import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom'
import { AppLayout } from '@/components/AppLayout'
import { ScrollToTop } from '@/components/ScrollToTop'
import { FullPageSpinner } from '@/components/FullPageSpinner'
import { buttonVariants } from '@/components/ui/button'
import { LoginPage } from '@/features/auth/LoginPage'
import { RegisterPage } from '@/features/auth/RegisterPage'
import { RequireAuth } from '@/features/auth/RequireAuth'
import { CampaignPage } from '@/features/campaigns/CampaignPage'
import { CampaignsPage } from '@/features/campaigns/CampaignsPage'
import { HomeRoute } from '@/features/campaigns/HomeRoute'
import { JoinPage } from '@/features/campaigns/JoinPage'
import { ProfilePage } from '@/features/profile/ProfilePage'

// Těžší části (pravidlový engine, Leaflet, průvodce level upem) se načítají až při otevření stránky, ať se úvodní načtení nezdržuje.
// Po načtení se ty nejčastější stáhnou předem v době nečinnosti (preloadRoutes), takže přepnutí záložky pak nečeká na síť.
const loaders = {
  dm: () => import('@/features/dm/DmPage').then((m) => ({ default: m.DmPage })),
  loot: () => import('@/features/loot/LootPage').then((m) => ({ default: m.LootPage })),
  maps: () => import('@/features/maps/MapsPage').then((m) => ({ default: m.MapsPage })),
  journal: () => import('@/features/journal/JournalPage').then((m) => ({ default: m.JournalPage })),
  calendar: () => import('@/features/sessions/CalendarPage').then((m) => ({ default: m.CalendarPage })),
  mapView: () => import('@/features/maps/MapViewPage'),
  messages: () => import('@/features/messages/MessagesPage').then((m) => ({ default: m.MessagesPage })),
  notifications: () => import('@/features/notifications/NotificationsPage').then((m) => ({ default: m.NotificationsPage })),
  about: () => import('@/features/about/AboutPage').then((m) => ({ default: m.AboutPage })),
  homebrewForm: () => import('@/features/rules/HomebrewFormPage').then((m) => ({ default: m.HomebrewFormPage })),
  ruleDetail: () => import('@/features/rules/RuleDetailPage').then((m) => ({ default: m.RuleDetailPage })),
  rules: () => import('@/features/rules/RulesPage').then((m) => ({ default: m.RulesPage })),
  character: () => import('@/features/sheet/CharacterPage').then((m) => ({ default: m.CharacterPage })),
  createCharacter: () => import('@/features/sheet/CreateCharacterPage').then((m) => ({ default: m.CreateCharacterPage })),
  levelUp: () => import('@/features/sheet/LevelUpWizard').then((m) => ({ default: m.LevelUpPage })),
}
const DmPage = lazy(loaders.dm)
const LootPage = lazy(loaders.loot)
const MapsPage = lazy(loaders.maps)
const JournalPage = lazy(loaders.journal)
const CalendarPage = lazy(loaders.calendar)
const MapViewPage = lazy(loaders.mapView)
const MessagesPage = lazy(loaders.messages)
const NotificationsPage = lazy(loaders.notifications)
const AboutPage = lazy(loaders.about)
const HomebrewFormPage = lazy(loaders.homebrewForm)
const RuleDetailPage = lazy(loaders.ruleDetail)
const RulesPage = lazy(loaders.rules)
const CharacterPage = lazy(loaders.character)
const CreateCharacterPage = lazy(loaders.createCharacter)
const LevelUpPage = lazy(loaders.levelUp)

/** Stáhne předem stránky, na které se nejčastěji přepíná (sheet, deník, zprávy, mapy, pravidla); šetří data a přeskočí se při úsporném režimu. */
function preloadRoutes() {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection
  if (connection?.saveData || connection?.effectiveType === '2g' || connection?.effectiveType === 'slow-2g') return
  const queue = [loaders.character, loaders.messages, loaders.journal, loaders.dm, loaders.maps, loaders.rules]
  const idle = (cb: () => void) => {
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(cb, { timeout: 4000 })
    else globalThis.setTimeout(cb, 1500)
  }
  const next = () => {
    const load = queue.shift()
    if (!load) return
    void load().finally(() => idle(next))
  }
  idle(next)
}

function NotFound() {
  return (
    <div className="space-y-4 py-10 text-center">
      <h1 className="text-2xl font-bold">Stránka neexistuje</h1>
      <Link to="/" className={buttonVariants()}>
        Zpět na kampaně
      </Link>
    </div>
  )
}

export default function App() {
  useEffect(() => {
    if (import.meta.env.PROD) preloadRoutes()
  }, [])

  // basename = Vite base (např. "/" nebo "/dnd/"), bez koncového lomítka
  const basename = import.meta.env.BASE_URL.replace(/\/$/, '')

  return (
    <BrowserRouter basename={basename}>
      <ScrollToTop />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route
          path="/about"
          element={
            <Suspense fallback={<FullPageSpinner />}>
              <AboutPage />
            </Suspense>
          }
        />
        <Route element={<RequireAuth />}>
          <Route element={<AppLayout />}>
            <Route index element={<HomeRoute />} />
            <Route path="campaigns" element={<CampaignsPage />} />
            <Route path="campaigns/:campaignId" element={<CampaignPage />} />
            <Route path="campaigns/:campaignId/dm" element={<DmPage />} />
            <Route path="campaigns/:campaignId/dm/loot" element={<LootPage />} />
            <Route path="campaigns/:campaignId/messages" element={<MessagesPage />} />
            <Route path="campaigns/:campaignId/journal" element={<JournalPage />} />
            <Route path="campaigns/:campaignId/calendar" element={<CalendarPage />} />
            <Route path="campaigns/:campaignId/maps" element={<MapsPage />} />
            <Route path="campaigns/:campaignId/maps/:mapId" element={<MapViewPage />} />
            <Route path="notifications" element={<NotificationsPage />} />
            <Route path="campaigns/:campaignId/characters/new" element={<CreateCharacterPage />} />
            <Route path="characters/:id" element={<CharacterPage />} />
            <Route path="characters/:id/levelup" element={<LevelUpPage />} />
            <Route path="join/:code" element={<JoinPage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="rules" element={<RulesPage />}>
              <Route path="new" element={<HomebrewFormPage />} />
              <Route path=":id" element={<RuleDetailPage />} />
              <Route path=":id/edit" element={<HomebrewFormPage />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
