import assert from 'node:assert'
import { classifyIntent } from '../server/services/intentClassifier.js'
import { optimizeConversationContext } from '../server/services/contextManager.js'

console.log('=== RUNNING MANA AI CONVERSATIONAL INTELLIGENCE REGRESSION TESTS ===\n')

let passedCount = 0
let failedCount = 0

function runTest(name: string, fn: () => void) {
  try {
    fn()
    console.log(`[PASS] ${name}`)
    passedCount++
  } catch (err: any) {
    console.error(`[FAIL] ${name}`)
    console.error(`       Error: ${err.message}`)
    failedCount++
  }
}

// TEST A: Hyderabad -> "ammerpet" -> Ameerpet in Hyderabad
runTest('Test A: Hyderabad -> "ammerpet" -> Interpreted as Ameerpet in Hyderabad without web search', () => {
  const history = [
    { role: 'user', content: 'do you know hyderabad' },
    { role: 'assistant', content: 'Ha baga telusu mama! Hyderabad is the City of Pearls, famous for Charminar, Biryani, and Hitec City.' },
  ]
  const intent = classifyIntent('ammerpet', history)

  assert.strictEqual(intent.category, 'contextual_followup', 'Should be categorized as contextual_followup')
  assert.strictEqual(intent.correctedEntity, 'Ameerpet', 'Spelling "ammerpet" should be corrected to "Ameerpet"')
  assert.strictEqual(intent.contextualTopic, 'Hyderabad', 'Contextual topic should be Hyderabad')
  assert.strictEqual(intent.needsSearch, false, 'Should NOT trigger a web search for generic locality inquiry')
  assert.strictEqual(intent.isCorrectionOrFeedback, undefined, 'Should not be marked as correction/feedback')
})

// TEST B: Hyderabad -> "what about metro?" -> Interpret as Hyderabad metro
runTest('Test B: Hyderabad -> "what about metro?" -> Interpreted as Hyderabad Metro Rail', () => {
  const history = [
    { role: 'user', content: 'Tell me about Hyderabad transport' },
    { role: 'assistant', content: 'Hyderabad has TSRTC buses, autos, and a modern metro system.' },
  ]
  const intent = classifyIntent('what about metro?', history)

  assert.strictEqual(intent.category, 'contextual_followup', 'Should be categorized as contextual_followup')
  assert.strictEqual(intent.contextualTopic, 'Hyderabad Metro Rail', 'Should be mapped to Hyderabad Metro Rail')
  assert.strictEqual(intent.needsSearch, false, 'General metro inquiry should not require web search')
  assert(intent.refinedQuery.toLowerCase().includes('hyderabad metro'), 'Refined query must specify Hyderabad Metro')
})

// TEST C: AI gives wrong answer -> User says "you made a mistake" / "rectify you mistakes"
runTest('Test C1: User says "you made a mistake" -> Detected as correction_feedback without search', () => {
  const history = [
    { role: 'user', content: 'do you know hyderabad' },
    { role: 'assistant', content: 'Yes, Hyderabad is in India.' },
    { role: 'user', content: 'ammerpet' },
    { role: 'assistant', content: 'Ammersee is a lake in Upper Bavaria, Germany...' },
  ]
  const intent = classifyIntent('you made a mistake, that is a lake in germany not hyderabad', history)

  assert.strictEqual(intent.category, 'correction_feedback', 'Should be categorized as correction_feedback')
  assert.strictEqual(intent.isCorrectionOrFeedback, true, 'isCorrectionOrFeedback must be true')
  assert.strictEqual(intent.needsSearch, false, 'Complaints/corrections must NEVER trigger a web search')
})

runTest('Test C2: Exact user complaint phrase triggers error recovery without web search', () => {
  const history = [
    { role: 'user', content: 'do you know hyderabad' },
    { role: 'assistant', content: 'Yes, Hyderabad is in India.' },
    { role: 'user', content: 'ammerpet' },
    { role: 'assistant', content: 'Ammersee is a lake in Germany.' },
  ]
  const complaint = 'first i asked hyderabad after that ameerpet you rectify my spelling mistakes but here i need to rectify you mistakes'
  const intent = classifyIntent(complaint, history)

  assert.strictEqual(intent.category, 'correction_feedback', 'Should be categorized as correction_feedback')
  assert.strictEqual(intent.isCorrectionOrFeedback, true, 'isCorrectionOrFeedback must be true')
  assert.strictEqual(intent.needsSearch, false, 'Must NEVER search the complaint sentence on the web')
})

// TEST D: Java -> "spring boot" -> Interpret as Java framework
runTest('Test D: Java -> "spring boot" -> Interpreted as Java Spring Boot Framework', () => {
  const history = [
    { role: 'user', content: 'I am learning Java programming' },
    { role: 'assistant', content: 'Java is an object-oriented programming language running on the JVM.' },
  ]
  const intent = classifyIntent('spring boot', history)

  assert.strictEqual(intent.category, 'contextual_followup', 'Should be categorized as contextual_followup')
  assert.strictEqual(intent.contextualTopic, 'Java', 'Contextual topic should be Java')
  assert.strictEqual(intent.correctedEntity, 'Spring Boot Framework', 'Should identify Spring Boot Framework')
  assert.strictEqual(intent.needsSearch, false, 'Conceptual framework question does not require web search')
})

// TEST E: Explicit topic change -> Clears previous context
runTest('Test E: User changes subject explicitly -> Does not inherit old topic', () => {
  const history = [
    { role: 'user', content: 'Tell me about Hyderabad' },
    { role: 'assistant', content: 'Hyderabad is a major tech hub...' },
  ]
  const intent = classifyIntent('forget that, let us talk about quantum physics', history)

  assert.strictEqual(intent.category, 'topic_change', 'Should be categorized as topic_change')
  assert.strictEqual(intent.isFollowUp, false, 'Must not be considered a follow-up')
})

// TEST F: Ambiguous place name without context -> Handled appropriately
runTest('Test F: User enters ambiguous place name without context -> Noticed as ambiguous', () => {
  const intent = classifyIntent('springfield', [])

  assert.strictEqual(intent.needsSearch, false, 'Should not search ambiguous single entity blindly')
  assert(intent.reason.includes('Ambiguous place name'), 'Reason must mention ambiguity')
})

// TEST G: User asks for current information -> Search only when appropriate with context query
runTest('Test G: Current live metro timings -> Contextually enriched web search query', () => {
  const history = [
    { role: 'user', content: 'do you know hyderabad' },
    { role: 'assistant', content: 'Yes, Hyderabad is known for its metro, pearls, and IT hubs.' },
  ]
  const intent = classifyIntent('ammerpet metro timings today', history)

  assert.strictEqual(intent.needsSearch, true, 'Time-sensitive "today" query must trigger web search')
  assert(intent.refinedQuery.includes('Ameerpet'), 'Query must have corrected spelling Ameerpet')
  assert(intent.refinedQuery.includes('Hyderabad'), 'Query must include contextual city Hyderabad')
})

// TEST H: User says "hello" -> Friendly greeting without web search
runTest('Test H: User says "hello" -> Conversational, no web search', () => {
  const intent = classifyIntent('hello')

  assert.strictEqual(intent.category, 'conversational', 'Should be categorized as conversational')
  assert.strictEqual(intent.needsSearch, false, 'Must NOT trigger web search')
})

// TEST I: User says "tell me something" -> Conversational, no search or unnecessary angle inquiry
runTest('Test I: User says "tell me something" -> Conversational, no web search', () => {
  const intent = classifyIntent('tell me something')

  assert.strictEqual(intent.category, 'conversational', 'Should be categorized as conversational')
  assert.strictEqual(intent.needsSearch, false, 'Must NOT trigger web search')
})

// TEST J: Context management preserves previous messages in payload
runTest('Test J: Context manager preserves conversation history and entities', () => {
  const history = [
    { role: 'user' as const, content: 'hello' },
    { role: 'assistant' as const, content: 'Hey mama! Namaskaram.' },
    { role: 'user' as const, content: 'do you know hyderabad' },
    { role: 'assistant' as const, content: 'Hyderabad is a glorious city with Charminar and Ameerpet.' },
    { role: 'user' as const, content: 'ammerpet' },
  ]
  const optimized = optimizeConversationContext(history)

  assert(optimized.sanitizedHistory.length >= 4, 'Should keep recent message turns intact')
  const hyderabadMsg = optimized.sanitizedHistory.find((m) => m.content.toLowerCase().includes('hyderabad'))
  assert(hyderabadMsg !== undefined, 'Hyderabad turn must be preserved in context')
})

console.log(`\n=== RESULTS: ${passedCount} PASSED, ${failedCount} FAILED ===\n`)
if (failedCount > 0) {
  process.exit(1)
} else {
  console.log('All regression tests passed successfully! 🎉')
}
