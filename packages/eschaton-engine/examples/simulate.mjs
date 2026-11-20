// Plays a short scripted CURRENT-profile exchange and prints the log and tally.
// Run: npm run demo
import fs from "node:fs";
import { parseLedger, verifyLedger, createGame, launch, playCbw, endTurn, activeCombatant, tally } from "../dist/index.js";

const L = parseLedger(fs.readFileSync(new URL("../data/eschaton_ledger.json", import.meta.url), "utf8"));
console.log("ledger", L.meta.formula_version, "verify:", verifyLedger(L).length ? "MISMATCH" : "clean");

let s = createGame(L, "CURRENT", { include: ["AMNAT", "RUSCSTO", "REDCHI"] });
const centre = (id) => ({ x: s.countries[id].x, y: s.countries[id].y });
const step = (fn) => { const r = fn(); s = r.state; console.log(JSON.stringify(r.shot ?? r.record)); s = endTurn(s); };

step(() => launch(s, { combatant: activeCombatant(s), origin: "USA", target: "RUS", landing: centre("RUS") }));
step(() => launch(s, { combatant: activeCombatant(s), origin: "RUS", target: "ITA", landing: centre("ITA") })); // destroys 4 staged
step(() => playCbw(s, { combatant: activeCombatant(s), targetCombatant: "AMNAT" }));
step(() => launch(s, { combatant: activeCombatant(s), origin: "DEU", fromStaged: true, target: "BLR",
                       landing: { x: centre("BLR").x + 2, y: centre("BLR").y + 2 } }));      // a miss
console.table(tally(s));
