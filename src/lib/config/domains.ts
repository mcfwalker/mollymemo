// Domain configuration for content classification
// Add new domains here - the AI will use these descriptions to categorize content

export const domains: Record<string, string> = {
  'vibe-coding':
    'Software development, AI coding tools, developer productivity, programming techniques',
  'ai-filmmaking':
    'Video generation, AI video, filmmaking with AI, cinematography, visual effects',
  // Add new domains below:
  // 'robotics': 'Robotics, automation, physical AI systems, hardware projects',
  // 'design': 'UI/UX design, graphic design, product design, design tools',
  // 'hardware': 'Electronics, 3D printing, maker projects, IoT devices',
}

// Default domain when content doesn't match any defined domain
export const defaultDomain = 'other'

// Helper to get domain list for prompts
export function getDomainPromptList(): string {
  const domainEntries = Object.entries(domains)
    .map(([name, description]) => `"${name}" - ${description}`)
    .join('\n  ')

  return `${domainEntries}\n  "${defaultDomain}" - Content that doesn't fit other categories`
}
