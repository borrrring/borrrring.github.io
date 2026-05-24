/**
 * Remark plugin to transform Obsidian-style wikilinks [[link]] to standard markdown links
 * 将 Obsidian 风格的双链 [[link]] 转换为标准 markdown 链接
 */
import type { Root, Text, Link } from 'mdast'
import type { Plugin } from 'unified'
import { visit } from 'unist-util-visit'

export interface WikilinkOptions {
  /** Base path for blog posts */
  basePath?: string
  /** Collection of valid slugs to validate links */
  validSlugs?: Set<string>
}

// Regex to match [[wikilink]] or [[wikilink|display text]]
const WIKILINK_REGEX = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g

/**
 * Parse a wikilink and return the target slug and display text
 */
function parseWikilink(match: string): { slug: string; displayText: string } | null {
  const wikilinkMatch = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/.exec(match)
  if (!wikilinkMatch) return null

  const rawSlug = wikilinkMatch[1].trim()
  const displayText = wikilinkMatch[2]?.trim() || rawSlug

  // Handle relative paths like ./slug or ../slug
  let slug = rawSlug
  if (slug.startsWith('./')) {
    slug = slug.slice(2)
  } else if (slug.startsWith('../')) {
    // Keep as is for parent directory references
    slug = rawSlug
  }

  // Remove .md or .mdx extension if present
  slug = slug.replace(/\.(md|mdx)$/, '')

  return { slug, displayText }
}

/**
 * Normalize a slug for comparison
 */
function normalizeSlug(slug: string): string {
  return slug
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-/]/g, '')
}

export const remarkWikilinks: Plugin<[WikilinkOptions?], Root> = function (options = {}) {
  const { basePath = '/blog', validSlugs } = options

  return function (tree, file) {
    // Collect wikilinks for backlink processing
    const foundLinks: string[] = []

    visit(tree, 'text', (node: Text, index, parent) => {
      if (!parent || index === undefined) return

      const text = node.value
      const matches = [...text.matchAll(WIKILINK_REGEX)]

      if (matches.length === 0) return

      // Build new children array with text and link nodes
      const newChildren: (Text | Link)[] = []
      let lastIndex = 0

      for (const match of matches) {
        const parsed = parseWikilink(match[0])
        if (!parsed) continue

        const { slug, displayText } = parsed
        const matchStart = match.index!
        const matchEnd = matchStart + match[0].length

        // Add text before this match
        if (matchStart > lastIndex) {
          newChildren.push({
            type: 'text',
            value: text.slice(lastIndex, matchStart)
          })
        }

        // Determine the link URL
        let linkUrl: string
        if (slug.startsWith('../') || slug.startsWith('./')) {
          // Relative path - keep as is
          linkUrl = slug
        } else {
          // Convert to absolute path
          const normalizedSlug = normalizeSlug(slug)
          linkUrl = `${basePath}/${normalizedSlug}`

          // Record the link for backlink processing
          foundLinks.push(normalizedSlug)
        }

        // Check if the link is valid (if validSlugs provided)
        const isValid = !validSlugs || validSlugs.has(normalizeSlug(slug))

        // Create link node
        const linkNode: Link = {
          type: 'link',
          url: linkUrl,
          title: isValid ? null : '⚠️ 此链接可能无效',
          children: [{ type: 'text', value: displayText }],
          data: {
            hProperties: {
              class: isValid ? 'wikilink' : 'wikilink wikilink-broken',
              'data-wikilink': 'true'
            }
          }
        }

        newChildren.push(linkNode)
        lastIndex = matchEnd
      }

      // Add remaining text after last match
      if (lastIndex < text.length) {
        newChildren.push({
          type: 'text',
          value: text.slice(lastIndex)
        })
      }

      // Replace the text node with new nodes
      if (newChildren.length > 0) {
        parent.children.splice(index, 1, ...newChildren)
      }
    })

    // Store found links in file data for backlink processing
    if (file.data.astro && foundLinks.length > 0) {
      ;(file.data.astro as any).wikilinks = foundLinks
    }
  }
}

export default remarkWikilinks

