const input = document.getElementById('apiKey')
const status = document.getElementById('status')

// Load saved key
chrome.storage.sync.get('apiKey', ({ apiKey }) => {
  if (apiKey) input.value = apiKey
})

// Save on change (debounced)
let saveTimer
input.addEventListener('input', () => {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const apiKey = input.value.trim()
    chrome.storage.sync.set({ apiKey }, () => {
      status.textContent = apiKey ? 'Key saved' : 'Key cleared'
      status.className = 'status saved'
      setTimeout(() => { status.className = 'status' }, 2000)
    })
  }, 500)
})
