import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { formatCurrency } from '../lib/format'
import { supabase } from '../lib/supabaseClient'
import { Card } from './Card'
import { PercentRing } from './PercentRing'
import { StatTile } from './StatTile'
import { Modal } from './Modal'
import { ConfirmDialog } from './ConfirmDialog'
import { SavingsGoalForm, type SavingsGoalFormValues } from './forms/SavingsGoalForm'
import { SavingsTransactionForm, type SavingsTransactionFormValues } from './forms/SavingsTransactionForm'
import { savingsGoalsKey, updateSavingsGoal, deleteSavingsGoal, type SavingsGoal } from '../lib/queries/savingsGoals'
import {
  savingsContributionsKey,
  createContribution,
  deleteContribution,
  type SavingsContribution
} from '../lib/queries/savingsContributions'

interface SavingsGoalCardProps {
  userId: string
  goal: SavingsGoal
  contributions: SavingsContribution[]
}

const VISIBLE_COUNT = 5

export function SavingsGoalCard({ userId, goal, contributions }: SavingsGoalCardProps) {
  const [editOpen, setEditOpen] = useState(false)
  const [logOpen, setLogOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [pendingDeleteGoal, setPendingDeleteGoal] = useState(false)
  const [pendingDeleteContribution, setPendingDeleteContribution] = useState<SavingsContribution | null>(
    null
  )
  const queryClient = useQueryClient()

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: savingsGoalsKey(userId) })
    queryClient.invalidateQueries({ queryKey: savingsContributionsKey(userId) })
  }

  const updateMutation = useMutation({
    mutationFn: (values: SavingsGoalFormValues) =>
      updateSavingsGoal(supabase, goal.id, {
        name: values.name,
        notes: values.notes,
        target_amount: values.targetAmount
      }),
    onSuccess: () => {
      invalidate()
      setEditOpen(false)
    }
  })

  const deleteGoalMutation = useMutation({
    mutationFn: () => deleteSavingsGoal(supabase, goal.id),
    onSuccess: () => {
      invalidate()
      setPendingDeleteGoal(false)
    }
  })

  const logMutation = useMutation({
    mutationFn: (values: SavingsTransactionFormValues) =>
      createContribution(supabase, {
        savings_goal_id: goal.id,
        amount: values.amount,
        type: values.type,
        contribution_date: values.date
      }),
    onSuccess: () => {
      invalidate()
      setLogOpen(false)
    }
  })

  const deleteContributionMutation = useMutation({
    mutationFn: (id: string) => deleteContribution(supabase, id),
    onSuccess: () => {
      invalidate()
      setPendingDeleteContribution(null)
    }
  })

  const remaining = goal.target_amount - goal.current_amount
  const percent = goal.target_amount > 0 ? (goal.current_amount / goal.target_amount) * 100 : 0
  const visible = expanded ? contributions : contributions.slice(0, VISIBLE_COUNT)

  return (
    <Card>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-text">{goal.name}</h3>
          {goal.notes && <p className="mt-1 text-sm text-text-muted">{goal.notes}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <button onClick={() => setEditOpen(true)} className="text-xs text-text-muted hover:text-text">
            Edit
          </button>
          <button
            onClick={() => setPendingDeleteGoal(true)}
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
          <StatTile label="Saved" value={goal.current_amount} />
          <StatTile label="Target" value={goal.target_amount} />
          <StatTile label="Remaining" value={remaining} tone="positive" />
        </div>
        <PercentRing percent={percent} />
      </div>

      <div className="mt-6">
        <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-muted">Transactions</h4>

        {contributions.length === 0 ? (
          <p className="text-sm text-text-muted">No transactions logged yet.</p>
        ) : (
          <div className="divide-y divide-border overflow-hidden rounded-lg bg-surface-raised">
            {visible.map((contribution) => (
              <div key={contribution.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm capitalize text-text">{contribution.type}</p>
                  <p className="text-xs text-text-muted">{contribution.contribution_date}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`text-sm font-semibold ${
                      contribution.type === 'deposit' ? 'text-positive' : 'text-negative'
                    }`}
                  >
                    {contribution.type === 'deposit' ? '+' : '-'}
                    {formatCurrency(contribution.amount)}
                  </span>
                  <button
                    onClick={() => setPendingDeleteContribution(contribution)}
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

        {contributions.length > VISIBLE_COUNT && (
          <button
            onClick={() => setExpanded((value) => !value)}
            className="mt-3 text-sm text-text-muted hover:text-text"
          >
            {expanded ? 'Show less' : `Show all ${contributions.length} transactions`}
          </button>
        )}
      </div>

      {editOpen && (
        <Modal title={`Edit ${goal.name}`} onClose={() => setEditOpen(false)}>
          <SavingsGoalForm initial={goal} onSubmit={(values) => updateMutation.mutateAsync(values)} />
        </Modal>
      )}

      {logOpen && (
        <Modal title="Log transaction" onClose={() => setLogOpen(false)}>
          <SavingsTransactionForm onSubmit={(values) => logMutation.mutateAsync(values)} />
        </Modal>
      )}

      {pendingDeleteGoal && (
        <ConfirmDialog
          title="Delete goal"
          message={`Delete "${goal.name}"? This also deletes its ${contributions.length} logged transaction${
            contributions.length === 1 ? '' : 's'
          }.`}
          onConfirm={() => deleteGoalMutation.mutate()}
          onCancel={() => setPendingDeleteGoal(false)}
        />
      )}

      {pendingDeleteContribution && (
        <ConfirmDialog
          title="Delete transaction"
          message={`Delete this ${pendingDeleteContribution.type}? This can't be undone.`}
          onConfirm={() => deleteContributionMutation.mutate(pendingDeleteContribution.id)}
          onCancel={() => setPendingDeleteContribution(null)}
        />
      )}
    </Card>
  )
}
