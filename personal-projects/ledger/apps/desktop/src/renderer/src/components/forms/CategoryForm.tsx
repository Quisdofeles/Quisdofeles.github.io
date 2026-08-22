import { useState, type FormEvent } from 'react'
import type { CategoryType } from '@ledger/shared'
import type { Category } from '../../lib/queries/categories'
import { nextSwatch, swatchesForType } from '../../lib/categoryPalette'
import { inputClass, labelClass } from '../../lib/formStyles'

export interface CategoryFormValues {
  name: string
  categoryType: CategoryType
  monthlyGoal: number
  color: string
}

interface CategoryFormProps {
  initial?: Category
  categories: Category[]
  onSubmit: (values: CategoryFormValues) => Promise<void>
}

function usedColorsForType(categories: Category[], categoryType: CategoryType): string[] {
  return categories
    .filter((category) => category.category_type === categoryType)
    .map((category) => category.color)
}

export function CategoryForm({ initial, categories, onSubmit }: CategoryFormProps) {
  const [name, setName] = useState(initial?.name ?? '')
  const [categoryType, setCategoryType] = useState<CategoryType>(initial?.category_type ?? 'expense')
  const [monthlyGoal, setMonthlyGoal] = useState(String(initial?.monthly_goal ?? ''))
  const [color, setColor] = useState(
    () => initial?.color ?? nextSwatch('expense', usedColorsForType(categories, 'expense'))
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleTypeChange(nextType: CategoryType) {
    setCategoryType(nextType)
    setColor(nextSwatch(nextType, usedColorsForType(categories, nextType)))
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)

    const parsedGoal = Number(monthlyGoal)
    if (!name.trim()) {
      setError('Give the category a name.')
      return
    }
    if (!Number.isFinite(parsedGoal) || parsedGoal < 0) {
      setError('Enter a goal of 0 or more.')
      return
    }

    setSubmitting(true)
    try {
      await onSubmit({ name: name.trim(), categoryType, monthlyGoal: parsedGoal, color })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className={labelClass}>Name</label>
        <input
          type="text"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          className={inputClass}
        />
      </div>

      <div>
        <label className={labelClass}>Type</label>
        {initial ? (
          <p className="rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm capitalize text-text-muted">
            {categoryType} (fixed after creation)
          </p>
        ) : (
          <div className="flex gap-2">
            {(['income', 'expense'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => handleTypeChange(option)}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium capitalize transition ${
                  categoryType === option
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-border text-text-muted hover:text-text'
                }`}
              >
                {option}
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        <label className={labelClass}>
          {categoryType === 'expense' ? 'Monthly spending goal' : 'Monthly income goal'}
        </label>
        <input
          type="number"
          min="0"
          step="0.01"
          required
          value={monthlyGoal}
          onChange={(event) => setMonthlyGoal(event.target.value)}
          className={inputClass}
        />
      </div>

      <div>
        <label className={labelClass}>Color</label>
        <div className="flex flex-wrap gap-2">
          {swatchesForType(categoryType).map((swatch) => (
            <button
              key={swatch}
              type="button"
              onClick={() => setColor(swatch)}
              className={`h-8 w-8 rounded-full transition ${
                color === swatch ? 'ring-2 ring-text ring-offset-2 ring-offset-surface' : ''
              }`}
              style={{ backgroundColor: swatch }}
              aria-label={swatch}
            />
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-negative">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-lg bg-accent px-3 py-2 font-semibold text-bg transition hover:bg-accent-strong disabled:opacity-50"
      >
        {submitting ? 'Saving…' : initial ? 'Save changes' : 'Add category'}
      </button>
    </form>
  )
}
