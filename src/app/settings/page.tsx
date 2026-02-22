'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ThemeToggle } from '@/components/ThemeToggle'
import styles from './page.module.css'

interface UserSettings {
  digest_frequency: string  // 'daily' | 'weekly' | 'never'
  digest_day: number        // 0=Sun, 1=Mon, ..., 6=Sat
  digest_time: string
  timezone: string
}

const TIMEZONES = [
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'America/Toronto',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Australia/Sydney',
]

function formatTimezone(tz: string): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'short',
    })
    const parts = formatter.formatToParts(new Date())
    const abbr = parts.find((p) => p.type === 'timeZoneName')?.value || ''
    return `${tz.replace(/_/g, ' ')} (${abbr})`
  } catch {
    return tz
  }
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<UserSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    async function fetchSettings() {
      try {
        const res = await fetch('/api/users/settings')
        if (res.ok) {
          const data = await res.json()
          setSettings(data)
        }
      } catch (err) {
        console.error('Error fetching settings:', err)
      } finally {
        setLoading(false)
      }
    }
    fetchSettings()
  }, [])

  const updateSetting = async (updates: Partial<UserSettings>) => {
    if (!settings) return

    setSaving(true)
    try {
      const res = await fetch('/api/users/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      if (res.ok) {
        setSettings({ ...settings, ...updates })
      }
    } catch (err) {
      console.error('Error updating settings:', err)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <main className={styles.main}>
        <div className={styles.loading}>Loading settings...</div>
      </main>
    )
  }

  if (!settings) {
    return (
      <main className={styles.main}>
        <div className={styles.error}>Failed to load settings</div>
      </main>
    )
  }

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <Link href="/" className={styles.backLink}>
          &larr; Back to List
        </Link>
        <ThemeToggle />
      </header>

      <h1 className={styles.title}>Settings</h1>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Daily Digest</h2>

        <div className={styles.settingCard}>
          <div className={styles.settingRow}>
            <div className={styles.settingInfo}>
              <span className={styles.settingLabel}>Enable daily digest</span>
              <span className={styles.settingDescription}>
                Receive a voice summary of your captured items
              </span>
            </div>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={settings.digest_enabled}
                onChange={(e) =>
                  updateSetting({ digest_enabled: e.target.checked })
                }
                disabled={saving}
              />
              <span className={styles.toggleSlider}></span>
            </label>
          </div>
        </div>

        <div className={styles.settingCard}>
          <div className={styles.settingRow}>
            <div className={styles.settingInfo}>
              <span className={styles.settingLabel}>Delivery time</span>
              <span className={styles.settingDescription}>
                When to send your daily digest
              </span>
            </div>
            <input
              type="time"
              value={settings.digest_time}
              onChange={(e) => updateSetting({ digest_time: e.target.value })}
              disabled={saving || !settings.digest_enabled}
              className={styles.timeInput}
            />
          </div>
        </div>

        <div className={styles.settingCard}>
          <div className={styles.settingRow}>
            <div className={styles.settingInfo}>
              <span className={styles.settingLabel}>Timezone</span>
              <span className={styles.settingDescription}>
                Your local timezone for digest scheduling
              </span>
            </div>
            <select
              value={settings.timezone}
              onChange={(e) => updateSetting({ timezone: e.target.value })}
              disabled={saving}
              className={styles.select}
            >
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {formatTimezone(tz)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {saving && <div className={styles.saving}>Saving...</div>}
    </main>
  )
}
