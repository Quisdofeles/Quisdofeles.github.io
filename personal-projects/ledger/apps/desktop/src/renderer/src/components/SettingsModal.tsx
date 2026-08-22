import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { Modal } from './Modal'
import { inputClass, labelClass } from '../lib/formStyles'

interface SettingsModalProps {
  onClose: () => void
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const [currentEmail, setCurrentEmail] = useState('')

  const [newEmail, setNewEmail] = useState('')
  const [emailSubmitting, setEmailSubmitting] = useState(false)
  const [emailError, setEmailError] = useState<string | null>(null)
  const [emailNotice, setEmailNotice] = useState<string | null>(null)

  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordSubmitting, setPasswordSubmitting] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [passwordNotice, setPasswordNotice] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setCurrentEmail(data.user?.email ?? '')
    })
  }, [])

  async function handleEmailSubmit(event: FormEvent) {
    event.preventDefault()
    setEmailError(null)
    setEmailNotice(null)
    setEmailSubmitting(true)

    const { error } = await supabase.auth.updateUser({ email: newEmail })

    setEmailSubmitting(false)

    if (error) {
      setEmailError(error.message)
      return
    }

    setEmailNotice("Check your new email (and possibly your old one) to confirm the change.")
    setNewEmail('')
  }

  async function handlePasswordSubmit(event: FormEvent) {
    event.preventDefault()
    setPasswordError(null)
    setPasswordNotice(null)

    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match.')
      return
    }

    setPasswordSubmitting(true)
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    setPasswordSubmitting(false)

    if (error) {
      setPasswordError(error.message)
      return
    }

    setPasswordNotice('Password updated.')
    setNewPassword('')
    setConfirmPassword('')
  }

  return (
    <Modal title="Settings" onClose={onClose}>
      <div className="space-y-6">
        <form onSubmit={handleEmailSubmit} className="space-y-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Email</h4>
          <p className="text-sm text-text-muted">Current: {currentEmail || '—'}</p>
          <div>
            <label className={labelClass}>New email</label>
            <input
              type="email"
              required
              value={newEmail}
              onChange={(event) => setNewEmail(event.target.value)}
              className={inputClass}
            />
          </div>
          {emailError && <p className="text-sm text-negative">{emailError}</p>}
          {emailNotice && <p className="text-sm text-positive">{emailNotice}</p>}
          <button
            type="submit"
            disabled={emailSubmitting}
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-bg transition hover:bg-accent-strong disabled:opacity-50"
          >
            {emailSubmitting ? 'Updating…' : 'Update email'}
          </button>
        </form>

        <form onSubmit={handlePasswordSubmit} className="space-y-3 border-t border-border pt-6">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Password</h4>
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
          {passwordError && <p className="text-sm text-negative">{passwordError}</p>}
          {passwordNotice && <p className="text-sm text-positive">{passwordNotice}</p>}
          <button
            type="submit"
            disabled={passwordSubmitting}
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-bg transition hover:bg-accent-strong disabled:opacity-50"
          >
            {passwordSubmitting ? 'Updating…' : 'Update password'}
          </button>
        </form>

        <div className="border-t border-border pt-6">
          <button
            type="button"
            onClick={() => supabase.auth.signOut()}
            className="w-full rounded-lg border border-border px-3 py-2 text-sm text-text-muted transition hover:bg-surface-raised hover:text-negative"
          >
            Sign out
          </button>
        </div>
      </div>
    </Modal>
  )
}
