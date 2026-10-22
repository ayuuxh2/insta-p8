import { createClient, SupabaseClient } from "@supabase/supabase-js"
import { createMockSupabaseClient } from "./supabase-store"

let _admin: SupabaseClient | null = null

/**
 * Service-role Supabase client — bypasses RLS.
 * Used for: schema migrations, server-side background work, unlock-attempt tracking.
 * Falls back to in-memory store when Supabase environment variables are not configured.
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (_admin) return _admin
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key || !url.startsWith("http")) {
    return createMockSupabaseClient() as unknown as SupabaseClient
  }

  try {
    _admin = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    return _admin
  } catch (err) {
    console.warn("[supabase-admin] Failed to initialize Supabase client, using in-memory store:", err)
    return createMockSupabaseClient() as unknown as SupabaseClient
  }
}
