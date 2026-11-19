# indpak_1999: balance baseline and tuning proposal

Status: **proposal, not applied.** `rules.ts` and `/data` are unchanged. Every
number below can be reproduced with `npm run balance` and the `--set` flags shown.

## Baseline (1,000 AI-vs-AI games)

Full table: [indpak_1999-baseline.md](indpak_1999-baseline.md).

- **Nuclear use 27.5%**, target under 15%. Every first use is Pakistan's.
- War (level 4) in 91% of games, WMD threshold (level 5) in 81%.
- Kargil fires in 92% of games, the Parliament attack in 73%.
- India wins 68.5%, Pakistan 11.6%. Pakistan ends at stability 11 on average.
- Only 1.4% of games end in a nuclear exchange: Pakistan strikes, India rarely
  retaliates (see AI limitations).

### Why

1. **Kargil is near-certain.** 400 bp per turn, plus 150 bp from the
   stability-instability paradox, over 48 turns. It jumps tension two levels,
   straight to Conventional war, so nearly every game starts its war early.
2. **War is sticky.** Climbing down needs 6 fully quiet turns at zero pressure;
   once both sides posture, that rarely happens.
3. **Pakistan's regime collapses in long wars.** India's army rating (80 vs 55)
   wins most assaults; each lost region costs Pakistan 5 stability and trips its
   territory red line. Stability below 30 trips the political red line. Each red
   line lowers ESC by 2, which opens Pakistan's nuclear gate.

## Experiments (400 games each, seeds 1-400)

All rows except the baseline include K+C: `--set triggers.kargil_infiltration.chanceBp=100 --set rules.quietTurnsBeforeDeescalate=4 --set rules.pressureDecay=8`.

| Experiment | Nuclear | War (4) | Level 5 | India win | Pakistan win | Pakistan loss | Assaults | PK stability |
|---|---|---|---|---|---|---|---|---|
| Baseline | 27.0% | 91.5% | 80.8% | 71.5% | 11.0% | 62.5% | 19.0 | 11 |
| Kargil 100 bp only | 17.2% | 67.8% | 54.0% | 83.0% | 36.2% | 46.8% | 13.5 | 36 |
| Faster calm only (quiet 4, decay 8) | 23.2% | 88.0% | 77.5% | 68.0% | 14.8% | 54.8% | 18.2 | 15 |
| K+C | 16.0% | 61.8% | 49.0% | 80.8% | 43.0% | 38.5% | 12.1 | 42 |
| **K+C, capture shock -5 -> -2** | **12.2%** | 62.5% | 49.8% | 85.8% | 42.0% | 44.0% | 12.3 | 42 |
| K+C, assaults only at level 4 | 8.0% | 25.8% | 22.8% | 93.0% | 75.0% | 18.2% | 5.7 | 75 |
| K+C, both | 6.5% | 25.8% | 23.8% | 94.5% | 74.8% | 19.8% | 5.8 | 75 |

Both sides can win the same game (each has its own victory condition), so win
columns can add up to more than 100%.

## Proposal

**Recommended: K+C plus capture shock -2** (nuclear 12.2%, meets the target).

| Change | From | To | Where |
|---|---|---|---|
| Kargil chance per turn | 400 bp | 100 bp | `data/triggers/kargil_infiltration.json` (content) |
| Quiet turns before tension steps down | 6 | 4 | `RULES.quietTurnsBeforeDeescalate` |
| Pressure decay per quiet turn | 5 | 8 | `RULES.pressureDecay` |
| Stability lost per captured region | -5 | -2 | `RULES.captureStabilityShock` |

It keeps crises common (war in about 60% of games, level 5 in half), which suits
a scenario built around Kargil and the 2001-02 standoff, and roughly quadruples
Pakistan's chances.

**Stronger alternative: assaults only at level 4.** Nuclear use falls to 8%,
but war drops to 26% of games and both sides "win" three games in four. That
looks too calm for this scenario; keep it in reserve.

## Open questions for you

1. **Kargil is content.** 100 bp still fires in about 70% of games (the paradox
   adds 150). Historically it happened once in this window. Is "likely but not
   certain" the intent, or should it be rarer still?
2. **India wins too easily** in every variant (68-95%). Its victory condition
   (hold Kashmir, stability 40+) is far easier than Pakistan's (25+ warheads and
   stability 35+ after 48 turns of pressure). That is a scenario design question,
   not a rules number.
3. **One-sided nuclear use rarely ends the game.** `mutual_catastrophe` needs a
   nuclear exchange; when only Pakistan fires, play continues. Should any
   nuclear use end the scenario?

## AI limitations that affect these numbers

These are AI behaviors, not rules. Fixing them will move the numbers again, so
the target should be re-checked after each.

- **India rarely retaliates.** Nuclear release needs alert 2 or lower; the AI does
  not pre-position its alert when the threat grows, so after a Pakistani strike it
  often cannot answer the same turn. That understates deterrence and mutual loss.
- **The rival model is simple.** In lookahead the AI assumes the rival follows a
  few fixed rules from its public stats. A smarter model would likely make both
  sides more cautious.
- **Plans, not full search.** The AI scores seven whole-turn plans. It never
  combines, for example, a ceasefire offer with an assault.

## Reproduce

```bash
npm run balance -- --games 1000
npm run balance -- --games 400 --label proposed \
  --set triggers.kargil_infiltration.chanceBp=100 \
  --set rules.quietTurnsBeforeDeescalate=4 --set rules.pressureDecay=8 \
  --set rules.captureStabilityShock=-2
```

Seeds are 1..N, so the same flags give the same numbers.
