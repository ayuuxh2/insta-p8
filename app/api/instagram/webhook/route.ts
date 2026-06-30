/* @ts-nocheck */

import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"

const WEBHOOK_VERIFY_TOKEN = process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN || "your_verify_token"

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const mode = searchParams.get("hub.mode")
  const token = searchParams.get("hub.verify_token")
  const challenge = searchParams.get("hub.challenge")

  if (mode === "subscribe" && token === WEBHOOK_VERIFY_TOKEN && challenge) {
    return new NextResponse(challenge, { status: 200 })
  }
  return NextResponse.json({ error: "Invalid token" }, { status: 403 })
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    if (!body.entry) return NextResponse.json({ ok: true })
    const supabase = await getSupabaseServerClient()

    for (const entry of body.entry) {
      // ============================================================
      // 🔇 ECHO SILENCER (The Fix for "ID Not Found" logs)
      // ============================================================
      // If the incoming event is just a "Read Receipt", "Delivery Status",
      // or "Echo" (the bot's own reply), we skip it immediately.
      // This prevents the code from trying to find a User ID for a system event.
      if (entry.messaging) {
        const isSystemEvent = entry.messaging.every(
          (event: any) => event.read || event.delivery || (event.message && event.message.is_echo),
        )
        if (isSystemEvent) {
          // console.log("[v0] 🔇 Skipped System Event (Echo/Read/Delivery)")
          continue
        }
      }
      // ============================================================

      const webhookId = entry.id

      // 1. DUAL ID LOOKUP
      let { data: user } = await supabase
        .from("users")
        .select("*")
        .or(`business_account_id.eq.${webhookId},page_id.eq.${webhookId}`)
        .single()

      // ============================================================
      // 🔍 FALLBACK 1: Extract actual IG ID from payload
      // ============================================================
      if (!user) {
        console.log(`[v0] ⚠️ ID ${webhookId} not found in DB. Trying payload fallback...`)

        const candidateIds = new Set<string>()

        if (entry.changes) {
          for (const change of entry.changes) {
            if (change.value?.media?.owner?.id) candidateIds.add(String(change.value.media.owner.id))
          }
        }
        if (entry.messaging) {
          for (const event of entry.messaging) {
            if (event.recipient?.id) candidateIds.add(String(event.recipient.id))
          }
        }

        for (const candidateId of candidateIds) {
          if (candidateId === webhookId) continue
          const { data: fallbackUser } = await supabase
            .from("users")
            .select("*")
            .or(`business_account_id.eq.${candidateId},page_id.eq.${candidateId}`)
            .single()

          if (fallbackUser) {
            console.log(`[v0] ✅ Payload fallback matched! ${candidateId} → ${fallbackUser.username}`)
            await supabase.from("users").update({ page_id: webhookId }).eq("id", fallbackUser.id)
            user = fallbackUser
            break
          }
        }
      }

      // ============================================================
      // 🔍 FALLBACK 2: Token verification (tests ALL users)
      // Only runs once per unknown ID, then saves the mapping forever
      // ============================================================
      if (!user) {
        console.log(`[v0] 🔎 Trying token verification for ${webhookId}...`)
        const { data: allUsers } = await supabase.from("users").select("*")

        if (allUsers) {
          for (const candidate of allUsers) {
            if (!candidate.access_token) continue
            try {
              const testRes = await fetch(
                `https://graph.instagram.com/v24.0/${webhookId}?fields=id&access_token=${candidate.access_token}`
              )
              if (testRes.ok) {
                console.log(`[v0] ✅ Token verified! ${webhookId} belongs to ${candidate.username}. Saving permanently.`)
                await supabase
                  .from("users")
                  .update({ page_id: webhookId })
                  .eq("id", candidate.id)
                user = candidate
                break
              }
            } catch (e) {
              // Network error, skip this user
            }
          }
        }
      }
      // ============================================================

      if (!user) {
        console.log(`[v0] ❌ Could not resolve User for ID ${webhookId}`)
        continue
      }

      const { data: automations } = await supabase
        .from("automations")
        .select("*")
        .eq("user_id", user.id)
        .eq("is_active", true)

      if (!automations?.length) continue

      // ============================================================
      //  PART A: COMMENTS
      // ============================================================
      if (entry.changes) {
        for (const change of entry.changes) {
          if (change.field === "comments" && change.value?.text) {
            const commentId = change.value.id
            const commentText = change.value.text.toLowerCase().trim()
            const senderId = change.value.from.id

            const mediaId = change.value.media.id

            // Safety check for self-reply
            if (senderId === webhookId || senderId === user.business_account_id || senderId === user.page_id) continue

            // ============================================================
            // 🧠 SMART MATCHING LOGIC
            // ============================================================
            // Filter to comment-only automations first
            const commentAutomations = automations.filter((a: any) => a.trigger_source === 'comment')

            // Priority 1: Reply-All (Specific post, ALL comments)
            let match = commentAutomations.find(
              (a: any) => a.specific_media_id === mediaId && a.trigger_type === "reply_all",
            )

            // Priority 2: Specific Post + Keyword Match
            if (!match) {
              match = automations.find(
                (a) =>
                  a.specific_media_id === mediaId &&
                  a.trigger_type === "keyword" &&
                  a.trigger_value
                    .split(",")
                    .some((k: string) => new RegExp(`\\b${k.trim()}\\b`, "i").test(commentText)),
              )
            }

            // Priority 3: Global Keyword Match (Only if no specific match found)
            if (!match) {
              match = automations.find(
                (a) =>
                  !a.specific_media_id && // Must be global
                  a.trigger_type === "keyword" &&
                  a.trigger_value
                    .split(",")
                    .some((k: string) => new RegExp(`\\b${k.trim()}\\b`, "i").test(commentText)),
              )
            }

            if (match) {
              console.log(`[v0] ✅ Comment Match: "${match.name}" (ID: ${match.id})`)
              const content = match.response_content
              const replies = ["Check your DMs! 📥", "Sent! 🔥", "Check inbox! ✨"]
              const randomReply = replies[Math.floor(Math.random() * replies.length)]

              // Public Reply
              try {
                const pubRes = await fetch(
                  `https://graph.instagram.com/v24.0/${commentId}/replies?access_token=${encodeURIComponent(user.access_token)}`,
                  {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ message: randomReply }),
                  },
                )
                const pubJson = await pubRes.json()
                if (pubJson.error) console.error("[v0] 🔴 Public Reply Failed:", JSON.stringify(pubJson.error))
                else console.log("[v0] 🟢 Public Reply Sent!", pubJson)
              } catch (e) {
                console.error("[v0] 🔴 Public Reply Network Error:", e)
              }

              // Private Reply (DM)
              const apiBody: any = { recipient: { comment_id: commentId } }

              if (content.message) {
                // Plain Text
                apiBody.message = { text: content.message }
              } else if (content.card) {
                // Rich Card / Generic Template
                const card = content.card
                const apiButtons = card.buttons.map((b: any) => ({
                  type: b.type,
                  title: b.title,
                  url: b.url || undefined,
                  payload: b.payload || undefined,
                }))
                const element: any = { title: card.title, buttons: apiButtons }
                if (card.subtitle) element.subtitle = card.subtitle
                if (card.image_url && card.image_url.startsWith("http")) element.image_url = card.image_url

                apiBody.message = {
                  attachment: {
                    type: "template",
                    payload: {
                      template_type: "generic",
                      elements: [element],
                    },
                  },
                }
              }

              console.log("[v0] 📤 DM Body:", JSON.stringify(apiBody))
              try {
                const dmRes = await fetch(
                  `https://graph.instagram.com/v24.0/me/messages?access_token=${encodeURIComponent(user.access_token)}`,
                  { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(apiBody) },
                )
                const dmJson = await dmRes.json()
                if (dmJson.error) console.error("[v0] 🔴 Private DM Failed:", JSON.stringify(dmJson.error))
                else console.log("[v0] 🟢 Private DM Sent!", dmJson)
              } catch (e) {
                console.error("[v0] 🔴 Private DM Network Error:", e)
              }
            }
          }
        }
      }

      // ============================================================
      //  PART A.5: STORY AUTOMATION HANDLING
      // ============================================================
      if (entry.messaging) {
        for (const event of entry.messaging) {
          const senderId = event.sender.id
          const recipientId = event.recipient.id

          // Skip system events
          if (event.read || event.delivery || event.message?.is_echo || senderId === recipientId) continue

          // Filter story automations only
          const storyAutomations = automations.filter((a: any) => a.trigger_source === 'story')
          if (storyAutomations.length === 0) continue

          let match = null
          let storyMediaId: string | null = null

          // 1️⃣ Story Mention Handler
          if (event.message?.attachments?.[0]?.type === 'story_mention') {
            const attachment = event.message.attachments[0]
            storyMediaId = attachment.payload?.url || null

            match = storyAutomations.find((a: any) =>
              a.trigger_type === 'mention' &&
              (!a.specific_media_id || a.specific_media_id === storyMediaId)
            )
          }

          // 2️⃣ Story Reaction Handler  
          else if (event.reaction) {
            const reactionEmoji = event.reaction.emoji
            storyMediaId = event.reaction.mid || null

            match = storyAutomations.find((a: any) => {
              if (a.trigger_type !== 'reaction') return false
              if (a.specific_media_id && a.specific_media_id !== storyMediaId) return false

              const triggers = a.trigger_value?.split(',').map((t: string) => t.trim()) || []
              if (triggers.length > 0 && triggers[0] !== 'ALL' && triggers[0] !== '') {
                return triggers.includes(reactionEmoji)
              }
              return true
            })
          }

          // 3️⃣ Story Reply Handler
          else if (event.message?.reply_to?.story) {
            const messageText = event.message.text || ''
            storyMediaId = event.message.reply_to.story.id || null

            match = storyAutomations.find((a: any) => {
              if (a.trigger_type !== 'reply') return false
              if (a.specific_media_id && a.specific_media_id !== storyMediaId) return false

              const triggers = a.trigger_value?.split(',').map((t: string) => t.trim()) || []
              if (triggers.length > 0 && triggers[0] !== 'ALL' && triggers[0] !== 'ALL_MENTIONS' && triggers[0] !== '') {
                return triggers.some((keyword: string) =>
                  new RegExp(`\\b${keyword}\\b`, 'i').test(messageText)
                )
              }
              return true
            })
          }

          // Send response if match found
          if (match) {
            console.log(`✨ Story automation matched: ${match.name}`)

            try {
              const content = JSON.parse(match.response_content)
              const apiBody: any = { recipient: { id: senderId } }

              if (content.message) {
                apiBody.message = { text: content.message }
              } else if (content.card) {
                const card = content.card
                const apiButtons = card.buttons.map((b: any) => ({
                  type: b.type,
                  title: b.title,
                  url: b.url || undefined,
                  payload: b.payload || undefined,
                }))
                const element: any = { title: card.title, buttons: apiButtons }
                if (card.subtitle) element.subtitle = card.subtitle
                if (card.image_url && card.image_url.startsWith("http")) element.image_url = card.image_url

                apiBody.message = {
                  attachment: {
                    type: "template",
                    payload: {
                      template_type: "generic",
                      elements: [element],
                    },
                  },
                }
              }

              await fetch(
                `https://graph.instagram.com/v24.0/me/messages?access_token=${encodeURIComponent(user.access_token)}`,
                { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(apiBody) },
              )

              console.log(`✅ Story automation sent: ${match.name}`)
            } catch (err) {
              console.error('❌ Story automation error:', err)
            }
          }
        }
      }

      // ============================================================
      //  PART B: MESSAGES (DMs)
      // ============================================================
      if (entry.messaging) {
        for (const event of entry.messaging) {
          if (event.read || event.delivery || event.reaction || event.message?.is_echo) continue

          const senderId = event.sender.id
          if (senderId === webhookId || senderId === user.business_account_id || senderId === user.page_id) continue

          let triggerType = "",
            triggerValue = ""

          if (event.message?.text) {
            triggerType = "keyword"
            triggerValue = event.message.text.toLowerCase().trim()
          } else if (event.postback?.payload) {
            triggerType = "postback"
            triggerValue = event.postback.payload
          } else {
            continue
          }

          console.log(`[v0] 📩 DM from ${senderId}: "${triggerValue}"`)

          // ============================================================
          // 💾 1. SAVE INCOMING MESSAGE (Live Inbox Logic)
          // ============================================================
          try {
            // A. Upsert Conversation
            // We try to find an existing conv first to get the ID
            let { data: conv } = await supabase
              .from("conversations")
              .select("id")
              .eq("user_id", user.id)
              .eq("recipient_id", senderId)
              .single()

            if (!conv) {
              // Create new conversation

              // 1. Try to fetch real username first
              let realUsername = `cnt_${senderId.slice(0, 5)}...`
              try {
                const profileUrl = `https://graph.instagram.com/v24.0/${senderId}?fields=username&access_token=${user.access_token}`
                const profileRes = await fetch(profileUrl)
                const profileData = await profileRes.json()
                if (profileData.username) {
                  realUsername = profileData.username
                }
              } catch (e) {
                console.error("[v0] Failed to fetch username", e)
              }

              const { data: newConv } = await supabase
                .from("conversations")
                .insert({
                  user_id: user.id,
                  recipient_id: senderId,
                  recipient_username: realUsername,
                  last_message_at: new Date().toISOString(),
                })
                .select("id")
                .single()
              conv = newConv
            } else {
              // Update timestamp
              await supabase
                .from("conversations")
                .update({ last_message_at: new Date().toISOString() })
                .eq("id", conv.id)
            }

            if (conv) {
              // B. Save User Message
              await supabase.from("messages").insert({
                id: event.message?.mid || `mid_${Date.now()}_${Math.random()}`,
                conversation_id: conv.id,
                user_id: user.id,
                sender_id: senderId,
                sender_username: "User", // We don't have their username easily here
                content: triggerValue,
                is_from_instagram: true, // True = FROM the user TO us
              })
            }
          } catch (err) {
            console.error("[v0] Failed to save incoming message DB", err)
          }
          // ============================================================

          let match = null
          if (triggerType === "postback") {
            if (triggerValue.startsWith("UNLOCK_CONTENT_")) {
              const ruleId = triggerValue.replace("UNLOCK_CONTENT_", "")
              match = automations.find((a) => a.id === ruleId)
            } else if (triggerValue.startsWith("ICE_BREAKER_")) {
              // Handle Ice Breaker
              const iceBreakerId = triggerValue.replace("ICE_BREAKER_", "")
              const { data: ibMatches } = await supabase
                .from("ice_breakers")
                .select("*")
                .eq("id", iceBreakerId)
                .eq("user_id", user.id)
                .single()

              if (ibMatches) {
                // Construct a temporary match object to reuse the sending logic
                match = {
                  name: "Ice Breaker: " + ibMatches.question,
                  response_content: { message: ibMatches.response },
                }
              }
            } else {
              match = automations.find((a) => a.trigger_type === "postback" && a.trigger_value === triggerValue)
            }
          } else {
            match = automations.find(
              (a) =>
                a.trigger_type === "keyword" &&
                a.trigger_value.split(",").some((k: string) => new RegExp(`\\b${k.trim()}\\b`, "i").test(triggerValue)),
            )
          }

          if (!match) {
            console.log(`[v0] ❌ No match.`)
            continue
          }

          console.log(`[v0] ✅ Match: "${match.name}"`)
          const content = match.response_content
          const apiBody: any = { recipient: { id: senderId } }

          let replyTextLog = ""

          if (content.message) {
            apiBody.message = { text: content.message }
            replyTextLog = content.message
          } else if (content.card) {
            const card = content.card
            replyTextLog = `[Card] ${card.title}`
            const apiButtons = card.buttons.map((b: any) => ({
              type: b.type,
              title: b.title,
              url: b.url || undefined,
              payload: b.payload || undefined,
            }))
            const element: any = { title: card.title, buttons: apiButtons }
            if (card.subtitle) element.subtitle = card.subtitle
            if (card.image_url && card.image_url.startsWith("http")) element.image_url = card.image_url
            apiBody.message = {
              attachment: { type: "template", payload: { template_type: "generic", elements: [element] } },
            }
          }

          // Follow Gate Logic
          const isUnlockEvent = triggerType === "postback" && triggerValue.startsWith("UNLOCK_CONTENT_")
          if (content.check_follow === true && !isUnlockEvent) {
            replyTextLog = "[Locked Content Gate]"
            apiBody.message = {
              attachment: {
                type: "template",
                payload: {
                  template_type: "generic",
                  elements: [
                    {
                      title: "🔒 Content Locked",
                      subtitle: `Please follow @${user.username} to see this!`,
                      buttons: [
                        { type: "web_url", url: `https://instagram.com/${user.username}`, title: "Follow Us" },
                        { type: "postback", title: "I Followed! ✅", payload: `UNLOCK_CONTENT_${match.id}` },
                      ],
                    },
                  ],
                },
              },
            }
          }

          // SEND REPLY
          try {
            const res = await fetch(
              `https://graph.instagram.com/v24.0/me/messages?access_token=${encodeURIComponent(user.access_token)}`,
              { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(apiBody) },
            )
            const json = await res.json()
            if (json.error) console.error("[v0] 🔴 Reply Failed:", json.error)
            else {
              console.log("[v0] 🟢 Reply Sent!")

              // ============================================================
              // 💾 2. SAVE OUTGOING REPLY (Live Inbox Logic)
              // ============================================================
              // We need to find the conversation ID again (or pass it down)
              // For safety, we just re-query or use the one if we scoped it.
              // Doing a quick localized lookup for robustness:
              const { data: conv } = await supabase
                .from("conversations")
                .select("id")
                .eq("user_id", user.id)
                .eq("recipient_id", senderId)
                .single()

              if (conv) {
                await supabase.from("messages").insert({
                  id: `mid_reply_${Date.now()}_${Math.random()}`,
                  conversation_id: conv.id,
                  user_id: user.id,
                  sender_id: user.business_account_id, // It's us
                  sender_username: user.username,
                  content: replyTextLog,
                  is_from_instagram: false, // False = FROM US
                })
              }
              // ============================================================
            }
          } catch (e) {
            console.error("[v0] Network Error:", e)
          }
        }
      }
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("[v0] Webhook Error", error)
    return NextResponse.json({ ok: true })
  }
}
