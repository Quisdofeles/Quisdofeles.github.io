import { useState, type FormEvent } from 'react'
import type { SavingsGoal } from '../../lib/queries/savingsGoals'
import { inputClass, labelClass } from '../../lib/formStyles'

export interface SavingsGoalFormValues {
  name: string
  notes: string | null
  targetAmount: number
}

interface SavingsGoalFormProps {
  initial?: SavingsGoal
  onSubmit: (values: SavingsGoalFormValues) => Promise<void>
}

export function SavingsGoalForm({ initial, onSubmit }: SavingsGoalFormProps) {
  const [name, setName] = useState(initial?.name ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [targetAmount, setTargetAmount] = useState(String(initial?.target_amount ?? ''))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)

    const parsedTarget = Number(targetAmount)
    if (!name.trim()) {
      setError('Give the goal a name.')
      return
    }
    if (!Number.isFinite(parsedTarget) || parsedTarget <= 0) {
      setError('Enter a target amount greater than 0.')
      return
    }

    setSubmitting(true)
    try {
      await onSubmit({ name: name.trim(), notes: notes.trim() || null, targetAmount: parsedTarget })
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
        <label className={labelClass}>Notes (optional)</label>
        <textarea
          rows={2}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          className={inputClass}
        />
      </div>

      <div>
        <label className={labelClass}>Target amount</label>
        <input
          type="number"
          min="0.01"
          step="0.01"
          required
          value={targetAmount}
          onChange={(event) => setTargetAmount(event.target.value)}
          className={inputClass}
        />
      </div>

      {error && <p className="text-sm text-negative">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-lg bg-accent px-3 py-2 font-semibold text-bg transition hover:bg-accent-strong disabled:opacity-50"
      >
        {submitting ? 'Saving…' : initial ? 'Save changes' : 'Add goal'}
      </button>
    </form>
  )
}
