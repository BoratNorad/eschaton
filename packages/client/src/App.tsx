import { useEffect, useRef, useState } from "react";
import type { GameEvent } from "@eschaton/engine";
import { EngineClient } from "./engineClient.js";
import type { GameInfo, MenuItem, NationInfo, SeatData } from "./protocol.js";
import { EventFeed } from "./ui/EventFeed.js";
import { MapView } from "./ui/MapView.js";
import { NationPanel } from "./ui/NationPanel.js";
import { OrderPanel } from "./ui/OrderPanel.js";
import { RegionDetail } from "./ui/RegionDetail.js";
import { TensionLadder } from "./ui/TensionLadder.js";

// Hotseat flow: a cover screen hands the device to each player in turn. Only
// the current player's view is ever loaded, and it is dropped before the next
// cover screen, so nobody sees the other side's plans or intelligence.

type Phase =
  | { kind: "title" }
  | { kind: "cover"; nationId: string; note?: string }
  | { kind: "plan"; nationId: string; seat: SeatData }
  | { kind: "over"; outcomes: Record<string, string>; log?: GameEvent[] };

const OUTCOME_TEXT: Record<string, string> = { win: "wins", loss: "loses", draw: "draws" };

function loadHistoricalNames(): boolean {
  try {
    return localStorage.getItem("eschaton.historicalNames") === "1";
  } catch {
    return false;
  }
}

export function App() {
  const client = useRef<EngineClient | null>(null);
  const [info, setInfo] = useState<GameInfo | null>(null);
  const [turn, setTurn] = useState(0);
  const [phase, setPhase] = useState<Phase>({ kind: "title" });
  const [staged, setStaged] = useState<MenuItem[]>([]);
  const [reasons, setReasons] = useState<Array<string | null>>([]);
  const [selected, setSelected] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historical, setHistorical] = useState(loadHistoricalNames);
  const [seed, setSeed] = useState(() => String(Math.floor(Math.random() * 1_000_000)));
  /** Nations the AI plays this game. Empty = hotseat. */
  const [aiSeats, setAiSeats] = useState<string[]>([]);

  useEffect(() => {
    client.current = new EngineClient();
    return () => client.current?.dispose();
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("eschaton.historicalNames", historical ? "1" : "0");
    } catch {
      /* private mode: the setting just won't persist */
    }
  }, [historical]);

  const nation = (id: string): NationInfo | undefined => info?.nations.find((n) => n.id === id);
  // Aliases already carry a rank ("General Rashid Kamal"); historical names need the title.
  const leaderName = (n: NationInfo | undefined) => (n ? (historical ? `${n.leaderTitle} ${n.leaderName}` : n.leaderAlias) : "");

  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function newGame(ai: string[]) {
    const s = Number.parseInt(seed, 10);
    await run(async () => {
      const r = await client.current!.call({ type: "new", seed: Number.isFinite(s) ? s >>> 0 : 1, ai });
      setAiSeats(r.ai);
      setInfo(r.info);
      setTurn(r.turn);
      setPhase({ kind: "cover", nationId: r.planning[0]!, note: "A new crisis begins." });
    });
  }

  async function takeSeat(nationId: string) {
    await run(async () => {
      const r = await client.current!.call({ type: "seat", nationId });
      setStaged([]);
      setReasons([]);
      setSelected(undefined);
      setPhase({ kind: "plan", nationId, seat: r.data });
    });
  }

  // Live legality check whenever the staged list changes.
  useEffect(() => {
    if (phase.kind !== "plan") return;
    let stale = false;
    const set = { nationId: phase.nationId, turn, orders: staged.map((m) => m.order) };
    void client.current!.call({ type: "check", set }).then(
      (r) => !stale && setReasons(r.result.orders),
      (e: unknown) => !stale && setError(String(e)),
    );
    return () => {
      stale = true;
    };
  }, [staged, phase, turn]);

  async function submit() {
    if (phase.kind !== "plan") return;
    const set = { nationId: phase.nationId, turn, orders: staged.map((m) => m.order) };
    await run(async () => {
      const r = await client.current!.call({ type: "submit", set });
      setStaged([]);
      setReasons([]);
      if (r.resolved?.outcomes) {
        const log = await client.current!.call({ type: "reveal" });
        setPhase({ kind: "over", outcomes: r.resolved.outcomes, log: log.events });
      } else if (r.resolved) {
        setTurn(r.resolved.turn);
        setPhase({ kind: "cover", nationId: r.waitingFor[0]!, note: `Turn ${r.resolved.turn + 1} begins. Last turn's results are in your feed.` });
      } else {
        setPhase({ kind: "cover", nationId: r.waitingFor[0]! });
      }
    });
  }

  const names = phase.kind === "plan" ? phase.seat.names : {};
  const title = info ? info.scenarioName : "ESCHATON";

  return (
    <div className="app">
      <header className="top">
        <h1>{title}</h1>
        {info && <span className="turn-badge" data-testid="turn">Turn {turn + 1} of {info.maxTurns}</span>}
        {phase.kind === "plan" && (
          <span className="who">
            {nation(phase.nationId)?.name} · {leaderName(nation(phase.nationId))}
          </span>
        )}
        <label className="toggle">
          <input type="checkbox" checked={historical} onChange={(e) => setHistorical(e.target.checked)} /> Historical names
        </label>
      </header>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {phase.kind === "title" && (
        <main className="center">
          <p className="lede">Two new nuclear powers. One disputed mountain region. Lead one side against the computer, or both sides with a friend at this screen.</p>
          <label>
            Seed <input value={seed} onChange={(e) => setSeed(e.target.value.replace(/\D/g, ""))} inputMode="numeric" aria-label="Seed" />
          </label>
          <div className="modes">
            <button type="button" className="primary" onClick={() => newGame(["pakistan"])} disabled={busy} data-testid="play-india">
              Play India against the computer
            </button>
            <button type="button" className="primary" onClick={() => newGame(["india"])} disabled={busy} data-testid="play-pakistan">
              Play Pakistan against the computer
            </button>
            <button type="button" onClick={() => newGame([])} disabled={busy} data-testid="new-game">
              Two players, one screen
            </button>
          </div>
        </main>
      )}

      {phase.kind === "cover" && (
        <main className="center cover" data-testid="cover">
          {phase.note && <p>{phase.note}</p>}
          {aiSeats.length === 0 ? (
            <>
              <h2>Pass the device to {nation(phase.nationId)?.name}</h2>
              <p className="hint">{leaderName(nation(phase.nationId))}. The other player should look away.</p>
            </>
          ) : (
            <>
              <h2>{nation(phase.nationId)?.name}: your turn</h2>
              <p className="hint">
                {leaderName(nation(phase.nationId))}. The computer leads {aiSeats.map((id) => nation(id)?.name).join(" and ")}.
              </p>
            </>
          )}
          <button type="button" className="primary" onClick={() => takeSeat(phase.nationId)} disabled={busy} data-testid="take-seat">
            I am {nation(phase.nationId)?.name}: show my turn
          </button>
        </main>
      )}

      {phase.kind === "plan" && info && (
        <main className="board">
          <div className="left">
            <MapView info={info} view={phase.seat.view} places={phase.seat.places} selected={selected} onSelect={setSelected} />
            <RegionDetail regionId={selected} info={info} view={phase.seat.view} places={phase.seat.places} names={names} />
          </div>
          <div className="right">
            <TensionLadder view={phase.seat.view} names={names} />
            <NationPanel view={phase.seat.view} names={names} />
            <OrderPanel
              menu={phase.seat.menu}
              staged={staged}
              reasons={reasons}
              onChange={setStaged}
              onSubmit={submit}
              busy={busy}
            />
            <EventFeed events={phase.seat.view.events} />
          </div>
        </main>
      )}

      {phase.kind === "over" && info && (
        <main className="center over" data-testid="game-over">
          <h2>The game is over</h2>
          <ul className="outcomes">
            {Object.keys(phase.outcomes).sort().map((id) => (
              <li key={id}>
                {nation(id)?.name} {OUTCOME_TEXT[phase.outcomes[id]!] ?? phase.outcomes[id]}
              </li>
            ))}
          </ul>
          <button type="button" className="primary" onClick={() => setPhase({ kind: "title" })}>
            New game
          </button>
          {phase.log && <EventFeed events={phase.log} title="Full record, secrets included" />}
        </main>
      )}
    </div>
  );
}
