import React, { useState, useEffect } from 'react'
import { X, Key, Search, Cpu, Sliders, Check, Globe, RefreshCw, Mic, Volume2, Play, Sparkles, Film } from 'lucide-react'
import { AppConfig, VoiceLanguage, VoiceSettings } from '../types/chat'
import { voiceManager, DEFAULT_VOICE_SETTINGS } from '../utils/voiceManager'

interface SettingsModalProps {
  config: AppConfig
  isOpen: boolean
  onClose: () => void
  onSave: (newConfig: Partial<AppConfig>) => Promise<void>
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  config,
  isOpen,
  onClose,
  onSave,
}) => {
  const [formData, setFormData] = useState<AppConfig>({ ...config })
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings>({
    ...DEFAULT_VOICE_SETTINGS,
    ...(config.voiceSettings || {}),
  })
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [testQuery, setTestQuery] = useState('latest cricket score')
  const [testResult, setTestResult] = useState<string | null>(null)
  const [isTestingSearch, setIsTestingSearch] = useState(false)
  const [isTestingVoice, setIsTestingVoice] = useState(false)

  // Fetch available voices on modal open
  useEffect(() => {
    if (isOpen) {
      setFormData({ ...config })
      setVoiceSettings({
        ...DEFAULT_VOICE_SETTINGS,
        ...(config.voiceSettings || {}),
      })

      voiceManager.getVoices().then((voices) => {
        setAvailableVoices(voices)
      })
    }
  }, [isOpen, config])

  if (!isOpen) return null

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSaving(true)
    try {
      await onSave({
        ...formData,
        voiceSettings,
      })
      setSaveSuccess(true)
      setTimeout(() => {
        setSaveSuccess(false)
        onClose()
      }, 700)
    } finally {
      setIsSaving(false)
    }
  }

  const handleTestSearch = async () => {
    if (!testQuery) return
    setIsTestingSearch(true)
    setTestResult(null)
    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: testQuery,
          provider: formData.searchProvider,
        }),
      })
      const data = await res.json()
      if (data.success && data.evidence) {
        setTestResult(
          `✅ Found ${data.evidence.totalFound} results in ${data.evidence.tookMs}ms via ${data.evidence.provider}. Top: "${data.evidence.results[0]?.title || 'No title'}"`
        )
      } else {
        setTestResult(`❌ Error: ${data.error || 'Search failed'}`)
      }
    } catch (err: any) {
      setTestResult(`❌ Network Error: ${err.message}`)
    } finally {
      setIsTestingSearch(false)
    }
  }

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

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            <Sliders size={20} color="#818cf8" />
            <span>Mana AI Configuration & Models</span>
          </div>
          <button className="code-copy-btn" onClick={onClose} id="btn-close-settings">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSave}>
          <div className="modal-body">
            {/* AI Provider */}
            <div className="form-group">
              <label className="form-label">
                <Cpu size={15} color="#6366f1" />
                <span>AI Model Provider</span>
              </label>
              <select
                className="form-select"
                value={formData.aiProvider}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    aiProvider: e.target.value as any,
                  })
                }
                id="select-ai-provider"
              >
                <option value="gemini">Google Gemini (Recommended — Ultra-fast, Smart)</option>
                <option value="openai">OpenAI (GPT-4o / GPT-4o-mini)</option>
                <option value="groq">Groq (Llama 3.1 Instant)</option>
                <option value="builtin">Built-in Smart Engine (Zero Key Required)</option>
              </select>
              <span className="form-hint">
                {formData.aiProvider === 'builtin'
                  ? '✨ Works instantly without external API keys using curated rules and real live search synthesis.'
                  : 'Enter your API key below. Keys stay securely on your local machine.'}
              </span>
            </div>

            {/* Gemini API Key */}
            {formData.aiProvider === 'gemini' && (
              <div className="form-group">
                <label className="form-label">
                  <Key size={15} color="#38bdf8" />
                  <span>Gemini API Key</span>
                </label>
                <input
                  type="password"
                  className="form-input"
                  placeholder="AIzaSy..."
                  value={formData.geminiApiKey || ''}
                  onChange={(e) =>
                    setFormData({ ...formData, geminiApiKey: e.target.value })
                  }
                  id="input-gemini-key"
                />
                <span className="form-hint">
                  Get a 100% free key in seconds at{' '}
                  <a
                    href="https://aistudio.google.com/app/apikey"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: '#38bdf8' }}
                  >
                    Google AI Studio
                  </a>
                  .
                </span>
              </div>
            )}

            {/* OpenAI API Key */}
            {formData.aiProvider === 'openai' && (
              <div className="form-group">
                <label className="form-label">
                  <Key size={15} color="#38bdf8" />
                  <span>OpenAI API Key</span>
                </label>
                <input
                  type="password"
                  className="form-input"
                  placeholder="sk-proj-..."
                  value={formData.openaiApiKey || ''}
                  onChange={(e) =>
                    setFormData({ ...formData, openaiApiKey: e.target.value })
                  }
                  id="input-openai-key"
                />
              </div>
            )}

            {/* Groq API Key */}
            {formData.aiProvider === 'groq' && (
              <div className="form-group">
                <label className="form-label">
                  <Key size={15} color="#38bdf8" />
                  <span>Groq API Key</span>
                </label>
                <input
                  type="password"
                  className="form-input"
                  placeholder="gsk_..."
                  value={formData.groqApiKey || ''}
                  onChange={(e) =>
                    setFormData({ ...formData, groqApiKey: e.target.value })
                  }
                  id="input-groq-key"
                />
              </div>
            )}

            {/* Model Name */}
            {formData.aiProvider !== 'builtin' && (
              <div className="form-group">
                <label className="form-label">Model Identifier</label>
                <input
                  type="text"
                  className="form-input"
                  value={formData.modelName}
                  onChange={(e) =>
                    setFormData({ ...formData, modelName: e.target.value })
                  }
                  placeholder={
                    formData.aiProvider === 'gemini'
                      ? 'gemini-1.5-flash'
                      : formData.aiProvider === 'openai'
                      ? 'gpt-4o-mini'
                      : 'llama-3.1-8b-instant'
                  }
                />
              </div>
            )}

            {/* Reasoning Mode Selector */}
            <div className="form-group">
              <label className="form-label">
                <Cpu size={15} color="#8b5cf6" />
                <span>Reasoning & Problem-Solving Mode</span>
              </label>
              <select
                className="form-select"
                value={formData.reasoningMode || 'fast'}
                onChange={(e) =>
                  setFormData({ ...formData, reasoningMode: e.target.value as 'fast' | 'thinking' })
                }
                id="select-reasoning-mode"
              >
                <option value="fast">⚡ Fast Mode (Direct, crisp, quick conversational responses)</option>
                <option value="thinking">🧠 Deep Reasoning Mode (Step-by-step problem solving for math, logic, coding, and planning)</option>
              </select>
              <span className="form-hint">
                In Deep Reasoning mode, Mana AI breaks complex problems into manageable steps and verifies calculations.
              </span>
            </div>

            {/* Memory Retention Toggle */}
            <div className="form-group">
              <label className="form-checkbox-label">
                <input
                  type="checkbox"
                  checked={formData.memoryEnabled !== false}
                  onChange={(e) =>
                    setFormData({ ...formData, memoryEnabled: e.target.checked })
                  }
                  id="checkbox-memory-enabled"
                />
                <span className="checkbox-text">
                  <strong>Enable Application Memory & Context Retention</strong>
                  <br />
                  <small style={{ color: '#94a3b8' }}>
                    Remembers preferences and context locally across sessions. Disable for private, stateless chat.
                  </small>
                </span>
              </label>
            </div>

            {/* AI Image & Video Generation Section */}
            <div className="settings-section-divider">
              <div className="settings-section-title">
                <Sparkles size={16} color="#8b5cf6" />
                <span>AI Media Generation (Image & Video)</span>
              </div>
            </div>

            {/* OpenAI Key for DALL-E 3 */}
            <div className="form-group">
              <label className="form-label">
                <Key size={15} color="#38bdf8" />
                <span>OpenAI API Key (for DALL-E 3 Image Generation)</span>
              </label>
              <input
                type="password"
                className="form-input"
                placeholder="sk-proj-..."
                value={formData.openaiApiKey || ''}
                onChange={(e) =>
                  setFormData({ ...formData, openaiApiKey: e.target.value })
                }
                id="input-media-openai-key"
              />
              <span className="form-hint">
                Optional: If omitted, Mana AI uses Pollinations Flux.1 out of the box with zero keys required.
              </span>
            </div>

            {/* Luma Dream Machine API Key */}
            <div className="form-group">
              <label className="form-label">
                <Film size={15} color="#06b6d4" />
                <span>Luma Dream Machine API Key (for Video Generation)</span>
              </label>
              <input
                type="password"
                className="form-input"
                placeholder="luma-..."
                value={formData.lumaApiKey || ''}
                onChange={(e) =>
                  setFormData({ ...formData, lumaApiKey: e.target.value })
                }
                id="input-media-luma-key"
              />
              <span className="form-hint">
                Get your key at{' '}
                <a
                  href="https://lumalabs.ai/dream-machine/api"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#06b6d4' }}
                >
                  lumalabs.ai/dream-machine/api
                </a>
                . Generates 5s–9s cinematic clips at 720p/1080p.
              </span>
            </div>

            {/* Replicate API Token */}
            <div className="form-group">
              <label className="form-label">
                <Key size={15} color="#06b6d4" />
                <span>Replicate API Token (Alternative Video Engine)</span>
              </label>
              <input
                type="password"
                className="form-input"
                placeholder="r8_..."
                value={formData.replicateApiKey || ''}
                onChange={(e) =>
                  setFormData({ ...formData, replicateApiKey: e.target.value })
                }
                id="input-media-replicate-key"
              />
              <span className="form-hint">
                Get your token at{' '}
                <a
                  href="https://replicate.com/account/api-tokens"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#06b6d4' }}
                >
                  replicate.com/account/api-tokens
                </a>
                . Supports Wan-2.1 and Minimax Video models.
              </span>
            </div>

            {/* Voice Assistant Settings Section */}
            <div className="settings-section-divider">
              <div className="settings-section-title">
                <Mic size={16} color="#8b5cf6" />
                <span>Voice Assistant & Speech</span>
              </div>
            </div>

            {/* Voice Mode Toggle */}
            <div className="form-group">
              <label className="form-checkbox-label">
                <input
                  type="checkbox"
                  checked={voiceSettings.voiceMode}
                  onChange={(e) =>
                    setVoiceSettings({
                      ...voiceSettings,
                      voiceMode: e.target.checked,
                    })
                  }
                  id="checkbox-voice-mode"
                />
                <span className="checkbox-text">
                  <strong>Enable Voice Mode (Auto-speak responses)</strong>
                  <br />
                  <small style={{ color: '#94a3b8' }}>
                    When enabled, Mana AI will automatically speak completed answers aloud.
                  </small>
                </span>
              </label>
            </div>

            {/* Voice Language */}
            <div className="form-group">
              <label className="form-label">
                <Globe size={15} color="#8b5cf6" />
                <span>Voice Language (Speech Recognition & Spoken Output)</span>
              </label>
              <select
                className="form-select"
                value={voiceSettings.language}
                onChange={(e) =>
                  setVoiceSettings({
                    ...voiceSettings,
                    language: e.target.value as VoiceLanguage,
                  })
                }
                id="select-voice-language"
              >
                <option value="en-US">English (United States) — en-US</option>
                <option value="en-IN">English (India) — en-IN</option>
                <option value="te-IN">Telugu (తెలుగు) — te-IN</option>
                <option value="hi-IN">Hindi (हिंदी) — hi-IN</option>
              </select>
            </div>

            {/* Available System Voices */}
            {availableVoices.length > 0 && (
              <div className="form-group">
                <label className="form-label">
                  <Volume2 size={15} color="#8b5cf6" />
                  <span>Synthesizer Voice</span>
                </label>
                <select
                  className="form-select"
                  value={voiceSettings.voiceURI || ''}
                  onChange={(e) =>
                    setVoiceSettings({
                      ...voiceSettings,
                      voiceURI: e.target.value || undefined,
                    })
                  }
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

            {/* Voice Speed & Pitch Sliders */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div className="form-group">
                <label className="form-label">
                  <span>Speed: {voiceSettings.rate}x</span>
                </label>
                <input
                  type="range"
                  min="0.75"
                  max="1.5"
                  step="0.05"
                  value={voiceSettings.rate}
                  onChange={(e) =>
                    setVoiceSettings({
                      ...voiceSettings,
                      rate: parseFloat(e.target.value),
                    })
                  }
                  className="form-range"
                />
              </div>

              <div className="form-group">
                <label className="form-label">
                  <span>Pitch: {voiceSettings.pitch}x</span>
                </label>
                <input
                  type="range"
                  min="0.8"
                  max="1.2"
                  step="0.05"
                  value={voiceSettings.pitch}
                  onChange={(e) =>
                    setVoiceSettings({
                      ...voiceSettings,
                      pitch: parseFloat(e.target.value),
                    })
                  }
                  className="form-range"
                />
              </div>
            </div>

            {/* Test Voice Button */}
            <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: '0.2rem' }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={handleTestVoice}
                disabled={isTestingVoice}
                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem' }}
                id="btn-test-voice"
              >
                <Play size={14} fill="currentColor" />
                <span>{isTestingVoice ? 'Speaking...' : 'Test Voice Audio'}</span>
              </button>
            </div>

            {/* Search Provider */}
            <div className="settings-section-divider">
              <div className="settings-section-title">
                <Search size={16} color="#06b6d4" />
                <span>Live Web Search</span>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">
                <Search size={15} color="#06b6d4" />
                <span>Live Web Search Provider</span>
              </label>
              <select
                className="form-select"
                value={formData.searchProvider}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    searchProvider: e.target.value as any,
                  })
                }
                id="select-search-provider"
              >
                <option value="duckduckgo">DuckDuckGo Live (Free, Instant, No API Key Required)</option>
                <option value="tavily">Tavily Search API (Dedicated AI Search)</option>
                <option value="serper">Serper (Google Search API)</option>
                <option value="brave">Brave Search API</option>
              </select>
              <span className="form-hint">
                DuckDuckGo searches the live web out-of-the-box without requiring any subscription or payment.
              </span>
            </div>

            {/* Optional Search API Keys */}
            {formData.searchProvider === 'tavily' && (
              <div className="form-group">
                <label className="form-label">Tavily API Key</label>
                <input
                  type="password"
                  className="form-input"
                  placeholder="tvly-..."
                  value={formData.tavilyApiKey || ''}
                  onChange={(e) =>
                    setFormData({ ...formData, tavilyApiKey: e.target.value })
                  }
                />
              </div>
            )}

            {formData.searchProvider === 'serper' && (
              <div className="form-group">
                <label className="form-label">Serper API Key</label>
                <input
                  type="password"
                  className="form-input"
                  placeholder="serper key..."
                  value={formData.serperApiKey || ''}
                  onChange={(e) =>
                    setFormData({ ...formData, serperApiKey: e.target.value })
                  }
                />
              </div>
            )}

            {formData.searchProvider === 'brave' && (
              <div className="form-group">
                <label className="form-label">Brave Search API Key</label>
                <input
                  type="password"
                  className="form-input"
                  placeholder="BSA..."
                  value={formData.braveApiKey || ''}
                  onChange={(e) =>
                    setFormData({ ...formData, braveApiKey: e.target.value })
                  }
                />
              </div>
            )}

            {/* Test Search */}
            <div
              style={{
                background: 'rgba(15, 23, 42, 0.8)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '8px',
                padding: '0.85rem',
              }}
            >
              <div
                style={{
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  color: '#38bdf8',
                  marginBottom: '0.4rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                }}
              >
                <Globe size={14} />
                <span>Test Live Search Connectivity</span>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  type="text"
                  className="form-input"
                  style={{ flex: 1 }}
                  value={testQuery}
                  onChange={(e) => setTestQuery(e.target.value)}
                  placeholder="Search test query..."
                />
                <button
                  type="button"
                  className="btn-icon"
                  onClick={handleTestSearch}
                  disabled={isTestingSearch}
                  style={{ whiteSpace: 'nowrap' }}
                >
                  {isTestingSearch ? (
                    <RefreshCw size={14} className="animate-spin" />
                  ) : (
                    <Search size={14} />
                  )}
                  <span>Test</span>
                </button>
              </div>
              {testResult && (
                <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: testResult.startsWith('✅') ? '#4ade80' : '#f87171' }}>
                  {testResult}
                </div>
              )}
            </div>

            {/* Conciseness settings */}
            <div className="form-group">
              <label className="form-label">Max Sentences for Short Answers (Default: 4)</label>
              <input
                type="number"
                min={1}
                max={8}
                className="form-input"
                value={formData.maxShortSentences}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    maxShortSentences: parseInt(e.target.value) || 4,
                  })
                }
              />
              <span className="form-hint">
                Controls conciseness: Ordinary answers target 1–5 sentences with direct answers first.
              </span>
            </div>

            <div className="form-group">
              <label className="form-label">Configurable System Prompt</label>
              <textarea
                className="form-textarea"
                rows={4}
                value={formData.systemPrompt}
                onChange={(e) =>
                  setFormData({ ...formData, systemPrompt: e.target.value })
                }
              />
              <span className="form-hint">
                Defines tone, contextual emojis, and search evidence handling rules.
              </span>
            </div>
          </div>

          <div className="modal-footer">
            <button
              type="button"
              className="btn-secondary"
              onClick={onClose}
              id="btn-cancel-settings"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={isSaving}
              id="btn-save-settings"
            >
              {saveSuccess ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <Check size={16} /> Saved!
                </span>
              ) : isSaving ? (
                'Saving...'
              ) : (
                'Save Settings'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
