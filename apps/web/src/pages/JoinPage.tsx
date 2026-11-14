import { NICKNAME_MAX } from "@apr/shared";
import { type FormEvent, useEffect, useState } from "react";
import { api, saveSession } from "../api.ts";
import { navigate } from "../router.ts";

export function JoinPage({ inviteToken }: { inviteToken: string }) {
  const [roomName, setRoomName] = useState<string | null>(null);
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .invite(inviteToken)
      .then((info) => setRoomName(info.roomName))
      .catch((err: Error) => setError(err.message));
  }, [inviteToken]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const seat = await api.join({ inviteToken, nickname });
      saveSession(seat);
      // Leave the invite URL behind so the token does not linger in the address bar.
      navigate(`/room/${seat.roomId}`, true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加入失败");
      setBusy(false);
    }
  }

  return (
    <main className="center-page">
      <form className="card form" onSubmit={submit}>
        <h1>{roomName ? `加入「${roomName}」` : "加入房间"}</h1>
        {roomName && (
          <label>
            你的昵称
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              maxLength={NICKNAME_MAX}
              required
              // biome-ignore lint/a11y/noAutofocus: single-field page
              autoFocus
            />
          </label>
        )}
        {error && <p className="error">{error}</p>}
        {roomName && (
          <button type="submit" className="primary" disabled={busy}>
            {busy ? "加入中…" : "加入"}
          </button>
        )}
      </form>
    </main>
  );
}
