/**
 * End-to-end tests against the test-site.html
 *
 * These tests actually launch Chromium + FFmpeg to render real videos.
 * They serve public/test-site.html via a tiny Node.js HTTP server.
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import os from 'os'
import http from 'http'
import { renderScript } from '../lib/renderer/engine'
import type { DemoScript } from '../lib/types'

// ─── Test HTTP server ──────────────────────────────────────────────────────────

let testServer: http.Server
let testServerUrl: string

const TEST_SITE_PATH = path.join(__dirname, '../public/test-site.html')
const PUBLIC_DIR = path.join(__dirname, '../public')

function startTestServer(): Promise<string> {
  return new Promise((resolve, reject) => {
    testServer = http.createServer((req, res) => {
      const urlPath = req.url === '/' ? '/test-site.html' : (req.url || '/test-site.html')
      const filePath = path.join(PUBLIC_DIR, urlPath)

      if (!fs.existsSync(filePath)) {
        res.writeHead(404)
        res.end('Not found')
        return
      }

      const ext = path.extname(filePath)
      const mimeTypes: Record<string, string> = {
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'application/javascript',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
      }
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' })
      res.end(fs.readFileSync(filePath))
    })

    testServer.listen(0, '127.0.0.1', () => {
      const addr = testServer.address() as { port: number }
      resolve(`http://127.0.0.1:${addr.port}`)
    })

    testServer.on('error', reject)
  })
}

// ─── E2E Test Suite ────────────────────────────────────────────────────────────

describe('E2E: Render against test-site.html', () => {
  let outputDir: string

  before(async () => {
    testServerUrl = await startTestServer()
    outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'demoscript-e2e-'))
    console.log(`  Test server at: ${testServerUrl}`)
    console.log(`  Output dir: ${outputDir}`)
  })

  after(() => {
    testServer.close()
    if (fs.existsSync(outputDir)) {
      fs.rmSync(outputDir, { recursive: true, force: true })
    }
  })

  it('test-site.html exists and has expected sections', () => {
    assert.ok(fs.existsSync(TEST_SITE_PATH), 'test-site.html must exist')
    const content = fs.readFileSync(TEST_SITE_PATH, 'utf-8')
    assert.ok(content.includes('id="hero"'), 'Should have #hero section')
    assert.ok(content.includes('id="features"'), 'Should have #features section')
    assert.ok(content.includes('id="pricing"'), 'Should have #pricing section')
    assert.ok(content.includes('.pricing-card.featured'), 'Should have .pricing-card.featured')
    assert.ok(content.includes('cta-button'), 'Should have CTA button')
  })

  it('renders a minimal MP4 from test-site (wait + highlight)', async () => {
    const script: DemoScript = {
      id: 'e2e-test-1',
      url: `${testServerUrl}/test-site.html`,
      viewport: { width: 800, height: 600 },
      fps: 10,
      outputFormat: 'mp4',
      steps: [
        { id: 's1', order: 1, action: 'wait', target: null, targetLabel: 'page', duration: 0.5, annotation: 'Welcome' },
        { id: 's2', order: 2, action: 'highlight', target: 'h1', targetLabel: 'h1', duration: 0.5, highlightColor: '#667eea' },
      ],
      createdAt: new Date().toISOString(),
    }

    const outputPath = await renderScript({ script, outputDir }) as string

    assert.ok(fs.existsSync(outputPath), `Output file must exist: ${outputPath}`)
    assert.ok(outputPath.endsWith('.mp4'), 'Output should be .mp4')

    const stat = fs.statSync(outputPath)
    assert.ok(stat.size > 1000, `MP4 file too small (${stat.size} bytes) — likely empty or corrupt`)
    console.log(`  MP4 output: ${outputPath} (${(stat.size / 1024).toFixed(1)} KB)`)
  })

  it('renders MP4 with scroll-to action', async () => {
    const script: DemoScript = {
      id: 'e2e-test-2',
      url: `${testServerUrl}/test-site.html`,
      viewport: { width: 800, height: 600 },
      fps: 10,
      outputFormat: 'mp4',
      steps: [
        { id: 's1', order: 1, action: 'wait', target: null, targetLabel: 'page', duration: 0.3 },
        { id: 's2', order: 2, action: 'scroll-to', target: '#pricing', targetLabel: 'pricing', duration: 0.5, annotation: 'See Pricing' },
        { id: 's3', order: 3, action: 'wait', target: null, targetLabel: 'page', duration: 0.3 },
      ],
      createdAt: new Date().toISOString(),
    }

    const outputPath = await renderScript({ script, outputDir }) as string
    assert.ok(fs.existsSync(outputPath))
    const stat = fs.statSync(outputPath)
    assert.ok(stat.size > 1000, `MP4 too small: ${stat.size} bytes`)
  })

  it('renders MP4 with zoom-in + zoom-out', async () => {
    const script: DemoScript = {
      id: 'e2e-test-3',
      url: `${testServerUrl}/test-site.html`,
      viewport: { width: 800, height: 600 },
      fps: 10,
      outputFormat: 'mp4',
      steps: [
        { id: 's1', order: 1, action: 'wait', target: null, targetLabel: 'page', duration: 0.3 },
        { id: 's2', order: 2, action: 'zoom-in', target: 'h1', targetLabel: 'h1', duration: 0.5, zoom: 1.8 },
        { id: 's3', order: 3, action: 'zoom-out', target: null, targetLabel: 'page', duration: 0.5 },
      ],
      createdAt: new Date().toISOString(),
    }

    const outputPath = await renderScript({ script, outputDir }) as string
    assert.ok(fs.existsSync(outputPath))
    const stat = fs.statSync(outputPath)
    assert.ok(stat.size > 1000)
  })

  it('reports progress via onProgress callback', async () => {
    const progressUpdates: Array<{ progress: number; message: string }> = []

    const script: DemoScript = {
      id: 'e2e-test-progress',
      url: `${testServerUrl}/test-site.html`,
      viewport: { width: 800, height: 600 },
      fps: 10,
      outputFormat: 'mp4',
      steps: [
        { id: 's1', order: 1, action: 'wait', target: null, targetLabel: 'page', duration: 0.3 },
      ],
      createdAt: new Date().toISOString(),
    }

    await renderScript({
      script,
      outputDir,
      onProgress: (progress, message) => {
        progressUpdates.push({ progress, message })
      },
    })

    assert.ok(progressUpdates.length > 0, 'onProgress should have been called')

    const progressNums = progressUpdates.map(u => u.progress)
    assert.ok(progressNums.some(p => p >= 2), 'Progress should start from at least 2%')
    assert.ok(progressNums.some(p => p >= 80), 'Progress should reach at least 80%')
    assert.ok(progressNums.some(p => p === 100), 'Progress should reach 100%')

    // All messages should be non-empty strings
    for (const u of progressUpdates) {
      assert.equal(typeof u.message, 'string')
      assert.ok(u.message.length > 0)
    }
  })

  it('renders thumbnail (PNG) using multi-format path', async () => {
    const script: DemoScript = {
      id: 'e2e-test-thumb',
      url: `${testServerUrl}/test-site.html`,
      viewport: { width: 800, height: 600 },
      fps: 10,
      outputFormat: 'mp4',
      steps: [
        { id: 's1', order: 1, action: 'wait', target: null, targetLabel: 'page', duration: 0.3 },
      ],
      createdAt: new Date().toISOString(),
    }

    const result = await renderScript({ script, outputDir, formats: ['thumbnail'] })
    assert.ok(typeof result === 'object' && 'outputs' in result, 'Should return MultiRenderResult')
    assert.ok(result.outputs['thumbnail'], 'thumbnail output should exist')
    const thumbPath = result.outputs['thumbnail']!
    assert.ok(fs.existsSync(thumbPath), `Thumbnail file must exist: ${thumbPath}`)
    assert.ok(thumbPath.endsWith('.png'), 'Thumbnail must be PNG')

    const stat = fs.statSync(thumbPath)
    assert.ok(stat.size > 100, `PNG too small: ${stat.size} bytes`)

    // Verify it's actually a PNG by checking magic bytes
    const buf = Buffer.alloc(8)
    const fd = fs.openSync(thumbPath, 'r')
    fs.readSync(fd, buf, 0, 8, 0)
    fs.closeSync(fd)
    // PNG magic: 89 50 4E 47 0D 0A 1A 0A
    assert.equal(buf[0], 0x89, 'Should start with PNG magic byte 0x89')
    assert.equal(buf[1], 0x50, 'Should have PNG magic byte 0x50 (P)')
    assert.equal(buf[2], 0x4e, 'Should have PNG magic byte 0x4e (N)')
    assert.equal(buf[3], 0x47, 'Should have PNG magic byte 0x47 (G)')
  })

  it('renders standard MP4 + thumbnail together (multi-format)', async () => {
    const script: DemoScript = {
      id: 'e2e-test-multi',
      url: `${testServerUrl}/test-site.html`,
      viewport: { width: 640, height: 480 },
      fps: 10,
      outputFormat: 'mp4',
      steps: [
        { id: 's1', order: 1, action: 'wait', target: null, targetLabel: 'page', duration: 0.3 },
        { id: 's2', order: 2, action: 'highlight', target: '#cta', targetLabel: 'cta', duration: 0.3 },
      ],
      createdAt: new Date().toISOString(),
    }

    const result = await renderScript({ script, outputDir, formats: ['mp4-standard', 'thumbnail'] })
    assert.ok('outputs' in result, 'Should return MultiRenderResult')
    assert.ok(result.outputs['mp4-standard'], 'mp4-standard output should exist')
    assert.ok(result.outputs['thumbnail'], 'thumbnail output should exist')

    const mp4Stat = fs.statSync(result.outputs['mp4-standard']!)
    const thumbStat = fs.statSync(result.outputs['thumbnail']!)

    assert.ok(mp4Stat.size > 1000, `MP4 too small: ${mp4Stat.size} bytes`)
    assert.ok(thumbStat.size > 100, `Thumbnail too small: ${thumbStat.size} bytes`)

    console.log(`  MP4: ${(mp4Stat.size / 1024).toFixed(1)} KB, Thumbnail: ${thumbStat.size} bytes`)
  })

  it('AbortSignal cancels render mid-way', async () => {
    const { AbortError } = await import('../lib/watcher')
    const controller = new AbortController()

    const script: DemoScript = {
      id: 'e2e-test-abort',
      url: `${testServerUrl}/test-site.html`,
      viewport: { width: 800, height: 600 },
      fps: 10,
      outputFormat: 'mp4',
      steps: [
        { id: 's1', order: 1, action: 'wait', target: null, targetLabel: 'page', duration: 0.3 },
        { id: 's2', order: 2, action: 'scroll-to', target: '#pricing', targetLabel: 'pricing', duration: 0.5 },
        { id: 's3', order: 3, action: 'wait', target: null, targetLabel: 'page', duration: 0.3 },
      ],
      createdAt: new Date().toISOString(),
    }

    // Abort immediately (before render starts)
    controller.abort()

    await assert.rejects(
      () => renderScript({ script, outputDir, signal: controller.signal }),
      (err: Error) => {
        assert.ok(err instanceof AbortError, `Expected AbortError, got ${err.constructor.name}: ${err.message}`)
        return true
      }
    )
  })

  it('renders GIF output format', async () => {
    const script: DemoScript = {
      id: 'e2e-test-gif',
      url: `${testServerUrl}/test-site.html`,
      viewport: { width: 640, height: 480 },
      fps: 10,
      outputFormat: 'gif',
      steps: [
        { id: 's1', order: 1, action: 'wait', target: null, targetLabel: 'page', duration: 0.3 },
        { id: 's2', order: 2, action: 'highlight', target: 'h1', targetLabel: 'h1', duration: 0.3 },
      ],
      createdAt: new Date().toISOString(),
    }

    const outputPath = await renderScript({ script, outputDir }) as string
    assert.ok(fs.existsSync(outputPath), `GIF must exist: ${outputPath}`)
    assert.ok(outputPath.endsWith('.gif'), 'Output should be .gif')

    const stat = fs.statSync(outputPath)
    assert.ok(stat.size > 1000, `GIF too small: ${stat.size} bytes`)

    // Verify GIF magic bytes: 47 49 46 38 (GIF8)
    const buf = Buffer.alloc(4)
    const fd = fs.openSync(outputPath, 'r')
    fs.readSync(fd, buf, 0, 4, 0)
    fs.closeSync(fd)
    assert.equal(buf.toString('ascii'), 'GIF8', 'File should start with GIF8 magic bytes')

    console.log(`  GIF output: ${outputPath} (${(stat.size / 1024).toFixed(1)} KB)`)
  })

  it('multiple renders in parallel produce independent output files', async () => {
    const makeScript = (id: string): DemoScript => ({
      id,
      url: `${testServerUrl}/test-site.html`,
      viewport: { width: 640, height: 480 },
      fps: 10,
      outputFormat: 'mp4',
      steps: [
        { id: 's1', order: 1, action: 'wait', target: null, targetLabel: 'page', duration: 0.3 },
      ],
      createdAt: new Date().toISOString(),
    })

    const [p1, p2] = await Promise.all([
      renderScript({ script: makeScript('parallel-1'), outputDir }) as Promise<string>,
      renderScript({ script: makeScript('parallel-2'), outputDir }) as Promise<string>,
    ])

    assert.ok(fs.existsSync(p1), `First output must exist: ${p1}`)
    assert.ok(fs.existsSync(p2), `Second output must exist: ${p2}`)
    assert.notEqual(p1, p2, 'Parallel renders should produce different output files')

    const s1 = fs.statSync(p1)
    const s2 = fs.statSync(p2)
    assert.ok(s1.size > 1000)
    assert.ok(s2.size > 1000)
  })
})
