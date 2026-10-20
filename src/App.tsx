import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Header } from './components/Header'
import { Sidebar } from './components/Sidebar'
import { ChatMessage } from './components/ChatMessage'
import { ChatInput } from './components/ChatInput'
import { SettingsModal } from './components/SettingsModal'
import { MemoryModal } from './components/MemoryModal'
import { AuthModal } from './components/AuthModal'
import { ManaLogo } from './components/ManaLogo'
import { ImageLightboxModal } from './components/ImageLightboxModal'
import {
  Message,
  AppConfig,
  SearchMode,
  ChatSessionSummary,
  AuthUser,
  ChatMode,
  GeneratedImageMetadata,
  VideoJobMetadata,
} from './types/chat'
import {
  voiceManager,
  isSpeechRecognitionSupported,
  DEFAULT_VOICE_SETTINGS,
} from './utils/voiceManager'
import { safeApiFetch } from './utils/api'

export const App: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isMemoryOpen, setIsMemoryOpen] = useState(false)
  const [isAuthOpen, setIsAuthOpen] = useState(false)

  // Mode & Media Generation state
  const [chatMode, setChatMode] = useState<ChatMode>('chat')
  const [imageAspectRatio, setImageAspectRatio] = useState<'1:1' | '16:9' | '9:16'>('1:1')
  const [imageQuality, setImageQuality] = useState<'standard' | 'hd'>('standard')
  const [videoAspectRatio, setVideoAspectRatio] = useState<'16:9' | '9:16' | '1:1'>('16:9')
  const [videoDuration, setVideoDuration] = useState<number>(5)
  const [lightboxImage, setLightboxImage] = useState<GeneratedImageMetadata | null>(null)

  // Voice Assistant state
  const [isListening, setIsListening] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null)
  const [voiceError, setVoiceError] = useState<string | null>(null)

  // Auth state
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null)
  const [authToken, setAuthToken] = useState<string | null>(null)

  // Chat sessions & history state
  const [sessions, setSessions] = useState<ChatSessionSummary[]>(() => {
    try {
      const cached = localStorage.getItem('mana_cached_sessions')
      return cached ? JSON.parse(cached) : []
    } catch {
      return []
    }
  })
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const currentSessionIdRef = useRef<string | null>(null)

  const [config, setConfig] = useState<AppConfig>({
    aiProvider: 'builtin',
    searchProvider: 'duckduckgo',
    searchMode: 'auto',
    modelName: 'gemini-1.5-flash',
    systemPrompt: '',
    maxShortSentences: 4,
    emojiDensity: 'concise',
    voiceSettings: DEFAULT_VOICE_SETTINGS,
  })

  const configRef = useRef(config)
  useEffect(() => {
    configRef.current = config
  }, [config])

  const isSpeakingRef = useRef(false)
  const speakingMessageIdRef = useRef<string | null>(null)
  const isListeningRef = useRef(false)

  useEffect(() => {
    isSpeakingRef.current = isSpeaking
  }, [isSpeaking])

  useEffect(() => {
    speakingMessageIdRef.current = speakingMessageId
  }, [speakingMessageId])

  useEffect(() => {
    isListeningRef.current = isListening
  }, [isListening])

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  // Clean up any ongoing speech or microphone capture on unmount
  useEffect(() => {
    return () => {
      voiceManager.stopSpeaking()
      voiceManager.stopListening()
    }
  }, [])

  // Keep ref in sync
  useEffect(() => {
    currentSessionIdRef.current = currentSessionId
  }, [currentSessionId])

  // Helper for auth and client isolation headers
  const getAuthHeaders = useCallback((): HeadersInit => {
    const token = authToken || localStorage.getItem('mana_auth_token')
    let guestId = localStorage.getItem('mana_guest_id')
    if (!guestId) {
      guestId = `g-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      localStorage.setItem('mana_guest_id', guestId)
    }
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-guest-id': guestId,
    }
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }
    return headers
  }, [authToken])

  // Load chat sessions from backend
  const fetchSessions = useCallback(async () => {
    try {
      const res = await safeApiFetch<{ sessions: ChatSessionSummary[] }>('/api/chats', {
        headers: getAuthHeaders(),
      })
      if (res.success && res.data?.sessions && Array.isArray(res.data.sessions)) {
        setSessions(res.data.sessions)
        try {
          localStorage.setItem('mana_cached_sessions', JSON.stringify(res.data.sessions))
        } catch {}
      }
    } catch (err) {
      console.warn('Could not load chat sessions:', err)
    }
  }, [getAuthHeaders])

  // Verify auth token on mount
  useEffect(() => {
    const savedToken = localStorage.getItem('mana_auth_token')
    const savedUser = localStorage.getItem('mana_user')

    if (savedToken) {
      setAuthToken(savedToken)
      if (savedUser) {
        try {
          setCurrentUser(JSON.parse(savedUser))
        } catch {
          // ignore
        }
      }

      safeApiFetch<{ user: AuthUser }>('/api/auth/me', {
        headers: { Authorization: `Bearer ${savedToken}` },
      })
        .then((res) => {
          if (res.success && res.data?.user) {
            setCurrentUser(res.data.user)
            localStorage.setItem('mana_user', JSON.stringify(res.data.user))
          } else if (res.status === 401) {
            // Token expired or invalid
            localStorage.removeItem('mana_auth_token')
            localStorage.removeItem('mana_user')
            setAuthToken(null)
            setCurrentUser(null)
          }
        })
        .catch(() => {
          // offline or error, keep cached user
        })
    }
  }, [])

  // Load chat sessions when auth changes
  useEffect(() => {
    fetchSessions()
  }, [authToken, fetchSessions])

  // Load config on mount
  useEffect(() => {
    safeApiFetch<AppConfig>('/api/config')
      .then((res) => {
        if (res.success && res.data) {
          setConfig((prev) => ({ ...prev, ...res.data }))
        }
      })
      .catch((err) => console.warn('Could not load config:', err))
  }, [])

  // Auto-collapse sidebar on smaller screens
  useEffect(() => {
    if (window.innerWidth < 820) {
      setIsSidebarOpen(false)
    }
  }, [])

  // Auto-scroll to bottom of messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleUpdateConfig = async (partial: Partial<AppConfig>) => {
    try {
      const res = await safeApiFetch<{ config: AppConfig }>('/api/config', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(partial),
      })
      if (res.success && res.data?.config) {
        setConfig(res.data.config)
      }
    } catch (err) {
      console.error('Failed to update config:', err)
    }
  }

  const handleToggleVoiceMode = () => {
    const currentVoice = config.voiceSettings || DEFAULT_VOICE_SETTINGS
    const updated = {
      ...currentVoice,
      voiceMode: !currentVoice.voiceMode,
    }
    handleUpdateConfig({ voiceSettings: updated })
  }

  // Voice: Speak message aloud
  const handleSpeakMessage = useCallback((messageId: string, content: string) => {
    // If currently speaking this specific message, toggle it off
    if (speakingMessageIdRef.current === messageId && isSpeakingRef.current) {
      voiceManager.stopSpeaking()
      setIsSpeaking(false)
      setSpeakingMessageId(null)
      return
    }

    // Stop listening before speaking to prevent echo / feedback loop
    if (isListeningRef.current) {
      voiceManager.stopListening()
      setIsListening(false)
    }

    const currentVoiceSettings = configRef.current.voiceSettings || DEFAULT_VOICE_SETTINGS
    setIsSpeaking(true)
    setSpeakingMessageId(messageId)

    voiceManager.speak(content, currentVoiceSettings, {
      onStart: () => {
        setIsSpeaking(true)
        setSpeakingMessageId(messageId)
      },
      onEnd: () => {
        setIsSpeaking(false)
        setSpeakingMessageId(null)
      },
      onError: (err) => {
        console.warn('Speech synthesis playback error:', err)
        setIsSpeaking(false)
        setSpeakingMessageId(null)
      },
    })
  }, [])

  // Voice: Stop speech playback
  const handleStopSpeaking = useCallback(() => {
    voiceManager.stopSpeaking()
    setIsSpeaking(false)
    setSpeakingMessageId(null)
  }, [])

  // Voice: Toggle Microphone listening
  const handleToggleVoice = useCallback(() => {
    if (isListeningRef.current) {
      voiceManager.stopListening()
      setIsListening(false)
      return
    }

    // Clear previous error
    setVoiceError(null)

    // Stop assistant speech immediately if it's currently speaking (interruption)
    if (isSpeakingRef.current) {
      voiceManager.stopSpeaking()
      setIsSpeaking(false)
      setSpeakingMessageId(null)
    }

    const lang = configRef.current.voiceSettings?.language || 'en-US'

    const started = voiceManager.startListening({
      lang,
      onInterim: (interimText) => {
        setInput(interimText)
      },
      onFinal: (finalText) => {
        setInput(finalText)
      },
      onError: (errMsg) => {
        setVoiceError(errMsg)
        setIsListening(false)
      },
      onEnd: () => {
        setIsListening(false)
      },
    })

    if (started) {
      setIsListening(true)
    }
  }, [])

  const handleAuthSuccess = (user: AuthUser, token: string) => {
    setCurrentUser(user)
    setAuthToken(token)
    // Reload sessions for the newly logged in user
    setTimeout(() => {
      fetchSessions()
    }, 100)
  }

  const handleLogout = () => {
    localStorage.removeItem('mana_auth_token')
    localStorage.removeItem('mana_user')
    localStorage.removeItem('mana_cached_sessions')
    localStorage.removeItem('mana_active_session_id')
    setAuthToken(null)
    setCurrentUser(null)
    setCurrentSessionId(null)
    currentSessionIdRef.current = null
    setMessages([])
    handleStopSpeaking()
    voiceManager.stopListening()
    setIsListening(false)
    setTimeout(() => {
      fetchSessions()
    }, 100)
  }

  // Select and load a chat session from sidebar
  const handleSelectSession = async (sessionId: string) => {
    if (isGenerating && abortControllerRef.current) {
      abortControllerRef.current.abort()
      setIsGenerating(false)
    }
    handleStopSpeaking()
    voiceManager.stopListening()
    setIsListening(false)

    try {
      localStorage.setItem('mana_active_session_id', sessionId)
      const res = await safeApiFetch<{ session: { messages: Message[] } }>(`/api/chats/${sessionId}`, {
        headers: getAuthHeaders(),
      })
      if (res.success && res.data?.session) {
        setCurrentSessionId(sessionId)
        currentSessionIdRef.current = sessionId
        setMessages(res.data.session.messages || [])
        if (window.innerWidth < 820) {
          setIsSidebarOpen(false)
        }
      }
    } catch (err) {
      console.error('Failed to load session:', err)
    }
  }

  // Auto-restore active session from localStorage on load
  useEffect(() => {
    const savedActiveId = localStorage.getItem('mana_active_session_id')
    if (savedActiveId && !currentSessionId && sessions.length > 0) {
      if (sessions.some((s) => s.id === savedActiveId)) {
        handleSelectSession(savedActiveId)
      }
    }
  }, [sessions])

  // Delete a chat session
  const handleDeleteSession = async (sessionId: string) => {
    try {
      await safeApiFetch(`/api/chats/${sessionId}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      })

      setSessions((prev) => {
        const updated = prev.filter((s) => s.id !== sessionId)
        try {
          localStorage.setItem('mana_cached_sessions', JSON.stringify(updated))
        } catch {}
        return updated
      })

      if (currentSessionId === sessionId) {
        localStorage.removeItem('mana_active_session_id')
        setCurrentSessionId(null)
        currentSessionIdRef.current = null
        setMessages([])
        handleStopSpeaking()
      }
    } catch (err) {
      console.error('Failed to delete session:', err)
    }
  }

  // Clear current active conversation
  const handleClearChat = () => {
    if (isGenerating && abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    handleStopSpeaking()
    voiceManager.stopListening()
    setIsListening(false)
    setMessages([])
    setCurrentSessionId(null)
    currentSessionIdRef.current = null
    localStorage.removeItem('mana_active_session_id')
    setIsGenerating(false)
  }

  // Start a fresh new chat
  const handleNewChat = () => {
    handleClearChat()
    setInput('')
    if (window.innerWidth < 820) {
      setIsSidebarOpen(false)
    }
  }

  const handleStopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    handleStopSpeaking()
    setIsGenerating(false)
    setMessages((prev) => {
      const copy = [...prev]
      if (copy.length > 0 && copy[copy.length - 1].role === 'assistant') {
        copy[copy.length - 1].isStreaming = false
        copy[copy.length - 1].isSearching = false
      }
      return copy
    })
  }

  const handleToggleSearchMode = () => {
    const nextMode: SearchMode =
      config.searchMode === 'auto'
        ? 'always'
        : config.searchMode === 'always'
        ? 'never'
        : 'auto'
    handleUpdateConfig({ searchMode: nextMode })
  }

  const handleFeedback = async (
    messageId: string,
    rating: 'thumbs_up' | 'thumbs_down',
    comment?: string
  ) => {
    const targetMsg = messages.find((m) => m.id === messageId)
    const targetIdx = messages.findIndex((m) => m.id === messageId)
    const userPrompt = targetIdx > 0 ? messages[targetIdx - 1]?.content : ''

    setMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, feedback: rating } : m))
    )

    try {
      await safeApiFetch('/api/feedback', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          messageId,
          prompt: userPrompt,
          response: targetMsg?.content || '',
          rating,
          comment,
        }),
      })
    } catch (err) {
      console.error('Error saving feedback:', err)
    }
  }

  // Save conversation messages to backend session
  const saveSessionMessages = async (sessionId: string, msgsToSave: Message[]) => {
    try {
      await safeApiFetch(`/api/chats/${sessionId}/messages`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          messages: msgsToSave.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            timestamp: m.timestamp,
            searchEvidence: m.searchEvidence,
            isSearchPerformed: m.isSearchPerformed,
            feedback: m.feedback,
          })),
        }),
      })
      // Refresh sidebar sessions list
      fetchSessions()
    } catch (err) {
      console.warn('Error saving session messages:', err)
    }
  }

  const handleGenerateImage = async (
    customPrompt?: string,
    customRatio?: '1:1' | '16:9' | '9:16',
    customQuality?: 'standard' | 'hd'
  ) => {
    const promptToSend = (customPrompt || input).trim()
    if (!promptToSend) return

    setInput('')
    if (window.innerWidth < 820) {
      setIsSidebarOpen(false)
    }

    let activeSessionId = currentSessionIdRef.current
    if (!activeSessionId) {
      activeSessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`
      setCurrentSessionId(activeSessionId)
      currentSessionIdRef.current = activeSessionId
    }

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: promptToSend,
      timestamp: Date.now(),
      mode: 'image',
    }

    const assistantId = `assistant-${Date.now()}`
    const assistantMessage: Message = {
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      mode: 'image',
      isGeneratingMedia: true,
    }

    const nextMessages = [...messages, userMessage, assistantMessage]
    setMessages(nextMessages)

    try {
      const res = await safeApiFetch<{ image: GeneratedImageMetadata }>('/api/generate/image', {
        method: 'POST',
        body: JSON.stringify({
          prompt: promptToSend,
          aspectRatio: customRatio || imageAspectRatio,
          quality: customQuality || imageQuality,
        }),
      })

      if (!res.success || !res.data?.image) {
        throw new Error(res.error || 'Image generation failed.')
      }

      const generatedImage = res.data.image
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                isGeneratingMedia: false,
                image: generatedImage,
              }
            : m
        )
      )
      saveSessionMessages(activeSessionId, [
        ...nextMessages.filter((m) => m.id !== assistantId),
        { ...assistantMessage, isGeneratingMedia: false, image: generatedImage },
      ])
    } catch (err: any) {
      console.error('[App] Image generation error:', err)
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                isGeneratingMedia: false,
                mediaError: err.message || 'Image generation failed.',
              }
            : m
        )
      )
    }
  }

  const handleGenerateVideo = async (
    customPrompt?: string,
    customRatio?: '16:9' | '9:16' | '1:1',
    customDuration?: number
  ) => {
    const promptToSend = (customPrompt || input).trim()
    if (!promptToSend) return

    setInput('')
    if (window.innerWidth < 820) {
      setIsSidebarOpen(false)
    }

    let activeSessionId = currentSessionIdRef.current
    if (!activeSessionId) {
      activeSessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`
      setCurrentSessionId(activeSessionId)
      currentSessionIdRef.current = activeSessionId
    }

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: promptToSend,
      timestamp: Date.now(),
      mode: 'video',
    }

    const assistantId = `assistant-${Date.now()}`
    const assistantMessage: Message = {
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      mode: 'video',
      isGeneratingMedia: true,
    }

    const nextMessages = [...messages, userMessage, assistantMessage]
    setMessages(nextMessages)

    try {
      const res = await safeApiFetch<{ job: VideoJobMetadata }>('/api/generate/video', {
        method: 'POST',
        body: JSON.stringify({
          prompt: promptToSend,
          aspectRatio: customRatio || videoAspectRatio,
          duration: customDuration || videoDuration,
        }),
      })

      if (!res.success || !res.data?.job) {
        throw new Error(res.error || 'Video generation job failed.')
      }

      const initialJob = res.data.job
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                video: initialJob,
                isGeneratingMedia: initialJob.status === 'queued' || initialJob.status === 'processing',
              }
            : m
        )
      )

      if (initialJob.status === 'completed' || initialJob.status === 'failed') {
        saveSessionMessages(activeSessionId, [
          ...nextMessages.filter((m) => m.id !== assistantId),
          { ...assistantMessage, isGeneratingMedia: false, video: initialJob },
        ])
        return
      }

      // Poll video job status every 2.5 seconds
      const pollInterval = setInterval(async () => {
        try {
          const pollRes = await safeApiFetch<{ job: VideoJobMetadata }>(`/api/generate/video/status/${initialJob.jobId}`)
          if (pollRes.success && pollRes.data?.job) {
            const currentJob = pollRes.data.job
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      video: currentJob,
                      isGeneratingMedia: currentJob.status === 'queued' || currentJob.status === 'processing',
                    }
                  : m
              )
            )

            if (currentJob.status === 'completed' || currentJob.status === 'failed') {
              clearInterval(pollInterval)
              saveSessionMessages(activeSessionId, [
                ...nextMessages.filter((m) => m.id !== assistantId),
                { ...assistantMessage, isGeneratingMedia: false, video: currentJob },
              ])
            }
          }
        } catch (pollErr) {
          console.warn('Error polling video job:', pollErr)
        }
      }, 2500)
    } catch (err: any) {
      console.error('[App] Video generation error:', err)
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                isGeneratingMedia: false,
                mediaError: err.message || 'Video generation failed.',
              }
            : m
        )
      )
    }
  }

  const handleSendPrompt = (customPrompt?: string) => {
    if (chatMode === 'image') {
      handleGenerateImage(customPrompt)
    } else if (chatMode === 'video') {
      handleGenerateVideo(customPrompt)
    } else {
      handleSendMessage(customPrompt)
    }
  }

  const handleSendMessage = async (customPrompt?: string) => {
    const promptToSend = (customPrompt || input).trim()
    if (!promptToSend || isGenerating) return

    // Immediately stop any speech playback or recognition when new query is submitted
    if (isSpeakingRef.current) {
      voiceManager.stopSpeaking()
      setIsSpeaking(false)
      setSpeakingMessageId(null)
    }
    if (isListeningRef.current) {
      voiceManager.stopListening()
      setIsListening(false)
    }

    setInput('')
    if (window.innerWidth < 820) {
      setIsSidebarOpen(false)
    }

    // Ensure session exists or create one
    let activeSessionId = currentSessionIdRef.current
    if (!activeSessionId) {
      activeSessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`
      setCurrentSessionId(activeSessionId)
      currentSessionIdRef.current = activeSessionId
    }

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: promptToSend,
      timestamp: Date.now(),
    }

    const assistantId = `assistant-${Date.now()}`
    const assistantMessage: Message = {
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      isStreaming: true,
      isSearching: false,
    }

    const nextMessages = [...messages, userMessage, assistantMessage]
    setMessages(nextMessages)
    setIsGenerating(true)

    // Context window: send last 16 turns preserving full locality names and context
    const history = messages.slice(-16).map((m) => ({
      role: m.role,
      content: m.content.length > 2500 ? m.content.slice(0, 2500) + '...' : m.content,
    }))

    const controller = new AbortController()
    abortControllerRef.current = controller

    try {
      const streamEndpoint =
        typeof window !== 'undefined' && window.location.hostname !== 'localhost'
          ? '/.netlify/functions/chat-stream'
          : '/api/chat/stream'

      const response = await fetch(streamEndpoint, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          prompt: promptToSend,
          history,
          searchMode: config.searchMode,
          reasoningMode: config.reasoningMode,
        }),
        signal: controller.signal,
      })

      if (!response.ok || !response.body) {
        let errMessage = `Server error (HTTP ${response.status})`
        try {
          const errData = await response.json()
          if (errData.error) {
            errMessage = typeof errData.error === 'string' ? errData.error : errData.error.message || errMessage
          }
        } catch {}
        throw new Error(errMessage)
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let finalContent = ''
      let finalEvidence = undefined

      while (true) {
        const { value, done } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const events = buffer.split('\n\n')
        buffer = events.pop() || ''

        for (const eventBlock of events) {
          if (!eventBlock.trim()) continue

          const lines = eventBlock.split('\n')
          let eventType = 'message'
          let eventData = ''

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              eventType = line.slice(7).trim()
            } else if (line.startsWith('data: ')) {
              eventData = line.slice(6)
            }
          }

          if (!eventData) continue

          try {
            const parsed = JSON.parse(eventData)

            setMessages((prev) => {
              const copy = [...prev]
              const targetIdx = copy.findIndex((m) => m.id === assistantId)
              if (targetIdx === -1) return prev

              const target = { ...copy[targetIdx] }

              switch (eventType) {
                case 'search_start':
                  target.isSearching = true
                  target.isSearchPerformed = true
                  target.intent = parsed
                  break

                case 'search_status':
                  target.searchStatus = parsed.status
                  break

                case 'search_results':
                  target.searchEvidence = parsed
                  finalEvidence = parsed
                  target.isSearching = false
                  break

                case 'token':
                  target.content = (target.content || '') + parsed.token
                  finalContent = target.content
                  break

                case 'done':
                  target.isStreaming = false
                  target.isSearching = false
                  target.reasoningMode = parsed.reasoningMode
                  if (parsed.timings) {
                    target.timings = parsed.timings
                  }
                  if (parsed.documentsUsed) {
                    target.documentsUsed = parsed.documentsUsed
                  }
                  if (parsed.searchEvidence) {
                    target.searchEvidence = parsed.searchEvidence
                    finalEvidence = parsed.searchEvidence
                  }
                  break

                case 'error':
                  target.isStreaming = false
                  target.isSearching = false
                  target.content =
                    (target.content ? target.content + '\n\n' : '') +
                    `⚠️ **Error**: ${parsed.message}`
                  finalContent = target.content
                  break
              }

              copy[targetIdx] = target
              return copy
            })
          } catch (jsonErr) {
            console.error('Error parsing SSE JSON:', jsonErr)
          }
        }
      }

      // Persist finished conversation to backend session
      const completedAssistantMsg: Message = {
        ...assistantMessage,
        content: finalContent,
        searchEvidence: finalEvidence,
        reasoningMode: configRef.current.reasoningMode,
        isStreaming: false,
        isSearching: false,
      }
      const allCurrentMsgs = [...messages, userMessage, completedAssistantMsg]
      saveSessionMessages(activeSessionId, allCurrentMsgs)

      // Auto-speak completed answer if Voice Mode is active
      if (configRef.current.voiceSettings?.voiceMode && finalContent.trim()) {
        handleSpeakMessage(assistantId, finalContent)
      }

    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('Chat error:', err)
        setMessages((prev) => {
          const copy = [...prev]
          const target = copy.find((m) => m.id === assistantId)
          if (target) {
            target.isStreaming = false
            target.isSearching = false
            target.content =
              (target.content ? target.content + '\n\n' : '') +
              `⚠️ **Error**: ${err.message || 'Unable to connect to Mana AI backend.'}`
          }
          return copy
        })
      }
    } finally {
      setIsGenerating(false)
      abortControllerRef.current = null
      setMessages((prev) => {
        const copy = [...prev]
        const target = copy.find((m) => m.id === assistantId)
        if (target) {
          target.isStreaming = false
          target.isSearching = false
        }
        return copy
      })
    }
  }

  const handleRegenerateChat = (assistantMsgId: string) => {
    if (isGenerating) return
    const idx = messages.findIndex((m) => m.id === assistantMsgId)
    if (idx > 0) {
      const userPrompt = messages[idx - 1]?.content
      if (userPrompt) {
        setMessages((prev) => prev.filter((m) => m.id !== assistantMsgId))
        handleSendMessage(userPrompt)
      }
    }
  }

  const hasMessages = messages.length > 0

  return (
    <div className="chatgpt-layout">
      {/* Sidebar with Chat History & Search Filter */}
      <Sidebar
        isOpen={isSidebarOpen}
        onToggle={() => setIsSidebarOpen(!isSidebarOpen)}
        onNewChat={handleNewChat}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenMemory={() => setIsMemoryOpen(true)}
        onOpenAuth={() => setIsAuthOpen(true)}
        onLogout={handleLogout}
        onSelectPrompt={(p) => handleSendPrompt(p)}
        sessions={sessions}
        currentSessionId={currentSessionId}
        onSelectSession={handleSelectSession}
        onDeleteSession={handleDeleteSession}
        currentUser={currentUser}
      />

      {/* Main Chat Workspace */}
      <div className="chatgpt-main">
        {/* Top Header */}
        <Header
          onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
          onNewChat={handleNewChat}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onOpenMemory={() => setIsMemoryOpen(true)}
          onOpenAuth={() => setIsAuthOpen(true)}
          currentUser={currentUser}
          isVoiceMode={!!config.voiceSettings?.voiceMode}
          onToggleVoiceMode={handleToggleVoiceMode}
        />

        {/* Content Area */}
        <div className="chatgpt-conversation-area">
          {!hasMessages ? (
            <div className="chatgpt-empty-state">
              <div className="mana-empty-logo">
                <ManaLogo size={36} />
              </div>
              <h1 className="empty-state-title">
                {currentUser?.name ? `Hey, ${currentUser.name}!` : "What's on your mind?"}
              </h1>
              <p className="empty-state-subtitle">
                Your AI. Your World.
              </p>
            </div>
          ) : (
            <div className="chatgpt-message-list">
              {messages.map((message) => (
                <ChatMessage
                  key={message.id}
                  message={message}
                  onFeedback={handleFeedback}
                  isSpeakingMessage={speakingMessageId === message.id && isSpeaking}
                  onSpeakMessage={handleSpeakMessage}
                  onStopSpeaking={handleStopSpeaking}
                  onPreviewImage={(img) => setLightboxImage(img)}
                  onRegenerateImage={(prompt, ratio, qual) =>
                    handleGenerateImage(prompt, ratio as any, qual as any)
                  }
                  onRegenerateVideo={(prompt, ratio, dur) =>
                    handleGenerateVideo(prompt, ratio as any, dur)
                  }
                  onRegenerateChat={handleRegenerateChat}
                  onOpenSettings={() => setIsSettingsOpen(true)}
                />
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Bottom Floating Input Bar with Mode Switcher & Voice Controls */}
        <ChatInput
          input={input}
          onChange={setInput}
          onSend={() => handleSendPrompt()}
          onStop={handleStopGeneration}
          isGenerating={isGenerating}
          searchMode={config.searchMode}
          onToggleSearchMode={handleToggleSearchMode}
          isListening={isListening}
          onToggleVoice={handleToggleVoice}
          voiceError={voiceError}
          onClearVoiceError={() => setVoiceError(null)}
          isVoiceSupported={isSpeechRecognitionSupported()}
          mode={chatMode}
          onSelectMode={setChatMode}
          imageAspectRatio={imageAspectRatio}
          onSelectImageAspectRatio={setImageAspectRatio}
          imageQuality={imageQuality}
          onSelectImageQuality={setImageQuality}
          videoAspectRatio={videoAspectRatio}
          onSelectVideoAspectRatio={setVideoAspectRatio}
          videoDuration={videoDuration}
          onSelectVideoDuration={setVideoDuration}
        />

        {/* Settings Modal */}
        <SettingsModal
          config={config}
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          onSave={handleUpdateConfig}
        />

        {/* Memory Modal */}
        <MemoryModal
          isOpen={isMemoryOpen}
          onClose={() => setIsMemoryOpen(false)}
        />

        {/* Auth Modal (Login / Sign Up) */}
        <AuthModal
          isOpen={isAuthOpen}
          onClose={() => setIsAuthOpen(false)}
          onAuthSuccess={handleAuthSuccess}
        />

        {/* Image Lightbox Modal */}
        <ImageLightboxModal
          image={lightboxImage}
          onClose={() => setLightboxImage(null)}
        />
      </div>
    </div>
  )
}

export default App
