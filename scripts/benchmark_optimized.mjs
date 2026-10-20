import fetch from 'node-fetch'

const BASE_URL = 'https://mana-ai-local.netlify.app'

const testPrompts = [
  { name: 'Telugu Greeting', prompt: 'హలో మావా! బాగున్నావా?' },
  { name: 'Math Tool Query', prompt: 'calculate 25 * 48' },
  { name: 'Technical Question', prompt: 'How do I center a div in CSS?' },
  { name: 'Telugu Cultural Inquiry', prompt: 'ఆంధ్ర పల్లెల గురించి ఒక మంచి మాట చెప్పు మావా' },
  { name: 'Long Explanation', prompt: 'Explain the difference between SQL and NoSQL in detail' },
]

async function measurePrompt(testItem) {
  const reqStart = Date.now()
  let firstTokenTime = null
  let tokenCount = 0
  let statusTime = null
  let fullText = ''
  let chunkCount = 0

  try {
    const res = await fetch(`${BASE_URL}/.netlify/functions/chat-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: testItem.prompt }),
    })

    statusTime = Date.now() - reqStart

    if (!res.ok) {
      return {
        name: testItem.name,
        error: `HTTP ${res.status}`,
        statusTime,
        ttft: null,
        totalTime: Date.now() - reqStart,
      }
    }

    const reader = res.body
    await new Promise((resolve, reject) => {
      reader.on('data', (chunk) => {
        chunkCount++
        const text = chunk.toString()
        fullText += text
        if (!firstTokenTime && text.includes('event: token')) {
          firstTokenTime = Date.now() - reqStart
        }
        const matches = text.match(/event: token/g)
        if (matches) tokenCount += matches.length
      })
      reader.on('end', resolve)
      reader.on('error', reject)
    })

    const totalTime = Date.now() - reqStart
    // True streaming means chunks arrive incrementally (chunkCount > 1 and firstTokenTime < totalTime - 100)
    const isTrueStreaming = chunkCount > 2 && firstTokenTime !== null && (totalTime - firstTokenTime > 50)

    return {
      name: testItem.name,
      statusTime,
      ttft: firstTokenTime || totalTime,
      totalTime,
      chunks: chunkCount,
      tokensReceived: tokenCount,
      streamingMode: isTrueStreaming ? 'TRUE SSE STREAMING' : 'Single Batch',
    }
  } catch (err) {
    return {
      name: testItem.name,
      error: err.message,
      totalTime: Date.now() - reqStart,
    }
  }
}

async function runBenchmark() {
  console.log('=== OPTIMIZED PERFORMANCE MEASUREMENTS (LIVE PRODUCTION NETLIFY) ===')
  console.log(`Target: ${BASE_URL}\n`)

  const results = []
  for (const item of testPrompts) {
    console.log(`Measuring: "${item.name}"...`)
    const result = await measurePrompt(item)
    results.push(result)
    console.log(`  -> Status received: ${result.statusTime} ms`)
    console.log(`  -> TTFT (First Token): ${result.ttft} ms`)
    console.log(`  -> Total Latency: ${result.totalTime} ms`)
    console.log(`  -> Streaming: ${result.streamingMode} (${result.chunks} HTTP chunks)`)
    console.log(`  -> Tokens: ${result.tokensReceived}\n`)
    await new Promise((r) => setTimeout(r, 800))
  }

  console.log('=== OPTIMIZED PERFORMANCE SUMMARY ===')
  console.table(results)
}

runBenchmark().catch(console.error)
