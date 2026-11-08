import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, getCapabilities, getUsers, isAbort, postChat } from "./api";
import { CapabilitiesPanel } from "./CapabilitiesPanel";
import { Chat, type Exchange } from "./Chat";
import type { Capabilities, UserInfo } from "./schemas";
import { TracePanel } from "./TracePanel";
import { UserSwitcher } from "./UserSwitcher";

function messageOf(err: unknown): string {
  return err instanceof ApiError ? err.message : "Something went wrong. Please try again.";
}

export function App() {
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [capsError, setCapsError] = useState<string | null>(null);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [pending, setPending] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const inflight = useRef<AbortController | null>(null);
  const nextId = useRef(1);

  useEffect(() => {
    const ctrl = new AbortController();
    getUsers(ctrl.signal)
      .then((list) => {
        setUsers(list);
        setUserId((cur) => cur ?? list[0]?.userId ?? null);
      })
      .catch((err: unknown) => {
        if (!isAbort(err)) setUsersError(messageOf(err));
      });
    return () => ctrl.abort();
  }, []);

  useEffect(() => {
    if (userId === null) return;
    const ctrl = new AbortController();
    setCaps(null);
    setCapsError(null);
    getCapabilities(userId, ctrl.signal)
      .then(setCaps)
      .catch((err: unknown) => {
        if (!isAbort(err)) setCapsError(messageOf(err));
      });
    return () => ctrl.abort();
  }, [userId]);

  useEffect(() => {
    if (!pending) return;
    const started = Date.now();
    setElapsedMs(0);
    const timer = setInterval(() => setElapsedMs(Date.now() - started), 100);
    return () => clearInterval(timer);
  }, [pending]);

  const switchUser = useCallback((next: string) => {
    inflight.current?.abort();
    inflight.current = null;
    setPending(false);
    setExchanges([]);
    setUserId(next);
  }, []);

  const send = useCallback(
    (message: string) => {
      if (userId === null) return;
      const ctrl = new AbortController();
      inflight.current = ctrl;
      const id = nextId.current++;
      setExchanges((xs) => [...xs, { id, message, result: null }]);
      setPending(true);
      const settle = (result: Exchange["result"]) => {
        if (ctrl.signal.aborted) return; // user switched meanwhile: exchanges were cleared
        setExchanges((xs) => xs.map((x) => (x.id === id ? { ...x, result } : x)));
        inflight.current = null;
        setPending(false);
      };
      postChat(userId, message, ctrl.signal).then(
        (res) => settle(res),
        (err: unknown) => {
          if (!isAbort(err)) settle({ error: messageOf(err) });
        },
      );
    },
    [userId],
  );

  const last = exchanges[exchanges.length - 1];
  const trace = last?.result != null && "trace" in last.result ? last.result.trace : null;

  return (
    <main>
      <header>
        <h1>Acme d.o.o. IT/HR Assistant</h1>
        {usersError !== null && <p className="error" role="alert">{usersError}</p>}
        {userId !== null && <UserSwitcher users={users} userId={userId} onChange={switchUser} />}
      </header>
      <div className="grid">
        <CapabilitiesPanel capabilities={caps} error={capsError} />
        <Chat exchanges={exchanges} pending={pending} elapsedMs={elapsedMs} onSend={send} />
        <TracePanel trace={trace} />
      </div>
    </main>
  );
}
