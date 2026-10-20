import type { Config, Context } from '@netlify/functions'
import { configService } from '../../server/services/configService.js'
import { memoryService } from '../../server/services/memoryService.js'
import { documentService } from '../../server/services/documentService.js'
import { classifyIntent } from '../../server/services/intentClassifier.js'
import { executeWebSearch } from '../../server/services/searchService.js'
import { generateAIResponse } from '../../server/services/aiService.js'
import { authService } from '../../server/services/authService.js'
import { chatHistoryService } from '../../server/services/chatHistoryService.js'
import { SearchEvidence } from '../../server/types.js'

export default async (req: Request, _context: Context): Promise<Response> => {
  // Only accept POST requests
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const reqStart = Date.now()
  let body: any
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const { prompt, history = [], searchMode: reqSearchMode, reasoningMode: reqReasoningMode } = body

  if (!prompt || typeof prompt !== 'string') {
    return new Response(JSON.stringify({ error: 'Valid prompt string is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Extract auth credentials if present
  const authHeader = req.headers.get('authorization')
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

  // Step 2: Intent classification
  const conversationContext = (history || []).slice(-4).map((h: any) => `${h.role}: ${h.content}`)
  const intent = classifyIntent(prompt, conversationContext)
  const shouldSearch =
    (searchMode === 'always' && intent.category !== 'conversational') ||
    (searchMode === 'auto' && intent.needsSearch)

  const encoder = new TextEncoder()

  // Build the unbuffered SSE ReadableStream
  const stream = new ReadableStream({
    async start(controller) {
      let isAborted = false
      req.signal?.addEventListener('abort', () => {
        isAborted = true
        try {
          controller.close()
        } catch {}
      })

      const sendEvent = (event: string, data: any) => {
        if (isAborted) return
        const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
        controller.enqueue(encoder.encode(payload))
      }

      if (learnedMemory) {
        sendEvent('memory_saved', learnedMemory)
      }

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
            if (isAborted) return
            if (!firstTokenTime) {
              firstTokenTime = Date.now() - reqStart
            }
            accumulatedContent += token
            sendEvent('token', { token })
          },
        })

        const totalTime = Date.now() - reqStart

        // Step 4: Complete event with detailed timing instrumentation
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

        controller.close()
      } catch (err: any) {
        sendEvent('error', {
          message: err.message || 'An error occurred during response generation.',
        })
        try {
          controller.close()
        } catch {}
      }
    },
  })

  // Return standard Response streaming SSE directly to client
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

export const config: Config = {
  path: '/api/chat/stream',
}
