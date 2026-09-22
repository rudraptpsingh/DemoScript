# Contributing to DemoScript

Thanks for looking. DemoScript turns a JSON script into a demo video — no screen
recording, no manual clicking. Contributions that keep it that simple are the
most welcome kind.

## Setup

You need Node 18+ (the package sets `engines.node >= 18`) and about 400 MB of
disk for Chromium.

```bash
git clone https://github.com/rudraptpsingh/DemoScript.git
cd DemoScript
npm install
npx playwright install chromium
```

FFmpeg is **not** a separate install — it arrives with
`@ffmpeg-installer/ffmpeg` as a normal dependency.

Check it works end to end:

```bash
npx demoscript render --script examples/demo.json --output ./output
```

That writes an MP4 to `./output`. If it does, your environment is good.

## Running things

```bash
npm run dev          # web editor at http://localhost:3000
npm test             # unit + integration, no browser, fast
npm run test:e2e     # real Chromium + FFmpeg renders, slow
npm run test:all     # both
npm run typecheck
npm run lint
```

Run `npm test` and `npm run typecheck` before opening a PR. Run `npm run test:e2e` if you touched
anything under `lib/renderer/`.

## How the pieces fit

```
pkg/cli.ts            the `demoscript` command
lib/types.ts          DemoScript + Step shapes — the contract everything shares
lib/renderer/
  engine.ts           launches or attaches a browser, walks the steps, encodes
  actions.ts          one function per action (zoom, pan, highlight, ...)
  ffmpeg.ts           frames to MP4/GIF/WebM
app/                  the Next.js web editor
server/               hosted cloud rendering
```

The render loop is deliberately dumb: for each step, compute eased progress
frame by frame, mutate the page, screenshot. If you are adding motion, you are
almost certainly working in `actions.ts`.

## Adding an action

1. Add the name to the `Step` action union in `lib/types.ts`.
2. Write `actionYourThing(ctx: ActionContext)` in `lib/renderer/actions.ts`,
   using the shared `captureFrames` helper so easing and frame numbering stay
   consistent.
3. Wire it into the `switch` in `executeAction`.
4. Add a row to the actions table in `README.md`.
5. Add an example step to `examples/demo.json` if it needs explaining.

## What makes a good change here

- **Motion should look hand-made.** The difference between a render that feels
  fluid and one that feels scripted is almost entirely easing and framing. If
  you are changing a curve, say what it looks like, not just what it computes.
- **Never leave the page altered.** Actions mutate the DOM to do their work and
  must put it back. A transform left behind leaks into every later step.
- **Attach mode borrows someone else's browser.** Anything running under
  `cdpUrl` must not navigate, resize, or close it. When in doubt, do less.
- **Keep the JSON readable.** A script is something a person writes by hand.
  Prefer a sensible default over a new required field.

## Pull requests

Small and focused beats large and thorough. In the description, say what
changed and — for anything touching the renderer — what it looks like now,
ideally with a before/after GIF. `docs/demo_readme-demo.gif` was produced by
DemoScript itself, which is a good habit to keep.

Bug reports are most useful with the script JSON that reproduces them, the
command you ran, and what you expected the video to do.

## License

DemoScript is MIT licensed. By contributing you agree your work is released
under the same terms. See [LICENSE](LICENSE).
