-- =========================================================================
-- Fluxos de conversa em etapas (ex.: RAIOX): o sistema faz uma pergunta por vez, guarda as respostas e,
-- no fim, registra um pedido. Um worker (skill) analisa o pedido e o sistema entrega o resultado na DM.
-- Safe to run more than once. Run in Supabase -> SQL Editor.
--
-- status:
--   coletando  → fazendo as perguntas (a próxima resposta é a etapa `step`)
--   pedido     → perguntas respondidas, esperando o worker
--   analisando → o worker pegou o pedido
--   entregue   → resultado enviado na DM
--   falhou     → não foi possível entregar (motivo em last_error); o dono recebe um aviso
--   cancelado  → a pessoa pediu para sair ou o fluxo foi reiniciado
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.lead_flows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  ig_id TEXT NOT NULL,
  username TEXT,
  automation_id UUID REFERENCES public.automations(id) ON DELETE SET NULL,
  flow TEXT NOT NULL,
  step INT NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'coletando'
    CHECK (status IN ('coletando', 'pedido', 'analisando', 'entregue', 'falhou', 'cancelado')),
  answers JSONB NOT NULL DEFAULT '[]'::jsonb,
  invalid_tries INT NOT NULL DEFAULT 0,
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  result_path TEXT,
  result_cover_path TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_inbound_at TIMESTAMPTZ,
  requested_at TIMESTAMPTZ,
  claimed_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Only one open flow per person and flow type.
CREATE UNIQUE INDEX IF NOT EXISTS uq_lead_flows_open
  ON public.lead_flows (user_id, ig_id, flow)
  WHERE status IN ('coletando', 'pedido', 'analisando');
CREATE INDEX IF NOT EXISTS idx_lead_flows_queue ON public.lead_flows (user_id, status, requested_at);
ALTER TABLE public.lead_flows ENABLE ROW LEVEL SECURITY;
