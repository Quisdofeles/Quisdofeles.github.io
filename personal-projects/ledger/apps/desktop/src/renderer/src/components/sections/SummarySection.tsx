import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Card } from '../Card'
import { StatTile } from '../StatTile'
import { supabase } from '../../lib/supabaseClient'
import { sendMonthlyInvoice } from '../../lib/queries/invoice'
import type { MonthAggregates } from '../../lib/deriveMonthAggregates'

interface SummarySectionProps {
  aggregates: MonthAggregates
  month: Date
}

export function SummarySection({ aggregates, month }: SummarySectionProps) {
  const [justSent, setJustSent] = useState(false)

  const invoiceMutation = useMutation({
    mutationFn: () => sendMonthlyInvoice(supabase, month),
    onSuccess: () => {
      setJustSent(true)
      setTimeout(() => setJustSent(false), 4000)
    }
  })

  return (
    <Card padding="lg">
      <h2 className="mb-4 text-lg font-semibold tracking-tight text-text">Summary</h2>
      <div className="flex flex-wrap gap-x-8 gap-y-4">
        <StatTile label="Income" value={aggregates.income} />
        <StatTile label="Expenses" value={aggregates.expenses} />
        <StatTile
          label="Balance"
          value={aggregates.balance}
          tone={aggregates.balance >= 0 ? 'positive' : 'negative'}
        />
      </div>

      <div className="mt-6">
        <button
          onClick={() => invoiceMutation.mutate()}
          disabled={invoiceMutation.isPending}
          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-bg transition hover:bg-accent-strong disabled:opacity-50"
        >
          {invoiceMutation.isPending ? 'Sending…' : justSent ? 'Sent ✓' : 'Email invoice'}
        </button>

        {invoiceMutation.isError && (
          <p className="mt-3 text-sm text-negative">
            Couldn't send invoice: {(invoiceMutation.error as Error).message}
          </p>
        )}
      </div>
    </Card>
  )
}
