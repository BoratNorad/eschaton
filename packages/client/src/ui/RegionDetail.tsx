import type { PlayerView } from "@eschaton/engine";
import type { GameInfo, Place } from "../protocol.js";

export function RegionDetail(props: {
  regionId: string | undefined;
  info: GameInfo;
  view: PlayerView;
  places: Place[];
  names: Record<string, string>;
}) {
  const { regionId, info, view, places, names } = props;
  if (regionId === undefined) return <p className="hint">Select a region on the map.</p>;
  const r = info.regions.find((x) => x.id === regionId);
  if (!r) return null;
  const controller = view.control[regionId];
  const own = view.self.forces[regionId];
  const here = places.filter((p) => p.regionId === regionId);
  return (
    <div className="region-detail" data-testid="region-detail">
      <h3>{r.name}</h3>
      <p className="hint">
        {r.terrain}. {controller ? `Held by ${names[controller] ?? controller}.` : "Open sea."}{" "}
        {own !== undefined ? `Your forces: ${own}.` : controller && controller !== view.viewer ? "Enemy strength unknown." : ""}
      </p>
      {here.length > 0 && (
        <ul className="places">
          {here.map((p) => (
            <li key={p.id}>
              {p.kind === "metro" ? "●" : "◆"} {p.name}
              {p.capital ? " (capital)" : ""} <span className="status">{p.status}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
