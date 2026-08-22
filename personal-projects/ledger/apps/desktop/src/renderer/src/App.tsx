import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './lib/AuthContext'
import { TitleBar } from './components/TitleBar'
import { SignIn } from './components/SignIn'
import { AppShell } from './components/AppShell'

const queryClient = new QueryClient()

function Root() {
  const { session, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex h-screen flex-col bg-bg">
        <TitleBar />
        <div className="flex flex-1 items-center justify-center text-text-muted">Loading…</div>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="flex h-screen flex-col bg-bg">
        <TitleBar />
        <div className="flex-1 overflow-hidden">
          <SignIn />
        </div>
      </div>
    )
  }

  return <AppShell userId={session.user.id} />
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Root />
      </AuthProvider>
    </QueryClientProvider>
  )
}

export default App
