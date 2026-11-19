import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadContent } from "../../../tools/load-content.js";
import type { Order, OrderSet } from "@eschaton/engine";
import { prettify, Session } from "../src/worker/session.js";

const { bundle } = loadContent(resolve(import.meta.dirname, "../../../data"));

/** Every key that appears anywhere in a JSON value. */
function keysIn(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => keysIn(v, out));
  else if (value !== null && typeof value === "object")
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      keysIn(v, out);
    }
  return out;
}

/** GameState-only keys: if any shows up in a reply, state is leaking to the UI thread. */
const STATE_ONLY_KEYS = ["rng", "seed", "beliefs", "triggerFires", "leakagePool", "nextEventSeq", "pipelines", "nonState"];

/** A simple player: pick a few menu entries by position each turn. */
function pick(menu: { order: Order }[], turn: number): Order[] {
  return menu.filter((_, i) => (i + turn) % 37 === 0).slice(0, 6).map((m) => m.order);
}

describe("Session (the engine worker's core)", () => {
  it("runs hotseat turns: both seats submit, then the turn resolves", () => {
    const s = new Session(bundle, "indpak_1999");
    const start = s.newGame(7);
    expect(start.planning).toEqual(["india", "pakistan"]);
    expect(start.info.nations.map((n) => n.leaderAlias)).toEqual(["Prime Minister Devraj Anand", "General Rashid Kamal"]);

    const india = s.seat("india");
    const r1 = s.submit({ nationId: "india", turn: 0, orders: pick(india.menu, 0) });
    expect(r1).toEqual({ type: "submit", waitingFor: ["pakistan"] });
    expect(() => s.submit({ nationId: "india", turn: 0, orders: [] })).toThrow(/already submitted/);

    const r2 = s.submit({ nationId: "pakistan", turn: 0, orders: [] });
    expect(r2.resolved).toEqual({ turn: 1 });
    expect(s.planning()).toEqual(["india", "pakistan"]);
  });

  it("never sends GameState-only data or hidden events to the UI", () => {
    const s = new Session(bundle, "indpak_1999");
    const replies: unknown[] = [s.newGame(3)];
    for (let turn = 0; turn < 12 && s.planning().length > 0; turn++) {
      for (const id of s.planning()) {
        const seat = s.seat(id);
        replies.push(seat);
        const set: OrderSet = { nationId: id, turn, orders: pick(seat.menu, turn) };
        replies.push(s.check(set));
        replies.push(s.submit(set));
      }
    }
    for (const r of replies) {
      const keys = keysIn(r);
      for (const k of STATE_ONLY_KEYS) expect(keys.has(k), `reply contains "${k}"`).toBe(false);
      expect(JSON.stringify(r)).not.toContain('"visibility":"hidden"');
    }
  });

  it("does not name covert sites the viewer has not found", () => {
    const s = new Session(bundle, "indpak_1999");
    s.newGame(1);
    const pak = s.seat("pakistan");
    expect(pak.names.india_cw_depot).toBeUndefined();
    expect(pak.places.some((p) => p.id === "india_cw_depot")).toBe(false);
    expect(JSON.stringify(pak)).not.toContain("Undisclosed chemical depot");
    // India sees its own covert site.
    expect(s.seat("india").names.india_cw_depot).toBe("Undisclosed chemical depot");
  });

  it("labels every menu entry in plain words", () => {
    const s = new Session(bundle, "indpak_1999");
    s.newGame(1);
    const { menu } = s.seat("india");
    expect(menu.length).toBeGreaterThan(50);
    for (const m of menu) {
      expect(m.label).not.toMatch(/undefined|\[object/);
      expect(m.label).not.toMatch(/\b[a-z]+_[a-z_]+\b/); // no raw ids
    }
  });

  it("keeps the full log closed until the game ends", () => {
    const s = new Session(bundle, "indpak_1999");
    s.newGame(1);
    expect(() => s.reveal()).toThrow(/when the game ends/);
  });

  it("prettifies ids in event text", () => {
    const e = prettify(
      { seq: 0, turn: 0, type: "tension_changed", visibility: "public", audience: [], data: {}, text: "Tension india|pakistan: Incident -> Crisis." },
      { india: "India", pakistan: "Pakistan" },
    );
    expect(e.text).toBe("Tension India-Pakistan: Incident -> Crisis.");
  });
});
