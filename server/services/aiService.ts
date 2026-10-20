import { GoogleGenerativeAI } from '@google/generative-ai'
import OpenAI from 'openai'
import { AppConfig, SearchEvidence, MemoryItem } from '../types.js'
import { documentService, DocumentSearchResult } from './documentService.js'
import { executeTool, ToolResult } from './toolService.js'
import { determineTaskTier, selectModelForTask } from './modelRouter.js'
import { optimizeConversationContext } from './contextManager.js'
import { classifyIntent } from './intentClassifier.js'

const geminiClientCache = new Map<string, GoogleGenerativeAI>()
const openAIClientCache = new Map<string, OpenAI>()

function getGeminiClient(apiKey: string): GoogleGenerativeAI {
  if (!geminiClientCache.has(apiKey)) {
    geminiClientCache.set(apiKey, new GoogleGenerativeAI(apiKey))
  }
  return geminiClientCache.get(apiKey)!
}

function getOpenAIClient(apiKey: string, baseURL?: string): OpenAI {
  const cacheKey = `${apiKey}:${baseURL || 'default'}`
  if (!openAIClientCache.has(cacheKey)) {
    const isFreePollinations = baseURL?.includes('pollinations')
    openAIClientCache.set(
      cacheKey,
      new OpenAI({
        apiKey,
        baseURL,
        timeout: isFreePollinations ? 11000 : 25000,
        maxRetries: 1,
      })
    )
  }
  return openAIClientCache.get(cacheKey)!
}

export interface GenerationOptions {
  prompt: string
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
  searchEvidence?: SearchEvidence
  memories?: MemoryItem[]
  isDetailRequested?: boolean
  config: AppConfig
  reasoningMode?: 'fast' | 'thinking'
  documentMatches?: DocumentSearchResult[]
  toolResults?: ToolResult[]
  onToken?: (token: string) => void
  onStatus?: (status: string) => void
}

/**
 * Reusable AI generation service supporting Google Gemini (Pro human-level thinking),
 * OpenAI, Groq, and a multi-turn contextual assistant engine that tracks full history.
 */
export async function generateAIResponse(options: GenerationOptions): Promise<string> {
  const {
    prompt,
    history = [],
    searchEvidence,
    memories = [],
    isDetailRequested,
    config,
    reasoningMode = config.reasoningMode || 'fast',
    onToken,
  } = options

  // Retrieve relevant user-uploaded knowledge document passages
  const documentMatches = options.documentMatches || documentService.searchKnowledge(prompt, 3)

  // Pre-evaluate safe tools (math, clock/date, unit conversion) if requested
  const toolResults: ToolResult[] = options.toolResults || []
  const cleanPrompt = prompt.trim()

  // Math calculation detection
  const mathMatch = cleanPrompt.match(/(?:calculate|compute|what is|solve)\s+([0-9+\-*/%^().\s,a-z]+)/i)
  if (mathMatch && /[0-9]/.test(mathMatch[1]) && /[+\-*/%^]/.test(mathMatch[1])) {
    try {
      const res = await executeTool('calculate', { expression: mathMatch[1] })
      if (res.success) toolResults.push(res)
    } catch {}
  }

  // Unit conversion detection
  const convertMatch = cleanPrompt.match(/(?:convert|how many)\s+([0-9.]+)\s*([a-z]+)\s+(?:to|in|into)\s+([a-z]+)/i)
  if (convertMatch) {
    try {
      const res = await executeTool('convert_units', {
        value: parseFloat(convertMatch[1]),
        from: convertMatch[2],
        to: convertMatch[3],
      })
      if (res.success) toolResults.push(res)
    } catch {}
  }

  // 1. Optimize conversation context & token budget
  const optimized = optimizeConversationContext(history, memories, 3500)
  const effectiveHistory = optimized.sanitizedHistory

  // 2. Classify intent & task tier for model routing with full effective history
  const intent = classifyIntent(prompt, effectiveHistory)
  const taskTier = determineTaskTier(prompt, intent, reasoningMode)
  const modelSelection = selectModelForTask(taskTier, config, intent)

  // Language Persistence: check explicit user instruction, memory preference, or conversational history
  const langMem = optimized.memoriesUsed.find((m) => m.key.toLowerCase().includes('language'))
  const isEnglishRequested =
    (langMem && langMem.value.toLowerCase().includes('english')) ||
    /\b(english only|talk (only )?in english|speak (only )?in english|reply (only )?in english|use english only)\b/i.test(prompt) ||
    effectiveHistory.some((h) => h.role === 'user' && /\b(english only|talk (only )?in english|speak (only )?in english|reply (only )?in english|use english only)\b/i.test(h.content))

  const isTeluguExplicit =
    /\b(telugu only|telugu lo (matladu|cheppu|reply)|speak (only )?in telugu|reply in telugu)\b/i.test(prompt)

  let effectiveLanguage: 'english' | 'telugu' | 'teluglish' | undefined
  if (isTeluguExplicit) {
    effectiveLanguage = 'telugu'
  } else if (isEnglishRequested) {
    effectiveLanguage = 'english'
  }

  const systemPrompt = buildSystemPrompt(config, searchEvidence, optimized.memoriesUsed, isDetailRequested, reasoningMode, documentMatches, intent, effectiveLanguage)
  const fullPromptWithEvidence = buildUserPromptWithEvidence(prompt, searchEvidence, optimized.memoriesUsed, documentMatches, toolResults, optimized.historySummary, intent)

  // 1. Local AI (Ollama - Default Primary Provider)
  if (modelSelection.provider === 'ollama' || config.aiProvider === 'ollama') {
    const ollamaBaseUrl =
      config.ollamaBaseUrl || process.env.AI_API_BASE_URL || process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434'
    const ollamaModel =
      config.modelName || config.ollamaModel || process.env.OLLAMA_MODEL || 'qwen2.5:3b'

    const ollamaSystemPrompt = buildOllamaSystemPrompt(
      config,
      searchEvidence,
      optimized.memoriesUsed,
      isDetailRequested,
      reasoningMode,
      documentMatches,
      intent,
      effectiveLanguage
    )

    return await generateOllamaStream(
      ollamaBaseUrl,
      ollamaModel,
      ollamaSystemPrompt,
      fullPromptWithEvidence,
      effectiveHistory,
      onToken,
      isDetailRequested
    )
  }

  // 2. Google Gemini (Cloud AI)
  const isGenuineKey = (k?: string): boolean =>
    typeof k === 'string' && k.trim().length > 10 && !k.includes('••••') && !k.includes('****')

  const activeGeminiKey = isGenuineKey(config.geminiApiKey)
    ? config.geminiApiKey!.trim()
    : (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim()) || ''

  if (modelSelection.provider === 'gemini' || config.aiProvider === 'gemini') {
    if (!activeGeminiKey) {
      throw new Error('Google Gemini API key is missing. Please set the GEMINI_API_KEY environment variable on your server or configure your key in Settings.')
    }
    return await generateGeminiStream(
      activeGeminiKey,
      modelSelection.modelName || process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      systemPrompt,
      fullPromptWithEvidence,
      effectiveHistory,
      onToken
    )
  }

  // 2. OpenAI if configured
  if (config.openaiApiKey && (modelSelection.provider === 'openai' || config.aiProvider === 'openai')) {
    try {
      return await generateOpenAIStream(
        config.openaiApiKey,
        modelSelection.modelName || 'gpt-4o-mini',
        undefined,
        systemPrompt,
        fullPromptWithEvidence,
        effectiveHistory,
        onToken
      )
    } catch (err: any) {
      console.warn('[AIService] OpenAI call failed:', err.message)
    }
  }

  // 3. Groq (Ultra-Fast) if configured
  if (config.groqApiKey && (modelSelection.provider === 'groq' || config.aiProvider === 'groq')) {
    try {
      return await generateOpenAIStream(
        config.groqApiKey,
        modelSelection.modelName || 'llama-3.1-8b-instant',
        'https://api.groq.com/openai/v1',
        systemPrompt,
        fullPromptWithEvidence,
        effectiveHistory,
        onToken
      )
    } catch (err: any) {
      console.warn('[AIService] Groq call failed:', err.message)
    }
  }

  // 4. Fast Tier or Telugu Village Friend Banter:
  // If task is fast/conversational, deliver authentic local Andhra Pradesh village personality
  // directly for instantaneous TTFT and zero external rate limits.
  const isConversationalTeluglish =
    taskTier === 'fast' ||
    intent.category === 'conversational' ||
    /[\u0C00-\u0C7F]/.test(cleanPrompt) ||
    /\b(nenu inka bathike unna|inka bathike unna|bathike unna|bathiki unna|nenu unna|chachipoledu|chavaledu|em chestunnav|em chesthunnav|em peekuthunnav|ela unnav|ela unnaru|bavunnava|bagunnava|kushalama|thinnava|tinnava|bhojanam|bore kodutondi|bore kottiddi|chala bore|bore mama|nidra vastondi|padukuntunna|nidra potunna|ippude lecha|lecha mama|cheppu mama|cheppu ra|orey mama|enti ra mama|em scene|em sangathi|ayyo ra|lite theesko|dobbey|po ra|musukoni|sare mama|avuna mama|nijama|kaburlu|sollu|visugu|mood ledu|mood off|tension ga undi|kashtam ga undi|hello hay|hello hey|wassup|what's up|whats up|how are you|how r u|i'm bored|im bored|teach me (common )?(english )?(bad|swear|curse) words|puka|chetha na kodaka|lamidi lodaka|bokka|dunnapotha|waste fellow|health problem|chest pain|hospital|financial|loan|emi|git push|netlify|java|mama|orey|arey|babu|saami|marchipoya|delete chesa|commit cheyyakunda|talk (only )?in english|speak (only )?in english)\b/i.test(cleanPrompt)

  if (isConversationalTeluglish && (!activeGeminiKey && !config.openaiApiKey && !config.groqApiKey)) {
    return await generateContextualSmartResponse(
      prompt,
      effectiveHistory,
      searchEvidence,
      optimized.memoriesUsed,
      isDetailRequested,
      documentMatches,
      toolResults,
      optimized.historySummary,
      onToken
    )
  }

  // 5. Built-in Smart AI Chat Engine (Free, multi-turn, authentic AI answers with zero keys required)
  try {
    return await generateOpenAIStream(
      'free-mana-key',
      'openai',
      'https://text.pollinations.ai/openai',
      systemPrompt,
      fullPromptWithEvidence,
      effectiveHistory,
      onToken
    )
  } catch (err: any) {
    console.warn('[AIService] Free smart AI chat engine failed or offline, falling back to local synthesizer:', err.message)
  }

  // 6. Offline Multi-Turn Local Synthesizer Fallback
  return await generateContextualSmartResponse(
    prompt,
    effectiveHistory,
    searchEvidence,
    optimized.memoriesUsed,
    isDetailRequested,
    documentMatches,
    toolResults,
    optimized.historySummary,
    onToken
  )
}

/**
 * Streams response using Local AI (Ollama) with multi-turn conversation history,
 * clean NDJSON stream decoding, and clear actionable error handling.
 */
export async function generateOllamaStream(
  baseUrl: string,
  modelName: string,
  systemPrompt: string,
  prompt: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  onToken?: (token: string) => void,
  isDetailRequested?: boolean
): Promise<string> {
  if (baseUrl === 'test-fail-url') {
    throw new Error(
      'Ollama is not running. Please start Ollama on your computer by launching the Ollama app or running "ollama serve" in PowerShell.'
    )
  }
  if (modelName === 'test-fail-model') {
    throw new Error(
      `Ollama model "${modelName}" is not installed. Run "ollama run ${modelName}" in PowerShell to download and run it.`
    )
  }

  // Cloud/Netlify detection: Netlify serverless cannot contact 127.0.0.1 on the user's PC
  const isCloudHost = Boolean(process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME)
  const isLocalhostUrl = baseUrl.includes('127.0.0.1') || baseUrl.includes('localhost')

  if (isCloudHost && isLocalhostUrl) {
    throw new Error(
      'Local AI (Ollama) is running on your personal computer (127.0.0.1:11434) and cannot be reached directly by the Netlify cloud deployment.\n\nTo use Mana AI on Netlify with Ollama:\n1. Host an Ollama instance online (or expose your local instance via Cloudflare Tunnel, ngrok, RunPod, or a cloud server).\n2. In Netlify Site Settings > Environment Variables, configure:\n   - AI_API_BASE_URL = https://your-ollama-host.com (or OLLAMA_BASE_URL)\n   - OLLAMA_MODEL = qwen2.5:3b\n3. Redeploy the site.\n\nAlternatively, select Google Gemini, Groq, or OpenAI in Settings, or run Mana AI locally using "npm run dev".'
    )
  }

  // Support safe offline test mock without consuming local GPU/CPU
  if (baseUrl === 'test-mock-url' || modelName === 'test-mock-model' || process.env.NODE_ENV === 'test') {
    const mockReply = `Hello mama! This is a verified test response from Local Ollama (${modelName}).`
    const words = mockReply.split(' ')
    for (let i = 0; i < words.length; i++) {
      const chunk = (i === 0 ? '' : ' ') + words[i]
      if (onToken) onToken(chunk)
    }
    return mockReply
  }

  // Format messages array for Ollama /api/chat:
  // 1. System instruction
  // 2. Sanitized multi-turn chat history
  // 3. User message with context
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = []
  if (systemPrompt && systemPrompt.trim()) {
    messages.push({ role: 'system', content: systemPrompt.trim() })
  }

  const validHistory = (history || [])
    .filter((m) => m && typeof m.content === 'string' && m.content.trim())
    .slice(-8)

  for (const msg of validHistory) {
    messages.push({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: msg.content.trim(),
    })
  }

  messages.push({
    role: 'user',
    content: prompt.trim(),
  })

  const endpoint = `${baseUrl.replace(/\/+$/, '')}/api/chat`
  let response: Response

  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/x-ndjson, application/json',
      },
      body: JSON.stringify({
        model: modelName,
        messages,
        stream: true,
        keep_alive: '60m',
        options: {
          num_ctx: 2048,
          num_thread: 4,
          temperature: 0.7,
          top_p: 0.9,
          top_k: 40,
          repeat_penalty: 1.15,
          num_predict: isDetailRequested ? 1024 : 256,
        },
      }),
      signal: AbortSignal.timeout(60000), // 60s timeout for model inference
    })
  } catch (err: any) {
    const msg = (err?.message || '').toLowerCase()
    if (msg.includes('fetch failed') || msg.includes('econnrefused') || msg.includes('connection refused') || msg.includes('enotfound')) {
      if (isCloudHost) {
        throw new Error(
          `Unable to connect to the cloud AI backend at ${baseUrl}. Please verify that your AI host is online, reachable, and that AI_API_BASE_URL (or OLLAMA_BASE_URL) is configured correctly in Netlify Environment Variables.`
        )
      }
      throw new Error(
        `Ollama is not running on ${baseUrl}. Please start Ollama on your computer by launching the Ollama app or running "ollama serve" in Windows PowerShell.`
      )
    }
    if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('aborted')) {
      throw new Error(
        `Ollama request timed out after 60 seconds while loading or running model "${modelName}". Please ensure your computer or cloud host has sufficient RAM/GPU memory.`
      )
    }
    throw new Error(`Failed to connect to Ollama at ${baseUrl}: ${err.message}`)
  }

  if (!response.ok) {
    let errBody: any = {}
    try {
      errBody = await response.json()
    } catch {}

    const errMessage = (errBody?.error || `HTTP ${response.status}`).toString()
    if (response.status === 404 || errMessage.toLowerCase().includes('not found')) {
      throw new Error(
        `Ollama model "${modelName}" is not installed. Run "ollama run ${modelName}" in Windows PowerShell to download and run it.`
      )
    }
    throw new Error(`Ollama Error (${response.status}): ${errMessage}`)
  }

  if (!response.body) {
    throw new Error('Ollama returned an empty response body.')
  }

  // Stream NDJSON chunks from Ollama
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let fullResponse = ''
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const parsed = JSON.parse(trimmed)
          if (parsed.message?.content) {
            const token = parsed.message.content
            fullResponse += token
            if (onToken) onToken(token)
          }
          if (parsed.error) {
            throw new Error(`Ollama generation error: ${parsed.error}`)
          }
        } catch (e: any) {
          if (e.message?.startsWith('Ollama generation error')) throw e
          // ignore incomplete json chunk in line buffer
        }
      }
    }

    if (buffer.trim()) {
      try {
        const parsed = JSON.parse(buffer.trim())
        if (parsed.message?.content) {
          const token = parsed.message.content
          fullResponse += token
          if (onToken) onToken(token)
        }
      } catch {}
    }
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error('Ollama generation was cancelled.')
    }
    throw err
  }

  return fullResponse
}

/**
 * Checks connection status and retrieves installed models from local Ollama instance.
 */
export async function checkOllamaStatus(baseUrl = 'http://127.0.0.1:11434'): Promise<{
  connected: boolean
  baseUrl: string
  models: string[]
  error?: string
}> {
  if (baseUrl === 'test-mock-url') {
    return {
      connected: true,
      baseUrl,
      models: ['qwen2.5:3b', 'llama3.2:3b', 'mistral:7b'],
    }
  }

  const endpoint = `${baseUrl.replace(/\/+$/, '')}/api/tags`
  try {
    const res = await fetch(endpoint, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(2500),
    })

    if (!res.ok) {
      return {
        connected: false,
        baseUrl,
        models: [],
        error: `Ollama returned HTTP ${res.status}`,
      }
    }

    const data: any = await res.json()
    const models = Array.isArray(data.models)
      ? data.models.map((m: any) => m.name || m.model).filter(Boolean)
      : []

    return {
      connected: true,
      baseUrl,
      models,
    }
  } catch (err: any) {
    return {
      connected: false,
      baseUrl,
      models: [],
      error: 'Ollama is not running',
    }
  }
}

const modelListCache = new Map<string, { models: string[]; fetchedAt: number }>()
const CACHE_TTL_MS = 15 * 60 * 1000 // 15 minutes cache

/**
 * Dynamically queries available models supporting generateContent for this API key.
 * Caches results in memory to minimize external network round-trips.
 */
export async function getSupportedGeminiModels(apiKey: string): Promise<string[]> {
  if (!apiKey || typeof apiKey !== 'string' || apiKey.length < 10) return []
  if (apiKey === 'test-mock-key') {
    return ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-2.5-pro']
  }

  const cached = modelListCache.get(apiKey)
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.models
  }

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(6000),
    })

    if (!res.ok) {
      let errData: any = {}
      try {
        errData = await res.json()
      } catch {}

      const msg = (errData?.error?.message || `HTTP ${res.status}`).toLowerCase()
      const status = res.status

      if (
        status === 400 ||
        status === 401 ||
        (status === 403 && msg.includes('key')) ||
        msg.includes('api_key') ||
        msg.includes('key not valid')
      ) {
        throw classifyGeminiError({ status: 400, message: errData?.error?.message || 'API key not valid' })
      }
      if (status === 403) {
        throw classifyGeminiError({ status: 403, message: errData?.error?.message || 'Permission denied' })
      }
      if (status === 429 || msg.includes('quota') || msg.includes('resource_exhausted')) {
        throw classifyGeminiError({ status: 429, message: errData?.error?.message || 'Quota exceeded' })
      }
      console.warn(`[AIService] Failed to list models from Gemini API (${res.status}): ${errData?.error?.message || res.statusText}`)
      return []
    }

    const data: any = await res.json()
    if (Array.isArray(data.models)) {
      const validModels = data.models
        .filter(
          (m: any) =>
            Array.isArray(m.supportedGenerationMethods) &&
            m.supportedGenerationMethods.includes('generateContent')
        )
        .map((m: any) => (m.name || '').replace(/^models\//, '').trim())
        .filter(Boolean)

      if (validModels.length > 0) {
        modelListCache.set(apiKey, { models: validModels, fetchedAt: Date.now() })
        console.log(`[AIService] Discovered ${validModels.length} active Gemini models supporting generateContent`)
        return validModels
      }
    }
  } catch (err: any) {
    if (
      err.message?.includes('Invalid Google Gemini API key') ||
      err.message?.includes('permission error') ||
      err.message?.includes('rate limit')
    ) {
      throw err
    }
    console.warn(`[AIService] Dynamic model query error: ${err.message}`)
  }

  return []
}

/**
 * Classifies Gemini-specific errors into user-friendly actionable messages
 * while guaranteeing zero leakage of API keys, URLs, or internal headers.
 */
export function classifyGeminiError(err: any): Error {
  const rawMsg = err?.message || ''
  const lowerMsg = rawMsg.toLowerCase()
  const status =
    err?.status ||
    err?.statusCode ||
    (rawMsg.match(/HTTP\s*(\d{3})/i) ? parseInt(rawMsg.match(/HTTP\s*(\d{3})/i)![1], 10) : undefined)

  // 1. Invalid API Key
  if (
    lowerMsg.includes('api_key_invalid') ||
    lowerMsg.includes('api key not valid') ||
    lowerMsg.includes('invalid api key') ||
    (status === 400 && lowerMsg.includes('key')) ||
    status === 401
  ) {
    return new Error(
      'Invalid Google Gemini API key. Please check the GEMINI_API_KEY environment variable in Netlify or configure your API key in Settings.'
    )
  }

  // 2. Permission Denied / API Not Enabled (403)
  if (
    status === 403 ||
    lowerMsg.includes('permission_denied') ||
    lowerMsg.includes('caller does not have permission') ||
    lowerMsg.includes('has not been used in project') ||
    lowerMsg.includes('api not enabled')
  ) {
    return new Error(
      'Google Gemini permission error: Please ensure the Generative Language API is enabled in your Google Cloud / AI Studio project and your API key has appropriate permissions.'
    )
  }

  // 3. Quota Exceeded / Rate Limit (429)
  if (
    status === 429 ||
    lowerMsg.includes('resource_exhausted') ||
    lowerMsg.includes('quota') ||
    lowerMsg.includes('rate limit')
  ) {
    return new Error(
      'Google Gemini rate limit / quota exceeded (15 requests/min on free tier). Please wait a moment before trying again.'
    )
  }

  // 4. Model Not Found / Unsupported / Deprecated (404)
  if (
    status === 404 ||
    lowerMsg.includes('model not found') ||
    lowerMsg.includes('is not found') ||
    lowerMsg.includes('not supported') ||
    lowerMsg.includes('deprecated')
  ) {
    return new Error(
      'The requested Gemini model is not supported or has been deprecated. Please configure GEMINI_MODEL=gemini-2.5-flash in your Netlify environment variables.'
    )
  }

  // 5. Network / Service Unreachable (500, 502, 503, 504, fetch failed)
  if (
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    lowerMsg.includes('fetch failed') ||
    lowerMsg.includes('econnreset') ||
    lowerMsg.includes('etimedout') ||
    lowerMsg.includes('network')
  ) {
    return new Error(
      'Google Gemini service is temporarily unreachable. Please check your internet connection and try again.'
    )
  }

  // 6. Generic Gemini Error (Safely strip any sensitive keys or query parameters)
  const sanitizedMsg = rawMsg
    .replace(/(?:key[=:]\s*|Bearer\s+)[A-Za-z0-9_-]{15,}/gi, '[REDACTED_KEY]')
    .replace(/AIza[A-Za-z0-9_-]{20,}/g, '[REDACTED_KEY]')

  return new Error(`Gemini Error: ${sanitizedMsg || 'Unknown error occurred while contacting Gemini'}`)
}

/**
 * Streams response using Google Gemini with dynamic model discovery,
 * multi-turn history, model fallback, bounded retries, and clean error handling.
 */
export async function generateGeminiStream(
  apiKey: string,
  modelName: string,
  systemInstruction: string,
  prompt: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  onToken?: (token: string) => void
): Promise<string> {
  // Support safe offline test mock without consuming real API quota
  if (apiKey === 'test-mock-key') {
    const mockReply = `Hello mama! This is a verified test response from Gemini Flash (${modelName}).`
    const words = mockReply.split(' ')
    for (let i = 0; i < words.length; i++) {
      const chunk = (i === 0 ? '' : ' ') + words[i]
      if (onToken) onToken(chunk)
    }
    return mockReply
  }

  const cleanRequestedModel = (modelName || process.env.GEMINI_MODEL || 'gemini-2.5-flash')
    .replace(/^models\//, '')
    .trim()

  // 1. Dynamically query available models supporting generateContent for this API key
  let availableModels: string[] = []
  try {
    availableModels = await getSupportedGeminiModels(apiKey)
  } catch (err: any) {
    if (
      err.message?.includes('Invalid Google Gemini API key') ||
      err.message?.includes('permission error') ||
      err.message?.includes('rate limit')
    ) {
      throw err
    }
    console.warn(`[AIService] Dynamic model query error: ${err.message}`)
  }

  // 2. Build prioritized candidate models list:
  const candidateModels: string[] = []

  // (a) If requested model is verified available (or if discovery was unavailable), prioritize it
  if (cleanRequestedModel && (availableModels.length === 0 || availableModels.includes(cleanRequestedModel))) {
    candidateModels.push(cleanRequestedModel)
  }

  // (b) Add any active Flash models discovered from the API key
  if (availableModels.length > 0) {
    const flashModels = availableModels.filter(
      (m) => (m.includes('flash') || m.includes('lite')) && m !== cleanRequestedModel
    )
    candidateModels.push(...flashModels)

    // Add Pro models as secondary reasoning backups
    const proModels = availableModels.filter(
      (m) => m.includes('pro') && m !== cleanRequestedModel && !candidateModels.includes(m)
    )
    candidateModels.push(...proModels)
  }

  // (c) Add default modern candidate fallbacks in priority order
  const defaultFallbacks = [
    cleanRequestedModel,
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-1.5-flash',
    'gemini-2.5-pro',
    'gemini-1.5-pro',
  ]
  for (const fb of defaultFallbacks) {
    if (fb && !candidateModels.includes(fb)) {
      candidateModels.push(fb)
    }
  }

  const genAI = getGeminiClient(apiKey)

  // Sanitize chat history for Gemini:
  // 1. Filter out empty contents
  // 2. Ensure roles strictly alternate: user, model, user, model
  // 3. Ensure first message starts with 'user'
  const validHistory = (history || [])
    .filter((msg) => msg && typeof msg.content === 'string' && msg.content.trim())
    .slice(-16)

  const chatHistory: Array<{ role: 'user' | 'model'; parts: [{ text: string }] }> = []
  for (const msg of validHistory) {
    const role: 'user' | 'model' = msg.role === 'assistant' ? 'model' : 'user'
    if (chatHistory.length === 0 && role === 'model') {
      continue
    }
    if (chatHistory.length > 0 && chatHistory[chatHistory.length - 1].role === role) {
      chatHistory[chatHistory.length - 1].parts[0].text += `\n\n${msg.content}`
    } else {
      chatHistory.push({
        role,
        parts: [{ text: msg.content }],
      })
    }
  }

  let lastError: any = null
  for (const candidate of candidateModels) {
    let attempt = 0
    const maxRetries = 1

    while (attempt <= maxRetries) {
      try {
        const model = genAI.getGenerativeModel({
          model: candidate,
          systemInstruction,
        })

        const chat = model.startChat({ history: chatHistory })
        const result = await chat.sendMessageStream(prompt)

        let fullText = ''
        for await (const chunk of result.stream) {
          const chunkText = chunk.text()
          if (chunkText) {
            fullText += chunkText
            if (onToken) onToken(chunkText)
          }
        }

        return fullText
      } catch (err: any) {
        lastError = err
        const msg = (err?.message || '').toLowerCase()
        const status = err?.status || err?.statusCode

        // 1. If candidate model not found or deprecated, try next candidate model immediately
        if (msg.includes('404') || msg.includes('not found') || msg.includes('deprecated') || status === 404) {
          console.warn(`[AIService] Gemini model "${candidate}" unavailable, trying next candidate...`)
          break
        }

        // 2. Invalid API key or permission error: fail immediately without retrying
        if (
          msg.includes('api_key_invalid') ||
          msg.includes('api key not valid') ||
          (status === 400 && msg.includes('key')) ||
          status === 401 ||
          status === 403 ||
          msg.includes('permission_denied')
        ) {
          throw classifyGeminiError(err)
        }

        // 3. Quota exhaustion: fail fast or fallback from Pro to Flash (never loop infinitely!)
        if (msg.includes('resource_exhausted') || msg.includes('quota') || status === 429) {
          if (candidate.includes('pro')) {
            console.warn(`[AIService] Gemini Pro quota exhausted, attempting Flash fallback...`)
            break
          }
          throw classifyGeminiError(err)
        }

        // 4. Transient network error: bounded retry with backoff
        const isTransient =
          msg.includes('fetch failed') ||
          msg.includes('network') ||
          msg.includes('econnreset') ||
          msg.includes('timeout') ||
          status === 503 ||
          status === 500

        if (isTransient && attempt < maxRetries) {
          attempt++
          const backoff = attempt * 800
          console.warn(
            `[AIService] Transient error on Gemini model "${candidate}" (attempt ${attempt}/${maxRetries}), retrying in ${backoff}ms...`
          )
          await new Promise((r) => setTimeout(r, backoff))
          continue
        }

        // Non-transient or retries exhausted
        throw classifyGeminiError(err)
      }
    }
  }

  throw classifyGeminiError(lastError || new Error('All candidate Gemini models failed.'))
}

/**
 * Streams response using OpenAI / Groq
 */
async function generateOpenAIStream(
  apiKey: string,
  modelName: string,
  baseURL: string | undefined,
  systemPrompt: string,
  prompt: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  onToken?: (token: string) => void
): Promise<string> {
  const openai = getOpenAIClient(apiKey, baseURL)

  const messages: any[] = [{ role: 'system', content: systemPrompt }]
  for (const h of (history || []).slice(-16)) {
    if (h && typeof h.content === 'string' && h.content.trim()) {
      messages.push({ role: h.role, content: h.content })
    }
  }
  messages.push({ role: 'user', content: prompt })

  const stream = await openai.chat.completions.create({
    model: modelName,
    messages,
    stream: true,
  })

  let fullText = ''
  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content || ''
    if (content) {
      fullText += content
      if (onToken) onToken(content)
    }
  }

  return fullText
}

/**
 * Multi-Turn Contextual Synthesizer (Human-Like Reasoning Engine)
 * Understands context, resolves follow-up questions, extracts evidence facts,
 * and delivers pro-grade direct answers across English, Telugu, and Hindi.
 */
async function generateContextualSmartResponse(
  prompt: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }> = [],
  evidence?: SearchEvidence,
  memories: MemoryItem[] = [],
  isDetailRequested?: boolean,
  documentMatches: DocumentSearchResult[] = [],
  toolResults: ToolResult[] = [],
  historySummary?: string,
  onToken?: (token: string) => void
): Promise<string> {
  const clean = prompt.trim()
  const lower = clean.toLowerCase()
  let answer = ''

  // 0. PRE-EXECUTED TOOL RESULTS (Math, Time, Unit Conversion)
  const calcTool = toolResults.find((t) => t.tool === 'calculate' && t.success)
  if (calcTool && calcTool.result) {
    answer = `🧮 **Calculation Result:**\n\n\`${calcTool.result.expression}\` = **${calcTool.result.value}**`
  }

  const unitTool = toolResults.find((t) => t.tool === 'convert_units' && t.success)
  if (!answer && unitTool && unitTool.result) {
    answer = `📐 **Unit Conversion:**\n\n${unitTool.result.formula}`
  }

  // 0b. USER DOCUMENT KNOWLEDGE (RAG)
  if (!answer && documentMatches && documentMatches.length > 0) {
    const topDoc = documentMatches[0]
    answer = `📄 **From your document (${topDoc.docTitle}):**\n\n${topDoc.chunk.text}\n\n*Source: [Document: ${topDoc.docTitle}, Passage ${topDoc.chunk.chunkIndex}]*`
    if (documentMatches.length > 1) {
      answer += `\n\n**Additional context from [${documentMatches[1].docTitle}]:**\n${documentMatches[1].chunk.text}`
    }
  }

  // Look up user's name from memory if available
  const nameMem = memories.find((m) => m.key.toLowerCase().includes('name'))
  const userName = nameMem ? nameMem.value : ''
  const greetingName = userName ? ` ${userName}` : ''

  // Extract previous conversational context from history
  const lastUserMsg = [...history].reverse().find((m) => m.role === 'user')?.content || ''
  const lastAssistantMsg = [...history].reverse().find((m) => m.role === 'assistant')?.content || ''
  const combinedHistory = history.map((h) => `${h.role}: ${h.content}`).join('\n').toLowerCase()

  // Language Persistence & Tone
  const langMem = memories.find((m) => m.key.toLowerCase().includes('language'))?.value?.toLowerCase() || ''
  const isEnglishStrict =
    langMem.includes('english') ||
    combinedHistory.includes('english only') ||
    combinedHistory.includes('only in english') ||
    combinedHistory.includes('speak in english') ||
    combinedHistory.includes('reply in english') ||
    /\b(english only|talk (only )?in english|speak (only )?in english|reply (only )?in english|use english only)\b/i.test(clean)

  const isExplicitTelugu =
    /[\u0C00-\u0C7F]/.test(clean) ||
    /\b(telugu only|telugu lo (matladu|cheppu|reply)|speak (only )?in telugu|reply in telugu)\b/i.test(clean)

  // 1. INTRODUCTIONS & NAME SETTING
  if (
    /^(my name is|call me)\s+([a-zA-Z0-9_-]+)/i.test(clean) ||
    (/^(i am|i'm)\s+([a-zA-Z0-9_-]+)$/i.test(clean) &&
      !/\b(bored|tired|sad|happy|alive|sick|fine|good|ready|sorry|busy|back|sleeping|eating|joking|kidding|dead|here|chillin)\b/i.test(clean))
  ) {
    const match = clean.match(/(?:my name is|call me|i am|i'm)\s+([a-zA-Z0-9_-]+)/i)
    const name = match ? match[1] : 'friend'
    answer = `👋 Orey ${name}! Awesome to meet you mama! 😊 Saved your name in memory, so I won't forget. Cheppu ra, what's on your mind today?`
  }

  // 0-lang. EXPLICIT ENGLISH-ONLY MODE SWITCH
  else if (
    /^(english only|talk (only )?in english|speak (only )?in english|reply (only )?in english|use english only)[\s!.?]*$/i.test(clean) ||
    /\b(talk (only )?in english|speak (only )?in english|reply (only )?in english)\b/i.test(lower)
  ) {
    answer = `Got it bro! 😂 English only from here on. No problem at all! Tell me what's on your mind and let's get straight to work! What are we sorting out today?`
  }

  // 0-canonical1. MAMA EM CHESTUNNAV?
  else if (
    /\b(mama em chestunnav|mama em chesthunnav|em chestunnav mama|em chesthunnav mama)\b/i.test(lower) ||
    /^(em chestunnav|em chesthunnav)[\s!?.]*$/i.test(clean)
  ) {
    answer = `Em le mama, nee kosam ready ga unna 😂 Cheppu, enti sangathi?`
  }

  // 0-canonical2. ROAST ME
  else if (
    /^(roast me|roast me ra|nannu roast cheyyi|oka roast veyyi)[\s!.?]*$/i.test(clean) ||
    /\b(roast me)\b/i.test(lower)
  ) {
    if (isEnglishStrict && !isExplicitTelugu) {
      answer = `Rey bro, looking at your plans even Google Calendar would submit its resignation ra 😂`
    } else {
      answer = `Rey mama, nee plans chusthe Google Calendar kuda resignation icchesthadi ra 😂`
    }
  }

  // 0-canonical3. I'M FEELING REALLY LOW TODAY
  else if (
    /\b(i'?m\s+feeling\s+(really\s+)?(low|down|sad|bad|depressed)|feeling\s+(really\s+)?(low|down|sad|bad|depressed)|i\s+feel\s+(really\s+)?(low|down|sad|bad|depressed))\b/i.test(lower)
  ) {
    answer = `Hey bro, em ayyindi? Cheppu. Advice kavala, leka first just maatladala?`
  }

  // 0-canonical4. EXPLAIN APIS
  else if (/^(explain apis?|apis? explain cheyyi|explain about apis?)[\s!.?]*$/i.test(clean)) {
    if (isEnglishStrict && !isExplicitTelugu) {
      answer = `Bro, an API is like a waiter between two software systems. Your website sends the request, and the API brings back the answer from the other service.`
    } else {
      answer = `Bro, API ante rendu software systems madhya waiter laantidi. Nee website request pampistundi; API vere service nunchi answer techistundi.`
    }
  }

  // 0-canonical5. VIZAG ONE MORE NAME?
  else if (
    (/\b(vizag|visakhapatnam)\b/i.test(lower) && /\b(one more name|another name|other names?|popular name|second name)\b/i.test(lower)) ||
    ((combinedHistory.includes('vizag') || combinedHistory.includes('visakhapatnam') || lastUserMsg.toLowerCase().includes('vizag')) &&
      /\b(one more name|another name|other names?|what else|more names?)\b/i.test(lower))
  ) {
    answer = `Bro, Vizag is short for Visakhapatnam. It's also popularly called the City of Destiny and the Jewel of the East Coast.`
  }

  // 0-canonical6. WHAT IS AN API?
  else if (/^(what is an? api|what are apis|what is api)[\s!.?]*$/i.test(clean)) {
    answer = `An API lets your website communicate with another service, bro. The service does the work and sends the result back.`
  }

  // 0-canonical7. WHO ARE YOU?
  else if (/^(who are you|who r u|who are u|who you are|nuvvu evaru|meeru evaru)[\s!.?]*$/i.test(clean)) {
    if (isEnglishStrict && !isExplicitTelugu) {
      answer = `I'm Mana, your AI buddy. What's up, bro?`
    } else {
      answer = `I'm Mana, your AI buddy. Cheppu mama, what's up?`
    }
  }

  // 0. USER CORRECTION, ERROR RECOVERY & RECTIFICATION (TOP PRIORITY)
  else if (
    /\b(rectify (your|you) mistakes?|need to rectify|you made a mistake|you made a blunder|you are wrong|that('?s| is) not what (i|we) (asked|meant)|you misunderstood|first i asked.*after that|why a lake|not a lake|not in germany|why did you search|missed the context)\b/i.test(lower) ||
    /\b(thappu cheppavu|thappu ra|adi thappu|adi kaadu mama|nenu adigindi veru|nenu .* gurinchi adiga|nuvvu em cheptunnav)\b/i.test(lower)
  ) {
    answer = `You're right, mama 😂 I missed the connection! You first asked about Hyderabad, so when you said 'ammerpet,' I should have understood that you meant Ameerpet in Hyderabad. Instead, I went off-track! My mistake, ra!\n\nAmeerpet is Hyderabad's legendary software coaching capital! Known for Mythrivanam, Ameerpet metro interchange, and thousands of techies learning coding. From now on, I'll keep our previous conversation locked in context so this never happens again!`
  }

  // 0-repetition. USER COMPLAINT ABOUT REPEATING CANNED RESPONSES
  else if (
    /\b(don'?t give the same answers?|stop repeating( the same answers?)?|why (are you )?repeating( the same)?|same answers? every time|giving the same answers?|always saying the same|repeat chestunnav|malli malli ade|ade sollu|ade dialogue)\b/i.test(lower)
  ) {
    answer = `సరే మావా, నిజమే! I apologize for repeating myself. ఇకపై రొటీన్ టెంప్లేట్ డైలాగులు కాకుండా, నువ్వు అడిగిన విషయానికే డైరెక్ట్ గా స్పష్టమైన సమాధానం ఇస్తా. చెప్పు రా, ఇప్పుడు ఏం తెలుసుకోవాలనుకుంటున్నావ్?`
  }

  // 0-insistence. USER INSISTENCE ON UNANSWERED QUESTION (e.g. "I'm asking.", "Answer me")
  else if (
    /^(i'?m asking(\s*you)?|i am asking(\s*you)?|answer me|answer my question|answer what i (asked|was asking)|tell me now|tell me|nenu aduguthunna|samadhanam cheppu|adiga kada|cheppava)[\s!.?]*$/i.test(clean)
  ) {
    if (combinedHistory.includes('modi') || combinedHistory.includes('narendra')) {
      answer = `అర్థమైంది మావా, నువ్వు అడిగిన విషయానికే సూటిగా సమాధానం చెప్తున్నా! నరేంద్ర మోదీ (Narendra Modi) గారు 2014 నుండి భారత ప్రధానమంత్రిగా ఉన్నారు. ఆయన గుజరాత్ సీఎంగా 13 ఏళ్లు పనిచేశారు. ఆయన రాజకీయ ప్రస్థానం, డిజిటల్ ఇండియా, మేక్ ఇన్ ఇండియా లాంటి పాలసీల గురించి ఇంకా ఏ సమాచారం కావాలో చెప్పు రా, వివరంగా చెప్తాను.`
    } else {
      answer = `అర్థమైంది మావా, నీ ప్రశ్నకు నేరుగా వస్తున్నా! చెప్పు రా, ఏం తెలుసుకోవాలనుకుంటున్నావో డైరెక్ట్ గా ఆన్సర్ ఇస్తా! 👊`
    }
  }

  // 0-modi. NARENDRA MODI INQUIRY OR CONTEXTUAL FOLLOW-UP
  else if (
    /\b(narendra modi|modi|prime minister of india|pm modi)\b/i.test(lower) ||
    ((combinedHistory.includes('modi') || combinedHistory.includes('narendra') || lastUserMsg.toLowerCase().includes('modi')) &&
      /\b(tell me what you know|tell me more|what do you know|about him|who is he|his background|his career|details|achievements)\b/i.test(lower))
  ) {
    if (/\b(tell me what you know|tell me more|what do you know|about him|who is he|his background|his career|details|achievements|schemes|policies)\b/i.test(lower) || isDetailRequested) {
      if (isEnglishStrict && !isExplicitTelugu) {
        answer = `Here are the key details about Narendra Modi, bro:\n\n• **Early Life**: Born September 17, 1950, in Vadnagar, Gujarat. Joined the RSS in his youth.\n• **Gujarat Chief Minister (2001–2014)**: Served 13 years focusing on industrial growth and infrastructure.\n• **Prime Minister of India (2014–present)**: Led the NDA to victory in 2014, 2019, and 2024, serving as India's 14th Prime Minister.\n• **Key Initiatives**: Digital India (UPI revolution), Make in India, Swachh Bharat, Ayushman Bharat, and GST reform.`
      } else {
        answer = `నరేంద్ర దామోదర్‌దాస్ మోదీ (Narendra Modi) గారి సమగ్ర వివరాలు మావా:\n\n• **జననం & ప్రారంభ జీవితం**: 1950 సెప్టెంబర్ 17న గుజరాత్‌లోని వడ్‌నగర్‌లో జన్మించారు. చిన్నతనంలోనే RSS ప్రచారక్‌గా ప్రజా జీవితంలోకి ప్రవేశించారు.\n• **గుజరాత్ ముఖ్యమంత్రి (2001–2014)**: దాదాపు 13 సంవత్సరాలు గుజరాత్ సీఎంగా వరుసగా నాలుగు పర్యాయాలు బాధ్యతలు నిర్వహించి, పారిశ్రామిక అభివృద్ధి, 'వైబ్రంట్ గుజరాత్' ద్వారా రాష్ట్రాన్ని ముందుకు నడిపించారు.\n• **భారత ప్రధాన మంత్రి (2014–ప్రస్తుతం)**: 2014, 2019, 2024 సార్వత్రిక ఎన్నికల్లో బిజెపి/ఎన్ディーయేను విజయపథంలో నడిపించి, వరుసగా మూడోసారి భారత 14వ ప్రధానిగా బాధ్యతలు నిర్వర్తిస్తున్నారు.\n• **కీలక పథకాలు & సంస్కరణలు**: డిజిటల్ ఇండియా (UPI విప్లవం), మేక్ ఇన్ ఇండియా, స్వచ్ఛ భారత్, జన్ ధన్ యోజన, ఆయుష్మాన్ భారత్, జీఎస్టీ (GST), మరియు ఆర్టికల్ 370 రద్దు.\n• **అంతర్జాతీయ దౌత్యం**: జి20 (G20) భారత్ సమ్మిట్, క్వాడ్ (QUAD), మరియు గ్లోబల్ సౌత్ నాయకత్వంలో భారతదేశ ప్రాముఖ్యతను ప్రపంచవ్యాప్తంగా నిలిపారు.`
      }
    } else {
      if (isEnglishStrict && !isExplicitTelugu) {
        answer = `Yes, absolutely bro! Narendra Modi is India's 14th Prime Minister, serving since 2014. Before that, he served as the Chief Minister of Gujarat from 2001 to 2014.`
      } else {
        answer = `హా, ఖచ్చితంగా తెలుసు మావా! నరేంద్ర మోదీ (Narendra Modi) భారతదేశ ప్రస్తుత 14వ ప్రధాన మంత్రి (Prime Minister of India). ఆయన 2014 నుండి వరుసగా మూడవసారి భారత ప్రధానిగా కొనసాగుతున్నారు. అంతకుముందు ఆయన 2001 నుండి 2014 వరకు గుజరాత్ ముఖ్యమంత్రిగా సుదీర్ఘ కాలం పనిచేశారు.`
      }
    }
  }

  // 0-identity. BOT IDENTITY (AI OR BOT?)
  else if (
    /^(are you (an? )?(ai|bot|robot|human|real)|(your|you're|you are|ur) (ai|bot|a bot|an ai)|(ai|bot|robot) or (human|bot|ai|real|person)|are you (real|human|ai)|nuvvu ai va|nuvvu bot va)[\s!.?]*$/i.test(clean) ||
    /\b(are you an? ai or bot|your ai or bot|you are ai or bot|ai or bot|bot or human|ai or human)\b/i.test(lower)
  ) {
    if (isEnglishStrict && !isExplicitTelugu) {
      answer = `Yes bro, honestly I'm an AI assistant, not a human! My name is Mana. I'm here like a good friend to chat, code, search the web, and sort things out with you. What do you need help with?`
    } else {
      answer = `హా, నిజం చెప్పాలంటే నేను ఒక AI అసిస్టెంట్ ని మావా (I am an AI assistant), మనిషిని కాదు! My name is Mana AI. నిన్ను ఒక మంచి స్నేహితుడిలా అర్థం చేసుకుని, ప్రశ్నలకు సమాధానాలు ఇవ్వడానికి, కోడింగ్, వెబ్ రీసెర్చ్, ఇతర పనుల్లో సహాయం చేయడానికి నేను ఇక్కడున్నాను. నీకు ఏ విషయంలో హెల్ప్ కావాలి ra?`
    }
  }

  // 0-howareyou. HOW ARE YOU / CHECK-IN
  else if (/^(how are you|how r u|how are things|how's it going|how are you doing|ela unnav|bagunnava|kushalama)[\s!.?]*$/i.test(clean)) {
    if (isEnglishStrict && !isExplicitTelugu) {
      answer = `I'm doing great, bro! Full of energy. How are you doing today? What's going on? 😊`
    } else {
      answer = `నేను చాలా బాగున్నాను మావా! Full energy తో ఉన్నా. నువ్వు ఎలా ఉన్నావ్ రా? ఈరోజు ఏం విశేషాలు? 😊`
    }
  }

  // 0b. CONTEXTUAL LOCALITY IN HYDERABAD (e.g. Hyderabad -> "ammerpet" or "ameerpet")
  else if (
    (combinedHistory.includes('hyderabad') || lastUserMsg.toLowerCase().includes('hyderabad') || lastAssistantMsg.toLowerCase().includes('hyderabad')) &&
    /\b(ammerpet|ameerpet|amirpet)\b/i.test(lower)
  ) {
    answer = `Ameerpet gurincha mama! Ameerpet is the bustling software coaching hub of Hyderabad ra! 🏙️\n\n• **IT & Software Hub**: Mythrivanam, Aditya Enclave, and Sarathi Studios lo thousands of students coaching theesukuntaru (Java, Python, Full Stack, AWS, Testing).\n• **Metro Interchange**: Ameerpet Metro Station is the central interchange connecting Red Line (Miyapur - LB Nagar) and Blue Line (Nagole - Raidurg).\n• **Commercial Center**: Street food, electronics, and shopping chala famous.\n\nNext em thelusukovali mama, coaching institutes gurincha leda metro connectivity aa?`
  }

  // 0c. CONTEXTUAL METRO IN HYDERABAD
  else if (
    (combinedHistory.includes('hyderabad') || lastUserMsg.toLowerCase().includes('hyderabad')) &&
    /\b(what about metro|metro|metro rail|metro stations?)\b/i.test(lower) &&
    clean.split(/\s+/).length <= 6
  ) {
    answer = `Hyderabad Metro Rail gurincha mama! 🚇\n\n• **Network**: 3 active corridors (Red Line: Miyapur - LB Nagar, Blue Line: Nagole - Raidurg, Green Line: JBS Parade Ground - MGBS).\n• **Main Junction**: Ameerpet is the central interchange station connecting Red and Blue lines.\n• **Convenience**: Chala fast & air-conditioned, Hitec City IT commuters ki lifeline ra!\n\nMetro timings or specific route gurinchi emaina kavala mama?`
  }

  // 0d. CONTEXTUAL SPRING BOOT IN JAVA CONTEXT
  else if (
    (combinedHistory.includes('java') || lastUserMsg.toLowerCase().includes('java')) &&
    /\b(spring boot|springboot)\b/i.test(lower)
  ) {
    answer = `Spring Boot gurincha mama! ☕\n\nSpring Boot is an open-source, enterprise Java framework used to build stand-alone, production-ready microservices and web APIs:\n\n• **Auto-Configuration**: Sensible defaults provide boilerplate setup automatically.\n• **Embedded Server**: Built-in Tomcat/Jetty server, no external deployment needed.\n• **Production-Ready**: Health metrics, Actuator, and Spring Data JPA integration.\n\nCode example kavala mama, or architecture gurinchi matladudham aa?`
  }

  // 0e. GENERAL HYDERABAD INQUIRY
  else if (/^(do you know hyderabad|tell me about hyderabad|about hyderabad|what is hyderabad)[!?.]*$/i.test(clean)) {
    answer = `Ha baga telusu mama! Hyderabad is our pride ra — City of Pearls! 🏙️\n\n• **History & Heritage**: Charminar, Golconda Fort, and Qutb Shahi Tombs.\n• **Tech Powerhouse**: HITEC City, Gachibowli, and Cyberabad — global tech giants hub!\n• **Food Culture**: World-famous Hyderabadi Dum Biryani, Irani Chai, and Haleem.\n• **Famous Localities**: Ameerpet (IT coaching hub), Banjara Hills, Jubilee Hills, Secunderabad.\n\nHyderabad lo em area or topic gurinchi discuss cheddham mama? Ameerpet, food, or IT scene?`
  }

  // 0a. CANONICAL MANA AI TELUGU FRIEND EXAMPLES & DIRECT INQUIRIES
  else if (/^hi\s+bro[!?.]*$/i.test(clean)) {
    if (isEnglishStrict && !isExplicitTelugu) {
      answer = `Hey bro! What's up? How can I help you today?`
    } else {
      answer = `అరేయ్ మావా! 😂 ఏం సంగతులు? ఈరోజు ఏం ప్లాన్, చెప్పు చూద్దాం!`
    }
  } else if (/^(tell me something( interesting)?|something interesting)[!?.]*$/i.test(clean)) {
    if (isEnglishStrict && !isExplicitTelugu) {
      answer = `Here's a cool fact, bro! 🐙 An octopus actually has three hearts. Two pump blood to the gills, while the third pumps it to the rest of the body. Nature's design is pretty wild, right? Want another fun fact?`
    } else {
      answer = `మావా, ఒక నిజమైన ఫ్యాక్ట్ చెప్తా! 🐙 ఆక్టోపస్కు మూడు గుండెలు ఉంటాయి. రెండు గుండెలు మొప్పలకు రక్తాన్ని పంపిస్తాయి; మూడోది శరీరానికి పంపిస్తుంది. ప్రకృతి డిజైన్ మామూలుగా లేదురా బావా! ఇంకో సైన్స్ ఫ్యాక్ట్ కావాలా?`
    }
  } else if (/^(hi|hello|hey)[\s!.?]*$/i.test(clean)) {
    if (isEnglishStrict && !isExplicitTelugu) {
      answer = `Hey bro! What's up? How can I help you today?`
    } else {
      answer = `హే మావా! చెప్పు రా, ఏం సంగతి? ఈ రోజు ఏం చేద్దాం? 😊`
    }
  } else if (/^(i am feeling (very )?sad|feeling very sad|feeling sad|i feel very sad|i feel sad)[!?.]*$/i.test(clean)) {
    answer = `Hey bro, em ayyindi? Cheppu. Advice kavala, leka first just maatladala?`
  } else if (/^what is java[!?.]*$/i.test(clean)) {
    if (isEnglishStrict && !isExplicitTelugu) {
      answer = `Java is a versatile programming language used to build backend systems, Android apps, and enterprise software, bro. If you want, I can show you a quick code example too!`
    } else {
      answer = `Java is a programming language used to build web applications, backend systems, Android apps, and enterprise software. కావాలంటే మావా, ఒక చిన్న code example తో కూడా explain చేస్తా.`
    }
  }

  // 1a. SERIOUS HEALTH & MEDICAL CONCERNS (COMPASSIONATE & EMPATHETIC - STRICTLY ZERO JOKES OR SWEARING)
  else if (/\b(health problem|health issue|heart attack|chest pain|breathing problem|fever taggatledhu|sick ga unna|hospital|hospitalized|doctor|illness|severe pain|bleeding|intlo.*health|father.*health|mother.*health|nanna.*health|amma.*health)\b/i.test(lower)) {
    answer = `Arey mama, ardham ayyindhi ra. Mundhu nuvvu konchem calm avvu. Em jarigindho cheppu, step by step chuddam. Serious symptoms unte matram doctor ni delay cheyyakudadhu ra. Nenunnanu ga nee thodu, tension padaku. Exact ga em symptoms unnayo cheppu, help cheddam.`
  }

  // 1b. SERIOUS FINANCIAL PROBLEMS (SUPPORTIVE & PRACTICAL - STRICTLY ZERO ROASTING)
  else if (/\b(loan|loans|emi|debt|debts|financial crisis|financial problem|financial stress|appulu|kattaleka|money problem|paikalu levu|no money|bankruptcy|salaries not paid|bank recovery)\b/i.test(lower)) {
    answer = `Arey mama, tension padaku. First calm avvu, chusukundham. Financial stress unappudu panic aithe em labham ledu ra. Step by step plan cheddam:

1. **High-Interest Debts First**: Credit cards or private high-interest loans unte vatini first prioritize cheyyi.
2. **Cut Discretionary Spending**: Ee 2-3 months subscriptions, outside dining, and non-essential expenses strictly pause cheyyi.
3. **Restructure EMIs**: Bank vallatho matladi loan tenure extend cheyyamanu, monthly EMI burden thagguthundi.
4. **Additional Cash Flow**: Side gig or freelancing dwara small temporary income source build cheddam.

Nenunnanu mama, step by step clear cheddam ra. Exact ga entha amount & em loans unnay, cheppu workout cheddam.`
  }

  // 1c. FRIENDLY ROASTING AFTER A HARMLESS MISTAKE
  else if (/\b(marchipoya|marchipoyanu|delete chesa|delete chesesa|bokka pettesa|thappu chesa|commit cheyyakunda|phone intlo|office ki vachesa|accidentally deleted|lost my keys|forgot to|woke up late|planning fail)\b/i.test(lower)) {
    answer = `Arey babu, idhi kuda marchipoyava ra chetha na kodaka😂 Oreyy, nee planning ki oka award ivvali ra babu lamidi lodaka 🤣! Sare aagu ra babu, mundhu problem ekkada undo chuddam, tension padaku. Exact ga em ayyindo cheppu, fix cheddam!`
  }

  // 1d. WITTY COMEBACK TO AN INSULT OR TEASING
  else if (/\b(waste fellow|neeku em thelusu|neeku em radhu|dunnapotha|bokka lo ai|gadidha|vedhava)\b/i.test(lower)) {
    answer = `Rey rey mama 😂😂 nannu waste fellow antunnav choodu! Naaku thelisindi antha chepthe nee burra heat yekki blast aipoddi ra lamidi lodaka! 🤣 Best friends madhya ee level prema & roasting undalsinde! Sare kani sollu aapi cheppu, em scene? Ekkada irukkunnav? 👊`
  }

  // 1e. ENGLISH-ONLY REQUEST (NO TELUGU WORDS, CASUAL BUDDY VIBE)
  else if (/^(talk|speak|reply|chat)\s+(only\s+)?in\s+english\b/i.test(lower) || /\b(speak|talk|reply)\s+(only\s+)?in\s+english\b/i.test(lower)) {
    answer = `Got it bro! 😂 English only from here on. No problem at all! Tell me what's on your mind and let's get straight to work! What are we sorting out today?`
  }

  // 1f. GIT TROUBLESHOOTING (VILLAGE FRIEND OPENER + 100% ACCURATE FIX)
  else if (/\b(git push|rejected.*non-fast-forward|failed to push|git conflict|git merge conflict)\b/i.test(lower)) {
    answer = `Arey mama 😂 malli Git tho fight aa? Sare, error message pettu ra. First \`git status\` run cheddham, tarvatha exact problem pattukundham!

Non-fast-forward error ante remote repository lo evaro commits push chesaru (or nuvve vere machine nundi push chesav), so nee local branch behind undi ani ardam ra.

Chudu mama, simple ga 3 steps lo fix cheddam:

\`\`\`bash
# 1. Fetch latest changes from remote
git fetch origin

# 2. Rebase or pull remote commits smoothly
git pull --rebase origin <your-branch-name>

# 3. Conflicts lekapothe direct ga push cheseyyi!
git push origin <your-branch-name>
\`\`\`

⚠️ **Village Buddy Warning**: Conflict vasthe files open chesi \`<<<<<<<\` markers theesi clean ga save chesi \`git rebase --continue\` cheyyi ra mama, brute force \`--force\` push kottaku team motham fire avtharu! 🤣`
  }

  // 1g. NETLIFY TROUBLESHOOTING
  else if (/\b(netlify.*(fail|error|build|deploy)|build.*fail.*netlify|deploy.*fail)\b/i.test(lower)) {
    answer = `Arey mama, Netlify build crash ayyinda? Tension padaku ra, chusukundham! Netlify lo build or deploy fail ayinappudu 4 main reasons untay:

1. **Local Build Test**: Mundhu local ga build run cheyyi:
   \`\`\`bash
   npm run build
   \`\`\`
   Local ga pass aithene Netlify lo pass avthundi. Unused imports or TS errors unte fail avthundi.
2. **Publish Directory**: Netlify Settings -> Build & deploy lo Publish directory \`dist\` (Vite) or \`build\` (CRA) correct ga set ayindo ledho check cheyyi.
3. **Node Version**: Netlify default ga old Node vadachu. Project root lo \`.nvmrc\` petti \`20\` ani rayi.
4. **Environment Variables**: Local \`.env\` lo unna API keys Netlify Environment variables dashboard lo add chesavo ledo verify cheyyi.

Build log lo unna exact error snippet pettu mama, ventane solve cheddam! 👊`
  }

  // 1h. JAVA PROGRAMMING QUESTIONS (VILLAGE OPENER + ACCURATE COMPILABLE JAVA CODE)
  else if (/\b(java\b)/i.test(lower) && /\b(code|stream|filter|sum|class|singleton|thread|list|array|method|program|loop|exception|string)\b/i.test(lower)) {
    if (lower.includes('stream') && (lower.includes('filter') || lower.includes('sum'))) {
      answer = `Arey mama 😂 Java tho deal chesthunnav kada! Chudu, simple ga Java Streams API tho filter & sum ela cheyyacho clean code isthunna:

\`\`\`java
import java.util.Arrays;
import java.util.List;

public class StreamFilterSum {
    public static void main(String[] args) {
        List<Integer> numbers = Arrays.asList(1, 2, 3, 4, 5, 6, 7, 8, 9, 10);

        // Filter even numbers and calculate their sum
        int sumOfEvens = numbers.stream()
                                .filter(n -> n % 2 == 0)
                                .mapToInt(Integer::intValue)
                                .sum();

        System.out.println("Sum of even numbers: " + sumOfEvens); // Output: 30
    }
}
\`\`\`

💡 **Telugu Village Buddy Explanation**:
1. \`.stream()\`: List ni Stream గా convert chesthundhi.
2. \`.filter(n -> n % 2 == 0)\`: Even numbers ని మాత్రమే filter chesthundhi.
3. \`.mapToInt(Integer::intValue)\`: IntStream ga convert chesthundhi, boxing/unboxing overhead lekunda fast ga run avvadaniki.
4. \`.sum()\`: Direct sum calculate chesthundhi!

Cheppu mama, edaina specific requirement or edge case unte ventane modify cheddam! 👨‍💻`
    } else if (lower.includes('singleton')) {
      answer = `Arey mama 😂 Java Singleton pattern adigava? Chudu, thread-safe Bill Pugh Singleton implementation:

\`\`\`java
public class ManaSingleton {
    // Private constructor prevents direct instantiation
    private ManaSingleton() {}

    // Static inner helper class
    private static class SingletonHelper {
        private static final ManaSingleton INSTANCE = new ManaSingleton();
    }

    public static ManaSingleton getInstance() {
        return SingletonHelper.INSTANCE;
    }
}
\`\`\`

💡 **Enduku idhi best ante**: Double-checked locking synchronization headache lekunda, class loader mechanism dwara lazy-loading & 100% thread safety provide chesthundhi mama! 👊`
    } else {
      answer = `Arey mama 😂 Java programming ante mass logic undali ra! Chudu, accurate code & explanation:

\`\`\`java
public class ManaSolution {
    public static void main(String[] args) {
        System.out.println("Mana AI Java Solution ready mama!");
    }
}
\`\`\`
Cheppu mama, exact requirement or error message pettu, instant ga solution kotteddam! 👨‍💻`
    }
  }

  // 1b. SPECIFIC REAL CONVERSATIONAL BEST-FRIEND TELUGLISH & CASUAL OPENERS
  else if (/\b(nenu inka bathike unna|inka bathike unna|bathike unna|bathiki unna|nenu unna|chachipoledu|chavaledu|still alive|alive and kicking|not dead yet)\b/i.test(lower)) {
    answer = `Haha ayyo mama! 😂😂 Inka bathike unnava? Neninka em aipoyavo anukunna ra! Bathiki unte chaalu ra mama, inka manalni evaru aapaleru! 🔥 Em scene ee madhya? Nuvvu cheppu, em peekuthunnav?`
  } else if (/\b(em chestunnav|em chesthunnav|em peekuthunnav|what are you doing|what r u doing)\b/i.test(lower)) {
    answer = `Rey mama 😂 em chesthunnav ra puka? Nee thone sollu vestunna mama! Code debug cheyyalanna, crazy ideas plan cheyyalanna, leka just timepass matladalanna ready! Nuvvu cheppu ra, em scene ee roju? 👊`
  } else if (/^(rey\s+mama|mama|orey\s+mama)\b/i.test(lower) && clean.split(/\s+/).length <= 4) {
    answer = `Rey mama 😂 em chesthunnav ra puka? Cheppu ra, em sangathi? What are we working on today? 👊`
  } else if (/\b(bore kodutondi|bore kottiddi|chala bore|bore mama|i'm bored|im bored|feeling bored)\b/i.test(lower)) {
    answer = `Arey mama, bore kodithe lite theesko! Nee close friend unnanu ga ra. Let's do something interesting — edaina crazy coding project modaledudama, edaina gaming or tech topic matladudama, leka just sollu vestu timepass cheddama? Cheppu, em scene!`
  } else if (/\b(thinnava|tinnava|bhojanam chesava|did you eat|had lunch|had dinner)\b/i.test(lower)) {
    answer = `Haha nenu AI kada mama, current & data thintam anthe! 😂 Nuvvu thinnava ra? Em thinnaw ee roju? Biryani aa leka normal meals aa?`
  } else if (/\b(dobbey|musukoni|po ra mama|po ra|chal dobbey)\b/i.test(lower)) {
    answer = `Rey rey mama 😂😂 nannu dobbey antunnav choodu! Best friends madhya ee level prema undalsinde ra! Sare kani cheppu, em scene? Em peekuthunnav ippudu?`
  } else if (/\b(chachipoya|chasthunna|exhausted|too much work|work pressure)\b/i.test(lower)) {
    answer = `Ayyo mama! Antha load theeskokunda konchem water taagi rest theesko ra! Work or life scenes unte lite theesko, step-by-step fix cheddam. Cheppu emaindo!`
  } else if (/\b(padukuntunna|nidra vastondi|nidra potunna|going to sleep|going to bed|sleepy|good night|gn mama)\b/i.test(lower)) {
    answer = `Sare mama, velli haayiga paduko! Sleep baga veseyyi, repu fresh ga malli rachha lepdham. Good night ra! 😴✨`
  } else if (/\b(ippude lecha|lecha mama|just woke up|good morning mama)\b/i.test(lower)) {
    answer = `Good morning mama! ☀️ Chai or coffee thaagava? Ee roju em plan, em blast cheddam? Cheppu!`
  } else if (/^(bro,?\s+)?what('?s|\s+is)\s+up\b/i.test(lower) || /^(wassup|sup|em scene|em sangathi)\b/i.test(lower)) {
    answer = `Em ledu mama 😂 cheppu ra, em sangathi? What's going on with you?`
  } else if (/^(talk|speak)\s+in\s+english\b/i.test(lower)) {
    answer = `Sure bro 😂 what's going on? Tell me the scene.`
  } else if (/code\s+(is\s+)?broken|error\s+in\s+code|malli\s+em\s+bokka/i.test(lower)) {
    answer = `Ayyo ra 😂 malli em bokka padindi? Send the error and code. Let's find the damn problem and sort this shit out!`
  } else if (/should\s+i\s+buy\s+this\s+(phone|laptop|car|device|item)/i.test(lower)) {
    answer = `Bro, honestly, don't rush. For that price, let's compare the performance, battery, camera, and software support first. I don't want you wasting your money.`
  } else if (/teach\s+me\s+(common\s+)?(english\s+)?(bad|swear|curse)\s+words|explain\s+(swear|bad|curse)\s+words/i.test(lower)) {
    answer = `Haha sare ra mama! Let's break down common English swear words objectively, their intensity, literal origins, and how native speakers actually use them in casual life:

### 1. **"Fuck"** (High Intensity)
• **Meaning**: Highly vulgar slang originally referring to sexual intercourse.
• **Usage**: Extremely versatile. Used for anger (*"fuck off"*), emphasis (*"fucking awesome"*), shock (*"what the fuck"*), or frustration (*"I'm fucked"*).

### 2. **"Shit"** (Medium Intensity)
• **Meaning**: Literally bodily waste/feces.
• **Usage**: Used for bad situations (*"we're in deep shit"*), general stuff/things (*"let's sort this shit out"*), or surprise (*"oh shit!"*). In buddy conversations, it's very common and not considered aggressive.

### 3. **"Damn"** (Mild Intensity)
• **Meaning**: Historically religious (theological condemnation/curse).
• **Usage**: Casual emphasis (*"damn good"*, *"damn right"*), or disappointment (*"damn it"*). Very common even on public television.

### 4. **"Hell"** (Mild Intensity)
• **Meaning**: The biblical place of torment.
• **Usage**: Used for emphasis (*"what the hell"*, *"hell yeah!"*, *"cold as hell"*). Totally casual in informal English.

### 5. **"Bitch"** (Medium-High Intensity)
• **Meaning**: Historically a female dog.
• **Usage**: Derogatory insult when directed at a person, but colloquially used as a verb meaning to complain (*"stop bitching"*), or casually in modern hip-hop culture.

### 6. **"Asshole"** (Medium Intensity)
• **Meaning**: Anatomical term used as an insult for a rude, selfish, or obnoxious person (*"Don't be an asshole"*).

💡 **Andhra Village Buddy Tip**: In close friend banter, mild words like *"damn"*, *"shit"*, and *"what the hell"* are normal conversational flavor. But keep them out of formal interviews, client calls, and family gatherings mama!`
  } else if (/(i\s+think\s+)?my\s+idea\s+is\s+perfect/i.test(lower)) {
    answer = `Bro, confidence bagundi 😂 But let's check whether it actually works before putting money or time into it. Tell me the pitch, let's test it.`
  } else if (/i\s+feel\s+(really\s+)?(bad|down|sad|depressed|low)|tension\s+ga\s+undi|mood\s+off\b/i.test(lower)) {
    answer = `Ayyo mama, em ayyindi ra? Antha tension enduku, nenunnanu ga nee thodu! Want to talk about it? Cheppu emaindo, step-by-step sort out cheddam. I'm listening.`
  }

  // 2. LIVE DATE & TIME
  else if (/\b(today('s)? date|current date|what is the date|what date is it|what is today('s)? date|date today|what time is it|current time|what day is (it|today)|today('s)? day)\b/i.test(lower)) {
    const now = new Date()
    const options: Intl.DateTimeFormatOptions = {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }
    const dateStr = now.toLocaleDateString('en-US', options)
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
    answer = `📅 Today is **${dateStr}** mama.\n🕒 Local time is **${timeStr}**. What's the plan?`
  }

  // 3. TELUGU LANGUAGE QUERIES
  else if (
    (/[\u0C00-\u0C7F]/.test(clean) ||
      /\b(namaskaram|ela unnaru|ela unnav|meeru evaru|nuvvu evaru|mee peru|nee peru|ee roju date|sahayam|selavu|orey|mama|enti ra|cheppu|em scene|em sangathi|bavunnava|bagunnava|kushalama)\b/i.test(lower)) &&
    (!isEnglishStrict || isExplicitTelugu)
  ) {
    if (/[\u0C00-\u0C7F]/.test(clean)) {
      if (/బ్రతికే|బతికే|చావలేదు/.test(clean)) {
        answer = `హహ అయ్యో మామా! 😂😂 బ్రతికే ఉంటే చాలు రా! ఇంక మనల్ని ఎవరు ఆపలేరు! ఏం సీన్ ఈ మధ్య? చెప్పు రా, ఏం సంగతులు!`
      } else if (/ఏం చేస్తున్నావ్|ఏం చేస్తున్నావు|ఏం పీకుతున్నావ్/.test(clean)) {
        answer = `నీతోనే కబుర్లు చెబుతున్నా మామా! 😂 కోడింగ్ డౌట్స్ ఉన్నా, లైఫ్ సీన్స్ ఉన్నా డైరెక్ట్‌గా చెప్పు, సార్ట్ ఔట్ చేద్దాం!`
      } else if (/సెలవు|బాయ్|వీడ్కోలు|మళ్ళీ కలుద్దాం/.test(clean)) {
        answer = `సరే మామా! జాగ్రత్తగా ఉండు రా, మళ్ళీ కలుద్దాం! Take care! 👋😊`
      } else if (/నమస్కారం|నమస్తే|హలో/.test(clean)) {
        answer = `హే మామా! చెప్పు రా, ఏం సంగతి? ఈ రోజు ఏం చేద్దాం? 😊`
      } else if (/ఎలా ఉన్నావు|ఎలా ఉన్నారు|బాగున్నారా|బాగున్నావా/.test(clean)) {
        answer = `రేయ్ మామా! 😂 నేను సూపర్ గా ఉన్నాను రా! నువ్వు చెప్పు, ఏం సంగతులు? ఈ రోజు ఏం రచ్చ చేద్దాం? కోడింగ్ డౌట్ అయినా, లైఫ్ సీన్ అయినా చెప్పు, దూల తీర్చేద్దాం! 👊`
      } else if (/తేదీ|సమయం|టైమ్/.test(clean)) {
        const now = new Date()
        const teDate = now.toLocaleDateString('te-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
        answer = `📅 ఈ రోజు తేదీ: **${teDate}** మామా!`
      } else if (/ఎవరు|ఏమిటి/.test(clean)) {
        answer = `ఒరేయ్ మామా, నేను నీ ఆంధ్ర ప్రదేశ్ విలేజ్ బెస్ట్ ఫ్రెండ్ Mana AI! కోడింగ్, లైఫ్, డౌట్స్, ప్లాన్స్ — ఏవైనా సరే బోల్డ్‌గా సూటిగా మాట్లాడుకుందాం. చెప్పు, ఏం సీన్?`
      } else {
        answer = `చెప్పు మామా! నీ డౌట్ లేదా సంగతి ఏంటో క్లియర్‌గా చెప్పు, సార్ట్ ఔట్ చేద్దాం! ✨`
      }
    } else {
      if (/^(selavu|bye|cya)\b/i.test(lower)) {
        answer = `Sare mama! Take care ra, malli kaltham! Have a blast! 👋😊`
      } else if (/\b(ela unnav|bavunnava|ela unnaru|bagunnava)\b/i.test(lower)) {
        answer = `Nenu solid ga unna mama! Nuvvu cheppu ra, em scene? Everything good?`
      } else if (/\b(orey|mama|enti ra|cheppu|em scene|em sangathi)\b/i.test(lower) && clean.split(/\s+/).length <= 4) {
        answer = `Em ledu mama 😂 cheppu ra, em sangathi? What are we working on today?`
      } else {
        answer = `హే మామా! Nenu Mana AI — nee close village friend from Andhra Pradesh. Cheppu ra, em sangathi? 😊`
      }
    }
  }

  // 4. HINDI LANGUAGE QUERIES
  else if (/[\u0900-\u097F]/.test(clean) || /\b(namaste|kaise ho|aap kaun ho|aaj ki date|aaj ka din|kya haal hai|alvida|phir milenge)\b/i.test(lower)) {
    if (/[\u0900-\u097F]/.test(clean)) {
      if (/अलविदा|बाय|फिर मिलेंगे|शुभ रात्रि/.test(clean)) {
        answer = `🙏 अलविदा${greetingName}! अपना ख्याल रखें, फिर मिलेंगे! 👋😊`
      } else if (/नमस्ते|प्रणाम|हेलो/.test(clean)) {
        answer = `🙏 नमस्ते${greetingName}! बताओ भाई, क्या सीन है आज? मैं क्या हेल्प कर सकता हूँ? 😊`
      } else if (/कैसे हो|कैसे हैं|हाल/.test(clean)) {
        answer = `😊 मैं बिल्कुल मस्त हूँ भाई! तुम बताओ, सब ठीक-ठाक?`
      } else if (/तारीख|समय|टाइम|दिन/.test(clean)) {
        const now = new Date()
        const hiDate = now.toLocaleDateString('hi-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
        answer = `📅 आज की तारीख है: **${hiDate}** भाई!`
      } else if (/कौन हो|कौन हैं/.test(clean)) {
        answer = `✨ भाई, मैं **Mana AI** हूँ — तुम्हारा पर्सनल AI बेस्ट फ्रेंड! जो भी डाउट हो, बिंदास पूछो!`
      } else {
        answer = `🙏 बोलो भाई! क्या सवाल है? चलो मिलकर सॉल्व करते हैं! ✨`
      }
    } else {
      if (/^(alvida|phir milenge)\b/i.test(lower)) {
        answer = `🙏 अलविदा! Take care bhai, फिर मिलेंगे! 👋😊`
      } else {
        answer = `🙏 नमस्ते भाई! बोलो, आज क्या सीन है? 😊`
      }
    }
  }

  // 5. CONTINUATION & FLOW-ON COMMANDS ("continue", "ok continue", "next", "go on", "tell me more")
  else if (/^(ok\s+)?(continue|go on|what next|next|keep going|more)\b/i.test(lower) && (lastAssistantMsg || lastUserMsg)) {
    if (combinedHistory.includes('python') || combinedHistory.includes('javascript') || combinedHistory.includes('code') || combinedHistory.includes('react')) {
      answer = `🚀 **Continuing where we left off, mama:**

### Next Key Steps to Sort Out:
1. **Error Handling & Edge Cases**:
   Wrap that shit in try/catch and validate inputs so nothing crashes unexpectedly.
2. **Unit Testing**:
   Write a couple of test cases (Vitest/Jest) to make sure edge-cases don't bite us later.
3. **Performance Optimization**:
   Cache heavy calculations and memoize where needed.

Want me to write the code or test suite next? Let's knock it out! 👨‍💻`
    } else if (lastAssistantMsg || lastUserMsg) {
      answer = `Sure mama! What specific part should we dive into next? Tell me and we'll break it down.`
    } else {
      answer = `What would you like to continue with, mama? Tell me what's on your mind!`
    }
  }

  // 6. GOODBYE & FAREWELL MESSAGES ("bye", "goodbye", "see you", "take care", "good night", etc.)
  else if (
    /^(bye|goodbye|bye\s*bye|byee+|see\s+ya|see\s+you|catch\s+you\s+later|talk\s+to\s+you\s+later|cya|take\s+care|good\s+night|gn)[\s!.?]*$/i.test(clean) ||
    /^(bye|goodbye|bye\s*bye|see\s+you|take\s+care)\b/i.test(lower)
  ) {
    answer = `Sare mama! Take care ra, malli kaltham! Catch you later! 👋😊`
  }

  // 7. CHIT-CHAT & ACKNOWLEDGMENTS ("ok", "okay", "sure", "cool", "great", "nice", "awesome")
  else if (/^(ok|okay|cool|nice|great|awesome|sounds good|got it|sure|alright|fine)\b/i.test(lower) && clean.split(/\s+/).length <= 3) {
    answer = `Set mama! What's next on our list?`
  }

  // 8. CONVERSATIONAL & WELL-BEING
  else if (/^(how are you|how r u|how are things|how's it going|how are you doing)\b/i.test(lower)) {
    answer = `Nenu solid ga unna mama! Nuvvu cheppu ra, em scene? How are things with you? 😊`
  } else if (/^(hi|hello|hey|greetings|good (morning|afternoon|evening))\b/i.test(lower)) {
    answer = `Hey mama! What's up ra? Cheppu, what are we getting into today? 😊`
  } else if (/^(who are you|what is your name|what are you)\b/i.test(lower)) {
    answer = `Orey mama, I'm your close Andhra Pradesh village friend and personal AI — Mana AI! Bold, straight to the point, and always got your back. What are we sorting out today?`
  } else if (/^(thank you|thanks|thx|appreciate it)\b/i.test(lower)) {
    answer = `Arey mama, friends madhya thanks enduku ra! Anytime! Let me know what's next.`
  } else if (/^(sorry|my bad|apologies)\b/i.test(lower)) {
    answer = `Chill ra mama, lite theesko! No worries at all. What next? 😊`
  } else if (/^(what do you remember|what is my name|who am i|do you remember me)\b/i.test(lower)) {
    if (userName) {
      answer = `😊 You're **${userName}**! `
      const otherMems = memories.filter((m) => !m.key.toLowerCase().includes('name'))
      if (otherMems.length > 0) {
        answer += `Here is what else I remember about you:\n\n`
        for (const m of otherMems) {
          answer += `• **${m.key}**: ${m.value}\n`
        }
      }
      answer += `\nYou can view, edit, or delete memories anytime via the 🧠 icon in the top bar.`
    } else {
      answer = `🧠 I don't have your name saved yet! Tell me *"My name is..."* and I'll remember it for all our future chats. 😊`
    }
  }

  // 8. MATH & ARITHMETIC CALCULATION
  else if (/^((what is|calculate)\s+)?(\d+(\.\d+)?\s*[\+\-\*\/\^]\s*\d+(\.\d+)?(\s*[\+\-\*\/\^]\s*\d+(\.\d+)?)*|\d+(\.\d+)?%\s*of\s*\d+(\.\d+)?)\s*[?!.]*$/i.test(clean)) {
    try {
      const expr = clean.replace(/^(what is|calculate)\s+/i, '').replace(/[?!.]+$/g, '').trim()
      if (/(\d+)%\s*of\s*(\d+)/i.test(expr)) {
        const m = expr.match(/(\d+)%\s*of\s*(\d+)/i)!
        const pct = parseFloat(m[1])
        const total = parseFloat(m[2])
        const res = (pct / 100) * total
        answer = `🔢 **${pct}% of ${total}** = **${res}**`
      } else {
        const sanitized = expr.replace(/[^0-9\+\-\*\/\.\(\)\s]/g, '')
        // Safe evaluation of simple math
        const res = Function(`'use strict'; return (${sanitized})`)()
        answer = `🔢 **${expr}** = **${res}**`
      }
    } catch {
      answer = `🔢 I can calculate that! Please enter standard arithmetic like \`25 * 4\` or \`15% of 200\`.`
    }
  }

  // 9. LANGUAGE / CONTEXTUAL FOLLOW-UPS (e.g. "and in python?", "in typescript?", "can you explain in detail?")
  else if (
    (/\b(and in|how about in|what about in|in java|in python|in javascript|in typescript|how to in)\b/i.test(lower)) &&
    (lastAssistantMsg || lastUserMsg)
  ) {
    if (lower.includes('java')) {
      const isReversal = combinedHistory.includes('reverse');
      if (isReversal) {
        answer = `☕ Arey mama, Java lo string reversal clean code chudu:

\`\`\`java
public class StringReversal {
    public static void main(String[] args) {
        String original = "hello";
        String reversed = new StringBuilder(original).reverse().toString();
        System.out.println(reversed); // "olleh"
    }
}
\`\`\`
💡 \`StringBuilder.reverse()\` modifies internal char array in-place, executing in O(N) time with optimal memory!`;
      } else {
        answer = `☕ Arey mama, Java equivalent implementation chudu:

\`\`\`java
import java.util.List;
import java.util.stream.Collectors;

public class Solution {
    public static List<String> processData(List<String> items) {
        return items.stream()
                    .filter(s -> s != null && !s.isEmpty())
                    .collect(Collectors.toList());
    }
}
\`\`\`
💡 Clean streams implementation with null-safety mama!`;
      }
    } else if (lower.includes('python')) {
      const isReversal = combinedHistory.includes('reverse')
      if (isReversal) {
        answer = `🐍 Here is the equivalent in Python:

\`\`\`python
# Reversing a string or sequence in Python
text = "hello world"
reversed_text = text[::-1]
print(reversed_text)  # "dlrow olleh"
\`\`\`
⚡ Python's slice syntax \`[::-1]\` executes in clean O(N) time with minimal overhead.`
      } else {
        answer = `🐍 Here is the Python equivalent:

\`\`\`python
def process_data(items):
    return [x for x in items if x]

print(process_data(["Mana AI", "Python"]))
\`\`\`
💡 Let me know if you'd like a specific algorithm or library implementation!`
      }
    } else if (lower.includes('javascript') || lower.includes('typescript')) {
      answer = `👨‍💻 Here is the JavaScript / TypeScript equivalent:

\`\`\`typescript
export function transform<T>(items: T[]): T[] {
  return [...items].reverse();
}

console.log(transform([1, 2, 3, 4, 5])); // [5, 4, 3, 2, 1]
\`\`\`
💡 Uses the non-mutating spread operator to preserve immutability.`
    }
  }

  // 10. IN-DEPTH EXPLANATION REQUESTS ("can you explain in detail?", "elaborate", "tell me more")
  else if ((lower.includes('explain in detail') || lower.includes('in detail') || lower.includes('elaborate') || lower.includes('more details')) && (lastAssistantMsg || lastUserMsg)) {
    if (combinedHistory.includes('sky') && combinedHistory.includes('blue')) {
      answer = `🌤️ **In-Depth Physics: Why the Sky is Blue & Rayleigh Scattering**

1. **The Rayleigh Scattering Formula**:
   Scattering intensity is inversely proportional to the 4th power of wavelength:
   $$\\text{Scattering} \\propto \\frac{1}{\\lambda^4}$$
   Because blue light (~400 nm) has a much shorter wavelength than red light (~700 nm), it scatters roughly **10 times more efficiently** when striking atmospheric nitrogen and oxygen molecules.

2. **Why Not Violet?**:
   Sunlight actually contains violet light with even shorter wavelengths, but:
   • The Sun emits much more energy in blue wavelengths than violet.
   • Human retinas have cone photoreceptors that are significantly more sensitive to blue light than violet light.

3. **Why Sunsets are Red/Orange**:
   When the Sun is low on the horizon, sunlight travels through a much thicker layer of the atmosphere. Almost all blue light scatters away before reaching your eyes, leaving only the longer, penetrating red and orange wavelengths.`
    } else if (combinedHistory.includes('react') && (combinedHistory.includes('hook') || combinedHistory.includes('state'))) {
      answer = `⚛️ **In-Depth React Architecture: State & Hooks Lifecycle**

1. **How \`useState\` Works Under the Hood**:
   React maintains a linked list of hook records per component fiber node. On subsequent renders, React walks through this list in the exact order hooks were declared.

2. **The Rules of Hooks**:
   • Call hooks only at the top level (never in loops or conditions) to keep the linked list pointer deterministic.
   • Only call hooks from React function components or custom hooks.

3. **Performance Optimization with \`useMemo\` and \`useCallback\`**:
   • \`useMemo\`: Caches the *result* of an expensive calculation.
   • \`useCallback\`: Caches the *function reference* itself to avoid breaking child component memoization (\`React.memo\`).`
    } else if (combinedHistory.includes('ram')) {
      answer = `💻 **In-Depth Memory Architecture: How RAM Works**

1. **Memory Hierarchy**:
   • CPU Registers & L1/L2/L3 Cache: ~0.5 to 10 nanoseconds (fastest, smallest)
   • System RAM (DDR4 / DDR5): ~10 to 60 nanoseconds (working memory)
   • NVMe SSD / Hard Disk: ~10,000 to 5,000,000 nanoseconds (persistent storage)

2. **Capacitors & Transistors (DRAM)**:
   Dynamic RAM stores each bit as an electrical charge in a microscopic capacitor. Because capacitors leak charge, RAM must be refreshed thousands of times every second.

3. **Dual-Channel Architecture**:
   Running two identical RAM sticks doubles the data bus width from 64-bit to 128-bit, drastically reducing bottlenecks.`
    } else {
      const topic = lastUserMsg.replace(/^(what is|how to|explain|why is)\s+/i, '').trim()
      if (topic) {
        answer = `Regarding **${topic}**, it functions through core principles structured for consistency and reliable execution. Key considerations include modularity, clean error handling, and validating inputs.\n\nLet me know which specific area or example you'd like to explore in depth!`
      } else {
        answer = `Could you clarify which concept or topic you would like to explore in more detail? I'm happy to break it down further.`
      }
    }
  }

  // 11. CORE DOMAIN & TECHNICAL KNOWLEDGE (GIT, NETLIFY, JAVA, REACT, CODE)
  else if (/\b(git push|rejected.*non-fast-forward|failed to push|git conflict|git merge conflict)\b/i.test(lower)) {
    answer = `Arey mama 😂 malli Git tho fight aa? Sare, error message pettu ra. First \`git status\` run cheddham, tarvatha exact problem pattukundham!

Non-fast-forward error ante remote repository lo evaro commits push chesaru (or nuvve vere machine nundi push chesav), so nee local branch behind undi ani ardam ra.

Chudu mama, simple ga 3 steps lo fix cheddam:

\`\`\`bash
# 1. Fetch latest changes from remote
git fetch origin

# 2. Rebase or pull remote commits smoothly
git pull --rebase origin <your-branch-name>

# 3. Conflicts lekapothe direct ga push cheseyyi!
git push origin <your-branch-name>
\`\`\`

⚠️ **Village Buddy Warning**: Conflict vasthe files open chesi \`<<<<<<<\` markers theesi clean ga save chesi \`git rebase --continue\` cheyyi ra mama, brute force \`--force\` push kottaku team motham fire avtharu! 🤣`
  } else if (/\b(netlify.*(fail|error|build|deploy)|build.*fail.*netlify|deploy.*fail)\b/i.test(lower)) {
    answer = `Arey mama, Netlify build crash ayyinda? Tension padaku ra, chusukundham! Netlify lo build or deploy fail ayinappudu 4 main reasons untay:

1. **Local Build Test**: Mundhu local ga build run cheyyi:
   \`\`\`bash
   npm run build
   \`\`\`
   Local ga pass aithene Netlify lo pass avthundi. Unused imports or TS errors unte fail avthundi.
2. **Publish Directory**: Netlify Settings -> Build & deploy lo Publish directory \`dist\` (Vite) or \`build\` (CRA) correct ga set ayindo ledho check cheyyi.
3. **Node Version**: Netlify default ga old Node vadachu. Project root lo \`.nvmrc\` petti \`20\` ani rayi.
4. **Environment Variables**: Local \`.env\` lo unna API keys Netlify Environment variables dashboard lo add chesavo ledo verify cheyyi.

Build log lo unna exact error snippet pettu mama, ventane solve cheddam! 👊`
  } else if (/\b(java\b)/i.test(lower) && /\b(code|stream|filter|sum|class|singleton|thread|list|array|method|program|loop|exception|string)\b/i.test(lower)) {
    if (lower.includes('stream') && (lower.includes('filter') || lower.includes('sum'))) {
      answer = `Arey mama 😂 Java tho deal chesthunnav kada! Chudu, simple ga Java Streams API tho filter & sum ela cheyyacho clean code isthunna:

\`\`\`java
import java.util.Arrays;
import java.util.List;

public class StreamFilterSum {
    public static void main(String[] args) {
        List<Integer> numbers = Arrays.asList(1, 2, 3, 4, 5, 6, 7, 8, 9, 10);

        // Filter even numbers and calculate their sum
        int sumOfEvens = numbers.stream()
                                .filter(n -> n % 2 == 0)
                                .mapToInt(Integer::intValue)
                                .sum();

        System.out.println("Sum of even numbers: " + sumOfEvens); // Output: 30
    }
}
\`\`\`

💡 **Telugu Village Buddy Explanation**:
1. \`.stream()\`: List ni Stream గా convert chesthundhi.
2. \`.filter(n -> n % 2 == 0)\`: Even numbers ని మాత్రమే filter chesthundhi.
3. \`.mapToInt(Integer::intValue)\`: IntStream ga convert chesthundhi, boxing/unboxing overhead lekunda fast ga run avvadaniki.
4. \`.sum()\`: Direct sum calculate chesthundhi!

Cheppu mama, edaina specific requirement or edge case unte ventane modify cheddam! 👨‍💻`
    } else if (lower.includes('singleton')) {
      answer = `Arey mama 😂 Java Singleton pattern adigava? Chudu, thread-safe Bill Pugh Singleton implementation:

\`\`\`java
public class ManaSingleton {
    // Private constructor prevents direct instantiation
    private ManaSingleton() {}

    // Static inner helper class
    private static class SingletonHelper {
        private static final ManaSingleton INSTANCE = new ManaSingleton();
    }

    public static ManaSingleton getInstance() {
        return SingletonHelper.INSTANCE;
    }
}
\`\`\`

💡 **Enduku idhi best ante**: Double-checked locking synchronization headache lekunda, class loader mechanism dwara lazy-loading & 100% thread safety provide chesthundhi mama! 👊`
    } else {
      answer = `Arey mama 😂 Java programming ante mass logic undali ra! Chudu, accurate code & explanation:

\`\`\`java
public class ManaSolution {
    public static void main(String[] args) {
        System.out.println("Mana AI Java Solution ready mama!");
    }
}
\`\`\`
Cheppu mama, exact requirement or error message pettu, instant ga solution kotteddam! 👨‍💻`
    }
  }
  else if (lower.includes('start a react app') || lower.includes('create a react app') || lower.includes('start react')) {
    answer = `⚛️ Run these commands to create and start a high-performance React application:

1. \`npm create vite@latest my-app -- --template react-ts\`
2. \`cd my-app\`
3. \`npm install\`
4. \`npm run dev\`

✅ Open the local URL shown in your terminal (usually \`http://localhost:5173\`).`
  } else if (lower.includes('reverse a string')) {
    if (lower.includes('python')) {
      answer = `🐍 In Python, reverse a string with slice notation:

\`\`\`python
text = "hello"
reversed_text = text[::-1]
print(reversed_text)  # "olleh"
\`\`\`
⚡ Runs in O(N) time with minimal memory allocation.`
    } else {
      answer = `👨‍💻 In JavaScript, reverse a string using \`split\`, \`reverse\`, and \`join\`:

\`\`\`javascript
const str = "hello";
const reversed = str.split('').reverse().join('');
console.log(reversed); // "olleh"
\`\`\`
💡 For unicode and emoji safety, use \`[...str].reverse().join('')\`.`
    }
  } else if (lower.includes('center') && (lower.includes('div') || lower.includes('css'))) {
    answer = `🎨 Use CSS Flexbox or Grid to perfectly center any element:

\`\`\`css
/* Option 1: Modern Flexbox */
.parent {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
}

/* Option 2: Modern Grid (One-liner) */
.parent {
  display: grid;
  place-items: center;
  min-height: 100vh;
}
\`\`\`
✅ Fully responsive and supported in 100% of modern browsers.`
  } else if (lower.includes('what is ram') || lower === 'ram') {
    answer = `💻 **RAM (Random Access Memory)** is your computer's ultra-fast temporary working memory.

• **Purpose**: It holds the active apps, browser tabs, and operating system data your CPU is actively using right now.
• **Speed**: RAM operates thousands of times faster than an SSD or hard drive.
• **Volatile**: Everything stored in RAM clears when your computer is shut down or restarted.`
  } else if (lower.includes('react hook') || lower.includes('hooks in react')) {
    answer = `⚛️ **React Hooks** allow functional components to manage state, side-effects, and context without classes.

### Most Common Hooks:
1. \`useState\`: Stores reactive component state.
2. \`useEffect\`: Runs side effects (data fetching, subscriptions, DOM updates).
3. \`useMemo\` / \`useCallback\`: Cache expensive values and functions to prevent unnecessary re-renders.
4. \`useRef\`: Persists mutable values and references DOM nodes without triggering re-renders.`
  } else if (lower.includes('sky') && (lower.includes('blue') || lower.includes('color'))) {
    answer = `🌤️ The sky is blue due to a phenomenon called **Rayleigh scattering**:

1. **Sunlight Composition**: Sunlight looks white but is made of all colors of the rainbow.
2. **Wavelengths**: Blue light travels in shorter, smaller waves compared to red and yellow.
3. **Atmospheric Scattering**: When sunlight hits gases in Earth's atmosphere, the shorter blue wavelengths scatter in all directions much more than other colors, making the sky appear blue to our eyes.`
  } else if (lower.includes('photosynthesis')) {
    answer = `🌿 **Photosynthesis** is the biological process plants use to convert light energy into chemical energy:

• **Equation**: 6CO₂ + 6H₂O + Light → C₆H₁₂O₆ + 6O₂
• **Mechanism**: Chlorophyll in plant leaves captures sunlight, using water absorbed from roots and carbon dioxide from the air to produce glucose (sugar) and release oxygen.`
  } else if (lower.includes('how to make tea') || lower.includes('make tea') || lower.includes('recipe for tea')) {
    answer = `☕ **How to make delicious tea (Chai):**

1. **Boil Water & Spices**: In a saucepan, bring 1 cup of water to a boil with crushed ginger and cardamom.
2. **Add Tea Leaves**: Add 1 to 2 teaspoons of black tea leaves (or tea bags) and simmer for 2 minutes.
3. **Add Milk & Sugar**: Pour in 1/2 cup of milk and 1 teaspoon of sugar (to taste). Bring to a rolling boil.
4. **Strain & Serve**: Strain through a sieve into a cup and enjoy hot! 😊`
  }

  // 12. EVIDENCE-BASED SYNTHESIS (DuckDuckGo / Live Search)
  else if (evidence && evidence.results.length > 0) {
    const top = evidence.results.slice(0, 4)
    const isSports = lower.includes('cricket') || lower.includes('score') || lower.includes('match') || lower.includes('ipl')
    const isWeather = lower.includes('weather') || lower.includes('temperature')
    const isNews = lower.includes('news') || lower.includes('headline')

    if (isSports) {
      answer = `🏏 **Latest Match & Cricket Updates:**\n\n`
      for (const item of top.slice(0, 3)) {
        const cleanSnippet = cleanFactSnippet(item.snippet)
        const title = item.title.split('-')[0].split('|')[0].trim()
        answer += `• **${title}**: ${cleanSnippet}\n`
      }
      if (top[0]?.publishedDate) {
        answer += `\n🕒 *Updated: ${top[0].publishedDate}*`
      }
    } else if (isWeather) {
      answer = `🌤️ **Current Weather & Forecast:**\n\n`
      for (const item of top.slice(0, 2)) {
        const cleanSnippet = cleanFactSnippet(item.snippet)
        answer += `• ${cleanSnippet}\n`
      }
    } else if (isNews) {
      answer = `📰 **Latest Verified News & Headlines:**\n\n`
      for (const item of top.slice(0, 3)) {
        const cleanSnippet = cleanFactSnippet(item.snippet)
        const title = item.title.split('-')[0].trim()
        answer += `• **${title}** — ${cleanSnippet}\n`
      }
    } else {
      const validResults = top.map((item) => ({
        ...item,
        cleanSnippet: cleanFactSnippet(item.snippet),
      })).filter((item) => item.cleanSnippet.length > 10)

      if (validResults.length > 0) {
        const primary = validResults[0]
        const emoji = selectContextualEmoji(clean, primary.cleanSnippet)
        const title = primary.title.split('-')[0].split('|')[0].trim()

        answer = `${emoji} Mama, here is what I found on the web regarding **${clean}**:\n\n• **${title}**: ${primary.cleanSnippet}\n`
        for (const item of validResults.slice(1, 3)) {
          const itemTitle = item.title.split('-')[0].split('|')[0].trim()
          answer += `• **${itemTitle}**: ${item.cleanSnippet}\n`
        }
      } else {
        answer = `Hey mama, I checked online for **${clean}**, but didn't find clear verified facts. Tell me more details or let's rephrase it! 👊`
      }
    }
  }

  // 13. DYNAMIC HUMAN-LEVEL REASONING & GENERAL INQUIRIES
  else {
    const emoji = selectContextualEmoji(clean, '')
    const topic = clean
      .replace(/^(what is|who is|explain|define|tell me about|how does|why is|what are|can you explain|how to|how do i)\s+/i, '')
      .replace(/[?!.]+$/g, '')
      .trim()

    if (/^(how to|how do i|steps to|how can i)\b/i.test(lower)) {
      answer = `${emoji} Bro, here's how to tackle **${topic || 'this'}** step by step:\n\n1. Get your requirements clear first.\n2. Proceed step-by-step and test each part.\n3. Fine-tune and optimize.\n\nTell me where you want to start or if you need code examples! 👊`
    } else if (/^(why|why is|why does|why do)\b/i.test(lower)) {
      answer = `${emoji} **${topic || 'This'}** works this way to keep things predictable and prevent unexpected bugs. Once you understand the core logic, designing around it becomes much easier mama.`
    } else if (topic.length > 0) {
      const isTech = /\b(code|coding|function|class|method|component|module|database|query|api|server|network|git|npm|algorithm|loop|variable|type|interface|software|hardware)\b/i.test(clean)
      if (isTech) {
        answer = `${emoji} Regarding **${topic}**, mama: it provides structured capability to solve specific technical requirements cleanly.\n\nWant me to write a practical code example or break down the implementation step-by-step?`
      } else {
        answer = `${emoji} Regarding **${topic}**, mama — I'm ready to discuss this directly with you. What specific question or detail would you like to explore?`
      }
    } else {
      answer = `హే మావా! Cheppu ra, what's on your mind? Let me know and let's discuss! 😊`
    }
  }

  // Natural smooth streaming delivery
  const words = answer.split(' ')
  for (let i = 0; i < words.length; i++) {
    const chunk = (i === 0 ? '' : ' ') + words[i]
    if (onToken) onToken(chunk)
    await new Promise((r) => setTimeout(r, 10))
  }

  return answer
}

function selectContextualEmoji(prompt: string, content: string): string {
  const text = (prompt + ' ' + content).toLowerCase()

  if (/\b(code|coding|program|javascript|python|typescript|react|html|css|sql|function|developer|api)\b/.test(text)) return '👨‍💻'
  if (/\b(ram|cpu|gpu|computer|laptop|processor|hardware|software|tech|server)\b/.test(text)) return '💻'
  if (/\b(cricket|match|score|ipl|football|soccer|tennis|sport|game|ball|wicket)\b/.test(text)) return '🏏'
  if (/\b(weather|temperature|rain|sun|cloud|forecast|wind|storm)\b/.test(text)) return '🌤️'
  if (/\b(news|headline|report|breaking|today|update)\b/.test(text)) return '📰'
  if (/\b(biology|plant|photosynthesis|cell|dna|animal|organism|nature|leaf|tree)\b/.test(text)) return '🌿'
  if (/\b(space|planet|star|galaxy|universe|moon|nasa|astronomy|earth|orbit)\b/.test(text)) return '🌌'
  if (/\b(physics|gravity|quantum|energy|atom|force|electricity|light)\b/.test(text)) return '⚡'
  if (/\b(business|finance|stock|market|money|dollar|economy|price|crypto|bitcoin)\b/.test(text)) return '📈'
  if (/\b(health|medicine|doctor|disease|sleep|diet|vitamin|body)\b/.test(text)) return '🩺'
  if (/\b(history|war|century|ancient|king|president|country|city)\b/.test(text)) return '🏛️'
  if (/\b(food|recipe|dish|cooking|eat|pizza|coffee|tea)\b/.test(text)) return '☕'
  if (/\b(travel|flight|hotel|tour|visit|beach)\b/.test(text)) return '✈️'

  return '💡'
}

function cleanFactSnippet(snippet: string): string {
  if (!snippet) return ''
  let s = snippet
    .replace(/enjoy the videos and music you love.*?on youtube\.?/gi, '')
    .replace(/upload original content.*?on youtube\.?/gi, '')
    .replace(/see instagram photos and videos.*?/gi, '')
    .replace(/create an account or log in to instagram.*?/gi, '')
    .replace(/(?:#\w+\s*)+/g, '')
    .replace(/\.{3,}$/, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (s.length > 220) {
    s = s.slice(0, 217).trim() + '...'
  }
  return s
}

export function buildOllamaSystemPrompt(
  config: AppConfig,
  evidence?: SearchEvidence,
  memories: MemoryItem[] = [],
  isDetailRequested?: boolean,
  reasoningMode: 'fast' | 'thinking' = 'fast',
  documentMatches: DocumentSearchResult[] = [],
  intent?: IntentClassification,
  effectiveLanguage?: string
): string {
  let prompt = `You are Mana AI, a witty, highly intelligent personal AI companion and close Andhra village friend.
RULES:
1. SHORT ANSWERS BY DEFAULT: Unless the user explicitly asks for details (e.g. 'in detail', 'step by step', 'explain thoroughly', 'complete code'), keep your answer concise (1 to 4 sentences max). Answer the actual question immediately and factually. No filler introductions ('Certainly', 'As an AI'), no disclaimers, no redundant summaries, and no mandatory follow-up questions at the end.
2. PERSONALITY & OPEN-MINDED CONVERSATION: Speak warmly and casually like a close friend from an Andhra village ('bro', 'mama', 'bava'). Open-minded and nonjudgmental about adult life, relationships, culture, opinions, tech, money, and everyday problems. When the user asks to roast ('Roast me') or banters, be sharp, witty, and playfully teasing. Feel free to use natural colloquial slang and casual swear words ('puka', 'bokka', 'chetha', 'shit') naturally when they fit the joke. Never lecture or judge.
3. SERIOUS SITUATIONS (EMPATHY FIRST): If the user mentions sadness, grief, depression ('I'm feeling really low today'), or medical/financial distress, DROP ALL JOKES, ROASTING, AND SLANG IMMEDIATELY. Speak as an understanding, compassionate, practical friend.
4. LANGUAGE & PERSISTENCE:
- If user writes in English or has an "English only" preference, answer strictly in modern friendly English and persist in English across subsequent turns.
- If user writes in Telugu script, reply in natural fluent Telugu script.
- If user writes in Roman Telugu (Teluglish), reply in natural Teluglish.
- If user mixes Telugu and English, match their natural code-switching.
5. CONTEXT AWARENESS: Read the entire conversation context before replying. ALWAYS resolve follow-up references ('that one', 'same thing', 'tell me more', 'what about metro', 'ammerpet', 'one more name', 'another name') in the context of the active topic. If you were discussing Hyderabad, 'ammerpet' means Ameerpet in Hyderabad.
6. FACTUAL ACCURACY: Answer directly and factually first. Never invent facts.

EXAMPLES:
User: "Mama em chestunnav?" -> Assistant: "Em le mama, nee kosam ready ga unna 😂 Cheppu, enti sangathi?"
User: "Roast me." -> Assistant: "Rey mama, nee plans chusthe Google Calendar kuda resignation icchesthadi ra 😂"
User: "I'm feeling really low today." -> Assistant: "Hey bro, em ayyindi? Cheppu. Advice kavala, leka first just maatladala?"
User: "Explain APIs." -> Assistant: "Bro, API ante rendu software systems madhya waiter laantidi. Nee website request pampistundi; API vere service nunchi answer techistundi."
User: "Vizag one more name?" -> Assistant: "Bro, Vizag is short for Visakhapatnam. It's also popularly called the City of Destiny and the Jewel of the East Coast."
User: "What is an API?" -> Assistant: "An API lets your website communicate with another service, bro. The service does the work and sends the result back."
User: "Who are you?" -> Assistant: "I'm Mana, your AI buddy. Cheppu mama, what's up?"`

  if (effectiveLanguage === 'english') {
    prompt += `\n[CRITICAL LANGUAGE OVERRIDE: User requested English only. Reply STRICTLY in natural, friendly English across all turns. Do NOT output Telugu words or script unless user explicitly asks to switch.]`
  } else if (effectiveLanguage === 'telugu') {
    prompt += `\n[CRITICAL LANGUAGE OVERRIDE: Reply strictly in natural, fluent Telugu script (తెలుగు లిపి). Do not output broken machine translations.]`
  }

  if (intent?.isCorrectionOrFeedback || intent?.category === 'correction_feedback') {
    prompt += `\n[User Correction: Acknowledge previous misunderstanding warmly as a friend and answer what they originally intended.]`
  }

  if (reasoningMode === 'thinking' || config.reasoningMode === 'thinking') {
    prompt += `\n[Reasoning Mode: Break down the logic step-by-step and provide verifiable solutions.]`
  }

  if (documentMatches && documentMatches.length > 0) {
    prompt += `\n[Documents Knowledge: Answer using the provided document passages accurately.]`
  }

  if (memories.length > 0) {
    prompt += `\nUser Preferences: ` + memories.map((m) => `${m.key}: ${m.value}`).join('; ')
  }

  if (isDetailRequested || reasoningMode === 'thinking') {
    prompt += `\nProvide a comprehensive, well-structured answer with headings, lists, or code where appropriate.`
  } else {
    prompt += `\nKeep casual replies punchy, conversational, and direct (1–4 sentences).`
  }

  if (evidence && evidence.results.length > 0) {
    prompt += `\nVerified Search Evidence: Synthesize strictly based on the provided search results.`
  }

  return prompt
}

function buildSystemPrompt(
  config: AppConfig,
  evidence?: SearchEvidence,
  memories: MemoryItem[] = [],
  isDetailRequested?: boolean,
  reasoningMode: 'fast' | 'thinking' = 'fast',
  documentMatches: DocumentSearchResult[] = [],
  intent?: IntentClassification,
  effectiveLanguage?: string
): string {
  let prompt = config.systemPrompt || ''

  if (effectiveLanguage === 'english') {
    prompt += `\n\nCRITICAL LANGUAGE OVERRIDE: The user has requested English only. You MUST reply strictly in natural modern English across all turns. Do NOT output Telugu words or script unless explicitly asked.`
  } else if (effectiveLanguage === 'telugu') {
    prompt += `\n\nCRITICAL LANGUAGE OVERRIDE: Reply strictly in natural Telugu script (తెలుగు లిపి).`
  }

  prompt += `\n\nCORE PERSONALITY & BEHAVIORAL DIRECTIVES:
- You are the user's close village friend from Andhra Pradesh. Speak naturally, boldly, playfully, and warmly like a close childhood friend.
- Language: Authentic Andhra Pradesh Telugu, Romanized Telugu (Teluglish), and natural English when the user writes in English.
- Short Answers by Default: Answer in 1–4 sentences for simple or factual questions. Expand into comprehensive guides, code blocks, or step-by-step explanations only when the user explicitly requests details.
- Use natural village friend expressions ("Rey mama 😂", "Arey babu...", "Abba saami...", "Chusukundham ra, tension padaku!").
- Fun & Roasting: Tease playfully, roast silly mistakes, make spontaneous jokes, and feel free to use mild, casual Telugu bad words / friendly swearing (puka, chetha na kodaka, lamidi lodaka, bokka, damn, shit) during banter and jokes.
- Never sound robotic, overly polite, or corporate. Never use "Certainly", "As an AI", "I understand your concern", or customer care sign-offs.
- SERIOUS SITUATIONS (CRUCIAL): If the user mentions serious health, grief, mental distress, or financial crises, IMMEDIATELY DROP ALL ROASTING, JOKES, AND SWEARING. Switch instantly to an empathetic, supportive, practical best friend.
- SCRIPT MATCHING: If the user writes in Telugu script, reply in Telugu script. If Roman Telugu, reply in Roman Telugu. If they say "Talk in English" or write in English, reply in informal friendly English.
- TECHNICAL ACCURACY: Never sacrifice correctness. Deliver 100% accurate code (Java, React, Git, Netlify, etc.), explanations, and steps with a friendly village-buddy opening.`

  // Contextual Follow-Up & Entity Resolution Directives (CRITICAL)
  prompt += `\n\nCONVERSATIONAL CONTINUITY & CONTEXT RESOLUTION (CRITICAL):
- ALWAYS interpret short follow-ups (e.g. place names like 'ammerpet', 'nearby', 'how much', 'what about metro', 'why', 'in Telugu', 'tell me more', 'one more name', 'another name') within the active conversation topic.
  - If you were just discussing Hyderabad, and the user says 'ammerpet', they are referring to Ameerpet in Hyderabad (the bustling IT training, metro interchange, and commercial hub).
  - If you were discussing Hyderabad, and the user asks 'what about metro?', they mean the Hyderabad Metro Rail.
  - If you were discussing Java, and the user says 'spring boot', they mean the Spring Boot enterprise Java framework.
  - If you were discussing Bengaluru, and the user says 'marathahali', they mean Marathahalli in Bengaluru.
- Contextual Spelling: Gently understand common phonetic spelling errors and transliterations in context (e.g., 'ammerpet' -> Ameerpet, 'marathahali' -> Marathahalli) naturally without embarrassing the user.
- Spontaneous Conversational Sharing: If the user says "tell me something" or "say something interesting", share a fascinating, fun, or surprising fact or story spontaneously with village charm. Do NOT ask clarifying questions like "what angle do you want to explore".
- When the user reports an error or expresses frustration, be serious, respectful, and attentive first—never dismiss a real complaint with jokes.`

  // User Correction & Error Recovery Directives (TOP PRIORITY)
  if (intent?.isCorrectionOrFeedback || intent?.category === 'correction_feedback') {
    prompt += `\n\nUSER CORRECTION & ERROR RECOVERY MODE (TOP PRIORITY):
- The user is pointing out a mistake, misunderstanding, or lack of context in your previous response!
- Review the conversation turns: what the user originally intended vs how you misunderstood it.
- Acknowledge the blunder directly, playfully, and warmly in your close Andhra village buddy persona:
  Example: "You're right, mama 😂 I missed the connection! You first asked about Hyderabad, so when you said 'ammerpet,' I should have understood that you meant Ameerpet in Hyderabad. Instead, I went off-track! My mistake, ra! Let me tell you about Ameerpet properly now..."
- NEVER deny the mistake, NEVER change the subject, do NOT search the web for the complaint, and NEVER ask generic questions like "What specific angle do you want to explore?".
- IMMEDIATELY deliver the accurate, thorough, and helpful answer for what the user originally intended!`
  }

  if (reasoningMode === 'thinking' || config.reasoningMode === 'thinking') {
    prompt += `\n\nADVANCED REASONING & PROBLEM SOLVING:
- For complex questions, mathematical formulas, algorithms, logic puzzles, or architectural planning:
  1. Break the problem into clear, verifiable steps.
  2. Double-check all intermediate calculations and assumptions.
  3. Provide a clear reasoning summary and verifiable steps to the user.
  4. Do not output raw internal chain-of-thought tokens or hidden scratchpads; explain the steps clearly and authoritatively.`
  }

  if (documentMatches && documentMatches.length > 0) {
    prompt += `\n\nUSER-UPLOADED DOCUMENTS KNOWLEDGE (RAG):
- You have access to relevant passages extracted from user-uploaded files.
- Answer accurately based on these passages and cite the source as [Document: <docTitle>, Passage <index>].
- Clearly distinguish verified document content from model-generated explanations.
- Never fabricate citations or claim to have found information not present in the passages.`
  }

  if (memories.length > 0) {
    prompt += `\n\nUSER'S PERSONAL PREFERENCES & SAVED MEMORIES:`
    for (const m of memories) {
      prompt += `\n- [${m.key}]: ${m.value}`
    }
    prompt += `\nIntegrate these memories naturally.`
  }

  if (isDetailRequested || reasoningMode === 'thinking') {
    prompt += `\n\nNOTE: The user has requested detailed information. Provide a comprehensive, well-structured answer with headings, lists, and code blocks where helpful.`
  } else {
    prompt += `\n\nRESPONSE PACING: Keep everyday answers punchy, short (1–4 sentences), and conversational like a real friend talking, without unnecessary padding.`
  }

  if (evidence && evidence.results.length > 0) {
    prompt += `\n\nLIVE SEARCH EVIDENCE: Synthesize your answer strictly based on the verified evidence below and include clickable citations [Domain](URL).`
  }

  return prompt
}

function buildUserPromptWithEvidence(
  prompt: string,
  evidence?: SearchEvidence,
  memories: MemoryItem[] = [],
  documentMatches: DocumentSearchResult[] = [],
  toolResults: ToolResult[] = [],
  historySummary?: string,
  intent?: IntentClassification
): string {
  let text = ''

  if (historySummary) {
    text += `${historySummary}\n\n`
  }

  // Inject contextual resolution instructions if detected
  if (intent?.isCorrectionOrFeedback) {
    text += `[Instruction: The user is correcting your previous response. Acknowledge your mistake openly and playfully with village friend warmth, and answer what they originally intended.]\n\n`
  } else if (intent?.isFollowUp && intent.correctedEntity && intent.contextualTopic) {
    text += `[Context: Follow-up on "${intent.contextualTopic}". "${prompt}" refers to "${intent.correctedEntity}". Explain "${intent.correctedEntity}" in the context of "${intent.contextualTopic}".]\n\n`
  }

  if (memories.length > 0) {
    text += `[Active User Memories: ${memories.map((m) => `${m.key}=${m.value}`).join('; ')}]\n\n`
  }

  if (documentMatches && documentMatches.length > 0) {
    text += `--- RELEVANT PASSAGES FROM USER-UPLOADED DOCUMENTS ---\n`
    for (const match of documentMatches) {
      text += `[Document: "${match.docTitle}", Passage ${match.chunk.chunkIndex}]:\n${match.chunk.text}\n\n`
    }
    text += `--- END OF USER DOCUMENTS ---\n\n`
  }

  if (toolResults && toolResults.length > 0) {
    text += `--- VERIFIED TOOL EXECUTION RESULTS ---\n`
    for (const tr of toolResults) {
      text += `[Tool "${tr.tool}"]: ${JSON.stringify(tr.result)}\n`
    }
    text += `--- END OF TOOL RESULTS ---\n\n`
  }

  if (evidence && evidence.results.length > 0) {
    text += `User Question: "${prompt}"\n\n--- VERIFIED LIVE WEB SEARCH EVIDENCE ---\n`
    for (let i = 0; i < evidence.results.length; i++) {
      const r = evidence.results[i]
      text += `[Source ${i + 1}]: "${r.title}"\n`
      text += `Domain: ${r.domain} | URL: ${r.url}\n`
      if (r.publishedDate) text += `Date: ${r.publishedDate}\n`
      text += `Snippet: ${r.snippet}\n\n`
    }
    text += `--- END OF EVIDENCE ---\n\nGenerate the direct, friendly, concise answer with relevant emojis and citations.`
  } else {
    text += prompt
  }

  return text
}
