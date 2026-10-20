import assert from 'node:assert'
import { classifyIntent } from '../server/services/intentClassifier.js'
import { orchestrateChat } from '../server/services/chatOrchestrator.js'
import { configService } from '../server/services/configService.js'
import { generateAIResponse } from '../server/services/aiService.js'
import { chatHistoryService } from '../server/services/chatHistoryService.js'
import { authService } from '../server/services/authService.js'

console.log('=== RUNNING MANA AI REPEATED RESPONSE FIX & CONVERSATIONAL TESTS ===\n')

let passedCount = 0
let failedCount = 0

const FORBIDDEN_TEMPLATE_SNIPPET = 'Solid topic ra! Cheppu, deeni gurinchi details kavala'

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
  const history: Array<{ role: 'user' | 'assistant'; content: string }> = []

  // Ensure mock key is not permanently saved
  configService.updateConfig({ aiProvider: 'builtin', geminiApiKey: '' })

  // 1. "Hi" receives a greeting
  await runTest('1. "Hi" receives a short, natural greeting (never the repetitive template)', async () => {
    const prompt = 'Hi'
    const intent = classifyIntent(prompt, history)
    assert.strictEqual(intent.category, 'conversational')
    assert.strictEqual(intent.needsSearch, false)

    const res = await orchestrateChat({ prompt, history, searchMode: 'never' })
    assert(!res.content.includes(FORBIDDEN_TEMPLATE_SNIPPET), 'Must not use repetitive template')
    assert(
      /hi|hello|hey|మావా|నమస్తే/i.test(res.content),
      `Expected a natural greeting, got: "${res.content}"`
    )
    history.push({ role: 'user', content: prompt })
    history.push({ role: 'assistant', content: res.content })
  })

  // 2. "How are you?" receives a natural conversational answer
  await runTest('2. "How are you?" receives a natural answer about well-being, followed by a friendly question', async () => {
    const prompt = 'How are you?'
    const intent = classifyIntent(prompt, history)
    assert.strictEqual(intent.category, 'conversational')
    assert.strictEqual(intent.needsSearch, false)

    const res = await orchestrateChat({ prompt, history, searchMode: 'never' })
    assert(!res.content.includes(FORBIDDEN_TEMPLATE_SNIPPET), 'Must not use repetitive template')
    assert(
      /బాగున్నా|good|great|fine|energy|ఎలా ఉన్నావ్|how are you/i.test(res.content),
      `Expected well-being answer, got: "${res.content}"`
    )
    history.push({ role: 'user', content: prompt })
    history.push({ role: 'assistant', content: res.content })
  })

  // 3. "Do you know Narendra Modi?" receives a factual response identifying him as Prime Minister
  await runTest('3. "Do you know Narendra Modi?" receives a direct factual answer identifying him as PM', async () => {
    const prompt = 'Do you know Narendra Modi?'
    const intent = classifyIntent(prompt, history)
    assert.strictEqual(intent.needsSearch, false)
    assert.strictEqual(intent.category, 'general_knowledge')

    const res = await orchestrateChat({ prompt, history, searchMode: 'never' })
    assert(!res.content.includes(FORBIDDEN_TEMPLATE_SNIPPET), 'Must not use repetitive template')
    assert(
      /ప్రధాన మంత్రి|Prime Minister|మోదీ|Modi/i.test(res.content),
      `Expected identification of Narendra Modi as PM, got: "${res.content}"`
    )
    history.push({ role: 'user', content: prompt })
    history.push({ role: 'assistant', content: res.content })
  })

  // 4. "Tell me what you know about him" uses correct context
  await runTest('4. "Tell me what you know about him" uses Narendra Modi context and gives useful explanation', async () => {
    const prompt = 'Tell me what you know about him.'
    const intent = classifyIntent(prompt, history)
    assert(intent.refinedQuery.includes('Narendra Modi'), `Expected pronoun resolution to Narendra Modi, got: "${intent.refinedQuery}"`)
    assert.strictEqual(intent.isFollowUp, true)

    const res = await orchestrateChat({ prompt, history, searchMode: 'never' })
    assert(!res.content.includes(FORBIDDEN_TEMPLATE_SNIPPET), 'Must not use repetitive template')
    assert(
      /గుజరాత్|Gujarat|ప్రధాని|Prime Minister|మోదీ|Modi/i.test(res.content),
      `Expected useful explanation about Modi's career, got: "${res.content}"`
    )
    history.push({ role: 'user', content: prompt })
    history.push({ role: 'assistant', content: res.content })
  })

  // 5. "Don't give the same answers every time" is treated as feedback
  await runTest('5. "Don\'t give the same answers every time." is treated as feedback and acknowledges error', async () => {
    const prompt = "Don't give the same answers every time."
    const intent = classifyIntent(prompt, history)
    assert.strictEqual(intent.category, 'correction_feedback')
    assert.strictEqual(intent.isCorrectionOrFeedback, true)
    assert.strictEqual(intent.needsSearch, false)

    const res = await orchestrateChat({ prompt, history, searchMode: 'never' })
    assert(!res.content.includes(FORBIDDEN_TEMPLATE_SNIPPET), 'Must not use repetitive template')
    assert(
      /apologize|తప్పు|రిపీట్|డైరెక్ట్|సూటిగా/i.test(res.content),
      `Expected acknowledgment of repetitive answers, got: "${res.content}"`
    )
    history.push({ role: 'user', content: prompt })
    history.push({ role: 'assistant', content: res.content })
  })

  // 6. "I'm asking." does not trigger universal fallback and refers to unresolved question
  await runTest('6. "I\'m asking." recognizes user insistence and addresses the unresolved topic', async () => {
    const prompt = "I'm asking."
    const intent = classifyIntent(prompt, history)
    assert.strictEqual(intent.category, 'clarification')
    assert.strictEqual(intent.needsSearch, false)

    const res = await orchestrateChat({ prompt, history, searchMode: 'never' })
    assert(!res.content.includes(FORBIDDEN_TEMPLATE_SNIPPET), 'Must not use repetitive template')
    assert(
      !res.content.includes('I\'m asking gurincha mama'),
      'Must never extract "I\'m asking" as a topic!'
    )
    assert(
      /నరేంద్ర మోదీ|Modi|సూటిగా|సమాధానం/i.test(res.content),
      `Expected response addressing the question, got: "${res.content}"`
    )
    history.push({ role: 'user', content: prompt })
    history.push({ role: 'assistant', content: res.content })
  })

  // 7. "Your AI or bot?" receives a direct identity answer
  await runTest('7. "Your AI or bot?" receives an honest identity answer explaining Mana AI is an AI assistant', async () => {
    const prompt = 'Your AI or bot?'
    const intent = classifyIntent(prompt, history)
    assert.strictEqual(intent.needsSearch, false)

    const res = await orchestrateChat({ prompt, history, searchMode: 'never' })
    assert(!res.content.includes(FORBIDDEN_TEMPLATE_SNIPPET), 'Must not use repetitive template')
    assert(
      /AI assistant|ఏఐ|మనిషిని కాదు|Mana AI/i.test(res.content),
      `Expected honest AI identity explanation, got: "${res.content}"`
    )
  })

  // 8. Ordinary chat does not trigger unnecessary searches
  await runTest('8. Ordinary chat does not trigger web search', () => {
    const intent1 = classifyIntent('What is your name?')
    const intent2 = classifyIntent('How are you doing?')
    const intent3 = classifyIntent('Do you know Narendra Modi?')
    assert.strictEqual(intent1.needsSearch, false)
    assert.strictEqual(intent2.needsSearch, false)
    assert.strictEqual(intent3.needsSearch, false)
  })

  // 9. Explicit current-news requests still use search integration
  await runTest('9. Explicit current news requests still trigger web search', () => {
    const intent = classifyIntent('Search the latest news about Narendra Modi')
    assert.strictEqual(intent.needsSearch, true)
    assert.strictEqual(intent.category, 'explicit_search')
  })

  // 10. Gemini errors are handled honestly
  await runTest('10. Gemini errors are handled honestly without generic fake success', async () => {
    let threw = false
    try {
      await orchestrateChat({
        prompt: 'Explain quantum computing',
        searchMode: 'never',
        aiProvider: 'gemini',
        geminiApiKey: 'invalid-failing-key-xyz',
      })
    } catch (err: any) {
      threw = true
      assert(
        err.message.includes('Google Gemini') || err.message.includes('API key'),
        `Expected honest key error, got: ${err.message}`
      )
    }
    assert(threw, 'Should throw honest error when key is invalid')
  })

  // 11. Missing credentials do not produce fake success
  await runTest('11. Missing credentials when provider is gemini produce clear error', async () => {
    const oldKey = process.env.GEMINI_API_KEY
    delete process.env.GEMINI_API_KEY
    try {
      let threw = false
      try {
        await orchestrateChat({
          prompt: 'What is the theory of relativity?',
          searchMode: 'never',
          aiProvider: 'gemini',
          geminiApiKey: '',
        })
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

  // 12. Streaming returns the actual generated content
  await runTest('12. Streaming returns real generated tokens', async () => {
    const tokens: string[] = []
    const res = await orchestrateChat(
      {
        prompt: 'Do you know Narendra Modi?',
        searchMode: 'never',
      },
      {
        onToken: (t) => tokens.push(t),
      }
    )
    assert(tokens.length > 0, 'Must stream tokens')
    const streamed = tokens.join('')
    assert(streamed.includes('Narendra Modi') || streamed.includes('నరేంద్ర మోదీ'), 'Streamed content must match generated content')
    assert(!streamed.includes(FORBIDDEN_TEMPLATE_SNIPPET), 'Streamed content must never be the forbidden template')
  })

  // 13. Client-provided geminiApiKey is properly ingested by orchestrator
  await runTest('13. Client-provided geminiApiKey is properly ingested by orchestrator', async () => {
    const tokens: string[] = []
    const res = await orchestrateChat(
      {
        prompt: 'Hello from client with key',
        searchMode: 'never',
        aiProvider: 'gemini',
        geminiApiKey: 'test-mock-key',
      },
      {
        onToken: (t) => tokens.push(t),
      }
    )
    assert(res.content.includes('Gemini Flash'), `Expected mock response from Gemini, got: "${res.content}"`)
  })

  // 14. Separate users cannot access one another's conversations
  await runTest('14. Separate users cannot access one another\'s conversations', async () => {
    const sessionUserA = await chatHistoryService.createSessionAsync('user-alpha', 'User A Secret Chat')
    await chatHistoryService.saveMessagesAsync('user-alpha', sessionUserA.id, [
      { id: 'm1', role: 'user', content: 'Secret Alpha', timestamp: Date.now() },
    ])

    const crossAccess = chatHistoryService.getSession('user-beta', sessionUserA.id)
    assert.strictEqual(crossAccess, null, 'User B must not be able to read User A session')
  })

  // 15. /api/config getMaskedConfig never returns secret keys or key slices
  await runTest('15. /api/config getMaskedConfig never returns secret keys or key slices', () => {
    const masked = configService.getMaskedConfig()
    assert.strictEqual(masked.geminiApiKey, '', 'geminiApiKey must be empty in getMaskedConfig')
    assert.strictEqual(masked.openaiApiKey, '', 'openaiApiKey must be empty in getMaskedConfig')
    assert.strictEqual(masked.groqApiKey, '', 'groqApiKey must be empty in getMaskedConfig')
    assert(!JSON.stringify(masked).includes('AIzaSy'), 'Must never leak key prefix or secret')
  })

  // 16. authService never returns geminiApiKey in user payloads
  await runTest('16. authService never returns geminiApiKey in user payloads', async () => {
    const res = await authService.login('nagesh@mana.ai', 'password123')
    assert.strictEqual((res.user as any).geminiApiKey, undefined, 'geminiApiKey must not be in user response')
    assert.strictEqual((res.user as any).passwordHash, undefined, 'passwordHash must not be in user response')
  })

  // 17. orchestrateChat discards masked keys and safely falls back to process.env.GEMINI_API_KEY
  await runTest('17. orchestrateChat discards masked keys and falls back to process.env.GEMINI_API_KEY', async () => {
    const oldEnv = process.env.GEMINI_API_KEY
    process.env.GEMINI_API_KEY = 'test-mock-key'
    try {
      const res = await orchestrateChat({
        prompt: 'Hello with masked key',
        searchMode: 'never',
        aiProvider: 'gemini',
        geminiApiKey: 'AIza••••1234', // simulated masked key from client
      })
      assert(res.content.includes('Gemini Flash'), 'Must succeed by falling back to process.env.GEMINI_API_KEY')
    } finally {
      process.env.GEMINI_API_KEY = oldEnv
    }
  })

  // 18. Server environment variable GEMINI_API_KEY is used when client passes no key
  await runTest('18. Server environment variable GEMINI_API_KEY is used when client passes no key', async () => {
    const oldEnv = process.env.GEMINI_API_KEY
    process.env.GEMINI_API_KEY = 'test-mock-key'
    try {
      const res = await orchestrateChat({
        prompt: 'Hello with zero client key',
        searchMode: 'never',
        aiProvider: 'gemini',
      })
      assert(res.content.includes('Gemini Flash'), 'Must succeed with server environment key')
    } finally {
      process.env.GEMINI_API_KEY = oldEnv
    }
  })

  console.log(`\n=== TEST RESULTS: ${passedCount} PASSED, ${failedCount} FAILED ===\n`)
  if (failedCount > 0) {
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('Fatal test error:', err)
  process.exit(1)
})
