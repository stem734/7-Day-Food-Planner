import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, PointerEvent as ReactPointerEvent } from 'react'
import './App.css'
import { dietaryOptions, emptyProductForm, storageZones } from './data'
import { buildMealPlan, buildShoppingList, getRequiredTags, titleCase } from './lib/planner'
import { loadInitialState, saveLocalState } from './lib/storage'
import {
  getCurrentUserId,
  isSupabaseEnabled,
  loadRemoteState,
  saveRemoteState,
  signInWithPassword,
  signOut,
  signUpWithPassword,
  supabase,
} from './lib/supabase'
import type { AppState, DietaryTag, DietProfile, InventoryItem } from './types'

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

function normalize(value: string) {
  return value.trim().toLowerCase()
}

function includesNormalized(haystack: string, needle: string) {
  return normalize(haystack).includes(normalize(needle))
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

  return {
    id: `barcode-${Date.now()}`,
    name: String(product.product_name || product.product_name_en || 'Scanned product'),
    brand: String(product.brands || ''),
    categories,
    quantity: 1,
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
    },
  }
}

function App() {
  const initialState = useMemo(() => loadInitialState(), [])
  const [inventory, setInventory] = useState<AppState['inventory']>(initialState.inventory)
  const [family, setFamily] = useState<AppState['family']>(initialState.family)
  const [householdNeeds, setHouseholdNeeds] = useState<AppState['householdNeeds']>(
    initialState.householdNeeds,
  )
  const [cookedMeals, setCookedMeals] = useState<AppState['cookedMeals']>(initialState.cookedMeals)
  const [manualItem, setManualItem] = useState(emptyProductForm)
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
  const [isScannerOpen, setIsScannerOpen] = useState(false)
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
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const appShellRef = useRef<HTMLDivElement | null>(null)

  const appState = useMemo(
    () => ({ inventory, family, householdNeeds, cookedMeals }),
    [cookedMeals, family, householdNeeds, inventory],
  )
  const mealPlan = useMemo(
    () => buildMealPlan(inventory, family, householdNeeds),
    [family, householdNeeds, inventory],
  )
  const shoppingList = useMemo(() => buildShoppingList(mealPlan), [mealPlan])
  const requiredTags = useMemo(() => getRequiredTags(appState), [appState])
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

    return storageZones.map((zone) => ({
      zone,
      items: sortedItems.filter((item) => item.zone === zone),
    }))
  }, [inventory, inventorySort])

  useEffect(() => {
    saveLocalState(appState)
  }, [appState])

  useEffect(() => {
    return () => {
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [])

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
          setHouseholdNeeds(remoteState.householdNeeds)
          setCookedMeals(remoteState.cookedMeals)
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

  async function lookupBarcodeValue(value: string) {
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

    return buildScannedItem(value, data.product)
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
      const draft = await lookupBarcodeValue(barcode)
      setProductDraft(draft)
      setLookupState('success')
      setLookupMessage(
        `Found ${draft.name}. Suggested storage: ${draft.zone}. Confirm quantity, then add it.`,
      )
    } catch {
      setLookupState('error')
      setLookupMessage('No matching product was found from Open Food Facts for that barcode.')
    }
  }

  async function startScanner() {
    if (!window.BarcodeDetector) {
      setScannerMessage('BarcodeDetector is not available in this browser. Use manual barcode entry instead.')
      setIsScannerOpen(true)
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
      })

      mediaStreamRef.current = stream
      setIsScannerOpen(true)
      setScannerMessage('Point the camera at a barcode.')

      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }

      const detector = new window.BarcodeDetector({
        formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'],
      })

      const intervalId = window.setInterval(async () => {
        if (!videoRef.current) {
          return
        }

        try {
          const results = await detector.detect(videoRef.current)
          const code = results[0]?.rawValue

          if (code) {
            window.clearInterval(intervalId)
            setBarcode(code)
            setScannerMessage(`Detected barcode ${code}.`)
            stopScanner()
            setLookupState('loading')
            setLookupMessage('Looking up detected barcode...')

            try {
              const draft = await lookupBarcodeValue(code)
              setProductDraft(draft)
              setLookupState('success')
              setLookupMessage('Barcode detected and product details loaded.')
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
      setIsScannerOpen(true)
    }
  }

  function stopScanner() {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
    mediaStreamRef.current = null
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    setIsScannerOpen(false)
  }

  function addInventoryItem(item: InventoryItem) {
    setInventory((current) => [item, ...current])
  }

  function updateInventoryItem(
    itemId: string,
    updater: (item: InventoryItem) => InventoryItem,
  ) {
    setInventory((current) => current.map((item) => (item.id === itemId ? updater(item) : item)))
  }

  function toggleInventorySort(key: typeof inventorySort.key) {
    setInventorySort((current) => ({
      key,
      direction:
        current.key === key ? (current.direction === 'asc' ? 'desc' : 'asc') : 'asc',
    }))
  }

  function handleDraftAdd() {
    if (!productDraft) {
      return
    }

    addInventoryItem(productDraft)
    setProductDraft(null)
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

  function toggleSelection<T extends string>(current: T[], value: T) {
    return current.includes(value)
      ? current.filter((item) => item !== value)
      : [...current, value]
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

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const element = appShellRef.current
    if (!element) {
      return
    }

    const bounds = element.getBoundingClientRect()
    element.style.setProperty('--spotlight-x', `${event.clientX - bounds.left}px`)
    element.style.setProperty('--spotlight-y', `${event.clientY - bounds.top}px`)
  }

  return (
    <div ref={appShellRef} className="app-shell" onPointerMove={handlePointerMove}>
      <div className="ambient ambient-aurora ambient-aurora-1" aria-hidden="true" />
      <div className="ambient ambient-aurora ambient-aurora-2" aria-hidden="true" />
      <div className="ambient ambient-aurora ambient-aurora-3" aria-hidden="true" />
      <div className="spotlight" aria-hidden="true" />
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
          </article>
          <article>
            <span>{shoppingList.length}</span>
            <p>Shopping items</p>
          </article>
          <article>
            <span>{mealPlan.filter((meal) => cookedMeals[meal.day]).length}</span>
            <p>Cooked meals</p>
          </article>
        </div>
      </header>

      <main className="dashboard">
        <section className="panel panel-wide">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Inventory</p>
              <h2>Kitchen stock tables</h2>
            </div>
            <div className="inventory-panel-actions">
              <input
                value={barcode}
                onChange={(event) => setBarcode(event.target.value)}
                placeholder="Quick scan barcode"
              />
              <button type="button" onClick={() => void lookupBarcode()}>
                Lookup item
              </button>
              <button type="button" className="secondary" onClick={() => void startScanner()}>
                Scan item
              </button>
            </div>
          </div>
          <p className={`status ${lookupState}`}>{lookupMessage}</p>
          {isScannerOpen ? (
            <div className="scanner scanner-inline">
              <video ref={videoRef} muted playsInline />
              <p>{scannerMessage}</p>
              <button type="button" className="secondary" onClick={stopScanner}>
                Close camera
              </button>
            </div>
          ) : null}
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
              </p>
              <div className="inline-fields">
                <label>
                  How many in stock?
                  <input
                    type="number"
                    min="1"
                    value={productDraft.quantity}
                    onChange={(event) =>
                      setProductDraft((current) =>
                        current ? { ...current, quantity: Number(event.target.value) } : current,
                      )
                    }
                  />
                </label>
                <label>
                  Unit
                  <input
                    value={productDraft.unit}
                    onChange={(event) =>
                      setProductDraft((current) =>
                        current ? { ...current, unit: event.target.value } : current,
                      )
                    }
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
              <details key={zone} className="inventory-section">
                <summary className="inventory-section-summary">
                  <div className="zone-card-header">
                    <h3>{zone}</h3>
                    <span>{items.length} items</span>
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
                          quantity: manualItem.quantity,
                          unit: manualItem.unit.trim(),
                          zone,
                          expiresOn: manualItem.expiresOn,
                          source: 'manual',
                          dietaryTags: [],
                          allergens: [],
                          health: {},
                        })
                        setManualItem(emptyProductForm)
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
                        value={manualItem.zone === zone ? manualItem.quantity : 1}
                        onChange={(event) =>
                          setManualItem((current) => ({
                            ...current,
                            zone,
                            quantity: Number(event.target.value),
                          }))
                        }
                        placeholder="Qty"
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
                        placeholder="Unit"
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
                      <button type="button" className="secondary" onClick={() => void startScanner()}>
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
                          </p>
                        </div>
                        <div className="inline-fields">
                          <label>
                            How many in stock?
                            <input
                              type="number"
                              min="1"
                              value={productDraft.quantity}
                              onChange={(event) =>
                                setProductDraft((current) =>
                                  current
                                    ? { ...current, quantity: Number(event.target.value), zone }
                                    : current,
                                )
                              }
                            />
                          </label>
                          <label>
                            Unit
                            <input
                              value={productDraft.unit}
                              onChange={(event) =>
                                setProductDraft((current) =>
                                  current ? { ...current, unit: event.target.value, zone } : current,
                                )
                              }
                            />
                          </label>
                        </div>
                        <button type="button" onClick={handleDraftAdd}>
                          Add scanned item
                        </button>
                      </div>
                    ) : null}
                    {isScannerOpen && productDraft?.zone === zone ? (
                      <div className="scanner">
                        <video ref={videoRef} muted playsInline />
                        <p>{scannerMessage}</p>
                        <button type="button" className="secondary" onClick={stopScanner}>
                          Close camera
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
                          <button type="button" className="table-sort" onClick={() => toggleInventorySort('brand')}>
                            Brand
                          </button>
                        </th>
                        <th>Categories</th>
                        <th>
                          <button type="button" className="table-sort" onClick={() => toggleInventorySort('quantity')}>
                            Quantity
                          </button>
                        </th>
                        <th>Unit</th>
                        <th>
                          <button type="button" className="table-sort" onClick={() => toggleInventorySort('expiresOn')}>
                            Use By
                          </button>
                        </th>
                        <th>Barcode</th>
                        <th>
                          <button type="button" className="table-sort" onClick={() => toggleInventorySort('calories')}>
                            kcal
                          </button>
                        </th>
                        <th>
                          <button type="button" className="table-sort" onClick={() => toggleInventorySort('protein')}>
                            Protein
                          </button>
                        </th>
                        <th>
                          <button type="button" className="table-sort" onClick={() => toggleInventorySort('sodium')}>
                            Sodium
                          </button>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => (
                        <tr key={item.id}>
                          <td>
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
                          <td>
                            <input
                              value={item.brand ?? ''}
                              onChange={(event) =>
                                updateInventoryItem(item.id, (current) => ({
                                  ...current,
                                  brand: event.target.value,
                                }))
                              }
                            />
                          </td>
                          <td>
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
                          </td>
                          <td>
                            <input
                              type="number"
                              min="0"
                              value={item.quantity}
                              onChange={(event) =>
                                updateInventoryItem(item.id, (current) => ({
                                  ...current,
                                  quantity: Number(event.target.value),
                                }))
                              }
                            />
                          </td>
                          <td>
                            <input
                              value={item.unit}
                              onChange={(event) =>
                                updateInventoryItem(item.id, (current) => ({
                                  ...current,
                                  unit: event.target.value,
                                }))
                              }
                            />
                          </td>
                          <td>
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
                          <td>
                            <input
                              value={item.barcode ?? ''}
                              onChange={(event) =>
                                updateInventoryItem(item.id, (current) => ({
                                  ...current,
                                  barcode: event.target.value,
                                }))
                              }
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              value={item.health.calories ?? ''}
                              onChange={(event) =>
                                updateInventoryItem(item.id, (current) => ({
                                  ...current,
                                  health: {
                                    ...current.health,
                                    calories: event.target.value ? Number(event.target.value) : undefined,
                                  },
                                }))
                              }
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              value={item.health.protein ?? ''}
                              onChange={(event) =>
                                updateInventoryItem(item.id, (current) => ({
                                  ...current,
                                  health: {
                                    ...current.health,
                                    protein: event.target.value ? Number(event.target.value) : undefined,
                                  },
                                }))
                              }
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              value={item.health.sodium ?? ''}
                              onChange={(event) =>
                                updateInventoryItem(item.id, (current) => ({
                                  ...current,
                                  health: {
                                    ...current.health,
                                    sodium: event.target.value ? Number(event.target.value) : undefined,
                                  },
                                }))
                              }
                            />
                          </td>
                        </tr>
                      ))}
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
            <div className="planner-summary">
              <span>Required tags: {requiredTags.join(', ') || 'None'}</span>
            </div>
          </div>
          <div className="meal-rows">
            {mealPlan.map((meal) => (
              <details key={meal.day} className="meal-row">
                <summary className="meal-row-summary">
                  <label className="checkbox-inline" onClick={(event) => event.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={Boolean(cookedMeals[meal.day])}
                      onChange={(event) =>
                        setCookedMeals((current) => ({
                          ...current,
                          [meal.day]: event.target.checked,
                        }))
                      }
                    />
                    Cooked
                  </label>
                  <div className="meal-row-main">
                    <strong>{meal.day}</strong>
                    <span>{meal.recipe.title}</span>
                  </div>
                  <div className="meal-row-meta">
                    <span>{meal.recipe.cookTime ? `${meal.recipe.cookTime} min` : 'Add more items'}</span>
                    <span>{meal.missingIngredients.length} to buy</span>
                  </div>
                </summary>
                <div className="meal-row-details">
                  <p className="meal-description">{meal.recipe.description}</p>
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
                  <p className="section-label">Matched from inventory</p>
                  <p>{meal.matchedIngredients.join(', ') || 'No exact matches yet'}</p>
                  <p className="section-label">Still needed</p>
                  <p>{meal.missingIngredients.join(', ') || 'Nothing else needed'}</p>
                  <p className="section-label">Health notes</p>
                  <p>{meal.recipe.healthHighlights.join(' · ')}</p>
                </div>
              </details>
            ))}
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
                {family.map((member) => (
                  <article key={member.id} className="member-card">
                    <div className="member-top-row">
                      <input
                        value={member.name}
                        onChange={(event) =>
                          updateFamilyMember(member.id, (current) => ({
                            ...current,
                            name: event.target.value,
                          }))
                        }
                      />
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
                      <label className="checkbox-inline">
                        <input
                          type="checkbox"
                          checked={member.eatsFish}
                          disabled={member.dietProfile !== 'Vegetarian'}
                          onChange={(event) =>
                            updateFamilyMember(member.id, (current) => ({
                              ...current,
                              eatsFish: event.target.checked,
                            }))
                          }
                        />
                        Eats fish
                      </label>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => removeFamilyMember(member.id)}
                      >
                        Remove
                      </button>
                    </div>
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
                  </article>
                ))}
              </div>
              <form className="stack add-member-form" onSubmit={handleAddFamilyMember}>
                <div className="inline-fields">
                  <label>
                    New member
                    <input
                      value={memberForm.name}
                      onChange={(event) =>
                        setMemberForm((current) => ({ ...current, name: event.target.value }))
                      }
                      placeholder="Member 4"
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
                      disabled={memberForm.dietProfile !== 'Vegetarian'}
                      onChange={(event) =>
                        setMemberForm((current) => ({ ...current, eatsFish: event.target.checked }))
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
                <button type="submit">Add family member</button>
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
                <p className="section-label">Steps</p>
                <ol className="steps-list">
                  <li>Create a Supabase project.</li>
                  <li>Copy `.env.example` to `.env` and add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.</li>
                  <li>Run `supabase-schema.sql` in the Supabase SQL editor.</li>
                  <li>Restart the app, create an account, and sign in.</li>
                  <li>Your planner data then syncs automatically after changes.</li>
                </ol>
                <p className="section-label">Backup</p>
                <p>
                  Without Supabase, data lives only in this browser. With Supabase enabled, your
                  inventory, family members, and cooked meal status are backed up to the cloud for
                  that signed-in account.
                </p>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  )
}

export default App
