// X/Twitter processor using oembed API (no auth required)

interface XMetadata {
  text: string
  authorName: string
  authorUrl: string
  resolvedUrls: string[]
  isLinkOnly: boolean      // Tweet text is just a URL with no commentary
  xArticleUrl: string | null  // If resolved URL is an X Article (requires login)
}

export async function processX(url: string): Promise<XMetadata | null> {
  try {
    // Normalize twitter.com to x.com
    const normalizedUrl = url.replace('twitter.com', 'x.com')

    const oembedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(normalizedUrl)}&omit_script=true`

    const response = await fetch(oembedUrl)

    if (!response.ok) {
      console.error(`X oembed error: ${response.status}`)
      return null
    }

    const data = await response.json()

    // Extract text from HTML (oembed returns HTML blockquote)
    const htmlText = data.html as string

    // Extract the tweet text from the <p> tag, stripping all HTML tags
    const pMatch = htmlText.match(/<p[^>]*>([\s\S]*?)<\/p>/)
    let text = ''
    if (pMatch) {
      text = pMatch[1]
        // Replace <br> with newlines
        .replace(/<br\s*\/?>/gi, '\n')
        // Strip all HTML tags but keep their text content
        .replace(/<[^>]+>/g, '')
        // Decode HTML entities
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .trim()
    }

    // Extract t.co URLs from the HTML and resolve them
    const tcoUrls = htmlText.match(/https:\/\/t\.co\/[a-zA-Z0-9]+/g) || []
    const resolvedUrls: string[] = []

    for (const tcoUrl of tcoUrls.slice(0, 5)) {
      try {
        // Follow redirect to get real URL
        const res = await fetch(tcoUrl, { redirect: 'manual' })
        const location = res.headers.get('location')
        if (location && !location.includes('t.co')) {
          resolvedUrls.push(location)
        }
      } catch {
        // Ignore failed redirects
      }
    }

    // Check if tweet is link-only (just URLs, no real commentary)
    const textWithoutUrls = text.replace(/https?:\/\/\S+/g, '').trim()
    const isLinkOnly = textWithoutUrls.length < 10 // Less than 10 chars of actual text

    // Check if any resolved URL is an X Article (requires login)
    const xArticleUrl = resolvedUrls.find(url => url.includes('x.com/i/article/')) || null

    return {
      text,
      authorName: data.author_name,
      authorUrl: data.author_url,
      resolvedUrls,
      isLinkOnly,
      xArticleUrl,
    }
  } catch (error) {
    console.error('X processing error:', error)
    return null
  }
}
