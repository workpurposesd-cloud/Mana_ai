import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'

function resolveDataDir(): string {
  if (process.env.DATA_DIR) return process.env.DATA_DIR
  if (process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME) return '/tmp'
  try {
    if (typeof __dirname !== 'undefined') return path.resolve(__dirname, '../data')
    if (typeof import.meta !== 'undefined' && import.meta.url) {
      return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data')
    }
  } catch {}
  return path.resolve(process.cwd(), 'server', 'data')
}

const DATA_DIR = resolveDataDir()
const USERS_FILE = path.join(DATA_DIR, 'users.json')

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

  constructor() {
    this.ensureDataDir()
    this.loadUsers()
  }

  private ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true })
    }
  }

  private loadUsers() {
    try {
      if (fs.existsSync(USERS_FILE)) {
        const raw = fs.readFileSync(USERS_FILE, 'utf-8')
        this.users = JSON.parse(raw)
      } else {
        // Create initial default user for Nagesh
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
        this.saveUsers()
      }
    } catch (err) {
      console.error('[AuthService] Error loading users:', err)
      this.users = []
    }
  }

  private saveUsers() {
    try {
      this.ensureDataDir()
      fs.writeFileSync(USERS_FILE, JSON.stringify(this.users, null, 2), 'utf-8')
    } catch (err) {
      console.error('[AuthService] Error saving users:', err)
    }
  }

  public hashPassword(password: string): string {
    return crypto.createHash('sha256').update(password + '_mana_salt').digest('hex')
  }

  public signup(name: string, email: string, password: string): { user: Omit<User, 'passwordHash'>; token: string } {
    const cleanEmail = email.toLowerCase().trim()
    const cleanName = name.trim()

    if (this.users.some((u) => u.email.toLowerCase() === cleanEmail)) {
      throw new Error('An account with this email already exists.')
    }

    const newUser: User = {
      id: `usr-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      name: cleanName,
      email: cleanEmail,
      passwordHash: this.hashPassword(password),
      createdAt: new Date().toISOString(),
    }

    this.users.push(newUser)
    this.saveUsers()

    const token = this.generateToken(newUser)
    const { passwordHash, ...userWithoutPassword } = newUser
    return { user: userWithoutPassword, token }
  }

  public login(email: string, password: string): { user: Omit<User, 'passwordHash'>; token: string } {
    const cleanEmail = email.toLowerCase().trim()
    const user = this.users.find((u) => u.email.toLowerCase() === cleanEmail)

    if (!user) {
      throw new Error('Invalid email or password.')
    }

    const hash = this.hashPassword(password)
    if (user.passwordHash !== hash) {
      throw new Error('Invalid email or password.')
    }

    const token = this.generateToken(user)
    const { passwordHash, ...userWithoutPassword } = user
    return { user: userWithoutPassword, token }
  }

  private getAuthSecret(): string {
    return process.env.AUTH_SECRET || 'mana_ai_auth_hmac_secret_key_2026_secured'
  }

  public generateToken(user: User): string {
    const payload = JSON.stringify({ id: user.id, email: user.email, exp: Date.now() + 30 * 24 * 3600 * 1000 })
    const payloadB64 = Buffer.from(payload).toString('base64url')
    const sig = crypto.createHmac('sha256', this.getAuthSecret()).update(payloadB64).digest('base64url')
    return `${payloadB64}.${sig}`
  }

  public verifyToken(token: string): Omit<User, 'passwordHash'> | null {
    try {
      if (!token || typeof token !== 'string') return null

      // Check signed token format: payloadB64.signature
      const parts = token.split('.')
      let payload: any = null

      if (parts.length === 2) {
        const [payloadB64, sig] = parts
        const expectedSig = crypto.createHmac('sha256', this.getAuthSecret()).update(payloadB64).digest('base64url')
        if (sig !== expectedSig) return null
        const decoded = Buffer.from(payloadB64, 'base64url').toString('utf-8')
        payload = JSON.parse(decoded)
      } else {
        // Legacy base64 support during transition
        const decoded = Buffer.from(token, 'base64').toString('utf-8')
        payload = JSON.parse(decoded)
      }

      if (!payload || !payload.id) return null
      if (payload.exp && Date.now() > payload.exp) return null

      const user = this.users.find((u) => u.id === payload.id)
      if (!user) return null

      const { passwordHash, ...userWithoutPassword } = user
      return userWithoutPassword
    } catch {
      return null
    }
  }

  public updateUserGeminiKey(userId: string, key: string): boolean {
    const user = this.users.find((u) => u.id === userId)
    if (!user) return false
    user.geminiApiKey = key
    this.saveUsers()
    return true
  }
}

export const authService = new AuthService()
