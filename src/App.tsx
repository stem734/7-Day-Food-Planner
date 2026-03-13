import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'
import {
  dietaryOptions,
  emptyProductForm,
  sampleDemoFamily,
  sampleDemoInventory,
  storageZones,
} from './data'
import { buildMealPlan, formatRecipeIngredient, titleCase } from './lib/planner'
import { loadInitialState, saveLocalState } from './lib/storage'
import {
  getCurrentUserId,
  isSupabaseEnabled,
  loadCachedProduct,
  loadRemoteState,
  saveCachedProduct,
  saveRemoteState,
  signInWithPassword,
  signOut,
  signUpWithPassword,
  supabase,
} from './lib/supabase'
import type {
  AppState,
  CachedProduct,
  DietaryTag,
  DietProfile,
  InventoryItem,
  MealCookingFor,
  PlannedMeal,
  Recipe,
  ShoppingListItem,
  StorageZone,
} from './types'

type LookupState = 'idle' | 'loading' | 'error' | 'success'

type BarcodeDetectorResult = {
  rawValue?: string
}

type BarcodeDetectorInstance = {
  detect: (source: ImageBitmapSource) => Promise<BarcodeDetectorResult[]>
}

type BarcodeDetectorConstructor = new (options?: {
  formats?: string[]
}) => BarcodeDetectorInstance

declare global {
  interface Window {
    BarcodeDetector?: BarcodeDetectorConstructor
  }
}

const dietProfiles: DietProfile[] = ['Omnivore', 'Vegetarian', 'Vegan']

const emptyRecipeForm = {
  title: '',
  description: '',
  servings: '4',
  cookTime: '30',
  ingredients: [{ name: '', amount: '', unit: '' }],
  steps: '',
  dietaryTags: [] as DietaryTag[],
  allergens: '',
  zoneFocus: [] as StorageZone[],
  healthHighlights: '',
}

function recipeToForm(recipe: Recipe) {
  return {
    title: recipe.title,
    description: recipe.description,
    servings: String(recipe.servings),
    cookTime: String(recipe.cookTime),
    ingredients: recipe.ingredients.map((ingredient) => ({
      name: ingredient.name,
      amount: String(ingredient.amount),
      unit: ingredient.unit,
    })),
    steps: recipe.steps.join('\n'),
    dietaryTags: recipe.dietaryTags,
    allergens: recipe.allergens.join(', '),
    zoneFocus: recipe.zoneFocus,
    healthHighlights: recipe.healthHighlights.join(', '),
  }
}

function normalize(value: string) {
  return value.trim().toLowerCase()
}

function includesNormalized(haystack: string, needle: string) {
  return normalize(haystack).includes(normalize(needle))
}

function parseOptionalNumberInput(value: string) {
  if (!value.trim()) {
    return undefined
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseNumberInput(value: string, fallback: number) {
  return parseOptionalNumberInput(value) ?? fallback
}

function inferStorageZone(name: string, categories: string[]): AppState['inventory'][number]['zone'] {
  const source = `${name} ${categories.join(' ')}`.toLowerCase()

  if (
    ['frozen', 'ice-cream', 'ice cream', 'freezer', 'frozen-foods'].some((term) =>
      source.includes(term),
    )
  ) {
    return 'Freezer'
  }

  if (
    [
      'milk',
      'yogurt',
      'yoghurt',
      'cheese',
      'butter',
      'cream',
      'eggs',
      'fresh',
      'chilled',
      'juice',
      'salad',
      'fruit',
      'vegetable',
      'vegetables',
      'meat',
      'fish',
      'ham',
    ].some((term) => source.includes(term))
  ) {
    return 'Fridge'
  }

  return 'Cupboard'
}

function buildScannedItem(barcode: string, product: Record<string, unknown>): InventoryItem {
  const categoryText = Array.isArray(product.categories_tags)
    ? product.categories_tags.join(' ')
    : ''
  const categories = Array.isArray(product.categories_tags)
    ? product.categories_tags
        .map((tag) => String(tag).split(':').pop() ?? String(tag))
        .slice(0, 6)
    : []
  const allergens = Array.isArray(product.allergens_tags)
    ? product.allergens_tags.map((tag) => String(tag).split(':').pop() ?? String(tag))
    : []

  const dietaryTags = dietaryOptions.filter((tag) => {
    if (tag === 'Vegetarian') {
      return includesNormalized(categoryText, 'vegetarian')
    }
    if (tag === 'Vegan') {
      return includesNormalized(categoryText, 'vegan')
    }
    if (tag === 'Pescatarian') {
      return includesNormalized(categoryText, 'fish')
    }
    if (tag === 'Gluten-Free') {
      return includesNormalized(categoryText, 'gluten-free')
    }
    return false
  })

  const nutriments = (product.nutriments as Record<string, unknown> | undefined) ?? {}
  const novaGroup =
    typeof product.nova_group === 'number'
      ? product.nova_group
      : typeof product.nova_group === 'string'
        ? Number(product.nova_group) || undefined
        : undefined

  return {
    id: `barcode-${Date.now()}`,
    name: String(product.product_name || product.product_name_en || 'Scanned product'),
    brand: String(product.brands || ''),
    categories,
    quantity: 1,
    remainingPercent: undefined,
    unit: 'pack',
    zone: inferStorageZone(
      String(product.product_name || product.product_name_en || 'Scanned product'),
      categories,
    ),
    expiresOn: '',
    barcode,
    source: 'barcode',
    dietaryTags,
    allergens,
    health: {
      calories: Number(nutriments['energy-kcal_100g']) || undefined,
      protein: Number(nutriments.proteins_100g) || undefined,
      fiber: Number(nutriments.fiber_100g) || undefined,
      fat: Number(nutriments.fat_100g) || undefined,
      sugar: Number(nutriments.sugars_100g) || undefined,
      sodium: nutriments.sodium_100g ? Number(nutriments.sodium_100g) * 1000 : undefined,
      novaGroup,
    },
  }
}

function buildDraftFromCachedProduct(product: CachedProduct): InventoryItem {
  return {
    id: `barcode-${Date.now()}`,
    name: product.name,
    brand: product.brand ?? '',
    categories: product.categories,
    quantity: 1,
    remainingPercent: undefined,
    unit: product.unit,
    zone: product.zone,
    expiresOn: '',
    barcode: product.barcode,
    source: 'barcode',
    dietaryTags: product.dietaryTags,
    allergens: product.allergens,
    health: product.health,
  }
}

function toCachedProduct(item: InventoryItem): CachedProduct {
  return {
    barcode: item.barcode ?? '',
    name: item.name,
    brand: item.brand ?? '',
    categories: item.categories,
    unit: item.unit,
    zone: item.zone,
    dietaryTags: item.dietaryTags,
    allergens: item.allergens,
    health: item.health,
  }
}

function App() {
  const initialState = useMemo(() => loadInitialState(), [])
  const [inventory, setInventory] = useState<AppState['inventory']>(initialState.inventory)
  const [family, setFamily] = useState<AppState['family']>(initialState.family)
  const [userRecipes, setUserRecipes] = useState<AppState['userRecipes']>(initialState.userRecipes)
  const [householdNeeds, setHouseholdNeeds] = useState<AppState['householdNeeds']>(
    initialState.householdNeeds,
  )
  const [cookedMeals, setCookedMeals] = useState<AppState['cookedMeals']>(initialState.cookedMeals)
  const [mealCookingFor, setMealCookingFor] = useState<AppState['mealCookingFor']>(
    initialState.mealCookingFor,
  )
  const [mealRecipeOverrides, setMealRecipeOverrides] = useState<AppState['mealRecipeOverrides']>(
    initialState.mealRecipeOverrides,
  )
  const [mealInventoryAdjustments, setMealInventoryAdjustments] = useState<AppState['mealInventoryAdjustments']>(
    initialState.mealInventoryAdjustments,
  )
  const [shoppingChecked, setShoppingChecked] = useState<AppState['shoppingChecked']>(
    initialState.shoppingChecked,
  )
  const [shoppingExtras, setShoppingExtras] = useState<AppState['shoppingExtras']>(
    initialState.shoppingExtras,
  )
  const [purchaseHistory, setPurchaseHistory] = useState<AppState['purchaseHistory']>(
    initialState.purchaseHistory,
  )
  const [manualItem, setManualItem] = useState(emptyProductForm)
  const [manualQuantityInput, setManualQuantityInput] = useState('1')
  const [memberForm, setMemberForm] = useState({
    name: '',
    dietProfile: 'Omnivore' as DietProfile,
    eatsFish: false,
    dietaryNeeds: [] as DietaryTag[],
    avoidIngredients: '',
  })
  const [barcode, setBarcode] = useState('')
  const [lookupState, setLookupState] = useState<LookupState>('idle')
  const [lookupMessage, setLookupMessage] = useState('Ready to look up products from Open Food Facts.')
  const [productDraft, setProductDraft] = useState<InventoryItem | null>(null)
  const [draftQuantityInput, setDraftQuantityInput] = useState('1')
  const [isScannerOpen, setIsScannerOpen] = useState(false)
  const [scannerZone, setScannerZone] = useState<'main' | InventoryItem['zone'] | null>(null)
  const [scannerMessage, setScannerMessage] = useState('Use your camera to detect an EAN/UPC barcode.')
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin')
  const [authForm, setAuthForm] = useState({ email: '', password: '' })
  const [authStatus, setAuthStatus] = useState(
    isSupabaseEnabled
      ? 'Sign in to sync your planner across devices.'
      : 'Cloud sync is off until Supabase environment variables are configured.',
  )
  const [userId, setUserId] = useState<string | null>(null)
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [remoteReady, setRemoteReady] = useState(false)
  const [isSavingRemote, setIsSavingRemote] = useState(false)
  const [isFamilyModalOpen, setIsFamilyModalOpen] = useState(false)
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false)
  const [isShoppingListModalOpen, setIsShoppingListModalOpen] = useState(false)
  const [shoppingFeedback, setShoppingFeedback] = useState('')
  const [selectedMeal, setSelectedMeal] = useState<PlannedMeal | null>(null)
  const [isRecipeModalOpen, setIsRecipeModalOpen] = useState(false)
  const [editingRecipeId, setEditingRecipeId] = useState<string | null>(null)
  const [recipeSearch, setRecipeSearch] = useState('')
  const [recipeForm, setRecipeForm] = useState(emptyRecipeForm)
  const [openMealDay, setOpenMealDay] = useState<string | null>(null)
  const [mealRegenerations, setMealRegenerations] = useState<Record<string, number>>({})
  const [inventoryQuantityInputs, setInventoryQuantityInputs] = useState<Record<string, string>>({})
  const [inventorySort, setInventorySort] = useState<{
    key:
      | 'name'
      | 'brand'
      | 'quantity'
      | 'expiresOn'
      | 'calories'
      | 'protein'
      | 'sodium'
    direction: 'asc' | 'desc'
  }>({
    key: 'name',
    direction: 'asc',
  })
  const [inventorySearch, setInventorySearch] = useState('')
  const [openInventoryDetails, setOpenInventoryDetails] = useState<Record<string, boolean>>({})
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const scannerIntervalRef = useRef<number | null>(null)

  const appState = useMemo(
    () => ({
      inventory,
      family,
      userRecipes,
      householdNeeds,
      cookedMeals,
      mealCookingFor,
      mealRecipeOverrides,
      mealInventoryAdjustments,
      shoppingChecked,
      shoppingExtras,
      purchaseHistory,
    }),
    [
      cookedMeals,
      family,
      userRecipes,
      householdNeeds,
      inventory,
      mealCookingFor,
      mealRecipeOverrides,
      mealInventoryAdjustments,
      purchaseHistory,
      shoppingChecked,
      shoppingExtras,
    ],
  )
  const mealPlan = useMemo(
    () =>
      buildMealPlan(
        inventory,
        family,
        householdNeeds,
        userRecipes,
        mealRecipeOverrides,
        mealRegenerations,
      ),
    [family, householdNeeds, inventory, mealRecipeOverrides, mealRegenerations, userRecipes],
  )
  const filteredMealPlan = useMemo(() => {
    if (!recipeSearch.trim()) {
      return mealPlan
    }

    const query = normalize(recipeSearch)

    return mealPlan.filter((meal) => {
      const source = [
        meal.day,
        meal.recipe.title,
        meal.recipe.description,
        ...meal.recipe.ingredients.map((ingredient) => ingredient.name),
        ...meal.recipe.dietaryTags,
      ]
        .join(' ')
        .toLowerCase()

      return source.includes(query)
    })
  }, [mealPlan, recipeSearch])
  const shoppingList = useMemo(() => {
    const grouped = new Map<string, ShoppingListItem>()
    const allItems = [...shoppingExtras]

    allItems.forEach((item) => {
      const key = normalize(item.name)
      const existing = grouped.get(key)

      if (existing) {
        existing.neededFor = Array.from(new Set([...existing.neededFor, ...item.neededFor]))
        if (item.priority === 'High') {
          existing.priority = 'High'
        }
        return
      }

      grouped.set(key, {
        ...item,
        neededFor: Array.from(new Set(item.neededFor)),
      })
    })

    return Array.from(grouped.values()).sort((left, right) => left.name.localeCompare(right.name))
  }, [shoppingExtras])
  const shoppingListNames = useMemo(
    () => new Set(shoppingList.map((item) => normalize(item.name))),
    [shoppingList],
  )
  const duplicateDraftItems = useMemo(() => {
    if (!productDraft) {
      return []
    }

    return inventory.filter((item) => {
      if (item.zone !== productDraft.zone) {
        return false
      }

      if (item.barcode && productDraft.barcode) {
        return item.barcode === productDraft.barcode
      }

      return normalize(item.name) === normalize(productDraft.name)
    })
  }, [inventory, productDraft])
  const shoppingListByZone = useMemo(() => {
    const zoneOrder: StorageZone[] = ['Cupboard', 'Fridge', 'Freezer']

    return zoneOrder
      .map((zone) => {
        const items = shoppingList.filter((item) => item.zone === zone)
        const pending = items.filter((item) => !shoppingChecked[item.name])
        const bought = items.filter((item) => shoppingChecked[item.name])

        return {
          zone,
          items: [...pending, ...bought],
        }
      })
      .filter(({ items }) => items.length > 0)
  }, [shoppingChecked, shoppingList])
  const suggestedRebuys = useMemo(() => {
    const today = new Date()
    const shoppingKeys = new Set(shoppingList.map((item) => normalize(item.name)))
    const grouped = new Map<
      string,
      {
        name: string
        zone: StorageZone
        rebuyEveryDays?: number
        remainingPercent?: number
        lastPurchasedOn?: string
      }
    >()

    inventory.forEach((item) => {
      const key = normalize(item.name)
      const existing = grouped.get(key)

      if (!existing) {
        grouped.set(key, {
          name: titleCase(item.name),
          zone: item.zone,
          rebuyEveryDays: item.rebuyEveryDays,
          remainingPercent: item.remainingPercent,
          lastPurchasedOn: item.lastPurchasedOn,
        })
        return
      }

      existing.rebuyEveryDays = existing.rebuyEveryDays ?? item.rebuyEveryDays
      existing.remainingPercent =
        existing.remainingPercent === undefined
          ? item.remainingPercent
          : Math.min(existing.remainingPercent, item.remainingPercent ?? 100)
      if (
        item.lastPurchasedOn &&
        (!existing.lastPurchasedOn ||
          new Date(item.lastPurchasedOn).getTime() > new Date(existing.lastPurchasedOn).getTime())
      ) {
        existing.lastPurchasedOn = item.lastPurchasedOn
      }
    })

    const medianFromHistory = (name: string) => {
      const dates = purchaseHistory
        .filter((entry) => normalize(entry.name) === normalize(name))
        .map((entry) => new Date(entry.date).getTime())
        .filter((value) => Number.isFinite(value))
        .sort((left, right) => left - right)

      if (dates.length < 2) {
        return undefined
      }

      const diffs: number[] = []
      for (let index = 1; index < dates.length; index += 1) {
        const diffDays = Math.round((dates[index] - dates[index - 1]) / 86400000)
        if (diffDays > 0) {
          diffs.push(diffDays)
        }
      }

      if (!diffs.length) {
        return undefined
      }

      const sortedDiffs = [...diffs].sort((left, right) => left - right)
      const middle = Math.floor(sortedDiffs.length / 2)
      return sortedDiffs.length % 2 === 0
        ? Math.round((sortedDiffs[middle - 1] + sortedDiffs[middle]) / 2)
        : sortedDiffs[middle]
    }

    return Array.from(grouped.values())
      .map((item) => {
        const rebuyEveryDays = item.rebuyEveryDays ?? medianFromHistory(item.name)
        if (!rebuyEveryDays || shoppingKeys.has(normalize(item.name))) {
          return null
        }

        const lastPurchasedOn = item.lastPurchasedOn
          ?? purchaseHistory
            .filter((entry) => normalize(entry.name) === normalize(item.name))
            .map((entry) => entry.date)
            .sort()
            .pop()

        if (!lastPurchasedOn) {
          return null
        }

        const daysSince = Math.max(
          0,
          Math.round((today.getTime() - new Date(lastPurchasedOn).getTime()) / 86400000),
        )
        const daysUntil = rebuyEveryDays - daysSince
        const lowRemaining = item.remainingPercent !== undefined && item.remainingPercent <= 20

        if (!lowRemaining && daysUntil > 3) {
          return null
        }

        return {
          ...item,
          rebuyEveryDays,
          dueLabel: lowRemaining
            ? `${item.remainingPercent}% left`
            : daysUntil <= 0
              ? 'Due now'
              : `Likely needed in ${daysUntil} day${daysUntil === 1 ? '' : 's'}`,
        }
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .sort((left, right) => left.name.localeCompare(right.name))
  }, [inventory, purchaseHistory, shoppingList])

  function getShoppingListCoverage(ingredients: string[]) {
    return ingredients.filter((ingredient) => shoppingListNames.has(normalize(ingredient)))
  }

  function getOutstandingIngredients(ingredients: string[]) {
    return ingredients.filter((ingredient) => !shoppingListNames.has(normalize(ingredient)))
  }
  const inventoryByZone = useMemo(() => {
    const sortedItems = [...inventory].sort((left, right) => {
      const factor = inventorySort.direction === 'asc' ? 1 : -1

      const getValue = (item: InventoryItem) => {
        switch (inventorySort.key) {
          case 'brand':
            return item.brand ?? ''
          case 'quantity':
            return item.quantity
          case 'expiresOn':
            return item.expiresOn || '9999-12-31'
          case 'calories':
            return item.health.calories ?? -1
          case 'protein':
            return item.health.protein ?? -1
          case 'sodium':
            return item.health.sodium ?? -1
          case 'name':
          default:
            return item.name
        }
      }

      const leftValue = getValue(left)
      const rightValue = getValue(right)

      if (typeof leftValue === 'number' && typeof rightValue === 'number') {
        return (leftValue - rightValue) * factor
      }

      return String(leftValue).localeCompare(String(rightValue)) * factor
    })

    const filteredItems = sortedItems.filter((item) => {
      if (!inventorySearch.trim()) {
        return true
      }

      const query = inventorySearch.toLowerCase()
      return [
        item.name,
        item.brand ?? '',
        item.zone,
        item.barcode ?? '',
        item.unit,
        item.categories.join(' '),
        item.allergens.join(' '),
        item.dietaryTags.join(' '),
      ]
        .join(' ')
        .toLowerCase()
        .includes(query)
    })

    return storageZones.map((zone) => ({
      zone,
      items: filteredItems.filter((item) => item.zone === zone),
    }))
  }, [inventory, inventorySearch, inventorySort])

  useEffect(() => {
    saveLocalState(appState)
  }, [appState])

  useEffect(() => {
    return () => {
      if (scannerIntervalRef.current) {
        window.clearInterval(scannerIntervalRef.current)
      }
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  useEffect(() => {
    if (!isScannerOpen || !videoRef.current || !mediaStreamRef.current) {
      return
    }

    videoRef.current.srcObject = mediaStreamRef.current
    void videoRef.current.play().catch(() => {
      setScannerMessage('Camera opened, but playback was blocked. Tap scan again if needed.')
    })
  }, [isScannerOpen, scannerZone])

  useEffect(() => {
    const client = supabase
    if (!client) {
      return
    }

    let mounted = true

    void getCurrentUserId().then(async (id) => {
      if (!mounted) {
        return
      }

      setUserId(id)

      const {
        data: { session },
      } = await client.auth.getSession()

      if (!mounted) {
        return
      }

      setUserEmail(session?.user.email ?? null)
    })

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user.id ?? null)
      setUserEmail(session?.user.email ?? null)
      setRemoteReady(false)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!userId) {
      return
    }

    let cancelled = false

    void loadRemoteState(userId)
      .then((remoteState) => {
        if (cancelled) {
          return
        }

        if (remoteState) {
          setInventory(remoteState.inventory)
          setFamily(remoteState.family)
          setUserRecipes(remoteState.userRecipes)
          setHouseholdNeeds(remoteState.householdNeeds)
          setCookedMeals(remoteState.cookedMeals)
          setMealCookingFor(remoteState.mealCookingFor)
          setMealRecipeOverrides(remoteState.mealRecipeOverrides)
          setMealInventoryAdjustments(remoteState.mealInventoryAdjustments)
          setShoppingChecked(remoteState.shoppingChecked)
          setShoppingExtras(remoteState.shoppingExtras)
          setPurchaseHistory(remoteState.purchaseHistory)
          setAuthStatus('Cloud sync is active.')
        } else {
          setAuthStatus('Cloud account ready. The first sync will upload this device state.')
        }

        setRemoteReady(true)
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return
        }

        setRemoteReady(true)
        setAuthStatus(
          error instanceof Error ? error.message : 'Cloud sync could not load your saved state.',
        )
      })

    return () => {
      cancelled = true
    }
  }, [userId])

  useEffect(() => {
    if (!userId || !remoteReady) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setIsSavingRemote(true)
      void saveRemoteState(userId, appState)
        .then(() => {
          setAuthStatus('Changes synced to cloud.')
        })
        .catch((error: unknown) => {
          setAuthStatus(
            error instanceof Error ? error.message : 'Cloud sync failed while saving changes.',
          )
        })
        .finally(() => {
          setIsSavingRemote(false)
        })
    }, 700)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [appState, remoteReady, userId])

  useEffect(() => {
    if (!shoppingFeedback) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setShoppingFeedback('')
    }, 2200)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [shoppingFeedback])

  async function lookupBarcodeValue(value: string) {
    if (isSupabaseEnabled) {
      try {
        const cached = await loadCachedProduct(value)
        if (cached) {
          return {
            draft: buildDraftFromCachedProduct(cached),
            source: 'cache' as const,
          }
        }
      } catch {
        // Fall back to Open Food Facts if shared cache lookup fails.
      }
    }

    const response = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(value)}.json`,
    )
    const data = (await response.json()) as {
      status?: number
      product?: Record<string, unknown>
    }

    if (!response.ok || data.status !== 1 || !data.product) {
      throw new Error('Product not found')
    }

    const draft = buildScannedItem(value, data.product)

    if (isSupabaseEnabled) {
      void saveCachedProduct(toCachedProduct(draft)).catch(() => {
        // Ignore cache-write failures during lookup; the scanned item still works.
      })
    }

    return {
      draft,
      source: 'openfoodfacts' as const,
    }
  }

  async function lookupBarcode() {
    if (!barcode.trim()) {
      setLookupState('error')
      setLookupMessage('Enter a barcode first.')
      return
    }

    setLookupState('loading')
    setLookupMessage('Looking up product details...')

    try {
      const { draft, source } = await lookupBarcodeValue(barcode)
      setProductDraft(draft)
      setDraftQuantityInput(String(draft.quantity))
      setLookupState('success')
      setLookupMessage(
        source === 'cache'
          ? `Found ${draft.name} from shared cache. Suggested storage: ${draft.zone}. Confirm quantity, then add it.`
          : `Found ${draft.name}. Suggested storage: ${draft.zone}. Confirm quantity, then add it.`,
      )
    } catch {
      setLookupState('error')
      setLookupMessage('No matching product was found from Open Food Facts for that barcode.')
    }
  }

  async function startScanner(zone: 'main' | InventoryItem['zone'] = 'main') {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
      })

      mediaStreamRef.current = stream
      setScannerZone(zone)
      setIsScannerOpen(true)
      setScannerMessage(
        window.BarcodeDetector
          ? 'Point the camera at a barcode.'
          : 'Camera is open, but barcode detection is not available in this browser. Enter the barcode manually if needed.',
      )

      if (!window.BarcodeDetector) {
        return
      }

      const detector = new window.BarcodeDetector({
        formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'],
      })

      if (scannerIntervalRef.current) {
        window.clearInterval(scannerIntervalRef.current)
      }

      scannerIntervalRef.current = window.setInterval(async () => {
        if (!videoRef.current) {
          return
        }

        try {
          const results = await detector.detect(videoRef.current)
          const code = results[0]?.rawValue

          if (code) {
            if (scannerIntervalRef.current) {
              window.clearInterval(scannerIntervalRef.current)
              scannerIntervalRef.current = null
            }
            setBarcode(code)
            setScannerMessage(`Detected barcode ${code}.`)
            stopScanner()
            setLookupState('loading')
            setLookupMessage('Looking up detected barcode...')

            try {
              const { draft, source } = await lookupBarcodeValue(code)
              const nextDraft = zone === 'main' ? draft : { ...draft, zone }
              setProductDraft(nextDraft)
              setDraftQuantityInput(String(nextDraft.quantity))
              setLookupState('success')
              setLookupMessage(
                source === 'cache'
                  ? 'Barcode detected and product details loaded from shared cache.'
                  : 'Barcode detected and product details loaded.',
              )
            } catch {
              setLookupState('error')
              setLookupMessage('Barcode detected, but the product was not found in Open Food Facts.')
            }
          }
        } catch {
          setScannerMessage('Scanning is active, but detection is still waiting for a clearer barcode.')
        }
      }, 900)
    } catch {
      setScannerMessage('Camera access was blocked. Manual barcode entry is still available.')
      setScannerZone(zone)
      setIsScannerOpen(true)
    }
  }

  function stopScanner() {
    if (scannerIntervalRef.current) {
      window.clearInterval(scannerIntervalRef.current)
      scannerIntervalRef.current = null
    }
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
    mediaStreamRef.current = null
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    setIsScannerOpen(false)
    setScannerZone(null)
  }

  function addInventoryItem(item: InventoryItem) {
    const purchasedOn = item.lastPurchasedOn || new Date().toISOString().slice(0, 10)
    setInventory((current) => [{ ...item, lastPurchasedOn: purchasedOn }, ...current])
    setPurchaseHistory((current) => [...current, { name: item.name, date: purchasedOn }])
  }

  function removeShoppingItemsForMeal(day: string) {
    const mealPrefix = `${day}: `
    let removedLinks = 0
    const removedNames: string[] = []

    setShoppingExtras((current) =>
      current
        .map((item) => {
          const remainingNeededFor = item.neededFor.filter((entry) => {
            const matchesMeal = entry.startsWith(mealPrefix)
            if (matchesMeal) {
              removedLinks += 1
            }
            return !matchesMeal
          })

          if (!remainingNeededFor.length) {
            removedNames.push(item.name)
            return null
          }

          return {
            ...item,
            neededFor: remainingNeededFor,
          }
        })
        .filter((item): item is ShoppingListItem => item !== null),
    )

    if (removedLinks) {
      setShoppingChecked((current) => {
        const next = { ...current }
        removedNames.forEach((name) => {
          delete next[name]
        })
        return next
      })
      setShoppingFeedback(
        removedLinks === 1
          ? `Shopping list updated for ${day}: 1 linked item removed.`
          : `Shopping list updated for ${day}: ${removedLinks} linked items removed.`,
      )
    }
  }

  function regenerateMeal(day: string) {
    removeShoppingItemsForMeal(day)
    setMealRegenerations((current) => ({
      ...current,
      [day]: (current[day] ?? 0) + 1,
    }))
    setOpenMealDay(day)
    setSelectedMeal((current) => (current?.day === day ? null : current))
  }

  function loadSampleDemoData() {
    setInventory(sampleDemoInventory)
    setFamily(sampleDemoFamily)
    setUserRecipes([])
    setHouseholdNeeds([])
    setCookedMeals({})
    setMealCookingFor({})
    setMealRecipeOverrides({})
    setMealInventoryAdjustments({})
    setShoppingChecked({})
    setShoppingExtras([])
    setPurchaseHistory([])
    setManualQuantityInput('1')
    setDraftQuantityInput('1')
    setInventorySearch('')
    setBarcode('')
    setProductDraft(null)
    setLookupState('success')
    setLookupMessage('Sample demo data loaded from the built-in Open Food Facts-style seed set.')
  }

  function updateInventoryItem(
    itemId: string,
    updater: (item: InventoryItem) => InventoryItem,
  ) {
    setInventory((current) => current.map((item) => (item.id === itemId ? updater(item) : item)))
  }

  function getInventoryQuantityInput(item: InventoryItem) {
    return inventoryQuantityInputs[item.id] ?? String(item.quantity)
  }

  function toggleInventorySort(key: typeof inventorySort.key) {
    setInventorySort((current) => ({
      key,
      direction:
        current.key === key ? (current.direction === 'asc' ? 'desc' : 'asc') : 'asc',
    }))
  }

  function toggleInventoryDetails(itemId: string) {
    setOpenInventoryDetails((current) => ({
      ...current,
      [itemId]: !current[itemId],
    }))
  }

  function handleDraftAdd() {
    if (!productDraft) {
      return
    }

    addInventoryItem({
      ...productDraft,
      quantity: parseNumberInput(draftQuantityInput, productDraft.quantity || 1),
    })
    setProductDraft(null)
    setDraftQuantityInput('1')
    setLookupMessage('Product added to inventory.')
    setLookupState('idle')
    setBarcode('')
  }

  function handleAddFamilyMember(event: FormEvent) {
    event.preventDefault()
    if (!memberForm.name.trim()) {
      return
    }

    setFamily((current) => [
      ...current,
      {
        id: `member-${Date.now()}`,
        name: titleCase(memberForm.name.trim()),
        dietProfile: memberForm.dietProfile,
        eatsFish: memberForm.eatsFish,
        dietaryNeeds: memberForm.dietaryNeeds,
        avoidIngredients: memberForm.avoidIngredients,
      },
    ])
    setMemberForm({
      name: '',
      dietProfile: 'Omnivore',
      eatsFish: false,
      dietaryNeeds: [],
      avoidIngredients: '',
    })
  }

  function updateFamilyMember(
    memberId: string,
    updater: (member: AppState['family'][number]) => AppState['family'][number],
  ) {
    setFamily((current) => current.map((member) => (member.id === memberId ? updater(member) : member)))
  }

  function removeFamilyMember(memberId: string) {
    setFamily((current) => current.filter((member) => member.id !== memberId))
  }

  function handleAddRecipe(event: FormEvent) {
    event.preventDefault()

    const ingredients = recipeForm.ingredients
      .map((item) => ({
        name: item.name.trim(),
        amount: parseNumberInput(item.amount, 1),
        unit: item.unit.trim(),
      }))
      .filter((item) => item.name)

    if (!recipeForm.title.trim() || !ingredients.length) {
      return
    }

    const steps = recipeForm.steps
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)

    const healthHighlights = recipeForm.healthHighlights
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)

    const allergens = recipeForm.allergens
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)

    const recipe: Recipe = {
      id: editingRecipeId ?? `user-recipe-${Date.now()}`,
      title: titleCase(recipeForm.title.trim()),
      description: recipeForm.description.trim(),
      servings: Math.max(1, parseNumberInput(recipeForm.servings, 4)),
      ingredients,
      steps,
      dietaryTags: recipeForm.dietaryTags,
      allergens,
      cookTime: Math.max(0, parseNumberInput(recipeForm.cookTime, 0)),
      zoneFocus: recipeForm.zoneFocus,
      nutrition: { calories: 0, protein: 0, fiber: 0, carbs: 0, fat: 0, sodium: 0 },
      healthHighlights: healthHighlights.length ? healthHighlights : ['Custom recipe'],
    }

    setUserRecipes((current) => {
      if (editingRecipeId) {
        return current.map((existing) => (existing.id === editingRecipeId ? recipe : existing))
      }

      return [recipe, ...current]
    })
    setRecipeForm(emptyRecipeForm)
    setEditingRecipeId(null)
    setIsRecipeModalOpen(false)
  }

  function startEditingRecipe(recipe: Recipe) {
    setEditingRecipeId(recipe.id)
    setRecipeForm(recipeToForm(recipe))
  }

  function deleteUserRecipe(recipeId: string) {
    setUserRecipes((current) => current.filter((recipe) => recipe.id !== recipeId))
    setMealRecipeOverrides((current) => {
      const next = { ...current }
      Object.entries(next).forEach(([day, selectedRecipeId]) => {
        if (selectedRecipeId === recipeId) {
          delete next[day]
        }
      })
      return next
    })

    if (editingRecipeId === recipeId) {
      setEditingRecipeId(null)
      setRecipeForm(emptyRecipeForm)
    }
  }

  function clearZone(zone: InventoryItem['zone']) {
    const itemCount = inventory.filter((item) => item.zone === zone).length
    if (!itemCount) {
      return
    }

    const confirmed = window.confirm(
      `Clear ${zone}? This will remove ${itemCount} ${itemCount === 1 ? 'item' : 'items'} from ${zone}.`,
    )

    if (!confirmed) {
      return
    }

    setInventory((current) => current.filter((item) => item.zone !== zone))
  }

  function removeInventoryItem(itemId: string) {
    setInventory((current) => current.filter((item) => item.id !== itemId))
    setInventoryQuantityInputs((current) => {
      const next = { ...current }
      delete next[itemId]
      return next
    })
    setOpenInventoryDetails((current) => {
      const next = { ...current }
      delete next[itemId]
      return next
    })
  }

  function toggleSelection<T extends string>(current: T[], value: T) {
    return current.includes(value)
      ? current.filter((item) => item !== value)
      : [...current, value]
  }

  function updateRecipeIngredient(
    index: number,
    updater: (ingredient: (typeof emptyRecipeForm.ingredients)[number]) => (typeof emptyRecipeForm.ingredients)[number],
  ) {
    setRecipeForm((current) => ({
      ...current,
      ingredients: current.ingredients.map((ingredient, ingredientIndex) =>
        ingredientIndex === index ? updater(ingredient) : ingredient,
      ),
    }))
  }

  function addRecipeIngredientRow() {
    setRecipeForm((current) => ({
      ...current,
      ingredients: [...current.ingredients, { name: '', amount: '', unit: '' }],
    }))
  }

  function removeRecipeIngredientRow(index: number) {
    setRecipeForm((current) => ({
      ...current,
      ingredients:
        current.ingredients.length === 1
          ? [{ name: '', amount: '', unit: '' }]
          : current.ingredients.filter((_, ingredientIndex) => ingredientIndex !== index),
    }))
  }

  async function handleAuthSubmit(event: FormEvent) {
    event.preventDefault()
    if (!isSupabaseEnabled) {
      return
    }

    try {
      setAuthStatus(authMode === 'signin' ? 'Signing in...' : 'Creating your account...')
      if (authMode === 'signin') {
        await signInWithPassword(authForm.email, authForm.password)
        setAuthStatus('Signed in. Syncing your household data...')
      } else {
        await signUpWithPassword(authForm.email, authForm.password)
        setAuthStatus('Account created. Check your inbox if email confirmation is enabled.')
      }
    } catch (error: unknown) {
      setAuthStatus(error instanceof Error ? error.message : 'Authentication failed.')
    }
  }

  async function handleSignOut() {
    try {
      await signOut()
      setAuthStatus('Signed out. Local data remains on this device.')
      setUserId(null)
      setUserEmail(null)
      setRemoteReady(false)
    } catch (error: unknown) {
      setAuthStatus(error instanceof Error ? error.message : 'Sign out failed.')
    }
  }

  function printMealRecipe(meal: PlannedMeal) {
    const printWindow = window.open('', '_blank', 'width=900,height=700')
    if (!printWindow) {
      return
    }

    const recipeTags = meal.recipe.dietaryTags.join(' · ') || 'No tags'
    const matched = meal.matchedIngredients.join(', ') || 'No exact inventory matches'
    const needed = meal.missingIngredients.join(', ') || 'Nothing else needed'
    const notes = meal.recipe.healthHighlights.join(' · ')
    const cookingForLabel = getCookingForLabel(meal.day)
    const scaledIngredients = meal.recipe.ingredients
      .map((item) => formatRecipeIngredient(item, getCookingForCount(meal.day), meal.recipe.servings))
      .map((item) => `<li>${item}</li>`)
      .join('')

    printWindow.document.write(`<!doctype html>
<html>
  <head>
    <title>${meal.recipe.title}</title>
    <style>
      body { font-family: Outfit, Arial, sans-serif; padding: 32px; color: #111827; }
      h1, h2 { margin: 0 0 12px; }
      p { margin: 0 0 14px; }
      .meta { color: #4b5563; margin-bottom: 24px; }
      .block { margin-bottom: 24px; }
      ul { margin: 8px 0 0 20px; }
    </style>
  </head>
  <body>
    <h1>${meal.recipe.title}</h1>
    <p class="meta">${meal.day} · ${meal.recipe.cookTime} min · Recipe serves ${meal.recipe.servings} · Cooking for ${cookingForLabel} · ${recipeTags}</p>
    <div class="block">
      <h2>Description</h2>
      <p>${meal.recipe.description}</p>
    </div>
    <div class="block">
      <h2>Ingredients</h2>
      <ul>${scaledIngredients}</ul>
    </div>
    <div class="block">
      <h2>Method</h2>
      <ol>${meal.recipe.steps.map((item) => `<li>${item}</li>`).join('')}</ol>
    </div>
    <div class="block">
      <h2>Nutrition</h2>
      <p>Calories: ${meal.recipe.nutrition.calories} · Protein: ${meal.recipe.nutrition.protein}g · Fibre: ${meal.recipe.nutrition.fiber}g · Sodium: ${meal.recipe.nutrition.sodium}mg</p>
    </div>
    <div class="block">
      <h2>Inventory Match</h2>
      <p><strong>Matched:</strong> ${matched}</p>
      <p><strong>Still needed:</strong> ${needed}</p>
    </div>
    <div class="block">
      <h2>Health Notes</h2>
      <p>${notes}</p>
    </div>
  </body>
</html>`)
    printWindow.document.close()
    printWindow.focus()
    printWindow.print()
  }

  function printShoppingList() {
    const printWindow = window.open('', '_blank', 'width=760,height=700')
    if (!printWindow) {
      return
    }

    const itemsMarkup = shoppingListByZone.length
      ? shoppingListByZone
          .map(
            ({ zone, items }) => `
      <section>
        <h2>${zone}</h2>
        <ul>
          ${items
            .map(
              (item) => `
            <li>
              <div class="shopping-check">${shoppingChecked[item.name] ? '☑' : '☐'}</div>
              <div>
                <strong>${item.name}</strong>
                <p>Needed for: ${item.neededFor.join(', ')}</p>
              </div>
              <span>${item.priority} priority</span>
            </li>`,
            )
            .join('')}
        </ul>
      </section>`,
          )
          .join('')
      : '<section><ul><li><div><strong>No shopping items yet</strong><p>Add missing ingredients from recipe views when you decide what to buy.</p></div></li></ul></section>'

    printWindow.document.write(`<!doctype html>
<html>
  <head>
    <title>Shopping List</title>
    <style>
      body { font-family: Outfit, Arial, sans-serif; padding: 32px; color: #111827; }
      h1, h2, p { margin: 0; }
      .meta { margin: 8px 0 24px; color: #4b5563; }
      h2 { margin: 24px 0 12px; font-size: 1rem; }
      ul { list-style: none; padding: 0; margin: 0; }
      li { display: grid; grid-template-columns: 30px 1fr auto; align-items: start; gap: 16px; padding: 14px 0; border-bottom: 2px solid #e5e7eb; }
      strong { display: block; margin-bottom: 6px; }
      span { white-space: nowrap; }
      .shopping-check { font-size: 1.1rem; line-height: 1.3; }
    </style>
  </head>
  <body>
    <h1>Shopping List</h1>
    <p class="meta">Saved shopping list · ${shoppingList.length} item${shoppingList.length === 1 ? '' : 's'}</p>
    ${itemsMarkup}
  </body>
</html>`)
    printWindow.document.close()
    printWindow.focus()
    printWindow.print()
  }

  function toggleShoppingItem(itemName: string) {
    setShoppingChecked((current) => ({
      ...current,
      [itemName]: !current[itemName],
    }))
  }

  function getCookingForValue(day: string): MealCookingFor {
    return mealCookingFor[day] ?? 'all'
  }

  function getCookingForLabel(day: string) {
    const value = getCookingForValue(day)
    if (value === 'all') {
      return family.length ? `all (${family.length})` : 'all'
    }

    return String(value)
  }

  function getCookingForCount(day: string) {
    const value = getCookingForValue(day)
    if (value === 'all') {
      return Math.max(family.length, 1)
    }

    return value
  }

  function updateMealCookingFor(day: string, value: MealCookingFor) {
    setMealCookingFor((current) => ({
      ...current,
      [day]: value,
    }))
  }

  function updateMealRecipeOverride(day: string, recipeId: string) {
    setMealRecipeOverrides((current) => {
      if (!recipeId) {
        const next = { ...current }
        delete next[day]
        return next
      }

      return {
        ...current,
        [day]: recipeId,
      }
    })
  }

  function toggleCookedMeal(meal: PlannedMeal, checked: boolean) {
    if (checked) {
      const usedItemIds = new Set<string>()
      const consumedItems: InventoryItem[] = []

      setInventory((current) =>
        current
          .map((item) => {
            const shouldConsume = meal.matchedIngredients.some(
              (ingredient) =>
                !usedItemIds.has(item.id) && includesNormalized(normalize(item.name), ingredient),
            )

            if (!shouldConsume) {
              return item
            }

            usedItemIds.add(item.id)
            consumedItems.push({ ...item, quantity: 1 })

            if (item.quantity > 1) {
              return {
                ...item,
                quantity: item.quantity - 1,
              }
            }

            return null
          })
          .filter((item): item is InventoryItem => item !== null),
      )

      setMealInventoryAdjustments((current) => ({
        ...current,
        [meal.day]: consumedItems,
      }))
      setCookedMeals((current) => ({
        ...current,
        [meal.day]: true,
      }))
      return
    }

    const consumedItems = mealInventoryAdjustments[meal.day] ?? []

    if (consumedItems.length) {
      setInventory((current) => {
        const next = [...current]

        consumedItems.forEach((consumedItem) => {
          const existingIndex = next.findIndex((item) => item.id === consumedItem.id)
          if (existingIndex >= 0) {
            next[existingIndex] = {
              ...next[existingIndex],
              quantity: next[existingIndex].quantity + consumedItem.quantity,
            }
            return
          }

          next.unshift(consumedItem)
        })

        return next
      })
    }

    setMealInventoryAdjustments((current) => {
      const next = { ...current }
      delete next[meal.day]
      return next
    })
    setCookedMeals((current) => ({
      ...current,
      [meal.day]: false,
    }))
  }

  function inferShoppingZoneForItem(name: string): StorageZone {
    const source = normalize(name)

    if (['ice cream', 'frozen', 'frozen peas', 'frozen berries', 'chips'].some((term) => source.includes(term))) {
      return 'Freezer'
    }

    if (
      [
        'milk',
        'yogurt',
        'yoghurt',
        'cheese',
        'butter',
        'cream',
        'egg',
        'eggs',
        'spinach',
        'cucumber',
        'salad',
        'lettuce',
        'fruit',
        'vegetable',
        'vegetables',
        'chicken',
        'fish',
        'meat',
        'fresh',
      ].some((term) => source.includes(term))
    ) {
      return 'Fridge'
    }

    return 'Cupboard'
  }

  function addItemsToShoppingList(items: string[], neededFor: string, priority: 'High' | 'Medium' = 'Medium') {
    const cleanedItems = items.map((item) => titleCase(item.trim())).filter(Boolean)
    if (!cleanedItems.length) {
      return
    }

    let addedCount = 0
    let updatedCount = 0

    setShoppingExtras((current) => {
      const grouped = new Map(current.map((item) => [normalize(item.name), item] as const))

      cleanedItems.forEach((name) => {
        const key = normalize(name)
        const existing = grouped.get(key)

        if (existing) {
          existing.neededFor = Array.from(new Set([...existing.neededFor, neededFor]))
          if (priority === 'High') {
            existing.priority = 'High'
          }
          updatedCount += 1
          return
        }

        grouped.set(key, {
          name,
          zone: inferShoppingZoneForItem(name),
          neededFor: [neededFor],
          priority,
        })
        addedCount += 1
      })

      return Array.from(grouped.values())
    })

    if (addedCount && updatedCount) {
      setShoppingFeedback(`Shopping list updated: ${addedCount} added, ${updatedCount} already there.`)
      return
    }

    if (addedCount > 1) {
      setShoppingFeedback(`${addedCount} items added to your shopping list.`)
      return
    }

    if (addedCount === 1) {
      setShoppingFeedback(`${cleanedItems[0]} added to your shopping list.`)
      return
    }

    setShoppingFeedback('Shopping list updated.')
  }

  return (
    <div className="app-shell">
      {shoppingFeedback ? (
        <div className="shopping-feedback" role="status" aria-live="polite">
          {shoppingFeedback}
        </div>
      ) : null}
      <header className="hero">
        <div>
          <p className="eyebrow">7 Day Food Planner</p>
          <h1>7 Day Food Planner</h1>
          <p className="hero-copy">
            Track cupboard, fridge, and freezer items, scan barcodes, manage family food
            preferences, and build a seven-day plan with a shopping list.
          </p>
          <div className="hero-actions">
            <button type="button" className="secondary" onClick={() => setIsFamilyModalOpen(true)}>
              Family
            </button>
            <button type="button" className="secondary" onClick={() => setIsSyncModalOpen(true)}>
              Sync & Backup
            </button>
          </div>
        </div>
        <div className="hero-metrics">
          <article>
            <span>{inventory.length}</span>
            <p>Tracked items</p>
            <button type="button" className="metric-button" onClick={loadSampleDemoData}>
              Load Sample Data
            </button>
          </article>
          <article>
            <span>{shoppingList.length}</span>
            <p>Shopping items</p>
            <button
              type="button"
              className="metric-button"
              onClick={() => setIsShoppingListModalOpen(true)}
            >
              View Shopping List
            </button>
          </article>
          <article>
            <span>{mealPlan.filter((meal) => cookedMeals[meal.day]).length}</span>
            <p>Cooked meals</p>
          </article>
        </div>
      </header>

      <main className="dashboard">
        <section className="panel panel-wide">
          <div className="panel-heading inventory-toolbar">
            <div className="inventory-panel-actions">
              <input
                value={inventorySearch}
                onChange={(event) => setInventorySearch(event.target.value)}
                placeholder="Search all kitchen stock"
              />
              <button type="button" className="secondary" onClick={() => void startScanner('main')}>
                Scan item
              </button>
            </div>
          </div>
          <p className={`status ${lookupState}`}>{lookupMessage}</p>
          {productDraft ? (
            <div className="draft-card main-draft-card">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Scanned Item</p>
                  <h3>{productDraft.name}</h3>
                </div>
                <span className="badge">{productDraft.zone}</span>
              </div>
              <p>
                Barcode {productDraft.barcode} · Brand {productDraft.brand || 'Unknown'} ·{' '}
                {productDraft.health.calories ?? 'n/a'} kcal per 100g
                {productDraft.health.novaGroup
                  ? ` · NOVA ${productDraft.health.novaGroup}`
                  : ''}
              </p>
              {duplicateDraftItems.length ? (
                <p className="status loading">
                  Already in {productDraft.zone}: {duplicateDraftItems
                    .map((item) => `${item.name} (${item.quantity} ${item.unit})`)
                    .join(', ')}
                </p>
              ) : null}
              <div className="inline-fields">
                <label>
                  Amount in stock
                  <input
                    type="number"
                    min="1"
                    step="0.1"
                    value={draftQuantityInput}
                    onChange={(event) =>
                      setDraftQuantityInput(event.target.value)
                    }
                  />
                </label>
                <label>
                  % left
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={productDraft.remainingPercent ?? ''}
                    onChange={(event) =>
                      setProductDraft((current) =>
                        current
                          ? {
                              ...current,
                              remainingPercent: event.target.value
                                ? Number(event.target.value)
                                : undefined,
                            }
                          : current,
                      )
                    }
                    placeholder="Optional"
                  />
                </label>
                <label>
                  Unit / measure
                  <input
                    value={productDraft.unit}
                    onChange={(event) =>
                      setProductDraft((current) =>
                        current ? { ...current, unit: event.target.value } : current,
                      )
                    }
                    placeholder="bag, g, potatoes"
                  />
                </label>
                <label>
                  Suggested section
                  <select
                    value={productDraft.zone}
                    onChange={(event) =>
                      setProductDraft((current) =>
                        current ? { ...current, zone: event.target.value as InventoryItem['zone'] } : current,
                      )
                    }
                  >
                    {storageZones.map((zone) => (
                      <option key={zone} value={zone}>
                        {zone}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <button type="button" onClick={handleDraftAdd}>
                Add to {productDraft.zone}
              </button>
            </div>
          ) : null}
          <div className="inventory-sections">
            {inventoryByZone.map(({ zone, items }) => (
              <details key={zone} className={`inventory-section inventory-section-${zone.toLowerCase()}`}>
                <summary className="inventory-section-summary">
                  <div className="zone-card-header">
                    <div>
                      <p className="eyebrow">{zone}</p>
                      <h3>{zone}</h3>
                    </div>
                    <div className="zone-card-actions">
                      <span>{items.length} items</span>
                      <button
                        type="button"
                        className="secondary summary-clear-button"
                        onClick={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          clearZone(zone)
                        }}
                      >
                        Clear {zone}
                      </button>
                    </div>
                  </div>
                </summary>
                <div className="inventory-table-wrap">
                  <div className="storage-tools">
                    <form
                      className="storage-manual-form"
                      onSubmit={(event) => {
                        event.preventDefault()
                        setManualItem((current) => ({ ...current, zone }))
                        if (!manualItem.name.trim()) {
                          return
                        }

                        addInventoryItem({
                          id: `manual-${Date.now()}`,
                          name: titleCase(manualItem.name.trim()),
                          brand: '',
                          categories: [],
                          quantity: parseNumberInput(manualQuantityInput, manualItem.quantity || 1),
                          remainingPercent: undefined,
                          unit: manualItem.unit.trim(),
                          zone,
                          expiresOn: manualItem.expiresOn,
                          source: 'manual',
                          dietaryTags: [],
                          allergens: [],
                          health: {},
                        })
                        setManualItem(emptyProductForm)
                        setManualQuantityInput('1')
                      }}
                    >
                      <input
                        value={manualItem.zone === zone ? manualItem.name : ''}
                        onChange={(event) =>
                          setManualItem((current) => ({
                            ...current,
                            zone,
                            name: event.target.value,
                          }))
                        }
                        placeholder={`Add to ${zone}`}
                      />
                      <input
                        type="number"
                        min="1"
                        step="0.1"
                        value={manualItem.zone === zone ? manualQuantityInput : '1'}
                        onChange={(event) => {
                          setManualQuantityInput(event.target.value)
                          if (event.target.value) {
                            setManualItem((current) => ({
                              ...current,
                              zone,
                              quantity: Number(event.target.value) || current.quantity,
                            }))
                          }
                        }}
                        placeholder="Amount"
                      />
                      <input
                        value={manualItem.zone === zone ? manualItem.unit : 'pack'}
                        onChange={(event) =>
                          setManualItem((current) => ({
                            ...current,
                            zone,
                            unit: event.target.value,
                          }))
                        }
                        placeholder="bag, g, potatoes"
                      />
                      <input
                        type="date"
                        value={manualItem.zone === zone ? manualItem.expiresOn : ''}
                        onChange={(event) =>
                          setManualItem((current) => ({
                            ...current,
                            zone,
                            expiresOn: event.target.value,
                          }))
                        }
                      />
                      <button type="submit">Add</button>
                    </form>

                    <div className="storage-scan-tools">
                      <input
                        value={barcode}
                        onChange={(event) => {
                          setBarcode(event.target.value)
                          setProductDraft((current) =>
                            current ? { ...current, zone } : current,
                          )
                        }}
                        placeholder={`Barcode for ${zone}`}
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          await lookupBarcode()
                          setProductDraft((current) => (current ? { ...current, zone } : current))
                        }}
                      >
                        Lookup
                      </button>
                      <button type="button" className="secondary" onClick={() => void startScanner(zone)}>
                        Scan
                      </button>
                    </div>
                    {productDraft && productDraft.zone === zone ? (
                      <div className="draft-card storage-draft-card">
                        <div>
                          <h3>{productDraft.name}</h3>
                          <p>
                            Barcode {productDraft.barcode} · {productDraft.health.calories ?? 'n/a'} kcal
                            per 100g
                            {productDraft.health.novaGroup
                              ? ` · NOVA ${productDraft.health.novaGroup}`
                              : ''}
                          </p>
                        </div>
                        {duplicateDraftItems.length ? (
                          <p className="status loading">
                            Already in {productDraft.zone}: {duplicateDraftItems
                              .map((item) => `${item.name} (${item.quantity} ${item.unit})`)
                              .join(', ')}
                          </p>
                        ) : null}
                        <div className="inline-fields">
                          <label>
                            How many in stock?
                            <input
                              type="number"
                              min="1"
                              step="0.1"
                              value={draftQuantityInput}
                              onChange={(event) => setDraftQuantityInput(event.target.value)}
                            />
                          </label>
                          <label>
                            % left
                            <input
                              type="number"
                              min="0"
                              max="100"
                              value={productDraft.remainingPercent ?? ''}
                              onChange={(event) =>
                                setProductDraft((current) =>
                                  current
                                    ? {
                                        ...current,
                                        remainingPercent: event.target.value
                                          ? Number(event.target.value)
                                          : undefined,
                                        zone,
                                      }
                                    : current,
                                )
                              }
                              placeholder="Optional"
                            />
                          </label>
                          <label>
                            Unit / measure
                            <input
                              value={productDraft.unit}
                              onChange={(event) =>
                                setProductDraft((current) =>
                                  current ? { ...current, unit: event.target.value, zone } : current,
                                )
                              }
                              placeholder="bag, g, potatoes"
                            />
                          </label>
                        </div>
                        <button type="button" onClick={handleDraftAdd}>
                          Add scanned item
                        </button>
                      </div>
                    ) : null}
                    <p className={`status ${lookupState}`}>{lookupMessage}</p>
                  </div>
                  <table className="inventory-table">
                    <thead>
                      <tr>
                        <th>
                          <button type="button" className="table-sort" onClick={() => toggleInventorySort('name')}>
                            Name
                          </button>
                        </th>
                        <th>
                          <button type="button" className="table-sort" onClick={() => toggleInventorySort('quantity')}>
                            Amount
                          </button>
                        </th>
                        <th>
                          <button type="button" className="table-sort" onClick={() => toggleInventorySort('expiresOn')}>
                            Use By / Best Before
                          </button>
                        </th>
                        <th>More</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => {
                        const isOpen = Boolean(openInventoryDetails[item.id])

                        return (
                          <Fragment key={item.id}>
                            <tr className={isOpen ? 'inventory-row inventory-row-open' : 'inventory-row'}>
                              <td data-label="Name">
                                <input
                                  value={item.name}
                                  onChange={(event) =>
                                    updateInventoryItem(item.id, (current) => ({
                                      ...current,
                                      name: event.target.value,
                                    }))
                                  }
                                />
                              </td>
                              <td data-label="Amount">
                                <div className="quantity-field">
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.1"
                                    value={getInventoryQuantityInput(item)}
                                    onChange={(event) => {
                                      const nextValue = event.target.value
                                      setInventoryQuantityInputs((current) => ({
                                        ...current,
                                        [item.id]: nextValue,
                                      }))

                                      const parsed = parseOptionalNumberInput(nextValue)
                                      if (parsed !== undefined) {
                                        updateInventoryItem(item.id, (current) => ({
                                          ...current,
                                          quantity: parsed,
                                        }))
                                      }
                                    }}
                                    onBlur={() =>
                                      setInventoryQuantityInputs((current) => {
                                        const next = { ...current }
                                        delete next[item.id]
                                        return next
                                      })
                                    }
                                  />
                                  <span>
                                    {item.unit}
                                    {item.remainingPercent !== undefined
                                      ? ` · ${item.remainingPercent}% left`
                                      : ''}
                                  </span>
                                </div>
                              </td>
                              <td data-label="Use By / Best Before">
                                <input
                                  type="date"
                                  value={item.expiresOn}
                                  onChange={(event) =>
                                    updateInventoryItem(item.id, (current) => ({
                                      ...current,
                                      expiresOn: event.target.value,
                                    }))
                                  }
                                />
                              </td>
                              <td data-label="Actions">
                                <div className="row-actions">
                                  <button
                                    type="button"
                                    className="secondary compact-button"
                                    onClick={() => toggleInventoryDetails(item.id)}
                                  >
                                    {isOpen ? 'Hide details' : 'Details'}
                                  </button>
                                  <button
                                    type="button"
                                    className="danger-icon-button"
                                    aria-label={`Delete ${item.name}`}
                                    title={`Delete ${item.name}`}
                                    onClick={() => removeInventoryItem(item.id)}
                                  >
                                    ×
                                  </button>
                                </div>
                              </td>
                            </tr>
                            {isOpen ? (
                              <tr className="inventory-detail-row">
                                <td colSpan={4}>
                                  <div className="inventory-detail-panel">
                                    <div className="inventory-detail-grid">
                                      <label>
                                        Brand
                                        <input
                                          value={item.brand ?? ''}
                                          onChange={(event) =>
                                            updateInventoryItem(item.id, (current) => ({
                                              ...current,
                                              brand: event.target.value,
                                            }))
                                          }
                                        />
                                      </label>
                                      <label>
                                        Unit / measure
                                        <input
                                          value={item.unit}
                                          onChange={(event) =>
                                            updateInventoryItem(item.id, (current) => ({
                                              ...current,
                                              unit: event.target.value,
                                            }))
                                          }
                                          placeholder="bag, g, potatoes"
                                        />
                                      </label>
                                      <label>
                                        % left
                                        <input
                                          type="number"
                                          min="0"
                                          max="100"
                                          value={item.remainingPercent ?? ''}
                                          onChange={(event) =>
                                            updateInventoryItem(item.id, (current) => ({
                                              ...current,
                                              remainingPercent: event.target.value
                                                ? Number(event.target.value)
                                                : undefined,
                                            }))
                                          }
                                        />
                                      </label>
                                      <label>
                                        Rebuy every days
                                        <input
                                          type="number"
                                          min="1"
                                          value={item.rebuyEveryDays ?? ''}
                                          onChange={(event) =>
                                            updateInventoryItem(item.id, (current) => ({
                                              ...current,
                                              rebuyEveryDays: event.target.value
                                                ? Number(event.target.value)
                                                : undefined,
                                            }))
                                          }
                                        />
                                      </label>
                                      <label>
                                        Categories
                                        <input
                                          value={item.categories.join(', ')}
                                          onChange={(event) =>
                                            updateInventoryItem(item.id, (current) => ({
                                              ...current,
                                              categories: event.target.value
                                                .split(',')
                                                .map((value) => value.trim())
                                                .filter(Boolean),
                                            }))
                                          }
                                        />
                                      </label>
                                      <label>
                                        Barcode
                                        <input
                                          value={item.barcode ?? ''}
                                          onChange={(event) =>
                                            updateInventoryItem(item.id, (current) => ({
                                              ...current,
                                              barcode: event.target.value,
                                            }))
                                          }
                                        />
                                      </label>
                                      <label>
                                        Calories
                                        <input
                                          type="number"
                                          value={item.health.calories ?? ''}
                                          onChange={(event) =>
                                            updateInventoryItem(item.id, (current) => ({
                                              ...current,
                                              health: {
                                                ...current.health,
                                                calories: event.target.value
                                                  ? Number(event.target.value)
                                                  : undefined,
                                              },
                                            }))
                                          }
                                        />
                                      </label>
                                      <label>
                                        Protein
                                        <input
                                          type="number"
                                          value={item.health.protein ?? ''}
                                          onChange={(event) =>
                                            updateInventoryItem(item.id, (current) => ({
                                              ...current,
                                              health: {
                                                ...current.health,
                                                protein: event.target.value
                                                  ? Number(event.target.value)
                                                  : undefined,
                                              },
                                            }))
                                          }
                                        />
                                      </label>
                                      <label>
                                        Sodium
                                        <input
                                          type="number"
                                          value={item.health.sodium ?? ''}
                                          onChange={(event) =>
                                            updateInventoryItem(item.id, (current) => ({
                                              ...current,
                                              health: {
                                                ...current.health,
                                                sodium: event.target.value
                                                  ? Number(event.target.value)
                                                  : undefined,
                                              },
                                            }))
                                          }
                                        />
                                      </label>
                                      <label>
                                        Ultra-processed NOVA
                                        <input
                                          type="number"
                                          min="1"
                                          max="4"
                                          value={item.health.novaGroup ?? ''}
                                          onChange={(event) =>
                                            updateInventoryItem(item.id, (current) => ({
                                              ...current,
                                              health: {
                                                ...current.health,
                                                novaGroup: event.target.value
                                                  ? Number(event.target.value)
                                                  : undefined,
                                              },
                                            }))
                                          }
                                        />
                                      </label>
                                      <label>
                                        Allergens
                                        <input
                                          value={item.allergens.join(', ')}
                                          onChange={(event) =>
                                            updateInventoryItem(item.id, (current) => ({
                                              ...current,
                                              allergens: event.target.value
                                                .split(',')
                                                .map((value) => value.trim())
                                                .filter(Boolean),
                                            }))
                                          }
                                        />
                                      </label>
                                      <label>
                                        Dietary tags
                                        <input
                                          value={item.dietaryTags.join(', ')}
                                          onChange={(event) =>
                                            updateInventoryItem(item.id, (current) => ({
                                              ...current,
                                              dietaryTags: event.target.value
                                                .split(',')
                                                .map((value) => value.trim())
                                                .filter(Boolean) as DietaryTag[],
                                            }))
                                          }
                                        />
                                      </label>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            ) : null}
                          </Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </details>
            ))}
          </div>
        </section>

        <section className="panel panel-wide">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Planner</p>
              <h2>Seven-day meal ideas</h2>
            </div>
            <div className="button-row">
              <input
                value={recipeSearch}
                onChange={(event) => setRecipeSearch(event.target.value)}
                placeholder="Search meals"
              />
              <button type="button" className="secondary" onClick={() => setIsRecipeModalOpen(true)}>
                Add your recipe
              </button>
            </div>
          </div>
          <div className="meal-rows">
            {filteredMealPlan.map((meal) => {
              const coveredOnShoppingList = getShoppingListCoverage(meal.missingIngredients)
              const stillNeeded = getOutstandingIngredients(meal.missingIngredients)
              const cookingForLabel = getCookingForLabel(meal.day)

              return (
                <article
                  key={meal.day}
                  className={[
                    'meal-row',
                    cookedMeals[meal.day] ? 'meal-row-cooked' : '',
                    openMealDay === meal.day ? 'meal-row-open' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <button
                    type="button"
                    className="meal-row-summary"
                    onClick={() =>
                      setOpenMealDay((current) => (current === meal.day ? null : meal.day))
                    }
                  >
                  <label className="checkbox-inline" onClick={(event) => event.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={Boolean(cookedMeals[meal.day])}
                      onChange={(event) => toggleCookedMeal(meal, event.target.checked)}
                    />
                    {cookedMeals[meal.day] ? 'Cooked' : 'Mark cooked'}
                  </label>
                  <div className="meal-row-main">
                    <strong>{meal.day}</strong>
                    <span>{meal.recipe.title}</span>
                  </div>
                  <div className="meal-row-meta">
                    {cookedMeals[meal.day] ? <span className="meal-state-badge">Cooked</span> : null}
                    <span>{meal.recipe.cookTime ? `${meal.recipe.cookTime} min` : 'Add more items'}</span>
                    <span>Cooking for {cookingForLabel}</span>
                    <span>{stillNeeded.length} to buy</span>
                  </div>
                  </button>
                  {openMealDay === meal.day ? (
                <div className="meal-row-details">
                  <p className="meal-description">{meal.recipe.description}</p>
                  <p className="planner-summary">{meal.wasteReason}</p>
                  <div className="inline-fields">
                    <label>
                      Cooking for
                      <select
                        value={String(getCookingForValue(meal.day))}
                        onChange={(event) =>
                          updateMealCookingFor(
                            meal.day,
                            event.target.value === 'all' ? 'all' : Number(event.target.value),
                          )
                        }
                      >
                        <option value="all">
                          {family.length ? `All (${family.length})` : 'All'}
                        </option>
                        {Array.from({ length: Math.max(family.length, 1) }, (_, index) => index + 1).map(
                          (count) => (
                            <option key={count} value={count}>
                              {count}
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                    {userRecipes.length ? (
                      <label>
                        Use my recipe
                        <select
                          value={mealRecipeOverrides[meal.day] ?? ''}
                          onChange={(event) => updateMealRecipeOverride(meal.day, event.target.value)}
                        >
                          <option value="">Planner choice</option>
                          {userRecipes.map((recipe) => (
                            <option key={recipe.id} value={recipe.id}>
                              {recipe.title}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                  </div>
                  <div className="button-row">
                    <button type="button" onClick={() => setSelectedMeal(meal)}>
                      View recipe
                    </button>
                    {meal.missingIngredients.length ? (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() =>
                          addItemsToShoppingList(
                            meal.missingIngredients,
                            `${meal.day}: ${meal.recipe.title}`,
                            meal.score > 6 ? 'High' : 'Medium',
                          )
                        }
                      >
                        Add all to shopping list
                      </button>
                    ) : null}
                    <button type="button" className="secondary" onClick={() => regenerateMeal(meal.day)}>
                      Regenerate
                    </button>
                    <button type="button" className="secondary" onClick={() => printMealRecipe(meal)}>
                      Print recipe
                    </button>
                    <button type="button" className="secondary" onClick={() => setOpenMealDay(null)}>
                      Close
                    </button>
                  </div>
                  <div className="tag-row">
                    {meal.recipe.dietaryTags.map((tag) => (
                      <span key={tag} className="badge">
                        {tag}
                      </span>
                    ))}
                  </div>
                  <dl className="nutrition-grid">
                    <div>
                      <dt>Calories</dt>
                      <dd>{meal.recipe.nutrition.calories}</dd>
                    </div>
                    <div>
                      <dt>Protein</dt>
                      <dd>{meal.recipe.nutrition.protein}g</dd>
                    </div>
                    <div>
                      <dt>Fibre</dt>
                      <dd>{meal.recipe.nutrition.fiber}g</dd>
                    </div>
                    <div>
                      <dt>Sodium</dt>
                      <dd>{meal.recipe.nutrition.sodium}mg</dd>
                    </div>
                  </dl>
                  <p className="section-label">Already in inventory</p>
                  <p>{meal.matchedIngredients.join(', ') || 'No exact matches yet'}</p>
                  <p className="section-label">Already on shopping list</p>
                  <p>{coveredOnShoppingList.join(', ') || 'Nothing added yet'}</p>
                  <p className="section-label">Still needed</p>
                  <p>{stillNeeded.join(', ') || 'Nothing else needed'}</p>
                  <p className="section-label">Health notes</p>
                  <p>{meal.recipe.healthHighlights.join(' · ')}</p>
                </div>
                  ) : null}
                </article>
              )
            })}
            {!filteredMealPlan.length ? (
              <div className="draft-card">
                <h3>No meals match that search</h3>
                <p>Try a recipe name, ingredient, or dietary tag.</p>
              </div>
            ) : null}
          </div>
        </section>
      </main>

      {isFamilyModalOpen ? (
        <div className="modal-backdrop" onClick={() => setIsFamilyModalOpen(false)}>
          <section className="modal-panel" onClick={(event) => event.stopPropagation()}>
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Family</p>
                <h2>Family members and food preferences</h2>
              </div>
              <button type="button" className="secondary" onClick={() => setIsFamilyModalOpen(false)}>
                Close
              </button>
            </div>
            <div className="stack">
              <div>
                <p className="section-label">Household-wide requirements</p>
                <div className="chip-grid">
                  {dietaryOptions
                    .filter((option) => !['Vegetarian', 'Vegan', 'Pescatarian'].includes(option))
                    .map((option) => (
                      <button
                        key={option}
                        type="button"
                        className={householdNeeds.includes(option) ? 'chip active' : 'chip'}
                        onClick={() =>
                          setHouseholdNeeds((current) => toggleSelection(current, option))
                        }
                      >
                        {option}
                      </button>
                    ))}
                </div>
              </div>
              <div className="member-editor-list">
                {family.map((member, index) => (
                  <article key={member.id} className="member-card">
                    <div className="member-card-header">
                      <div>
                        <p className="section-label">Member {index + 1}</p>
                        <input
                          value={member.name}
                          onChange={(event) =>
                            updateFamilyMember(member.id, (current) => ({
                              ...current,
                              name: event.target.value,
                            }))
                          }
                        />
                      </div>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => removeFamilyMember(member.id)}
                      >
                        Remove
                      </button>
                    </div>
                    <div className="member-section-grid">
                      <label>
                        Diet
                        <select
                          value={member.dietProfile}
                          onChange={(event) =>
                            updateFamilyMember(member.id, (current) => ({
                              ...current,
                              dietProfile: event.target.value as DietProfile,
                              eatsFish:
                                event.target.value === 'Vegetarian' ? current.eatsFish : false,
                            }))
                          }
                        >
                          {dietProfiles.map((profile) => (
                            <option key={profile} value={profile}>
                              {profile}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="checkbox-inline member-checkbox-row">
                        <input
                          type="checkbox"
                          checked={member.eatsFish}
                          onChange={(event) =>
                            updateFamilyMember(member.id, (current) => ({
                              ...current,
                              dietProfile: event.target.checked ? 'Vegetarian' : current.dietProfile,
                              eatsFish: event.target.checked,
                            }))
                          }
                        />
                        Eats fish
                      </label>
                    </div>
                    <div className="member-section-block">
                      <p className="section-label">Dietary needs</p>
                      <div className="chip-grid">
                        {dietaryOptions
                          .filter((option) => !['Vegetarian', 'Vegan', 'Pescatarian'].includes(option))
                          .map((option) => (
                            <button
                              key={option}
                              type="button"
                              className={member.dietaryNeeds.includes(option) ? 'chip active' : 'chip'}
                              onClick={() =>
                                updateFamilyMember(member.id, (current) => ({
                                  ...current,
                                  dietaryNeeds: toggleSelection(current.dietaryNeeds, option),
                                }))
                              }
                            >
                              {option}
                            </button>
                          ))}
                      </div>
                    </div>
                    <div className="member-section-block">
                      <label>
                        Avoid ingredients or allergens
                        <input
                          value={member.avoidIngredients}
                          onChange={(event) =>
                            updateFamilyMember(member.id, (current) => ({
                              ...current,
                              avoidIngredients: event.target.value,
                            }))
                          }
                          placeholder="sesame, shellfish"
                        />
                      </label>
                    </div>
                  </article>
                ))}
              </div>
              <form className="stack add-member-form" onSubmit={handleAddFamilyMember}>
                <p className="section-label">Add family member</p>
                <div className="inline-fields">
                  <label>
                    New member
                    <input
                      value={memberForm.name}
                      onChange={(event) =>
                        setMemberForm((current) => ({ ...current, name: event.target.value }))
                      }
                      placeholder="Enter name"
                    />
                  </label>
                  <label>
                    Diet
                    <select
                      value={memberForm.dietProfile}
                      onChange={(event) =>
                        setMemberForm((current) => ({
                          ...current,
                          dietProfile: event.target.value as DietProfile,
                          eatsFish:
                            event.target.value === 'Vegetarian' ? current.eatsFish : false,
                        }))
                      }
                    >
                      {dietProfiles.map((profile) => (
                        <option key={profile} value={profile}>
                          {profile}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="checkbox-inline">
                    <input
                      type="checkbox"
                      checked={memberForm.eatsFish}
                      onChange={(event) =>
                        setMemberForm((current) => ({
                          ...current,
                          dietProfile: event.target.checked ? 'Vegetarian' : current.dietProfile,
                          eatsFish: event.target.checked,
                        }))
                      }
                    />
                    Eats fish
                  </label>
                </div>
                <label>
                  Avoid ingredients or allergens
                  <input
                    value={memberForm.avoidIngredients}
                    onChange={(event) =>
                      setMemberForm((current) => ({
                        ...current,
                        avoidIngredients: event.target.value,
                      }))
                    }
                    placeholder="peanuts, sesame"
                  />
                </label>
                <button type="submit" disabled={!memberForm.name.trim()}>
                  Add family member
                </button>
              </form>
            </div>
          </section>
        </div>
      ) : null}

      {isSyncModalOpen ? (
        <div className="modal-backdrop" onClick={() => setIsSyncModalOpen(false)}>
          <section className="modal-panel" onClick={(event) => event.stopPropagation()}>
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Cloud Sync</p>
                <h2>Accounts, sync, and backup</h2>
              </div>
              <button type="button" className="secondary" onClick={() => setIsSyncModalOpen(false)}>
                Close
              </button>
            </div>
            <div className="auth-grid">
              <div className="stack">
                <p className={`status ${isSupabaseEnabled ? 'success' : 'loading'}`}>{authStatus}</p>
                {userId ? (
                  <div className="draft-card">
                    <h3>{userEmail ?? 'Signed-in user'}</h3>
                    <p>{isSavingRemote ? 'Syncing latest changes...' : 'Cloud sync is active.'}</p>
                    <button type="button" className="secondary" onClick={() => void handleSignOut()}>
                      Sign out
                    </button>
                  </div>
                ) : (
                  <form className="stack" onSubmit={handleAuthSubmit}>
                    <div className="tab-row">
                      <button
                        type="button"
                        className={authMode === 'signin' ? 'chip active' : 'chip'}
                        onClick={() => setAuthMode('signin')}
                      >
                        Sign in
                      </button>
                      <button
                        type="button"
                        className={authMode === 'signup' ? 'chip active' : 'chip'}
                        onClick={() => setAuthMode('signup')}
                      >
                        Create account
                      </button>
                    </div>
                    <label>
                      Email
                      <input
                        type="email"
                        value={authForm.email}
                        onChange={(event) =>
                          setAuthForm((current) => ({ ...current, email: event.target.value }))
                        }
                        placeholder="family@example.com"
                      />
                    </label>
                    <label>
                      Password
                      <input
                        type="password"
                        value={authForm.password}
                        onChange={(event) =>
                          setAuthForm((current) => ({ ...current, password: event.target.value }))
                        }
                        placeholder="Choose a strong password"
                      />
                    </label>
                    <button type="submit" disabled={!isSupabaseEnabled}>
                      {authMode === 'signin' ? 'Sign in and sync' : 'Create synced account'}
                    </button>
                  </form>
                )}
              </div>
              <div className="stack note-card">
                <p className="section-label">Sync status</p>
                <p>
                  {userId
                    ? 'You are signed in. Your planner changes will sync to your account automatically.'
                    : 'Sign in to sync and back up your planner data across devices.'}
                </p>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {isScannerOpen ? (
        <div className="modal-backdrop" onClick={stopScanner}>
          <section className="modal-panel scanner-modal" onClick={(event) => event.stopPropagation()}>
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Barcode Scanner</p>
                <h2>{scannerZone === 'main' ? 'Scan item' : `Scan for ${scannerZone}`}</h2>
              </div>
              <button type="button" className="secondary" onClick={stopScanner}>
                Close
              </button>
            </div>
            <div className="scanner scanner-modal-body">
              <video ref={videoRef} muted playsInline />
              <p>{scannerMessage}</p>
            </div>
          </section>
        </div>
      ) : null}

      {selectedMeal ? (
        <div className="modal-backdrop" onClick={() => setSelectedMeal(null)}>
          <section className="modal-panel recipe-modal" onClick={(event) => event.stopPropagation()}>
            <div className="panel-heading">
              <div>
                <p className="eyebrow">{selectedMeal.day}</p>
                <h2>{selectedMeal.recipe.title}</h2>
              </div>
              <div className="button-row">
                <button type="button" className="secondary" onClick={() => printMealRecipe(selectedMeal)}>
                  Print
                </button>
                <button type="button" className="secondary" onClick={() => regenerateMeal(selectedMeal.day)}>
                  Regenerate
                </button>
                <button type="button" className="secondary" onClick={() => setSelectedMeal(null)}>
                  Close
                </button>
              </div>
            </div>
            <div className="stack recipe-modal-body">
              <p>{selectedMeal.recipe.description}</p>
              <div className="tag-row">
                {selectedMeal.recipe.dietaryTags.map((tag) => (
                  <span key={tag} className="badge">
                    {tag}
                  </span>
                ))}
              </div>
              <p className="planner-summary">
                {selectedMeal.recipe.cookTime} min · Recipe serves {selectedMeal.recipe.servings} · Cooking for{' '}
                {getCookingForLabel(selectedMeal.day)}
              </p>
              <p className="planner-summary">{selectedMeal.wasteReason}</p>
              <div className="inline-fields">
                <label>
                  Cooking for
                  <select
                    value={String(getCookingForValue(selectedMeal.day))}
                    onChange={(event) =>
                      updateMealCookingFor(
                        selectedMeal.day,
                        event.target.value === 'all' ? 'all' : Number(event.target.value),
                      )
                    }
                  >
                    <option value="all">{family.length ? `All (${family.length})` : 'All'}</option>
                    {Array.from({ length: Math.max(family.length, 1) }, (_, index) => index + 1).map(
                      (count) => (
                        <option key={count} value={count}>
                          {count}
                        </option>
                      ),
                    )}
                  </select>
                </label>
              </div>
              <div className="recipe-columns">
                <div>
                  <p className="section-label">Ingredients</p>
                  <ul className="recipe-list">
                    {selectedMeal.recipe.ingredients.map((ingredient) => (
                      <li key={ingredient.name}>
                        {formatRecipeIngredient(
                          ingredient,
                          getCookingForCount(selectedMeal.day),
                          selectedMeal.recipe.servings,
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="section-label">Method</p>
                  <ol className="recipe-list">
                    {selectedMeal.recipe.steps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                </div>
              </div>
              <div className="recipe-columns">
                <div>
                  <p className="section-label">Nutrition</p>
                  <dl className="nutrition-grid">
                    <div>
                      <dt>Calories</dt>
                      <dd>{selectedMeal.recipe.nutrition.calories}</dd>
                    </div>
                    <div>
                      <dt>Protein</dt>
                      <dd>{selectedMeal.recipe.nutrition.protein}g</dd>
                    </div>
                    <div>
                      <dt>Fibre</dt>
                      <dd>{selectedMeal.recipe.nutrition.fiber}g</dd>
                    </div>
                    <div>
                      <dt>Sodium</dt>
                      <dd>{selectedMeal.recipe.nutrition.sodium}mg</dd>
                    </div>
                  </dl>
                </div>
                <div>
                  <p className="section-label">Matched from inventory</p>
                  <p>{selectedMeal.matchedIngredients.join(', ') || 'No exact matches yet'}</p>
                </div>
                <div>
                  <p className="section-label">Still needed</p>
                  {selectedMeal.missingIngredients.length ? (
                    <>
                      <div className="recipe-missing-actions">
                        <button
                          type="button"
                          className="secondary compact-button"
                          onClick={() =>
                            addItemsToShoppingList(
                              selectedMeal.missingIngredients,
                              `${selectedMeal.day}: ${selectedMeal.recipe.title}`,
                              selectedMeal.score > 6 ? 'High' : 'Medium',
                            )
                          }
                        >
                          Add all
                        </button>
                      </div>
                      <ul className="recipe-missing-list">
                        {selectedMeal.missingIngredients.map((ingredient) => (
                          <li key={ingredient}>
                            <span>{titleCase(ingredient)}</span>
                            <button
                              type="button"
                              className="secondary compact-button"
                              onClick={() =>
                                addItemsToShoppingList(
                                  [ingredient],
                                  `${selectedMeal.day}: ${selectedMeal.recipe.title}`,
                                  selectedMeal.score > 6 ? 'High' : 'Medium',
                                )
                              }
                            >
                              Add to shopping list
                            </button>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <p>Nothing else needed</p>
                  )}
                </div>
              </div>
              <div>
                <p className="section-label">Health notes</p>
                <p>{selectedMeal.recipe.healthHighlights.join(' · ')}</p>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {isRecipeModalOpen ? (
        <div className="modal-backdrop" onClick={() => setIsRecipeModalOpen(false)}>
          <section className="modal-panel recipe-editor-modal" onClick={(event) => event.stopPropagation()}>
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Custom Recipe</p>
                <h2>{editingRecipeId ? 'Edit your recipe' : 'Add your own meal'}</h2>
                <p className="planner-summary">
                  Required to save: title and at least one ingredient.
                </p>
              </div>
              <button type="button" className="secondary" onClick={() => setIsRecipeModalOpen(false)}>
                Close
              </button>
            </div>
            {userRecipes.length ? (
              <div className="stack saved-recipe-list">
                <p className="section-label">Your saved recipes</p>
                {userRecipes.map((recipe) => (
                  <article key={recipe.id} className="saved-recipe-card">
                    <div>
                      <h3>{recipe.title}</h3>
                      <p className="planner-summary">
                        {recipe.cookTime} min · serves {recipe.servings}
                      </p>
                    </div>
                    <div className="button-row">
                      <button type="button" className="secondary compact-button" onClick={() => startEditingRecipe(recipe)}>
                        Edit
                      </button>
                      <button type="button" className="secondary compact-button" onClick={() => deleteUserRecipe(recipe.id)}>
                        Delete
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : null}
            <form className="stack recipe-editor-form" onSubmit={handleAddRecipe}>
              <div className="recipe-columns">
                <label>
                  Title
                  <input
                    value={recipeForm.title}
                    onChange={(event) =>
                      setRecipeForm((current) => ({ ...current, title: event.target.value }))
                    }
                    placeholder="Roast potatoes and salmon"
                  />
                </label>
                <label>
                  Description
                  <input
                    value={recipeForm.description}
                    onChange={(event) =>
                      setRecipeForm((current) => ({ ...current, description: event.target.value }))
                    }
                    placeholder="Short meal description"
                  />
                </label>
              </div>
              <div className="recipe-columns">
                <label>
                  Recipe serves
                  <input
                    type="number"
                    min="1"
                    value={recipeForm.servings}
                    onChange={(event) =>
                      setRecipeForm((current) => ({
                        ...current,
                        servings: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  Cook time (min)
                  <input
                    type="number"
                    min="0"
                    value={recipeForm.cookTime}
                    onChange={(event) =>
                      setRecipeForm((current) => ({
                        ...current,
                        cookTime: event.target.value,
                      }))
                    }
                  />
                </label>
              </div>
              <div className="recipe-columns">
                <div className="member-section-block">
                  <p className="section-label">Ingredients</p>
                  <div className="recipe-ingredient-list">
                    {recipeForm.ingredients.map((ingredient, index) => (
                      <div key={`ingredient-${index}`} className="recipe-ingredient-row">
                        <input
                          value={ingredient.name}
                          onChange={(event) =>
                            updateRecipeIngredient(index, (current) => ({
                              ...current,
                              name: event.target.value,
                            }))
                          }
                          placeholder="Ingredient"
                        />
                        <input
                          type="number"
                          min="0"
                          step="0.1"
                          value={ingredient.amount}
                          onChange={(event) =>
                            updateRecipeIngredient(index, (current) => ({
                              ...current,
                              amount: event.target.value,
                            }))
                          }
                          placeholder="Amount"
                        />
                        <input
                          value={ingredient.unit}
                          onChange={(event) =>
                            updateRecipeIngredient(index, (current) => ({
                              ...current,
                              unit: event.target.value,
                            }))
                          }
                          placeholder="Unit / measure"
                        />
                        <button
                          type="button"
                          className="secondary compact-button"
                          onClick={() => removeRecipeIngredientRow(index)}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                  <button type="button" className="secondary compact-button" onClick={addRecipeIngredientRow}>
                    Add ingredient
                  </button>
                </div>
                <label>
                  Method steps
                  <textarea
                    rows={8}
                    value={recipeForm.steps}
                    onChange={(event) =>
                      setRecipeForm((current) => ({ ...current, steps: event.target.value }))
                    }
                    placeholder={`Boil the potatoes until tender.\nRoast the salmon until just cooked.\nServe together with broccoli.`}
                  />
                </label>
              </div>
              <div className="recipe-columns">
                <label>
                  Allergens
                  <input
                    value={recipeForm.allergens}
                    onChange={(event) =>
                      setRecipeForm((current) => ({ ...current, allergens: event.target.value }))
                    }
                    placeholder="milk, fish"
                  />
                </label>
                <label>
                  Health notes
                  <input
                    value={recipeForm.healthHighlights}
                    onChange={(event) =>
                      setRecipeForm((current) => ({
                        ...current,
                        healthHighlights: event.target.value,
                      }))
                    }
                    placeholder="High protein, freezer-friendly"
                  />
                </label>
              </div>
              <div className="member-section-block">
                <p className="section-label">Dietary tags</p>
                <div className="tag-row">
                  {dietaryOptions.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      className={recipeForm.dietaryTags.includes(tag) ? 'chip active' : 'chip'}
                      onClick={() =>
                        setRecipeForm((current) => ({
                          ...current,
                          dietaryTags: toggleSelection(current.dietaryTags, tag),
                        }))
                      }
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </div>
              <div className="member-section-block">
                <p className="section-label">Zone focus</p>
                <div className="tag-row">
                  {storageZones.map((zone) => (
                    <button
                      key={zone}
                      type="button"
                      className={recipeForm.zoneFocus.includes(zone) ? 'chip active' : 'chip'}
                      onClick={() =>
                        setRecipeForm((current) => ({
                          ...current,
                          zoneFocus: toggleSelection(current.zoneFocus, zone),
                        }))
                      }
                    >
                      {zone}
                    </button>
                  ))}
                </div>
              </div>
              <div className="button-row">
                <button
                  type="submit"
                  disabled={
                    !recipeForm.title.trim()
                    || !recipeForm.ingredients.some((ingredient) => ingredient.name.trim())
                  }
                >
                  {editingRecipeId ? 'Save changes' : 'Save recipe'}
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setEditingRecipeId(null)
                    setRecipeForm(emptyRecipeForm)
                  }}
                >
                  {editingRecipeId ? 'Cancel edit' : 'Reset'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {isShoppingListModalOpen ? (
        <div className="modal-backdrop" onClick={() => setIsShoppingListModalOpen(false)}>
          <section className="modal-panel shopping-list-modal" onClick={(event) => event.stopPropagation()}>
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Shopping</p>
                <h2>Shopping list</h2>
                <p className="planner-summary">
                  Add items from recipes when you decide what to buy.
                </p>
              </div>
              <div className="button-row">
                <button type="button" className="secondary" onClick={printShoppingList}>
                  Print
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setIsShoppingListModalOpen(false)}
                >
                  Close
                </button>
              </div>
            </div>
            {shoppingList.length ? (
              <div className="shopping-zone-list">
                {shoppingListByZone.map(({ zone, items }) => (
                  <section key={zone} className="shopping-zone-group">
                    <p className="section-label">{zone}</p>
                    <ul className="shopping-list shopping-list-detailed">
                      {items.map((item) => {
                        const checked = Boolean(shoppingChecked[item.name])

                        return (
                          <li
                            key={item.name}
                            className={checked ? 'shopping-item shopping-item-checked' : 'shopping-item'}
                          >
                            <label className="shopping-check-row">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleShoppingItem(item.name)}
                              />
                              <div className="shopping-item-copy">
                                <strong>{item.name}</strong>
                                <span>Needed for: {item.neededFor.join(', ')}</span>
                              </div>
                            </label>
                            <span
                              className={`badge shopping-priority shopping-priority-${item.priority.toLowerCase()}`}
                            >
                              {item.priority} priority
                            </span>
                          </li>
                        )
                      })}
                    </ul>
                  </section>
                ))}
              </div>
            ) : (
              <div className="draft-card">
                <h3>No shopping items yet</h3>
                <p>Add missing ingredients from recipe views to build your shopping list.</p>
              </div>
            )}
            {suggestedRebuys.length ? (
              <div className="shopping-zone-group shopping-suggestions">
                <p className="section-label">You may also need</p>
                <ul className="shopping-list shopping-list-detailed">
                  {suggestedRebuys.map((item) => (
                    <li key={`suggested-${item.name}`} className="shopping-item">
                      <div>
                        <strong>{item.name}</strong>
                        <p>
                          {item.dueLabel} · {item.zone} · every {item.rebuyEveryDays} day
                          {item.rebuyEveryDays === 1 ? '' : 's'}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="secondary compact-button"
                        onClick={() => addItemsToShoppingList([item.name], `Suggested rebuy: ${item.name}`)}
                      >
                        Add
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}

      <footer className="app-footer">
        <p>Version 0.1.0</p>
        <p>(C) Stephen Murdock 2026</p>
      </footer>
    </div>
  )
}

export default App
