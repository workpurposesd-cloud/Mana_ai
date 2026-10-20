import React, { useState } from 'react'
import {
  Plus,
  MessageSquare,
  Settings,
  Trash2,
  PanelLeftClose,
  Brain,
  Search,
  X,
  LogIn,
  LogOut,
  User as UserIcon,
} from 'lucide-react'
import { ManaLogo } from './ManaLogo'
import { ChatSessionSummary, AuthUser } from '../types/chat'

interface SidebarProps {
  isOpen: boolean
  onToggle: () => void
  onNewChat: () => void
  onOpenSettings: () => void
  onOpenMemory: () => void
  onOpenAuth: () => void
  onLogout: () => void
  onSelectPrompt: (prompt: string) => void
  sessions: ChatSessionSummary[]
  currentSessionId: string | null
  onSelectSession: (id: string) => void
  onDeleteSession: (id: string) => void
  currentUser: AuthUser | null
}

export const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  onToggle,
  onNewChat,
  onOpenSettings,
  onOpenMemory,
  onOpenAuth,
  onLogout,
  onSelectPrompt,
  sessions,
  currentSessionId,
  onSelectSession,
  onDeleteSession,
  currentUser,
}) => {
  const [filterQuery, setFilterQuery] = useState('')

  const quickTopics = [
    { title: 'Live Cricket Score', prompt: 'What is the latest cricket score?' },
    { title: "Today's Tech News", prompt: "What are today's important technology news stories?" },
    { title: 'Weather & Forecast', prompt: 'What is the weather today?' },
    { title: 'Start a React App', prompt: 'How do I start a React app?' },
    { title: 'What is RAM?', prompt: 'What is RAM?' },
  ]

  // Filter sessions by user query
  const filteredSessions = sessions.filter((s) => {
    if (!filterQuery.trim()) return true
    return s.title.toLowerCase().includes(filterQuery.toLowerCase().trim())
  })

  return (
    <>
      {isOpen && <div className="sidebar-backdrop" onClick={onToggle} />}

      <aside className={`chatgpt-sidebar ${isOpen ? 'open' : 'closed'}`}>
        {/* Top actions */}
        <div className="sidebar-top">
          <button
            className="sidebar-new-btn"
            onClick={onNewChat}
            id="sidebar-new-chat-btn"
            title="Start a fresh conversation"
          >
            <Plus size={18} />
            <span>New chat</span>
          </button>
          <button
            className="sidebar-close-btn"
            onClick={onToggle}
            title="Close sidebar"
            id="sidebar-btn-close"
          >
            <PanelLeftClose size={18} />
          </button>
        </div>

        {/* History Search / Filter Input */}
        <div className="sidebar-search-box">
          <Search size={14} className="search-icon-muted" />
          <input
            type="text"
            className="sidebar-search-input"
            placeholder="Search chat history..."
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            id="input-filter-history"
          />
          {filterQuery && (
            <button
              className="sidebar-search-clear"
              onClick={() => setFilterQuery('')}
              title="Clear search"
            >
              <X size={13} />
            </button>
          )}
        </div>

        {/* Scrollable list */}
        <div className="sidebar-scroll-list">
          {/* Saved chat sessions */}
          <div className="sidebar-group">
            <div className="sidebar-group-header">
              <span className="sidebar-group-label">
                {filterQuery ? `Matches (${filteredSessions.length})` : 'Conversations'}
              </span>
            </div>

            {filteredSessions.length === 0 ? (
              <div className="sidebar-empty-hint">
                {filterQuery ? 'No matching chats found' : 'No saved conversations yet'}
              </div>
            ) : (
              filteredSessions.map((session) => {
                const isActive = session.id === currentSessionId
                return (
                  <div
                    key={session.id}
                    className={`chat-history-item ${isActive ? 'active' : ''}`}
                    onClick={() => onSelectSession(session.id)}
                    title={session.title}
                  >
                    <MessageSquare size={14} className="chat-item-icon" />
                    <span className="chat-title">{session.title}</span>
                    <button
                      className="chat-delete-btn"
                      onClick={(e) => {
                        e.stopPropagation()
                        onDeleteSession(session.id)
                      }}
                      title="Delete conversation"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                )
              })
            )}
          </div>

          {/* Quick topic shortcuts */}
          {!filterQuery && (
            <div className="sidebar-group">
              <div className="sidebar-group-label">Quick Prompts</div>
              {quickTopics.map((item, idx) => (
                <button
                  key={idx}
                  className="chat-history-item quick-item"
                  onClick={() => onSelectPrompt(item.prompt)}
                >
                  <MessageSquare size={14} />
                  <span className="chat-title">{item.title}</span>
                </button>
              ))}
            </div>
          )}

          {/* Memory shortcut */}
          <div className="sidebar-group" style={{ marginTop: 'auto', paddingTop: '0.5rem' }}>
            <button className="chat-history-item memory-item" onClick={onOpenMemory}>
              <Brain size={15} />
              <span className="chat-title">Mana's Memory & Preferences</span>
            </button>
          </div>
        </div>

        {/* User profile footer */}
        <div className="sidebar-bottom">
          {currentUser ? (
            <div className="user-profile-bar">
              <div className="mana-avatar-badge small" title={currentUser.email}>
                <span className="avatar-initial">
                  {currentUser.name ? currentUser.name.charAt(0).toUpperCase() : 'U'}
                </span>
              </div>
              <div className="user-info" onClick={onOpenSettings} title="Settings">
                <span className="user-name">{currentUser.name || 'User'}</span>
                <span className="user-status">{currentUser.email}</span>
              </div>
              <div className="user-actions">
                <button
                  className="user-action-btn"
                  onClick={onOpenSettings}
                  title="Settings"
                >
                  <Settings size={15} />
                </button>
                <button
                  className="user-action-btn logout"
                  onClick={onLogout}
                  title="Sign Out"
                  id="btn-logout"
                >
                  <LogOut size={15} />
                </button>
              </div>
            </div>
          ) : (
            <button
              className="sidebar-auth-btn"
              onClick={onOpenAuth}
              id="sidebar-signin-btn"
            >
              <LogIn size={16} />
              <span>Sign In / Sign Up</span>
            </button>
          )}
        </div>
      </aside>
    </>
  )
}
