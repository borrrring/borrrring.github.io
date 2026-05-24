import type { AstroGlobal } from 'astro'
import type { CollectionEntry } from 'astro:content'
import { getCollection } from 'astro:content'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'
import type { Root } from 'mdast'

interface ContentDetails {
  slug: string
  title: string
  content: string
  tags: string[]
  links: string[]
  collection: 'blog' | 'docs'
  publishDate?: string
}

interface ContentIndex {
  [slug: string]: ContentDetails
}

// Extract text content from markdown AST, removing markdown syntax
function extractText(node: Root): string {
  const textParts: string[] = []
  
  visit(node, (node) => {
    if (node.type === 'text') {
      textParts.push(node.value)
    } else if (node.type === 'code' && 'value' in node) {
      textParts.push(node.value)
    }
  })
  
  return textParts.join(' ').replace(/\s+/g, ' ').trim()
}

// Get slug from collection entry
function getSlug(entry: CollectionEntry<'blog' | 'docs'>): string {
  if (entry.collection === 'blog') {
    return `blog/${entry.id}`
  }
  return `docs/${entry.id}`
}

// Regex to match wikilinks [[link]] or [[link|display text]]
const WIKILINK_REGEX = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g

// Normalize a slug for comparison
function normalizeSlug(slug: string): string {
  return slug
    .toLowerCase()
    .trim()
    .replace(/\.(md|mdx)$/, '')
    .replace(/[^\w\-/]/g, '')
}

// Get links from markdown content (including wikilinks)
function extractLinks(node: Root, rawContent: string, currentCollection: 'blog' | 'docs'): string[] {
  const links: string[] = []
  
  // Extract wikilinks from raw content
  const wikiMatches = rawContent.matchAll(WIKILINK_REGEX)
  for (const match of wikiMatches) {
    let slug = match[1].trim()
    
    // Remove ./ prefix if present
    if (slug.startsWith('./')) {
      slug = slug.slice(2)
    }
    
    // Remove .md or .mdx extension if present
    slug = slug.replace(/\.(md|mdx)$/, '')
    
    // Normalize slug
    const normalizedSlug = normalizeSlug(slug)
    
    if (normalizedSlug && !normalizedSlug.startsWith('http')) {
      // Convert to absolute path
      // If slug doesn't specify collection, use current collection
      if (!normalizedSlug.startsWith('blog/') && !normalizedSlug.startsWith('docs/')) {
        links.push(`/${currentCollection}/${normalizedSlug}`)
      } else {
        links.push(`/${normalizedSlug}`)
      }
    }
  }
  
      // Extract standard markdown links
      visit(node, (node) => {
        if (node.type === 'link' && 'url' in node) {
          const url = node.url as string
          // Only include internal links
          if (url.startsWith('/') || url.startsWith('./') || url.startsWith('../')) {
            // Normalize relative paths
            let normalizedUrl = url
            if (url.startsWith('./')) {
              normalizedUrl = `/${currentCollection}/${url.slice(2)}`
            } else if (url.startsWith('../')) {
              // Keep relative paths as is for now
              normalizedUrl = url
            }
            links.push(normalizedUrl)
          }
        }
      })
  
  // Remove duplicates and normalize
  return [...new Set(links.map(link => {
    // Normalize links
    if (link.startsWith('./')) {
      link = link.slice(2)
    }
    if (link.startsWith('../')) {
      // Keep relative paths as is for now
      return link
    }
    // Ensure absolute paths start with /
    if (!link.startsWith('/')) {
      link = `/${link}`
    }
    return link
  }))]
}

const GET = async (_context: AstroGlobal) => {
  const blogPosts = await getCollection('blog', ({ data }) => {
    return import.meta.env.PROD ? !data.draft : true
  })
  
  const docs = await getCollection('docs', ({ data }) => {
    return import.meta.env.PROD ? !data.draft : true
  })
  
  const allEntries: CollectionEntry<'blog' | 'docs'>[] = [...blogPosts, ...docs]
  
  const contentIndex: ContentIndex = {}
  
  for (const entry of allEntries) {
    const slug = getSlug(entry)
    
    // Parse markdown to extract text and links
    if (!entry.body) continue
    const ast = unified().use(remarkParse).parse(entry.body)
    const textContent = extractText(ast as Root)
    // Pass raw content and collection to extract wikilinks
    const links = extractLinks(ast as Root, entry.body, entry.collection)
    
    contentIndex[slug] = {
      slug,
      title: entry.data.title || '',
      content: textContent,
      tags: entry.data.tags || [],
      links,
      collection: entry.collection,
      publishDate: entry.data.publishDate ? entry.data.publishDate.toISOString() : undefined
    }
  }
  
  return new Response(JSON.stringify(contentIndex), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600'
    }
  })
}

export { GET }

