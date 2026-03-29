import { NextRequest, NextResponse } from 'next/server'
import { jobsDb } from '@/lib/db'
import { RenderJob } from '@/lib/types'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params
  const job = jobsDb.get(jobId)
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  const renderJob: RenderJob = {
    id: job.id,
    scriptId: job.id,
    script: JSON.parse(job.script_json),
    status: job.status as RenderJob['status'],
    progress: job.progress,
    currentStep: job.current_step,
    outputPath: job.output_path || undefined,
    downloadUrl: job.download_url || undefined,
    error: job.error || undefined,
    createdAt: job.created_at,
    completedAt: job.completed_at || undefined,
  }

  return NextResponse.json(renderJob)
}
