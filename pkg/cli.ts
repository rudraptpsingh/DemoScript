#!/usr/bin/env node

import { render, capture, generate, createCloudClient, RenderInput, StepInput } from './index'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { spawn } from 'child_process'
import { watchScript, AbortError } from '../lib/watcher'
import { ALL_FORMAT_IDS, FormatId, FORMAT_SPECS } from '../lib/renderer/formats'
import type { DemoScriptCloudClient } from '../lib/api/client'

const HELP = `
demoscript — Generate polished demo videos from any URL

USAGE
  demoscript render --script <file.json>   Render from a JSON script file
  demoscript capture <url>                 Capture page elements for scripting
  demoscript watch --script <file.json>    Watch script and auto re-render on save
  demoscript generate --url <url> --prompt <text>  Generate script with AI
  demoscript cloud status                  Check cloud API key and usage
  demoscript cloud jobs list               List recent cloud render jobs
  demoscript auth set-key <key>            Save Anthropic API key locally
  demoscript --help                        Show this help

RENDER OPTIONS
  --script, -s <file>    Path to JSON script file
  --output, -o <dir>     Output directory (default: ./output)
  --format, -f <fmt>     Output format: mp4, gif (default: mp4)
  --all-formats          Render all 5 formats simultaneously
  --formats <list>       Comma-separated format IDs (e.g. mp4-standard,gif,thumbnail)
  --fps <n>              Frames per second (default: 24)
  --width <n>            Viewport width (default: 1280)
  --height <n>           Viewport height (default: 720)
  --api-key <key>        Use cloud rendering (DemoScript API key)

WATCH OPTIONS
  --script, -s <file>    Path to JSON script file (required)
  --no-open              Do not auto-open rendered video
  --format, -f <fmt>     Output format: mp4, gif (default: mp4)
  --output, -o <dir>     Output directory (default: ./output)

GENERATE OPTIONS
  --url <url>            Page URL to analyze (required)
  --prompt <text>        Natural language description of the demo (required)
  --output, -o <file>    Output script file (default: ./demo.json)
  --verbose              Show token usage and extra details

AVAILABLE FORMAT IDs
  mp4-standard   Full-resolution MP4 for general use
  mp4-twitter    Twitter/X optimized MP4 (max 60s)
  mp4-linkedin   Square 1:1 MP4 for LinkedIn (1080x1080)
  gif            Optimized GIF with palette (600px wide, 15fps)
  thumbnail      First-frame PNG thumbnail

AVAILABLE ACTIONS
  wait          Hold the current frame
  scroll-to     Smooth scroll to a target element
  zoom-in       Zoom into a target element
  zoom-out      Zoom back to normal
  highlight     Show a colored border around an element
  pan           Pan the viewport to an element
  cursor-move   Animate cursor to an element
  click         Move cursor to element and click
`

interface ScriptFile {
  url?: string
  steps: StepInput[]
  viewport?: { width: number; height: number }
  fps?: number
  outputFormat?: 'mp4' | 'gif' | 'webm'
}

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {}
  const positional: string[] = []

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const next = argv[i + 1]
      if (next && !next.startsWith('-')) {
        args[key] = next
        i++
      } else {
        args[key] = true
      }
    } else if (arg.startsWith('-') && arg.length === 2) {
      const shortMap: Record<string, string> = {
        s: 'script', o: 'output', f: 'format', h: 'help',
      }
      const key = shortMap[arg[1]] || arg[1]
      const next = argv[i + 1]
      if (next && !next.startsWith('-')) {
        args[key] = next
        i++
      } else {
        args[key] = true
      }
    } else {
      positional.push(arg)
    }
  }
  return { args, positional }
}

// ─── Terminal Progress Renderer ────────────────────────────────────────────────

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

class TerminalProgress {
  private spinnerIndex = 0
  private intervalHandle: ReturnType<typeof setInterval> | null = null
  private currentProgress = 0
  private currentMessage = ''
  private startTime = Date.now()
  private isTTY: boolean

  constructor() {
    this.isTTY = Boolean(process.stdout.isTTY)
  }

  start(initialMessage = 'Starting...') {
    this.currentMessage = initialMessage
    this.startTime = Date.now()

    if (this.isTTY) {
      this.intervalHandle = setInterval(() => {
        this.spinnerIndex = (this.spinnerIndex + 1) % SPINNER_FRAMES.length
        this.render()
      }, 100)
    } else {
      console.log(initialMessage)
    }
  }

  update(progress: number, message: string) {
    this.currentProgress = progress
    this.currentMessage = message
    if (!this.isTTY) {
      console.log(`${Math.round(progress)}% ${message}`)
    }
  }

  private render() {
    const spinner = SPINNER_FRAMES[this.spinnerIndex]
    const pct = Math.round(this.currentProgress)
    const elapsed = Math.round((Date.now() - this.startTime) / 1000)
    const msg = this.currentMessage.slice(0, 60).padEnd(60)
    process.stdout.write(
      `\r${spinner} ${String(pct).padStart(3)}% ${msg}  [${elapsed}s elapsed]`
    )
  }

  succeed(message: string, outputPath: string) {
    this.stop()
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1)
    const line = `\u2713 ${message} in ${elapsed}s \u2192 ${outputPath}`
    if (this.isTTY) {
      process.stdout.write(`\r\x1b[32m${line}\x1b[0m\n`)
    } else {
      console.log(line)
    }
  }

  fail(message: string) {
    this.stop()
    if (this.isTTY) {
      process.stdout.write(`\r\x1b[31m\u2717 ${message}\x1b[0m\n`)
    } else {
      console.error(`ERROR: ${message}`)
    }
  }

  stop() {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle)
      this.intervalHandle = null
    }
  }
}

// ─── Platform Video Opener ─────────────────────────────────────────────────────

function openVideoInPlayer(filePath: string) {
  const platform = process.platform
  let cmd: string
  let args: string[]

  if (platform === 'darwin') {
    cmd = 'open'
    args = [filePath]
  } else if (platform === 'win32') {
    cmd = 'cmd.exe'
    args = ['/c', 'start', '', filePath]
  } else {
    cmd = 'xdg-open'
    args = [filePath]
  }

  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' })
    child.unref()
  } catch {
    // Best-effort: if this fails, no crash
    console.log('Note: could not open video automatically.')
  }
}

// ─── Config helpers ────────────────────────────────────────────────────────────

const CONFIG_DIR = path.join(os.homedir(), '.demoscript')
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json')

function readConfig(): Record<string, string> {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'))
    }
  } catch {
    // ignore
  }
  return {}
}

function writeConfig(data: Record<string, string>) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true })
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2))
}

function getApiKey(argKey?: string): string | undefined {
  return (
    argKey ||
    process.env.DEMOSCRIPT_API_KEY ||
    readConfig()['apiKey']
  )
}

function getAnthropicKey(argKey?: string): string | undefined {
  return (
    argKey ||
    process.env.ANTHROPIC_API_KEY ||
    readConfig()['anthropicApiKey']
  )
}

// ─── Format Summary Printer ────────────────────────────────────────────────────

function printFormatSummary(
  results: Record<string, { success: boolean; outputPath?: string; fileSizeBytes?: number; error?: string }>,
  elapsedS: string
) {
  console.log('')
  console.log('Format          | File                         | Size     | Status')
  console.log('----------------|------------------------------|----------|-------')
  for (const [fmtId, r] of Object.entries(results)) {
    const spec = FORMAT_SPECS[fmtId as FormatId]
    const label = (spec?.label || fmtId).padEnd(15)
    const file = r.outputPath ? path.basename(r.outputPath).padEnd(28) : '(failed)'.padEnd(28)
    const size = r.fileSizeBytes
      ? r.fileSizeBytes > 1024 * 1024
        ? `${(r.fileSizeBytes / 1024 / 1024).toFixed(1)} MB`
        : `${(r.fileSizeBytes / 1024).toFixed(0)} KB`
      : r.error?.slice(0, 8) || 'N/A'
    const status = r.success ? '\u2713' : '\u2717 ' + (r.error?.slice(0, 20) || '')
    console.log(`${label} | ${file} | ${size.padEnd(8)} | ${status}`)
  }
  console.log('')
  console.log(`All formats rendered in ${elapsedS}s.`)
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const { args, positional } = parseArgs(process.argv.slice(2))

  if (args.help || positional.length === 0) {
    console.log(HELP)
    process.exit(0)
  }

  const command = positional[0]

  // ── auth ──────────────────────────────────────────────────────────────────────
  if (command === 'auth') {
    const subCmd = positional[1]
    if (subCmd === 'set-key') {
      const keyArg = positional[2]
      if (!keyArg) {
        console.error('Usage: demoscript auth set-key <ANTHROPIC_API_KEY>')
        process.exit(1)
      }
      const cfg = readConfig()
      cfg['anthropicApiKey'] = keyArg
      writeConfig(cfg)
      console.log(`API key saved to ${CONFIG_FILE}`)
    } else {
      console.error('Usage: demoscript auth set-key <key>')
      process.exit(1)
    }
    return
  }

  // ── capture ───────────────────────────────────────────────────────────────────
  if (command === 'capture') {
    const url = positional[1]
    if (!url) {
      console.error('Error: URL required. Usage: demoscript capture <url>')
      process.exit(1)
    }

    const width = parseInt(args.width as string) || 1280
    const height = parseInt(args.height as string) || 720

    console.log(`Capturing ${url} ...`)
    const result = await capture(url, { width, height })

    console.log(`\nFound ${result.elements.length} elements:\n`)
    console.log('  Selector                                 | Tag        | Text')
    console.log('  ' + '-'.repeat(80))
    for (const el of result.elements) {
      const sel = el.selector.padEnd(40)
      const tag = el.tagName.padEnd(10)
      const text = el.innerText.slice(0, 40)
      console.log(`  ${sel} | ${tag} | ${text}`)
    }
    console.log(`\nPage size: ${result.pageWidth}x${result.pageHeight}`)
    console.log('Use these selectors as "target" values in your script file.')
    return
  }

  // ── render ────────────────────────────────────────────────────────────────────
  if (command === 'render') {
    const scriptPath = args.script as string | undefined
    const inlineUrl = positional[1]

    let scriptFile: ScriptFile | null = null

    if (scriptPath) {
      const resolved = path.resolve(scriptPath)
      if (!fs.existsSync(resolved)) {
        console.error(`Error: Script file not found: ${resolved}`)
        process.exit(1)
      }
      scriptFile = JSON.parse(fs.readFileSync(resolved, 'utf-8'))
    }

    const url = inlineUrl || scriptFile?.url
    if (!url) {
      console.error('Error: URL required. Provide as argument or in script file.')
      process.exit(1)
    }

    const steps = scriptFile?.steps
    if (!steps || steps.length === 0) {
      console.error('Error: No steps defined. Provide a --script file with steps.')
      process.exit(1)
    }

    const width = parseInt(args.width as string) || scriptFile?.viewport?.width || 1280
    const height = parseInt(args.height as string) || scriptFile?.viewport?.height || 720
    const fps = parseInt(args.fps as string) || scriptFile?.fps || 24
    const format = (args.format as string) || scriptFile?.outputFormat || 'mp4'
    const outputDir = (args.output as string) || './output'
    const allFormats = Boolean(args['all-formats'])
    const formatsArg = args.formats as string | undefined
    const apiKey = getApiKey(args['api-key'] as string | undefined)

    // Determine which formats to render
    let selectedFormats: FormatId[] | null = null
    if (allFormats) {
      selectedFormats = [...ALL_FORMAT_IDS]
    } else if (formatsArg) {
      const parsed = formatsArg.split(',').map((s) => s.trim()) as FormatId[]
      const invalid = parsed.filter((f) => !FORMAT_SPECS[f])
      if (invalid.length > 0) {
        console.error(`Error: Unknown format IDs: ${invalid.join(', ')}`)
        console.error(`Valid IDs: ${ALL_FORMAT_IDS.join(', ')}`)
        process.exit(1)
      }
      selectedFormats = parsed
    }

    const totalDuration = steps.reduce((sum, s) => sum + s.duration, 0)
    console.log('DemoScript Render')
    console.log(`  URL:      ${url}`)
    console.log(`  Steps:    ${steps.length}`)
    console.log(`  Duration: ${totalDuration}s`)
    console.log(`  Format:   ${selectedFormats ? selectedFormats.join(', ') : format}`)
    console.log(`  FPS:      ${fps}`)
    console.log(`  Viewport: ${width}x${height}`)
    if (apiKey) console.log('  Mode:     [cloud]')
    console.log('')

    const termProgress = new TerminalProgress()

    // Cloud rendering path
    if (apiKey) {
      termProgress.start('Submitting to cloud...')
      try {
        const client = createCloudClient({ apiKey })
        const cloudResult = await client.render(
          {
            id: 'cli-render',
            url,
            viewport: { width, height },
            fps,
            outputFormat: format as 'mp4' | 'gif',
            steps: steps.map((s, i) => ({
              id: String(i),
              order: i + 1,
              target: s.target ?? null,
              targetLabel: s.label || s.target || 'page',
              action: s.action,
              duration: s.duration,
              zoom: s.zoom,
              easing: s.easing,
              annotation: s.annotation,
              highlightColor: s.highlightColor,
            })),
            createdAt: new Date().toISOString(),
          },
          format,
          {
            onProgress: (p, msg) => termProgress.update(p, `[cloud] ${msg}`),
          }
        )

        const resolvedOutput = path.resolve(outputDir)
        fs.mkdirSync(resolvedOutput, { recursive: true })
        const outFile = path.join(resolvedOutput, `demo_cloud.${format === 'gif' ? 'gif' : 'mp4'}`)

        // Download the primary output
        const primaryUrl = Object.values(cloudResult.downloadUrls)[0]
        if (primaryUrl) {
          await client.downloadToFile(primaryUrl, outFile)
          termProgress.succeed('Rendered', outFile)
          const stat = fs.statSync(outFile)
          console.log(`  Size: ${(stat.size / 1024).toFixed(0)} KB`)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        termProgress.fail(msg)
        process.exit(1)
      }
      return
    }

    // Local rendering path
    termProgress.start('Starting render...')
    const start = Date.now()

    try {
      if (selectedFormats && selectedFormats.length > 1) {
        // Multi-format render
        const { renderScript } = await import('../lib/renderer/engine')

        const scriptId = `cli_${Date.now()}`
        const script = {
          id: scriptId,
          url,
          viewport: { width, height },
          fps,
          outputFormat: 'mp4' as const,
          steps: steps.map((s, i) => ({
            id: String(i),
            order: i + 1,
            target: s.target ?? null,
            targetLabel: s.label || s.target || 'page',
            action: s.action,
            duration: s.duration,
            zoom: s.zoom,
            easing: s.easing,
            annotation: s.annotation,
            highlightColor: s.highlightColor,
          })),
          createdAt: new Date().toISOString(),
        }

        const renderResult = await renderScript({
          script,
          outputDir: path.resolve(outputDir),
          formats: selectedFormats,
          onProgress: (p, msg) => termProgress.update(p, msg),
        })
        const result = renderResult as unknown as { outputs: Partial<Record<FormatId, string>> }

        termProgress.stop()
        const elapsed = ((Date.now() - start) / 1000).toFixed(1)

        // Build results for summary
        const summaryResults: Record<string, { success: boolean; outputPath?: string; fileSizeBytes?: number; error?: string }> = {}
        for (const fmtId of selectedFormats) {
          const outPath = result.outputs[fmtId]
          if (outPath && fs.existsSync(outPath)) {
            const stat = fs.statSync(outPath)
            summaryResults[fmtId] = { success: true, outputPath: outPath, fileSizeBytes: stat.size }
          } else {
            summaryResults[fmtId] = { success: false, error: 'Encoding failed' }
          }
        }

        printFormatSummary(summaryResults, elapsed)
      } else {
        // Single-format render (existing behavior)
        const input: RenderInput = {
          url,
          steps,
          viewport: { width, height },
          fps,
          outputFormat: format as 'mp4' | 'gif' | 'webm',
          outputDir: path.resolve(outputDir),
          onProgress: (p, msg) => termProgress.update(p, msg),
        }

        const result = await render(input)
        const elapsed = ((Date.now() - start) / 1000).toFixed(1)
        const stat = fs.statSync(result.outputPath)
        const sizeKB = (stat.size / 1024).toFixed(0)

        termProgress.succeed('Rendered', result.outputPath)
        console.log(`\n  Done in ${elapsed}s`)
        console.log(`  Size:   ${sizeKB} KB`)
        console.log(`  Frames: ${result.frameCount}`)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      termProgress.fail(msg)
      process.exit(1)
    }
    return
  }

  // ── watch ─────────────────────────────────────────────────────────────────────
  if (command === 'watch') {
    const scriptPath = args.script as string | undefined
    if (!scriptPath) {
      console.error('Error: --script <file> is required for watch command')
      process.exit(1)
    }

    const resolved = path.resolve(scriptPath)
    if (!fs.existsSync(resolved)) {
      console.error(`Error: Script file not found: ${resolved}`)
      process.exit(1)
    }

    const noOpen = Boolean(args['no-open'])
    const format = (args.format as string) || 'mp4'
    const outputDir = path.resolve((args.output as string) || './output')

    console.log(`Watching ${resolved}`)
    console.log(`Save the file to trigger a re-render. Press Ctrl+C to stop.\n`)

    let renderCount = 0
    let currentController: AbortController | null = null
    let isRendering = false

    async function triggerRender(script: unknown) {
      // Cancel in-progress render
      if (isRendering && currentController) {
        console.log('\nFile changed during render — cancelling current render...')
        currentController.abort()
        // Wait a moment for cleanup
        await new Promise((r) => setTimeout(r, 500))
      }

      renderCount++
      const renderNum = renderCount
      const now = new Date().toLocaleTimeString()
      console.log(`\n[${now}] Render #${renderNum} starting...`)

      currentController = new AbortController()
      isRendering = true

      const termProgress = new TerminalProgress()
      termProgress.start('Launching browser...')

      const start = Date.now()

      try {
        const { renderScript } = await import('../lib/renderer/engine')
        const scriptObj = script as ScriptFile

        const width = scriptObj.viewport?.width || 1280
        const height = scriptObj.viewport?.height || 720
        const fps = scriptObj.fps || 24
        const url = scriptObj.url

        if (!url) {
          termProgress.fail('Script missing "url" field')
          isRendering = false
          return
        }

        const scriptId = `watch_${Date.now()}`
        const engineScript = {
          id: scriptId,
          url,
          viewport: { width, height },
          fps,
          outputFormat: format as 'mp4' | 'gif',
          steps: scriptObj.steps.map((s: StepInput, i: number) => ({
            id: String(i),
            order: i + 1,
            target: s.target ?? null,
            targetLabel: s.label || s.target || 'page',
            action: s.action,
            duration: s.duration,
            zoom: s.zoom,
            easing: s.easing,
            annotation: s.annotation,
            highlightColor: s.highlightColor,
          })),
          createdAt: new Date().toISOString(),
        }

        const outputPath = await renderScript({
          script: engineScript,
          outputDir,
          signal: currentController!.signal,
          onProgress: (p, msg) => termProgress.update(p, msg),
        }) as string

        const elapsed = ((Date.now() - start) / 1000).toFixed(1)
        const totalFrames = Math.round(
          scriptObj.steps.reduce((sum: number, s: StepInput) => sum + s.duration, 0) * fps
        )
        termProgress.succeed('Rendered', outputPath)
        console.log(
          `  Render #${renderNum} complete — ${elapsed}s, ${fps}fps, ~${totalFrames} frames → ${outputPath}`
        )

        if (!noOpen) {
          openVideoInPlayer(outputPath)
          console.log('  [opened in default player]')
        }
      } catch (err) {
        if (err instanceof AbortError) {
          termProgress.stop()
          console.log(`  Render #${renderNum} cancelled.`)
        } else {
          const msg = err instanceof Error ? err.message : String(err)
          termProgress.fail(msg)
          console.error(`  Render #${renderNum} failed: ${msg}`)
        }
      } finally {
        isRendering = false
        currentController = null
      }
    }

    // Trigger initial render on startup
    const rawScript = JSON.parse(fs.readFileSync(resolved, 'utf-8'))
    await triggerRender(rawScript)

    // Now start watching for changes
    let stopWatcher: (() => void) | null = null

    try {
      stopWatcher = watchScript({
        filePath: resolved,
        onChange: (script) => {
          triggerRender(script).catch((err) => {
            console.error('Unexpected error in render:', err)
          })
        },
        onParseError: (err) => {
          console.error(`\nScript error: ${err.message}`)
          console.error('Fix the error and save again to re-render.')
        },
        onDeletedError: () => {
          console.log('\nScript file deleted. Stopping watcher.')
          process.exit(0)
        },
      })
    } catch (err) {
      console.error(`Error starting watcher: ${err instanceof Error ? err.message : err}`)
      process.exit(1)
    }

    // Handle Ctrl+C
    process.on('SIGINT', () => {
      console.log('\n\nStopped watching.')
      if (stopWatcher) stopWatcher()
      if (currentController) currentController.abort()
      process.exit(0)
    })

    // Keep alive
    await new Promise<void>(() => { /* never resolves */ })
    return
  }

  // ── generate ──────────────────────────────────────────────────────────────────
  if (command === 'generate') {
    const url = args.url as string | undefined
    const prompt = args.prompt as string | undefined
    const outputFile = (args.output as string) || './demo.json'
    const verbose = Boolean(args.verbose)

    if (!url) {
      console.error('Error: --url <url> is required')
      process.exit(1)
    }
    if (!prompt) {
      console.error('Error: --prompt <text> is required')
      process.exit(1)
    }

    const anthropicKey = getAnthropicKey()
    if (!anthropicKey) {
      console.error(
        'Error: ANTHROPIC_API_KEY environment variable not set.\n' +
        'Get one at https://console.anthropic.com and either:\n' +
        '  export ANTHROPIC_API_KEY=sk-ant-...\n' +
        '  or run: demoscript auth set-key <key>'
      )
      process.exit(1)
    }

    console.log('Capturing page elements...')
    const termProgress = new TerminalProgress()
    termProgress.start('Launching browser...')

    let captureResult: Awaited<ReturnType<typeof capture>> | null = null
    try {
      captureResult = await capture(url)
      termProgress.stop()
      console.log(`  Captured ${captureResult.elements.length} elements from ${url}`)
    } catch (err) {
      termProgress.fail(err instanceof Error ? err.message : String(err))
      process.exit(1)
    }

    console.log('\nGenerating script with AI...')
    termProgress.start('Calling AI...')

    let genResult: Awaited<ReturnType<typeof generate>> | null = null
    try {
      genResult = await generate({
        url,
        prompt,
        apiKey: anthropicKey,
        capturedElements: captureResult!.elements,
      })
      termProgress.stop()
    } catch (err) {
      termProgress.fail(err instanceof Error ? err.message : String(err))
      process.exit(1)
    }

    const { steps, estimatedDuration, tokensUsed } = genResult!

    console.log(`\nGenerated ${steps.length} steps (${estimatedDuration.toFixed(1)}s total):\n`)
    console.log('  # | Action       | Target                       | Duration | Annotation')
    console.log('  --|--------------|------------------------------|----------|------------------')
    steps.forEach((s, i) => {
      const num = String(i + 1).padEnd(2)
      const action = s.action.padEnd(12)
      const target = (s.target || '(full page)').slice(0, 28).padEnd(28)
      const dur = `${s.duration}s`.padEnd(8)
      const ann = s.annotation ? `"${s.annotation}"` : ''
      console.log(`  ${num} | ${action} | ${target} | ${dur} | ${ann}`)
    })

    if (verbose) {
      console.log(`\n  Tokens used: ${tokensUsed}`)
    }

    // Build script file
    const scriptOut = {
      url,
      viewport: { width: 1280, height: 720 },
      fps: 24,
      outputFormat: 'mp4',
      steps: steps.map((s) => ({
        action: s.action,
        target: s.target,
        duration: s.duration,
        zoom: s.zoom,
        easing: s.easing,
        annotation: s.annotation,
        highlightColor: s.highlightColor,
      })),
    }

    fs.writeFileSync(path.resolve(outputFile), JSON.stringify(scriptOut, null, 2))
    console.log(`\nScript saved to ${outputFile}`)
    console.log(`Run: demoscript render --script ${outputFile}`)
    return
  }

  // ── cloud ─────────────────────────────────────────────────────────────────────
  if (command === 'cloud') {
    const subCmd = positional[1]
    const apiKey = getApiKey(args['api-key'] as string | undefined)

    if (!apiKey) {
      console.error(
        'Error: No cloud API key found.\n' +
        'Set DEMOSCRIPT_API_KEY environment variable or use --api-key <key>'
      )
      process.exit(1)
    }

    const client = createCloudClient({ apiKey })

    if (subCmd === 'status') {
      try {
        const status = await client.checkAuth()
        console.log('Cloud API Status')
        console.log(`  Tier:              ${status.tier}`)
        console.log(`  Renders this month: ${status.rendersThisMonth}`)
        console.log(`  Monthly limit:     ${status.renderLimitMonthly === -1 ? 'Unlimited' : status.renderLimitMonthly}`)
        console.log(`  Renders remaining: ${status.rendersRemaining === -1 ? 'Unlimited' : status.rendersRemaining}`)
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`)
        process.exit(1)
      }
      return
    }

    if (subCmd === 'jobs') {
      const jobSubCmd = positional[2]
      if (jobSubCmd === 'list') {
        console.log('(Job listing requires the cloud API to be running.)')
        console.log('Use the DemoScript dashboard at https://api.demoscript.com to view jobs.')
      } else if (jobSubCmd === 'logs') {
        const jobId = positional[3]
        if (!jobId) {
          console.error('Usage: demoscript cloud jobs logs <jobId>')
          process.exit(1)
        }
        console.log(`(Fetching logs for job ${jobId}...)`)
        console.log('Use the DemoScript dashboard at https://api.demoscript.com to view logs.')
      } else {
        console.error('Usage: demoscript cloud jobs list|logs <jobId>')
        process.exit(1)
      }
      return
    }

    console.error(`Unknown cloud subcommand: ${subCmd}`)
    console.error('Available: status, jobs list, jobs logs <id>')
    process.exit(1)
  }

  console.error(`Unknown command: ${command}`)
  console.log(HELP)
  process.exit(1)
}

main().catch((err) => {
  console.error('\nError:', err.message)
  process.exit(1)
})
