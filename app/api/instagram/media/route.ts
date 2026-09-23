import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { requireUser } from "@/lib/api-auth"

// ============================================================
// Instagram media fetch (/me/media)
//
// One place describes the request so diagnostics can never drift:
//   host:    graph.instagram.com   (Instagram API with Instagram Login)
//   version: v24.0
//   path:    /me/media             (/me = the account the token belongs to)
//   token:   Instagram User access token, stored by the OAuth callback
//   fields:  id,caption,media_type,media_url,thumbnail_url,permalink,timestamp
// ============================================================
const IG_MEDIA_HOST = "graph.instagram.com"
const IG_API_VERSION = "v24.0"
const IG_MEDIA_FIELDS = "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp"
const IG_MEDIA_LIMIT = 24

/**
 * Normalized media-fetch error.
 *
 * A raw Meta failure must never surface as an opaque "Server Error", and the
 * dashboard must be able to tell "temporarily busy" apart from "reconnect your
 * account" apart from "Meta has blocked this app". `requiresReauthorization` is
 * true only when the evidence (token code 190) actually points at authorization.
 */
interface InstagramMediaError {
  type:
    | "INSTAGRAM_MEDIA_ACCESS_BLOCKED"
    | "INSTAGRAM_MEDIA_SESSION_EXPIRED"
    | "INSTAGRAM_MEDIA_PERMISSION"
    | "INSTAGRAM_MEDIA_RATE_LIMITED"
    | "INSTAGRAM_MEDIA_UNAVAILABLE"
    | "INSTAGRAM_MEDIA_ERROR"
  code: number | null
  subcode: number | null
  message: string
  retryable: boolean
  requiresReauthorization: boolean
}

function normalizeInstagramMediaError(meta: any, httpStatus: number): InstagramMediaError {
  const code = typeof meta?.code === "number" ? meta.code : null
  const subcode = typeof meta?.error_subcode === "number" ? meta.error_subcode : null

  // code 200 "API access blocked." — Meta refuses this app/account's access.
  // The request is well-formed; retrying or re-logging-in does not fix it.
  if (code === 200) {
    return {
      type: "INSTAGRAM_MEDIA_ACCESS_BLOCKED",
      code,
      subcode,
      message:
        "Instagram blocked API access for this app/account. Verify the Meta app is Live with approved Instagram permissions for this account.",
      retryable: false,
      requiresReauthorization: false,
    }
  }

  // code 190 = expired/invalid token — the one case that genuinely needs re-login.
  if (code === 190) {
    return {
      type: "INSTAGRAM_MEDIA_SESSION_EXPIRED",
      code,
      subcode,
      message: "Instagram session expired. Please reconnect your Instagram account.",
      retryable: false,
      requiresReauthorization: true,
    }
  }

  // code 10 / subcode 458 (app not installed) = permission problem.
  if (code === 10 || subcode === 458) {
    return {
      type: "INSTAGRAM_MEDIA_PERMISSION",
      code,
      subcode,
      message:
        "This app lacks permission to read the Instagram account's media. Confirm the Instagram permissions are approved.",
      retryable: false,
      requiresReauthorization: false,
    }
  }

  // Rate limiting.
  if (code === 4 || code === 17 || code === 32 || code === 613) {
    return {
      type: "INSTAGRAM_MEDIA_RATE_LIMITED",
      code,
      subcode,
      message: "Instagram is rate-limiting this app. Try again shortly.",
      retryable: true,
      requiresReauthorization: false,
    }
  }

  // Graph-side 5xx or a response with no Meta error body.
  if (httpStatus >= 500) {
    return {
      type: "INSTAGRAM_MEDIA_UNAVAILABLE",
      code,
      subcode,
      message: "Instagram is temporarily unavailable. Try again shortly.",
      retryable: true,
      requiresReauthorization: false,
    }
  }

  return {
    type: "INSTAGRAM_MEDIA_ERROR",
    code,
    subcode,
    message:
      typeof meta?.message === "string" && meta.message
        ? meta.message
        : "Failed to load Instagram media.",
    retryable: false,
    requiresReauthorization: false,
  }
}

function statusForMediaError(error: InstagramMediaError): number {
  if (error.type === "INSTAGRAM_MEDIA_SESSION_EXPIRED") return 401
  if (error.type === "INSTAGRAM_MEDIA_ACCESS_BLOCKED" || error.type === "INSTAGRAM_MEDIA_PERMISSION") return 403
  if (error.type === "INSTAGRAM_MEDIA_RATE_LIMITED") return 429
  if (error.type === "INSTAGRAM_MEDIA_UNAVAILABLE") return 503
  return 500
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const userId = searchParams.get("userId")

    if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 })

    const denied = requireUser(request, userId)
    if (denied) return denied

    const supabase = await getSupabaseServerClient()

    // 1. Get Access Token
    const { data: user } = await supabase
      .from("users")
      .select("access_token")
      .eq("id", userId)
      .single()

    if (!user?.access_token) {
      return NextResponse.json({ error: "Instagram not connected" }, { status: 401 })
    }

    // 2. Fetch the connected account's media. `/me` means the token's own
    // account, so no arbitrary/foreign media ID is ever requested.
    const url =
      `https://${IG_MEDIA_HOST}/${IG_API_VERSION}/me/media` +
      `?fields=${IG_MEDIA_FIELDS}&limit=${IG_MEDIA_LIMIT}` +
      `&access_token=${encodeURIComponent(user.access_token)}`

    // Safe diagnostics only — NEVER the URL (it carries the access token).
    console.log(`[instagram/media] endpoint=${IG_MEDIA_HOST}/${IG_API_VERSION}/me/media`)
    console.log(`[instagram/media] apiVersion=${IG_API_VERSION}`)
    console.log(`[instagram/media] objectId=me`)
    console.log(`[instagram/media] tokenType=Instagram User`)

    const res = await fetch(url, { cache: "no-store" })
    const data = await res.json().catch(() => null)
    const meta = data?.error ?? null

    if (!res.ok || meta) {
      // Meta's error object carries no token material. Log only the fields that
      // matter — error_subcode can pinpoint the exact authorization failure.
      console.error("[instagram/media] fetch failed", {
        httpStatus: res.status,
        message: meta?.message ?? null,
        type: meta?.type ?? null,
        code: meta?.code ?? null,
        error_subcode: meta?.error_subcode ?? null,
        fbtrace_id: meta?.fbtrace_id ?? null,
      })
      // The WWW-Authenticate *challenge* (a response header, never request
      // credentials) says "access_denied" when Meta blocks the app.
      const challenge = res.headers?.get?.("www-authenticate")
      if (challenge) console.error(`[instagram/media] www-authenticate=${challenge}`)

      const normalized = normalizeInstagramMediaError(meta, res.status)
      return NextResponse.json(
        {
          error: normalized.message,
          normalized: {
            type: normalized.type,
            code: normalized.code,
            subcode: normalized.subcode,
            message: normalized.message,
            retryable: normalized.retryable,
            requiresReauthorization: normalized.requiresReauthorization,
          },
        },
        { status: statusForMediaError(normalized) },
      )
    }

    // Normalize: pick thumbnail_url for videos, media_url for images.
    // Skips items with neither URL so we never return the broken `image_url: null` shape.
    const normalized = (data?.data || [])
      .map((m: any) => ({
        ...m,
        image_url: m.thumbnail_url || m.media_url || null,
      }))
      .filter((m: any) => typeof m.image_url === "string" && m.image_url.length > 0)

    return NextResponse.json({ data: normalized })
  } catch (error) {
    console.error("[instagram/media] Server Error:", error instanceof Error ? error.message : error)
    return NextResponse.json({ error: "Server Error" }, { status: 500 })
  }
}
