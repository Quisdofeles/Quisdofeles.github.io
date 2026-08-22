import type { LedgerClient, BillingFrequency } from '@ledger/shared'

export interface Subscription {
  id: string
  user_id: string
  category_id: string | null
  name: string
  amount: number
  billing_frequency: BillingFrequency
  next_charge_date: string
  is_active: boolean
}

export interface NewSubscriptionInput {
  user_id: string
  category_id: string | null
  name: string
  amount: number
  billing_frequency: BillingFrequency
  next_charge_date: string
}

export function subscriptionsKey(userId: string) {
  return ['subscriptions', userId] as const
}

export async function fetchSubscriptions(
  supabase: LedgerClient,
  userId: string
): Promise<Subscription[]> {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('id, user_id, category_id, name, amount, billing_frequency, next_charge_date, is_active')
    .eq('user_id', userId)
    .order('next_charge_date', { ascending: true })

  if (error) throw error
  return data
}

export async function createSubscription(
  supabase: LedgerClient,
  input: NewSubscriptionInput
): Promise<void> {
  const { error } = await supabase.from('subscriptions').insert(input)
  if (error) throw error
}

export async function deleteSubscription(supabase: LedgerClient, id: string): Promise<void> {
  const { error } = await supabase.from('subscriptions').delete().eq('id', id)
  if (error) throw error
}
