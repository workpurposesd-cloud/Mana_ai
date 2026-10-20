import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { getStore } from '@netlify/blobs'
import { createClient } from '@supabase/supabase-js'

// Storage Collections
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
  private supabaseClient: any = null
  private supabaseChecked: boolean = false

  constructor() {
    this.ensureDataDir()
  }

  private ensureDataDir() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true })
      }
    } catch {}
  }

  public getSupabaseClient() {
    if (this.supabaseChecked) return this.supabaseClient
    this.supabaseChecked = true

    const supabaseUrl = process.env.SUPABASE_URL
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_KEY ||
      process.env.SUPABASE_ANON_KEY

    if (supabaseUrl && supabaseKey) {
      try {
        this.supabaseClient = createClient(supabaseUrl, supabaseKey, {
          auth: { persistSession: false },
        })
        console.log('[DBService] Supabase client initialized successfully.')
      } catch (err: any) {
        console.warn('[DBService] Supabase init error:', err.message)
      }
    }
    return this.supabaseClient
  }

  /**
   * Dynamically gets Netlify Blobs store using current runtime context
   */
  public getBlobsStore() {
    try {
      return getStore('mana-persistent-data')
    } catch {
      const siteID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID
      const token = process.env.NETLIFY_ACCESS_TOKEN || process.env.NETLIFY_AUTH_TOKEN
      if (siteID && token) {
        try {
          return getStore({
            name: 'mana-persistent-data',
            siteID,
            token,
          })
        } catch {}
      }
      return null
    }
  }

  public async get<T>(collection: StorageCollection, defaultValue: T): Promise<T> {
    if (this.memoryCache.has(collection)) {
      return this.memoryCache.get(collection) as T
    }
    return this.fetchFromProviders<T>(collection, defaultValue)
  }

  public async getFresh<T>(collection: StorageCollection, defaultValue: T): Promise<T> {
    this.memoryCache.delete(collection)
    return this.fetchFromProviders<T>(collection, defaultValue)
  }

  private async fetchFromProviders<T>(collection: StorageCollection, defaultValue: T): Promise<T> {
    // 1. Try Supabase
    const supabase = this.getSupabaseClient()
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('mana_storage')
          .select('value')
          .eq('collection', collection)
          .single()

        if (!error && data && data.value !== undefined) {
          this.memoryCache.set(collection, data.value)
          return data.value as T
        }
      } catch {}
    }

    // 2. Try Netlify Blobs
    const blobsStore = this.getBlobsStore()
    if (blobsStore) {
      try {
        let val: any = null
        try {
          val = await blobsStore.get(collection, { type: 'json', consistency: 'strong' })
        } catch {
          val = await blobsStore.get(collection, { type: 'json' })
        }
        if (val !== null && val !== undefined) {
          this.memoryCache.set(collection, val)
          return val as T
        }
      } catch (err: any) {
        console.warn(`[DBService] Netlify Blobs read error for ${collection}:`, err.message)
      }
    }

    // 3. Try Local File Storage
    try {
      const filePath = path.join(DATA_DIR, `${collection}.json`)
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf-8')
        const parsed = JSON.parse(raw)
        this.memoryCache.set(collection, parsed)
        return parsed as T
      }
    } catch (err: any) {
      console.warn(`[DBService] Local disk read error for ${collection}:`, err.message)
    }

    this.memoryCache.set(collection, defaultValue)
    return defaultValue
  }

  public async set<T>(collection: StorageCollection, value: T): Promise<void> {
    this.memoryCache.set(collection, value)

    // 1. Persist to local disk
    try {
      this.ensureDataDir()
      const filePath = path.join(DATA_DIR, `${collection}.json`)
      fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf-8')
    } catch {}

    // 2. Persist to Supabase if available
    const supabase = this.getSupabaseClient()
    if (supabase) {
      try {
        await supabase.from('mana_storage').upsert({
          collection,
          value,
          updated_at: new Date().toISOString(),
        })
      } catch (err: any) {
        console.warn(`[DBService] Supabase upsert error for ${collection}:`, err.message)
      }
    }

    // 3. Persist to Netlify Blobs if available
    const blobsStore = this.getBlobsStore()
    if (blobsStore) {
      try {
        await blobsStore.setJSON(collection, value)
      } catch (err: any) {
        console.warn(`[DBService] Netlify Blobs setJSON error for ${collection}:`, err.message)
      }
    }
  }

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

  public setSync<T>(collection: StorageCollection, value: T): void {
    this.memoryCache.set(collection, value)
    try {
      this.ensureDataDir()
      const filePath = path.join(DATA_DIR, `${collection}.json`)
      fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf-8')
    } catch {}

    // Async background cloud sync
    this.set(collection, value).catch(() => {})
  }
}

export const dbService = new DatabaseService()
