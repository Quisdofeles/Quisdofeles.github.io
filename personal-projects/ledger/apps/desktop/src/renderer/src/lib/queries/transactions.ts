import type { LedgerClient, TransactionType } from '@ledger/shared'
import { addMonths, toDateOnlyString } from '../date'

export interface TransactionWithCategory {
  id: string
  amount: number
  type: TransactionType
  transaction_date: string
  note: string | null
  category_id: string | null
  categories: { name: string; color: string } | null
}

export interface NewTransactionInput {
  user_id: string
  category_id: string | null
  amount: number
  type: TransactionType
  transaction_date: string
  note: string | null
}

export function monthTransactionsKeyPrefix(userId: string) {
  return ['month-transactions', userId] as const
}

export function monthTransactionsKey(userId: string, monthStart: Date) {
  return [
    ...monthTransactionsKeyPrefix(userId),
    monthStart.getFullYear(),
    monthStart.getMonth()
  ] as const
}

export async function fetchMonthTransactions(
  supabase: LedgerClient,
  userId: string,
  monthStart: Date
): Promise<TransactionWithCategory[]> {
  const monthEnd = addMonths(monthStart, 1)

  const { data, error } = await supabase
    .from('transactions')
    .select('id, amount, type, transaction_date, note, category_id, categories(name, color)')
    .eq('user_id', userId)
    .gte('transaction_date', toDateOnlyString(monthStart))
    .lt('transaction_date', toDateOnlyString(monthEnd))
    .order('transaction_date', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) throw error
  return data
}

export async function createTransaction(
  supabase: LedgerClient,
  input: NewTransactionInput
): Promise<void> {
  const { error } = await supabase.from('transactions').insert(input)
  if (error) throw error
}

export async function deleteTransaction(supabase: LedgerClient, id: string): Promise<void> {
  const { error } = await supabase.from('transactions').delete().eq('id', id)
  if (error) throw error
}
