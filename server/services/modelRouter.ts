import { AppConfig, IntentClassification } from '../types.js'

export type TaskTier = 'fast' | 'reasoning' | 'media'

export interface ModelSelection {
  tier: TaskTier
  provider: 'gemini' | 'openai' | 'groq' | 'builtin'
  modelName: string
  reason: string
}

/**
 * Classifies query complexity to route to the fastest capable model
 * while preserving deep reasoning for complex coding and analysis.
 */
export function determineTaskTier(
  prompt: string,
  intent: IntentClassification,
  reasoningMode?: 'fast' | 'thinking'
): TaskTier {
  const clean = prompt.trim()
  const lower = clean.toLowerCase()

  // Explicit user override via UI toggle
  if (reasoningMode === 'thinking') {
    return 'reasoning'
  }

  // 1. Conversational greetings, everyday Telugu village banter, small talk, reactions
  if (intent.category === 'conversational') {
    return 'fast'
  }

  // 2. Math tools, date/time, unit conversion, simple word definitions
  if (
    /^(calculate|compute|what is \d+|convert|\d+\s*[\+\-\*\/%])/i.test(clean) ||
    /^(time|date|today's date|what time is it|define \w+)[?!.]*$/i.test(clean)
  ) {
    return 'fast'
  }

  // 3. Short translations and simple inquiries
  if (
    /^(translate|how do you say|meaning of|synonym of)\b/i.test(lower) &&
    clean.length < 120
  ) {
    return 'fast'
  }

  // 4. Complex coding, system design, architectural questions, deep debugging
  const reasoningTriggers = [
    /\b(build an app|system design|architecture|refactor|design pattern|memory leak|deadlock|concurrency|algorithm|data structure|regex|sql query optimization|dockerfile|kubernetes|oauth2|jwt implementation)\b/i,
    /\b(step[- ]by[- ]step explanation|deep dive|in[- ]depth analysis|comprehensive guide|compare and contrast|pros and cons in detail)\b/i,
    /\b(write a full|create a complete|implement a class|generate an api)\b/i,
  ]

  if (reasoningTriggers.some((r) => r.test(clean))) {
    return 'reasoning'
  }

  // Length heuristic: long complex prompts benefit from reasoning model
  if (clean.length > 350 || intent.isDetailRequested) {
    return 'reasoning'
  }

  return 'fast'
}

/**
 * Selects the optimal model and provider based on task tier and configured credentials
 */
export function selectModelForTask(
  tier: TaskTier,
  config: AppConfig,
  intent: IntentClassification
): ModelSelection {
  const hasGemini = Boolean(config.geminiApiKey || process.env.GEMINI_API_KEY)
  const hasGroq = Boolean(config.groqApiKey || process.env.GROQ_API_KEY)
  const hasOpenAI = Boolean(config.openaiApiKey || process.env.OPENAI_API_KEY)

  // 1. FAST TIER: Optimize for sub-second TTFT and low latency
  if (tier === 'fast') {
    // Groq is exceptionally fast (>300 tokens/sec, TTFT ~200ms)
    if (hasGroq && (config.aiProvider === 'groq' || !config.aiProvider)) {
      return {
        tier: 'fast',
        provider: 'groq',
        modelName: 'llama-3.1-8b-instant',
        reason: 'Ultra-fast Groq Llama-3.1-8B selected for rapid conversational response.',
      }
    }

    // Google Gemini 2.0 / 1.5 Flash (TTFT ~400-800ms)
    if (hasGemini && (config.aiProvider === 'gemini' || config.aiProvider === 'builtin' || !config.aiProvider)) {
      return {
        tier: 'fast',
        provider: 'gemini',
        modelName: config.modelName?.includes('flash') ? config.modelName : 'gemini-1.5-flash',
        reason: 'Fast Gemini Flash selected for low latency and high accuracy.',
      }
    }

    // OpenAI gpt-4o-mini
    if (hasOpenAI && config.aiProvider === 'openai') {
      return {
        tier: 'fast',
        provider: 'openai',
        modelName: 'gpt-4o-mini',
        reason: 'OpenAI GPT-4o-mini selected for fast, accurate generation.',
      }
    }

    // Free built-in tier: fast conversational engine or Pollinations
    return {
      tier: 'fast',
      provider: 'builtin',
      modelName: 'fast-synthesizer',
      reason: 'Built-in conversational engine selected for instant response.',
    }
  }

  // 2. REASONING TIER: Optimize for complex code generation, logical depth, and structure
  if (hasGemini && (config.aiProvider === 'gemini' || config.aiProvider === 'builtin' || !config.aiProvider)) {
    return {
      tier: 'reasoning',
      provider: 'gemini',
      modelName: config.modelName || 'gemini-1.5-pro',
      reason: 'Gemini Pro selected for deep multi-step reasoning and technical accuracy.',
    }
  }

  if (hasOpenAI && config.aiProvider === 'openai') {
    return {
      tier: 'reasoning',
      provider: 'openai',
      modelName: config.modelName || 'gpt-4o',
      reason: 'OpenAI GPT-4o selected for complex coding and deep analysis.',
    }
  }

  if (hasGroq && config.aiProvider === 'groq') {
    return {
      tier: 'reasoning',
      provider: 'groq',
      modelName: 'llama-3.3-70b-versatile',
      reason: 'Groq Llama-3.3-70B selected for high-capacity reasoning.',
    }
  }

  // Free Tier Reasoning
  return {
    tier: 'reasoning',
    provider: 'builtin',
    modelName: 'openai',
    reason: 'Built-in smart engine with deep system instructions selected.',
  }
}
