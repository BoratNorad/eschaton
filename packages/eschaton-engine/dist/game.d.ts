import type { Ledger, Profile } from "./types.js";
export interface Point {
    x: number;
    y: number;
}
export interface CountryState {
    id: string;
    name: string;
    combatant: string;
    x: number;
    y: number;
    r: number;
    reach: number;
    secondStrike: boolean;
    restraint: number;
    homeBalls: number;
    struck: boolean;
    hitsTaken: number;
}
export interface StagedStock {
    host: string;
    provider: string;
    combatant: string;
    reach: number;
    count: number;
}
export interface Combatant {
    id: string;
    bloc: string;
    name: string;
    color: string;
    members: string[];
    cbwStock: number;
    cbwUsedOnTurn: number | null;
    restraintPenalty: number;
}
export interface ShotRecord {
    turn: number;
    combatant: string;
    origin: string;
    fromStaged: boolean;
    target: string;
    landing: Point;
    hit: string | null;
    friendly: boolean;
    stagedDestroyed: number;
}
export interface CbwRecord {
    turn: number;
    combatant: string;
    target: string;
    cancelledFrom: string;
    fromStaged: boolean;
}
export interface GameState {
    profile: Profile;
    formulaVersion: string;
    turn: number;
    order: string[];
    active: number;
    combatants: Record<string, Combatant>;
    countries: Record<string, CountryState>;
    staged: StagedStock[];
    shots: ShotRecord[];
    cbw: CbwRecord[];
}
export interface GameOptions {
    /** Combatant ids to include; default all. Non-listed countries stay on the map as neutral zones. */
    include?: string[];
    /** Turn order; default ledger bloc order, then NONALIGN members alphabetically. */
    order?: string[];
    /** Skip combatants with no balls, no staged balls and no CBW stock when advancing turns. Default true. */
    skipIdle?: boolean;
}
export declare class RuleError extends Error {
    rule: string;
    constructor(rule: string, message: string);
}
/** Build a match. The profile cannot change afterwards (H-01). */
export declare function createGame(L: Ledger, profile: Profile, opts?: GameOptions): GameState;
export declare const activeCombatant: (s: GameState) => string;
/** Total balls a combatant still holds: home balls of members plus its staged balls (H-02, H-11). */
export declare function ballsRemaining(s: GameState, combatant: string): number;
/** True if the combatant has anything it could still do: launch a ball or spend a CBW token (H-12). */
export declare function canAct(s: GameState, combatant: string): boolean;
/** Countries the given launch point may target (H-04 reach, H-10 no allied targets). */
export declare function legalTargets(s: GameState, combatant: string, origin: string, fromStaged?: boolean): string[];
/** The zone a landing point strikes (H-03): first bounce inside a zone circle; nearest centre wins on overlap. */
export declare function zoneAt(s: GameState, p: Point): string | null;
export interface LaunchInput {
    combatant: string;
    origin: string;
    fromStaged?: boolean;
    target: string;
    landing: Point;
}
/** Launch one ball. `target` is what the player aimed at (checked against H-04/H-10); `landing` is where the
 *  ball's first bounce actually landed, measured by the client or the court-side game master (H-03). */
export declare function launch(state: GameState, a: LaunchInput): {
    state: GameState;
    shot: ShotRecord;
};
export interface CbwInput {
    combatant: string;
    targetCombatant: string;
    fromCountry?: string;
}
/** Spend one CBW token to cancel one unlaunched ball of a targeted combatant, once per turn (H-06, H-12).
 *  If `fromCountry` is omitted the ball comes from the target member holding the most home balls,
 *  then from its largest staged stock. The spender loses 1 RESTRAINT. */
export declare function playCbw(state: GameState, a: CbwInput): {
    state: GameState;
    record: CbwRecord;
};
/** Hand the turn to the next combatant that can still act. */
export declare function endTurn(state: GameState, skipIdle?: boolean): GameState;
/** True when no included combatant can launch or spend CBW. */
export declare const isOver: (s: GameState) => boolean;
/** Mean member RESTRAINT minus CBW penalties: the H-07 tie-break value. */
export declare function meanRestraint(s: GameState, combatant: string): number;
export interface TallyRow {
    combatant: string;
    hitsDelivered: number;
    hitsTaken: number;
    friendlyHits: number;
    zonesStruck: number;
    ballsRemaining: number;
    meanRestraint: number;
    score: number;
}
/** PLACEHOLDER tally. The canon (C-05) says a game master tallies results through statistical indices but
 *  does not define them. This default scores enemy hits delivered minus hits taken, with ties broken by
 *  mean RESTRAINT (H-07). Replace `score` with the game's own indices. */
export declare function tally(s: GameState): TallyRow[];
