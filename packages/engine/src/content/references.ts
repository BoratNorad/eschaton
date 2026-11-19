import type { Condition, Effect, SideRef } from "../schema/index.js";
import type { ContentBundle } from "./bundle.js";

// Cross-file checks that a single schema cannot do: every id must exist, be
// unique, and point at the right kind of thing. Returns human-readable errors.

const BINDINGS = new Set(["$self", "$actor", "$target", "$self_side", "$actor_side", "$target_side"]);

type Refs = { nations: string[]; sites: string[]; regions: string[]; treaties: string[]; sides: string[]; actors: string[] };

function emptyRefs(): Refs {
  return { nations: [], sites: [], regions: [], treaties: [], sides: [], actors: [] };
}

function addSide(refs: Refs, s: SideRef): void {
  if (!BINDINGS.has(s)) refs.sides.push(s);
}
function addNation(refs: Refs, n: string | undefined): void {
  if (n !== undefined && !BINDINGS.has(n)) refs.nations.push(n);
}

export function collectConditionRefs(c: Condition, refs: Refs = emptyRefs()): Refs {
  switch (c.kind) {
    case "all":
    case "any":
      c.of.forEach((x) => collectConditionRefs(x, refs));
      break;
    case "not":
      collectConditionRefs(c.cond, refs);
      break;
    case "tension_at_least":
      c.pair.forEach((s) => addSide(refs, s));
      break;
    case "stat_at_least":
    case "stat_at_most":
    case "metric_at_least":
    case "metric_at_most":
    case "member_of":
      addNation(refs, c.nation);
      break;
    case "event_occurred":
      addNation(refs, c.actor);
      addNation(refs, c.target);
      break;
    case "site_status":
      refs.sites.push(c.site);
      break;
    case "controls_region":
      addNation(refs, c.nation);
      refs.regions.push(c.region);
      break;
    case "treaty_status":
      addNation(refs, c.nation);
      refs.treaties.push(c.treaty);
      break;
    default:
      break;
  }
  return refs;
}

export function collectEffectRefs(e: Effect, refs: Refs = emptyRefs()): Refs {
  switch (e.kind) {
    case "raise_tension":
    case "lower_tension":
    case "add_pressure":
      e.pair.forEach((s) => addSide(refs, s));
      break;
    case "stat_roll":
      addNation(refs, e.nation);
      e.onPass.forEach((x) => collectEffectRefs(x, refs));
      e.onFail.forEach((x) => collectEffectRefs(x, refs));
      break;
    case "modify_stat":
    case "stability_shock":
    case "unlock_action":
    case "expose_program":
      addNation(refs, e.nation);
      break;
    case "emit_event":
      addNation(refs, e.actor);
      addNation(refs, e.target);
      break;
    case "violate_treaty":
      addNation(refs, e.nation);
      refs.treaties.push(e.treaty);
      break;
    case "reveal_site":
      refs.sites.push(e.site);
      break;
    case "sanction":
      addSide(refs, e.by);
      addNation(refs, e.against);
      break;
    case "spawn_actor":
      refs.actors.push(e.actor);
      break;
    default:
      break;
  }
  return refs;
}

// ----- Binding availability -------------------------------------------------
// Each place logic runs binds a fixed set of names. Using any other `$` ref
// would throw LogicError mid-game, so validation rejects it up front.

export type BindingName = "self" | "actor" | "target";

/** Every binding a condition uses ($x and $x_side both count as x). */
export function collectConditionBindings(c: Condition, out: Set<BindingName> = new Set()): Set<BindingName> {
  const use = (r: string | undefined) => addBinding(out, r);
  switch (c.kind) {
    case "all":
    case "any":
      c.of.forEach((x) => collectConditionBindings(x, out));
      break;
    case "not":
      collectConditionBindings(c.cond, out);
      break;
    case "tension_at_least":
      c.pair.forEach(use);
      break;
    case "stat_at_least":
    case "stat_at_most":
    case "metric_at_least":
    case "metric_at_most":
    case "member_of":
    case "controls_region":
    case "treaty_status":
      use(c.nation);
      break;
    case "event_occurred":
      use(c.actor);
      use(c.target);
      break;
    default:
      break;
  }
  return out;
}

export function collectEffectBindings(e: Effect, out: Set<BindingName> = new Set()): Set<BindingName> {
  const use = (r: string | undefined) => addBinding(out, r);
  switch (e.kind) {
    case "raise_tension":
    case "lower_tension":
    case "add_pressure":
      e.pair.forEach(use);
      break;
    case "stat_roll":
      use(e.nation);
      e.onPass.forEach((x) => collectEffectBindings(x, out));
      e.onFail.forEach((x) => collectEffectBindings(x, out));
      break;
    case "modify_stat":
    case "stability_shock":
    case "unlock_action":
    case "expose_program":
    case "violate_treaty":
      use(e.nation);
      break;
    case "emit_event":
      use(e.actor);
      use(e.target);
      break;
    case "sanction":
      use(e.by);
      use(e.against);
      break;
    default:
      break;
  }
  return out;
}

function addBinding(out: Set<BindingName>, ref: string | undefined): void {
  if (ref === undefined || !ref.startsWith("$")) return;
  out.add(ref.slice(1).replace(/_side$/, "") as BindingName);
}

function checkBindings(
  err: (where: string, msg: string) => void,
  where: string,
  used: Set<BindingName>,
  allowed: readonly BindingName[],
): void {
  const bound = allowed.length === 0 ? "nothing is bound" : `only ${allowed.map((a) => `$${a}`).join(", ")} bound`;
  for (const name of [...used].sort()) if (!allowed.includes(name)) err(where, `uses $${name}, but ${bound} here`);
}

export function validateReferences(b: ContentBundle): string[] {
  const errors: string[] = [];
  const err = (where: string, msg: string) => errors.push(`${where}: ${msg}`);

  // --- global id uniqueness -------------------------------------------------
  const seen = new Map<string, string>();
  const claim = (id: string, where: string) => {
    const prev = seen.get(id);
    if (prev !== undefined) err(where, `id "${id}" already used by ${prev}`);
    else seen.set(id, where);
  };
  for (const l of b.leaders) claim(l.id, `leader ${l.id}`);
  for (const t of b.treaties) claim(t.id, `treaty ${t.id}`);
  for (const t of b.triggers) claim(t.id, `trigger ${t.id}`);
  for (const p of b.pipelines) claim(p.id, `pipeline ${p.id}`);
  for (const a of b.nonstate) claim(a.id, `nonstate ${a.id}`);
  for (const m of b.maps) {
    claim(m.id, `map ${m.id}`);
    for (const r of m.regions) claim(r.id, `region ${r.id}`);
  }
  for (const s of b.scenarios) claim(s.id, `scenario ${s.id}`);
  for (const n of b.nations) {
    claim(n.id, `nation ${n.id}`);
    for (const m of n.metros) claim(m.id, `metro ${m.id} (${n.id})`);
    for (const s of n.sites) claim(s.id, `site ${s.id} (${n.id})`);
    for (const d of n.delivery) claim(d.id, `delivery ${d.id} (${n.id})`);
  }

  // --- lookup tables ----------------------------------------------------------
  const leaders = new Set(b.leaders.map((l) => l.id));
  const nations = new Map(b.nations.map((n) => [n.id, n]));
  const coalitions = new Map(b.coalitions.map((c) => [c.id, c]));
  const treaties = new Set(b.treaties.map((t) => t.id));
  const actors = new Set(b.nonstate.map((a) => a.id));
  const allSites = new Set(b.nations.flatMap((n) => n.sites.map((s) => s.id)));
  const allRegions = new Set(b.maps.flatMap((m) => m.regions.map((r) => r.id)));
  const sideIds = new Set<string>([
    ...b.coalitions.map((c) => c.id),
    ...b.nations.filter((n) => coalitions.get(n.coalition.id)?.splitTheater).map((n) => n.id),
  ]);

  const checkRefs = (where: string, refs: Refs) => {
    for (const n of refs.nations) if (!nations.has(n)) err(where, `unknown nation "${n}"`);
    for (const s of refs.sites) if (!allSites.has(s)) err(where, `unknown site "${s}"`);
    for (const r of refs.regions) if (!allRegions.has(r)) err(where, `unknown region "${r}"`);
    for (const t of refs.treaties) if (!treaties.has(t)) err(where, `unknown treaty "${t}"`);
    for (const a of refs.actors) if (!actors.has(a)) err(where, `unknown non-state actor "${a}"`);
    for (const s of refs.sides) {
      // A coalition id is always a valid side; a nation id only if its coalition is a split theater.
      if (!sideIds.has(s) && !/^[A-Z]+$/.test(s)) err(where, `"${s}" is not a side (coalition id or split-theater nation)`);
    }
  };

  // --- nations ----------------------------------------------------------------
  for (const n of b.nations) {
    const w = `nation ${n.id}`;
    if (!leaders.has(n.leaderId)) err(w, `unknown leader "${n.leaderId}"`);
    if (!coalitions.has(n.coalition.id)) err(w, `unknown coalition "${n.coalition.id}"`);
    if (n.coalition.parentNationId && !nations.has(n.coalition.parentNationId))
      err(w, `unknown parent nation "${n.coalition.parentNationId}"`);
    const metroIds = new Set(n.metros.map((m) => m.id));
    if (!metroIds.has(n.capitalMetroId)) err(w, `capitalMetroId "${n.capitalMetroId}" is not one of its metros`);
    if (n.metros.filter((m) => m.isCapital).length !== 1) err(w, "exactly one metro must have isCapital: true");
    for (const m of n.metros) if (!allRegions.has(m.regionId)) err(w, `metro ${m.id}: unknown region "${m.regionId}"`);
    const ownSites = new Set(n.sites.map((s) => s.id));
    for (const s of n.sites) {
      if (!allRegions.has(s.regionId)) err(w, `site ${s.id}: unknown region "${s.regionId}"`);
      if (s.hostsWeaponsOf && !nations.has(s.hostsWeaponsOf)) err(w, `site ${s.id}: unknown owner "${s.hostsWeaponsOf}"`);
    }
    for (const d of n.delivery)
      for (const sid of d.basingSiteIds) if (!ownSites.has(sid)) err(w, `delivery ${d.id}: basing site "${sid}" is not its own`);
    for (const h of n.hostedAbroad) {
      const host = nations.get(h.hostNationId);
      if (!host) err(w, `hostedAbroad: unknown host "${h.hostNationId}"`);
      else if (!host.sites.some((s) => s.id === h.siteId)) err(w, `hostedAbroad: "${h.siteId}" is not a site of ${host.id}`);
    }
    if (n.nuclear.warheads > 0 && !n.delivery.some((d) => d.payloads.includes("nuclear")))
      err(w, "has warheads but no nuclear-capable delivery system");
    for (const o of n.objectives) {
      checkRefs(`${w} objective ${o.id}`, collectConditionRefs(o.satisfiedWhen));
      checkBindings(err, `${w} objective ${o.id}`, collectConditionBindings(o.satisfiedWhen), ["self"]);
    }
    for (const d of n.conventional.deployments)
      if (!allRegions.has(d.regionId)) err(w, `deployment: unknown region "${d.regionId}"`);
  }

  // --- maps -------------------------------------------------------------------
  for (const m of b.maps) {
    const ids = new Set(m.regions.map((r) => r.id));
    for (const l of m.links) {
      if (!ids.has(l.from)) err(`map ${m.id}`, `link from unknown region "${l.from}"`);
      if (!ids.has(l.to)) err(`map ${m.id}`, `link to unknown region "${l.to}"`);
    }
    for (const r of m.regions)
      if (r.controller !== "none" && !nations.has(r.controller)) err(`map ${m.id}`, `region ${r.id}: unknown controller "${r.controller}"`);
  }

  // --- treaties, triggers, pipelines, non-state -----------------------------------
  for (const t of b.treaties) {
    for (const p of Object.keys(t.parties)) if (!nations.has(p)) err(`treaty ${t.id}`, `unknown party "${p}"`);
    for (const e of [...t.onSign, ...t.onViolation, ...t.onWithdrawal]) {
      checkRefs(`treaty ${t.id}`, collectEffectRefs(e));
      checkBindings(err, `treaty ${t.id}`, collectEffectBindings(e), ["actor"]);
    }
  }
  for (const t of b.triggers) {
    const w = `trigger ${t.id}`;
    if (t.pair) checkRefs(w, (() => { const r = emptyRefs(); t.pair!.forEach((s) => addSide(r, s)); return r; })());
    checkRefs(w, collectConditionRefs(t.when));
    for (const e of t.effects) checkRefs(w, collectEffectRefs(e));
    const bound: BindingName[] = [];
    if (t.bindings.actor) bound.push("actor");
    if (t.bindings.target) bound.push("target");
    const used = collectConditionBindings(t.when);
    for (const e of t.effects) collectEffectBindings(e, used);
    t.pair?.forEach((r) => addBinding(used, r));
    checkBindings(err, w, used, bound);
    if (t.bindings.actor && !nations.has(t.bindings.actor)) err(w, `binding actor: unknown nation "${t.bindings.actor}"`);
    if (t.bindings.target && !nations.has(t.bindings.target)) err(w, `binding target: unknown nation "${t.bindings.target}"`);
  }
  for (const p of b.pipelines) {
    const w = `pipeline ${p.id}`;
    if (p.supplier !== "market" && !nations.has(p.supplier)) err(w, `unknown supplier "${p.supplier}"`);
    for (const r of p.eligibleRecipients) if (!nations.has(r)) err(w, `unknown recipient "${r}"`);
    if (p.counterTreatyId && !treaties.has(p.counterTreatyId)) err(w, `unknown counter treaty "${p.counterTreatyId}"`);
    for (const e of p.onDetected) {
      checkRefs(w, collectEffectRefs(e));
      checkBindings(err, w, collectEffectBindings(e), ["actor", "target"]);
    }
  }
  for (const a of b.nonstate) {
    const w = `nonstate ${a.id}`;
    for (const r of a.operatingRegions) if (!allRegions.has(r)) err(w, `unknown region "${r}"`);
    checkRefs(w, collectConditionRefs(a.spawn.when));
    checkBindings(err, `${w} spawn`, collectConditionBindings(a.spawn.when), []);
    for (const e of a.attackEffects) {
      checkRefs(w, collectEffectRefs(e));
      checkBindings(err, w, collectEffectBindings(e), ["target"]);
    }
  }

  // --- scenarios --------------------------------------------------------------------
  for (const s of b.scenarios) {
    const w = `scenario ${s.id}`;
    const map = b.maps.find((m) => m.id === s.mapId);
    if (!map) err(w, `unknown map "${s.mapId}"`);
    const mapRegions = new Set(map?.regions.map((r) => r.id) ?? []);
    for (const c of s.coalitions) if (!coalitions.has(c)) err(w, `unknown coalition "${c}"`);
    for (const nid of s.nations) {
      const n = nations.get(nid);
      if (!n) { err(w, `unknown nation "${nid}"`); continue; }
      if (!s.coalitions.includes(n.coalition.id)) err(w, `nation ${nid} is in ${n.coalition.id}, which the scenario does not include`);
      for (const m of n.metros) if (map && !mapRegions.has(m.regionId)) err(w, `metro ${m.id} is in region ${m.regionId}, not on map ${s.mapId}`);
      for (const st of n.sites) if (map && !mapRegions.has(st.regionId)) err(w, `site ${st.id} is in region ${st.regionId}, not on map ${s.mapId}`);
    }
    for (const id of s.treaties) if (!treaties.has(id)) err(w, `unknown treaty "${id}"`);
    for (const id of s.triggers) if (!b.triggers.some((t) => t.id === id)) err(w, `unknown trigger "${id}"`);
    for (const id of s.pipelines) if (!b.pipelines.some((p) => p.id === id)) err(w, `unknown pipeline "${id}"`);
    for (const id of s.nonStateActors) if (!actors.has(id)) err(w, `unknown non-state actor "${id}"`);
    for (const h of s.humanSeats) if (!s.nations.includes(h)) err(w, `human seat "${h}" is not a scenario nation`);
    for (const t of s.initialTensions) {
      checkRefs(w, (() => { const r = emptyRefs(); t.pair.forEach((x) => addSide(r, x)); return r; })());
      const used = new Set<BindingName>();
      t.pair.forEach((x) => addBinding(used, x));
      checkBindings(err, `${w} initialTensions`, used, []);
    }
    for (const p of s.phaseTransitions) {
      checkRefs(w, collectConditionRefs(p.when));
      checkBindings(err, `${w} phase transition to ${p.to}`, collectConditionBindings(p.when), []);
    }
    for (const v of s.victory) {
      checkRefs(`${w} victory ${v.id}`, collectConditionRefs(v.when));
      checkBindings(err, `${w} victory ${v.id}`, collectConditionBindings(v.when), []);
    }
  }

  return errors;
}
