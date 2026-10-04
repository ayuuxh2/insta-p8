import { type NextRequest, NextResponse } from "next/server"
import { agentUser, isAgentAuthorized, unauthorized } from "@/lib/agent"
import { normalizeTags } from "@/lib/contacts"

const str = (v: unknown, max = 1000) => (typeof v === "string" ? v.trim().slice(0, max) : "")
const strList = (v: unknown, max = 10) => (Array.isArray(v) ? v.map((x) => str(x, 300)).filter(Boolean).slice(0, max) : [])

// POST /api/agent/rules — creates the comment rule for a published post.
// { mediaId, name, keywords[], message, messageVariants?, link?, checkFollow?, publicReplies?, tags?,
//   optinTitle?, optinSubtitle?, optinButton?, replyMode? }
export async function POST(request: NextRequest) {
  if (!isAgentAuthorized(request)) return unauthorized()
  const body = await request.json().catch(() => ({}))

  const keywords = strList(body.keywords, 5).map((k) => k.toLowerCase().replace(/,/g, " "))
  const message = str(body.message, 950)
  const link = str(body.link, 500)
  if (!body.mediaId || !keywords.length || !message) {
    return NextResponse.json({ error: "Informe mediaId, keywords e message" }, { status: 400 })
  }
  if (link && !/^https?:\/\//i.test(link)) return NextResponse.json({ error: "Link inválido" }, { status: 400 })

  const { db, user } = await agentUser()
  if (!user) return NextResponse.json({ error: "Nenhuma conta do Instagram conectada" }, { status: 400 })

  // The link goes at the end of every message variation (tracked automatically when sent).
  const withLink = (text: string) => (link && !text.includes(link) ? `${text}\n\n👉 ${link}` : text)
  const replyMode = ["both", "dm_only", "public_only"].includes(body.replyMode) ? body.replyMode : "both"
  const content: Record<string, unknown> = {
    message: withLink(message),
    check_follow: body.checkFollow !== false,
    reply_mode: replyMode,
  }
  const variants = strList(body.messageVariants, 5).map(withLink)
  if (variants.length) content.message_variants = variants
  const publicReplies = strList(body.publicReplies, 8)
  if (publicReplies.length) content.public_replies = publicReplies
  const tags = normalizeTags(body.tags)
  if (tags.length) content.add_tags = tags
  for (const [key, field, max] of [["optinTitle", "optin_title", 80], ["optinSubtitle", "optin_subtitle", 80], ["optinButton", "optin_button", 20]] as const) {
    const value = str(body[key], max)
    if (value) content[field] = value
  }

  const { data, error } = await db
    .from("automations")
    .insert({
      user_id: user.id,
      name: str(body.name, 120) || `Post: ${keywords[0]}`,
      trigger_source: "comment",
      trigger_type: "keyword",
      trigger_value: keywords.join(", "),
      response_type: "pro",
      response_content: content,
      is_active: true,
      specific_media_id: String(body.mediaId),
    })
    .select("id, name, trigger_value, specific_media_id")
    .single()
  if (error) return NextResponse.json({ error: `Não foi possível criar a regra: ${error.message}` }, { status: 500 })
  return NextResponse.json({ ok: true, rule: data })
}
