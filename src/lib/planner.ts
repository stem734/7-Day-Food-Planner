import { days, recipeLibrary } from '../data'
import type {
  AppState,
  DietaryTag,
  DietProfile,
  FamilyMember,
  InventoryItem,
  PlannedMeal,
  Recipe,
  ShoppingListItem,
} from '../types'

function normalize(value: string) {
  return value.trim().toLowerCase()
}

export function titleCase(value: string) {
  return value
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function includesNormalized(haystack: string, needle: string) {
  return normalize(haystack).includes(normalize(needle))
}

export function getFamilyAvoidances(family: FamilyMember[]) {
  return family
    .flatMap((member) => member.avoidIngredients.split(','))
    .map((item) => normalize(item))
    .filter(Boolean)
}

function profileToRequiredTag(profile: DietProfile, eatsFish: boolean): DietaryTag | null {
  if (profile === 'Vegan') {
    return 'Vegan'
  }

  if (profile === 'Vegetarian') {
    return eatsFish ? 'Pescatarian' : 'Vegetarian'
  }

  return null
}

export function getRequiredTags(state: AppState) {
  const profileTags = state.family
    .map((member) => profileToRequiredTag(member.dietProfile, member.eatsFish))
    .filter((tag): tag is DietaryTag => Boolean(tag))

  return Array.from(
    new Set([
      ...state.householdNeeds,
      ...profileTags,
      ...state.family.flatMap((member) => member.dietaryNeeds),
    ]),
  )
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

function emptyMeal(day: string): PlannedMeal {
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

export function buildMealPlan(
  inventory: InventoryItem[],
  family: FamilyMember[],
  householdNeeds: DietaryTag[],
) {
  const requiredTags = getRequiredTags({
    inventory,
    family,
    householdNeeds,
    cookedMeals: {},
  })
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
    return choice ? { day, ...choice } : emptyMeal(day)
  })
}

export function buildShoppingList(mealPlan: PlannedMeal[]): ShoppingListItem[] {
  const grouped = new Map<string, ShoppingListItem>()

  mealPlan.forEach((meal) => {
    meal.missingIngredients.forEach((ingredient) => {
      const key = normalize(ingredient)
      const existing = grouped.get(key)

      if (existing) {
        existing.neededFor.push(meal.day)
        if (meal.score > 6) {
          existing.priority = 'High'
        }
        return
      }

      grouped.set(key, {
        name: titleCase(ingredient),
        neededFor: [meal.day],
        priority: meal.score > 6 ? 'High' : 'Medium',
      })
    })
  })

  return Array.from(grouped.values()).sort((left, right) => {
    if (left.priority !== right.priority) {
      return left.priority === 'High' ? -1 : 1
    }

    return left.name.localeCompare(right.name)
  })
}
