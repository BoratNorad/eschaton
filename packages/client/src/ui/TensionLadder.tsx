import { TENSION_LABELS, type PlayerView } from "@eschaton/engine";

const HINTS = [
  "",
  "Propaganda, arms sales, proxy funding.",
  "Border clashes, shootdowns, terror attacks.",
  "Mobilization, alerts, ultimatums. Assaults allowed.",
  "Open fighting. Conventional strikes allowed.",
  "WMD release is possible.",
];

export function TensionLadder({ view, names }: { view: PlayerView; names: Record<string, string> }) {
  const pairs = Object.keys(view.tensions).sort();
  return (
    <section className="panel" aria-labelledby="ladder-h">
      <h2 id="ladder-h">Tension</h2>
      {pairs.map((key) => {
        const t = view.tensions[key]!;
        const [a, b] = key.split("|") as [string, string];
        return (
          <div key={key} className="ladder" data-testid={`ladder-${key}`}>
            <div className="ladder-title">
              {names[a] ?? a} – {names[b] ?? b}
            </div>
            <ol className="rungs">
              {[5, 4, 3, 2, 1].map((level) => (
                <li key={level} className={level === t.level ? "rung current" : level < t.level ? "rung passed" : "rung"} title={HINTS[level]}>
                  <span className="rung-n">{level}</span> {TENSION_LABELS[level]}
                  {level === t.level && (
                    <span className="pressure" aria-label={`pressure ${t.pressure} of 100`}>
                      <span style={{ width: `${t.pressure}%` }} />
                    </span>
                  )}
                </li>
              ))}
            </ol>
            <p className="hint">{HINTS[t.level]} Pressure {t.pressure}/100.</p>
          </div>
        );
      })}
    </section>
  );
}
