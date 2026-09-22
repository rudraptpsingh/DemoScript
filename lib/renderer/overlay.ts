/**
 * On-screen text: captions, callouts and title cards.
 *
 * Two rules drive every number here.
 *
 * 1. Type is sized as a FRACTION OF FRAME HEIGHT, never in fixed pixels. The
 *    same script renders at 720p for a blog embed and at 1920px tall for a
 *    phone-shaped reel; a 16px caption that reads on a desktop screenshot is
 *    unreadable in the second. Ratios keep the text the same physical size
 *    relative to the picture, which is how broadcast subtitles are specified.
 *
 * 2. Overlays mount on <html>, never on <body>. The camera transforms <body>,
 *    and `position: fixed` inside a transformed element resolves against that
 *    element rather than the viewport — so a caption parented to <body> would
 *    scale and drift with every zoom.
 */
import type { Page } from 'playwright'

export type TextPosition = 'bottom' | 'top' | 'center' | 'callout'

/** Design tokens, all relative to the frame unless noted. */
export const TEXT_SCALE = {
  /** Caption type size as a share of frame height. */
  caption: 0.034,
  captionMin: 18,
  captionMax: 44,
  /** Title-card heading, and its subtitle as a share of the heading. */
  title: 0.075,
  titleMin: 34,
  titleMax: 96,
  subtitleOfTitle: 0.52,
  /** Keep text inside this margin — platform chrome crops the edges. */
  safe: 0.055,
  /** Long lines are hard to read; hold captions near 40-60 characters. */
  captionMaxWidth: 0.66,
  titleMaxWidth: 0.8,
  /** Seconds of fade at each end of a step. */
  fade: 0.28,
} as const

export function captionFontPx(frameHeight: number): number {
  return Math.round(
    Math.min(TEXT_SCALE.captionMax, Math.max(TEXT_SCALE.captionMin, frameHeight * TEXT_SCALE.caption))
  )
}

export function titleFontPx(frameHeight: number): number {
  return Math.round(
    Math.min(TEXT_SCALE.titleMax, Math.max(TEXT_SCALE.titleMin, frameHeight * TEXT_SCALE.title))
  )
}

/**
 * Opacity for a step at linear progress `p`, fading in and out.
 * Short steps get proportionally shorter fades so text is never mid-fade for
 * the whole shot.
 */
export function fadeOpacity(p: number, durationSeconds: number): number {
  const fade = Math.min(TEXT_SCALE.fade, durationSeconds * 0.3)
  if (fade <= 0 || durationSeconds <= 0) return 1
  const f = fade / durationSeconds
  if (p <= 0 || p >= 1) return 0
  if (p < f) return p / f
  if (p > 1 - f) return (1 - p) / f
  return 1
}

const ROOT_ID = '__demoscript_text'

/** The one font stack every platform resolves to something well-made. */
const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI Variable Display', 'Segoe UI', Inter, 'Helvetica Neue', Arial, sans-serif"

export interface CaptionOptions {
  text: string
  position?: TextPosition
  /** Second line, smaller and quieter — the "why" under the "what". */
  subtitle?: string
  /** Anchor rect for `callout`, in viewport coordinates. */
  anchor?: { x: number; y: number; w: number; h: number } | null
}

export async function showCaption(page: Page, opts: CaptionOptions): Promise<void> {
  await page.evaluate(
    ({ o, ROOT_ID, FONT, SCALE }) => {
      const doc = document.documentElement
      document.getElementById(ROOT_ID)?.remove()

      const vh = window.innerHeight
      const vw = window.innerWidth
      const size = Math.round(
        Math.min(SCALE.captionMax, Math.max(SCALE.captionMin, vh * SCALE.caption))
      )
      const safe = Math.round(vh * SCALE.safe)
      const position = o.position || 'bottom'

      const root = document.createElement('div')
      root.id = ROOT_ID
      root.style.cssText = [
        'position: fixed',
        'left: 0',
        'top: 0',
        `width: ${vw}px`,
        `height: ${vh}px`,
        'pointer-events: none',
        'z-index: 2147483647',
        'opacity: 0',
        `font-family: ${FONT}`,
      ].join(';')

      const card = document.createElement('div')
      // A scrim rather than a text shadow: these sit over photographs, where a
      // shadow alone leaves light text on light frames unreadable.
      card.style.cssText = [
        'position: absolute',
        `max-width: ${Math.round(vw * SCALE.captionMaxWidth)}px`,
        `padding: ${Math.round(size * 0.55)}px ${Math.round(size * 0.9)}px`,
        `border-radius: ${Math.round(size * 0.5)}px`,
        'background: rgba(8, 8, 8, 0.78)',
        'border: 1px solid rgba(255, 255, 255, 0.14)',
        'backdrop-filter: blur(10px)',
        'box-shadow: 0 8px 40px rgba(0, 0, 0, 0.45)',
        'color: #fafafa',
        'text-align: center',
        'text-wrap: balance',
      ].join(';')

      const line = document.createElement('div')
      line.textContent = o.text
      line.style.cssText = [
        `font-size: ${size}px`,
        'font-weight: 600',
        'line-height: 1.3',
        // Large type needs tightening; small type does not.
        `letter-spacing: ${size > 30 ? '-0.015em' : '0'}`,
      ].join(';')
      card.appendChild(line)

      if (o.subtitle) {
        const sub = document.createElement('div')
        sub.textContent = o.subtitle
        sub.style.cssText = [
          `font-size: ${Math.round(size * 0.68)}px`,
          'font-weight: 450',
          'line-height: 1.35',
          `margin-top: ${Math.round(size * 0.28)}px`,
          'color: rgba(250, 250, 250, 0.72)',
        ].join(';')
        card.appendChild(sub)
      }

      root.appendChild(card)
      doc.appendChild(root)

      // Place after measuring, so the card can be centred on its real size and
      // clamped inside the safe area.
      const r = card.getBoundingClientRect()
      let left = Math.round((vw - r.width) / 2)
      let top = vh - safe - r.height
      if (position === 'top') top = safe
      else if (position === 'center') top = Math.round((vh - r.height) / 2)
      else if (position === 'callout' && o.anchor) {
        // Sit under the anchor, or above it when there is no room below.
        const gap = Math.round(size * 0.7)
        const below = o.anchor.y + o.anchor.h + gap
        top = below + r.height + safe <= vh ? below : o.anchor.y - gap - r.height
        left = Math.round(o.anchor.x + o.anchor.w / 2 - r.width / 2)
      }
      left = Math.min(vw - safe - r.width, Math.max(safe, left))
      top = Math.min(vh - safe - r.height, Math.max(safe, top))
      card.style.left = `${left}px`
      card.style.top = `${top}px`
    },
    { o: opts, ROOT_ID, FONT, SCALE: TEXT_SCALE }
  )
}

/** A full-frame story card: heading, optional subtitle, over a scrim. */
export async function showTitleCard(
  page: Page,
  opts: { text: string; subtitle?: string }
): Promise<void> {
  await page.evaluate(
    ({ o, ROOT_ID, FONT, SCALE }) => {
      document.getElementById(ROOT_ID)?.remove()
      const vh = window.innerHeight
      const vw = window.innerWidth
      const size = Math.round(Math.min(SCALE.titleMax, Math.max(SCALE.titleMin, vh * SCALE.title)))

      const root = document.createElement('div')
      root.id = ROOT_ID
      root.style.cssText = [
        'position: fixed',
        'inset: 0',
        'display: flex',
        'flex-direction: column',
        'align-items: center',
        'justify-content: center',
        `padding: 0 ${Math.round(vw * SCALE.safe)}px`,
        'background: rgba(4, 4, 4, 0.86)',
        'backdrop-filter: blur(6px)',
        'pointer-events: none',
        'z-index: 2147483647',
        'opacity: 0',
        `font-family: ${FONT}`,
        'color: #fafafa',
        'text-align: center',
      ].join(';')

      const h = document.createElement('div')
      h.textContent = o.text
      h.style.cssText = [
        `font-size: ${size}px`,
        'font-weight: 700',
        'line-height: 1.1',
        'letter-spacing: -0.03em',
        `max-width: ${Math.round(vw * SCALE.titleMaxWidth)}px`,
        'text-wrap: balance',
      ].join(';')
      root.appendChild(h)

      if (o.subtitle) {
        const sub = document.createElement('div')
        sub.textContent = o.subtitle
        sub.style.cssText = [
          `font-size: ${Math.round(size * SCALE.subtitleOfTitle)}px`,
          'font-weight: 450',
          'line-height: 1.35',
          `margin-top: ${Math.round(size * 0.3)}px`,
          'color: rgba(250, 250, 250, 0.7)',
          `max-width: ${Math.round(vw * 0.62)}px`,
          'text-wrap: balance',
        ].join(';')
        root.appendChild(sub)
      }
      document.documentElement.appendChild(root)
    },
    { o: opts, ROOT_ID, FONT, SCALE: TEXT_SCALE }
  )
}

export async function setTextOpacity(page: Page, opacity: number): Promise<void> {
  await page.evaluate(
    ({ ROOT_ID, opacity }) => {
      const el = document.getElementById(ROOT_ID)
      if (el) el.style.opacity = String(opacity)
    },
    { ROOT_ID, opacity }
  )
}

export async function clearText(page: Page): Promise<void> {
  await page.evaluate((ROOT_ID) => document.getElementById(ROOT_ID)?.remove(), ROOT_ID)
}
