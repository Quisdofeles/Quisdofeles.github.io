import type { LedgerClient, SavingsContributionType } from '@ledger/shared'

export interface SavingsContribution {
  id: string
  savings_goal_id: string
  amount: number
  type: SavingsContributionType
  contribution_date: string
}

export interface NewSavingsContributionInput {
  savings_goal_id: string
  amount: number
  type: SavingsContributionType
  contribution_date: string
}

// Keyed by userId (even though the fetch itself is scoped by RLS via the
// parent goal's ownership, not a user_id column here) so cache invalidation
// stays consistent with every other query key in the app.
export function savingsContributionsKey(userId: string) {
  return ['savings-contributions', userId] as const
}

export async function fetchAllContributions(supabase: LedgerClient): Promise<SavingsContribution[]> {
  const { data, error } = await supabase
    .from('savings_contributions')
    .select('id, savings_goal_id, amount, type, contribution_date')
    .order('contribution_date', { ascending: false })

  if (error) throw error
  return data
}

export async function createContribution(
  supabase: LedgerClient,
  input: NewSavingsContributionInput
): Promise<void> {
  const { error } = await supabase.from('savings_contributions').insert(input)
  if (error) throw error
}

export async function deleteContribution(supabase: LedgerClient, id: string): Promise<void> {
  const { error } = await supabase.from('savings_contributions').delete().eq('id', id)
  if (error) throw error
}
