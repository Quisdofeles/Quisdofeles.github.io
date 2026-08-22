import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

export type LedgerClient = SupabaseClient<Database>

// URL/key are passed in rather than read from env here, because Electron
// (Vite's import.meta.env) and React Native (its own env tooling) load
// config differently. Each app owns reading its own env vars and calls
// this factory once at startup.
export function createLedgerClient(url: string, anonKey: string): LedgerClient {
  return createClient<Database>(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  })
}
