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

export type Recipe = {
  id: string
  title: string
  description: string
  servings: number
  ingredients: string[]
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

export type AppState = {
  inventory: InventoryItem[]
  family: FamilyMember[]
  householdNeeds: DietaryTag[]
  cookedMeals: Record<string, boolean>
  shoppingChecked: Record<string, boolean>
}

export type SupabasePantryStateRow = {
  id?: string
  user_id: string
  inventory: InventoryItem[]
  family: FamilyMember[]
  household_needs: DietaryTag[]
  cooked_meals: Record<string, boolean>
  shopping_checked: Record<string, boolean>
  updated_at?: string
}
