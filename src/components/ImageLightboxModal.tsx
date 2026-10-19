import React, { useEffect } from 'react'
import { X, Download, ExternalLink, Sparkles, Layers, Sliders } from 'lucide-react'
import { GeneratedImageMetadata } from '../types/chat'

interface ImageLightboxModalProps {
  image: GeneratedImageMetadata | null
  onClose: () => void
}

export const ImageLightboxModal: React.FC<ImageLightboxModalProps> = ({ image, onClose }) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    if (image) {
      window.addEventListener('keydown', handleKeyDown)
      document.body.style.overflow = 'hidden'
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = 'auto'
    }
  }, [image, onClose])

  if (!image) return null

  const handleDownload = () => {
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

  return (
    <div className="mana-lightbox-backdrop" onClick={onClose}>
      <div className="mana-lightbox-container" onClick={(e) => e.stopPropagation()}>
        {/* Top Control Bar */}
        <div className="mana-lightbox-header">
          <div className="lightbox-title-section">
            <Sparkles size={16} color="#8b5cf6" />
            <span className="lightbox-provider-badge">{image.provider}</span>
            <span className="lightbox-tag">{image.aspectRatio}</span>
            {image.quality && <span className="lightbox-tag uppercase">{image.quality}</span>}
          </div>

          <div className="lightbox-actions">
            <button
              className="lightbox-btn"
              onClick={handleDownload}
              title="Download high-resolution image"
            >
              <Download size={16} />
              <span>Download</span>
            </button>
            <a
              href={image.url}
              target="_blank"
              rel="noopener noreferrer"
              className="lightbox-btn"
              title="Open full resolution in new tab"
            >
              <ExternalLink size={16} />
              <span>Full Size</span>
            </a>
            <button
              className="lightbox-close-btn"
              onClick={onClose}
              title="Close (Esc)"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Full Image Display */}
        <div className="mana-lightbox-image-wrapper">
          <img
            src={image.url}
            alt={image.prompt}
            className="mana-lightbox-image"
          />
        </div>

        {/* Footer Details */}
        <div className="mana-lightbox-footer">
          <div className="lightbox-prompt-row">
            <span className="prompt-label">Prompt:</span>
            <p className="prompt-content">"{image.prompt}"</p>
          </div>
          {image.revisedPrompt && (
            <div className="lightbox-prompt-row revised">
              <span className="prompt-label">DALL-E Revised:</span>
              <p className="prompt-content revised">"{image.revisedPrompt}"</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
