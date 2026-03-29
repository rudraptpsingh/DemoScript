import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as artifact from '@actions/artifact'
import * as github from '@actions/github'
import path from 'path'
import fs from 'fs'

async function run(): Promise<void> {
  const startTime = Date.now()

  try {
    // ── Step 1: Read and validate inputs ────────────────────────────────────────
    const workspace = process.env.GITHUB_WORKSPACE || process.cwd()

    const scriptPathInput = core.getInput('script-path') || '.demoscript/demo.json'
    const outputPathInput = core.getInput('output-path') || '.demoscript/output'
    const format = core.getInput('format') || 'gif'
    const apiKey = core.getInput('api-key') || ''
    const commitOutput = core.getInput('commit-output') === 'true'
    const commitMessage = core.getInput('commit-message') || 'chore: update demo video [skip ci]'
    const openPr = core.getInput('open-pr') === 'true'

    const validFormats = ['mp4', 'gif', 'all']
    if (!validFormats.includes(format)) {
      core.setFailed(
        `Invalid format "${format}". Must be one of: ${validFormats.join(', ')}`
      )
      return
    }

    const scriptPath = path.resolve(workspace, scriptPathInput)
    const outputPath = path.resolve(workspace, outputPathInput)

    core.info(`Script path: ${scriptPath}`)
    core.info(`Output path: ${outputPath}`)
    core.info(`Format: ${format}`)

    if (!fs.existsSync(scriptPath)) {
      core.setFailed(
        `Script file not found: ${scriptPathInput}\n` +
        `Make sure the file exists at that path relative to the repository root.`
      )
      return
    }

    // ── Step 2: Setup environment ────────────────────────────────────────────────
    core.startGroup('Setting up environment')

    // Check if FFmpeg is available, install if not
    let ffmpegAvailable = false
    try {
      await exec.exec('ffmpeg', ['-version'], { silent: true })
      ffmpegAvailable = true
      core.info('FFmpeg is already installed')
    } catch {
      ffmpegAvailable = false
    }

    if (!ffmpegAvailable) {
      core.info('Installing FFmpeg...')
      await exec.exec('sudo', ['apt-get', 'update', '-qq'])
      await exec.exec('sudo', ['apt-get', 'install', '-y', '-qq', 'ffmpeg'])
    }

    // Install Playwright Chromium
    core.info('Installing Playwright Chromium...')
    await exec.exec('npx', ['playwright', 'install', '--with-deps', 'chromium'])

    core.endGroup()

    // ── Step 3: Execute render ────────────────────────────────────────────────────
    core.startGroup('Rendering demo')

    fs.mkdirSync(outputPath, { recursive: true })

    const renderStart = Date.now()
    let primaryOutputFile = ''

    if (apiKey) {
      // Cloud render path
      core.info(`Using DemoScript cloud API`)
      await exec.exec(
        'npx',
        [
          'demoscript',
          'render',
          '--script', scriptPath,
          '--format', format === 'all' ? 'mp4' : format,
          '--output', outputPath,
          '--api-key', apiKey,
        ],
        {
          cwd: workspace,
          listeners: {
            stdout: (data: Buffer) => core.info(data.toString()),
            stderr: (data: Buffer) => core.warning(data.toString()),
          },
        }
      )
    } else {
      // Local render path
      const formatArgs = format === 'all'
        ? ['--all-formats']
        : ['--format', format]

      await exec.exec(
        'npx',
        [
          'demoscript',
          'render',
          '--script', scriptPath,
          ...formatArgs,
          '--output', outputPath,
        ],
        {
          cwd: workspace,
          listeners: {
            stdout: (data: Buffer) => core.info(data.toString()),
            stderr: (data: Buffer) => core.warning(data.toString()),
          },
        }
      )
    }

    // Find output files
    const outputFiles = fs.existsSync(outputPath)
      ? fs.readdirSync(outputPath).map((f) => path.join(outputPath, f))
      : []

    if (outputFiles.length === 0) {
      core.setFailed('No output files were produced by the render')
      return
    }

    // Primary output = first file (prefer gif, then mp4)
    primaryOutputFile =
      outputFiles.find((f) => f.endsWith('.gif')) ||
      outputFiles.find((f) => f.endsWith('.mp4')) ||
      outputFiles[0]

    const renderDuration = ((Date.now() - renderStart) / 1000).toFixed(1)
    core.info(`Render completed in ${renderDuration}s`)
    core.info(`Output files: ${outputFiles.map((f) => path.basename(f)).join(', ')}`)
    core.endGroup()

    // ── Step 4: Set outputs ──────────────────────────────────────────────────────
    core.setOutput('output-file', path.relative(workspace, primaryOutputFile))
    core.setOutput('output-files-json', JSON.stringify(outputFiles.map((f) => path.relative(workspace, f))))
    core.setOutput('render-duration-seconds', renderDuration)

    // ── Step 5: Commit output (if enabled) ───────────────────────────────────────
    if (commitOutput) {
      core.startGroup('Committing output')

      await exec.exec('git', ['config', 'user.email', 'github-actions[bot]@users.noreply.github.com'], { cwd: workspace })
      await exec.exec('git', ['config', 'user.name', 'github-actions[bot]'], { cwd: workspace })
      await exec.exec('git', ['add', outputPath], { cwd: workspace })

      // Check if there are staged changes
      let hasChanges = false
      await exec.exec('git', ['diff', '--staged', '--quiet'], {
        cwd: workspace,
        ignoreReturnCode: true,
        listeners: {
          exitCode: (code: number) => { hasChanges = code !== 0 },
        },
      })

      if (!hasChanges) {
        core.info('Output is unchanged — skipping commit')
      } else if (openPr) {
        // Push to a new branch and open a PR
        const timestamp = Date.now()
        const branch = `demoscript/update-demo-${timestamp}`

        await exec.exec('git', ['checkout', '-b', branch], { cwd: workspace })
        await exec.exec('git', ['commit', '-m', commitMessage], { cwd: workspace })
        await exec.exec('git', ['push', 'origin', branch], { cwd: workspace })

        // Create PR using GitHub CLI if available
        try {
          await exec.exec(
            'gh',
            [
              'pr', 'create',
              '--title', 'Update demo video',
              '--body', `Auto-generated by DemoScript action.\n\nRender time: ${renderDuration}s`,
              '--head', branch,
            ],
            { cwd: workspace }
          )
        } catch {
          core.warning('Could not create PR automatically. Push the branch and open a PR manually.')
        }
      } else {
        await exec.exec('git', ['commit', '-m', commitMessage], { cwd: workspace })
        await exec.exec('git', ['push'], { cwd: workspace })

        // Get the committed SHA
        let committedSha = ''
        await exec.exec('git', ['rev-parse', 'HEAD'], {
          cwd: workspace,
          listeners: {
            stdout: (data: Buffer) => { committedSha = data.toString().trim() },
          },
        })
        core.setOutput('committed-sha', committedSha)
        core.info(`Committed output as ${committedSha}`)
      }

      core.endGroup()
    }

    // ── Step 6: Upload artifact ──────────────────────────────────────────────────
    core.startGroup('Uploading artifact')

    const artifactClient = new artifact.DefaultArtifactClient()
    try {
      await artifactClient.uploadArtifact(
        'demo-output',
        outputFiles,
        outputPath
      )
      core.info('Uploaded output files as artifact "demo-output"')
    } catch (err) {
      core.warning(`Could not upload artifact: ${err instanceof Error ? err.message : err}`)
    }

    core.endGroup()

    // ── Step 7: Action Summary ────────────────────────────────────────────────────
    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1)
    const scriptName = path.basename(scriptPath)

    await core.summary
      .addHeading('DemoScript Render Summary')
      .addTable([
        [
          { data: 'Field', header: true },
          { data: 'Value', header: true },
        ],
        ['Script', scriptName],
        ['Format', format],
        ['Render time', `${renderDuration}s`],
        ['Total time', `${totalDuration}s`],
        [
          'Output files',
          outputFiles.map((f) => path.basename(f)).join(', '),
        ],
      ])
      .write()

  } catch (error) {
    core.setFailed(
      `DemoScript action failed: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

run()
