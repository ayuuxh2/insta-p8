-- =========================================================================
-- Etapa 3 — anti-spam: idempotency, hourly send limit, queue, contacts/opt-out.
-- Safe to run more than once. Run in Supabase -> SQL Editor.
-- =========================================================================

-- One row per webhook event already handled (comment id, message mid).
-- Meta retries deliveries; inserting first and skipping on conflict
-- guarantees we never answer the same event twice.
CREATE TABLE IF NOT EXISTS public.processed_events (
  event_key TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_processed_events_created ON public.processed_events(created_at);

-- Every message we send, to enforce Instagram's hourly limits.
CREATE TABLE IF NOT EXISTS public.send_log (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, -- 'private_reply' | 'dm' | 'public_reply'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_send_log_user_kind_created ON public.send_log(user_id, kind, created_at);

-- Comments that arrived while the hourly limit was reached. Drained later
-- (private replies stay valid for 7 days after the comment).
CREATE TABLE IF NOT EXISTS public.pending_replies (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  automation_id UUID NOT NULL REFERENCES public.automations(id) ON DELETE CASCADE,
  comment_id TEXT NOT NULL UNIQUE,
  sender_id TEXT NOT NULL,
  comment_created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pending_replies_user_created ON public.pending_replies(user_id, created_at);

-- People who interacted with the account (base for the contacts screen).
CREATE TABLE IF NOT EXISTS public.contacts (
  user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  ig_id TEXT NOT NULL,
  username TEXT,
  opted_out BOOLEAN NOT NULL DEFAULT FALSE,
  opted_out_at TIMESTAMPTZ,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, ig_id)
);

-- Server-only tables: RLS on, no policies -> the public anon key cannot read them.
ALTER TABLE public.processed_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.send_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pending_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
