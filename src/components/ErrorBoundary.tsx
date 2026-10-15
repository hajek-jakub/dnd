import { Component, type ErrorInfo, type ReactNode } from 'react'

interface State {
  failed: boolean
}

/** Poslední záchrana: když se při vykreslení něco rozbije, uživatel neuvidí prázdnou stránku, ale srozumitelnou hlášku. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Chyba v aplikaci:', error, info.componentStack)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div role="alert" className="mx-auto max-w-md space-y-4 p-8 text-center">
        <h1 className="text-2xl font-bold">Něco se pokazilo</h1>
        <p className="text-muted-foreground">Stránku se nepodařilo zobrazit. Obnov ji, a když se to bude opakovat, dej vědět DM.</p>
        <div className="flex justify-center gap-2">
          <button type="button" className="inline-flex h-11 items-center rounded-lg bg-primary px-4 font-medium text-primary-foreground" onClick={() => window.location.reload()}>
            Obnovit stránku
          </button>
          <a href="/" className="inline-flex h-11 items-center rounded-lg border px-4 font-medium">
            Na úvod
          </a>
        </div>
      </div>
    )
  }
}
