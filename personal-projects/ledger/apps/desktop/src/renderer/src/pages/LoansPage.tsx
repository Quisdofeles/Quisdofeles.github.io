import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient'
import { Modal } from '../components/Modal'
import { LoanCard } from '../components/LoanCard'
import { DebtForm, type DebtFormValues } from '../components/forms/DebtForm'
import { debtsKey, fetchDebts, createDebt } from '../lib/queries/debts'
import { debtPaymentsKey, fetchAllDebtPayments } from '../lib/queries/debtPayments'

interface LoansPageProps {
  userId: string
}

export function LoansPage({ userId }: LoansPageProps) {
  const [addOpen, setAddOpen] = useState(false)
  const queryClient = useQueryClient()

  const debtsQuery = useQuery({
    queryKey: debtsKey(userId),
    queryFn: () => fetchDebts(supabase, userId)
  })

  const paymentsQuery = useQuery({
    queryKey: debtPaymentsKey(userId),
    queryFn: () => fetchAllDebtPayments(supabase)
  })

  const debts = debtsQuery.data ?? []
  const payments = paymentsQuery.data ?? []

  const paymentsByDebt = useMemo(() => {
    const map = new Map<string, typeof payments>()
    for (const payment of payments) {
      const list = map.get(payment.debt_id) ?? []
      list.push(payment)
      map.set(payment.debt_id, list)
    }
    return map
  }, [payments])

  const createMutation = useMutation({
    mutationFn: (values: DebtFormValues) =>
      createDebt(supabase, {
        user_id: userId,
        name: values.name,
        notes: values.notes,
        original_amount: values.originalAmount
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: debtsKey(userId) })
      setAddOpen(false)
    }
  })

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-8 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight text-text">Loans</h1>
        <button
          onClick={() => setAddOpen(true)}
          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-bg transition hover:bg-accent-strong"
        >
          + Add loan
        </button>
      </div>

      {debtsQuery.error && (
        <p className="text-sm text-negative">Couldn't load loans: {(debtsQuery.error as Error).message}</p>
      )}

      {debts.length === 0 ? (
        <p className="text-sm text-text-muted">No loans yet. Add one to start tracking payoff progress.</p>
      ) : (
        <div className="space-y-6">
          {debts.map((debt) => (
            <LoanCard key={debt.id} userId={userId} debt={debt} payments={paymentsByDebt.get(debt.id) ?? []} />
          ))}
        </div>
      )}

      {addOpen && (
        <Modal title="Add loan" onClose={() => setAddOpen(false)}>
          <DebtForm onSubmit={(values) => createMutation.mutateAsync(values)} />
        </Modal>
      )}
    </div>
  )
}
