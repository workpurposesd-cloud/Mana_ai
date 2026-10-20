import { generateOllamaStream, buildOllamaSystemPrompt } from '../server/services/aiService.js'
import { configService } from '../server/services/configService.js'

async function run() {
  const cfg = configService.getConfig()
  const systemPrompt = buildOllamaSystemPrompt(cfg)

  console.log('--- STARTING CONSECUTIVE TIMED OLLAMA BENCHMARK ---')
  console.log('Optimized System Prompt Length (chars):', systemPrompt.length)

  // RUN 1 (Warmup)
  console.log('\n[Run 1: Warmup Query]')
  let t1First: number | null = null
  let t1Count = 0
  let t1Start = Date.now()
  await generateOllamaStream(
    'http://127.0.0.1:11434',
    'qwen2.5:3b',
    systemPrompt,
    'Hi bro, who are you?',
    [],
    () => {
      if (!t1First) t1First = Date.now() - t1Start
      t1Count++
    }
  )
  console.log(`Run 1 -> TTFT: ${t1First}ms | Total: ${Date.now() - t1Start}ms | Tokens: ${t1Count}`)

  // RUN 2 (Resident in memory with active KV Cache)
  console.log('\n[Run 2: Follow-up Query]')
  let t2First: number | null = null
  let t2Count = 0
  let t2Start = Date.now()
  const history = [
    { role: 'user' as const, content: 'Do you know Hyderabad?' },
    { role: 'assistant' as const, content: 'Yes! Hyderabad is famous for Charminar and Biryani.' },
  ]
  const reply2 = await generateOllamaStream(
    'http://127.0.0.1:11434',
    'qwen2.5:3b',
    systemPrompt,
    'ammerpet',
    history,
    () => {
      if (!t2First) t2First = Date.now() - t2Start
      t2Count++
    }
  )
  const t2Total = Date.now() - t2Start
  const tps2 = (t2Count / (t2Total / 1000)).toFixed(1)
  console.log(`Run 2 -> TTFT: ${t2First}ms | Total: ${t2Total}ms | Tokens: ${t2Count} | Speed: ${tps2} tokens/sec`)
  console.log('Follow-up understanding verified:', reply2.slice(0, 150))
}

run().catch(console.error)
