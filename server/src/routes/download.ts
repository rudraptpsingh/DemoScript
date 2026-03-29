import { Router, Request, Response } from 'express'
import { pool } from '../db/schema'
import { authMiddleware } from '../middleware/auth'
import { getPresignedUrl } from '../storage/r2'

const router = Router()

// GET /v1/download/:jobId/:filename — Redirect to presigned R2 URL
router.get('/:jobId/:filename', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const { jobId, filename } = req.params
  const apiKey = req.apiKey!

  const result = await pool.query(
    'SELECT output_keys, expires_at, status FROM render_jobs WHERE id = $1 AND api_key_id = $2',
    [jobId, apiKey.id]
  )

  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Job not found' })
    return
  }

  const job = result.rows[0]

  if (job.status !== 'complete') {
    res.status(400).json({ error: 'Job is not complete yet' })
    return
  }

  if (job.expires_at && new Date(job.expires_at) < new Date()) {
    res.status(410).json({ error: 'Job output has expired and been deleted' })
    return
  }

  // Find the matching R2 key
  const matchingKey = (job.output_keys as string[]).find(
    (k) => k.endsWith(`/${filename}`)
  )

  if (!matchingKey) {
    res.status(404).json({ error: `File "${filename}" not found for this job` })
    return
  }

  const presignedUrl = await getPresignedUrl(matchingKey, 15 * 60)
  res.redirect(302, presignedUrl)
})

export default router
