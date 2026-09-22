import { chromium, Browser, Page } from 'playwright'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { nanoid } from 'nanoid'
import { DemoScript } from '../types'
import { executeAction, removeAnnotation, SharedState } from './actions'
import { encodeFramesToVideo, encodeFramesToGif, encodeMultipleFormats, MultiFormatResult } from './ffmpeg'
import type { FormatId } from './formats'
import { AbortError } from '../watcher'

export interface RenderOptions {
  script: DemoScript
  outputDir: string
  onProgress?: (progress: number, message: string) => void
  signal?: AbortSignal
  formats?: FormatId[]
}

export interface MultiRenderResult {
  outputs: Partial<Record<FormatId, string>>
}

export async function renderScript(options: RenderOptions): Promise<string>
export async function renderScript(options: RenderOptions & { formats: FormatId[] }): Promise<MultiRenderResult>
export async function renderScript(options: RenderOptions): Promise<string | MultiRenderResult> {
  const { script, outputDir, onProgress, signal, formats } = options
  const progress = (p: number, msg: string) => onProgress?.(p, msg)

  const frameDir = path.join(os.tmpdir(), `demoscript_${nanoid()}`)
  fs.mkdirSync(frameDir, { recursive: true })
  fs.mkdirSync(outputDir, { recursive: true })

  let browser: Browser | null = null
  // Attach mode borrows someone else's browser and its real window size.
  let ownsBrowser = true

  try {
    if (signal?.aborted) throw new AbortError()

    // Two modes. ATTACH reuses a browser somebody else is driving (an Electron
    // app, a desktop build, a page behind a long sign-in); LAUNCH opens a clean
    // headless Chromium at script.url. In attach mode the caller owns the
    // browser, so we touch as little as possible: no navigation, no resize, no
    // banner stripping, and no close at the end.
    let page: Page

    if (script.cdpUrl) {
      progress(2, `Connecting to ${script.cdpUrl}...`)
      browser = await chromium.connectOverCDP(script.cdpUrl)
      ownsBrowser = false

      const context = browser.contexts()[0]
      if (!context) {
        throw new Error(
          `Connected to ${script.cdpUrl} but it has no browser context. Is the app running?`
        )
      }
      const attached = context.pages()[0]
      if (!attached) {
        throw new Error(
          `Connected to ${script.cdpUrl} but it has no open page. Open the window you want to record first.`
        )
      }
      page = attached

      // Deliberately NOT pausing animations here. In launch mode that buys
      // deterministic frames on a static page; in attach mode the app is live
      // and mid-flow, and freezing its transitions changes what is being
      // recorded — which is the one thing a capture must not do.
      progress(10, 'Attached to running page. Starting render...')
    } else {
      progress(2, 'Launching browser...')

      browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--hide-scrollbars',
          '--disable-web-security',
        ],
      })

      page = await browser.newPage()
      await page.setViewportSize(script.viewport)

      // Disable animations for deterministic rendering
      await page.addInitScript(() => {
        const style = document.createElement('style')
        style.textContent = `
          *, *::before, *::after {
            animation-play-state: paused !important;
            transition-duration: 0ms !important;
          }
        `
        document.head?.appendChild(style)
      })

      if (signal?.aborted) throw new AbortError()

      progress(5, `Loading ${script.url}...`)

      await page.goto(script.url, {
        waitUntil: 'load',
        timeout: 30000,
      })

      // Wait for fonts, but don't fail if it times out
      await page
        .evaluate(() => document.fonts.ready)
        .catch(() => {})

      // Additional settle time for dynamic content
      await page.waitForTimeout(1500)

      // Handle cookie banners / GDPR popups
      await page
        .evaluate(() => {
          const cookieBannerSelectors = [
            '[id*="cookie"]',
            '[class*="cookie"]',
            '[id*="gdpr"]',
            '[class*="consent"]',
            '[id*="consent"]',
          ]
          for (const sel of cookieBannerSelectors) {
            document.querySelectorAll(sel).forEach((el) => {
              ;(el as HTMLElement).style.display = 'none'
            })
          }
        })
        .catch(() => {})

      progress(10, 'Page loaded. Starting render...')
    }

    if (signal?.aborted) throw new AbortError()

    // Frames must be sized by the page we are ACTUALLY capturing. In attach
    // mode script.viewport describes a window DemoScript never created — using
    // it clips or letterboxes every frame — so read the live size instead and
    // fall back to the script only if the page cannot report one.
    const liveViewport = ownsBrowser
      ? script.viewport
      : ((await page
          .evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
          .catch(() => null)) ??
        page.viewportSize() ??
        script.viewport)

    const frameCount = { value: 1 }
    const totalSteps = script.steps.length
    const shared: SharedState = {
      cursorX: liveViewport.width / 2,
      cursorY: liveViewport.height / 2,
    }

    for (let i = 0; i < script.steps.length; i++) {
      if (signal?.aborted) throw new AbortError()

      const step = script.steps[i]
      const stepProgress = 10 + (i / totalSteps) * 70
      progress(
        stepProgress,
        `Rendering step ${i + 1}/${totalSteps}: ${step.action} on ${step.targetLabel || step.target || 'page'}`
      )

      await executeAction({
        page,
        step,
        frameDir,
        fps: script.fps,
        frameCount,
        viewport: liveViewport,
        shared,
      })

      // Remove annotation after step
      if (step.annotation) {
        await removeAnnotation(page)
      }
    }

    if (signal?.aborted) throw new AbortError()

    const capturedFrames = frameCount.value - 1

    // Multi-format export path (any time formats array is explicitly provided)
    if (formats && formats.length >= 1) {
      const fmtLabel = formats.length === 1 ? '1 format' : `${formats.length} formats`
      progress(80, `Captured ${capturedFrames} frames. Encoding ${fmtLabel}...`)
      const baseOutputPath = path.join(outputDir, `demo_${script.id}`)
      const results: MultiFormatResult = await encodeMultipleFormats({
        frameDir,
        baseOutputPath,
        fps: script.fps,
        viewport: liveViewport,
        formatIds: formats,
      })

      progress(95, 'Cleaning up...')
      fs.rmSync(frameDir, { recursive: true, force: true })
      progress(100, 'Complete!')

      const outputs: Partial<Record<FormatId, string>> = {}
      for (const [fmtId, result] of Object.entries(results)) {
        if (result.success && result.outputPath) {
          outputs[fmtId as FormatId] = result.outputPath
        }
      }
      return { outputs }
    }

    // Single-format path (existing behavior)
    progress(80, `Captured ${capturedFrames} frames. Encoding video...`)

    const ext =
      script.outputFormat === 'gif'
        ? 'gif'
        : script.outputFormat === 'webm'
          ? 'webm'
          : 'mp4'
    const outputPath = path.join(outputDir, `demo_${script.id}.${ext}`)

    if (script.outputFormat === 'gif') {
      await encodeFramesToGif({
        frameDir,
        outputPath,
        fps: script.fps,
        width: liveViewport.width,
        height: liveViewport.height,
      })
    } else {
      await encodeFramesToVideo({
        frameDir,
        outputPath,
        fps: script.fps,
        width: liveViewport.width,
        height: liveViewport.height,
      })
    }

    progress(95, 'Cleaning up...')
    fs.rmSync(frameDir, { recursive: true, force: true })
    progress(100, 'Complete!')

    return outputPath
  } finally {
    // For a launched browser this shuts it down. For an attached one,
    // close() on a connectOverCDP handle only drops our connection — the
    // caller's app keeps running, which is the whole contract of attach mode.
    await browser?.close().catch(() => {})
    if (fs.existsSync(frameDir)) {
      fs.rmSync(frameDir, { recursive: true, force: true })
    }
  }
}
