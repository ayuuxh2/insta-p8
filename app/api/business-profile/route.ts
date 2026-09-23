import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { getSessionUserId } from "@/lib/api-auth"

type Knowledge = Record<string, string>

export async function GET(request: NextRequest) {
    const sessionUserId = getSessionUserId(request)
    const requestedUserId = request.nextUrl.searchParams.get("userId")
    if (!sessionUserId || !requestedUserId || sessionUserId !== requestedUserId) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const supabase = await getSupabaseServerClient()
    const { data, error } = await supabase.from("users").select("ai_context").eq("id", sessionUserId).single()
    if (error) return NextResponse.json({ error: "Failed to load business profile" }, { status: 500 })

    let knowledge: Knowledge = {}
    try {
        knowledge = data?.ai_context ? JSON.parse(data.ai_context) : {}
    } catch {
        knowledge = { business_description: data?.ai_context ?? "" }
    }
    return NextResponse.json({ knowledge })
}

export async function PUT(request: NextRequest) {
    const sessionUserId = getSessionUserId(request)
    const body = await request.json()
    const { userId, knowledge } = body as { userId?: string; knowledge?: Knowledge }
    if (!sessionUserId || !userId || sessionUserId !== userId || !knowledge || typeof knowledge !== "object" || Array.isArray(knowledge)) {
        return NextResponse.json({ error: "Unauthorized or invalid request" }, { status: 401 })
    }

    const sanitizedKnowledge = Object.fromEntries(
        Object.entries(knowledge)
            .filter(([key, value]) => typeof key === "string" && typeof value === "string")
            .map(([key, value]) => [key, value.trim().slice(0, 5000)]),
    )
    const supabase = await getSupabaseServerClient()
    const { error } = await supabase.from("users").update({ ai_context: JSON.stringify(sanitizedKnowledge) }).eq("id", sessionUserId)
    if (error) return NextResponse.json({ error: "Failed to save business profile" }, { status: 500 })
    return NextResponse.json({ ok: true })
}
