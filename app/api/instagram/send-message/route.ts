import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { requireUser } from "@/lib/api-auth"

/**
 * POST /api/instagram/send-message
 * Send a DM reply to an Instagram user
 *
 * Request body:
 * {
 *   "user_id": 123456,
 *   "recipient_id": 789012,
 *   "message": "Your reply text here"
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const { user_id, recipient_id, message } = await request.json()

    if (!user_id || !recipient_id || !message) {
      return NextResponse.json({ error: "Missing required fields: user_id, recipient_id, message" }, { status: 400 })
    }

    const denied = requireUser(request, user_id)
    if (denied) return denied

    const supabase = await getSupabaseServerClient()

    // Get user's access token
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("access_token, username")
      .eq("id", user_id)
      .single()

    if (userError || !user) {
      console.error("[v0] Failed to get user:", userError)
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    console.log("[v0] Sending DM from", user.username, "to", recipient_id)

    // Send message via Instagram API
    const sendUrl = `https://graph.instagram.com/v24.0/me/messages?access_token=${encodeURIComponent(user.access_token)}`

    const response = await fetch(sendUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        recipient: {
          id: recipient_id.toString(),
        },
        message: {
          text: message,
        },
      }),
    })

    const data = await response.json()

    if (!response.ok) {
      console.error("[v0] Failed to send message:", data)
      return NextResponse.json({ error: data.error?.message || "Failed to send message" }, { status: 400 })
    }

    console.log("[v0] Message sent successfully:", data.message_id)

    // Store the sent message in database
    const { data: conversation } = await supabase
      .from("conversations")
      .select("id")
      .eq("user_id", user_id)
      .eq("recipient_id", recipient_id)
      .single()

    if (conversation) {
      await supabase.from("messages").insert({
        id: data.message_id,
        conversation_id: conversation.id,
        user_id,
        sender_id: user_id,
        sender_username: user.username,
        content: message,
        is_from_instagram: false,
      })
    }

    return NextResponse.json({
      success: true,
      message_id: data.message_id,
    })
  } catch (error) {
    console.error("[v0] Send message error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
