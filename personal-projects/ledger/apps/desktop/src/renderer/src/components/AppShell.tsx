import { useState, type CSSProperties } from 'react'
import { Sidebar, type AppPage } from './Sidebar'
import { BudgetPage } from '../pages/BudgetPage'
import { SavingsPage } from '../pages/SavingsPage'
import { LoansPage } from '../pages/LoansPage'

interface AppShellProps {
  userId: string
}

const dragStyle = { WebkitAppRegion: 'drag' } as CSSProperties

export function AppShell({ userId }: AppShellProps) {
  const [activePage, setActivePage] = useState<AppPage>('budget')

  return (
    <div className="flex h-screen">
      <Sidebar activePage={activePage} onNavigate={setActivePage} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="h-9 shrink-0 bg-bg" style={dragStyle} />
        <div className="flex-1 overflow-y-auto">
          {activePage === 'budget' && <BudgetPage userId={userId} />}
          {activePage === 'savings' && <SavingsPage userId={userId} />}
          {activePage === 'loans' && <LoansPage userId={userId} />}
        </div>
      </div>
    </div>
  )
}
