import { NextRequest, NextResponse } from 'next/server'
import { generateScript } from '@/lib/ai/scriptGenerator'

const RATE_LIMIT = new Map<string, { count: number; resetAt: number }>()

function checkRateLimit(ip: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  const record = RATE_LIMIT.get(ip)
  if (!record || now > record.resetAt) {
    RATE_LIMIT.set(ip, { count: 1, resetAt: now + windowMs })
    return true
  }
  if (record.count >= limit) return false
  record.count++
  return true
}

function isPublicUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    const hostname = parsed.hostname

    // Block localhost and private IP ranges
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return false
    if (/^10\./.test(hostname)) return false
    if (/^192\.168\./.test(hostname)) return false
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return false

    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get('x-forwarded-for') || 'unknown'
    if (!checkRateLimit(ip, 10, 60 * 60 * 1000)) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Maximum 10 AI generations per hour.' },
        { status: 429 }
      )
    }

    const { url, prompt } = await req.json()

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'url is required' }, { status: 400 })
    }

    if (!prompt || typeof prompt !== 'string') {
      return NextResponse.json({ error: 'prompt is required' }, { status: 400 })
    }

    if (prompt.length > 1000) {
      return NextResponse.json(
        { error: 'Prompt is too long. Maximum 1000 characters.' },
        { status: 400 }
      )
    }

    if (!isPublicUrl(url)) {
      return NextResponse.json(
        { error: 'URL must be a public HTTP/HTTPS URL (localhost and private IPs not allowed).' },
        { status: 400 }
      )
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return NextResponse.json(
        { error: 'AI generation is not configured on this server (missing ANTHROPIC_API_KEY).' },
        { status: 503 }
      )
    }

    const result = await generateScript({ url, prompt, apiKey })

    return NextResponse.json({
      steps: result.steps,
      estimatedDuration: result.estimatedDuration,
      tokensUsed: result.tokensUsed,
    })
  } catch (error) {
    console.error('Generate error:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'AI generation failed',
      },
      { status: 500 }
    )
  }
}
