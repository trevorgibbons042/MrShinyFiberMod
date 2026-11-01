import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

const frame = atom({ plugin: 'spin-mascot', key: 'frame' } as const, 0)

const WIDTH = 5
const BODY_ROWS = 7
const OFFSET = 5
const TAIL = 30
const SPACING = 6
const FADE = 6
const WRAP = 9996
const MARGIN = 10
const FIBER_CELLS = WIDTH + 3
const HOT = 0.9
const SCATTER_FADE = 3
const BLAST_FADE = 1
const BOOM = 18
const BOOM_LIFE = 20

const EDGE = '#3B82F6'
const DARK = '#1E3A8A'
const FACE = '#FFFFFF'

// Blue comes in from the right, red from the left, and blasts burn orange to
// white. Kinds 3-8 are the rainbow a red-on-blue blast flashes through, and 9
// and 10 are the blue and red shocks of same-colour crashes.
const PALETTES = [
  { low: '#3B82F6', mid: '#60A5FA', high: '#7DF9FF', core: FACE },
  { low: '#B91C1C', mid: '#EF4444', high: '#FCA5A5', core: '#FF8A8A' },
  { low: '#F59E0B', mid: '#FCD34D', high: '#FFFFFF', core: '#FFFFFF' },
  { low: '#E01818', mid: '#FF2D2D', high: '#FF4D4D', core: '#FFFFFF' },
  { low: '#E06A00', mid: '#FF8A00', high: '#FFA033', core: '#FFFFFF' },
  { low: '#E0C800', mid: '#FFE600', high: '#FFF03D', core: '#FFFFFF' },
  { low: '#12B04A', mid: '#22E06B', high: '#4DFF8A', core: '#FFFFFF' },
  { low: '#1E5BE0', mid: '#2D7BFF', high: '#5C99FF', core: '#FFFFFF' },
  { low: '#8A2BE0', mid: '#B04DFF', high: '#C47DFF', core: '#FFFFFF' },
  { low: '#3B82F6', mid: '#60A5FA', high: '#7DF9FF', core: FACE },
  { low: '#B91C1C', mid: '#EF4444', high: '#FF5A5A', core: '#FF8A8A' },
]

const SLOPES = [-0.6, -0.3, 0, 0.3, 0.6]

// Primaries come in at four speeds, in columns per tick. Faster ones carry
// more energy; the rare fastest tier showers into far more daughters, more
// generations deep. TIER_ODDS picks a tier out of ten.
const TIERS = [
  { speed: 1, energy: 1.5, maxGen: 3 },
  { speed: 2, energy: 2, maxGen: 3 },
  { speed: 3, energy: 3, maxGen: 3 },
  { speed: 4, energy: 12, maxGen: 4 },
]
const TIER_ODDS = [0, 0, 0, 1, 1, 1, 1, 2, 2, 3]

// One turn of the spin. Eyes slide across the face; the empty
// eye list is the fiber's back.
const SPIN: { eyes: number[]; mouth: number | null }[] = [
  { eyes: [1, 3], mouth: 2 },
  { eyes: [2, 4], mouth: 3 },
  { eyes: [4], mouth: null },
  { eyes: [], mouth: null },
  { eyes: [0], mouth: null },
  { eyes: [0, 2], mouth: 1 },
]

type Head = 'p' | 'd' | null
type Kind = number
type Cell = { ch: string; color: string; bold?: boolean }
// `tr` numbers a scatter track within its event (0 is the primary) and `par` is
// the track it grew from; blast cells leave both out.
type Deposit = { t: number; col: number; row: number; e: number; mark: Head; kind: Kind; tr?: number; par?: number }
type Spread = { cols: number; maxGen: number; back: number; kind: Kind; ids: { next: number } }
type Shape = { radius: number; speed: number; thick: number; climb: number; extra: number }
type Blast = { start: number; deps: Deposit[]; cx: number; cy: number; shape: Shape }
type Hot = { t: number; row: number; col: number; e: number }

const hash = (n: number): number => {
  let x = Math.imul(n + 1, 2654435761) >>> 0
  x = Math.imul(x ^ (x >>> 15), 2246822519) >>> 0
  return (x ^ (x >>> 13)) >>> 0
}

// Each daughter track starts one column beside where its parent ended, usually
// further left and sometimes back to the right (one in `back`), and drifts up
// or down; its energy is its parent's, shared out between siblings.
const grow = (out: Deposit[], t: number, col: number, row: number, gen: number, energy: number, seed: number, sp: Spread, parent: number) => {
  if (gen > sp.maxGen) return
  const n = 1 + (hash(seed) % 3) + Math.min(3, Math.floor(energy / 3))
  for (let j = 0; j < n; j++) {
    const h = hash(seed * 7 + j + 1)
    const tr = sp.ids.next++
    const slope = SLOPES[h % SLOPES.length]!
    const len = 2 + ((h >>> 8) % 3)
    const dir = (h >>> 16) % sp.back === 0 ? 1 : -1
    const e = (energy / n) * 1.3
    let lastCol = col
    let lastRow = row
    let count = 0
    for (let s = 0; s < len; s++) {
      const c = col + dir * (1 + s)
      const r = Math.round(row + slope * (s + 1))
      if (c < 0 || c >= sp.cols || r < 0 || r >= BODY_ROWS) break
      out.push({ t: t + 1 + s, col: c, row: r, e, mark: 'd', kind: sp.kind, tr, par: parent })
      lastCol = c
      lastRow = r
      count++
    }
    if (count) grow(out, t + count, lastCol, lastRow, gen + 1, e, h, sp, tr)
  }
}

// The primary crosses `speed` columns a tick. Three in five pass straight
// through to the left edge; the rest interact at a hashed column and fan out leftward.
// A new event starts every SPACING ticks and lasts eventLife, so they overlap.
// Even events are blue and come from the right; odd events are red, built the
// same way and then mirrored so they come from the left.
const eventLife = (cols: number): number => cols + TAIL + FADE

// What an event decides for itself before it meets anything: its colour, speed
// tier, aim row, angle, and the column where it interacts (none if it passes
// straight through).
type Line = { i: number; kind: number; tier: (typeof TIERS)[number]; row: number; slope: number; inter: number; through: boolean }

const lines = new Map<string, Line>()

const lineOf = (i: number, cols: number): Line => {
  const key = `${cols}:${i}`
  const cached = lines.get(key)
  if (cached) return cached

  const h = hash(i)
  const through = (h >>> 12) % 5 < 3
  const a = hash(i ^ 0x5bd1e995)
  const out: Line = {
    i,
    kind: i % 2,
    tier: TIERS[TIER_ODDS[hash(i ^ 0x27d4eb2d) % TIER_ODDS.length]!]!,
    row: 2 + (h % 5),
    // About one primary in three comes in at a slight angle, aimed so it
    // reaches `row` at the interaction column; cells off the band are skipped.
    slope: a % 3 === 0 ? ((a >>> 3) % 2 ? 1 : -1) * (0.08 + ((a >>> 4) % 3) * 0.06) : 0,
    inter: through ? 0 : 1 + ((h >>> 4) % (cols - 1)),
    through,
  }

  if (lines.size > 1024) lines.clear()
  lines.set(key, out)
  return out
}

// The real column and straight-line row of a line's leading cell on a tick, or
// null when it isn't flying then. Blue runs right to left, red left to right.
const placeAt = (ln: Line, t: number, cols: number): { col: number; row: number } | null => {
  const s = (t - ln.i * SPACING) * ln.tier.speed
  if (s < 0 || cols - 1 - s < ln.inter) return null
  return { col: ln.kind === 1 ? s : cols - 1 - s, row: ln.row - ln.slope * (cols - 1 - s - ln.inter) }
}

const REACH = 30
const PUSH = 0.06
const ATTRACT = 3
const REPEL = 6
const DAMP = 0.5

// Row offset of event i's primary on each tick of its flight. Opposite colours
// pull each other's rows together, same colours push apart, and nearer ones count
// more. A slow particle (mobility 1) swings easily; the fastest (0.25) barely
// bends. Other events are taken on their straight lines, so nothing here waits
// on anything else being steered first.
const steers = new Map<string, number[]>()

const steerOf = (i: number, cols: number): number[] => {
  const key = `${cols}:${i}`
  const cached = steers.get(key)
  if (cached) return cached

  const me = lineOf(i, cols)
  const reach = Math.ceil(eventLife(cols) / SPACING)
  const mobility = 1 / me.tier.speed
  const ticks = Math.floor((cols - 1 - me.inter) / me.tier.speed) + 1
  const out: number[] = []
  let off = 0
  let vy = 0
  for (let n = 0; n < ticks; n++) {
    const t = i * SPACING + n
    const here = placeAt(me, t, cols)!
    const y = here.row + off
    // Only the nearest particle of each kind counts, so the pulls don't average
    // out to nothing.
    let pull = { dx: REACH + 1, dy: 0 }
    let push = { dx: REACH + 1, dy: 0, j: 0 }
    for (let j = Math.max(0, i - reach); j <= i + reach; j++) {
      if (j === i) continue
      const other = placeAt(lineOf(j, cols), t, cols)
      if (!other) continue
      const dx = Math.abs(other.col - here.col)
      if (dx > REACH) continue
      if (j % 2 !== i % 2) {
        if (dx < pull.dx) pull = { dx, dy: other.row - y }
      } else if (dx < push.dx) push = { dx, dy: other.row - y, j }
    }
    let force = 0
    if (pull.dx <= REACH) force += Math.max(-1, Math.min(1, pull.dy)) * ATTRACT * (1 - pull.dx / REACH)
    if (push.dx <= REACH) {
      const side = push.dy === 0 ? (hash(i * 31 + push.j) % 2 ? 1 : -1) : Math.sign(push.dy)
      force -= side * REPEL * ((1 - push.dx / REACH) / (1 + Math.abs(push.dy)))
    }
    vy = vy * DAMP + force * PUSH * mobility
    off = Math.max(-here.row, Math.min(BODY_ROWS - 1 - here.row, off + vy))
    out.push(off)
  }

  if (steers.size > 1024) steers.clear()
  steers.set(key, out)
  return out
}

const events = new Map<string, Deposit[]>()

const eventAt = (i: number, cols: number): Deposit[] => {
  const key = `${cols}:${i}`
  const cached = events.get(key)
  if (cached) return cached

  const { kind, tier, row, slope, inter, through } = lineOf(i, cols)
  const steer = steerOf(i, cols)
  const out: Deposit[] = []
  for (let s = 0; cols - 1 - s >= inter; s++) {
    const last = cols - 2 - s < inter
    const n = Math.floor(s / tier.speed)
    const r = Math.round(row - slope * (cols - 1 - s - inter) + steer[n]!)
    if (r < 0 || r >= BODY_ROWS) continue
    out.push({ t: n, col: cols - 1 - s, row: r, e: 0.7 * tier.energy, mark: (s + 1) % tier.speed === 0 || last ? 'p' : null, kind, tr: 0, par: -1 })
  }
  // The shower starts from the row where the steered primary ended.
  const end = Math.max(0, Math.min(BODY_ROWS - 1, Math.round(row + steer[steer.length - 1]!)))
  if (!through) grow(out, Math.floor((cols - 1 - inter) / tier.speed), inter, end, 1, tier.energy, hash(i), { cols, maxGen: tier.maxGen, back: 5, kind, ids: { next: 1 } }, 0)
  if (kind === 1) for (const d of out) d.col = cols - 1 - d.col

  if (events.size > 256) events.clear()
  events.set(key, out)
  return out
}

// A blast: a white flash and a solid rectangular shockwave that spreads two
// columns and one row a tick, each ring lit for BLAST_FADE ticks only. A
// red-on-blue blast gives every block its own random rainbow colour, reshuffled
// each tick as the rings move out; a same-colour crash shocks in its own colour. Side walls are two columns thick,
// so a one-tick wall that moves two columns a tick leaves no gaps; a harder hit
// spreads faster and its walls get thicker to match.
// How far and how fast a blast spreads. Harder hits spread faster: columns, then
// rows, a tick, with a wall thick enough that a step never leaves a gap.
const shapeOf = (energy: number, tone: number): Shape => {
  const speed = 2 + (energy >= 6 ? 1 : 0) + (energy >= 12 ? 1 : 0)
  const extra = tone < 0 ? 2 : 0
  return { radius: Math.min(BOOM, 8 + Math.floor(2 * energy)), speed, thick: 2 * (speed - 1) + extra, climb: speed - 1, extra }
}

const explode = (col: number, row: number, energy: number, cols: number, tone: number, shape: Shape): Deposit[] => {
  const { radius, speed, thick, climb, extra } = shape
  const out: Deposit[] = [{ t: 0, col, row, e: energy, mark: 'p', kind: 2 }]
  for (let k = 1; k <= radius; k++) {
    const reachX = speed * k
    const reachY = climb * k
    for (let dr = -reachY; dr <= reachY; dr++) {
      const r = row + dr
      if (r < 0 || r >= BODY_ROWS) continue
      // The wall thins from full thickness to one cell as the blast fizzles out.
      const left = 1 - (k - 1) / radius
      const wall = 1 + Math.round((thick - 1) * left)
      const lip = 1 + Math.round((climb + extra - 1) * left)
      const edge = Math.abs(dr) > reachY - lip
      for (let dc = -reachX; dc <= reachX; dc++) {
        if (!edge && Math.abs(dc) <= reachX - wall) continue
        const c = col + dc
        if (c < 0 || c >= cols) continue
        const kind = tone < 0 ? 3 + (hash(c * 31 + r * 7 + k * 131 + col * 17 + row) % 6) : tone
        out.push({ t: k, col: c, row: r, e: 1.4 * (1 - (k - 1) / radius), mark: null, kind })
      }
    }
  }
  return out
}

// Cells where an event holds a hot particle, keyed by the tick and place, so
// two events meeting in one cell on one tick show up as a shared key.
const hots = new Map<string, Map<string, Hot>>()

const hotOf = (i: number, cols: number): Map<string, Hot> => {
  const key = `${cols}:${i}`
  const cached = hots.get(key)
  if (cached) return cached

  const out = new Map<string, Hot>()
  for (const d of eventAt(i, cols)) {
    if (d.e < HOT) continue
    const t = i * SPACING + d.t
    const k = `${t}:${d.row}:${d.col}`
    const cur = out.get(k)
    if (!cur || cur.e < d.e) out.set(k, { t, row: d.row, col: d.col, e: d.e })
  }

  if (hots.size > 256) hots.clear()
  hots.set(key, out)
  return out
}

// The first hot cell of event j (the earlier one) that event i fills, or sits
// next to, on the same tick, with the two particles' energies added together;
// null if they never meet. Fast particles skip cells between ticks, so a head-on
// crossing can jump past without sharing one; the one-column margin catches it.
const meets = new Map<string, { at: Hot; e: number } | null>()

const meet = (j: number, i: number, cols: number): { at: Hot; e: number } | null => {
  const key = `${cols}:${j}:${i}`
  const cached = meets.get(key)
  if (cached !== undefined) return cached

  const mine = hotOf(i, cols)
  let first: { at: Hot; e: number } | null = null
  for (const at of hotOf(j, cols).values()) {
    for (let dc = -1; dc <= 1; dc++) {
      const m = mine.get(`${at.t}:${at.row}:${at.col + dc}`)
      if (m && (!first || at.t < first.at.t)) first = { at, e: at.e + m.e }
    }
  }

  if (meets.size > 4096) meets.clear()
  meets.set(key, first)
  return first
}

// Where event i runs into an earlier event, the first shared hot cell makes a
// blast whose size follows the two particles' energies added together.
const blasts = new Map<string, Blast[]>()

// `final` false judges crashes on crash rules alone, which is what fizzling reads
// its shockwaves from; true also drops particles that fizzled before the crash.
const boomsFor = (i: number, cols: number, life: number, final = true): Blast[] => {
  const key = `${cols}:${i}:${final}`
  const cached = blasts.get(key)
  if (cached) return cached

  const out: Blast[] = []
  for (let j = Math.max(0, i - Math.ceil(life / SPACING)); j < i; j++) {
    const m = meet(j, i, cols)
    // Even events are blue and odd red, so an odd sum means a blue met a red.
    // A particle already stopped by an earlier crash leaves no blast behind.
    const alive = m && crashOf(j, cols, life, m.at.t, final) === Infinity && crashOf(i, cols, life, m.at.t, final) === Infinity
    const flying = !final || !m || (fizzleOf(j, cols, life) >= m.at.t && fizzleOf(i, cols, life) >= m.at.t)
    if (m && alive && flying) {
      const tone = (i + j) % 2 === 1 ? -1 : 9 + (i % 2)
      const shape = shapeOf(m.e, tone)
      out.push({ start: m.at.t, deps: explode(m.at.col, m.at.row, m.e, cols, tone, shape), cx: m.at.col, cy: m.at.row, shape })
    }
  }

  if (blasts.size > 256) blasts.clear()
  blasts.set(key, out)
  return out
}

// A blue and a red particle that meet stop there for good, and trails already
// laid down fade out on their own. This is the earliest tick before `limit` at
// which event i met an opposite-colour event while both were still flying, or
// Infinity. A particle stopped by an earlier crash can't take part in a later
// one, so each candidate is checked against its partner's own earlier crashes.
const crashes = new Map<string, number>()

const crashOf = (i: number, cols: number, life: number, limit: number, final = true): number => {
  const key = `${cols}:${i}:${limit}:${final}`
  const cached = crashes.get(key)
  if (cached !== undefined) return cached

  const reach = Math.ceil(life / SPACING)
  const found: { t: number; k: number }[] = []
  for (let k = Math.max(0, i - reach); k <= i + reach; k++) {
    if ((i + k) % 2 !== 1) continue
    const m = k < i ? meet(k, i, cols) : meet(i, k, cols)
    if (!m || m.at.t >= limit) continue
    // In the final pass a particle that fizzled before the crash can't take part.
    if (final && (fizzleOf(i, cols, life) < m.at.t || fizzleOf(k, cols, life) < m.at.t)) continue
    found.push({ t: m.at.t, k })
  }
  found.sort((a, b) => a.t - b.t)

  let out = Infinity
  for (const { t, k } of found) {
    if (crashOf(k, cols, life, t, final) === Infinity) {
      out = t
      break
    }
  }

  if (crashes.size > 4096) crashes.clear()
  crashes.set(key, out)
  return out
}

// Every particle track has FIZZLE odds of dying on each tick, doubled while it has
// a cell inside a shockwave: the whole block the blast has spread to by then, not
// just its one-tick ring. A fizzled track stops there, its trail fades as usual,
// and daughters it hadn't spawned yet never appear.
const FIZZLE = 0.005

const caught = (b: Blast, t: number, row: number, col: number): boolean => {
  const k = t - b.start
  const { radius, speed, climb, extra } = b.shape
  return k >= 1 && k <= radius && Math.abs(col - b.cx) <= speed * k && Math.abs(row - b.cy) <= climb * k + extra
}

// Blasts near enough in time to reach event i, on crash rules alone.
const nearBlasts = (i: number, cols: number, life: number): Blast[] => {
  const reach = Math.ceil((life + BOOM_LIFE) / SPACING)
  const out: Blast[] = []
  for (let k = Math.max(0, i - reach); k <= i + reach; k++) out.push(...boomsFor(k, cols, life, false))
  return out
}

const fizzles = new Map<string, Map<number, number>>()

// The tick each of event i's tracks fizzles, by track id; survivors aren't listed.
const fizzleTicks = (i: number, cols: number, life: number): Map<number, number> => {
  const key = `${cols}:${i}`
  const cached = fizzles.get(key)
  if (cached) return cached

  const tracks = new Map<number, { par: number; ticks: Map<number, Deposit[]> }>()
  for (const d of eventAt(i, cols)) {
    let g = tracks.get(d.tr!)
    if (!g) tracks.set(d.tr!, (g = { par: d.par!, ticks: new Map() }))
    const t = i * SPACING + d.t
    const cells = g.ticks.get(t)
    if (cells) cells.push(d)
    else g.ticks.set(t, [d])
  }

  const out = new Map<number, number>()
  const near = nearBlasts(i, cols, life)
  // Parents come before their daughters, so a fizzled parent is known by then.
  for (const tr of [...tracks.keys()].sort((a, b) => a - b)) {
    const g = tracks.get(tr)!
    const ticks = [...g.ticks.keys()].sort((a, b) => a - b)
    if (g.par >= 0 && out.has(g.par)) {
      out.set(tr, ticks[0]!)
      continue
    }
    for (const t of ticks) {
      const inside = g.ticks.get(t)!.some(c => near.some(b => caught(b, t, c.row, c.col)))
      if (hash(i * 1009 + tr * 53 + t) / 4294967296 < (inside ? 2 : 1) * FIZZLE) {
        out.set(tr, t)
        break
      }
    }
  }

  if (fizzles.size > 256) fizzles.clear()
  fizzles.set(key, out)
  return out
}

const fizzleOf = (i: number, cols: number, life: number): number => fizzleTicks(i, cols, life).get(0) ?? Infinity

const trimmed = new Map<string, Deposit[]>

const trimmedAt = (i: number, cols: number, life: number): Deposit[] => {
  const key = `${cols}:${i}`
  const cached = trimmed.get(key)
  if (cached) return cached

  const cut = crashOf(i, cols, life, Infinity)
  const lost = fizzleTicks(i, cols, life)
  const out = eventAt(i, cols).filter(d => {
    const t = i * SPACING + d.t
    return t <= cut && t < (lost.get(d.tr!) ?? Infinity)
  })

  if (trimmed.size > 256) trimmed.clear()
  trimmed.set(key, out)
  return out
}

const field = (tick: number, live: { start: number; deps: Deposit[] }[], cols: number) => {
  const grid = () => Array.from({ length: BODY_ROWS }, () => Array<number>(cols).fill(0))
  const energy = PALETTES.map(grid)
  const head = Array.from({ length: BODY_ROWS }, () => Array<{ mark: Head; kind: Kind } | null>(cols).fill(null))
  for (const { start, deps } of live) {
    for (const d of deps) {
      const age = tick - start - d.t
      const fade = d.kind >= 2 ? BLAST_FADE : d.mark === 'd' ? SCATTER_FADE : FADE
      if (age < 0 || age >= fade) continue
      energy[d.kind]![d.row]![d.col]! += d.e * (1 - age / fade)
      if (age === 0 && d.mark) head[d.row]![d.col] = { mark: d.mark, kind: d.kind }
    }
  }
  return { energy, head }
}

const glyph = (e: number, kind: Kind): Cell => {
  const pal = PALETTES[kind]!
  if (e > 0.8) return { ch: '█', color: pal.high, bold: true }
  if (e > 0.4) return { ch: '▓', color: pal.mid }
  return { ch: '▒', color: pal.low }
}

const cellsAt = (tick: number, k: number, f: ReturnType<typeof field>): Cell[][] => {
  const spin = SPIN[(tick + k * OFFSET) % SPIN.length]!
  const rows: Cell[][] = []

  for (let r = 0; r < BODY_ROWS; r++) {
    const row: Cell[] = []
    for (let c = 0; c < WIDTH; c++) {
      const col = k * WIDTH + c
      const per = f.energy.map(g => g[r]![col]!)
      const e = per.reduce((a, b) => a + b, 0)
      // A blast's own colour wins over particles in the same cell, so it can fade.
      const blast = Math.max(...per.slice(2))
      const kind = blast > 0.12 ? 2 + per.slice(2).indexOf(blast) : per.indexOf(Math.max(...per))
      const head = f.head[r]![col]
      if (r === 0 && spin.eyes.includes(c)) {
        row.push({ ch: 'o', color: FACE, bold: true })
      } else if (r === 1 && spin.mouth === c) {
        row.push({ ch: '▾', color: FACE })
      } else if (head?.mark === 'p') {
        row.push({ ch: '✦', color: PALETTES[head.kind]!.core, bold: true })
      } else if (head?.mark === 'd') {
        row.push({ ch: '•', color: PALETTES[head.kind]!.high, bold: true })
      } else if (e > 0.12) {
        row.push(glyph(e, kind))
      } else {
        row.push({ ch: '░', color: DARK })
      }
    }
    rows.push([{ ch: '│', color: EDGE }, ...row, { ch: '│', color: EDGE }])
  }

  const rule = '─'.repeat(WIDTH)
  return [
    [{ ch: `╭${rule}╮`, color: EDGE }],
    ...rows,
    [{ ch: `╰${rule}╯`, color: EDGE }],
  ]
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    $.clock.every(180, () => update($, frame, n => (n + 1) % WRAP))

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const tick = await read($, frame)
    const count = Math.max(1, Math.floor(((e.viewport?.columns ?? 80) - MARGIN + 1) / FIBER_CELLS))
    const cols = count * WIDTH
    const life = eventLife(cols)
    const live: { start: number; deps: Deposit[] }[] = []
    // An event's blasts outlast its own tracks by up to BOOM_LIFE ticks.
    for (let i = Math.max(0, Math.ceil((tick - life - BOOM_LIFE) / SPACING)); i * SPACING <= tick; i++) {
      if (tick - i * SPACING <= life) live.push({ start: i * SPACING, deps: trimmedAt(i, cols, life) })
      live.push(...boomsFor(i, cols, life))
    }
    const f = field(tick, live, cols)

    // Each fiber's spin runs OFFSET ticks ahead of the one to its left.
    return (
      <Box flexDirection="row" gap={1}>
        {Array.from({ length: count }, (_, k) => (
          <Box key={String(k)} flexDirection="column" flexShrink={0}>
            {cellsAt(tick, k, f).map((row, r) => (
              <Box key={String(r)} flexDirection="row">
                {row.map((cell, c) => (
                  <Text key={String(c)} color={cell.color} bold={cell.bold} mono>
                    {cell.ch}
                  </Text>
                ))}
              </Box>
            ))}
          </Box>
        ))}
      </Box>
    )
  })
}
