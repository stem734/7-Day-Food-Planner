import { defaultState, STORAGE_KEY } from '../data'
import type { AppState } from '../types'

export function loadInitialState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return defaultState
    }

    const parsed = JSON.parse(raw) as Partial<AppState>

    return {
      inventory: parsed.inventory?.length ? parsed.inventory : defaultState.inventory,
      family: parsed.family?.length ? parsed.family : defaultState.family,
      householdNeeds: parsed.householdNeeds?.length
        ? parsed.householdNeeds
        : defaultState.householdNeeds,
      cookedMeals: parsed.cookedMeals ?? defaultState.cookedMeals,
    }
  } catch {
    return defaultState
  }
}

export function saveLocalState(state: AppState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}
