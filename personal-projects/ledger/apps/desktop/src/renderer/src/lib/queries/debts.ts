import type { LedgerClient } from '@ledger/shared'

export interface Debt {
  id: string
  user_id: string
  name: string
  notes: string | null
  original_amount: number
  current_balance: number
}

export interface NewDebtInput {
  user_id: string
  name: string
  notes: string | null
  original_amount: number
}

export interface UpdateDebtInput {
  name?: string
  notes?: string | null
  original_amount?: number
}

export function debtsKey(userId: string) {
  return ['debts', userId] as const
}

export async function fetchDebts(supabase: LedgerClient, userId: string): Promise<Debt[]> {
  const { data, error } = await supabase
    .from('debts')
    .select('id, user_id, name, notes, original_amount, current_balance')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return data
}

export async function createDebt(supabase: LedgerClient, input: NewDebtInput): Promise<void> {
  const { error } = await supabase.from('debts').insert(input)
  if (error) throw error
}

export async function updateDebt(supabase: LedgerClient, id: string, input: UpdateDebtInput): Promise<void> {
  const { error } = await supabase.from('debts').update(input).eq('id', id)
  if (error) throw error
}

export async function deleteDebt(supabase: LedgerClient, id: string): Promise<void> {
  const { error } = await supabase.from('debts').delete().eq('id', id)
  if (error) throw error
}
