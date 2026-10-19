import React, { useState } from 'react'
import { Download, Maximize2, RefreshCw, Sparkles, ChevronDown, ChevronUp, Layers } from 'lucide-react'
import { GeneratedImageMetadata } from '../types/chat'

interface GeneratedImageCardProps {
  image: GeneratedImageMetadata
  onPreview: (image: GeneratedImageMetadata) => void
  onRegenerate?: (prompt: string, aspectRatio?: string, quality?: string) => void
}

export const GeneratedImageCard: React.FC<GeneratedImageCardProps> = ({
  image,
  onPreview,
  onRegenerate,
}) => {
  const [showRevised, setShowRevised] = useState(false)
  const [isLoaded, setIsLoaded] = useState(false)

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation()
    const link = document.createElement('a')
    link.href = image.url
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    const cleanName = image.prompt
      .slice(0, 32)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
    link.download = `mana-ai-${cleanName || 'image'}.png`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const handleRegenerate = (e: React.MouseEvent) => {
    e.stopPropagation()
    onRegenerate?.(image.prompt, image.aspectRatio, image.quality)
  }

  return (
    <div className="mana-generated-media-card">
      {/* Top Media Header */}
      <div className="media-card-topbar">
        <div className="media-provider-info">
          <Sparkles size={14} color="#8b5cf6" />
          <span className="media-provider-name">{image.provider}</span>
          <span className="media-badge ratio">{image.aspectRatio}</span>
          {image.quality && <span className="media-badge quality">{image.quality.toUpperCase()}</span>}
        </div>

        {/* Action Buttons Toolbar */}
        <div className="media-action-toolbar">
          <button
            type="button"
            className="media-action-btn"
            onClick={() => onPreview(image)}
            title="Preview full size"
          >
            <Maximize2 size={14} />
            <span>Preview</span>
          </button>
          <button
            type="button"
            className="media-action-btn"
            onClick={handleDownload}
            title="Download image"
          >
            <Download size={14} />
            <span>Download</span>
          </button>
          {onRegenerate && (
            <button
              type="button"
              className="media-action-btn regenerate"
              onClick={handleRegenerate}
              title="Regenerate this image"
            >
              <RefreshCw size={14} />
              <span>Regenerate</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Image Box */}
      <div
        className="media-image-frame"
        onClick={() => onPreview(image)}
        title="Click to view full size preview"
      >
        {!isLoaded && (
          <div className="media-image-skeleton">
            <span className="spinner-dot" />
            <span>Loading image preview...</span>
          </div>
        )}
        <img
          src={image.url}
          alt={image.prompt}
          className={`media-image-content ${isLoaded ? 'loaded' : 'loading'}`}
          onLoad={() => setIsLoaded(true)}
        />
        <div className="media-image-hover-overlay">
          <div className="hover-pill">
            <Maximize2 size={15} />
            <span>Click to Preview Full Size</span>
          </div>
        </div>
      </div>

      {/* Prompt Details */}
      <div className="media-prompt-caption">
        <p className="caption-text">"{image.prompt}"</p>
      </div>

      {/* DALL-E Revised Prompt Accordion */}
      {image.revisedPrompt && (
        <div className="media-revised-accordion">
          <button
            type="button"
            className="revised-toggle-btn"
            onClick={() => setShowRevised(!showRevised)}
          >
            <Layers size={12} color="#8b5cf6" />
            <span>{showRevised ? 'Hide DALL-E Revised Prompt' : 'View DALL-E Revised Prompt'}</span>
            {showRevised ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
          {showRevised && (
            <div className="revised-content-box">
              <p>{image.revisedPrompt}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
