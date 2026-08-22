import type { LedgerClient, SavingsGoalType } from '@ledger/shared'

export interface SavingsGoal {
  id: string
  user_id: string
  name: string
  notes: string | null
  goal_type: SavingsGoalType
  target_amount: number
  current_amount: number
}

export interface NewSavingsGoalInput {
  user_id: string
  name: string
  notes: string | null
  target_amount: number
}

export interface UpdateSavingsGoalInput {
  name?: string
  notes?: string | null
  target_amount?: number
}

export function savingsGoalsKey(userId: string) {
  return ['savings-goals', userId] as const
}

export async function fetchSavingsGoals(supabase: LedgerClient, userId: string): Promise<SavingsGoal[]> {
  const { data, error } = await supabase
    .from('savings_goals')
    .select('id, user_id, name, notes, goal_type, target_amount, current_amount')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return data
}

export async function createSavingsGoal(supabase: LedgerClient, input: NewSavingsGoalInput): Promise<void> {
  const { error } = await supabase.from('savings_goals').insert(input)
  if (error) throw error
}

export async function updateSavingsGoal(
  supabase: LedgerClient,
  id: string,
  input: UpdateSavingsGoalInput
): Promise<void> {
  const { error } = await supabase.from('savings_goals').update(input).eq('id', id)
  if (error) throw error
}

export async function deleteSavingsGoal(supabase: LedgerClient, id: string): Promise<void> {
  const { error } = await supabase.from('savings_goals').delete().eq('id', id)
  if (error) throw error
}
