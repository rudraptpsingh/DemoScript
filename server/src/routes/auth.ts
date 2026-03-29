import { Router, Request, Response } from 'express'
import crypto from 'crypto'
import { pool } from '../db/schema'
import { authMiddleware } from '../middleware/auth'

const router = Router()

function generateApiKey(): string {
  const bytes = crypto.randomBytes(32)
  const base62Chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
  let result = ''
  for (let i = 0; i < 32; i++) {
    result += base62Chars[bytes[i] % 62]
  }
  return `ds_live_${result}`
}

// POST /v1/auth/keys — Create a new API key
router.post('/keys', async (req: Request, res: Response): Promise<void> => {
  const { email, tier = 'free' } = req.body

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    res.status(400).json({ error: 'Valid email address is required' })
    return
  }

  if (!['free', 'pro'].includes(tier)) {
    res.status(400).json({ error: 'tier must be "free" or "pro"' })
    return
  }

  // Check if email already has an active key
  const existing = await pool.query(
    'SELECT id FROM api_keys WHERE owner_email = $1 AND is_active = true',
    [email]
  )
  if (existing.rows.length > 0) {
    res.status(409).json({
      error: 'Key already exists for this email. Use POST /v1/auth/keys/rotate to get a new one.',
    })
    return
  }

  const key = generateApiKey()
  const keyHash = crypto.createHash('sha256').update(key).digest('hex')
  const keyPrefix = key.slice(0, 12) // "ds_live_" + 4 chars
  const renderLimit = tier === 'pro' ? 100 : 10

  await pool.query(
    `INSERT INTO api_keys (key_hash, key_prefix, owner_email, tier, render_limit_monthly)
     VALUES ($1, $2, $3, $4, $5)`,
    [keyHash, keyPrefix, email, tier, renderLimit]
  )

  res.status(201).json({
    key,
    prefix: keyPrefix,
    tier,
    renderLimitMonthly: renderLimit,
  })
})

// GET /v1/auth/me — Get current key's usage
router.get('/me', authMiddleware, (req: Request, res: Response): void => {
  const apiKey = req.apiKey!
  res.json({
    tier: apiKey.tier,
    rendersThisMonth: apiKey.renders_this_month,
    renderLimitMonthly: apiKey.render_limit_monthly,
    rendersRemaining:
      apiKey.render_limit_monthly === -1
        ? -1
        : apiKey.render_limit_monthly - apiKey.renders_this_month,
  })
})

export default router
