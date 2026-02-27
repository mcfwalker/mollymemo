const API_BASE = 'https://mollymemo.com'

chrome.action.onClicked.addListener(async (tab) => {
  // Skip unsupported pages
  if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
    showBadge('!', '#f59e0b')
    return
  }

  // Get API key from storage
  const { apiKey } = await chrome.storage.sync.get('apiKey')
  if (!apiKey) {
    chrome.runtime.openOptionsPage()
    return
  }

  try {
    showBadge('...', '#64748b')

    const response = await fetch(`${API_BASE}/api/capture`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ url: tab.url }),
    })

    if (response.ok) {
      showBadge('\u2713', '#22c55e')
    } else if (response.status === 409) {
      showBadge('=', '#64748b') // Already captured
    } else if (response.status === 401) {
      showBadge('!', '#ef4444')
      chrome.runtime.openOptionsPage()
    } else {
      showBadge('\u2717', '#ef4444')
    }
  } catch {
    showBadge('\u2717', '#ef4444')
  }
})

function showBadge(text, color) {
  chrome.action.setBadgeText({ text })
  chrome.action.setBadgeBackgroundColor({ color })
  if (text !== '...') {
    setTimeout(() => chrome.action.setBadgeText({ text: '' }), 2000)
  }
}
