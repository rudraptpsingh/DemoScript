import { Router, Request, Response } from 'express'
import { pool } from '../db/schema'
import { authMiddleware } from '../middleware/auth'
import Queue from 'bull'

const router = Router()

// Lazy-initialized queue to allow server to start without Redis in tests
let renderQueue: Queue.Queue | null = null

function getQueue(): Queue.Queue {
  if (!renderQueue) {
    renderQueue = new Queue('render', process.env.REDIS_URL || 'redis://localhost:6379')
  }
  return renderQueue
}

// POST /v1/render — Submit a render job
router.post('/', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const { script, format = 'mp4', webhookUrl, priority = 'normal' } = req.body

  if (!script || typeof script !== 'object') {
    res.status(400).json({ error: 'Request body must contain a "script" object' })
    return
  }

  if (!script.url || typeof script.url !== 'string') {
    res.status(400).json({ error: 'script.url is required and must be a string' })
    return
  }

  if (!Array.isArray(script.steps) || script.steps.length === 0) {
    res.status(400).json({ error: 'script.steps must be a non-empty array' })
    return
  }

  const validFormats = ['mp4', 'gif', 'all']
  if (!validFormats.includes(format)) {
    res.status(400).json({ error: `format must be one of: ${validFormats.join(', ')}` })
    return
  }

  // Complexity limits
  if (script.steps.length > 30) {
    res.status(400).json({ error: 'Script exceeds maximum of 30 steps' })
    return
  }

  const totalDuration = script.steps.reduce(
    (sum: number, s: { duration: number }) => sum + (s.duration || 0),
    0
  )
  if (totalDuration > 300) {
    res.status(400).json({ error: 'Script total duration exceeds 300 seconds' })
    return
  }

  const viewport = script.viewport || { width: 1280, height: 720 }
  if (viewport.width > 1920 || viewport.height > 1080) {
    res.status(400).json({ error: 'Viewport exceeds maximum of 1920x1080' })
    return
  }

  // Check URL reachability
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    const urlCheck = await fetch(script.url, {
      method: 'HEAD',
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout))

    if (!urlCheck.ok && urlCheck.status !== 405) {
      res.status(400).json({
        error: `URL is not reachable: ${script.url} returned ${urlCheck.status}`,
      })
      return
    }
  } catch {
    res.status(400).json({
      error: `URL is not reachable: ${script.url}. Check the URL and ensure it is publicly accessible.`,
    })
    return
  }

  const apiKey = req.apiKey!

  // Atomic increment of renders_this_month
  await pool.query(
    'UPDATE api_keys SET renders_this_month = renders_this_month + 1 WHERE id = $1',
    [apiKey.id]
  )

  // Insert job
  const jobResult = await pool.query(
    `INSERT INTO render_jobs (api_key_id, script_json, format, webhook_url)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [apiKey.id, JSON.stringify(script), format, webhookUrl || null]
  )
  const jobId: string = jobResult.rows[0].id

  // Add to Bull queue
  const queuePriority = priority === 'high' ? 1 : 5
  try {
    await getQueue().add({ jobId }, { priority: queuePriority, jobId })
  } catch (err) {
    // If queue fails, still return job ID (worker will pick it up on retry)
    console.error('Failed to add job to queue:', err)
  }

  res.status(202).json({
    jobId,
    status: 'queued',
    pollUrl: `${process.env.API_BASE_URL || 'https://api.demoscript.com'}/v1/jobs/${jobId}`,
  })
})

// GET /v1/jobs/:jobId — Poll job status
router.get('/jobs/:jobId', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const { jobId } = req.params
  const apiKey = req.apiKey!

  const result = await pool.query(
    'SELECT * FROM render_jobs WHERE id = $1 AND api_key_id = $2',
    [jobId, apiKey.id]
  )

  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Job not found' })
    return
  }

  const job = result.rows[0]
  const now = new Date()
  const isExpired = job.expires_at && new Date(job.expires_at) < now

  if (isExpired && job.output_keys?.length > 0) {
    res.status(410).json({
      error: 'Job output has expired and been deleted',
      jobId,
      status: job.status,
    })
    return
  }

  let downloadUrls: Record<string, string> | null = null
  if (job.status === 'complete' && job.output_keys?.length > 0 && !isExpired) {
    const { getPresignedUrl } = await import('../storage/r2')
    downloadUrls = {}
    for (const key of job.output_keys) {
      const filename = key.split('/').pop() || key
      downloadUrls[filename] = await getPresignedUrl(key, 24 * 3600)
    }
  }

  // Estimate completion time
  let estimatedCompletionAt: string | null = null
  if (job.status === 'processing' && job.started_at) {
    const elapsed = now.getTime() - new Date(job.started_at).getTime()
    const estimated = new Date(now.getTime() + Math.max(0, 90000 - elapsed))
    estimatedCompletionAt = estimated.toISOString()
  }

  res.json({
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    currentStep: job.current_step,
    createdAt: job.created_at,
    startedAt: job.started_at || null,
    completedAt: job.completed_at || null,
    estimatedCompletionAt,
    downloadUrls,
    errorMessage: job.error_message || null,
  })
})

export default router
