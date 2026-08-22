import { useState, type FormEvent } from 'react'
import type { TransactionType } from '@ledger/shared'
import type { Category } from '../../lib/queries/categories'
import { inputClass, labelClass } from '../../lib/formStyles'
import { DatePicker } from '../DatePicker'
import { Select } from '../Select'

export interface TransactionFormValues {
  type: TransactionType
  amount: number
  categoryId: string | null
  date: string
  note: string | null
}

interface TransactionFormProps {
  categories: Category[]
  onSubmit: (values: TransactionFormValues) => Promise<void>
}

function todayDateString(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function TransactionForm({ categories, onSubmit }: TransactionFormProps) {
  const [type, setType] = useState<TransactionType>('expense')
  const [amount, setAmount] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [date, setDate] = useState(todayDateString())
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const filteredCategories = categories.filter((category) => category.category_type === type)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)

    const parsedAmount = Number(amount)
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError('Enter an amount greater than 0.')
      return
    }

    setSubmitting(true)
    try {
      await onSubmit({
        type,
        amount: parsedAmount,
        categoryId: categoryId || null,
        date,
        note: note.trim() || null
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex gap-2">
        {(['income', 'expense'] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => {
              setType(option)
              setCategoryId('')
            }}
            className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium capitalize transition ${
              type === option
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-border text-text-muted hover:text-text'
            }`}
          >
            {option}
          </button>
        ))}
      </div>

      <div>
        <label className={labelClass}>Amount</label>
        <input
          type="number"
          min="0.01"
          step="0.01"
          required
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          className={inputClass}
        />
      </div>

      <div>
        <label className={labelClass}>Category</label>
        <Select
          value={categoryId}
          onChange={setCategoryId}
          placeholder="Uncategorized"
          options={filteredCategories.map((category) => ({
            value: category.id,
            label: category.name
          }))}
        />
      </div>

      <div>
        <label className={labelClass}>Date</label>
        <DatePicker value={date} onChange={setDate} />
      </div>

      <div>
        <label className={labelClass}>Note (optional)</label>
        <input
          type="text"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          className={inputClass}
        />
      </div>

      {error && <p className="text-sm text-negative">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-lg bg-accent px-3 py-2 font-semibold text-bg transition hover:bg-accent-strong disabled:opacity-50"
      >
        {submitting ? 'Saving…' : 'Add transaction'}
      </button>
    </form>
  )
}
