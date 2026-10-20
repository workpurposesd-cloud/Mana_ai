import React, { useState } from 'react'
import { X, Lock, Mail, User as UserIcon, LogIn, UserPlus, Sparkles, AlertCircle, Check, KeyRound, Eye, EyeOff } from 'lucide-react'
import { ManaLogo } from './ManaLogo'
import { AuthUser } from '../types/chat'
import { safeApiFetch } from '../utils/api'

interface AuthModalProps {
  isOpen: boolean
  onClose: () => void
  onAuthSuccess: (user: AuthUser, token: string) => void
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, onAuthSuccess }) => {
  const [mode, setMode] = useState<'signin' | 'signup' | 'reset'>('signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  if (!isOpen) return null

  const handleFillDemo = () => {
    setEmail('nagesh@mana.ai')
    setPassword('password123')
    setError(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccessMsg(null)

    if (!email.trim()) {
      setError('Please enter your email address.')
      return
    }

    if (!password.trim() || password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }

    if (mode === 'signup' && !name.trim()) {
      setError('Please enter your full name.')
      return
    }

    setLoading(true)

    try {
      if (mode === 'reset') {
        const res = await safeApiFetch<{ message?: string }>('/api/auth/reset-password', {
          method: 'POST',
          body: JSON.stringify({ email: email.trim(), newPassword: password }),
        })

        if (!res.success) {
          throw new Error(res.error || 'Password reset failed.')
        }

        setSuccessMsg('✅ Password reset successfully! Please sign in with your new password.')
        setTimeout(() => {
          setMode('signin')
          setSuccessMsg(null)
        }, 2000)
        return
      }

      const endpoint = mode === 'signup' ? '/api/auth/signup' : '/api/auth/login'
      const payload = mode === 'signup'
        ? { name: name.trim(), email: email.trim(), password }
        : { email: email.trim(), password }

      const res = await safeApiFetch<{ user: AuthUser; token: string }>(endpoint, {
        method: 'POST',
        body: JSON.stringify(payload),
      })

      if (!res.success || !res.data) {
        throw new Error(res.error || 'Authentication failed. Please check your credentials.')
      }

      const { user, token } = res.data

      setSuccessMsg(mode === 'signup' ? '🎉 Account created successfully!' : '👋 Welcome back!')

      // Save to localStorage for instant persistence across reloads
      if (token) {
        localStorage.setItem('mana_auth_token', token)
      }
      if (user) {
        localStorage.setItem('mana_user', JSON.stringify(user))
      }

      setTimeout(() => {
        onAuthSuccess(user, token)
        onClose()
      }, 600)
    } catch (err: any) {
      setError(err.message || 'An error occurred during authentication.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content auth-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <div className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <ManaLogo size={24} />
            <div>
              <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-main)' }}>
                Mana AI Account
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 400 }}>
                Your AI. Your World.
              </div>
            </div>
          </div>
          <button className="code-copy-btn" onClick={onClose} id="btn-close-auth" title="Close" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {/* Tab switch */}
        <div className="auth-tabs">
          <button
            type="button"
            className={`auth-tab-btn ${mode === 'signin' ? 'active' : ''}`}
            onClick={() => {
              setMode('signin')
              setError(null)
              setSuccessMsg(null)
            }}
            id="tab-signin"
          >
            <LogIn size={15} />
            <span>Sign In</span>
          </button>
          <button
            type="button"
            className={`auth-tab-btn ${mode === 'signup' ? 'active' : ''}`}
            onClick={() => {
              setMode('signup')
              setError(null)
              setSuccessMsg(null)
            }}
            id="tab-signup"
          >
            <UserPlus size={15} />
            <span>Sign Up</span>
          </button>
          <button
            type="button"
            className={`auth-tab-btn ${mode === 'reset' ? 'active' : ''}`}
            onClick={() => {
              setMode('reset')
              setError(null)
              setSuccessMsg(null)
            }}
            id="tab-reset"
          >
            <KeyRound size={15} />
            <span>Reset</span>
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="auth-form-body">
          {error && (
            <div className="auth-error-banner">
              <AlertCircle size={15} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}

          {successMsg && (
            <div className="auth-success-banner">
              <Check size={15} style={{ flexShrink: 0 }} />
              <span>{successMsg}</span>
            </div>
          )}

          {mode === 'signup' && (
            <div className="form-group">
              <label className="form-label" htmlFor="auth-name-input">
                <UserIcon size={14} style={{ color: 'var(--text-muted)' }} />
                <span>Full Name</span>
              </label>
              <input
                id="auth-name-input"
                type="text"
                className="form-input"
                placeholder="e.g. U Nagesh"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                required
              />
            </div>
          )}

          <div className="form-group">
            <label className="form-label" htmlFor="auth-email-input">
              <Mail size={14} style={{ color: 'var(--text-muted)' }} />
              <span>Email Address</span>
            </label>
            <input
              id="auth-email-input"
              type="email"
              className="form-input"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus={mode === 'signin' || mode === 'reset'}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="auth-password-input">
              <Lock size={14} style={{ color: 'var(--text-muted)' }} />
              <span>{mode === 'reset' ? 'New Password' : 'Password'}</span>
            </label>
            <div className="auth-password-wrapper">
              <input
                id="auth-password-input"
                type={showPassword ? 'text' : 'password'}
                className="form-input"
                placeholder={mode === 'reset' ? 'Enter new password (min 6 chars)' : 'Enter your password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button
                type="button"
                className="auth-password-toggle"
                onClick={() => setShowPassword((prev) => !prev)}
                title={showPassword ? 'Hide password' : 'Show password'}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {mode === 'signin' && (
            <div className="demo-credentials-box">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-main)', fontSize: '0.82rem' }}>
                <Sparkles size={14} />
                <span style={{ fontWeight: 600 }}>Demo Account Available</span>
              </div>
              <p style={{ margin: '0.2rem 0', color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                Quick test with pre-configured profile:
              </p>
              <button
                type="button"
                className="demo-fill-btn"
                onClick={handleFillDemo}
              >
                Use <code>nagesh@mana.ai</code> (Auto-fill)
              </button>
            </div>
          )}

          <div className="modal-footer" style={{ marginTop: '1.2rem', padding: '0.8rem 0 0 0', background: 'transparent', borderTop: 'none' }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={loading}
              id="btn-auth-submit"
            >
              {loading ? (
                <span>Processing...</span>
              ) : mode === 'signin' ? (
                'Sign In'
              ) : mode === 'signup' ? (
                'Create Account'
              ) : (
                'Reset Password'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
