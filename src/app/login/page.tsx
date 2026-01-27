'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import styles from './page.module.css'

const TITLE = "dont log in"

function FloatingLetter({
  letter,
  index,
}: {
  letter: string
  index: number
}) {
  return (
    <motion.span
      className={styles.letter}
      animate={{
        y: [0, -8, 0],
      }}
      transition={{
        y: {
          duration: 2,
          repeat: Infinity,
          ease: "easeInOut",
          delay: index * 0.15,
        },
      }}
    >
      {letter === ' ' ? '\u00A0' : letter}
    </motion.span>
  )
}

function FloatingTitle() {
  return (
    <div className={styles.floatingTitle}>
      {TITLE.split('').map((letter, index) => (
        <FloatingLetter
          key={index}
          letter={letter}
          index={index}
        />
      ))}
    </div>
  )
}

function LoginForm() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const searchParams = useSearchParams()

  // Handle auth errors from callback redirect
  useEffect(() => {
    const urlError = searchParams.get('error')
    if (urlError === 'auth_failed') {
      setError('Authentication failed. Please try again.')
    }
  }, [searchParams])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })

      if (res.ok) {
        setSent(true)
      } else {
        const data = await res.json()
        setError(data.error || 'Failed to send magic link')
      }
    } catch {
      setError('Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <div className={styles.form}>
        <p className={styles.success}>Check your email for the magic link</p>
        <button
          type="button"
          className={styles.button}
          onClick={() => setSent(false)}
        >
          try again
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <input
        type="email"
        placeholder="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className={styles.input}
        autoFocus
        required
      />
      {error && <p className={styles.error}>{error}</p>}
      <button type="submit" className={styles.button} disabled={loading}>
        {loading ? '...' : 'send magic link'}
      </button>
    </form>
  )
}

export default function LoginPage() {
  return (
    <main className={styles.main}>
      <div className={styles.container}>
        <img
          src="/laz_static_sm.png"
          alt=""
          className={styles.bgImage}
        />
        <div className={styles.content}>
          <FloatingTitle />
          <Suspense fallback={<div className={styles.form} />}>
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </main>
  )
}
