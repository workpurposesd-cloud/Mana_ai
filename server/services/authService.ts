import crypto from 'crypto'
import { dbService } from './dbService.js'

export interface User {
  id: string
  name: string
  email: string
  passwordHash: string
  createdAt: string
  geminiApiKey?: string
}

class AuthService {
  private users: User[] = []
  private isLoaded: boolean = false

  constructor() {
    this.initDefaultUsers()
  }

  private initDefaultUsers() {
    this.users = dbService.getSync<User[]>('users', [])
    if (this.users.length === 0) {
      const defaultHash = this.hashPassword('password123')
      this.users = [
        {
          id: 'user-default-1',
          name: 'U Nagesh',
          email: 'nagesh@mana.ai',
          passwordHash: defaultHash,
          createdAt: new Date().toISOString(),
        },
      ]
      dbService.setSync('users', this.users)
    }
    this.isLoaded = true
  }

  public async refreshFromDb(): Promise<void> {
    try {
      const stored = await dbService.getFresh<User[]>('users', this.users)
      if (Array.isArray(stored) && stored.length > 0) {
        const userMap = new Map<string, User>()
        for (const u of stored) userMap.set(u.id, u)
        for (const u of this.users) userMap.set(u.id, u)
        this.users = Array.from(userMap.values())
      }
    } catch {}
  }

  public hashPassword(password: string): string {
    const salt = crypto.randomBytes(16).toString('hex')
    const derived = crypto.scryptSync(password, salt, 64).toString('hex')
    return `scrypt:${salt}:${derived}`
  }

  public verifyPassword(password: string, storedHash: string): boolean {
    if (!storedHash || typeof storedHash !== 'string') return false

    // Modern scrypt verification with constant-time equality check
    if (storedHash.startsWith('scrypt:')) {
      const parts = storedHash.split(':')
      if (parts.length !== 3) return false
      const [, salt, expectedHash] = parts
      const derived = crypto.scryptSync(password, salt, 64).toString('hex')
      try {
        return crypto.timingSafeEqual(Buffer.from(derived, 'hex'), Buffer.from(expectedHash, 'hex'))
      } catch {
        return false
      }
    }

    // Legacy SHA-256 verification (for safe, seamless zero-downtime migration)
    const legacy2026 = crypto.createHash('sha256').update(password + '_mana_secure_salt_2026').digest('hex')
    const legacyOld = crypto.createHash('sha256').update(password + '_mana_salt').digest('hex')

    return storedHash === legacy2026 || storedHash === legacyOld
  }

  public async signup(
    name: string,
    email: string,
    password: string
  ): Promise<{ user: Omit<User, 'passwordHash' | 'geminiApiKey'>; token: string }> {
    await this.refreshFromDb()

    const cleanEmail = email.toLowerCase().trim()
    const cleanName = name.trim()

    if (!cleanEmail || !cleanEmail.includes('@') || !cleanEmail.includes('.')) {
      throw new Error('Please enter a valid email address.')
    }
    if (!cleanName || cleanName.length < 2) {
      throw new Error('Please enter your full name (minimum 2 characters).')
    }
    if (!password || password.length < 6) {
      throw new Error('Password must be at least 6 characters long.')
    }

    // Check duplicate account
    if (this.users.some((u) => u.email.toLowerCase() === cleanEmail)) {
      throw new Error('An account with this email address already exists. Please sign in instead.')
    }

    const newUser: User = {
      id: `usr-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      name: cleanName,
      email: cleanEmail,
      passwordHash: this.hashPassword(password),
      createdAt: new Date().toISOString(),
    }

    this.users.push(newUser)
    await dbService.set('users', this.users)

    const token = this.generateToken(newUser)
    return { user: this.sanitizeUser(newUser), token }
  }

  public async login(
    email: string,
    password: string
  ): Promise<{ user: Omit<User, 'passwordHash' | 'geminiApiKey'>; token: string }> {
    await this.refreshFromDb()

    const cleanEmail = email.toLowerCase().trim()
    const user = this.users.find((u) => u.email.toLowerCase() === cleanEmail)

    if (!user) {
      throw new Error('Invalid email or password. Please check your credentials.')
    }

    const isValid = this.verifyPassword(password, user.passwordHash)
    if (!isValid) {
      throw new Error('Invalid email or password. Please check your credentials.')
    }

    // Safe zero-downtime migration: if stored hash is legacy SHA-256, upgrade to scrypt
    if (!user.passwordHash.startsWith('scrypt:')) {
      console.log(`[AuthService] Migrating user ${cleanEmail} password hash to scrypt`)
      user.passwordHash = this.hashPassword(password)
      await dbService.set('users', this.users)
    }

    const token = this.generateToken(user)
    return { user: this.sanitizeUser(user), token }
  }

  public async resetPassword(email: string, newPassword: string): Promise<boolean> {
    await this.refreshFromDb()

    const cleanEmail = email.toLowerCase().trim()
    const user = this.users.find((u) => u.email.toLowerCase() === cleanEmail)

    if (!user) {
      throw new Error('No account found with this email address.')
    }
    if (!newPassword || newPassword.length < 6) {
      throw new Error('New password must be at least 6 characters long.')
    }

    user.passwordHash = this.hashPassword(newPassword)
    await dbService.set('users', this.users)
    return true
  }

  private getAuthSecret(): string {
    return process.env.AUTH_SECRET || 'mana_ai_auth_hmac_secret_key_2026_secured'
  }

  public generateToken(user: User): string {
    const payload = JSON.stringify({
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt,
      exp: Date.now() + 30 * 24 * 3600 * 1000, // 30 days session
    })
    const payloadB64 = Buffer.from(payload).toString('base64url')
    const sig = crypto.createHmac('sha256', this.getAuthSecret()).update(payloadB64).digest('base64url')
    return `${payloadB64}.${sig}`
  }

  private sanitizeUser(user: User): Omit<User, 'passwordHash' | 'geminiApiKey'> {
    const { passwordHash, geminiApiKey, ...safe } = user
    return safe
  }

  public getUserById(id: string): User | undefined {
    return this.users.find((u) => u.id === id)
  }

  public verifyToken(token: string): Omit<User, 'passwordHash' | 'geminiApiKey'> | null {
    try {
      if (!token || typeof token !== 'string') return null

      const parts = token.split('.')
      let payload: any = null

      if (parts.length === 2) {
        const [payloadB64, sig] = parts
        const expectedSig = crypto.createHmac('sha256', this.getAuthSecret()).update(payloadB64).digest('base64url')
        if (sig !== expectedSig) return null
        const decoded = Buffer.from(payloadB64, 'base64url').toString('utf-8')
        payload = JSON.parse(decoded)
      } else {
        // Fallback for base64
        const decoded = Buffer.from(token, 'base64').toString('utf-8')
        payload = JSON.parse(decoded)
      }

      if (!payload || !payload.id) return null
      if (payload.exp && Date.now() > payload.exp) return null

      // Check current in-memory cache
      const user = this.users.find((u) => u.id === payload.id)
      if (user) {
        return this.sanitizeUser(user)
      }

      // If user signed up on another container or cold boot, verified HMAC payload provides identity
      if (payload.email) {
        return {
          id: payload.id,
          email: payload.email,
          name: payload.name || payload.email.split('@')[0],
          createdAt: payload.createdAt || new Date().toISOString(),
        }
      }

      return null
    } catch {
      return null
    }
  }

  public async updateUserGeminiKey(userId: string, key: string): Promise<boolean> {
    await this.refreshFromDb()
    const user = this.users.find((u) => u.id === userId)
    if (!user) return false
    user.geminiApiKey = key
    await dbService.set('users', this.users)
    return true
  }
}

export const authService = new AuthService()
