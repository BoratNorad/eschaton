# eschaton-engine

The ESCHATON rules engine and ledger loader, built from the Combatant Dossier ledger
(formula_version 1.2). It is TypeScript with no runtime dependencies, and it runs in the
browser and in Node 20+.

```
data/eschaton_ledger.json     the ledger (48 countries, both profiles, blocs, map, rules)
data/eschaton_ledger.sha256   SHA-256 of the exact ledger bytes
src/types.ts                  ledger types
src/derive.ts                 the stat formulas (port of ledger.py), with constants
src/ledger.ts                 parseLedger, verifyLedger, loadLedger, joinSegs, sha256Hex
src/game.ts                   createGame and the actions that enforce rules H-01 to H-13
dist/                         compiled ES modules and .d.ts files (committed, so no build step is required)
test/engine.test.mjs          17 tests: data integrity, formula parity, and every house rule
examples/simulate.mjs         a scripted exchange that prints a log and a tally
```

`npm test` compiles and runs the tests. `npm run demo` plays the example.

## Using it

```ts
import { loadLedger, createGame, launch, playCbw, endTurn, activeCombatant,
         legalTargets, tally, isOver } from "eschaton-engine";

const L = await loadLedger("/eschaton_ledger.json", EXPECTED_SHA);   // fetch + hash + structure + stat recompute
let s = createGame(L, "CURRENT");                                    // profile is fixed for the match (H-01)

const me = activeCombatant(s);                                       // e.g. "AMNAT"
legalTargets(s, me, "USA");                                          // what USA may aim at (H-04, H-10)
s = launch(s, { combatant: me, origin: "USA", target: "RUS",
                landing: { x: 38.9, y: 4.0 } }).state;               // landing = first bounce, metres (H-03)
s = endTurn(s);
```

Every action returns a new state plus an event (`shot` or `record`) and leaves its input unchanged.
An illegal action throws `RuleError`, and its `.rule` field names the rule it broke (`"H-05"`, `"TURN"`, and so on).

### Coordinates

All positions are in metres on the 50.54 x 24.94 m field, with the origin at the top left,
x running east and y running south. That is the same frame the dossier map uses
(`ledger.map`, and each country's `eschaton.zone.x_m / y_m / radius_m`). The four courts
are listed in `ledger.map.courts`, so the renderer can draw them directly.

### State, for the server and the UI

`GameState` is plain JSON:
- `countries`: each country's zone, combatant, REACH, second-strike flag, home balls, and whether it has been struck.
- `combatants`: each combatant's members, CBW stock and restraint penalty.
- `staged`: hosted balls, by host and provider.
- `shots` and `cbw`: the action logs.

Send it to clients as-is. For multiplayer, keep the server authoritative: clients send a
`LaunchInput` or `CbwInput`, the server applies it with the engine and broadcasts the new
state. Where `landing` comes from is the game's choice. It can be the client's throw
physics, or a game master entering where the ball bounced on the real courts.

## How the rules map to code

| Rule | Where |
|---|---|
| H-01 profile fixed | `createGame(L, profile)`; `state.profile` |
| H-02 bloc allotment | `createGame` sets each member's `homeBalls` to its BALLS; `ballsRemaining` |
| H-03 hit = first bounce in a zone circle | `zoneAt`, used by `launch`; the nearest centre wins where zones overlap |
| H-04 REACH x 12.5 m, 4 = unlimited | `legalTargets`, checked in `launch` |
| H-05 struck zones need SECOND_STRIKE | `launch` |
| H-06 one CBW token per turn, -1 RESTRAINT | `playCbw` |
| H-07 tie-break on mean RESTRAINT | `meanRestraint`, used by `tally` |
| H-08 zone nudging | already applied in the ledger (`x_m`, `y_m`) |
| H-09 unretrieved = zeros | does not arise: all 48 countries are compiled |
| H-10 no allied fire; NONALIGN plays alone | `legalTargets`; NONALIGN becomes `NONALIGN:<ID>` combatants |
| H-11 staged balls in host zones | `createGame` builds `staged`; a strike on the host destroys them |
| H-12 CBW-only blocs | `canAct` counts CBW stock, so these blocs keep their turns |
| H-13 bloc CBW cap 12 | taken from `blocs[profile][].cbw_stock` |

### Interpretations the rules leave open

These are documented in code and easy to change:
- **CBW penalty.** The RESTRAINT penalty from H-06 applies to the spending combatant as a whole. It is subtracted from its mean.
- **Which ball a CBW token cancels.** By default it is one ball from the target member holding the most home balls, then from its largest staged stock. Pass `fromCountry` to choose.
- **Stray balls.** A ball that lands in a different zone than the one aimed at still strikes that zone. That includes allied zones, which are recorded as `friendly` hits.
- **Excluded blocs.** With `include`, blocs left out of the match stay on the map as neutral zones that cannot be targeted.
- **Turn order.** Turns go round-robin in ledger bloc order. Combatants that can do nothing are skipped (`skipIdle`). There is no per-turn launch limit.

## Not defined by the dossier yet

- **Scoring.** Canon rule C-05 says a game master tallies results "through statistical indices", but no index is defined. `tally()` is a placeholder: enemy hits delivered minus hits taken, with ties broken by mean RESTRAINT. Replace `score` with the real indices.
- **Throw mechanics.** The engine takes a landing point; how a player produces one is the game's design.

## Updating the data

When the dossier kit (`eschaton_build_kit.zip`) is rebuilt:
1. Copy the new `eschaton_ledger.json` into `data/`.
2. Write its SHA-256 to `data/eschaton_ledger.sha256`.
3. Run `npm test`.

The parity test recomputes every stored stat in TypeScript. If the Python formulas changed,
the test fails until `src/derive.ts` and `FORMULA_VERSION` are updated to match.

## Licence note

The ledger's prose fields (narratives, summaries, event lines) are adapted from Wikipedia
under CC BY-SA 4.0, and a shipped game must carry that attribution. The stat fields are
derived numbers.
