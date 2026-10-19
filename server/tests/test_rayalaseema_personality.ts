import fetch from 'node-fetch'

const BASE_URL = 'http://localhost:3001'

interface TestCase {
  name: string
  prompt: string
  expectSlangOrTone: string[]
}

const testCases: TestCase[] = [
  {
    name: 'Casual Bro Greeting',
    prompt: "Bro, what's up?",
    expectSlangOrTone: ['mama', 'ra', 'cheppu', 'scene', 'sangathi'],
  },
  {
    name: 'Language Switch Request',
    prompt: 'Talk in English, bro.',
    expectSlangOrTone: ['bro', 'scene', 'going on', 'tell'],
  },
  {
    name: 'Technical Code Troubleshooting',
    prompt: 'My code is broken again.',
    expectSlangOrTone: ['bokka', 'error', 'damn', 'shit', 'sort', 'padindi'],
  },
  {
    name: 'Honest Purchasing Advice',
    prompt: 'Should I buy this phone?',
    expectSlangOrTone: ['honestly', "don't rush", 'waste', 'compare', 'money', 'bro'],
  },
  {
    name: 'Educational Swear Words Explanation',
    prompt: 'Teach me bad words.',
    expectSlangOrTone: ['swear', 'words', 'mean', 'strong', 'use'],
  },
  {
    name: 'Direct Idea Reality Check',
    prompt: 'I think my idea is perfect.',
    expectSlangOrTone: ['confidence', 'bagundi', 'test', 'works', 'money'],
  },
  {
    name: 'Emotional Best-Friend Support',
    prompt: 'I feel really bad today.',
    expectSlangOrTone: ['mama', 'listening', 'em ayyindi', 'talk'],
  },
  {
    name: 'Teluglish Casual Chit-Chat',
    prompt: 'Orey mama ela unnav ra?',
    expectSlangOrTone: ['solid', 'mama', 'scene', 'cheppu'],
  },
]

async function runTests() {
  console.log('=====================================================')
  console.log('🧪 TESTING RAYALASEEMA TELUGLISH BEST FRIEND PERSONA')
  console.log('=====================================================\n')

  let passed = 0

  for (const tc of testCases) {
    try {
      const res = await fetch(`${BASE_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: tc.prompt }),
      })

      if (!res.ok) {
        console.error(`❌ [${tc.name}] HTTP ${res.status}`)
        continue
      }

      // Handle streaming or text response
      const text = await res.text()
      // Extract answer from SSE or plain text
      let answer = ''
      const lines = text.split('\n')
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6))
            if (data.token) answer += data.token
            if (data.fullResponse) answer = data.fullResponse
          } catch {}
        }
      }
      if (!answer) answer = text

      const lowerAnswer = answer.toLowerCase()
      const matchedTokens = tc.expectSlangOrTone.filter((t) => lowerAnswer.includes(t.toLowerCase()))

      console.log(`💬 User: "${tc.prompt}"`)
      console.log(`🤖 Mana AI: "${answer.slice(0, 180)}..."`)
      console.log(`🎯 Matched Persona Markers: [${matchedTokens.join(', ')}]`)

      if (matchedTokens.length > 0) {
        console.log(`✅ [PASS] ${tc.name}\n`)
        passed++
      } else {
        console.warn(`⚠️ [WARN] ${tc.name} — didn't match expected markers\n`)
      }
    } catch (err: any) {
      console.error(`❌ [FAIL] ${tc.name}:`, err.message)
    }
  }

  console.log(`\n=====================================================`)
  console.log(`📊 RESULTS: ${passed}/${testCases.length} Tests Passed`)
  console.log(`=====================================================\n`)
}

runTests()
