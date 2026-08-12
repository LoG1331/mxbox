import { Suspense, lazy, startTransition, useEffect, useMemo, useState } from 'react'
import {
  Ban,
  Bot,
  Crown,
  Globe2,
  LayoutDashboard,
  Mail,
  ShieldCheck,
  Users2,
} from 'lucide-react'
import { toast } from 'react-hot-toast'
import AppShell from './components/AppShell.jsx'
import AuthScreen from './components/AuthScreen.jsx'
import { getMe, login, logout, refreshSession } from './lib/api.js'
import { formatApiError } from './lib/format.js'
const AdminsView = lazy(() => import('./views/AdminsView.jsx'))
const AdminEmailsView = lazy(() => import('./views/AdminEmailsView.jsx'))
const BlockedSendersView = lazy(() => import('./views/BlockedSendersView.jsx'))
const DomainsView = lazy(() => import('./views/DomainsView.jsx'))
const EmailsView = lazy(() => import('./views/EmailsView.jsx'))
const OverviewView = lazy(() => import('./views/OverviewView.jsx'))
const PermissionsView = lazy(() => import('./views/PermissionsView.jsx'))
const TelegramView = lazy(() => import('./views/TelegramView.jsx'))
const UsersView = lazy(() => import('./views/UsersView.jsx'))

const STORAGE_KEY = 'frontend.sessionToken'

const BASE_NAV_ITEMS = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'emails', label: 'My Mail', icon: Mail },
  { id: 'domains', label: 'Domains', icon: Globe2 },
]

const ADMIN_NAV_ITEMS = [
  { id: 'admin-mails', label: 'System Mail', icon: Mail },
  { id: 'blocked-senders', label: 'Blocked Senders', icon: Ban },
  { id: 'telegram', label: 'Telegram Bot', icon: Bot },
  { id: 'users', label: 'Users', icon: Users2 },
  { id: 'permissions', label: 'Permissions', icon: ShieldCheck },
  { id: 'admins', label: 'Admin', icon: Crown },
]

const VIEW_LABELS = {
  overview: OverviewView,
  emails: EmailsView,
  'admin-mails': AdminEmailsView,
  'blocked-senders': BlockedSendersView,
  domains: DomainsView,
  telegram: TelegramView,
  users: UsersView,
  permissions: PermissionsView,
  admins: AdminsView,
}

// Virtual paths: each tab has its own URL; share/refresh/back keep the tab.
const VIEW_PATHS = {
  overview: '/',
  emails: '/mail',
  domains: '/domains',
  'admin-mails': '/system-mail',
  'blocked-senders': '/blocked-senders',
  telegram: '/telegram',
  users: '/users',
  permissions: '/permissions',
  admins: '/admins',
}
const PATH_VIEWS = Object.fromEntries(Object.entries(VIEW_PATHS).map(([view, path]) => [path, view]))

function viewFromLocation() {
  return PATH_VIEWS[window.location.pathname] || 'overview'
}

function readStoredToken() {
  return window.localStorage.getItem(STORAGE_KEY) || ''
}

function readSessionExpiry(token) {
  if (!token) {
    return null
  }

  try {
    const [, encodedPayload] = token.split('.')
    if (!encodedPayload) {
      return null
    }

    const normalized = encodedPayload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const payload = JSON.parse(window.atob(padded))
    if (!payload?.exp) {
      return null
    }

    return new Date(payload.exp * 1000).toISOString()
  } catch {
    return null
  }
}

export default function App() {
  const [token, setToken] = useState(() => readStoredToken())
  const [booting, setBooting] = useState(() => Boolean(readStoredToken()))
  const [account, setAccount] = useState(null)
  const [accessibleDomains, setAccessibleDomains] = useState([])
  const [sessionExpiresAt, setSessionExpiresAt] = useState(() => readSessionExpiry(readStoredToken()))
  const [activeView, setActiveView] = useState(() => viewFromLocation())

  useEffect(() => {
    function handlePopState() {
      setActiveView(viewFromLocation())
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  function navigate(viewId) {
    const path = VIEW_PATHS[viewId] || '/'
    if (window.location.pathname !== path) {
      window.history.pushState(null, '', path)
    }
    startTransition(() => setActiveView(viewId))
  }

  function persistToken(nextToken) {
    if (nextToken) {
      window.localStorage.setItem(STORAGE_KEY, nextToken)
    } else {
      window.localStorage.removeItem(STORAGE_KEY)
    }

    setToken(nextToken)
    setSessionExpiresAt(readSessionExpiry(nextToken))
  }

  async function syncCurrentAccount(currentToken) {
    const response = await getMe(currentToken)
    setAccount(response.account)
    setAccessibleDomains(response.accessibleDomains)
    return response
  }

  useEffect(() => {
    if (!token) {
      setBooting(false)
      setAccount(null)
      setAccessibleDomains([])
      setSessionExpiresAt(null)
      setActiveView('overview')
      // Reset the URL to '/' too so the old tab's path is gone after logout
      if (window.location.pathname !== '/') {
        window.history.replaceState(null, '', '/')
      }
      return
    }

    let cancelled = false
    setBooting(true)

    async function loadSession() {
      try {
        await syncCurrentAccount(token)
      } catch (error) {
        if (!cancelled) {
          persistToken('')
          toast.error(formatApiError(error))
        }
      } finally {
        if (!cancelled) {
          setBooting(false)
        }
      }
    }

    loadSession()

    return () => {
      cancelled = true
    }
  }, [token])

  const navItems = useMemo(() => {
    if (!account) {
      return BASE_NAV_ITEMS
    }

    return account.isAdmin ? [...BASE_NAV_ITEMS, ...ADMIN_NAV_ITEMS] : BASE_NAV_ITEMS
  }, [account])

  useEffect(() => {
    // account === null means the session is still loading — don't redirect yet,
    // otherwise refreshing an admin tab would bounce to overview before we know the role.
    if (!account || account.isAdmin) {
      return
    }

    if (ADMIN_NAV_ITEMS.some((item) => item.id === activeView)) {
      navigate('overview')
    }
  }, [account, activeView])

  async function handleLogin(credentials) {
    try {
      const response = await login(credentials)
      persistToken(response.sessionToken)
      setSessionExpiresAt(response.expiresAt)
      setAccount(response.account)
      const meResponse = await syncCurrentAccount(response.sessionToken)
      setAccessibleDomains(meResponse.accessibleDomains)
      toast.success('Signed in successfully')
    } catch (error) {
      toast.error(formatApiError(error))
      throw error
    }
  }

  async function handleLogout() {
    try {
      if (token) {
        await logout(token)
      }
    } catch (error) {
      toast.error(formatApiError(error))
    } finally {
      persistToken('')
      setAccount(null)
      setAccessibleDomains([])
      setSessionExpiresAt(null)
      setActiveView('overview')
    }
  }

  async function handleRefreshSession() {
    if (!token) {
      return null
    }

    const response = await refreshSession(token)
    persistToken(response.sessionToken)
    setSessionExpiresAt(response.expiresAt)
    return response
  }

  async function handleRefreshAccount() {
    if (!token) {
      return null
    }

    return syncCurrentAccount(token)
  }

  if (booting) {
    return (
      <main className="app-shell flex min-h-screen items-center justify-center px-4">
        <div className="panel-strong rounded-2xl px-6 py-7 text-center">
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#38bdf8]">Restoring session</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-white">Mail Dashboard</h1>
          <p className="mt-2 text-[13px] text-gray-400">Loading…</p>
        </div>
      </main>
    )
  }

  if (!token || !account) {
    return <AuthScreen onLogin={handleLogin} />
  }

  const ActiveView = VIEW_LABELS[activeView] || OverviewView

  return (
    <AppShell
      account={account}
      activeView={activeView}
      accessibleDomains={accessibleDomains}
      navItems={navItems}
      onNavigate={navigate}
      onLogout={handleLogout}
    >
      <Suspense
        fallback={(
          <section className="panel panel-tone-slate rounded-2xl px-5 py-7 sm:px-6">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#38bdf8]">Loading view</p>
            <h2 className="mt-2 text-2xl font-bold tracking-tight text-white">Loading…</h2>
          </section>
        )}
      >
        <ActiveView
          token={token}
          account={account}
          accessibleDomains={accessibleDomains}
          sessionExpiresAt={sessionExpiresAt}
          onRefreshAccount={handleRefreshAccount}
          onRefreshSession={handleRefreshSession}
        />
      </Suspense>
    </AppShell>
  )
}
