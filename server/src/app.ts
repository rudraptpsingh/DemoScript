import express from 'express'
import { initDb } from './db/schema'
import authRouter from './routes/auth'
import renderRouter from './routes/render'
import downloadRouter from './routes/download'
import { startWorker, startExpiryCleanup } from './workers/renderWorker'

const app = express()

app.use(express.json({ limit: '2mb' }))

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Routes
app.use('/v1/auth', authRouter)
app.use('/v1/render', renderRouter)
app.use('/v1/jobs', renderRouter)
app.use('/v1/download', downloadRouter)

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' })
})

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err)
  res.status(500).json({ error: 'Internal server error' })
})

async function start() {
  await initDb()

  const port = parseInt(process.env.PORT || '3001', 10)
  app.listen(port, () => {
    console.log(`DemoScript API server running on port ${port}`)
  })

  // Start worker processes
  if (process.env.NODE_ENV !== 'test') {
    startWorker()
    startExpiryCleanup()
  }
}

if (require.main === module) {
  start().catch((err) => {
    console.error('Server failed to start:', err)
    process.exit(1)
  })
}

export { app, start }
