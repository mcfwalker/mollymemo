'use client'

import { useEffect, useState } from 'react'
import { Report } from '@/lib/supabase'
import styles from './page.module.css'

export default function ReportsPage() {
  const [reports, setReports] = useState<Report[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [typeFilter, setTypeFilter] = useState('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    async function fetchReports() {
      setLoading(true)
      const params = new URLSearchParams()
      if (typeFilter !== 'all') params.set('type', typeFilter)

      try {
        const res = await fetch(`/api/reports?${params}`)
        const data = await res.json()
        setReports(data.reports || [])
        setTotal(data.total || 0)
      } catch (err) {
        console.error('Error fetching reports:', err)
      } finally {
        setLoading(false)
      }
    }
    fetchReports()
  }, [typeFilter])

  return (
    <>
      <div className={styles.header}>
        <h1 className={styles.title}>Reports</h1>
        <div className={styles.controls}>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className={styles.select}
          >
            <option value="all">All reports</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </select>
          <span className={styles.count}>{total} report{total !== 1 ? 's' : ''}</span>
        </div>
      </div>

      <div className={styles.list}>
        {loading ? (
          <div className={styles.empty}>Loading...</div>
        ) : reports.length === 0 ? (
          <div className={styles.empty}>
            No reports yet. Reports are generated automatically — daily (Tue-Sun) and weekly (Monday).
          </div>
        ) : (
          reports.map((report) => (
            <ReportCard
              key={report.id}
              report={report}
              isExpanded={expandedId === report.id}
              onToggle={() =>
                setExpandedId(expandedId === report.id ? null : report.id)
              }
            />
          ))
        )}
      </div>
    </>
  )
}

function ReportCard({
  report,
  isExpanded,
  onToggle,
}: {
  report: Report
  isExpanded: boolean
  onToggle: () => void
}) {
  const date = new Date(report.generated_at)
  const formattedDate = date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
  const formattedTime = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })

  return (
    <div
      className={`${styles.card} ${isExpanded ? styles.expanded : ''}`}
      onClick={onToggle}
    >
      <div className={styles.cardHeader}>
        <div className={styles.cardTitleRow}>
          <span className={`${styles.badge} ${styles[report.report_type]}`}>
            {report.report_type}
          </span>
          <span className={styles.cardTitle}>{report.title}</span>
        </div>
        <div className={styles.cardMeta}>
          <span>{formattedDate} at {formattedTime}</span>
          <span className={styles.sep}>&middot;</span>
          <span>{report.item_count} item{report.item_count !== 1 ? 's' : ''} analyzed</span>
          {report.projects_mentioned && report.projects_mentioned.length > 0 && (
            <>
              <span className={styles.sep}>&middot;</span>
              <span className={styles.projectsList}>
                {report.projects_mentioned.map((p) => p.name).join(', ')}
              </span>
            </>
          )}
        </div>
      </div>

      {isExpanded && (
        <div className={styles.cardContent}>
          <div
            className={styles.markdown}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(report.content) }}
          />
          <div className={styles.cardFooter}>
            <span className={styles.window}>
              Window: {new Date(report.window_start).toLocaleDateString()} &ndash;{' '}
              {new Date(report.window_end).toLocaleDateString()}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

// Minimal markdown renderer — handles headers, bold, bullets, and paragraphs
function renderMarkdown(md: string): string {
  return md
    .split('\n')
    .map((line) => {
      // Headers
      if (line.startsWith('### '))
        return `<h4>${escapeHtml(line.slice(4))}</h4>`
      if (line.startsWith('## '))
        return `<h3>${escapeHtml(line.slice(3))}</h3>`
      // Bullet points
      if (line.startsWith('- '))
        return `<li>${inlineFormat(line.slice(2))}</li>`
      // Empty lines
      if (line.trim() === '') return '<br/>'
      // Regular paragraph
      return `<p>${inlineFormat(line)}</p>`
    })
    .join('\n')
}

function inlineFormat(text: string): string {
  return escapeHtml(text).replace(
    /\*\*(.+?)\*\*/g,
    '<strong>$1</strong>'
  )
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
