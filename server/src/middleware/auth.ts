import { Request, Response, NextFunction } from 'express'
import crypto from 'crypto'
import { pool } from '../db/schema'

export interface ApiKeyRecord {
  id: string
  key_prefix: string
  owner_email: string
  tier: string
  renders_this_month: number
  render_limit_monthly: number
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      apiKey?: ApiKeyRecord
    }
  }
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'Missing API key. Set Authorization: Bearer <key>',
    })
    return
  }

  const key = authHeader.slice('Bearer '.length).trim()
  if (!key) {
    res.status(401).json({ error: 'Missing API key.' })
    return
  }

  const keyHash = crypto.createHash('sha256').update(key).digest('hex')

  let result
  try {
    result = await pool.query(
      'SELECT id, key_prefix, owner_email, tier, renders_this_month, render_limit_monthly FROM api_keys WHERE key_hash = $1 AND is_active = true',
      [keyHash]
    )
  } catch {
    res.status(500).json({ error: 'Database error during authentication' })
    return
  }

  if (result.rows.length === 0) {
    res.status(401).json({ error: 'Invalid API key' })
    return
  }

  const record: ApiKeyRecord = result.rows[0]

  if (
    record.render_limit_monthly !== -1 &&
    record.renders_this_month >= record.render_limit_monthly
  ) {
    const resetDate = new Date()
    resetDate.setMonth(resetDate.getMonth() + 1)
    resetDate.setDate(1)
    res.status(429).json({
      error: 'Monthly render limit reached',
      rendersThisMonth: record.renders_this_month,
      limit: record.render_limit_monthly,
      resetDate: resetDate.toISOString(),
    })
    return
  }

  req.apiKey = record

  // Update last_used_at asynchronously — do not await
  pool
    .query('UPDATE api_keys SET last_used_at = NOW() WHERE id = $1', [record.id])
    .catch(() => {})

  next()
}
