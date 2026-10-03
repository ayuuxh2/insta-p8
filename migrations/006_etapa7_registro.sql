-- =========================================================================
-- Etapa 7 — event log (Preferências → Diagnóstico).
-- Safe to run more than once. Run in Supabase -> SQL Editor.
-- =========================================================================

-- webhook_events existed in the original schema but was never written to.
CREATE INDEX IF NOT EXISTS idx_webhook_events_user_processed ON public.webhook_events(user_id, processed_at DESC);
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;
