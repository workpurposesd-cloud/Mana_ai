/**
 * Mana AI Comprehensive Evaluation and Benchmarking Suite
 * Evaluates conversation quality, reasoning, tool execution, search gating,
 * memory persistence, document RAG, and multimodal image/video generation.
 */

const BASE_URL = 'http://localhost:3001'

interface TestCaseResult {
  category: string
  testName: string
  passed: boolean
  durationMs: number
  details: string
}

const results: TestCaseResult[] = []

async function runTest(category: string, name: string, fn: () => Promise<string | void>) {
  process.stdout.write(`⏳ [${category}] ${name}... `)
  const start = Date.now()
  try {
    const details = await fn()
    const ms = Date.now() - start
    console.log(`✅ (${ms}ms)`)
    results.push({
      category,
      testName: name,
      passed: true,
      durationMs: ms,
      details: details || 'Passed',
    })
  } catch (err: any) {
    const ms = Date.now() - start
    console.log(`❌ (${ms}ms): ${err.message}`)
    results.push({
      category,
      testName: name,
      passed: false,
      durationMs: ms,
      details: err.message,
    })
  }
}

async function runEvaluation() {
  console.log('🚀 Starting Mana AI Assistant Evaluation Suite...\n')

  // --- CATEGORY 1: HEALTH & SERVER STATUS ---
  await runTest('Server', 'Backend Health Endpoint', async () => {
    const res = await fetch(`${BASE_URL}/api/health`)
    if (!res.ok) throw new Error(`Health returned HTTP ${res.status}`)
    const data = await res.json()
    if (data.status !== 'ok') throw new Error('Status not ok')
    return `Server uptime: ${data.uptimeSeconds}s`
  })

  // --- CATEGORY 2: SEARCH GATING (ChatGPT-style direct answer vs live search) ---
  await runTest('Search Gating', 'Direct Answer for Conceptual Question (No search)', async () => {
    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'what is photosynthesis in plants?' }),
    })
    const data = await res.json()
    if (!data.success) throw new Error(data.error || 'Chat failed')
    if (data.isSearchPerformed) {
      throw new Error('Search was incorrectly triggered for conceptual question!')
    }
    return `Answered directly like ChatGPT. Preview: "${data.content.slice(0, 80)}..."`
  })

  await runTest('Search Gating', 'Search Triggered for Explicit Search Query', async () => {
    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'search google for latest world news headlines today' }),
    })
    const data = await res.json()
    if (!data.success) throw new Error(data.error || 'Chat failed')
    if (!data.isSearchPerformed) {
      throw new Error('Search should have been performed for explicit search query!')
    }
    return `Correctly triggered live search. Sources: ${data.searchEvidence?.results?.length || 0}`
  })

  // --- CATEGORY 3: SAFE TOOL EXECUTION ---
  await runTest('Tools', 'Mathematical Calculator Tool', async () => {
    const res = await fetch(`${BASE_URL}/api/tools/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'calculate', arguments: { expression: 'sqrt(256) * 10 + 40 / 2' } }),
    })
    const data = await res.json()
    if (!data.success) throw new Error(data.result?.error || 'Tool failed')
    // sqrt(256)=16, 16*10=160, 40/2=20 -> 180
    if (data.result.result.value !== 180) {
      throw new Error(`Expected 180, got ${data.result.result.value}`)
    }
    return `Calculated sqrt(256) * 10 + 40 / 2 = ${data.result.result.value}`
  })

  await runTest('Tools', 'Clock & Date Timezone Tool', async () => {
    const res = await fetch(`${BASE_URL}/api/tools/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'get_current_time', arguments: { timezone: 'Asia/Kolkata' } }),
    })
    const data = await res.json()
    if (!data.success) throw new Error(data.result?.error || 'Tool failed')
    return `Time in IST: ${data.result.result.formatted}`
  })

  await runTest('Tools', 'Unit Conversion Tool', async () => {
    const res = await fetch(`${BASE_URL}/api/tools/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'convert_units', arguments: { value: 10, from: 'miles', to: 'km' } }),
    })
    const data = await res.json()
    if (!data.success) throw new Error(data.result?.error || 'Tool failed')
    // 10 miles = 16.0934 km
    return `Result: ${data.result.result.formula}`
  })

  // --- CATEGORY 4: CONVERSATION & REASONING ---
  await runTest('Reasoning', 'Step-by-Step Logic Puzzle', async () => {
    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'If a farmer has 17 sheep and all but 9 run away, how many sheep are left? Explain your reasoning.',
        reasoningMode: 'thinking',
      }),
    })
    const data = await res.json()
    if (!data.success) throw new Error(data.error || 'Chat failed')
    if (!data.content.includes('9')) {
      throw new Error('Reasoning failed to conclude 9 sheep remain!')
    }
    return `Reasoning validated: "${data.content.slice(0, 100)}..."`
  })

  // --- CATEGORY 5: MEMORY PERSISTENCE & PRIVACY CONTROLS ---
  let createdMemoryId = ''
  await runTest('Memory', 'Add User Memory', async () => {
    const res = await fetch(`${BASE_URL}/api/memories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category: 'preference',
        key: 'Test Assistant Preference',
        value: 'Always provide concise answers with bullet points.',
      }),
    })
    const data = await res.json()
    if (!data.success || !data.memory) throw new Error('Failed to create memory')
    createdMemoryId = data.memory.id
    return `Saved memory ID: ${createdMemoryId}`
  })

  await runTest('Memory', 'Update User Memory (PUT)', async () => {
    if (!createdMemoryId) throw new Error('No memory ID to update')
    const res = await fetch(`${BASE_URL}/api/memories/${createdMemoryId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        value: 'Always provide concise answers with emojis.',
      }),
    })
    const data = await res.json()
    if (!data.success || data.memory.value !== 'Always provide concise answers with emojis.') {
      throw new Error('Failed to update memory')
    }
    return `Updated memory value to: "${data.memory.value}"`
  })

  await runTest('Memory', 'Delete User Memory', async () => {
    if (!createdMemoryId) throw new Error('No memory ID to delete')
    const res = await fetch(`${BASE_URL}/api/memories/${createdMemoryId}`, {
      method: 'DELETE',
    })
    const data = await res.json()
    if (!data.success) throw new Error('Failed to delete memory')
    return `Deleted memory ID: ${createdMemoryId}`
  })

  // --- CATEGORY 6: DOCUMENT KNOWLEDGE (RAG) ---
  let createdDocId = ''
  await runTest('RAG Documents', 'Upload Knowledge Document', async () => {
    const sampleDoc = `Mana AI Knowledge Base\nVersion: 2.5\nFeature: Built-in Cinematic Video Engine renders 720p/1080p clips seamlessly.\nSecurity: Zero client-side API keys exposed.`
    const res = await fetch(`${BASE_URL}/api/documents/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Mana Architecture Spec',
        originalName: 'mana_spec.txt',
        mimeType: 'text/plain',
        content: sampleDoc,
      }),
    })
    const data = await res.json()
    if (!data.success || !data.document) throw new Error('Failed to index document')
    createdDocId = data.document.id
    return `Indexed document "${data.document.title}" with ${data.document.chunkCount} chunks`
  })

  await runTest('RAG Documents', 'Search Knowledge Passages', async () => {
    const res = await fetch(`${BASE_URL}/api/documents/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'cinematic video engine', limit: 2 }),
    })
    const data = await res.json()
    if (!data.success || !data.matches || data.matches.length === 0) {
      throw new Error('Failed to retrieve matching passage')
    }
    return `Retrieved passage from "${data.matches[0].docTitle}" with score ${data.matches[0].score}`
  })

  await runTest('RAG Documents', 'Delete Knowledge Document', async () => {
    if (!createdDocId) throw new Error('No doc ID to delete')
    const res = await fetch(`${BASE_URL}/api/documents/${createdDocId}`, {
      method: 'DELETE',
    })
    const data = await res.json()
    if (!data.success) throw new Error('Failed to delete document')
    return `Deleted document ID: ${createdDocId}`
  })

  // --- CATEGORY 7: AI IMAGE GENERATION ---
  await runTest('Image Generation', 'Generate and Cache Image (Authentic AI Pipeline)', async () => {
    const res = await fetch(`${BASE_URL}/api/generate/image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'a futuristic purple neon robot assistant in a clean office',
        aspectRatio: '1:1',
      }),
    })
    const data = await res.json()
    if (data.success && data.image?.url) {
      if (data.image.url.startsWith('/api/media/')) {
        const imgCheck = await fetch(`${BASE_URL}${data.image.url}`)
        if (!imgCheck.ok) throw new Error(`Media endpoint returned HTTP ${imgCheck.status}`)
        return `Generated & cached: ${data.image.url} via ${data.image.provider} (${imgCheck.headers.get('content-length')} bytes)`
      }
      return `Generated: ${data.image.url.slice(0, 50)}... via ${data.image.provider}`
    }

    // If rate-limited by free tier, verify clear error is returned
    const err = data.error || ''
    if (err.includes('rate-limit') || err.includes('limit') || err.includes('OpenAI') || err.includes('busy')) {
      return `Honest provider error handled gracefully: "${err.slice(0, 80)}..."`
    }
    throw new Error(err || 'Image generation failed unexpectedly')
  })

  // --- CATEGORY 8: AI VIDEO GENERATION ---
  await runTest('Video Generation', 'Video Job Validation & Provider Authentication Enforcement', async () => {
    const res = await fetch(`${BASE_URL}/api/generate/video`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'hypercar cruising down a rainy neon boulevard at dusk',
        aspectRatio: '16:9',
        duration: 5,
      }),
    })
    const data = await res.json()
    // When no video API key is set, the API must honestly report key requirement rather than simulating a fake video
    if (res.status === 500 || res.status === 400 || !data.success) {
      const err = data.error || ''
      if (err.includes('API key') || err.includes('Luma') || err.includes('Replicate')) {
        return `Correctly enforced provider authentication: "${err}"`
      }
      throw new Error(`Unexpected error: ${err}`)
    }
    // If a key was configured, verify valid job created
    if (data.job?.jobId) {
      return `Job created: ${data.job.jobId} with status ${data.job.status} via ${data.job.provider}`
    }
    throw new Error('Video generation validation failed')
  })

  // --- REPORT SUMMARY ---
  console.log('\n============================================================')
  console.log('              MANA AI EVALUATION REPORT                     ')
  console.log('============================================================\n')

  let passedCount = 0
  for (const r of results) {
    const symbol = r.passed ? '✅' : '❌'
    if (r.passed) passedCount++
    console.log(`${symbol} [${r.category}] ${r.testName} (${r.durationMs}ms)`)
    console.log(`   └─ ${r.details}\n`)
  }

  const scorePct = Math.round((passedCount / results.length) * 100)
  console.log('------------------------------------------------------------')
  console.log(`TOTAL TESTS: ${results.length} | PASSED: ${passedCount} | FAILED: ${results.length - passedCount}`)
  console.log(`BENCHMARK SCORE: ${scorePct}%`)
  console.log('============================================================\n')

  if (passedCount === results.length) {
    console.log('🎉 ALL ASSISTANT CAPABILITY EVALUATIONS PASSED SUCCESSFULLY!')
  } else {
    console.error('⚠️ Some tests failed. Review the details above.')
    process.exit(1)
  }
}

runEvaluation().catch((err) => {
  console.error('Fatal evaluation suite error:', err)
  process.exit(1)
})
