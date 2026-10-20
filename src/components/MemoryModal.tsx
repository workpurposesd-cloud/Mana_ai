import React, { useState, useEffect } from 'react'
import { X, Brain, Plus, Trash2, Edit2, Check, Sparkles, RefreshCw } from 'lucide-react'
import { safeApiFetch } from '../utils/api'

export interface MemoryItem {
  id: string
  category: 'personal' | 'preference' | 'correction' | 'project'
  key: string
  value: string
  createdAt: string
  updatedAt: string
}

interface MemoryModalProps {
  isOpen: boolean
  onClose: () => void
}

export const MemoryModal: React.FC<MemoryModalProps> = ({ isOpen, onClose }) => {
  const [memories, setMemories] = useState<MemoryItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')
  const [newCategory, setNewCategory] = useState<'preference' | 'personal' | 'project'>('preference')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')

  const fetchMemories = async () => {
    setIsLoading(true)
    try {
      const res = await safeApiFetch<{ memories: MemoryItem[] }>('/api/memories')
      if (res.success && res.data?.memories) {
        setMemories(res.data.memories)
      }
    } catch (err) {
      console.error('Error fetching memories:', err)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (isOpen) {
      fetchMemories()
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newKey.trim() || !newValue.trim()) return

    try {
      const res = await safeApiFetch<{ memory: MemoryItem }>('/api/memories', {
        method: 'POST',
        body: JSON.stringify({
          category: newCategory,
          key: newKey.trim(),
          value: newValue.trim(),
        }),
      })
      if (res.success && res.data?.memory) {
        setMemories((prev) => [res.data!.memory, ...prev.filter((m) => m.id !== res.data!.memory.id)])
        setNewKey('')
        setNewValue('')
      }
    } catch (err) {
      console.error('Error adding memory:', err)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      const res = await safeApiFetch(`/api/memories/${id}`, { method: 'DELETE' })
      if (res.success) {
        setMemories((prev) => prev.filter((m) => m.id !== id))
      }
    } catch (err) {
      console.error('Error deleting memory:', err)
    }
  }

  const handleSaveEdit = async (id: string) => {
    if (!editValue.trim()) return
    try {
      const res = await safeApiFetch<{ memory: MemoryItem }>(`/api/memories/${id}`, {
        method: 'PUT',
        body: JSON.stringify({
          value: editValue.trim(),
        }),
      })
      if (res.success && res.data?.memory) {
        setMemories((prev) =>
          prev.map((m) => (m.id === id ? res.data!.memory : m))
        )
        setEditingId(null)
      }
    } catch (err) {
      console.error('Error updating memory:', err)
    }
  }

  const handleClearAll = async () => {
    if (!window.confirm('Are you sure you want to clear all stored memories?')) return
    try {
      await safeApiFetch('/api/memories', { method: 'DELETE' })
      setMemories([])
    } catch (err) {
      console.error('Error clearing memories:', err)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            <Brain size={20} color="#8b5cf6" />
            <span>Mana's Memory & Preferences</span>
          </div>
          <button className="code-copy-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <div className="memory-info-banner">
            <Sparkles size={16} color="#38bdf8" style={{ flexShrink: 0 }} />
            <span>
              Mana AI learns your preferences and personal context locally to improve future answers. You can view, edit, or delete anything below.
            </span>
          </div>

          {/* Add custom memory */}
          <form onSubmit={handleAdd} className="memory-add-form">
            <div style={{ display: 'flex', gap: '0.5rem', width: '100%' }}>
              <input
                type="text"
                className="form-input"
                style={{ flex: 1 }}
                placeholder="Label (e.g. My Name, Preferred Stack)"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
              />
              <select
                className="form-select"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value as any)}
                style={{ width: '120px' }}
              >
                <option value="preference">Preference</option>
                <option value="personal">Personal</option>
                <option value="project">Project</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', width: '100%' }}>
              <input
                type="text"
                className="form-input"
                style={{ flex: 1 }}
                placeholder="Value (e.g. U Nagesh, TypeScript, Concise answers)"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
              />
              <button type="submit" className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <Plus size={15} />
                <span>Add</span>
              </button>
            </div>
          </form>

          {/* Memories List */}
          <div className="memory-list-scroll">
            {isLoading ? (
              <div style={{ textAlign: 'center', padding: '1rem', color: '#64748b' }}>
                <RefreshCw size={16} className="animate-spin" /> Loading memories...
              </div>
            ) : memories.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '1.5rem', color: '#64748b', fontSize: '0.85rem' }}>
                No saved memories yet. Talk to Mana AI or add notes above!
              </div>
            ) : (
              memories.map((m) => (
                <div key={m.id} className="memory-card-row">
                  <div className="memory-card-content">
                    <div className="memory-card-header">
                      <span className="memory-card-key">{m.key}</span>
                      <span className={`memory-category-badge ${m.category}`}>{m.category}</span>
                    </div>

                    {editingId === m.id ? (
                      <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.3rem' }}>
                        <input
                          type="text"
                          className="form-input"
                          style={{ flex: 1 }}
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          autoFocus
                        />
                        <button
                          type="button"
                          className="btn-icon"
                          onClick={() => handleSaveEdit(m.id)}
                        >
                          <Check size={14} color="#4ade80" />
                        </button>
                      </div>
                    ) : (
                      <div className="memory-card-value">{m.value}</div>
                    )}
                  </div>

                  <div className="memory-card-actions">
                    {editingId !== m.id && (
                      <button
                        type="button"
                        className="btn-icon-subtle"
                        onClick={() => {
                          setEditingId(m.id)
                          setEditValue(m.value)
                        }}
                        title="Edit memory"
                      >
                        <Edit2 size={13} />
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn-icon-subtle delete"
                      onClick={() => handleDelete(m.id)}
                      title="Delete memory"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
          {memories.length > 0 ? (
            <button
              type="button"
              className="btn-secondary"
              style={{ color: '#f87171', borderColor: 'rgba(239,68,68,0.3)' }}
              onClick={handleClearAll}
            >
              Clear All Memories
            </button>
          ) : <div />}

          <button type="button" className="btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
