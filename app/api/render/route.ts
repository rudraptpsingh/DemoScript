import { NextRequest, NextResponse } from 'next/server'
import { nanoid } from 'nanoid'
import { DemoScript } from '@/lib/types'
import { jobsDb } from '@/lib/db'
import { renderScript } from '@/lib/renderer/engine'
import path from 'path'
import fs from 'fs'

const RATE_LIMIT = new Map<string, { count: number; resetAt: number }>()

function checkRateLimit(
  ip: string,
  limit: number,
  windowMs: number
): boolean {
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

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get('x-forwarded-for') || 'unknown'
    if (!checkRateLimit(ip, 3, 60_000)) {
      return NextResponse.json(
        { error: 'Rate limit exceeded' },
        { status: 429 }
      )
    }

    const { script }: { script: DemoScript } = await req.json()
    const jobId = nanoid()

    jobsDb.create(jobId, JSON.stringify(script))

    // Fire-and-forget background render
    runRenderJob(jobId, script)

    return NextResponse.json({ jobId })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to start render',
      },
      { status: 500 }
    )
  }
}

async function runRenderJob(jobId: string, script: DemoScript) {
  try {
    jobsDb.update(jobId, {
      status: 'rendering',
      progress: 2,
      current_step: 'Starting...',
    })

    const outputDir = path.join(process.cwd(), '.demoscript', 'output')
    fs.mkdirSync(outputDir, { recursive: true })

    const outputPath = await renderScript({
      script,
      outputDir,
      onProgress: (progress, message) => {
        jobsDb.update(jobId, {
          status: progress < 80 ? 'rendering' : 'encoding',
          progress,
          current_step: message,
        })
      },
    })

    jobsDb.update(jobId, {
      status: 'complete',
      progress: 100,
      current_step: 'Complete!',
      output_path: outputPath,
      download_url: `/api/download/${jobId}`,
      completed_at: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Render job failed:', error)
    jobsDb.update(jobId, {
      status: 'failed',
      progress: 0,
      current_step: 'Failed',
      error: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}
