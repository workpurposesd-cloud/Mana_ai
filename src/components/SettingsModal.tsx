import React, { useState, useEffect, useCallback } from 'react'
import {
  X,
  Key,
  Search,
  Cpu,
  Sliders,
  Check,
  Globe,
  RefreshCw,
  Mic,
  Volume2,
  Play,
  Sparkles,
  Film,
  ArrowLeft,
  Sun,
  Moon,
  Monitor,
  Shield,
  Trash2,
  Download,
  Info,
  ChevronRight,
  Eye,
  EyeOff,
  RotateCcw,
  ExternalLink,
  AlertTriangle,
  Brain,
} from 'lucide-react'
import { AppConfig, VoiceLanguage, VoiceSettings } from '../types/chat'
import { voiceManager, DEFAULT_VOICE_SETTINGS } from '../utils/voiceManager'
import { safeApiFetch } from '../utils/api'
import { getThemePreference, applyTheme, ThemeMode } from '../utils/themeManager'

export type SettingsCategory =
  | 'appearance'
  | 'voice'
  | 'personalization'
  | 'models'
  | 'privacy'
  | 'about'

interface SettingsModalProps {
  config: AppConfig
  isOpen: boolean
  onClose: () => void
  onSave: (newConfig: Partial<AppConfig>) => Promise<void>
  onOpenMemory?: () => void
  onClearAllChats?: () => Promise<void>
  onExportChats?: () => void
}

const CATEGORIES: Array<{
  id: SettingsCategory
  title: string
  subtitle: string
  icon: React.ReactNode
}> = [
  {
    id: 'appearance',
    title: 'Appearance',
    subtitle: 'Theme and display options',
    icon: <Sun size={18} />,
  },
  {
    id: 'voice',
    title: 'Language & Voice',
    subtitle: 'Spoken language and speech synthesis',
    icon: <Globe size={18} />,
  },
  {
    id: 'personalization',
    title: 'Personalization',
    subtitle: 'Context memory and custom instructions',
    icon: <Sliders size={18} />,
  },
  {
    id: 'models',
    title: 'AI Models & Keys',
    subtitle: 'Google Gemini, model parameters, and search',
    icon: <Cpu size={18} />,
  },
  {
    id: 'privacy',
    title: 'Privacy & Data',
    subtitle: 'Export chat logs and manage stored data',
    icon: <Shield size={18} />,
  },
  {
    id: 'about',
    title: 'About Mana AI',
    subtitle: 'Version 1.2.0, details, and resources',
    icon: <Info size={18} />,
  },
]

export const SettingsModal: React.FC<SettingsModalProps> = ({
  config,
  isOpen,
  onClose,
  onSave,
  onOpenMemory,
  onClearAllChats,
  onExportChats,
}) => {
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>('appearance')
  const [mobileSubScreen, setMobileSubScreen] = useState<SettingsCategory | null>(null)
  const [isMobile, setIsMobile] = useState<boolean>(false)

  // Configuration state
  const [formData, setFormData] = useState<AppConfig>({ ...config })
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings>({
    ...DEFAULT_VOICE_SETTINGS,
    ...(config.voiceSettings || {}),
  })
  const [currentTheme, setCurrentTheme] = useState<ThemeMode>('system')
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([])

  // Tracking unsaved changes for manual text inputs
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)

  // Password visibility toggles
  const [showGeminiKey, setShowGeminiKey] = useState(false)
  const [showOpenaiKey, setShowOpenaiKey] = useState(false)
  const [showGroqKey, setShowGroqKey] = useState(false)

  // Local AI (Ollama) status state
  const [ollamaStatus, setOllamaStatus] = useState<{
    checking: boolean
    connected: boolean
    models: string[]
    error?: string
  }>({
    checking: false,
    connected: false,
    models: [],
  })

  const checkOllama = useCallback(async () => {
    setOllamaStatus((prev) => ({ ...prev, checking: true }))
    try {
      const res = await safeApiFetch<{
        connected: boolean
        models: string[]
        activeModel: string
        error?: string
      }>('/api/ollama/status')
      if (res.success && res.data) {
        setOllamaStatus({
          checking: false,
          connected: Boolean(res.data.connected),
          models: res.data.models || [],
          error: res.data.error,
        })
      } else {
        setOllamaStatus({
          checking: false,
          connected: false,
          models: [],
          error: res.error || 'Ollama not reachable',
        })
      }
    } catch {
      setOllamaStatus({
        checking: false,
        connected: false,
        models: [],
        error: 'Ollama not running',
      })
    }
  }, [])

  // Test search & test voice states
  const [testQuery, setTestQuery] = useState('latest cricket score')
  const [testResult, setTestResult] = useState<string | null>(null)
  const [isTestingSearch, setIsTestingSearch] = useState(false)
  const [isTestingVoice, setIsTestingVoice] = useState(false)

  // Privacy action states
  const [confirmDeleteChats, setConfirmDeleteChats] = useState(false)
  const [confirmDeleteMemories, setConfirmDeleteMemories] = useState(false)
  const [actionNotice, setActionNotice] = useState<string | null>(null)

  // Screen resize detection
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768)
    }
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  // Sync state when modal opens
  useEffect(() => {
    if (isOpen) {
      setFormData({ ...config })
      setVoiceSettings({
        ...DEFAULT_VOICE_SETTINGS,
        ...(config.voiceSettings || {}),
      })
      setCurrentTheme(getThemePreference())
      setHasUnsavedChanges(false)
      setSaveSuccess(false)
      setMobileSubScreen(null)
      setConfirmDeleteChats(false)
      setConfirmDeleteMemories(false)
      setActionNotice(null)

      voiceManager.getVoices().then((voices) => {
        setAvailableVoices(voices)
      })

      checkOllama()
    }
  }, [isOpen, config, checkOllama])

  // Instant save helper for toggles / dropdowns / themes
  const handleInstantSave = useCallback(
    async (partial: Partial<AppConfig>) => {
      try {
        await onSave(partial)
      } catch (err) {
        console.warn('Instant save error:', err)
      }
    },
    [onSave]
  )

  // Handle Theme Change
  const handleThemeChange = (newTheme: ThemeMode) => {
    setCurrentTheme(newTheme)
    applyTheme(newTheme)
    handleInstantSave({ theme: newTheme })
  }

  // Handle Voice Mode Toggle
  const handleToggleVoiceMode = (checked: boolean) => {
    const updated = { ...voiceSettings, voiceMode: checked }
    setVoiceSettings(updated)
    handleInstantSave({ voiceSettings: updated })
  }

  // Handle Voice Language Change
  const handleVoiceLanguageChange = (lang: VoiceLanguage) => {
    const updated = { ...voiceSettings, language: lang }
    setVoiceSettings(updated)
    handleInstantSave({ voiceSettings: updated })
  }

  // Handle Memory Toggle
  const handleToggleMemory = (checked: boolean) => {
    setFormData((prev) => ({ ...prev, memoryEnabled: checked }))
    handleInstantSave({ memoryEnabled: checked })
  }

  // Handle text input changes (marks unsaved changes)
  const handleTextChange = (field: keyof AppConfig, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
    setHasUnsavedChanges(true)
  }

  // Scoped Save for active category text inputs
  const handleSaveCategory = async () => {
    setIsSaving(true)
    try {
      await onSave({
        ...formData,
        voiceSettings,
      })
      setHasUnsavedChanges(false)
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 2000)
    } finally {
      setIsSaving(false)
    }
  }

  // Discard changes in current category
  const handleDiscardChanges = () => {
    setFormData({ ...config })
    setVoiceSettings({
      ...DEFAULT_VOICE_SETTINGS,
      ...(config.voiceSettings || {}),
    })
    setHasUnsavedChanges(false)
  }

  // Live Search Connectivity Test
  const handleTestSearch = async () => {
    if (!testQuery.trim()) return
    setIsTestingSearch(true)
    setTestResult(null)
    try {
      const res = await safeApiFetch<{ evidence?: any }>('/api/search', {
        method: 'POST',
        body: JSON.stringify({
          query: testQuery.trim(),
          provider: formData.searchProvider,
        }),
      })
      if (res.success && res.data?.evidence) {
        setTestResult(
          `✅ Found ${res.data.evidence.totalFound} results in ${res.data.evidence.tookMs}ms via ${res.data.evidence.provider}. Top: "${res.data.evidence.results[0]?.title || 'Result found'}"`
        )
      } else {
        setTestResult(`❌ Error: ${res.error || 'Search returned no evidence'}`)
      }
    } catch (err: any) {
      setTestResult(`❌ Network Error: ${err.message}`)
    } finally {
      setIsTestingSearch(false)
    }
  }

  // Test Voice Audio
  const handleTestVoice = async () => {
    setIsTestingVoice(true)
    let testPhrase = 'Hello! I am Mana AI, your personal AI assistant. Your AI, Your World.'
    if (voiceSettings.language === 'te-IN') {
      testPhrase = 'నమస్కారం! నేను మన ఏఐ (Mana AI) — మీ పర్సనల్ ఏఐ ఫ్రెండ్. మీ ఏఐ, మీ ప్రపంచం.'
    } else if (voiceSettings.language === 'hi-IN') {
      testPhrase = 'नमस्ते! मैं मना एआई (Mana AI) हूँ — आपका पर्सनल एआई साथी। Your AI, Your World.'
    }

    await voiceManager.speak(testPhrase, voiceSettings, {
      onEnd: () => setIsTestingVoice(false),
      onError: () => setIsTestingVoice(false),
    })
  }

  // Export Chat History
  const handleExportChatHistory = async () => {
    if (onExportChats) {
      onExportChats()
      setActionNotice('Export downloaded successfully!')
      setTimeout(() => setActionNotice(null), 3000)
      return
    }

    try {
      const res = await safeApiFetch<{ sessions: any[] }>('/api/chats')
      const exportData = {
        exportedAt: new Date().toISOString(),
        version: '1.2.0',
        sessions: res.data?.sessions || [],
      }
      const blob = new Blob([JSON.stringify(exportData, null, 2)], {
        type: 'application/json',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `mana-ai-chat-export-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      setActionNotice('Export downloaded successfully!')
      setTimeout(() => setActionNotice(null), 3000)
    } catch (err: any) {
      setActionNotice('Failed to export chats: ' + err.message)
    }
  }

  // Clear All Chat History
  const handleClearAllChats = async () => {
    try {
      if (onClearAllChats) {
        await onClearAllChats()
      } else {
        const res = await safeApiFetch<{ sessions: any[] }>('/api/chats')
        if (res.success && res.data?.sessions) {
          for (const s of res.data.sessions) {
            await safeApiFetch(`/api/chats/${s.id}`, { method: 'DELETE' })
          }
        }
      }
      setConfirmDeleteChats(false)
      setActionNotice('All chat conversations have been permanently cleared.')
      setTimeout(() => setActionNotice(null), 3500)
    } catch (err: any) {
      setActionNotice('Failed to clear chats: ' + err.message)
    }
  }

  // Clear All Memories
  const handleClearAllMemories = async () => {
    try {
      const res = await safeApiFetch<{ memories: any[] }>('/api/memories')
      if (res.success && res.data?.memories) {
        for (const m of res.data.memories) {
          await safeApiFetch(`/api/memories/${m.id}`, { method: 'DELETE' })
        }
      }
      setConfirmDeleteMemories(false)
      setActionNotice('All saved memories have been cleared.')
      setTimeout(() => setActionNotice(null), 3500)
    } catch (err: any) {
      setActionNotice('Failed to clear memories: ' + err.message)
    }
  }

  if (!isOpen) return null

  // Current category data
  const currentCategoryData =
    CATEGORIES.find((c) => c.id === activeCategory) || CATEGORIES[0]

  // Render Category Screen Content
  const renderCategoryContent = (categoryId: SettingsCategory) => {
    switch (categoryId) {
      /* ====================================================================
         1. Appearance
         ==================================================================== */
      case 'appearance':
        return (
          <>
            <div className="settings-card">
              <div className="settings-card-header">
                <span className="settings-card-title">
                  <Sun size={16} /> Theme Preference
                </span>
                <span className="form-hint">Applied immediately</span>
              </div>
              <span className="settings-card-desc">
                Select how Mana AI appears across your devices. Dark mode uses near-black
                backgrounds and soft high-contrast typography.
              </span>

              <div className="theme-picker-grid" style={{ marginTop: '0.4rem' }}>
                {/* System Card */}
                <div
                  className={`theme-card-option ${currentTheme === 'system' ? 'active' : ''}`}
                  onClick={() => handleThemeChange('system')}
                  role="button"
                  tabIndex={0}
                >
                  {currentTheme === 'system' && (
                    <div className="theme-card-check">
                      <Check size={12} strokeWidth={3} />
                    </div>
                  )}
                  <div className="theme-card-icon">
                    <Monitor size={20} />
                  </div>
                  <div className="theme-card-title">System</div>
                  <div className="theme-card-subtitle">Follows OS settings</div>
                </div>

                {/* Light Card */}
                <div
                  className={`theme-card-option ${currentTheme === 'light' ? 'active' : ''}`}
                  onClick={() => handleThemeChange('light')}
                  role="button"
                  tabIndex={0}
                >
                  {currentTheme === 'light' && (
                    <div className="theme-card-check">
                      <Check size={12} strokeWidth={3} />
                    </div>
                  )}
                  <div className="theme-card-icon">
                    <Sun size={20} />
                  </div>
                  <div className="theme-card-title">Light</div>
                  <div className="theme-card-subtitle">Clean white aesthetic</div>
                </div>

                {/* Dark Card */}
                <div
                  className={`theme-card-option ${currentTheme === 'dark' ? 'active' : ''}`}
                  onClick={() => handleThemeChange('dark')}
                  role="button"
                  tabIndex={0}
                >
                  {currentTheme === 'dark' && (
                    <div className="theme-card-check">
                      <Check size={12} strokeWidth={3} />
                    </div>
                  )}
                  <div className="theme-card-icon">
                    <Moon size={20} />
                  </div>
                  <div className="theme-card-title">Dark</div>
                  <div className="theme-card-subtitle">Near-black & easy on eyes</div>
                </div>
              </div>
            </div>

            <div className="settings-card">
              <span className="settings-card-title">
                <Sliders size={16} /> Visual Density & Emojis
              </span>
              <span className="settings-card-desc">
                Control how expressive Mana AI is when answering questions.
              </span>
              <div className="form-group" style={{ marginTop: '0.2rem' }}>
                <label className="form-label">Emoji Density</label>
                <select
                  className="form-select"
                  value={formData.emojiDensity || 'moderate'}
                  onChange={(e) => {
                    const val = e.target.value as any
                    setFormData((prev) => ({ ...prev, emojiDensity: val }))
                    handleInstantSave({ emojiDensity: val })
                  }}
                >
                  <option value="minimal">Minimal (Zero decorative emojis)</option>
                  <option value="moderate">Moderate (Clean and contextual)</option>
                  <option value="concise">Concise (Compact style)</option>
                </select>
              </div>
            </div>
          </>
        )

      /* ====================================================================
         2. Language & Voice
         ==================================================================== */
      case 'voice':
        return (
          <>
            {/* Preferred Language */}
            <div className="settings-card">
              <span className="settings-card-title">
                <Globe size={16} /> Preferred Language
              </span>
              <span className="settings-card-desc">
                Sets the speech recognition dialect and default speech synthesizer voice.
              </span>
              <select
                className="form-select"
                value={voiceSettings.language}
                onChange={(e) =>
                  handleVoiceLanguageChange(e.target.value as VoiceLanguage)
                }
                id="select-voice-language"
              >
                <option value="en-US">English (United States) — en-US</option>
                <option value="en-IN">English (India) — en-IN</option>
                <option value="te-IN">Telugu (తెలుగు) — te-IN</option>
                <option value="hi-IN">Hindi (हिंदी) — hi-IN</option>
              </select>
            </div>

            {/* Voice Mode Toggle Switch */}
            <div className="settings-toggle-row">
              <div className="settings-toggle-label">
                <span className="settings-toggle-title">
                  Enable Voice Mode (Auto-speak responses)
                </span>
                <span className="settings-toggle-desc">
                  When enabled, Mana AI will automatically read completed answers aloud.
                </span>
              </div>
              <label className="settings-switch">
                <input
                  type="checkbox"
                  checked={voiceSettings.voiceMode}
                  onChange={(e) => handleToggleVoiceMode(e.target.checked)}
                  id="checkbox-voice-mode"
                />
                <span className="settings-switch-slider"></span>
              </label>
            </div>

            {/* Voice-Specific Controls (Only visible when Voice Mode is enabled) */}
            {voiceSettings.voiceMode ? (
              <div className="settings-card">
                <span className="settings-card-title">
                  <Volume2 size={16} /> Speech Synthesizer & Controls
                </span>

                {availableVoices.length > 0 && (
                  <div className="form-group">
                    <label className="form-label">Voice Synthesizer</label>
                    <select
                      className="form-select"
                      value={voiceSettings.voiceURI || ''}
                      onChange={(e) => {
                        const updated = {
                          ...voiceSettings,
                          voiceURI: e.target.value || undefined,
                        }
                        setVoiceSettings(updated)
                        handleInstantSave({ voiceSettings: updated })
                      }}
                      id="select-voice-name"
                    >
                      <option value="">Default (Auto-select by language)</option>
                      {availableVoices.map((v) => (
                        <option key={v.voiceURI} value={v.voiceURI}>
                          {v.name} ({v.lang})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Speed & Pitch Sliders */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
                    gap: '0.85rem',
                  }}
                >
                  <div className="form-group">
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <label className="form-label">Speech Speed</label>
                      <span className="form-hint" style={{ fontWeight: 600 }}>
                        {voiceSettings.rate}x
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0.75"
                      max="1.5"
                      step="0.05"
                      value={voiceSettings.rate}
                      onChange={(e) => {
                        const rate = parseFloat(e.target.value)
                        const updated = { ...voiceSettings, rate }
                        setVoiceSettings(updated)
                        handleInstantSave({ voiceSettings: updated })
                      }}
                      className="form-range"
                    />
                  </div>

                  <div className="form-group">
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <label className="form-label">Speech Pitch</label>
                      <span className="form-hint" style={{ fontWeight: 600 }}>
                        {voiceSettings.pitch}x
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0.8"
                      max="1.2"
                      step="0.05"
                      value={voiceSettings.pitch}
                      onChange={(e) => {
                        const pitch = parseFloat(e.target.value)
                        const updated = { ...voiceSettings, pitch }
                        setVoiceSettings(updated)
                        handleInstantSave({ voiceSettings: updated })
                      }}
                      className="form-range"
                    />
                  </div>
                </div>

                {/* Test Voice Audio Button */}
                <div style={{ marginTop: '0.35rem' }}>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={handleTestVoice}
                    disabled={isTestingVoice}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.45rem',
                      fontSize: '0.85rem',
                    }}
                    id="btn-test-voice"
                  >
                    <Play size={14} fill="currentColor" />
                    <span>{isTestingVoice ? 'Speaking Test Audio...' : 'Test Voice Audio'}</span>
                  </button>
                </div>
              </div>
            ) : (
              <div
                style={{
                  padding: '1rem',
                  background: 'var(--bg-main)',
                  border: '1px dashed var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  color: 'var(--text-muted)',
                  fontSize: '0.82rem',
                  lineHeight: 1.4,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.6rem',
                }}
              >
                <Mic size={16} />
                <span>
                  Enable Voice Mode above to unlock synthesizer voice selection, playback speed, and audio controls.
                </span>
              </div>
            )}
          </>
        )

      /* ====================================================================
         3. Personalization
         ==================================================================== */
      case 'personalization':
        return (
          <>
            {/* Memory Toggle */}
            <div className="settings-toggle-row">
              <div className="settings-toggle-label">
                <span className="settings-toggle-title">
                  Enable Application Memory & Context Retention
                </span>
                <span className="settings-toggle-desc">
                  Remembers your preferences, facts, and corrections across sessions. Disable for private, stateless chat.
                </span>
              </div>
              <label className="settings-switch">
                <input
                  type="checkbox"
                  checked={formData.memoryEnabled !== false}
                  onChange={(e) => handleToggleMemory(e.target.checked)}
                  id="checkbox-memory-enabled"
                />
                <span className="settings-switch-slider"></span>
              </label>
            </div>

            {/* Saved Memories Actions */}
            <div className="settings-card">
              <span className="settings-card-title">
                <Brain size={16} /> Saved Context & Memories
              </span>
              <span className="settings-card-desc">
                Mana AI automatically extracts relevant personal facts, preferences, and project context to deliver tailored answers.
              </span>

              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '0.65rem',
                  marginTop: '0.35rem',
                }}
              >
                {onOpenMemory && (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      onClose()
                      onOpenMemory()
                    }}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.45rem',
                    }}
                  >
                    <Brain size={14} />
                    <span>Manage Saved Memories</span>
                  </button>
                )}

                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setConfirmDeleteMemories(true)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.45rem',
                    color: '#ef4444',
                  }}
                >
                  <Trash2 size={14} />
                  <span>Clear Saved Memories</span>
                </button>
              </div>

              {confirmDeleteMemories && (
                <div
                  style={{
                    marginTop: '0.75rem',
                    padding: '0.85rem',
                    background: 'rgba(239, 68, 68, 0.08)',
                    border: '1px solid rgba(239, 68, 68, 0.25)',
                    borderRadius: 'var(--radius-sm)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.5rem',
                  }}
                >
                  <span style={{ fontSize: '0.82rem', color: '#ef4444', fontWeight: 600 }}>
                    Are you sure you want to delete all saved memories?
                  </span>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      type="button"
                      className="btn-danger"
                      onClick={handleClearAllMemories}
                    >
                      Yes, Clear Memories
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setConfirmDeleteMemories(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Answer Conciseness */}
            <div className="settings-card">
              <span className="settings-card-title">
                <Sliders size={16} /> Response Conciseness
              </span>
              <span className="settings-card-desc">
                Sets maximum sentences for quick conversational answers.
              </span>
              <div className="form-group" style={{ marginTop: '0.2rem' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <label className="form-label">Direct Answer Sentence Limit</label>
                  <span className="form-hint" style={{ fontWeight: 600 }}>
                    {formData.maxShortSentences || 4} sentences
                  </span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="8"
                  step="1"
                  value={formData.maxShortSentences || 4}
                  onChange={(e) => {
                    const maxShortSentences = parseInt(e.target.value) || 4
                    setFormData((prev) => ({ ...prev, maxShortSentences }))
                    handleInstantSave({ maxShortSentences })
                  }}
                  className="form-range"
                />
              </div>
            </div>

            {/* Custom System Prompt */}
            <div className="settings-card">
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span className="settings-card-title">
                  <Sliders size={16} /> Custom System Persona
                </span>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    handleTextChange('systemPrompt', '')
                  }}
                  style={{
                    fontSize: '0.75rem',
                    padding: '0.25rem 0.6rem',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.3rem',
                  }}
                >
                  <RotateCcw size={12} /> Reset
                </button>
              </div>
              <span className="settings-card-desc">
                Customize instructions for Mana AI's tone, character, or specialized developer guidelines.
              </span>
              <textarea
                className="form-textarea"
                rows={4}
                value={formData.systemPrompt || ''}
                placeholder="Example: Always provide code examples in TypeScript. Be concise and professional."
                onChange={(e) => handleTextChange('systemPrompt', e.target.value)}
              />
            </div>
          </>
        )

      /* ====================================================================
         4. AI Models & Keys
         ==================================================================== */
      case 'models':
        return (
          <>
            {/* Primary AI Provider */}
            <div className="settings-card">
              <span className="settings-card-title">
                <Cpu size={16} /> Primary AI Provider
              </span>
              <span className="settings-card-desc">
                Choose the foundation engine for your conversational responses.
              </span>
              <select
                className="form-select"
                value={formData.aiProvider}
                onChange={(e) => {
                  const aiProvider = e.target.value as any
                  setFormData((prev) => ({ ...prev, aiProvider }))
                  handleInstantSave({ aiProvider })
                }}
                id="select-ai-provider"
              >
                <option value="ollama">Local AI (Ollama) — Completely Free, 100% Private (Default)</option>
                <option value="gemini">Google Gemini (Cloud — Fast, Intelligent)</option>
                <option value="openai">OpenAI (GPT-4o / GPT-4o-mini)</option>
                <option value="groq">Groq (Llama 3.1 Instant)</option>
                <option value="builtin">Built-in Smart Engine (Zero Key Required)</option>
              </select>
            </div>

            {/* Local Ollama Configuration */}
            {formData.aiProvider === 'ollama' && (
              <div className="settings-card">
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '0.5rem',
                  }}
                >
                  <span className="settings-card-title">
                    <Cpu size={16} /> Local Ollama Engine
                  </span>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={checkOllama}
                    disabled={ollamaStatus.checking}
                    style={{
                      fontSize: '0.75rem',
                      padding: '0.25rem 0.6rem',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                    }}
                  >
                    <RefreshCw
                      size={12}
                      style={{
                        animation: ollamaStatus.checking ? 'spin 1s linear infinite' : 'none',
                      }}
                    />
                    {ollamaStatus.checking ? 'Checking...' : 'Check Status'}
                  </button>
                </div>

                {/* Connection Status Badge */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.6rem 0.75rem',
                    borderRadius: '8px',
                    backgroundColor: ollamaStatus.connected ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                    border: `1px solid ${ollamaStatus.connected ? 'rgba(34, 197, 94, 0.25)' : 'rgba(239, 68, 68, 0.25)'}`,
                    marginBottom: '0.85rem',
                  }}
                >
                  <span
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      backgroundColor: ollamaStatus.connected ? '#22c55e' : '#ef4444',
                      display: 'inline-block',
                      boxShadow: ollamaStatus.connected ? '0 0 6px #22c55e' : 'none',
                    }}
                  />
                  <span
                    style={{
                      fontSize: '0.82rem',
                      fontWeight: 600,
                      color: ollamaStatus.connected ? '#15803d' : '#b91c1c',
                    }}
                  >
                    {ollamaStatus.checking
                      ? 'Checking Ollama service...'
                      : ollamaStatus.connected
                      ? 'Ollama is online and ready (Local)'
                      : 'Ollama is not running locally'}
                  </span>
                </div>

                {!ollamaStatus.connected && !ollamaStatus.checking && (
                  <div
                    style={{
                      fontSize: '0.8rem',
                      color: 'var(--text-muted)',
                      backgroundColor: 'var(--bg-subtle, #f9fafb)',
                      padding: '0.75rem',
                      borderRadius: '6px',
                      border: '1px solid var(--border-color, #e5e7eb)',
                      marginBottom: '0.85rem',
                      lineHeight: '1.45',
                    }}
                  >
                    <div style={{ fontWeight: 600, marginBottom: '0.35rem', color: 'var(--text-main)' }}>
                      Quick Windows PowerShell Setup:
                    </div>
                    <div>1. Install: <code>winget install Ollama.Ollama</code></div>
                    <div>2. Run Model: <code>ollama run qwen2.5:3b</code></div>
                    <div style={{ marginTop: '0.35rem' }}>Then click <strong>Check Status</strong> above.</div>
                  </div>
                )}

                {/* Model Selector / Name */}
                <label
                  style={{
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    color: 'var(--text-main)',
                    display: 'block',
                    marginBottom: '0.25rem',
                  }}
                >
                  Local Model Name
                </label>
                {ollamaStatus.connected && ollamaStatus.models.length > 0 ? (
                  <select
                    className="form-select"
                    style={{ marginBottom: '0.75rem' }}
                    value={formData.ollamaModel || formData.modelName || 'qwen2.5:3b'}
                    onChange={(e) => {
                      const model = e.target.value
                      setFormData((prev) => ({
                        ...prev,
                        ollamaModel: model,
                        modelName: model,
                      }))
                      handleInstantSave({
                        ollamaModel: model,
                        modelName: model,
                      })
                    }}
                  >
                    {ollamaStatus.models.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                    {!ollamaStatus.models.includes(formData.ollamaModel || 'qwen2.5:3b') && (
                      <option value={formData.ollamaModel || 'qwen2.5:3b'}>
                        {formData.ollamaModel || 'qwen2.5:3b'} (Custom)
                      </option>
                    )}
                  </select>
                ) : (
                  <input
                    type="text"
                    className="form-input"
                    style={{ marginBottom: '0.75rem' }}
                    placeholder="qwen2.5:3b"
                    value={formData.ollamaModel || formData.modelName || ''}
                    onChange={(e) => {
                      handleTextChange('ollamaModel', e.target.value)
                      handleTextChange('modelName', e.target.value)
                    }}
                  />
                )}

                {/* Base URL */}
                <label
                  style={{
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    color: 'var(--text-main)',
                    display: 'block',
                    marginBottom: '0.25rem',
                  }}
                >
                  Ollama Base URL
                </label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="http://127.0.0.1:11434"
                  value={formData.ollamaBaseUrl || ''}
                  onChange={(e) => handleTextChange('ollamaBaseUrl', e.target.value)}
                />
                <span
                  className="settings-card-desc"
                  style={{ marginTop: '0.35rem', marginBottom: 0, fontSize: '0.75rem' }}
                >
                  Default is <code>http://127.0.0.1:11434</code>. Free, 100% private, no API keys needed.
                </span>
              </div>
            )}

            {/* Gemini API Key */}
            {formData.aiProvider === 'gemini' && (
              <div className="settings-card">
                <div className="settings-card-header">
                  <span className="settings-card-title">
                    <Key size={16} /> Google Gemini API Key
                  </span>
                  <a
                    href="https://aistudio.google.com/app/apikey"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      fontSize: '0.78rem',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.25rem',
                      color: 'var(--text-main)',
                      fontWeight: 600,
                    }}
                  >
                    <span>Get Free Key</span>
                    <ExternalLink size={12} />
                  </a>
                </div>
                <span className="settings-card-desc">
                  Stored securely. Google Gemini Flash provides the fastest speeds and highest accuracy.
                </span>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showGeminiKey ? 'text' : 'password'}
                    className="form-input"
                    style={{ paddingRight: '2.5rem', width: '100%' }}
                    placeholder="AIzaSy..."
                    value={formData.geminiApiKey || ''}
                    onChange={(e) => handleTextChange('geminiApiKey', e.target.value)}
                    id="input-gemini-key"
                  />
                  <button
                    type="button"
                    onClick={() => setShowGeminiKey(!showGeminiKey)}
                    style={{
                      position: 'absolute',
                      right: '0.65rem',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                    }}
                  >
                    {showGeminiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
            )}

            {/* OpenAI API Key */}
            {formData.aiProvider === 'openai' && (
              <div className="settings-card">
                <span className="settings-card-title">
                  <Key size={16} /> OpenAI API Key
                </span>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showOpenaiKey ? 'text' : 'password'}
                    className="form-input"
                    style={{ paddingRight: '2.5rem', width: '100%' }}
                    placeholder="sk-proj-..."
                    value={formData.openaiApiKey || ''}
                    onChange={(e) => handleTextChange('openaiApiKey', e.target.value)}
                    id="input-openai-key"
                  />
                  <button
                    type="button"
                    onClick={() => setShowOpenaiKey(!showOpenaiKey)}
                    style={{
                      position: 'absolute',
                      right: '0.65rem',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                    }}
                  >
                    {showOpenaiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
            )}

            {/* Groq API Key */}
            {formData.aiProvider === 'groq' && (
              <div className="settings-card">
                <span className="settings-card-title">
                  <Key size={16} /> Groq API Key
                </span>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showGroqKey ? 'text' : 'password'}
                    className="form-input"
                    style={{ paddingRight: '2.5rem', width: '100%' }}
                    placeholder="gsk_..."
                    value={formData.groqApiKey || ''}
                    onChange={(e) => handleTextChange('groqApiKey', e.target.value)}
                    id="input-groq-key"
                  />
                  <button
                    type="button"
                    onClick={() => setShowGroqKey(!showGroqKey)}
                    style={{
                      position: 'absolute',
                      right: '0.65rem',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                    }}
                  >
                    {showGroqKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
            )}

            {/* Model Identifier (Cloud / Custom providers) */}
            {formData.aiProvider !== 'builtin' && formData.aiProvider !== 'ollama' && (
              <div className="settings-card">
                <span className="settings-card-title">Model Identifier</span>
                <span className="settings-card-desc">
                  Specify the model variant (e.g. <code>gemini-2.5-flash</code>).
                </span>
                <input
                  type="text"
                  className="form-input"
                  value={formData.modelName || ''}
                  onChange={(e) => handleTextChange('modelName', e.target.value)}
                  placeholder={
                    formData.aiProvider === 'gemini'
                      ? 'gemini-2.5-flash'
                      : formData.aiProvider === 'openai'
                      ? 'gpt-4o-mini'
                      : 'llama-3.1-8b-instant'
                  }
                />
              </div>
            )}

            {/* Reasoning Mode */}
            <div className="settings-card">
              <span className="settings-card-title">
                <Cpu size={16} /> Reasoning & Problem-Solving Mode
              </span>
              <span className="settings-card-desc">
                In Deep Reasoning mode, Mana AI shows structured thought steps before delivering code or solutions.
              </span>
              <select
                className="form-select"
                value={formData.reasoningMode || 'fast'}
                onChange={(e) => {
                  const reasoningMode = e.target.value as any
                  setFormData((prev) => ({ ...prev, reasoningMode }))
                  handleInstantSave({ reasoningMode })
                }}
                id="select-reasoning-mode"
              >
                <option value="fast">⚡ Fast Mode (Crisp, rapid conversational answers)</option>
                <option value="thinking">🧠 Deep Reasoning Mode (Step-by-step problem solving)</option>
              </select>
            </div>

            {/* Live Web Search */}
            <div className="settings-card">
              <span className="settings-card-title">
                <Search size={16} /> Live Web Search Provider
              </span>
              <span className="settings-card-desc">
                DuckDuckGo works out of the box with zero key required.
              </span>
              <select
                className="form-select"
                value={formData.searchProvider}
                onChange={(e) => {
                  const searchProvider = e.target.value as any
                  setFormData((prev) => ({ ...prev, searchProvider }))
                  handleInstantSave({ searchProvider })
                }}
                id="select-search-provider"
              >
                <option value="duckduckgo">DuckDuckGo Live (Free, Zero Key Required)</option>
                <option value="tavily">Tavily Search API (Dedicated AI Search)</option>
                <option value="serper">Serper (Google Search API)</option>
                <option value="brave">Brave Search API</option>
              </select>

              {/* Optional Search Keys */}
              {formData.searchProvider === 'tavily' && (
                <div className="form-group" style={{ marginTop: '0.4rem' }}>
                  <label className="form-label">Tavily API Key</label>
                  <input
                    type="password"
                    className="form-input"
                    placeholder="tvly-..."
                    value={formData.tavilyApiKey || ''}
                    onChange={(e) => handleTextChange('tavilyApiKey', e.target.value)}
                  />
                </div>
              )}

              {/* Test Search */}
              <div
                style={{
                  marginTop: '0.75rem',
                  padding: '0.85rem',
                  background: 'var(--bg-hover-subtle)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                <span
                  style={{
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    marginBottom: '0.45rem',
                  }}
                >
                  <Globe size={14} /> Test Search Connectivity
                </span>
                <div style={{ display: 'flex', gap: '0.45rem' }}>
                  <input
                    type="text"
                    className="form-input"
                    style={{ flex: 1 }}
                    value={testQuery}
                    onChange={(e) => setTestQuery(e.target.value)}
                    placeholder="Search query..."
                  />
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={handleTestSearch}
                    disabled={isTestingSearch}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                  >
                    {isTestingSearch ? (
                      <RefreshCw size={13} className="animate-spin" />
                    ) : (
                      <Search size={13} />
                    )}
                    <span>Test</span>
                  </button>
                </div>
                {testResult && (
                  <div
                    style={{
                      marginTop: '0.45rem',
                      fontSize: '0.75rem',
                      color: testResult.startsWith('✅') ? '#10b981' : '#ef4444',
                      lineHeight: 1.35,
                    }}
                  >
                    {testResult}
                  </div>
                )}
              </div>
            </div>

            {/* AI Image & Video Diffusion Tokens */}
            <div className="settings-card">
              <span className="settings-card-title">
                <Sparkles size={16} /> AI Media Diffusion Tokens (Optional)
              </span>
              <span className="settings-card-desc">
                FLUX.1 watermark-free images work out of the box with zero key required. Provide tokens below for external diffusion providers.
              </span>

              <div className="form-group">
                <label className="form-label">Primary Image Provider</label>
                <select
                  className="form-select"
                  value={formData.imageProvider || 'pollinations'}
                  onChange={(e) => {
                    const imageProvider = e.target.value as any
                    setFormData((prev) => ({ ...prev, imageProvider }))
                    handleInstantSave({ imageProvider })
                  }}
                >
                  <option value="pollinations">Pollinations FLUX.1 (Free, 100% Watermark-Free)</option>
                  <option value="openai">OpenAI DALL-E 3 (Requires OpenAI Key)</option>
                  <option value="huggingface">Hugging Face FLUX.1 (Requires HF Token)</option>
                </select>
              </div>

              {formData.imageProvider === 'huggingface' && (
                <div className="form-group">
                  <label className="form-label">Hugging Face API Token</label>
                  <input
                    type="password"
                    className="form-input"
                    placeholder="hf_..."
                    value={formData.huggingfaceApiKey || ''}
                    onChange={(e) => handleTextChange('huggingfaceApiKey', e.target.value)}
                  />
                </div>
              )}

              <div className="form-group">
                <label className="form-label">
                  <Film size={14} /> Luma Dream Machine API Key (Cinematic Video)
                </label>
                <input
                  type="password"
                  className="form-input"
                  placeholder="luma-..."
                  value={formData.lumaApiKey || ''}
                  onChange={(e) => handleTextChange('lumaApiKey', e.target.value)}
                />
              </div>
            </div>
          </>
        )

      /* ====================================================================
         5. Privacy & Data
         ==================================================================== */
      case 'privacy':
        return (
          <>
            {/* Action notification banner */}
            {actionNotice && (
              <div
                style={{
                  padding: '0.85rem 1rem',
                  background: 'var(--bg-main)',
                  border: '1px solid var(--border-active)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                }}
              >
                <Check size={16} />
                <span>{actionNotice}</span>
              </div>
            )}

            {/* Privacy Explanation */}
            <div className="settings-card">
              <span className="settings-card-title">
                <Shield size={16} /> Data Privacy & Key Protection
              </span>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.5rem',
                  fontSize: '0.82rem',
                  color: 'var(--text-muted)',
                  lineHeight: 1.45,
                }}
              >
                <div>
                  <strong>Local Key Protection:</strong> Your Gemini and provider API keys
                  remain securely stored and are never shared or logged.
                </div>
                <div>
                  <strong>Strict Session Isolation:</strong> Chat transcripts and memory profiles
                  are isolated per authenticated user account with scrypt password hashing.
                </div>
                <div>
                  <strong>No Public Model Training:</strong> Your conversations and personal data
                  are never sold or used to train third-party public AI models.
                </div>
              </div>
            </div>

            {/* Export Data */}
            <div className="settings-card">
              <span className="settings-card-title">
                <Download size={16} /> Export Chat History
              </span>
              <span className="settings-card-desc">
                Download a complete, readable JSON file containing your saved chat sessions, timestamps, and message transcripts.
              </span>
              <div>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleExportChatHistory}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.45rem',
                  }}
                >
                  <Download size={14} />
                  <span>Export Chat History (.JSON)</span>
                </button>
              </div>
            </div>

            {/* Danger Zone: Delete All Chats */}
            <div className="settings-danger-card">
              <span className="settings-card-title">
                <Trash2 size={16} /> Delete All Chat History
              </span>
              <span className="settings-card-desc">
                Permanently delete all saved chat sessions and messages from your account. This action cannot be undone.
              </span>

              {confirmDeleteChats ? (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.5rem',
                    marginTop: '0.25rem',
                  }}
                >
                  <span style={{ fontSize: '0.82rem', color: '#ef4444', fontWeight: 600 }}>
                    Are you sure? All saved chat sessions will be permanently deleted.
                  </span>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      type="button"
                      className="btn-danger"
                      onClick={handleClearAllChats}
                    >
                      Yes, Delete Everything
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setConfirmDeleteChats(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <button
                    type="button"
                    className="btn-danger"
                    onClick={() => setConfirmDeleteChats(true)}
                  >
                    <Trash2 size={14} />
                    <span>Clear All Conversations</span>
                  </button>
                </div>
              )}
            </div>
          </>
        )

      /* ====================================================================
         6. About Mana AI
         ==================================================================== */
      case 'about':
        return (
          <>
            {/* Brand Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '1rem',
                padding: '1.25rem',
                background: 'var(--bg-main)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 12,
                  background: 'var(--bg-hover)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 800,
                  fontSize: '1.4rem',
                  color: 'var(--text-main)',
                }}
              >
                M
              </div>
              <div>
                <div
                  style={{
                    fontSize: '1.15rem',
                    fontWeight: 700,
                    color: 'var(--text-main)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                  }}
                >
                  <span>Mana AI</span>
                  <span
                    style={{
                      fontSize: '0.72rem',
                      padding: '0.15rem 0.5rem',
                      background: 'var(--bg-hover)',
                      borderRadius: 'var(--radius-capsule)',
                      color: 'var(--text-muted)',
                      fontWeight: 600,
                    }}
                  >
                    v1.2.0 Production
                  </span>
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Your AI. Your World.
                </div>
              </div>
            </div>

            {/* Mission & Purpose */}
            <div className="settings-card">
              <span className="settings-card-title">
                <Info size={16} /> Mission & Overview
              </span>
              <p
                style={{
                  fontSize: '0.82rem',
                  lineHeight: 1.5,
                  color: 'var(--text-muted)',
                  margin: 0,
                }}
              >
                Mana AI is a fast, intelligent, and privacy-focused personal AI companion designed to understand you deeply. Powered by Google Gemini with real-time web synthesis, persistent cross-device memory, and multimodal generation.
              </p>
            </div>

            {/* Architecture Highlights */}
            <div className="settings-card">
              <span className="settings-card-title">
                <Cpu size={16} /> Production Architecture
              </span>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
                  gap: '0.65rem',
                  fontSize: '0.78rem',
                }}
              >
                <div
                  style={{
                    padding: '0.65rem',
                    background: 'var(--bg-hover-subtle)',
                    borderRadius: 'var(--radius-sm)',
                  }}
                >
                  <strong>Primary Engine:</strong>
                  <br />
                  <span style={{ color: 'var(--text-muted)' }}>
                    Google Gemini 2.5 / 1.5 Flash
                  </span>
                </div>
                <div
                  style={{
                    padding: '0.65rem',
                    background: 'var(--bg-hover-subtle)',
                    borderRadius: 'var(--radius-sm)',
                  }}
                >
                  <strong>Live Web Search:</strong>
                  <br />
                  <span style={{ color: 'var(--text-muted)' }}>
                    DuckDuckGo & Tavily AI
                  </span>
                </div>
                <div
                  style={{
                    padding: '0.65rem',
                    background: 'var(--bg-hover-subtle)',
                    borderRadius: 'var(--radius-sm)',
                  }}
                >
                  <strong>Media Diffusion:</strong>
                  <br />
                  <span style={{ color: 'var(--text-muted)' }}>
                    FLUX.1 & Luma Video
                  </span>
                </div>
                <div
                  style={{
                    padding: '0.65rem',
                    background: 'var(--bg-hover-subtle)',
                    borderRadius: 'var(--radius-sm)',
                  }}
                >
                  <strong>Security & Auth:</strong>
                  <br />
                  <span style={{ color: 'var(--text-muted)' }}>
                    scrypt hashing & isolated DB
                  </span>
                </div>
              </div>
            </div>

            {/* Helpful Resources */}
            <div className="settings-card">
              <span className="settings-card-title">
                <ExternalLink size={16} /> Helpful Resources & Support
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.65rem 0.85rem',
                    background: 'var(--bg-hover-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '0.82rem',
                    color: 'var(--text-main)',
                    textDecoration: 'none',
                    fontWeight: 500,
                  }}
                >
                  <span>Google AI Studio (Get Free Gemini Key)</span>
                  <ExternalLink size={13} color="var(--text-muted)" />
                </a>

                <a
                  href="https://ai.google.dev/gemini-api/docs"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.65rem 0.85rem',
                    background: 'var(--bg-hover-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '0.82rem',
                    color: 'var(--text-main)',
                    textDecoration: 'none',
                    fontWeight: 500,
                  }}
                >
                  <span>Gemini API Documentation & Quickstarts</span>
                  <ExternalLink size={13} color="var(--text-muted)" />
                </a>
              </div>
            </div>
          </>
        )

      default:
        return null
    }
  }

  // --------------------------------------------------------------------------
  // Mobile View: Settings Home Screen (List of Category Cards)
  // --------------------------------------------------------------------------
  if (isMobile && mobileSubScreen === null) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div
          className="settings-modal-dialog"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="settings-home-container">
            <div className="settings-home-header">
              <div className="settings-content-title">
                <Sliders size={18} />
                <span>Settings</span>
              </div>
              <button
                className="code-copy-btn"
                onClick={onClose}
                id="btn-close-settings"
                aria-label="Close Settings"
              >
                <X size={18} />
              </button>
            </div>

            <div className="settings-home-list">
              {CATEGORIES.map((cat) => (
                <div
                  key={cat.id}
                  className="settings-home-card"
                  onClick={() => {
                    setActiveCategory(cat.id)
                    setMobileSubScreen(cat.id)
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <div className="settings-home-card-left">
                    <div className="settings-home-card-icon">{cat.icon}</div>
                    <div>
                      <div className="settings-home-card-title">{cat.title}</div>
                      <div className="settings-home-card-desc">{cat.subtitle}</div>
                    </div>
                  </div>
                  <ChevronRight size={18} color="var(--text-muted)" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // --------------------------------------------------------------------------
  // Desktop Two-Column Layout & Mobile Sub-Screen View
  // --------------------------------------------------------------------------
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="settings-modal-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left Sidebar Navigation (Desktop only) */}
        <div className="settings-sidebar">
          <div className="settings-sidebar-header">
            <Sliders size={18} />
            <span>Settings</span>
          </div>

          <div className="settings-sidebar-nav">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                type="button"
                className={`settings-nav-item ${
                  activeCategory === cat.id ? 'active' : ''
                }`}
                onClick={() => {
                  setActiveCategory(cat.id)
                }}
              >
                {cat.icon}
                <span>{cat.title}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Right Content Pane (Desktop) or Full Category Screen (Mobile) */}
        <div className="settings-content-pane">
          {/* Header */}
          <div className="settings-content-header">
            <div className="settings-content-header-left">
              {/* Back button on mobile */}
              {isMobile && (
                <button
                  type="button"
                  className="settings-back-btn"
                  onClick={() => {
                    setMobileSubScreen(null)
                  }}
                  aria-label="Back to Settings Home"
                >
                  <ArrowLeft size={16} />
                </button>
              )}

              <div className="settings-content-header-info">
                <div className="settings-content-title">
                  {currentCategoryData.icon}
                  <span>{currentCategoryData.title}</span>
                </div>
                <div className="settings-content-subtitle">
                  {currentCategoryData.subtitle}
                </div>
              </div>
            </div>

            <button
              className="code-copy-btn"
              onClick={onClose}
              id="btn-close-settings"
              aria-label="Close Settings"
            >
              <X size={18} />
            </button>
          </div>

          {/* Scrollable Category Body */}
          <div className="settings-content-scroll">
            {renderCategoryContent(activeCategory)}
          </div>

          {/* Scoped Inline Save Bar (Shown only when manual text inputs have unsaved changes) */}
          {hasUnsavedChanges && (
            <div className="settings-save-bar">
              <div className="settings-save-bar-text">
                <AlertTriangle size={14} color="#f59e0b" />
                <span>Unsaved changes in this section</span>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleDiscardChanges}
                  style={{ fontSize: '0.82rem', padding: '0.45rem 0.85rem' }}
                >
                  Discard
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleSaveCategory}
                  disabled={isSaving}
                  style={{
                    fontSize: '0.82rem',
                    padding: '0.45rem 0.85rem',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                  }}
                >
                  {saveSuccess ? (
                    <>
                      <Check size={14} /> Saved!
                    </>
                  ) : isSaving ? (
                    'Saving...'
                  ) : (
                    'Save Changes'
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
