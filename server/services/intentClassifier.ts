import { IntentClassification } from '../types.js'

/**
 * Classifies the user's intent to decide whether live web search is required,
 * cleans the search query, and identifies if detailed explanation is requested.
 */
export function classifyIntent(prompt: string, conversationContext?: string[]): IntentClassification {
  const cleanText = prompt.trim()
  const lower = cleanText.toLowerCase()

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

  // 2. Conversational phrases: greetings, goodbyes, pleasantries, well-being, Teluglish buddy openers, everyday updates
  const conversationalRegex = /^(hi|hello|hey|greetings|good (morning|afternoon|evening)|bye|goodbye|bye bye|byee+|see you|see ya|cya|take care|good night|gn|ok|okay|cool|nice|great|awesome|sounds good|got it|sure|alright|fine|thanks|thank you|thx|how are you|how r u|who are you|what is your name|my name is|sorry|my bad|namaste|namaskaram|alvida|selavu|orey|mama|ra|enti ra|cheppu|em scene|em sangathi|bavunnava|ela unnav|bro|dude|wassup|what's up|whats up|sup|ayyo|malli|teach me bad words|talk in english|should i buy|my code is broken|my idea is perfect|i feel really bad)\b/i
  
  // Telugu & Teluglish everyday conversational expressions (e.g. "nenu inka bathike unna", "em chestunnav ra", "bore kodutondi")
  const teluguConversationalRegex = /\b(nenu inka bathike unna|inka bathike unna|bathike unna|bathiki unna|nenu unna|chachipoledu|chavaledu|em chestunnav|em chesthunnav|em peekuthunnav|ela unnav|ela unnaru|bavunnava|bagunnava|kushalama|thinnava|tinnava|bhojanam chesava|bore kodutondi|bore kottiddi|chala bore|bore mama|nidra vastondi|padukuntunna|nidra potunna|ippude lecha|lecha mama|cheppu mama|cheppu ra|orey mama|enti ra mama|em scene|em sangathi|lite theesko|dobbey|po ra|musukoni|sare mama|avuna mama|nijama|kaburlu|sollu|visugu vastondi|mood ledu|mood off|tension ga undi|kashtam ga undi)\b/i

  // Casual English emotional updates, small talk, well-being, and banter
  const casualEnglishRegex = /\b(still alive|alive and kicking|not dead yet|i'm bored|im bored|feeling bored|entertain me|what are you doing|what r u doing|did you eat|had lunch|had dinner|going to bed|going to sleep|sleepy|tired|woke up|bad day|bad mood|mood off|feeling down|feeling sad|feeling low|tell me a joke|crack a joke|talk to me|let's chat|teach me (bad|swear|curse) words|explain (bad|swear|curse) words|who made you|who created you|are you real)\b/i

  // Pure Telugu script without explicit search requests is direct conversation/knowledge
  const isTeluguScript = /[\u0C00-\u0C7F]/.test(cleanText)

  // Short reactions and acknowledgments
  const isReaction = /^(haha+|lmao+|lol+|rofl+|hehe+|😂|🤣|👍|❤️|🔥|cool|nice|great|super|awesome|chill|done|perfect|wow|ayyo|sare)[\s!.?]*$/i.test(cleanText)

  if (conversationalRegex.test(lower) || teluguConversationalRegex.test(lower) || casualEnglishRegex.test(lower) || isReaction) {
    return {
      needsSearch: false,
      refinedQuery: cleanText,
      reason: 'Conversational greeting, personal exchange, Teluglish banter, or everyday update.',
      category: 'conversational',
      isDetailRequested: false,
    }
  }

  // If in Telugu script and not explicitly asking to search the web, treat as direct conversation/knowledge
  if (isTeluguScript && !/\b(search|google|web|online|score|weather)\b/i.test(lower)) {
    return {
      needsSearch: false,
      refinedQuery: cleanText,
      reason: 'Direct conversational Telugu inquiry.',
      category: 'conversational',
      isDetailRequested,
    }
  }

  // Check for time-sensitive keywords that might need live info
  const hasTimeKeywords = /\b(latest|today|now|current|recent|recently|live|score|scores|schedule|price|prices|release date|version|2025|2026|newest|breaking)\b/i.test(lower)

  // Context-aware continuation: if previous messages exist and current message is a short casual follow-up
  if (conversationContext && conversationContext.length > 0) {
    const isShortRemark = cleanText.split(/\s+/).length <= 7
    const hasSearchWord = /\b(search|google|web|online|news|score|weather|price)\b/i.test(lower)
    if (isShortRemark && !hasSearchWord && !hasTimeKeywords) {
      if (/^(why|why so|how come|really|seriously|avuna|nijama|mari|inka|mari nuvvu|what about you|and you|tell me more|what next|explain more|next|sare)[\s?!.]*$/i.test(cleanText)) {
        return {
          needsSearch: false,
          refinedQuery: cleanText,
          reason: 'Conversational follow-up in ongoing dialogue.',
          category: 'conversational',
          isDetailRequested,
        }
      }
    }
  }

  // 3. Explicit direct / creative / general knowledge exclusions that shouldn't search
  // e.g. "What is RAM?", "Write a poem about", "Translate this", "How to loop in python"
  const generalCodingPatterns = [
    /^(how do i|how to|write code to|create a function|reverse a string|for loop in|regex for)\s+[a-z0-9\s#+._-]+$/i,
    /^(what is|define|explain)\s+(ram|rom|cpu|gpu|html|css|dns|tcp|http|api|ip address|boolean|array|recursion|polymorphism|oop|sql|json|variable|function|compiler|interpreter|photosynthesis|gravity|mitochondria|dna|rna|atom|energy|cell)\b/i,
    /^(write a poem|tell me a joke|write a story|write an essay|summarize this text)\b/i,
  ]

  if (!hasTimeKeywords) {
    for (const pattern of generalCodingPatterns) {
      if (pattern.test(lower)) {
        return {
          needsSearch: false,
          refinedQuery: cleanText,
          reason: 'Standard conceptual or coding question with established knowledge.',
          category: lower.includes('code') || lower.includes('function') ? 'coding' : 'general_knowledge',
          isDetailRequested,
        }
      }
    }
  }

  // 3. Explicit Search Intent Triggers (e.g. "search google for X", "google X", "look up on web")
  const explicitSearchRegex = /\b(search (google|the web|online|for)|google (for|the|it|search)|look up (online|on the web|on google)|find (online|on the web))\b/i
  if (explicitSearchRegex.test(lower)) {
    return {
      needsSearch: true,
      refinedQuery: extractSearchQuery(cleanText, 'explicit_search'),
      reason: 'User explicitly requested an external web/Google search.',
      category: 'explicit_search',
      isDetailRequested,
    }
  }

  // 4. Live sports scores and ongoing match status
  const liveSportsRegex = /\b(live cricket score|ipl score|t20 score|world cup score|live score of|live match score|cricbuzz score)\b/i
  if (liveSportsRegex.test(lower)) {
    return {
      needsSearch: true,
      refinedQuery: extractSearchQuery(cleanText, 'sports'),
      reason: 'Real-time sports score requires live web coverage.',
      category: 'sports',
      isDetailRequested,
    }
  }

  // 5. Real-time meteorological data (weather forecast for a specific location)
  const weatherRegex = /\b(weather (in|for|today in|forecast in)|temperature (in|at)|forecast for|climate in)\b/i
  if (weatherRegex.test(lower)) {
    return {
      needsSearch: true,
      refinedQuery: extractSearchQuery(cleanText, 'weather'),
      reason: 'Live local weather forecast requires real-time meteorological data.',
      category: 'weather',
      isDetailRequested,
    }
  }

  // 6. Breaking news and today's headlines
  const newsRegex = /\b(breaking news today|today's headlines|latest news on|news today about)\b/i
  if (newsRegex.test(lower)) {
    return {
      needsSearch: true,
      refinedQuery: extractSearchQuery(cleanText, 'news'),
      reason: 'Current breaking news requires live web coverage.',
      category: 'news',
      isDetailRequested,
    }
  }

  // 7. Live stock/crypto prices (e.g. "stock price of AAPL", "bitcoin price today")
  const priceRegex = /\b(stock price of|share price of|crypto price of|bitcoin price today|eth price today)\b/i
  if (priceRegex.test(lower)) {
    return {
      needsSearch: true,
      refinedQuery: extractSearchQuery(cleanText, 'pricing'),
      reason: 'Live financial asset price fluctuates in real time.',
      category: 'pricing',
      isDetailRequested,
    }
  }

  // 8. Default: Ordinary questions, coding, explanations, chat are answered directly by Mana AI (like ChatGPT)
  return {
    needsSearch: false,
    refinedQuery: cleanText,
    reason: 'Answer directly using Mana AI intelligent assistant engine.',
    category: 'general_knowledge',
    isDetailRequested,
  }
}

/**
 * Extracts a concise, privacy-safe search engine query
 * Strips filler words ("can you tell me", "please search for", etc.)
 * Strips personal identification (emails, phone numbers)
 */
function extractSearchQuery(input: string, _category: string): string {
  let q = input.trim()

  // Remove trailing search instructions (e.g. "search the web", "search google", "look up online")
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

  // Fallback if query became empty
  return q.length > 0 ? q : input
}
