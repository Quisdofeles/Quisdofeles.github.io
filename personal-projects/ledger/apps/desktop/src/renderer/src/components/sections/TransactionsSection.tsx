import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import { formatCurrency } from '../../lib/format'
import { Card } from '../Card'
import { ConfirmDialog } from '../ConfirmDialog'
import { Modal } from '../Modal'
import { TransactionForm, type TransactionFormValues } from '../forms/TransactionForm'
import {
  createTransaction,
  deleteTransaction,
  monthTransactionsKey,
  type TransactionWithCategory
} from '../../lib/queries/transactions'
import type { Category } from '../../lib/queries/categories'

interface TransactionsSectionProps {
  userId: string
  month: Date
  transactions: TransactionWithCategory[]
  categories: Category[]
}

const RECENT_COUNT = 5

export function TransactionsSection({
  userId,
  month,
  transactions,
  categories
}: TransactionsSectionProps) {
  const [modalOpen, setModalOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<TransactionWithCategory | null>(null)
  const queryClient = useQueryClient()
  const queryKey = monthTransactionsKey(userId, month)

  const createMutation = useMutation({
    mutationFn: (values: TransactionFormValues) =>
      createTransaction(supabase, {
        user_id: userId,
        category_id: values.categoryId,
        amount: values.amount,
        type: values.type,
        transaction_date: values.date,
        note: values.note
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey })
      setModalOpen(false)
    }
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteTransaction(supabase, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey })
      setPendingDelete(null)
    }
  })

  const visible = expanded ? transactions : transactions.slice(0, RECENT_COUNT)

  return (
    <Card>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight text-text">Transactions</h2>
        <button
          onClick={() => setModalOpen(true)}
          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-bg transition hover:bg-accent-strong"
        >
          + Add transaction
        </button>
      </div>

      {transactions.length === 0 ? (
        <p className="text-sm text-text-muted">No transactions this month yet.</p>
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-lg bg-surface-raised">
          {visible.map((transaction) => (
            <div key={transaction.id} className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-3">
                {transaction.categories && (
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: transaction.categories.color }}
                  />
                )}
                <div>
                  <p className="text-sm text-text">
                    {transaction.categories?.name ?? 'Uncategorized'}
                  </p>
                  <p className="text-xs text-text-muted">
                    {transaction.transaction_date}
                    {transaction.note ? ` · ${transaction.note}` : ''}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span
                  className={`text-sm font-semibold ${
                    transaction.type === 'income' ? 'text-positive' : 'text-negative'
                  }`}
                >
                  {transaction.type === 'income' ? '+' : '-'}
                  {formatCurrency(transaction.amount)}
                </span>
                <button
                  onClick={() => setPendingDelete(transaction)}
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

      {transactions.length > RECENT_COUNT && (
        <button
          onClick={() => setExpanded((value) => !value)}
          className="mt-3 text-sm text-text-muted hover:text-text"
        >
          {expanded ? 'Show less' : `Show all ${transactions.length} transactions`}
        </button>
      )}

      {modalOpen && (
        <Modal title="Add transaction" onClose={() => setModalOpen(false)}>
          <TransactionForm
            categories={categories}
            onSubmit={(values) => createMutation.mutateAsync(values)}
          />
        </Modal>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete transaction"
          message={`Delete "${pendingDelete.categories?.name ?? 'Uncategorized'} — ${formatCurrency(
            pendingDelete.amount
          )}"? This can't be undone.`}
          onConfirm={() => deleteMutation.mutate(pendingDelete.id)}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </Card>
  )
}
