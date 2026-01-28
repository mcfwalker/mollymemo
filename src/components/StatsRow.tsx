'use client'

import Link from 'next/link'
import { AllTimeStats } from '@/lib/supabase'
import styles from './StatsRow.module.css'

interface StatsRowProps {
  stats: AllTimeStats | null
  loading?: boolean
}

function formatCurrency(amount: number): string {
  return amount < 0.01 && amount > 0
    ? '<$0.01'
    : `$${amount.toFixed(2)}`
}

export function StatsRow({ stats, loading }: StatsRowProps) {
  if (loading) {
    return (
      <div className={styles.statsRow}>
        <span className={styles.statsText}>Loading stats...</span>
      </div>
    )
  }

  if (!stats || stats.entryCount === 0) {
    return (
      <div className={styles.statsRow}>
        <span className={styles.statsText}>
          All time: No entries yet
        </span>
        <Link href="/stats" className={styles.historyLink}>
          view history
        </Link>
      </div>
    )
  }

  const { entryCount, totalCost, avgCost } = stats

  return (
    <div className={styles.statsRow}>
      <span className={styles.statsText}>
        All time: {entryCount} {entryCount === 1 ? 'entry' : 'entries'}
        <span className={styles.separator}>•</span>
        {formatCurrency(avgCost)} avg
        <span className={styles.separator}>•</span>
        {formatCurrency(totalCost)} total
      </span>
      <Link href="/stats" className={styles.historyLink}>
        view history
      </Link>
    </div>
  )
}
