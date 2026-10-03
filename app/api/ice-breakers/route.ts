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
            // Construct IG Payload
            const ice_breakers = inserted.map((ib: any) => ({
                question: ib.question,
                payload: `ICE_BREAKER_${ib.id}`
            }))

            // We need to SAVE/MAP this payload to the response? 
            // Actually, for simple text reply, we can handle the payload in webhook. 
            // BUT, our current webhook looks for Keywords or Postbacks. 
            // Let's assume standard behavior: User clicks question -> It sends the question as text? 
            // No, Ice Breakers send a Postback payload usually. 
            // IF we want to reply with the `response`, we need to map the payload to the response.
            // Let's update the DB insert to include payload if possible, or just match by Question Text (easier for now).
            // IG says: "When a person taps an ice breaker, your webhook receives a messaging_postbacks event."

            // Wait, current DB schema doesn't have payload. 
            // Let's use the 'question' as the trigger for now or rely on the fact that we just need to set them.
            // Actually, keeping it simple: We set them on IG. When user clicks, we get a Postback.
            // We need to know which response to send. 

            const response = await fetch(
                "https://graph.instagram.com/v24.0/me/messenger_profile",
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${user.access_token}` },
                    body: JSON.stringify({
                        ice_breakers: ice_breakers,
                        platform: "instagram" // Important
                    })
                }
            )
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
