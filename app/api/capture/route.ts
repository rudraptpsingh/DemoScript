import { NextRequest, NextResponse } from 'next/server'
import { chromium } from 'playwright'
import { PageCapture, CapturedElement } from '@/lib/types'
import { z } from 'zod'

const RequestSchema = z.object({
  url: z.string().url(),
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { url } = RequestSchema.parse(body)

    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    })
    const page = await browser.newPage()
    await page.setViewportSize({ width: 1280, height: 720 })

    try {
      await page.goto(url, { waitUntil: 'load', timeout: 20000 })
      await page.waitForTimeout(1000)

      const screenshotBuffer = await page.screenshot({
        type: 'jpeg',
        quality: 85,
        fullPage: false,
      })
      const screenshotBase64 = screenshotBuffer.toString('base64')

      const elements: CapturedElement[] = await page.evaluate(() => {
        const selectors = [
          'header',
          'nav',
          'main',
          'footer',
          'section',
          'article',
          'h1',
          'h2',
          'h3',
          '[class*="hero"]',
          '[class*="banner"]',
          '[class*="pricing"]',
          '[class*="feature"]',
          '[class*="cta"]',
          '[class*="button"]',
          'button',
          'form',
          '[id]',
        ]

        const seen = new Set<string>()
        const results: {
          selector: string
          label: string
          boundingBox: {
            x: number
            y: number
            width: number
            height: number
          }
          tagName: string
          innerText: string
        }[] = []

        for (const selector of selectors) {
          const els = Array.from(document.querySelectorAll(selector)).slice(
            0,
            3
          )
          for (const el of els) {
            const rect = el.getBoundingClientRect()
            if (rect.width < 10 || rect.height < 10) continue
            if (rect.top < 0 || rect.left < 0) continue

            let cssSelector = ''
            if (el.id) {
              cssSelector = `#${el.id}`
            } else if (
              el.className &&
              typeof el.className === 'string' &&
              el.className.trim()
            ) {
              const cls = el.className.trim().split(/\s+/)[0]
              cssSelector = `${el.tagName.toLowerCase()}.${cls}`
            } else {
              cssSelector = el.tagName.toLowerCase()
            }

            if (seen.has(cssSelector)) continue
            seen.add(cssSelector)

            results.push({
              selector: cssSelector,
              label:
                el.id ||
                el.getAttribute('aria-label') ||
                el.tagName.toLowerCase() +
                  (el.className && typeof el.className === 'string'
                    ? `.${el.className.trim().split(/\s+/)[0]}`
                    : ''),
              boundingBox: {
                x: Math.round(rect.left),
                y: Math.round(rect.top),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
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

      const pageHeight = await page.evaluate(
        () => document.body.scrollHeight
      )

      const capture: PageCapture = {
        url,
        screenshotBase64,
        elements,
        pageHeight,
        pageWidth: 1280,
      }

      return NextResponse.json(capture)
    } finally {
      await browser.close()
    }
  } catch (error) {
    console.error('Capture error:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Capture failed',
      },
      { status: 500 }
    )
  }
}
