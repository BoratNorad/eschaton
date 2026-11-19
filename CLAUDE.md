# ESCHATON

Browser-based strategic command game. Players lead nations in seven coalitions
(AMNAT, SOVWAR, REDCHI, INDPAK, IRLIBSYR, SOUTHAF, LATAM) through Cold War-era
crises, at each nation's historical WMD peak. It has simultaneous turns (WEGO), deep hidden
mechanics, social diplomacy in multiplayer, and strong AI opponents in single-player.

The design source is the "ESCHATON: Peak-Tension Nation & Leader Compendium" doc.
When content in `/data` disagrees with the compendium, ask before changing either.

## Repo layout

```
packages/engine/      Pure simulation. No I/O, no DOM, no network. Runs in browser, server and tools.
  src/schema/         Zod schemas: the single source of truth for every type
  src/content/        ContentBundle type + cross-reference validation
  src/rng.ts          The ONLY randomness source (sfc32, state lives in GameState)
  src/util/           Determinism helpers (pairKey, sortedEntries, hashState)
  src/api.ts          The Engine interface: createGame, resolveTurn, legalOrders, viewFor, revealAll
packages/server/      (planned) Node + Colyseus. Authoritative engine host, lobbies, chat, AI seat-fill
packages/client/      React UI + PixiJS map. The engine runs in a Web Worker (src/worker/session.ts holds
                      the only GameState); the UI thread gets PlayerViews, menus and names only
packages/ai/          (planned) Utility AI driven by leader stats; headless harness
data/                 Game content as JSON, one object per file, file name = id
tools/                Node-only scripts (fs allowed here, never in the engine)
```

## Commands

```
npm run typecheck        tsc, strict
npm run validate         parse every /data file with its schema, then check all cross-references
npm run build:distances  regenerate greatCircleKm tables in /data/maps (commit the result)
npm run test             vitest
npm run check            all of the above; run before finishing any task
npm run dev              hotseat client (Vite dev server)
npm run e2e              build the client and play 3 hotseat turns in headless Chromium
```

## Hard rules for the engine (packages/engine)

These protect determinism. Multiplayer sync, replays, forking and AI search all
break silently if any of them is violated.

1. **Pure functions only.** No `fs`, `fetch`, `Date`, `performance`, `console` in engine code, and no
   globals or module-level mutable state.
2. **No `Math.random()`.** All randomness goes through `src/rng.ts` using `state.rng`.
   Each roll consumes draws in a fixed order. Never roll inside a conditional
   whose branch depends on iteration order.
3. **Integers only in state.** Probabilities are basis points (0-10000), shares are
   percent (0-100), stats are 1-10. No floats, no `Math.sin/cos/exp/pow` in
   simulation code. Geography math happens at build time in `tools/`.
4. **Stable iteration.** Never use `Object.entries/keys/values` or `for...in` on
   state records in engine logic; use `sortedEntries()`. Process nations, triggers
   and orders in sorted id order.
5. **Never mutate inputs.** `resolveTurn` deep-clones the input state once
   (`structuredClone`), mutates the draft, and returns it.
6. **Content is read-only.** State refers to content by id. Never copy content
   objects into state except the fields `NationState` already declares.
7. **Fog of war is enforced server-side.** Clients receive only `viewFor()` output.
   Never add a field to `PlayerView` that leaks hidden values (true warhead counts
   of others, covert sites, `sincere` on signals, hidden events).

## Turn resolution order (fixed; changing it is a design decision, ask first)

1. Validate each `OrderSet` with the `checkOrderSet` rules (`legalOrders` is only a menu); drop illegal orders with a private event.
2. Diplomacy: treaty proposals, signatures, withdrawals, ceasefires.
3. Posture: alerts, mobilization, investments, intel focus.
4. Movement: deployments.
5. Strikes: resolve all strikes simultaneously from start-of-phase positions.
6. Proliferation pipelines and covert-violation detection rolls.
7. Triggers, in sorted id order: check `when`, cooldown and `maxFires`, roll `chanceBp`, apply effects.
8. Non-state actors: spawn checks, ladder attempts.
9. Tension upkeep: pressure decay, level changes, misperception (PAR) rolls.
10. Intel updates: refresh `beliefs`.
11. Phase transitions, then victory checks.
12. Expire modifiers and unlocked actions; increment `turn`.

## Content rules (/data)

- One JSON object per file. File name equals `id` (coalitions use their uppercase id: `INDPAK.json`).
- Ids are lowercase snake_case and **globally unique** across all content kinds, including
  metros, sites, regions and delivery systems. Disambiguate with a suffix: `hyderabad_in`, `hyderabad_pk`.
- Single source of truth: treaty membership lives only in `treaties/*.json` `parties`.
  Never add a treaty list to a nation file.
- Every leader has an `alias` (fictional analogue). Public builds show aliases by default;
  historical names appear only with the `useHistoricalNames` setting.
- Leader `profile` text describes documented decision-making behavior. No medical
  or psychiatric claims about real people.
- Numbers are approximate public estimates. Mark uncertain values in `notes`.
- New mechanics referenced by `traits` or `specialRules` need a handler in
  `src/traits/` (registered in `registry.ts`) plus a test. Unknown trait ids, wrong scope
  and bad params fail validation. Trait hooks run at fixed points (end of step 5, start
  of step 9, and as chance adjusters in steps 4 and 7) and never draw from the RNG.
- After any content change, run `npm run validate`.

## Content safety boundary

WMD systems are **abstract game numbers**: warhead counts, tonnages, ranges and
0-10 ratings, plus broad agent classes (`blister`, `nerve`...). Never add real-world
technical detail: no synthesis or production methods, no agent-specific properties,
no weapon design or yield engineering data, no dispersal or weaponization specifics,
and no operational detail about real attacks beyond what an encyclopedia summary
gives. If a mechanic seems to need such detail, abstract it into a rating instead.
The same applies to non-state actors: model capability as ladder steps with
failure rates, never as instructions.

## Schema changes

- Edit the Zod schema first; types come from `z.infer`, never hand-written duplicates
  (the only exceptions are the recursive `Condition` and `Effect` types in `logic.ts`,
  which must be kept in sync with their schemas by hand).
- Adding a `Condition` or `Effect` kind means updating `logic.ts`, its evaluator,
  `collectConditionRefs`/`collectEffectRefs` in `content/references.ts`, and tests.
- Any change to `GameState` bumps `SCHEMA_VERSION` and adds a migration in
  `src/migrations/` so saved games and replays still load.
- Objects are `.strict()`: unknown keys are errors, which catches content typos.

## Testing

- **Golden replays:** fixed seed + fixed order sets → the `hashState` after N turns
  must equal a committed value. Any change that moves a golden hash must be intentional
  and noted in the commit message. Regenerate with `UPDATE_GOLDEN=1 npx vitest run golden`.
- **Determinism:** run the same game twice in one process and compare hashes every turn.
- **Content:** `npm run validate` in CI; negative fixtures in `packages/engine/test/fixtures/bad/` must fail.
- **Balance harness (packages/ai):** run 1,000+ headless AI-vs-AI games per scenario
  and report win rates, game length, and the share of games reaching tension level 5
  and nuclear use. Target for INDPAK: nuclear use in under 15% of games.

## Build plan (vertical slices; finish each end to end before starting the next)

1. **Engine core for `indpak_1999`** ← current slice
   - `createGame`, `resolveTurn` steps 1-12, `Condition`/`Effect` evaluators, `viewFor`
   - Golden replay and determinism tests
   - Minimal hotseat client: map, tension ladder, order panel, event feed
2. AI opponent (utility scores weighted by leader stats; crisis lookahead) + balance harness
3. Server: Colyseus rooms, lobbies, chat channels (public, coalition, private), AI seat-fill,
   reconnection, async and timed turns; deploy to Render (web service + static site + Postgres)
4. Remaining coalitions, campaign phases, proliferation, non-state actors
5. Replays with fog lifted, fork-from-turn, scenario editor, spectating

## Deployment (Render)

- `packages/client` → Render static site. `packages/server` → Render web service
  (WebSockets). Postgres for accounts, saves, replays (store order logs + seed,
  not full states: replays are re-simulated).
- Use a paid instance for the game server; free instances spin down when idle
  and would drop live matches.
- Secrets come from Render environment variables. Never commit keys.

## Conventions

- TypeScript strict, ESM, `.js` extensions in relative imports.
- No `any`. Prefer discriminated unions and exhaustive `switch` with a `never` check.
- Small files, one concept each. Engine functions take `(content, state, ...)` explicitly.
- Prose in UI text: short sentences, plain words.
