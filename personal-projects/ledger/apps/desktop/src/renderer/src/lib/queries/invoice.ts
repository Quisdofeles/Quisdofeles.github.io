import type { LedgerClient } from '@ledger/shared'

export async function sendMonthlyInvoice(supabase: LedgerClient, month: Date): Promise<void> {
  const { error } = await supabase.functions.invoke('send-monthly-invoice', {
    body: { year: month.getFullYear(), month: month.getMonth() }
  })

  if (error) throw error
}
