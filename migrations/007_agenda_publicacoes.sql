-- =========================================================================
-- Agenda de publicações — fila de Reels, carrosséis e Stories publicados
-- automaticamente por /api/cron/publish (chamado a cada 10 min pelo GitHub Actions).
-- Safe to run more than once. Run in Supabase -> SQL Editor.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.scheduled_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  -- reel | carousel | image | story
  kind TEXT NOT NULL CHECK (kind IN ('reel', 'carousel', 'image', 'story')),
  label TEXT NOT NULL DEFAULT '',
  batch TEXT NOT NULL DEFAULT '',
  scheduled_at TIMESTAMPTZ NOT NULL,
  -- pending → processing (container created) → published | failed | canceled
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'published', 'failed', 'canceled')),
  media_paths TEXT[] NOT NULL DEFAULT '{}',
  cover_path TEXT,
  caption TEXT NOT NULL DEFAULT '',
  -- Body for the comment/story-reply rule created after publishing (same fields as /api/agent/rules), or null.
  rule JSONB,
  container_id TEXT,
  media_id TEXT,
  permalink TEXT,
  rule_id UUID,
  attempts INT NOT NULL DEFAULT 0,
  error TEXT,
  processing_since TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_posts_due ON public.scheduled_posts(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_user ON public.scheduled_posts(user_id, scheduled_at DESC);

-- Only the server (service role) touches this table.
ALTER TABLE public.scheduled_posts ENABLE ROW LEVEL SECURITY;
