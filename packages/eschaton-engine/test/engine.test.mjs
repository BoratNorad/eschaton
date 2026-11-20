import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  parseLedger, verifyLedger, sha256Hex, createGame, launch, playCbw, endTurn, legalTargets,
  ballsRemaining, canAct, activeCombatant, zoneAt, tally, isOver, meanRestraint, RuleError, REACH_UNIT_M,
} from "../dist/index.js";

const text = fs.readFileSync(new URL("../data/eschaton_ledger.json", import.meta.url), "utf8");
const L = parseLedger(text);
const centre = (s, id) => ({ x: s.countries[id].x, y: s.countries[id].y });
const at = (s, id) => ({ ...s, active: s.order.indexOf(id) }); // jump the turn pointer for a focused test

test("ledger bytes match the shipped SHA-256", async () => {
  const want = fs.readFileSync(new URL("../data/eschaton_ledger.sha256", import.meta.url), "utf8").trim();
  assert.equal(await sha256Hex(text), want);
});

test("every stored stat and bloc CBW stock recomputes in TypeScript (parity with ledger.py)", () => {
  assert.deepEqual(verifyLedger(L), []);
});

test("H-02: bloc allotments match the dossier totals", () => {
  const peak = createGame(L, "PEAK");
  assert.equal(ballsRemaining(peak, "AMNAT"), 95);
  assert.equal(ballsRemaining(peak, "SOVWAR"), 100);
  const cur = createGame(L, "CURRENT");
  assert.equal(ballsRemaining(cur, "AMNAT"), 52);
  assert.equal(ballsRemaining(cur, "RUSCSTO"), 33);
});

test("H-10: NONALIGN members become one-country combatants", () => {
  const s = createGame(L, "PEAK");
  assert.ok(s.combatants["NONALIGN:IND"]);
  assert.ok(!s.combatants.NONALIGN);
  assert.deepEqual(s.combatants["NONALIGN:IND"].members, ["IND"]);
});

test("H-13: CBW stock is capped at 12 per bloc", () => {
  const s = createGame(L, "PEAK");
  assert.equal(s.combatants.AMNAT.cbwStock, 12);
  assert.equal(s.combatants.SOVWAR.cbwStock, 11);
});

test("H-11: CURRENT staging moves provider balls into host zones", () => {
  const s = createGame(L, "CURRENT");
  const staged = Object.fromEntries(s.staged.map((x) => [x.host, x.count]));
  assert.deepEqual(staged, { BLR: 1, BEL: 2, DEU: 2, ITA: 4, NLD: 2, TUR: 2, GBR: 1 });
  assert.equal(s.countries.USA.homeBalls, 30 - 13);
  assert.equal(createGame(L, "PEAK").staged.length, 0);
});

test("H-04: limited REACH restricts targets; REACH 4 is unlimited", () => {
  const s = createGame(L, "PEAK");
  s.countries.PAK.reach = 1; // the ledger's REACH 2 (25 m) already covers the whole field from Pakistan
  const pak = s.countries.PAK;
  const targets = legalTargets(s, "AMNAT", "PAK");
  for (const t of targets) {
    const c = s.countries[t];
    assert.ok(Math.hypot(c.x - pak.x, c.y - pak.y) <= 1 * REACH_UNIT_M);
  }
  const enemies = Object.keys(s.countries).length - s.combatants.AMNAT.members.length;
  assert.ok(targets.length > 0 && targets.length < enemies);
  assert.equal(legalTargets(s, "AMNAT", "USA").length, enemies);
});

test("countries of excluded combatants are neutral and cannot be targeted", () => {
  const s = createGame(L, "PEAK", { include: ["AMNAT", "SOVWAR"] });
  const t = legalTargets(s, "AMNAT", "USA");
  assert.ok(t.includes("RUS") && !t.includes("CHN"));
});

test("H-10: allies cannot be targeted", () => {
  const s = createGame(L, "PEAK");
  assert.throws(() => launch(s, { combatant: "AMNAT", origin: "USA", target: "GBR", landing: centre(s, "GBR") }),
    (e) => e instanceof RuleError && e.rule === "H-10");
});

test("H-03: a hit needs the first bounce inside a zone circle", () => {
  const s = createGame(L, "PEAK");
  const hit = launch(s, { combatant: "AMNAT", origin: "USA", target: "RUS", landing: centre(s, "RUS") });
  assert.equal(hit.shot.hit, "RUS");
  assert.equal(hit.state.countries.RUS.struck, true);
  assert.equal(hit.state.countries.USA.homeBalls, 59);
  const miss = launch(s, { combatant: "AMNAT", origin: "USA", target: "RUS", landing: { x: -50, y: -50 } });
  assert.equal(miss.shot.hit, null);
  assert.equal(zoneAt(s, { x: -50, y: -50 }), null);
});

test("actions never mutate the input state", () => {
  const s = createGame(L, "PEAK");
  const before = JSON.stringify(s);
  launch(s, { combatant: "AMNAT", origin: "USA", target: "RUS", landing: centre(s, "RUS") });
  assert.equal(JSON.stringify(s), before);
});

test("H-05: a struck country launches again only with SECOND_STRIKE", () => {
  let s = createGame(L, "PEAK");
  s = launch(s, { combatant: "AMNAT", origin: "USA", target: "KAZ", landing: centre(s, "KAZ") }).state;
  s = launch(s, { combatant: "AMNAT", origin: "USA", target: "RUS", landing: centre(s, "RUS") }).state;
  s = at(s, "SOVWAR");
  assert.throws(() => launch(s, { combatant: "SOVWAR", origin: "KAZ", target: "USA", landing: centre(s, "USA") }),
    (e) => e.rule === "H-05");
  assert.equal(s.countries.RUS.secondStrike, true);
  assert.doesNotThrow(() => launch(s, { combatant: "SOVWAR", origin: "RUS", target: "USA", landing: centre(s, "USA") }));
});

test("H-11: striking a host before launch destroys its staged balls", () => {
  let s = at(createGame(L, "CURRENT"), "RUSCSTO");
  const r = launch(s, { combatant: "RUSCSTO", origin: "RUS", target: "ITA", landing: centre(s, "ITA") });
  assert.equal(r.shot.stagedDestroyed, 4);
  assert.equal(ballsRemaining(r.state, "AMNAT"), 52 - 4);
  s = createGame(L, "CURRENT");
  const st = launch(s, { combatant: "AMNAT", origin: "DEU", fromStaged: true, target: "BLR", landing: centre(s, "BLR") });
  assert.equal(st.shot.hit, "BLR");
  assert.equal(st.shot.stagedDestroyed, 1); // Russia's staged ball in Belarus is lost too
});

test("H-06: one CBW token per turn cancels a ball and costs 1 RESTRAINT", () => {
  let s = createGame(L, "PEAK");
  const before = meanRestraint(s, "AMNAT");
  const r = playCbw(s, { combatant: "AMNAT", targetCombatant: "SOVWAR" });
  assert.equal(r.record.cancelledFrom, "RUS");
  assert.equal(ballsRemaining(r.state, "SOVWAR"), 99);
  assert.equal(r.state.combatants.AMNAT.cbwStock, 11);
  assert.equal(meanRestraint(r.state, "AMNAT"), before - 1);
  assert.throws(() => playCbw(r.state, { combatant: "AMNAT", targetCombatant: "SOVWAR" }), (e) => e.rule === "H-06");
});

test("H-12: a bloc with no balls still takes turns and plays CBW", () => {
  let s = createGame(L, "PEAK");
  assert.equal(ballsRemaining(s, "IRLIBSYR"), 0);
  assert.ok(canAct(s, "IRLIBSYR"));
  while (activeCombatant(s) !== "IRLIBSYR") s = endTurn(s);
  const r = playCbw(s, { combatant: "IRLIBSYR", targetCombatant: "AMNAT" });
  assert.equal(ballsRemaining(r.state, "AMNAT"), 94);
});

test("idle combatants are skipped; turn number advances after a full round", () => {
  let s = createGame(L, "PEAK");
  const seen = [];
  for (let i = 0; i < 12; i++) { seen.push(activeCombatant(s)); s = endTurn(s); }
  assert.ok(!seen.includes("LATAM"));          // no balls, no CBW stock
  assert.ok(seen.includes("NONALIGN:IND"));
  assert.ok(s.turn >= 2);
});

test("a random full match terminates and produces a sorted tally", () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  let s = createGame(L, "CURRENT");
  for (let guard = 0; guard < 5000 && !isOver(s); guard++) {
    const me = activeCombatant(s);
    const c = s.combatants[me];
    const origins = [
      ...c.members.filter((m) => s.countries[m].homeBalls > 0 && (!s.countries[m].struck || s.countries[m].secondStrike)).map((m) => [m, false]),
      ...s.staged.filter((x) => x.combatant === me && x.count > 0).map((x) => [x.host, true]),
    ];
    if (origins.length) {
      const [o, staged] = origins[Math.floor(rnd() * origins.length)];
      const ts = legalTargets(s, me, o, staged);
      if (ts.length) {
        const t = ts[Math.floor(rnd() * ts.length)];
        const p = centre(s, t);
        s = launch(s, { combatant: me, origin: o, fromStaged: staged, target: t, landing: { x: p.x + (rnd() - 0.5) * 3, y: p.y + (rnd() - 0.5) * 3 } }).state;
      } else if (staged) {
        s.staged.find((x) => x.host === o && x.combatant === me).count = 0; // no reachable target: discard
      } else s.countries[o].homeBalls = 0;
    } else if (c.cbwStock > 0) {
      const foe = s.order.find((id) => id !== me && ballsRemaining(s, id) > 0);
      if (foe) s = playCbw(s, { combatant: me, targetCombatant: foe }).state;
      else c.cbwStock = 0;
    }
    s = endTurn(s);
  }
  assert.ok(isOver(s));
  const t = tally(s);
  for (let i = 1; i < t.length; i++) assert.ok(t[i - 1].score >= t[i].score);
});
