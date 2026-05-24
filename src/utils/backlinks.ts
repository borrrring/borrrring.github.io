/**
 * Backlinks utility - collects and manages backlinks between blog posts
 */

// Regex patterns for link detection
const WIKILINK_REGEX = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g
const MARKDOWN_LINK_REGEX = /\[([^\]]+)\]\(([^)]+)\)/g
const RELATIVE_LINK_REGEX = /\(\.\/([^)]+)\)/g

export interface Backlink {
  /** The ID/slug of the linking post */
  id: string
  /** The title of the linking post */
  title: string
  /** A snippet of text around the link */
  context?: string
  /** The URL to the linking post */
  url: string
  /** The publish date of the linking post */
  date?: Date
}

export interface BacklinksMap {
  [targetId: string]: Backlink[]
}

/** Minimal post interface for backlinks processing */
interface PostLike {
  id: string
  body?: string
  data: {
    title: string
    publishDate?: Date
  }
}

/**
 * Normalize a slug/id for comparison
 */
function normalizeId(id: string): string {
  return id
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/\.(md|mdx)$/, '')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/index$/, '')
}

/**
 * Extract all links from post content (body)
 */
function extractLinksFromContent(content: string): string[] {
  const links: string[] = []

  // Extract wikilinks [[link]]
  const wikiMatches = content.matchAll(WIKILINK_REGEX)
  for (const match of wikiMatches) {
    let slug = match[1].trim()
    // Remove ./ prefix if present
    if (slug.startsWith('./')) {
      slug = slug.slice(2)
    }
    links.push(normalizeId(slug))
  }

  // Extract relative markdown links (./slug)
  const relativeMatches = content.matchAll(RELATIVE_LINK_REGEX)
  for (const match of relativeMatches) {
    links.push(normalizeId(match[1]))
  }

  // Extract standard markdown links that point to /blog/
  const mdMatches = content.matchAll(MARKDOWN_LINK_REGEX)
  for (const match of mdMatches) {
    const url = match[2]
    if (url.startsWith('/blog/') || url.includes('/blog/')) {
      const slug = url.replace(/^.*\/blog\//, '').replace(/\/$/, '')
      if (slug) {
        links.push(normalizeId(slug))
      }
    }
  }

  return [...new Set(links)] // Remove duplicates
}

/**
 * Get a context snippet around a link
 */
function getContextSnippet(content: string, targetSlug: string, maxLength: number = 100): string | undefined {
  // Try to find wikilink first
  const wikilinkPattern = new RegExp(`\\[\\[${escapeRegex(targetSlug)}(?:\\|[^\\]]+)?\\]\\]`, 'i')
  let match = wikilinkPattern.exec(content)
  
  // Try relative link
  if (!match) {
    const relativePattern = new RegExp(`\\(\\./${escapeRegex(targetSlug)}\\)`, 'i')
    match = relativePattern.exec(content)
  }

  if (!match) return undefined

  const start = Math.max(0, match.index - 50)
  const end = Math.min(content.length, match.index + match[0].length + 50)
  
  let snippet = content.slice(start, end)
  
  // Clean up the snippet
  snippet = snippet
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  // Add ellipsis if truncated
  if (start > 0) snippet = '...' + snippet
  if (end < content.length) snippet = snippet + '...'

  return snippet.slice(0, maxLength)
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Build a backlinks map from a collection of posts
 * @param posts - Array of blog posts
 * @param basePath - Base URL path for blog posts
 * @returns A map of target post IDs to their backlinks
 */
export async function buildBacklinksMap(
  posts: PostLike[],
  basePath: string = '/blog'
): Promise<BacklinksMap> {
  const backlinksMap: BacklinksMap = {}
  
  // Initialize empty arrays for all posts
  for (const post of posts) {
    const normalizedId = normalizeId(post.id)
    backlinksMap[normalizedId] = []
  }

  // Build map of valid slugs
  const validSlugs = new Set(posts.map(p => normalizeId(p.id)))

  // Process each post to find outgoing links
  for (const post of posts) {
    const sourceId = normalizeId(post.id)
    const content = post.body || ''
    
    // Extract all links from this post
    const links = extractLinksFromContent(content)

    for (const targetSlug of links) {
      // Skip self-references
      if (targetSlug === sourceId) continue
      
      // Only add backlink if target exists
      if (validSlugs.has(targetSlug)) {
        if (!backlinksMap[targetSlug]) {
          backlinksMap[targetSlug] = []
        }

        // Avoid duplicate backlinks
        const exists = backlinksMap[targetSlug].some(bl => bl.id === sourceId)
        if (!exists) {
          backlinksMap[targetSlug].push({
            id: sourceId,
            title: post.data.title,
            context: getContextSnippet(content, targetSlug),
            url: `${basePath}/${sourceId}`,
            date: post.data.publishDate
          })
        }
      }
    }
  }

  return backlinksMap
}

/**
 * Get backlinks for a specific post
 */
export function getBacklinksForPost(
  backlinksMap: BacklinksMap,
  postId: string
): Backlink[] {
  const normalizedId = normalizeId(postId)
  return backlinksMap[normalizedId] || []
}

/**
 * Get all posts that the current post links to (outgoing links)
 */
export function getOutgoingLinks(
  post: PostLike,
  posts: PostLike[],
  basePath: string = '/blog'
): Backlink[] {
  const content = post.body || ''
  const links = extractLinksFromContent(content)
  const validPosts = new Map(posts.map(p => [normalizeId(p.id), p]))
  
  const outgoing: Backlink[] = []
  const seen = new Set<string>()

  for (const targetSlug of links) {
    if (seen.has(targetSlug)) continue
    seen.add(targetSlug)

    const targetPost = validPosts.get(targetSlug)
    if (targetPost) {
      outgoing.push({
        id: targetSlug,
        title: targetPost.data.title,
        url: `${basePath}/${targetSlug}`,
        date: targetPost.data.publishDate
      })
    }
  }

  return outgoing
}
