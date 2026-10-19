export type AIProvider = 'gemini' | 'openai' | 'groq' | 'builtin'
export type SearchProvider = 'duckduckgo' | 'tavily' | 'serper' | 'brave'
export type SearchMode = 'auto' | 'always' | 'never'
export type EmojiDensity = 'concise' | 'moderate' | 'minimal'

export type VoiceLanguage = 'en-US' | 'en-IN' | 'te-IN' | 'hi-IN'

export interface VoiceSettings {
  voiceMode: boolean
  language: VoiceLanguage
  rate: number
  pitch: number
  voiceURI?: string
}

export type ChatMode = 'chat' | 'image' | 'video'

export interface GeneratedImageMetadata {
  url: string
  prompt: string
  revisedPrompt?: string
  aspectRatio: '1:1' | '16:9' | '9:16'
  quality: 'standard' | 'hd'
  provider: string
  width?: number
  height?: number
  createdAt: string
}

export interface ProviderRestrictions {
  name: string
  pricing: string
  durationLimit: string
  resolution: string
  docsUrl: string
  supportedAspectRatios: string[]
}

export interface VideoJobMetadata {
  jobId: string
  prompt: string
  provider: 'luma' | 'replicate' | 'runway' | 'pollinations'
  status: 'queued' | 'processing' | 'completed' | 'failed'
  progress: number
  videoUrl?: string
  thumbnailUrl?: string
  aspectRatio: '16:9' | '9:16' | '1:1'
  duration: number
  error?: string
  externalId?: string
  createdAt: string
  updatedAt: string
  providerRestrictions?: ProviderRestrictions
}

export interface AppConfig {
  aiProvider: AIProvider
  searchProvider: SearchProvider
  searchMode: SearchMode
  geminiApiKey?: string
  openaiApiKey?: string
  groqApiKey?: string
  tavilyApiKey?: string
  serperApiKey?: string
  braveApiKey?: string
  lumaApiKey?: string
  replicateApiKey?: string
  runwayApiKey?: string
  imageProvider?: 'openai' | 'pollinations'
  videoProvider?: 'luma' | 'replicate' | 'runway'
  modelName: string
  systemPrompt: string
  maxShortSentences: number
  emojiDensity: EmojiDensity
  reasoningMode?: 'fast' | 'thinking'
  memoryEnabled?: boolean
  voiceSettings?: VoiceSettings
}

export interface SearchResultItem {
  id: string
  title: string
  url: string
  snippet: string
  domain: string
  publishedDate?: string
  relevanceScore?: number
  isOfficialOrReputable?: boolean
}

export interface SearchEvidence {
  query: string
  provider: SearchProvider
  results: SearchResultItem[]
  totalFound: number
  searchedAt: string
  tookMs: number
  errorMessage?: string
}

export interface IntentClassification {
  needsSearch: boolean
  refinedQuery: string
  reason: string
  category: 'news' | 'sports' | 'weather' | 'pricing' | 'tech_docs' | 'announcements' | 'time_sensitive' | 'general_knowledge' | 'coding' | 'creative' | 'other'
  isDetailRequested: boolean
}

export interface MemoryItem {
  id: string
  category: 'personal' | 'preference' | 'correction' | 'project'
  key: string
  value: string
  createdAt: string
  updatedAt: string
}

export interface FeedbackItem {
  id: string
  messageId: string
  prompt: string
  response: string
  rating: 'thumbs_up' | 'thumbs_down'
  comment?: string
  timestamp: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  mode?: ChatMode
  image?: GeneratedImageMetadata
  video?: VideoJobMetadata
  isGeneratingMedia?: boolean
  mediaError?: string
  searchEvidence?: SearchEvidence
  isSearchPerformed?: boolean
  searchStatus?: string
  tokensUsed?: number
  feedback?: 'thumbs_up' | 'thumbs_down'
  documentsUsed?: string[]
  reasoningMode?: 'fast' | 'thinking'
  toolsUsed?: string[]
}

export interface StreamEvent {
  type: 'search_start' | 'search_status' | 'search_results' | 'token' | 'memory_saved' | 'done' | 'error'
  data: any
}
