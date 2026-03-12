import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'

type StorageZone = 'Cupboard' | 'Fridge' | 'Freezer'

type DietaryTag =
  | 'Vegetarian'
  | 'Vegan'
  | 'Gluten-Free'
  | 'Dairy-Free'
  | 'Nut-Free'
  | 'High-Protein'
  | 'Low-Sodium'

type InventoryItem = {
  id: string
  name: string
  quantity: number
  unit: string
  zone: StorageZone
  expiresOn: string
  barcode?: string
  source: 'manual' | 'barcode'
  dietaryTags: DietaryTag[]
  allergens: string[]
  health: {
    calories?: number
    protein?: number
    fiber?: number
    fat?: number
    sugar?: number
    sodium?: number
  }
}

type FamilyMember = {
  id: string
  name: string
  dietaryNeeds: DietaryTag[]
  avoidIngredients: string
}

type Recipe = {
  id: string
  title: string
  description: string
  ingredients: string[]
  dietaryTags: DietaryTag[]
  allergens: string[]
  cookTime: number
  zoneFocus: StorageZone[]
  nutrition: {
    calories: number
    protein: number
    fiber: number
    carbs: number
    fat: number
    sodium: number
  }
  healthHighlights: string[]
}

type PlannedMeal = {
  day: string
  recipe: Recipe
  matchedIngredients: string[]
  missingIngredients: string[]
  score: number
}

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

const STORAGE_KEY = 'seven-day-food-planner'

const dietaryOptions: DietaryTag[] = [
  'Vegetarian',
  'Vegan',
  'Gluten-Free',
  'Dairy-Free',
  'Nut-Free',
  'High-Protein',
  'Low-Sodium',
]

const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

const starterInventory: InventoryItem[] = [
  {
    id: 'i-1',
    name: 'Chickpeas',
    quantity: 2,
    unit: 'tins',
    zone: 'Cupboard',
    expiresOn: '',
    source: 'manual',
    dietaryTags: ['Vegetarian', 'Vegan', 'Gluten-Free', 'Dairy-Free'],
    allergens: [],
    health: { calories: 164, protein: 8.9, fiber: 7.6, fat: 2.6, sugar: 4.8, sodium: 24 },
  },
  {
    id: 'i-2',
    name: 'Frozen mixed vegetables',
    quantity: 1,
    unit: 'bag',
    zone: 'Freezer',
    expiresOn: '',
    source: 'manual',
    dietaryTags: ['Vegetarian', 'Vegan', 'Gluten-Free', 'Dairy-Free'],
    allergens: [],
    health: { calories: 70, protein: 3.8, fiber: 4.6, fat: 0.7, sugar: 5.1, sodium: 40 },
  },
  {
    id: 'i-3',
    name: 'Greek yogurt',
    quantity: 500,
    unit: 'g',
    zone: 'Fridge',
    expiresOn: '',
    source: 'manual',
    dietaryTags: ['Vegetarian', 'High-Protein'],
    allergens: ['milk'],
    health: { calories: 97, protein: 9, fiber: 0, fat: 5, sugar: 3.6, sodium: 36 },
  },
]

const starterFamily: FamilyMember[] = [
  {
    id: 'f-1',
    name: 'Alex',
    dietaryNeeds: ['Nut-Free'],
    avoidIngredients: 'walnuts, peanuts',
  },
  {
    id: 'f-2',
    name: 'Sam',
    dietaryNeeds: ['High-Protein'],
    avoidIngredients: '',
  },
]

const recipeLibrary: Recipe[] = [
  {
    id: 'r-1',
    title: 'Smoky Chickpea Traybake',
    description: 'Roasted chickpeas and vegetables with paprika, lemon, and herbs.',
    ingredients: ['chickpeas', 'mixed vegetables', 'olive oil', 'paprika', 'lemon'],
    dietaryTags: ['Vegetarian', 'Vegan', 'Gluten-Free', 'Dairy-Free', 'Nut-Free'],
    allergens: [],
    cookTime: 30,
    zoneFocus: ['Cupboard', 'Freezer'],
    nutrition: { calories: 430, protein: 18, fiber: 13, carbs: 48, fat: 14, sodium: 320 },
    healthHighlights: ['High fibre', 'Plant-based protein', 'Good freezer use'],
  },
  {
    id: 'r-2',
    title: 'Herby Yogurt Chicken Bowls',
    description: 'Chicken bowls with yogurt dressing, grains, and crunchy veg.',
    ingredients: ['chicken breast', 'greek yogurt', 'rice', 'cucumber', 'spinach'],
    dietaryTags: ['Gluten-Free', 'High-Protein', 'Nut-Free'],
    allergens: ['milk'],
    cookTime: 35,
    zoneFocus: ['Fridge', 'Cupboard'],
    nutrition: { calories: 520, protein: 39, fiber: 6, carbs: 42, fat: 18, sodium: 410 },
    healthHighlights: ['High protein', 'Balanced carbs', 'Great for packed lunches'],
  },
  {
    id: 'r-3',
    title: 'Freezer Veg Stir-Fry',
    description: 'A quick stir-fry built around freezer vegetables and pantry sauces.',
    ingredients: ['mixed vegetables', 'soy sauce', 'rice noodles', 'garlic', 'tofu'],
    dietaryTags: ['Vegetarian', 'Vegan', 'Dairy-Free'],
    allergens: ['soy'],
    cookTime: 20,
    zoneFocus: ['Freezer', 'Cupboard'],
    nutrition: { calories: 455, protein: 21, fiber: 8, carbs: 56, fat: 14, sodium: 620 },
    healthHighlights: ['Fast weeknight meal', 'Uses freezer staples', 'Good vegetable density'],
  },
  {
    id: 'r-4',
    title: 'Lentil Cottage Pie',
    description: 'Comforting lentil pie with mashed potato topping and hidden vegetables.',
    ingredients: ['lentils', 'potatoes', 'carrots', 'peas', 'vegetable stock'],
    dietaryTags: ['Vegetarian', 'Vegan', 'Dairy-Free', 'Nut-Free'],
    allergens: ['celery'],
    cookTime: 55,
    zoneFocus: ['Cupboard', 'Freezer', 'Fridge'],
    nutrition: { calories: 470, protein: 19, fiber: 15, carbs: 63, fat: 12, sodium: 360 },
    healthHighlights: ['High fibre', 'Family-friendly', 'Good batch cook'],
  },
  {
    id: 'r-5',
    title: 'Salmon, Greens and New Potatoes',
    description: 'A lighter dinner with omega-3 rich salmon and green vegetables.',
    ingredients: ['salmon', 'potatoes', 'broccoli', 'peas', 'lemon'],
    dietaryTags: ['Gluten-Free', 'High-Protein', 'Nut-Free'],
    allergens: ['fish'],
    cookTime: 28,
    zoneFocus: ['Fridge', 'Freezer'],
    nutrition: { calories: 510, protein: 37, fiber: 9, carbs: 35, fat: 24, sodium: 280 },
    healthHighlights: ['Omega-3 fats', 'High protein', 'Lower sodium'],
  },
  {
    id: 'r-6',
    title: 'Black Bean Chili',
    description: 'Hearty bean chili with tomatoes, peppers, and warming spices.',
    ingredients: ['black beans', 'tomatoes', 'peppers', 'onion', 'cumin'],
    dietaryTags: ['Vegetarian', 'Vegan', 'Gluten-Free', 'Dairy-Free', 'Nut-Free'],
    allergens: [],
    cookTime: 40,
    zoneFocus: ['Cupboard', 'Fridge'],
    nutrition: { calories: 445, protein: 17, fiber: 16, carbs: 58, fat: 11, sodium: 300 },
    healthHighlights: ['High fibre', 'Budget-friendly', 'Great for leftovers'],
  },
  {
    id: 'r-7',
    title: 'Turkey Meatball Orzo Bake',
    description: 'Protein-forward baked orzo with meatballs, tomato, and spinach.',
    ingredients: ['turkey mince', 'orzo', 'tomatoes', 'spinach', 'mozzarella'],
    dietaryTags: ['High-Protein', 'Nut-Free'],
    allergens: ['milk', 'gluten'],
    cookTime: 45,
    zoneFocus: ['Fridge', 'Cupboard'],
    nutrition: { calories: 560, protein: 34, fiber: 5, carbs: 49, fat: 24, sodium: 540 },
    healthHighlights: ['High protein', 'Oven-to-table', 'Crowd-pleasing'],
  },
  {
    id: 'r-8',
    title: 'Coconut Red Lentil Curry',
    description: 'Creamy lentil curry with spinach and fragrant spices.',
    ingredients: ['red lentils', 'coconut milk', 'spinach', 'onion', 'curry paste'],
    dietaryTags: ['Vegetarian', 'Vegan', 'Gluten-Free', 'Dairy-Free', 'Nut-Free'],
    allergens: [],
    cookTime: 32,
    zoneFocus: ['Cupboard', 'Fridge'],
    nutrition: { calories: 485, protein: 20, fiber: 12, carbs: 51, fat: 19, sodium: 340 },
    healthHighlights: ['Iron-rich greens', 'High fibre', 'Plant-based dinner'],
  },
  {
    id: 'r-9',
    title: 'Sheet-Pan Sausage and Vegetables',
    description: 'Roasted sausages with colourful vegetables for a simple dinner.',
    ingredients: ['sausages', 'potatoes', 'peppers', 'broccoli', 'red onion'],
    dietaryTags: ['Nut-Free'],
    allergens: [],
    cookTime: 38,
    zoneFocus: ['Fridge', 'Freezer'],
    nutrition: { calories: 590, protein: 24, fiber: 8, carbs: 39, fat: 36, sodium: 760 },
    healthHighlights: ['Simple prep', 'Balanced plate', 'Flexible vegetables'],
  },
  {
    id: 'r-10',
    title: 'Yogurt Berry Breakfast Pots',
    description: 'Make-ahead breakfast pots with yogurt, oats, berries, and seeds.',
    ingredients: ['greek yogurt', 'berries', 'oats', 'chia seeds', 'honey'],
    dietaryTags: ['Vegetarian', 'High-Protein', 'Nut-Free'],
    allergens: ['milk', 'gluten'],
    cookTime: 10,
    zoneFocus: ['Fridge', 'Cupboard', 'Freezer'],
    nutrition: { calories: 320, protein: 18, fiber: 7, carbs: 36, fat: 10, sodium: 90 },
    healthHighlights: ['Breakfast prep', 'Protein rich', 'Supports satiety'],
  },
]

const emptyProductForm = {
  name: '',
  quantity: 1,
  unit: 'pack',
  zone: 'Cupboard' as StorageZone,
  expiresOn: '',
}

function normalize(value: string) {
  return value.trim().toLowerCase()
}

function titleCase(value: string) {
  return value
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function includesNormalized(haystack: string, needle: string) {
  return normalize(haystack).includes(normalize(needle))
}

function loadInitialState() {
  const fallback = {
    inventory: starterInventory,
    family: starterFamily,
    householdNeeds: ['Nut-Free'] as DietaryTag[],
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return fallback
    }

    const parsed = JSON.parse(raw) as typeof fallback
    return {
      inventory: parsed.inventory?.length ? parsed.inventory : fallback.inventory,
      family: parsed.family?.length ? parsed.family : fallback.family,
      householdNeeds: parsed.householdNeeds?.length
        ? parsed.householdNeeds
        : fallback.householdNeeds,
    }
  } catch {
    return fallback
  }
}

function getFamilyAvoidances(family: FamilyMember[]) {
  return family
    .flatMap((member) => member.avoidIngredients.split(','))
    .map((item) => normalize(item))
    .filter(Boolean)
}

function recipeMatchesRequirements(
  recipe: Recipe,
  requiredTags: DietaryTag[],
  avoidances: string[],
) {
  const meetsTags = requiredTags.every((tag) => recipe.dietaryTags.includes(tag))
  const conflictsWithAvoidances = avoidances.some(
    (avoidance) =>
      recipe.ingredients.some((ingredient) => includesNormalized(ingredient, avoidance)) ||
      recipe.allergens.some((allergen) => includesNormalized(allergen, avoidance)),
  )

  return meetsTags && !conflictsWithAvoidances
}

function buildMealPlan(
  inventory: InventoryItem[],
  family: FamilyMember[],
  householdNeeds: DietaryTag[],
) {
  const requiredTags = Array.from(
    new Set([...householdNeeds, ...family.flatMap((member) => member.dietaryNeeds)]),
  )
  const avoidances = getFamilyAvoidances(family)
  const inventoryNames = inventory.map((item) => normalize(item.name))

  const eligibleRecipes = recipeLibrary
    .filter((recipe) => recipeMatchesRequirements(recipe, requiredTags, avoidances))
    .map((recipe) => {
      const matchedIngredients = recipe.ingredients.filter((ingredient) =>
        inventoryNames.some((itemName) => includesNormalized(itemName, ingredient)),
      )
      const missingIngredients = recipe.ingredients.filter(
        (ingredient) =>
          !inventoryNames.some((itemName) => includesNormalized(itemName, ingredient)),
      )

      const coverage = matchedIngredients.length / recipe.ingredients.length
      const healthScore =
        recipe.nutrition.protein / 10 +
        recipe.nutrition.fiber / 4 -
        recipe.nutrition.sodium / 400

      return {
        recipe,
        matchedIngredients,
        missingIngredients,
        score: coverage * 10 + healthScore,
      }
    })
    .sort((left, right) => right.score - left.score)

  const selected = eligibleRecipes.slice(0, 7)

  return days.map((day, index) => {
    const choice = selected[index] ?? eligibleRecipes[index % Math.max(eligibleRecipes.length, 1)]

    if (!choice) {
      return {
        day,
        recipe: {
          id: `empty-${day}`,
          title: 'No matching recipe yet',
          description: 'Add a few more staples or relax one dietary rule to complete the week.',
          ingredients: [],
          dietaryTags: [],
          allergens: [],
          cookTime: 0,
          zoneFocus: [],
          nutrition: { calories: 0, protein: 0, fiber: 0, carbs: 0, fat: 0, sodium: 0 },
          healthHighlights: ['Needs more matching recipes'],
        },
        matchedIngredients: [],
        missingIngredients: [],
        score: 0,
      }
    }

    return { day, ...choice }
  })
}

function App() {
  const initialState = useMemo(() => loadInitialState(), [])
  const [inventory, setInventory] = useState<InventoryItem[]>(initialState.inventory)
  const [family, setFamily] = useState<FamilyMember[]>(initialState.family)
  const [householdNeeds, setHouseholdNeeds] = useState<DietaryTag[]>(initialState.householdNeeds)
  const [manualItem, setManualItem] = useState(emptyProductForm)
  const [memberForm, setMemberForm] = useState({
    name: '',
    dietaryNeeds: ['Nut-Free'] as DietaryTag[],
    avoidIngredients: '',
  })
  const [barcode, setBarcode] = useState('')
  const [lookupState, setLookupState] = useState<'idle' | 'loading' | 'error' | 'success'>('idle')
  const [lookupMessage, setLookupMessage] = useState('Ready to look up products from Open Food Facts.')
  const [productDraft, setProductDraft] = useState<InventoryItem | null>(null)
  const [isScannerOpen, setIsScannerOpen] = useState(false)
  const [scannerMessage, setScannerMessage] = useState('Use your camera to detect an EAN/UPC barcode.')
  const [mealPlan, setMealPlan] = useState<PlannedMeal[]>([])
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)

  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        inventory,
        family,
        householdNeeds,
      }),
    )
  }, [family, householdNeeds, inventory])

  useEffect(() => {
    setMealPlan(buildMealPlan(inventory, family, householdNeeds))
  }, [family, householdNeeds, inventory])

  useEffect(() => {
    return () => {
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  async function lookupBarcode() {
    if (!barcode.trim()) {
      setLookupState('error')
      setLookupMessage('Enter a barcode first.')
      return
    }

    setLookupState('loading')
    setLookupMessage('Looking up product details...')

    try {
      const response = await fetch(
        `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json`,
      )
      const data = await response.json()

      if (!response.ok || data.status !== 1 || !data.product) {
        throw new Error('Product not found')
      }

      const product = data.product
      const name = product.product_name || product.product_name_en || 'Scanned product'
      const allergens = Array.isArray(product.allergens_tags)
        ? product.allergens_tags.map((tag: string) => tag.split(':').pop() ?? tag)
        : []
      const categoryText = Array.isArray(product.categories_tags)
        ? product.categories_tags.join(' ')
        : ''
      const dietaryTags = dietaryOptions.filter((tag) => {
        const normalizedTag = normalize(tag)
        if (normalizedTag === 'vegetarian') {
          return includesNormalized(categoryText, 'vegetarian')
        }
        if (normalizedTag === 'vegan') {
          return includesNormalized(categoryText, 'vegan')
        }
        if (normalizedTag === 'gluten-free') {
          return includesNormalized(categoryText, 'gluten-free')
        }
        return false
      })

      const draft: InventoryItem = {
        id: `barcode-${Date.now()}`,
        name,
        quantity: 1,
        unit: 'pack',
        zone: 'Cupboard',
        expiresOn: '',
        barcode,
        source: 'barcode',
        dietaryTags,
        allergens,
        health: {
          calories: product.nutriments?.['energy-kcal_100g'],
          protein: product.nutriments?.proteins_100g,
          fiber: product.nutriments?.fiber_100g,
          fat: product.nutriments?.fat_100g,
          sugar: product.nutriments?.sugars_100g,
          sodium: product.nutriments?.sodium_100g
            ? Number(product.nutriments.sodium_100g) * 1000
            : undefined,
        },
      }

      setProductDraft(draft)
      setLookupState('success')
      setLookupMessage(`Found ${name}. Review the storage zone and quantity, then add it.`)
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
            void lookupBarcodeFromValue(code)
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

  async function lookupBarcodeFromValue(value: string) {
    setBarcode(value)
    setLookupState('loading')
    setLookupMessage('Looking up detected barcode...')
    await new Promise((resolve) => setTimeout(resolve, 150))
    return fetch(
      `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(value)}.json`,
    )
      .then(async (response) => {
        const data = await response.json()
        if (!response.ok || data.status !== 1 || !data.product) {
          throw new Error('Product not found')
        }

        const product = data.product
        const allergens = Array.isArray(product.allergens_tags)
          ? product.allergens_tags.map((tag: string) => tag.split(':').pop() ?? tag)
          : []

        setProductDraft({
          id: `barcode-${Date.now()}`,
          name: product.product_name || product.product_name_en || 'Scanned product',
          quantity: 1,
          unit: 'pack',
          zone: 'Cupboard',
          expiresOn: '',
          barcode: value,
          source: 'barcode',
          dietaryTags: [],
          allergens,
          health: {
            calories: product.nutriments?.['energy-kcal_100g'],
            protein: product.nutriments?.proteins_100g,
            fiber: product.nutriments?.fiber_100g,
            fat: product.nutriments?.fat_100g,
            sugar: product.nutriments?.sugars_100g,
            sodium: product.nutriments?.sodium_100g
              ? Number(product.nutriments.sodium_100g) * 1000
              : undefined,
          },
        })
        setLookupState('success')
        setLookupMessage('Barcode detected and product details loaded.')
      })
      .catch(() => {
        setLookupState('error')
        setLookupMessage('Barcode detected, but the product was not found in Open Food Facts.')
      })
  }

  function addInventoryItem(item: InventoryItem) {
    setInventory((current) => [item, ...current])
  }

  function handleManualAdd(event: FormEvent) {
    event.preventDefault()
    if (!manualItem.name.trim()) {
      return
    }

    addInventoryItem({
      id: `manual-${Date.now()}`,
      name: titleCase(manualItem.name.trim()),
      quantity: manualItem.quantity,
      unit: manualItem.unit.trim(),
      zone: manualItem.zone,
      expiresOn: manualItem.expiresOn,
      source: 'manual',
      dietaryTags: [],
      allergens: [],
      health: {},
    })
    setManualItem(emptyProductForm)
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
        dietaryNeeds: memberForm.dietaryNeeds,
        avoidIngredients: memberForm.avoidIngredients,
      },
    ])
    setMemberForm({ name: '', dietaryNeeds: ['Nut-Free'], avoidIngredients: '' })
  }

  function toggleSelection<T extends string>(current: T[], value: T) {
    return current.includes(value)
      ? current.filter((item) => item !== value)
      : [...current, value]
  }

  const inventoryByZone = useMemo(
    () =>
      (['Cupboard', 'Fridge', 'Freezer'] as StorageZone[]).map((zone) => ({
        zone,
        items: inventory.filter((item) => item.zone === zone),
      })),
    [inventory],
  )

  const requiredTags = Array.from(
    new Set([...householdNeeds, ...family.flatMap((member) => member.dietaryNeeds)]),
  )

  return (
    <div className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">7 Day Food Planner</p>
          <h1>Plan meals from what your family already has.</h1>
          <p className="hero-copy">
            Track cupboard, fridge, and freezer items, scan barcodes with Open Food Facts,
            and build a weekly meal plan that respects household dietary needs.
          </p>
        </div>
        <div className="hero-metrics">
          <article>
            <span>{inventory.length}</span>
            <p>Tracked items</p>
          </article>
          <article>
            <span>{family.length}</span>
            <p>Family profiles</p>
          </article>
          <article>
            <span>{mealPlan.filter((meal) => meal.score > 0).length}</span>
            <p>Planned meals</p>
          </article>
        </div>
      </header>

      <main className="dashboard">
        <section className="panel panel-wide">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Inventory</p>
              <h2>Kitchen stock by storage zone</h2>
            </div>
          </div>
          <div className="zone-grid">
            {inventoryByZone.map(({ zone, items }) => (
              <article key={zone} className="zone-card">
                <div className="zone-card-header">
                  <h3>{zone}</h3>
                  <span>{items.length} items</span>
                </div>
                <ul className="item-list">
                  {items.map((item) => (
                    <li key={item.id}>
                      <div>
                        <strong>{item.name}</strong>
                        <p>
                          {item.quantity} {item.unit}
                          {item.expiresOn ? ` · use by ${item.expiresOn}` : ''}
                        </p>
                      </div>
                      <small>{item.source === 'barcode' ? 'Scanned' : 'Manual'}</small>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Add items</p>
              <h2>Manual inventory entry</h2>
            </div>
          </div>
          <form className="stack" onSubmit={handleManualAdd}>
            <label>
              Item name
              <input
                value={manualItem.name}
                onChange={(event) =>
                  setManualItem((current) => ({ ...current, name: event.target.value }))
                }
                placeholder="Brown rice"
              />
            </label>
            <div className="inline-fields">
              <label>
                Quantity
                <input
                  type="number"
                  min="1"
                  value={manualItem.quantity}
                  onChange={(event) =>
                    setManualItem((current) => ({
                      ...current,
                      quantity: Number(event.target.value),
                    }))
                  }
                />
              </label>
              <label>
                Unit
                <input
                  value={manualItem.unit}
                  onChange={(event) =>
                    setManualItem((current) => ({ ...current, unit: event.target.value }))
                  }
                  placeholder="bag"
                />
              </label>
            </div>
            <div className="inline-fields">
              <label>
                Storage zone
                <select
                  value={manualItem.zone}
                  onChange={(event) =>
                    setManualItem((current) => ({
                      ...current,
                      zone: event.target.value as StorageZone,
                    }))
                  }
                >
                  <option value="Cupboard">Cupboard</option>
                  <option value="Fridge">Fridge</option>
                  <option value="Freezer">Freezer</option>
                </select>
              </label>
              <label>
                Use by
                <input
                  type="date"
                  value={manualItem.expiresOn}
                  onChange={(event) =>
                    setManualItem((current) => ({ ...current, expiresOn: event.target.value }))
                  }
                />
              </label>
            </div>
            <button type="submit">Add item</button>
          </form>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Barcode</p>
              <h2>Scan with Open Food Facts</h2>
            </div>
          </div>
          <div className="stack">
            <label>
              Barcode number
              <input
                value={barcode}
                onChange={(event) => setBarcode(event.target.value)}
                placeholder="5000112548167"
              />
            </label>
            <div className="button-row">
              <button type="button" onClick={() => void lookupBarcode()}>
                Lookup product
              </button>
              <button type="button" className="secondary" onClick={() => void startScanner()}>
                Open camera
              </button>
            </div>
            <p className={`status ${lookupState}`}>{lookupMessage}</p>
            {isScannerOpen ? (
              <div className="scanner">
                <video ref={videoRef} muted playsInline />
                <p>{scannerMessage}</p>
                <button type="button" className="secondary" onClick={stopScanner}>
                  Close camera
                </button>
              </div>
            ) : null}
            {productDraft ? (
              <div className="draft-card">
                <div>
                  <h3>{productDraft.name}</h3>
                  <p>
                    Barcode {productDraft.barcode} · {productDraft.health.calories ?? 'n/a'} kcal
                    per 100g
                  </p>
                </div>
                <div className="inline-fields">
                  <label>
                    Storage
                    <select
                      value={productDraft.zone}
                      onChange={(event) =>
                        setProductDraft((current) =>
                          current
                            ? { ...current, zone: event.target.value as StorageZone }
                            : current,
                        )
                      }
                    >
                      <option value="Cupboard">Cupboard</option>
                      <option value="Fridge">Fridge</option>
                      <option value="Freezer">Freezer</option>
                    </select>
                  </label>
                  <label>
                    Quantity
                    <input
                      type="number"
                      min="1"
                      value={productDraft.quantity}
                      onChange={(event) =>
                        setProductDraft((current) =>
                          current
                            ? { ...current, quantity: Number(event.target.value) }
                            : current,
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
          </div>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Family</p>
              <h2>Dietary rules</h2>
            </div>
          </div>
          <div className="stack">
            <div>
              <p className="section-label">Household-wide requirements</p>
              <div className="chip-grid">
                {dietaryOptions.map((option) => (
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
            <ul className="member-list">
              {family.map((member) => (
                <li key={member.id}>
                  <strong>{member.name}</strong>
                  <p>{member.dietaryNeeds.join(', ') || 'No fixed tags'}</p>
                  <small>{member.avoidIngredients || 'No ingredient exclusions listed'}</small>
                </li>
              ))}
            </ul>
            <form className="stack" onSubmit={handleAddFamilyMember}>
              <label>
                Family member
                <input
                  value={memberForm.name}
                  onChange={(event) =>
                    setMemberForm((current) => ({ ...current, name: event.target.value }))
                  }
                  placeholder="Jamie"
                />
              </label>
              <div>
                <p className="section-label">Needs</p>
                <div className="chip-grid">
                  {dietaryOptions.map((option) => (
                    <button
                      key={option}
                      type="button"
                      className={
                        memberForm.dietaryNeeds.includes(option) ? 'chip active' : 'chip'
                      }
                      onClick={() =>
                        setMemberForm((current) => ({
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
                  placeholder="shellfish, sesame"
                />
              </label>
              <button type="submit">Add family member</button>
            </form>
          </div>
        </section>

        <section className="panel panel-wide">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Planner</p>
              <h2>Seven-day meal suggestions</h2>
            </div>
            <div className="planner-summary">
              <span>Required tags: {requiredTags.join(', ') || 'None'}</span>
            </div>
          </div>
          <div className="meal-grid">
            {mealPlan.map((meal) => (
              <article key={meal.day} className="meal-card">
                <div className="meal-card-header">
                  <p>{meal.day}</p>
                  <span>{meal.recipe.cookTime ? `${meal.recipe.cookTime} min` : 'Add more items'}</span>
                </div>
                <h3>{meal.recipe.title}</h3>
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
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}

export default App
