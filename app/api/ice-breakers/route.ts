import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { requireUser } from "@/lib/api-auth"
import { redactSecrets } from "@/lib/redact"

/** Meta caps the ice-breaker list at 4 and the question at 80 characters. */
const MAX_ICE_BREAKERS = 4
const MAX_QUESTION_LENGTH = 80
const MAX_RESPONSE_LENGTH = 1000

const MESSENGER_PROFILE_URL = "https://graph.instagram.com/v24.0/me/messenger_profile"

interface IceBreakerRow {
  question: string
  response: string
}

/**
 * Validate the incoming list and normalise it to stored rows.
 *
 * Returns `{ error }` (a message the client can display) or `{ rows }` with
 * trimmed values. Kept as a pure function so the same rules apply to every
 * entry and are easy to unit-test.
 */
function validateIceBreakers(input: unknown[]): { error: string } | { rows: IceBreakerRow[] } {
  if (input.length > MAX_ICE_BREAKERS) {
    return { error: `Instagram allows at most ${MAX_ICE_BREAKERS} ice breakers` }
  }

  const rows: IceBreakerRow[] = []
  for (let i = 0; i < input.length; i++) {
    const entry = input[i] as { question?: unknown; response?: unknown } | null | undefined
    const question = typeof entry?.question === "string" ? entry.question.trim() : ""
    const response = typeof entry?.response === "string" ? entry.response.trim() : ""
    const n = i + 1

    if (!question || !response) {
      return { error: `Ice breaker ${n} needs both a question and a response` }
    }
    if (question.length > MAX_QUESTION_LENGTH) {
      return { error: `Ice breaker ${n} question must be ${MAX_QUESTION_LENGTH} characters or fewer` }
    }
    if (response.length > MAX_RESPONSE_LENGTH) {
      return { error: `Ice breaker ${n} response must be ${MAX_RESPONSE_LENGTH} characters or fewer` }
    }
    rows.push({ question, response })
  }
  return { rows }
}

/**
 * Push the current ice-breaker set to Instagram.
 *
 * Meta's contract (Instagram API with Instagram Login -> Ice Breakers):
 *   * a non-empty set is a POST whose `ice_breakers` value is an array holding
 *     ONE object with a `call_to_actions` array of `{ question, payload }` —
 *     not a flat list of questions;
 *   * removing every ice breaker is a DELETE of the `ice_breakers` field, since
 *     POSTing an empty array does not clear them.
 *
 * Returns Meta's own success flag; the caller decides the HTTP status. Never
 * logs the access token — only Meta's error code/message.
 */
async function syncIceBreakers(token: string, rows: Array<{ id: string; question: string }>): Promise<{ ok: boolean }> {
  const url = `${MESSENGER_PROFILE_URL}?access_token=${encodeURIComponent(token)}`

  const request =
    rows.length === 0
      ? {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fields: ["ice_breakers"] }),
        }
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            platform: "instagram",
            ice_breakers: [
              {
                // The payload must be the stored row id: the webhook resolves an
                // ICE_BREAKER_* postback back to its row by that id.
                call_to_actions: rows.map((row) => ({ question: row.question, payload: `ICE_BREAKER_${row.id}` })),
              },
            ],
          }),
        }

  const response = await fetch(url, request)
  const result = await response.json().catch(() => null)
  const meta = result?.error

  if (!response.ok || meta) {
    // Rows are saved locally, but the feature users actually see is NOT live.
    // Reporting success here is what made this look like it worked.
    console.error(
      `[ice-breakers] Instagram sync failed: HTTP ${response.status}` +
        (meta ? ` type=${meta.type ?? "-"} code=${meta.code ?? "-"} message=${redactSecrets(meta.message ?? "-")}` : ""),
    )
    return { ok: false }
  }
  return { ok: true }
}

export async function GET(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get("userId")
    if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 })

    const denied = requireUser(request, userId)
    if (denied) return denied

    const supabase = await getSupabaseServerClient()
    const { data, error } = await supabase
      .from("ice_breakers")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })

    if (error) throw error
    return NextResponse.json(data)
  } catch (error) {
    console.error("[ice-breakers] GET error:", redactSecrets(error))
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId, iceBreakers } = await request.json()
    if (!userId || !Array.isArray(iceBreakers)) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
    }

    const denied = requireUser(request, userId)
    if (denied) return denied

    const validated = validateIceBreakers(iceBreakers)
    if ("error" in validated) return NextResponse.json({ error: validated.error }, { status: 400 })
    const rows = validated.rows

    const supabase = await getSupabaseServerClient()

    // 1. Replace the user's rows (Instagram caps the list at 4).
    const { error: deleteError } = await supabase.from("ice_breakers").delete().eq("user_id", userId)
    if (deleteError) throw deleteError

    let inserted: any[] = []
    if (rows.length > 0) {
      const { data, error: insertError } = await supabase
        .from("ice_breakers")
        .insert(rows.map((row) => ({ user_id: userId, question: row.question, response: row.response, is_active: true })))
        .select()
      if (insertError) throw insertError
      inserted = data ?? []
    }

    // 2. Sync to Instagram — this is what actually makes them visible to users.
    const { data: user } = await supabase.from("users").select("access_token").eq("id", userId).single()
    if (!user?.access_token) {
      return NextResponse.json({ error: "Instagram is not connected for this account" }, { status: 409 })
    }

    const synced = await syncIceBreakers(
      user.access_token,
      inserted.map((row: any) => ({ id: String(row.id), question: row.question })),
    )
    if (!synced.ok) {
      return NextResponse.json(
        {
          error:
            rows.length === 0
              ? "Removed locally, but Instagram rejected the update — your ice breakers may still be live."
              : "Saved locally, but Instagram rejected the sync — your ice breakers are not live yet.",
          savedLocally: true,
        },
        { status: 502 },
      )
    }

    // The database and Instagram now agree.
    return NextResponse.json({ success: true, synced: true, data: inserted })
  } catch (error) {
    console.error("[ice-breakers] POST error:", redactSecrets(error))
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
