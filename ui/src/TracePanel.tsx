import { useState } from "react";
import type { TraceEvent } from "./schemas";
import { buildTraceView, truncate, type TraceGroup, type TraceRow, type TraceSpan } from "./trace";

const MAX_DETAIL = 200;

function Detail({ text }: { readonly text: string }) {
  const [open, setOpen] = useState(false);
  const t = truncate(text, MAX_DETAIL);
  if (!t.truncated) return <span className="detail">{text}</span>;
  return (
    <span className="detail">
      {open ? text : `${t.text}…`}{" "}
      <button type="button" className="link" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? "Show less" : "Show more"}
      </button>
    </span>
  );
}

function Row({ row }: { readonly row: TraceRow }) {
  const cls = row.highlight === null ? "trace-row" : `trace-row hl-${row.highlight}`;
  return (
    <li className={cls}>
      <span className="offset">+{row.offsetMs} ms</span>
      <span className={`badge agent-${row.agent}`}>{row.agent}</span>
      <span className="etype">{row.type}</span>
      {row.tool !== null && <code>{row.tool}</code>}
      {row.ok !== null && <span className={row.ok ? "ok" : "failed"}>{row.ok ? "ok" : "failed"}</span>}
      {row.status !== null && <span className={row.status === "ok" ? "ok" : "failed"}>{row.status}</span>}
      {row.detail !== "" && <Detail text={row.detail} />}
    </li>
  );
}

function spanTitle(s: TraceSpan): string {
  if (s.unfinished) return `${s.agent}: unfinished (no agent_end)`;
  return `${s.agent}: ${s.durationMs} ms, ${s.status}`;
}

function Group({ group }: { readonly group: TraceGroup }) {
  const parallel = group.kind === "parallel";
  return (
    <li className={parallel ? "group parallel" : "group"}>
      {parallel && (
        <div className="group-label">
          ran in parallel: {group.spans.map((s) => `${s.agent} ${s.durationMs === null ? "unfinished" : `${s.durationMs} ms`}`).join(" | ")}
        </div>
      )}
      {group.spans.map((s, i) => (
        <div key={i} className="span">
          <div className="span-title">{spanTitle(s)}</div>
          <ul>
            {s.rows.map((r, j) => (
              <Row key={j} row={r} />
            ))}
          </ul>
        </div>
      ))}
    </li>
  );
}

export function TracePanel({ trace }: { readonly trace: readonly TraceEvent[] | null }) {
  const view = trace === null ? null : buildTraceView(trace);
  return (
    <section aria-labelledby="trace-h" className="panel">
      <h2 id="trace-h">Execution trace</h2>
      {view === null && <p className="muted">Send a message to see what the agents did.</p>}
      {view !== null && view.timeline.length === 0 && <p className="muted">The trace is empty.</p>}
      {view !== null && view.timeline.length > 0 && (
        <>
          <p className="muted">Total: {view.totalMs} ms</p>
          <ul className="trace">
            {view.timeline.map((item, i) =>
              item.kind === "row" ? <Row key={i} row={item.row} /> : <Group key={i} group={item.group} />,
            )}
          </ul>
        </>
      )}
    </section>
  );
}
