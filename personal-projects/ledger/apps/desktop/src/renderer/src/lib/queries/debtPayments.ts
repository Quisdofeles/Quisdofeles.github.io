import type { LedgerClient, DebtPaymentType } from '@ledger/shared'

export interface DebtPayment {
  id: string
  debt_id: string
  amount: number
  type: DebtPaymentType
  payment_date: string
}

export interface NewDebtPaymentInput {
  debt_id: string
  amount: number
  type: DebtPaymentType
  payment_date: string
}

// Keyed by userId for cache consistency, same reasoning as savingsContributionsKey.
export function debtPaymentsKey(userId: string) {
  return ['debt-payments', userId] as const
}

export async function fetchAllDebtPayments(supabase: LedgerClient): Promise<DebtPayment[]> {
  const { data, error } = await supabase
    .from('debt_payments')
    .select('id, debt_id, amount, type, payment_date')
    .order('payment_date', { ascending: false })

  if (error) throw error
  return data
}

export async function createDebtPayment(supabase: LedgerClient, input: NewDebtPaymentInput): Promise<void> {
  const { error } = await supabase.from('debt_payments').insert(input)
  if (error) throw error
}

export async function deleteDebtPayment(supabase: LedgerClient, id: string): Promise<void> {
  const { error } = await supabase.from('debt_payments').delete().eq('id', id)
  if (error) throw error
}
