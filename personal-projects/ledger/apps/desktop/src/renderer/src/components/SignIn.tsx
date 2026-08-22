import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { inputClass, labelClass } from '../lib/formStyles'

type Mode = 'sign-in' | 'sign-up' | 'forgot-request' | 'forgot-confirm'

export function SignIn() {
  const [mode, setMode] = useState<Mode>('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [resetCode, setResetCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function resetTransientState() {
    setError(null)
    setNotice(null)
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    resetTransientState()
    setSubmitting(true)

    const { error } =
      mode === 'sign-in'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password })

    setSubmitting(false)

    if (error) {
      setError(error.message)
      return
    }

    if (mode === 'sign-up') {
      setNotice('Check your email to confirm your account, then sign in.')
    }
  }

  async function handleRequestReset(event: FormEvent) {
    event.preventDefault()
    resetTransientState()
    setSubmitting(true)

    const { error } = await supabase.auth.resetPasswordForEmail(email)

    setSubmitting(false)

    if (error) {
      setError(error.message)
      return
    }

    setNotice(`Sent a reset code to ${email}.`)
    setMode('forgot-confirm')
  }

  async function handleConfirmReset(event: FormEvent) {
    event.preventDefault()
    resetTransientState()

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setSubmitting(true)

    const { error: verifyError } = await supabase.auth.verifyOtp({
      email,
      token: resetCode,
      type: 'recovery'
    })

    if (verifyError) {
      setSubmitting(false)
      setError(verifyError.message)
      return
    }

    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })

    setSubmitting(false)

    if (updateError) {
      setError(updateError.message)
      return
    }

    // A valid recovery code signs the user in — App.tsx picks up the new
    // session automatically, so there's nothing left to do here.
  }

  function switchMode(next: Mode) {
    resetTransientState()
    setMode(next)
  }

  return (
    <div className="flex h-full w-full items-center justify-center bg-bg">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-8 shadow-2xl">
        <h1 className="mb-1 text-2xl font-bold tracking-tight text-text">
          LEDGER<span className="text-accent">.</span>
        </h1>

        {(mode === 'sign-in' || mode === 'sign-up') && (
          <>
            <p className="mb-6 text-sm text-text-muted">
              {mode === 'sign-in' ? 'Sign in to your account' : 'Create your account'}
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className={labelClass}>Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Password</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className={inputClass}
                />
              </div>

              {error && <p className="text-sm text-negative">{error}</p>}
              {notice && <p className="text-sm text-positive">{notice}</p>}

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-lg bg-accent px-3 py-2 font-semibold text-bg transition hover:bg-accent-strong disabled:opacity-50"
              >
                {mode === 'sign-in' ? 'Sign in' : 'Sign up'}
              </button>
            </form>

            <button
              type="button"
              onClick={() => switchMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')}
              className="mt-4 w-full text-center text-sm text-text-muted hover:text-text"
            >
              {mode === 'sign-in' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
            </button>

            {mode === 'sign-in' && (
              <button
                type="button"
                onClick={() => switchMode('forgot-request')}
                className="mt-2 w-full text-center text-sm text-text-muted hover:text-text"
              >
                Forgot password?
              </button>
            )}
          </>
        )}

        {mode === 'forgot-request' && (
          <>
            <p className="mb-6 text-sm text-text-muted">
              Enter your email and we'll send you a reset code.
            </p>

            <form onSubmit={handleRequestReset} className="space-y-4">
              <div>
                <label className={labelClass}>Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className={inputClass}
                />
              </div>

              {error && <p className="text-sm text-negative">{error}</p>}

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-lg bg-accent px-3 py-2 font-semibold text-bg transition hover:bg-accent-strong disabled:opacity-50"
              >
                {submitting ? 'Sending…' : 'Send reset code'}
              </button>
            </form>

            <button
              type="button"
              onClick={() => switchMode('sign-in')}
              className="mt-4 w-full text-center text-sm text-text-muted hover:text-text"
            >
              Back to sign in
            </button>
          </>
        )}

        {mode === 'forgot-confirm' && (
          <>
            <p className="mb-6 text-sm text-text-muted">
              Enter the code we emailed you and choose a new password.
            </p>

            <form onSubmit={handleConfirmReset} className="space-y-4">
              <div>
                <label className={labelClass}>Reset code</label>
                <input
                  type="text"
                  required
                  value={resetCode}
                  onChange={(event) => setResetCode(event.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>New password</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Confirm new password</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  className={inputClass}
                />
              </div>

              {error && <p className="text-sm text-negative">{error}</p>}
              {notice && <p className="text-sm text-positive">{notice}</p>}

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-lg bg-accent px-3 py-2 font-semibold text-bg transition hover:bg-accent-strong disabled:opacity-50"
              >
                {submitting ? 'Resetting…' : 'Reset password'}
              </button>
            </form>

            <button
              type="button"
              onClick={() => switchMode('forgot-request')}
              className="mt-4 w-full text-center text-sm text-text-muted hover:text-text"
            >
              Didn't get a code? Try again
            </button>
          </>
        )}
      </div>
    </div>
  )
}
