'use client'

import { useState, useRef, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import styles from './page.module.css'

const TITLE = "dont login"

// Colors for each letter when in "color mode"
const LETTER_COLORS = [
  '#FF6B6B', // d - coral
  '#FFA94D', // o - orange
  '#FFD43B', // n - yellow
  '#69DB7C', // t - green
  '#69DB7C', // (space)
  '#4DABF7', // l - blue
  '#9775FA', // o - purple
  '#F783AC', // g - pink
  '#FF6B6B', // i - coral
  '#4DABF7', // n - blue
]

function FloatingLetter({
  letter,
  index,
  isColorful
}: {
  letter: string
  index: number
  isColorful: boolean
}) {
  return (
    <motion.span
      className={styles.letter}
      animate={{
        y: [0, -8, 0],
        color: isColorful ? LETTER_COLORS[index] : '#000000',
      }}
      transition={{
        y: {
          duration: 2,
          repeat: Infinity,
          ease: "easeInOut",
          delay: index * 0.15,
        },
        color: {
          duration: 0.5,
          ease: "easeInOut",
        }
      }}
    >
      {letter === ' ' ? '\u00A0' : letter}
    </motion.span>
  )
}

function FloatingTitle({ isColorful }: { isColorful: boolean }) {
  return (
    <div className={styles.floatingTitle}>
      {TITLE.split('').map((letter, index) => (
        <FloatingLetter
          key={index}
          letter={letter}
          index={index}
          isColorful={isColorful}
        />
      ))}
    </div>
  )
}

function LoginForm() {
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
        body: JSON.stringify({ password }),
      })

      if (res.ok) {
        const from = searchParams.get('from') || '/'
        router.push(from)
        router.refresh()
      } else {
        const data = await res.json()
        setError(data.error || 'Invalid password')
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
        type="password"
        placeholder="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className={styles.input}
        autoFocus
      />
      {error && <p className={styles.error}>{error}</p>}
      <button type="submit" className={styles.button} disabled={loading}>
        {loading ? '...' : 'enter'}
      </button>
    </form>
  )
}

export default function LoginPage() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isColorful, setIsColorful] = useState(false)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const handleTimeUpdate = () => {
      const time = video.currentTime
      // Color mode between 3-6 seconds
      setIsColorful(time >= 3 && time <= 6)
    }

    video.addEventListener('timeupdate', handleTimeUpdate)
    return () => video.removeEventListener('timeupdate', handleTimeUpdate)
  }, [])

  return (
    <main className={styles.main}>
      <div className={styles.container}>
        <video
          ref={videoRef}
          className={styles.bgVideo}
          autoPlay
          loop
          muted
          playsInline
        >
          <source src="/lazy_list_vid2.mp4" type="video/mp4" />
        </video>

        <div className={styles.content}>
          <FloatingTitle isColorful={isColorful} />
          <Suspense fallback={<div className={styles.form} />}>
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </main>
  )
}
