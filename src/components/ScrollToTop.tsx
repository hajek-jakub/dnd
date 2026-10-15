import { useEffect } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

/** Po přechodu na jinou stránku se začíná nahoře (SPA jinak nechá posun z předchozí stránky). Změna jen parametrů v adrese a tlačítko Zpět se nedotknou. */
export function ScrollToTop() {
  const { pathname } = useLocation()
  const type = useNavigationType()
  useEffect(() => {
    if (type !== 'POP') window.scrollTo({ top: 0 })
  }, [pathname, type])
  return null
}
