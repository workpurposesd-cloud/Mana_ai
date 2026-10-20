import { MemoryItem } from '../types.js'

export interface OptimizedContext {
  sanitizedHistory: Array<{ role: 'user' | 'assistant'; content: string }>
  historySummary?: string
  totalEstimatedTokens: number
  memoriesUsed: MemoryItem[]
}

/**
 * Estimates token count from text using character heuristic (~4 characters per token)
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 4)
}

/**
 * Optimizes chat history context:
 * 1. Deduplicates consecutive identical messages
 * 2. Applies sliding window: keeps the most recent 8-10 messages intact
 * 3. Compacts older messages (>10) into a concise context summary
 * 4. Caps individual historical message length to prevent past dumps from bloating context
 * 5. Enforces an overall token budget (default 2500 tokens)
 */
export function optimizeConversationContext(
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  memories: MemoryItem[] = [],
  maxTokenBudget: number = 3500
): OptimizedContext {
  if (!Array.isArray(history) || history.length === 0) {
    return {
      sanitizedHistory: [],
      totalEstimatedTokens: 0,
      memoriesUsed: memories.slice(0, 3),
    }
  }

  // 1. Clean and deduplicate history
  const cleanHistory: Array<{ role: 'user' | 'assistant'; content: string }> = []
  for (const msg of history) {
    if (!msg || typeof msg.content !== 'string') continue
    const trimmed = msg.content.trim()
    if (!trimmed) continue

    // Deduplicate exact consecutive duplicates
    const last = cleanHistory[cleanHistory.length - 1]
    if (last && last.role === msg.role && last.content === trimmed) {
      continue
    }

    cleanHistory.push({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: trimmed,
    })
  }

  // 2. Sliding Window: Separate into recent window (last 12 messages) and older history
  const RECENT_WINDOW_SIZE = 12
  const olderMessages = cleanHistory.slice(0, Math.max(0, cleanHistory.length - RECENT_WINDOW_SIZE))
  const recentMessages = cleanHistory.slice(-RECENT_WINDOW_SIZE)

  // 3. Compact older messages into a brief recap if conversation is long
  let historySummary: string | undefined
  if (olderMessages.length > 0) {
    const topics: string[] = []
    for (const m of olderMessages) {
      if (m.role === 'user' && m.content.length > 3) {
        const snippet = m.content.slice(0, 60).replace(/\n/g, ' ')
        topics.push(snippet)
      }
    }
    if (topics.length > 0) {
      historySummary = `[Earlier conversation context: User previously discussed: ${topics.slice(-6).join('; ')}]`
    }
  }

  // 4. Cap individual older messages within the recent window (up to 2000 chars)
  const sanitizedHistory = recentMessages.map((msg, index) => {
    const isVeryRecent = index >= recentMessages.length - 2
    const maxLength = isVeryRecent ? 2500 : 1500
    if (msg.content.length > maxLength) {
      return {
        role: msg.role,
        content: msg.content.slice(0, maxLength) + '... [truncated for context efficiency]',
      }
    }
    return msg
  })

  // 5. Enforce token budget from oldest to newest
  let currentTokenCount = estimateTokens(historySummary || '')
  const budgetCompliantHistory: Array<{ role: 'user' | 'assistant'; content: string }> = []

  // Iterate backwards (most recent messages have highest priority)
  for (let i = sanitizedHistory.length - 1; i >= 0; i--) {
    const msg = sanitizedHistory[i]
    const msgTokens = estimateTokens(msg.content)
    if (currentTokenCount + msgTokens <= maxTokenBudget) {
      budgetCompliantHistory.unshift(msg)
      currentTokenCount += msgTokens
    } else {
      break
    }
  }

  // Cap memories to the top 3 most relevant items
  const memoriesUsed = memories.slice(0, 3)

  return {
    sanitizedHistory: budgetCompliantHistory,
    historySummary,
    totalEstimatedTokens: currentTokenCount,
    memoriesUsed,
  }
}
