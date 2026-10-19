import * as cheerio from 'cheerio'
import { SearchEvidence, SearchResultItem, SearchProvider } from '../types.js'

// In-memory cache with 5-minute TTL to avoid duplicate searches
interface CacheEntry {
  timestamp: number
  evidence: SearchEvidence
}
const searchCache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

// Reputable domains to prioritize in ranking
const REPUTABLE_DOMAINS = [
  'espncricinfo.com',
  'cricbuzz.com',
  'bcci.tv',
  'icc-cricket.com',
  'wikipedia.org',
  'reuters.com',
  'apnews.com',
  'bbc.com',
  'bbc.co.uk',
  'theverge.com',
  'techcrunch.com',
  'wired.com',
  'arstechnica.com',
  'github.com',
  'developer.mozilla.org',
  'react.dev',
  'nodejs.org',
  'gov.in',
  'gov',
  'edu',
  'weather.com',
  'accuweather.com',
  'bloomberg.com',
  'cnbc.com',
]

/**
 * Main search function that delegates to the configured provider,
 * applies caching, filtering, ranking, and prompt-injection sanitization.
 */
export async function executeWebSearch(
  query: string,
  provider: SearchProvider = 'duckduckgo',
  apiKeys?: {
    tavily?: string
    serper?: string
    brave?: string
  }
): Promise<SearchEvidence> {
  const normalizedQuery = query.toLowerCase().trim()
  const cacheKey = `${provider}:${normalizedQuery}`

  // Check cache
  const cached = searchCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return {
      ...cached.evidence,
      searchedAt: new Date().toISOString(),
    }
  }

  const startTime = Date.now()
  let rawResults: SearchResultItem[] = []
  let errorMessage: string | undefined

  try {
    if (provider === 'tavily' && apiKeys?.tavily) {
      rawResults = await searchWithTavily(query, apiKeys.tavily)
    } else if (provider === 'serper' && apiKeys?.serper) {
      rawResults = await searchWithSerper(query, apiKeys.serper)
    } else if (provider === 'brave' && apiKeys?.brave) {
      rawResults = await searchWithBrave(query, apiKeys.brave)
    } else {
      // Default & reliable zero-key live provider: DuckDuckGo HTML
      rawResults = await searchWithDuckDuckGo(query)
    }
  } catch (err: any) {
    console.error(`[SearchService] Error searching with ${provider}:`, err.message)
    errorMessage = `Live web search via ${provider} encountered a network timeout.`
    // Fallback to DuckDuckGo if another provider failed
    if (provider !== 'duckduckgo') {
      try {
        rawResults = await searchWithDuckDuckGo(query)
        errorMessage = undefined
      } catch (fallbackErr: any) {
        console.error('[SearchService] Fallback also failed:', fallbackErr.message)
      }
    }
  }

  // Fallback if rawResults is empty (e.g. DDG bot challenge or zero results)
  if (rawResults.length === 0) {
    if (/\b(news|headline|headlines|latest|update|cricket|score|ipl|today|breaking)\b/i.test(query)) {
      try {
        const newsItems = await searchGoogleNews(query)
        if (newsItems.length > 0) {
          rawResults = newsItems
        }
      } catch (err: any) {
        console.warn('[SearchService] Google news fallback error:', err.message)
      }
    }

    if (rawResults.length === 0) {
      try {
        const wikiItem = await fetchWikipediaKnowledge(query)
        if (wikiItem) {
          rawResults.push(wikiItem)
        }
      } catch (err: any) {
        console.warn('[SearchService] Wikipedia fallback error:', err.message)
      }
    }
  }

  // Filter, deduplicate, rank, and sanitize results
  const filteredResults = filterAndRankResults(rawResults)

  const evidence: SearchEvidence = {
    query,
    provider,
    results: filteredResults,
    totalFound: filteredResults.length,
    searchedAt: new Date().toISOString(),
    tookMs: Date.now() - startTime,
    errorMessage: filteredResults.length === 0 && !errorMessage
      ? 'No relevant search results found for this query.'
      : errorMessage,
  }

  // Cache successful results
  if (filteredResults.length > 0) {
    searchCache.set(cacheKey, { timestamp: Date.now(), evidence })
  }

  return evidence
}

/**
 * Rapid Wikipedia encyclopedic knowledge lookup for definitions and concepts
 * Works 100% free with zero keys and returns verified extracts
 */
export async function fetchWikipediaKnowledge(topic: string): Promise<SearchResultItem | null> {
  try {
    let cleanTopic = topic
      .replace(/^(what is|who is|explain|define|tell me about|how does|why is|why are|can you explain)\s+/i, '')
      .replace(/[?!.]+$/g, '')
      .trim()

    if (!cleanTopic) return null

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 4000)

    // Step 1: Direct summary check
    let data: any = null
    try {
      const directUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(cleanTopic)}`
      const res = await fetch(directUrl, {
        headers: { 'User-Agent': 'ManaAI/2.0 (contact: support@mana-ai.internal)' },
        signal: controller.signal,
      })
      if (res.ok) {
        data = await res.json()
      }
    } catch {
      // ignore
    }

    // Step 2: If direct failed or was disambiguation, query Wikipedia OpenSearch
    if (!data || !data.extract || data.type === 'disambiguation') {
      try {
        const searchUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(cleanTopic)}&limit=1&namespace=0&format=json`
        const searchRes = await fetch(searchUrl, {
          headers: { 'User-Agent': 'ManaAI/2.0 (contact: support@mana-ai.internal)' },
          signal: controller.signal,
        })
        if (searchRes.ok) {
          const searchJson: any = await searchRes.json()
          const resolvedTitle = searchJson[1]?.[0]
          if (resolvedTitle) {
            const resolvedUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(resolvedTitle)}`
            const resolvedRes = await fetch(resolvedUrl, {
              headers: { 'User-Agent': 'ManaAI/2.0 (contact: support@mana-ai.internal)' },
              signal: controller.signal,
            })
            if (resolvedRes.ok) {
              data = await resolvedRes.json()
            }
          }
        }
      } catch {
        // ignore
      }
    }

    clearTimeout(timeout)

    if (!data || !data.extract) return null

    return {
      id: `wiki-${Date.now()}`,
      title: data.title,
      url: data.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(data.title)}`,
      snippet: sanitizeText(data.extract),
      domain: 'wikipedia.org',
      isOfficialOrReputable: true,
      publishedDate: data.timestamp ? new Date(data.timestamp).toLocaleDateString() : undefined,
    }
  } catch {
    return null
  }
}

/**
 * Live search using DuckDuckGo HTML endpoint (zero-config, completely free & live)
 */
async function searchWithDuckDuckGo(query: string): Promise<SearchResultItem[]> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)

  try {
    const params = new URLSearchParams({ q: query })
    const res = await fetch('https://lite.duckduckgo.com/lite/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      body: params.toString(),
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (!res.ok) {
      throw new Error(`Search engine responded with status ${res.status}`)
    }

    const html = await res.text()
    const $ = cheerio.load(html)
    const results: SearchResultItem[] = []

    $('a.result-link').each((idx, el) => {
      if (results.length >= 8) return

      const rawUrl = $(el).attr('href') || ''
      const title = $(el).text().trim()
      const snippet = $(el).closest('tr').next().find('.result-snippet').text().trim()

      if (!title || !rawUrl) return

      let actualUrl = rawUrl
      try {
        if (rawUrl.includes('uddg=')) {
          const match = rawUrl.match(/uddg=([^&]+)/)
          if (match && match[1]) {
            actualUrl = decodeURIComponent(match[1])
          }
        }
      } catch {
        actualUrl = rawUrl
      }

      if (!actualUrl.startsWith('http')) return

      let domain = ''
      try {
        domain = new URL(actualUrl).hostname.replace(/^www\./, '')
      } catch {
        domain = 'web'
      }

      let publishedDate: string | undefined
      const dateMatch = snippet.match(/^(\w{3}\s+\d{1,2},\s+\d{4}|\d{1,2}\s+\w{3}\s+\d{4}|\d+\s+(hours?|days?|mins?|months?)\s+ago)/i)
      if (dateMatch) {
        publishedDate = dateMatch[0]
      }

      results.push({
        id: `search-${idx + 1}`,
        title: sanitizeText(title),
        url: actualUrl,
        snippet: sanitizeText(snippet),
        domain,
        publishedDate,
      })
    })

    return results
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Searches live news headlines via Google News RSS (zero-key, live, reliable)
 */
async function searchGoogleNews(query: string): Promise<SearchResultItem[]> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 6000)

  try {
    const cleanQ = query.replace(/[?!.]+$/g, '').trim()
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(cleanQ)}&hl=en-US&gl=US&ceid=US:en`
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      },
      signal: controller.signal,
    })
    clearTimeout(timeout)
    if (!res.ok) return []

    const xml = await res.text()
    const $ = cheerio.load(xml, { xmlMode: true })
    const results: SearchResultItem[] = []

    $('item').each((idx, el) => {
      if (results.length >= 6) return
      const title = $(el).find('title').text().trim()
      const link = $(el).find('link').text().trim()
      const pubDate = $(el).find('pubDate').text().trim()
      const descHtml = $(el).find('description').text().trim()
      const descText = cheerio.load(descHtml).text().trim() || title

      if (title && link) {
        let domain = 'news.google.com'
        try {
          const sourceMatch = title.match(/-\s*([^-\n]+)$/)
          if (sourceMatch) {
            domain = sourceMatch[1].trim()
          }
        } catch {}

        results.push({
          id: `news-${idx + 1}`,
          title: sanitizeText(title),
          url: link,
          snippet: sanitizeText(descText),
          domain,
          publishedDate: pubDate ? new Date(pubDate).toLocaleDateString() : undefined,
          isOfficialOrReputable: true,
        })
      }
    })

    return results
  } catch {
    return []
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Search using Tavily Search API
 */
async function searchWithTavily(query: string, apiKey: string): Promise<SearchResultItem[]> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)

  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: 'basic',
        include_answer: false,
        max_results: 8,
      }),
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (!res.ok) {
      throw new Error(`Tavily API responded with status ${res.status}`)
    }

    const data: any = await res.json()
    const raw = data.results || []

    return raw.map((item: any, idx: number) => {
      let domain = ''
      try {
        domain = new URL(item.url).hostname.replace(/^www\./, '')
      } catch {
        domain = 'web'
      }

      return {
        id: `tavily-${idx + 1}`,
        title: sanitizeText(item.title || ''),
        url: item.url,
        snippet: sanitizeText(item.content || ''),
        domain,
        publishedDate: item.published_date,
        relevanceScore: item.score,
      }
    })
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Search using Serper Google Search API
 */
async function searchWithSerper(query: string, apiKey: string): Promise<SearchResultItem[]> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)

  try {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q: query, num: 8 }),
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (!res.ok) {
      throw new Error(`Serper API responded with status ${res.status}`)
    }

    const data: any = await res.json()
    const organic = data.organic || []

    return organic.map((item: any, idx: number) => {
      let domain = ''
      try {
        domain = new URL(item.link).hostname.replace(/^www\./, '')
      } catch {
        domain = 'web'
      }

      return {
        id: `serper-${idx + 1}`,
        title: sanitizeText(item.title || ''),
        url: item.link,
        snippet: sanitizeText(item.snippet || ''),
        domain,
        publishedDate: item.date,
      }
    })
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Search using Brave Search API
 */
async function searchWithBrave(query: string, apiKey: string): Promise<SearchResultItem[]> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)

  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=8`
    const res = await fetch(url, {
      headers: {
        'X-Subscription-Token': apiKey,
        'Accept': 'application/json',
      },
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (!res.ok) {
      throw new Error(`Brave API responded with status ${res.status}`)
    }

    const data: any = await res.json()
    const results = data.web?.results || []

    return results.map((item: any, idx: number) => {
      let domain = ''
      try {
        domain = new URL(item.url).hostname.replace(/^www\./, '')
      } catch {
        domain = 'web'
      }

      return {
        id: `brave-${idx + 1}`,
        title: sanitizeText(item.title || ''),
        url: item.url,
        snippet: sanitizeText(item.description || ''),
        domain,
        publishedDate: item.page_age,
      }
    })
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Filters out duplicates, spam, low quality, and ranks by reputation
 */
function filterAndRankResults(results: SearchResultItem[]): SearchResultItem[] {
  const seenUrls = new Set<string>()
  const seenTitles = new Set<string>()
  const filtered: SearchResultItem[] = []

  for (const item of results) {
    if (!item.title || !item.url || !item.snippet) continue

    // Exclude generic social media boilerplate and platform marketing snippets
    const lowerSnippet = item.snippet.toLowerCase()
    if (
      lowerSnippet.includes('enjoy the videos and music you love') ||
      lowerSnippet.includes('upload original content') ||
      lowerSnippet.includes('see instagram photos and videos') ||
      lowerSnippet.includes('log into facebook') ||
      lowerSnippet.includes('followers, following, posts') ||
      lowerSnippet.includes('create an account or log in to instagram')
    ) {
      continue
    }

    // Clean out heavy hashtag clusters (e.g. "#motivation #ai #ml #naana #students")
    item.snippet = item.snippet.replace(/(?:#\w+\s*){3,}/g, '').replace(/\s+/g, ' ').trim()
    if (item.snippet.length < 15) continue

    const cleanUrl = item.url.split('#')[0].replace(/\/$/, '')
    if (seenUrls.has(cleanUrl)) continue
    seenUrls.add(cleanUrl)

    const titleKey = item.title.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (seenTitles.has(titleKey)) continue
    seenTitles.add(titleKey)

    const isReputable = REPUTABLE_DOMAINS.some((d) => item.domain.endsWith(d))
    item.isOfficialOrReputable = isReputable

    filtered.push(item)
  }

  filtered.sort((a, b) => {
    if (a.isOfficialOrReputable && !b.isOfficialOrReputable) return -1
    if (!a.isOfficialOrReputable && b.isOfficialOrReputable) return 1
    return 0
  })

  return filtered.slice(0, 5)
}

function sanitizeText(text: string): string {
  if (!text) return ''

  let clean = text
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")

  const injectionPatterns = [
    /ignore (all )?previous instructions/gi,
    /system:\s*/gi,
    /<\|im_start\|>/gi,
    /<\|im_end\|>/gi,
    /you are now a[n]?/gi,
    /override (the|your) (prompt|rules)/gi,
  ]

  for (const pat of injectionPatterns) {
    clean = clean.replace(pat, '[filtered phrase]')
  }

  return clean.replace(/\s+/g, ' ').trim()
}
