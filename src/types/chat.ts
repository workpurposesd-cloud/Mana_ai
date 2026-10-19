export type SearchMode = 'auto' | 'always' | 'never'

export interface SearchResultItem {
  id: string
  title: string
  url: string
  snippet: string
  domain: string
  publishedDate?: string
  isOfficialOrReputable?: boolean
}

export interface SearchEvidence {
  query: string
  provider: string
  results: SearchResultItem[]
  totalFound: number
  searchedAt: string
  tookMs: number
  errorMessage?: string
}

export interface IntentInfo {
  needsSearch: boolean
  refinedQuery: string
  reason: string
  category: string
  isDetailRequested: boolean
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

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  mode?: ChatMode
  image?: GeneratedImageMetadata
  video?: VideoJobMetadata
  isGeneratingMedia?: boolean
  mediaError?: string
  isStreaming?: boolean
  isSearchPerformed?: boolean
  searchEvidence?: SearchEvidence
  intent?: IntentInfo
  searchStatus?: string
  searchStep?: string
  isSearching?: boolean
  error?: string
  feedback?: 'thumbs_up' | 'thumbs_down'
  reasoningMode?: 'fast' | 'thinking'
  documentsUsed?: string[]
}

export interface DocumentMetadata {
  id: string
  title: string
  originalName: string
  mimeType: string
  sizeBytes: number
  uploadedAt: string
  chunkCount: number
}

export interface MemoryItem {
  id: string
  category: 'personal' | 'preference' | 'correction' | 'project'
  key: string
  value: string
  createdAt: string
  updatedAt: string
}

export interface ChatSessionSummary {
  id: string
  userId: string
  title: string
  createdAt: string
  updatedAt: string
}

export interface AuthUser {
  id: string
  name: string
  email: string
  createdAt?: string
  geminiApiKey?: string
}

export type VoiceLanguage = 'en-US' | 'en-IN' | 'te-IN' | 'hi-IN'

export interface VoiceSettings {
  voiceMode: boolean
  language: VoiceLanguage
  rate: number
  pitch: number
  voiceURI?: string
}

export interface AppConfig {
  aiProvider: 'gemini' | 'openai' | 'groq' | 'builtin'
  searchProvider: 'duckduckgo' | 'tavily' | 'serper' | 'brave'
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
  emojiDensity: 'concise' | 'moderate' | 'minimal'
  reasoningMode?: 'fast' | 'thinking'
  memoryEnabled?: boolean
  voiceSettings?: VoiceSettings
}

