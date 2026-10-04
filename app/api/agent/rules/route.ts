import { type NextRequest, NextResponse } from "next/server"
import { agentUser, isAgentAuthorized, unauthorized } from "@/lib/agent"
import { createPostRule, ruleProblem } from "@/lib/publishing"

// POST /api/agent/rules — creates the comment rule for a published post.
// { mediaId, name, keywords[], message, messageVariants?, link?, checkFollow?, publicReplies?, tags?,
//   optinTitle?, optinSubtitle?, optinButton?, replyMode?, anyComment?, source? }
// anyComment: true answers every comment on the post (keywords become optional).
// source: "story" makes it answer replies to that Story instead of comments.
export async function POST(request: NextRequest) {
  if (!isAgentAuthorized(request)) return unauthorized()
  const body = await request.json().catch(() => ({}))
  const problem = !body.mediaId ? "Informe mediaId" : ruleProblem(body)
  if (problem) return NextResponse.json({ error: problem }, { status: 400 })

  const { db, user } = await agentUser()
  if (!user) return NextResponse.json({ error: "Nenhuma conta do Instagram conectada" }, { status: 400 })

  try {
    const rule = await createPostRule(db, user.id, String(body.mediaId), body, body.source === "story" ? "story" : "comment")
    return NextResponse.json({ ok: true, rule })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 })
  }
}
