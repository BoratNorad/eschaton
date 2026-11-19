import type { PlayerView } from "@eschaton/engine";

const ALERT = ["", "1 · war imminent", "2 · forces ready", "3 · raised", "4 · watchful", "5 · peacetime"];

export function NationPanel({ view, names }: { view: PlayerView; names: Record<string, string> }) {
  const s = view.self;
  return (
    <section className="panel" aria-labelledby="nation-h">
      <h2 id="nation-h">{names[s.nationId]}</h2>
      <dl className="stats">
        <dt>Stability</dt>
        <dd><Meter value={s.stability} /></dd>
        <dt>Readiness</dt>
        <dd><Meter value={s.readiness} /></dd>
        <dt>Mobilization</dt>
        <dd><Meter value={s.mobilization} /></dd>
        <dt>Alert</dt>
        <dd>{ALERT[s.alert]}</dd>
        <dt>Warheads</dt>
        <dd>{s.nuclear.warheads}</dd>
        {s.chemicalTonnes > 0 && (
          <>
            <dt>Chemical stock</dt>
            <dd>{s.chemicalTonnes} t</dd>
          </>
        )}
        {s.sanctionsAgainst > 0 && (
          <>
            <dt>Sanctions</dt>
            <dd>{s.sanctionsAgainst}</dd>
          </>
        )}
      </dl>
      {s.unlockedActions.length > 0 && (
        <p className="hint">Unlocked: {s.unlockedActions.map((u) => `${u.action.replace(/_/g, " ")} (to turn ${u.untilTurn})`).join(", ")}</p>
      )}
      <h3>What we believe</h3>
      {Object.keys(view.others).sort().map((id) => {
        const o = view.others[id]!;
        const w = o.belief.warheads;
        return (
          <p key={id} className="belief">
            <strong>{names[id] ?? id}:</strong> alert {o.alert ?? "?"}; warheads{" "}
            {w ? `${w.low}–${w.high} (confidence ${Math.round(w.confidenceBp / 100)}%, turn ${w.asOfTurn})` : "unknown"}
          </p>
        );
      })}
    </section>
  );
}

function Meter({ value }: { value: number }) {
  return (
    <span className="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}>
      <span style={{ width: `${value}%` }} />
      <em>{value}</em>
    </span>
  );
}
