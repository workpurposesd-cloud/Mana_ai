import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { ChatMessage } from '../types.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DATA_DIR = path.resolve(__dirname, '../data')
const CHATS_FILE = path.join(DATA_DIR, 'chats.json')

export interface ChatSession {
  id: string
  userId: string
  title: string
  createdAt: string
  updatedAt: string
  messages: ChatMessage[]
}

class ChatHistoryService {
  private sessions: ChatSession[] = []

  constructor() {
    this.ensureDataDir()
    this.loadSessions()
  }

  private ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true })
    }
  }

  private loadSessions() {
    try {
      if (fs.existsSync(CHATS_FILE)) {
        const raw = fs.readFileSync(CHATS_FILE, 'utf-8')
        this.sessions = JSON.parse(raw)
      } else {
        this.sessions = []
        this.saveSessions()
      }
    } catch (err) {
      console.error('[ChatHistoryService] Error loading chats:', err)
      this.sessions = []
    }
  }

  private saveSessions() {
    try {
      this.ensureDataDir()
      fs.writeFileSync(CHATS_FILE, JSON.stringify(this.sessions, null, 2), 'utf-8')
    } catch (err) {
      console.error('[ChatHistoryService] Error saving chats:', err)
    }
  }

  public getUserSessions(userId: string, filterQuery?: string): Omit<ChatSession, 'messages'>[] {
    let list = this.sessions.filter((s) => s.userId === userId || s.userId === 'guest')

    if (filterQuery && filterQuery.trim()) {
      const q = filterQuery.toLowerCase().trim()
      list = list.filter((s) => {
        if (s.title.toLowerCase().includes(q)) return true
        return s.messages?.some((m) => m.content?.toLowerCase().includes(q))
      })
    }

    // Sort newest first
    list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())

    return list.map(({ messages, ...rest }) => rest)
  }

  public getSession(userId: string, sessionId: string): ChatSession | null {
    const session = this.sessions.find(
      (s) => s.id === sessionId && (s.userId === userId || s.userId === 'guest')
    )
    return session ? { ...session } : null
  }

  public createSession(userId: string, firstMessage?: string): ChatSession {
    let title = 'New Conversation'
    if (firstMessage && firstMessage.trim()) {
      title = firstMessage.trim().slice(0, 36)
      if (firstMessage.length > 36) title += '...'
    }

    const newSession: ChatSession = {
      id: `session-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      userId: userId || 'guest',
      title,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
    }

    this.sessions.unshift(newSession)
    this.saveSessions()
    return newSession
  }

  public saveMessages(userId: string, sessionId: string, messages: ChatMessage[]): ChatSession {
    let session = this.sessions.find((s) => s.id === sessionId)

    if (!session) {
      const firstUserMsg = messages.find((m) => m.role === 'user')?.content || 'New Conversation'
      let title = firstUserMsg.slice(0, 36)
      if (firstUserMsg.length > 36) title += '...'

      session = {
        id: sessionId,
        userId: userId || 'guest',
        title,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: [],
      }
      this.sessions.unshift(session)
    }

    session.messages = messages
    session.updatedAt = new Date().toISOString()

    // Auto-update title if it was "New Conversation" and we now have a user message
    if (session.title === 'New Conversation') {
      const firstUserMsg = messages.find((m) => m.role === 'user')?.content
      if (firstUserMsg) {
        session.title = firstUserMsg.slice(0, 36) + (firstUserMsg.length > 36 ? '...' : '')
      }
    }

    this.saveSessions()
    return session
  }

  public deleteSession(userId: string, sessionId: string): boolean {
    const initialLen = this.sessions.length
    this.sessions = this.sessions.filter(
      (s) => !(s.id === sessionId && (s.userId === userId || s.userId === 'guest'))
    )
    if (this.sessions.length !== initialLen) {
      this.saveSessions()
      return true
    }
    return false
  }

  public renameSession(userId: string, sessionId: string, newTitle: string): ChatSession | null {
    const session = this.sessions.find(
      (s) => s.id === sessionId && (s.userId === userId || s.userId === 'guest')
    )
    if (!session) return null
    session.title = newTitle.trim()
    session.updatedAt = new Date().toISOString()
    this.saveSessions()
    return session
  }
}

export const chatHistoryService = new ChatHistoryService()
