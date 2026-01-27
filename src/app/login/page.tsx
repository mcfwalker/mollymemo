'use client'

import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
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
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      if (res.ok) {
        const from = searchParams.get('from') || '/'
        router.push(from)
        router.refresh()
      } else {
        const data = await res.json()
        setError(data.error || 'Invalid credentials')
      }
    } catch {
      setError('Something went wrong')
    } finally {
      setLoading(false)
    }
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
      />
      <input
        type="password"
        placeholder="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className={styles.input}
      />
      {error && <p className={styles.error}>{error}</p>}
      <button type="submit" className={styles.button} disabled={loading}>
        {loading ? '...' : 'enter'}
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
