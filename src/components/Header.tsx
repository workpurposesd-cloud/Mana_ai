import React from 'react'
import { PanelLeft, Plus, Settings, Brain, LogIn, Volume2 } from 'lucide-react'
import { ManaLogo } from './ManaLogo'
import { AuthUser } from '../types/chat'

interface HeaderProps {
  onToggleSidebar: () => void
  onNewChat: () => void
  onOpenSettings: () => void
  onOpenMemory: () => void
  onOpenAuth: () => void
  currentUser: AuthUser | null
  isVoiceMode: boolean
  onToggleVoiceMode: () => void
}

export const Header: React.FC<HeaderProps> = ({
  onToggleSidebar,
  onNewChat,
  onOpenSettings,
  onOpenMemory,
  onOpenAuth,
  currentUser,
  isVoiceMode,
  onToggleVoiceMode,
}) => {
  return (
    <header className="chatgpt-header">
      <div className="header-left">
        <button
          className="header-icon-btn"
          onClick={onToggleSidebar}
          title="Toggle Sidebar"
          id="btn-toggle-sidebar"
        >
          <PanelLeft size={19} />
        </button>
        <button
          className="header-icon-btn"
          onClick={onNewChat}
          title="New Chat"
          id="btn-header-new-chat"
        >
          <Plus size={19} />
        </button>
      </div>

      <div className="header-title-pill">
        <ManaLogo size={20} />
        <span className="header-brand-name">Mana AI</span>
      </div>

      <div className="header-right">
        {/* Quick Voice Mode Auto-Speak Toggle */}
        <button
          className={`header-voice-pill ${isVoiceMode ? 'active' : ''}`}
          onClick={onToggleVoiceMode}
          title={
            isVoiceMode
              ? 'Voice Mode: Active (Automatically speaks answers aloud)'
              : 'Voice Mode: Off (Click to enable automatic spoken answers)'
          }
          id="btn-header-voice-mode"
        >
          <Volume2 size={15} />
          <span className="voice-mode-text">{isVoiceMode ? 'Voice ON' : 'Voice'}</span>
          {isVoiceMode && <span className="voice-mode-dot" />}
        </button>

        <button
          className="header-icon-btn"
          onClick={onOpenMemory}
          title="Mana's Memory & Continuous Learnings"
          id="btn-header-memory"
        >
          <Brain size={18} />
        </button>
        <button
          className="header-icon-btn"
          onClick={onOpenSettings}
          title="Settings & Model"
          id="btn-header-settings"
        >
          <Settings size={18} />
        </button>

        {currentUser ? (
          <button
            className="header-user-btn"
            onClick={onOpenSettings}
            title={`Logged in as ${currentUser.name || currentUser.email}`}
          >
            <span className="header-user-initial">
              {currentUser.name ? currentUser.name.charAt(0).toUpperCase() : 'U'}
            </span>
          </button>
        ) : (
          <button
            className="header-auth-pill"
            onClick={onOpenAuth}
            id="btn-header-signin"
            title="Sign In / Sign Up"
          >
            <LogIn size={14} />
            <span>Sign In</span>
          </button>
        )}
      </div>
    </header>
  )
}
