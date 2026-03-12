export type StorageZone = 'Cupboard' | 'Fridge' | 'Freezer'

export type DietaryTag =
  | 'Vegetarian'
  | 'Vegan'
  | 'Pescatarian'
  | 'Gluten-Free'
  | 'Dairy-Free'
  | 'Nut-Free'
  | 'High-Protein'
  | 'Low-Sodium'

export type DietProfile = 'Omnivore' | 'Vegetarian' | 'Vegan'

export type InventoryItem = {
  id: string
  name: string
  brand?: string
  categories: string[]
  quantity: number
  remainingPercent?: number
  rebuyEveryDays?: number
  lastPurchasedOn?: string
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
    novaGroup?: number
  }
}

export type FamilyMember = {
  id: string
  name: string
  dietProfile: DietProfile
  eatsFish: boolean
  dietaryNeeds: DietaryTag[]
  avoidIngredients: string
}

export type RecipeIngredient = {
  name: string
  amount: number
  unit: string
}

export type Recipe = {
  id: string
  title: string
  description: string
  servings: number
  ingredients: RecipeIngredient[]
  steps: string[]
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

export type PlannedMeal = {
  day: string
  recipe: Recipe
  matchedIngredients: string[]
  missingIngredients: string[]
  wasteReason: string
  score: number
}

export type AISuggestedMeal = {
  day: string
  title: string
  summary: string
  servings: number
  cookTime: number
  dietaryNotes: string[]
  usesFromInventory: string[]
  shoppingNeeded: string[]
  ingredients: string[]
  steps: string[]
  nutritionFocus: string
  whyItFits: string
}

export type ShoppingListItem = {
  name: string
  zone: StorageZone
  neededFor: string[]
  priority: 'High' | 'Medium'
}

export type MealCookingFor = 'all' | number

export type AppState = {
  inventory: InventoryItem[]
  family: FamilyMember[]
  userRecipes: Recipe[]
  householdNeeds: DietaryTag[]
  cookedMeals: Record<string, boolean>
  mealCookingFor: Record<string, MealCookingFor>
  mealRecipeOverrides: Record<string, string>
  mealInventoryAdjustments: Record<string, InventoryItem[]>
  shoppingChecked: Record<string, boolean>
  shoppingExtras: ShoppingListItem[]
  purchaseHistory: Array<{
    name: string
    date: string
  }>
}

export type CachedProduct = {
  barcode: string
  name: string
  brand?: string
  categories: string[]
  unit: string
  zone: StorageZone
  dietaryTags: DietaryTag[]
  allergens: string[]
  health: InventoryItem['health']
}

export type SupabasePantryStateRow = {
  id?: string
  user_id: string
  inventory: InventoryItem[]
  family: FamilyMember[]
  user_recipes: Recipe[]
  household_needs: DietaryTag[]
  cooked_meals: Record<string, boolean>
  meal_cooking_for: Record<string, MealCookingFor>
  meal_recipe_overrides: Record<string, string>
  meal_inventory_adjustments: Record<string, InventoryItem[]>
  shopping_checked: Record<string, boolean>
  shopping_extras: ShoppingListItem[]
  purchase_history: Array<{
    name: string
    date: string
  }>
  updated_at?: string
}

export type SupabaseProductCacheRow = {
  barcode: string
  product: CachedProduct
  updated_at?: string
}
