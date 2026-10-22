import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"

type Knowledge = Record<string, string>

function getSessionUserId(request: NextRequest): string | null {
    try {
        const raw = request.cookies.get("insta_session")?.value
        if (!raw) return null
        const decoded = decodeURIComponent(raw)
        const session = JSON.parse(decoded) as { userId?: string }
        return session.userId || null
    } catch {
        return null
    }
}

export async function GET(request: NextRequest) {
    const requestedUserId = request.nextUrl.searchParams.get("userId")
    const sessionUserId = getSessionUserId(request) || requestedUserId
    if (!requestedUserId) {
        return NextResponse.json({ error: "Missing userId" }, { status: 400 })
    }

    const supabase = await getSupabaseServerClient()
    const { data, error } = await supabase.from("users").select("ai_context").eq("id", sessionUserId || requestedUserId).single()
    if (error && !data) return NextResponse.json({ knowledge: {} })

    let knowledge: Knowledge = {}
    try {
        knowledge = data?.ai_context ? JSON.parse(data.ai_context) : {}
    } catch {
        knowledge = { business_description: data?.ai_context ?? "" }
    }
    return NextResponse.json({ knowledge })
}

export async function PUT(request: NextRequest) {
    const body = await request.json()
    const { userId, knowledge } = body as { userId?: string; knowledge?: Knowledge }
    const sessionUserId = getSessionUserId(request) || userId
    if (!userId || !knowledge || typeof knowledge !== "object" || Array.isArray(knowledge)) {
        return NextResponse.json({ error: "Invalid request payload" }, { status: 400 })
    }

    const sanitizedKnowledge = Object.fromEntries(
        Object.entries(knowledge)
            .filter(([key, value]) => typeof key === "string" && typeof value === "string")
            .map(([key, value]) => [key, value.trim().slice(0, 5000)]),
    )
    const supabase = await getSupabaseServerClient()
    const { error } = await supabase.from("users").update({ ai_context: JSON.stringify(sanitizedKnowledge) }).eq("id", sessionUserId || userId)
    if (error) return NextResponse.json({ error: "Failed to save business profile" }, { status: 500 })
    return NextResponse.json({ ok: true })
}
