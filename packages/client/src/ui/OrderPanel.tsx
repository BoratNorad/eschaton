import { useMemo, useState } from "react";
import type { MenuItem } from "../protocol.js";

interface Props {
  menu: MenuItem[];
  staged: MenuItem[];
  /** One entry per staged order: null = will be carried out, else why not. */
  reasons: Array<string | null>;
  onChange: (staged: MenuItem[]) => void;
  onSubmit: () => void;
  busy: boolean;
}

const MAX_ORDERS = 24;

export function OrderPanel({ menu, staged, reasons, onChange, onSubmit, busy }: Props) {
  const groups = useMemo(() => {
    const out = new Map<string, MenuItem[]>();
    for (const m of menu) out.set(m.group, [...(out.get(m.group) ?? []), m]);
    return [...out.entries()];
  }, [menu]);
  const rejected = reasons.filter((r) => r !== null).length;

  return (
    <section className="panel orders" aria-labelledby="orders-h">
      <h2 id="orders-h">Orders</h2>
      {groups.map(([group, items]) => (
        <GroupPicker
          key={group}
          group={group}
          items={items}
          disabled={busy || staged.length >= MAX_ORDERS}
          onAdd={(item) => onChange([...staged, item])}
        />
      ))}

      <h3>This turn ({staged.length}/{MAX_ORDERS})</h3>
      {staged.length === 0 && <p className="hint">No orders yet. You can also submit none.</p>}
      <ol className="staged" data-testid="staged">
        {staged.map((m, i) => (
          <li key={`${m.key}-${i}`} className={reasons[i] ? "bad" : ""}>
            <span>{m.label}</span>
            {reasons[i] && <span className="reason">Will be dropped: {reasons[i]}.</span>}
            <button type="button" className="link" onClick={() => onChange(staged.filter((_, j) => j !== i))} aria-label={`Remove ${m.label}`}>
              Remove
            </button>
          </li>
        ))}
      </ol>
      <button type="button" className="primary" disabled={busy} onClick={onSubmit} data-testid="submit">
        {rejected > 0 ? `Submit (${rejected} will be dropped)` : "Submit orders"}
      </button>
    </section>
  );
}

function GroupPicker(props: { group: string; items: MenuItem[]; disabled: boolean; onAdd: (m: MenuItem) => void }) {
  const [key, setKey] = useState("");
  const subs = useMemo(() => {
    const out = new Map<string, MenuItem[]>();
    for (const m of props.items) out.set(m.sub ?? "", [...(out.get(m.sub ?? "") ?? []), m]);
    return [...out.entries()];
  }, [props.items]);
  const id = `pick-${props.group.replace(/\W+/g, "-").toLowerCase()}`;
  const chosen = props.items.find((m) => m.key === key);
  return (
    <div className="picker">
      <label htmlFor={id}>{props.group}</label>
      <select id={id} value={key} onChange={(e) => setKey(e.target.value)} disabled={props.disabled}>
        <option value="">Choose…</option>
        {subs.map(([sub, items]) =>
          sub ? (
            <optgroup key={sub} label={sub}>
              {items.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </optgroup>
          ) : (
            items.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)
          ),
        )}
      </select>
      <button
        type="button"
        disabled={props.disabled || !chosen}
        onClick={() => {
          if (chosen) props.onAdd(chosen);
          setKey("");
        }}
      >
        Add
      </button>
    </div>
  );
}
