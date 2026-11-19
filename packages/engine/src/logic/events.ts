import { sortedEntries } from "../util/determinism.js";
import type { GameEvent, GameState, Visibility } from "../schema/index.js";

export interface NewEvent {
  type: string;
  visibility: Visibility;
  text: string;
  actor?: string | undefined;
  target?: string | undefined;
  /** Required for "private"; derived from actor/target when omitted. */
  audience?: string[];
  data?: GameEvent["data"];
}

/**
 * Append an event to the draft state's log. Assigns seq and turn.
 * Audience rules:
 *   public  -> [] (everyone)
 *   hidden  -> [] (no one until revealAll)
 *   coalition -> every nation on the actor's side (actor itself if it is a split-theater side)
 *   private -> the given audience, else actor + target
 */
export function emitEvent(state: GameState, e: NewEvent): GameEvent {
  const event: GameEvent = {
    seq: state.nextEventSeq,
    turn: state.turn,
    type: e.type,
    visibility: e.visibility,
    audience: audienceFor(state, e),
    data: e.data ?? {},
    text: e.text,
  };
  if (e.actor !== undefined) event.actor = e.actor;
  if (e.target !== undefined) event.target = e.target;
  state.nextEventSeq += 1;
  state.events.push(event);
  return event;
}

function audienceFor(state: GameState, e: NewEvent): string[] {
  switch (e.visibility) {
    case "public":
    case "hidden":
      return [];
    case "coalition": {
      const side = e.actor !== undefined ? state.nations[e.actor]?.side : undefined;
      if (side === undefined) return [];
      return sortedEntries(state.nations)
        .filter(([, n]) => n.side === side)
        .map(([id]) => id);
    }
    case "private": {
      const ids = e.audience ?? [e.actor, e.target].filter((x): x is string => x !== undefined);
      return [...new Set(ids)].sort();
    }
  }
}
