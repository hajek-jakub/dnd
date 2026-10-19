// Napodobený Claude API server pro API a E2E testy (žádné skutečné volání, nic se neplatí).
// Odpovědi řídí test: POST /__mock/script {key, responses: [...]} a ve zprávě DM značka [[mock:<key>]].
// Každý požadavek na /v1/messages se zaznamená (GET /__mock/log?key=<key>), takže test ověří, co aplikace do API poslala.
// Spuštění: node scripts/claude-mock.mjs [port]   (výchozí 8199, stejný jako claude_base_url v api/config.test.php)
import http from 'node:http'

const port = Number(process.argv[2] ?? process.env.CLAUDE_MOCK_PORT ?? 8199)
const API_KEY = 'test-claude-key'
/** @type {Map<string, any[]>} */
const scripts = new Map()
/** @type {Map<string, any[]>} */
const logs = new Map()
let counter = 0

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (chunk) => (data += chunk))
    req.on('end', () => resolve(data))
  })
}

/** Značka [[mock:klic]] v textu kterékoli zprávy uživatele určí scénář. */
function scenarioKey(body) {
  for (const m of body.messages ?? []) {
    if (m.role !== 'user') continue
    const parts = typeof m.content === 'string' ? [m.content] : (m.content ?? []).filter((b) => b.type === 'text').map((b) => b.text)
    for (const text of parts) {
      const found = /\[\[mock:([\w-]+)\]\]/.exec(text)
      if (found) return found[1]
    }
  }
  return null
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
  if (url.pathname === '/__mock/health') return send(res, 200, { ok: true })
  if (url.pathname === '/__mock/script' && req.method === 'POST') {
    const { key, responses } = JSON.parse(await readBody(req))
    scripts.set(key, [...responses])
    logs.set(key, [])
    return send(res, 200, { ok: true })
  }
  if (url.pathname === '/__mock/log') return send(res, 200, { requests: logs.get(url.searchParams.get('key') ?? '') ?? [] })

  if (req.headers['x-api-key'] !== API_KEY) {
    return send(res, 401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } })
  }
  if (url.pathname === '/v1/models' && req.method === 'GET') return send(res, 200, { data: [{ id: 'claude-opus-5-5' }], has_more: false })
  if (url.pathname !== '/v1/messages' || req.method !== 'POST') return send(res, 404, { type: 'error', error: { type: 'not_found_error', message: 'Not found' } })

  const body = JSON.parse(await readBody(req))
  const key = scenarioKey(body)
  if (key) logs.get(key)?.push({ headers: { version: req.headers['anthropic-version'], beta: req.headers['anthropic-beta'] ?? null }, body })
  const spec = (key && scripts.get(key)?.shift()) ?? { content: [{ type: 'text', text: 'Mock odpověď.' }] }
  if (spec.delayMs) await new Promise((r) => setTimeout(r, spec.delayMs))
  if (spec.status) return send(res, spec.status, spec.body ?? { type: 'error', error: { type: 'api_error', message: 'mock error' } })
  const content = spec.content ?? []
  send(res, 200, {
    id: `msg_mock_${++counter}`,
    type: 'message',
    role: 'assistant',
    model: body.model,
    content,
    stop_reason: spec.stop_reason ?? (content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn'),
    stop_sequence: null,
    stop_details: spec.stop_details ?? null,
    usage: spec.usage ?? { input_tokens: 1200, output_tokens: 150, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  })
})

server.listen(port, '127.0.0.1', () => console.log(`Claude mock na http://127.0.0.1:${port}`))
