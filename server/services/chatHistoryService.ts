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

  private lastRefreshTime: number = 0
  private readonly REFRESH_TTL_MS: number = 4000 // 4s in-memory TTL to avoid repeated Blobs latency

  constructor() {
    this.sessions = dbService.getSync<ChatSession[]>('chats', [])
  }

  public async refreshFromDb(force = false): Promise<void> {
    const now = Date.now()
    if (!force && now - this.lastRefreshTime < this.REFRESH_TTL_MS) {
      return
    }
    this.lastRefreshTime = now
    try {
      const stored = await dbService.getFresh<ChatSession[]>('chats', this.sessions)
      if (Array.isArray(stored) && stored.length > 0) {
        const sessionMap = new Map<string, ChatSession>()
        for (const s of stored) sessionMap.set(s.id, s)
        for (const s of this.sessions) sessionMap.set(s.id, s)
        this.sessions = Array.from(sessionMap.values())
      }
    } catch {}
  }

  private persistSessions() {
    dbService.setSync('chats', this.sessions)
  }

  public async persistSessionsAsync(): Promise<void> {
    await dbService.set('chats', this.sessions)
  }

  public getUserSessions(
    userId: string,
    filterQuery?: string,
    limit = 50,
    offset = 0
  ): { sessions: Omit<ChatSession, 'messages'>[]; total: number; hasMore: boolean } {
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

    const total = list.length
    const paginated = list.slice(offset, offset + limit).map(({ messages, ...rest }) => rest)
    return {
      sessions: paginated,
      total,
      hasMore: offset + limit < total,
    }
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

  public saveMessages(userId: string, sessionId: string, messages: ChatMessage[]): ChatSession | null {
    const targetUserId = userId || 'guest'
    let session = this.sessions.find((s) => s.id === sessionId)

    if (session) {
      // IDOR protection: User A cannot modify or overwrite User B's session
      if (session.userId !== targetUserId) {
        return null
      }
    } else {
      const firstUserMsg = messages.find((m) => m.role === 'user')?.content || 'New Conversation'
      let title = firstUserMsg.slice(0, 36)
      if (firstUserMsg.length > 36) title += '...'

      session = {
        id: sessionId,
        userId: targetUserId,
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

  public async saveMessagesAsync(userId: string, sessionId: string, messages: ChatMessage[]): Promise<ChatSession | null> {
    await this.refreshFromDb()
    const session = this.saveMessages(userId, sessionId, messages)
    if (session) {
      await this.persistSessionsAsync()
    }
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

  /**
   * Seamlessly claims / migrates guest conversations created on this device to the authenticated user ID
   */
  public async claimGuestSessions(guestId: string, userId: string): Promise<number> {
    if (!guestId || !userId || guestId === userId) return 0
    await this.refreshFromDb()
    let count = 0
    const normalizedGuest = guestId.startsWith('guest:') ? guestId : `guest:${guestId}`
    for (const session of this.sessions) {
      if (session.userId === normalizedGuest || session.userId === guestId) {
        session.userId = userId
        session.updatedAt = new Date().toISOString()
        count++
      }
    }
    if (count > 0) {
      await this.persistSessionsAsync()
    }
    return count
  }
}

export const chatHistoryService = new ChatHistoryService()
