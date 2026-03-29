import fs from 'fs'
import path from 'path'

export type WatcherChangeCallback = (script: unknown) => void
export type WatcherErrorCallback = (error: Error) => void

export interface WatcherOptions {
  filePath: string
  onChange: WatcherChangeCallback
  onParseError?: WatcherErrorCallback
  onDeletedError?: () => void
  debounceMs?: number
}

export type StopWatcher = () => void

export class AbortError extends Error {
  constructor(message = 'Render aborted') {
    super(message)
    this.name = 'AbortError'
  }
}

export function watchScript(options: WatcherOptions): StopWatcher {
  const {
    filePath,
    onChange,
    onParseError,
    onDeletedError,
    debounceMs = 500,
  } = options

  const resolved = path.resolve(filePath)

  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}`)
  }

  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let stopped = false

  function processFile() {
    if (stopped) return

    if (!fs.existsSync(resolved)) {
      if (onDeletedError) {
        onDeletedError()
      } else {
        console.error(`\nFile deleted: ${resolved}. Stopping watcher.`)
      }
      watcher.close()
      return
    }

    let raw: string
    try {
      raw = fs.readFileSync(resolved, 'utf-8')
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err))
      if (onParseError) {
        onParseError(new Error(`Failed to read file: ${e.message}`))
      } else {
        console.error(`\nFailed to read file: ${e.message}`)
      }
      return
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (err) {
      const jsonErr = err as SyntaxError
      // Extract line/column info if available
      const match = jsonErr.message.match(/position (\d+)/)
      let detail = jsonErr.message
      if (match) {
        const pos = parseInt(match[1])
        const lines = raw.slice(0, pos).split('\n')
        const line = lines.length
        const col = lines[lines.length - 1].length + 1
        detail = `${jsonErr.message} (line ${line}, column ${col})`
      }
      const parseError = new Error(`JSON parse error: ${detail}`)
      if (onParseError) {
        onParseError(parseError)
      } else {
        console.error(`\nInvalid JSON: ${detail}`)
      }
      return
    }

    // Basic schema validation — must have url and steps array
    if (!parsed || typeof parsed !== 'object') {
      const err = new Error('Script must be a JSON object')
      if (onParseError) onParseError(err)
      else console.error(`\n${err.message}`)
      return
    }

    const obj = parsed as Record<string, unknown>
    if (!obj.url || typeof obj.url !== 'string') {
      const err = new Error('Script missing required field: "url" (string)')
      if (onParseError) onParseError(err)
      else console.error(`\n${err.message}`)
      return
    }

    if (!Array.isArray(obj.steps)) {
      const err = new Error('Script missing required field: "steps" (array)')
      if (onParseError) onParseError(err)
      else console.error(`\n${err.message}`)
      return
    }

    onChange(parsed)
  }

  function scheduleProcess() {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer)
    }
    debounceTimer = setTimeout(processFile, debounceMs)
  }

  const watcher = fs.watch(resolved, (eventType) => {
    if (stopped) return
    if (eventType === 'rename') {
      // File may have been deleted
      if (!fs.existsSync(resolved)) {
        if (onDeletedError) {
          onDeletedError()
        } else {
          console.error(`\nFile deleted: ${resolved}. Stopping watcher.`)
        }
        stop()
        return
      }
    }
    scheduleProcess()
  })

  watcher.on('error', (err) => {
    if (!stopped) {
      console.error(`\nWatcher error: ${err.message}`)
    }
  })

  function stop() {
    stopped = true
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
    try {
      watcher.close()
    } catch {
      // ignore
    }
  }

  return stop
}
