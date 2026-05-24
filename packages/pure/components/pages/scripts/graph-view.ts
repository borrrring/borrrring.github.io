// Graph View component script
import * as d3 from 'd3'

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

interface GraphNode {
  id: string
  slug: string
  title: string
  radius: number
  x?: number
  y?: number
  fx?: number | null
  fy?: number | null
  visited?: boolean
  collection?: 'blog' | 'docs'
  isTag?: boolean
  isCategory?: boolean
}

interface GraphLink {
  source: string | GraphNode
  target: string | GraphNode
}

interface GraphConfig {
  drag: boolean
  zoom: boolean
  depth: number
  scale: number
  repelForce: number
  centerForce: number
  linkDistance: number
  fontSize: number
  opacityScale: number
  enableRadial: boolean
  focusOnHover: boolean
}

const localGraphConfig: GraphConfig = {
  drag: true,
  zoom: true,
  depth: 1,
  scale: 1.1,
  repelForce: 0.5,
  centerForce: 0.3,
  linkDistance: 30,
  fontSize: 0.6,
  opacityScale: 1,
  enableRadial: false,
  focusOnHover: false,
}

const globalGraphConfig: GraphConfig = {
  drag: true,
  zoom: true,
  depth: -1,
  scale: 0.9,
  repelForce: 0.5,
  centerForce: 0.2,
  linkDistance: 30,
  fontSize: 0.6,
  opacityScale: 1,
  enableRadial: true,
  focusOnHover: true,
}

class GraphView {
  private canvas: HTMLElement
  private toggleBtn: HTMLElement
  private currentSlug: string | null
  private contentIndex: ContentIndex | null = null
  private nodes: GraphNode[] = []
  private links: GraphLink[] = []
  private simulation: d3.Simulation<GraphNode, GraphLink> | null = null
  private svg: d3.Selection<SVGSVGElement, unknown, null, undefined> | null = null
  private g: d3.Selection<SVGGElement, unknown, null, undefined> | null = null
  private isGlobal: boolean = false
  private config: GraphConfig = localGraphConfig
  private hoveredNodeId: string | null = null
  private hoveredNeighbours: Set<string> = new Set()
  private fullscreenOverlay: HTMLElement | null = null
  private fullscreenCanvas: HTMLElement | null = null
  private hasCenteredFullscreen: boolean = false

  constructor(container: HTMLElement, currentSlug?: string) {
    this.canvas = container.querySelector('#graph-canvas') as HTMLElement
    this.toggleBtn = container.querySelector('#graph-toggle') as HTMLElement
    this.currentSlug = currentSlug || null

    this.init()
  }

  async init() {
    // Load content index
    try {
      const response = await fetch('/contentIndex.json')
      if (!response.ok) {
        throw new Error('Failed to fetch contentIndex.json')
      }
      this.contentIndex = await response.json()
    } catch (error) {
      console.error('Error loading content index:', error)
      return
    }

    // Setup toggle button
    this.toggleBtn.addEventListener('click', () => {
      this.isGlobal = !this.isGlobal
      this.config = this.isGlobal ? globalGraphConfig : localGraphConfig
      if (this.isGlobal) {
        this.showFullscreenGraph()
      } else {
        this.hideFullscreenGraph()
        this.updateGraph()
      }
    })

    // Initial render
    this.updateGraph()
  }

  buildGraph() {
    if (!this.contentIndex) return

    const nodesMap = new Map<string, GraphNode>()
    const links: GraphLink[] = []

    // Build nodes and links
    Object.entries(this.contentIndex).forEach(([slug, details]) => {
      // Check if node should be included
      if (this.config.depth >= 0 && this.currentSlug) {
        // Local graph: only include nodes within depth hops
        if (slug !== this.currentSlug && !this.isWithinDepth(slug, this.currentSlug, this.config.depth)) {
          return
        }
      }

      // Create or get node
      if (!nodesMap.has(slug)) {
        // Calculate node radius based on link count (similar to Quartz: 2 + sqrt(numLinks))
        const linkCount = details.links.length
        const incomingCount = this.getIncomingLinks(slug).length
        const totalLinks = linkCount + incomingCount
        const radius = 2 + Math.sqrt(totalLinks)

        nodesMap.set(slug, {
          id: slug,
          slug,
          title: details.title,
          radius: Math.max(2, Math.min(10, radius)),
          visited: this.isVisited(slug),
          collection: details.collection,
          isTag: false,
        })
      }

      // Create links
      details.links.forEach((linkSlug) => {
        // Normalize link slug
        const normalizedLink = this.normalizeSlug(linkSlug)
        if (this.contentIndex![normalizedLink]) {
          // Ensure target node exists
          if (!nodesMap.has(normalizedLink)) {
            const targetDetails = this.contentIndex![normalizedLink]
            const targetLinkCount = targetDetails.links.length
            const targetIncomingCount = this.getIncomingLinks(normalizedLink).length
            const targetTotalLinks = targetLinkCount + targetIncomingCount
            const targetRadius = 2 + Math.sqrt(targetTotalLinks)

            nodesMap.set(normalizedLink, {
              id: normalizedLink,
              slug: normalizedLink,
              title: targetDetails.title,
              radius: Math.max(2, Math.min(10, targetRadius)),
              visited: this.isVisited(normalizedLink),
              collection: targetDetails.collection,
              isTag: false,
            })
          }

          links.push({
            source: slug,
            target: normalizedLink,
          })
        }
      })

      // Create tag nodes and links
      if (details.tags && details.tags.length > 0) {
        details.tags.forEach((tag) => {
          const tagSlug = `tags/${tag}`
          
          // Check if tag node should be included (for local graph)
          if (this.config.depth >= 0 && this.currentSlug) {
            // For local graph, only include tags if the current node is within depth
            if (slug !== this.currentSlug && !this.isWithinDepth(slug, this.currentSlug, this.config.depth)) {
              return
            }
          }

          // Create or get tag node
          if (!nodesMap.has(tagSlug)) {
            nodesMap.set(tagSlug, {
              id: tagSlug,
              slug: tagSlug,
              title: tag,
              radius: 3,
              visited: false,
              collection: 'blog', // Tags don't have a collection, use blog as default
              isTag: true,
            })
          }

          // Create link from content to tag
          links.push({
            source: slug,
            target: tagSlug,
          })
        })
      }

      // Create category nodes and links for docs
      if (details.collection === 'docs' && slug.startsWith('docs/')) {
        // Extract category from slug (e.g., 'docs/setup/getting-started' -> 'setup')
        const parts = slug.split('/')
        if (parts.length > 2) {
          const category = parts[1] // e.g., 'setup', 'integrations', 'advanced'
          const categorySlug = `docs/${category}`
          
          // Check if category node should be included (for local graph)
          let shouldIncludeCategory = true
          if (this.config.depth >= 0 && this.currentSlug) {
            // For local graph, only include categories if the current node is within depth
            if (slug !== this.currentSlug && !this.isWithinDepth(slug, this.currentSlug, this.config.depth)) {
              shouldIncludeCategory = false
            }
          }

          if (shouldIncludeCategory) {
            // Create or get category node
            if (!nodesMap.has(categorySlug)) {
              // Map category ID to display name
              const categoryNames: { [key: string]: string } = {
                setup: 'Setup',
                integrations: 'Integrations',
                advanced: 'Advanced'
              }
              const categoryTitle = categoryNames[category] || category.charAt(0).toUpperCase() + category.slice(1)
              
              nodesMap.set(categorySlug, {
                id: categorySlug,
                slug: categorySlug,
                title: categoryTitle,
                radius: 3,
                visited: false,
                collection: 'docs',
                isTag: false,
                isCategory: true,
              })
            }

            // Create link from content to category
            links.push({
              source: slug,
              target: categorySlug,
            })
          }
        }
      }
    })

    this.nodes = Array.from(nodesMap.values())
    this.links = links
  }

  normalizeSlug(link: string): string {
    // Remove leading slash and trailing slash
    let slug = link.replace(/^\//, '').replace(/\/$/, '')
    
    // If it doesn't start with blog/ or docs/, assume it's a blog post
    if (!slug.startsWith('blog/') && !slug.startsWith('docs/')) {
      if (!slug.includes('/')) {
        slug = `blog/${slug}`
      }
    }
    
    return slug
  }

  getIncomingLinks(slug: string): string[] {
    if (!this.contentIndex) return []
    
    const incoming: string[] = []
    Object.entries(this.contentIndex).forEach(([sourceSlug, details]) => {
      if (details.links.some(link => this.normalizeSlug(link) === slug)) {
        incoming.push(sourceSlug)
      }
    })
    return incoming
  }

  isWithinDepth(slug: string, startSlug: string, depth: number): boolean {
    if (depth < 0) return true // Global view
    if (slug === startSlug) return true
    if (depth === 0) return false

    const visited = new Set<string>()
    const queue: Array<{ slug: string; level: number }> = [{ slug: startSlug, level: 0 }]

    while (queue.length > 0) {
      const { slug: current, level } = queue.shift()!
      if (visited.has(current)) continue
      visited.add(current)

      if (current === slug && level <= depth) {
        return true
      }

      if (level < depth) {
        const details = this.contentIndex![current]
        if (details) {
          // Check content links
          details.links.forEach((link) => {
            const normalized = this.normalizeSlug(link)
            if (this.contentIndex![normalized] && !visited.has(normalized)) {
              queue.push({ slug: normalized, level: level + 1 })
            }
          })

          // Check tag links
          if (details.tags && details.tags.length > 0) {
            details.tags.forEach((tag) => {
              const tagSlug = `tags/${tag}`
              if (!visited.has(tagSlug)) {
                queue.push({ slug: tagSlug, level: level + 1 })
              }
            })
          }
        }

        // If current is a tag, find all content nodes that link to it
        if (current.startsWith('tags/')) {
          Object.entries(this.contentIndex!).forEach(([contentSlug, contentDetails]) => {
            if (contentDetails.tags && contentDetails.tags.includes(current.slice(5))) {
              if (!visited.has(contentSlug)) {
                queue.push({ slug: contentSlug, level: level + 1 })
              }
            }
          })
        }

        // If current is a category, find all content nodes that belong to it
        if (current.startsWith('docs/') && !this.contentIndex![current]) {
          // This might be a category node (e.g., 'docs/setup')
          const category = current.split('/')[1]
          Object.entries(this.contentIndex!).forEach(([contentSlug]) => {
            if (contentSlug.startsWith(`docs/${category}/`)) {
              if (!visited.has(contentSlug)) {
                queue.push({ slug: contentSlug, level: level + 1 })
              }
            }
          })
        }
      }
    }

    return false
  }

  isVisited(slug: string): boolean {
    // Check if page has been visited (stored in sessionStorage)
    const visited = sessionStorage.getItem('graph-visited')
    if (!visited) return false
    const visitedSet = new Set(JSON.parse(visited))
    return visitedSet.has(slug)
  }

  markVisited(slug: string) {
    const visited = sessionStorage.getItem('graph-visited')
    const visitedSet = visited ? new Set(JSON.parse(visited)) : new Set<string>()
    visitedSet.add(slug)
    sessionStorage.setItem('graph-visited', JSON.stringify(Array.from(visitedSet)))
  }

  updateGraph() {
    this.buildGraph()
    if (this.isGlobal && this.fullscreenCanvas) {
      this.renderFullscreen()
    } else {
      this.render()
    }
  }

  showFullscreenGraph() {
    // Create modal overlay (like search box)
    if (!this.fullscreenOverlay) {
      this.fullscreenOverlay = document.createElement('div')
      this.fullscreenOverlay.className = 'graph-fullscreen-overlay'
      this.fullscreenOverlay.innerHTML = `
        <div class="graph-fullscreen-backdrop"></div>
        <div class="graph-fullscreen-modal">
          <div id="graph-fullscreen-canvas" class="graph-fullscreen-canvas"></div>
        </div>
      `
      document.body.appendChild(this.fullscreenOverlay)

      // Close on backdrop click
      const backdrop = this.fullscreenOverlay.querySelector('.graph-fullscreen-backdrop')
      backdrop?.addEventListener('click', () => {
        this.hideFullscreenGraph()
        this.isGlobal = false
        this.config = localGraphConfig
        this.updateGraph()
      })

      // Close on escape key
      const escapeHandler = (e: KeyboardEvent) => {
        if (e.key === 'Escape' && this.isGlobal) {
          this.hideFullscreenGraph()
          this.isGlobal = false
          this.config = localGraphConfig
          this.updateGraph()
          document.removeEventListener('keydown', escapeHandler)
        }
      }
      document.addEventListener('keydown', escapeHandler)

      this.fullscreenCanvas = this.fullscreenOverlay.querySelector('#graph-fullscreen-canvas') as HTMLElement
    }
    this.fullscreenOverlay.classList.add('active')
    this.hasCenteredFullscreen = false // Reset flag when opening fullscreen
    this.buildGraph()
    this.renderFullscreen()
  }

  hideFullscreenGraph() {
    if (this.fullscreenOverlay) {
      this.fullscreenOverlay.classList.remove('active')
    }
  }

  updateHoverInfo(nodeId: string | null) {
    this.hoveredNodeId = nodeId
    if (nodeId === null) {
      this.hoveredNeighbours = new Set()
    } else {
      this.hoveredNeighbours = new Set()
      this.links.forEach((link) => {
        const sourceId = typeof link.source === 'string' ? link.source : link.source.id
        const targetId = typeof link.target === 'string' ? link.target : link.target.id
        if (sourceId === nodeId || targetId === nodeId) {
          this.hoveredNeighbours.add(sourceId)
          this.hoveredNeighbours.add(targetId)
        }
      })
    }
    this.updateNodeStyles()
  }

  updateNodeStyles() {
    if (!this.svg || !this.g) return

    const nodes = this.g.selectAll<SVGCircleElement, GraphNode>('circle')
    const links = this.g.selectAll<SVGLineElement, GraphLink>('line')
    const labels = this.g.selectAll<SVGTextElement, GraphNode>('text')

    // Update link styles
    links.style('opacity', (d) => {
      if (!this.config.focusOnHover || !this.hoveredNodeId) return 0.3
      const sourceId = typeof d.source === 'string' ? d.source : d.source.id
      const targetId = typeof d.target === 'string' ? d.target : d.target.id
      return this.hoveredNeighbours.has(sourceId) || this.hoveredNeighbours.has(targetId) ? 1 : 0.2
    })

    // Update node styles
    nodes.style('opacity', (d) => {
      if (!this.config.focusOnHover || !this.hoveredNodeId) return 1
      return this.hoveredNeighbours.has(d.id) || d.id === this.hoveredNodeId ? 1 : 0.2
    })

    // Update label styles
    labels.style('opacity', (d) => {
      if (!this.config.focusOnHover || !this.hoveredNodeId) return 0.8
      return this.hoveredNeighbours.has(d.id) || d.id === this.hoveredNodeId ? 1 : 0.2
    })
  }

  render() {
    if (!this.canvas || this.nodes.length === 0) return

    // Clear previous render
    d3.select(this.canvas).selectAll('*').remove()

    const width = this.canvas.clientWidth || 300
    const height = this.canvas.clientHeight || 400

    // Create SVG
    this.svg = d3
      .select(this.canvas)
      .append('svg')
      .attr('width', width)
      .attr('height', height)

    // Create zoom behavior
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        if (this.g) {
          this.g.attr('transform', event.transform)
          // Update label opacity based on zoom level
          const scale = event.transform.k
          const labels = this.g.selectAll<SVGTextElement, GraphNode>('text')
          labels.style('opacity', (d) => {
            const baseOpacity = this.config.focusOnHover && this.hoveredNodeId
              ? (this.hoveredNeighbours.has(d.id) || d.id === this.hoveredNodeId ? 1 : 0.2)
              : 0.8
            return Math.min(1, baseOpacity * Math.pow(scale, this.config.opacityScale))
          })
        }
      })

    if (this.config.zoom) {
      this.svg.call(zoom)
    }

    // Create container group
    this.g = this.svg.append('g')

    // Define arrow marker for directed links
    const defs = this.svg.append('defs')
    const arrowMarker = defs
      .append('marker')
      .attr('id', 'arrowhead')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 15)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
    arrowMarker
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', 'hsl(var(--muted-foreground) / 0.5)')

    // Create simulation with config
    this.simulation = d3
      .forceSimulation<GraphNode>(this.nodes)
      .force(
        'link',
        d3
          .forceLink<GraphNode, GraphLink>(this.links)
          .id((d) => d.id)
          .distance(this.config.linkDistance)
      )
      .force('charge', d3.forceManyBody().strength(-300 * this.config.repelForce))
      .force('center', d3.forceCenter(width / 2, height / 2).strength(this.config.centerForce))
      .force('collide', d3.forceCollide<GraphNode>().radius((d) => d.radius + 2))

    // Apply radial force for global graph if enabled
    if (this.config.enableRadial && this.isGlobal && this.currentSlug) {
      const currentNode = this.nodes.find((n) => n.slug === this.currentSlug)
      if (currentNode) {
        this.simulation.force(
          'radial',
          d3
            .forceRadial<GraphNode>(() => {
              // Calculate radial distance based on link distance
              return this.config.linkDistance * 3
            })
            .x(() => currentNode.x || width / 2)
            .y(() => currentNode.y || height / 2)
            .strength(0.1)
        )
      }
    }

    // Draw links with arrows
    const link = this.g!
      .append('g')
      .selectAll('line')
      .data(this.links)
      .enter()
      .append('line')
      .attr('stroke', 'hsl(var(--muted-foreground) / 0.3)')
      .attr('stroke-width', 1)
      .attr('marker-end', 'url(#arrowhead)')
      .style('opacity', 0.3)

    // Draw nodes with different styles based on type
    const nodeGroup = this.g!
      .append('g')
      .selectAll('g.node-group')
      .data(this.nodes)
      .enter()
      .append('g')
      .attr('class', 'node-group')
      .style('cursor', 'pointer')
      .on('click', (_event, d) => {
        this.markVisited(d.slug)
        window.location.href = `/${d.slug}`
      })
      .on('mouseover', (_event, d) => {
        if (this.config.focusOnHover) {
          this.updateHoverInfo(d.id)
        }
      })
      .on('mouseout', () => {
        if (this.config.focusOnHover) {
          this.updateHoverInfo(null)
        }
      })

    // Draw node circle
    nodeGroup
      .append('circle')
      .attr('r', (d) => d.radius)
      .attr('fill', (d) => {
        if (d.slug === this.currentSlug) {
          return 'hsl(var(--primary))'
        }
        if (d.isTag || d.isCategory) {
          return 'hsl(var(--background))'
        }
        if (d.visited) {
          return 'hsl(var(--primary) / 0.6)'
        }
        return 'hsl(var(--muted-foreground) / 0.5)'
      })
      .attr('stroke', (d) => {
        if (d.slug === this.currentSlug) {
          return 'hsl(var(--primary))'
        }
        if (d.isTag || d.isCategory) {
          return 'hsl(var(--primary) / 0.6)'
        }
        return 'hsl(var(--border))'
      })
      .attr('stroke-width', (d) => {
        if (d.slug === this.currentSlug) {
          return 3
        }
        if (d.isTag || d.isCategory) {
          return 2
        }
        return 1
      })

    // Add node type icon
    const currentSlug = this.currentSlug
    nodeGroup.each(function (d) {
      const group = d3.select(this)
      if (d.collection === 'blog') {
        group
          .append('text')
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'middle')
          .attr('font-size', `${d.radius * 0.8}px`)
          .attr('fill', d.slug === currentSlug ? 'white' : 'hsl(var(--foreground))')
          .text('📝')
      } else if (d.collection === 'docs') {
        group
          .append('text')
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'middle')
          .attr('font-size', `${d.radius * 0.8}px`)
          .attr('fill', d.slug === currentSlug ? 'white' : 'hsl(var(--foreground))')
          .text('📄')
      } else if (d.isTag) {
        group
          .append('text')
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'middle')
          .attr('font-size', `${d.radius * 0.6}px`)
          .attr('fill', 'hsl(var(--primary))')
          .text('#')
      } else if (d.isCategory) {
        group
          .append('text')
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'middle')
          .attr('font-size', `${d.radius * 0.6}px`)
          .attr('fill', 'hsl(var(--primary))')
          .text('📁')
      }
    })

    if (this.config.drag) {
      nodeGroup.call(this.drag() as any)
    }

    // Add labels
    const label = this.g!
      .append('g')
      .selectAll('text')
      .data(this.nodes)
      .enter()
      .append('text')
      .text((d) => d.title)
      .attr('font-size', `${this.config.fontSize}rem`)
      .attr('fill', 'hsl(var(--foreground))')
      .attr('dx', (d) => d.radius + 2)
      .attr('dy', 3)
      .style('pointer-events', 'none')
      .style('opacity', 0.8)

    // Update positions on simulation tick
    this.simulation.on('tick', () => {
      link
        .attr('x1', (d) => (d.source as GraphNode).x!)
        .attr('y1', (d) => (d.source as GraphNode).y!)
        .attr('x2', (d) => {
          const target = d.target as GraphNode
          const dx = target.x! - (d.source as GraphNode).x!
          const dy = target.y! - (d.source as GraphNode).y!
          const dist = Math.sqrt(dx * dx + dy * dy)
          const radius = target.radius
          return target.x! - (dx / dist) * radius
        })
        .attr('y2', (d) => {
          const target = d.target as GraphNode
          const dx = target.x! - (d.source as GraphNode).x!
          const dy = target.y! - (d.source as GraphNode).y!
          const dist = Math.sqrt(dx * dx + dy * dy)
          const radius = target.radius
          return target.y! - (dy / dist) * radius
        })

      nodeGroup.attr('transform', (d) => `translate(${d.x},${d.y})`)

      label.attr('x', (d) => d.x!).attr('y', (d) => d.y!)
    })

    // nodeGroup is used for drag behavior below

    // Center on current node with appropriate scale
    if (this.currentSlug) {
      const currentNode = this.nodes.find((n) => n.slug === this.currentSlug)
      if (currentNode) {
        this.simulation.on('end', () => {
          if (this.svg && this.config.zoom) {
            const transform = d3.zoomIdentity
              .translate(width / 2 - currentNode.x!, height / 2 - currentNode.y!)
              .scale(this.config.scale)
            this.svg.call(zoom.transform, transform)
          }
        })
      }
    }
  }

  renderFullscreen() {
    if (!this.fullscreenCanvas || this.nodes.length === 0) return

    // Clear previous render
    d3.select(this.fullscreenCanvas).selectAll('*').remove()

    const width = window.innerWidth
    const height = window.innerHeight - 60 // Account for header

    // Create SVG
    const svg = d3
      .select(this.fullscreenCanvas)
      .append('svg')
      .attr('width', width)
      .attr('height', height)

    // Create zoom behavior
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform)
        // Update label opacity based on zoom level
        const scale = event.transform.k
        const labels = g.selectAll<SVGTextElement, GraphNode>('text')
        labels.style('opacity', () => {
          const baseOpacity = 0.9
          return Math.min(1, baseOpacity * Math.pow(scale, this.config.opacityScale))
        })
      })

    svg.call(zoom)

    // Create container group
    const g = svg.append('g')

    // Define arrow marker
    const defs = svg.append('defs')
    const arrowMarker = defs
      .append('marker')
      .attr('id', 'arrowhead-fullscreen')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 15)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
    arrowMarker
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', 'hsl(var(--muted-foreground) / 0.5)')

    // Create simulation
    const simulation = d3
      .forceSimulation<GraphNode>(this.nodes)
      .force(
        'link',
        d3
          .forceLink<GraphNode, GraphLink>(this.links)
          .id((d) => d.id)
          .distance(this.config.linkDistance)
      )
      .force('charge', d3.forceManyBody().strength(-300 * this.config.repelForce))
      .force('center', d3.forceCenter(width / 2, height / 2).strength(this.config.centerForce))
      .force('collide', d3.forceCollide<GraphNode>().radius((d) => d.radius + 2))

    // Apply radial force for global graph
    if (this.config.enableRadial && this.currentSlug) {
      const currentNode = this.nodes.find((n) => n.slug === this.currentSlug)
      if (currentNode) {
        simulation.force(
          'radial',
          d3
            .forceRadial<GraphNode>(() => this.config.linkDistance * 3)
            .x(() => currentNode.x || width / 2)
            .y(() => currentNode.y || height / 2)
            .strength(0.1)
        )
      }
    }

    // Draw links with arrows
    const link = g
      .append('g')
      .selectAll('line')
      .data(this.links)
      .enter()
      .append('line')
      .attr('stroke', 'hsl(var(--muted-foreground) / 0.3)')
      .attr('stroke-width', 1)
      .attr('marker-end', 'url(#arrowhead-fullscreen)')
      .style('opacity', 0.3)

    // Draw nodes
    const nodeGroup = g
      .append('g')
      .selectAll('g.node-group')
      .data(this.nodes)
      .enter()
      .append('g')
      .attr('class', 'node-group')
      .style('cursor', 'pointer')
      .on('click', (_event, d) => {
        this.markVisited(d.slug)
        window.location.href = `/${d.slug}`
      })

    nodeGroup
      .append('circle')
      .attr('r', (d) => d.radius)
      .attr('fill', (d) => {
        if (d.slug === this.currentSlug) {
          return 'hsl(var(--primary))'
        }
        if (d.isTag || d.isCategory) {
          return 'hsl(var(--background))'
        }
        if (d.visited) {
          return 'hsl(var(--primary) / 0.6)'
        }
        return 'hsl(var(--muted-foreground) / 0.5)'
      })
      .attr('stroke', (d) => {
        if (d.slug === this.currentSlug) {
          return 'hsl(var(--primary))'
        }
        if (d.isTag || d.isCategory) {
          return 'hsl(var(--primary) / 0.6)'
        }
        return 'hsl(var(--border))'
      })
      .attr('stroke-width', (d) => {
        if (d.slug === this.currentSlug) {
          return 4
        }
        if (d.isTag || d.isCategory) {
          return 2
        }
        return 1
      })

    // Add node type icon
    const currentSlugFullscreen = this.currentSlug
    nodeGroup.each(function (d) {
      const group = d3.select(this)
      if (d.collection === 'blog') {
        group
          .append('text')
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'middle')
          .attr('font-size', `${d.radius * 0.8}px`)
          .attr('fill', d.slug === currentSlugFullscreen ? 'white' : 'hsl(var(--foreground))')
          .text('📝')
      } else if (d.collection === 'docs') {
        group
          .append('text')
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'middle')
          .attr('font-size', `${d.radius * 0.8}px`)
          .attr('fill', d.slug === currentSlugFullscreen ? 'white' : 'hsl(var(--foreground))')
          .text('📄')
      } else if (d.isTag) {
        group
          .append('text')
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'middle')
          .attr('font-size', `${d.radius * 0.6}px`)
          .attr('fill', 'hsl(var(--primary))')
          .text('#')
      } else if (d.isCategory) {
        group
          .append('text')
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'middle')
          .attr('font-size', `${d.radius * 0.6}px`)
          .attr('fill', 'hsl(var(--primary))')
          .text('📁')
      }
    })

    if (this.config.drag) {
      nodeGroup.call(
        d3
          .drag<SVGGElement, GraphNode>()
          .on('start', (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart()
            d.fx = d.x
            d.fy = d.y
          })
          .on('drag', (event, d) => {
            d.fx = event.x
            d.fy = event.y
          })
          .on('end', (event, d) => {
            if (!event.active) simulation.alphaTarget(0)
            d.fx = null
            d.fy = null
          }) as any
      )
    }

    // Add labels
    const label = g
      .append('g')
      .selectAll('text')
      .data(this.nodes)
      .enter()
      .append('text')
      .text((d) => d.title)
      .attr('font-size', `${this.config.fontSize * 1.2}rem`)
      .attr('fill', 'hsl(var(--foreground))')
      .attr('dx', (d) => d.radius + 3)
      .attr('dy', 3)
      .style('pointer-events', 'none')
      .style('opacity', 0.9)

    // Update positions on simulation tick
    simulation.on('tick', () => {
      link
        .attr('x1', (d) => (d.source as GraphNode).x!)
        .attr('y1', (d) => (d.source as GraphNode).y!)
        .attr('x2', (d) => {
          const target = d.target as GraphNode
          const dx = target.x! - (d.source as GraphNode).x!
          const dy = target.y! - (d.source as GraphNode).y!
          const dist = Math.sqrt(dx * dx + dy * dy)
          const radius = target.radius
          return target.x! - (dx / dist) * radius
        })
        .attr('y2', (d) => {
          const target = d.target as GraphNode
          const dx = target.x! - (d.source as GraphNode).x!
          const dy = target.y! - (d.source as GraphNode).y!
          const dist = Math.sqrt(dx * dx + dy * dy)
          const radius = target.radius
          return target.y! - (dy / dist) * radius
        })

      nodeGroup.attr('transform', (d) => `translate(${d.x},${d.y})`)

      label.attr('x', (d) => d.x!).attr('y', (d) => d.y!)
    })

    // Center on current node (only once when opening fullscreen)
    if (this.currentSlug && !this.hasCenteredFullscreen) {
      const currentNode = this.nodes.find((n) => n.slug === this.currentSlug)
      if (currentNode) {
        simulation.on('end', () => {
          if (!this.hasCenteredFullscreen && currentNode.x !== undefined && currentNode.y !== undefined) {
            const transform = d3.zoomIdentity
              .translate(width / 2 - currentNode.x, height / 2 - currentNode.y)
              .scale(this.config.scale)
            svg.call(zoom.transform, transform)
            this.hasCenteredFullscreen = true // Mark as centered
          }
        })
      }
    }
  }

  drag() {
    return d3
      .drag<SVGGElement, GraphNode>()
      .on('start', (event, d) => {
        if (!event.active) this.simulation!.alphaTarget(0.3).restart()
        d.fx = d.x
        d.fy = d.y
      })
      .on('drag', (event, d) => {
        d.fx = event.x
        d.fy = event.y
      })
      .on('end', (event, d) => {
        if (!event.active) this.simulation!.alphaTarget(0)
        d.fx = null
        d.fy = null
      })
  }
}

// Initialize graph view
export function initGraphView() {
  // Try to find graph-view container by ID (supports both 'graph-view' and 'blog-graph-view')
  const container = document.getElementById('graph-view') || document.getElementById('blog-graph-view')
  if (container) {
    // Check if already initialized
    if (container.hasAttribute('data-initialized')) {
      return
    }
    container.setAttribute('data-initialized', 'true')
    const currentSlug = container.dataset.currentSlug || undefined
    new GraphView(container, currentSlug)
  }
}

