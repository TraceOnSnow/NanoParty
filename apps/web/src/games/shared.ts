import type { Ack } from "@apr/shared";
import { useEffect, useState } from "react";

/** Seconds left until a server-provided deadline, or null when there is none. */
export function useCountdown(deadlineAt: number | null): number | null {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (deadlineAt == null) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [deadlineAt]);
  return deadlineAt == null ? null : Math.max(0, Math.ceil((deadlineAt - now) / 1000));
}

/** Sends actions and keeps the last rejection message for display. */
export function useAct(act: (action: unknown) => Promise<Ack>) {
  const [error, setError] = useState<string | null>(null);
  const send = async (action: object) => {
    const ack = await act(action);
    setError(ack.ok ? null : ack.error);
    return ack.ok;
  };
  return { error, setError, send };
}
