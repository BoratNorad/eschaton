import type { GameEvent } from "@eschaton/engine";

export function EventFeed({ events, title = "Events" }: { events: GameEvent[]; title?: string }) {
  const shown = [...events].reverse();
  return (
    <section className="panel feed" aria-labelledby="feed-h">
      <h2 id="feed-h">{title}</h2>
      {shown.length === 0 && <p className="hint">Nothing has happened yet.</p>}
      <ol className="events" data-testid="events">
        {shown.map((e) => (
          <li key={e.seq} className={`event v-${e.visibility}`}>
            <span className="turn">T{e.turn}</span>
            <span className="text">{e.text}</span>
            {e.visibility !== "public" && <span className="tag">{e.visibility === "hidden" ? "secret" : e.visibility === "coalition" ? "your side" : "only you"}</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}
