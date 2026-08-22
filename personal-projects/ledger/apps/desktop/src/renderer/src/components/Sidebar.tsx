import { useState, type CSSProperties } from 'react'
import { SettingsModal } from './SettingsModal'

export type AppPage = 'budget' | 'savings' | 'loans'

interface SidebarProps {
  activePage: AppPage
  onNavigate: (page: AppPage) => void
}

const NAV_ITEMS: Array<{ key: AppPage; label: string }> = [
  { key: 'budget', label: 'Budget' },
  { key: 'savings', label: 'Savings' },
  { key: 'loans', label: 'Loans' }
]

const dragStyle = { WebkitAppRegion: 'drag' } as CSSProperties

export function Sidebar({ activePage, onNavigate }: SidebarProps) {
  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <aside className="flex w-44 shrink-0 flex-col border-r border-border bg-bg">
      <div className="h-9 shrink-0" style={dragStyle} />

      <div className="flex h-16 items-center justify-center px-3">
        <h1 className="text-2xl font-bold tracking-tight text-text">
          LEDGER<span className="text-accent">.</span>
        </h1>
      </div>

      <nav className="flex-1 space-y-1 px-3 pt-8">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.key}
            onClick={() => onNavigate(item.key)}
            className={`block w-full rounded-lg px-3 py-2 text-left text-sm font-medium transition ${
              activePage === item.key
                ? 'bg-surface-raised text-accent'
                : 'text-text-muted hover:bg-surface-raised hover:text-text'
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="p-3">
        <button
          onClick={() => setSettingsOpen(true)}
          className="w-full rounded-lg px-3 py-2 text-left text-sm text-text-muted hover:bg-surface-raised hover:text-text"
        >
          Settings
        </button>
      </div>

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </aside>
  )
}
