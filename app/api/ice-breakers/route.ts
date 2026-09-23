import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { requireUser } from "@/lib/api-auth"

export async function GET(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams
        const userId = searchParams.get("userId")

        if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 })

        const denied = requireUser(request, userId)
        if (denied) return denied

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
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const { userId, iceBreakers } = body // Array of ice breakers

        if (!userId || !Array.isArray(iceBreakers)) {
            return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
        }

        const denied = requireUser(request, userId)
        if (denied) return denied

        if (iceBreakers.length > 4) {
            return NextResponse.json({ error: "Instagram allows at most 4 ice breakers" }, { status: 400 })
        }

        const rows = iceBreakers.map((ib: any) => ({
            question: typeof ib?.question === "string" ? ib.question.trim() : "",
            response: typeof ib?.response === "string" ? ib.response.trim() : "",
        }))
        if (rows.some((row) => !row.question || !row.response)) {
            return NextResponse.json({ error: "Every ice breaker needs a question and a response" }, { status: 400 })
        }

        const supabase = await getSupabaseServerClient()

        // 1. Replace the user's rows (Instagram caps the list at 4).
        const { error: deleteError } = await supabase
            .from("ice_breakers")
            .delete()
            .eq("user_id", userId)

        if (deleteError) throw deleteError

        let inserted: any[] = []
        if (rows.length > 0) {
            const { data, error: insertError } = await supabase
                .from("ice_breakers")
                .insert(rows.map((row) => ({
                    user_id: userId,
                    question: row.question.slice(0, 80),
                    response: row.response.slice(0, 1000),
                    is_active: true
                })))
                .select()

            if (insertError) throw insertError
            inserted = data ?? []
        }

        // 2. Sync to Instagram — this is what actually makes them visible to users.
        const { data: user } = await supabase.from("users").select("access_token").eq("id", userId).single()

        if (!user?.access_token) {
            return NextResponse.json({ error: "Instagram is not connected for this account" }, { status: 409 })
        }

        {
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
                `https://graph.instagram.com/v24.0/me/messenger_profile?access_token=${encodeURIComponent(user.access_token)}`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        ice_breakers,
                        platform: "instagram",
                    })
                }
            )
            const igResult = await response.json().catch(() => null)
            if (!response.ok || igResult?.error) {
                const meta = igResult?.error
                console.error(
                    `[ice-breakers] Instagram sync failed: HTTP ${response.status}` +
                        (meta ? ` type=${meta.type ?? "-"} code=${meta.code ?? "-"} message=${meta.message ?? "-"}` : ""),
                )
                // Rows are saved locally, but the feature users actually see is NOT live.
                // Reporting success here is what made this look like it worked.
                return NextResponse.json(
                    { error: "Saved locally, but Instagram rejected the sync — your ice breakers are not live yet.", savedLocally: true },
                    { status: 502 },
                )
            }
        }

        return NextResponse.json({ success: true, data: inserted })

    } catch (error) {
        console.error("Ice Breaker POST Error:", error)
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
    }
}
