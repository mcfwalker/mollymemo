'use client'

import { useEffect, useState, useCallback } from 'react'
import { Item } from '@/lib/supabase'
import { FilterBar } from '@/components/FilterBar'
import { ItemCard } from '@/components/ItemCard'
import styles from './page.module.css'

export default function Home() {
  const [items, setItems] = useState<Item[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [domain, setDomain] = useState('all')
  const [contentType, setContentType] = useState('all')
  const [status, setStatus] = useState('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [container, setContainer] = useState('all')
  const [containers, setContainers] = useState<{ id: string; name: string; item_count: number }[]>([])
  const [project, setProject] = useState('all')
  const [projects, setProjects] = useState<{ id: string; name: string; stage: string | null }[]>([])
  const [projectTags, setProjectTags] = useState<Record<string, { project_name: string; project_stage: string | null; color_hue: number | null }[]>>({})

  const fetchItems = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (domain !== 'all') params.set('domain', domain)
    if (contentType !== 'all') params.set('type', contentType)
    if (status !== 'all') params.set('status', status)
    if (search) params.set('q', search)
    if (container !== 'all') params.set('container', container)
    if (project !== 'all') params.set('project', project)

    try {
      const res = await fetch(`/api/items?${params}`)
      const data = await res.json()
      setItems(data.items || [])
      setTotal(data.total || 0)
    } catch (err) {
      console.error('Fetch error:', err)
    } finally {
      setLoading(false)
    }
  }, [domain, contentType, status, search, container, project])

  useEffect(() => {
    fetchItems()
  }, [fetchItems])

  // Sync browser timezone to user profile (fire-and-forget)
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    fetch('/api/users/timezone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timezone: tz }),
    }).catch(() => {}) // Silent failure - non-critical
  }, [])

  // Fetch containers for filter dropdown
  useEffect(() => {
    async function fetchContainers() {
      try {
        const res = await fetch('/api/containers')
        if (res.ok) {
          const data = await res.json()
          setContainers(data.containers || [])
        }
      } catch (err) {
        console.error('Error fetching containers:', err)
      }
    }
    fetchContainers()
  }, [])

  // Fetch projects for filter dropdown
  useEffect(() => {
    async function fetchProjects() {
      try {
        const res = await fetch('/api/projects')
        if (res.ok) {
          const data = await res.json()
          setProjects(data.projects || [])
        }
      } catch (err) {
        console.error('Error fetching projects:', err)
      }
    }
    fetchProjects()
  }, [])

  // Fetch project tags for visible items (lazy batch)
  useEffect(() => {
    async function fetchProjectTags() {
      if (items.length === 0) {
        setProjectTags({})
        return
      }
      const ids = items.map((item) => item.id).join(',')
      try {
        const res = await fetch(`/api/items/project-tags?ids=${ids}`)
        if (res.ok) {
          const data = await res.json()
          setProjectTags(data.tags || {})
        }
      } catch (err) {
        console.error('Error fetching project tags:', err)
      }
    }
    fetchProjectTags()
  }, [items])

  const updateItem = async (id: string, updates: Partial<Item>) => {
    try {
      const res = await fetch(`/api/items/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      if (res.ok) {
        const updated = await res.json()
        setItems((prev) => prev.map((item) => (item.id === id ? updated : item)))
      }
    } catch (err) {
      console.error('Update error:', err)
    }
  }

  const deleteItem = async (id: string) => {
    if (!confirm('Delete this item?')) return
    try {
      const res = await fetch(`/api/items/${id}`, { method: 'DELETE' })
      if (res.ok) {
        setItems((prev) => prev.filter((item) => item.id !== id))
        setTotal((prev) => prev - 1)
        setExpandedId(null)
      }
    } catch (err) {
      console.error('Delete error:', err)
    }
  }

  const retryItem = async (id: string) => {
    try {
      const res = await fetch(`/api/items/${id}`, { method: 'POST' })
      if (res.ok) {
        setItems((prev) =>
          prev.map((item) =>
            item.id === id ? { ...item, status: 'pending', error_message: null } : item
          )
        )
      }
    } catch (err) {
      console.error('Retry error:', err)
    }
  }

  return (
    <>
      <input
        type="text"
        placeholder="search..."
        className={styles.search}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <FilterBar
        domain={domain}
        contentType={contentType}
        status={status}
        total={total}
        container={container}
        containers={containers}
        onDomainChange={setDomain}
        onContentTypeChange={setContentType}
        onStatusChange={setStatus}
        onContainerChange={setContainer}
        project={project}
        projects={projects}
        onProjectChange={setProject}
      />

      <div className={styles.list}>
        {loading ? (
          <div className={styles.loading}>Loading...</div>
        ) : items.length === 0 ? (
          <div className={styles.empty}>No items found</div>
        ) : (
          items.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              isExpanded={expandedId === item.id}
              onToggleExpand={() => setExpandedId(expandedId === item.id ? null : item.id)}
              onUpdate={updateItem}
              onDelete={deleteItem}
              onRetry={retryItem}
              projectTags={projectTags[item.id]}
            />
          ))
        )}
      </div>
    </>
  )
}
