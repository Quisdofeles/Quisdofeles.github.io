import { useState, type FormEvent } from 'react'
import type { DebtPaymentType } from '@ledger/shared'
import { inputClass, labelClass } from '../../lib/formStyles'
import { DatePicker } from '../DatePicker'
import { toDateOnlyString } from '../../lib/date'

export interface DebtTransactionFormValues {
  type: DebtPaymentType
  amount: number
  date: string
}

interface DebtTransactionFormProps {
  onSubmit: (values: DebtTransactionFormValues) => Promise<void>
}

const TYPE_LABELS: Record<DebtPaymentType, string> = {
  reduce: 'Reduce',
  extend: 'Extend'
}

export function DebtTransactionForm({ onSubmit }: DebtTransactionFormProps) {
  const [type, setType] = useState<DebtPaymentType>('reduce')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(() => toDateOnlyString(new Date()))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      await onSubmit({ type, amount: parsedAmount, date })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex gap-2">
        {(['reduce', 'extend'] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setType(option)}
            className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition ${
              type === option
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-border text-text-muted hover:text-text'
            }`}
          >
            {TYPE_LABELS[option]}
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
        <label className={labelClass}>Date</label>
        <DatePicker value={date} onChange={setDate} />
      </div>

      {error && <p className="text-sm text-negative">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-lg bg-accent px-3 py-2 font-semibold text-bg transition hover:bg-accent-strong disabled:opacity-50"
      >
        {submitting ? 'Saving…' : 'Log transaction'}
      </button>
    </form>
  )
}
