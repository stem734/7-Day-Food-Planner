import { days, recipeLibrary } from '../data'
import type {
  AppState,
  DietaryTag,
  DietProfile,
  FamilyMember,
  InventoryItem,
  PlannedMeal,
  Recipe,
  RecipeIngredient,
  ShoppingListItem,
  StorageZone,
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

export function formatRecipeIngredient(
  ingredient: RecipeIngredient,
  cookingFor: number | 'all',
  baseServings: number,
) {
  const multiplier =
    cookingFor === 'all' || !baseServings ? 1 : Math.max(cookingFor, 1) / Math.max(baseServings, 1)
  const scaledAmount = ingredient.amount * multiplier
  const roundedAmount =
    ingredient.unit === 'g' || ingredient.unit === 'ml'
      ? Math.round(scaledAmount / 5) * 5
      : Math.round(scaledAmount * 10) / 10
  const amountText = Number.isInteger(roundedAmount) ? String(roundedAmount) : roundedAmount.toFixed(1)
  const unitText = ingredient.unit ? `${ingredient.unit} ` : ''

  return `${amountText} ${unitText}${ingredient.name}`.trim()
}

function includesNormalized(haystack: string, needle: string) {
  return normalize(haystack).includes(normalize(needle))
}

function daysUntilExpiry(expiresOn: string) {
  if (!expiresOn) {
    return undefined
  }

  const expiry = new Date(expiresOn)
  if (Number.isNaN(expiry.getTime())) {
    return undefined
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  expiry.setHours(0, 0, 0, 0)

  return Math.round((expiry.getTime() - today.getTime()) / 86400000)
}

function inferShoppingZone(ingredient: string): StorageZone {
  const source = normalize(ingredient)

  if (
    ['ice cream', 'frozen', 'frozen peas', 'frozen berries', 'chips'].some((term) =>
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
      'egg',
      'eggs',
      'spinach',
      'cucumber',
      'salad',
      'lettuce',
      'fruit',
      'vegetable',
      'vegetables',
      'chicken',
      'fish',
      'meat',
      'fresh',
    ].some((term) => source.includes(term))
  ) {
    return 'Fridge'
  }

  return 'Cupboard'
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
      recipe.ingredients.some((ingredient) => includesNormalized(ingredient.name, avoidance)) ||
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
      servings: 0,
      ingredients: [],
      steps: [],
      dietaryTags: [],
      allergens: [],
      cookTime: 0,
      zoneFocus: [],
      nutrition: { calories: 0, protein: 0, fiber: 0, carbs: 0, fat: 0, sodium: 0 },
      healthHighlights: ['Needs more matching recipes'],
    },
    matchedIngredients: [],
    missingIngredients: [],
    wasteReason: 'Add more staples to unlock waste-saving meal ideas.',
    score: 0,
  }
}

export function buildMealPlan(
  inventory: InventoryItem[],
  family: FamilyMember[],
  householdNeeds: DietaryTag[],
  userRecipes: Recipe[] = [],
  mealRecipeOverrides: Record<string, string> = {},
  rerolls: Record<string, number> = {},
) {
  const requiredTags = getRequiredTags({
    inventory,
    family,
    userRecipes: [],
    householdNeeds,
    cookedMeals: {},
    mealCookingFor: {},
    mealRecipeOverrides: {},
    shoppingChecked: {},
    shoppingExtras: [],
    purchaseHistory: [],
  })
  const avoidances = getFamilyAvoidances(family)
  const inventoryLookup = inventory.map((item) => ({
    ...item,
    normalizedName: normalize(item.name),
    expiryDays: daysUntilExpiry(item.expiresOn),
  }))

  const scoredRecipes = [...userRecipes, ...recipeLibrary]
    .map((recipe) => {
      const matchedIngredients = recipe.ingredients
        .filter((ingredient) =>
          inventoryLookup.some((item) => includesNormalized(item.normalizedName, ingredient.name)),
        )
        .map((ingredient) => ingredient.name)
      const missingIngredients = recipe.ingredients
        .filter((ingredient) => {
          return !inventoryLookup.some((item) => includesNormalized(item.normalizedName, ingredient.name))
        })
        .map((ingredient) => ingredient.name)

      const coverage = recipe.ingredients.length
        ? matchedIngredients.length / recipe.ingredients.length
        : 0
      const missingPenalty = missingIngredients.length * 2.75
      const matchedInventoryItems = inventoryLookup.filter((item) =>
        recipe.ingredients.some((ingredient) => includesNormalized(item.normalizedName, ingredient.name)),
      )
      const wasteUseScore = matchedInventoryItems.length * 3
      const urgentUseScore = matchedInventoryItems.reduce((total, item) => {
        if (item.expiryDays === undefined) {
          return total
        }

        if (item.expiryDays <= 0) {
          return total + 10
        }

        if (item.expiryDays <= 2) {
          return total + 8
        }

        if (item.expiryDays <= 5) {
          return total + 5
        }

        if (item.expiryDays <= 10) {
          return total + 2
        }

        return total
      }, 0)
      const lowRemainingScore = matchedInventoryItems.reduce((total, item) => {
        if (item.remainingPercent === undefined) {
          return total
        }

        if (item.remainingPercent <= 10) {
          return total + 8
        }

        if (item.remainingPercent <= 25) {
          return total + 5
        }

        if (item.remainingPercent <= 50) {
          return total + 2
        }

        return total
      }, 0)
      const fridgeFreezerUseScore = matchedInventoryItems.reduce((total, item) => {
        return item.zone === 'Fridge' || item.zone === 'Freezer' ? total + 1.2 : total
      }, 0)
      const healthScore =
        recipe.nutrition.protein / 10 +
        recipe.nutrition.fiber / 4 -
        recipe.nutrition.sodium / 400
      const expiringSoonCount = matchedInventoryItems.filter(
        (item) => item.expiryDays !== undefined && item.expiryDays <= 5,
      ).length
      const lowRemainingCount = matchedInventoryItems.filter(
        (item) => item.remainingPercent !== undefined && item.remainingPercent <= 25,
      ).length
      const chilledCount = matchedInventoryItems.filter(
        (item) => item.zone === 'Fridge' || item.zone === 'Freezer',
      ).length
      const reasonParts = [
        matchedIngredients.length
          ? `uses ${matchedIngredients.length} stocked item${matchedIngredients.length === 1 ? '' : 's'}`
          : '',
        expiringSoonCount
          ? `includes ${expiringSoonCount} expiring soon`
          : '',
        lowRemainingCount
          ? `uses ${lowRemainingCount} low-stock item${lowRemainingCount === 1 ? '' : 's'}`
          : '',
        chilledCount
          ? `leans on ${chilledCount} fridge/freezer item${chilledCount === 1 ? '' : 's'}`
          : '',
      ].filter(Boolean)

      return {
        recipe,
        matchedIngredients,
        missingIngredients,
        wasteReason: reasonParts.length ? `Waste saver: ${reasonParts.join(' · ')}` : 'Waste saver: uses ingredients already in stock',
        score:
          coverage * 30 +
          wasteUseScore +
          urgentUseScore +
          lowRemainingScore +
          fridgeFreezerUseScore +
          healthScore * 0.35 -
          missingPenalty * 2.4,
      }
    })

  const eligibleRecipes = scoredRecipes
    .filter(({ recipe }) => recipeMatchesRequirements(recipe, requiredTags, avoidances))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }

      if (left.missingIngredients.length !== right.missingIngredients.length) {
        return left.missingIngredients.length - right.missingIngredients.length
      }

      return right.matchedIngredients.length - left.matchedIngredients.length
    })

  const usedRecipeIds = new Set<string>()

  return days.map((day) => {
    const overrideId = mealRecipeOverrides[day]
    const overrideChoice = overrideId
      ? scoredRecipes.find((entry) => entry.recipe.id === overrideId)
      : undefined

    if (overrideChoice) {
      usedRecipeIds.add(overrideChoice.recipe.id)
      return {
        day,
        ...overrideChoice,
        wasteReason: `Manual choice: ${overrideChoice.recipe.title}`,
      }
    }

    const uniquePool = eligibleRecipes.filter((entry) => !usedRecipeIds.has(entry.recipe.id))
    const candidatePool = uniquePool.length ? uniquePool : eligibleRecipes
    const recipeCount = candidatePool.length

    if (!recipeCount) {
      return emptyMeal(day)
    }

    const choice = candidatePool[(rerolls[day] ?? 0) % recipeCount]

    if (!choice) {
      return emptyMeal(day)
    }

    usedRecipeIds.add(choice.recipe.id)
    return { day, ...choice }
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
        zone: inferShoppingZone(ingredient),
        neededFor: [meal.day],
        priority: meal.score > 6 ? 'High' : 'Medium',
      })
    })
  })

  return Array.from(grouped.values()).sort((left, right) => {
    const zoneOrder: StorageZone[] = ['Cupboard', 'Fridge', 'Freezer']
    const zoneDifference = zoneOrder.indexOf(left.zone) - zoneOrder.indexOf(right.zone)

    if (zoneDifference !== 0) {
      return zoneDifference
    }

    if (left.priority !== right.priority) {
      return left.priority === 'High' ? -1 : 1
    }

    return left.name.localeCompare(right.name)
  })
}
