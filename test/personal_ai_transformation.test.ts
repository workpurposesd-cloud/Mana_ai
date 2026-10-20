import assert from 'node:assert'
import { classifyIntent } from '../server/services/intentClassifier.js'
import { orchestrateChat } from '../server/services/chatOrchestrator.js'
import { configService } from '../server/services/configService.js'
import { memoryService } from '../server/services/memoryService.js'

console.log('=== RUNNING MANA AI PERSONAL AI TRANSFORMATION MASTER TEST SUITE ===\n')

let passed = 0
let failed = 0

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn()
    console.log(`[PASS] ${name}`)
    passed++
  } catch (err: any) {
    console.error(`[FAIL] ${name}`)
    console.error(`       Error: ${err.message}`)
    failed++
  }
}

async function runAll() {
  // Use builtin provider to test local contextual synthesis & logic deterministically
  configService.updateConfig({ aiProvider: 'builtin', geminiApiKey: '' })
  memoryService.clearAllMemories()

  // 1. CANONICAL DIALOGUE 1: "Mama em chestunnav?"
  await test('1. Canonical: "Mama em chestunnav?" receives village friend ready response', async () => {
    const prompt = 'Mama em chestunnav?'
    const res = await orchestrateChat({ prompt, history: [], searchMode: 'never' })
    assert(
      res.content.includes('Em le mama, nee kosam ready ga unna') && res.content.includes('Cheppu, enti sangathi?'),
      `Expected canonical village response, got: "${res.content}"`
    )
    // Short answer check (1-4 sentences)
    const sentences = res.content.split(/[.?!]+/).filter(Boolean)
    assert(sentences.length <= 4, `Expected <= 4 sentences, got ${sentences.length}`)
  })

  // 2. CANONICAL DIALOGUE 2: "Roast me."
  await test('2. Canonical: "Roast me." receives Google Calendar resignation roast', async () => {
    const prompt = 'Roast me.'
    const res = await orchestrateChat({ prompt, history: [], searchMode: 'never' })
    assert(
      res.content.includes('Google Calendar') && res.content.includes('resignation'),
      `Expected Google Calendar roast, got: "${res.content}"`
    )
  })

  // 3. CANONICAL DIALOGUE 3: "I'm feeling really low today."
  await test('3. Canonical: "I\'m feeling really low today." receives empathy-first response', async () => {
    const prompt = "I'm feeling really low today."
    const res = await orchestrateChat({ prompt, history: [], searchMode: 'never' })
    assert(
      res.content.includes('Hey bro, em ayyindi?') && res.content.includes('Advice kavala, leka first just maatladala?'),
      `Expected empathetic non-judgmental response, got: "${res.content}"`
    )
  })

  // 4. CANONICAL DIALOGUE 4: "Explain APIs."
  await test('4. Canonical: "Explain APIs." uses intuitive waiter analogy', async () => {
    const prompt = 'Explain APIs.'
    const res = await orchestrateChat({ prompt, history: [], searchMode: 'never' })
    assert(
      res.content.includes('waiter laantidi') && res.content.includes('software systems'),
      `Expected waiter analogy for APIs, got: "${res.content}"`
    )
  })

  // 5. CANONICAL DIALOGUE 5: "Vizag one more name?"
  await test('5. Canonical: "Vizag one more name?" returns Visakhapatnam & City of Destiny', async () => {
    const prompt = 'Vizag one more name?'
    const res = await orchestrateChat({ prompt, history: [], searchMode: 'never' })
    assert(
      res.content.includes('Visakhapatnam') && res.content.includes('City of Destiny'),
      `Expected Visakhapatnam and City of Destiny, got: "${res.content}"`
    )
  })

  // 6. CANONICAL DIALOGUE 6: "What is an API?"
  await test('6. Canonical: "What is an API?" gives direct concise answer', async () => {
    const prompt = 'What is an API?'
    const res = await orchestrateChat({ prompt, history: [], searchMode: 'never' })
    assert(
      res.content.includes('An API lets your website communicate with another service, bro.'),
      `Expected concise API explanation, got: "${res.content}"`
    )
  })

  // 7. CANONICAL DIALOGUE 7: "Who are you?"
  await test('7. Canonical: "Who are you?" identifies as Mana AI buddy', async () => {
    const prompt = 'Who are you?'
    const res = await orchestrateChat({ prompt, history: [], searchMode: 'never' })
    assert(
      res.content.includes("I'm Mana, your AI buddy. Cheppu mama, what's up?"),
      `Expected AI buddy intro, got: "${res.content}"`
    )
  })

  // 8. MULTI-TURN LANGUAGE PERSISTENCE ("English only" -> subsequent turns in English)
  await test('8. Language Persistence: "English only" persists across subsequent turns', async () => {
    const history: Array<{ role: 'user' | 'assistant'; content: string }> = []

    // Turn 1: Switch to English only
    const turn1Prompt = 'English only'
    const turn1Res = await orchestrateChat({ prompt: turn1Prompt, history, searchMode: 'never' })
    assert(
      turn1Res.content.includes('English only from here on'),
      `Turn 1: Expected confirmation of English only, got: "${turn1Res.content}"`
    )
    history.push({ role: 'user', content: turn1Prompt })
    history.push({ role: 'assistant', content: turn1Res.content })

    // Turn 2: Ask general question "Tell me something"
    const turn2Prompt = 'Tell me something'
    const turn2Res = await orchestrateChat({ prompt: turn2Prompt, history, searchMode: 'never' })
    // Must NOT contain Telugu characters
    const hasTelugu = /[\u0C00-\u0C7F]/.test(turn2Res.content)
    assert(!hasTelugu, `Turn 2: Response should NOT contain Telugu script after English-only switch. Got: "${turn2Res.content}"`)
    assert(
      turn2Res.content.toLowerCase().includes('octopus') || turn2Res.content.toLowerCase().includes('fact'),
      `Turn 2: Expected English fact, got: "${turn2Res.content}"`
    )
    history.push({ role: 'user', content: turn2Prompt })
    history.push({ role: 'assistant', content: turn2Res.content })

    // Turn 3: Ask "How are you?"
    const turn3Prompt = 'How are you?'
    const turn3Res = await orchestrateChat({ prompt: turn3Prompt, history, searchMode: 'never' })
    const hasTelugu3 = /[\u0C00-\u0C7F]/.test(turn3Res.content)
    assert(!hasTelugu3, `Turn 3: Response should NOT contain Telugu script. Got: "${turn3Res.content}"`)
    assert(
      turn3Res.content.toLowerCase().includes('doing great') || turn3Res.content.toLowerCase().includes('energy'),
      `Turn 3: Expected natural English response, got: "${turn3Res.content}"`
    )
  })

  // 9. CONTEXTUAL FOLLOW-UP RESOLUTION: Vizag context
  await test('9. Multi-turn Follow-up: Resolves "one more name?" after Vizag question', async () => {
    const history = [
      { role: 'user' as const, content: 'Do you know Vizag?' },
      { role: 'assistant' as const, content: 'Yes bro, Vizag is a coastal city in Andhra Pradesh.' },
    ]
    const res = await orchestrateChat({ prompt: 'one more name?', history, searchMode: 'never' })
    assert(
      res.content.includes('Visakhapatnam') && res.content.includes('City of Destiny'),
      `Expected context resolution to Vizag nicknames, got: "${res.content}"`
    )
  })

  // 10. USER MEMORY ISOLATION & PREFERENCE EXTRACTION
  await test('10. Memory Isolation: Per-user preferences and isolation work correctly', async () => {
    memoryService.clearAllMemories()

    // User A sets English preference
    await memoryService.detectAndSaveUserPreferences('Please speak English only from now on', 'user_alpha')
    // User B sets Telugu preference
    await memoryService.detectAndSaveUserPreferences('Telugu lo matladu mama', 'user_beta')

    const userAMems = memoryService.getMemories('user_alpha')
    const userBMems = memoryService.getMemories('user_beta')

    assert(userAMems.length >= 1, 'User Alpha should have at least 1 memory')
    assert(userBMems.length >= 1, 'User Beta should have at least 1 memory')

    const userALang = userAMems.find((m) => m.key.toLowerCase().includes('language'))
    const userBLang = userBMems.find((m) => m.key.toLowerCase().includes('language'))

    assert(userALang?.value.toLowerCase().includes('english'), `Expected English for Alpha, got: "${userALang?.value}"`)
    assert(userBLang?.value.toLowerCase().includes('telugu'), `Expected Telugu for Beta, got: "${userBLang?.value}"`)

    // Verify isolation: User Alpha does not see User Beta's memory
    const userAOverlap = userAMems.filter((m) => m.userId === 'user_beta')
    assert.strictEqual(userAOverlap.length, 0, 'User Alpha should not see User Beta memories')
  })

  // 11. SHORT ANSWERS BY DEFAULT CHECK
  await test('11. Concise Style: Default answers are short and direct (1-4 sentences)', async () => {
    const testPrompts = [
      'Mama em chestunnav?',
      'Roast me.',
      'What is an API?',
      'Who are you?',
      'Vizag one more name?',
    ]

    for (const p of testPrompts) {
      const res = await orchestrateChat({ prompt: p, history: [], searchMode: 'never' })
      const words = res.content.trim().split(/\s+/).length
      // Punchy short answers are typically under 40 words
      assert(
        words <= 45,
        `Prompt "${p}" resulted in ${words} words, expected concise answer under 45 words. Output: "${res.content}"`
      )
    }
  })

  console.log(`\n==================================================`)
  console.log(`RESULTS: ${passed} PASSED, ${failed} FAILED`)
  console.log(`==================================================\n`)

  if (failed > 0) {
    process.exit(1)
  }
}

runAll().catch((err) => {
  console.error('Fatal test error:', err)
  process.exit(1)
})
