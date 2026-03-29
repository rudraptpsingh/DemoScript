import Queue from 'bull'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { nanoid } from 'nanoid'
import { pool } from '../db/schema'
import { uploadFile, deleteFile, getContentType } from '../storage/r2'
import { renderScript } from '../../../lib/renderer/engine'
import { DemoScript } from '../../../lib/types'

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'
const OUTPUT_DIR = path.join(os.tmpdir(), 'demoscript-server-output')

fs.mkdirSync(OUTPUT_DIR, { recursive: true })

export function startWorker(): Queue.Queue {
  const queue = new Queue('render', REDIS_URL)

  queue.process(async (job) => {
    const { jobId } = job.data as { jobId: string }

    await pool.query(
      'UPDATE render_jobs SET status = $1, started_at = NOW() WHERE id = $2',
      ['processing', jobId]
    )

    // Fetch job details
    const result = await pool.query('SELECT * FROM render_jobs WHERE id = $1', [jobId])
    if (result.rows.length === 0) {
      throw new Error(`Job not found: ${jobId}`)
    }

    const jobRow = result.rows[0]
    const script: DemoScript = JSON.parse(jobRow.script_json)
    const format: string = jobRow.format
    const webhookUrl: string | null = jobRow.webhook_url

    const jobOutputDir = path.join(OUTPUT_DIR, jobId)
    fs.mkdirSync(jobOutputDir, { recursive: true })

    const outputPath = await renderScript({
      script,
      outputDir: jobOutputDir,
      onProgress: async (progress, message) => {
        await pool
          .query(
            'UPDATE render_jobs SET progress = $1, current_step = $2 WHERE id = $3',
            [Math.round(progress), message, jobId]
          )
          .catch(() => {})
      },
    }) as string

    // Upload to R2 (or local in test mode)
    const filename = path.basename(outputPath)
    const r2Key = `jobs/${jobId}/${format}/${filename}`
    await uploadFile(r2Key, outputPath, getContentType(filename))

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)

    await pool.query(
      `UPDATE render_jobs
       SET status = 'complete',
           progress = 100,
           current_step = 'Complete!',
           output_keys = $1,
           completed_at = NOW(),
           expires_at = $2
       WHERE id = $3`,
      [[r2Key], expiresAt.toISOString(), jobId]
    )

    // Fire webhook if configured
    if (webhookUrl) {
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 10000)
        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jobId, status: 'complete' }),
          signal: controller.signal,
        }).finally(() => clearTimeout(timeout))
      } catch (err) {
        console.warn(`Webhook delivery failed for job ${jobId}:`, err)
      }
    }

    // Clean up temp output
    fs.rmSync(jobOutputDir, { recursive: true, force: true })
  })

  queue.on('failed', async (job, err) => {
    const { jobId } = job.data as { jobId: string }
    console.error(`Job ${jobId} failed:`, err)

    await pool
      .query(
        `UPDATE render_jobs SET status = 'failed', error_message = $1 WHERE id = $2`,
        [err.message, jobId]
      )
      .catch(() => {})
  })

  console.log('Render worker started')
  return queue
}

// Expiry cleanup — run every 6 hours
export function startExpiryCleanup(): void {
  const runCleanup = async () => {
    try {
      const expired = await pool.query(
        'SELECT id, output_keys FROM render_jobs WHERE expires_at < NOW() AND output_keys IS NOT NULL AND array_length(output_keys, 1) > 0'
      )

      for (const job of expired.rows) {
        for (const key of job.output_keys as string[]) {
          await deleteFile(key).catch(() => {})
        }
        await pool.query(
          'UPDATE render_jobs SET output_keys = ARRAY[]::TEXT[] WHERE id = $1',
          [job.id]
        )
      }

      if (expired.rows.length > 0) {
        console.log(`Expired ${expired.rows.length} jobs`)
      }
    } catch (err) {
      console.error('Expiry cleanup error:', err)
    }
  }

  setInterval(runCleanup, 6 * 60 * 60 * 1000)
  // Run once on startup
  runCleanup().catch(console.error)
}
