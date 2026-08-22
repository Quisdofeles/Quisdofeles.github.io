import { createLedgerClient } from '@ledger/shared'

export const supabase = createLedgerClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)
