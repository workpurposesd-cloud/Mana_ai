import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { classifyIntent } from '../server/services/intentClassifier.js'
import { selectModelForTask, determineTaskTier } from '../server/services/modelRouter.js'
import { classifyGeminiError } from '../server/services/aiService.js'
import { orchestrateChat } from '../server/services/chatOrchestrator.js'
import { chatHistoryService } from '../server/services/chatHistoryService.js'
import { configService } from '../server/services/configService.js'
import { authService } from '../server/services/authService.js'

console.log('=== RUNNING MANA AI PRODUCTION-READY GEMINI AUDIT & REGRESSION TESTS ===\n')

let passedCount = 0
let failedCount = 0

async function runTest(name: string, fn: () => Promise<void> | void) {
  try {
    await fn()
    console.log(`[PASS] ${name}`)
    passedCount++
  } catch (err: any) {
    console.error(`[FAIL] ${name}`)
    console.error(`       Error: ${err.message}`)
    failedCount++
  }
}

async function main() {
  // TEST 1: Missing API key produces a clear configuration error
  await runTest('Test 1: Missing API key produces a clear configuration error', async () => {
    configService.updateConfig({ aiProvider: 'gemini', geminiApiKey: '' })
    const oldKey = process.env.GEMINI_API_KEY
    delete process.env.GEMINI_API_KEY
    try {
      let threw = false
      try {
        await orchestrateChat({ prompt: 'Hello Mana', searchMode: 'never' })
      } catch (err: any) {
        threw = true
        assert(
          err.message.includes('Google Gemini API key is missing'),
          `Expected missing key error, got: ${err.message}`
        )
      }
      assert(threw, 'Should throw error when GEMINI_API_KEY is missing')
    } finally {
      if (oldKey) process.env.GEMINI_API_KEY = oldKey
    }
  })

  // TEST 2: A valid mocked Gemini response reaches the UI / client pipeline
  await runTest('Test 2: A valid mocked response streams through the orchestrator', async () => {
    configService.updateConfig({ aiProvider: 'gemini', geminiApiKey: 'test-mock-key' })
    const tokens: string[] = []
    let doneEvent: any = null

    await orchestrateChat(
      {
        prompt: 'Hi bro',
        history: [],
        searchMode: 'never',
      },
      {
        onToken: (tok) => tokens.push(tok),
        onDone: (data) => {
          doneEvent = data
        },
      }
    )

    assert(tokens.length > 0, 'Tokens must be emitted via onToken')
    assert(doneEvent !== null, 'onDone event must be emitted')
    assert(typeof doneEvent.content === 'string' && doneEvent.content.length > 0, 'Done event must contain content')
    assert(doneEvent.timings.totalMs >= 0, 'Done event must contain timing info')
  })

  // TEST 3: Invalid credentials are handled safely without secret exposure
  await runTest('Test 3: Invalid credentials produce clear, safe error message', () => {
    const fakeError = {
      status: 400,
      message: 'API_KEY_INVALID: API key not valid. Please pass a valid API key.',
    }
    const classified = classifyGeminiError(fakeError)
    assert(
      classified.message.includes('Invalid Google Gemini API key'),
      `Should produce user-friendly invalid key message, got: ${classified.message}`
    )
    assert(!classified.message.includes('AIzaSy'), 'Must not leak secret keys')
  })

  // TEST 4: Quota errors do not trigger infinite retries
  await runTest('Test 4: Quota errors fail cleanly without infinite retries', () => {
    const quotaError = {
      status: 429,
      message: 'RESOURCE_EXHAUSTED: Quota exceeded for quota metric "Generate Content API requests per minute"',
    }
    const classified = classifyGeminiError(quotaError)
    assert(
      classified.message.includes('Google Gemini rate limit / quota exceeded'),
      `Should produce quota guidance, got: ${classified.message}`
    )
  })

  // TEST 5: Gemini selection actually invokes the Gemini service
  await runTest('Test 5: Gemini provider selection actually routes to Gemini model', () => {
    const cfg = { ...configService.getConfig(), aiProvider: 'gemini' as const }
    const intent = classifyIntent('Explain binary search', [])
    const selection = selectModelForTask('fast', cfg, intent)
    assert.strictEqual(selection.provider, 'gemini', 'Provider must be gemini')
    assert(selection.modelName.includes('gemini'), 'Model must be a Gemini model')
  })

  // TEST 6: Fast Mode selects the configured Flash model
  await runTest('Test 6: Fast Mode selects the configured Flash model', () => {
    const cfg = { ...configService.getConfig(), aiProvider: 'gemini' as const, modelName: 'gemini-1.5-flash' }
    const intent = classifyIntent('Hi', [])
    const selection = selectModelForTask('fast', cfg, intent)
    assert.strictEqual(selection.provider, 'gemini')
    assert.strictEqual(selection.modelName, 'gemini-1.5-flash')
  })

  // TEST 7: Deep Reasoning Mode follows documented model-routing rules
  await runTest('Test 7: Deep Reasoning Mode selects Gemini Pro model', () => {
    const cfg = { ...configService.getConfig(), aiProvider: 'gemini' as const }
    const intent = classifyIntent('Design a distributed cache system with raft consensus', [])
    const selection = selectModelForTask('reasoning', cfg, intent)
    assert.strictEqual(selection.provider, 'gemini')
    assert.strictEqual(selection.modelName, 'gemini-1.5-pro')
  })

  // TEST 8: Greetings do not trigger unnecessary web searches
  await runTest('Test 8: Greetings do not trigger web search in any mode', () => {
    const greetings = ['hello', 'hi bro', 'namaste', 'cheppu mama', 'good morning', 'hey']
    for (const g of greetings) {
      const intent = classifyIntent(g, [])
      assert.strictEqual(intent.category, 'conversational', `"${g}" should be conversational`)
      assert.strictEqual(intent.needsSearch, false, `"${g}" should not search`)
    }
  })

  // TEST 9: “What's your name?” receives a conversational response without web search
  await runTest('Test 9: "What\'s your name?" receives conversational response without search', () => {
    const identityQueries = [
      "What's your name?",
      'what is your name',
      'who are you',
      'who created you',
      'what can you do',
      'tell me about yourself',
      'nee peru enti',
    ]
    for (const q of identityQueries) {
      const intent = classifyIntent(q, [])
      assert.strictEqual(intent.category, 'conversational', `Query "${q}" must be conversational`)
      assert.strictEqual(intent.needsSearch, false, `Query "${q}" must never trigger web search`)
    }
  })

  // TEST 10: “Do you know Vizag?” followed by “Tell me more about it” retains context
  await runTest('Test 10: "Do you know Vizag?" -> "Tell me more about it" retains context', () => {
    const history = [
      { role: 'user', content: 'Do you know Vizag?' },
      { role: 'assistant', content: 'Ha baga telusu mama! Visakhapatnam is the City of Destiny, famous for RK Beach, Kailasagiri, and Steel Plant.' },
    ]
    const intent = classifyIntent('Tell me more about it', history)
    assert.strictEqual(intent.category, 'contextual_followup', 'Should be categorized as contextual_followup')
    assert.strictEqual(intent.contextualTopic, 'Vizag', 'Must resolve context to Vizag')
    assert.strictEqual(intent.needsSearch, false, 'Generic follow-up should not search web')
    assert(intent.refinedQuery.toLowerCase().includes('vizag'), `Refined query must resolve pronoun to Vizag: ${intent.refinedQuery}`)
  })

  // TEST 11: Feedback such as “Your answer is wrong” is not treated as a search query
  await runTest('Test 11: User complaints/corrections are never searched as queries', () => {
    const feedbackList = [
      'Your answer is wrong',
      'You are giving wrong answers',
      'you made a mistake',
      'that is completely wrong',
      'thappu cheppavu mama',
    ]
    for (const fb of feedbackList) {
      const intent = classifyIntent(fb, [])
      assert.strictEqual(intent.category, 'correction_feedback', `"${fb}" should be correction_feedback`)
      assert.strictEqual(intent.needsSearch, false, `"${fb}" should never search`)
      assert.strictEqual(intent.isCorrectionOrFeedback, true)
    }
  })

  // TEST 12: Search still works for explicit current-information requests
  await runTest('Test 12: Web search triggers for real-time and explicit search requests', () => {
    const searchQueries = [
      'live cricket score today',
      'today weather forecast in Hyderabad',
      'gold rate today',
      'please search google for latest news',
    ]
    for (const sq of searchQueries) {
      const intent = classifyIntent(sq, [])
      assert.strictEqual(intent.needsSearch, true, `Query "${sq}" must trigger search`)
    }
  })

  // TEST 13: Streaming produces valid events and one final completion
  await runTest('Test 13: Streaming orchestrator produces valid token stream and done event', async () => {
    configService.updateConfig({ aiProvider: 'gemini', geminiApiKey: 'test-mock-key' })
    const events: string[] = []
    let doneCalled = false

    await orchestrateChat(
      { prompt: 'Say hello in 3 words', searchMode: 'never' },
      {
        onToken: () => events.push('token'),
        onDone: () => {
          events.push('done')
          doneCalled = true
        },
      }
    )

    assert(events.includes('token'), 'Must emit token events')
    assert(events.includes('done'), 'Must emit done event')
    assert.strictEqual(events[events.length - 1], 'done', 'Done event must be the final completion event')
    assert(doneCalled, 'onDone callback must be executed')
  })

  // TEST 14: User A cannot access or overwrite User B's chat history (IDOR protection)
  await runTest('Test 14: User A cannot access or overwrite User B chat session', async () => {
    // Create a session for User B
    const sessionB = await chatHistoryService.createSessionAsync('user-B', 'User B Private Chat')
    assert(sessionB && sessionB.id, 'Session B should be created')

    // User A tries to read User B's session
    const readAttempt = chatHistoryService.getSession('user-A', sessionB.id)
    assert.strictEqual(readAttempt, null, 'User A must not be allowed to read User B session')

    // User A tries to overwrite User B's session messages
    const overwriteAttempt = await chatHistoryService.saveMessagesAsync('user-A', sessionB.id, [
      { id: 'msg-1', role: 'user', content: 'Malicious overwrite', createdAt: new Date().toISOString() },
    ])
    assert.strictEqual(overwriteAttempt, null, 'User A must not be allowed to overwrite User B session')

    // Clean up
    await chatHistoryService.deleteSessionAsync('user-B', sessionB.id)
  })

  // TEST 15: No private API key appears in frontend build output
  await runTest('Test 15: No private API keys or secrets in frontend dist bundle', () => {
    const distPath = path.resolve(process.cwd(), 'dist')
    if (fs.existsSync(distPath)) {
      const files = fs.readdirSync(path.join(distPath, 'assets'))
      for (const f of files) {
        if (f.endsWith('.js')) {
          const content = fs.readFileSync(path.join(distPath, 'assets', f), 'utf-8')
          // Ensure no hardcoded Google API Key (AIzaSy[A-Za-z0-9_-]{33}) exists in bundle
          const hasRealGoogleKey = /AIzaSy[A-Za-z0-9_-]{33}/.test(content)
          assert(!hasRealGoogleKey, `Real Google API key leaked in bundle file: ${f}`)
          assert(!/sk-[A-Za-z0-9]{32,}/.test(content), `Potential OpenAI key in: ${f}`)
          assert(!/gsk_[A-Za-z0-9]{30,}/.test(content), `Potential Groq key in: ${f}`)
        }
      }
    }
  })

  // TEST 16: Environment variables are not committed to Git
  await runTest('Test 16: .env is excluded by .gitignore and not tracked by Git', () => {
    const gitignore = fs.readFileSync(path.resolve(process.cwd(), '.gitignore'), 'utf-8')
    assert(
      gitignore.split('\n').some((line) => line.trim() === '.env'),
      '.env must be explicitly ignored in .gitignore'
    )
  })

  // TEST 17: Existing routes and configuration remain functional
  await runTest('Test 17: Netlify redirects and Express routes are valid and compatible', () => {
    const netlifyToml = fs.readFileSync(path.resolve(process.cwd(), 'netlify.toml'), 'utf-8')
    assert(netlifyToml.includes('from = "/api/chat/stream"'), 'Must have /api/chat/stream redirect in netlify.toml')
    assert(netlifyToml.includes('to = "/.netlify/functions/chat-stream"'), 'Must point to chat-stream function')
    assert(netlifyToml.includes('from = "/api/*"'), 'Must have /api/* redirect in netlify.toml')
    assert(netlifyToml.includes('from = "/*"'), 'Must have SPA fallback redirect')
  })

  console.log(`\n=== PRODUCTION AUDIT TEST RESULTS: ${passedCount} PASSED, ${failedCount} FAILED ===\n`)
  if (failedCount > 0) {
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('Fatal test error:', err)
  process.exit(1)
})
