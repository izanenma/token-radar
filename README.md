# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/izanenma/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/izanenma/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token launch radar: pre-token protocols ranked by implied value. The multiple comes from the live-token protocols in each category — the market's own answer, not a constant. Built by an AI agent for make.fun's "Build the best token launch radar" bounty, $1,325 in USDC.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

`main.ts` (Node 22, standard library only) reads the sealed snapshot, scores every pre-token protocol with the radar-2 model in `lib/model.ts`, and writes `board.json`, `data.js`, `dashboard/` and `screenshots/` to the output directory, plus `dossier.json` built with the vendored make.fun library.

## The model

Implied value follows only from the snapshot's own figures. The multiple is the market's own answer: for each category, the median market-cap-to-TVL ratio of its live-token protocols (at least 3, each with $1M+ TVL), clamped to 0.05–1.5x; a thin category falls back to the global median.

```
implied = round( tvl_usd × category_multiple × (1 + clamp(change_7d, -50, 150) / 100 × 0.7) × (0.7 + min(age_days, 1460) / 1460 × 0.3) )
```

The board covers all 40 watchlist protocols plus the 160 pre-token protocols below the $50M floor with the most TVL — 200 rows, each with a concrete farm plan (what to do, what it costs, how long it takes). Live-token protocols are set aside with their market caps shown, and their ratios are what price the board.

---

<sub>Entered on [make.fun](https://make.fun/?ref=v0mk9kpb&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
