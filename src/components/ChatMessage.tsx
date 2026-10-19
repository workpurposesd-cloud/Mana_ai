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
  onOpenSettings?: () => void
}

export const ChatMessage: React.FC<ChatMessageProps> = ({
  message,
  onFeedback,
  isSpeakingMessage,
  onSpeakMessage,
  onStopSpeaking,
  onPreviewImage,
  onRegenerateImage,
  onRegenerateVideo,
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

        {/* Metadata badges (Reasoning mode & Knowledge documents cited) */}
        {!isUser && (message.reasoningMode === 'thinking' || (message.documentsUsed && message.documentsUsed.length > 0)) && (
          <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
            {message.reasoningMode === 'thinking' && (
              <span
                style={{
                  fontSize: '0.72rem',
                  padding: '2px 8px',
                  borderRadius: '12px',
                  background: 'rgba(139, 92, 246, 0.15)',
                  border: '1px solid rgba(139, 92, 246, 0.35)',
                  color: '#c4b5fd',
                  fontWeight: 500,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                🧠 Deep Reasoning
              </span>
            )}
            {message.documentsUsed && message.documentsUsed.length > 0 && (
              <span
                style={{
                  fontSize: '0.72rem',
                  padding: '2px 8px',
                  borderRadius: '12px',
                  background: 'rgba(14, 165, 233, 0.15)',
                  border: '1px solid rgba(14, 165, 233, 0.35)',
                  color: '#7dd3fc',
                  fontWeight: 500,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
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
              <Globe size={14} color="#38bdf8" />
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

/**
 * Lightweight markdown parser for headings, code blocks, lists, links, and bold text
 */
const FormattedMarkdown: React.FC<{ content: string }> = ({ content }) => {
  if (!content) return null

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
  const paragraphs = text.split(/\n\n+/)

  return (
    <>
      {paragraphs.map((para, pIdx) => {
        const trimmed = para.trim()
        if (!trimmed) return null

        if (trimmed.startsWith('### ')) {
          return <h3 key={pIdx}>{renderInlineMarkdown(trimmed.replace(/^###\s+/, ''))}</h3>
        }
        if (trimmed.startsWith('## ')) {
          return <h2 key={pIdx}>{renderInlineMarkdown(trimmed.replace(/^##\s+/, ''))}</h2>
        }
        if (trimmed.startsWith('# ')) {
          return <h1 key={pIdx}>{renderInlineMarkdown(trimmed.replace(/^#\s+/, ''))}</h1>
        }

        const lines = trimmed.split('\n')
        const isBulletList = lines.every((line) => /^[-•*]\s+/.test(line.trim()))
        const isNumberedList = lines.every((line) => /^\d+\.\s+/.test(line.trim()))

        if (isBulletList) {
          return (
            <ul key={pIdx}>
              {lines.map((line, lIdx) => (
                <li key={lIdx}>{renderInlineMarkdown(line.replace(/^[-•*]\s+/, ''))}</li>
              ))}
            </ul>
          )
        }

        if (isNumberedList) {
          return (
            <ol key={pIdx}>
              {lines.map((line, lIdx) => (
                <li key={lIdx}>{renderInlineMarkdown(line.replace(/^\d+\.\s+/, ''))}</li>
              ))}
            </ol>
          )
        }

        return (
          <p key={pIdx}>
            {lines.map((line, lIdx) => (
              <React.Fragment key={lIdx}>
                {renderInlineMarkdown(line)}
                {lIdx < lines.length - 1 && <br />}
              </React.Fragment>
            ))}
          </p>
        )
      })}
    </>
  )
}

function renderInlineMarkdown(str: string): React.ReactNode[] {
  const elements: React.ReactNode[] = []
  const regex = /(\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*)/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(str)) !== null) {
    if (match.index > lastIndex) {
      elements.push(str.slice(lastIndex, match.index))
    }

    if (match[2] && match[3]) {
      elements.push(
        <a key={`link-${match.index}`} href={match[3]} target="_blank" rel="noopener noreferrer">
          {match[2]}
          <ExternalLink size={10} style={{ display: 'inline', marginLeft: 3, verticalAlign: 'baseline' }} />
        </a>
      )
    } else if (match[4]) {
      elements.push(<code key={`code-${match.index}`}>{match[4]}</code>)
    } else if (match[5]) {
      elements.push(<strong key={`bold-${match.index}`}>{match[5]}</strong>)
    }

    lastIndex = match.index + match[0].length
  }

  if (lastIndex < str.length) {
    elements.push(str.slice(lastIndex))
  }

  return elements
}
