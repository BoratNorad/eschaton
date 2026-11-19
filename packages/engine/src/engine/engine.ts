import type { Engine } from "../api.js";
import { createGame } from "./createGame.js";
import { legalOrders } from "./legalOrders.js";
import { resolveTurn } from "./resolveTurn.js";
import { revealAll, viewFor } from "./viewFor.js";

/** The engine behind the public contract in api.ts. */
export const engine: Engine = { createGame, resolveTurn, legalOrders, viewFor, revealAll };
