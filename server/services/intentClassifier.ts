import { IntentClassification, IntentCategory } from '../types.js'

export interface ContextualTurn {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Normalizes conversation history into structured turns whether passed as
 * objects { role, content } or prefixed strings "user: ..."
 */
function normalizeContext(
  rawContext?: Array<{ role: string; content: string }> | string[]
): ContextualTurn[] {
  if (!rawContext || !Array.isArray(rawContext) || rawContext.length === 0) {
    return []
  }

  const turns: ContextualTurn[] = []
  for (const item of rawContext) {
    if (!item) continue
    if (typeof item === 'string') {
      const colonIdx = item.indexOf(':')
      if (colonIdx !== -1) {
        const role = item.slice(0, colonIdx).trim().toLowerCase()
        const content = item.slice(colonIdx + 1).trim()
        turns.push({
          role: role === 'assistant' || role === 'model' ? 'assistant' : 'user',
          content,
        })
      } else {
        turns.push({ role: 'user', content: item.trim() })
      }
    } else if (typeof item === 'object' && typeof item.content === 'string') {
      const role = item.role?.toLowerCase()
      turns.push({
        role: role === 'assistant' || role === 'model' ? 'assistant' : 'user',
        content: item.content.trim(),
      })
    }
  }

  return turns
}

/**
 * Known entity dictionaries and spelling correction maps
 */
const HYDERABAD_LOCALITIES: Record<string, string> = {
  ammerpet: 'Ameerpet',
  ameerpet: 'Ameerpet',
  amirpet: 'Ameerpet',
  secunderbad: 'Secunderabad',
  secunderabad: 'Secunderabad',
  sikandrabad: 'Secunderabad',
  kukatpali: 'Kukatpally',
  kukatpally: 'Kukatpally',
  kphb: 'KPHB Colony',
  'hitec city': 'HITEC City',
  hiteccity: 'HITEC City',
  cyberabad: 'Cyberabad',
  charminar: 'Charminar',
  charminr: 'Charminar',
  gachibowli: 'Gachibowli',
  gachiboli: 'Gachibowli',
  'jubilee hills': 'Jubilee Hills',
  jubileehills: 'Jubilee Hills',
  'banjara hills': 'Banjara Hills',
  banjarahills: 'Banjara Hills',
  madhapur: 'Madhapur',
  madhapr: 'Madhapur',
  kondapur: 'Kondapur',
  dilsukhnagar: 'Dilsukhnagar',
  dilsukhnagr: 'Dilsukhnagar',
  lakdikapul: 'Lakdikapul',
  lakdikapool: 'Lakdikapul',
  begumpet: 'Begumpet',
  begampet: 'Begumpet',
  miyapur: 'Miyapur',
  myapur: 'Miyapur',
  panjagutta: 'Punjagutta',
  punjagutta: 'Punjagutta',
  uppal: 'Uppal',
  abids: 'Abids',
  koti: 'Koti',
  mehdipatnam: 'Mehdipatnam',
  malakpet: 'Malakpet',
  toli_chowki: 'Tolichowki',
  tolichowki: 'Tolichowki',
  lingampally: 'Lingampally',
  nampally: 'Nampally',
  somajiguda: 'Somajiguda',
  khairatabad: 'Khairatabad',
}

const BENGALURU_LOCALITIES: Record<string, string> = {
  marathahali: 'Marathahalli',
  marathahalli: 'Marathahalli',
  koramangala: 'Koramangala',
  indiranagar: 'Indiranagar',
  whitefield: 'Whitefield',
  'electronic city': 'Electronic City',
  electroniccity: 'Electronic City',
  hebbal: 'Hebbal',
  jayanagar: 'Jayanagar',
  'jp nagar': 'JP Nagar',
  hsr: 'HSR Layout',
  'hsr layout': 'HSR Layout',
  bellandur: 'Bellandur',
  malleswaram: 'Malleswaram',
  rajajinagar: 'Rajajinagar',
  mg_road: 'MG Road',
}

const TECH_ENTITIES: Record<string, string> = {
  'spring boot': 'Spring Boot Framework',
  springboot: 'Spring Boot Framework',
  hibernate: 'Hibernate ORM',
  jvm: 'Java Virtual Machine (JVM)',
  jdk: 'Java Development Kit (JDK)',
  jre: 'Java Runtime Environment (JRE)',
  maven: 'Apache Maven',
  gradle: 'Gradle Build Tool',
  jpa: 'Jakarta Persistence API (JPA)',
  microservices: 'Java Microservices',
  react: 'React.js',
  nextjs: 'Next.js',
  vue: 'Vue.js',
  angular: 'Angular',
  docker: 'Docker Containers',
  kubernetes: 'Kubernetes (K8s)',
  postgres: 'PostgreSQL Database',
  mongodb: 'MongoDB Database',
}

/**
 * Extracts the primary conversational topic/city/tech domain from recent turns
 */
function extractActiveTopic(turns: ContextualTurn[]): {
  city?: 'hyderabad' | 'bengaluru' | 'chennai' | 'delhi' | 'mumbai' | 'ap'
  cityName?: string
  techDomain?: 'java' | 'python' | 'javascript' | 'react' | 'devops' | 'ai'
  techName?: string
  generalTopic?: string
} {
  const recentTurns = turns.slice(-6)
  const combinedText = recentTurns.map((t) => t.content.toLowerCase()).join(' ')

  // 1. Detect City Context
  if (/\b(hyderabad|hyderabadi|telangana|secunderabad|cyberabad|charminar|biryani|salim)\b/i.test(combinedText)) {
    return { city: 'hyderabad', cityName: 'Hyderabad', generalTopic: 'Hyderabad' }
  }
  if (/\b(bengaluru|bangalore|karnataka|namma metro|silicon valley of india)\b/i.test(combinedText)) {
    return { city: 'bengaluru', cityName: 'Bengaluru', generalTopic: 'Bengaluru' }
  }
  if (/\b(chennai|madras|tamil nadu)\b/i.test(combinedText)) {
    return { city: 'chennai', cityName: 'Chennai', generalTopic: 'Chennai' }
  }
  if (/\b(delhi|new delhi|ncr|gurgaon|noida)\b/i.test(combinedText)) {
    return { city: 'delhi', cityName: 'Delhi', generalTopic: 'Delhi' }
  }
  if (/\b(mumbai|bombay|maharashtra)\b/i.test(combinedText)) {
    return { city: 'mumbai', cityName: 'Mumbai', generalTopic: 'Mumbai' }
  }
  if (/\b(amaravati|vijayawada|vizag|visakhapatnam|tirupati|guntur|andhra|ap)\b/i.test(combinedText)) {
    return { city: 'ap', cityName: 'Andhra Pradesh', generalTopic: 'Andhra Pradesh' }
  }

  // 2. Detect Tech Context
  if (/\b(java|spring|jvm|jdk|hibernate|maven|gradle|byte code|polymorphism in java)\b/i.test(combinedText)) {
    return { techDomain: 'java', techName: 'Java', generalTopic: 'Java Programming' }
  }
  if (/\b(python|django|flask|fastapi|pandas|numpy|pytorch)\b/i.test(combinedText)) {
    return { techDomain: 'python', techName: 'Python', generalTopic: 'Python Programming' }
  }
  if (/\b(react|reactjs|hooks|jsx|redux|next\.?js|vue|angular)\b/i.test(combinedText)) {
    return { techDomain: 'react', techName: 'React / Frontend', generalTopic: 'React Web Development' }
  }

  return {}
}

/**
 * Classifies the user's intent with full conversation context awareness.
 * Determines whether web search is genuinely needed, rewrites queries with
 * contextual references, resolves spelling errors, and detects error recovery mode.
 */
export function classifyIntent(
  prompt: string,
  rawContext?: Array<{ role: string; content: string }> | string[]
): IntentClassification {
  const cleanText = prompt.trim()
  const lower = cleanText.toLowerCase()
  const turns = normalizeContext(rawContext)
  const activeTopic = extractActiveTopic(turns)

  // 1. Detect if the user explicitly requested detail
  const detailTriggers = [
    'in detail',
    'detailed',
    'in-depth',
    'deep dive',
    'step by step',
    'step-by-step',
    'thoroughly',
    'comprehensive',
    'explain with examples',
    'elaborate',
    'full explanation',
    'give me details',
  ]
  const isDetailRequested = detailTriggers.some((t) => lower.includes(t))

  // 2. CORRECTION & COMPLAINT RECOVERY DETECTION (CRITICAL PRIORITY)
  // When the user points out a mistake, misunderstanding, or failure in the previous turn
  const correctionTriggers = [
    /\b(you made a mistake|you made a blunder|you are wrong|that is wrong|that's wrong|thats wrong)\b/i,
    /\b(rectify (your|you) mistakes?|need to rectify|correct (your|you) mistakes?|fix your mistake)\b/i,
    /\b(that('?s| is) not what (i|we) (asked|meant|said)|not what i was asking)\b/i,
    /\b(you misunderstood|you misunderstood me|you completely misunderstood|missed the context|missed the connection)\b/i,
    /\b(first i asked .* after that|i asked about .* not .*|i was talking about .* not)\b/i,
    /\b(why did you search|why did you bring up|why a lake|not a lake|not in germany|why germany)\b/i,
    /\b(correct your answer|fix your answer|check again|that's incorrect|thats incorrect)\b/i,
    // Telugu / Teluglish expressions of correction & calling out AI blunders
    /\b(thappu cheppavu|thappu ra|adi thappu|adi kaadu mama|nenu adigindi veru|nenu adigindi adi kaadu|nenu .* gurinchi adiga|nuvvu em cheptunnav|nee bondha ra|bokka cheppav|dimag ledha|sariga chusi cheppu|sariga vinu)\b/i,
  ]

  const isCorrection = correctionTriggers.some((re) => re.test(lower))
  if (isCorrection) {
    return {
      needsSearch: false,
      refinedQuery: cleanText,
      reason: 'User is correcting an AI error or misunderstanding. Switch directly to correction and error recovery mode.',
      category: 'correction_feedback',
      isDetailRequested,
      isCorrectionOrFeedback: true,
      contextualTopic: activeTopic.cityName || activeTopic.techName || activeTopic.generalTopic || 'previous conversation',
      originalQuery: cleanText,
    }
  }

  // 3. EXPLICIT TOPIC CHANGE
  // User explicitly asks to drop the old topic and start something new
  const topicChangeRegex = /^(forget that|leave that|ignore (that|previous)|switch topic|new (topic|question)|different topic|moving on|let'?s talk about something else|never mind|anyway)\b/i
  if (topicChangeRegex.test(lower)) {
    return {
      needsSearch: false,
      refinedQuery: cleanText.replace(topicChangeRegex, '').trim() || cleanText,
      reason: 'User explicitly requested a topic change. Detach from previous context.',
      category: 'topic_change',
      isDetailRequested,
      isFollowUp: false,
      originalQuery: cleanText,
    }
  }

  // 4. CONVERSATIONAL GREETINGS & CASUAL OPENERS
  // Greetings, pleasantries, "tell me something", everyday banter
  const conversationalRegex = /^(hi|hello|hey|greetings|good (morning|afternoon|evening)|bye|goodbye|bye bye|byee+|see you|see ya|take care|good night|gn|ok|okay|cool|nice|great|awesome|sounds good|got it|sure|alright|fine|thanks|thank you|thx|namaste|namaskaram|alvida|selavu|orey|mama|ra|enti ra|cheppu|em scene|em sangathi|bavunnava|ela unnav|bro|dude|wassup|what's up|whats up|sup)[\s!.?]*$/i
  const tellMeSomethingRegex = /^(tell me something|tell me a fact|tell me something interesting|say something|tell me a story|say something interesting|something interesting|tell me an interesting fact)[\s!.?]*$/i
  const teluguCasualRegex = /\b(nenu inka bathike unna|inka bathike unna|bathike unna|em chestunnav|ela unnav|bavunnava|bagunnava|thinnava|tinnava|bore kodutondi|chala bore|bore mama|nidra vastondi|cheppu mama|cheppu ra|orey mama|visugu vastondi|mood off)\b/i
  const isReaction = /^(haha+|lmao+|lol+|rofl+|hehe+|😂|🤣|👍|❤️|🔥|cool|nice|great|super|awesome|chill|done|perfect|wow|ayyo|sare)[\s!.?]*$/i.test(cleanText)

  if (
    conversationalRegex.test(cleanText) ||
    tellMeSomethingRegex.test(lower) ||
    teluguCasualRegex.test(lower) ||
    isReaction
  ) {
    return {
      needsSearch: false,
      refinedQuery: cleanText,
      reason: 'Conversational greeting, everyday check-in, casual request, or reaction.',
      category: 'conversational',
      isDetailRequested: false,
      isFollowUp: false,
      originalQuery: cleanText,
    }
  }

  // Pure Telugu script without explicit search words is direct conversation/knowledge
  const isTeluguScript = /[\u0C00-\u0C7F]/.test(cleanText)
  if (isTeluguScript && !/\b(search|google|web|online|score|weather|timings|price)\b/i.test(lower)) {
    return {
      needsSearch: false,
      refinedQuery: cleanText,
      reason: 'Direct conversational Telugu inquiry.',
      category: 'conversational',
      isDetailRequested,
      originalQuery: cleanText,
    }
  }

  // 5. CONTEXTUAL FOLLOW-UP & SPELLING CORRECTION
  // If recent context exists and the prompt is a short follow-up or entity name
  const words = cleanText.split(/\s+/).filter(Boolean)
  const isShortPrompt = words.length <= 5
  const hasTimeKeywords = /\b(latest|today|now|current|recent|recently|live|score|scores|timings?|schedule|price|prices|release date|version|2025|2026|newest|breaking)\b/i.test(lower)
  const hasExplicitSearchWord = /\b(search (google|the web|online|for)|google (for|the|it|search)|look up (online|on the web|on google)|find (online|on the web))\b/i.test(lower)

  if (turns.length > 0 && !hasExplicitSearchWord) {
    // 5A. Locality follow-up in city context (e.g. Hyderabad -> "ammerpet" or "ammerpet metro timings today")
    if (activeTopic.city === 'hyderabad') {
      const normalizedLookup = lower.replace(/[^a-z0-9 ]/g, '').trim()
      let matchedCorrected: string | undefined
      let matchedKey: string | undefined

      if (HYDERABAD_LOCALITIES[normalizedLookup]) {
        matchedCorrected = HYDERABAD_LOCALITIES[normalizedLookup]
        matchedKey = normalizedLookup
      } else {
        for (const [key, corrected] of Object.entries(HYDERABAD_LOCALITIES)) {
          const keyRegex = new RegExp(`\\b${key}\\b`, 'i')
          if (keyRegex.test(lower)) {
            matchedCorrected = corrected
            matchedKey = key
            break
          }
        }
      }

      if (matchedCorrected) {
        const needsLiveTimings = hasTimeKeywords || /\b(metro timings|timings|bus timings|traffic|fare)\b/i.test(lower)
        let refinedSearchQuery: string
        if (matchedKey && lower.includes(matchedKey)) {
          const replaced = cleanText.replace(new RegExp(`\\b${matchedKey}\\b`, 'gi'), matchedCorrected)
          refinedSearchQuery = replaced.toLowerCase().includes('hyderabad')
            ? replaced
            : `${replaced} Hyderabad`
        } else {
          refinedSearchQuery = `${matchedCorrected} Hyderabad${hasTimeKeywords ? ' ' + lower.match(/\b(timings|metro|today|schedule)\b/gi)?.join(' ') : ''}`
        }

        return {
          needsSearch: needsLiveTimings,
          refinedQuery: refinedSearchQuery,
          reason: `Contextual locality (${matchedCorrected}) in Hyderabad. ${needsLiveTimings ? 'Live search for time-sensitive inquiry.' : 'Answer from general knowledge.'}`,
          category: 'contextual_followup',
          isDetailRequested,
          isFollowUp: true,
          contextualTopic: 'Hyderabad',
          correctedEntity: matchedCorrected,
          originalQuery: cleanText,
        }
      }

      // Metro inquiry in Hyderabad context: "what about metro?", "metro", "metro timings"
      if (/\b(what about metro|metro|metro rail|metro stations?|metro timings?)\b/i.test(lower) && words.length <= 6) {
        const needsLiveSearch = hasTimeKeywords || lower.includes('timings')
        return {
          needsSearch: needsLiveSearch,
          refinedQuery: `Hyderabad Metro Rail${hasTimeKeywords ? ' today' : ''}`,
          reason: `Interpreting "metro" in active Hyderabad context. ${needsLiveSearch ? 'Searching live metro info.' : 'Explaining Hyderabad Metro Rail.'}`,
          category: 'contextual_followup',
          isDetailRequested,
          isFollowUp: true,
          contextualTopic: 'Hyderabad Metro Rail',
          correctedEntity: 'Hyderabad Metro Rail',
          originalQuery: cleanText,
        }
      }
    }

    // 5B. Locality follow-up in Bengaluru context (e.g. Bengaluru -> "marathahali")
    if (activeTopic.city === 'bengaluru') {
      const normalizedLookup = lower.replace(/[^a-z0-9 ]/g, '').trim()
      let matchedCorrected: string | undefined
      let matchedKey: string | undefined

      if (BENGALURU_LOCALITIES[normalizedLookup]) {
        matchedCorrected = BENGALURU_LOCALITIES[normalizedLookup]
        matchedKey = normalizedLookup
      } else {
        for (const [key, corrected] of Object.entries(BENGALURU_LOCALITIES)) {
          const keyRegex = new RegExp(`\\b${key}\\b`, 'i')
          if (keyRegex.test(lower)) {
            matchedCorrected = corrected
            matchedKey = key
            break
          }
        }
      }

      if (matchedCorrected) {
        const needsLiveSearch = hasTimeKeywords
        let refinedSearchQuery: string
        if (matchedKey && lower.includes(matchedKey)) {
          const replaced = cleanText.replace(new RegExp(`\\b${matchedKey}\\b`, 'gi'), matchedCorrected)
          refinedSearchQuery = replaced.toLowerCase().includes('bengaluru') || replaced.toLowerCase().includes('bangalore')
            ? replaced
            : `${replaced} Bengaluru`
        } else {
          refinedSearchQuery = `${matchedCorrected} Bengaluru`
        }

        return {
          needsSearch: needsLiveSearch,
          refinedQuery: refinedSearchQuery,
          reason: `Contextual locality (${matchedCorrected}) in Bengaluru.`,
          category: 'contextual_followup',
          isDetailRequested,
          isFollowUp: true,
          contextualTopic: 'Bengaluru',
          correctedEntity: matchedCorrected,
          originalQuery: cleanText,
        }
      }
    }

    // 5C. Technology follow-up in Java / Tech context (e.g. Java -> "spring boot")
    if (activeTopic.techDomain === 'java') {
      const normalizedLookup = lower.replace(/[^a-z0-9 ]/g, '').trim()
      const matchedCorrected = TECH_ENTITIES[normalizedLookup]

      if (matchedCorrected) {
        return {
          needsSearch: false,
          refinedQuery: `${matchedCorrected} Java`,
          reason: `Interpreting "${cleanText}" as ${matchedCorrected} in active Java context.`,
          category: 'contextual_followup',
          isDetailRequested,
          isFollowUp: true,
          contextualTopic: 'Java',
          correctedEntity: matchedCorrected,
          originalQuery: cleanText,
        }
      }
    }

    // 5D. Short question follow-ups inheriting active topic: "how much", "nearby", "tell me more", "in Telugu", "why"
    const genericFollowupRegex = /^(how much|how to reach|nearby|near by|what next|tell me more|in telugu|why|why so|how come|and you|mari nuvvu|what about you|is it good|is it safe|food|cost|rent)[\s?!.]*$/i
    if (genericFollowupRegex.test(cleanText) || (isShortPrompt && !hasTimeKeywords)) {
      return {
        needsSearch: false,
        refinedQuery: cleanText,
        reason: 'Short contextual follow-up continuing ongoing topic without requiring web search.',
        category: 'contextual_followup',
        isDetailRequested,
        isFollowUp: true,
        contextualTopic: activeTopic.generalTopic,
        originalQuery: cleanText,
      }
    }
  }

  // 6. AMBIGUOUS PLACE NAME WITHOUT CONTEXT
  // If user enters an ambiguous place name like "springfield" with NO prior conversation context
  if (turns.length === 0 && words.length <= 2) {
    const ambiguousPlaces = ['springfield', 'victoria', 'manchester', 'alexandria', 'san jose', 'georgetown']
    if (ambiguousPlaces.includes(lower)) {
      return {
        needsSearch: false,
        refinedQuery: cleanText,
        reason: `Ambiguous place name "${cleanText}" without prior context. Clarify concisely.`,
        category: 'general_knowledge',
        isDetailRequested,
        isFollowUp: false,
        originalQuery: cleanText,
      }
    }
  }

  // 7. TIME-SENSITIVE / LIVE EXTERNAL SEARCH TRIGGERS

  // 7A. Explicit Search
  if (hasExplicitSearchWord) {
    return {
      needsSearch: true,
      refinedQuery: extractSearchQuery(cleanText, 'explicit_search'),
      reason: 'User explicitly requested a web or Google search.',
      category: 'explicit_search',
      isDetailRequested,
      originalQuery: cleanText,
    }
  }

  // 7B. Live sports scores and ongoing matches
  const liveSportsRegex = /\b(live cricket score|ipl score|t20 score|world cup score|live score of|live match score|cricbuzz score|who won (the )?match yesterday|yesterday match score)\b/i
  if (liveSportsRegex.test(lower)) {
    return {
      needsSearch: true,
      refinedQuery: extractSearchQuery(cleanText, 'sports'),
      reason: 'Real-time sports score or recent match result requires live web coverage.',
      category: 'sports',
      isDetailRequested,
      originalQuery: cleanText,
    }
  }

  // 7C. Weather forecast (real-time meteorological data)
  const weatherRegex = /\b(weather (in|for|today in|forecast in)|temperature (in|at)|forecast for|climate in|weather today)\b/i
  if (weatherRegex.test(lower)) {
    let q = cleanText
    if (activeTopic.cityName && !lower.includes('in') && !lower.includes('for')) {
      q = `weather in ${activeTopic.cityName} today`
    }
    return {
      needsSearch: true,
      refinedQuery: extractSearchQuery(q, 'weather'),
      reason: 'Live local weather forecast requires real-time meteorological data.',
      category: 'weather',
      isDetailRequested,
      originalQuery: cleanText,
    }
  }

  // 7D. Breaking news & today's headlines
  const newsRegex = /\b(breaking news today|today's headlines|latest news on|news today about|what happened today in)\b/i
  if (newsRegex.test(lower)) {
    return {
      needsSearch: true,
      refinedQuery: extractSearchQuery(cleanText, 'news'),
      reason: 'Current breaking news requires live web coverage.',
      category: 'news',
      isDetailRequested,
      originalQuery: cleanText,
    }
  }

  // 7E. Live financial rates (crypto, stock, gold rates today)
  const priceRegex = /\b(stock price of|share price of|crypto price of|bitcoin price today|eth price today|gold rate (today|in)|petrol price today)\b/i
  if (priceRegex.test(lower)) {
    return {
      needsSearch: true,
      refinedQuery: extractSearchQuery(cleanText, 'pricing'),
      reason: 'Live financial asset price fluctuates in real time.',
      category: 'pricing',
      isDetailRequested,
      originalQuery: cleanText,
    }
  }

  // 8. General Knowledge Exclusions (e.g. "Do you know Hyderabad?", "What is RAM?", "Write code in Python")
  // Should answer directly from model's internal intelligence without web search
  const generalKnowledgeRegex = /^(do you know|what is|tell me about|explain|who was|who is|history of|define|how does|why do|difference between)\s+[a-z0-9\s#+._-]+$/i
  if (!hasTimeKeywords && generalKnowledgeRegex.test(lower)) {
    return {
      needsSearch: false,
      refinedQuery: cleanText,
      reason: 'Conceptual, geographic, or general knowledge question answered directly.',
      category: 'general_knowledge',
      isDetailRequested,
      originalQuery: cleanText,
    }
  }

  // 9. Default: Intelligent direct answer (like ChatGPT)
  return {
    needsSearch: false,
    refinedQuery: cleanText,
    reason: 'Answer directly using Mana AI intelligent conversational engine.',
    category: 'general_knowledge',
    isDetailRequested,
    originalQuery: cleanText,
  }
}

/**
 * Extracts a concise, privacy-safe search engine query
 */
function extractSearchQuery(input: string, _category: string): string {
  let q = input.trim()

  // Remove trailing search instructions
  q = q.replace(/[\s,.-]+(search (the web|google|online|for this)|look (it )?up (online|on google|on the web)|on (google|the web|the internet))\s*$/i, '')

  // Remove polite introductions & filler prefixes
  q = q.replace(/^(can you (please )?(tell me|search for|look up|check)|please (search|check|find)|what is the|who is the|search (for|the web for|google for|online for)|look up|google)\s+/i, '')
  q = q.replace(/[?!.]+$/g, '').trim()

  // Privacy protection: strip emails
  q = q.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '')

  // Privacy protection: strip phone numbers (10+ digits)
  q = q.replace(/\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g, '')

  // Normalize spacing
  q = q.replace(/\s+/g, ' ').trim()

  return q.length > 0 ? q : input
}
