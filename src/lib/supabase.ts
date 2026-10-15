import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/** True, pokud jsou nastavené veřejné proměnné Supabase (viz .env.example). */
export const isSupabaseConfigured = Boolean(url && anonKey)

// Klient používá jen veřejný anon klíč. Service role klíč nesmí být nikdy v klientu.
export const supabase = createClient<Database>(
  url ?? 'http://localhost:54321',
  anonKey ?? 'missing-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      // Implicit flow: odkaz z e-mailu funguje i při otevření v jiném prohlížeči než ten,
      // ve kterém se přihlašování spustilo (u mobilů běžné: mail app otevře vlastní prohlížeč).
      flowType: 'implicit',
    },
  },
)
