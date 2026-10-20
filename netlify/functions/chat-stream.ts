import { stream } from '@netlify/functions'
import { PassThrough } from 'node:stream'
import { connectLambda } from '@netlify/blobs'
import { configService } from '../../server/services/configService.js'
import { memoryService } from '../../server/services/memoryService.js'
import { documentService } from '../../server/services/documentService.js'
import { classifyIntent } from '../../server/services/intentClassifier.js'
import { executeWebSearch } from '../../server/services/searchService.js'
import { generateAIResponse } from '../../server/services/aiService.js'
import { authService } from '../../server/services/authService.js'
import { SearchEvidence } from '../../server/types.js'

export const handler = stream(async (event, _context) => {
  // Connect Netlify Blobs runtime context
  try {
    connectLambda(event)
  } catch {}

  const reqStart = Date.now()
  let body: any = {}
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid JSON body' }),
    }
  }

  const { prompt, history = [], searchMode: reqSearchMode, reasoningMode: reqReasoningMode } = body

  if (!prompt || typeof prompt !== 'string') {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Valid prompt string is required' }),
    }
  }

  // Extract auth credentials if present
  const authHeader = event.headers?.['authorization'] || event.headers?.['Authorization']
  let authUser: any = null
  if (authHeader && authHeader.startsWith('Bearer ')) {
    authUser = authService.verifyToken(authHeader.slice(7))
  }

  const config = configService.getConfig()
  if (authUser?.geminiApiKey && !config.geminiApiKey) {
    config.geminiApiKey = authUser.geminiApiKey
  }

  const searchMode = reqSearchMode || config.searchMode || 'auto'
  const reasoningMode = reqReasoningMode || config.reasoningMode || 'fast'
  const isMemoryEnabled = config.memoryEnabled !== false

  // Step 1: Detect user memory and retrieve knowledge
  const learnedMemory = memoryService.detectAndSaveUserPreferences(prompt, isMemoryEnabled)
  const relevantMemories = memoryService.getRelevantMemories(prompt, isMemoryEnabled)
  const documentMatches = documentService.searchKnowledge(prompt, 3)

  // Step 2: Intent classification with full conversation history
  const intent = classifyIntent(prompt, history)
  const shouldSearch =
    searchMode !== 'never' &&
    !intent.isCorrectionOrFeedback &&
    intent.category !== 'conversational' &&
    ((searchMode === 'always' && intent.category !== 'contextual_followup') ||
     (searchMode === 'auto' && intent.needsSearch))

  const passThrough = new PassThrough()

  const sendEvent = (eventType: string, data: any) => {
    passThrough.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  // Run generation asynchronously and pipe chunks directly into the HTTP stream
  ;(async () => {
    try {
      if (learnedMemory) {
        sendEvent('memory_saved', learnedMemory)
      }

      let searchEvidence: SearchEvidence | undefined

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

      let accumulatedContent = ''
      let firstTokenTime: number | null = null

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
          if (!firstTokenTime) {
            firstTokenTime = Date.now() - reqStart
          }
          accumulatedContent += token
          sendEvent('token', { token })
        },
      })

      const totalTime = Date.now() - reqStart

      sendEvent('done', {
        content: accumulatedContent,
        searchEvidence,
        isSearchPerformed: shouldSearch || !!searchEvidence,
        intent,
        memoriesUsed: relevantMemories.map((m) => m.key),
        documentsUsed: documentMatches.map((d) => d.docTitle),
        reasoningMode,
        timings: {
          reqStart,
          ttftMs: firstTokenTime || totalTime,
          totalMs: totalTime,
          isStreaming: true,
        },
      })

      passThrough.end()
    } catch (err: any) {
      sendEvent('error', {
        message: err.message || 'An error occurred during response generation.',
      })
      passThrough.end()
    }
  })()

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
    body: passThrough,
  }
})
