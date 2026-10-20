import { ChatMessage } from '../types.js'
import { dbService } from './dbService.js'

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
    this.sessions = dbService.getSync<ChatSession[]>('chats', [])
  }

  public async refreshFromDb(): Promise<void> {
    try {
      this.sessions = await dbService.getFresh<ChatSession[]>('chats', this.sessions)
    } catch {}
  }

  private persistSessions() {
    dbService.setSync('chats', this.sessions)
  }

  public async persistSessionsAsync(): Promise<void> {
    await dbService.set('chats', this.sessions)
  }

  public getUserSessions(userId: string, filterQuery?: string): Omit<ChatSession, 'messages'>[] {
    const targetUserId = userId || 'guest'
    let list = this.sessions.filter((s) => s.userId === targetUserId)

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
    const targetUserId = userId || 'guest'
    const session = this.sessions.find(
      (s) => s.id === sessionId && s.userId === targetUserId
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
    this.persistSessions()
    return newSession
  }

  public async createSessionAsync(userId: string, firstMessage?: string): Promise<ChatSession> {
    await this.refreshFromDb()
    const session = this.createSession(userId, firstMessage)
    await this.persistSessionsAsync()
    return session
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

    this.persistSessions()
    return session
  }

  public async saveMessagesAsync(userId: string, sessionId: string, messages: ChatMessage[]): Promise<ChatSession> {
    await this.refreshFromDb()
    const session = this.saveMessages(userId, sessionId, messages)
    await this.persistSessionsAsync()
    return session
  }

  public deleteSession(userId: string, sessionId: string): boolean {
    const targetUserId = userId || 'guest'
    const initialLen = this.sessions.length
    this.sessions = this.sessions.filter(
      (s) => !(s.id === sessionId && s.userId === targetUserId)
    )
    if (this.sessions.length !== initialLen) {
      this.persistSessions()
      return true
    }
    return false
  }

  public async deleteSessionAsync(userId: string, sessionId: string): Promise<boolean> {
    await this.refreshFromDb()
    const deleted = this.deleteSession(userId, sessionId)
    if (deleted) {
      await this.persistSessionsAsync()
    }
    return deleted
  }

  public renameSession(userId: string, sessionId: string, newTitle: string): ChatSession | null {
    const targetUserId = userId || 'guest'
    const session = this.sessions.find(
      (s) => s.id === sessionId && s.userId === targetUserId
    )
    if (!session) return null
    session.title = newTitle.trim()
    session.updatedAt = new Date().toISOString()
    this.persistSessions()
    return session
  }

  public async renameSessionAsync(userId: string, sessionId: string, newTitle: string): Promise<ChatSession | null> {
    await this.refreshFromDb()
    const session = this.renameSession(userId, sessionId, newTitle)
    if (session) {
      await this.persistSessionsAsync()
    }
    return session
  }
}

export const chatHistoryService = new ChatHistoryService()
