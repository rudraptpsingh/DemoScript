# DemoScript GitHub Action

Automatically render demo videos from a DemoScript JSON file on every push, pull request, or release. The rendered output can be committed back to the repository to keep your README demo GIF always up to date.

## Usage

```yaml
- uses: rudraptpsingh/demoscript@v1
  with:
    script-path: .demoscript/demo.json
    format: gif
```

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `script-path` | No | `.demoscript/demo.json` | Path to the demo.json file relative to the repository root |
| `output-path` | No | `.demoscript/output` | Directory to write output files |
| `format` | No | `gif` | Output format: `mp4`, `gif`, or `all` |
| `api-key` | No | | DemoScript cloud API key (renders locally if not set) |
| `commit-output` | No | `false` | If `true`, commits the rendered output back to the repository |
| `commit-message` | No | `chore: update demo video [skip ci]` | Commit message when `commit-output` is true |
| `open-pr` | No | `false` | If `true` and `commit-output` is true, opens a PR instead of a direct push |
| `node-version` | No | `20` | Node.js version to use |
| `ffmpeg-version` | No | `latest` | FFmpeg version |

## Outputs

| Output | Description |
|--------|-------------|
| `output-file` | Path to the primary output file (relative to workspace) |
| `output-files-json` | JSON array of all output file paths |
| `render-duration-seconds` | How long the render took |
| `committed-sha` | SHA of the commit made, if `commit-output` was true |

## Examples

### Basic: Render GIF on push to main

```yaml
name: Render Demo
on:
  push:
    branches: [main]

jobs:
  render:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: rudraptpsingh/demoscript@v1
        with:
          script-path: .demoscript/demo.json
          format: gif
      - uses: actions/upload-artifact@v4
        with:
          name: demo
          path: .demoscript/output/
```

### Auto-update README: Commit GIF back to repo

```yaml
name: Update Demo
on:
  push:
    branches: [main]
    paths: ['.demoscript/demo.json']

jobs:
  update:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: rudraptpsingh/demoscript@v1
        with:
          commit-output: 'true'
```

### Release: Export all formats

```yaml
name: Release Assets
on:
  release:
    types: [published]

jobs:
  assets:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: rudraptpsingh/demoscript@v1
        with:
          format: all
      - uses: actions/upload-artifact@v4
        with:
          name: release-assets
          path: .demoscript/output/
```

## Setting up the API key (optional)

To use cloud rendering (faster, no local FFmpeg/Playwright required):

1. Get an API key from [demoscript.com](https://demoscript.com)
2. Add it as a repository secret: **Settings → Secrets → New repository secret**
   - Name: `DEMOSCRIPT_API_KEY`
   - Value: your API key
3. Reference it in the workflow:

```yaml
- uses: rudraptpsingh/demoscript@v1
  with:
    api-key: ${{ secrets.DEMOSCRIPT_API_KEY }}
```

## Troubleshooting

**Script file not found:** Ensure `.demoscript/demo.json` exists in your repository and the `script-path` input matches its location.

**FFmpeg installation fails:** On `ubuntu-latest` runners, FFmpeg is available via apt-get. The action installs it automatically if not present.

**Playwright install fails:** The action runs `npx playwright install --with-deps chromium` automatically. This requires ~300MB of disk space.

**Commit fails with permission error:** Add `permissions: contents: write` to your job, and ensure the `GITHUB_TOKEN` has write access under repository settings.

**GIF is too large:** Lower the FPS in your `demo.json` (try `"fps": 12`) or reduce the viewport size.
