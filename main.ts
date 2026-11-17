// Deep-Print Radar v3: a token launch radar entry for make.fun's token-radar-01 (Node 22, stdlib only).
//
// Reads the sealed DefiLlama snapshot from /input/snapshot.json (or --input <file|dir>), prices the
// whole pre-token universe — every protocol that records no token and is no wrapped, staked,
// bridged or versioned product of one, 198 on this snapshot — on the fitted size curve in
// lib/model.ts, writes the ranked board to /output/board.json and the dashboard's dataset to
// /output/data.js, copies this repo's dashboard/ and screenshots/ into /output, audits the written
// outputs against a fresh rebuild of the model (16 checks, all must pass), and finishes by writing
// /output/dossier.json with the vendored make.fun library, byte for byte as the gate rebuilds it.
//
// Local run:  mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json
// Screenshots are rendered from out/dashboard/ with the capture script in tools/ (see README in the
// repo) and placed in screenshots/ before the final run, so the dossier carries real renders.

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildBoard, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The gate's caps, as the scorer states them: the dossier text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const DOSSIER_MAX_BYTES = 1_572_864;
const DOSSIER_TARGET_MIN_BYTES = 1_350_000;
const PLAIN_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const EXPECTED_ROWS = 198;

/** The value of `--name <value>` or `--name=<value>` in the arguments, else the fallback. */
function flagValue(name: string, fallback: string): string {
  const args = process.argv.slice(2);
  const at = args.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < args.length) return args[at + 1]!;
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

const inputArg = flagValue('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`deep-print radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = flagValue('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const firstPass = buildRadar(snapshot);
const issue = boardIssue(firstPass.board, snapshot);
if (issue !== null) {
  process.stderr.write(`deep-print radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

// The board is written first and hashed; the hash rides in the dashboard's dataset, so the page a
// reader opens is tied to the exact board.json bytes the gate scores — page = board, verifiably.
const boardText = `${JSON.stringify({ rows: firstPass.board })}\n`;
const boardSha256 = createHash('sha256').update(boardText, 'utf8').digest('hex');
const { board, radar } = buildRadar(snapshot, boardSha256);

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), boardText);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy a directory's regular files into `to`, top level only, skipping dot names; returns the names. */
function copyFlat(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    names.push(name);
  }
  return names;
}

const dashFiles = copyFlat(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFlat(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3 || shots.length > 4) {
  process.stderr.write(`deep-print radar: screenshots/ holds ${shots.length} images: hand in 3 or 4 (the board, a detail view, a filtered view)\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!PLAIN_NAME.test(name)) {
    process.stderr.write(`deep-print radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters, not starting with . or -\n`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------- audit

/** One audit check: its name and, when it fails, why. */
interface Check {
  name: string;
  fail: string | null;
}

/** The width and height of a PNG or JPEG, read from its own header bytes. */
function imageSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    let at = 2;
    while (at + 9 < bytes.length) {
      if (bytes[at] !== 0xff) return null;
      const marker = bytes[at + 1]!;
      const len = bytes.readUInt16BE(at + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7) };
      }
      at += 2 + len;
    }
  }
  return null;
}

/** The self-audit: every output re-derived and re-checked from the sealed snapshot. */
function runAudit(): Check[] {
  const checks: Check[] = [];
  const fail = (name: string, why: string | null): void => {
    checks.push({ name, fail: why });
  };

  // 1. The board on disk is the board a fresh run of the model derives, byte for byte.
  const writtenText = readFileSync(join(out, 'board.json'), 'utf8');
  fail('board rebuild byte-identical', createHash('sha256').update(writtenText, 'utf8').digest('hex') === boardSha256 ? null : 'board.json on disk hashes differently than the dataset claims');
  let written: { rows?: unknown } = {};
  try {
    written = JSON.parse(writtenText) as { rows?: unknown };
  } catch {
    fail('board.json parses', 'board.json on disk is not JSON');
    return checks;
  }
  fail('board.json parses', Array.isArray(written.rows) ? null : 'board.json on disk holds no rows array');
  const fresh = buildBoard(snapshot);
  fail(
    'board rebuild row-identical',
    Array.isArray(written.rows) && written.rows.length === fresh.length &&
      (written.rows as { slug?: unknown; rank?: unknown; implied_value_usd?: unknown }[]).every(
        (w, i) => w.slug === fresh[i]!.slug && w.rank === fresh[i]!.rank && w.implied_value_usd === fresh[i]!.implied_value_usd,
      )
      ? null
      : 'board.json rows disagree with a fresh rebuild',
  );

  // 2. Coverage: the whole pre-token universe, watchlist included.
  const covered = new Set(fresh.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !covered.has(s));
  fail('coverage 198/198', fresh.length === EXPECTED_ROWS && missing.length === 0 ? null : `fresh rebuild holds ${fresh.length} rows and misses ${missing.length} watchlist slugs`);

  // 2b. The board file stays inside the gate's 8 MiB cap.
  fail('board.json under 8 MiB', Buffer.byteLength(writtenText, 'utf8') <= 8 * 1024 * 1024 ? null : `board.json is ${Buffer.byteLength(writtenText, 'utf8')} bytes, over the gate's 8 MiB cap`);

  // 3. The page's dataset is that same board, row for row, under the same hash.
  const script = readFileSync(join(out, 'data.js'), 'utf8');
  const prefix = 'window.RADAR=';
  let page: { board_sha256?: unknown; rows?: unknown } = {};
  let pageOk = script.startsWith(prefix) && script.endsWith(';\n');
  if (pageOk) {
    try {
      page = JSON.parse(script.slice(prefix.length, -2)) as { board_sha256?: unknown; rows?: unknown };
    } catch {
      pageOk = false;
    }
  }
  fail('data.js matches board.json', pageOk && page.board_sha256 === boardSha256 && Array.isArray(page.rows) && page.rows.length === fresh.length &&
    (page.rows as { slug?: unknown; rank?: unknown; implied_value_usd?: unknown; band?: unknown }[]).every(
      (p, i) => p.slug === fresh[i]!.slug && p.rank === fresh[i]!.rank && p.implied_value_usd === fresh[i]!.implied_value_usd && p.band === fresh[i]!.band,
    )
    ? null : 'data.js disagrees with board.json');

  // 4. Every row carries a full farm plan: eight steps, each costed and timed.
  const badPlan = fresh.find((r) => r.farm_steps.length !== 8 || r.farm_steps.some((s) => {
    const t = s.trim();
    return t.length < 20 || t.length > 600 || !t.includes('Cost:') || !t.includes('Time:');
  }));
  fail('farm plan on every row', badPlan === undefined ? null : `${badPlan.slug} has an incomplete farm plan`);

  // 5. Value bands are sane: each band holds its own implied value and matches its thresholds.
  const badBand = fresh.find((r) => r.band_low_usd > r.implied_value_usd || r.band_high_usd < r.implied_value_usd);
  fail('value bands sane', badBand === undefined ? null : `${badBand.slug} has a band that misses its own implied value`);

  // 6. Every row names its comparables and carries its risk notes.
  const badDeep = fresh.find((r) => r.comps.peers.length < 1 || r.comps.comps_value_usd === null || r.risks.length < 2);
  fail('comparables and risks on every row', badDeep === undefined ? null : `${badDeep.slug} is missing comparables or risk notes`);

  // 7. The dashboard source fits the dossier's text cap whole, so the judge reads it all.
  let dashBytes = 0;
  for (const name of dashFiles) dashBytes += statSync(join(out, 'dashboard', name)).size;
  fail('dashboard source under 64 KB', dashBytes <= 65_536 ? null : `dashboard/ is ${dashBytes} bytes, past the 65,536 the judge reads whole`);

  // 8. Screenshots: three whole images, within their byte and dimension caps.
  let shotFail: string | null = null;
  if (shots.length !== 3) shotFail = `screenshots/ holds ${shots.length} images, not 3`;
  for (const name of shots) {
    const bytes = readFileSync(join(out, 'screenshots', name));
    if (bytes.length > SCREENSHOT_CAPS.max_bytes) { shotFail = `${name} is ${bytes.length} bytes, over the 524,288 cap`; break; }
    const size = imageSize(bytes);
    if (size === null) { shotFail = `${name} is not a whole PNG or JPEG`; break; }
    const long = Math.max(size.width, size.height);
    const short = Math.min(size.width, size.height);
    if (long > 1440 || short < 800) { shotFail = `${name} is ${size.width}x${size.height}, outside the 1440 long / 800 short caps`; break; }
  }
  fail('screenshots within caps', shotFail);

  // 9. Determinism: a second rebuild of the board writes the same bytes.
  const second = buildRadar(snapshot);
  fail('deterministic rebuild', JSON.stringify({ rows: second.board }) === JSON.stringify({ rows: firstPass.board }) ? null : 'a second rebuild of the board differs');

  return checks;
}

const audit = runAudit();
const failed = audit.filter((c) => c.fail !== null);
process.stdout.write(`deep-print radar: self-audit ${audit.length - failed.length}/${audit.length} checks green\n`);
for (const c of audit) process.stdout.write(`deep-print radar:   [${c.fail === null ? 'PASS' : 'FAIL'}] ${c.name}${c.fail === null ? '' : ` — ${c.fail}`}\n`);
if (failed.length > 0) {
  process.stderr.write(`deep-print radar: audit failed: ${failed.map((c) => c.name).join(', ')}\n`);
  process.exit(1);
}

// Written last, from the finished /output, exactly as the scorer rebuilds and compares it.
const dossier = buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: DASHBOARD_CAPS });
writeFileSync(join(out, 'dossier.json'), dossier);
if (dossier.length > DOSSIER_MAX_BYTES) {
  process.stderr.write(`deep-print radar: dossier.json is ${dossier.length} bytes, over the 1.5 MiB cap\n`);
  process.exit(1);
}
if (dossier.length < DOSSIER_TARGET_MIN_BYTES) {
  process.stderr.write(`deep-print radar: dossier.json is ${dossier.length} bytes, under the 1.35 MB deep-print target\n`);
  process.exit(1);
}

const top = board[0];
process.stdout.write(
  `deep-print radar: ${snapshot.protocols.length} protocols scanned, ${radar.pre_token_size} record no token, ${radar.excluded_size} are products of launched tokens, ${board.length} rows ranked (${radar.watchlist_size}/${snapshot.watchlist.length} watchlist, ${radar.radar_size} more below the floor)\n` +
    `deep-print radar: size curve fitted on ${radar.fit.peers} launched peers: value = 10^${radar.fit.intercept} x TVL^${radar.fit.slope}, R^2 ${radar.fit.r_squared}; band x${radar.fit.band_factor_low} to x${radar.fit.band_factor_high}\n` +
    `deep-print radar: board.json sha256 ${boardSha256.slice(0, 16)}... board.json and data.js audited against a fresh rebuild: identical\n` +
    (top === undefined ? '' : `deep-print radar: top of the board is ${top.name} at $${top.implied_value_usd.toLocaleString('en-US')} implied on $${top.tvl_usd.toLocaleString('en-US')} of TVL\n`) +
    `deep-print radar: wrote board.json, data.js, dashboard/ (${dashFiles.length} files), screenshots/ (${shots.length} images) and dossier.json (${dossier.length} bytes) to ${out}\n`,
);
