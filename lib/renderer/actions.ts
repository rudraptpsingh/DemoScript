import { Page } from 'playwright'
import { Step } from '../types'

export interface SharedState {
  cursorX: number
  cursorY: number
}

export interface ActionContext {
  page: Page
  step: Step
  frameDir: string
  fps: number
  frameCount: { value: number }
  viewport: { width: number; height: number }
  shared: SharedState
}

async function captureFrames(
  ctx: ActionContext,
  durationSeconds: number,
  onFrame: (progress: number) => Promise<void>
): Promise<void> {
  const totalFrames = Math.max(1, Math.round(durationSeconds * ctx.fps))

  for (let i = 0; i < totalFrames; i++) {
    const progress = totalFrames === 1 ? 1 : i / (totalFrames - 1)
    const easedProgress = applyEasing(
      progress,
      ctx.step.easing || 'ease-in-out'
    )

    await onFrame(easedProgress)

    const frameNumber = String(ctx.frameCount.value).padStart(4, '0')
    const framePath = `${ctx.frameDir}/frame_${frameNumber}.png`
    await ctx.page.screenshot({ path: framePath, type: 'png' })
    ctx.frameCount.value++
  }
}

/**
 * Easing curves for camera motion.
 *
 * The original set was quadratic throughout, which is the main reason renders
 * read as mechanical: a quadratic ease-out still arrives at the target with
 * noticeable speed, so a zoom appears to stop dead rather than settle. Camera
 * moves in screen-recording tools are cubic or stronger — they cover most of
 * the distance early and glide into the final frames.
 *
 * `ease-out-expo` is the closest of these to how a hand-held zoom settles and
 * is the default for that reason. `spring` adds a small overshoot, which reads
 * as lively on a short move and seasick on a long one — use it under ~0.6s.
 */
function applyEasing(t: number, easing: string): number {
  switch (easing) {
    case 'linear':
      return t
    case 'ease-in':
      return t * t * t
    case 'ease-out':
      return 1 - Math.pow(1 - t, 3)
    case 'ease-in-out':
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
    case 'ease-out-expo':
      return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)
    case 'ease-in-out-quart':
      return t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2
    case 'spring': {
      // Damped oscillation, clamped so a frame can never render past the end
      // state — an overshoot that never resolves looks like a glitch.
      if (t >= 1) return 1
      const c = 2 * Math.PI / 3
      return 1 + Math.pow(2, -9 * t) * Math.sin((t * 10 - 0.75) * c)
    }
    default:
      return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)
  }
}

export async function actionScrollTo(ctx: ActionContext): Promise<void> {
  const { page, step } = ctx

  const targetY = await page.evaluate(({ selector, offset }) => {
    const el = selector ? document.querySelector(selector) : null
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    return window.scrollY + rect.top - (offset ?? 80)
  }, { selector: step.target, offset: step.scrollOffset })

  const startScrollY = await page.evaluate(() => window.scrollY)
  const endScrollY = targetY

  await captureFrames(ctx, step.duration, async (progress) => {
    const currentY = startScrollY + (endScrollY - startScrollY) * progress
    await page.evaluate((y) => window.scrollTo(0, y), currentY)
  })
}

export async function actionZoomIn(ctx: ActionContext): Promise<void> {
  const { page, step, viewport } = ctx
  const startZoom = 1.0

  // Measure the target in DOCUMENT space, not viewport space.
  //
  // The origin used to be expressed as a percentage of the viewport
  // (`elementCenter.x / viewport.width * 100`). A percentage transform-origin
  // resolves against the box of the element being transformed — the body —
  // which on any scrollable page is far taller than the viewport. On a 5000px
  // body with a 720px viewport, an element in the middle of the screen
  // produced "50%", i.e. 2500px down the document, and the zoom landed
  // somewhere else entirely. Pixel offsets in document space have no such
  // ambiguity, so the zoom lands on the component every time.
  const target = await page.evaluate((selector) => {
    const el = selector ? document.querySelector(selector) : null
    if (!el) {
      return {
        originX: window.scrollX + window.innerWidth / 2,
        originY: window.scrollY + window.innerHeight / 2,
        width: 0,
        height: 0,
        found: false,
      }
    }
    const rect = el.getBoundingClientRect()
    return {
      originX: window.scrollX + rect.left + rect.width / 2,
      originY: window.scrollY + rect.top + rect.height / 2,
      width: rect.width,
      height: rect.height,
      found: true,
    }
  }, step.target)

  // `zoom` may be a number, or omitted to frame the component automatically.
  // Auto-fit is what you want when zooming to a real UI component: a fixed 2x
  // is too tight on a wide panel and too loose on a small control.
  const PADDING = 1.15
  const autoFit =
    target.found && target.width > 0 && target.height > 0
      ? Math.min(
          viewport.width / (target.width * PADDING),
          viewport.height / (target.height * PADDING)
        )
      : 2.0
  // Never zoom OUT in a zoom-in step, and cap the magnification so a tiny
  // element does not scale into a wall of blurred pixels.
  const targetZoom = step.zoom || Math.max(1.2, Math.min(autoFit, 4.0))

  await captureFrames(ctx, step.duration, async (progress) => {
    const currentZoom = startZoom + (targetZoom - startZoom) * progress

    await page.evaluate(
      ({ zoom, ox, oy }) => {
        const body = document.body as HTMLElement
        body.style.transformOrigin = `${ox}px ${oy}px`
        body.style.transform = `scale(${zoom})`
        body.style.transition = 'none'
      },
      { zoom: currentZoom, ox: target.originX, oy: target.originY }
    )
  })
}

export async function actionZoomOut(ctx: ActionContext): Promise<void> {
  const { page } = ctx

  // Read the actual current zoom from the page — don't trust step.zoom
  const startZoom = await page.evaluate(() => {
    const body = document.body as HTMLElement
    const match = body.style.transform.match(/scale\(([^)]+)\)/)
    return match ? parseFloat(match[1]) : 1.0
  })

  // Already at 1x — nothing to do, just capture static frames
  if (startZoom <= 1.0) {
    await captureFrames(ctx, ctx.step.duration, async () => {})
    return
  }

  const endZoom = 1.0

  await captureFrames(ctx, ctx.step.duration, async (progress) => {
    // Overshooting easings (spring) drive progress past 1, which would take the
    // scale below 1.0 mid-move. The branch below clears the transform at <= 1,
    // so an un-clamped overshoot makes the page snap back to full size and then
    // jump again on the next frame. Clamp so the move only ever settles.
    const raw = startZoom + (endZoom - startZoom) * progress
    const currentZoom = Math.max(endZoom, raw)
    const isFinalFrame = progress >= 1

    await page.evaluate(
      ({ zoom, done }) => {
        const body = document.body as HTMLElement
        if (done && zoom <= 1.0) {
          // Only tear the transform down once we have actually arrived, so the
          // page is left exactly as it was found.
          body.style.transform = ''
          body.style.transformOrigin = ''
          body.style.transition = ''
        } else {
          body.style.transform = `scale(${zoom})`
          body.style.transition = 'none'
        }
      },
      { zoom: currentZoom, done: isFinalFrame }
    )
  })
}

export async function actionHighlight(ctx: ActionContext): Promise<void> {
  const { page, step } = ctx
  const color = step.highlightColor || '#3B82F6'

  await page.evaluate(
    ({ selector, color }) => {
      const existing = document.getElementById('__demoscript_highlight')
      if (existing) existing.remove()

      const el = selector ? document.querySelector(selector) : null
      if (!el) return

      const rect = el.getBoundingClientRect()
      const overlay = document.createElement('div')
      overlay.id = '__demoscript_highlight'
      overlay.style.cssText = `
      position: fixed;
      left: ${rect.left - 4}px;
      top: ${rect.top - 4}px;
      width: ${rect.width + 8}px;
      height: ${rect.height + 8}px;
      border: 3px solid ${color};
      border-radius: 6px;
      background: ${color}22;
      pointer-events: none;
      z-index: 999999;
      box-shadow: 0 0 0 4px ${color}44;
    `
      document.body.appendChild(overlay)
    },
    { selector: step.target, color }
  )

  await captureFrames(ctx, step.duration, async (progress) => {
    let opacity = 1
    if (progress < 0.15) opacity = progress / 0.15
    // fade out only in the last 15% but never reach 0 — removal happens after loop
    else if (progress > 0.85) opacity = Math.max(0.15, (1 - progress) / 0.15)

    await page.evaluate((op) => {
      const el = document.getElementById('__demoscript_highlight')
      if (el) el.style.opacity = String(op)
    }, opacity)
  })

  await page.evaluate(() => {
    document.getElementById('__demoscript_highlight')?.remove()
  })
}

export async function actionWait(ctx: ActionContext): Promise<void> {
  await captureFrames(ctx, ctx.step.duration, async () => {
    // No-op — just capture the current state
  })
}

export async function actionPan(ctx: ActionContext): Promise<void> {
  const { page, step, viewport } = ctx

  const targetElement = await page.evaluate((selector) => {
    const el = selector ? document.querySelector(selector) : null
    if (!el) return null
    const rect = el.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  }, step.target)

  if (!targetElement) return

  const startX = await page.evaluate(() => window.scrollX)
  const startY = await page.evaluate(() => window.scrollY)
  const endX = Math.max(0, targetElement.x - viewport.width / 2)
  const endY = Math.max(0, targetElement.y - viewport.height / 2)

  await captureFrames(ctx, step.duration, async (progress) => {
    const x = startX + (endX - startX) * progress
    const y = startY + (endY - startY) * progress
    await page.evaluate(({ x, y }) => window.scrollTo(x, y), { x, y })
  })
}

async function injectCursor(page: Page, x: number, y: number): Promise<void> {
  await page.evaluate(({ x, y }) => {
    let cursor = document.getElementById('__demoscript_cursor') as HTMLElement | null
    if (!cursor) {
      cursor = document.createElement('div')
      cursor.id = '__demoscript_cursor'
      cursor.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M5 2L19 12.5L12 13.5L8.5 20L5 2Z" fill="white" stroke="#1a1a1a" stroke-width="1.5" stroke-linejoin="round"/>
      </svg>`
      cursor.style.cssText = `
        position: fixed;
        pointer-events: none;
        z-index: 2147483647;
        top: 0; left: 0;
        transform-origin: 4px 2px;
        filter: drop-shadow(0 1px 3px rgba(0,0,0,0.4));
      `
      document.body.appendChild(cursor)
    }
    cursor.style.transform = `translate(${x}px, ${y}px)`
    cursor.style.display = 'block'
  }, { x, y })
}

export async function actionCursorMove(ctx: ActionContext): Promise<void> {
  const { page, step, shared } = ctx

  const targetPos = await page.evaluate((selector) => {
    const el = selector ? document.querySelector(selector) : null
    if (!el) return null
    const rect = el.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  }, step.target)

  if (!targetPos) return

  const startX = shared.cursorX
  const startY = shared.cursorY

  await captureFrames(ctx, step.duration, async (progress) => {
    const x = startX + (targetPos.x - startX) * progress
    const y = startY + (targetPos.y - startY) * progress
    await injectCursor(page, x, y)
    await page.mouse.move(x, y)
  })

  shared.cursorX = targetPos.x
  shared.cursorY = targetPos.y
}

export async function injectAnnotation(
  page: Page,
  text: string
): Promise<void> {
  await page.evaluate((annotationText) => {
    const existing = document.getElementById('__demoscript_annotation')
    if (existing) existing.remove()

    const el = document.createElement('div')
    el.id = '__demoscript_annotation'
    el.textContent = annotationText
    el.style.cssText = `
      position: fixed;
      bottom: 32px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0, 0, 0, 0.85);
      color: white;
      padding: 12px 24px;
      border-radius: 8px;
      font-family: -apple-system, sans-serif;
      font-size: 16px;
      font-weight: 500;
      z-index: 999999;
      backdrop-filter: blur(8px);
      border: 1px solid rgba(255,255,255,0.1);
      max-width: 600px;
      text-align: center;
      pointer-events: none;
    `
    document.body.appendChild(el)
  }, text)
}

export async function removeAnnotation(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.getElementById('__demoscript_annotation')?.remove()
  })
}

export async function actionClick(ctx: ActionContext): Promise<void> {
  const { page, step, shared } = ctx

  const targetPos = await page.evaluate((selector) => {
    const el = selector ? document.querySelector(selector) : null
    if (!el) return null
    const rect = el.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  }, step.target)

  if (!targetPos) return

  const startX = shared.cursorX
  const startY = shared.cursorY

  // 60% of duration: move cursor to target
  const moveDuration = step.duration * 0.6
  const holdDuration = step.duration * 0.4

  await captureFrames({ ...ctx, step: { ...ctx.step, duration: moveDuration } }, moveDuration, async (progress) => {
    const x = startX + (targetPos.x - startX) * progress
    const y = startY + (targetPos.y - startY) * progress
    await injectCursor(page, x, y)
    await page.mouse.move(x, y)
  })

  shared.cursorX = targetPos.x
  shared.cursorY = targetPos.y

  // Click
  if (step.target) {
    await page.click(step.target).catch(() => {})
  }

  // 40% of duration: hold on the clicked element
  await captureFrames({ ...ctx, step: { ...ctx.step, duration: holdDuration } }, holdDuration, async () => {
    await injectCursor(page, targetPos.x, targetPos.y)
  })
}

export async function actionType(ctx: ActionContext): Promise<void> {
  const { page, step, shared } = ctx
  const text = step.typeText || ''
  if (!text || !step.target) return

  // Move cursor to the field first
  const targetPos = await page.evaluate((selector) => {
    const el = selector ? document.querySelector(selector) : null
    if (!el) return null
    const rect = el.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  }, step.target)

  if (targetPos) {
    await injectCursor(page, targetPos.x, targetPos.y)
    await page.mouse.move(targetPos.x, targetPos.y)
    shared.cursorX = targetPos.x
    shared.cursorY = targetPos.y
  }

  // Click to focus
  await page.click(step.target).catch(() => {})
  // Clear existing value
  await page.evaluate((sel) => {
    const el = document.querySelector(sel!) as HTMLInputElement | HTMLTextAreaElement | null
    if (el && 'value' in el) el.value = ''
  }, step.target)

  await captureFrames(ctx, step.duration, async (progress) => {
    const charCount = Math.round(progress * text.length)
    const partial = text.slice(0, charCount)
    await page.evaluate(({ sel, val }) => {
      const el = document.querySelector(sel!) as HTMLInputElement | HTMLTextAreaElement | null
      if (el && 'value' in el) {
        el.value = val
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }
    }, { sel: step.target!, val: partial })
    if (targetPos) await injectCursor(page, targetPos.x, targetPos.y)
  })
}

export async function actionHover(ctx: ActionContext): Promise<void> {
  const { page, step, shared } = ctx

  const targetPos = await page.evaluate((selector) => {
    const el = selector ? document.querySelector(selector) : null
    if (!el) return null
    const rect = el.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  }, step.target)

  if (!targetPos) return

  const startX = shared.cursorX
  const startY = shared.cursorY

  // Move to element over 40% of duration, then hold the hover for 60%
  const moveDuration = step.duration * 0.4
  const holdDuration = step.duration * 0.6

  await captureFrames({ ...ctx, step: { ...ctx.step, duration: moveDuration } }, moveDuration, async (progress) => {
    const x = startX + (targetPos.x - startX) * progress
    const y = startY + (targetPos.y - startY) * progress
    await injectCursor(page, x, y)
    await page.mouse.move(x, y)
  })

  shared.cursorX = targetPos.x
  shared.cursorY = targetPos.y

  // Trigger hover state via mouse move at target
  await page.mouse.move(targetPos.x, targetPos.y)

  await captureFrames({ ...ctx, step: { ...ctx.step, duration: holdDuration } }, holdDuration, async () => {
    await injectCursor(page, targetPos.x, targetPos.y)
  })
}

export async function executeAction(ctx: ActionContext): Promise<void> {
  // Inject annotation if present
  if (ctx.step.annotation) {
    await injectAnnotation(ctx.page, ctx.step.annotation)
  }

  switch (ctx.step.action) {
    case 'scroll-to':
      return actionScrollTo(ctx)
    case 'zoom-in':
      return actionZoomIn(ctx)
    case 'zoom-out':
      return actionZoomOut(ctx)
    case 'highlight':
      return actionHighlight(ctx)
    case 'wait':
      return actionWait(ctx)
    case 'pan':
      return actionPan(ctx)
    case 'cursor-move':
      return actionCursorMove(ctx)
    case 'click':
      return actionClick(ctx)
    case 'type':
      return actionType(ctx)
    case 'hover':
      return actionHover(ctx)
    default:
      return actionWait(ctx)
  }
}
