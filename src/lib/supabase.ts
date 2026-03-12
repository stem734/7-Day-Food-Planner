import { createClient } from '@supabase/supabase-js'
import type { AppState, CachedProduct, SupabasePantryStateRow, SupabaseProductCacheRow } from '../types'

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
    .select('inventory, family, user_recipes, household_needs, cooked_meals, meal_cooking_for, meal_recipe_overrides, shopping_checked, shopping_extras, purchase_history')
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
    .select('barcode, product, updated_at')
    .eq('barcode', barcode)
    .maybeSingle<SupabaseProductCacheRow>()

  if (error) {
    throw error
  }

  return data?.product ?? null
}

export async function saveCachedProduct(product: CachedProduct) {
  if (!supabase) {
    return
  }

  const payload: SupabaseProductCacheRow = {
    barcode: product.barcode,
    product,
  }

  const { error } = await supabase.from('product_cache').upsert(payload, {
    onConflict: 'barcode',
  })

  if (error) {
    throw error
  }
}
