// In-memory persistent mock store for Supabase tables when live Supabase is not connected
import { randomUUID } from "crypto"

interface InMemoryData {
  users: Array<Record<string, any>>
  automations: Array<Record<string, any>>
  conversations: Array<Record<string, any>>
  messages: Array<Record<string, any>>
  ice_breakers: Array<Record<string, any>>
  unlock_attempts: Array<Record<string, any>>
  media_cache: Array<Record<string, any>>
  content_pool: Array<Record<string, any>>
  reels_posts: Array<Record<string, any>>
  scheduler_config: Array<Record<string, any>>
  dm_queue: Array<Record<string, any>>
  webhook_events: Array<Record<string, any>>
}

const globalStore: InMemoryData = {
  users: [
    {
      id: "9999999999",
      username: "test_creator",
      access_token: "TEST_TOKEN_NOT_REAL",
      token_expires_at: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
      business_account_id: "9999999999",
      page_id: "9999999999",
      groq_auto_reply_enabled: false,
      ai_context: JSON.stringify({
        business_name: "InstaAuto Studio",
        business_description: "Automated Instagram direct message replies and comment funnels.",
        services: "DM automations, comment triggers, story reactions, AI auto-replies.",
        hours_location: "Online 24/7",
        policies: "Immediate automated replies.",
        faq: "How does InstaAuto work? Connect your account and configure your keyword triggers.",
      }),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ],
  automations: [
    {
      id: "auto-demo-1",
      user_id: "9999999999",
      name: "Welcome DM",
      trigger_source: "dm",
      trigger_type: "keyword",
      trigger_value: "hello",
      response_type: "pro",
      response_content: { message: "Hey there! Thanks for reaching out to InstaAuto. How can we help you today?" },
      is_active: true,
      created_at: new Date(Date.now() - 3600000).toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: "auto-demo-2",
      user_id: "9999999999",
      name: "Post Pricing Guide",
      trigger_source: "comment",
      trigger_type: "keyword",
      trigger_value: "price",
      response_type: "pro",
      response_content: { message: "Sent you the complete pricing guide in your DMs! Check your inbox." },
      is_active: true,
      created_at: new Date(Date.now() - 7200000).toISOString(),
      updated_at: new Date().toISOString(),
    },
  ],
  conversations: [
    {
      id: "conv-demo-1",
      user_id: "9999999999",
      recipient_id: "ig_user_101",
      recipient_username: "alex_design",
      last_message_at: new Date(Date.now() - 1800000).toISOString(),
      created_at: new Date(Date.now() - 86400000).toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: "conv-demo-2",
      user_id: "9999999999",
      recipient_id: "ig_user_102",
      recipient_username: "sara_marketing",
      last_message_at: new Date(Date.now() - 7200000).toISOString(),
      created_at: new Date(Date.now() - 172800000).toISOString(),
      updated_at: new Date().toISOString(),
    },
  ],
  messages: [
    {
      id: "msg-demo-1",
      conversation_id: "conv-demo-1",
      user_id: "9999999999",
      sender_id: "ig_user_101",
      sender_username: "alex_design",
      content: "Hi! I saw your post about automated funnels. Can I get more details?",
      is_from_instagram: true,
      created_at: new Date(Date.now() - 1900000).toISOString(),
    },
    {
      id: "msg-demo-2",
      conversation_id: "conv-demo-1",
      user_id: "9999999999",
      sender_id: "9999999999",
      sender_username: "test_creator",
      content: "Hey Alex! Thanks for reaching out. Here's how our keyword triggers work.",
      is_from_instagram: false,
      created_at: new Date(Date.now() - 1800000).toISOString(),
    },
    {
      id: "msg-demo-3",
      conversation_id: "conv-demo-2",
      user_id: "9999999999",
      sender_id: "ig_user_102",
      sender_username: "sara_marketing",
      content: "price",
      is_from_instagram: true,
      created_at: new Date(Date.now() - 7300000).toISOString(),
    },
    {
      id: "msg-demo-4",
      conversation_id: "conv-demo-2",
      user_id: "9999999999",
      sender_id: "9999999999",
      sender_username: "test_creator",
      content: "Sent you the complete pricing guide in your DMs! Check your inbox.",
      is_from_instagram: false,
      created_at: new Date(Date.now() - 7200000).toISOString(),
    },
  ],
  ice_breakers: [
    {
      id: "ib-demo-1",
      user_id: "9999999999",
      question: "How does InstaAuto work?",
      response: "InstaAuto monitors your Instagram comments and DMs, replying instantly based on keywords.",
      is_active: true,
      created_at: new Date().toISOString(),
    },
    {
      id: "ib-demo-2",
      user_id: "9999999999",
      question: "What features are included?",
      response: "Keyword auto-replies, story reaction triggers, comment-to-DM funnels, and live inbox.",
      is_active: true,
      created_at: new Date().toISOString(),
    },
  ],
  unlock_attempts: [],
  media_cache: [],
  content_pool: [],
  reels_posts: [],
  scheduler_config: [],
  dm_queue: [],
  webhook_events: [],
}

export function getInMemoryStore() {
  return globalStore
}

export class MockQueryBuilder {
  private tableName: keyof InMemoryData
  private filters: Array<(row: any) => boolean> = []
  private sortFn: ((a: any, b: any) => number) | null = null
  private limitCount: number | null = null
  private isSingle = false
  private selectCount = false
  private headOnly = false

  constructor(tableName: string) {
    this.tableName = (tableName in globalStore ? tableName : "users") as keyof InMemoryData
  }

  select(columns = "*", options?: { count?: "exact" | "planned" | "estimated"; head?: boolean }) {
    if (options?.count) {
      this.selectCount = true
    }
    if (options?.head) {
      this.headOnly = true
    }
    return this
  }

  eq(column: string, value: any) {
    this.filters.push((row) => {
      if (row == null) return false
      const val = row[column]
      return String(val) === String(value)
    })
    return this
  }

  neq(column: string, value: any) {
    this.filters.push((row) => {
      if (row == null) return true
      const val = row[column]
      return String(val) !== String(value)
    })
    return this
  }

  order(column: string, options?: { ascending?: boolean }) {
    const asc = options?.ascending !== false
    this.sortFn = (a, b) => {
      const valA = a[column]
      const valB = b[column]
      if (valA < valB) return asc ? -1 : 1
      if (valA > valB) return asc ? 1 : -1
      return 0
    }
    return this
  }

  limit(count: number) {
    this.limitCount = count
    return this
  }

  single() {
    this.isSingle = true
    return this
  }

  private executeQuery(): { data: any; error: any; count?: number } {
    const table = globalStore[this.tableName] || []
    let result = table.filter((row) => this.filters.every((fn) => fn(row)))

    const totalCount = result.length

    if (this.sortFn) {
      result = [...result].sort(this.sortFn)
    }

    if (this.limitCount !== null) {
      result = result.slice(0, this.limitCount)
    }

    if (this.headOnly) {
      return { data: null, error: null, count: totalCount }
    }

    if (this.isSingle) {
      const item = result[0] || null
      return { data: item, error: item ? null : { message: "Row not found", code: "PGRST116" }, count: totalCount }
    }

    return {
      data: result,
      error: null,
      count: this.selectCount ? totalCount : undefined,
    }
  }

  then(onfulfilled?: (value: any) => any, onrejected?: (reason: any) => any) {
    const res = this.executeQuery()
    return Promise.resolve(res).then(onfulfilled, onrejected)
  }

  async insert(items: any | any[]) {
    const list = Array.isArray(items) ? items : [items]
    const table = globalStore[this.tableName] || (globalStore[this.tableName] = [])
    const inserted: any[] = []

    for (const item of list) {
      const row = {
        id: item.id || randomUUID(),
        created_at: item.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...item,
      }
      table.push(row)
      inserted.push(row)
    }

    return {
      data: Array.isArray(items) ? inserted : inserted[0],
      error: null,
      select: () => ({
        single: () => Promise.resolve({ data: inserted[0], error: null }),
        then: (resolve: any) => resolve({ data: Array.isArray(items) ? inserted : inserted[0], error: null }),
      }),
    }
  }

  async upsert(items: any | any[], options?: { onConflict?: string }) {
    const list = Array.isArray(items) ? items : [items]
    const table = globalStore[this.tableName] || (globalStore[this.tableName] = [])
    const conflictCol = options?.onConflict || "id"
    const insertedOrUpdated: any[] = []

    for (const item of list) {
      const idx = table.findIndex((row) => String(row[conflictCol]) === String(item[conflictCol]))
      if (idx >= 0) {
        table[idx] = { ...table[idx], ...item, updated_at: new Date().toISOString() }
        insertedOrUpdated.push(table[idx])
      } else {
        const newRow = {
          id: item.id || randomUUID(),
          created_at: item.created_at || new Date().toISOString(),
          updated_at: new Date().toISOString(),
          ...item,
        }
        table.push(newRow)
        insertedOrUpdated.push(newRow)
      }
    }

    return {
      data: Array.isArray(items) ? insertedOrUpdated : insertedOrUpdated[0],
      error: null,
      select: () => ({
        single: () => Promise.resolve({ data: insertedOrUpdated[0], error: null }),
        then: (resolve: any) => resolve({ data: Array.isArray(items) ? insertedOrUpdated : insertedOrUpdated[0], error: null }),
      }),
    }
  }

  async update(updateData: Record<string, any>) {
    const table = globalStore[this.tableName] || []
    const updated: any[] = []

    for (let i = 0; i < table.length; i++) {
      if (this.filters.every((fn) => fn(table[i]))) {
        table[i] = { ...table[i], ...updateData, updated_at: new Date().toISOString() }
        updated.push(table[i])
      }
    }

    return {
      data: updated,
      error: null,
      select: () => ({
        single: () => Promise.resolve({ data: updated[0] || null, error: updated[0] ? null : { message: "Not found" } }),
        then: (resolve: any) => resolve({ data: updated, error: null }),
      }),
    }
  }

  async delete() {
    const table = globalStore[this.tableName] || []
    const remaining = table.filter((row) => !this.filters.every((fn) => fn(row)))
    globalStore[this.tableName] = remaining
    return { data: null, error: null }
  }
}

export function createMockSupabaseClient() {
  return {
    from: (table: string) => new MockQueryBuilder(table),
    rpc: async (fnName: string, args?: Record<string, any>) => {
      if (fnName === "bump_unlock_attempt") {
        const key = args?.p_key || "default"
        const existing = globalStore.unlock_attempts.find((u) => u.key === key)
        if (existing) {
          existing.count = (existing.count || 0) + 1
          existing.updated_at = new Date().toISOString()
          return { data: existing.count, error: null }
        } else {
          globalStore.unlock_attempts.push({ key, count: 1, updated_at: new Date().toISOString() })
          return { data: 1, error: null }
        }
      }
      return { data: null, error: null }
    },
  }
}
