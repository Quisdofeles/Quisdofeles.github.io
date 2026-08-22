import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient'
import { Modal } from '../components/Modal'
import { SavingsGoalCard } from '../components/SavingsGoalCard'
import { SavingsGoalForm, type SavingsGoalFormValues } from '../components/forms/SavingsGoalForm'
import { savingsGoalsKey, fetchSavingsGoals, createSavingsGoal } from '../lib/queries/savingsGoals'
import { savingsContributionsKey, fetchAllContributions } from '../lib/queries/savingsContributions'

interface SavingsPageProps {
  userId: string
}

export function SavingsPage({ userId }: SavingsPageProps) {
  const [addOpen, setAddOpen] = useState(false)
  const queryClient = useQueryClient()

  const goalsQuery = useQuery({
    queryKey: savingsGoalsKey(userId),
    queryFn: () => fetchSavingsGoals(supabase, userId)
  })

  const contributionsQuery = useQuery({
    queryKey: savingsContributionsKey(userId),
    queryFn: () => fetchAllContributions(supabase)
  })

  const goals = goalsQuery.data ?? []
  const contributions = contributionsQuery.data ?? []

  const contributionsByGoal = useMemo(() => {
    const map = new Map<string, typeof contributions>()
    for (const contribution of contributions) {
      const list = map.get(contribution.savings_goal_id) ?? []
      list.push(contribution)
      map.set(contribution.savings_goal_id, list)
    }
    return map
  }, [contributions])

  const createMutation = useMutation({
    mutationFn: (values: SavingsGoalFormValues) =>
      createSavingsGoal(supabase, {
        user_id: userId,
        name: values.name,
        notes: values.notes,
        target_amount: values.targetAmount
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: savingsGoalsKey(userId) })
      setAddOpen(false)
    }
  })

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-8 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight text-text">Savings</h1>
        <button
          onClick={() => setAddOpen(true)}
          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-bg transition hover:bg-accent-strong"
        >
          + Add goal
        </button>
      </div>

      {goalsQuery.error && (
        <p className="text-sm text-negative">
          Couldn't load savings goals: {(goalsQuery.error as Error).message}
        </p>
      )}

      {goals.length === 0 ? (
        <p className="text-sm text-text-muted">
          No savings goals yet. Add one to start tracking progress toward it.
        </p>
      ) : (
        <div className="space-y-6">
          {goals.map((goal) => (
            <SavingsGoalCard
              key={goal.id}
              userId={userId}
              goal={goal}
              contributions={contributionsByGoal.get(goal.id) ?? []}
            />
          ))}
        </div>
      )}

      {addOpen && (
        <Modal title="Add goal" onClose={() => setAddOpen(false)}>
          <SavingsGoalForm onSubmit={(values) => createMutation.mutateAsync(values)} />
        </Modal>
      )}
    </div>
  )
}
