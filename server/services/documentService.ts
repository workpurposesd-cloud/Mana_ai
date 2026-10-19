import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DATA_DIR = path.resolve(__dirname, '../data')
const DOCS_DIR = path.join(DATA_DIR, 'documents')
const INDEX_FILE = path.join(DOCS_DIR, 'index.json')

export interface DocumentChunk {
  id: string
  docId: string
  docTitle: string
  chunkIndex: number
  text: string
  tokensApprox: number
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

export interface DocumentSearchResult {
  chunk: DocumentChunk
  score: number
  docTitle: string
}

class DocumentService {
  private documents: DocumentMetadata[] = []
  private chunks: DocumentChunk[] = []

  constructor() {
    this.ensureDirs()
    this.loadIndex()
  }

  private ensureDirs() {
    if (!fs.existsSync(DOCS_DIR)) {
      fs.mkdirSync(DOCS_DIR, { recursive: true })
    }
  }

  private loadIndex() {
    try {
      if (fs.existsSync(INDEX_FILE)) {
        const raw = fs.readFileSync(INDEX_FILE, 'utf-8')
        const data = JSON.parse(raw)
        this.documents = data.documents || []
        this.chunks = data.chunks || []
      } else {
        this.documents = []
        this.chunks = []
        this.saveIndex()
      }
    } catch (err) {
      console.warn('[DocumentService] Failed to load documents index:', err)
      this.documents = []
      this.chunks = []
    }
  }

  private saveIndex() {
    try {
      this.ensureDirs()
      fs.writeFileSync(
        INDEX_FILE,
        JSON.stringify(
          {
            documents: this.documents,
            chunks: this.chunks,
          },
          null,
          2
        ),
        'utf-8'
      )
    } catch (err) {
      console.error('[DocumentService] Failed to save documents index:', err)
    }
  }

  /**
   * Split text into passages with overlap for contextual retrieval
   */
  private chunkText(docId: string, docTitle: string, fullText: string, chunkSize = 500, overlap = 100): DocumentChunk[] {
    const clean = fullText.replace(/\r\n/g, '\n').trim()
    if (!clean) return []

    const chunks: DocumentChunk[] = []
    let start = 0
    let index = 0

    while (start < clean.length) {
      let end = start + chunkSize
      if (end >= clean.length) {
        end = clean.length
      } else {
        // Try to break at a paragraph or sentence boundary
        const newlinePos = clean.lastIndexOf('\n', end)
        const periodPos = clean.lastIndexOf('. ', end)
        if (newlinePos > start + chunkSize / 2) {
          end = newlinePos + 1
        } else if (periodPos > start + chunkSize / 2) {
          end = periodPos + 2
        }
      }

      const chunkContent = clean.slice(start, end).trim()
      if (chunkContent.length > 20) {
        chunks.push({
          id: `${docId}-chunk-${index}`,
          docId,
          docTitle,
          chunkIndex: index + 1,
          text: chunkContent,
          tokensApprox: Math.ceil(chunkContent.length / 4),
        })
        index++
      }

      if (end >= clean.length) break
      start = end - overlap
      if (start < 0) start = 0
    }

    return chunks
  }

  /**
   * Add text-based or decoded document to the knowledge store
   */
  public async addDocument(params: {
    title: string
    originalName: string
    mimeType: string
    content: string | Buffer
  }): Promise<DocumentMetadata> {
    const docId = `doc-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`
    let text = ''

    if (Buffer.isBuffer(params.content)) {
      if (params.mimeType.includes('pdf')) {
        try {
          // Dynamic import of pdf-parse if available
          const pdfParse = (await import('pdf-parse')).default as any
          const data = await pdfParse(params.content)
          text = data.text || ''
        } catch {
          // Fallback: extract ASCII strings from PDF buffer
          text = params.content.toString('latin1').replace(/[^\x20-\x7E\n]/g, ' ')
        }
      } else {
        text = params.content.toString('utf-8')
      }
    } else {
      text = params.content
    }

    const docChunks = this.chunkText(docId, params.title, text)

    const meta: DocumentMetadata = {
      id: docId,
      title: params.title,
      originalName: params.originalName,
      mimeType: params.mimeType,
      sizeBytes: typeof params.content === 'string' ? Buffer.byteLength(params.content) : params.content.length,
      uploadedAt: new Date().toISOString(),
      chunkCount: docChunks.length,
    }

    this.documents.unshift(meta)
    this.chunks.push(...docChunks)
    this.saveIndex()

    return meta
  }

  public listDocuments(): DocumentMetadata[] {
    return [...this.documents]
  }

  public deleteDocument(docId: string): boolean {
    const initialLen = this.documents.length
    this.documents = this.documents.filter((d) => d.id !== docId)
    this.chunks = this.chunks.filter((c) => c.docId !== docId)

    if (this.documents.length !== initialLen) {
      this.saveIndex()
      return true
    }
    return false
  }

  public clearAllDocuments(): void {
    this.documents = []
    this.chunks = []
    this.saveIndex()
  }

  /**
   * BM25-style keyword search over document chunks
   */
  public searchKnowledge(query: string, limit = 4): DocumentSearchResult[] {
    if (!this.chunks.length) return []

    const queryTerms = query
      .toLowerCase()
      .split(/[^a-z0-9_-]+/)
      .filter((term) => term.length >= 3)

    if (!queryTerms.length) return []

    const scored: DocumentSearchResult[] = []

    for (const chunk of this.chunks) {
      const chunkLower = chunk.text.toLowerCase()
      let score = 0

      for (const term of queryTerms) {
        if (chunkLower.includes(term)) {
          // Count occurrences
          const regex = new RegExp(`\\b${term}\\b`, 'g')
          const matches = chunkLower.match(regex)
          const occurrences = matches ? matches.length : 1
          score += 1 + occurrences * 0.5
        }
      }

      if (score > 0) {
        scored.push({
          chunk,
          score,
          docTitle: chunk.docTitle,
        })
      }
    }

    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, limit)
  }
}

export const documentService = new DocumentService()
