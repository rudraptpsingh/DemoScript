import fs from 'fs'
import path from 'path'
import { DemoScript } from '../types'

export interface CloudClientOptions {
  apiKey: string
  baseUrl?: string
  timeout?: number
}

export interface AuthStatus {
  tier: string
  rendersThisMonth: number
  renderLimitMonthly: number
  rendersRemaining: number
}

export interface CloudRenderResult {
  jobId: string
  downloadUrls: Record<string, string>
  renderDurationSeconds: number
}

export type ProgressCallback = (progress: number, message: string) => void

// Base error class
export class DemoScriptError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DemoScriptError'
  }
}

export class AuthError extends DemoScriptError {
  constructor(message: string) {
    super(message)
    this.name = 'AuthError'
  }
}

export class RateLimitError extends DemoScriptError {
  rendersThisMonth: number
  limit: number
  resetDate: string

  constructor(message: string, rendersThisMonth: number, limit: number, resetDate: string) {
    super(message)
    this.name = 'RateLimitError'
    this.rendersThisMonth = rendersThisMonth
    this.limit = limit
    this.resetDate = resetDate
  }
}

export class ValidationError extends DemoScriptError {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

export class NetworkError extends DemoScriptError {
  constructor(message: string) {
    super(message)
    this.name = 'NetworkError'
  }
}

export class TimeoutError extends DemoScriptError {
  constructor(message: string) {
    super(message)
    this.name = 'TimeoutError'
  }
}

export class DemoScriptCloudClient {
  private apiKey: string
  private baseUrl: string
  private timeout: number

  constructor(options: CloudClientOptions) {
    this.apiKey = options.apiKey
    this.baseUrl = options.baseUrl || 'https://api.demoscript.com'
    this.timeout = options.timeout || 300_000
  }

  private async fetchWithAuth(url: string, init?: RequestInit): Promise<Response> {
    const headers = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    }

    let lastError: Error | null = null
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, { ...init, headers })
        return res
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000))
        }
      }
    }
    throw new NetworkError(`Network error after 3 retries: ${lastError?.message}`)
  }

  private async handleResponse(res: Response): Promise<unknown> {
    if (res.status === 401) {
      throw new AuthError('Invalid API key. Check your DEMOSCRIPT_API_KEY.')
    }
    if (res.status === 429) {
      const body = await res.json().catch(() => ({})) as Record<string, unknown>
      throw new RateLimitError(
        body.error as string || 'Monthly render limit reached',
        body.rendersThisMonth as number || 0,
        body.limit as number || 0,
        body.resetDate as string || ''
      )
    }
    if (res.status === 400) {
      const body = await res.json().catch(() => ({})) as Record<string, unknown>
      throw new ValidationError(body.error as string || 'Validation error')
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as Record<string, unknown>
      throw new DemoScriptError(body.error as string || `HTTP ${res.status}`)
    }
    return res.json()
  }

  async checkAuth(): Promise<AuthStatus> {
    const res = await this.fetchWithAuth(`${this.baseUrl}/v1/auth/me`)
    return this.handleResponse(res) as Promise<AuthStatus>
  }

  async render(
    script: DemoScript,
    format: string,
    options?: { onProgress?: ProgressCallback; webhookUrl?: string }
  ): Promise<CloudRenderResult> {
    const { onProgress, webhookUrl } = options || {}

    const res = await this.fetchWithAuth(`${this.baseUrl}/v1/render`, {
      method: 'POST',
      body: JSON.stringify({ script, format, webhookUrl }),
    })

    const submitResult = await this.handleResponse(res) as { jobId: string; pollUrl: string }
    const { jobId } = submitResult

    const deadline = Date.now() + this.timeout
    const startTime = Date.now()

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 3000))

      let pollRes: Response | null = null
      let pollBackoff = 1000
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          pollRes = await this.fetchWithAuth(`${this.baseUrl}/v1/jobs/${jobId}`)
          break
        } catch {
          if (attempt === 2) throw new NetworkError('Failed to poll job status')
          await new Promise((r) => setTimeout(r, pollBackoff))
          pollBackoff *= 2
        }
      }

      if (!pollRes) throw new NetworkError('Failed to poll job status after retries')

      const job = await this.handleResponse(pollRes) as {
        jobId: string
        status: string
        progress: number
        currentStep: string
        downloadUrls: Record<string, string> | null
        errorMessage?: string
      }

      if (onProgress) {
        onProgress(job.progress, job.currentStep || 'Rendering...')
      }

      if (job.status === 'failed') {
        throw new DemoScriptError(job.errorMessage || 'Cloud render failed')
      }

      if (job.status === 'complete' && job.downloadUrls) {
        const renderDurationSeconds = (Date.now() - startTime) / 1000
        return { jobId, downloadUrls: job.downloadUrls, renderDurationSeconds }
      }
    }

    throw new TimeoutError(`Render timed out after ${this.timeout / 1000}s`)
  }

  async downloadToFile(downloadUrl: string, outputPath: string): Promise<void> {
    const dir = path.dirname(outputPath)
    fs.mkdirSync(dir, { recursive: true })

    const res = await fetch(downloadUrl)
    if (!res.ok) {
      throw new DemoScriptError(`Failed to download: HTTP ${res.status}`)
    }

    const buffer = await res.arrayBuffer()
    fs.writeFileSync(outputPath, Buffer.from(buffer))
  }
}

export function createCloudClient(options: CloudClientOptions): DemoScriptCloudClient {
  return new DemoScriptCloudClient(options)
}
