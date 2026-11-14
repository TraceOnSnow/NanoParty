import { NICKNAME_MAX } from "@apr/shared";
import { type FormEvent, useState } from "react";
import { api, saveSession } from "../api.ts";
import { navigate } from "../router.ts";

export function HomePage() {
  const [roomName, setRoomName] = useState("");
  const [nickname, setNickname] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const seat = await api.createRoom({ roomName, nickname, adminPassword });
      saveSession(seat);
      navigate(`/room/${seat.roomId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
      setBusy(false);
    }
  }

  return (
    <main className="center-page">
      <form className="card form" onSubmit={submit}>
        <h1>NanoParty</h1>
        <p className="muted">自部署的朋友聚会游戏房间。创建房间需要实例管理员密码；朋友通过邀请链接加入。</p>
        <label>
          房间名
          <input value={roomName} onChange={(e) => setRoomName(e.target.value)} maxLength={40} required />
        </label>
        <label>
          你的昵称
          <input value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={NICKNAME_MAX} required />
        </label>
        <label>
          管理员密码
          <input
            type="password"
            value={adminPassword}
            onChange={(e) => setAdminPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "创建中…" : "创建房间"}
        </button>
      </form>
    </main>
  );
}
