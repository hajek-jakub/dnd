import { useEffect, useRef } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

/** Po přechodu na jinou stránku se začíná nahoře (SPA jinak nechá posun z předchozí stránky). Změna jen parametrů v adrese (záložka, vybrané NPC) a tlačítko Zpět se nedotknou. */
export function ScrollToTop() {
  const { pathname } = useLocation()
  const type = useNavigationType()
  const previous = useRef(pathname)
  useEffect(() => {
    if (previous.current !== pathname && type !== 'POP') window.scrollTo({ top: 0 })
    previous.current = pathname
  }, [pathname, type])
  return null
}
