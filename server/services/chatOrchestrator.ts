import { AppConfig, SearchEvidence, MemoryItem, SearchMode } from '../types.js'
import { configService } from './configService.js'
import { authService } from './authService.js'
import { memoryService } from './memoryService.js'
import { documentService } from './documentService.js'
import { classifyIntent } from './intentClassifier.js'
import { executeWebSearch } from './searchService.js'
import { generateAIResponse } from './aiService.js'

export interface ChatRequestOptions {
  prompt: string
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
  searchMode?: SearchMode
  reasoningMode?: 'fast' | 'thinking'
  aiProvider?: 'ollama' | 'gemini' | 'openai' | 'groq' | 'builtin'
  modelName?: string
  ollamaBaseUrl?: string
  ollamaModel?: string
  geminiApiKey?: string
  openaiApiKey?: string
  groqApiKey?: string
  authUser?: any
  clientId?: string
}

export interface StreamEventCallbacks {
  onMemorySaved?: (memory: MemoryItem) => void
  onSearchStart?: (data: { query: string; reason: string; category: string }) => void
  onSearchStatus?: (data: { status: string; step: string }) => void
  onSearchResults?: (evidence: SearchEvidence) => void
  onToken?: (token: string) => void
  onDone?: (data: any) => void
  onError?: (error: Error) => void
}

export const MAX_PROMPT_LENGTH = 10000

/**
 * Unified Chat Orchestrator shared across Express local/production server
 * and Netlify Serverless Streaming functions.
 */
export async function orchestrateChat(
  options: ChatRequestOptions,
  callbacks?: StreamEventCallbacks
): Promise<{
  content: string
  searchEvidence?: SearchEvidence
  isSearchPerformed: boolean
  intent: any
  memoriesUsed: string[]
  documentsUsed: string[]
  reasoningMode: string
  timings: {
    reqStart: number
    ttftMs: number
    totalMs: number
  }
}> {
  const reqStart = Date.now()
  const { prompt, history = [], searchMode: reqSearchMode, reasoningMode: reqReasoningMode, authUser } = options

  // 1. Strict Server Input Validation
  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    throw new Error('Valid prompt string is required.')
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    throw new Error(`Prompt exceeds maximum allowed length (${MAX_PROMPT_LENGTH} characters).`)
  }

  const cleanPrompt = prompt.trim()

  // 2. Resolve Config & Keys (Prioritizing secure server environment variables for shared deployments)
  const config = { ...configService.getConfig() }
  if (options.aiProvider) {
    config.aiProvider = options.aiProvider
  }
  if (options.modelName) {
    config.modelName = options.modelName
  }

  const isCloudHost = Boolean(process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME)
  const envCloudUrl = process.env.AI_API_BASE_URL || process.env.OLLAMA_BASE_URL

  if (options.ollamaBaseUrl) {
    const isClientLocalhost =
      options.ollamaBaseUrl.includes('127.0.0.1') || options.ollamaBaseUrl.includes('localhost')
    // If running in cloud environment and server has a cloud AI URL, do not allow client's localhost default to override it
    if (isCloudHost && isClientLocalhost && envCloudUrl) {
      config.ollamaBaseUrl = envCloudUrl
    } else {
      config.ollamaBaseUrl = options.ollamaBaseUrl
    }
  } else if (envCloudUrl) {
    config.ollamaBaseUrl = envCloudUrl
  }

  if (options.ollamaModel) {
    config.ollamaModel = options.ollamaModel
  }

  // Validate that an incoming client key is non-empty, genuine, and not a masked placeholder
  const isGenuineKey = (k?: string): boolean =>
    typeof k === 'string' && k.trim().length > 10 && !k.includes('••••') && !k.includes('****')

  // Check if authenticated user has a personal key saved in their account
  let userSavedKey: string | undefined
  if (authUser?.id) {
    const rawUser = authService.getUserById(authUser.id)
    if (rawUser?.geminiApiKey && isGenuineKey(rawUser.geminiApiKey)) {
      userSavedKey = rawUser.geminiApiKey.trim()
    }
  }

  // Gemini Key Resolution:
  // 1. Client-supplied custom key (BYOK in session) if genuine
  // 2. Account-stored user key if genuine
  // 3. Server environment variable GEMINI_API_KEY (shared deployment authority)
  // 4. Server config file key if genuine
  if (isGenuineKey(options.geminiApiKey)) {
    config.geminiApiKey = options.geminiApiKey!.trim()
  } else if (userSavedKey) {
    config.geminiApiKey = userSavedKey
  } else if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim()) {
    config.geminiApiKey = process.env.GEMINI_API_KEY.trim()
  } else if (isGenuineKey(config.geminiApiKey)) {
    config.geminiApiKey = config.geminiApiKey.trim()
  } else {
    config.geminiApiKey = ''
  }

  // OpenAI Key Resolution:
  if (isGenuineKey(options.openaiApiKey)) {
    config.openaiApiKey = options.openaiApiKey!.trim()
  } else if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim()) {
    config.openaiApiKey = process.env.OPENAI_API_KEY.trim()
  } else if (isGenuineKey(config.openaiApiKey)) {
    config.openaiApiKey = config.openaiApiKey.trim()
  } else {
    config.openaiApiKey = ''
  }

  // Groq Key Resolution:
  if (isGenuineKey(options.groqApiKey)) {
    config.groqApiKey = options.groqApiKey!.trim()
  } else if (process.env.GROQ_API_KEY && process.env.GROQ_API_KEY.trim()) {
    config.groqApiKey = process.env.GROQ_API_KEY.trim()
  } else if (isGenuineKey(config.groqApiKey)) {
    config.groqApiKey = config.groqApiKey.trim()
  } else {
    config.groqApiKey = ''
  }

  const searchMode: SearchMode = reqSearchMode || config.searchMode || 'auto'
  const reasoningMode: 'fast' | 'thinking' = reqReasoningMode || (config.reasoningMode as any) || 'fast'
  const isMemoryEnabled = config.memoryEnabled !== false

  // 3. User Memory Detection & Retrieval
  const learnedMemory = memoryService.detectAndSaveUserPreferences(cleanPrompt, isMemoryEnabled, authUser?.id)
  if (learnedMemory && callbacks?.onMemorySaved) {
    callbacks.onMemorySaved(learnedMemory)
  }
  const relevantMemories = memoryService.getRelevantMemories(cleanPrompt, isMemoryEnabled, authUser?.id)

  // 4. Document RAG Retrieval
  const documentMatches = documentService.searchKnowledge(cleanPrompt, 3)

  // 5. Context-Aware Intent Classification
  const intent = classifyIntent(cleanPrompt, history)

  // Web search decision:
  // NEVER search if user is conversational, greetings, identity inquiries, or correcting/giving feedback
  const isConversationalOrFeedback =
    intent.category === 'conversational' ||
    intent.category === 'contextual_followup' ||
    intent.isCorrectionOrFeedback === true

  const shouldSearch =
    searchMode !== 'never' &&
    !isConversationalOrFeedback &&
    ((searchMode === 'always') || (searchMode === 'auto' && intent.needsSearch))

  let searchEvidence: SearchEvidence | undefined

  if (shouldSearch) {
    if (callbacks?.onSearchStart) {
      callbacks.onSearchStart({
        query: intent.refinedQuery,
        reason: intent.reason,
        category: intent.category,
      })
    }
    if (callbacks?.onSearchStatus) {
      callbacks.onSearchStatus({
        status: `Searching live web via ${config.searchProvider}...`,
        step: 'retrieving',
      })
    }

    try {
      searchEvidence = await executeWebSearch(
        intent.refinedQuery,
        config.searchProvider,
        {
          tavily: config.tavilyApiKey,
          serper: config.serperApiKey,
          brave: config.braveApiKey,
        }
      )
    } catch (searchErr: any) {
      console.warn('[Orchestrator] Web search warning (continuing with LLM):', searchErr.message)
    }

    if (callbacks?.onSearchStatus) {
      callbacks.onSearchStatus({
        status: 'Filtering & verifying sources...',
        step: 'filtering',
      })
    }
    if (searchEvidence && callbacks?.onSearchResults) {
      callbacks.onSearchResults(searchEvidence)
    }
  }

  if (callbacks?.onSearchStatus) {
    callbacks.onSearchStatus({
      status: reasoningMode === 'thinking' ? 'Deep reasoning & calculating...' : 'Thinking...',
      step: 'generating',
    })
  }

  let firstTokenTime: number | null = null
  let accumulatedContent = ''

  const onTokenHandler = (token: string) => {
    if (!firstTokenTime) {
      firstTokenTime = Date.now() - reqStart
    }
    accumulatedContent += token
    if (callbacks?.onToken) {
      callbacks.onToken(token)
    }
  }

  // 6. Generate AI Response
  const content = await generateAIResponse({
    prompt: cleanPrompt,
    history,
    searchEvidence,
    memories: relevantMemories,
    isDetailRequested: intent.isDetailRequested,
    config,
    reasoningMode,
    documentMatches,
    onToken: onTokenHandler,
  })

  const totalTime = Date.now() - reqStart
  const resultData = {
    content: accumulatedContent || content,
    searchEvidence,
    isSearchPerformed: shouldSearch || !!searchEvidence,
    intent,
    memoriesUsed: relevantMemories.map((m) => m.key),
    documentsUsed: documentMatches.map((d) => d.docTitle),
    reasoningMode,
    provider: config.aiProvider || 'ollama',
    model: config.modelName || config.ollamaModel || 'qwen2.5:3b',
    timings: {
      reqStart,
      ttftMs: firstTokenTime || totalTime,
      totalMs: totalTime,
    },
  }

  if (callbacks?.onDone) {
    callbacks.onDone(resultData)
  }

  return resultData
}
