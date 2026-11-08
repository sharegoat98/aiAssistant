import { useState, type FormEvent } from "react";
import { DemoButtons } from "./DemoButtons";
import type { ChatResponse } from "./schemas";

export interface Exchange {
  readonly id: number;
  readonly message: string;
  /** null while pending. */
  readonly result: ChatResponse | { readonly error: string } | null;
}

interface Props {
  readonly exchanges: readonly Exchange[];
  readonly pending: boolean;
  readonly elapsedMs: number;
  readonly onSend: (message: string) => void;
}

export function Chat({ exchanges, pending, elapsedMs, onSend }: Props) {
  const [text, setText] = useState("");

  const submit = (message: string) => {
    if (pending || message.trim() === "") return;
    onSend(message);
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(text);
  };

  return (
    <section aria-labelledby="chat-h" className="panel">
      <h2 id="chat-h">Chat</h2>
      <ol className="exchanges" aria-live="polite">
        {exchanges.map((x) => (
          <li key={x.id}>
            <div className="msg-user">{x.message}</div>
            {x.result === null && <div className="muted">Waiting for the answer…</div>}
            {x.result !== null && "error" in x.result && <div className="error" role="alert">{x.result.error}</div>}
            {x.result !== null && "reply" in x.result && (
              <div className="msg-reply">
                {x.result.reply}
                <div className="muted">status: {x.result.status}</div>
              </div>
            )}
          </li>
        ))}
      </ol>
      <DemoButtons
        disabled={pending}
        onPick={(m) => {
          setText(m);
          submit(m);
        }}
      />
      <form onSubmit={onSubmit}>
        <label htmlFor="chat-input">Your message</label>
        <textarea id="chat-input" rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />
        <p className="muted">Each request is independent: there is no conversation memory.</p>
        <button type="submit" disabled={pending || text.trim() === ""}>
          {pending ? "Sending…" : "Send"}
        </button>
        {pending && <span className="muted"> {(elapsedMs / 1000).toFixed(1)} s</span>}
      </form>
    </section>
  );
}
