import { BrowserRouter, Link, Route, Routes } from 'react-router-dom'
import { AppLayout } from '@/components/AppLayout'
import { buttonVariants } from '@/components/ui/button'
import { LoginPage } from '@/features/auth/LoginPage'
import { RegisterPage } from '@/features/auth/RegisterPage'
import { RequireAuth } from '@/features/auth/RequireAuth'
import { CampaignPage } from '@/features/campaigns/CampaignPage'
import { CampaignsPage } from '@/features/campaigns/CampaignsPage'
import { JoinPage } from '@/features/campaigns/JoinPage'
import { ProfilePage } from '@/features/profile/ProfilePage'
import { AboutPage } from '@/features/about/AboutPage'
import { HomebrewFormPage } from '@/features/rules/HomebrewFormPage'
import { RuleDetailPage } from '@/features/rules/RuleDetailPage'
import { RulesPage } from '@/features/rules/RulesPage'
import { CharacterPage } from '@/features/sheet/CharacterPage'
import { CreateCharacterPage } from '@/features/sheet/CreateCharacterPage'
import { LevelUpPage } from '@/features/sheet/LevelUpWizard'

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
        <Route path="/about" element={<AboutPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<AppLayout />}>
            <Route index element={<CampaignsPage />} />
            <Route path="campaigns/:campaignId" element={<CampaignPage />} />
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
