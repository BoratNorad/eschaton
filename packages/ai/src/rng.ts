import { seedRng, type RngState } from "@eschaton/engine";

/**
 * The AI's own random stream, derived from (game seed, turn, nation). It never
 * touches the game's state.rng, so a game with AI seats replays exactly from
 * its seed and order log, and AI choices do not shift the game's own dice.
 */
export function aiRng(gameSeed: number, turn: number, nationId: string): RngState {
  let h = 0x811c9dc5;
  const key = `${gameSeed >>> 0}:${turn}:${nationId}:ai`;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return seedRng(h);
}
