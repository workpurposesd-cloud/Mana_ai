import { dbService } from './dbService.js'

export interface MemoryItem {
  id: string
  category: 'personal' | 'preference' | 'correction' | 'project'
  key: string
  value: string
  createdAt: string
  updatedAt: string
}

export interface FeedbackItem {
  id: string
  messageId: string
  prompt: string
  response: string
  rating: 'thumbs_up' | 'thumbs_down'
  comment?: string
  timestamp: string
}

class MemoryService {
  private memories: MemoryItem[] = []
  private feedbacks: FeedbackItem[] = []

  constructor() {
    this.loadData()
  }

  private loadData() {
    this.memories = dbService.getSync<MemoryItem[]>('memories', [])
    if (this.memories.length === 0) {
      this.memories = [
        {
          id: 'mem-default-1',
          category: 'preference',
          key: 'Communication Style',
          value: 'Warm, casual, like a trusted village friend. Direct answers first, natural emojis.',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]
      dbService.setSync('memories', this.memories)
    }
  }

  private saveMemories() {
    dbService.setSync('memories', this.memories)
  }

  public async refreshFromDb(): Promise<void> {
    try {
      this.memories = await dbService.getFresh<MemoryItem[]>('memories', this.memories)
    } catch {}
  }

  public async saveMemoriesAsync(): Promise<void> {
    await dbService.set('memories', this.memories)
  }

  public getMemories(): MemoryItem[] {
    return [...this.memories]
  }

  public addMemory(category: MemoryItem['category'], key: string, value: string): MemoryItem {
    const existingIndex = this.memories.findIndex(
      (m) => m.key.toLowerCase().trim() === key.toLowerCase().trim()
    )

    const now = new Date().toISOString()

    if (existingIndex !== -1) {
      this.memories[existingIndex] = {
        ...this.memories[existingIndex],
        category,
        value,
        updatedAt: now,
      }
      this.saveMemories()
      return this.memories[existingIndex]
    }

    const newMemory: MemoryItem = {
      id: `mem-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      category,
      key: key.trim(),
      value: value.trim(),
      createdAt: now,
      updatedAt: now,
    }

    this.memories.unshift(newMemory)
    this.saveMemories()
    return newMemory
  }

  public updateMemory(id: string, updates: Partial<Pick<MemoryItem, 'category' | 'key' | 'value'>>): MemoryItem | null {
    const index = this.memories.findIndex((m) => m.id === id)
    if (index === -1) return null

    this.memories[index] = {
      ...this.memories[index],
      ...updates,
      updatedAt: new Date().toISOString(),
    }

    this.saveMemories()
    return this.memories[index]
  }

  public deleteMemory(id: string): boolean {
    const initialLength = this.memories.length
    this.memories = this.memories.filter((m) => m.id !== id)
    if (this.memories.length !== initialLength) {
      this.saveMemories()
      return true
    }
    return false
  }

  public clearAllMemories(): void {
    this.memories = []
    this.saveMemories()
  }

  public saveFeedback(item: Omit<FeedbackItem, 'id' | 'timestamp'>): FeedbackItem {
    return this.recordFeedback(item)
  }

  public recordFeedback(data: Omit<FeedbackItem, 'id' | 'timestamp'>): FeedbackItem {
    const item: FeedbackItem = {
      id: `fb-${Date.now()}`,
      timestamp: new Date().toISOString(),
      ...data,
    }
    this.feedbacks.unshift(item)
    // Keep last 100 feedback entries
    if (this.feedbacks.length > 100) {
      this.feedbacks = this.feedbacks.slice(0, 100)
    }

    // If thumbs down with a correction/comment, automatically save a learned correction
    if (data.rating === 'thumbs_down' && data.comment) {
      this.addMemory('correction', `Feedback on "${data.prompt.slice(0, 30)}"`, data.comment)
    }

    return item
  }

  public getFeedbacks(): FeedbackItem[] {
    return [...this.feedbacks]
  }

  /**
   * Retrieves relevant memory items matching the user's prompt
   */
  public getRelevantMemories(prompt: string, enabled = true): MemoryItem[] {
    if (!enabled || this.memories.length === 0) return []
    const lower = prompt.toLowerCase()
    const words = lower.split(/\s+/).filter((w) => w.length > 3)

    return this.memories.filter((mem) => {
      // General preferences always apply
      if (mem.category === 'preference' || mem.category === 'personal') return true

      const memText = (mem.key + ' ' + mem.value).toLowerCase()
      return words.some((w) => memText.includes(w))
    })
  }

  /**
   * Automatically detects personal information or explicit preferences stated in the prompt
   */
  public detectAndSaveUserPreferences(prompt: string, enabled = true): MemoryItem | null {
    if (!enabled) return null
    const clean = prompt.trim()

    // 1. Name detection (e.g. "my name is Rahul", "call me Nagesh")
    const explicitNameMatch = clean.match(/(?:my name is|call me|myself|i am called|i'm called)\s+([A-Z][a-zA-Z0-9_-]+)/i)
    const selfNameMatch = !explicitNameMatch && clean.match(/^(?:i am|i'm)\s+([A-Z][a-zA-Z0-9_-]+)[.!]?$/i)
    const candidate = explicitNameMatch ? explicitNameMatch[1] : (selfNameMatch ? selfNameMatch[1] : null)

    if (candidate) {
      const lowerCandidate = candidate.toLowerCase()
      const nonNameWords = new Set([
        'sorry', 'glad', 'happy', 'tired', 'here', 'fine', 'good', 'ready',
        'asking', 'bored', 'sad', 'sick', 'sure', 'not', 'just', 'working',
        'trying', 'saying', 'telling', 'looking', 'waiting', 'reading',
        'learning', 'testing', 'using', 'online', 'busy', 'done', 'back'
      ])
      if (!nonNameWords.has(lowerCandidate) && !/(?:ing|ed|ly)$/i.test(lowerCandidate)) {
        return this.addMemory('personal', "User's Name", candidate)
      }
    }

    // 2. Preferences
    const preferMatch = clean.match(/(?:i prefer|i like|always use|prefer to use)\s+([a-zA-Z0-9\s#+._-]+)/i)
    if (preferMatch && preferMatch[1].length < 40) {
      return this.addMemory('preference', 'Preference', preferMatch[1].trim())
    }

    // 3. Explicit correction ("Actually, ...", "No, it is ...")
    const correctionMatch = clean.match(/(?:actually,? it(?:'s| is)|no,? that(?:'s| is) wrong,?\s*(?:it is)?)\s+([a-zA-Z0-9\s#+._-]+)/i)
    if (correctionMatch) {
      return this.addMemory('correction', 'User Correction', correctionMatch[1].trim())
    }

    return null
  }

  public autoExtractMemories(prompt: string, response: string): MemoryItem[] {
    const extracted: MemoryItem[] = []
    const lower = prompt.toLowerCase()

    if (/my name is ([a-zA-Z0-9_\s]+)/i.test(prompt)) {
      const match = prompt.match(/my name is ([a-zA-Z0-9_\s]+)/i)
      if (match && match[1]) {
        extracted.push(this.addMemory('personal', "User's Name", match[1].trim()))
      }
    }

    if (/i live in ([a-zA-Z0-9_\s,]+)/i.test(prompt) || /i am from ([a-zA-Z0-9_\s,]+)/i.test(prompt)) {
      const match = prompt.match(/(?:i live in|i am from) ([a-zA-Z0-9_\s,]+)/i)
      if (match && match[1]) {
        extracted.push(this.addMemory('personal', 'Location', match[1].trim()))
      }
    }

    if (/i prefer ([a-zA-Z0-9_\s,]+)/i.test(prompt)) {
      const match = prompt.match(/i prefer ([a-zA-Z0-9_\s,]+)/i)
      if (match && match[1]) {
        extracted.push(this.addMemory('preference', 'Preference', match[1].trim()))
      }
    }

    if (/remember that ([a-zA-Z0-9_\s,.]+)/i.test(prompt)) {
      const match = prompt.match(/remember that ([a-zA-Z0-9_\s,.]+)/i)
      if (match && match[1]) {
        extracted.push(this.addMemory('preference', 'Explicit Note', match[1].trim()))
      }
    }

    return extracted
  }
}

export const memoryService = new MemoryService()
