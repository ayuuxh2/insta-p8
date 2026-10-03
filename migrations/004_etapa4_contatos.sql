-- =========================================================================
-- Etapa 4 — base de contatos: follow status, tags, interaction history.
-- Safe to run more than once. Run in Supabase -> SQL Editor.
-- Requires migrations/003_etapa3_antispam.sql.
-- =========================================================================

ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS follows BOOLEAN;            -- null = not checked yet
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS follows_checked_at TIMESTAMPTZ;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS last_event TEXT;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS last_keyword TEXT;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS last_automation_id UUID;
CREATE INDEX IF NOT EXISTS idx_contacts_user_last_seen ON public.contacts(user_id, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_contacts_tags ON public.contacts USING GIN (tags);

-- Every interaction, for the contact history and the metrics funnel.
--   comment, dm, story, optin_tap, unlock_tap, content_sent, gate_sent, opt_out, opt_in, link_click
CREATE TABLE IF NOT EXISTS public.contact_events (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  ig_id TEXT NOT NULL,
  event TEXT NOT NULL,
  automation_id UUID REFERENCES public.automations(id) ON DELETE SET NULL,
  keyword TEXT,
  media_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contact_events_user_created ON public.contact_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_events_contact ON public.contact_events(user_id, ig_id, created_at DESC);
ALTER TABLE public.contact_events ENABLE ROW LEVEL SECURITY;

-- Adds tags without duplicates (used by rules with automatic tags).
CREATE OR REPLACE FUNCTION public.add_contact_tags(p_user_id BIGINT, p_ig_id TEXT, p_tags TEXT[])
RETURNS VOID
LANGUAGE sql
AS $$
  UPDATE public.contacts
     SET tags = ARRAY(SELECT DISTINCT unnest(tags || p_tags) ORDER BY 1)
   WHERE user_id = p_user_id AND ig_id = p_ig_id;
$$;
REVOKE EXECUTE ON FUNCTION public.add_contact_tags(BIGINT, TEXT, TEXT[]) FROM PUBLIC, anon, authenticated;

-- Contacts with their interaction count (what the Contacts screen lists).
CREATE OR REPLACE VIEW public.contacts_overview
WITH (security_invoker = true) AS
SELECT c.*,
       (SELECT COUNT(*) FROM public.contact_events e WHERE e.user_id = c.user_id AND e.ig_id = c.ig_id) AS interactions
  FROM public.contacts c;

-- Bring in people who already talked to the account before this table existed.
INSERT INTO public.contacts (user_id, ig_id, username, first_seen_at, last_seen_at, last_event)
SELECT user_id, recipient_id, NULLIF(recipient_username, ''), COALESCE(created_at, NOW()), COALESCE(last_message_at, NOW()), 'dm'
  FROM public.conversations
ON CONFLICT (user_id, ig_id) DO NOTHING;
