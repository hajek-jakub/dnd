/**
 * Klient pro PHP API (stejný origin, relace v HttpOnly cookie).
 * Základ cesty respektuje Vite base, takže funguje i při nasazení do podsložky.
 */
const API_BASE = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/api`

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly field?: string

  constructor(status: number, code: string, message: string, field?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.field = field
  }
}

type UnauthorizedListener = () => void
const unauthorizedListeners = new Set<UnauthorizedListener>()

/** Zavolá se, když server odmítne požadavek, protože relace vypršela (HTTP 401 "unauthorized"). */
export function onUnauthorized(listener: UnauthorizedListener): () => void {
  unauthorizedListeners.add(listener)
  return () => unauthorizedListeners.delete(listener)
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError(0, 'network', 'Server neodpovídá. Zkontroluj připojení a zkus to znovu.')
  }

  if (response.status === 204) return undefined as T

  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    // tělo není JSON (např. chyba hostingu); zpracuje se níže
  }

  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string; field?: string } } | null)?.error
    const apiError = new ApiError(
      response.status,
      error?.code ?? 'http_error',
      error?.message ?? `Server vrátil chybu ${response.status}.`,
      error?.field,
    )
    if (apiError.status === 401 && apiError.code === 'unauthorized') {
      unauthorizedListeners.forEach((listener) => listener())
    }
    throw apiError
  }
  return payload as T
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  delete: <T = void>(path: string) => request<T>('DELETE', path),
}
