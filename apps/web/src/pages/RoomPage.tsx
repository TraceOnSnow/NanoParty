import type { Ack } from "@apr/shared";
import { useState } from "react";
import { clearSession, loadSession } from "../api.ts";
import { ChatPanel } from "../components/ChatPanel.tsx";
import { GameToolbar } from "../components/GameToolbar.tsx";
import { Lobby } from "../components/Lobby.tsx";
import { Scoreboard } from "../components/Scoreboard.tsx";
import { gameComponents } from "../games/registry.tsx";
import { navigate } from "../router.ts";
import { useRoom } from "../useRoom.ts";

export function RoomPage({ roomId }: { roomId: string }) {
  const [token] = useState(() => loadSession(roomId));
  const conn = useRoom(roomId, token);
  const [error, setError] = useState<string | null>(null);
  const { view } = conn;

  if (conn.status === "denied") {
    return (
      <main className="center-page">
        <div className="card form">
          <h1>无法进入房间</h1>
          <p className="muted">这个浏览器里没有该房间的有效身份。请使用邀请链接加入；昵称不能用来找回身份。</p>
          <button
            type="button"
            onClick={() => {
              clearSession(roomId);
              navigate("/");
            }}
          >
            返回首页
          </button>
        </div>
      </main>
    );
  }
  if (!view) return <main className="center-page muted">连接中…</main>;

  const run = async (p: Promise<Ack>) => {
    const ack = await p;
    setError(ack.ok ? null : ack.error);
    return ack;
  };
  const segment = view.segment;
  const Game = segment ? gameComponents[segment.gameId] : undefined;
  const gameMeta = segment ? view.games.find((g) => g.id === segment.gameId) : undefined;

  return (
    <div className="room">
      <header className="room-bar">
        <strong>{view.room.name}</strong>
        {gameMeta && <span className="tag">{gameMeta.name}</span>}
        <span className="spacer" />
        {conn.status !== "connected" && <span className="tag warn">连接中断，正在重连…</span>}
        {segment && view.me.isHost && (
          <button type="button" onClick={() => run(conn.command({ type: "endSegment", segmentId: segment.id }))}>
            结束本游戏，回到大厅
          </button>
        )}
      </header>

      <section className="main-panel">
        {error && (
          <button type="button" className="error banner" onClick={() => setError(null)}>
            {error}
          </button>
        )}
        {segment?.status === "paused" && (
          <div className="banner pause">
            <span>服务器重启过，游戏已暂停，进度和成绩都已保留。</span>
            {view.me.isHost ? (
              <button
                type="button"
                className="primary"
                onClick={() => run(conn.command({ type: "resumeSegment", segmentId: segment.id }))}
              >
                继续游戏
              </button>
            ) : (
              <span className="muted">等待房主继续…</span>
            )}
          </div>
        )}
        {segment ? (
          Game ? (
            <>
              <Game
                view={segment.view}
                room={view}
                paused={segment.status === "paused"}
                act={(action) => conn.command({ type: "gameAction", segmentId: segment.id, action })}
              />
              <GameToolbar segment={segment} command={(c) => run(conn.command(c))} />
            </>
          ) : (
            <p className="muted">这个版本的页面还不支持该游戏。</p>
          )
        ) : (
          <Lobby view={view} command={(c) => run(conn.command(c))} />
        )}
      </section>

      <aside className="side-panel">
        <Scoreboard view={view} />
        <ChatPanel view={view} chat={conn.chat} say={conn.say} />
      </aside>
    </div>
  );
}
