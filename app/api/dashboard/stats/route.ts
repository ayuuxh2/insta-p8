import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"

export async function GET(request: NextRequest) {
    try {
        const userId = request.nextUrl.searchParams.get("userId")
        if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 })

        const supabase = await getSupabaseServerClient()

        // 1. Total Automations
        const automationsQuery = supabase
            .from("automations")
            .select("*", { count: "exact", head: true })
            .eq("user_id", userId)

        // 2. Active Triggers
        const activeQuery = supabase
            .from("automations")
            .select("*", { count: "exact", head: true })
            .eq("user_id", userId)
            .eq("is_active", true)

        // 3. Audience Reached (Total Conversations)
        const audienceQuery = supabase
            .from("conversations")
            .select("*", { count: "exact", head: true })
            .eq("user_id", userId)

        // 4. Messages Sent (where is_from_instagram is false, implying bot/system sent it)
        const sentQuery = supabase
            .from("messages")
            .select("*", { count: "exact", head: true })
            .eq("user_id", userId)
            .eq("is_from_instagram", false)

        // 5. Recent Activity (Last 5 messages sent by bot)
        const recentQuery = supabase
            .from("messages")
            .select("id, content, created_at, sender_username, conversation_id, recipient:conversations(recipient_username)")
            .eq("user_id", userId)
            .eq("is_from_instagram", false)
            .order("created_at", { ascending: false })
            .limit(5)

        const results = await Promise.allSettled([automationsQuery, activeQuery, audienceQuery, sentQuery, recentQuery])
        
        const automationsRes = results[0].status === "fulfilled" ? results[0].value : null
        const activeRes = results[1].status === "fulfilled" ? results[1].value : null
        const audienceRes = results[2].status === "fulfilled" ? results[2].value : null
        const sentRes = results[3].status === "fulfilled" ? results[3].value : null
        const recentRes = results[4].status === "fulfilled" ? results[4].value : null

        return NextResponse.json({
            metrics: {
                totalAutomations: automationsRes?.count || 0,
                activeTriggers: activeRes?.count || 0,
                audienceReached: audienceRes?.count || 0,
                messagesSent: sentRes?.count || 0,
            },
            recentActivity: recentRes?.data || []
        })
    } catch (error) {
        console.error("[v0] Dashboard Stats error:", error)
        return NextResponse.json({ error: "Failed to fetch stats" }, { status: 500 })
    }
}
