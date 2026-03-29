import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import path from 'path'
import fs from 'fs'

// ─── GitHub Action Tests ───────────────────────────────────────────────────────

describe('Phase 5: GitHub Action', () => {
  it('action.yml exists and has required fields', () => {
    const actionYmlPath = path.join(__dirname, '../github-action/action.yml')
    assert.ok(fs.existsSync(actionYmlPath), 'action.yml must exist')
    const content = fs.readFileSync(actionYmlPath, 'utf-8')
    assert.ok(content.includes('name:'), 'action.yml must have name')
    assert.ok(content.includes('description:'), 'action.yml must have description')
    assert.ok(content.includes('inputs:'), 'action.yml must have inputs')
    assert.ok(content.includes('outputs:'), 'action.yml must have outputs')
    assert.ok(content.includes('runs:'), 'action.yml must have runs')
    assert.ok(content.includes('using:'), 'action.yml must have using')
    assert.ok(content.includes('main:'), 'action.yml must have main')
  })

  it('action.yml branding has icon and color', () => {
    const actionYmlPath = path.join(__dirname, '../github-action/action.yml')
    const content = fs.readFileSync(actionYmlPath, 'utf-8')
    assert.ok(content.includes('branding:'), 'action.yml must have branding')
    assert.ok(content.includes('icon:'), 'action.yml must have icon')
    assert.ok(content.includes('color:'), 'action.yml must have color')
  })

  it('action.yml declares all required inputs', () => {
    const actionYmlPath = path.join(__dirname, '../github-action/action.yml')
    const content = fs.readFileSync(actionYmlPath, 'utf-8')
    const requiredInputs = ['script-path', 'output-path', 'format', 'api-key', 'commit-output', 'commit-message']
    for (const input of requiredInputs) {
      assert.ok(content.includes(input), `action.yml must declare input: ${input}`)
    }
  })

  it('action.yml declares required outputs', () => {
    const actionYmlPath = path.join(__dirname, '../github-action/action.yml')
    const content = fs.readFileSync(actionYmlPath, 'utf-8')
    const requiredOutputs = ['output-file', 'render-duration-seconds']
    for (const output of requiredOutputs) {
      assert.ok(content.includes(output), `action.yml must declare output: ${output}`)
    }
  })

  it('github-action/src/main.ts exists and imports @actions/core', () => {
    const mainPath = path.join(__dirname, '../github-action/src/main.ts')
    assert.ok(fs.existsSync(mainPath), 'main.ts must exist')
    const content = fs.readFileSync(mainPath, 'utf-8')
    assert.ok(content.includes('@actions/core'), 'main.ts must import @actions/core')
    assert.ok(content.includes('@actions/exec'), 'main.ts must import @actions/exec')
  })

  it('main.ts handles invalid format input', () => {
    const mainPath = path.join(__dirname, '../github-action/src/main.ts')
    const content = fs.readFileSync(mainPath, 'utf-8')
    // Verify that the code validates the format input
    assert.ok(
      content.includes('validFormats') || content.includes('Invalid format'),
      'main.ts must validate format input'
    )
  })

  it('main.ts checks that script file exists', () => {
    const mainPath = path.join(__dirname, '../github-action/src/main.ts')
    const content = fs.readFileSync(mainPath, 'utf-8')
    assert.ok(
      content.includes('existsSync') || content.includes('script not found'),
      'main.ts must check if script file exists'
    )
  })

  it('main.ts has git commit logic for commit-output', () => {
    const mainPath = path.join(__dirname, '../github-action/src/main.ts')
    const content = fs.readFileSync(mainPath, 'utf-8')
    assert.ok(content.includes('commitOutput'), 'main.ts must handle commit-output')
    assert.ok(content.includes('git'), 'main.ts must use git commands')
  })

  it('path resolution uses GITHUB_WORKSPACE', () => {
    const mainPath = path.join(__dirname, '../github-action/src/main.ts')
    const content = fs.readFileSync(mainPath, 'utf-8')
    assert.ok(content.includes('GITHUB_WORKSPACE'), 'main.ts must use GITHUB_WORKSPACE for path resolution')
  })

  it('github-action/package.json has required action dependencies', () => {
    const pkgPath = path.join(__dirname, '../github-action/package.json')
    assert.ok(fs.existsSync(pkgPath), 'package.json must exist')
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
    assert.ok(pkg.dependencies['@actions/core'], 'Must depend on @actions/core')
    assert.ok(pkg.dependencies['@actions/exec'], 'Must depend on @actions/exec')
    assert.ok(pkg.devDependencies['@vercel/ncc'], 'Must have @vercel/ncc as devDep')
  })

  it('example workflows exist', () => {
    const examplesDir = path.join(__dirname, '../github-action/examples')
    assert.ok(fs.existsSync(examplesDir), 'examples directory must exist')
    const files = fs.readdirSync(examplesDir)
    assert.ok(files.length >= 3, `Must have at least 3 example files, got ${files.length}`)
    assert.ok(files.some(f => f.endsWith('.yml') || f.endsWith('.yaml')), 'Must have YAML workflow examples')
  })

  it('FFmpeg detection: main.ts checks ffmpeg -version before installing', () => {
    const mainPath = path.join(__dirname, '../github-action/src/main.ts')
    const content = fs.readFileSync(mainPath, 'utf-8')
    assert.ok(
      content.includes('ffmpeg') && content.includes('version'),
      'main.ts must check ffmpeg availability'
    )
  })
})
