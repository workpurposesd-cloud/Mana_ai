import React, { useState, useEffect } from 'react'
import {
  Film,
  Download,
  RefreshCw,
  Play,
  Pause,
  AlertTriangle,
  Clock,
  Sparkles,
  Maximize2
} from 'lucide-react'
import { VideoJobMetadata } from '../types/chat'

interface GeneratedVideoCardProps {
  video: VideoJobMetadata
  onRegenerate?: (prompt: string, aspectRatio?: string, duration?: number) => void
  onOpenSettings?: () => void
}

export const GeneratedVideoCard: React.FC<GeneratedVideoCardProps> = ({
  video,
  onRegenerate,
  onOpenSettings,
}) => {
  const [elapsedSeconds, setElapsedSeconds] = useState(0)

  // Track elapsed time while job is queued or processing
  useEffect(() => {
    let timer: any
    if (video.status === 'queued' || video.status === 'processing') {
      const start = new Date(video.createdAt).getTime()
      timer = setInterval(() => {
        const secs = Math.max(0, Math.floor((Date.now() - start) / 1000))
        setElapsedSeconds(secs)
      }, 1000)
    }
    return () => clearInterval(timer)
  }, [video.status, video.createdAt])

  const handleDownload = () => {
    if (!video.videoUrl) return
    const link = document.createElement('a')
    link.href = video.videoUrl
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    const cleanName = video.prompt
      .slice(0, 32)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
    link.download = `mana-video-${cleanName || 'generation'}.mp4`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const handleRegenerate = () => {
    onRegenerate?.(video.prompt, video.aspectRatio, video.duration)
  }

  // Provider display name
  const providerLabel =
    video.providerRestrictions?.name ||
    (video.provider === 'luma'
      ? 'Luma Dream Machine Ray-2'
      : video.provider === 'replicate'
      ? 'Replicate Video'
      : video.provider === 'runway'
      ? 'RunwayML Gen-3'
      : 'AI Video Engine')

  // 1. COMPLETED STATE (Embedded Video Player)
  if (video.status === 'completed' && video.videoUrl) {
    return (
      <div className="mana-generated-media-card video-card">
        {/* Top Header */}
        <div className="media-card-topbar">
          <div className="media-provider-info">
            <Film size={14} color="#06b6d4" />
            <span className="media-provider-name">{providerLabel}</span>
            <span className="media-badge ratio">{video.aspectRatio || '16:9'}</span>
            <span className="media-badge duration">{video.duration || 5}s</span>
          </div>

          <div className="media-action-toolbar">
            <button
              type="button"
              className="media-action-btn"
              onClick={handleDownload}
              title="Download MP4 Video"
            >
              <Download size={14} />
              <span>Download MP4</span>
            </button>
            {onRegenerate && (
              <button
                type="button"
                className="media-action-btn regenerate"
                onClick={handleRegenerate}
                title="Regenerate this video"
              >
                <RefreshCw size={14} />
                <span>Regenerate</span>
              </button>
            )}
          </div>
        </div>

        {/* Embedded HTML5 Video Player */}
        <div className="media-video-frame">
          <video
            src={video.videoUrl}
            controls
            playsInline
            loop
            poster={video.thumbnailUrl}
            className="media-video-element"
          >
            Your browser does not support the video tag.
          </video>
        </div>

        {/* Video Prompt Caption */}
        <div className="media-prompt-caption">
          <p className="caption-text">"{video.prompt}"</p>
        </div>
      </div>
    )
  }

  // 2. QUEUED / PROCESSING STATE (Progress Bar & Live Status)
  if (video.status === 'queued' || video.status === 'processing') {
    const isQueued = video.status === 'queued'
    return (
      <div className="mana-generated-media-card video-processing-card">
        <div className="media-card-topbar">
          <div className="media-provider-info">
            <Film size={14} color="#06b6d4" />
            <span className="media-provider-name">{providerLabel}</span>
            <span className="media-badge ratio">{video.aspectRatio || '16:9'}</span>
            <span className="media-badge duration">{video.duration || 5}s</span>
          </div>
          <div className="elapsed-badge">
            <Clock size={12} />
            <span>{elapsedSeconds}s elapsed</span>
          </div>
        </div>

        <div className="video-progress-body">
          <div className="video-status-header">
            <div className="pulsing-spinner-ring">
              <span className="spinner-core" />
            </div>
            <div className="status-text-block">
              <span className="status-main-label">
                {isQueued
                  ? 'Queued in Video GPU Cluster...'
                  : 'Synthesizing Cinematic Video Frames...'}
              </span>
              <span className="status-sub-label">
                {isQueued
                  ? 'Allocating neural rendering nodes'
                  : 'Rendering high-resolution motion diffusion'}
              </span>
            </div>
            <span className="percentage-display">{video.progress}%</span>
          </div>

          {/* Animated Progress Bar */}
          <div className="mana-progress-track">
            <div
              className="mana-progress-fill"
              style={{ width: `${Math.max(10, video.progress)}%` }}
            >
              <div className="mana-progress-shimmer" />
            </div>
          </div>

          <p className="processing-prompt-quote">"{video.prompt}"</p>
        </div>
      </div>
    )
  }

  // 3. FAILED STATE - Clean error with just retry option, no API key nagging
  return (
    <div className="mana-generated-media-card video-error-card">
      <div className="video-error-header">
        <AlertTriangle size={18} color="#f59e0b" />
        <span className="error-title">Video Generation Notice</span>
      </div>

      <p className="error-description">{video.error || 'Video generation could not be completed. Please try again.'}</p>

      {/* Action Buttons */}
      <div className="video-error-actions">
        {onRegenerate && (
          <button
            type="button"
            className="retry-job-btn"
            onClick={handleRegenerate}
          >
            <RefreshCw size={14} />
            <span>Try Again</span>
          </button>
        )}
      </div>
    </div>
  )
}
