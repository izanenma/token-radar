// Token Radar's entry point (Node 22, standard library only).
//
// What it does, in order:
//   1. Reads the sealed snapshot (DefiLlama's protocol index as of 2026-11-14) from
//      /input/snapshot.json, or from --input <file|dir> when you run it by hand.
//   2. Scores every pre-token protocol with the radar-2 model in lib/model.ts. The multiple is
//      read off the live-token protocols in each category, never chosen by hand.
//   3. Writes the ranked board to /output/board.json and the dashboard's dataset to
//      /output/data.js, copies dashboard/ and screenshots/ into /output, and finishes with
//      /output/dossier.json, the summary the judge reads, built with the vendored make.fun
//      library in vendor/makefun-board.ts.
//   4. Refuses to write a board the gate would refuse, and says why, before writing anything.
//
// The program runs twice in grading and both runs must write the same bytes: there is no clock,
// no randomness and no network anywhere in it.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));

// The scorer's own caps, from the bounty rules: the text cap shapes the dossier's bytes, the
// screenshot caps refuse an image past them, and the name rule refuses a bad file name.
const DOSSIER_TEXT_MAX_BYTES = 65_536;
const SHOTS = { max: 4, max_bytes: 524_288 };
const DASHBOARD = { max_files: 400, max_bytes: 4_194_304 };
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function fail(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(1);
}

/** The value after `--name value` or `--name=value` on the command line, or the fallback. */
function flag(name: string, fallback: string): string {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === `--${name}` && i + 1 < argv.length) return argv[i + 1]!;
    if (a.startsWith(`--${name}=`)) return a.slice(name.length + 3);
  }
  return fallback;
}

/** The snapshot file behind `--input <snapshot.json|directory>`, defaulting to /input. */
function snapshotPath(): string {
  const given = flag('input', '/input');
  return given.endsWith('.json') ? given : join(given, 'snapshot.json');
}

/** Where this run writes, from --output or MAKEFUN_OUTPUT_DIR, defaulting to /output. */
function outputDir(): string {
  return resolve(flag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output'));
}

/** The regular files of one directory, copied into another, skipping dotfiles. */
function copyPlainFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const source = join(from, name);
    if (!statSync(source).isFile()) continue;
    copyFileSync(source, join(to, name));
    copied.push(name);
  }
  return copied;
}

const inputFile = snapshotPath();
if (!existsSync(inputFile)) {
  fail(`no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input`);
}
const out = outputDir();

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`);

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

const dashboardFiles = copyPlainFiles(join(repoRoot, 'dashboard'), join(out, 'dashboard'));
const shots = copyPlainFiles(join(repoRoot, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  fail(`screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`);
}
const badName = shots.find((name) => !SHOT_NAME.test(name));
if (badName !== undefined) fail(`screenshots/${badName}: a name is letters, digits and . _ -, 1 to 128 characters`);

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: DOSSIER_TEXT_MAX_BYTES, screenshots: SHOTS, dashboard: DASHBOARD }));

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (${dashboardFiles.length} files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
