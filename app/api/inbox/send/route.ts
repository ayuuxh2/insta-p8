import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"

export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const { userId, recipientId, message, attachment } = body

        if (!userId || !recipientId || (!message && !attachment)) {
            return NextResponse.json({ error: "Campos obrigatórios ausentes" }, { status: 400 })
        }

        const supabase = await getSupabaseServerClient()

        // 1. Get User Access Token
        const { data: user, error: userError } = await supabase
            .from("users")
            .select("access_token, username, business_account_id")
            .eq("id", userId)
            .single()

        if (userError || !user) {
            return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 })
        }

        // 2. Prepare Payload for Instagram API
        const apiBody: any = { recipient: { id: recipientId } }

        if (message) {
            apiBody.message = { text: message }
        } else if (attachment) {
            apiBody.message = { attachment }
        }

        // 3. Send to Instagram
        const res = await fetch(
            "https://graph.instagram.com/v24.0/me/messages",
            {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${user.access_token}` },
                body: JSON.stringify(apiBody)
            }
        )

        const data = await res.json()

        if (data.error) {
            console.error("[Inbox Send] Instagram API Error:", data.error)
            return NextResponse.json({ error: data.error.message }, { status: 500 })
        }

        // 4. Log to Database (Outbound Message)
        // Find Conversation ID first
        let { data: conv } = await supabase
            .from("conversations")
            .select("id")
            .eq("user_id", userId)
            .eq("recipient_id", recipientId)
            .single()

        // If conversation doesn't exist (unlikely if replying, but possible if initiating), create it logic is tricky here 
        // without knowing username. Assuming it exists for now as this is usually a reply flow.

        if (conv) {
            await supabase.from("messages").insert({
                id: `mid_out_${Date.now()}_${Math.random()}`,
                conversation_id: conv.id,
                user_id: userId,
                sender_id: user.business_account_id,
                sender_username: user.username,
                content: message || "[Anexo]",
                is_from_instagram: false
            })

            // Update conversation timestamp
            await supabase
                .from("conversations")
                .update({ last_message_at: new Date().toISOString() })
                .eq("id", conv.id)
        }

        return NextResponse.json({ success: true, data })

    } catch (error) {
        console.error("[Inbox Send] Internal Error:", error)
        return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
    }
}
