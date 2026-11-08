import type { Capabilities } from "./schemas";

interface Props {
  readonly capabilities: Capabilities | null;
  readonly error: string | null;
}

export function CapabilitiesPanel({ capabilities, error }: Props) {
  return (
    <section aria-labelledby="caps-h" className="panel">
      <h2 id="caps-h">What this user can use</h2>
      {error !== null && <p className="error" role="alert">{error}</p>}
      {capabilities === null && error === null && <p>Loading…</p>}
      {capabilities?.agents.map((a) => (
        <div key={a.agent} className="agent-caps">
          <h3>{a.agent}</h3>
          <ul>
            {a.capabilities.map((c) => (
              <li key={c.id} className={c.available ? "cap-yes" : "cap-no"}>
                <strong>{c.id}</strong> <span className="badge">{c.kind}</span>{" "}
                <span className="state">{c.available ? "available" : "not available"}</span>
                <div className="muted">{c.description}</div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
