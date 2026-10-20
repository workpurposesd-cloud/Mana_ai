import OpenAI from 'openai'
import { configService } from './configService.js'
import { GeneratedImageMetadata } from '../types.js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

export interface ImageGenerationOptions {
  prompt: string
  aspectRatio?: '1:1' | '16:9' | '9:16'
  quality?: 'standard' | 'hd'
  provider?: 'openai' | 'pollinations'
}

function resolveMediaDir(): string {
  if (process.env.MEDIA_DIR) return process.env.MEDIA_DIR
  if (process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME) return path.join('/tmp', 'media')
  try {
    if (typeof __dirname !== 'undefined') return path.resolve(__dirname, '../data/media')
    if (typeof import.meta !== 'undefined' && import.meta.url) {
      return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/media')
    }
  } catch {}
  return path.resolve(process.cwd(), 'server', 'data', 'media')
}

const MEDIA_DIR = resolveMediaDir()

function ensureMediaDir(): string {
  if (!fs.existsSync(MEDIA_DIR)) {
    try {
      fs.mkdirSync(MEDIA_DIR, { recursive: true })
    } catch (e) {
      console.warn('[ImageService] Failed to create MEDIA_DIR:', e)
    }
  }
  return MEDIA_DIR
}

/**
 * Service for generating authentic AI images using OpenAI DALL-E 3 or Pollinations Flux.
 * Never uses fake photos, mock images, or pre-rendered static placeholders.
 */
export async function generateAIImage(options: ImageGenerationOptions): Promise<GeneratedImageMetadata> {
  const { prompt, aspectRatio = '1:1', quality = 'standard', provider } = options

  const cleanPrompt = prompt.trim()
  if (!cleanPrompt) {
    throw new Error('Please enter a description for the image you want to generate.')
  }

  const config = configService.getConfig()
  const activeOpenAIKey = config.openaiApiKey || process.env.OPENAI_API_KEY
  const chosenProvider = provider || (activeOpenAIKey ? 'openai' : 'pollinations')

  ensureMediaDir()

  // 1. OpenAI DALL-E 3 API
  if (chosenProvider === 'openai' && activeOpenAIKey) {
    try {
      const openai = new OpenAI({ apiKey: activeOpenAIKey })

      // Map aspect ratios to DALL-E 3 supported dimensions
      let size: '1024x1024' | '1792x1024' | '1024x1792' = '1024x1024'
      let width = 1024
      let height = 1024

      if (aspectRatio === '16:9') {
        size = '1792x1024'
        width = 1792
        height = 1024
      } else if (aspectRatio === '9:16') {
        size = '1024x1792'
        width = 1024
        height = 1792
      }

      console.log(`[ImageService] Generating with OpenAI DALL-E 3: "${cleanPrompt.slice(0, 60)}..." (${size}, ${quality})`)

      const response = await openai.images.generate({
        model: 'dall-e-3',
        prompt: cleanPrompt,
        size,
        quality: quality === 'hd' ? 'hd' : 'standard',
        n: 1,
      })

      const imageItem = response.data?.[0]
      if (!imageItem?.url) {
        throw new Error('OpenAI did not return an image URL.')
      }

      // Download and cache OpenAI image locally so URL never expires
      const localFilename = `img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.png`
      const localFilePath = path.join(MEDIA_DIR, localFilename)

      try {
        const imgRes = await fetch(imageItem.url)
        if (imgRes.ok) {
          const buf = Buffer.from(await imgRes.arrayBuffer())
          fs.writeFileSync(localFilePath, buf)
          return {
            url: `/api/media/${localFilename}`,
            prompt: cleanPrompt,
            revisedPrompt: imageItem.revised_prompt || undefined,
            aspectRatio,
            quality,
            provider: 'OpenAI DALL-E 3',
            width,
            height,
            createdAt: new Date().toISOString(),
          }
        }
      } catch (cacheErr) {
        console.warn('[ImageService] Failed to cache OpenAI image locally, using remote URL:', cacheErr)
      }

      return {
        url: imageItem.url,
        prompt: cleanPrompt,
        revisedPrompt: imageItem.revised_prompt || undefined,
        aspectRatio,
        quality,
        provider: 'OpenAI DALL-E 3',
        width,
        height,
        createdAt: new Date().toISOString(),
      }
    } catch (err: any) {
      console.error('[ImageService] OpenAI generation error:', err.message)
      if (err.status === 401) {
        throw new Error('Invalid OpenAI API Key. Please check your key in Settings.')
      } else if (err.status === 429) {
        throw new Error('OpenAI rate limit or quota exceeded. Please check your OpenAI account billing or try again in a moment.')
      } else if (err.message && err.message.includes('safety system')) {
        throw new Error('The prompt was flagged by OpenAI safety filters. Please adjust the prompt and try again.')
      }
      throw new Error(`OpenAI image generation failed: ${err.message || 'Unknown error'}`)
    }
  }

  // 2. Pollinations AI (Zero-Key AI Image Diffusion)
  let width = 1024
  let height = 1024

  if (aspectRatio === '16:9') {
    width = 1280
    height = 720
  } else if (aspectRatio === '9:16') {
    width = 720
    height = 1280
  }

  // Enhance the prompt for diffusion synthesis
  let enhancedPrompt = cleanPrompt
  if (!/(realistic|photorealistic|detailed|cinematic|portrait|quality|rendering)/i.test(cleanPrompt)) {
    enhancedPrompt = `${cleanPrompt}, highly detailed, cinematic lighting, 8k resolution`
  }

  console.log(`[ImageService] Submitting to Pollinations AI: "${enhancedPrompt.slice(0, 60)}" (${width}x${height})`)
  const candidateModels = ['flux', 'turbo']
  let lastErrorMsg = ''

  for (const model of candidateModels) {
    const seed = Math.floor(Math.random() * 1000000)
    const encodedPrompt = encodeURIComponent(enhancedPrompt)
    const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&seed=${seed}&nologo=true&model=${model}`

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 20000)

    try {
      const res = await fetch(imageUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'ManaAI/1.0',
          'Accept': 'image/jpeg,image/png,image/*,*/*',
        },
      })
      clearTimeout(timeout)

      if (res.status === 402 || res.status === 429) {
        lastErrorMsg = 'Pollinations AI free tier is currently rate-limited (1 request per 30 seconds per IP). Please wait a moment and try again, or add an OpenAI API Key in Settings for instant DALL-E 3 generations.'
        console.warn(`[ImageService] Pollinations ${model} rate-limited (${res.status})`)
        continue
      }

      if (!res.ok) {
        lastErrorMsg = `Pollinations ${model} returned HTTP ${res.status}`
        console.warn(`[ImageService] ${lastErrorMsg}`)
        continue
      }

      const buf = Buffer.from(await res.arrayBuffer())

      if (buf.length < 5000) {
        const textPreview = buf.toString('utf-8').slice(0, 200)
        if (textPreview.includes('FREE_LIMIT') || textPreview.includes('limit') || textPreview.startsWith('{')) {
          lastErrorMsg = 'Pollinations AI free tier limit reached. Please wait 30 seconds and try again, or configure an OpenAI API Key in Settings.'
          continue
        }
      }

      const localFilename = `img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`
      try {
        fs.writeFileSync(path.join(MEDIA_DIR, localFilename), buf)
        return {
          url: `/api/media/${localFilename}`,
          prompt: cleanPrompt,
          aspectRatio,
          quality: quality || 'standard',
          provider: `Pollinations AI (${model.toUpperCase()})`,
          width,
          height,
          createdAt: new Date().toISOString(),
        }
      } catch (writeErr) {
        console.warn('[ImageService] Failed to cache locally, returning direct data URI:', writeErr)
        // If filesystem write fails (e.g. strict readonly), return data URI
        const base64Data = buf.toString('base64')
        return {
          url: `data:image/jpeg;base64,${base64Data}`,
          prompt: cleanPrompt,
          aspectRatio,
          quality: quality || 'standard',
          provider: `Pollinations AI (${model.toUpperCase()})`,
          width,
          height,
          createdAt: new Date().toISOString(),
        }
      }
    } catch (fetchErr: any) {
      clearTimeout(timeout)
      if (fetchErr.name === 'AbortError') {
        lastErrorMsg = 'Image generation request timed out after 20 seconds. The model cluster is under high load. Please try again.'
      } else {
        lastErrorMsg = fetchErr.message || 'Network error contacting image generation cluster.'
      }
      console.warn(`[ImageService] Pollinations ${model} fetch failed:`, lastErrorMsg)
    }
  }

  throw new Error(
    lastErrorMsg ||
      'AI Image generation is temporarily busy or rate-limited. Please retry in 30 seconds, or provide an OpenAI API key in Settings to use DALL-E 3 directly.'
  )
}
