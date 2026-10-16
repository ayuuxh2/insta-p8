import { type NextRequest, NextResponse } from "next/server"
import { agentUser } from "@/lib/agent"
import { FILES_BUCKET } from "@/lib/files"
import { loadVitrine } from "@/lib/vitrine"

// GET /api/vitrine/img/<number> — public product image for the /links page.
// Files stay in the private bucket; this redirects to a short-lived signed URL.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ n: string }> }) {
  const number = Number((await params).n)
  if (!Number.isInteger(number) || number < 1) return new NextResponse(null, { status: 404 })
  const { db, user } = await agentUser()
  if (!user) return new NextResponse(null, { status: 404 })
  const item = (await loadVitrine(db, user.id)).items.find((i) => i.number === number && !i.hidden)
  if (!item?.imagePath) return new NextResponse(null, { status: 404 })
  const { data } = await db.storage.from(FILES_BUCKET).createSignedUrl(item.imagePath, 3600)
  if (!data?.signedUrl) return new NextResponse(null, { status: 404 })
  return NextResponse.redirect(data.signedUrl, { status: 302, headers: { "Cache-Control": "public, max-age=1800" } })
}
