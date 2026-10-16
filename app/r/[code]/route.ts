import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { recordEvent } from "@/lib/contacts"

// Link-preview crawlers (Instagram/Facebook fetch every URL sent in a DM) must not count as clicks.
const BOT_UA = /facebookexternalhit|facebot|meta-externalagent|bot|crawler|spider|preview|slurp/i
const FILE_URL_TTL_SECONDS = 600

function notFound() {
  return new NextResponse(
    "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width'><title>Link indisponível</title>" +
      "<body style='font-family:system-ui;padding:40px;text-align:center'><h1 style='font-size:20px'>Link indisponível</h1>" +
      "<p>Este link expirou ou não existe mais. Peça um novo pelo direct da @cee_webstore.</p></body>",
    { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } },
  )
}

// GET /r/<code> — counts the click and redirects to the URL or to a short-lived file URL.
export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  if (!/^[A-Za-z0-9]{6,16}$/.test(code)) return notFound()

  const db = await getSupabaseServerClient()
  const { data: link } = await db
    .from("tracked_links")
    .select("code, user_id, automation_id, ig_id, target_url, file_id, files(storage_path, name)")
    .eq("code", code)
    .maybeSingle()
  if (!link) return notFound()

  let destination: string | null = null
  if (link.file_id) {
    const file: any = Array.isArray(link.files) ? link.files[0] : link.files
    if (!file?.storage_path) return notFound()
    // Opened inline (PDFs and images display in Instagram's in-app browser; forced downloads often fail there).
    const { data } = await db.storage.from("arquivos").createSignedUrl(file.storage_path, FILE_URL_TTL_SECONDS)
    destination = data?.signedUrl || null
  } else if (link.target_url && /^https?:\/\//i.test(link.target_url)) {
    destination = link.target_url
  }
  if (!destination) return notFound()

  const isBot = BOT_UA.test(request.headers.get("user-agent") || "")
  if (!isBot) {
    await db.rpc("register_link_click", { p_code: code })
    if (link.ig_id) {
      await recordEvent(db, link.user_id, link.ig_id, "link_click", { automationId: link.automation_id })
    }
  }

  return NextResponse.redirect(destination, { status: 302, headers: { "Cache-Control": "no-store" } })
}
