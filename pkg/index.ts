/**
 * DemoScript — Programmatic API
 *
 * Usage:
 *   import { render, capture, generate, createCloudClient } from 'demoscript'
 *
 *   const video = await render({
 *     url: 'https://your-site.com',
 *     steps: [
 *       { action: 'wait', duration: 1 },
 *       { action: 'scroll-to', target: '#pricing', duration: 2 },
 *       { action: 'highlight', target: '.plan-pro', duration: 1.5, highlightColor: '#6366F1' },
 *     ],
 *   })
 *   console.log(video.outputPath) // => /path/to/demo.mp4
 */

import { nanoid } from 'nanoid'
import path from 'path'
import { renderScript, RenderOptions } from '../lib/renderer/engine'
import { ActionType, Step, DemoScript, PageCapture, CapturedElement } from '../lib/types'
import { chromium } from 'playwright'
import { generateScript, GenerateOptions, GenerateResult } from '../lib/ai/scriptGenerator'
import { createCloudClient, DemoScriptCloudClient, CloudClientOptions, AuthStatus, CloudRenderResult } from '../lib/api/client'

// Re-export types for consumers
export type { ActionType, Step, DemoScript, PageCapture, CapturedElement, RenderOptions }
export type { EncodeOptions } from '../lib/renderer/ffmpeg'
export type { GenerateOptions, GenerateResult }
export type { CloudClientOptions, AuthStatus, CloudRenderResult }
export { createCloudClient, DemoScriptCloudClient }

export interface RenderInput {
  /** URL of the page to record */
  url: string
  /** Ordered list of actions to perform */
  steps: StepInput[]
  /** Viewport size (default: 1280x720) */
  viewport?: { width: number; height: number }
  /** Frames per second (default: 24) */
  fps?: number
  /** Output format (default: 'mp4') */
  outputFormat?: 'mp4' | 'gif' | 'webm'
  /** Directory to write output file (default: './output') */
  outputDir?: string
  /** Progress callback */
  onProgress?: (progress: number, message: string) => void
}

export interface StepInput {
  /** Action type */
  action: ActionType
  /** CSS selector for the target element (null for whole page) */
  target?: string | null
  /** Human-readable label (auto-generated if omitted) */
  label?: string
  /** Duration in seconds */
  duration: number
  /** Zoom level for zoom-in/zoom-out (default: 2.0) */
  zoom?: number
  /** Easing function (default: 'ease-in-out') */
  easing?: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out'
  /** Text annotation overlay */
  annotation?: string
  /** Border color for highlight action (default: '#3B82F6') */
  highlightColor?: string
  /** Text to type character-by-character into target field (for type action) */
  typeText?: string
}

export interface RenderResult {
  /** Absolute path to the output video file */
  outputPath: string
  /** Number of frames captured */
  frameCount: number
  /** Total duration in seconds */
  duration: number
}

/**
 * Render a demo video from a URL and a list of steps.
 */
export async function render(input: RenderInput): Promise<RenderResult> {
  const {
    url,
    steps: stepInputs,
    viewport = { width: 1280, height: 720 },
    fps = 24,
    outputFormat = 'mp4',
    outputDir = path.join(process.cwd(), 'output'),
    onProgress,
  } = input

  const scriptId = nanoid()
  const steps: Step[] = stepInputs.map((s, i) => ({
    id: nanoid(),
    order: i + 1,
    target: s.target ?? null,
    targetLabel: s.label || s.target || 'Page',
    action: s.action,
    duration: s.duration,
    zoom: s.zoom,
    easing: s.easing,
    annotation: s.annotation,
    highlightColor: s.highlightColor,
    typeText: s.typeText,
  }))

  const script: DemoScript = {
    id: scriptId,
    url,
    viewport,
    fps,
    outputFormat,
    steps,
    createdAt: new Date().toISOString(),
  }

  const outputPath = await renderScript({
    script,
    outputDir,
    onProgress,
  }) as string

  const totalDuration = steps.reduce((sum, s) => sum + s.duration, 0)
  const frameCount = Math.round(totalDuration * fps)

  return { outputPath, frameCount, duration: totalDuration }
}

/**
 * Capture a page screenshot and detect major DOM elements.
 */
export async function capture(
  url: string,
  viewport: { width: number; height: number } = { width: 1280, height: 720 }
): Promise<PageCapture> {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })
  const page = await browser.newPage()
  await page.setViewportSize(viewport)

  try {
    await page.goto(url, { waitUntil: 'load', timeout: 30000 })
    await page.waitForTimeout(1000)

    const screenshotBuffer = await page.screenshot({
      type: 'jpeg',
      quality: 85,
      fullPage: false,
    })
    const screenshotBase64 = screenshotBuffer.toString('base64')

    const elements: CapturedElement[] = await page.evaluate(() => {
      const selectors = [
        'header', 'nav', 'main', 'footer', 'section', 'article',
        'h1', 'h2', 'h3',
        '[class*="hero"]', '[class*="pricing"]', '[class*="feature"]',
        '[class*="cta"]', 'button', 'form', '[id]',
      ]

      const seen = new Set<string>()
      const results: {
        selector: string; label: string;
        boundingBox: { x: number; y: number; width: number; height: number };
        tagName: string; innerText: string;
      }[] = []

      for (const selector of selectors) {
        const els = Array.from(document.querySelectorAll(selector)).slice(0, 3)
        for (const el of els) {
          const rect = el.getBoundingClientRect()
          if (rect.width < 10 || rect.height < 10 || rect.top < 0 || rect.left < 0) continue

          let cssSelector = ''
          if (el.id) cssSelector = `#${el.id}`
          else if (el.className && typeof el.className === 'string' && el.className.trim())
            cssSelector = `${el.tagName.toLowerCase()}.${el.className.trim().split(/\s+/)[0]}`
          else cssSelector = el.tagName.toLowerCase()

          if (seen.has(cssSelector)) continue
          seen.add(cssSelector)

          results.push({
            selector: cssSelector,
            label: el.id || el.getAttribute('aria-label') || el.tagName.toLowerCase(),
            boundingBox: {
              x: Math.round(rect.left), y: Math.round(rect.top),
              width: Math.round(rect.width), height: Math.round(rect.height),
            },
            tagName: el.tagName.toLowerCase(),
            innerText: (el.textContent || '').trim().slice(0, 60),
          })
          if (results.length >= 30) break
        }
        if (results.length >= 30) break
      }
      return results
    })

    const pageHeight = await page.evaluate(() => document.body.scrollHeight)

    return { url, screenshotBase64, elements, pageHeight, pageWidth: viewport.width }
  } finally {
    await browser.close()
  }
}

/**
 * Generate a demo script using AI from a URL and a natural language prompt.
 */
export async function generate(options: GenerateOptions): Promise<GenerateResult> {
  return generateScript(options)
}
