import { Children, isValidElement, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** Vodorovná mezera mezi sloupci i svislá mezera mezi kartami (px). */
const GAP = 16

/**
 * Karty se skládají do sloupců podle skutečné výšky (každá další jde pod nejkratší sloupec), takže vedle sebe nezůstávají prázdná místa.
 * Telefon (pod `tab`): jeden sloupec pod sebou (flex, takže funguje i `order`). Tablet: dva sloupce, počítač (`lg`): tři (`columns` přepíše počet).
 * Technika: mřížka s řádky po 1 px, každá karta si podle výšky obsahu (ResizeObserver) řekne, kolik řádků zabere.
 * Pořadí karet v DOM zůstává stejné (čtečky a tabulátor), mění se jen umístění.
 */
export function Masonry({ children, className, columns = 'tab:grid-cols-2 lg:grid-cols-3' }: { children: ReactNode; className?: string; columns?: string }) {
  return <div className={cn('flex flex-col gap-4 tab:grid tab:auto-rows-[1px] tab:items-start tab:gap-y-0', columns, className)}>{children}</div>
}

/** Jedna karta v `Masonry`. `className` jde třeba `tab:col-span-2` pro kartu přes celou šířku. */
export function MasonryItem({ children, className }: { children: ReactNode; className?: string }) {
  const inner = useRef<HTMLDivElement>(null)
  const [span, setSpan] = useState<number | undefined>(undefined)

  useLayoutEffect(() => {
    const el = inner.current
    if (!el) return
    const measure = () => {
      const h = el.getBoundingClientRect().height
      // Prázdná karta (komponenta nic nevykreslila) nezabírá žádné místo ani mezeru.
      setSpan(h === 0 ? 1 : Math.ceil(h) + GAP)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div className={cn('min-w-0 has-[>div:empty]:hidden', className)} style={span === undefined ? undefined : { gridRowEnd: `span ${span}` }}>
      <div ref={inner}>{children}</div>
    </div>
  )
}

/** Obalí každé dítě `Masonry` do `MasonryItem` (`false`/`null` vynechá `Children.toArray`). */
export function MasonryCards({ children, className, columns }: { children: ReactNode; className?: string; columns?: string }) {
  return (
    <Masonry className={className} columns={columns}>
      {Children.toArray(children).map((c, i) => (isValidElement(c) && c.key !== null ? <MasonryItem key={c.key}>{c}</MasonryItem> : <MasonryItem key={i}>{c}</MasonryItem>))}
    </Masonry>
  )
}
