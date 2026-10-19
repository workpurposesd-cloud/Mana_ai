import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DATA_DIR = path.resolve(__dirname, '../data')
const MEMORIES_FILE = path.join(DATA_DIR, 'memories.json')
const FEEDBACK_FILE = path.join(DATA_DIR, 'feedback.json')

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
    this.ensureDataDir()
    this.loadData()
  }

  private ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true })
    }
  }

  private loadData() {
    try {
      if (fs.existsSync(MEMORIES_FILE)) {
        const raw = fs.readFileSync(MEMORIES_FILE, 'utf-8')
        this.memories = JSON.parse(raw)
      } else {
        // Initial friendly default memory
        this.memories = [
          {
            id: 'mem-default-1',
            category: 'preference',
            key: 'Communication Style',
            value: 'Warm, casual, like a trusted friend. Direct answers first, natural emojis.',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ]
        this.saveMemories()
      }

      if (fs.existsSync(FEEDBACK_FILE)) {
        const raw = fs.readFileSync(FEEDBACK_FILE, 'utf-8')
        this.feedbacks = JSON.parse(raw)
      } else {
        this.feedbacks = []
      }
    } catch (err) {
      console.warn('[MemoryService] Error loading data from disk:', err)
      this.memories = []
      this.feedbacks = []
    }
  }

  private saveMemories() {
    try {
      this.ensureDataDir()
      fs.writeFileSync(MEMORIES_FILE, JSON.stringify(this.memories, null, 2), 'utf-8')
    } catch (err) {
      console.error('[MemoryService] Error saving memories to disk:', err)
    }
  }

  private saveFeedback() {
    try {
      this.ensureDataDir()
      fs.writeFileSync(FEEDBACK_FILE, JSON.stringify(this.feedbacks, null, 2), 'utf-8')
    } catch (err) {
      console.error('[MemoryService] Error saving feedback to disk:', err)
    }
  }

  public getMemories(): MemoryItem[] {
    return [...this.memories]
  }

  public addMemory(category: MemoryItem['category'], key: string, value: string): MemoryItem {
    // Check if key already exists, update if so
    const existingIdx = this.memories.findIndex(
      (m) => m.key.toLowerCase() === key.toLowerCase()
    )

    if (existingIdx !== -1) {
      this.memories[existingIdx].value = value
      this.memories[existingIdx].category = category
      this.memories[existingIdx].updatedAt = new Date().toISOString()
      this.saveMemories()
      return this.memories[existingIdx]
    }

    const item: MemoryItem = {
      id: `mem-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      category,
      key,
      value,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    this.memories.unshift(item)
    this.saveMemories()
    return item
  }

  public updateMemory(id: string, value: string): MemoryItem | null {
    const item = this.memories.find((m) => m.id === id)
    if (!item) return null
    item.value = value
    item.updatedAt = new Date().toISOString()
    this.saveMemories()
    return item
  }

  public deleteMemory(id: string): boolean {
    const initialLen = this.memories.length
    this.memories = this.memories.filter((m) => m.id !== id)
    if (this.memories.length !== initialLen) {
      this.saveMemories()
      return true
    }
    return false
  }

  public clearAllMemories(): void {
    this.memories = []
    this.saveMemories()
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
    this.saveFeedback()

    // If thumbs down with a correction/comment, automatically save a learned correction
    if (data.rating === 'thumbs_down' && data.comment) {
      this.addMemory('correction', `Feedback on "${data.prompt.slice(0, 30)}"`, data.comment)
    }

    return item
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
    const lower = clean.toLowerCase()

    // 1. Name detection
    const nameMatch = clean.match(/(?:my name is|call me|i am|i'm)\s+([A-Z][a-zA-Z0-9_-]+)/i)
    if (nameMatch && !/^(sorry|glad|happy|tired|here|fine|good|ready)/i.test(nameMatch[1])) {
      return this.addMemory('personal', "User's Name", nameMatch[1])
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
}

export const memoryService = new MemoryService()
