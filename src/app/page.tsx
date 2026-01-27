'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Item, CurrentMonthStats, getCurrentMonthStats, createBrowserClient } from '@/lib/supabase'
import { ThemeToggle } from '@/components/ThemeToggle'
import { FilterBar } from '@/components/FilterBar'
import { ItemCard } from '@/components/ItemCard'
import { StatsRow } from '@/components/StatsRow'
import styles from './page.module.css'

export default function Home() {
  const router = useRouter()
  const [items, setItems] = useState<Item[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [domain, setDomain] = useState('all')
  const [contentType, setContentType] = useState('all')
  const [status, setStatus] = useState('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [costStats, setCostStats] = useState<CurrentMonthStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(true)

  const handleLogout = async () => {
    await fetch('/api/auth', { method: 'DELETE' })
    router.push('/login')
  }

  const fetchItems = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (domain !== 'all') params.set('domain', domain)
    if (contentType !== 'all') params.set('type', contentType)
    if (status !== 'all') params.set('status', status)
    if (search) params.set('q', search)

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
  }, [domain, contentType, status, search])

  useEffect(() => {
    fetchItems()
  }, [fetchItems])

  useEffect(() => {
    async function fetchStats() {
      setStatsLoading(true)
      try {
        const supabase = createBrowserClient()
        const stats = await getCurrentMonthStats(supabase)
        setCostStats(stats)
      } catch (err) {
        console.error('Error fetching stats:', err)
      } finally {
        setStatsLoading(false)
      }
    }
    fetchStats()
  }, [])

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

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <h1 className={styles.title}>lazylist</h1>
        <div className={styles.headerRight}>
          <input
            type="text"
            placeholder="search..."
            className={styles.search}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <ThemeToggle />
          <button onClick={handleLogout} className={styles.logout}>
            logout
          </button>
        </div>
      </header>

      <StatsRow stats={costStats} loading={statsLoading} />

      <FilterBar
        domain={domain}
        contentType={contentType}
        status={status}
        total={total}
        onDomainChange={setDomain}
        onContentTypeChange={setContentType}
        onStatusChange={setStatus}
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
            />
          ))
        )}
      </div>
    </main>
  )
}
