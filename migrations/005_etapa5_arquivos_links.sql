-- =========================================================================
-- Etapa 5 — file delivery and tracked links.
-- Safe to run more than once. Run in Supabase -> SQL Editor.
-- Requires migrations/004_etapa4_contatos.sql.
-- =========================================================================

-- Private bucket: files are only reachable through short-lived signed URLs
-- created by the server when someone opens a tracked link. 50 MB per file.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('arquivos', 'arquivos', false, 52428800)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 52428800;

CREATE TABLE IF NOT EXISTS public.files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  storage_path TEXT NOT NULL UNIQUE,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  mime_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_files_user_created ON public.files(user_id, created_at DESC);
ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;

-- One short link per delivered URL/file per person, so clicks are attributed.
CREATE TABLE IF NOT EXISTS public.tracked_links (
  code TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  automation_id UUID REFERENCES public.automations(id) ON DELETE SET NULL,
  ig_id TEXT,
  target_url TEXT,
  file_id UUID REFERENCES public.files(id) ON DELETE CASCADE,
  clicks INTEGER NOT NULL DEFAULT 0,
  first_click_at TIMESTAMPTZ,
  last_click_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (target_url IS NOT NULL OR file_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_tracked_links_user_created ON public.tracked_links(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tracked_links_automation ON public.tracked_links(automation_id);
ALTER TABLE public.tracked_links ENABLE ROW LEVEL SECURITY;

-- Atomic click counter.
CREATE OR REPLACE FUNCTION public.register_link_click(p_code TEXT)
RETURNS VOID
LANGUAGE sql
AS $$
  UPDATE public.tracked_links
     SET clicks = clicks + 1,
         first_click_at = COALESCE(first_click_at, NOW()),
         last_click_at = NOW()
   WHERE code = p_code;
$$;
REVOKE EXECUTE ON FUNCTION public.register_link_click(TEXT) FROM PUBLIC, anon, authenticated;
