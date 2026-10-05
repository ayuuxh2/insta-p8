-- =========================================================================
-- Reels de teste (Trial Reels): mostrados primeiro só para quem não segue a conta;
-- o Instagram os mostra aos seguidores automaticamente se forem bem.
-- Safe to run more than once. Run in Supabase -> SQL Editor.
-- =========================================================================

ALTER TABLE public.scheduled_posts ADD COLUMN IF NOT EXISTS trial BOOLEAN NOT NULL DEFAULT FALSE;
