import React, { useState } from 'react'
import { ExternalLink, ChevronDown, ChevronUp, Globe, CheckCircle2, AlertTriangle, Calendar } from 'lucide-react'
import { SearchEvidence } from '../types/chat'

interface SourcesListProps {
  evidence: SearchEvidence
}

export const SourcesList: React.FC<SourcesListProps> = ({ evidence }) => {
  const [isExpanded, setIsExpanded] = useState(false)

  if (evidence.errorMessage && evidence.results.length === 0) {
    return (
      <div style={{ marginTop: '0.75rem', padding: '0.65rem 0.85rem', borderRadius: '8px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.25)', fontSize: '0.8rem', color: '#fca5a5', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <AlertTriangle size={15} style={{ flexShrink: 0 }} />
        <span>Live web search is temporarily unavailable: {evidence.errorMessage}</span>
      </div>
    )
  }

  if (evidence.results.length === 0) {
    return null
  }

  return (
    <div className="sources-container" id="sources-section">
      <div className="sources-header">
        <CheckCircle2 size={14} color="#4ade80" />
        <span>Verified Sources ({evidence.results.length})</span>
        <span style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 400, marginLeft: 'auto' }}>
          via {evidence.provider} in {evidence.tookMs}ms
        </span>
      </div>

      {/* Clickable Source Chips */}
      <div className="sources-grid">
        {evidence.results.map((item, index) => (
          <a
            key={item.id || index}
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="source-chip"
            title={`${item.title}\n${item.snippet}`}
            id={`source-link-${index + 1}`}
          >
            <Globe size={13} style={{ color: '#38bdf8', flexShrink: 0 }} />
            <span className="source-domain">{item.domain}</span>
            {item.publishedDate && (
              <span className="source-date" title={`Published: ${item.publishedDate}`}>
                <Calendar size={11} style={{ display: 'inline', marginRight: 2 }} />
                {item.publishedDate}
              </span>
            )}
            <ExternalLink size={11} style={{ color: '#64748b', flexShrink: 0 }} />
          </a>
        ))}
      </div>

      {/* Expandable "View search results" detail accordion */}
      <button
        type="button"
        className="accordion-toggle-btn"
        onClick={() => setIsExpanded(!isExpanded)}
        id="btn-toggle-search-results"
      >
        {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        <span>{isExpanded ? 'Hide search details' : 'View search results'}</span>
      </button>

      {isExpanded && (
        <div className="accordion-body" id="expanded-search-results">
          <div style={{ marginBottom: '0.6rem', color: '#94a3b8', fontSize: '0.75rem' }}>
            Query: <strong style={{ color: '#e2e8f0' }}>"{evidence.query}"</strong>
          </div>
          {evidence.results.map((item, idx) => (
            <div key={item.id || idx} className="raw-result-item">
              <div className="raw-result-title">
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#60a5fa', textDecoration: 'none' }}
                >
                  [{idx + 1}] {item.title}
                </a>
                {item.publishedDate && (
                  <span style={{ fontSize: '0.72rem', color: '#94a3b8', marginLeft: '0.5rem' }}>
                    ({item.publishedDate})
                  </span>
                )}
              </div>
              <div className="raw-result-snippet">{item.snippet}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
