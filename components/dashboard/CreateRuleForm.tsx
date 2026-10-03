"use client"

import { useState, useEffect, useMemo } from "react"
import {
  Plus, Trash2, Film, Check, MessageCircle, Send, AtSign, Heart,
  MessageSquare, Image as ImageIcon, Timer, Eye, Megaphone, Lock,
  Link2, Zap, ChevronDown, ChevronRight, ChevronLeft, X, Loader2,
  ArrowLeft, Phone, Video, Info, Sparkles, Smile, Camera, Mic, Image as PicIcon,
  Globe
} from "lucide-react"
import { TagInput } from "@/components/ui/tag-input"
import type { ProButton, QuickReplyOption, Automation } from "@/lib/types"
import { toast } from "sonner"

/* ============================================================
   AESTHETIC & SEXY WIZARD FOR INSTAGRAM AUTOMATION RULES
   Step 1: TRIGGER  — Select Reel/Post first, then set keywords
   Step 2: RESPONSE — What do they get?
   Step 3: SETTINGS — Name it & delivery options
   ============================================================ */

interface CreateRuleFormProps {
  userId: string
  triggerSource: "comment" | "dm" | "story"
  onSuccess: () => void
  editRule?: Automation | null
}

const STEPS = [
  { key: "trigger", label: "Gatilho", sub: "Escolha o que inicia" },
  { key: "response", label: "Resposta", sub: "Escreva o que a pessoa recebe" },
  { key: "settings", label: "Revisar", sub: "Dê um nome e publique" },
] as const

export function CreateRuleForm({ userId, triggerSource, onSuccess, editRule }: CreateRuleFormProps) {
  const isEditing = !!editRule
  const [step, setStep] = useState(0)

  /* ---------- WHEN ---------- */
  const [triggers, setTriggers] = useState<string[]>([])
  const [storyTriggerType, setStoryTriggerType] = useState<"mention" | "reaction" | "reply">("mention")
  const [selectedReel, setSelectedReel] = useState<any | null>(null)
  const [hasSelectedReelOption, setHasSelectedReelOption] = useState<boolean>(false)

  /* ---------- THEN ---------- */
  const [type, setType] = useState<"text" | "card" | "media">("text")
  const [messageText, setMessageText] = useState("")
  const [cardTitle, setCardTitle] = useState("")
  const [cardSubtitle, setCardSubtitle] = useState("")
  const [cardImage, setCardImage] = useState("")
  const [buttons, setButtons] = useState<ProButton[]>([])
  const [mediaUrl, setMediaUrl] = useState("")
  const [mediaType, setMediaType] = useState<"image" | "video" | "audio">("image")
  const [quickReplies, setQuickReplies] = useState<QuickReplyOption[]>([])

  /* ---------- Public comment reply ---------- */
  const [replyMode, setReplyMode] = useState<"both" | "dm_only" | "public_only">("both")
  const [publicReplies, setPublicReplies] = useState<string[]>([])
  const [includeReplies, setIncludeReplies] = useState(false)

  /* ---------- EXTRAS ---------- */
  const [name, setName] = useState("")
  const [checkFollow, setCheckFollow] = useState(false)
  // Texts of the "Quero receber" card sent as a private reply on follow-gated comment rules.
  const [optinTitle, setOptinTitle] = useState("")
  const [optinSubtitle, setOptinSubtitle] = useState("")
  const [optinButton, setOptinButton] = useState("")
  // Comment rules send the "Quero receber" card first unless this is on (single message, no button).
  const [directSend, setDirectSend] = useState(false)
  const [messageVariants, setMessageVariants] = useState<string[]>([])
  const [delaySeconds, setDelaySeconds] = useState(0)
  const [typingIndicator, setTypingIndicator] = useState(false)

  const [saving, setSaving] = useState(false)
  const [reels, setReels] = useState<any[]>([])
  const [loadingReels, setLoadingReels] = useState(false)

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    setLoadingReels(true)
    fetch(`/api/instagram/media?userId=${userId}`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return
        const list = j.data && Array.isArray(j.data) ? j.data : Array.isArray(j) ? j : []
        setReels(list)
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoadingReels(false))
    return () => { cancelled = true }
  }, [userId])

  /* Prefill on edit */
  useEffect(() => {
    if (!editRule) return
    const content: any =
      typeof editRule.response_content === "string"
        ? JSON.parse(editRule.response_content as any)
        : editRule.response_content || {}

    setName(editRule.name)
    if (["mention", "reaction", "reply"].includes(editRule.trigger_type)) {
      setStoryTriggerType(editRule.trigger_type as any)
    }
    const rawTriggers = (editRule.trigger_value || "")
      .split(",").map((t) => t.trim())
      .filter((t) => t && !["ALL", "ALL_COMMENTS", "ALL_MENTIONS", "ALL_REACTIONS"].includes(t.toUpperCase()))
    setTriggers(rawTriggers)

    if (content.media?.url) {
      setType("media"); setMediaUrl(content.media.url); setMediaType(content.media.type || "image"); setMessageText(content.message || "")
    } else if (content.card) {
      setType("card"); setCardTitle(content.card.title || ""); setCardSubtitle(content.card.subtitle || ""); setCardImage(content.card.image_url || "")
      setButtons((content.card.buttons || []).map((b: any, i: number) => ({ id: `${Date.now()}_${i}`, ...b })))
    } else {
      setType("text"); setMessageText(content.message || "")
    }
    setQuickReplies((content.quick_replies || []).map((q: any, i: number) => ({ id: `${Date.now()}_qr${i}`, title: q.title, payload: q.payload })))
    setReplyMode(content.reply_mode || "both")
    setPublicReplies(content.public_replies || [])
    setIncludeReplies(content.include_replies === true)
    setCheckFollow(content.check_follow === true)
    setOptinTitle(content.optin_title || "")
    setOptinSubtitle(content.optin_subtitle || "")
    setOptinButton(content.optin_button || "")
    setDirectSend(content.direct_send === true)
    setMessageVariants(Array.isArray(content.message_variants) ? content.message_variants : [])
    setDelaySeconds(Number(content.delay_seconds) || 0)
    setTypingIndicator(content.typing_indicator === true)
    
    if (editRule.specific_media_id) {
      setSelectedReel({ id: editRule.specific_media_id, caption: "Post selecionado" })
      setHasSelectedReelOption(true)
    } else {
      setHasSelectedReelOption(false)
    }
  }, [editRule])

  /* Auto name */
  useEffect(() => {
    if (name || isEditing) return
    const isReplyAll = triggerSource === "comment" && triggers.length === 0
    if (isReplyAll) setName("Responder a todos os comentários")
    else if (triggers.length > 0) setName(`Responder "${triggers[0]}"`)
  }, [triggers, name, isEditing, triggerSource])

  /* ---------- helpers ---------- */
  const addButton = () => {
    if (buttons.length >= 3) return
    setButtons([...buttons, { id: Date.now().toString(), type: "web_url", title: "", url: "", payload: "" }])
  }
  const updateButton = (id: string, field: keyof ProButton, value: string) =>
    setButtons(buttons.map((b) => (b.id === id ? { ...b, [field]: value } : b)))
  const removeButton = (id: string) => setButtons(buttons.filter((b) => b.id !== id))

  const addQuickReply = () => {
    if (quickReplies.length >= 4) return
    setQuickReplies([...quickReplies, { id: Date.now().toString(), title: "" }])
  }
  const updateQuickReply = (id: string, title: string) =>
    setQuickReplies(quickReplies.map((q) => (q.id === id ? { ...q, title } : q)))
  const removeQuickReply = (id: string) => setQuickReplies(quickReplies.filter((q) => q.id !== id))

  const needsKeywords = triggerSource === "dm" || (triggerSource === "story" && storyTriggerType !== "mention")

  const whenValid = triggerSource === "comment" 
    ? hasSelectedReelOption // Comment trigger is valid once they select a specific post or global option
    : !needsKeywords || triggers.length > 0

  const thenValid =
    replyMode === "public_only" ||
    (type === "text" ? messageText.trim().length > 0 : type === "card" ? cardTitle.trim().length > 0 : mediaUrl.trim().length > 0)
  const canSave = whenValid && thenValid && name.trim().length > 0

  const stepValid = [
    whenValid,  // step 0
    thenValid,  // step 1
    name.trim().length > 0, // step 2
  ]
  const sourceLabel = triggerSource === "comment" ? "um comentário" : triggerSource === "dm" ? "uma mensagem direta" : "um story"
  const validationHint = step === 0
    ? triggerSource === "comment" && !hasSelectedReelOption ? "Escolha um post, um reel ou Todos os posts para continuar." : needsKeywords && triggers.length === 0 ? "Adicione pelo menos uma palavra-chave para continuar." : ""
    : step === 1 && !thenValid ? "Escreva a resposta que a pessoa vai receber." : step === 2 && !name.trim() ? "Dê um nome para esta resposta automática antes de publicar." : ""

  /* Plain-language summary sentence */
  const summary = useMemo(() => {
    const isReplyAll = triggerSource === "comment" && triggers.length === 0
    const who =
      triggerSource === "comment"
        ? isReplyAll ? "alguém comentar no seu post" : `alguém comentar ${triggers.length ? `"${triggers[0]}"` : "uma palavra-chave"}`
        : triggerSource === "dm"
          ? `alguém te mandar ${triggers.length ? `"${triggers[0]}"` : "uma palavra-chave"} na DM`
          : storyTriggerType === "mention" ? "alguém te mencionar em um story"
            : storyTriggerType === "reaction" ? "alguém reagir ao seu story"
              : "alguém responder ao seu story"
    const what =
      replyMode === "public_only" ? "responder no comentário"
        : type === "card" ? "enviar um cartão com botões"
          : type === "media" ? (mediaType === "image" ? "enviar uma imagem" : mediaType === "video" ? "enviar um vídeo" : "enviar um áudio")
            : "enviar uma DM"
    return { who, what }
  }, [triggerSource, triggers, storyTriggerType, replyMode, type, mediaType])

  /* ---------- save ---------- */
  const handleSubmit = async () => {
    if (!canSave || saving) return
    setSaving(true)

    const isReplyAll = triggerSource === "comment" && triggers.length === 0

    const content: any = { check_follow: checkFollow }
    if (delaySeconds > 0) content.delay_seconds = delaySeconds
    if (typingIndicator) content.typing_indicator = true
    if (triggerSource === "comment") {
      content.reply_mode = replyMode
      if (publicReplies.length > 0) content.public_replies = publicReplies
      if (includeReplies) content.include_replies = true
      if (directSend && !checkFollow) content.direct_send = true
      if (checkFollow || !directSend) {
        if (optinTitle.trim()) content.optin_title = optinTitle.trim()
        if (optinSubtitle.trim()) content.optin_subtitle = optinSubtitle.trim()
        if (optinButton.trim()) content.optin_button = optinButton.trim()
      }
    }
    if (quickReplies.filter((q) => q.title.trim()).length > 0) {
      content.quick_replies = quickReplies.filter((q) => q.title.trim()).map((q) => ({ title: q.title.trim(), payload: q.payload }))
    }

    if (type === "text") {
      content.message = messageText
      const variants = messageVariants.map((v) => v.trim()).filter(Boolean)
      if (variants.length) content.message_variants = variants
    } else if (type === "media") {
      content.media = { type: mediaType, url: mediaUrl.trim() }
      if (messageText.trim()) content.message = messageText
    } else {
      const cleanButtons = buttons
        .map((b) => {
          if (b.type === "web_url") {
            let cleanUrl = b.url?.trim() || ""
            if (cleanUrl.startsWith("https://https://")) cleanUrl = cleanUrl.replace("https://https://", "https://")
            return { type: "web_url" as const, title: b.title, url: cleanUrl }
          }
          return { type: "postback" as const, title: b.title, payload: b.payload }
        })
        .filter((b) => b.title)
      content.card = { title: cardTitle, subtitle: cardSubtitle || undefined, image_url: cardImage || undefined, buttons: cleanButtons }
    }

    const payload = {
      userId,
      name,
      trigger_source: triggerSource,
      trigger_type: isReplyAll ? "reply_all" : triggerSource === "story" ? storyTriggerType : "keyword",
      trigger_value: isReplyAll ? "ALL_COMMENTS"
        : triggerSource === "story" && storyTriggerType === "mention" ? "ALL_MENTIONS"
          : triggerSource === "story" && storyTriggerType === "reaction" && triggers.length === 0 ? "ALL_REACTIONS"
            : triggers.length > 0 ? triggers.join(", ") : "ALL",
      content,
      specific_media_id: selectedReel?.id || null,
    }

    try {
      const res = await fetch("/api/automations", {
        method: isEditing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isEditing ? { ...payload, id: editRule!.id } : payload),
      })
      if (res.ok) {
        toast.success(isEditing ? "Resposta automática atualizada" : "Resposta automática ativada")
        onSuccess()
      } else {
        toast.error("Não foi possível salvar — tente de novo")
      }
    } catch {
      toast.error("Erro de conexão. Verifique sua internet.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="workflow-builder space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div><p className="text-xs text-muted-foreground">{isEditing ? "Editando resposta automática" : "Nova resposta automática"}</p><p className="mt-1 text-sm font-semibold">Começa com {sourceLabel} no Instagram</p></div>
        <span className="rounded-md bg-secondary px-2.5 py-1 text-xs font-medium">Etapa {step + 1} de {STEPS.length}</span>
      </div>
      {/* ── Sexy Stepper Timeline ── */}
      <div className="relative border-b border-border py-3">
        <div className="flex items-center justify-between gap-4 relative">
          {STEPS.map((s, i) => {
            const isActive = i === step
            const isCompleted = i < step
            return (
              <div key={s.key} className="flex items-center gap-3 flex-1 last:flex-initial">
                <button
                  type="button"
                  onClick={() => { if (i < step || stepValid[step]) setStep(i) }}
                  className="flex items-center gap-3 group text-left focus:outline-none"
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-semibold transition-colors ${
                    isCompleted
                      ? "bg-primary text-primary-foreground"
                      : isActive
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground border border-border"
                  }`}>
                    {isCompleted ? <Check className="w-4 h-4 stroke-[3]" /> : i + 1}
                  </div>
                  <div className="hidden md:block">
                    <p className={`text-xs font-semibold ${isActive ? "text-foreground" : "text-muted-foreground"}`}>
                      {s.label}
                    </p>
                    <p className="text-[10px] text-muted-foreground font-mono-ui">{s.sub}</p>
                  </div>
                </button>
                {i < STEPS.length - 1 && (
                  <div className="flex-1 h-[2px] mx-2 relative bg-muted rounded-full overflow-hidden">
                    <div className={`absolute inset-y-0 left-0 transition-all duration-300 bg-primary ${
                      isCompleted ? "w-full" : "w-0"
                    }`} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Two Column Workspace ── */}
      <div className={step === 1 && replyMode !== "public_only" ? "grid lg:grid-cols-[1fr_300px] xl:grid-cols-[1fr_340px] gap-6 xl:gap-8 items-start" : "grid grid-cols-1 gap-6 items-start"}>
        {/* ── LEFT: Config Form ── */}
        <div className="bg-card border border-border rounded-lg p-4 space-y-4 min-w-0">
          {/* ===== STEP 1: TRIGGER ===== */}
          {step === 0 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-2 duration-300">
              <StepHeader
                number={1}
                title={triggerSource === "comment" ? "Em qual post isso deve funcionar?" : triggerSource === "dm" ? "Quais mensagens ativam a resposta?" : "Qual ação no story ativa a resposta?"}
                description={triggerSource === "comment" ? "Escolha um post, um reel ou Todos os posts." : "Escolha o que faz esta resposta automática começar."}
              />

              {triggerSource === "story" && (
                <div className="space-y-3">
                  <FieldLabel>Escolha o tipo de interação no story</FieldLabel>
                  <div className="grid grid-cols-3 gap-3">
                    {([
                      { key: "mention" as const, icon: <AtSign className="w-5 h-5" />, label: "Me menciona", desc: "Marcou você no story" },
                      { key: "reaction" as const, icon: <Heart className="w-5 h-5" />, label: "Reage", desc: "Reagiu com emoji" },
                      { key: "reply" as const, icon: <MessageSquare className="w-5 h-5" />, label: "Responde", desc: "Respondeu o story com texto" },
                    ]).map(({ key, icon, label, desc }) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setStoryTriggerType(key)}
                        className={`p-4 rounded-xl border text-left flex flex-col gap-2 transition-all duration-200 ${
                          storyTriggerType === key
                            ? "border-accent-yellow bg-accent-yellow/10 text-accent-yellow-foreground"
                            : "border-border text-muted-foreground hover:border-border hover:text-foreground bg-muted/30"
                        }`}
                      >
                        <span className={storyTriggerType === key ? "text-accent-yellow-foreground" : "text-muted-foreground"}>{icon}</span>
                        <div>
                          <p className="text-xs font-bold uppercase tracking-wider">{label}</p>
                          <p className="text-[10px] text-muted-foreground font-normal mt-0.5">{desc}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {triggerSource === "comment" && (
                <div className="space-y-4">
                  <FieldLabel>Em qual post ou reel?</FieldLabel>
                  {loadingReels ? (
                    <div className="p-8 flex flex-col items-center justify-center gap-3 border border-border rounded-2xl bg-white/[0.01]">
                      <Loader2 className="w-6 h-6 animate-spin text-accent-yellow-foreground" />
                      <span className="text-xs text-muted-foreground font-mono-ui">Carregando seus posts do Instagram...</span>
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 sm:grid-cols-3 gap-2 sm:gap-3 max-h-[55vh] sm:max-h-[420px] overflow-y-auto pr-1 pb-1">
                      {/* Option: Global Post Rule */}
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedReel(null)
                          setHasSelectedReelOption(true)
                        }}
                        className={`aspect-square rounded-xl border flex flex-col items-center justify-center p-2 sm:p-4 text-center transition-all duration-200 ${
                                                  hasSelectedReelOption && selectedReel === null
                                                    ? "border-accent-yellow ring-2 ring-accent-yellow/30 bg-accent-yellow/10"
                                                    : "border-border bg-card hover:border-foreground/30 hover:bg-accent"
                                                }`}
                                              >
                                                <Globe className="w-6 h-6 mb-2 text-accent-blue" />
                                                <span className="text-xs font-bold text-foreground">Todos os posts</span>
                                                <span className="text-[10px] text-muted-foreground mt-1 font-mono-ui">Posts e reels</span>
                                              </button>

                      {reels.map((reel) => {
                        const isSelected = hasSelectedReelOption && selectedReel?.id === reel.id
                        return (
                          <button
                            key={reel.id}
                            type="button"
                            onClick={() => {
                              setSelectedReel(reel)
                              setHasSelectedReelOption(true)
                            }}
                            className={`aspect-square rounded-xl border overflow-hidden relative group text-left transition-all duration-200 bg-neutral-900 ${
                                                        isSelected
                                                          ? "border-accent-yellow ring-2 ring-accent-yellow/30"
                                                          : "border-border hover:border-foreground/40"
                                                      }`}
                                                    >
                                                      {reel.image_url ? (
                                                        <img
                                                          src={reel.image_url}
                                                          alt=""
                                                          loading="lazy"
                                                          className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
                                                        />
                                                      ) : (
                                                        <div className="w-full h-full bg-neutral-900 flex items-center justify-center">
                                                          <Film className="w-6 h-6 text-neutral-500" />
                                                        </div>
                                                      )}

                                                      {/* Subtle dark gradient so caption + type pill stay readable in BOTH themes */}
                                                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent pointer-events-none" />

                                                      {/* Type Overlay */}
                                                      <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded-md bg-black/70 text-[9px] font-mono-ui text-white uppercase tracking-wider border border-white/10">
                                                        {reel.media_type === "STORY" ? "Story" : reel.media_type === "VIDEO" ? "Reel" : "Post"}
                                                      </span>

                                                      {/* Selected Check overlay */}
                                                      {isSelected && (
                                                        <div className="absolute inset-0 bg-accent-yellow/20 flex items-center justify-center backdrop-blur-[1px]">
                                                          <div className="w-9 h-9 rounded-full bg-accent-yellow text-accent-yellow-foreground flex items-center justify-center shadow-lg ring-2 ring-accent-yellow-foreground">
                                                            <Check className="w-4 h-4 stroke-[3]" />
                                                          </div>
                                                        </div>
                                                      )}

                                                      {/* Caption snippet at bottom — white text on dark gradient for contrast in BOTH themes */}
                                                      <div className="absolute inset-x-0 bottom-0 px-2 pt-6 pb-2 pointer-events-none">
                                                        <p className="text-[10px] text-white line-clamp-1 font-sans drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">{reel.caption || "Sem legenda"}</p>
                                                      </div>
                                                    </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Configure keywords only after selection (for Comment triggers) or always for others */}
              {(triggerSource !== "comment" || hasSelectedReelOption) && (
                <div className="space-y-4 pt-3 border-t border-border animate-in fade-in slide-in-from-top-2 duration-300">
                  {triggerSource === "comment" ? (
                    <div className="space-y-2">
                      <FieldLabel>Palavras-chave</FieldLabel>
                      <p className="text-[11px] text-muted-foreground">
                        Qual palavra no comentário ativa a resposta? <span className="text-accent-yellow-foreground font-semibold">Deixe vazio para responder a todos os comentários.</span>
                      </p>
                      <TagInput
                        value={triggers}
                        onChange={setTriggers}
                        placeholder="digite a palavra e aperte Enter (ex.: quero)"
                      />
                    </div>
                  ) : needsKeywords ? (
                    <div className="space-y-2 bg-muted/40 p-5 rounded-2xl border border-border">
                      <FieldLabel>
                        {triggerSource === "story" && storyTriggerType === "reaction"
                          ? "Só responder a estes emojis"
                          : "Palavras-chave do gatilho"}
                      </FieldLabel>
                      <p className="text-[11px] text-muted-foreground mb-3">
                        {triggerSource === "story" && storyTriggerType === "reaction"
                          ? "Deixe vazio para responder a qualquer reação."
                          : "Funciona com a palavra ou frase exata (maiúsculas e minúsculas tanto faz)."}
                      </p>
                      <TagInput
                        value={triggers}
                        onChange={setTriggers}
                        placeholder={
                          triggerSource === "story" && storyTriggerType === "reaction" ? "ex.: ❤️, 🔥, 👍" : "digite a palavra e aperte Enter (ex.: preço)"
                        }
                      />
                    </div>
                  ) : null}

                  {triggerSource === "comment" && triggers.length > 0 && (
                    <ToggleRow
                      icon={<MessageSquare className="w-5 h-5" />}
                      title="Incluir respostas a comentários"
                      sub="Normalmente só os comentários principais do post ativam a resposta."
                      on={includeReplies}
                      onToggle={() => setIncludeReplies(!includeReplies)}
                    />
                  )}
                </div>
              )}
            </div>
          )}

          {/* ===== STEP 2: RESPONSE ===== */}
          {step === 1 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-2 duration-300">
              <StepHeader
                number={2}
                title="O que a pessoa vai receber?"
                description="Escolha o formato e escreva a mensagem do jeitinho que ela vai ser enviada."
              />

              {triggerSource === "comment" && (
                <div className="space-y-2">
                  <FieldLabel>Onde responder</FieldLabel>
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      { key: "both" as const, label: "Comentário + DM" },
                      { key: "public_only" as const, label: "Só comentário" },
                      { key: "dm_only" as const, label: "Só DM" },
                    ]).map(({ key, label }) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setReplyMode(key)}
                        className={`h-11 rounded-xl border text-xs font-bold uppercase tracking-wider transition-all ${
                          replyMode === key ? "border-accent-yellow bg-accent-yellow/10 text-accent-yellow-foreground" : "border-border text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {triggerSource === "comment" && replyMode !== "dm_only" && (
                <div className="space-y-2 bg-muted/40 p-5 rounded-2xl border border-border">
                  <FieldLabel>Resposta pública no comentário</FieldLabel>
                  <p className="text-[11px] text-muted-foreground mb-3">Adicione várias frases. A gente alterna entre elas para parecer mais natural.</p>
                  <TagInput sentences value={publicReplies} onChange={setPublicReplies} placeholder={'digite uma frase e aperte Enter (ex.: Te mandei na DM!)'} />
                </div>
              )}

              {replyMode !== "public_only" && (
                <div className="space-y-5 pt-2">
                  <div className="space-y-2">
                    <FieldLabel>Formato da DM</FieldLabel>
                    <div className="grid grid-cols-3 gap-3">
                      {([
                        { key: "text" as const, icon: <MessageCircle className="w-4.5 h-4.5" />, label: "Só texto" },
                        { key: "card" as const, icon: <Link2 className="w-4.5 h-4.5" />, label: "Cartão / Link" },
                        { key: "media" as const, icon: <ImageIcon className="w-4.5 h-4.5" />, label: "Mídia" },
                      ]).map(({ key, icon, label }) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setType(key)}
                          className={`p-3 rounded-xl border text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all ${
                            type === key ? "border-accent-yellow bg-accent-yellow/10 text-accent-yellow-foreground" : "border-border text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {icon}
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {type === "text" && (
                    <div className="space-y-2">
                      <FieldLabel>Mensagem da DM</FieldLabel>
                      <textarea
                        value={messageText}
                        onChange={(e) => setMessageText(e.target.value)}
                        rows={5}
                        maxLength={1000}
                        className="w-full bg-muted/30 border border-border rounded-2xl px-4 py-3.5 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:border-accent-yellow/50 transition-colors"
                        placeholder="Ex.: Oi! Aqui está o link com 10% de desconto pra você: ..."
                      />
                      <p className="font-mono-ui text-[10px] text-muted-foreground text-right">{messageText.length}/1000</p>
                      <div className="space-y-2 pt-1">
                        <FieldLabel>Variações da mensagem (opcional)</FieldLabel>
                        <p className="text-[11px] text-muted-foreground">
                          A cada envio sorteamos uma entre a mensagem principal e estas variações. Mensagens idênticas em massa
                          podem ser vistas como spam pelo Instagram.
                        </p>
                        <TagInput sentences value={messageVariants} onChange={setMessageVariants} placeholder="escreva outra versão e aperte Enter" />
                      </div>
                    </div>
                  )}

                  {type === "card" && (
                    <div className="space-y-4">
                      <div className="space-y-3">
                        <FieldLabel>Cartão</FieldLabel>
                        <TextField value={cardTitle} onChange={setCardTitle} placeholder="Título (ex.: Frete grátis só hoje!)" />
                        <TextField value={cardSubtitle} onChange={setCardSubtitle} placeholder="Subtítulo (opcional)" />
                        <TextField value={cardImage} onChange={setCardImage} placeholder="Link da imagem (opcional)" />
                      </div>
                      <div className="space-y-2.5">
                        <div className="flex items-center justify-between border-b border-border pb-2">
                          <FieldLabel>Botões ({buttons.length}/3)</FieldLabel>
                          <button type="button" onClick={addButton} disabled={buttons.length >= 3}
                            className="font-mono-ui text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40 flex items-center gap-1 transition-colors">
                            <Plus className="w-3 h-3" /> Adicionar botão
                          </button>
                        </div>
                        {buttons.map((btn) => (
                          <div key={btn.id} className="flex gap-2 items-center bg-white/[0.02] p-3 rounded-2xl border border-border">
                            <input
                              value={btn.title}
                              onChange={(e) => updateButton(btn.id, "title", e.target.value)}
                              className="h-8 text-xs flex-1 bg-transparent border-none px-2 text-foreground placeholder:text-muted-foreground focus:outline-none"
                              placeholder="Texto do botão (ex.: Ver produto)"
                            />
                            <select
                              value={btn.type}
                              onChange={(e) => updateButton(btn.id, "type", e.target.value)}
                              className="h-8 text-[11px] bg-black border border-border rounded-lg px-2 text-foreground focus:outline-none"
                            >
                              <option value="web_url">Abrir link</option>
                              <option value="postback">Acionar resposta</option>
                            </select>
                            <input
                              value={btn.type === "web_url" ? btn.url : btn.payload}
                              onChange={(e) => updateButton(btn.id, btn.type === "web_url" ? "url" : "payload", e.target.value)}
                              className="h-8 text-xs flex-1 bg-transparent border-none px-2 text-foreground placeholder:text-muted-foreground focus:outline-none font-mono"
                              placeholder={btn.type === "web_url" ? "https://sualoja.com.br" : "palavra-chave da resposta"}
                            />
                            <button type="button" onClick={() => removeButton(btn.id)} className="text-muted-foreground hover:text-red-400 p-1.5 transition-colors">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {type === "media" && (
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <FieldLabel>Tipo de mídia</FieldLabel>
                        <div className="grid grid-cols-3 gap-2">
                          {(["image", "video", "audio"] as const).map((m) => (
                            <button
                              key={m}
                              type="button"
                              onClick={() => setMediaType(m)}
                              className={`h-10 rounded-xl border text-xs font-bold uppercase transition-all ${
                                mediaType === m ? "border-accent-yellow bg-accent-yellow/10 text-accent-yellow-foreground" : "border-border text-muted-foreground hover:text-foreground"
                              }`}
                            >
                              {m === "image" ? "Foto" : m === "video" ? "Vídeo" : "Áudio"}
                            </button>
                          ))}
                        </div>
                      </div>
                      <TextField value={mediaUrl} onChange={setMediaUrl} placeholder="Link público do arquivo (ex.: .jpg, .mp4)" />
                      <TextField value={messageText} onChange={setMessageText} placeholder="Mensagem para enviar depois da mídia (opcional)" />
                    </div>
                  )}

                  {type !== "card" && (
                    <div className="space-y-3 pt-2">
                      <div className="flex items-center justify-between border-b border-border pb-2">
                        <FieldLabel>Respostas rápidas ({quickReplies.length}/4)</FieldLabel>
                        <button type="button" onClick={addQuickReply} disabled={quickReplies.length >= 4}
                          className="font-mono-ui text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40 flex items-center gap-1 transition-colors">
                          <Plus className="w-3 h-3" /> Adicionar
                        </button>
                      </div>
                      {quickReplies.length > 0 && (
                        <div className="space-y-2">
                          {quickReplies.map((q) => (
                            <div key={q.id} className="flex gap-2 items-center">
                              <input
                                value={q.title}
                                onChange={(e) => updateQuickReply(q.id, e.target.value)}
                                maxLength={20}
                                className="h-10 text-xs flex-1 bg-muted/30 border border-border rounded-xl px-4 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-accent-yellow/50"
                                placeholder='ex.: "Quero saber mais!"'
                              />
                              <button type="button" onClick={() => removeQuickReply(q.id)} className="text-muted-foreground hover:text-red-400 p-1.5 transition-colors">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ===== STEP 3: SETTINGS ===== */}
          {step === 2 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-2 duration-300">
              <StepHeader
                number={3}
                title="Revisar e publicar"
                description="Dê um nome fácil de reconhecer e confira as opções de envio."
              />

              <div className="space-y-2">
                <FieldLabel>Nome da resposta automática</FieldLabel>
                <TextField value={name} onChange={setName} placeholder='ex.: "Enviar cupom de desconto"' />
              </div>

              <div className="space-y-4">
                <FieldLabel>Opções de envio</FieldLabel>
                <ToggleRow icon={<Lock className="w-5 h-5" />} title="Liberar só para seguidores" sub="Só seguidores recebem a mensagem. Quem ainda não segue recebe antes um pedido para seguir." on={checkFollow} onToggle={() => setCheckFollow(!checkFollow)} />
                {triggerSource === "comment" && !checkFollow && (
                  <ToggleRow
                    icon={<Send className="w-5 h-5" />}
                    title="Enviar direto, sem botão"
                    sub='Pula o cartão "Quero receber" e manda só UMA mensagem (texto, cartão ou mídia). Sem o toque, a conversa não fica aberta para outras mensagens.'
                    on={directSend}
                    onToggle={() => setDirectSend(!directSend)}
                  />
                )}
                {triggerSource === "comment" && (checkFollow || !directSend) && (
                  <div className="space-y-3 rounded-2xl border border-border p-4">
                    <p className="text-[11px] text-muted-foreground">
                      Quem comentar recebe primeiro um cartão com o botão abaixo. Ao tocar, a conversa é aberta e{" "}
                      {checkFollow
                        ? 'verificamos se a pessoa segue a conta: se seguir, recebe a sua mensagem; se não, recebe o pedido para seguir e o botão "Já segui ✅".'
                        : "a pessoa recebe a sua mensagem."}{" "}
                      Deixe em branco para usar o texto padrão.
                    </p>
                    <div className="space-y-1.5">
                      <FieldLabel>Título do cartão</FieldLabel>
                      <TextField value={optinTitle} onChange={setOptinTitle} placeholder="Quer receber? 🎁" />
                    </div>
                    <div className="space-y-1.5">
                      <FieldLabel>Texto do cartão</FieldLabel>
                      <TextField value={optinSubtitle} onChange={setOptinSubtitle} placeholder="Toque no botão abaixo que eu te envio aqui no direct." />
                    </div>
                    <div className="space-y-1.5">
                      <FieldLabel>Texto do botão (até 20 caracteres)</FieldLabel>
                      <TextField value={optinButton} onChange={v => setOptinButton(v.slice(0, 20))} placeholder="Quero receber" />
                    </div>
                  </div>
                )}
                <ToggleRow icon={<Eye className="w-5 h-5" />} title='Mostrar "digitando..."' sub="Mostra o aviso de digitando antes de enviar, para parecer mais natural." on={typingIndicator} onToggle={() => setTypingIndicator(!typingIndicator)} />
                
                <div className="flex items-center justify-between p-4 rounded-2xl border border-border bg-white/[0.01]">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center border border-border">
                      <Timer className="w-4.5 h-4.5 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">Atraso extra antes de responder</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">Toda resposta já espera alguns segundos aleatórios, como uma pessoa faria. Aqui você soma mais tempo.</p>
                    </div>
                  </div>
                  <select
                    value={delaySeconds}
                    onChange={(e) => setDelaySeconds(Number(e.target.value))}
                    className="bg-black border border-border rounded-xl px-3 py-2 text-xs text-foreground focus:outline-none hover:border-border transition-all cursor-pointer"
                  >
                    <option value={0}>Sem atraso extra</option>
                    <option value={3}>3 segundos</option>
                    <option value={5}>5 segundos</option>
                    <option value={10}>10 segundos</option>
                    <option value={30}>30 segundos</option>
                  </select>
                </div>
              </div>

              {triggerSource === "comment" && triggers.length === 0 && (
                <div role="alert" className="rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-xs text-foreground">
                  <strong>Atenção: sem palavra-chave.</strong> Esta regra vai responder a <strong>todos os comentários</strong>{" "}
                  {selectedReel ? "deste post" : "de todos os seus posts"}. Para responder só a uma palavra, volte à etapa 1.
                </div>
              )}

              {/* Plain-text Summary Panel */}
              <div className="rounded-2xl border border-accent-yellow/15 bg-accent-yellow/[0.03] p-5 space-y-2">
                              <div className="flex items-center gap-2">
                                <Sparkles className="w-4 h-4 text-accent-yellow-foreground" />
                                <span className="text-xs font-mono-ui uppercase tracking-widest text-accent-yellow-foreground font-bold">Resumo da regra</span>
                              </div>
                              <p className="text-xs text-muted-foreground leading-relaxed">
                                Quando <span className="text-foreground font-semibold underline decoration-accent-yellow/40 decoration-2">{summary.who}</span>, vamos <span className="text-accent-yellow-foreground font-semibold">{summary.what}</span>.
                              </p>
              </div>
            </div>
          )}

          {/* ── Wizard Foot Navigation ── */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-6">
            {step > 0 ? (
              <button
                type="button"
                onClick={() => setStep(step - 1)}
                className="flex items-center gap-2 h-10 px-4 rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground text-xs font-medium transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
                Voltar
              </button>
            ) : <div />}

            {validationHint && <p className="order-last w-full text-xs text-muted-foreground sm:order-none sm:w-auto">{validationHint}</p>}
            {step < 2 ? (
              <button
                type="button"
                onClick={() => { if (stepValid[step]) setStep(step + 1) }}
                disabled={!stepValid[step]}
                className="flex items-center gap-2 h-10 px-4 rounded-lg bg-primary text-primary-foreground text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ml-auto"
              >
                Continuar
                <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!canSave || saving}
                className="flex items-center justify-center gap-2 h-10 px-5 rounded-lg bg-primary text-primary-foreground text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ml-auto"
              >
                {saving ? <Loader2 className="w-4.5 h-4.5 animate-spin" /> : <Zap className="w-4 h-4 stroke-[2.5]" />}
                {saving ? "Salvando..." : isEditing ? "Salvar" : "Publicar"}
              </button>
            )}
          </div>
        </div>

        {/* ── RIGHT: iPhone Mockup — ALWAYS dark regardless of page theme ── */}
        {step === 1 && replyMode !== "public_only" && (
          <div className="hidden lg:block sticky top-6 dark">
            <div className="text-center mb-3">
              <span className="font-mono-ui text-[10px] uppercase tracking-[0.25em] text-neutral-400 font-bold">Pré-visualização</span>
            </div>
            
            {/* iPhone Outer Frame — sized to fit the 300px right rail without overflowing */}
            <div className="mx-auto w-[260px] xl:w-[300px] h-[500px] xl:h-[560px] rounded-[2.5rem] xl:rounded-[3rem] border-[7px] xl:border-8 border-[#1f1f1e] bg-black shadow-2xl relative flex flex-col overflow-hidden ring-1 ring-white/10">
              
              {/* iPhone Dynamic Island */}
              <div className="absolute top-2.5 left-1/2 -translate-x-1/2 w-24 h-5 bg-black rounded-full z-50 flex items-center justify-center">
                <div className="w-2.5 h-2.5 rounded-full bg-muted border border-neutral-800 ml-auto mr-3" />
              </div>

              {/* Status Bar Mockup */}
              <div className="h-8 bg-neutral-950 flex items-end justify-between px-6 pb-1 text-[9px] text-foreground/80 font-mono-ui z-40 select-none">
                <span>9:41</span>
                <div className="flex items-center gap-1">
                  <span>5G</span>
                  <div className="w-4 h-2 border border-white/40 rounded-sm p-[1px] flex items-center"><div className="w-2 h-full bg-white rounded-2xs" /></div>
                </div>
              </div>

              {/* True-to-life Instagram DM Header */}
              <div className="flex items-center justify-between px-3 py-2.5 border-b border-border bg-neutral-950/80 backdrop-blur-md sticky top-0 z-40">
                <div className="flex items-center gap-2">
                  <ArrowLeft className="w-4 h-4 text-foreground cursor-pointer" />
                  <div className="relative">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-[#8a3ab9] via-[#e95950] to-[#fccc63] p-[1.5px]">
                      <div className="w-full h-full rounded-full bg-black flex items-center justify-center text-[10px] font-bold text-foreground font-mono">
                        {(editRule?.name || "T").substring(0,1).toUpperCase()}
                      </div>
                    </div>
                    <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-neutral-950" />
                  </div>
                  <div className="leading-tight">
                    <p className="text-[11px] font-semibold text-foreground truncate max-w-[100px]">@{userId ? "test_creator" : "creator"}</p>
                    <p className="text-[8px] text-green-500 font-medium">Online agora</p>
                  </div>
                </div>
                <div className="flex items-center gap-3.5 text-foreground">
                  <Phone className="w-3.5 h-3.5" />
                  <Video className="w-3.5 h-3.5" />
                  <Info className="w-3.5 h-3.5" />
                </div>
              </div>

              {/* Screen Body */}
              <div className="flex-1 bg-black px-3 py-4 space-y-4 overflow-y-auto font-sans flex flex-col justify-end">
                {/* Incoming bubble */}
                <div className="flex justify-start items-end gap-1.5">
                  <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-[9px] text-foreground">U</div>
                  <div className="bg-[#1f1f1e] text-foreground rounded-2xl rounded-bl-sm px-3.5 py-2 text-xs max-w-[75%] shadow-md">
                    {incomingMsg(triggerSource, triggers)}
                  </div>
                </div>

                {/* Typing indicator simulator */}
                {typingIndicator && (
                  <div className="flex justify-end pr-1 animate-pulse">
                    <span className="text-[9px] text-muted-foreground font-mono-ui italic">digitando...</span>
                  </div>
                )}

                {/* Outgoing Reply Bubble */}
                {hasDMContent(type, messageText, cardTitle, mediaUrl) ? (
                  <div className="flex justify-end items-end gap-1.5 animate-in fade-in zoom-in-95 duration-200">
                    <div className="max-w-[80%] space-y-1.5 flex flex-col items-end">
                      {type === "text" && (
                        <div className="bg-[#3797f0] text-foreground rounded-2xl rounded-br-sm px-4 py-2.5 text-xs whitespace-pre-wrap break-words leading-relaxed shadow-lg">
                          {messageText || "Digite a mensagem..."}
                        </div>
                      )}
                      {type === "card" && (
                        <div className="bg-muted border border-border rounded-2xl overflow-hidden w-48 shadow-2xl">
                          {cardImage && cardImage.startsWith("http") && (
                            <img src={cardImage} alt="" className="w-full h-24 object-cover" loading="lazy" />
                          )}
                          <div className="p-3">
                            <p className="text-xs font-bold text-foreground line-clamp-1">{cardTitle || "Título do cartão"}</p>
                            {cardSubtitle && <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2 leading-tight">{cardSubtitle}</p>}
                          </div>
                          {buttons.filter((b) => b.title).map((b) => (
                            <div key={b.id} className="border-t border-border py-2 text-center text-[10px] font-bold text-[#3797f0] bg-white/[0.01] cursor-pointer hover:bg-white/[0.03] transition-colors">
                              {b.title}
                            </div>
                          ))}
                        </div>
                      )}
                      {type === "media" && (
                        <div className="bg-muted border border-border rounded-2xl w-40 h-40 overflow-hidden flex items-center justify-center relative group shadow-xl">
                          {mediaType === "image" && mediaUrl.startsWith("http") ? (
                            <img src={mediaUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
                          ) : (
                            <div className="flex flex-col items-center gap-1.5 text-muted-foreground">
                              <ImageIcon className="w-6 h-6" />
                              <span className="text-[9px] uppercase font-mono-ui tracking-wider">{mediaType === "image" ? "Foto" : mediaType === "video" ? "Vídeo" : "Áudio"}</span>
                            </div>
                          )}
                        </div>
                      )}
                      {type === "media" && messageText && (
                        <div className="bg-[#3797f0] text-foreground rounded-2xl rounded-br-sm px-4 py-2.5 text-xs leading-relaxed shadow-lg">{messageText}</div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex justify-end animate-pulse">
                    <div className="border border-dashed border-border bg-white/[0.01] rounded-2xl px-4 py-3 text-[10px] text-muted-foreground font-mono-ui italic text-center w-full">
                      Preencha a etapa 2 para ver a mensagem aqui
                    </div>
                  </div>
                )}

                {/* Quick Reply Pills */}
                {type !== "card" && quickReplies.filter((q) => q.title.trim()).length > 0 && (
                  <div className="flex flex-wrap gap-1.5 justify-end pt-2">
                    {quickReplies.filter((q) => q.title.trim()).map((q) => (
                      <span key={q.id} className="border border-[#3797f0] text-[#3797f0] hover:bg-[#3797f0]/5 cursor-pointer rounded-full px-3 py-1 text-[10px] font-bold transition-all">
                        {q.title}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* iPhone Footer Navigation Bar */}
              <div className="h-12 bg-neutral-950 border-t border-border flex items-center justify-between px-5 text-muted-foreground">
                <Camera className="w-4 h-4" />
                <div className="flex-1 max-w-[150px] h-7 bg-muted border border-border rounded-full px-3 flex items-center justify-between text-[9px] text-muted-foreground">
                  <span>Mensagem...</span>
                  <Smile className="w-3 h-3" />
                </div>
                <Mic className="w-4 h-4" />
                <PicIcon className="w-4 h-4" />
              </div>

              {/* iPhone Bottom Bar Indicator */}
              <div className="h-5 bg-neutral-950 flex items-center justify-center pb-1">
                <div className="w-24 h-1 bg-white/40 rounded-full" />
              </div>

            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ============================================================
   Helper renders & string parsers
   ============================================================ */

function incomingMsg(triggerSource: string, triggers: string[]): string {
  const primaryKw = triggers.length > 0 ? triggers[0] : null
  if (triggerSource === "comment") {
    return primaryKw ? `Comentou "${primaryKw}"` : "Comentou no seu post"
  }
  if (triggerSource === "story") {
    return "Interagiu com seu story"
  }
  return primaryKw ? `Mandou "${primaryKw}" na DM` : "Te enviou uma mensagem"
}

function hasDMContent(type: string, messageText: string, cardTitle: string, mediaUrl: string): boolean {
  if (type === "text" && messageText.trim().length > 0) return true
  if (type === "card" && cardTitle.trim().length > 0) return true
  if (type === "media" && mediaUrl.trim().length > 0) return true
  return false
}

function StepHeader({ number, title, description }: { number: number; title: string; description: string }) {
  return (
    <div className="border-b border-border pb-4">
      <div className="flex items-center gap-2 mb-1.5">
        <div className="px-2 py-0.5 rounded-md bg-secondary text-[10px] font-medium text-muted-foreground">
          Etapa {number}
        </div>
      </div>
      <h3 className="text-xl font-semibold text-foreground tracking-tight">{title}</h3>
      <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{description}</p>
    </div>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-medium text-foreground mb-2">{children}</p>
}

function TextField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full h-11 bg-card border border-border rounded-lg px-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all"
    />
  )
}

function ToggleRow({
  icon, title, sub, on, onToggle,
}: {
  icon: React.ReactNode
  title: string
  sub: string
  on: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`w-full p-4 rounded-xl border text-left flex items-center gap-3.5 transition-colors bg-card ${
        on ? "border-foreground bg-accent" : "border-border hover:border-foreground"
      }`}
    >
      <span className={on ? "text-foreground" : "text-muted-foreground"}>{icon}</span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-semibold text-foreground">{title}</span>
        <span className="block text-xs text-muted-foreground mt-0.5 leading-relaxed">{sub}</span>
      </span>
      <span className={`w-10 h-5.5 rounded-full relative transition-colors shrink-0 ${on ? "bg-primary" : "bg-muted"}`}>
        <span className={`absolute top-0.5 w-4.5 h-4.5 rounded-full bg-card transition-all ${on ? "left-[20px]" : "left-0.5"}`} />
      </span>
    </button>
  )
}
