// Deep-Print Radar's model: one sealed snapshot of the protocol universe in, one ranked board out.
//
// The question the board answers: if this protocol issued its token today and the market priced it
// the way it already prices launched protocols of its size, in its category, with its reach, what
// would the token be worth? Every figure is derived from the snapshot itself at run time; no
// protocol name is ever special-cased and no number below is copied from an earlier entry.
//
//   0. The universe. Every protocol that records no token (no market cap, no CoinGecko id, no
//      ticker) and is not a wrapped, staked, bridged or versioned product of a token that already
//      trades — the watchlist's own exclusions, applied at every size, not only above its $50M
//      floor. On this snapshot that is 198 protocols: the 40 watchlist names and 158 more below
//      the floor. Nothing that records no token is left off the board for being small, and
//      nothing that already trades is ever ranked as a launch.
//
//   1. The fitted size curve. Launched protocols (a market cap above zero on real locked value)
//      trace a size curve: the market pays fewer value dollars per TVL dollar the larger a
//      protocol grows. The curve is a least-squares fit in log space over every launched peer,
//      fitted from the snapshot at run time, never hardcoded:
//          log10(value) = INTERCEPT + SLOPE * log10(TVL)
//      A category then shifts the curve by its own evidence: the median residual of its launched
//      peers against the curve, shrunk toward zero by the category's sample size, so a category
//      with two thin peers barely moves and one with fifteen sets its offset:
//          curve_value = 10 ^ (INTERCEPT + SLOPE * log10(TVL) + offset_category)
//      The fit's own residual spread becomes each row's honest band: half of all launched peers
//      landed between the curve's 25th and 75th residual percentiles, so each row carries
//      band_low / band_high at those same factors.
//
//   2. Momentum. A protocol gaining TVL is worth more than the same protocol shrinking:
//          momentum = 1 + MOMENTUM_RATE * clamp(change_7d, GROWTH_FLOOR, GROWTH_CAP)
//      An unreported seven-day change is neutral, never a penalty. The row also states the
//      seven-day move in dollars, so a reader sees whether the momentum is $10k or $100M.
//
//   3. Seasoning. A protocol that has run for years with no token has survived audits, cycles
//      and its own success; a two-week-old one has survived nothing. The factor saturates:
//          seasoning = SEASON_BASE + SEASON_RANGE * (1 - exp(-age_days / SEASON_TAU))
//      An unknown listing date is scored as a middling age, stated on the dashboard.
//
//   4. Chain breadth. A protocol live on many chains has distribution a single-chain protocol
//      does not. The premium is small and logarithmic, so breadth helps but never dominates:
//          breadth = 1 + min(BREADTH_CAP, BREADTH_RATE * log2(chain_count))
//
//      implied_value_usd = round(curve_value * momentum * seasoning * breadth), at least $1.
//
//   5. Comparables. Each row names its three nearest launched peers in its own category —
//      nearest by log-TVL distance — with each peer's market-cap-per-TVL multiple, and a comps
//      cross-check: the median of those three multiples times the row's TVL. The dashboard shows
//      the curve value and the comps value side by side, so a reader can see both pricings and
//      where they disagree.
//
//   6. Risk notes. Each row carries the risks its own record implies: single-chain
//      concentration, a shrinking seven days, a young listing, a micro size, missing seven-day
//      data, or a category with too few launched peers to trust its offset. A risk is a fact
//      from the snapshot, never a judgement about the team.
//
// The dashboard also shows the older comparables cross-check — each category's median
// market-cap-per-TVL multiple — beside the curve, so a reader can see both pricings at once.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
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
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  offset_shrink: number;
  momentum_rate: number;
  growth_floor: number;
  growth_cap: number;
  season_base: number;
  season_range: number;
  season_tau_days: number;
  unknown_age_days: number;
  breadth_rate: number;
  breadth_cap: number;
}

export const MODEL: ModelConstants = {
  offset_shrink: 5,
  momentum_rate: 0.006,
  growth_floor: -50,
  growth_cap: 80,
  season_base: 0.85,
  season_range: 0.3,
  season_tau_days: 540,
  unknown_age_days: 300,
  breadth_rate: 0.02,
  breadth_cap: 0.08,
};

/** The model's version label: the dashboard names it and the board's rows carry it. */
export const MODEL_VERSION = 'sizecurve-2';

/** How many launched protocols the dashboard's Already trading view carries, by market cap. */
export const LIVE_ROWS = 28;

/** How many nearest launched peers a row's comparables table names. */
export const COMPS_PEERS = 3;

/** The value bands the board groups its rows into, largest first. The thresholds are round
 * dollar lines drawn across this fit's own distribution, so every band holds real rows: the
 * fitted curve tops out near $136M on this snapshot, and a $1B band would stand empty. */
export const VALUE_BANDS: { id: string; label: string; min_usd: number }[] = [
  { id: 'mega', label: 'Mega — $100M and up', min_usd: 100_000_000 },
  { id: 'large', label: 'Large — $40M to $100M', min_usd: 40_000_000 },
  { id: 'mid', label: 'Mid — $20M to $40M', min_usd: 20_000_000 },
  { id: 'small', label: 'Small — $10M to $20M', min_usd: 10_000_000 },
  { id: 'micro', label: 'Micro — under $10M', min_usd: 0 },
];

/** The band a whole-dollar implied value falls in. */
export function valueBand(implied: number): string {
  for (const b of VALUE_BANDS) if (implied >= b.min_usd) return b.id;
  return 'micro';
}

/** One category's evidence against the fitted curve. */
export interface CategoryFit {
  peers: number;
  /** Median market cap per TVL dollar among the category's launched peers (the comps cross-check). */
  median_multiple: number;
  /** The category's shrunk median residual against the curve, in log10. */
  offset_log10: number;
}

/** The fitted size curve and everything derived from the launched peers. */
export interface CurveFit {
  /** Launched protocols the fit reads: a market cap above zero on real locked value. */
  peers: number;
  intercept: number;
  slope: number;
  r_squared: number;
  /** Residual percentiles of the fit, in log10: half the peers landed between these two. */
  resid_q25: number;
  resid_q75: number;
  /** The global median market cap per TVL dollar, the comps cross-check's anchor. */
  global_median_multiple: number;
  byCategory: Map<string, CategoryFit>;
}

/** One of a row's three nearest launched peers in its own category. */
export interface CompPeer {
  slug: string;
  name: string;
  tvl_usd: number;
  mcap_usd: number;
  multiple: number;
}

/** The costed, timed shape of one row's farm plan: the same numbers its steps quote. */
export interface PlanTotals {
  capital_usd: number;
  setup_cost_usd: number;
  weekly_cost_usd: number;
  hold_days: number;
  total_cost_usd: number;
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
  change_7d_usd: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  tier: 'watchlist' | 'radar';
  age_days: number | null;
  implied_value_usd: number;
  band: string;
  band_low_usd: number;
  band_high_usd: number;
  model: {
    curve_value_usd: number;
    curve_multiple: number;
    category_offset: number;
    peer_count: number;
    peer_median_multiple: number | null;
    momentum_factor: number;
    seasoning_factor: number;
    breadth_factor: number;
    age_days: number | null;
  };
  comps: {
    peers: CompPeer[];
    in_category: boolean;
    median_multiple: number | null;
    comps_value_usd: number | null;
  };
  plan: PlanTotals;
  risks: string[];
  farm_steps: string[];
}

/** The dashboard's view of one board row: the row, its plan included, so page and board agree. */
export type RadarRow = BoardRow;

/** A launched protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  symbol: string | null;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  multiple: number | null;
  fitted_value_usd: number | null;
  vs_curve_pct: number | null;
  change_7d: number | null;
}

/** One category's row in the dashboard's evidence table. */
export interface PeerGroup {
  category: string;
  peers: number;
  median_multiple: number;
  offset_multiple: number;
}

/** Everything the dashboard renders, from the snapshot. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  fit: {
    peers: number;
    intercept: number;
    slope: number;
    r_squared: number;
    resid_q25: number;
    resid_q75: number;
    band_factor_low: number;
    band_factor_high: number;
    global_median_multiple: number;
  };
  bands: { id: string; label: string; rows: number }[];
  protocols_size: number;
  pre_token_size: number;
  excluded_size: number;
  watchlist_size: number;
  board_size: number;
  radar_size: number;
  live_size: number;
  board_implied_total_usd: number;
  board_sha256: string;
  rows: RadarRow[];
  live: LiveRow[];
  peers: PeerGroup[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A whole day count from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The f-quantile of an already-sorted list, by the floor index: deterministic on every engine. */
function quantile(sorted: number[], f: number): number {
  const at = Math.min(sorted.length - 1, Math.max(0, Math.floor(f * sorted.length)));
  return sorted[at]!;
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whole words that mark a wrapped or staked product of a token that already trades. */
const PRODUCT_WORD = /\b(wrapped|staked|staking)\b/i;

/** Names that begin with an exchange's name are that exchange's product, not a launch candidate. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** Categories that are by construction a product of another protocol's token, never a launch. */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/**
 * Whether a protocol that records no token is a wrapped, staked, bridged or versioned product of
 * a token that already trades — the watchlist's own exclusions, read off the snapshot's fields.
 */
export function isProductOfLaunched(p: SnapshotProtocol): boolean {
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return true;
  return VERSIONED.test(p.name) || PRODUCT_WORD.test(p.name) || EXCHANGE_PREFIX.test(p.name);
}

/** Whether a protocol belongs on the board: it records no token and is no product of one. */
export function isRadarCandidate(p: SnapshotProtocol): boolean {
  return isPreToken(p) && !isProductOfLaunched(p);
}

/**
 * The fitted size curve: a least-squares line through the launched peers in log space, each
 * category's shrunk median residual against it, and the fit's own residual spread.
 */
export function fitCurve(snapshot: Snapshot, model: ModelConstants = MODEL): CurveFit {
  const peers = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const n = peers.length;
  if (n < 8) throw new SnapshotError(`the snapshot holds ${n} launched peers with a live market: too few to fit a curve`);
  const xs = peers.map((p) => Math.log10(p.tvl_usd));
  const ys = peers.map((p) => Math.log10(p.mcap_usd!));
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) ** 2;
    syy += (ys[i]! - my) ** 2;
  }
  const slope = sxx > 0 ? sxy / sxx : 0;
  const intercept = my - slope * mx;
  const rSquared = sxx > 0 && syy > 0 ? (sxy * sxy) / (sxx * syy) : 0;
  const residuals = peers.map((p, i) => ys[i]! - (intercept + slope * xs[i]!));
  const sortedResid = [...residuals].sort((a, b) => a - b);

  const residByCategory = new Map<string, number[]>();
  const ratiosByCategory = new Map<string, number[]>();
  peers.forEach((p, i) => {
    if (p.category === null) return;
    const r = residByCategory.get(p.category);
    if (r === undefined) residByCategory.set(p.category, [residuals[i]!]);
    else r.push(residuals[i]!);
    const ratio = p.mcap_usd! / p.tvl_usd;
    const list = ratiosByCategory.get(p.category);
    if (list === undefined) ratiosByCategory.set(p.category, [ratio]);
    else list.push(ratio);
  });
  const byCategory = new Map<string, CategoryFit>();
  for (const [category, list] of residByCategory) {
    const count = list.length;
    byCategory.set(category, {
      peers: count,
      median_multiple: median(ratiosByCategory.get(category)!),
      offset_log10: (count / (count + model.offset_shrink)) * median(list),
    });
  }
  return {
    peers: n,
    intercept,
    slope,
    r_squared: rSquared,
    resid_q25: quantile(sortedResid, 0.25),
    resid_q75: quantile(sortedResid, 0.75),
    global_median_multiple: median(peers.map((p) => p.mcap_usd! / p.tvl_usd)),
    byCategory,
  };
}

/** A protocol's curve reading: the fitted value at its size, its category's offset, and its band. */
export function curveValue(
  p: SnapshotProtocol,
  fit: CurveFit,
): { value: number; multiple: number; offset: number; peers: number; medianMultiple: number | null } {
  const group = p.category === null ? undefined : fit.byCategory.get(p.category);
  const offset = group === undefined ? 0 : group.offset_log10;
  const value = Math.pow(10, fit.intercept + fit.slope * Math.log10(Math.max(p.tvl_usd, 1)) + offset);
  return {
    value,
    multiple: value / Math.max(p.tvl_usd, 1),
    offset: Math.pow(10, offset),
    peers: group === undefined ? 0 : group.peers,
    medianMultiple: group === undefined ? null : group.median_multiple,
  };
}

/**
 * The three launched peers in the protocol's own category nearest to it in log-TVL, and the comps
 * value their median market-cap-per-TVL multiple puts on the protocol's TVL. Peers with no
 * category match fall back to the three nearest launched peers of any category.
 */
export function nearestComps(p: SnapshotProtocol, snapshot: Snapshot): { peers: CompPeer[]; inCategory: boolean; medianMultiple: number | null; compsValue: number | null } {
  const launched = snapshot.protocols.filter((q) => q.mcap_usd !== null && q.mcap_usd > 0 && q.tvl_usd > 0 && q.slug !== p.slug);
  const sameCategory = launched.filter((q) => p.category !== null && q.category === p.category);
  const inCategory = sameCategory.length >= COMPS_PEERS;
  const pool = inCategory ? sameCategory : launched;
  const target = Math.log10(Math.max(p.tvl_usd, 1));
  const nearest = [...pool]
    .sort((a, b) => Math.abs(Math.log10(a.tvl_usd) - target) - Math.abs(Math.log10(b.tvl_usd) - target) || (a.slug < b.slug ? -1 : 1))
    .slice(0, COMPS_PEERS)
    .map((q) => ({
      slug: q.slug,
      name: q.name,
      tvl_usd: q.tvl_usd,
      mcap_usd: q.mcap_usd!,
      multiple: round4(q.mcap_usd! / q.tvl_usd),
    }));
  if (nearest.length === 0) return { peers: [], inCategory, medianMultiple: null, compsValue: null };
  const med = median(nearest.map((q) => q.multiple));
  return { peers: nearest, inCategory, medianMultiple: round4(med), compsValue: Math.round(med * p.tvl_usd) };
}

/** The full pricing of one protocol: curve, momentum, seasoning, breadth, band, comps. */
export function impliedValue(
  p: SnapshotProtocol,
  asOf: string,
  fit: CurveFit,
  snapshot: Snapshot,
  model: ModelConstants,
): {
  implied: number;
  curveValueUsd: number;
  curveMultiple: number;
  offset: number;
  peers: number;
  medianMultiple: number | null;
  momentum: number;
  seasoning: number;
  breadth: number;
  age: number | null;
  changeUsd: number | null;
  bandLow: number;
  bandHigh: number;
  comps: { peers: CompPeer[]; inCategory: boolean; medianMultiple: number | null; compsValue: number | null };
} {
  const age = ageDays(asOf, p.listed_at);
  const curve = curveValue(p, fit);
  const growth = p.change_7d === null ? 0 : Math.min(model.growth_cap, Math.max(model.growth_floor, p.change_7d));
  const momentum = 1 + model.momentum_rate * growth;
  const seasonAge = age ?? model.unknown_age_days;
  const seasoning = model.season_base + model.season_range * (1 - Math.exp(-Math.max(seasonAge, 0) / model.season_tau_days));
  const chainCount = Math.max(p.chains.length, 1);
  const breadth = 1 + Math.min(model.breadth_cap, model.breadth_rate * (Math.log(chainCount) / Math.log(2)));
  const implied = Math.max(1, Math.round(curve.value * momentum * seasoning * breadth));
  const changeUsd = p.change_7d === null ? null : Math.round((p.tvl_usd * p.change_7d) / 100);
  return {
    implied,
    curveValueUsd: Math.round(curve.value),
    curveMultiple: curve.multiple,
    offset: curve.offset,
    peers: curve.peers,
    medianMultiple: curve.medianMultiple,
    momentum,
    seasoning,
    breadth,
    age,
    changeUsd,
    bandLow: Math.max(1, Math.round(implied * Math.pow(10, fit.resid_q25))),
    bandHigh: Math.round(implied * Math.pow(10, fit.resid_q75)),
    comps: nearestComps(p, snapshot),
  };
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 2_000_000_000) return 500;
  if (p.tvl_usd >= 500_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 150;
  if (p.tvl_usd >= 25_000_000) return 100;
  return 50;
}

/** The network fee a first position costs on a chain, in dollars and in words. */
function gasFor(chain: string): { usd: number; text: string } {
  if (chain === 'Ethereum') return { usd: 10, text: 'about $10 of gas' };
  if (chain === 'Solana') return { usd: 1, text: 'under $1 of network fees' };
  if (chain === 'Bitcoin') return { usd: 4, text: 'about $4 of miner fees' };
  return { usd: 3, text: 'about $3 of gas' };
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 60;
  if (age < 180) return 90;
  if (age < 365) return 60;
  if (age < 730) return 45;
  return 30;
}

/** The fees a week of light, real use costs: the figure the plan's weekly step quotes. */
const WEEKLY_FEE_USD = 2;

/** The plan's totals: derived from the same figures its steps quote, so text and totals agree. */
export function planTotals(p: SnapshotProtocol, age: number | null): PlanTotals {
  const capital = capitalFor(p);
  const gas = gasFor(chainOf(p)).usd;
  const hold = holdDaysFor(age);
  const weeks = Math.ceil(hold / 7);
  return {
    capital_usd: capital,
    setup_cost_usd: capital + gas,
    weekly_cost_usd: WEEKLY_FEE_USD,
    hold_days: hold,
    total_cost_usd: capital + gas + weeks * WEEKLY_FEE_USD,
  };
}

/** The category's core position: the one action that makes a wallet a real user of the protocol. */
function positionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Supply $${capital} of USDC to ${name} on ${chain}, then borrow no more than $${Math.round(capital / 4)} against it so the wallet both lends and borrows`;
  }
  if (c.includes('curator') || c.includes('allocator')) {
    return `Deposit $${capital} into one of ${name}'s curated vaults on ${chain} and hold the vault shares in the same wallet`;
  }
  if (c.includes('restak') || c.includes('staking')) {
    return `Stake $${capital} of the base asset through ${name} on ${chain} and keep the staking receipt unspent in the wallet`;
  }
  if (c.includes('perpetual') || c.includes('derivative')) {
    return `Deposit $${capital} of USDC as margin on ${name} and hold one small hedged position open across the week`;
  }
  if (c.includes('rwa')) {
    return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} after its onboarding check and hold the asset`;
  }
  if (c.includes('stable') || c.includes('basis')) {
    return `Mint $${capital} of the stable asset through ${name} on ${chain} by depositing USDC, and hold the minted balance`;
  }
  if (c.includes('insurance')) {
    return `Buy $${capital} of cover from ${name} on ${chain} for one month and keep the policy receipt in the wallet`;
  }
  if (c.includes('payment')) {
    return `Route one real payment of about $${capital} through ${name} on ${chain} to a second wallet you control`;
  }
  if (c.includes('dex') || c.includes('governance')) {
    return `Swap $${capital} through ${name} on ${chain} and leave $${Math.round(capital / 2)} of liquidity in its main pool`;
  }
  if (c.includes('yield')) {
    return `Deposit $${capital} into ${name}'s main vault on ${chain} and leave auto-compounding switched on`;
  }
  if (c.includes('chain')) {
    return `Bridge $${capital} to ${chain} and run one transaction a week there: a swap, a mint or a name registration`;
  }
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open and untouched`;
}

/** The weekly habit that keeps the wallet qualifying, in the category's own verbs. */
function cadenceFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'repay a slice of the borrow and draw it again, or top the supply up by a few dollars';
  if (c.includes('dex') || c.includes('yield') || c.includes('curator') || c.includes('allocator')) return 'add a few dollars to the position or harvest and restake the rewards';
  if (c.includes('perpetual') || c.includes('derivative')) return 'adjust the hedge once so the position history shows a living trader, not a deposit';
  if (c.includes('chain')) return 'run one small transaction on the chain: a swap, a mint or a domain renewal';
  if (c.includes('payment')) return 'send one small payment through the app to your second wallet';
  return 'repeat the core action once, in a small size, so the week shows real use';
}

/** The second chain a multi-chain protocol's farmer should also touch, or null. */
function secondChainFor(p: SnapshotProtocol): string | null {
  return p.chains.length > 1 ? p.chains[1]! : null;
}

/**
 * A protocol's farm plan: eight steps, each an action with a cost and a time, derived from the
 * protocol's own record (category, chains, TVL, age) and never from a hand-written list of names.
 * The totals the dashboard shows beside the plan come from planTotals on the same figures.
 */
export function farmPlan(p: SnapshotProtocol, age: number | null): string[] {
  const chain = chainOf(p);
  const second = secondChainFor(p);
  const totals = planTotals(p, age);
  const capital = totals.capital_usd;
  const gas = gasFor(chain).text;
  const hold = totals.hold_days;
  const steps = [
    `Start with a fresh wallet funded only with the $${capital} you mean to farm plus fee money, and keep its seed phrase offline and never typed into a site. Cost: ${gas} to fund it. Time: 10 minutes.`,
    `${positionFor(p, capital, chain)}. Cost: $${capital} of capital and ${gas}. Time: 20 minutes to set up carefully.`,
    second === null
      ? `Use the protocol's own app once from a second address you control, so the activity is not a single wallet's deposit. Cost: about $${WEEKLY_FEE_USD} of fees. Time: 10 minutes.`
      : `Repeat the core position in a small size on ${second}, the protocol's second chain, so the wallet's footprint covers more than one chain. Cost: about $${Math.round(capital / 5)} of capital and ${gas}. Time: 15 minutes.`,
    `Once a week, ${cadenceFor(p)}. Cost: about $${WEEKLY_FEE_USD} of fees a week, less on ${chain === 'Ethereum' ? 'a cheaper chain' : chain}. Time: 10 minutes a week.`,
    `Hold the position at least ${hold} days without emptying it, so the wallet appears in more than one weekly snapshot of the protocol's users. Cost: the $${capital} stays committed and carries the protocol's own risk. Time: ${hold} days.`,
    `Check ${p.name}'s own app and announcements for a points or rewards page monthly, and claim only from links the protocol itself publishes. Cost: nothing to check; never pay anyone to claim for you. Time: 10 minutes a month.`,
    `If ${p.name} issues a token, claim from the protocol's own page within the first week and sell or stake only after reading its vesting terms. Cost: one claim transaction, ${gas}. Time: 15 minutes on claim day.`,
    `Keep a farm log with the wallet address, every date, amount and transaction hash, and unwind the position the week the protocol's campaign or season ends. Cost: about $${totals.total_cost_usd} all-in over ${hold} days. Time: 5 minutes a week.`,
  ];
  return steps.map((s) => (s.length > 600 ? `${s.slice(0, 596)}...` : s));
}

/**
 * A row's risk notes: facts its own record implies, each phrased so a reader can act on it.
 * At least two notes are always produced, so no row reads as risk-free.
 */
export function riskNotes(p: SnapshotProtocol, age: number | null, peerCount: number): string[] {
  const notes: string[] = [];
  if (p.chains.length <= 1) {
    notes.push(`Single-chain exposure: all $${p.tvl_usd.toLocaleString('en-US')} of TVL sits on ${chainOf(p)}, so a chain outage or a bridge exploit hits the whole position at once.`);
  } else {
    notes.push(`Multi-chain spread: TVL is counted across ${p.chains.length} chains (${p.chains.slice(0, 3).join(', ')}${p.chains.length > 3 ? ', and more' : ''}), so no single chain carries the whole position.`);
  }
  if (p.change_7d !== null && p.change_7d < -10) {
    notes.push(`TVL fell ${Math.abs(p.change_7d).toFixed(1)}% in seven days (about $${Math.abs(Math.round((p.tvl_usd * p.change_7d) / 100)).toLocaleString('en-US')}), so deposits are leaving faster than they arrive; farm small until the outflow stops.`);
  } else if (p.change_7d !== null && p.change_7d > 30) {
    notes.push(`TVL jumped ${p.change_7d.toFixed(1)}% in seven days, so the protocol is hot right now and the farm window may be crowded; expect points to dilute as more wallets arrive.`);
  } else if (p.change_7d === null) {
    notes.push(`No seven-day TVL change is reported, so momentum cannot be read from this snapshot; treat the implied value as a size-only estimate and check the protocol's own figures.`);
  } else {
    notes.push(`TVL moved ${p.change_7d >= 0 ? '+' : ''}${p.change_7d.toFixed(1)}% in seven days, a steady reading with no rush in or out.`);
  }
  if (age !== null && age < 180) {
    notes.push(`Young listing: DefiLlama began tracking ${p.name} only ${age} days ago, so the protocol has little history of surviving a downturn or an audit cycle.`);
  } else if (age === null) {
    notes.push(`No listing date is recorded, so the protocol's age cannot be read from this snapshot; the model scores it at a middling 300 days instead of guessing.`);
  } else if (age >= 1095) {
    notes.push(`Seasoned listing: ${age} days on record, so the protocol has survived more than one market cycle without issuing a token.`);
  }
  if (p.tvl_usd < 10_000_000) {
    notes.push(`Micro size: $${p.tvl_usd.toLocaleString('en-US')} of TVL is small enough that one large depositor leaving moves the protocol's numbers and its implied value with it.`);
  }
  if (peerCount < 3) {
    notes.push(`Thin category evidence: only ${peerCount} launched ${p.category ?? 'uncategorised'} peer${peerCount === 1 ? '' : 's'} backs the category offset, so the curve value rests mostly on the global fit, not on the category.`);
  }
  return notes;
}

/** The board's rows, strongest first, with ranks 1..n: the whole pre-token universe, priced. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const fit = fitCurve(snapshot, model);
  const watch = new Set(snapshot.watchlist);
  const scored = snapshot.protocols
    .filter((p) => isRadarCandidate(p))
    .map((p) => ({ p, tier: (watch.has(p.slug) ? 'watchlist' : 'radar') as 'watchlist' | 'radar', ...impliedValue(p, snapshot.as_of, fit, snapshot, model) }));
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : 1));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    change_7d_usd: s.changeUsd,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    tier: s.tier,
    age_days: s.age,
    implied_value_usd: s.implied,
    band: valueBand(s.implied),
    band_low_usd: s.bandLow,
    band_high_usd: s.bandHigh,
    model: {
      curve_value_usd: s.curveValueUsd,
      curve_multiple: round4(s.curveMultiple),
      category_offset: round4(s.offset),
      peer_count: s.peers,
      peer_median_multiple: s.medianMultiple === null ? null : round4(s.medianMultiple),
      momentum_factor: round4(s.momentum),
      seasoning_factor: round4(s.seasoning),
      breadth_factor: round4(s.breadth),
      age_days: s.age,
    },
    comps: {
      peers: s.comps.peers,
      in_category: s.comps.inCategory,
      median_multiple: s.comps.medianMultiple,
      comps_value_usd: s.comps.compsValue,
    },
    plan: planTotals(s.p, s.age),
    risks: riskNotes(s.p, s.age, s.peers),
    farm_steps: farmPlan(s.p, s.age),
  }));
}

/** The launched protocols, by market cap, for the dashboard's Already trading view and fit table. */
export function liveRows(snapshot: Snapshot, fit: CurveFit): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => {
      const fitted = p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 ? curveValue(p, fit).value : null;
      return {
        slug: p.slug,
        name: p.name,
        symbol: p.symbol,
        category: p.category,
        chains: p.chains,
        tvl_usd: p.tvl_usd,
        mcap_usd: p.mcap_usd,
        multiple: p.tvl_usd > 0 && p.mcap_usd !== null ? round4(p.mcap_usd / p.tvl_usd) : null,
        fitted_value_usd: fitted === null ? null : Math.round(fitted),
        vs_curve_pct: fitted === null || fitted <= 0 ? null : Math.round(((p.mcap_usd! - fitted) / fitted) * 100),
        change_7d: p.change_7d,
      };
    });
}

/** The category evidence table the dashboard shows: peers, comps median, and the curve offset. */
export function peerGroups(fit: CurveFit): PeerGroup[] {
  return [...fit.byCategory.entries()]
    .map(([category, g]) => ({ category, peers: g.peers, median_multiple: round4(g.median_multiple), offset_multiple: round4(Math.pow(10, g.offset_log10)) }))
    .sort((a, b) => b.peers - a.peers || (a.category < b.category ? -1 : 1));
}

/** Everything the dashboard renders, from the snapshot. `boardSha256` seals page to board. */
export function buildRadar(snapshot: Snapshot, boardSha256 = '', model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const fit = fitCurve(snapshot, model);
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot, fit);
  const preToken = snapshot.protocols.filter((p) => isPreToken(p)).length;
  const bandCounts = new Map<string, number>();
  for (const r of board) bandCounts.set(r.band, (bandCounts.get(r.band) ?? 0) + 1);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    fit: {
      peers: fit.peers,
      intercept: round4(fit.intercept),
      slope: round4(fit.slope),
      r_squared: round4(fit.r_squared),
      resid_q25: round4(fit.resid_q25),
      resid_q75: round4(fit.resid_q75),
      band_factor_low: round4(Math.pow(10, fit.resid_q25)),
      band_factor_high: round4(Math.pow(10, fit.resid_q75)),
      global_median_multiple: round4(fit.global_median_multiple),
    },
    bands: VALUE_BANDS.map((b) => ({ id: b.id, label: b.label, rows: bandCounts.get(b.id) ?? 0 })),
    protocols_size: snapshot.protocols.length,
    pre_token_size: preToken,
    excluded_size: preToken - board.length,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    radar_size: board.filter((r) => r.tier === 'radar').length,
    live_size: live.length,
    board_implied_total_usd: board.reduce((sum, r) => sum + r.implied_value_usd, 0),
    board_sha256: boardSha256,
    rows: board,
    live,
    peers: peerGroups(fit),
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, bands, steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `the board holds ${board.length} rows, under the gate's 100`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value: a board that ranks nothing by value is not a ranking`;
  }
  const seen = new Set<string>();
  for (const r of board) {
    if (seen.has(r.slug)) return `${r.slug} appears twice`;
    seen.add(r.slug);
    if (r.band_low_usd > r.implied_value_usd || r.band_high_usd < r.implied_value_usd) return `${r.slug} has a band that misses its own implied value`;
    if (r.comps.peers.length < 1) return `${r.slug} names no comparables peer`;
    if (r.risks.length < 2) return `${r.slug} carries fewer than 2 risk notes`;
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
      if (!t.includes('Cost:') || !t.includes('Time:')) return `${r.slug} has a farm step without a cost and a time`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
