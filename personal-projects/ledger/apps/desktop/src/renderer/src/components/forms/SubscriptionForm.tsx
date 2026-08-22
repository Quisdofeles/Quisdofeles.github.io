import { useState, type FormEvent } from 'react'
import type { BillingFrequency } from '@ledger/shared'
import { inputClass, labelClass } from '../../lib/formStyles'
import { DatePicker } from '../DatePicker'
import { Select } from '../Select'

export interface SubscriptionFormValues {
  name: string
  amount: number
  billingFrequency: BillingFrequency
  nextChargeDate: string
}

interface SubscriptionFormProps {
  onSubmit: (values: SubscriptionFormValues) => Promise<void>
}

const FREQUENCY_OPTIONS: Array<{ value: BillingFrequency; label: string }> = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' }
]

function todayDateString(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function SubscriptionForm({ onSubmit }: SubscriptionFormProps) {
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [billingFrequency, setBillingFrequency] = useState<BillingFrequency>('monthly')
  const [nextChargeDate, setNextChargeDate] = useState(todayDateString())
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)

    const parsedAmount = Number(amount)
    if (!name.trim()) {
      setError('Give the subscription a name.')
      return
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError('Enter an amount greater than 0.')
      return
    }

    setSubmitting(true)
    try {
      await onSubmit({
        name: name.trim(),
        amount: parsedAmount,
        billingFrequency,
        nextChargeDate
      })
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
        <label className={labelClass}>Billing frequency</label>
        <Select
          value={billingFrequency}
          onChange={(value) => setBillingFrequency(value as BillingFrequency)}
          options={FREQUENCY_OPTIONS}
        />
      </div>

      <div>
        <label className={labelClass}>Next charge date</label>
        <DatePicker value={nextChargeDate} onChange={setNextChargeDate} />
      </div>

      {error && <p className="text-sm text-negative">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-lg bg-accent px-3 py-2 font-semibold text-bg transition hover:bg-accent-strong disabled:opacity-50"
      >
        {submitting ? 'Saving…' : 'Add subscription'}
      </button>
    </form>
  )
}
