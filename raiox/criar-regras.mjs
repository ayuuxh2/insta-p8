// Cria (ou atualiza) as regras RAIOX da conta @cloviseduardo: comentário e Direct com a palavra RAIOX.
// Rode DEPOIS da migração 010 (tabela lead_flows):  node raiox/criar-regras.mjs
import { createRequire } from "node:module"
import { readEnv } from "../conteudo/kit/common.mjs"

const require = createRequire(import.meta.url)
const { createClient } = require("@supabase/supabase-js")
const env = readEnv()
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const USERNAME = (process.argv[2] || "cloviseduardo").replace(/^@/, "")
const { data: user } = await db.from("users").select("id, username").eq("username", USERNAME).maybeSingle()
if (!user) throw new Error(`Conta @${USERNAME} não está conectada`)

const { error: probe } = await db.from("lead_flows").select("id").limit(1)
if (probe) throw new Error(`A tabela lead_flows não existe: rode a migração 010 no Supabase antes. (${probe.message})`)

const content = {
  direct_send: true,
  check_follow: false,
  reply_mode: "both",
  message:
    "Oi! Vou montar o seu Raio-X de anúncios, gratuito. Para começar, me manda o @ do Instagram ou o site do seu negócio.",
  public_replies: ["Te mandei no direct.", "Já te chamei no direct.", "Olha o direct, te mandei uma mensagem."],
  add_tags: ["raiox"],
  flow: {
    id: "raiox",
    followups: [
      "Você já anuncia hoje? Se sim, quanto investe por mês, mais ou menos?",
      "E qual é o seu maior objetivo agora: mais clientes, mais pedidos de orçamento ou vender um produto específico?",
    ],
    validate_first: "contact",
    retry_message: "Não consegui identificar o negócio. Me manda o @ do Instagram (por exemplo @minhaloja) ou o endereço do site.",
    done_message:
      "Recebi tudo. Vou analisar o perfil e o site e te mando o seu Raio-X por aqui, em PDF. Se algum ponto eu não conseguir ler, eu te aviso qual foi.",
    done_tag: "raiox-pedido",
    notify: true,
    notify_title: "Novo pedido de Raio-X",
    labels: ["Perfil/site", "Anuncia e investimento", "Objetivo"],
  },
}

const rules = [
  { name: "RAIOX: comentário", trigger_source: "comment", trigger_type: "keyword" },
  { name: "RAIOX: Direct", trigger_source: "dm", trigger_type: "keyword" },
]
for (const r of rules) {
  const row = { user_id: user.id, ...r, trigger_value: "raiox, raio-x, raio x", response_type: "pro", response_content: content, is_active: true, specific_media_id: null }
  const { data: existing } = await db.from("automations").select("id").eq("user_id", user.id).eq("name", r.name).maybeSingle()
  const { error } = existing
    ? await db.from("automations").update({ ...row, updated_at: new Date().toISOString() }).eq("id", existing.id)
    : await db.from("automations").insert(row)
  if (error) throw new Error(`${r.name}: ${error.message}`)
  console.log(`${existing ? "atualizada" : "criada"}: ${r.name}`)
}
