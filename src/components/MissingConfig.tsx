export function MissingConfig() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-3 p-4">
      <h1 className="text-2xl font-bold">Chybí nastavení</h1>
      <p>
        Aplikace nemá nastavené <code>VITE_SUPABASE_URL</code> a <code>VITE_SUPABASE_ANON_KEY</code>. Zkopíruj{' '}
        <code>.env.example</code> do <code>.env.development.local</code>, vyplň hodnoty a restartuj <code>npm run dev</code>.
      </p>
    </main>
  )
}
