import { makePng } from '../test-utils/png'

export { makePng }

/** Malý HTTP klient s cookie jar, který se chová jako jeden prohlížeč / jeden uživatel. */
const BASE = 'http://127.0.0.1:8181'

export interface ApiResult<T = any> {
  status: number
  body: T
  setCookie: string[]
}

let ipCounter = 0

export class Client {
  private cookies = new Map<string, string>()
  /** Každý klient se tváří jako jiná IP adresa (testovací konfigurace hlavičku X-Test-Ip respektuje). */
  readonly ip = `10.${Math.floor(++ipCounter / 65000)}.${Math.floor(ipCounter / 250) % 250}.${(ipCounter % 250) + 1}`

  async request<T = any>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<ApiResult<T>> {
    const cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ')
    const res = await fetch(BASE + path, {
      method,
      headers: {
        'X-Test-Ip': this.ip,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })

    const setCookie = res.headers.getSetCookie()
    for (const line of setCookie) {
      const [pair = ''] = line.split(';')
      const eq = pair.indexOf('=')
      const name = pair.slice(0, eq).trim()
      const value = pair.slice(eq + 1).trim()
      if (value === '' || /expires=Thu, 01 Jan 1970/i.test(line)) this.cookies.delete(name)
      else this.cookies.set(name, value)
    }

    const text = await res.text()
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T, setCookie }
  }

  /** Nahrání souboru (multipart/form-data) jako prohlížeč. */
  async upload<T = any>(path: string, field: string, bytes: Uint8Array, filename: string, type: string): Promise<ApiResult<T>> {
    const form = new FormData()
    form.append(field, new Blob([bytes], { type }), filename)
    const res = await fetch(BASE + path, { method: 'POST', headers: { 'X-Test-Ip': this.ip, ...this.cookieHeader() }, body: form })
    const text = await res.text()
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T, setCookie: [] }
  }

  /** Stažení binární odpovědi (obrázek). */
  async raw(path: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: Headers; bytes: Uint8Array }> {
    const res = await fetch(BASE + path, { headers: { 'X-Test-Ip': this.ip, ...this.cookieHeader(), ...headers } })
    return { status: res.status, headers: res.headers, bytes: new Uint8Array(await res.arrayBuffer()) }
  }

  private cookieHeader(): Record<string, string> {
    const cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ')
    return cookie ? { Cookie: cookie } : {}
  }

  get = <T = any>(path: string) => this.request<T>('GET', path)
  post = <T = any>(path: string, body: unknown = {}) => this.request<T>('POST', path, body)
  patch = <T = any>(path: string, body: unknown) => this.request<T>('PATCH', path, body)
  delete = <T = any>(path: string) => this.request<T>('DELETE', path)

  hasSession(): boolean {
    return this.cookies.has('dnd_session')
  }
}

export function uniqueName(prefix: string): string {
  // Náhodná část: testové soubory běží paralelně v oddělených procesech a sdílejí DB.
  return `${prefix}${Math.random().toString(36).slice(2, 10)}`
}

export const REGISTRATION_KEY = 'test-key'
export const PASSWORD = 'tajneheslo123'

export interface TestUser {
  client: Client
  id: string
  username: string
}

/** Zaregistruje nového uživatele pomocí registračního hesla (jako DM / první uživatel). */
export async function registerUser(prefix = 'user'): Promise<TestUser> {
  const client = new Client()
  const username = uniqueName(prefix)
  const res = await client.post('/auth/register', { username, password: PASSWORD, code: REGISTRATION_KEY })
  if (res.status !== 201) throw new Error(`Registrace selhala: ${res.status} ${JSON.stringify(res.body)}`)
  return { client, id: res.body.user.id, username }
}

/** Uživatel založí kampaň a vrátí její id. */
export async function createCampaign(user: TestUser, name = 'Testovací kampaň'): Promise<string> {
  const res = await user.client.post('/campaigns', { name })
  expectStatus(res, 201)
  return res.body.campaign.id
}

/** DM vytvoří pozvánku a vrátí její kód. */
export async function createInvite(dm: TestUser, campaignId: string, body: unknown = {}): Promise<{ id: string; code: string }> {
  const res = await dm.client.post(`/campaigns/${campaignId}/invites`, body)
  expectStatus(res, 201)
  return { id: res.body.invite.id, code: res.body.invite.code }
}

/** Nový uživatel se připojí do kampaně jako hráč (registrace s kódem pozvánky). */
export async function joinAsPlayer(dm: TestUser, campaignId: string, prefix = 'hrac'): Promise<TestUser> {
  const { code } = await createInvite(dm, campaignId)
  const client = new Client()
  const username = uniqueName(prefix)
  const res = await client.post('/auth/register', { username, password: PASSWORD, code })
  expectStatus(res, 201)
  return { client, id: res.body.user.id, username }
}

export function expectStatus(res: ApiResult, status: number): void {
  if (res.status !== status) {
    throw new Error(`Očekáván stav ${status}, přišel ${res.status}: ${JSON.stringify(res.body)}`)
  }
}

/** Rozměry JPEG ze značky SOF. */
export function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let i = 2
  while (i < bytes.length - 9) {
    if (bytes[i] !== 0xff) return null
    const marker = bytes[i + 1]!
    const length = (bytes[i + 2]! << 8) | bytes[i + 3]!
    if (marker >= 0xc0 && marker <= 0xc3) return { height: (bytes[i + 5]! << 8) | bytes[i + 6]!, width: (bytes[i + 7]! << 8) | bytes[i + 8]! }
    i += 2 + length
  }
  return null
}
