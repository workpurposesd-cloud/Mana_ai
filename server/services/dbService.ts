import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

// Storage Keys
export type StorageCollection = 'users' | 'chats' | 'memories' | 'documents' | 'config' | 'video_jobs'

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

class DatabaseService {
  private memoryCache: Map<string, any> = new Map()
  private isNetlifyBlobsAvailable: boolean = false
  private netlifyStore: any = null
  private supabaseClient: any = null
  private isSupabaseAvailable: boolean = false
  private initialized: boolean = false

  constructor() {
    this.ensureDataDir()
    this.initProviders()
  }

  private ensureDataDir() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true })
      }
    } catch {}
  }

  private async initProviders() {
    if (this.initialized) return
    this.initialized = true

    // 1. Check Supabase availability
    const supabaseUrl = process.env.SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY
    if (supabaseUrl && supabaseKey) {
      try {
        const { createClient } = await import('@supabase/supabase-js')
        this.supabaseClient = createClient(supabaseUrl, supabaseKey, {
          auth: { persistSession: false },
        })
        this.isSupabaseAvailable = true
        console.log('[DBService] Supabase client initialized successfully.')
      } catch (err: any) {
        console.warn('[DBService] Could not initialize Supabase:', err.message)
      }
    }

    // 2. Check Netlify Blobs availability
    if (process.env.NETLIFY || process.env.NETLIFY_BLOBS_CONTEXT || process.env.SITE_ID) {
      try {
        const { getStore } = await import('@netlify/blobs')
        this.netlifyStore = getStore('mana-persistent-data')
        this.isNetlifyBlobsAvailable = true
        console.log('[DBService] Netlify Blobs store initialized for production persistence.')
      } catch (err: any) {
        console.warn('[DBService] Netlify Blobs not available:', err.message)
      }
    }
  }

  /**
   * Retrieves data from the highest-priority available storage provider.
   */
  public async get<T>(collection: StorageCollection, defaultValue: T): Promise<T> {
    await this.initProviders()

    // 1. Check in-memory cache first for instant sub-millisecond response
    if (this.memoryCache.has(collection)) {
      return this.memoryCache.get(collection) as T
    }

    return this.fetchFromProviders<T>(collection, defaultValue)
  }

  /**
   * Forces a fresh fetch from remote providers/disk, bypassing the in-memory cache.
   */
  public async getFresh<T>(collection: StorageCollection, defaultValue: T): Promise<T> {
    await this.initProviders()
    this.memoryCache.delete(collection)
    return this.fetchFromProviders<T>(collection, defaultValue)
  }

  private async fetchFromProviders<T>(collection: StorageCollection, defaultValue: T): Promise<T> {
    // 2. Try Supabase
    if (this.isSupabaseAvailable && this.supabaseClient) {
      try {
        const { data, error } = await this.supabaseClient
          .from('mana_storage')
          .select('value')
          .eq('collection', collection)
          .single()

        if (!error && data && data.value !== undefined) {
          this.memoryCache.set(collection, data.value)
          return data.value as T
        }
      } catch (err: any) {
        // Fall back to next provider
      }
    }

    // 3. Try Netlify Blobs
    if (this.isNetlifyBlobsAvailable && this.netlifyStore) {
      try {
        const val = await this.netlifyStore.get(collection, { type: 'json' })
        if (val !== null && val !== undefined) {
          this.memoryCache.set(collection, val)
          return val as T
        }
      } catch (err: any) {
        // Fall back to next provider
      }
    }

    // 4. Try local file system
    try {
      const filePath = path.join(DATA_DIR, `${collection}.json`)
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf-8')
        const parsed = JSON.parse(raw)
        this.memoryCache.set(collection, parsed)
        return parsed as T
      }
    } catch (err: any) {
      console.warn(`[DBService] Error reading local file for ${collection}:`, err.message)
    }

    // Default value if nothing found
    this.memoryCache.set(collection, defaultValue)
    return defaultValue
  }

  /**
   * Saves data synchronously in-memory and asynchronously persists to cloud storage & disk.
   */
  public async set<T>(collection: StorageCollection, value: T): Promise<void> {
    await this.initProviders()

    // 1. Immediately update memory cache
    this.memoryCache.set(collection, value)

    // 2. Persist to local disk
    try {
      this.ensureDataDir()
      const filePath = path.join(DATA_DIR, `${collection}.json`)
      fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf-8')
    } catch (err: any) {
      // In read-only serverless this might fail if not in /tmp
    }

    // 3. Persist to Supabase if available
    if (this.isSupabaseAvailable && this.supabaseClient) {
      try {
        await this.supabaseClient.from('mana_storage').upsert({
          collection,
          value,
          updated_at: new Date().toISOString(),
        })
      } catch (err: any) {
        console.warn(`[DBService] Supabase upsert error for ${collection}:`, err.message)
      }
    }

    // 4. Persist to Netlify Blobs if available
    if (this.isNetlifyBlobsAvailable && this.netlifyStore) {
      try {
        await this.netlifyStore.setJSON(collection, value)
      } catch (err: any) {
        console.warn(`[DBService] Netlify Blobs setJSON error for ${collection}:`, err.message)
      }
    }
  }

  /**
   * Synchronous get from memory cache or local disk.
   */
  public getSync<T>(collection: StorageCollection, defaultValue: T): T {
    if (this.memoryCache.has(collection)) {
      return this.memoryCache.get(collection) as T
    }

    try {
      const filePath = path.join(DATA_DIR, `${collection}.json`)
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf-8')
        const parsed = JSON.parse(raw)
        this.memoryCache.set(collection, parsed)
        return parsed as T
      }
    } catch {}

    this.memoryCache.set(collection, defaultValue)
    return defaultValue
  }

  /**
   * Synchronous set in memory and local disk, with background cloud sync.
   */
  public setSync<T>(collection: StorageCollection, value: T): void {
    this.memoryCache.set(collection, value)

    try {
      this.ensureDataDir()
      const filePath = path.join(DATA_DIR, `${collection}.json`)
      fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf-8')
    } catch {}

    // Async cloud backup
    if (this.isNetlifyBlobsAvailable || this.isSupabaseAvailable) {
      this.set(collection, value).catch(() => {})
    }
  }
}

export const dbService = new DatabaseService()
