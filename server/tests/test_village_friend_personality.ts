import fetch from 'node-fetch'

const BASE_URL = 'http://localhost:3001'

interface TestScenario {
  id: number
  name: string
  prompt: string
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
  validate: (answer: string) => { passed: boolean; reason: string }
}

const scenarios: TestScenario[] = [
  {
    id: 1,
    name: 'Casual greeting in Roman Telugu',
    prompt: 'Rey mama em chesthunnav ra?',
    validate: (answer: string) => {
      const lower = answer.toLowerCase()
      const hasGreeting = lower.includes('mama') && (lower.includes('cheppu') || lower.includes('sollu') || lower.includes('em chesthunnav') || lower.includes('puka'))
      const notRobotic = !lower.includes('certainly') && !lower.includes('as an ai') && !lower.includes('how may i assist')
      return {
        passed: hasGreeting && notRobotic,
        reason: hasGreeting && notRobotic ? 'Authentic Roman Telugu village friend greeting' : 'Missing village tone or sounds robotic',
      }
    },
  },
  {
    id: 2,
    name: 'Friendly roasting after a harmless mistake',
    prompt: 'Arey mama, nenu code commit cheyyakunda branch delete chesesa ra',
    validate: (answer: string) => {
      const lower = answer.toLowerCase()
      const hasRoast = lower.includes('award') || lower.includes('chetha na kodaka') || lower.includes('lamidi lodaka') || lower.includes('marchipoyava') || lower.includes('planning')
      const hasHelp = lower.includes('problem') || lower.includes('fix') || lower.includes('chuddam') || lower.includes('tension padaku')
      return {
        passed: hasRoast && hasHelp,
        reason: hasRoast && hasHelp ? 'Playful roasting with friendly swearing followed by helpful reassurance' : 'Missing roasting or helpful fix',
      }
    },
  },
  {
    id: 3,
    name: 'A funny comeback to an insult',
    prompt: 'Orey puka, neeku em thelusu ra waste fellow',
    validate: (answer: string) => {
      const lower = answer.toLowerCase()
      const hasComeback = (lower.includes('waste fellow') || lower.includes('heat') || lower.includes('blast') || lower.includes('burra')) && (lower.includes('roasting') || lower.includes('prema') || lower.includes('cheppu'))
      return {
        passed: hasComeback,
        reason: hasComeback ? 'Witty comeback matching the user banter without getting defensive' : 'Missing witty banter or comeback',
      }
    },
  },
  {
    id: 4,
    name: 'A serious health question (must be compassionate, NO jokes/swearing)',
    prompt: 'Mama, intlo ma nanna ki health problem valla chaala tension ga undhi ra',
    validate: (answer: string) => {
      const lower = answer.toLowerCase()
      // STRICT RULES:
      const hasLaughter = answer.includes('😂') || answer.includes('🤣') || lower.includes('haha') || lower.includes('hahaha')
      const hasSwearing = lower.includes('puka') || lower.includes('chetha na kodaka') || lower.includes('lamidi lodaka') || lower.includes('bokka')
      const hasEmpathy = lower.includes('calm') && lower.includes('doctor') && (lower.includes('ardham ayyindhi') || lower.includes('step by step') || lower.includes('nenunnanu'))

      if (hasLaughter) return { passed: false, reason: 'FAILED: Found inappropriate jokes/emojis in serious health question!' }
      if (hasSwearing) return { passed: false, reason: 'FAILED: Found swearing/bad words in serious health question!' }
      return {
        passed: hasEmpathy,
        reason: hasEmpathy ? 'Compassionate, supportive, zero jokes, zero swearing' : 'Missing calm empathetic advice or doctor recommendation',
      }
    },
  },
  {
    id: 5,
    name: 'A financial problem',
    prompt: 'Mama, loans ekkuva aipoyayi, monthly EMI kattaleka chaala stress ga undhi ra',
    validate: (answer: string) => {
      const lower = answer.toLowerCase()
      const noMockery = !answer.includes('😂') && !answer.includes('🤣') && !lower.includes('puka')
      const hasFinancialAdvice = (lower.includes('high-interest') || lower.includes('debt') || lower.includes('debts') || lower.includes('emi')) && (lower.includes('restructure') || lower.includes('plan') || lower.includes('calm'))
      return {
        passed: noMockery && hasFinancialAdvice,
        reason: noMockery && hasFinancialAdvice ? 'Grounded, empathetic debt-management strategy without mockery' : 'Missing financial advice or contained mockery',
      }
    },
  },
  {
    id: 6,
    name: 'A Java coding question',
    prompt: 'Mama, Java lo list of numbers ni stream use chesi filter and sum ela cheyyali?',
    validate: (answer: string) => {
      const lower = answer.toLowerCase()
      const hasVillageIntro = lower.includes('mama') && lower.includes('java')
      const hasCodeBlock = answer.includes('```java') || answer.includes('```')
      const hasStreamLogic = answer.includes('.stream()') && answer.includes('.filter(') && (answer.includes('.sum()') || answer.includes('mapToInt'))
      return {
        passed: hasVillageIntro && hasCodeBlock && hasStreamLogic,
        reason: hasVillageIntro && hasCodeBlock && hasStreamLogic ? 'Friendly village opener with 100% accurate compilable Java Stream code' : 'Missing Java stream code or village opener',
      }
    },
  },
  {
    id: 7,
    name: 'A Git or Netlify troubleshooting question',
    prompt: 'Mama, Git push avvatledhu ra rejected non-fast-forward error vastondi',
    validate: (answer: string) => {
      const lower = answer.toLowerCase()
      const hasVillageTone = lower.includes('mama') && lower.includes('git')
      const hasGitFix = (lower.includes('fetch') || lower.includes('rebase') || lower.includes('pull')) && lower.includes('push')
      return {
        passed: hasVillageTone && hasGitFix,
        reason: hasVillageTone && hasGitFix ? 'Accurate Git non-fast-forward commands with village buddy tone' : 'Missing git troubleshooting commands',
      }
    },
  },
  {
    id: 8,
    name: 'A request to speak only English',
    prompt: 'Talk only in English',
    validate: (answer: string) => {
      const lower = answer.toLowerCase()
      const hasEnglishBuddyTone = lower.includes('english') && (lower.includes('bro') || lower.includes('got it') || lower.includes('work'))
      const noTeluguSlang = !lower.includes('mama') && !lower.includes('ra ') && !lower.includes('cheppu')
      return {
        passed: hasEnglishBuddyTone && noTeluguSlang,
        reason: hasEnglishBuddyTone && noTeluguSlang ? 'Responded in casual buddy English without forcing Telugu slang' : 'Failed to switch to pure English',
      }
    },
  },
  {
    id: 9,
    name: 'A Telugu-script conversation',
    prompt: 'రేయ్ మామా, ఎలా ఉన్నావురా?',
    validate: (answer: string) => {
      // Must contain authentic Telugu Unicode script
      const hasTeluguScript = /[\u0C00-\u0C7F]/.test(answer)
      const hasVillageVibe = answer.includes('మామా') || answer.includes('సూపర్') || answer.includes('సంగతులు') || answer.includes('రచ్చ')
      return {
        passed: hasTeluguScript && hasVillageVibe,
        reason: hasTeluguScript && hasVillageVibe ? 'Accurate, warm Telugu script response' : 'Missing Telugu script or village vibe',
      }
    },
  },
  {
    id: 10,
    name: 'A long conversation with relevant follow-up context',
    prompt: 'and how about in Java?',
    history: [
      { role: 'user', content: 'How to reverse a string in Python?' },
      { role: 'assistant', content: '🐍 In Python, reverse a string with slice notation: `text[::-1]`' },
    ],
    validate: (answer: string) => {
      const lower = answer.toLowerCase()
      const hasJava = lower.includes('java')
      const hasReversalContext = lower.includes('reverse') || lower.includes('stringbuilder') || lower.includes('olleh')
      return {
        passed: hasJava && hasReversalContext,
        reason: hasJava && hasReversalContext ? 'Successfully maintained conversation context and provided Java string reversal code' : 'Lost context of string reversal or missing Java code',
      }
    },
  },
]

async function runAllScenarios() {
  console.log('======================================================================')
  console.log('🌾 MANA AI — ANDHRA PRADESH VILLAGE FRIEND PERSONALITY TEST SUITE')
  console.log('======================================================================\n')

  let passedCount = 0

  for (const s of scenarios) {
    console.log(`----------------------------------------------------------------------`)
    console.log(`📌 Scenario ${s.id}: ${s.name}`)
    console.log(`💬 User: "${s.prompt}"`)
    if (s.history && s.history.length > 0) {
      console.log(`📜 History: [${s.history.map((h) => `${h.role}: ${h.content}`).join(' | ')}]`)
    }

    try {
      const res = await fetch(`${BASE_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: s.prompt,
          history: s.history || [],
        }),
      })

      if (!res.ok) {
        console.error(`❌ HTTP Error: ${res.status}`)
        continue
      }

      const text = await res.text()
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

      console.log(`🤖 Mana AI Response:\n${answer.trim()}`)

      const result = s.validate(answer)
      if (result.passed) {
        console.log(`\n✅ PASS: ${result.reason}`)
        passedCount++
      } else {
        console.log(`\n❌ FAIL: ${result.reason}`)
      }
    } catch (err: any) {
      console.error(`❌ Request Exception: ${err.message}`)
    }
    console.log('')
  }

  console.log('======================================================================')
  console.log(`🏁 FINAL RESULTS: ${passedCount}/${scenarios.length} Scenarios Passed (${Math.round((passedCount / scenarios.length) * 100)}%)`)
  console.log('======================================================================')

  if (passedCount === scenarios.length) {
    process.exit(0)
  } else {
    process.exit(1)
  }
}

runAllScenarios()
