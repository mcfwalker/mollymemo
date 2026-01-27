'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { MonthStats } from '@/lib/supabase'
import { ThemeToggle } from '@/components/ThemeToggle'
import styles from './page.module.css'

function formatCurrency(amount: number): string {
  return amount < 0.01 && amount > 0
    ? '<$0.01'
    : `$${amount.toFixed(2)}`
}

function formatMonth(isoDate: string): string {
  const date = new Date(isoDate)
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

interface AllTimeStats {
  entryCount: number
  openaiCost: number
  grokCost: number
  totalCost: number
  avgCost: number
}

function calculateAllTimeStats(monthlyStats: MonthStats[]): AllTimeStats {
  const entryCount = monthlyStats.reduce((sum, m) => sum + m.entryCount, 0)
  const openaiCost = monthlyStats.reduce((sum, m) => sum + m.openaiCost, 0)
  const grokCost = monthlyStats.reduce((sum, m) => sum + m.grokCost, 0)
  const totalCost = openaiCost + grokCost
  const avgCost = entryCount > 0 ? totalCost / entryCount : 0

  return { entryCount, openaiCost, grokCost, totalCost, avgCost }
}

export default function StatsPage() {
  const [monthlyStats, setMonthlyStats] = useState<MonthStats[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchStats() {
      try {
        const res = await fetch('/api/stats/monthly')
        if (res.ok) {
          const stats = await res.json()
          setMonthlyStats(stats)
        }
      } catch (err) {
        console.error('Error fetching stats:', err)
      } finally {
        setLoading(false)
      }
    }
    fetchStats()
  }, [])

  const allTime = calculateAllTimeStats(monthlyStats)

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <Link href="/" className={styles.backLink}>
          &larr; Back to List
        </Link>
        <ThemeToggle />
      </header>

      <h1 className={styles.title}>Cost History</h1>

      {loading ? (
        <div className={styles.loading}>Loading stats...</div>
      ) : monthlyStats.length === 0 ? (
        <div className={styles.empty}>No cost data yet. Process some items to see stats.</div>
      ) : (
        <>
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>All Time</h2>
            <div className={styles.statsCard}>
              <div className={styles.statsMain}>
                <span>{allTime.entryCount} {allTime.entryCount === 1 ? 'entry' : 'entries'}</span>
                <span className={styles.separator}>•</span>
                <span>{formatCurrency(allTime.avgCost)} avg</span>
                <span className={styles.separator}>•</span>
                <span className={styles.total}>{formatCurrency(allTime.totalCost)} total</span>
              </div>
              <div className={styles.statsBreakdown}>
                <span>GPT-4o-mini: {formatCurrency(allTime.openaiCost)}</span>
                <span>Grok: {formatCurrency(allTime.grokCost)}</span>
              </div>
            </div>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Monthly Breakdown</h2>
            {monthlyStats.map((month) => (
              <div key={month.month} className={styles.statsCard}>
                <h3 className={styles.monthTitle}>{formatMonth(month.month)}</h3>
                <div className={styles.statsMain}>
                  <span>{month.entryCount} {month.entryCount === 1 ? 'entry' : 'entries'}</span>
                  <span className={styles.separator}>•</span>
                  <span>{formatCurrency(month.avgCost)} avg</span>
                  <span className={styles.separator}>•</span>
                  <span className={styles.total}>{formatCurrency(month.totalCost)} total</span>
                </div>
                <div className={styles.statsBreakdown}>
                  <span>GPT-4o-mini: {formatCurrency(month.openaiCost)}</span>
                  <span>Grok: {formatCurrency(month.grokCost)}</span>
                </div>
              </div>
            ))}
          </section>
        </>
      )}
    </main>
  )
}
