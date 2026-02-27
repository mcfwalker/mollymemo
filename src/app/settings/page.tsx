'use client'

import { useEffect, useState } from 'react'
import styles from './page.module.css'

interface UserSettings {
  timezone: string
  report_frequency: string  // 'daily' | 'weekly' | 'none'
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
  const [apiKeys, setApiKeys] = useState<Array<{id: string, name: string, created_at: string, last_used_at: string | null}>>([])
  const [newKey, setNewKey] = useState<string | null>(null)
  const [generatingKey, setGeneratingKey] = useState(false)

  async function fetchApiKeys() {
    try {
      const res = await fetch('/api/keys')
      if (res.ok) {
        const data = await res.json()
        setApiKeys(data.keys)
      }
    } catch (err) {
      console.error('Error fetching API keys:', err)
    }
  }

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
    fetchApiKeys()
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

  const generateKey = async () => {
    setGeneratingKey(true)
    try {
      const res = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Chrome Extension' }),
      })
      if (res.ok) {
        const data = await res.json()
        setNewKey(data.key)
        await fetchApiKeys()
      }
    } catch (err) {
      console.error('Error generating API key:', err)
    } finally {
      setGeneratingKey(false)
    }
  }

  const revokeKey = async (id: string) => {
    try {
      const res = await fetch(`/api/keys/${id}`, { method: 'DELETE' })
      if (res.ok) {
        setApiKeys((keys) => keys.filter((k) => k.id !== id))
      }
    } catch (err) {
      console.error('Error revoking API key:', err)
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
      <h1 className={styles.title}>Settings</h1>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Trend Reports</h2>

        <div className={styles.settingCard}>
          <div className={styles.settingRow}>
            <div className={styles.settingInfo}>
              <span className={styles.settingLabel}>Report frequency</span>
              <span className={styles.settingDescription}>
                How often Molly generates written trend reports
              </span>
            </div>
            <select
              value={settings.report_frequency}
              onChange={(e) => updateSetting({ report_frequency: e.target.value })}
              disabled={saving}
              className={styles.select}
            >
              <option value="daily">Daily (Tue–Sun) + Weekly (Mon)</option>
              <option value="weekly">Weekly only (Mon)</option>
              <option value="none">None</option>
            </select>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>API Keys</h2>

        <div className={styles.settingCard}>
          <div className={styles.settingRow}>
            <div className={styles.settingInfo}>
              <span className={styles.settingLabel}>Chrome Extension</span>
              <span className={styles.settingDescription}>
                Generate an API key for the MollyMemo Chrome extension
              </span>
            </div>
            <button
              className={styles.button}
              onClick={generateKey}
              disabled={generatingKey}
            >
              {generatingKey ? 'Generating...' : 'Generate Key'}
            </button>
          </div>

          {newKey && (
            <div className={styles.keyReveal}>
              <p className={styles.keyWarning}>
                Copy this key now — it won&apos;t be shown again
              </p>
              <div className={styles.keyDisplay}>
                <code className={styles.keyCode}>{newKey}</code>
                <button
                  className={styles.copyButton}
                  onClick={() => navigator.clipboard.writeText(newKey)}
                >
                  Copy
                </button>
              </div>
            </div>
          )}

          {apiKeys.map((k) => (
            <div key={k.id} className={styles.keyRow}>
              <div className={styles.keyInfo}>
                <span className={styles.keyName}>{k.name}</span>
                <span className={styles.keyMeta}>
                  Created {new Date(k.created_at).toLocaleDateString()}
                  {k.last_used_at && ` · Last used ${new Date(k.last_used_at).toLocaleDateString()}`}
                </span>
              </div>
              <button
                className={styles.revokeButton}
                onClick={() => revokeKey(k.id)}
              >
                Revoke
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>General</h2>

        <div className={styles.settingCard}>
          <div className={styles.settingRow}>
            <div className={styles.settingInfo}>
              <span className={styles.settingLabel}>Timezone</span>
              <span className={styles.settingDescription}>
                Your local timezone for report scheduling
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
