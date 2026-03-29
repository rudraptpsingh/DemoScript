import { Request, Response, NextFunction } from 'express'

const ipRequestCounts = new Map<string, { count: number; resetAt: number }>()

export function rateLimitMiddleware(
  limit: number,
  windowMs: number
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      'unknown'

    const now = Date.now()
    const record = ipRequestCounts.get(ip)

    if (!record || now > record.resetAt) {
      ipRequestCounts.set(ip, { count: 1, resetAt: now + windowMs })
      next()
      return
    }

    if (record.count >= limit) {
      res.status(429).json({
        error: 'Too many requests',
        retryAfter: Math.ceil((record.resetAt - now) / 1000),
      })
      return
    }

    record.count++
    next()
  }
}
