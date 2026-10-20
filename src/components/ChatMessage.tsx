import React, { useState } from 'react'
import { Copy, Check, ExternalLink, Globe, ChevronDown, ChevronUp, ThumbsUp, ThumbsDown, Volume2, VolumeX, AlertCircle, RefreshCw, Settings } from 'lucide-react'
import { Message, GeneratedImageMetadata } from '../types/chat'
import { ManaLogo } from './ManaLogo'
import { GeneratedImageCard } from './GeneratedImageCard'
import { GeneratedVideoCard } from './GeneratedVideoCard'

interface ChatMessageProps {
  message: Message
  onFeedback?: (messageId: string, rating: 'thumbs_up' | 'thumbs_down', comment?: string) => void
  isSpeakingMessage?: boolean
  onSpeakMessage?: (messageId: string, content: string) => void
  onStopSpeaking?: () => void
  onPreviewImage?: (image: GeneratedImageMetadata) => void
  onRegenerateImage?: (prompt: string, aspectRatio?: string, quality?: string) => void
  onRegenerateVideo?: (prompt: string, aspectRatio?: string, duration?: number) => void
  onRegenerateChat?: (messageId: string) => void
  onOpenSettings?: () => void
}

const ChatMessageComponent: React.FC<ChatMessageProps> = ({
  message,
  onFeedback,
  isSpeakingMessage,
  onSpeakMessage,
  onStopSpeaking,
  onPreviewImage,
  onRegenerateImage,
  onRegenerateVideo,
  onRegenerateChat,
  onOpenSettings,
}) => {
  const isUser = message.role === 'user'
  const [showSources, setShowSources] = useState(false)
  const [feedbackGiven, setFeedbackGiven] = useState<'thumbs_up' | 'thumbs_down' | null>(
    message.feedback || null
  )
  const [showCorrectionInput, setShowCorrectionInput] = useState(false)
  const [correctionText, setCorrectionText] = useState('')
  const [copiedAnswer, setCopiedAnswer] = useState(false)

  const handleFeedback = (rating: 'thumbs_up' | 'thumbs_down') => {
    setFeedbackGiven(rating)
    if (rating === 'thumbs_down') {
      setShowCorrectionInput(true)
    }
    if (onFeedback) {
      onFeedback(message.id, rating)
    }
  }

  const handleSubmitCorrection = (e: React.FormEvent) => {
    e.preventDefault()
    if (!correctionText.trim()) return
    if (onFeedback) {
      onFeedback(message.id, 'thumbs_down', correctionText.trim())
    }
    setShowCorrectionInput(false)
  }

  const handleCopyAnswer = () => {
    navigator.clipboard.writeText(message.content)
    setCopiedAnswer(true)
    setTimeout(() => setCopiedAnswer(false), 2000)
  }

  return (
    <div className={`chatgpt-message-row ${message.role}`}>
      {!isUser && (
        <div className="mana-avatar-badge">
          <ManaLogo size={20} />
        </div>
      )}

      <div className="chatgpt-bubble">
        {/* Search indicator when searching */}
        {message.isSearching && (
          <div className="chatgpt-search-pill running">
            <span className="spinner-dot" />
            <span>Searching the web...</span>
          </div>
        )}

        {/* Subtle Typing Indicator while generating and waiting for first token */}
        {!isUser && message.isStreaming && !message.content && !message.isSearching && (
          <div className="mana-typing-indicator" aria-label="Thinking...">
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="typing-dot" />
          </div>
        )}

        {/* Metadata badges (Reasoning mode & Knowledge documents cited & Speed) */}
        {!isUser && (message.reasoningMode === 'thinking' || (message.documentsUsed && message.documentsUsed.length > 0) || message.timings?.ttftMs) && (
          <div className="mana-meta-badges">
            {message.timings?.ttftMs && (
              <span
                className="mana-meta-badge timing"
                title={`Time to first token: ${message.timings.ttftMs}ms${message.timings.totalMs ? ` | Total: ${message.timings.totalMs}ms` : ''}`}
              >
                ⚡ {message.timings.ttftMs}ms
              </span>
            )}
            {message.reasoningMode === 'thinking' && (
              <span className="mana-meta-badge thinking">
                🧠 Deep Reasoning
              </span>
            )}
            {message.documentsUsed && message.documentsUsed.length > 0 && (
              <span className="mana-meta-badge docs">
                📄 {message.documentsUsed.length} {message.documentsUsed.length === 1 ? 'doc' : 'docs'} cited: {message.documentsUsed.join(', ')}
              </span>
            )}
          </div>
        )}

        {/* Verified sources pill when complete */}
        {message.searchEvidence && message.searchEvidence.results.length > 0 && (
          <div className="chatgpt-sources-wrapper">
            <button
              className="chatgpt-sources-toggle"
              onClick={() => setShowSources(!showSources)}
            >
              <Globe size={14} />
              <span>{message.searchEvidence.results.length} sources</span>
              {showSources ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>

            {showSources && (
              <div className="chatgpt-sources-dropdown">
                {message.searchEvidence.results.map((item, idx) => (
                  <a
                    key={idx}
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="chatgpt-source-link"
                  >
                    <span className="source-domain-tag">{item.domain}</span>
                    <span className="source-title-tag">{item.title}</span>
                    <ExternalLink size={11} style={{ opacity: 0.6, flexShrink: 0 }} />
                  </a>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Media Loading State */}
        {message.isGeneratingMedia && (
          <div className="mana-media-generating-banner">
            <div className="pulsing-spinner-ring">
              <span className="spinner-core" />
            </div>
            <div className="generating-text-group">
              <span className="generating-title">
                {message.mode === 'video'
                  ? 'Initializing Video Generation...'
                  : 'Generating AI Artwork...'}
              </span>
              <span className="generating-sub">
                {message.mode === 'video'
                  ? 'Contacting GPU rendering cluster'
                  : 'Synthesizing high-resolution pixels from your prompt'}
              </span>
            </div>
          </div>
        )}

        {/* Media Error State */}
        {message.mediaError && (
          <div className="mana-media-error-box">
            <div className="error-title-row">
              <AlertCircle size={16} color="#ef4444" />
              <span>Generation Failed</span>
            </div>
            <p className="error-msg-text">{message.mediaError}</p>
            <div className="media-error-actions">
              {onRegenerateImage && message.mode === 'image' && (
                <button
                  type="button"
                  className="media-retry-btn"
                  onClick={() => onRegenerateImage(message.content)}
                >
                  <RefreshCw size={13} />
                  <span>Retry Image</span>
                </button>
              )}
              {onRegenerateVideo && message.mode === 'video' && (
                <button
                  type="button"
                  className="media-retry-btn"
                  onClick={() => onRegenerateVideo(message.content)}
                >
                  <RefreshCw size={13} />
                  <span>Retry Video</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* AI Generated Image Card */}
        {message.image && (
          <GeneratedImageCard
            image={message.image}
            onPreview={(img) => onPreviewImage?.(img)}
            onRegenerate={onRegenerateImage}
          />
        )}

        {/* AI Generated Video Card */}
        {message.video && (
          <GeneratedVideoCard
            video={message.video}
            onRegenerate={onRegenerateVideo}
            onOpenSettings={onOpenSettings}
          />
        )}

        {/* Message Content */}
        {message.content && (
          <div className="chatgpt-text-body">
            <FormattedMarkdown content={message.content} />
            {message.isStreaming && <span className="streaming-cursor" />}
          </div>
        )}

        {/* Assistant Action Bar: Speak Aloud, Copy, Thumbs Up / Down */}
        {!isUser && !message.isStreaming && message.content && (
          <div className="chatgpt-message-actions">
            {/* Read aloud speaker button */}
            <button
              className={`feedback-btn speech-btn ${isSpeakingMessage ? 'active-speaking' : ''}`}
              onClick={() => {
                if (isSpeakingMessage) {
                  onStopSpeaking?.()
                } else {
                  onSpeakMessage?.(message.id, message.content)
                }
              }}
              title={isSpeakingMessage ? 'Stop speaking (Click to mute)' : 'Hear answer aloud'}
              id={`btn-speak-${message.id}`}
            >
              {isSpeakingMessage ? <VolumeX size={13} color="#38bdf8" /> : <Volume2 size={13} />}
            </button>

            {/* Copy button */}
            <button
              className="feedback-btn"
              onClick={handleCopyAnswer}
              title="Copy message"
            >
              {copiedAnswer ? <Check size={13} color="#4ade80" /> : <Copy size={13} />}
            </button>

            {/* Regenerate Chat Response */}
            {onRegenerateChat && (
              <button
                className="feedback-btn"
                onClick={() => onRegenerateChat(message.id)}
                title="Regenerate this answer"
              >
                <RefreshCw size={13} />
              </button>
            )}

            {/* Feedback Thumbs */}
            <button
              className={`feedback-btn ${feedbackGiven === 'thumbs_up' ? 'active-up' : ''}`}
              onClick={() => handleFeedback('thumbs_up')}
              title="Helpful response"
            >
              <ThumbsUp size={13} />
            </button>
            <button
              className={`feedback-btn ${feedbackGiven === 'thumbs_down' ? 'active-down' : ''}`}
              onClick={() => handleFeedback('thumbs_down')}
              title="Not helpful / Needs improvement"
            >
              <ThumbsDown size={13} />
            </button>

            {/* Optional Correction Input */}
            {showCorrectionInput && (
              <form onSubmit={handleSubmitCorrection} className="correction-inline-form">
                <input
                  type="text"
                  className="correction-input"
                  placeholder="How can Mana improve this answer?"
                  value={correctionText}
                  onChange={(e) => setCorrectionText(e.target.value)}
                  autoFocus
                />
                <button type="submit" className="correction-submit-btn">
                  Save
                </button>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export const ChatMessage = React.memo<ChatMessageProps>(
  ChatMessageComponent,
  (prevProps, nextProps) => {
    return (
      prevProps.message.id === nextProps.message.id &&
      prevProps.message.content === nextProps.message.content &&
      prevProps.message.isStreaming === nextProps.message.isStreaming &&
      prevProps.message.isSearching === nextProps.message.isSearching &&
      prevProps.message.searchStatus === nextProps.message.searchStatus &&
      prevProps.message.feedback === nextProps.message.feedback &&
      prevProps.isSpeakingMessage === nextProps.isSpeakingMessage &&
      prevProps.message.searchEvidence === nextProps.message.searchEvidence &&
      prevProps.message.video === nextProps.message.video &&
      prevProps.message.image === nextProps.message.image &&
      prevProps.message.isGeneratingMedia === nextProps.message.isGeneratingMedia &&
      prevProps.message.mediaError === nextProps.message.mediaError
    )
  }
)

/**
 * Lightweight markdown parser for headings, code blocks, lists, links, and bold text
 */
const FormattedMarkdown: React.FC<{ content: string }> = ({ content }) => {
  if (!content) return null

  // Fast-path: single text block when no fenced code blocks exist
  if (!content.includes('```')) {
    return <TextMarkdownBlock text={content} />
  }

  const parts: React.ReactNode[] = []
  const codeBlockRegex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = codeBlockRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push(
        <TextMarkdownBlock key={`text-${lastIndex}`} text={content.slice(lastIndex, match.index)} />
      )
    }

    const language = match[1] || 'bash'
    const code = match[2]
    parts.push(<CodeBlock key={`code-${match.index}`} language={language} code={code} />)
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < content.length) {
    parts.push(<TextMarkdownBlock key={`text-${lastIndex}`} text={content.slice(lastIndex)} />)
  }

  return <div>{parts}</div>
}

const CodeBlock: React.FC<{ language: string; code: string }> = ({ language, code }) => {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="chatgpt-code-block">
      <div className="code-header">
        <span>{language}</span>
        <button className="code-copy-btn" onClick={handleCopy}>
          {copied ? <Check size={12} color="#4ade80" /> : <Copy size={12} />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre>
        <code>{code.trim()}</code>
      </pre>
    </div>
  )
}

const TextMarkdownBlock: React.FC<{ text: string }> = ({ text }) => {
  // Fast path for plain single-line text without markdown syntax
  if (!text.includes('\n') && !text.includes('*') && !text.includes('`') && !text.includes('[') && !text.includes('#')) {
    return <p style={{ margin: '0.35rem 0' }}>{text}</p>
  }

  const paragraphs = text.split(/\n\n+/)

  return (
    <>
      {paragraphs.map((para, pIdx) => {
        const trimmed = para.trim()
        if (!trimmed) return null

        // Headings
        if (trimmed.startsWith('#### ')) {
          return <h4 key={pIdx}>{renderInlineMarkdown(trimmed.replace(/^####\s+/, ''))}</h4>
        }
        if (trimmed.startsWith('### ')) {
          return <h3 key={pIdx}>{renderInlineMarkdown(trimmed.replace(/^###\s+/, ''))}</h3>
        }
        if (trimmed.startsWith('## ')) {
          return <h2 key={pIdx}>{renderInlineMarkdown(trimmed.replace(/^##\s+/, ''))}</h2>
        }
        if (trimmed.startsWith('# ')) {
          return <h1 key={pIdx}>{renderInlineMarkdown(trimmed.replace(/^#\s+/, ''))}</h1>
        }

        // Blockquotes
        if (trimmed.startsWith('>')) {
          const quoteLines = trimmed.split('\n').map((l) => l.replace(/^>\s*/, ''))
          return (
            <blockquote
              key={pIdx}
              style={{
                borderLeft: '3px solid var(--border-active, #171717)',
                paddingLeft: '0.8rem',
                margin: '0.6rem 0',
                color: 'var(--text-muted, #6B7280)',
                fontStyle: 'italic',
              }}
            >
              {quoteLines.map((ql, qIdx) => (
                <React.Fragment key={qIdx}>
                  {renderInlineMarkdown(ql)}
                  {qIdx < quoteLines.length - 1 && <br />}
                </React.Fragment>
              ))}
            </blockquote>
          )
        }

        // Markdown Table: lines starting and ending with |
        const rawLines = trimmed.split('\n').map((l) => l.trim())
        const isTable =
          rawLines.length >= 2 &&
          rawLines[0].startsWith('|') &&
          rawLines[0].endsWith('|') &&
          rawLines[1].includes('---')

        if (isTable) {
          const headerCells = rawLines[0]
            .split('|')
            .slice(1, -1)
            .map((c) => c.trim())
          const dataRows = rawLines
            .slice(2)
            .filter((l) => l.startsWith('|') && l.endsWith('|'))
            .map((row) =>
              row
                .split('|')
                .slice(1, -1)
                .map((c) => c.trim())
            )

          return (
            <div
              key={pIdx}
              style={{
                overflowX: 'auto',
                margin: '0.8rem 0',
                border: '1px solid var(--border-subtle, #e5e7eb)',
                borderRadius: '8px',
              }}
            >
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: '0.9rem',
                }}
              >
                <thead>
                  <tr style={{ background: 'var(--bg-hover, #f1f1f1)' }}>
                    {headerCells.map((h, hIdx) => (
                      <th
                        key={hIdx}
                        style={{
                          padding: '8px 12px',
                          textAlign: 'left',
                          borderBottom: '1px solid var(--border-subtle, #e5e7eb)',
                          fontWeight: 600,
                          color: 'var(--text-main, #171717)',
                        }}
                      >
                        {renderInlineMarkdown(h)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dataRows.map((row, rIdx) => (
                    <tr
                      key={rIdx}
                      style={{
                        borderBottom:
                          rIdx < dataRows.length - 1
                            ? '1px solid var(--border-subtle, #e5e7eb)'
                            : 'none',
                      }}
                    >
                      {row.map((cell, cIdx) => (
                        <td
                          key={cIdx}
                          style={{
                            padding: '8px 12px',
                            color: 'var(--text-main, #171717)',
                          }}
                        >
                          {renderInlineMarkdown(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }

        // Parse individual lines within the paragraph to handle mixed lists cleanly
        const parsedNodes: React.ReactNode[] = []
        let currentBulletItems: React.ReactNode[] = []
        let currentNumberedItems: React.ReactNode[] = []

        const flushLists = (keyPrefix: string) => {
          if (currentBulletItems.length > 0) {
            parsedNodes.push(
              <ul key={`${keyPrefix}-ul`} style={{ margin: '0.4rem 0', paddingLeft: '1.4rem' }}>
                {currentBulletItems.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            )
            currentBulletItems = []
          }
          if (currentNumberedItems.length > 0) {
            parsedNodes.push(
              <ol key={`${keyPrefix}-ol`} style={{ margin: '0.4rem 0', paddingLeft: '1.4rem' }}>
                {currentNumberedItems.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ol>
            )
            currentNumberedItems = []
          }
        }

        const lines = trimmed.split('\n')
        lines.forEach((line, lIdx) => {
          const lTrim = line.trim()
          if (/^[-•*]\s+/.test(lTrim)) {
            if (currentNumberedItems.length > 0) flushLists(`line-${lIdx}`)
            currentBulletItems.push(renderInlineMarkdown(lTrim.replace(/^[-•*]\s+/, '')))
          } else if (/^\d+\.\s+/.test(lTrim)) {
            if (currentBulletItems.length > 0) flushLists(`line-${lIdx}`)
            currentNumberedItems.push(renderInlineMarkdown(lTrim.replace(/^\d+\.\s+/, '')))
          } else {
            flushLists(`line-${lIdx}`)
            if (lTrim.length > 0) {
              parsedNodes.push(
                <p key={`p-${lIdx}`} style={{ margin: '0.35rem 0' }}>
                  {renderInlineMarkdown(line)}
                </p>
              )
            }
          }
        })
        flushLists('end')

        return <React.Fragment key={pIdx}>{parsedNodes}</React.Fragment>
      })}
    </>
  )
}

function renderInlineMarkdown(str: string): React.ReactNode[] {
  const elements: React.ReactNode[] = []
  // Matches links, inline code, bold, italics
  const regex = /(\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*)/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(str)) !== null) {
    if (match.index > lastIndex) {
      elements.push(str.slice(lastIndex, match.index))
    }

    if (match[2] && match[3]) {
      // Link
      elements.push(
        <a key={`link-${match.index}`} href={match[3]} target="_blank" rel="noopener noreferrer">
          {match[2]}
          <ExternalLink size={10} style={{ display: 'inline', marginLeft: 3, verticalAlign: 'baseline' }} />
        </a>
      )
    } else if (match[4]) {
      // Inline Code
      elements.push(<code key={`code-${match.index}`}>{match[4]}</code>)
    } else if (match[5]) {
      // Bold
      elements.push(<strong key={`bold-${match.index}`}>{match[5]}</strong>)
    } else if (match[6]) {
      // Italic
      elements.push(<em key={`italic-${match.index}`}>{match[6]}</em>)
    }

    lastIndex = match.index + match[0].length
  }

  if (lastIndex < str.length) {
    elements.push(str.slice(lastIndex))
  }

  return elements
}
