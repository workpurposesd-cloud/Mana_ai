import React from 'react'
import { Search } from 'lucide-react'

interface SearchStatusIndicatorProps {
  status?: string
  query?: string
}

export const SearchStatusIndicator: React.FC<SearchStatusIndicatorProps> = ({
  status = 'Searching the web...',
  query,
}) => {
  return (
    <div className="search-indicator-card" id="search-running-indicator">
      <div className="search-spinner-ring" />
      <div className="search-indicator-info">
        <div className="search-indicator-title">
          <span>🔎</span>
          <span>{status}</span>
        </div>
        {query && (
          <div className="search-indicator-query">
            Query: "<em>{query}</em>"
          </div>
        )}
      </div>
    </div>
  )
}
