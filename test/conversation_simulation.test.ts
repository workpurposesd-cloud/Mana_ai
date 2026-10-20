import assert from 'node:assert'
import { classifyIntent } from '../server/services/intentClassifier.js'
import { optimizeConversationContext } from '../server/services/contextManager.js'

console.log('=== RUNNING EXACT REPRODUCTION MULTI-TURN CONVERSATION TEST ===\n')

const conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = []

// Turn 1
console.log('--- Turn 1: "hello" ---')
const intent1 = classifyIntent('hello', conversationHistory)
console.log(`Intent 1: category=${intent1.category}, needsSearch=${intent1.needsSearch}, reason="${intent1.reason}"`)
assert.strictEqual(intent1.category, 'conversational')
assert.strictEqual(intent1.needsSearch, false)
conversationHistory.push({ role: 'user', content: 'hello' })
conversationHistory.push({ role: 'assistant', content: 'Rey mama! Namaskaram ra, ela unnav? Cheppu em sangathi!' })

// Turn 2
console.log('\n--- Turn 2: "tell me something" ---')
const intent2 = classifyIntent('tell me something', conversationHistory)
console.log(`Intent 2: category=${intent2.category}, needsSearch=${intent2.needsSearch}, reason="${intent2.reason}"`)
assert.strictEqual(intent2.category, 'conversational')
assert.strictEqual(intent2.needsSearch, false)
conversationHistory.push({ role: 'user', content: 'tell me something' })
conversationHistory.push({ role: 'assistant', content: 'Arey mama, oka interesting vishayam cheppana? Honey (thene) never spoils ra! 3000 years old Egyptian tombs lo dorikina honey kuda inka safe ga tinaachu!' })

// Turn 3
console.log('\n--- Turn 3: "do you know hyderabad" ---')
const intent3 = classifyIntent('do you know hyderabad', conversationHistory)
console.log(`Intent 3: category=${intent3.category}, needsSearch=${intent3.needsSearch}, reason="${intent3.reason}"`)
assert.strictEqual(intent3.needsSearch, false)
conversationHistory.push({ role: 'user', content: 'do you know hyderabad' })
conversationHistory.push({ role: 'assistant', content: 'Ha baga telusu mama! Hyderabad is our pride ra — City of Pearls, Charminar, world-famous Biryani, and IT powerhouse Hitec City. Hyderabad gurinchi em thelusukovalani undi cheppu?' })

// Turn 4
console.log('\n--- Turn 4: "ammerpet" ---')
const intent4 = classifyIntent('ammerpet', conversationHistory)
console.log(`Intent 4: category=${intent4.category}, needsSearch=${intent4.needsSearch}, correctedEntity=${intent4.correctedEntity}, topic=${intent4.contextualTopic}`)
assert.strictEqual(intent4.category, 'contextual_followup')
assert.strictEqual(intent4.correctedEntity, 'Ameerpet')
assert.strictEqual(intent4.contextualTopic, 'Hyderabad')
assert.strictEqual(intent4.needsSearch, false, 'Must NOT search Ammersee in Germany!')
conversationHistory.push({ role: 'user', content: 'ammerpet' })
conversationHistory.push({ role: 'assistant', content: 'Ameerpet gurincha mama! Ameerpet Hyderabad lo software coaching ki capital ra! India motham nunchi techies vachi coaching theesukuntaru, plus busy metro interchange hub adi.' })

// Turn 5
console.log('\n--- Turn 5: "ameerpet" ---')
const intent5 = classifyIntent('ameerpet', conversationHistory)
console.log(`Intent 5: category=${intent5.category}, needsSearch=${intent5.needsSearch}, correctedEntity=${intent5.correctedEntity}, topic=${intent5.contextualTopic}`)
assert.strictEqual(intent5.category, 'contextual_followup')
assert.strictEqual(intent5.correctedEntity, 'Ameerpet')
assert.strictEqual(intent5.contextualTopic, 'Hyderabad')
assert.strictEqual(intent5.needsSearch, false)
conversationHistory.push({ role: 'user', content: 'ameerpet' })
conversationHistory.push({ role: 'assistant', content: 'Yes mama, Ameerpet lo Sarathi Studios, Mythrivanam, Aditya Enclave chala famous. Commercial ga chala busy center.' })

// Turn 6
console.log('\n--- Turn 6: User corrects the AI ---')
const complaint = 'first i asked hyderabad after that ameerpet you rectify my spelling mistakes but here i need to rectify you mistakes'
const intent6 = classifyIntent(complaint, conversationHistory)
console.log(`Intent 6: category=${intent6.category}, needsSearch=${intent6.needsSearch}, isCorrectionOrFeedback=${intent6.isCorrectionOrFeedback}`)
assert.strictEqual(intent6.category, 'correction_feedback')
assert.strictEqual(intent6.isCorrectionOrFeedback, true)
assert.strictEqual(intent6.needsSearch, false, 'Must NEVER search the complaint sentence!')

console.log('\n=== EXACT REPRODUCTION MULTI-TURN TEST PASSED WITH 100% ACCURACY! 🎉 ===\n')
