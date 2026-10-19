import React, { useState } from 'react'
import { X, Lock, Mail, User as UserIcon, LogIn, UserPlus, Sparkles, AlertCircle, Check } from 'lucide-react'
import { ManaLogo } from './ManaLogo'
import { AuthUser } from '../types/chat'

interface AuthModalProps {
  isOpen: boolean
  onClose: () => void
  onAuthSuccess: (user: AuthUser, token: string) => void
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, onAuthSuccess }) => {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
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

    if (!email.trim() || !password.trim()) {
      setError('Please fill in both email and password.')
      return
    }

    if (mode === 'signup' && !name.trim()) {
      setError('Please enter your name.')
      return
    }

    setLoading(true)

    try {
      const endpoint = mode === 'signup' ? '/api/auth/signup' : '/api/auth/login'
      const payload = mode === 'signup' 
        ? { name: name.trim(), email: email.trim(), password }
        : { email: email.trim(), password }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const data = await res.json()

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Authentication failed. Please check your credentials.')
      }

      setSuccessMsg(mode === 'signup' ? '🎉 Account created successfully!' : '👋 Welcome back!')
      
      // Save to localStorage
      if (data.token) {
        localStorage.setItem('mana_auth_token', data.token)
      }
      if (data.user) {
        localStorage.setItem('mana_user', JSON.stringify(data.user))
      }

      setTimeout(() => {
        onAuthSuccess(data.user, data.token)
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
              <div style={{ fontSize: '1rem', fontWeight: 600, color: '#f1f5f9' }}>
                Mana AI Account
              </div>
              <div style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 400 }}>
                Your AI. Your World.
              </div>
            </div>
          </div>
          <button className="code-copy-btn" onClick={onClose} id="btn-close-auth" title="Close">
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
            }}
            id="tab-signup"
          >
            <UserPlus size={15} />
            <span>Sign Up</span>
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
              <label className="form-label">
                <UserIcon size={14} color="#818cf8" />
                <span>Full Name</span>
              </label>
              <input
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
            <label className="form-label">
              <Mail size={14} color="#818cf8" />
              <span>Email Address</span>
            </label>
            <input
              type="email"
              className="form-input"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus={mode === 'signin'}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">
              <Lock size={14} color="#818cf8" />
              <span>Password</span>
            </label>
            <input
              type="password"
              className="form-input"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {mode === 'signin' && (
            <div className="demo-credentials-box">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#38bdf8' }}>
                <Sparkles size={14} />
                <span style={{ fontWeight: 600 }}>Demo Account Available</span>
              </div>
              <p style={{ margin: '0.2rem 0', color: '#94a3b8', fontSize: '0.78rem' }}>
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

          <div className="modal-footer" style={{ marginTop: '1.2rem', padding: '0.8rem 0 0 0' }}>
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
              ) : (
                'Create Account'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
