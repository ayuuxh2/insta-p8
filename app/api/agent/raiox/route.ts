import { randomUUID } from "crypto"
import { type NextRequest, NextResponse } from "next/server"
import { agentUser, isAgentAuthorized, unauthorized } from "@/lib/agent"
import { FILES_BUCKET } from "@/lib/files"
import { createTrackedLink } from "@/lib/links"
import { sendTextDM } from "@/lib/instagram-api"
import { recordEvent, addTags } from "@/lib/contacts"
import { sendAlert } from "@/lib/notify"

// Queue of Raio-X requests created by the "raiox" conversation flow (lib/flows.ts, table lead_flows).
//   GET  /api/agent/raiox                         → claims the oldest pending request (or { request: null })
//   POST { action: "upload-url", id }             → signed URL to upload the PDF (and cover) of a claimed request
//   POST { action: "deliver", id, pdf_path, ... } → sends the PDF link in the lead's Direct and closes the request
//   POST { action: "fail", id, error }            → gives up (the owner gets an alert)
// Instagram only allows a message to a person within 24h of their last message, so older requests are not delivered.

const WINDOW_MS = 23 * 3_600_000
const STALE_CLAIM_MS = 45 * 60_000
const MAX_ATTEMPTS = 3

const one = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max)

export async function GET(request: NextRequest) {
  if (!isAgentAuthorized(request)) return unauthorized()
  const { db, user } = await agentUser(request)
  if (!user) return NextResponse.json({ error: "Conta não encontrada" }, { status: 400 })

  // A worker that died mid-analysis leaves the request "analisando": put it back in the queue (limited tries).
  const stale = new Date(Date.now() - STALE_CLAIM_MS).toISOString()
  await db.from("lead_flows").update({ status: "pedido", updated_at: new Date().toISOString() })
    .eq("user_id", user.id).eq("status", "analisando").lt("claimed_at", stale).lt("attempts", MAX_ATTEMPTS)

  // Expired or exhausted requests can no longer be delivered in the Direct.
  const limit = new Date(Date.now() - WINDOW_MS).toISOString()
  const { data: dead } = await db.from("lead_flows").select("id, username")
    .eq("user_id", user.id).in("status", ["pedido", "analisando"]).or(`last_inbound_at.lt.${limit},attempts.gte.${MAX_ATTEMPTS}`)
  for (const d of dead || []) {
    await db.from("lead_flows").update({ status: "falhou", last_error: "Passou de 23h sem entrega (ou tentativas esgotadas)", updated_at: new Date().toISOString() }).eq("id", d.id)
    await sendAlert(db, `raiox-expirou:${d.id}`, "Raio-X não entregue", `@${d.username || "?"}: a janela de 24h do Direct passou. Mande o PDF por outro caminho.`)
  }

  const { data: rows } = await db.from("lead_flows").select("*")
    .eq("user_id", user.id).eq("flow", "raiox").eq("status", "pedido").order("requested_at", { ascending: true }).limit(1)
  const row = rows?.[0]
  if (!row) return NextResponse.json({ request: null })

  const { data: claimed } = await db.from("lead_flows")
    .update({ status: "analisando", claimed_at: new Date().toISOString(), attempts: row.attempts + 1, updated_at: new Date().toISOString() })
    .eq("id", row.id).eq("status", "pedido").select("id")
  if (!claimed?.length) return NextResponse.json({ request: null })

  return NextResponse.json({
    request: {
      id: row.id,
      username: row.username,
      answers: row.answers,
      requested_at: row.requested_at,
      deliver_before: new Date(new Date(row.last_inbound_at).getTime() + WINDOW_MS).toISOString(),
      attempt: row.attempts + 1,
    },
  })
}

export async function POST(request: NextRequest) {
  if (!isAgentAuthorized(request)) return unauthorized()
  const body = await request.json().catch(() => ({}))
  const { db, user } = await agentUser(request)
  if (!user) return NextResponse.json({ error: "Conta não encontrada" }, { status: 400 })

  const { data: row } = await db.from("lead_flows").select("*").eq("id", String(body.id || "")).eq("user_id", user.id).eq("flow", "raiox").maybeSingle()
  if (!row) return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 })
  if (row.status !== "analisando") return NextResponse.json({ error: `Pedido está "${row.status}", não "analisando"` }, { status: 409 })

  if (body.action === "upload-url") {
    const kind = body.kind === "cover" ? "cover" : "pdf"
    const path = `${user.id}/raiox/${row.id}-${randomUUID().slice(0, 6)}.${kind === "cover" ? "png" : "pdf"}`
    const { data, error } = await db.storage.from(FILES_BUCKET).createSignedUploadUrl(path)
    if (error || !data) return NextResponse.json({ error: `Não foi possível preparar o envio: ${error?.message}` }, { status: 500 })
    return NextResponse.json({ path, signedUrl: data.signedUrl })
  }

  if (body.action === "fail") {
    const error = one(body.error, 300) || "sem motivo informado"
    await db.from("lead_flows").update({ status: "falhou", last_error: error, updated_at: new Date().toISOString() }).eq("id", row.id)
    await sendAlert(db, `raiox-falhou:${row.id}`, "Raio-X não foi gerado", `@${row.username || "?"}: ${error}`)
    return NextResponse.json({ ok: true })
  }

  if (body.action === "deliver") {
    const pdfPath = String(body.pdf_path || "")
    if (!pdfPath.startsWith(`${user.id}/raiox/`) || !pdfPath.endsWith(".pdf")) {
      return NextResponse.json({ error: "pdf_path inválido (use o caminho devolvido por upload-url)" }, { status: 400 })
    }
    if (Date.now() - new Date(row.last_inbound_at).getTime() > WINDOW_MS) {
      await db.from("lead_flows").update({ status: "falhou", last_error: "Passou de 23h", updated_at: new Date().toISOString() }).eq("id", row.id)
      await sendAlert(db, `raiox-expirou:${row.id}`, "Raio-X não entregue", `@${row.username || "?"}: a janela de 24h do Direct passou.`)
      return NextResponse.json({ error: "Janela de 24h do Direct encerrada" }, { status: 410 })
    }

    const { data: info } = await db.storage.from(FILES_BUCKET).list(`${user.id}/raiox`, { search: pdfPath.split("/").pop() })
    if (!info?.length) return NextResponse.json({ error: "PDF não foi enviado ao armazenamento" }, { status: 400 })

    const name = `Raio-X ${one(body.business, 60) || row.username || "do seu negócio"}.pdf`
    const { data: file, error: fileError } = await db.from("files").insert({
      user_id: user.id, name, storage_path: pdfPath, size_bytes: Number(info[0]?.metadata?.size) || 0, mime_type: "application/pdf",
    }).select("id").single()
    if (fileError || !file) return NextResponse.json({ error: `Não foi possível registrar o arquivo: ${fileError?.message}` }, { status: 500 })

    const link = await createTrackedLink(db, { userId: user.id, automationId: row.automation_id, igId: row.ig_id }, { fileId: file.id })
    if (!link) return NextResponse.json({ error: "Não foi possível criar o link" }, { status: 500 })

    // Anything the analysis could not read is said openly in the message (and marked "Não verificado" in the PDF).
    const gaps: string[] = Array.isArray(body.not_verified) ? body.not_verified.map((g: unknown) => one(g, 120)).filter(Boolean).slice(0, 5) : []
    const parts = [
      "Seu Raio-X ficou pronto. Está aqui:",
      link,
      one(body.summary, 240),
      gaps.length
        ? `O que eu não consegui verificar: ${gaps.join("; ")}. Está marcado como "Não verificado" no PDF. Se quiser que eu complete, me manda o que faltou aqui no Direct.`
        : "",
      "Se quiser conversar sobre o que ele mostra, é só responder aqui.",
    ].filter(Boolean)
    const sent = await sendTextDM(user.access_token, { id: row.ig_id }, parts.join("\n\n"))
    if (!sent.ok) {
      await db.from("lead_flows").update({ status: "falhou", last_error: `Direct recusou: ${JSON.stringify(sent.error).slice(0, 250)}`, updated_at: new Date().toISOString() }).eq("id", row.id)
      await sendAlert(db, `raiox-falhou:${row.id}`, "Raio-X não chegou ao lead", `@${row.username || "?"}: o Instagram recusou o envio. O PDF está em Arquivos.`)
      return NextResponse.json({ error: "Instagram recusou o envio" }, { status: 502 })
    }

    await db.from("lead_flows").update({
      status: "entregue", result_path: pdfPath, result_cover_path: body.cover_path ? String(body.cover_path) : null,
      delivered_at: new Date().toISOString(), updated_at: new Date().toISOString(), last_error: null,
    }).eq("id", row.id)
    await recordEvent(db, user.id, row.ig_id, "content_sent", { automationId: row.automation_id })
    await addTags(db, user.id, row.ig_id, ["raiox-entregue"])
    return NextResponse.json({ ok: true, link })
  }

  return NextResponse.json({ error: "action deve ser upload-url, deliver ou fail" }, { status: 400 })
}
