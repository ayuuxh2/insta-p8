import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"

export async function GET(request: NextRequest) {
    try {
        const userId = request.nextUrl.searchParams.get("userId")
        if (!userId) return NextResponse.json({ error: "userId ausente" }, { status: 400 })

        const supabase = await getSupabaseServerClient()

        // Fetch conversations sorted by last message
        const { data: conversations, error } = await supabase
            .from("conversations")
            .select("*")
            .eq("user_id", userId)
            .order("last_message_at", { ascending: false })

        if (error) throw error

        return NextResponse.json(conversations)
    } catch (error) {
        console.error("[Inbox] Conversations GET error:", error)
        return NextResponse.json({ error: "Não foi possível carregar as conversas" }, { status: 500 })
    }
}
