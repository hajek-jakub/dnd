import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from './ErrorBoundary'

function Boom(): never {
  throw new Error('rozbito')
}

describe('ErrorBoundary', () => {
  afterEach(() => vi.restoreAllMocks())

  it('při chybě ukáže srozumitelnou hlášku místo prázdné stránky', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Něco se pokazilo')
    expect(screen.getByRole('button', { name: 'Obnovit stránku' })).toBeInTheDocument()
  })

  it('bez chyby jen vykreslí obsah', () => {
    render(
      <ErrorBoundary>
        <p>vše funguje</p>
      </ErrorBoundary>,
    )
    expect(screen.getByText('vše funguje')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
