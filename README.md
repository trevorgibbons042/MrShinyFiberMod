# MrShinyFiberMod

A Claude Code mod that draws a band of scintillating fibers above the prompt. Particles fly through them, scatter into showers, crash into each other and blow up. It animates on a 180 ms clock and everything is deterministic, so the same tick always draws the same frame.

## Features

**The band**
- Six fibers side by side, each five columns wide and seven rows tall.
- Each fiber shows a spinning mascot face with eyes and a mouth. The faces are offset so the band looks like a wave.

**Particles**
- Blue particles come in from the right and red ones from the left.
- Energy is random, so speeds differ. Fast particles are fast, slow ones crawl.
- Some enter at a slight angle.
- Brightness shows energy (`░ ▒ ▓ █`), and a new head of a track flashes.

**Showers**
- Particles break up into daughters that fan out in short tracks and can break up again.
- Some daughters go backwards.
- More energy means more daughters, and very fast particles decay into a crazy number of them.
- Plain scattering with no other particle nearby is rare, short, and leaves few daughters.
- Daughter trails fade quickly.

**Attraction and repulsion**
- Red and blue pull toward each other.
- Same-colour particles push apart.
- Slow particles change direction more easily than fast ones.

**Crashes and shockwaves**
- When a red and a blue particle meet, a shockwave blasts out from the crash.
- Red-blue crashes make a rainbow block. Every cell flickers through random red, orange, yellow, green, blue and violet.
- Same-colour crashes make a block in that colour, red for red and blue for blue.
- The block expands in rings. Harder hits, meaning higher combined energy, spread faster, climb more rows and have thicker walls. Rainbow walls are two cells thicker.
- Blasts fade out as they spread and the wall thins to one cell at the edge.
- Particles that crashed stop. Nothing keeps flying through the blast.

**Fizzling**
- Any particle or daughter track can fizzle out at any tick, with low odds.
- Odds double while a particle is caught inside any shockwave.
- A fizzled track stops, its trail fades, and daughters it hadn't spawned never appear. A particle that fizzled before a crash can't take part in it.

## Install

```
/plugin install spin-mascot --marketplace trevorgibbons042/MrShinyFiberMod
```

Restart Claude Code afterwards. To try it from a clone without installing, run `claude --plugin-dir <path to this folder>`.

## Files

- `hooks/register.tsx` has all of the animation. It is a `ui.render` hook on the `AbovePrompt` component, driven by a clock atom.
- `types/index.d.ts` declares the mod's state.
- `.claude-plugin/plugin.json` is the manifest.
