import type { Country, DerivedStats, Profile, Treaty } from "./types.js";
export declare const FORMULA_VERSION = "1.2";
export declare const BLOC_CBW_CAP = 12;
export declare const CBW_TOKEN_CAP_PER_COUNTRY = 6;
export declare const BALLS_CAP = 60;
export declare const REACH_UNIT_M = 12.5;
export declare const TREATIES: Treaty[];
/** Round half up, as documented in the dossier. */
export declare const rhu: (x: number) => number;
export declare function ballsFor(W: number): number;
export declare function derive(c: Country, profile: Profile): DerivedStats;
