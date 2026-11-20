export type Profile = "PEAK" | "CURRENT";
export type Segs = string[];
export type ProgramStatus = "NONE_DOCUMENTED" | "RESEARCH_ABANDONED" | "FORMER_DISMANTLED" | "FORMER_TRANSFERRED" | "SUSPECTED" | "ACTIVE_UNACKNOWLEDGED" | "ACTIVE_ACKNOWLEDGED";
export type TreatyStatus = "PARTY" | "SIGNATORY_NOT_RATIFIED" | "NON_PARTY" | "WITHDRAWN" | "NOT_APPLICABLE" | "UNKNOWN";
export type Treaty = "NPT" | "CTBT" | "BWC" | "CWC" | "TPNW";
export type RangeClass = "NONE" | "SHORT" | "MEDIUM" | "INTERMEDIATE" | "INTERCONTINENTAL";
export interface Program {
    status: ProgramStatus | null;
    peak_status?: ProgramStatus;
    start_year: number | null;
    end_year: number | null;
    summary: Segs | string | null;
    confidence: "HIGH" | "MEDIUM" | "LOW" | null;
}
export interface Figure {
    value: number | null;
    year: number | null;
    attribution: Segs | string | null;
}
export interface DerivedStats {
    W: number;
    BALLS: number;
    REACH: number;
    CAP_N: number;
    CAP_B: number;
    CAP_C: number;
    CAP_R: number;
    RESTRAINT: number;
    RESTRAINT_points: number;
    RESTRAINT_applicable: number;
    SECOND_STRIKE: boolean;
    CBW_TOKENS: number;
    STAGED: number;
}
export interface ProfileBlock extends DerivedStats {
    bloc: string;
    bloc_justification: Segs;
    bloc_provenance: string;
}
export interface Zone {
    lat: number;
    lon: number;
    radius_m: number;
    x_m: number;
    y_m: number;
    x_proj_m: number;
    y_proj_m: number;
    size_class: string;
    nudged: boolean;
}
export interface Country {
    id: string;
    name: string;
    retrieval: {
        status: "OK" | "PARTIAL" | "UNRETRIEVED";
        source_urls: string[];
        accessed: string;
    };
    programs: Record<"nuclear" | "biological" | "chemical" | "radiological", Program>;
    stockpile: {
        nuclear_warheads: Figure & {
            low?: number | null;
            high?: number | null;
            note?: Segs | string | null;
        };
        nuclear_warheads_peak: Figure;
        chemical_declared_tonnes: {
            value: number | null;
            year: number | null;
            status: string | null;
        };
    };
    delivery: Record<string, boolean | RangeClass | null> & {
        max_range_class: RangeClass | null;
        sea_ballistic: boolean;
    };
    sharing: {
        nuclear_sharing_host: boolean;
        hosted_by: string[];
        provider_to: string[];
        hosted_warheads?: {
            value: number | null;
            low: number | null;
            high: number | null;
            year: number | null;
        };
    };
    treaties: Record<Treaty, TreatyStatus>;
    narrative: Segs | string;
    eschaton: {
        formula_version: string;
        PEAK: ProfileBlock;
        CURRENT: ProfileBlock;
        zone: Zone;
    };
    [k: string]: unknown;
}
export interface BlocDef {
    code: string;
    name: string;
    canon: boolean;
    color_hex: string;
    pattern: string;
    members: string[];
    cbw_tokens_sum: number;
    cbw_stock: number;
}
export interface Rule {
    id: string;
    text: Segs;
}
export interface Ledger {
    meta: {
        formula_version: string;
        country_count: number;
        profiles: Profile[];
        compiled_at: string;
        [k: string]: unknown;
    };
    rules: {
        canon: Rule[];
        house: Rule[];
    };
    blocs: Record<Profile, BlocDef[]>;
    map: {
        field_w_m: number;
        field_h_m: number;
        courts: {
            x: number;
            y: number;
            w: number;
            h: number;
        }[];
        gap_m: number;
        [k: string]: unknown;
    };
    countries: Country[];
}
