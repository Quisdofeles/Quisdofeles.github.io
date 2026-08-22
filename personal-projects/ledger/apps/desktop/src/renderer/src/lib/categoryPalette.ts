import type { CategoryType } from '@ledger/shared'

// Single-hue ramps (same green/red hue as --color-positive/--color-negative,
// stepping only saturation + lightness) so a category's swatch always signals
// its type at a glance, with shade distinguishing it from sibling categories.
// Contrast against the app's dark surfaces (#12151d / #181c26) confirmed >= 3:1
// for every step via the dataviz skill's validator.
export const INCOME_SWATCHES = [
  '#06794f',
  '#0a8a5b',
  '#12a56f',
  '#1dc386',
  '#31d89b',
  '#5ad8aa',
  '#80dbba',
  '#a3e0ca'
]

export const EXPENSE_SWATCHES = [
  '#c21b0f',
  '#c91f13',
  '#de281b',
  '#e04438',
  '#de6259',
  '#de7e78',
  '#e09994',
  '#e4b3af'
]

export function swatchesForType(categoryType: CategoryType): string[] {
  return categoryType === 'income' ? INCOME_SWATCHES : EXPENSE_SWATCHES
}

export function nextSwatch(categoryType: CategoryType, usedColors: string[]): string {
  const palette = swatchesForType(categoryType)
  const unused = palette.find((swatch) => !usedColors.includes(swatch))
  return unused ?? palette[usedColors.length % palette.length]
}
