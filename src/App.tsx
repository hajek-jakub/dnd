import { lazy, Suspense } from 'react'
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom'
import { AppLayout } from '@/components/AppLayout'
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
const DmPage = lazy(() => import('@/features/dm/DmPage').then((m) => ({ default: m.DmPage })))
const MapsPage = lazy(() => import('@/features/maps/MapsPage').then((m) => ({ default: m.MapsPage })))
const JournalPage = lazy(() => import('@/features/journal/JournalPage').then((m) => ({ default: m.JournalPage })))
const MapViewPage = lazy(() => import('@/features/maps/MapViewPage'))
const MessagesPage = lazy(() => import('@/features/messages/MessagesPage').then((m) => ({ default: m.MessagesPage })))
const NotificationsPage = lazy(() => import('@/features/notifications/NotificationsPage').then((m) => ({ default: m.NotificationsPage })))
const AboutPage = lazy(() => import('@/features/about/AboutPage').then((m) => ({ default: m.AboutPage })))
const HomebrewFormPage = lazy(() => import('@/features/rules/HomebrewFormPage').then((m) => ({ default: m.HomebrewFormPage })))
const RuleDetailPage = lazy(() => import('@/features/rules/RuleDetailPage').then((m) => ({ default: m.RuleDetailPage })))
const RulesPage = lazy(() => import('@/features/rules/RulesPage').then((m) => ({ default: m.RulesPage })))
const CharacterPage = lazy(() => import('@/features/sheet/CharacterPage').then((m) => ({ default: m.CharacterPage })))
const EnemiesPage = lazy(() => import('@/features/enemies/EnemiesPage').then((m) => ({ default: m.EnemiesPage })))
const CreateCharacterPage = lazy(() => import('@/features/sheet/CreateCharacterPage').then((m) => ({ default: m.CreateCharacterPage })))
const LevelUpPage = lazy(() => import('@/features/sheet/LevelUpWizard').then((m) => ({ default: m.LevelUpPage })))

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
  // basename = Vite base (např. "/" nebo "/dnd/"), bez koncového lomítka
  const basename = import.meta.env.BASE_URL.replace(/\/$/, '')

  return (
    <BrowserRouter basename={basename}>
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
            <Route path="campaigns/:campaignId/enemies" element={<EnemiesPage />} />
            <Route path="campaigns/:campaignId/messages" element={<MessagesPage />} />
            <Route path="campaigns/:campaignId/journal" element={<JournalPage />} />
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
