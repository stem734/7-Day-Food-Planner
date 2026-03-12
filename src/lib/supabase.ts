import { createClient } from '@supabase/supabase-js'
import type { AppState, SupabasePantryStateRow } from '../types'

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
    .select('inventory, family, household_needs, cooked_meals')
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
    householdNeeds: data.household_needs,
    cookedMeals: data.cooked_meals ?? {},
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
    household_needs: state.householdNeeds,
    cooked_meals: state.cookedMeals,
  }

  const { error } = await supabase.from('planner_state').upsert(payload, {
    onConflict: 'user_id',
  })

  if (error) {
    throw error
  }
}
