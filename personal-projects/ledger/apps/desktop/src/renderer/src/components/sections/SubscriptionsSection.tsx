import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import { formatCurrency } from '../../lib/format'
import { Card } from '../Card'
import { ConfirmDialog } from '../ConfirmDialog'
import { Modal } from '../Modal'
import { SubscriptionForm, type SubscriptionFormValues } from '../forms/SubscriptionForm'
import {
  createSubscription,
  deleteSubscription,
  subscriptionsKey,
  type Subscription
} from '../../lib/queries/subscriptions'

interface SubscriptionsSectionProps {
  userId: string
  subscriptions: Subscription[]
}

const MS_PER_DAY = 1000 * 60 * 60 * 24
const VISIBLE_COUNT = 5

function daysUntil(dateString: string): number {
  const target = new Date(dateString + 'T00:00:00')
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - now.getTime()) / MS_PER_DAY)
}

export function SubscriptionsSection({ userId, subscriptions }: SubscriptionsSectionProps) {
  const [modalOpen, setModalOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<Subscription | null>(null)
  const queryClient = useQueryClient()
  const queryKey = subscriptionsKey(userId)

  const createMutation = useMutation({
    mutationFn: (values: SubscriptionFormValues) =>
      createSubscription(supabase, {
        user_id: userId,
        category_id: null,
        name: values.name,
        amount: values.amount,
        billing_frequency: values.billingFrequency,
        next_charge_date: values.nextChargeDate
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey })
      setModalOpen(false)
    }
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteSubscription(supabase, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey })
      setPendingDelete(null)
    }
  })

  return (
    <Card>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight text-text">Subscriptions</h2>
        <button
          onClick={() => setModalOpen(true)}
          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-bg transition hover:bg-accent-strong"
        >
          + Add subscription
        </button>
      </div>

      {subscriptions.length === 0 ? (
        <p className="text-sm text-text-muted">No subscriptions yet.</p>
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-lg bg-surface-raised">
          {(expanded ? subscriptions : subscriptions.slice(0, VISIBLE_COUNT)).map((subscription) => {
            const remaining = daysUntil(subscription.next_charge_date)
            const dueSoon = remaining <= 7

            return (
              <div key={subscription.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm text-text">{subscription.name}</p>
                  <p className="text-xs capitalize text-text-muted">{subscription.billing_frequency}</p>
                </div>
                <div className="flex items-center gap-4">
                  <span className={`text-xs ${dueSoon ? 'text-accent' : 'text-text-muted'}`}>
                    {remaining < 0
                      ? 'Overdue'
                      : remaining === 0
                        ? 'Charges today'
                        : `In ${remaining} day${remaining === 1 ? '' : 's'}`}{' '}
                    · {subscription.next_charge_date}
                  </span>
                  <span className="text-sm font-semibold text-text">
                    {formatCurrency(subscription.amount)}
                  </span>
                  <button
                    onClick={() => setPendingDelete(subscription)}
                    className="text-text-muted hover:text-negative"
                    aria-label="Delete subscription"
                  >
                    ✕
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {subscriptions.length > VISIBLE_COUNT && (
        <button
          onClick={() => setExpanded((value) => !value)}
          className="mt-3 text-sm text-text-muted hover:text-text"
        >
          {expanded ? 'Show less' : `Show all ${subscriptions.length} subscriptions`}
        </button>
      )}

      {modalOpen && (
        <Modal title="Add subscription" onClose={() => setModalOpen(false)}>
          <SubscriptionForm onSubmit={(values) => createMutation.mutateAsync(values)} />
        </Modal>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete subscription"
          message={`Delete "${pendingDelete.name}"?`}
          onConfirm={() => deleteMutation.mutate(pendingDelete.id)}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </Card>
  )
}
