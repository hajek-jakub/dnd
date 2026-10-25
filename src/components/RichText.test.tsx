import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RichText } from './RichText'
import { parseBlocks } from './rich-text'

describe('RichText', () => {
  it('rozpozná nadpisy, odrážky a odstavce', () => {
    expect(parseBlocks('# Nadpis\nprvní řádek\ndruhý řádek\n\n- a\n- b\n\nKonec')).toEqual([
      { type: 'heading', level: 1, text: 'Nadpis' },
      { type: 'paragraph', text: 'první řádek\ndruhý řádek' },
      { type: 'list', items: ['a', 'b'] },
      { type: 'paragraph', text: 'Konec' },
    ])
  })

  it('drží Entery i prázdné řádky tak, jak byly napsané', () => {
    expect(parseBlocks('Ráno\nPoledne\n\n\nVečer\r\nNoc')).toEqual([{ type: 'paragraph', text: 'Ráno\nPoledne\n\n\nVečer\nNoc' }])
    expect(parseBlocks('\n\nÚvod\n\n\n- a\n\n\n\n# Konec\n\n')).toEqual([
      { type: 'paragraph', text: 'Úvod' },
      { type: 'gap', lines: 1 },
      { type: 'list', items: ['a'] },
      { type: 'gap', lines: 2 },
      { type: 'heading', level: 1, text: 'Konec' },
    ])
    const { container } = render(<RichText text={'a\n\nb   c'} />)
    expect(container.querySelector('p')?.textContent).toBe('a\n\nb   c')
    expect(container.querySelector('p')).toHaveClass('whitespace-pre-wrap')
  })

  it('podkapitoly a citace (po sobě jdoucí řádky s „>“ jsou jedna citace)', () => {
    expect(parseBlocks('# Kapitola\n## Podkapitola\n> „První řádek\n> — přísloví“\nText\n> Druhá')).toEqual([
      { type: 'heading', level: 1, text: 'Kapitola' },
      { type: 'heading', level: 2, text: 'Podkapitola' },
      { type: 'quote', text: '„První řádek\n— přísloví“' },
      { type: 'paragraph', text: 'Text' },
      { type: 'quote', text: 'Druhá' },
    ])
    const { container } = render(<RichText text={'# A\n## B\n> **Moudrost**'} />)
    expect(container.querySelector('h3')?.textContent).toBe('A')
    expect(container.querySelector('h4')?.textContent).toBe('B')
    expect(container.querySelector('blockquote strong')?.textContent).toBe('Moudrost')
  })

  it('tučné, kurzíva a odkazy; odkaz míří ven bezpečně', () => {
    render(<RichText text="**Tučně** a *kurzívou* na https://example.com/mapa" />)
    expect(screen.getByText('Tučně').tagName).toBe('STRONG')
    expect(screen.getByText('kurzívou').tagName).toBe('EM')
    const link = screen.getByRole('link', { name: 'https://example.com/mapa' })
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('HTML a nebezpečné odkazy se nevykonají, jen se ukážou jako text', () => {
    const { container } = render(<RichText text={'<img src=x onerror=alert(1)> <script>alert(1)</script> javascript:alert(1) [x](javascript:alert(1))'} />)
    expect(container.querySelector('img, script')).toBeNull()
    expect(container.querySelector('a')).toBeNull()
    expect(container.textContent).toContain('<script>alert(1)</script>')
  })
})
