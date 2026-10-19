import React, { useRef, useEffect } from 'react'
import {
  ArrowUp,
  Square,
  Globe,
  Mic,
  MicOff,
  AlertCircle,
  X,
  MessageSquare,
  Sparkles,
  Film,
  Sliders,
  Clock
} from 'lucide-react'
import { SearchMode, ChatMode } from '../types/chat'

interface ChatInputProps {
  input: string
  onChange: (val: string) => void
  onSend: () => void
  onStop: () => void
  isGenerating: boolean
  searchMode: SearchMode
  onToggleSearchMode: () => void
  isListening: boolean
  onToggleVoice: () => void
  voiceError: string | null
  onClearVoiceError: () => void
  isVoiceSupported: boolean

  // Mode Selection
  mode: ChatMode
  onSelectMode: (mode: ChatMode) => void

  // Image Generation Options
  imageAspectRatio: '1:1' | '16:9' | '9:16'
  onSelectImageAspectRatio: (ratio: '1:1' | '16:9' | '9:16') => void
  imageQuality: 'standard' | 'hd'
  onSelectImageQuality: (quality: 'standard' | 'hd') => void

  // Video Generation Options
  videoAspectRatio: '16:9' | '9:16' | '1:1'
  onSelectVideoAspectRatio: (ratio: '16:9' | '9:16' | '1:1') => void
  videoDuration: number
  onSelectVideoDuration: (duration: number) => void
}

export const ChatInput: React.FC<ChatInputProps> = ({
  input,
  onChange,
  onSend,
  onStop,
  isGenerating,
  searchMode,
  onToggleSearchMode,
  isListening,
  onToggleVoice,
  voiceError,
  onClearVoiceError,
  isVoiceSupported,
  mode,
  onSelectMode,
  imageAspectRatio,
  onSelectImageAspectRatio,
  imageQuality,
  onSelectImageQuality,
  videoAspectRatio,
  onSelectVideoAspectRatio,
  videoDuration,
  onSelectVideoDuration,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`
    }
  }, [input])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (isGenerating) return
      if (input.trim()) onSend()
    }
  }

  const isSearchActive = searchMode === 'always'
  const isSearchAuto = searchMode === 'auto'

  // Dynamic placeholder text based on selected mode
  let placeholderText = 'Ask Mana AI anything...'
  if (isListening) {
    placeholderText = 'Listening to you speak...'
  } else if (mode === 'image') {
    placeholderText = 'Describe the image you want to generate (e.g. A realistic photo of a black sports car in a rainy neon city)...'
  } else if (mode === 'video') {
    placeholderText = 'Describe the video you want to generate (e.g. Create a 10-second cinematic video of a sports car driving through a rainy city at night)...'
  }

  return (
    <div className="chatgpt-input-container">
      {/* 1. Mode Selector Tabs (Chat / Image / Video) */}
      <div className="mana-mode-switcher-container">
        <div className="mana-mode-pills">
          <button
            type="button"
            className={`mana-mode-tab ${mode === 'chat' ? 'active chat' : ''}`}
            onClick={() => onSelectMode('chat')}
            title="Standard conversational AI chat"
          >
            <MessageSquare size={13} />
            <span>Chat</span>
          </button>

          <button
            type="button"
            className={`mana-mode-tab ${mode === 'image' ? 'active image' : ''}`}
            onClick={() => onSelectMode('image')}
            title="AI Image Generation mode"
          >
            <Sparkles size={13} />
            <span>Image</span>
          </button>

          <button
            type="button"
            className={`mana-mode-tab ${mode === 'video' ? 'active video' : ''}`}
            onClick={() => onSelectMode('video')}
            title="AI Video Generation mode"
          >
            <Film size={13} />
            <span>Video</span>
          </button>
        </div>

        {/* Mode Options Bar */}
        {mode === 'image' && (
          <div className="mode-options-strip image-options">
            <span className="options-label">Aspect Ratio:</span>
            <div className="options-chip-group">
              <button
                type="button"
                className={`option-chip ${imageAspectRatio === '1:1' ? 'active' : ''}`}
                onClick={() => onSelectImageAspectRatio('1:1')}
              >
                1:1 (Square)
              </button>
              <button
                type="button"
                className={`option-chip ${imageAspectRatio === '16:9' ? 'active' : ''}`}
                onClick={() => onSelectImageAspectRatio('16:9')}
              >
                16:9 (Landscape)
              </button>
              <button
                type="button"
                className={`option-chip ${imageAspectRatio === '9:16' ? 'active' : ''}`}
                onClick={() => onSelectImageAspectRatio('9:16')}
              >
                9:16 (Portrait)
              </button>
            </div>

            <div className="options-divider" />

            <span className="options-label">Quality:</span>
            <div className="options-chip-group">
              <button
                type="button"
                className={`option-chip ${imageQuality === 'standard' ? 'active' : ''}`}
                onClick={() => onSelectImageQuality('standard')}
              >
                Standard
              </button>
              <button
                type="button"
                className={`option-chip ${imageQuality === 'hd' ? 'active' : ''}`}
                onClick={() => onSelectImageQuality('hd')}
              >
                HD
              </button>
            </div>
          </div>
        )}

        {mode === 'video' && (
          <div className="mode-options-strip video-options">
            <span className="options-label">Aspect Ratio:</span>
            <div className="options-chip-group">
              <button
                type="button"
                className={`option-chip ${videoAspectRatio === '16:9' ? 'active' : ''}`}
                onClick={() => onSelectVideoAspectRatio('16:9')}
              >
                16:9 (Cinematic)
              </button>
              <button
                type="button"
                className={`option-chip ${videoAspectRatio === '9:16' ? 'active' : ''}`}
                onClick={() => onSelectVideoAspectRatio('9:16')}
              >
                9:16 (Shorts/Reels)
              </button>
              <button
                type="button"
                className={`option-chip ${videoAspectRatio === '1:1' ? 'active' : ''}`}
                onClick={() => onSelectVideoAspectRatio('1:1')}
              >
                1:1 (Square)
              </button>
            </div>

            <div className="options-divider" />

            <span className="options-label">Duration:</span>
            <div className="options-chip-group">
              <button
                type="button"
                className={`option-chip ${videoDuration === 5 ? 'active' : ''}`}
                onClick={() => onSelectVideoDuration(5)}
              >
                5s
              </button>
              <button
                type="button"
                className={`option-chip ${videoDuration === 10 ? 'active' : ''}`}
                onClick={() => onSelectVideoDuration(10)}
              >
                10s
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Listening Status Indicator Banner */}
      {isListening && (
        <div className="voice-listening-banner">
          <div className="listening-wave-indicator">
            <span className="wave-bar bar-1" />
            <span className="wave-bar bar-2" />
            <span className="wave-bar bar-3" />
            <span className="wave-bar bar-4" />
          </div>
          <span className="listening-text">Listening to your voice... Speak now</span>
          <button
            type="button"
            className="stop-voice-btn"
            onClick={onToggleVoice}
            id="btn-stop-listening-banner"
            title="Stop listening"
          >
            <Square size={10} fill="currentColor" />
            <span>Stop</span>
          </button>
        </div>
      )}

      {/* Voice Error Banner */}
      {voiceError && (
        <div className="voice-error-banner">
          <AlertCircle size={14} style={{ flexShrink: 0 }} />
          <span className="voice-error-text">{voiceError}</span>
          <button
            type="button"
            className="voice-error-close"
            onClick={onClearVoiceError}
            title="Dismiss"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* Main Input Capsule */}
      <div className={`chatgpt-input-capsule ${isListening ? 'listening-active' : ''} mode-${mode}`}>
        {/* Globe search button (active for chat mode) */}
        {mode === 'chat' ? (
          <button
            type="button"
            className={`input-search-toggle-btn ${isSearchActive ? 'active' : isSearchAuto ? 'auto' : 'off'}`}
            onClick={onToggleSearchMode}
            title={
              isSearchActive
                ? 'Web search: Forced ON for all queries'
                : isSearchAuto
                ? 'Web search: Auto (Searches when live data is needed)'
                : 'Web search: OFF (Direct AI only)'
            }
            id="btn-search-toggle"
          >
            <Globe size={18} />
            {isSearchActive && <span className="search-active-dot" />}
          </button>
        ) : (
          <div className="mode-capsule-badge" title={mode === 'image' ? 'Image Prompt Mode' : 'Video Prompt Mode'}>
            {mode === 'image' ? <Sparkles size={17} color="#a855f7" /> : <Film size={17} color="#06b6d4" />}
          </div>
        )}

        {/* Textarea Input */}
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholderText}
          rows={1}
          className="chatgpt-textarea"
          id="chat-textarea-input"
          autoFocus
        />

        {/* Voice Input Microphone Button */}
        <button
          type="button"
          className={`input-mic-btn ${isListening ? 'listening' : ''}`}
          onClick={onToggleVoice}
          title={
            !isVoiceSupported
              ? 'Speech recognition not supported in this browser'
              : isListening
              ? 'Click to stop listening'
              : 'Click to speak to Mana AI'
          }
          id="btn-voice-input"
        >
          {isListening ? (
            <div className="mic-listening-icon">
              <MicOff size={18} />
              <span className="mic-pulse-ring" />
            </div>
          ) : (
            <Mic size={18} />
          )}
        </button>

        {/* Send / Stop button */}
        {isGenerating ? (
          <button
            type="button"
            className="chatgpt-send-circle stop"
            onClick={onStop}
            title="Stop generating"
            id="btn-stop-stream"
          >
            <Square size={13} fill="currentColor" />
          </button>
        ) : (
          <button
            type="button"
            className={`chatgpt-send-circle ${input.trim() ? 'ready' : ''} ${mode}`}
            onClick={onSend}
            disabled={!input.trim()}
            title={mode === 'image' ? 'Generate Image' : mode === 'video' ? 'Generate Video' : 'Send prompt'}
            id="btn-send-message"
          >
            {mode === 'image' ? (
              <Sparkles size={17} strokeWidth={2.2} />
            ) : mode === 'video' ? (
              <Film size={17} strokeWidth={2.2} />
            ) : (
              <ArrowUp size={18} strokeWidth={2.5} />
            )}
          </button>
        )}
      </div>
    </div>
  )
}
