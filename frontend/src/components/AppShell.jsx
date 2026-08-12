import { useEffect, useState } from 'react'
import { LogOut, Menu, ShieldCheck, X } from 'lucide-react'
import { Badge } from './ui.jsx'
import { cn } from '../lib/format.js'

function SidebarItem({ item, active, onClick }) {
  const Icon = item.icon

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group relative flex w-full items-center gap-3 overflow-hidden rounded-xl px-4 py-3 text-left transition-all duration-300',
        active
          ? 'border border-[#38bdf8]/20 bg-[#38bdf8]/10 font-medium text-white'
          : 'border border-transparent text-gray-400 hover:bg-white/5 hover:text-white',
      )}
    >
      {active ? (
        <div className="absolute bottom-0 left-0 top-0 w-1 bg-[#38bdf8] shadow-[0_0_10px_#38bdf8]" />
      ) : null}
      <Icon className={cn('h-5 w-5 transition-transform group-hover:scale-110', active ? 'text-[#38bdf8]' : '')} />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.badge ? <Badge tone={active ? 'accent' : 'neutral'}>{item.badge}</Badge> : null}
    </button>
  )
}

function AccountCard({ account, permissionCount, accessibleDomainCount }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-semibold text-white">{account.displayName || account.username}</p>
          {account.isAdmin ? (
            <ShieldCheck className="h-4 w-4 shrink-0 text-[#38bdf8]" />
          ) : null}
        </div>
        <p className="truncate text-[11px] text-gray-400">
          @{account.username} · {accessibleDomainCount} domains · {permissionCount} permissions
        </p>
      </div>
    </div>
  )
}

export default function AppShell({
  account,
  activeView,
  accessibleDomains,
  navItems,
  onNavigate,
  onLogout,
  children,
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const permissionCount = account.permissions?.length || 0
  const accessibleDomainCount = accessibleDomains.length

  useEffect(() => {
    if (!mobileNavOpen) {
      return undefined
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [mobileNavOpen])

  function handleMobileNavigate(viewId) {
    setMobileNavOpen(false)
    onNavigate(viewId)
  }

  return (
    <div className="flex min-h-screen font-sans text-white">
      {/* Mobile Menu Overlay */}
      {mobileNavOpen ? (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      ) : null}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed z-50 flex h-full w-72 flex-col border-r border-white/5 bg-[#1a1a1a]/60 p-6 backdrop-blur-xl transition-transform duration-300',
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full',
          'md:translate-x-0',
        )}
      >
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-3 px-2">
            <img src="/logo_white.png" alt="Logo" className="h-9 w-auto object-contain" />
            <h1 className="text-base font-bold leading-tight tracking-wide text-white">
              Mail <span className="text-[#38bdf8]">Dashboard</span>
            </h1>
          </div>
          <button
            type="button"
            onClick={() => setMobileNavOpen(false)}
            className="rounded-lg p-2 transition-colors hover:bg-white/10 md:hidden"
            aria-label="Close navigation menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto">
          {navItems.map((item) => (
            <SidebarItem
              key={item.id}
              item={item}
              active={item.id === activeView}
              onClick={() => handleMobileNavigate(item.id)}
            />
          ))}
        </nav>

        <div className="space-y-3 border-t border-white/5 pt-4">
          <AccountCard
            account={account}
            permissionCount={permissionCount}
            accessibleDomainCount={accessibleDomainCount}
          />
          <button
            type="button"
            onClick={onLogout}
            className="flex w-full items-center gap-3 rounded-lg px-4 py-2 text-sm text-red-400 transition-all hover:bg-red-500/10 hover:text-red-300"
          >
            <LogOut className="h-4 w-4" />
            <span className="font-medium">Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="relative flex h-screen flex-1 flex-col overflow-hidden md:ml-72">
        {/* Mobile menu button (sidebar hidden on mobile) */}
        <button
          type="button"
          onClick={() => setMobileNavOpen(true)}
          className="fixed left-4 top-4 z-30 rounded-lg border border-white/10 bg-[#1a1a1a]/80 p-2 text-gray-400 backdrop-blur-md transition-colors hover:text-white md:hidden"
          aria-label="Open navigation menu"
        >
          <Menu className="h-5 w-5" />
        </button>

        <div className="relative z-0 flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden px-4 py-4 md:px-8 md:py-6">
          <div className="flex h-full min-h-0 flex-col pt-12 md:pt-0">{children}</div>
        </div>

        <footer className="z-30 shrink-0 border-t border-white/5 bg-[#121212]/80 py-4 text-center backdrop-blur-md">
          <div className="flex items-center justify-center gap-2 opacity-50 transition-opacity hover:opacity-100">
            <img src="/logo_white.png" alt="Logo" className="h-4 w-auto opacity-90" />
            <span className="text-xs font-bold text-white">Mail Dashboard</span>
          </div>
        </footer>
      </main>
    </div>
  )
}
