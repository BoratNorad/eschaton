import { Application, Container, Graphics, Text } from "pixi.js";
import { useEffect, useRef, useState } from "react";
import type { PlayerView } from "@eschaton/engine";
import type { GameInfo, Place } from "../protocol.js";
import { SRI_LANKA_COAST, SUBCONTINENT_COAST } from "./coast.js";

// Schematic theater map. Regions are nodes at their display centroids, joined
// by movement links; a faint coastline sits underneath. Display-only floats are
// fine here: the client never feeds them back into the engine.

interface Props {
  info: GameInfo;
  view: PlayerView;
  places: Place[];
  selected: string | undefined;
  onSelect: (regionId: string) => void;
}

const BG = 0x0d1117;
const SEA_COLOR = 0x3b6ea5;
const COAST_COLOR = 0x5a7a99;
const LINK_LAND = 0x6b7785;
const LINK_SEA = 0x3b6ea5;

export function MapView(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const propsRef = useRef(props);
  const [ready, setReady] = useState(false);
  propsRef.current = props;

  useEffect(() => {
    let cancelled = false;
    const app = new Application();
    const el = host.current!;
    void app
      .init({ resizeTo: el, background: BG, antialias: true, resolution: window.devicePixelRatio || 1, autoDensity: true })
      .then(() => {
        if (cancelled) {
          app.destroy(true, { children: true });
          return;
        }
        el.appendChild(app.canvas);
        app.canvas.setAttribute("aria-label", "Theater map");
        app.renderer.on("resize", () => draw(app, propsRef.current));
        appRef.current = app;
        setReady(true);
      });
    return () => {
      cancelled = true;
      appRef.current?.destroy(true, { children: true });
      appRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (ready && appRef.current) draw(appRef.current, props);
  }, [ready, props.view, props.places, props.selected, props.info]);

  return <div className="map" ref={host} data-testid="map" />;
}

function draw(app: Application, p: Props): void {
  app.stage.removeChildren().forEach((c) => c.destroy({ children: true }));
  const w = app.screen.width;
  const h = app.screen.height;
  const project = projection(p.info, w, h);
  const color = (id: string | undefined) => {
    const hex = p.info.nations.find((n) => n.id === id)?.color;
    return hex ? parseInt(hex.slice(1), 16) : SEA_COLOR;
  };

  // Coastline
  const coast = new Graphics();
  for (const line of [SUBCONTINENT_COAST, SRI_LANKA_COAST]) {
    line.forEach(([lat, lon], i) => {
      const [x, y] = project(lat, lon);
      if (i === 0) coast.moveTo(x, y);
      else coast.lineTo(x, y);
    });
    coast.stroke({ width: 1.5, color: COAST_COLOR, alpha: 0.45 });
  }
  app.stage.addChild(coast);

  // Links
  const radius = Math.max(12, Math.min(20, w / 55));
  const pos = spread(new Map(p.info.regions.map((r) => [r.id, project(r.lat, r.lon)])), radius * 4.2);
  const links = new Graphics();
  for (const l of p.info.links) {
    const a = pos.get(l.from);
    const b = pos.get(l.to);
    if (!a || !b) continue;
    links.moveTo(a[0], a[1]).lineTo(b[0], b[1]);
    links.stroke({ width: l.mode === "sea" ? 1 : 2, color: l.mode === "sea" ? LINK_SEA : LINK_LAND, alpha: l.mode === "sea" ? 0.5 : 0.7 });
  }
  app.stage.addChild(links);

  // Regions
  for (const r of p.info.regions) {
    const [x, y] = pos.get(r.id)!;
    const controller = p.view.control[r.id];
    const node = new Container();
    node.position.set(x, y);
    node.eventMode = "static";
    node.cursor = "pointer";
    node.on("pointertap", () => p.onSelect(r.id));

    const g = new Graphics();
    const isSea = controller === undefined;
    g.circle(0, 0, radius).fill({ color: color(controller), alpha: isSea ? 0.25 : 0.9 });
    if (p.selected === r.id) g.circle(0, 0, radius + 4).stroke({ width: 2, color: 0xffffff });
    if (controller === p.view.viewer) g.circle(0, 0, radius).stroke({ width: 2, color: 0xffffff, alpha: 0.5 });
    node.addChild(g);

    const own = p.view.self.forces[r.id];
    const forceText = controller === p.view.viewer || own !== undefined ? String(own ?? 0) : isSea ? "" : "?";
    if (forceText) {
      const t = new Text({ text: forceText, style: { fontFamily: "system-ui, sans-serif", fontSize: 12, fontWeight: "700", fill: 0x0d1117 } });
      t.anchor.set(0.5);
      node.addChild(t);
    }

    const here = p.places.filter((pl) => pl.regionId === r.id);
    const damaged = here.some((pl) => /damaged|destroyed|contaminated|captured/.test(pl.status) || /damage [1-9]/.test(pl.status));
    const label = new Text({
      text: r.name,
      style: { fontFamily: "system-ui, sans-serif", fontSize: 11, fill: 0xd6dde6, align: "center", wordWrap: true, wordWrapWidth: 110 },
    });
    label.anchor.set(0.5, 0);
    label.position.set(0, radius + 3);
    node.addChild(label);
    if (damaged) {
      // Sites and cities are listed in the region panel; the map only flags damage.
      const mark = new Graphics().circle(radius * 0.75, -radius * 0.75, 4).fill({ color: 0xff7b72 });
      node.addChild(mark);
    }
    app.stage.addChild(node);
  }
}

/**
 * Push nodes apart until no two are closer than minDist. Display only: the
 * Kashmir regions sit within ~2 degrees of each other. Deterministic (fixed
 * iteration order and count), so the map never jitters between redraws.
 */
function spread(pos: Map<string, [number, number]>, minDist: number): Map<string, [number, number]> {
  const ids = [...pos.keys()].sort();
  const p = new Map([...pos].map(([k, v]) => [k, [v[0], v[1]] as [number, number]]));
  for (let iter = 0; iter < 80; iter++) {
    let moved = false;
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        const a = p.get(ids[i]!)!;
        const b = p.get(ids[j]!)!;
        let dx = b[0] - a[0];
        let dy = b[1] - a[1];
        let d = Math.hypot(dx, dy);
        if (d >= minDist) continue;
        if (d < 0.01) [dx, dy, d] = [1, 0, 1];
        const push = (minDist - d) / 2;
        a[0] -= (dx / d) * push;
        a[1] -= (dy / d) * push;
        b[0] += (dx / d) * push;
        b[1] += (dy / d) * push;
        moved = true;
      }
    if (!moved) break;
  }
  return p;
}

/** Equirectangular, scaled for mid-latitude, fitted to the regions with a margin. */
function projection(info: GameInfo, w: number, h: number): (lat: number, lon: number) => [number, number] {
  const lats = info.regions.map((r) => r.lat);
  const lons = info.regions.map((r) => r.lon);
  const minLat = Math.min(...lats) - 1.5;
  const maxLat = Math.max(...lats) + 1.5;
  const minLon = Math.min(...lons) - 1.5;
  const maxLon = Math.max(...lons) + 1.5;
  const k = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const spanX = (maxLon - minLon) * k;
  const spanY = maxLat - minLat;
  const margin = 36;
  const scale = Math.min((w - 2 * margin) / spanX, (h - 2 * margin) / spanY);
  const offX = (w - spanX * scale) / 2;
  const offY = (h - spanY * scale) / 2;
  return (lat, lon) => [offX + (lon - minLon) * k * scale, offY + (maxLat - lat) * scale];
}
