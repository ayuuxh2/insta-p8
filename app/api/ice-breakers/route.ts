import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"

export async function GET(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams
        const userId = searchParams.get("userId")

        if (!userId) return NextResponse.json({ error: "userId ausente" }, { status: 400 })

        const supabase = await getSupabaseServerClient()
        const { data, error } = await supabase
            .from("ice_breakers")
            .select("*")
            .eq("user_id", userId)
            .order("created_at", { ascending: true })

        if (error) throw error

        return NextResponse.json(data)
    } catch (error) {
        console.error("Ice Breaker GET Error:", error)
        return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const { userId, iceBreakers } = body // Array of ice breakers

        if (!userId || !Array.isArray(iceBreakers)) {
            return NextResponse.json({ error: "Dados inválidos" }, { status: 400 })
        }

        const supabase = await getSupabaseServerClient()

        // 1. Update Database (Replace all for simplicity or Upsert)
        // Strategy: Delete all for user and re-insert. Simple and effective for limited list (max 4).
        const { error: deleteError } = await supabase
            .from("ice_breakers")
            .delete()
            .eq("user_id", userId)

        if (deleteError) throw deleteError

        const { data: inserted, error: insertError } = await supabase
            .from("ice_breakers")
            .insert(iceBreakers.map((ib: any) => ({
                user_id: userId,
                question: ib.question,
                response: ib.response,
                is_active: true
            })))
            .select()

        if (insertError) throw insertError

        // 2. Sync to Instagram
        const { data: user } = await supabase.from("users").select("access_token, page_id").eq("id", userId).single()

        if (user && user.access_token && user.page_id) {
            // Tapping a question sends a messaging_postbacks event with this payload; the webhook
            // looks the question up by id and answers with its saved response.
            // Format per Meta docs: call_to_actions grouped by locale ("default" is required); max 4.
            const callToActions = (inserted || []).slice(0, 4).map((ib: any) => ({
                question: String(ib.question).slice(0, 80),
                payload: `ICE_BREAKER_${ib.id}`,
            }))
            const headers = { "Content-Type": "application/json", Authorization: `Bearer ${user.access_token}` }

            // An empty list removes the ice breakers from the Instagram profile.
            const response = callToActions.length
                ? await fetch("https://graph.instagram.com/v24.0/me/messenger_profile", {
                      method: "POST",
                      headers,
                      body: JSON.stringify({ platform: "instagram", ice_breakers: [{ call_to_actions: callToActions, locale: "default" }] }),
                  })
                : await fetch("https://graph.instagram.com/v24.0/me/messenger_profile", {
                      method: "DELETE",
                      headers,
                      body: JSON.stringify({ platform: "instagram", fields: ["ice_breakers"] }),
                  })
            const igResult = await response.json()
            if (igResult.error) {
                console.error("IG Sync Error", igResult.error)
                return NextResponse.json({ success: true, warning: "Salvo no banco, mas a sincronização com o Instagram falhou", error: igResult.error }, { status: 200 })
            }
        }

        return NextResponse.json({ success: true, data: inserted })

    } catch (error) {
        console.error("Ice Breaker POST Error:", error)
        return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
    }
}
