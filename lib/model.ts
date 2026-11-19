// Token Radar's model, radar-2: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds
// the early radar: pre-token protocols below the watchlist floor, by TVL. A protocol is pre-token
// when its index entry records no token at all (no market cap, no CoinGecko id, no symbol); the
// live-token protocols are kept apart and shown with the market's own values, never mixed into
// the ranked board.
//
// Implied value follows only from the snapshot's own figures, and the multiple is the market's
// own answer rather than a constant. For each category, the multiple is the median
// market-cap-to-TVL ratio of its live-token protocols (TVL at least $1M, at least 3 of them); a
// category with too few live comparables falls back to the global median. The multiple is clamped
// to [0.05, 1.5] so one thin protocol cannot set the price for a whole category:
//
//   multiple   = median(mcap_usd / tvl_usd) over the category's live comparables (or the global one)
//   growth     = clamp(change_7d, -50, 150) per cent
//   growthMult = 1 + (growth / 100) x 0.7
//   maturity   = 0.7 + min(age_days, 1460) / 1460 x 0.3   (age_days unknown: 365)
//   implied    = max(1, round(tvl_usd x multiple x growthMult x maturity))
//
// No protocol name is ever special-cased: one function scores every row, and the dashboard prints
// the multiple, its source and the comparables behind it for every category it uses.

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  min_comparables: number;
  min_tvl_for_comparable: number;
  multiple_floor: number;
  multiple_cap: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.7,
  growth_floor: -50,
  growth_cap: 150,
  maturity_floor: 0.7,
  maturity_range: 0.3,
  maturity_days: 1460,
  unknown_age_days: 365,
  min_comparables: 3,
  min_tvl_for_comparable: 1_000_000,
  multiple_floor: 0.05,
  multiple_cap: 1.5,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

const DAY_MS = 86_400_000;

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string; // DefiLlama's slug, the row's key
  name: string; // the protocol's display name
  category: string | null; // DefiLlama's category, null when it names none
  chains: string[]; // the chains it runs on
  tvl_usd: number; // total value locked, whole dollars, truncated
  change_7d: number | null; // its TVL's change over seven days, in per cent
  mcap_usd: number | null; // market cap, null when it records no token
  listed_at: string | null; // the UTC day DefiLlama began tracking it, or null
  gecko_id: string | null; // CoinGecko id, null when it records no token
  symbol: string | null; // token symbol, null when it records no token
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string; // the UTC date of the fetch
  source: string; // the endpoint and the exact fetch time
  floor_usd: number; // the watchlist's floor in whole US dollars
  protocols: SnapshotProtocol[]; // every protocol at or above $5M of TVL, sorted by slug
  watchlist: string[]; // the slugs the house's rule kept
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    multiple_source: string;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  category_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  on_watchlist: boolean;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** One live comparable behind a category multiple, for the detail view. */
export interface Comparable {
  name: string;
  tvl_usd: number;
  mcap_usd: number;
  ratio: number;
}

/** A category's multiple, its source, and the comparables it was read from. */
export interface CategoryMultiple {
  category: string;
  multiple: number;
  count: number;
  source: 'category' | 'global';
  top: Comparable[];
}

/** Everything the dashboard needs: the board, the live set, the multiples, and the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  global_multiple: number;
  rows: RadarRow[];
  live: LiveRow[];
  multiples: CategoryMultiple[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a non-empty list of numbers. */
function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function daysSince(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function mayRank(p: SnapshotProtocol): boolean {
  return recordsNoToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** Whether a protocol can price a category multiple: it trades, and its TVL is big enough to mean something. */
function canPrice(p: SnapshotProtocol, model: ModelConstants): boolean {
  return !recordsNoToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd >= model.min_tvl_for_comparable;
}

/** The multiples the snapshot's own live protocols imply, per category and globally. */
export function priceMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): { byCategory: Map<string, CategoryMultiple>; global: number } {
  const live = snapshot.protocols.filter((p) => canPrice(p, model));
  const clamp = (x: number): number => Math.min(model.multiple_cap, Math.max(model.multiple_floor, x));
  const global = clamp(medianOf(live.map((p) => p.mcap_usd! / p.tvl_usd)));
  const grouped = new Map<string, SnapshotProtocol[]>();
  for (const p of live) {
    const key = p.category ?? 'Other';
    const list = grouped.get(key) ?? [];
    list.push(p);
    grouped.set(key, list);
  }
  const byCategory = new Map<string, CategoryMultiple>();
  for (const [category, list] of grouped) {
    const top = [...list]
      .sort((a, b) => b.mcap_usd! - a.mcap_usd!)
      .slice(0, 3)
      .map((p) => ({ name: p.name, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd!, ratio: Math.round((p.mcap_usd! / p.tvl_usd) * 1000) / 1000 }));
    if (list.length >= model.min_comparables) {
      byCategory.set(category, { category, multiple: clamp(medianOf(list.map((p) => p.mcap_usd! / p.tvl_usd))), count: list.length, source: 'category', top });
    } else {
      byCategory.set(category, { category, multiple: global, count: list.length, source: 'global', top });
    }
  }
  return { byCategory, global };
}

/** The three multipliers and the implied value one protocol gets under `model`. */
export function scoreProtocol(
  protocol: SnapshotProtocol,
  asOf: string,
  multiples: { byCategory: Map<string, CategoryMultiple>; global: number },
  model: ModelConstants,
): { implied: number; multiple: number; multipleSource: string; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = daysSince(asOf, protocol.listed_at);
  const entry = multiples.byCategory.get(protocol.category ?? 'Other');
  const multiple = entry?.multiple ?? multiples.global;
  const multipleSource =
    entry === undefined
      ? 'global (no live comparables in its category)'
      : entry.source === 'category'
        ? `median of ${entry.count} live ${protocol.category ?? 'Other'} protocols`
        : `global (only ${entry.count} live ${protocol.category ?? 'Other'} comparables)`;
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * growthMult * maturityMult));
  return { implied, multiple, multipleSource, growthPct, growthMult, maturityMult, age };
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The snapshot's protocol by slug. */
function indexBySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function rankBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const multiples = priceMultiples(snapshot, model);
  const index = indexBySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot,
  // but the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL, capped. Never a
  // replacement for a watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && mayRank(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = scoreProtocol(p, snapshot.as_of, multiples, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      // Full precision on purpose: the dashboard recomputes this row from the same multiple and
      // checks the number against board.json, so a rounded multiple would read as stale data.
      category_multiple: s.multiple,
      multiple_source: s.multipleSource,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function firstChain(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/**
 * One category's core action, as a rule table: the first rule whose words match the category
 * wins. The action is built from the protocol's own record (category, chains, TVL), never from a
 * hand-written list of names.
 */
const ACTION_RULES: { words: string[]; action: (name: string, capital: number, chain: string) => string }[] = [
  { words: ['lend', 'cdp', 'collateral'], action: (name, capital, chain) => `Lend $${capital} of USDC on ${name} (${chain}) and leave the deposit earning for the full hold.` },
  { words: ['dex', 'yield', 'leveraged farm'], action: (name, capital, chain) => `Add $${capital} to ${name}'s deepest ${chain} pool as liquidity and leave it in place.` },
  { words: ['bridge'], action: (name, capital, chain) => `Send $${capital} of USDC across ${name} to ${chain}, then put the bridged funds to work in the destination app.` },
  { words: ['staking', 'restak'], action: (name, capital, chain) => `Stake $${capital} of the native asset through ${name} and keep the liquid receipt token.` },
  { words: ['perpetual', 'derivative'], action: (name, capital, chain) => `Fund a $${capital} USDC margin account on ${name} and open a single small hedged position.` },
  { words: ['prediction'], action: (name, capital, chain) => `Back one outcome with $${capital} on ${name} and leave the position until the market resolves.` },
  { words: ['curator', 'allocator'], action: (name, capital, chain) => `Place $${capital} into a ${name} vault on ${chain} and hold the vault shares.` },
  { words: ['stable'], action: (name, capital, chain) => `Mint or lock $${capital} of stable value through ${name} on ${chain}.` },
  { words: ['rwa'], action: (name, capital, chain) => `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it.` },
  { words: ['insurance'], action: (name, capital, chain) => `Underwrite $${capital} of cover through ${name} on ${chain} and keep the policy active.` },
];

/** The category's one action, from the rule table, or the default open-a-position action. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  for (const rule of ACTION_RULES) {
    if (rule.words.some((w) => c.includes(w))) return rule.action(p.name, capital, chain);
  }
  return `Open a $${capital} position in ${p.name} on ${chain} and leave it working.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of
 * names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = firstChain(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  return [
    {
      text: `Read ${p.name}'s own docs and check whether it runs a points or rewards program, so you farm what it actually counts.`,
      cost: 'free',
      time: '20 minutes',
    },
    {
      text: `Move $${capital} of USDC to ${chain} on the cheapest route and keep the receipt for the farm log.`,
      cost: `about $${capital >= 150 ? 6 : 3} of gas or bridge fees`,
      time: '10 to 20 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Do one on-chain action a week inside the protocol, such as a deposit, a swap, a borrow or a vote.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Keep the position open for at least ${hold} days so the activity shows up in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `When you leave, confirm any claim only on the protocol's own site or docs, and never pay a fee to claim.`,
      cost: 'free to check, and never pay to claim',
      time: '10 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveSet(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !recordsNoToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    on_watchlist: false, // set by buildRadar, which knows the snapshot's watchlist
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = rankBoard(snapshot, model);
  const multiples = priceMultiples(snapshot, model);
  const live = liveSet(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    global_multiple: round4(multiples.global),
    rows: board.map((r) => {
      const row = radarRow(r);
      row.on_watchlist = snapshot.watchlist.includes(r.slug);
      return row;
    }),
    live,
    multiples: [...multiples.byCategory.values()].sort((a, b) => b.multiple - a.multiple),
  };
  return { board, radar };
}

/** Refuse with a SnapshotError when `ok` is false. */
function need(ok: boolean, message: string): void {
  if (!ok) throw new SnapshotError(message);
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  need(typeof raw === 'object' && raw !== null && !Array.isArray(raw), 'snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  need(typeof o.as_of === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.as_of), 'snapshot.json has no as_of date');
  need(typeof o.source === 'string', 'snapshot.json has no source');
  need(typeof o.floor_usd === 'number' && Number.isSafeInteger(o.floor_usd) && o.floor_usd > 0, 'snapshot.json has no floor_usd');
  need(Array.isArray(o.protocols), 'snapshot.json has no protocols array');
  need(Array.isArray(o.watchlist) && o.watchlist.every((s) => typeof s === 'string'), 'snapshot.json has no watchlist of slugs');
  const protocols = (o.protocols as unknown[]).map((v, i) => {
    need(typeof v === 'object' && v !== null && !Array.isArray(v), `snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    const hasIdentity = typeof p.slug === 'string' && typeof p.name === 'string' && typeof p.tvl_usd === 'number' && Number.isFinite(p.tvl_usd);
    need(hasIdentity, `snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    const numOrNull = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
    const strOrNull = (x: unknown): string | null => (typeof x === 'string' ? x : null);
    return {
      slug: p.slug as string,
      name: p.name as string,
      category: strOrNull(p.category),
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd as number,
      change_7d: numOrNull(p.change_7d),
      mcap_usd: numOrNull(p.mcap_usd),
      listed_at: strOrNull(p.listed_at),
      gecko_id: strOrNull(p.gecko_id),
      symbol: strOrNull(p.symbol),
    };
  });
  return {
    as_of: o.as_of as string,
    source: o.source as string,
    floor_usd: o.floor_usd as number,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  for (let i = 0; i < board.length; i++) {
    if (board[i]!.rank !== i + 1) return `the row at position ${i + 1} carries rank ${board[i]!.rank}`;
    if (i > 0 && board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
