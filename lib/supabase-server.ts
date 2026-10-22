import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { createMockSupabaseClient } from "./supabase-store"

/**
 * Create a Supabase server client
 * Use this in API routes and server actions.
 * Falls back to in-memory store when Supabase environment variables are not set or during local development.
 */
export async function getSupabaseServerClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key || !url.startsWith("http")) {
    return createMockSupabaseClient() as any
  }

  try {
    const cookieStore = await cookies()

    return createServerClient(url, key, {
      cookies: {
        getAll: async () => cookieStore.getAll(),
        setAll: async (cookiesToSet) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
          } catch (error) {
            console.error("[supabase-server] Error setting cookies:", error)
          }
        },
      },
    })
  } catch (err) {
    console.warn("[supabase-server] Failed to initialize Supabase client, using in-memory store:", err)
    return createMockSupabaseClient() as any
  }
}
