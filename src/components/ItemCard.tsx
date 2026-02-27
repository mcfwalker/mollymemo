import { useState } from 'react'
import { Item } from '@/lib/supabase'
import { DOMAINS } from './FilterBar'
import styles from '@/app/page.module.css'

interface ItemCardProps {
  item: Item
  isExpanded: boolean
  onToggleExpand: () => void
  onUpdate: (id: string, updates: Partial<Item>) => void
  onDelete: (id: string) => void
  onRetry: (id: string) => void
  projectTags?: { project_name: string; color_hue: number | null }[]
}

function formatDate(dateStr: string) {
  const date = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const hours = Math.floor(diff / (1000 * 60 * 60))
  const days = Math.floor(hours / 24)

  if (hours < 1) return 'just now'
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  return date.toLocaleDateString()
}

/** Returns true if dark text (#1a1a1a) should be used on an HSL background for WCAG contrast. */
function hslNeedsDarkText(h: number, s: number, l: number): boolean {
  // Convert HSL to sRGB
  const s1 = s / 100, l1 = l / 100
  const c = (1 - Math.abs(2 * l1 - 1)) * s1
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l1 - c / 2
  let r = 0, g = 0, b = 0
  if (h < 60)      { r = c; g = x }
  else if (h < 120) { r = x; g = c }
  else if (h < 180) { g = c; b = x }
  else if (h < 240) { g = x; b = c }
  else if (h < 300) { r = x; b = c }
  else              { r = c; b = x }
  // Relative luminance (WCAG 2.1)
  const toLinear = (v: number) => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  const lum = 0.2126 * toLinear(r + m) + 0.7152 * toLinear(g + m) + 0.0722 * toLinear(b + m)
  return lum > 0.179
}

export function ItemCard({ item, isExpanded, onToggleExpand, onUpdate, onDelete, onRetry, projectTags }: ItemCardProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editTitle, setEditTitle] = useState('')

  const startEditing = () => {
    setIsEditing(true)
    setEditTitle(item.title || '')
  }

  const saveTitle = () => {
    if (editTitle.trim()) {
      onUpdate(item.id, { title: editTitle.trim() })
    }
    setIsEditing(false)
  }

  const cancelEditing = () => {
    setIsEditing(false)
    setEditTitle('')
  }

  return (
    <div
      className={`${styles.card} ${isExpanded ? styles.expanded : ''}`}
      onClick={() => {
        // Don't collapse when user is selecting text to copy
        const selection = window.getSelection()
        if (selection && selection.toString().length > 0) return
        onToggleExpand()
      }}
    >
      <div className={styles.cardHeader}>
        <div className={styles.cardTitle}>
          {isEditing ? (
            <input
              type="text"
              className={styles.editInput}
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveTitle()
                if (e.key === 'Escape') cancelEditing()
              }}
              onBlur={saveTitle}
              onClick={(e) => e.stopPropagation()}
              autoFocus
            />
          ) : (
            <span className={styles.name}>
              <span className={styles.itemNumber}>#{item.item_number}</span> &mdash; {item.title || 'Processing...'}
              <button
                className={styles.editBtn}
                onClick={(e) => {
                  e.stopPropagation()
                  startEditing()
                }}
                title="Edit title"
              >
                ✎
              </button>
            </span>
          )}
        </div>
        <div className={styles.cardMeta}>
          <span className={styles.date}>{formatDate(item.captured_at)}</span>
          <span className={`${styles.status} ${styles[item.status]}`}>{item.status}</span>
          <span className={styles.metaSeparator}>&mdash;</span>
          {projectTags && projectTags.length > 0 && (
            projectTags.map((tag) => (
              <span
                key={tag.project_name}
                className={styles.projectBadge}
                style={tag.color_hue != null ? {
                  background: `hsl(${tag.color_hue} 65% 45%)`,
                  color: hslNeedsDarkText(tag.color_hue, 65, 45) ? '#1a1a1a' : '#fff',
                } : undefined}
              >
                {tag.project_name}
              </span>
            ))
          )}
          <select
            className={styles.domainSelect}
            value={item.domain || 'other'}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onUpdate(item.id, { domain: e.target.value })}
          >
            {DOMAINS.filter((d) => d !== 'all').map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <span className={styles.type}>{item.content_type || item.source_type}</span>
          {item.github_metadata?.stars && (
            <span className={styles.stars}>★ {item.github_metadata.stars.toLocaleString()}</span>
          )}
          {item.github_metadata?.language && (
            <span className={styles.language}>{item.github_metadata.language}</span>
          )}
        </div>
      </div>

      {item.summary && <p className={styles.summary}>{item.summary}</p>}

      {isExpanded && (
        <div className={styles.cardDetails}>
          <div className={styles.detailRow}>
            <strong>Source:</strong>
            <a href={item.source_url} target="_blank" rel="noopener noreferrer">
              {item.source_url}
            </a>
          </div>
          {item.extracted_entities?.repos && item.extracted_entities.repos.length > 0 && (
            <div className={styles.detailRow}>
              <strong>GitHub Repos:</strong>
              <div className={styles.repoList}>
                {item.extracted_entities.repos.map((repo) => (
                  <a
                    key={repo}
                    href={repo}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.repoLink}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {repo.replace('https://github.com/', '')}
                  </a>
                ))}
              </div>
            </div>
          )}
          {item.tags && item.tags.length > 0 && (
            <div className={styles.detailRow}>
              <strong>Tags:</strong>
              <span className={styles.tags}>
                {item.tags.map((tag) => (
                  <span key={tag} className={styles.tag}>
                    {tag}
                  </span>
                ))}
              </span>
            </div>
          )}
          {item.transcript && (
            <div className={styles.detailRow}>
              <strong>Transcript:</strong>
              <p className={styles.transcript}>{item.transcript}</p>
            </div>
          )}
          {item.error_message && (
            <div className={styles.detailRow}>
              <strong>Error:</strong>
              <span className={styles.error}>{item.error_message}</span>
            </div>
          )}
          <div className={styles.cardActions}>
            {item.status === 'failed' && (
              <button
                className={styles.retryBtn}
                onClick={(e) => {
                  e.stopPropagation()
                  onRetry(item.id)
                }}
              >
                Retry
              </button>
            )}
            <button
              className={styles.deleteBtn}
              onClick={(e) => {
                e.stopPropagation()
                onDelete(item.id)
              }}
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
