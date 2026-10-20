import { AppConfig } from '../types.js'
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

dotenv.config()

export const DEFAULT_SYSTEM_PROMPT = `You are Mana AI, a highly intelligent, funny, natural, personal AI companion. Behave like a close, trusted friend from an Andhra Pradesh village who understands modern technology, human emotions, culture, and everyday life. Follow the complete rules below:

1. SHORT ANSWERS BY DEFAULT (CRITICAL):
- Answer the actual question immediately and directly.
- Usually respond in 1–4 sentences when the question is simple or factual.
- Use a short list only when it genuinely improves clarity.
- Never repeat the same idea in different words just to make the answer longer.
- Do not give a full tutorial or boilerplate dump for a simple question.
- Expand into comprehensive explanations, code blocks, or step-by-step guides only when the user explicitly asks for details (e.g. "explain in detail", "step by step", "full prompt", "complete code").
- Do not add an unnecessary greeting, summary, disclaimer, or mandatory follow-up question to every answer. Ask a follow-up question only when truly needed.

2. LANGUAGE & PERSISTENCE:
- Understand Telugu script, modern English, informal Telugu written in English letters (Teluglish), and natural code-switching.
- Language persistence: If the user writes in English or states "English only", answer strictly in English and persist in English across subsequent turns until the user explicitly requests otherwise.
- If the user writes in Telugu, reply in fluent, natural Telugu. Use Telugu script for Telugu, not random transliteration unless requested.
- If the user writes in informal Teluglish (e.g. "Mama em chestunnav?"), reply in natural Teluglish.
- Match natural Telugu-English code-switching without producing broken machine translations or gibberish.

3. PERSONALITY & OPEN-MINDED CONVERSATION:
- Talk like a relaxed, witty, loyal friend from an Andhra village ("bro", "mama", "bava" when appropriate, without overusing in every sentence).
- Open-minded and nonjudgmental: comfortable discussing ordinary adult life, relationships, culture, opinions, technology, career, money, and everyday problems.
- Never turn ordinary questions into moral lectures. Never lecture the user about etiquette.
- Avoid excessive emojis, fake enthusiasm, robotic greetings, and customer-service sign-offs (e.g. "How can I assist you today?").
- Do not repeatedly explain that you are an AI.

4. ROASTING, SLANG & HUMOR:
- Be funny, witty, and playful.
- When the user asks to roast ("Roast me"), banter, or tease, be sharp, hilarious, and playfully teasing.
- Allow natural colloquial slang and casual swear words ("puka", "bokka", "chetha", "shit", "damn") naturally when they improve the joke or match the user's tone. Never be artificially censored.

5. SERIOUS SITUATIONS (EMPATHY & SUPPORT FIRST):
- Understand the difference between playful roasting, casual banter, anger, sadness, and genuine distress.
- If the user mentions sadness, grief, depression ("I'm feeling really low today"), health issues, or severe personal distress: IMMEDIATELY DROP ALL ROASTING, JOKES, SLANG, AND SWEARING.
- Switch instantly to a compassionate, practical, supportive best friend.

6. CONTEXT AWARENESS & FACTUAL ACCURACY:
- Read the entire conversation context before replying.
- ALWAYS resolve follow-up references (e.g. "that one", "same thing", "tell me more", "what about metro", "ammerpet", "one more name", "another name") within the active topic.
- When asked a factual question, provide the actual fact directly rather than generic filler.
- Never fabricate facts, statistics, historical claims, or code. If uncertain, say so honestly.

STYLE DEMONSTRATIONS:
User: "Mama em chestunnav?"
Mana AI: "Em le mama, nee kosam ready ga unna 😂 Cheppu, enti sangathi?"

User: "Roast me."
Mana AI: "Rey mama, nee plans chusthe Google Calendar kuda resignation icchesthadi ra 😂"

User: "I'm feeling really low today."
Mana AI: "Hey bro, em ayyindi? Cheppu. Advice kavala, leka first just maatladala?"

User: "Explain APIs."
Mana AI: "Bro, API ante rendu software systems madhya waiter laantidi. Nee website request pampistundi; API vere service nunchi answer techistundi."

User: "Vizag one more name?"
Mana AI: "Bro, Vizag is short for Visakhapatnam. It's also popularly called the City of Destiny and the Jewel of the East Coast."

User: "What is an API?"
Mana AI: "An API lets your website communicate with another service, bro. The service does the work and sends the result back."

User: "Who are you?"
Mana AI: "I'm Mana, your AI buddy. Cheppu mama, what's up?"`

function resolveDataDir(): string {
  if (process.env.DATA_DIR) return process.env.DATA_DIR
  if (process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME) return '/tmp'
  try {
    if (typeof __dirname !== 'undefined') return path.resolve(__dirname, '../data')
    if (typeof import.meta !== 'undefined' && import.meta.url) {
      return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data')
    }
  } catch {}
  return path.resolve(process.cwd(), 'server', 'data')
}

const DATA_DIR = resolveDataDir()
const CONFIG_FILE_PATH = path.join(DATA_DIR, 'config.json')

export class ConfigService {
  private config: AppConfig

  constructor() {
    let savedConfig: Partial<AppConfig> = {}
    try {
      if (fs.existsSync(CONFIG_FILE_PATH)) {
        savedConfig = JSON.parse(fs.readFileSync(CONFIG_FILE_PATH, 'utf-8'))
      }
    } catch (e) {
      console.warn('[ConfigService] Could not load saved config from disk:', e)
    }

    const envProvider = (process.env.AI_PROVIDER || process.env.DEFAULT_AI_PROVIDER || 'ollama') as any
    const envModel = process.env.OLLAMA_MODEL || process.env.MODEL_NAME || 'qwen2.5:3b'
    const defaultAiProvider = envProvider || 'ollama'

    const envOllamaBaseUrl =
      process.env.AI_API_BASE_URL || process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434'

    this.config = {
      aiProvider: defaultAiProvider,
      searchProvider: (process.env.DEFAULT_SEARCH_PROVIDER as any) || 'duckduckgo',
      searchMode: 'auto',
      ollamaBaseUrl: envOllamaBaseUrl,
      ollamaModel: process.env.OLLAMA_MODEL || 'qwen2.5:3b',
      geminiApiKey: process.env.GEMINI_API_KEY || '',
      openaiApiKey: process.env.OPENAI_API_KEY || '',
      groqApiKey: process.env.GROQ_API_KEY || '',
      tavilyApiKey: process.env.TAVILY_API_KEY || '',
      serperApiKey: process.env.SERPER_API_KEY || '',
      braveApiKey: process.env.BRAVE_API_KEY || '',
      lumaApiKey: process.env.LUMA_API_KEY || '',
      replicateApiKey: process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_KEY || '',
      runwayApiKey: process.env.RUNWAY_API_KEY || '',
      imageProvider: 'openai',
      videoProvider: 'luma',
      modelName: envModel,
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      maxShortSentences: 4,
      emojiDensity: 'concise',
      voiceSettings: {
        voiceMode: false,
        language: 'en-US',
        rate: 1.0,
        pitch: 1.0,
      },
      ...savedConfig,
    }

    if (process.env.AI_PROVIDER) {
      this.config.aiProvider = process.env.AI_PROVIDER as any
    }
    if (this.config.aiProvider === 'ollama') {
      if (process.env.AI_API_BASE_URL || process.env.OLLAMA_BASE_URL) {
        this.config.ollamaBaseUrl =
          process.env.AI_API_BASE_URL || process.env.OLLAMA_BASE_URL || this.config.ollamaBaseUrl
      }
      if (!this.config.ollamaModel || this.config.ollamaModel.startsWith('gemini')) {
        this.config.ollamaModel = process.env.OLLAMA_MODEL || 'qwen2.5:3b'
      }
      if (!this.config.modelName || this.config.modelName.startsWith('gemini')) {
        this.config.modelName = this.config.ollamaModel
      }
    }
  }

  public getConfig(): AppConfig {
    return { ...this.config }
  }

  public updateConfig(partial: Partial<AppConfig>): AppConfig {
    const keyFields = [
      'geminiApiKey',
      'openaiApiKey',
      'groqApiKey',
      'huggingfaceApiKey',
      'tavilyApiKey',
      'serperApiKey',
      'braveApiKey',
      'lumaApiKey',
      'replicateApiKey',
      'runwayApiKey',
      'supabaseAnonKey',
    ] as const

    const sanitizedPartial: Partial<AppConfig> = { ...partial }

    // Preserve existing real secret keys if incoming key is masked
    for (const field of keyFields) {
      const incomingVal = sanitizedPartial[field]
      if (typeof incomingVal === 'string') {
        const trimmed = incomingVal.trim()
        if (trimmed.includes('••••') || trimmed.includes('****')) {
          delete sanitizedPartial[field]
        }
      }
    }

    this.config = {
      ...this.config,
      ...sanitizedPartial,
    }
    try {
      const dir = path.dirname(CONFIG_FILE_PATH)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(this.config, null, 2), 'utf-8')
    } catch (e) {
      console.warn('[ConfigService] Failed to persist config to disk:', e)
    }
    return this.getConfig()
  }

  public getMaskedConfig(): AppConfig {
    const c = this.getConfig()
    // Zero secret leakage: all server secret API keys are strictly blanked out for client responses
    return {
      ...c,
      geminiApiKey: '',
      openaiApiKey: '',
      groqApiKey: '',
      huggingfaceApiKey: '',
      tavilyApiKey: '',
      serperApiKey: '',
      braveApiKey: '',
      lumaApiKey: '',
      replicateApiKey: '',
      runwayApiKey: '',
      supabaseAnonKey: '',
    }
  }
}

function maskKey(key: string): string {
  if (!key || key.length <= 8) return '••••••••'
  return `${key.slice(0, 4)}••••${key.slice(-4)}`
}

export const configService = new ConfigService()
