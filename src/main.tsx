import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@/components/theme'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Toaster } from '@/components/ui/sonner'
import { AuthProvider } from '@/features/auth/AuthProvider'

// gcTime: data stránek, kam se člověk za hraní vrací, zůstanou v paměti (a v uložené cache, query-persist.ts) i po odchodu ze stránky.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, gcTime: 30 * 60_000, refetchOnWindowFocus: true, retry: 1 },
  },
})

// Po nasazení nové verze server staré soubory stránek smaže: otevřená aplikace, která by je chtěla načíst, se jednou obnoví na novou verzi.
window.addEventListener('vite:preloadError', (event) => {
  const last = Number(sessionStorage.getItem('dnd.reloadedAt') ?? 0)
  if (Date.now() - last < 60_000) return
  sessionStorage.setItem('dnd.reloadedAt', String(Date.now()))
  event.preventDefault()
  window.location.reload()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <App />
          </AuthProvider>
        </QueryClientProvider>
      </ErrorBoundary>
      <Toaster position="top-center" />
    </ThemeProvider>
  </StrictMode>,
)
