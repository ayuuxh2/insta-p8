const ts = require('typescript')
const fs = require('node:fs')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')

async function test(matched, profileFails = false) {
  let releaseProfile
  const profileGate = new Promise(resolve => { releaseProfile = resolve })
  let sent = 0
  let finished = false
  const saved = []
  const user = { id: 'user', business_account_id: 'business', access_token: 'fake', username: 'owner' }
  const db = { from(table) {
    let inserted
    const query = {
      select() { return this }, eq() { return this }, or() { return this }, limit() { return this },
      update() { return this }, insert(row) { inserted = row; return this },
      single() { return this },
      then(resolve, reject) {
        let data = null
        if (table === 'users') data = user
        if (table === 'automations') data = [{ id: 'rule', trigger_source: 'dm', trigger_type: 'keyword', trigger_value: 'price', response_content: { message: '499' } }]
        if (table === 'conversations' && inserted) data = { id: 'conv' }
        if (table === 'messages' && inserted) saved.push(inserted)
        return Promise.resolve({ data }).then(resolve, reject)
      },
    }
    return query
  } }
  const mocks = {
    'next/server': { NextResponse: { json: data => data } },
    '@/lib/supabase-server': { getSupabaseServerClient: async () => db },
    '@/lib/supabase-migrate': { ensureSchema: async () => {} },
    '@/lib/instagram-api': {
      fetchProfile: async () => { await profileGate; if (profileFails) throw Error('profile unavailable'); return { username: 'sender' } },
      sendTextDM: async () => { sent++; return { ok: true } },
      sendSenderAction: async () => ({ ok: true }),
      isHttpUrl: v => typeof v === 'string' && /^https?:\/\//i.test(v),
    },
    '@/lib/ai-reply': {}, '@/lib/unlock-tracking': { unlockKey: () => 'key' },
    '@/lib/webhook-verify': {
      handleWebhookVerification: () => ({}),
      isMetaWebhookDelivery: () => false,
      metaAppSecrets: () => ['test-secret'],
      verifyMetaSignature: (raw, sig) => typeof sig === 'string' && sig.startsWith('sha256='),
      signatureBypassEnabled: () => false,
    },
  }
  process.env.INSTAGRAM_APP_SECRET = 'test-secret'
  const module = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync('app/api/instagram/webhook/route.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  new Function('exports', 'require', 'module', code)(module.exports, name => mocks[name] || require(name), module)
  const raw = JSON.stringify({ entry: [{ id: 'business', messaging: [{ sender: { id: 'sender' }, recipient: { id: 'business' }, message: { mid: 'incoming', text: matched ? 'price' : 'unmatched' } }] }] })
  const signature = 'sha256=' + crypto.createHmac('sha256', 'test-secret').update(raw).digest('hex')
  const response = module.exports.POST({ text: async () => raw, headers: { get: () => signature } }).then(value => { finished = true; return value })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(sent, matched ? 1 : 0, 'keyword reply must not wait for profile lookup')
  assert.equal(finished, false, 'webhook must join pending inbox work, even without a match')
  releaseProfile()
  assert.deepEqual(await response, { ok: true })
  assert.equal(sent, matched ? 1 : 0, 'never send twice')
  if (!profileFails) {
    assert.equal(saved.filter(row => row.is_from_instagram).length, 1)
    assert.equal(saved.filter(row => !row.is_from_instagram).length, matched ? 1 : 0)
  }
}
async function main() {
  await test(true)
  await test(false)
  await test(true, true)
  console.log('PASS: reply precedes profile completion; inbox/outgoing saves joined; no-match and profile failure handled')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
