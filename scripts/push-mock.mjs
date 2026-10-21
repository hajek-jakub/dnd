// Napodobená push služba pro API testy (žádné skutečné volání Googlu, Applu ani Mozilly).
// Každý POST na /push/<klíč> se zaznamená (GET /__mock/log?key=<klíč>): hlavičky a tělo (base64), takže test šifrovaný obsah
// sám rozšifruje stejným postupem jako prohlížeč. Klíč začínající „gone“ odpoví 410 (zařízení odběr zrušilo), „fail“ odpoví 500.
// Spuštění: node scripts/push-mock.mjs [port]   (výchozí 8198, stejný jako push_test_hosts v api/config.test.php)
import http from 'node:http'

const port = Number(process.argv[2] ?? process.env.PUSH_MOCK_PORT ?? 8198)
/** @type {Map<string, any[]>} */
const logs = new Map()

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
  if (url.pathname === '/__mock/health') {
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}')
    return
  }
  if (url.pathname === '/__mock/log') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ requests: logs.get(url.searchParams.get('key') ?? '') ?? [] }))
    return
  }
  const key = url.pathname.replace(/^\/push\//, '')
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    const list = logs.get(key) ?? []
    list.push({ method: req.method, headers: req.headers, body: Buffer.concat(chunks).toString('base64') })
    logs.set(key, list)
    res.writeHead(key.startsWith('gone') ? 410 : key.startsWith('fail') ? 500 : 201).end()
  })
})
server.listen(port, '127.0.0.1')
