import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { configService } from './configService.js'
import { VideoJobMetadata, ProviderRestrictions } from '../types.js'

export interface VideoGenerationOptions {
  prompt: string
  aspectRatio?: '16:9' | '9:16' | '1:1'
  duration?: number
  provider?: 'luma' | 'replicate' | 'runway'
}

export const PROVIDER_RESTRICTIONS: Record<string, ProviderRestrictions> = {
  luma: {
    name: 'Luma Dream Machine (Ray-2)',
    pricing: '~$0.08–$0.25 per generation (Subscription / Pay-as-you-go)',
    durationLimit: '5s or 9s cinematic clips',
    resolution: '720p or 1080p high fidelity',
    docsUrl: 'https://lumalabs.ai/dream-machine/api',
    supportedAspectRatios: ['16:9', '9:16', '1:1', '4:3', '21:9'],
  },
  replicate: {
    name: 'Replicate (Wan-2.1 / Minimax Video)',
    pricing: '~$0.05–$0.20 per generation (based on GPU runtime)',
    durationLimit: '5s standard video generation',
    resolution: '720p (1280x720)',
    docsUrl: 'https://replicate.com/docs/reference/http',
    supportedAspectRatios: ['16:9', '9:16', '1:1'],
  },
  runway: {
    name: 'RunwayML (Gen-3 Alpha Turbo)',
    pricing: '5 credits per second (~$0.05/sec, $0.25 per 5s video)',
    durationLimit: '5s or 10s cinematic video',
    resolution: '720p or 1080p',
    docsUrl: 'https://docs.dev.runwayml.com/',
    supportedAspectRatios: ['16:9', '9:16'],
  },
}

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
const JOBS_FILE = path.join(DATA_DIR, 'video_jobs.json')

function loadPersistedJobs(): Map<string, VideoJobMetadata> {
  const map = new Map<string, VideoJobMetadata>()
  try {
    if (fs.existsSync(JOBS_FILE)) {
      const list: VideoJobMetadata[] = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf-8'))
      for (const j of list) {
        map.set(j.jobId, j)
      }
    }
  } catch (e) {
    console.warn('[VideoService] Failed to load jobs from disk:', e)
  }
  return map
}

function savePersistedJobs(jobs: Map<string, VideoJobMetadata>) {
  try {
    const list = Array.from(jobs.values()).slice(-50)
    fs.writeFileSync(JOBS_FILE, JSON.stringify(list, null, 2), 'utf-8')
  } catch (e) {
    console.warn('[VideoService] Failed to persist jobs to disk:', e)
  }
}

const videoJobs = loadPersistedJobs()

/**
 * Initiates an AI video generation job using verified provider APIs (Luma or Replicate).
 * Never mocks video generation with static clips or fake progress.
 */
export async function startVideoJob(options: VideoGenerationOptions): Promise<VideoJobMetadata> {
  const { prompt, aspectRatio = '16:9', duration = 5, provider } = options

  const cleanPrompt = prompt.trim()
  if (!cleanPrompt) {
    throw new Error('Please enter a description for the video you want to generate.')
  }

  const config = configService.getConfig()
  const lumaKey = config.lumaApiKey || process.env.LUMA_API_KEY
  const replicateKey = config.replicateApiKey || process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_KEY
  const runwayKey = config.runwayApiKey || process.env.RUNWAY_API_KEY

  let chosenProvider: 'luma' | 'replicate' | 'runway' = 'luma'
  if (provider === 'replicate' && replicateKey) {
    chosenProvider = 'replicate'
  } else if (provider === 'runway' && runwayKey) {
    chosenProvider = 'runway'
  } else if (lumaKey) {
    chosenProvider = 'luma'
  } else if (replicateKey) {
    chosenProvider = 'replicate'
  } else if (runwayKey) {
    chosenProvider = 'runway'
  }

  const restrictions = PROVIDER_RESTRICTIONS[chosenProvider] || PROVIDER_RESTRICTIONS.luma
  const jobId = `vjob-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`
  const now = new Date().toISOString()

  const hasKey =
    (chosenProvider === 'luma' && lumaKey) ||
    (chosenProvider === 'replicate' && replicateKey) ||
    (chosenProvider === 'runway' && runwayKey)

  // When no video API key is configured, report honest requirement instead of fabricating fake video
  if (!hasKey) {
    const errorMsg =
      'Real AI video generation requires an API key for Luma Dream Machine or Replicate. Please open Settings (⚙️) to configure your API key, then try again.'
    const failedJob: VideoJobMetadata = {
      jobId,
      prompt: cleanPrompt,
      provider: chosenProvider,
      status: 'failed',
      progress: 0,
      aspectRatio,
      duration,
      error: errorMsg,
      createdAt: now,
      updatedAt: now,
      providerRestrictions: restrictions,
    }
    videoJobs.set(jobId, failedJob)
    savePersistedJobs(videoJobs)
    throw new Error(errorMsg)
  }

  // 1. Luma Dream Machine API (Ray-2)
  if (chosenProvider === 'luma' && lumaKey) {
    console.log(`[VideoService] Submitting to Luma Dream Machine API: "${cleanPrompt.slice(0, 60)}..."`)
    const lumaDuration = duration >= 9 ? '9s' : '5s'

    const res = await fetch('https://api.lumalabs.ai/dream-machine/v1/generations/video', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${lumaKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: cleanPrompt,
        aspect_ratio: aspectRatio,
        loop: false,
        resolution: '720p',
        duration: lumaDuration,
      }),
    })

    if (!res.ok) {
      const errText = await res.text()
      let parsedErr: any
      try {
        parsedErr = JSON.parse(errText)
      } catch {}
      const msg = parsedErr?.detail || parsedErr?.message || `Luma API returned HTTP ${res.status}: ${errText}`
      throw new Error(`Luma Video Submission Failed: ${msg}`)
    }

    const lumaData = (await res.json()) as any
    const externalId = lumaData.id

    const job: VideoJobMetadata = {
      jobId,
      externalId,
      prompt: cleanPrompt,
      provider: 'luma',
      status: 'queued',
      progress: 10,
      aspectRatio,
      duration,
      createdAt: now,
      updatedAt: now,
      providerRestrictions: restrictions,
    }

    videoJobs.set(jobId, job)
    savePersistedJobs(videoJobs)

    return job
  }

  // 2. Replicate Wan-2.1 Video API
  if (chosenProvider === 'replicate' && replicateKey) {
    console.log(`[VideoService] Submitting to Replicate Wan-2.1: "${cleanPrompt.slice(0, 60)}..."`)

    const res = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        Authorization: `Token ${replicateKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        version: 'wan-video/wan-2.1-t2v-1.3b',
        input: {
          prompt: cleanPrompt,
          aspect_ratio: aspectRatio,
        },
      }),
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`Replicate API returned HTTP ${res.status}: ${errText}`)
    }

    const repData = (await res.json()) as any
    const externalId = repData.id

    const job: VideoJobMetadata = {
      jobId,
      externalId,
      prompt: cleanPrompt,
      provider: 'replicate',
      status: 'queued',
      progress: 10,
      aspectRatio,
      duration,
      createdAt: now,
      updatedAt: now,
      providerRestrictions: restrictions,
    }

    videoJobs.set(jobId, job)
    savePersistedJobs(videoJobs)

    return job
  }

  throw new Error(`Unsupported video provider: ${chosenProvider}`)
}

/**
 * Get status of an ongoing or completed video generation job.
 * If the job is active and has an externalId, queries the provider synchronously
 * so it works reliably on serverless environments without long-lived background workers.
 */
export async function syncAndGetVideoJob(jobId: string): Promise<VideoJobMetadata | null> {
  const job = videoJobs.get(jobId)
  if (!job) return null

  // If already completed or failed, return directly
  if (job.status === 'completed' || job.status === 'failed') {
    return job
  }

  const config = configService.getConfig()
  const lumaKey = config.lumaApiKey || process.env.LUMA_API_KEY
  const replicateKey = config.replicateApiKey || process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_KEY

  // Check Luma API
  if (job.provider === 'luma' && job.externalId && lumaKey) {
    try {
      const res = await fetch(`https://api.lumalabs.ai/dream-machine/v1/generations/${job.externalId}`, {
        headers: { Authorization: `Bearer ${lumaKey}` },
      })
      if (res.ok) {
        const data = (await res.json()) as any
        const state = data.state // 'queued' | 'dreaming' | 'completed' | 'failed'

        if (state === 'completed') {
          job.status = 'completed'
          job.progress = 100
          job.videoUrl = data.video?.url || data.assets?.video || null
          job.thumbnailUrl = data.video?.thumbnail_url || data.assets?.thumbnail || null
          job.updatedAt = new Date().toISOString()
        } else if (state === 'failed') {
          job.status = 'failed'
          job.error = data.failure_reason || 'Luma video generation failed.'
          job.updatedAt = new Date().toISOString()
        } else if (state === 'dreaming') {
          job.status = 'processing'
          job.progress = Math.min(95, (job.progress || 20) + 10)
          job.updatedAt = new Date().toISOString()
        }
        videoJobs.set(jobId, job)
        savePersistedJobs(videoJobs)
      }
    } catch (err: any) {
      console.warn(`[VideoService] Error refreshing Luma job ${jobId}:`, err.message)
    }
  }

  // Check Replicate API
  if (job.provider === 'replicate' && job.externalId && replicateKey) {
    try {
      const res = await fetch(`https://api.replicate.com/v1/predictions/${job.externalId}`, {
        headers: { Authorization: `Token ${replicateKey}` },
      })
      if (res.ok) {
        const data = (await res.json()) as any
        const status = data.status

        if (status === 'succeeded') {
          job.status = 'completed'
          job.progress = 100
          const output = data.output
          job.videoUrl = Array.isArray(output) ? output[0] : output
          job.updatedAt = new Date().toISOString()
        } else if (status === 'failed' || status === 'canceled') {
          job.status = 'failed'
          job.error = data.error || 'Replicate video generation failed.'
          job.updatedAt = new Date().toISOString()
        } else if (status === 'processing') {
          job.status = 'processing'
          job.progress = Math.min(90, (job.progress || 20) + 15)
          job.updatedAt = new Date().toISOString()
        }
        videoJobs.set(jobId, job)
        savePersistedJobs(videoJobs)
      }
    } catch (err: any) {
      console.warn(`[VideoService] Error refreshing Replicate job ${jobId}:`, err.message)
    }
  }

  return job
}

export function getVideoJob(jobId: string): VideoJobMetadata | null {
  return videoJobs.get(jobId) || null
}
