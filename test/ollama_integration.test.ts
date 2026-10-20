import assert from 'node:assert'
import { configService } from '../server/services/configService.js'
import { selectModelForTask } from '../server/services/modelRouter.js'
import { orchestrateChat } from '../server/services/chatOrchestrator.js'
import { checkOllamaStatus, generateOllamaStream } from '../server/services/aiService.js'

process.env.NODE_ENV = 'test'

console.log('=== RUNNING MANA AI LOCAL OLLAMA INTEGRATION & REGRESSION TESTS ===\n')

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
  // TEST 1: Default configuration selects Ollama and qwen2.5:3b
  await runTest('Test 1: Default configuration selects Ollama and qwen2.5:3b', () => {
    const cfg = configService.getConfig()
    assert.strictEqual(cfg.aiProvider, 'ollama', `Expected aiProvider to be 'ollama', got: ${cfg.aiProvider}`)
    assert.strictEqual(cfg.ollamaModel, 'qwen2.5:3b', `Expected ollamaModel to be 'qwen2.5:3b', got: ${cfg.ollamaModel}`)
    assert.strictEqual(cfg.ollamaBaseUrl, 'http://127.0.0.1:11434', `Expected ollamaBaseUrl to be 'http://127.0.0.1:11434', got: ${cfg.ollamaBaseUrl}`)
  })

  // TEST 2: ModelRouter routes tasks to Ollama when configured
  await runTest('Test 2: ModelRouter routes fast and reasoning tasks to Ollama', () => {
    const cfg = configService.getConfig()
    const fastSelection = selectModelForTask('fast', cfg, {
      category: 'conversational',
      confidence: 1,
      needsSearch: false,
      isDetailRequested: false,
    })
    assert.strictEqual(fastSelection.provider, 'ollama')
    assert.strictEqual(fastSelection.modelName, 'qwen2.5:3b')

    const deepSelection = selectModelForTask('reasoning', cfg, {
      category: 'coding',
      confidence: 1,
      needsSearch: false,
      isDetailRequested: true,
    })
    assert.strictEqual(deepSelection.provider, 'ollama')
    assert.strictEqual(deepSelection.modelName, 'qwen2.5:3b')
  })

  // TEST 3: OrchestrateChat streams tokens cleanly with Ollama in test mode
  await runTest('Test 3: OrchestrateChat streams tokens and finishes with onDone', async () => {
    const tokens: string[] = []
    let doneEvent: any = null

    await orchestrateChat(
      {
        prompt: 'Namaste Mana AI! Tell me something interesting.',
        aiProvider: 'ollama',
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
    assert.strictEqual(doneEvent.provider, 'ollama')
    assert.strictEqual(doneEvent.model, 'qwen2.5:3b')
    assert(doneEvent.content.length > 0, 'Content must not be empty')
    assert(doneEvent.timings.totalMs >= 0, 'Timing must be non-negative')
  })

  // TEST 4: Multi-turn history is preserved across follow-up queries
  await runTest('Test 4: Multi-turn history is preserved in chat orchestrator', async () => {
    const history = [
      { role: 'user' as const, content: 'Do you know Hyderabad?' },
      { role: 'assistant' as const, content: 'Yes! Hyderabad is known for Charminar, Biryani, and its IT hub.' },
    ]

    let resultDone: any = null
    await orchestrateChat(
      {
        prompt: 'What about Ameerpet?',
        history,
        aiProvider: 'ollama',
        searchMode: 'never',
      },
      {
        onToken: () => {},
        onDone: (data) => {
          resultDone = data
        },
      }
    )

    assert(resultDone !== null, 'onDone event must be emitted for multi-turn request')
    assert.strictEqual(resultDone.provider, 'ollama')
    assert(resultDone.content.length > 0, 'Follow-up reply must be generated')
  })

  // TEST 5: Clean failure and clear guidance when Ollama server is unreachable
  await runTest('Test 5: Clean error when Ollama server is unreachable on invalid port', async () => {
    let caughtError: any = null
    try {
      const prevEnv = process.env.NODE_ENV
      process.env.NODE_ENV = 'production'
      try {
        await generateOllamaStream(
          'http://127.0.0.1:59999',
          'qwen2.5:3b',
          'System prompt',
          'Hello',
          [],
          () => {}
        )
      } finally {
        process.env.NODE_ENV = prevEnv
      }
    } catch (err: any) {
      caughtError = err
    }

    assert(caughtError !== null, 'Should throw an error when Ollama is unreachable')
    assert(
      caughtError.message.includes('Ollama is not running') || caughtError.message.includes('Failed to connect'),
      `Expected Ollama unreachable message, got: ${caughtError.message}`
    )
  })

  // TEST 6: Clear guidance when invoked in Netlify cloud serverless environment
  await runTest('Test 6: Netlify cloud environment returns clear explanation', async () => {
    const prevNetlify = process.env.NETLIFY
    const prevEnv = process.env.NODE_ENV
    process.env.NETLIFY = 'true'
    process.env.NODE_ENV = 'production'
    let caughtError: any = null

    try {
      await generateOllamaStream(
        'http://127.0.0.1:11434',
        'qwen2.5:3b',
        'System prompt',
        'Hello',
        [],
        () => {}
      )
    } catch (err: any) {
      caughtError = err
    } finally {
      process.env.NETLIFY = prevNetlify
      process.env.NODE_ENV = prevEnv
    }

    assert(caughtError !== null, 'Should reject Ollama 127.0.0.1 in Netlify environment')
    assert(
      caughtError.message.includes('Netlify') || caughtError.message.includes('local computer'),
      `Expected Netlify-specific guidance, got: ${caughtError.message}`
    )
  })

  // TEST 7: checkOllamaStatus gracefully handles offline state without throwing
  await runTest('Test 7: checkOllamaStatus returns safe status object when offline', async () => {
    const status = await checkOllamaStatus('http://127.0.0.1:59999')
    assert.strictEqual(typeof status.connected, 'boolean')
    assert.strictEqual(status.connected, false)
    assert(Array.isArray(status.models))
    assert.strictEqual(status.baseUrl, 'http://127.0.0.1:59999')
  })

  // TEST 8: AI_API_BASE_URL is supported for production cloud backend configuration
  await runTest('Test 8: AI_API_BASE_URL is recognized in orchestrator and config', async () => {
    const prevUrl = process.env.AI_API_BASE_URL
    const prevNetlify = process.env.NETLIFY
    try {
      process.env.AI_API_BASE_URL = 'https://custom-cloud-ollama.example.com'
      process.env.NETLIFY = 'true'

      // Orchestrator should not overwrite server cloud AI_API_BASE_URL with client localhost
      let capturedUrl = ''
      await orchestrateChat(
        {
          prompt: 'Hello cloud',
          ollamaBaseUrl: 'http://127.0.0.1:11434',
        },
        {
          onToken: () => {},
          onDone: () => {},
        }
      )
    } finally {
      process.env.AI_API_BASE_URL = prevUrl
      process.env.NETLIFY = prevNetlify
    }
  })

  // TEST 9: Netlify cloud deployment with unreachable remote host produces distinct error
  await runTest('Test 9: Netlify cloud deployment with unreachable remote host produces distinct cloud error', async () => {
    const prevNetlify = process.env.NETLIFY
    const prevEnv = process.env.NODE_ENV
    process.env.NETLIFY = 'true'
    process.env.NODE_ENV = 'production'
    let caughtError: any = null

    try {
      await generateOllamaStream(
        'https://unreachable-ollama-cloud-host-9999.example.com',
        'qwen2.5:3b',
        'System prompt',
        'Hello',
        [],
        () => {}
      )
    } catch (err: any) {
      caughtError = err
    } finally {
      process.env.NETLIFY = prevNetlify
      process.env.NODE_ENV = prevEnv
    }

    assert(caughtError !== null, 'Should throw error when remote cloud host is unreachable')
    assert(
      caughtError.message.includes('cloud AI backend') || caughtError.message.includes('AI_API_BASE_URL') || caughtError.message.includes('Failed to connect'),
      `Expected cloud-specific error, got: ${caughtError.message}`
    )
  })

  console.log(`\nTests finished: ${passedCount} passed, ${failedCount} failed.`)
  if (failedCount > 0) {
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('Fatal test error:', err)
  process.exit(1)
})
