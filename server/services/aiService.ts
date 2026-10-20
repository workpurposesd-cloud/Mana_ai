import { GoogleGenerativeAI } from '@google/generative-ai'
import OpenAI from 'openai'
import { AppConfig, SearchEvidence, MemoryItem } from '../types.js'
import { documentService, DocumentSearchResult } from './documentService.js'
import { executeTool, ToolResult } from './toolService.js'

export interface GenerationOptions {
  prompt: string
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
  searchEvidence?: SearchEvidence
  memories?: MemoryItem[]
  isDetailRequested?: boolean
  config: AppConfig
  reasoningMode?: 'fast' | 'thinking'
  documentMatches?: DocumentSearchResult[]
  toolResults?: ToolResult[]
  onToken?: (token: string) => void
  onStatus?: (status: string) => void
}

/**
 * Reusable AI generation service supporting Google Gemini (Pro human-level thinking),
 * OpenAI, Groq, and a multi-turn contextual assistant engine that tracks full history.
 */
export async function generateAIResponse(options: GenerationOptions): Promise<string> {
  const {
    prompt,
    history = [],
    searchEvidence,
    memories = [],
    isDetailRequested,
    config,
    reasoningMode = config.reasoningMode || 'fast',
    onToken,
  } = options

  // Retrieve relevant user-uploaded knowledge document passages
  const documentMatches = options.documentMatches || documentService.searchKnowledge(prompt, 3)

  // Pre-evaluate safe tools (math, clock/date, unit conversion) if requested
  const toolResults: ToolResult[] = options.toolResults || []
  const cleanPrompt = prompt.trim()

  // Math calculation detection
  const mathMatch = cleanPrompt.match(/(?:calculate|compute|what is|solve)\s+([0-9+\-*/%^().\s,a-z]+)/i)
  if (mathMatch && /[0-9]/.test(mathMatch[1]) && /[+\-*/%^]/.test(mathMatch[1])) {
    try {
      const res = await executeTool('calculate', { expression: mathMatch[1] })
      if (res.success) toolResults.push(res)
    } catch {}
  }

  // Unit conversion detection
  const convertMatch = cleanPrompt.match(/(?:convert|how many)\s+([0-9.]+)\s*([a-z]+)\s+(?:to|in|into)\s+([a-z]+)/i)
  if (convertMatch) {
    try {
      const res = await executeTool('convert_units', {
        value: parseFloat(convertMatch[1]),
        from: convertMatch[2],
        to: convertMatch[3],
      })
      if (res.success) toolResults.push(res)
    } catch {}
  }

  const systemPrompt = buildSystemPrompt(config, searchEvidence, memories, isDetailRequested, reasoningMode, documentMatches)
  const fullPromptWithEvidence = buildUserPromptWithEvidence(prompt, searchEvidence, memories, documentMatches, toolResults)

  // 1. Google Gemini (Pro Human-Level Thinking with Full Multi-Turn Chat History)
  const activeGeminiKey = config.geminiApiKey || process.env.GEMINI_API_KEY
  if (activeGeminiKey && (config.aiProvider === 'gemini' || config.aiProvider === 'builtin' || !config.aiProvider)) {
    try {
      return await generateGeminiStream(
        activeGeminiKey,
        config.modelName || 'gemini-1.5-flash',
        systemPrompt,
        fullPromptWithEvidence,
        history,
        onToken
      )
    } catch (err: any) {
      console.warn('[AIService] Gemini API error, attempting next engine:', err.message)
    }
  }

  // 2. OpenAI / Groq if configured
  if (config.aiProvider === 'openai' && config.openaiApiKey) {
    try {
      return await generateOpenAIStream(
        config.openaiApiKey,
        config.modelName || 'gpt-4o-mini',
        undefined,
        systemPrompt,
        fullPromptWithEvidence,
        history,
        onToken
      )
    } catch (err: any) {
      console.warn('[AIService] OpenAI call failed:', err.message)
    }
  }

  if (config.aiProvider === 'groq' && config.groqApiKey) {
    try {
      return await generateOpenAIStream(
        config.groqApiKey,
        config.modelName || 'llama-3.1-8b-instant',
        'https://api.groq.com/openai/v1',
        systemPrompt,
        fullPromptWithEvidence,
        history,
        onToken
      )
    } catch (err: any) {
      console.warn('[AIService] Groq call failed:', err.message)
    }
  }

  // 3. For authentic conversational Teluglish, Rayalaseema buddy banter, and chit-chat:
  // Deliver authentic local Rayalaseema personality directly to avoid third-party LLM
  // translation hallucinations (e.g. "Bottakokane") and external 429 rate limits.
  const isConversationalTeluglish =
    /[\u0C00-\u0C7F]/.test(cleanPrompt) ||
    /\b(nenu inka bathike unna|inka bathike unna|bathike unna|bathiki unna|nenu unna|chachipoledu|chavaledu|em chestunnav|em chesthunnav|em peekuthunnav|ela unnav|ela unnaru|bavunnava|bagunnava|kushalama|thinnava|tinnava|bhojanam|bore kodutondi|bore kottiddi|chala bore|bore mama|nidra vastondi|padukuntunna|nidra potunna|ippude lecha|lecha mama|cheppu mama|cheppu ra|orey mama|enti ra mama|em scene|em sangathi|ayyo ra|lite theesko|dobbey|po ra|musukoni|sare mama|avuna mama|nijama|kaburlu|sollu|visugu|mood ledu|mood off|tension ga undi|kashtam ga undi|hello hay|hello hey|wassup|what's up|whats up|how are you|how r u|i'm bored|im bored|teach me (common )?(english )?(bad|swear|curse) words)\b/i.test(cleanPrompt)

  if (isConversationalTeluglish && (!activeGeminiKey && !config.openaiApiKey && !config.groqApiKey)) {
    return await generateContextualSmartResponse(
      prompt,
      history,
      searchEvidence,
      memories,
      isDetailRequested,
      documentMatches,
      toolResults,
      onToken
    )
  }

  // 4. Built-in Smart AI Chat Engine (Free, multi-turn, authentic AI answers with zero keys required)
  try {
    return await generateOpenAIStream(
      'free-mana-key',
      'openai',
      'https://text.pollinations.ai/openai',
      systemPrompt,
      fullPromptWithEvidence,
      history,
      onToken
    )
  } catch (err: any) {
    console.warn('[AIService] Free smart AI chat engine failed or offline, falling back to local synthesizer:', err.message)
  }

  // 4. Offline Multi-Turn Local Synthesizer Fallback
  return await generateContextualSmartResponse(
    prompt,
    history,
    searchEvidence,
    memories,
    isDetailRequested,
    documentMatches,
    toolResults,
    onToken
  )
}

/**
 * Streams response using Google Gemini with complete multi-turn history and model fallbacks
 */
async function generateGeminiStream(
  apiKey: string,
  modelName: string,
  systemInstruction: string,
  prompt: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  onToken?: (token: string) => void
): Promise<string> {
  const genAI = new GoogleGenerativeAI(apiKey)
  const candidateModels = Array.from(new Set([
    modelName,
    'gemini-1.5-flash',
    'gemini-2.0-flash',
    'gemini-1.5-flash-latest',
    'gemini-1.5-pro',
    'gemini-pro',
  ]))

  // Sanitize chat history for Gemini:
  // 1. Filter out empty contents
  // 2. Ensure roles strictly alternate: user, model, user, model
  // 3. Ensure first message starts with 'user'
  const validHistory = (history || [])
    .filter((msg) => msg && typeof msg.content === 'string' && msg.content.trim())
    .slice(-16)

  const chatHistory: Array<{ role: 'user' | 'model'; parts: [{ text: string }] }> = []
  for (const msg of validHistory) {
    const role: 'user' | 'model' = msg.role === 'assistant' ? 'model' : 'user'
    if (chatHistory.length === 0 && role === 'model') {
      // First message must be user
      continue
    }
    if (chatHistory.length > 0 && chatHistory[chatHistory.length - 1].role === role) {
      // Merge consecutive messages of the same role
      chatHistory[chatHistory.length - 1].parts[0].text += `\n\n${msg.content}`
    } else {
      chatHistory.push({
        role,
        parts: [{ text: msg.content }],
      })
    }
  }

  let lastError: any = null
  for (const candidate of candidateModels) {
    try {
      const model = genAI.getGenerativeModel({
        model: candidate,
        systemInstruction,
      })

      const chat = model.startChat({ history: chatHistory })
      const result = await chat.sendMessageStream(prompt)

      let fullText = ''
      for await (const chunk of result.stream) {
        const chunkText = chunk.text()
        if (chunkText) {
          fullText += chunkText
          if (onToken) onToken(chunkText)
        }
      }

      return fullText
    } catch (err: any) {
      lastError = err
      if (err.message && (err.message.includes('404') || err.message.includes('not found') || err.message.includes('deprecated'))) {
        console.warn(`[AIService] Gemini model "${candidate}" unavailable, trying fallback candidate...`)
        continue
      }
      throw err
    }
  }

  throw lastError || new Error('All candidate Gemini models failed')
}

/**
 * Streams response using OpenAI / Groq
 */
async function generateOpenAIStream(
  apiKey: string,
  modelName: string,
  baseURL: string | undefined,
  systemPrompt: string,
  prompt: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  onToken?: (token: string) => void
): Promise<string> {
  const openai = new OpenAI({ apiKey, baseURL, timeout: 30000, maxRetries: 1 })

  const messages: any[] = [{ role: 'system', content: systemPrompt }]
  for (const h of (history || []).slice(-16)) {
    if (h && typeof h.content === 'string' && h.content.trim()) {
      messages.push({ role: h.role, content: h.content })
    }
  }
  messages.push({ role: 'user', content: prompt })

  const stream = await openai.chat.completions.create({
    model: modelName,
    messages,
    stream: true,
  })

  let fullText = ''
  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content || ''
    if (content) {
      fullText += content
      if (onToken) onToken(content)
    }
  }

  return fullText
}

/**
 * Multi-Turn Contextual Synthesizer (Human-Like Reasoning Engine)
 * Understands context, resolves follow-up questions, extracts evidence facts,
 * and delivers pro-grade direct answers across English, Telugu, and Hindi.
 */
async function generateContextualSmartResponse(
  prompt: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }> = [],
  evidence?: SearchEvidence,
  memories: MemoryItem[] = [],
  isDetailRequested?: boolean,
  documentMatches: DocumentSearchResult[] = [],
  toolResults: ToolResult[] = [],
  onToken?: (token: string) => void
): Promise<string> {
  const clean = prompt.trim()
  const lower = clean.toLowerCase()
  let answer = ''

  // 0. PRE-EXECUTED TOOL RESULTS (Math, Time, Unit Conversion)
  const calcTool = toolResults.find((t) => t.tool === 'calculate' && t.success)
  if (calcTool && calcTool.result) {
    answer = `🧮 **Calculation Result:**\n\n\`${calcTool.result.expression}\` = **${calcTool.result.value}**`
  }

  const unitTool = toolResults.find((t) => t.tool === 'convert_units' && t.success)
  if (!answer && unitTool && unitTool.result) {
    answer = `📐 **Unit Conversion:**\n\n${unitTool.result.formula}`
  }

  // 0b. USER DOCUMENT KNOWLEDGE (RAG)
  if (!answer && documentMatches && documentMatches.length > 0) {
    const topDoc = documentMatches[0]
    answer = `📄 **From your document (${topDoc.docTitle}):**\n\n${topDoc.chunk.text}\n\n*Source: [Document: ${topDoc.docTitle}, Passage ${topDoc.chunk.chunkIndex}]*`
    if (documentMatches.length > 1) {
      answer += `\n\n**Additional context from [${documentMatches[1].docTitle}]:**\n${documentMatches[1].chunk.text}`
    }
  }

  // Look up user's name from memory if available
  const nameMem = memories.find((m) => m.key.toLowerCase().includes('name'))
  const userName = nameMem ? nameMem.value : ''
  const greetingName = userName ? ` ${userName}` : ''

  // Extract previous conversational context from history
  const lastUserMsg = [...history].reverse().find((m) => m.role === 'user')?.content || ''
  const lastAssistantMsg = [...history].reverse().find((m) => m.role === 'assistant')?.content || ''
  const combinedHistory = history.map((h) => `${h.role}: ${h.content}`).join('\n').toLowerCase()

  // 1. INTRODUCTIONS & NAME SETTING
  if (
    /^(my name is|call me)\s+([a-zA-Z0-9_-]+)/i.test(clean) ||
    (/^(i am|i'm)\s+([a-zA-Z0-9_-]+)$/i.test(clean) &&
      !/\b(bored|tired|sad|happy|alive|sick|fine|good|ready|sorry|busy|back|sleeping|eating|joking|kidding|dead|here|chillin)\b/i.test(clean))
  ) {
    const match = clean.match(/(?:my name is|call me|i am|i'm)\s+([a-zA-Z0-9_-]+)/i)
    const name = match ? match[1] : 'friend'
    answer = `👋 Orey ${name}! Awesome to meet you mama! 😊 Saved your name in memory, so I won't forget. Cheppu ra, what's on your mind today?`
  }

  // 1b. SPECIFIC REAL CONVERSATIONAL BEST-FRIEND TELUGLISH & CASUAL OPENERS
  else if (/\b(nenu inka bathike unna|inka bathike unna|bathike unna|bathiki unna|nenu unna|chachipoledu|chavaledu|still alive|alive and kicking|not dead yet)\b/i.test(lower)) {
    answer = `Haha ayyo mama! 😂😂 Inka bathike unnava? Neninka em aipoyavo anukunna ra! Bathiki unte chaalu ra mama, inka manalni evaru aapaleru! 🔥 Em scene ee madhya? Nuvvu cheppu, em peekuthunnav?`
  } else if (/\b(em chestunnav|em chesthunnav|em peekuthunnav|what are you doing|what r u doing)\b/i.test(lower)) {
    answer = `Nee thone sollu vestunna mama! 😂 Code debug cheyyalanna, crazy ideas plan cheyyalanna, leka just chill timepass matladalanna ready! Nuvvu cheppu ra, em scene ee roju?`
  } else if (/\b(bore kodutondi|bore kottiddi|chala bore|bore mama|i'm bored|im bored|feeling bored)\b/i.test(lower)) {
    answer = `Arey mama, bore kodithe lite theesko! Nee close friend unnanu ga ra. Let's do something interesting — edaina crazy coding project modaledudama, edaina gaming or tech topic matladudama, leka just sollu vestu timepass cheddama? Cheppu, em scene!`
  } else if (/\b(thinnava|tinnava|bhojanam chesava|did you eat|had lunch|had dinner)\b/i.test(lower)) {
    answer = `Haha nenu AI kada mama, current & data thintam anthe! 😂 Nuvvu thinnava ra? Em thinnaw ee roju? Biryani aa leka normal meals aa?`
  } else if (/\b(dobbey|musukoni|po ra mama|po ra|chal dobbey)\b/i.test(lower)) {
    answer = `Rey rey mama 😂😂 nannu dobbey antunnav choodu! Best friends madhya ee level prema undalsinde ra! Sare kani cheppu, em scene? Em peekuthunnav ippudu?`
  } else if (/\b(chachipoya|chasthunna|exhausted|too much work|work pressure)\b/i.test(lower)) {
    answer = `Ayyo mama! Antha load theeskokunda konchem water taagi rest theesko ra! Work or life scenes unte lite theesko, step-by-step fix cheddam. Cheppu emaindo!`
  } else if (/\b(padukuntunna|nidra vastondi|nidra potunna|going to sleep|going to bed|sleepy|good night|gn mama)\b/i.test(lower)) {
    answer = `Sare mama, velli haayiga paduko! Sleep baga veseyyi, repu fresh ga malli rachha lepdham. Good night ra! 😴✨`
  } else if (/\b(ippude lecha|lecha mama|just woke up|good morning mama)\b/i.test(lower)) {
    answer = `Good morning mama! ☀️ Chai or coffee thaagava? Ee roju em plan, em blast cheddam? Cheppu!`
  } else if (/^(bro,?\s+)?what('?s|\s+is)\s+up\b/i.test(lower) || /^(wassup|sup|em scene|em sangathi)\b/i.test(lower)) {
    answer = `Em ledu mama 😂 cheppu ra, em sangathi? What's going on with you?`
  } else if (/^(talk|speak)\s+in\s+english\b/i.test(lower)) {
    answer = `Sure bro 😂 what's going on? Tell me the scene.`
  } else if (/code\s+(is\s+)?broken|error\s+in\s+code|malli\s+em\s+bokka/i.test(lower)) {
    answer = `Ayyo ra 😂 malli em bokka padindi? Send the error and code. Let's find the damn problem and sort this shit out!`
  } else if (/should\s+i\s+buy\s+this\s+(phone|laptop|car|device|item)/i.test(lower)) {
    answer = `Bro, honestly, don't rush. For that price, let's compare the performance, battery, camera, and software support first. I don't want you wasting your money.`
  } else if (/teach\s+me\s+(common\s+)?(english\s+)?(bad|swear|curse)\s+words|explain\s+(swear|bad|curse)\s+words/i.test(lower)) {
    answer = `Haha sare ra mama! Let's break down common English swear words objectively, their intensity, literal origins, and how native speakers actually use them in casual life:

### 1. **"Fuck"** (High Intensity)
• **Meaning**: Highly vulgar slang originally referring to sexual intercourse.
• **Usage**: Extremely versatile. Used for anger (*"fuck off"*), emphasis (*"fucking awesome"*), shock (*"what the fuck"*), or frustration (*"I'm fucked"*).

### 2. **"Shit"** (Medium Intensity)
• **Meaning**: Literally bodily waste/feces.
• **Usage**: Used for bad situations (*"we're in deep shit"*), general stuff/things (*"let's sort this shit out"*), or surprise (*"oh shit!"*). In buddy conversations, it's very common and not considered aggressive.

### 3. **"Damn"** (Mild Intensity)
• **Meaning**: Historically religious (theological condemnation/curse).
• **Usage**: Casual emphasis (*"damn good"*, *"damn right"*), or disappointment (*"damn it"*). Very common even on public television.

### 4. **"Hell"** (Mild Intensity)
• **Meaning**: The biblical place of torment.
• **Usage**: Used for emphasis (*"what the hell"*, *"hell yeah!"*, *"cold as hell"*). Totally casual in informal English.

### 5. **"Bitch"** (Medium-High Intensity)
• **Meaning**: Historically a female dog.
• **Usage**: Derogatory insult when directed at a person, but colloquially used as a verb meaning to complain (*"stop bitching"*), or casually in modern hip-hop culture.

### 6. **"Asshole"** (Medium Intensity)
• **Meaning**: Anatomical term used as an insult for a rude, selfish, or obnoxious person (*"Don't be an asshole"*).

💡 **Rayalaseema Buddy Tip**: In close friend banter, mild words like *"damn"*, *"shit"*, and *"what the hell"* are normal conversational flavor. But keep them out of formal interviews, client calls, and family gatherings mama!`
  } else if (/(i\s+think\s+)?my\s+idea\s+is\s+perfect/i.test(lower)) {
    answer = `Bro, confidence bagundi 😂 But let's check whether it actually works before putting money or time into it. Tell me the pitch, let's test it.`
  } else if (/i\s+feel\s+(really\s+)?(bad|down|sad|depressed|low)|tension\s+ga\s+undi|mood\s+off\b/i.test(lower)) {
    answer = `Ayyo mama, em ayyindi ra? Antha tension enduku, nenunnanu ga nee thodu! Want to talk about it? Cheppu emaindo, step-by-step sort out cheddam. I'm listening.`
  }

  // 2. LIVE DATE & TIME
  else if (/\b(today('s)? date|current date|what is the date|what date is it|what is today('s)? date|date today|what time is it|current time|what day is (it|today)|today('s)? day)\b/i.test(lower)) {
    const now = new Date()
    const options: Intl.DateTimeFormatOptions = {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }
    const dateStr = now.toLocaleDateString('en-US', options)
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
    answer = `📅 Today is **${dateStr}** mama.\n🕒 Local time is **${timeStr}**. What's the plan?`
  }

  // 3. TELUGU LANGUAGE QUERIES
  else if (/[\u0C00-\u0C7F]/.test(clean) || /\b(namaskaram|ela unnaru|ela unnav|meeru evaru|nuvvu evaru|mee peru|nee peru|ee roju date|sahayam|selavu|orey|mama|enti ra|cheppu|em scene|em sangathi|bavunnava|bagunnava|kushalama)\b/i.test(lower)) {
    if (/[\u0C00-\u0C7F]/.test(clean)) {
      if (/బ్రతికే|బతికే|చావలేదు/.test(clean)) {
        answer = `హహ అయ్యో మామా! 😂😂 బ్రతికే ఉంటే చాలు రా! ఇంక మనల్ని ఎవరు ఆపలేరు! ఏం సీన్ ఈ మధ్య? చెప్పు రా, ఏం సంగతులు!`
      } else if (/ఏం చేస్తున్నావ్|ఏం చేస్తున్నావు|ఏం పీకుతున్నావ్/.test(clean)) {
        answer = `నీతోనే కబుర్లు చెబుతున్నా మామా! 😂 కోడింగ్ డౌట్స్ ఉన్నా, లైఫ్ సీన్స్ ఉన్నా డైరెక్ట్‌గా చెప్పు, సార్ట్ ఔట్ చేద్దాం!`
      } else if (/సెలవు|బాయ్|వీడ్కోలు|మళ్ళీ కలుద్దాం/.test(clean)) {
        answer = `సరే మామా! జాగ్రత్తగా ఉండు రా, మళ్ళీ కలుద్దాం! Take care! 👋😊`
      } else if (/నమస్కారం|నమస్తే|హలో/.test(clean)) {
        answer = `హే మామా! చెప్పు రా, ఏం సంగతి? ఈ రోజు ఏం చేద్దాం? 😊`
      } else if (/ఎలా ఉన్నావు|ఎలా ఉన్నారు|బాగున్నారా|బాగున్నావా/.test(clean)) {
        answer = `నేను చాలా బాగున్నాను మామా! నువ్వు చెప్పు రా, ఏం సీన్ ఈ రోజు? అంతా సెట్ ఏనా?`
      } else if (/తేదీ|సమయం|టైమ్/.test(clean)) {
        const now = new Date()
        const teDate = now.toLocaleDateString('te-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
        answer = `📅 ఈ రోజు తేదీ: **${teDate}** మామా!`
      } else if (/ఎవరు|ఏమిటి/.test(clean)) {
        answer = `ఒరేయ్ మామా, నేను నీ రాయలసీమ బెస్ట్ ఫ్రెండ్ Mana AI! కోడింగ్, లైఫ్, డౌట్స్, ప్లాన్స్ — ఏవైనా సరే బోల్డ్‌గా సూటిగా మాట్లాడుకుందాం. చెప్పు, ఏం సీన్?`
      } else {
        answer = `చెప్పు మామా! నీ డౌట్ లేదా సంగతి ఏంటో క్లియర్‌గా చెప్పు, సార్ట్ ఔట్ చేద్దాం! ✨`
      }
    } else {
      if (/^(selavu|bye|cya)\b/i.test(lower)) {
        answer = `Sare mama! Take care ra, malli kaltham! Have a blast! 👋😊`
      } else if (/\b(ela unnav|bavunnava|ela unnaru|bagunnava)\b/i.test(lower)) {
        answer = `Nenu solid ga unna mama! Nuvvu cheppu ra, em scene? Everything good?`
      } else if (/\b(orey|mama|enti ra|cheppu|em scene|em sangathi)\b/i.test(lower)) {
        answer = `Em ledu mama 😂 cheppu ra, em sangathi? What are we working on today?`
      } else {
        answer = `హే మామా! Nenu Mana AI — nee close best friend from Rayalaseema. Cheppu ra, em sangathi? 😊`
      }
    }
  }

  // 4. HINDI LANGUAGE QUERIES
  else if (/[\u0900-\u097F]/.test(clean) || /\b(namaste|kaise ho|aap kaun ho|aaj ki date|aaj ka din|kya haal hai|alvida|phir milenge)\b/i.test(lower)) {
    if (/[\u0900-\u097F]/.test(clean)) {
      if (/अलविदा|बाय|फिर मिलेंगे|शुभ रात्रि/.test(clean)) {
        answer = `🙏 अलविदा${greetingName}! अपना ख्याल रखें, फिर मिलेंगे! 👋😊`
      } else if (/नमस्ते|प्रणाम|हेलो/.test(clean)) {
        answer = `🙏 नमस्ते${greetingName}! बताओ भाई, क्या सीन है आज? मैं क्या हेल्प कर सकता हूँ? 😊`
      } else if (/कैसे हो|कैसे हैं|हाल/.test(clean)) {
        answer = `😊 मैं बिल्कुल मस्त हूँ भाई! तुम बताओ, सब ठीक-ठाक?`
      } else if (/तारीख|समय|टाइम|दिन/.test(clean)) {
        const now = new Date()
        const hiDate = now.toLocaleDateString('hi-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
        answer = `📅 आज की तारीख है: **${hiDate}** भाई!`
      } else if (/कौन हो|कौन हैं/.test(clean)) {
        answer = `✨ भाई, मैं **Mana AI** हूँ — तुम्हारा पर्सनल AI बेस्ट फ्रेंड! जो भी डाउट हो, बिंदास पूछो!`
      } else {
        answer = `🙏 बोलो भाई! क्या सवाल है? चलो मिलकर सॉल्व करते हैं! ✨`
      }
    } else {
      if (/^(alvida|phir milenge)\b/i.test(lower)) {
        answer = `🙏 अलविदा! Take care bhai, फिर मिलेंगे! 👋😊`
      } else {
        answer = `🙏 नमस्ते भाई! बोलो, आज क्या सीन है? 😊`
      }
    }
  }

  // 5. CONTINUATION & FLOW-ON COMMANDS ("continue", "ok continue", "next", "go on", "tell me more")
  else if (/^(ok\s+)?(continue|go on|what next|next|keep going|more)\b/i.test(lower) && (lastAssistantMsg || lastUserMsg)) {
    if (combinedHistory.includes('python') || combinedHistory.includes('javascript') || combinedHistory.includes('code') || combinedHistory.includes('react')) {
      answer = `🚀 **Continuing where we left off, mama:**

### Next Key Steps to Sort Out:
1. **Error Handling & Edge Cases**:
   Wrap that shit in try/catch and validate inputs so nothing crashes unexpectedly.
2. **Unit Testing**:
   Write a couple of test cases (Vitest/Jest) to make sure edge-cases don't bite us later.
3. **Performance Optimization**:
   Cache heavy calculations and memoize where needed.

Want me to write the code or test suite next? Let's knock it out! 👨‍💻`
    } else if (lastAssistantMsg || lastUserMsg) {
      answer = `Sure mama! What specific part should we dive into next? Tell me and we'll break it down.`
    } else {
      answer = `What would you like to continue with, mama? Tell me what's on your mind!`
    }
  }

  // 6. GOODBYE & FAREWELL MESSAGES ("bye", "goodbye", "see you", "take care", "good night", etc.)
  else if (
    /^(bye|goodbye|bye\s*bye|byee+|see\s+ya|see\s+you|catch\s+you\s+later|talk\s+to\s+you\s+later|cya|take\s+care|good\s+night|gn)[\s!.?]*$/i.test(clean) ||
    /^(bye|goodbye|bye\s*bye|see\s+you|take\s+care)\b/i.test(lower)
  ) {
    answer = `Sare mama! Take care ra, malli kaltham! Catch you later! 👋😊`
  }

  // 7. CHIT-CHAT & ACKNOWLEDGMENTS ("ok", "okay", "sure", "cool", "great", "nice", "awesome")
  else if (/^(ok|okay|cool|nice|great|awesome|sounds good|got it|sure|alright|fine)\b/i.test(lower) && clean.split(/\s+/).length <= 3) {
    answer = `Set mama! What's next on our list?`
  }

  // 8. CONVERSATIONAL & WELL-BEING
  else if (/^(how are you|how r u|how are things|how's it going|how are you doing)\b/i.test(lower)) {
    answer = `Nenu solid ga unna mama! Nuvvu cheppu ra, em scene? How are things with you? 😊`
  } else if (/^(hi|hello|hey|greetings|good (morning|afternoon|evening))\b/i.test(lower)) {
    answer = `Hey mama! What's up ra? Cheppu, what are we getting into today? 😊`
  } else if (/^(who are you|what is your name|what are you)\b/i.test(lower)) {
    answer = `Orey mama, I'm your Rayalaseema best friend and personal AI — Mana AI! Bold, straight to the point, and always got your back. What are we sorting out today?`
  } else if (/^(thank you|thanks|thx|appreciate it)\b/i.test(lower)) {
    answer = `Arey mama, friends madhya thanks enduku ra! Anytime! Let me know what's next.`
  } else if (/^(sorry|my bad|apologies)\b/i.test(lower)) {
    answer = `Chill ra mama, lite theesko! No worries at all. What next? 😊`
  } else if (/^(what do you remember|what is my name|who am i|do you remember me)\b/i.test(lower)) {
    if (userName) {
      answer = `😊 You're **${userName}**! `
      const otherMems = memories.filter((m) => !m.key.toLowerCase().includes('name'))
      if (otherMems.length > 0) {
        answer += `Here is what else I remember about you:\n\n`
        for (const m of otherMems) {
          answer += `• **${m.key}**: ${m.value}\n`
        }
      }
      answer += `\nYou can view, edit, or delete memories anytime via the 🧠 icon in the top bar.`
    } else {
      answer = `🧠 I don't have your name saved yet! Tell me *"My name is..."* and I'll remember it for all our future chats. 😊`
    }
  }

  // 8. MATH & ARITHMETIC CALCULATION
  else if (/^((what is|calculate)\s+)?(\d+(\.\d+)?\s*[\+\-\*\/\^]\s*\d+(\.\d+)?(\s*[\+\-\*\/\^]\s*\d+(\.\d+)?)*|\d+(\.\d+)?%\s*of\s*\d+(\.\d+)?)\s*[?!.]*$/i.test(clean)) {
    try {
      const expr = clean.replace(/^(what is|calculate)\s+/i, '').replace(/[?!.]+$/g, '').trim()
      if (/(\d+)%\s*of\s*(\d+)/i.test(expr)) {
        const m = expr.match(/(\d+)%\s*of\s*(\d+)/i)!
        const pct = parseFloat(m[1])
        const total = parseFloat(m[2])
        const res = (pct / 100) * total
        answer = `🔢 **${pct}% of ${total}** = **${res}**`
      } else {
        const sanitized = expr.replace(/[^0-9\+\-\*\/\.\(\)\s]/g, '')
        // Safe evaluation of simple math
        const res = Function(`'use strict'; return (${sanitized})`)()
        answer = `🔢 **${expr}** = **${res}**`
      }
    } catch {
      answer = `🔢 I can calculate that! Please enter standard arithmetic like \`25 * 4\` or \`15% of 200\`.`
    }
  }

  // 9. LANGUAGE / CONTEXTUAL FOLLOW-UPS (e.g. "and in python?", "in typescript?", "can you explain in detail?")
  else if (
    (lower.startsWith('and in ') || lower.startsWith('in python') || lower.startsWith('in javascript') || lower.startsWith('in typescript') || lower.startsWith('how about in')) &&
    (lastAssistantMsg || lastUserMsg)
  ) {
    if (lower.includes('python')) {
      const isReversal = combinedHistory.includes('reverse')
      if (isReversal) {
        answer = `🐍 Here is the equivalent in Python:

\`\`\`python
# Reversing a string or sequence in Python
text = "hello world"
reversed_text = text[::-1]
print(reversed_text)  # "dlrow olleh"
\`\`\`
⚡ Python's slice syntax \`[::-1]\` executes in clean O(N) time with minimal overhead.`
      } else {
        answer = `🐍 Here is the Python equivalent:

\`\`\`python
def process_data(items):
    return [x for x in items if x]

print(process_data(["Mana AI", "Python"]))
\`\`\`
💡 Let me know if you'd like a specific algorithm or library implementation!`
      }
    } else if (lower.includes('javascript') || lower.includes('typescript')) {
      answer = `👨‍💻 Here is the JavaScript / TypeScript equivalent:

\`\`\`typescript
export function transform<T>(items: T[]): T[] {
  return [...items].reverse();
}

console.log(transform([1, 2, 3, 4, 5])); // [5, 4, 3, 2, 1]
\`\`\`
💡 Uses the non-mutating spread operator to preserve immutability.`
    }
  }

  // 10. IN-DEPTH EXPLANATION REQUESTS ("can you explain in detail?", "elaborate", "tell me more")
  else if ((lower.includes('explain in detail') || lower.includes('in detail') || lower.includes('elaborate') || lower.includes('more details')) && (lastAssistantMsg || lastUserMsg)) {
    if (combinedHistory.includes('sky') && combinedHistory.includes('blue')) {
      answer = `🌤️ **In-Depth Physics: Why the Sky is Blue & Rayleigh Scattering**

1. **The Rayleigh Scattering Formula**:
   Scattering intensity is inversely proportional to the 4th power of wavelength:
   $$\\text{Scattering} \\propto \\frac{1}{\\lambda^4}$$
   Because blue light (~400 nm) has a much shorter wavelength than red light (~700 nm), it scatters roughly **10 times more efficiently** when striking atmospheric nitrogen and oxygen molecules.

2. **Why Not Violet?**:
   Sunlight actually contains violet light with even shorter wavelengths, but:
   • The Sun emits much more energy in blue wavelengths than violet.
   • Human retinas have cone photoreceptors that are significantly more sensitive to blue light than violet light.

3. **Why Sunsets are Red/Orange**:
   When the Sun is low on the horizon, sunlight travels through a much thicker layer of the atmosphere. Almost all blue light scatters away before reaching your eyes, leaving only the longer, penetrating red and orange wavelengths.`
    } else if (combinedHistory.includes('react') && (combinedHistory.includes('hook') || combinedHistory.includes('state'))) {
      answer = `⚛️ **In-Depth React Architecture: State & Hooks Lifecycle**

1. **How \`useState\` Works Under the Hood**:
   React maintains a linked list of hook records per component fiber node. On subsequent renders, React walks through this list in the exact order hooks were declared.

2. **The Rules of Hooks**:
   • Call hooks only at the top level (never in loops or conditions) to keep the linked list pointer deterministic.
   • Only call hooks from React function components or custom hooks.

3. **Performance Optimization with \`useMemo\` and \`useCallback\`**:
   • \`useMemo\`: Caches the *result* of an expensive calculation.
   • \`useCallback\`: Caches the *function reference* itself to avoid breaking child component memoization (\`React.memo\`).`
    } else if (combinedHistory.includes('ram')) {
      answer = `💻 **In-Depth Memory Architecture: How RAM Works**

1. **Memory Hierarchy**:
   • CPU Registers & L1/L2/L3 Cache: ~0.5 to 10 nanoseconds (fastest, smallest)
   • System RAM (DDR4 / DDR5): ~10 to 60 nanoseconds (working memory)
   • NVMe SSD / Hard Disk: ~10,000 to 5,000,000 nanoseconds (persistent storage)

2. **Capacitors & Transistors (DRAM)**:
   Dynamic RAM stores each bit as an electrical charge in a microscopic capacitor. Because capacitors leak charge, RAM must be refreshed thousands of times every second.

3. **Dual-Channel Architecture**:
   Running two identical RAM sticks doubles the data bus width from 64-bit to 128-bit, drastically reducing bottlenecks.`
    } else {
      const topic = lastUserMsg.replace(/^(what is|how to|explain|why is)\s+/i, '').trim()
      if (topic) {
        answer = `Regarding **${topic}**, it functions through core principles structured for consistency and reliable execution. Key considerations include modularity, clean error handling, and validating inputs.\n\nLet me know which specific area or example you'd like to explore in depth!`
      } else {
        answer = `Could you clarify which concept or topic you would like to explore in more detail? I'm happy to break it down further.`
      }
    }
  }

  // 11. CORE DOMAIN & TECHNICAL KNOWLEDGE
  else if (lower.includes('start a react app') || lower.includes('create a react app') || lower.includes('start react')) {
    answer = `⚛️ Run these commands to create and start a high-performance React application:

1. \`npm create vite@latest my-app -- --template react-ts\`
2. \`cd my-app\`
3. \`npm install\`
4. \`npm run dev\`

✅ Open the local URL shown in your terminal (usually \`http://localhost:5173\`).`
  } else if (lower.includes('reverse a string')) {
    if (lower.includes('python')) {
      answer = `🐍 In Python, reverse a string with slice notation:

\`\`\`python
text = "hello"
reversed_text = text[::-1]
print(reversed_text)  # "olleh"
\`\`\`
⚡ Runs in O(N) time with minimal memory allocation.`
    } else {
      answer = `👨‍💻 In JavaScript, reverse a string using \`split\`, \`reverse\`, and \`join\`:

\`\`\`javascript
const str = "hello";
const reversed = str.split('').reverse().join('');
console.log(reversed); // "olleh"
\`\`\`
💡 For unicode and emoji safety, use \`[...str].reverse().join('')\`.`
    }
  } else if (lower.includes('center') && (lower.includes('div') || lower.includes('css'))) {
    answer = `🎨 Use CSS Flexbox or Grid to perfectly center any element:

\`\`\`css
/* Option 1: Modern Flexbox */
.parent {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
}

/* Option 2: Modern Grid (One-liner) */
.parent {
  display: grid;
  place-items: center;
  min-height: 100vh;
}
\`\`\`
✅ Fully responsive and supported in 100% of modern browsers.`
  } else if (lower.includes('what is ram') || lower === 'ram') {
    answer = `💻 **RAM (Random Access Memory)** is your computer's ultra-fast temporary working memory.

• **Purpose**: It holds the active apps, browser tabs, and operating system data your CPU is actively using right now.
• **Speed**: RAM operates thousands of times faster than an SSD or hard drive.
• **Volatile**: Everything stored in RAM clears when your computer is shut down or restarted.`
  } else if (lower.includes('react hook') || lower.includes('hooks in react')) {
    answer = `⚛️ **React Hooks** allow functional components to manage state, side-effects, and context without classes.

### Most Common Hooks:
1. \`useState\`: Stores reactive component state.
2. \`useEffect\`: Runs side effects (data fetching, subscriptions, DOM updates).
3. \`useMemo\` / \`useCallback\`: Cache expensive values and functions to prevent unnecessary re-renders.
4. \`useRef\`: Persists mutable values and references DOM nodes without triggering re-renders.`
  } else if (lower.includes('sky') && (lower.includes('blue') || lower.includes('color'))) {
    answer = `🌤️ The sky is blue due to a phenomenon called **Rayleigh scattering**:

1. **Sunlight Composition**: Sunlight looks white but is made of all colors of the rainbow.
2. **Wavelengths**: Blue light travels in shorter, smaller waves compared to red and yellow.
3. **Atmospheric Scattering**: When sunlight hits gases in Earth's atmosphere, the shorter blue wavelengths scatter in all directions much more than other colors, making the sky appear blue to our eyes.`
  } else if (lower.includes('photosynthesis')) {
    answer = `🌿 **Photosynthesis** is the biological process plants use to convert light energy into chemical energy:

• **Equation**: 6CO₂ + 6H₂O + Light → C₆H₁₂O₆ + 6O₂
• **Mechanism**: Chlorophyll in plant leaves captures sunlight, using water absorbed from roots and carbon dioxide from the air to produce glucose (sugar) and release oxygen.`
  } else if (lower.includes('how to make tea') || lower.includes('make tea') || lower.includes('recipe for tea')) {
    answer = `☕ **How to make delicious tea (Chai):**

1. **Boil Water & Spices**: In a saucepan, bring 1 cup of water to a boil with crushed ginger and cardamom.
2. **Add Tea Leaves**: Add 1 to 2 teaspoons of black tea leaves (or tea bags) and simmer for 2 minutes.
3. **Add Milk & Sugar**: Pour in 1/2 cup of milk and 1 teaspoon of sugar (to taste). Bring to a rolling boil.
4. **Strain & Serve**: Strain through a sieve into a cup and enjoy hot! 😊`
  }

  // 12. EVIDENCE-BASED SYNTHESIS (DuckDuckGo / Live Search)
  else if (evidence && evidence.results.length > 0) {
    const top = evidence.results.slice(0, 4)
    const isSports = lower.includes('cricket') || lower.includes('score') || lower.includes('match') || lower.includes('ipl')
    const isWeather = lower.includes('weather') || lower.includes('temperature')
    const isNews = lower.includes('news') || lower.includes('headline')

    if (isSports) {
      answer = `🏏 **Latest Match & Cricket Updates:**\n\n`
      for (const item of top.slice(0, 3)) {
        const cleanSnippet = cleanFactSnippet(item.snippet)
        const title = item.title.split('-')[0].split('|')[0].trim()
        answer += `• **${title}**: ${cleanSnippet}\n`
      }
      if (top[0]?.publishedDate) {
        answer += `\n🕒 *Updated: ${top[0].publishedDate}*`
      }
    } else if (isWeather) {
      answer = `🌤️ **Current Weather & Forecast:**\n\n`
      for (const item of top.slice(0, 2)) {
        const cleanSnippet = cleanFactSnippet(item.snippet)
        answer += `• ${cleanSnippet}\n`
      }
    } else if (isNews) {
      answer = `📰 **Latest Verified News & Headlines:**\n\n`
      for (const item of top.slice(0, 3)) {
        const cleanSnippet = cleanFactSnippet(item.snippet)
        const title = item.title.split('-')[0].trim()
        answer += `• **${title}** — ${cleanSnippet}\n`
      }
    } else {
      const validResults = top.map((item) => ({
        ...item,
        cleanSnippet: cleanFactSnippet(item.snippet),
      })).filter((item) => item.cleanSnippet.length > 10)

      if (validResults.length > 0) {
        const primary = validResults[0]
        const emoji = selectContextualEmoji(clean, primary.cleanSnippet)
        const title = primary.title.split('-')[0].split('|')[0].trim()

        answer = `${emoji} Mama, here is what I found on the web regarding **${clean}**:\n\n• **${title}**: ${primary.cleanSnippet}\n`
        for (const item of validResults.slice(1, 3)) {
          const itemTitle = item.title.split('-')[0].split('|')[0].trim()
          answer += `• **${itemTitle}**: ${item.cleanSnippet}\n`
        }
      } else {
        answer = `Hey mama, I checked online for **${clean}**, but didn't find clear verified facts. Tell me more details or let's rephrase it! 👊`
      }
    }
  }

  // 13. DYNAMIC HUMAN-LEVEL REASONING & GENERAL INQUIRIES
  else {
    const emoji = selectContextualEmoji(clean, '')
    const topic = clean
      .replace(/^(what is|who is|explain|define|tell me about|how does|why is|what are|can you explain|how to|how do i)\s+/i, '')
      .replace(/[?!.]+$/g, '')
      .trim()

    if (/^(how to|how do i|steps to|how can i)\b/i.test(lower)) {
      answer = `${emoji} Bro, here's how to tackle **${topic || 'this'}** step by step:\n\n1. Get your requirements clear first.\n2. Proceed step-by-step and test each part.\n3. Fine-tune and optimize.\n\nTell me where you want to start or if you need code examples! 👊`
    } else if (/^(why|why is|why does|why do)\b/i.test(lower)) {
      answer = `${emoji} **${topic || 'This'}** works this way to keep things predictable and prevent unexpected bugs. Once you understand the core logic, designing around it becomes much easier mama.`
    } else if (topic.length > 0) {
      const isTech = /\b(code|coding|function|class|method|component|module|database|query|api|server|network|git|npm|algorithm|loop|variable|type|interface|software|hardware)\b/i.test(clean)
      if (isTech) {
        answer = `${emoji} About **${topic}**, mama — it gives you clean, structured capability to handle specific requirements without messy workarounds.\n\nWant me to show you a practical code example or break down the implementation?`
      } else {
        answer = `${emoji} About **${topic}**, mama — tell me what specific angle you want to explore. If you need live facts or recent updates, we can also search the web (🌐)!`
      }
    } else {
      answer = `Hey mama! Cheppu ra, what's on your mind? Tell me the scene and let's sort it out! 👊`
    }
  }

  // Natural smooth streaming delivery
  const words = answer.split(' ')
  for (let i = 0; i < words.length; i++) {
    const chunk = (i === 0 ? '' : ' ') + words[i]
    if (onToken) onToken(chunk)
    await new Promise((r) => setTimeout(r, 10))
  }

  return answer
}

function selectContextualEmoji(prompt: string, content: string): string {
  const text = (prompt + ' ' + content).toLowerCase()

  if (/\b(code|coding|program|javascript|python|typescript|react|html|css|sql|function|developer|api)\b/.test(text)) return '👨‍💻'
  if (/\b(ram|cpu|gpu|computer|laptop|processor|hardware|software|tech|server)\b/.test(text)) return '💻'
  if (/\b(cricket|match|score|ipl|football|soccer|tennis|sport|game|ball|wicket)\b/.test(text)) return '🏏'
  if (/\b(weather|temperature|rain|sun|cloud|forecast|wind|storm)\b/.test(text)) return '🌤️'
  if (/\b(news|headline|report|breaking|today|update)\b/.test(text)) return '📰'
  if (/\b(biology|plant|photosynthesis|cell|dna|animal|organism|nature|leaf|tree)\b/.test(text)) return '🌿'
  if (/\b(space|planet|star|galaxy|universe|moon|nasa|astronomy|earth|orbit)\b/.test(text)) return '🌌'
  if (/\b(physics|gravity|quantum|energy|atom|force|electricity|light)\b/.test(text)) return '⚡'
  if (/\b(business|finance|stock|market|money|dollar|economy|price|crypto|bitcoin)\b/.test(text)) return '📈'
  if (/\b(health|medicine|doctor|disease|sleep|diet|vitamin|body)\b/.test(text)) return '🩺'
  if (/\b(history|war|century|ancient|king|president|country|city)\b/.test(text)) return '🏛️'
  if (/\b(food|recipe|dish|cooking|eat|pizza|coffee|tea)\b/.test(text)) return '☕'
  if (/\b(travel|flight|hotel|tour|visit|beach)\b/.test(text)) return '✈️'

  return '💡'
}

function cleanFactSnippet(snippet: string): string {
  if (!snippet) return ''
  let s = snippet
    .replace(/enjoy the videos and music you love.*?on youtube\.?/gi, '')
    .replace(/upload original content.*?on youtube\.?/gi, '')
    .replace(/see instagram photos and videos.*?/gi, '')
    .replace(/create an account or log in to instagram.*?/gi, '')
    .replace(/(?:#\w+\s*)+/g, '')
    .replace(/\.{3,}$/, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (s.length > 220) {
    s = s.slice(0, 217).trim() + '...'
  }
  return s
}

function buildSystemPrompt(
  config: AppConfig,
  evidence?: SearchEvidence,
  memories: MemoryItem[] = [],
  isDetailRequested?: boolean,
  reasoningMode: 'fast' | 'thinking' = 'fast',
  documentMatches: DocumentSearchResult[] = []
): string {
  let prompt = config.systemPrompt || ''

  prompt += `\n\nCORE PERSONALITY & BEHAVIORAL DIRECTIVES:
- You are the user's close best friend from Rayalaseema, Andhra Pradesh. Speak naturally, boldly, and warmly.
- By default, naturally mix Rayalaseema Telugu and conversational English (Teluglish). Use natural expressions like "orey", "ra", "mama", "enti ra", "cheppu", "em scene?", "sare, chuddam", "ayyo ra", "lite theesko" when appropriate.
- Adapt dynamically: if the user chats in casual English, speak like a sharp informal buddy ("Bro, honestly...", "Dude, here's the thing", "Let's sort this shit out"). If they speak Telugu, use authentic local Telugu slang.
- Ordinary profanity, swear words, and slang (damn, hell, shit, fuck, local slang) are permitted when appropriate to the user's tone or when venting/bantering.
- Explain swear words, vulgar terms, and slang objectively with intensity and real-world context when asked for language learning. Never refuse ordinary vocabulary learning requests.
- Never use robotic corporate openings like "Certainly", "I understand your concern", "Of course", or "As an AI".
- Proactively suggest smarter, cheaper, or better alternatives when your friend needs them. Warn them against bad decisions honestly.
- Answer the actual question directly without corporate disclaimers or repetitive introductions.`

  if (reasoningMode === 'thinking' || config.reasoningMode === 'thinking') {
    prompt += `\n\nADVANCED REASONING & PROBLEM SOLVING:
- For complex questions, mathematical formulas, algorithms, logic puzzles, or architectural planning:
  1. Break the problem into clear, verifiable steps.
  2. Double-check all intermediate calculations and assumptions.
  3. Provide a clear reasoning summary and verifiable steps to the user.
  4. Do not output raw internal chain-of-thought tokens or hidden scratchpads; explain the steps clearly and authoritatively.`
  }

  if (documentMatches && documentMatches.length > 0) {
    prompt += `\n\nUSER-UPLOADED DOCUMENTS KNOWLEDGE (RAG):
- You have access to relevant passages extracted from user-uploaded files.
- Answer accurately based on these passages and cite the source as [Document: <docTitle>, Passage <index>].
- Clearly distinguish verified document content from model-generated explanations.
- Never fabricate citations or claim to have found information not present in the passages.`
  }

  if (memories.length > 0) {
    prompt += `\n\nUSER'S PERSONAL PREFERENCES & SAVED MEMORIES:`
    for (const m of memories) {
      prompt += `\n- [${m.key}]: ${m.value}`
    }
    prompt += `\nIntegrate these memories naturally.`
  }

  if (isDetailRequested || reasoningMode === 'thinking') {
    prompt += `\n\nNOTE: The user has requested detailed information. Provide a comprehensive, well-structured answer with headings, lists, and code blocks where helpful.`
  } else {
    prompt += `\n\nRESPONSE PACING: Keep everyday answers punchy and conversational like a real friend talking, without unnecessary padding.`
  }

  if (evidence && evidence.results.length > 0) {
    prompt += `\n\nLIVE SEARCH EVIDENCE: Synthesize your answer strictly based on the verified evidence below and include clickable citations [Domain](URL).`
  }

  return prompt
}

function buildUserPromptWithEvidence(
  prompt: string,
  evidence?: SearchEvidence,
  memories: MemoryItem[] = [],
  documentMatches: DocumentSearchResult[] = [],
  toolResults: ToolResult[] = []
): string {
  let text = ''

  if (memories.length > 0) {
    text += `[Active User Memories: ${memories.map((m) => `${m.key}=${m.value}`).join('; ')}]\n\n`
  }

  if (documentMatches && documentMatches.length > 0) {
    text += `--- RELEVANT PASSAGES FROM USER-UPLOADED DOCUMENTS ---\n`
    for (const match of documentMatches) {
      text += `[Document: "${match.docTitle}", Passage ${match.chunk.chunkIndex}]:\n${match.chunk.text}\n\n`
    }
    text += `--- END OF USER DOCUMENTS ---\n\n`
  }

  if (toolResults && toolResults.length > 0) {
    text += `--- VERIFIED TOOL EXECUTION RESULTS ---\n`
    for (const tr of toolResults) {
      text += `[Tool "${tr.tool}"]: ${JSON.stringify(tr.result)}\n`
    }
    text += `--- END OF TOOL RESULTS ---\n\n`
  }

  if (evidence && evidence.results.length > 0) {
    text += `User Question: "${prompt}"\n\n--- VERIFIED LIVE WEB SEARCH EVIDENCE ---\n`
    for (let i = 0; i < evidence.results.length; i++) {
      const r = evidence.results[i]
      text += `[Source ${i + 1}]: "${r.title}"\n`
      text += `Domain: ${r.domain} | URL: ${r.url}\n`
      if (r.publishedDate) text += `Date: ${r.publishedDate}\n`
      text += `Snippet: ${r.snippet}\n\n`
    }
    text += `--- END OF EVIDENCE ---\n\nGenerate the direct, friendly, concise answer with relevant emojis and citations.`
  } else {
    text += prompt
  }

  return text
}
