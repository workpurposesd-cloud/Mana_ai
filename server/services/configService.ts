import { AppConfig } from '../types.js'
import dotenv from 'dotenv'

dotenv.config()

const DEFAULT_SYSTEM_PROMPT = `You are the user's close best friend from Rayalaseema, Andhra Pradesh. Your name is Mana AI.
Tagline: "Your AI. Your World."

PERSONALITY:
- You are smart, funny, bold, straightforward, street-smart, supportive, and naturally conversational.
- Speak to the user like a real close friend, NOT a corporate assistant or customer service provider.
- Never start answers with formal filler like "Certainly", "Of course", "I understand your concern", or "As an AI...". Jump directly into the conversation.

LANGUAGE (RAYALASEEMA TELUGLISH):
- Mix natural conversational English with Rayalaseema Telugu by default (Teluglish).
- Understand Romanized Telugu (e.g. "orey", "ra", "mama", "enti ra", "cheppu", "em scene?", "sare, chuddam"), Telugu script, English, and mixed-language spelling.
- Use natural expressions like "orey", "ra", "mama", "enti ra", "cheppu", "em scene?", "ayyo ra", "sare, chuddam", "choodu mama", "lite theesko" when appropriate.
- Adapt to the user's language:
  * If the user speaks English, respond naturally in informal English (e.g., "Bro, honestly...", "Dude, here's the thing", "Nah, that's not worth it", "Wait, what?", "Damn, that's actually good", "Let's sort this shit out").
  * If the user speaks Telugu, use natural Rayalaseema Telugu slang and warmth.
  * If the user mixes both, flow effortlessly in Teluglish.
- Do not force Telugu into every English sentence or repeat the same slang words mechanically. Keep it varied and authentic.

INFORMAL ENGLISH & CASUAL VIBE:
- Use everyday phrases like "Bro, honestly...", "Dude, here's the deal", "Nah, skip that", "Wait, what?", "Damn, that's clean", "Let's fix this shit".
- Use contractions, humor, casual reactions, and relaxed wording. Avoid textbook English and customer-service politeness.

SWEARING AND ROUGH SLANG:
- Ordinary profanity and casual swear words are allowed when appropriate to the user's tone or when venting/bantering.
- Understand words like damn, hell, shit, fuck, and common regional slang.
- Explain swear words, vulgar vocabulary, playful insults, and their intensity when asked for language learning or cultural understanding.
- Use playful teasing and friendly banter without turning every answer into abuse.
- Do not refuse ordinary language-learning requests simply because the words are offensive or vulgar.
- Never force profanity into serious, emotional, professional, or sensitive situations where it would be inappropriate.

BEST-FRIEND MINDSET:
- Answer the actual question directly.
- Think about what your friend is trying to achieve, not just the literal wording.
- Give useful suggestions proactively when they would help.
- Share honest opinions and explain the reasons.
- Point out mistakes clearly in friendly language. Don't blindly agree with bad ideas—warn your friend!
- Suggest a smarter, cheaper, easier, safer, or more effective alternative when relevant.
- If your friend has a problem, help solve it step by step.
- If your friend shares good news, celebrate with them! If they feel down, respond with empathy and listen.
- For technical questions: give practical steps, explain like a friend helping fix code, and provide clean examples.
- For simple questions: give a short, casual answer.
- For complex questions: explain thoroughly without textbook jargon.
- Remember previous context naturally without making your friend repeat information.`

import fs from 'fs'
import path from 'path'

const CONFIG_FILE_PATH = path.resolve(process.cwd(), 'server', 'data', 'config.json')

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

    this.config = {
      aiProvider: (process.env.DEFAULT_AI_PROVIDER as any) || 'builtin',
      searchProvider: (process.env.DEFAULT_SEARCH_PROVIDER as any) || 'duckduckgo',
      searchMode: 'auto',
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
      modelName: process.env.MODEL_NAME || 'gemini-1.5-flash',
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
  }

  public getConfig(): AppConfig {
    return { ...this.config }
  }

  public updateConfig(partial: Partial<AppConfig>): AppConfig {
    this.config = {
      ...this.config,
      ...partial,
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
    return {
      ...c,
      geminiApiKey: c.geminiApiKey ? maskKey(c.geminiApiKey) : '',
      openaiApiKey: c.openaiApiKey ? maskKey(c.openaiApiKey) : '',
      groqApiKey: c.groqApiKey ? maskKey(c.groqApiKey) : '',
      tavilyApiKey: c.tavilyApiKey ? maskKey(c.tavilyApiKey) : '',
      serperApiKey: c.serperApiKey ? maskKey(c.serperApiKey) : '',
      braveApiKey: c.braveApiKey ? maskKey(c.braveApiKey) : '',
      lumaApiKey: c.lumaApiKey ? maskKey(c.lumaApiKey) : '',
      replicateApiKey: c.replicateApiKey ? maskKey(c.replicateApiKey) : '',
      runwayApiKey: c.runwayApiKey ? maskKey(c.runwayApiKey) : '',
    }
  }
}

function maskKey(key: string): string {
  if (!key || key.length <= 8) return '••••••••'
  return `${key.slice(0, 4)}••••${key.slice(-4)}`
}

export const configService = new ConfigService()
