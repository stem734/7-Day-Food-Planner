import { createClient } from '@supabase/supabase-js'
import type {
  AppState,
  CachedProduct,
  CachedProductEntry,
  SupabasePantryStateRow,
  SupabaseProductCacheRow,
} from '../types'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseEnabled = Boolean(supabaseUrl && supabaseAnonKey)

export const supabase = isSupabaseEnabled
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null

export async function signUpWithPassword(email: string, password: string) {
  if (!supabase) {
    throw new Error('Supabase is not configured.')
  }

  const { error } = await supabase.auth.signUp({
    email,
    password,
  })

  if (error) {
    throw error
  }
}

export async function signInWithPassword(email: string, password: string) {
  if (!supabase) {
    throw new Error('Supabase is not configured.')
  }

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) {
    throw error
  }
}

export async function signOut() {
  if (!supabase) {
    return
  }

  const { error } = await supabase.auth.signOut()
  if (error) {
    throw error
  }
}

export async function getCurrentUserId() {
  if (!supabase) {
    return null
  }

  const {
    data: { session },
  } = await supabase.auth.getSession()

  return session?.user.id ?? null
}

export async function loadRemoteState(userId: string) {
  if (!supabase) {
    return null
  }

  const { data, error } = await supabase
    .from('planner_state')
    .select('inventory, family, user_recipes, household_needs, cooked_meals, meal_cooking_for, meal_recipe_overrides, meal_inventory_adjustments, shopping_checked, shopping_extras, purchase_history')
    .eq('user_id', userId)
    .maybeSingle<SupabasePantryStateRow>()

  if (error) {
    throw error
  }

  if (!data) {
    return null
  }

  return {
    inventory: data.inventory,
    family: data.family,
    userRecipes: data.user_recipes ?? [],
    householdNeeds: data.household_needs,
    cookedMeals: data.cooked_meals ?? {},
    mealCookingFor: data.meal_cooking_for ?? {},
    mealRecipeOverrides: data.meal_recipe_overrides ?? {},
    mealInventoryAdjustments: data.meal_inventory_adjustments ?? {},
    shoppingChecked: data.shopping_checked ?? {},
    shoppingExtras: data.shopping_extras ?? [],
    purchaseHistory: data.purchase_history ?? [],
  } as AppState
}

export async function saveRemoteState(userId: string, state: AppState) {
  if (!supabase) {
    return
  }

  const payload: SupabasePantryStateRow = {
    user_id: userId,
    inventory: state.inventory,
    family: state.family,
    user_recipes: state.userRecipes,
    household_needs: state.householdNeeds,
    cooked_meals: state.cookedMeals,
    meal_cooking_for: state.mealCookingFor,
    meal_recipe_overrides: state.mealRecipeOverrides,
    meal_inventory_adjustments: state.mealInventoryAdjustments,
    shopping_checked: state.shoppingChecked,
    shopping_extras: state.shoppingExtras,
    purchase_history: state.purchaseHistory,
  }

  const { error } = await supabase.from('planner_state').upsert(payload, {
    onConflict: 'user_id',
  })

  if (error) {
    throw error
  }
}

export async function loadCachedProduct(barcode: string) {
  if (!supabase) {
    return null
  }

  const { data, error } = await supabase
    .from('product_cache')
    .select('barcode, product, access_count, last_accessed, updated_at')
    .eq('barcode', barcode)
    .maybeSingle<SupabaseProductCacheRow>()

  if (error) {
    throw error
  }

  if (!data?.product) {
    return null
  }

  const entry: CachedProductEntry = {
    product: data.product,
    accessCount: data.access_count ?? 0,
    lastAccessed: data.last_accessed,
    updatedAt: data.updated_at,
  }

  void touchCachedProduct(barcode, entry.accessCount).catch(() => {
    // Ignore access tracking failures; returning the cached product still helps.
  })

  return entry
}

export async function saveCachedProduct(product: CachedProduct, accessCount = 1) {
  if (!supabase) {
    return
  }

  const now = new Date().toISOString()
  const payload: SupabaseProductCacheRow = {
    barcode: product.barcode,
    product,
    access_count: accessCount,
    last_accessed: now,
    updated_at: now,
  }

  const { error } = await supabase.from('product_cache').upsert(payload, {
    onConflict: 'barcode',
  })

  if (error) {
    throw error
  }
}

export async function touchCachedProduct(barcode: string, currentAccessCount = 0) {
  if (!supabase) {
    return
  }

  const { error } = await supabase
    .from('product_cache')
    .update({
      access_count: currentAccessCount + 1,
      last_accessed: new Date().toISOString(),
    })
    .eq('barcode', barcode)

  if (error) {
    throw error
  }
}
