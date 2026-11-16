import type { Ack } from "@apr/shared";
import { useEffect, useRef, useState } from "react";
import { clearSession, loadSession } from "../api.ts";
import { CanvasPanel } from "../components/CanvasPanel.tsx";
import { ChatPanel } from "../components/ChatPanel.tsx";
import { GameToolbar } from "../components/GameToolbar.tsx";
import { Lobby } from "../components/Lobby.tsx";
import { Scoreboard } from "../components/Scoreboard.tsx";
import { AdjustmentCard, SettlementPanel } from "../components/Settlement.tsx";
import { TestBar } from "../components/TestBar.tsx";
import { ThemeAdapt } from "../components/ThemeAdapt.tsx";
import { PickPanel, pickOf } from "../games/PickPanel.tsx";
import { customTopicFields, gameComponents } from "../games/registry.tsx";
import { navigate } from "../router.ts";
import { useRoom } from "../useRoom.ts";

export function RoomPage({ roomId }: { roomId: string }) {
  const [token] = useState(() => loadSession(roomId));
  const conn = useRoom(roomId, token);
  const [error, setError] = useState<string | null>(null);
  const { view } = conn;
  // Phones show one panel at a time; messages that arrive while the chat is hidden are counted.
  const [tab, setTab] = useState<"game" | "chat">("game");
  const seen = useRef(0);
  const total = conn.chat.length;
  if (tab === "chat") seen.current = total;
  const unread = Math.max(0, total - seen.current);
  // A rejected action explains itself for a few seconds, then gets out of the way.
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(t);
  }, [error]);

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
    <div className={`room tab-${tab}`}>
      <TestBar roomId={roomId} me={view.me.playerId} />
      <header className="room-bar">
        <strong>{view.room.name}</strong>
        {gameMeta && <span className="tag">{gameMeta.alias ?? gameMeta.name}</span>}
        <span className="spacer" />
        {conn.status !== "connected" && <span className="tag warn">连接中断，正在重连…</span>}
        {segment && view.me.isHost && (
          <>
            <button
              type="button"
              title="用已经完成的回合结算派对积分"
              onClick={() =>
                confirm("结束这场游戏并结算？正在进行、还没打完的这一回合会作废，之前完成的回合照常计入。") &&
                run(conn.command({ type: "endSegment", segmentId: segment.id, mode: "settle" }))
              }
            >
              结束并结算
            </button>
            <button
              type="button"
              title="不发派对积分"
              onClick={() =>
                confirm("放弃这场游戏？这一场不会有任何派对积分。") &&
                run(conn.command({ type: "endSegment", segmentId: segment.id, mode: "abandon" }))
              }
            >
              放弃本场
            </button>
          </>
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
        <CanvasPanel view={view} command={(c) => run(conn.command(c))} />
        {/* Proposals made mid-game are party-level: the lobby lists them, so show them here while it is hidden. */}
        {(segment || view.settlement) &&
          view.adjustments
            .filter((a) => a.segmentId !== view.settlement?.segmentId)
            .map((adj) => (
              <AdjustmentCard
                key={adj.id}
                adj={adj}
                view={view}
                command={(c) => run(conn.command(c))}
                inSettlement={false}
              />
            ))}
        {segment ? (
          Game ? (
            <>
              {segment.notice && <p className="notice ai-working">{segment.notice}</p>}
              {pickOf(segment.view) ? (
                <PickPanel
                  view={segment.view}
                  room={view}
                  paused={segment.status === "paused"}
                  act={(action) => conn.command({ type: "gameAction", segmentId: segment.id, action })}
                  fields={customTopicFields[segment.gameId] ?? []}
                />
              ) : null}
              {pickOf(segment.view) && segment.gameId === "soup" && (
                <ThemeAdapt
                  segmentId={segment.id}
                  disabled={segment.notice !== null}
                  command={(c) => run(conn.command(c))}
                />
              )}
              {pickOf(segment.view) ? null : (
                <Game
                  view={segment.view}
                  room={view}
                  paused={segment.status === "paused"}
                  act={(action) => conn.command({ type: "gameAction", segmentId: segment.id, action })}
                />
              )}
              {segment.rawScores.length > 0 && (
                <p className="muted small raw-scores">
                  本局游戏内得分（结算后按名次换成派对积分）：
                  {segment.rawScores
                    .map((s) => `${view.members.find((m) => m.id === s.playerId)?.nickname ?? "?"} ${s.points}`)
                    .join("　")}
                </p>
              )}
              <GameToolbar segment={segment} command={(c) => run(conn.command(c))} />
            </>
          ) : (
            <p className="muted">这个版本的页面还不支持该游戏。</p>
          )
        ) : view.settlement ? (
          <SettlementPanel view={view} command={(c) => run(conn.command(c))} />
        ) : (
          <Lobby view={view} command={(c) => run(conn.command(c))} />
        )}
      </section>

      <aside className="side-panel">
        <Scoreboard view={view} command={(c) => run(conn.command(c))} />
        <ChatPanel view={view} chat={conn.chat} say={conn.say} />
      </aside>

      <nav className="room-tabs">
        <button type="button" className={tab === "game" ? "on" : ""} onClick={() => setTab("game")}>
          {segment ? (gameMeta?.alias ?? gameMeta?.name ?? "游戏") : view.settlement ? "结算" : "大厅"}
        </button>
        <button type="button" className={tab === "chat" ? "on" : ""} onClick={() => setTab("chat")}>
          聊天和积分{unread > 0 && <span className="badge">{unread > 99 ? "99+" : unread}</span>}
        </button>
      </nav>
    </div>
  );
}
