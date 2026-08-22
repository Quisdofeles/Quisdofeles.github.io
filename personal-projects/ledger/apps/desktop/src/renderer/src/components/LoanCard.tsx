import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { formatCurrency } from '../lib/format'
import { supabase } from '../lib/supabaseClient'
import { Card } from './Card'
import { PercentRing } from './PercentRing'
import { StatTile } from './StatTile'
import { Modal } from './Modal'
import { ConfirmDialog } from './ConfirmDialog'
import { DebtForm, type DebtFormValues } from './forms/DebtForm'
import { DebtTransactionForm, type DebtTransactionFormValues } from './forms/DebtTransactionForm'
import { debtsKey, updateDebt, deleteDebt, type Debt } from '../lib/queries/debts'
import {
  debtPaymentsKey,
  createDebtPayment,
  deleteDebtPayment,
  type DebtPayment
} from '../lib/queries/debtPayments'

interface LoanCardProps {
  userId: string
  debt: Debt
  payments: DebtPayment[]
}

const VISIBLE_COUNT = 5

export function LoanCard({ userId, debt, payments }: LoanCardProps) {
  const [editOpen, setEditOpen] = useState(false)
  const [logOpen, setLogOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [pendingDeleteLoan, setPendingDeleteLoan] = useState(false)
  const [pendingDeletePayment, setPendingDeletePayment] = useState<DebtPayment | null>(null)
  const queryClient = useQueryClient()

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: debtsKey(userId) })
    queryClient.invalidateQueries({ queryKey: debtPaymentsKey(userId) })
  }

  const updateMutation = useMutation({
    mutationFn: (values: DebtFormValues) =>
      updateDebt(supabase, debt.id, {
        name: values.name,
        notes: values.notes,
        original_amount: values.originalAmount
      }),
    onSuccess: () => {
      invalidate()
      setEditOpen(false)
    }
  })

  const deleteLoanMutation = useMutation({
    mutationFn: () => deleteDebt(supabase, debt.id),
    onSuccess: () => {
      invalidate()
      setPendingDeleteLoan(false)
    }
  })

  const logMutation = useMutation({
    mutationFn: (values: DebtTransactionFormValues) =>
      createDebtPayment(supabase, {
        debt_id: debt.id,
        amount: values.amount,
        type: values.type,
        payment_date: values.date
      }),
    onSuccess: () => {
      invalidate()
      setLogOpen(false)
    }
  })

  const deletePaymentMutation = useMutation({
    mutationFn: (id: string) => deleteDebtPayment(supabase, id),
    onSuccess: () => {
      invalidate()
      setPendingDeletePayment(null)
    }
  })

  const paidOff = debt.original_amount - debt.current_balance
  const percent = debt.original_amount > 0 ? (paidOff / debt.original_amount) * 100 : 0
  const visible = expanded ? payments : payments.slice(0, VISIBLE_COUNT)

  return (
    <Card>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-text">{debt.name}</h3>
          {debt.notes && <p className="mt-1 text-sm text-text-muted">{debt.notes}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <button onClick={() => setEditOpen(true)} className="text-xs text-text-muted hover:text-text">
            Edit
          </button>
          <button
            onClick={() => setPendingDeleteLoan(true)}
            className="text-xs text-text-muted hover:text-negative"
          >
            Delete
          </button>
          <button
            onClick={() => setLogOpen(true)}
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-bg transition hover:bg-accent-strong"
          >
            + Log transaction
          </button>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-8">
        <div className="flex flex-1 flex-wrap gap-x-8 gap-y-4">
          <StatTile label="Paid off" value={paidOff} />
          <StatTile label="Original" value={debt.original_amount} />
          <StatTile label="Remaining" value={debt.current_balance} tone="positive" />
        </div>
        <PercentRing percent={percent} />
      </div>

      <div className="mt-6">
        <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-muted">Transactions</h4>

        {payments.length === 0 ? (
          <p className="text-sm text-text-muted">No transactions logged yet.</p>
        ) : (
          <div className="divide-y divide-border overflow-hidden rounded-lg bg-surface-raised">
            {visible.map((payment) => (
              <div key={payment.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm capitalize text-text">{payment.type}</p>
                  <p className="text-xs text-text-muted">{payment.payment_date}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`text-sm font-semibold ${
                      payment.type === 'reduce' ? 'text-positive' : 'text-negative'
                    }`}
                  >
                    {payment.type === 'reduce' ? '-' : '+'}
                    {formatCurrency(payment.amount)}
                  </span>
                  <button
                    onClick={() => setPendingDeletePayment(payment)}
                    className="text-text-muted hover:text-negative"
                    aria-label="Delete transaction"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {payments.length > VISIBLE_COUNT && (
          <button
            onClick={() => setExpanded((value) => !value)}
            className="mt-3 text-sm text-text-muted hover:text-text"
          >
            {expanded ? 'Show less' : `Show all ${payments.length} transactions`}
          </button>
        )}
      </div>

      {editOpen && (
        <Modal title={`Edit ${debt.name}`} onClose={() => setEditOpen(false)}>
          <DebtForm initial={debt} onSubmit={(values) => updateMutation.mutateAsync(values)} />
        </Modal>
      )}

      {logOpen && (
        <Modal title="Log transaction" onClose={() => setLogOpen(false)}>
          <DebtTransactionForm onSubmit={(values) => logMutation.mutateAsync(values)} />
        </Modal>
      )}

      {pendingDeleteLoan && (
        <ConfirmDialog
          title="Delete loan"
          message={`Delete "${debt.name}"? This also deletes its ${payments.length} logged transaction${
            payments.length === 1 ? '' : 's'
          }.`}
          onConfirm={() => deleteLoanMutation.mutate()}
          onCancel={() => setPendingDeleteLoan(false)}
        />
      )}

      {pendingDeletePayment && (
        <ConfirmDialog
          title="Delete transaction"
          message={`Delete this ${pendingDeletePayment.type}? This can't be undone.`}
          onConfirm={() => deletePaymentMutation.mutate(pendingDeletePayment.id)}
          onCancel={() => setPendingDeletePayment(null)}
        />
      )}
    </Card>
  )
}
