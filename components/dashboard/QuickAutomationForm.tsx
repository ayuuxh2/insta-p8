"use client"

import { useRef, useState } from "react"
import { Loader2 } from "lucide-react"
import type { Automation } from "@/lib/types"
import { PostSelector, InstagramMediaItem } from "@/components/dashboard/PostSelector"

type Source = Automation["trigger_source"]

export function QuickAutomationForm({ userId, initialSource, onSuccess }: {
  userId: string
  initialSource: Source
  onSuccess: (source: Source) => void
}) {
  const [source, setSource] = useState<Source>(initialSource)
  const [keyword, setKeyword] = useState("")
  const [answer, setAnswer] = useState("")
  const [selectedMediaId, setSelectedMediaId] = useState<string | null>(null)
  const [selectedMedia, setSelectedMedia] = useState<InstagramMediaItem | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const submitting = useRef(false)

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current || !keyword.trim() || !answer.trim()) return
    submitting.current = true
    setSaving(true)
    setError("")
    try {
      const response = await fetch("/api/automations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          name: "Reply to " + keyword.trim(),
          trigger_source: source,
          trigger_type: source === "story" ? "reply" : "keyword",
          trigger_value: keyword.trim(),
          content: { message: answer.trim(), ...(source === "comment" ? { reply_mode: "dm_only" } : {}) },
          specific_media_id: source === "comment" ? selectedMediaId : null,
        }),
      })
      if (!response.ok) throw new Error("Could not save. Please try again.")
      setKeyword("")
      setAnswer("")
      setSelectedMediaId(null)
      setSelectedMedia(null)
      onSuccess(source)
    } catch {
      setError("Could not save. Check your connection and try again.")
    } finally {
      submitting.current = false
      setSaving(false)
    }
  }

  return <form onSubmit={save} className="overflow-hidden rounded-xl border border-border bg-card">
    <fieldset disabled={saving} className="min-w-0">
      <label className="flex items-center gap-3 border-b border-border px-4 py-3">
        <span className="shrink-0 text-xs text-muted-foreground">Reply to</span>
        <select
          value={source}
          onChange={event => {
            const next = event.target.value as Source
            setSource(next)
            if (next !== "comment") {
              setSelectedMediaId(null)
              setSelectedMedia(null)
            }
          }}
          className="rounded-md bg-card py-1 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="dm">Direct messages</option>
          <option value="comment">Post comments</option>
          <option value="story">Story replies</option>
        </select>
      </label>

      {source === "comment" && (
        <div className="border-b border-border bg-muted/20 p-4 sm:p-5">
          <div className="mb-3">
            <p className="text-sm font-medium text-foreground">Choose where this runs</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Apply this reply to every post/reel, or pick one specific post or reel.
            </p>
          </div>
          <PostSelector
            userId={userId}
            selectedMediaId={selectedMediaId}
            onSelect={(id, item) => {
              setSelectedMediaId(id)
              setSelectedMedia(item)
            }}
          />
        </div>
      )}

      <div className="grid sm:grid-cols-[1fr_2fr]">
        <label className="block border-b border-border p-4 sm:border-b-0 sm:border-r">
          <span className="text-xs font-medium text-muted-foreground">When they say</span>
          <input
            required
            value={keyword}
            onChange={event => setKeyword(event.target.value)}
            placeholder="e.g. price"
            className="mt-2 w-full rounded-sm bg-card py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        <label className="block p-4">
          <span className="text-xs font-medium text-muted-foreground">Send this reply</span>
          <textarea
            required
            maxLength={1000}
            rows={3}
            value={answer}
            onChange={event => setAnswer(event.target.value)}
            placeholder="Our plans start at ₹499. Here’s the link…"
            className="mt-2 w-full resize-y rounded-sm bg-card py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
      </div>

      <div className="flex items-center justify-between gap-4 border-t border-border px-4 py-3">
        <p className="text-xs text-muted-foreground">
          {source === "comment"
            ? selectedMediaId
              ? "Triggers on selected post only · Reply sent by DM"
              : "Triggers on any post or reel · Reply sent by DM"
            : source === "story"
            ? "Matches keywords in story replies"
            : "Matches keywords in incoming DMs"}
        </p>
        <button
          disabled={saving || !keyword.trim() || !answer.trim()}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {saving && <Loader2 className="size-4 animate-spin" />}
          {saving ? "Saving…" : "Save reply"}
        </button>
      </div>
      {error && <p role="alert" className="px-4 pb-3 text-sm text-destructive">{error}</p>}
    </fieldset>
  </form>
}
