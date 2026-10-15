import { useEffect } from 'react'

const APP = 'D&D kampaně'

/** Název stránky v záložce prohlížeče a v historii: „Panel DM · Mirabilis · D&D kampaně“. Bez názvu zůstane jen název aplikace. */
export function usePageTitle(...parts: (string | undefined | null | false)[]) {
  const title = [...parts.filter((p): p is string => typeof p === 'string' && p !== ''), APP].join(' · ')
  useEffect(() => {
    document.title = title
  }, [title])
}
