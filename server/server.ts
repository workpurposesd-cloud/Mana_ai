import express from 'express'
import cors from 'cors'
import rateLimit from 'express-rate-limit'
import fs from 'fs'
import path from 'path'
import { configService } from './services/configService.js'
import { classifyIntent } from './services/intentClassifier.js'
import { executeWebSearch, fetchWikipediaKnowledge } from './services/searchService.js'
import { generateAIResponse } from './services/aiService.js'
import { memoryService } from './services/memoryService.js'
import { authService } from './services/authService.js'
import { chatHistoryService } from './services/chatHistoryService.js'
import { generateAIImage } from './services/imageService.js'
import { startVideoJob, getVideoJob, syncAndGetVideoJob, PROVIDER_RESTRICTIONS } from './services/videoService.js'
import { documentService } from './services/documentService.js'
import { executeTool, AVAILABLE_TOOLS } from './services/toolService.js'
import { SearchEvidence } from './types.js'

const app = express()
const PORT = process.env.PORT || 3001

const MEDIA_DIR = process.env.MEDIA_DIR || (process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME ? path.join('/tmp', 'media') : path.resolve(process.cwd(), 'server', 'data', 'media'))
if (!fs.existsSync(MEDIA_DIR)) {
  try {
    fs.mkdirSync(MEDIA_DIR, { recursive: true })
  } catch {}
}

// Middleware
app.use(
  cors({
    origin: true,
    credentials: true,
  })
)
app.use(express.json({ limit: '5mb' }))

// Normalize Netlify serverless function path prefixes so routes match seamlessly
app.use((req, _res, next) => {
  if (req.url.startsWith('/.netlify/functions/api')) {
    req.url = req.url.replace('/.netlify/functions/api', '/api')
  } else if (!req.url.startsWith('/api') && !req.url.startsWith('/.netlify')) {
    req.url = '/api' + (req.url.startsWith('/') ? req.url : '/' + req.url)
  }
  next()
})

// Serve static media (images, video previews) with correct MIME types for all formats
app.use('/api/media', express.static(MEDIA_DIR, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.webm')) {
      res.setHeader('Content-Type', 'video/webm')
    } else if (filePath.endsWith('.mp4')) {
      res.setHeader('Content-Type', 'video/mp4')
    } else if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) {
      res.setHeader('Content-Type', 'image/jpeg')
    } else if (filePath.endsWith('.png')) {
      res.setHeader('Content-Type', 'image/png')
    }
    // Allow byte-range requests for video seeking
    res.setHeader('Accept-Ranges', 'bytes')
  }
}))

// Rate limiting: 60 requests per minute
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a moment before sending another query.' },
})
app.use('/api/', apiLimiter)

// Helper to extract active user from Authorization header
function getAuthUser(req: express.Request) {
  const authHeader = req.headers.authorization
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    return authService.verifyToken(token)
  }
  return null
}

// Helper to extract isolated client ID (Authenticated user ID or distinct guest ID)
function getClientId(req: express.Request): string {
  const user = getAuthUser(req)
  if (user) return user.id
  const guestHeader = req.headers['x-guest-id']
  if (typeof guestHeader === 'string' && guestHeader.trim()) {
    return `guest:${guestHeader.trim().slice(0, 48)}`
  }
  return 'guest:default'
}

/**
 * Auth Endpoints: Sign Up, Login, Me
 */
app.post('/api/auth/signup', (req, res) => {
  try {
    const { name, email, password } = req.body
    if (!name || !email || !password) {
      res.status(400).json({ error: 'Name, email, and password are required' })
      return
    }
    const result = authService.signup(name, email, password)
    res.json({ success: true, ...result })
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

app.post('/api/auth/login', (req, res) => {
  try {
    const { email, password } = req.body
    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' })
      return
    }
    const result = authService.login(email, password)
    res.json({ success: true, ...result })
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

app.get('/api/auth/me', (req, res) => {
  const user = getAuthUser(req)
  if (!user) {
    res.status(401).json({ error: 'Not authenticated' })
    return
  }
  res.json({ success: true, user })
})

/**
 * Chat Sessions & History Endpoints
 */
app.get('/api/chats', (req, res) => {
  const userId = getClientId(req)
  const filterQuery = (req.query.q as string) || ''
  const sessions = chatHistoryService.getUserSessions(userId, filterQuery)
  res.json({ success: true, sessions })
})

app.post('/api/chats', (req, res) => {
  const userId = getClientId(req)
  const { title, firstMessage } = req.body
  const session = chatHistoryService.createSession(userId, firstMessage || title)
  res.json({ success: true, session })
})

app.get('/api/chats/:id', (req, res) => {
  const userId = getClientId(req)
  const session = chatHistoryService.getSession(userId, req.params.id)
  if (!session) {
    res.status(404).json({ error: 'Chat session not found' })
    return
  }
  res.json({ success: true, session })
})

app.post('/api/chats/:id/messages', (req, res) => {
  const userId = getClientId(req)
  const { messages } = req.body
  if (!Array.isArray(messages)) {
    res.status(400).json({ error: 'Messages array is required' })
    return
  }
  const session = chatHistoryService.saveMessages(userId, req.params.id, messages)
  res.json({ success: true, session })
})

app.delete('/api/chats/:id', (req, res) => {
  const userId = getClientId(req)
  const deleted = chatHistoryService.deleteSession(userId, req.params.id)
  res.json({ success: deleted })
})

app.put('/api/chats/:id/title', (req, res) => {
  const userId = getClientId(req)
  const { title } = req.body
  if (!title) {
    res.status(400).json({ error: 'Title is required' })
    return
  }
  const session = chatHistoryService.renameSession(userId, req.params.id, title)
  res.json({ success: !!session, session })
})

/**
 * Health check endpoint
 */
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    app: 'Mana AI Backend',
    serverTime: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
  })
})

/**
 * Get active configuration (API keys masked)
 */
app.get('/api/config', (_req, res) => {
  res.json(configService.getMaskedConfig())
})

/**
 * Update configuration
 */
app.post('/api/config', (req, res) => {
  try {
    const updated = configService.updateConfig(req.body)
    res.json({ success: true, config: configService.getMaskedConfig() })
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

/**
 * Memory Management Endpoints
 */
app.get('/api/memories', (_req, res) => {
  res.json({ success: true, memories: memoryService.getMemories() })
})

app.post('/api/memories', (req, res) => {
  try {
    const { category, key, value } = req.body
    if (!key || !value) {
      res.status(400).json({ error: 'Key and value are required' })
      return
    }
    const memory = memoryService.addMemory(category || 'preference', key, value)
    res.json({ success: true, memory })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

app.put('/api/memories/:id', (req, res) => {
  try {
    const { id } = req.params
    const { value } = req.body
    if (!value) {
      res.status(400).json({ error: 'Value is required' })
      return
    }
    const updated = memoryService.updateMemory(id, value)
    if (!updated) {
      res.status(404).json({ error: 'Memory item not found' })
      return
    }
    res.json({ success: true, memory: updated })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

app.delete('/api/memories/:id', (req, res) => {
  try {
    const { id } = req.params
    const deleted = memoryService.deleteMemory(id)
    res.json({ success: deleted })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

app.delete('/api/memories', (_req, res) => {
  try {
    memoryService.clearAllMemories()
    res.json({ success: true, message: 'All memories cleared' })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * Knowledge & Document RAG Endpoints
 */
app.get('/api/documents', (_req, res) => {
  res.json({ success: true, documents: documentService.listDocuments() })
})

app.post('/api/documents/upload', async (req, res) => {
  try {
    const { title, originalName, mimeType, content, base64 } = req.body
    if (!title || (!content && !base64)) {
      res.status(400).json({ error: 'Title and document content/base64 are required' })
      return
    }

    let fileContent: string | Buffer = content
    if (base64) {
      fileContent = Buffer.from(base64, 'base64')
    }

    const doc = await documentService.addDocument({
      title,
      originalName: originalName || title,
      mimeType: mimeType || 'text/plain',
      content: fileContent,
    })

    res.json({ success: true, document: doc })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/documents/search', (req, res) => {
  try {
    const { query, limit = 4 } = req.body
    if (!query) {
      res.status(400).json({ error: 'Query is required' })
      return
    }
    const matches = documentService.searchKnowledge(query, limit)
    res.json({ success: true, matches })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

app.delete('/api/documents/:id', (req, res) => {
  try {
    const deleted = documentService.deleteDocument(req.params.id)
    res.json({ success: deleted })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

app.delete('/api/documents', (_req, res) => {
  try {
    documentService.clearAllDocuments()
    res.json({ success: true, message: 'All knowledge documents cleared' })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * Safe Structured Tool Execution Endpoints
 */
app.get('/api/tools', (_req, res) => {
  res.json({ success: true, tools: AVAILABLE_TOOLS })
})

app.post('/api/tools/execute', async (req, res) => {
  try {
    const { name, arguments: args } = req.body
    if (!name) {
      res.status(400).json({ error: 'Tool name is required' })
      return
    }
    const result = await executeTool(name, args || {})
    res.json({ success: result.success, result })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * User Feedback Endpoint (👍 / 👎)
 */
app.post('/api/feedback', (req, res) => {
  try {
    const { messageId, prompt, response, rating, comment } = req.body
    if (!rating) {
      res.status(400).json({ error: 'Rating is required' })
      return
    }
    const feedback = memoryService.recordFeedback({
      messageId: messageId || `msg-${Date.now()}`,
      prompt: prompt || '',
      response: response || '',
      rating,
      comment,
    })
    res.json({ success: true, feedback })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * Direct standalone search endpoint
 */
app.post('/api/search', async (req, res) => {
  try {
    const { query, provider } = req.body
    if (!query) {
      res.status(400).json({ error: 'Query parameter is required' })
      return
    }

    const config = configService.getConfig()
    const activeProvider = provider || config.searchProvider

    const evidence = await executeWebSearch(query, activeProvider, {
      tavily: config.tavilyApiKey,
      serper: config.serperApiKey,
      brave: config.braveApiKey,
    })

    res.json({ success: true, evidence })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * Streaming Chat Endpoint using Server-Sent Events (SSE)
 */
app.post('/api/chat/stream', async (req, res) => {
  const { prompt, history = [], searchMode: reqSearchMode, reasoningMode: reqReasoningMode } = req.body

  if (!prompt || typeof prompt !== 'string') {
    res.status(400).json({ error: 'Valid prompt string is required' })
    return
  }

  // Setup SSE Headers
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()

  const sendEvent = (event: string, data: any) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  const authUser = getAuthUser(req)
  const config = configService.getConfig()
  if (authUser?.geminiApiKey && !config.geminiApiKey) {
    config.geminiApiKey = authUser.geminiApiKey
  }
  const searchMode = reqSearchMode || config.searchMode || 'auto'
  const reasoningMode = reqReasoningMode || config.reasoningMode || 'fast'
  const isMemoryEnabled = config.memoryEnabled !== false

  // Step 1: Detect and save user preferences/learnings automatically if memory is enabled
  const learnedMemory = memoryService.detectAndSaveUserPreferences(prompt, isMemoryEnabled)
  if (learnedMemory) {
    sendEvent('memory_saved', learnedMemory)
  }

  // Retrieve relevant user memories to personalize the answer
  const relevantMemories = memoryService.getRelevantMemories(prompt, isMemoryEnabled)

  // Retrieve relevant user knowledge documents (RAG)
  const documentMatches = documentService.searchKnowledge(prompt, 3)

  // Step 2: Intent classification with conversational context
  const conversationContext = history.map((h: any) => `${h.role}: ${h.content}`)
  const intent = classifyIntent(prompt, conversationContext)
  const shouldSearch =
    (searchMode === 'always' && intent.category !== 'conversational') ||
    (searchMode === 'auto' && intent.needsSearch)

  let searchEvidence: SearchEvidence | undefined

  try {
    if (shouldSearch) {
      sendEvent('search_start', {
        query: intent.refinedQuery,
        reason: intent.reason,
        category: intent.category,
      })

      sendEvent('search_status', {
        status: `Searching live web via ${config.searchProvider}...`,
        step: 'retrieving',
      })

      searchEvidence = await executeWebSearch(
        intent.refinedQuery,
        config.searchProvider,
        {
          tavily: config.tavilyApiKey,
          serper: config.serperApiKey,
          brave: config.braveApiKey,
        }
      )

      sendEvent('search_status', {
        status: 'Filtering & verifying sources...',
        step: 'filtering',
      })

      sendEvent('search_results', searchEvidence)
    }

    sendEvent('search_status', {
      status: reasoningMode === 'thinking' ? 'Deep reasoning & calculating...' : 'Thinking...',
      step: 'generating',
    })

    // Step 3: Stream AI response with full multi-turn history, memories, reasoning, & documents
    let accumulatedContent = ''
    await generateAIResponse({
      prompt,
      history,
      searchEvidence,
      memories: relevantMemories,
      isDetailRequested: intent.isDetailRequested,
      config,
      reasoningMode,
      documentMatches,
      onToken: (token: string) => {
        accumulatedContent += token
        sendEvent('token', { token })
      },
    })

    // Step 4: Complete event
    sendEvent('done', {
      content: accumulatedContent,
      searchEvidence,
      isSearchPerformed: shouldSearch || !!searchEvidence,
      intent,
      memoriesUsed: relevantMemories.map((m) => m.key),
      documentsUsed: documentMatches.map((d) => d.docTitle),
      reasoningMode,
    })

    res.end()
  } catch (err: any) {
    console.error('[Server] Chat stream error:', err)
    sendEvent('error', {
      message: err.message || 'An error occurred during response generation.',
    })
    res.end()
  }
})

/**
 * Standard Non-streaming Chat Endpoint
 */
app.post('/api/chat', async (req, res) => {
  try {
    const { prompt, history = [], searchMode: reqSearchMode, reasoningMode: reqReasoningMode } = req.body
    if (!prompt) {
      res.status(400).json({ error: 'Prompt is required' })
      return
    }

    const config = configService.getConfig()
    const searchMode = reqSearchMode || config.searchMode || 'auto'
    const reasoningMode = reqReasoningMode || config.reasoningMode || 'fast'
    const isMemoryEnabled = config.memoryEnabled !== false

    memoryService.detectAndSaveUserPreferences(prompt, isMemoryEnabled)
    const relevantMemories = memoryService.getRelevantMemories(prompt, isMemoryEnabled)
    const documentMatches = documentService.searchKnowledge(prompt, 3)

    const conversationContext = history.map((h: any) => `${h.role}: ${h.content}`)
    const intent = classifyIntent(prompt, conversationContext)
    const shouldSearch =
      (searchMode === 'always' && intent.category !== 'conversational') ||
      (searchMode === 'auto' && intent.needsSearch)

    let searchEvidence: SearchEvidence | undefined

    if (shouldSearch) {
      searchEvidence = await executeWebSearch(
        intent.refinedQuery,
        config.searchProvider,
        {
          tavily: config.tavilyApiKey,
          serper: config.serperApiKey,
          brave: config.braveApiKey,
        }
      )
    }

    const content = await generateAIResponse({
      prompt,
      history,
      searchEvidence,
      memories: relevantMemories,
      isDetailRequested: intent.isDetailRequested,
      config,
      reasoningMode,
      documentMatches,
    })

    res.json({
      success: true,
      content,
      searchEvidence,
      isSearchPerformed: shouldSearch || !!searchEvidence,
      intent,
      memoriesUsed: relevantMemories.map((m) => m.key),
      documentsUsed: documentMatches.map((d) => d.docTitle),
      reasoningMode,
    })
  } catch (err: any) {
    console.error('[Server] Chat error:', err)
    res.status(500).json({ error: err.message })
  }
})

/**
 * AI Image Generation Endpoint
 */
app.post('/api/generate/image', async (req, res) => {
  try {
    const { prompt, aspectRatio, quality, provider } = req.body
    if (!prompt || typeof prompt !== 'string') {
      res.status(400).json({ error: 'Prompt is required for image generation.' })
      return
    }

    const image = await generateAIImage({
      prompt,
      aspectRatio,
      quality,
      provider,
    })

    res.json({ success: true, image })
  } catch (err: any) {
    console.error('[Server] Image generation endpoint error:', err.message)
    res.status(500).json({ error: err.message || 'Image generation failed.' })
  }
})

/**
 * AI Video Generation Endpoints
 */
app.post('/api/generate/video', async (req, res) => {
  try {
    const { prompt, aspectRatio, duration, provider } = req.body
    if (!prompt || typeof prompt !== 'string') {
      res.status(400).json({ error: 'Prompt is required for video generation.' })
      return
    }

    const job = await startVideoJob({
      prompt,
      aspectRatio,
      duration,
      provider,
    })

    res.json({ success: true, job })
  } catch (err: any) {
    console.error('[Server] Video job submission error:', err.message)
    res.status(500).json({ error: err.message || 'Video generation job failed.' })
  }
})

app.get('/api/generate/video/status/:jobId', async (req, res) => {
  const { jobId } = req.params
  const job = await syncAndGetVideoJob(jobId)
  if (!job) {
    res.status(404).json({ error: 'Video generation job not found.' })
    return
  }
  res.json({ success: true, job })
})

app.get('/api/generate/video/:jobId', async (req, res) => {
  const { jobId } = req.params
  const job = await syncAndGetVideoJob(jobId)
  if (!job) {
    res.status(404).json({ error: 'Video generation job not found.' })
    return
  }
  res.json({ success: true, job })
})

app.get('/api/video/restrictions', (_req, res) => {
  res.json({ success: true, restrictions: PROVIDER_RESTRICTIONS })
})

// Start server if run directly (not as a serverless function)
if (!process.env.NETLIFY && !process.env.AWS_LAMBDA_FUNCTION_NAME) {
  app.listen(PORT, () => {
    console.log(`✨ Mana AI Server running on http://localhost:${PORT}`)
    console.log(`🤖 Active AI Provider: ${configService.getConfig().aiProvider}`)
    console.log(`🔎 Active Search Provider: ${configService.getConfig().searchProvider}`)
  })
}

export { app }
export default app
