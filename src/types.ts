export type StorageZone = 'Cupboard' | 'Fridge' | 'Freezer'

export type DietaryTag =
  | 'Vegetarian'
  | 'Vegan'
  | 'Gluten-Free'
  | 'Dairy-Free'
  | 'Nut-Free'
  | 'High-Protein'
  | 'Low-Sodium'

export type InventoryItem = {
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

export type FamilyMember = {
  id: string
  name: string
  dietaryNeeds: DietaryTag[]
  avoidIngredients: string
}

export type Recipe = {
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

export type PlannedMeal = {
  day: string
  recipe: Recipe
  matchedIngredients: string[]
  missingIngredients: string[]
  score: number
}

export type ShoppingListItem = {
  name: string
  neededFor: string[]
  priority: 'High' | 'Medium'
}

export type AppState = {
  inventory: InventoryItem[]
  family: FamilyMember[]
  householdNeeds: DietaryTag[]
}

export type SupabasePantryStateRow = {
  id?: string
  user_id: string
  inventory: InventoryItem[]
  family: FamilyMember[]
  household_needs: DietaryTag[]
  updated_at?: string
}
