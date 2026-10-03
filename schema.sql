-- Supabase Database Schema — Insta-P8
-- This file is the canonical source of truth for the database structure.
-- Run it directly in the Supabase SQL editor, or let the migration runner
-- (`lib/supabase-migrate.ts`) sync it automatically on deploy.
--
-- Auto-migration scope (lib/supabase-migrate.ts handles on every cold start):
--   * CREATE TABLE IF NOT EXISTS
--   * CREATE INDEX IF NOT EXISTS
--   * CREATE EXTENSION IF NOT EXISTS
--
-- Manual one-time setup (apply via Supabase SQL editor -- anon role required):
--   * CREATE POLICY (RLS)
--   * ALTER TABLE ... ENABLE ROW LEVEL SECURITY
--   * CREATE OR REPLACE FUNCTION (RPCs)
--
-- Design rules:
--   * Every CREATE uses IF NOT EXISTS — safe to re-run.
--   * No DROP TABLE statements anywhere. Existing data is preserved.
--   * Additive changes only. New columns get DEFAULT values.

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==========================================
-- 1. Table: public.users
-- ==========================================
CREATE TABLE IF NOT EXISTS public.users (
  id BIGINT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  access_token TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ,
  business_account_id BIGINT,
  page_id TEXT,
  groq_auto_reply_enabled BOOLEAN DEFAULT FALSE,
  ai_context TEXT DEFAULT NULL,
  groq_api_key TEXT DEFAULT NULL,
  ai_base_url TEXT DEFAULT NULL,
  ai_model TEXT DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- 2. Table: public.conversations
-- ==========================================
CREATE TABLE IF NOT EXISTS public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  recipient_id TEXT NOT NULL,
  recipient_username TEXT NOT NULL,
  last_message_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, recipient_id)
);

-- ==========================================
-- 3. Table: public.messages
-- ==========================================
CREATE TABLE IF NOT EXISTS public.messages (
  id TEXT PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL,
  sender_username TEXT NOT NULL,
  content TEXT NOT NULL,
  is_from_instagram BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- 4. Table: public.webhook_events
-- ==========================================
CREATE TABLE IF NOT EXISTS public.webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  user_id BIGINT,
  data JSONB,
  processed_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- 5. Table: public.automations
-- ==========================================
CREATE TABLE IF NOT EXISTS public.automations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  trigger_value TEXT NOT NULL,
  response_type TEXT DEFAULT 'text'::text,
  response_content JSONB,
  media_selection JSONB,
  selected_reel_id TEXT,
  specific_media_id TEXT,
  trigger_source TEXT NOT NULL DEFAULT 'comment' CHECK (trigger_source IN ('comment', 'dm', 'story')),
  follow_up_steps JSONB,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- 6. Table: public.media_cache
-- ==========================================
CREATE TABLE IF NOT EXISTS public.media_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  media_id TEXT NOT NULL,
  media_type TEXT NOT NULL,
  caption TEXT,
  image_url TEXT,
  video_url TEXT,
  permalink TEXT,
  media_product_type TEXT,
  timestamp TIMESTAMPTZ,
  cached_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, media_id)
);

-- ==========================================
-- 7. Table: public.ice_breakers
-- ==========================================
CREATE TABLE IF NOT EXISTS public.ice_breakers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  response TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- 8. Table: public.content_pool
-- ==========================================
CREATE TABLE IF NOT EXISTS public.content_pool (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  video_url TEXT NOT NULL,
  caption TEXT,
  cover_url TEXT,
  sequence_index SERIAL,
  thumbnail_url TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  automation_template JSONB
);

-- ==========================================
-- 9. Table: public.scheduler_config
-- ==========================================
CREATE TABLE IF NOT EXISTS public.scheduler_config (
  user_id BIGINT PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  interval_minutes INTEGER NOT NULL DEFAULT 240,
  start_time TIME DEFAULT '09:00:00'::TIME WITHOUT TIME ZONE,
  end_time TIME DEFAULT '21:00:00'::TIME WITHOUT TIME ZONE,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  current_sequence_index INTEGER DEFAULT 1,
  is_running BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- 10. Table: public.reels_posts
-- ==========================================
CREATE TABLE IF NOT EXISTS public.reels_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  content_pool_id UUID REFERENCES public.content_pool(id) ON DELETE SET NULL,
  video_url TEXT NOT NULL,
  caption TEXT,
  ig_container_id TEXT,
  ig_media_id TEXT,
  status TEXT DEFAULT 'PENDING'::text,
  error_message TEXT,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- 11. Table: public.dm_queue
-- ==========================================
CREATE TABLE IF NOT EXISTS public.dm_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  access_token TEXT NOT NULL,
  message TEXT NOT NULL,
  send_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'::text,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ==========================================
-- 12. Table: public.unlock_attempts
-- Purpose: Persistent counter so the 3-attempt gate cap works across
-- serverless Vercel instances. Each Vercel invocation has its own JS
-- memory, so without this table the in-Map would reset between requests
-- and the user could spam the gate card indefinitely.
-- The bump_unlock_attempt RPC (defined below) increments the counter
-- atomically to avoid races between concurrent invocations.
-- ==========================================
CREATE TABLE IF NOT EXISTS public.unlock_attempts (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- Indexes for performance
-- ==========================================
CREATE INDEX IF NOT EXISTS idx_automations_trigger_source ON public.automations(trigger_source);
CREATE INDEX IF NOT EXISTS idx_automations_user_source ON public.automations(user_id, trigger_source);
CREATE INDEX IF NOT EXISTS idx_content_pool_user_sequence ON public.content_pool(user_id, sequence_index);
CREATE INDEX IF NOT EXISTS idx_scheduler_next_run ON public.scheduler_config(next_run_at);
CREATE INDEX IF NOT EXISTS idx_reels_posts_user_status ON public.reels_posts(user_id, status);
CREATE INDEX IF NOT EXISTS idx_unlock_attempts_updated ON public.unlock_attempts(updated_at);

-- ==========================================
-- Storage
-- ==========================================
-- No public storage policies: anonymous visitors must not upload or delete
-- files. Uploads go through the server (service-role key) and downloads use
-- signed URLs. Remove the open policies created by older versions of this file.
DROP POLICY IF EXISTS "Public Uploads" ON storage.objects;
DROP POLICY IF EXISTS "Public Viewing" ON storage.objects;
DROP POLICY IF EXISTS "Public Deletion" ON storage.objects;

-- =========================================================================
-- SECURITY: Row Level Security (RLS) for public schema tables
--
-- Service-role key (server-side) bypasses RLS, so this only restricts the
-- anon role. The frontend uses the anon key via Supabase Auth to read its
-- own data after sign-in. The policies below enforce per-user ownership
-- for every table that has user_id.
--
-- Tables WITHOUT user_id (webhook_events, unlock_attempts) deny all anon
-- access by default; only the service-role key can read them.
-- =========================================================================

-- ---------- Per-user policies ----------

-- Drop in case of re-run
DROP POLICY IF EXISTS "users_select_own" ON public.users;
DROP POLICY IF EXISTS "conversations_select_own" ON public.conversations;
DROP POLICY IF EXISTS "conversations_insert_own" ON public.conversations;
DROP POLICY IF EXISTS "conversations_update_own" ON public.conversations;
DROP POLICY IF EXISTS "messages_select_own" ON public.messages;
DROP POLICY IF EXISTS "messages_insert_own" ON public.messages;
DROP POLICY IF EXISTS "automations_select_own" ON public.automations;
DROP POLICY IF EXISTS "automations_insert_own" ON public.automations;
DROP POLICY IF EXISTS "automations_update_own" ON public.automations;
DROP POLICY IF EXISTS "automations_delete_own" ON public.automations;
DROP POLICY IF EXISTS "media_cache_select_own" ON public.media_cache;
DROP POLICY IF EXISTS "ice_breakers_select_own" ON public.ice_breakers;
DROP POLICY IF EXISTS "ice_breakers_insert_own" ON public.ice_breakers;
DROP POLICY IF EXISTS "ice_breakers_update_own" ON public.ice_breakers;
DROP POLICY IF EXISTS "ice_breakers_delete_own" ON public.ice_breakers;
DROP POLICY IF EXISTS "content_pool_select_own" ON public.content_pool;
DROP POLICY IF EXISTS "content_pool_insert_own" ON public.content_pool;
DROP POLICY IF EXISTS "content_pool_update_own" ON public.content_pool;
DROP POLICY IF EXISTS "content_pool_delete_own" ON public.content_pool;
DROP POLICY IF EXISTS "scheduler_config_select_own" ON public.scheduler_config;
DROP POLICY IF EXISTS "scheduler_config_upsert_own" ON public.scheduler_config;
DROP POLICY IF EXISTS "reels_posts_select_own" ON public.reels_posts;
DROP POLICY IF EXISTS "reels_posts_insert_own" ON public.reels_posts;
DROP POLICY IF EXISTS "reels_posts_update_own" ON public.reels_posts;
DROP POLICY IF EXISTS "dm_queue_select_own" ON public.dm_queue;

-- users: a row is visible only to its own authenticated user (id matches)
CREATE POLICY "users_select_own" ON public.users
  FOR SELECT TO anon, authenticated
  USING (id = (current_setting('request.jwt.claims', true)::json->>'sub')::bigint);

-- conversations: anyone signed-in can see their own conversations
CREATE POLICY "conversations_select_own" ON public.conversations
  FOR SELECT TO anon, authenticated
  USING (user_id = (current_setting('request.jwt.claims', true)::json->>'sub')::bigint);
CREATE POLICY "conversations_insert_own" ON public.conversations
  FOR INSERT TO anon, authenticated
  WITH CHECK (user_id = (current_setting('request.jwt.claims', true)::json->>'sub')::bigint);
CREATE POLICY "conversations_update_own" ON public.conversations
  FOR UPDATE TO anon, authenticated
  USING (user_id = (current_setting('request.jwt.claims', true)::json->>'sub')::bigint);

-- messages: visible only to the owner of the conversation
CREATE POLICY "messages_select_own" ON public.messages
  FOR SELECT TO anon, authenticated
  USING (user_id = (current_setting('request.jwt.claims', true)::json->>'sub')::bigint);
CREATE POLICY "messages_insert_own" ON public.messages
  FOR INSERT TO anon, authenticated
  WITH CHECK (user_id = (current_setting('request.jwt.claims', true)::json->>'sub')::bigint);

-- automations
CREATE POLICY "automations_select_own" ON public.automations
  FOR SELECT TO anon, authenticated
  USING (user_id = (current_setting('request.jwt.claims', true)::json->>'sub')::bigint);
CREATE POLICY "automations_insert_own" ON public.automations
  FOR INSERT TO anon, authenticated
  WITH CHECK (user_id = (current_setting('request.jwt.claims', true)::json->>'sub')::bigint);
CREATE POLICY "automations_update_own" ON public.automations
  FOR UPDATE TO anon, authenticated
  USING (user_id = (current_setting('request.jwt.claims', true)::json->>'sub')::bigint);
CREATE POLICY "automations_delete_own" ON public.automations
  FOR DELETE TO anon, authenticated
  USING (user_id = (current_setting('request.jwt.claims', true)::json->>'sub')::bigint);

-- media_cache
CREATE POLICY "media_cache_select_own" ON public.media_cache
  FOR SELECT TO anon, authenticated
  USING (user_id = (current_setting('request.jwt.claims', true)::json->>'sub')::bigint);

-- ice_breakers
CREATE POLICY "ice_breakers_select_own" ON public.ice_breakers
  FOR SELECT TO anon, authenticated
  USING (user_id = (current_setting('request.jwt.claims', true)::json->>'sub')::bigint);
CREATE POLICY "ice_breakers_insert_own" ON public.ice_breakers
  FOR INSERT TO anon, authenticated
  WITH CHECK (user_id = (current_setting('request.jwt.claims', true)::json->>'sub')::bigint);
CREATE POLICY "ice_breakers_update_own" ON public.ice_breakers
  FOR UPDATE TO anon, authenticated
  USING (user_id = (current_setting('request.jwt.claims', true)::json->>'sub')::bigint);
CREATE POLICY "ice_breakers_delete_own" ON public.ice_breakers
  FOR DELETE TO anon, authenticated
  USING (user_id = (current_setting('request.jwt.claims', true)::json->>'sub')::bigint);

-- content_pool
CREATE POLICY "content_pool_select_own" ON public.content_pool
  FOR SELECT TO anon, authenticated
  USING (user_id = (current_setting('request.jwt.claims', true)::json->>'sub')::bigint);
CREATE POLICY "content_pool_insert_own" ON public.content_pool
  FOR INSERT TO anon, authenticated
  WITH CHECK (user_id = (current_setting('request.jwt.claims', true)::json->>'sub')::bigint);
CREATE POLICY "content_pool_update_own" ON public.content_pool
  FOR UPDATE TO anon, authenticated
  USING (user_id = (current_setting('request.jwt.claims', true)::json->>'sub')::bigint);
CREATE POLICY "content_pool_delete_own" ON public.content_pool
  FOR DELETE TO anon, authenticated
  USING (user_id = (current_setting('request.jwt.claims', true)::json->>'sub')::bigint);

-- scheduler_config
CREATE POLICY "scheduler_config_select_own" ON public.scheduler_config
  FOR SELECT TO anon, authenticated
  USING (user_id = (current_setting('request.jwt.claims', true)::json->>'sub')::bigint);
CREATE POLICY "scheduler_config_upsert_own" ON public.scheduler_config
  FOR ALL TO anon, authenticated
  USING (user_id = (current_setting('request.jwt.claims', true)::json->>'sub')::bigint);

-- reels_posts
CREATE POLICY "reels_posts_select_own" ON public.reels_posts
  FOR SELECT TO anon, authenticated
  USING (user_id = (current_setting('request.jwt.claims', true)::json->>'sub')::bigint);
CREATE POLICY "reels_posts_insert_own" ON public.reels_posts
  FOR INSERT TO anon, authenticated
  WITH CHECK (user_id = (current_setting('request.jwt.claims', true)::json->>'sub')::bigint);
CREATE POLICY "reels_posts_update_own" ON public.reels_posts
  FOR UPDATE TO anon, authenticated
  USING (user_id = (current_setting('request.jwt.claims', true)::json->>'sub')::bigint);

-- dm_queue
CREATE POLICY "dm_queue_select_own" ON public.dm_queue
  FOR SELECT TO anon, authenticated
  USING (user_id = (current_setting('request.jwt.claims', true)::json->>'sub')::text);

-- Now enable RLS on every table. With policies above, anon reads are
-- either per-user (ownership check) or denied (no policies defined).
-- Service-role key bypasses RLS for the server-side routes.
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ice_breakers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_pool ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduler_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reels_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dm_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unlock_attempts ENABLE ROW LEVEL SECURITY;

-- =========================================================================
-- RPC: bump_unlock_attempt -- atomic increment with TTL reset
-- Replaces the read-modify-write pattern that lost concurrent attempts.
-- Concurrent invocations of the same key now serialize at the DB level
-- rather than at the JS level, so no bumps are ever lost.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.bump_unlock_attempt(p_key TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  INSERT INTO public.unlock_attempts (key, count, updated_at)
  VALUES (p_key, 1, NOW())
  ON CONFLICT (key) DO UPDATE
    SET count = public.unlock_attempts.count + 1,
        updated_at = NOW()
  RETURNING count INTO v_count;

  RETURN v_count;
END;
$$;

-- Only the server (service role) may call this; block the public anon key.
REVOKE EXECUTE ON FUNCTION public.bump_unlock_attempt(TEXT) FROM PUBLIC, anon, authenticated;

-- =========================================================================
-- Periodic cleanup of stale unlock_attempts (older than 24h).
-- Set up via Supabase pg_cron (Dashboard -> Database -> Extensions -> pg_cron), then:
--   SELECT cron.schedule('purge-unlock-attempts', '0 * * * *',
--     $$DELETE FROM public.unlock_attempts WHERE updated_at < NOW() - INTERVAL '24 hours'$$);
-- Or run manually in the SQL editor:
--   DELETE FROM public.unlock_attempts WHERE updated_at < NOW() - INTERVAL '24 hours';
-- =========================================================================

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
