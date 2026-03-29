import { NextRequest, NextResponse } from 'next/server'
import { jobsDb } from '@/lib/db'
import fs from 'fs'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params
  const job = jobsDb.get(jobId)
  if (!job || !job.output_path) {
    return NextResponse.json({ error: 'Video not ready' }, { status: 404 })
  }

  if (!fs.existsSync(job.output_path)) {
    return NextResponse.json(
      { error: 'Video file missing' },
      { status: 404 }
    )
  }

  const fileBuffer = fs.readFileSync(job.output_path)
  const filename = `demo_${jobId}.mp4`

  return new NextResponse(fileBuffer, {
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(fileBuffer.length),
      'Cache-Control': 'no-cache',
    },
  })
}
