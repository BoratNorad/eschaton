import { resolve } from "node:path";
import { loadContent } from "../../../tools/load-content.js";
import {
  createGame, indexContent, makeContext, type Bindings, type ContentBundle, type EvalContext, type GameState, type Scenario,
} from "../src/index.js";

const DATA_DIR = resolve(import.meta.dirname, "../../../data");

export function loadBundle(): ContentBundle {
  const { bundle, errors } = loadContent(DATA_DIR);
  if (errors.length > 0) throw new Error(errors.join("\n"));
  return bundle;
}

export const bundle = loadBundle();
export const index = indexContent(bundle);

export function scenario(id = "indpak_1999"): Scenario {
  const s = index.scenarios.get(id);
  if (!s) throw new Error(`no scenario ${id}`);
  return s;
}

export function newGame(seed = 1): GameState {
  return createGame(bundle, scenario(), seed);
}

/** A context over a fresh game with RNG enabled. */
export function ctxFor(state: GameState, bindings: Bindings = {}, source = "test_source"): EvalContext {
  return makeContext(index, state, state.rng, source, bindings);
}

export function readOnlyCtx(state: GameState, bindings: Bindings = {}): EvalContext {
  return makeContext(index, state, undefined, "test_source", bindings);
}
