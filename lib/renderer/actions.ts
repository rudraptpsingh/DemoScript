import { Page } from 'playwright'
import { Step } from '../types'
import {
  clearText,
  fadeOpacity,
  setTextOpacity,
  showCaption,
  showTitleCard,
} from './overlay'

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

  const hasText = Boolean(ctx.step.annotation)
  for (let i = 0; i < totalFrames; i++) {
    const progress = totalFrames === 1 ? 1 : i / (totalFrames - 1)
    const easedProgress = applyEasing(
      progress,
      ctx.step.easing || 'ease-in-out'
    )

    await onFrame(easedProgress)
    // Text fades on the RAW progress, not the eased one: a caption should
    // appear at a steady rate even while the camera is accelerating.
    if (hasText) await setTextOpacity(ctx.page, fadeOpacity(progress, durationSeconds))

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
 * `smooth` (smootherstep) is the default for camera moves. It starts and ends
 * with zero speed AND zero acceleration, so a zoom neither lurches off the
 * mark nor stops dead. `ease-out-expo` looks lively on paper but covers ~28% of
 * a 42-frame zoom in its first frame, which reads as a jerk on screen.
 * `spring` adds a small overshoot: lively on a short move, seasick on a long
 * one — use it under ~0.6s.
 */
/** @internal exported for tests */
export function applyEasing(t: number, easing: string): number {
  switch (easing) {
    case 'linear':
      return t
    case 'ease-in':
      return t * t * t
    case 'ease-out':
      return 1 - Math.pow(1 - t, 3)
    case 'ease-in-out':
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
    case 'smooth':
      return t <= 0 ? 0 : t >= 1 ? 1 : t * t * t * (t * (6 * t - 15) + 10)
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
      return t <= 0 ? 0 : t >= 1 ? 1 : t * t * t * (t * (6 * t - 15) + 10)
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

/**
 * The camera: a single translate + scale on <body>, persisted between steps.
 *
 * Zooms are camera moves, not isolated effects. Each zoom starts from wherever
 * the camera already is, so `zoom-in A` then `zoom-in B` glides from one
 * component to the next instead of cutting back to full frame in between.
 *
 * Three things make it read as smooth rather than jerky:
 *  - scale is interpolated in LOG space. Perceived zoom is proportional to the
 *    ratio between frames, so a linear 1x->4x ramp spends its first frames
 *    lurching and its last frames crawling;
 *  - the default easing starts and ends at rest (see `smooth`);
 *  - the target moves to the CENTRE of the frame while it grows, rather than
 *    growing in place. Growing in place pins anything near an edge to that
 *    edge and pushes half of it off screen.
 * Translation is clamped so the edge of the page never slides into view.
 */
export interface Camera {
  s: number
  tx: number
  ty: number
}

export interface Stage {
  vw: number
  vh: number
  /** Content box origin and size, measured with the camera removed. */
  bx: number
  by: number
  cw: number
  ch: number
  target: { x: number; y: number; w: number; h: number } | null
  camera: Camera
}

async function measureStage(page: Page, selector: string | null): Promise<Stage> {
  return page.evaluate((sel) => {
    const body = document.body as HTMLElement
    let camera = { s: 1, tx: 0, ty: 0 }
    try {
      if (body.dataset.dsCamera) camera = JSON.parse(body.dataset.dsCamera)
    } catch {
      /* fall back to identity */
    }
    // Measure the untransformed layout: lift the camera for a synchronous
    // layout read and put it straight back. No paint happens in between.
    const prev = body.style.transform
    body.style.transform = 'none'
    const b = body.getBoundingClientRect()
    const el = sel ? document.querySelector(sel) : null
    const r = el ? el.getBoundingClientRect() : null
    const doc = document.documentElement
    body.style.transform = prev
    return {
      vw: window.innerWidth,
      vh: window.innerHeight,
      bx: b.left,
      by: b.top,
      // Apps often size <body> to the window while pages grow with content;
      // use whichever is larger so clamping covers the real content.
      cw: Math.max(b.width, doc.scrollWidth),
      ch: Math.max(b.height, doc.scrollHeight),
      target:
        r && r.width > 0 && r.height > 0 ? { x: r.left, y: r.top, w: r.width, h: r.height } : null,
      camera,
    }
  }, selector)
}

/** Translation that puts content point (wx, wy) at the frame centre at scale s, clamped. */
/** @internal exported for tests */
export function cameraFor(stage: Stage, s: number, wx: number, wy: number): Camera {
  const { vw, vh, bx, by, cw, ch } = stage
  let tx = vw / 2 - bx - (wx - bx) * s
  let ty = vh / 2 - by - (wy - by) * s
  // Keep the scaled content covering the frame. Skip an axis whose content is
  // smaller than the frame at this scale; there is nothing to clamp against.
  const clamp = (v: number, lo: number, hi: number) =>
    lo > hi ? v : Math.min(hi, Math.max(lo, v))
  tx = clamp(tx, vw - bx - cw * s, -bx)
  ty = clamp(ty, vh - by - ch * s, -by)
  return { s, tx, ty }
}

/** Content point currently under the frame centre. */
/** @internal exported for tests */
export function focusOf(stage: Stage, cam: Camera): { x: number; y: number } {
  return {
    x: stage.bx + (stage.vw / 2 - stage.bx - cam.tx) / cam.s,
    y: stage.by + (stage.vh / 2 - stage.by - cam.ty) / cam.s,
  }
}

async function applyCamera(page: Page, cam: Camera, final: boolean): Promise<void> {
  await page.evaluate(
    ({ s, tx, ty, final }) => {
      const body = document.body as HTMLElement
      const identity = s <= 1.0001 && Math.abs(tx) < 0.5 && Math.abs(ty) < 0.5
      if (final && identity) {
        // Leave the page exactly as it was found.
        body.style.transform = ''
        body.style.transformOrigin = ''
        body.style.transition = ''
        delete body.dataset.dsCamera
        return
      }
      body.style.transformOrigin = '0 0'
      body.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`
      body.style.transition = 'none'
      body.dataset.dsCamera = JSON.stringify({ s, tx, ty })
    },
    { ...cam, final }
  )
}

/** Glide the camera from where it is to `to`, one eased frame at a time. */
async function moveCamera(ctx: ActionContext, stage: Stage, to: Camera): Promise<void> {
  const from = stage.camera
  const a = focusOf(stage, from)
  const b = focusOf(stage, to)
  const logFrom = Math.log(from.s)
  const logTo = Math.log(to.s)
  // Camera moves start and end at rest unless the script asks otherwise.
  const eased: ActionContext = {
    ...ctx,
    step: { ...ctx.step, easing: ctx.step.easing ?? 'smooth' },
  }
  await captureFrames(eased, ctx.step.duration, async (p) => {
    const done = p >= 1
    // Never below 1x: an overshooting curve must not shrink the page and
    // reveal its edges mid-move.
    const s = done ? to.s : Math.max(1, Math.exp(logFrom + (logTo - logFrom) * p))
    const cam = done ? to : cameraFor(stage, s, a.x + (b.x - a.x) * p, a.y + (b.y - a.y) * p)
    await applyCamera(ctx.page, cam, done)
  })
}

export async function actionZoomIn(ctx: ActionContext): Promise<void> {
  const stage = await measureStage(ctx.page, ctx.step.target)
  const t = stage.target
  // `zoom` may be a number, or omitted to frame the component automatically:
  // a fixed 2x is too tight on a wide panel and too loose on a small control.
  const PADDING = 1.15
  const fit = t ? Math.min(stage.vw / (t.w * PADDING), stage.vh / (t.h * PADDING)) : 2.0
  const s = ctx.step.zoom || Math.max(1.2, Math.min(fit, 4.0))
  const cx = t ? t.x + t.w / 2 : stage.vw / 2
  const cy = t ? t.y + t.h / 2 : stage.vh / 2
  await moveCamera(ctx, stage, cameraFor(stage, s, cx, cy))
}

export async function actionZoomOut(ctx: ActionContext): Promise<void> {
  const stage = await measureStage(ctx.page, null)
  const { s, tx, ty } = stage.camera
  if (s <= 1.0001 && tx === 0 && ty === 0) {
    // Already at full frame: hold, so the step still has its duration.
    await captureFrames(ctx, ctx.step.duration, async () => {})
    return
  }
  await moveCamera(ctx, stage, { s: 1, tx: 0, ty: 0 })
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
      document.documentElement.appendChild(overlay)
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
      document.documentElement.appendChild(cursor)
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

export async function injectAnnotation(ctx: ActionContext): Promise<void> {
  const { page, step } = ctx
  const position = step.annotationPosition ?? 'bottom'
  let anchor: { x: number; y: number; w: number; h: number } | null = null
  if (position === 'callout' && step.target) {
    anchor = await page.evaluate((sel) => {
      const el = document.querySelector(sel)
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.left, y: r.top, w: r.width, h: r.height }
    }, step.target)
  }
  await showCaption(page, {
    text: step.annotation as string,
    position,
    subtitle: step.subtitle,
    anchor,
  })
}

export async function removeAnnotation(page: Page): Promise<void> {
  await clearText(page)
}

/** A full-frame story card. The heading carries the beat; the subtitle, the why. */
export async function actionTitle(ctx: ActionContext): Promise<void> {
  await showTitleCard(ctx.page, {
    text: ctx.step.annotation ?? ctx.step.targetLabel ?? '',
    subtitle: ctx.step.subtitle,
  })
  await captureFrames(ctx, ctx.step.duration, async () => {})
  await clearText(ctx.page)
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
  // A title card draws its own full-frame text; every other action can carry a
  // caption over whatever it is doing.
  if (ctx.step.annotation && ctx.step.action !== 'title') {
    await injectAnnotation(ctx)
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
    case 'title':
      return actionTitle(ctx)
    default:
      return actionWait(ctx)
  }
}
