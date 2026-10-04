// Owner alerts outside the dashboard. Configure one or both (free):
//   NTFY_TOPIC      push notification via https://ntfy.sh (install the ntfy app, subscribe to the topic)
//   RESEND_API_KEY + ALERT_EMAIL   e-mail via https://resend.com
// Alerts are de-duplicated per key and time window through processed_events.

import { claimEvent } from "@/lib/antispam"
import { appBaseUrl } from "@/lib/links"

type Db = any

const WINDOW_HOURS = 6

export async function sendAlert(db: Db, key: string, title: string, message: string): Promise<boolean> {
  const window = Math.floor(Date.now() / (WINDOW_HOURS * 3_600_000))
  if (!(await claimEvent(db, `alert:${key}:${window}`))) return false

  const link = `${appBaseUrl()}/dashboard`
  const tasks: Promise<unknown>[] = []

  const topic = process.env.NTFY_TOPIC?.trim()
  if (topic) {
    tasks.push(
      // JSON publishing keeps accents intact (HTTP headers are ASCII-only).
      fetch("https://ntfy.sh/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, title: `CEE Automação: ${title}`, message, priority: 4, tags: ["warning"], click: link }),
      }).catch((e) => console.error("[notify] ntfy failed:", e?.message)),
    )
  }

  const resendKey = process.env.RESEND_API_KEY?.trim()
  const email = process.env.ALERT_EMAIL?.trim()
  if (resendKey && email) {
    tasks.push(
      fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "CEE Automação <onboarding@resend.dev>",
          to: [email],
          subject: `⚠️ CEE Automação: ${title}`,
          text: `${message}\n\nPainel: ${link}`,
        }),
      }).catch((e) => console.error("[notify] resend failed:", e?.message)),
    )
  }

  if (!tasks.length) console.warn(`[notify] no alert channel configured — "${title}"`)
  await Promise.all(tasks)
  return tasks.length > 0
}
