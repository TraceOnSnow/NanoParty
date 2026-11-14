import type { Ack, Command, GameMeta, RoomView } from "@apr/shared";
import { useState } from "react";

interface Props {
  view: RoomView;
  command(command: Command): Promise<Ack>;
}

export function Lobby({ view, command }: Props) {
  const { me, members, lastSegment, suggestion } = view;
  const [copied, setCopied] = useState(false);
  const name = (id: string) => members.find((m) => m.id === id)?.nickname ?? "?";
  const inviteUrl = view.inviteToken ? `${location.origin}/join/${view.inviteToken}` : null;
  const suggested = suggestion ? view.games.find((g) => g.id === suggestion.gameId) : undefined;

  return (
    <div className="lobby">
      {inviteUrl && (
        <div className="card invite">
          <div>
            <strong>邀请朋友</strong>
            <p className="muted">把链接发给朋友，对方填写昵称即可加入。拿到链接的人都能加入，请只发给朋友。</p>
          </div>
          <div className="host-row">
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(inviteUrl);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? "已复制 ✓" : "复制邀请链接"}
            </button>
            <button
              type="button"
              title="旧链接立即失效；已在房间里的人不受影响"
              onClick={() =>
                confirm("更换后旧邀请链接将失效（已加入的人不受影响）。继续？") && command({ type: "rotateInvite" })
              }
            >
              更换链接
            </button>
          </div>
        </div>
      )}

      {lastSegment && (
        <div className="card">
          <strong>
            上一局：{lastSegment.gameName}
            {lastSegment.endedReason === "aborted" ? "（提前结束）" : ""}
          </strong>
          <p className="muted">
            {lastSegment.scores.length > 0
              ? lastSegment.scores.map((s) => `${name(s.playerId)} +${s.points}`).join("　")
              : "这一局没有人得分。"}
          </p>
        </div>
      )}

      {suggestion && suggested && (
        <div className="card suggestion">
          <div>
            <strong>AI 主持推荐：{suggested.name}</strong>
            <p>{suggestion.reason}</p>
          </div>
          {me.isHost ? (
            <div className="host-row">
              <button
                type="button"
                className="primary"
                onClick={() => command({ type: "startGame", gameId: suggested.id })}
              >
                就玩这个
              </button>
              <button type="button" onClick={() => command({ type: "dismissSuggestion" })}>
                不用了
              </button>
            </div>
          ) : (
            <span className="muted">等待房主决定</span>
          )}
        </div>
      )}

      {me.isHost && (
        <div className="card">
          <div className="lobby-head">
            <strong>房间管理</strong>
            <button
              type="button"
              onClick={() =>
                confirm("结束本场聚会？积分会清零并开始新的一场，聊天记录保留。") && command({ type: "endSession" })
              }
            >
              结束本场并清零积分
            </button>
          </div>
          <ul className="chips">
            {members
              .filter((m) => !m.isHost)
              .map((m) => (
                <li key={m.id} className="chip">
                  {m.nickname}
                  <button
                    type="button"
                    className="link"
                    onClick={() =>
                      confirm(`把 ${m.nickname} 移出房间？TA 将无法再用原身份进入。`) &&
                      command({ type: "removeMember", playerId: m.id })
                    }
                  >
                    移出
                  </button>
                </li>
              ))}
          </ul>
        </div>
      )}

      <div className="lobby-head">
        <h2>选择游戏</h2>
        <button
          type="button"
          disabled={!view.ai.enabled}
          title={view.ai.enabled ? "" : "AI 主持未启用，可直接选择游戏"}
          onClick={() => command({ type: "askAgent", kind: "recommend" })}
        >
          让 AI 推荐
        </button>
      </div>
      <div className="game-list">
        {view.games.map((g) => (
          <GameCard key={g.id} game={g} view={view} command={command} />
        ))}
      </div>
    </div>
  );
}

function GameCard({ game, view, command }: { game: GameMeta; view: RoomView; command: Props["command"] }) {
  const count = view.members.length;
  const playable = count >= game.minPlayers && count <= game.maxPlayers;
  const [config, setConfig] = useState<Record<string, number>>(() =>
    Object.fromEntries((game.options ?? []).map((o) => [o.key, o.default])),
  );
  return (
    <div className="card game-card">
      <div className="lobby-head">
        <strong>{game.name}</strong>
        <span className="tag">
          {game.minPlayers}–{game.maxPlayers} 人
        </span>
      </div>
      <p>{game.description}</p>
      <details>
        <summary>规则与计分</summary>
        <p>{game.rulesSummary}</p>
        <p>{game.scoringSummary}</p>
      </details>
      {view.me.isHost && game.options && game.options.length > 0 && (
        <details>
          <summary>设置</summary>
          <div className="options">
            {game.options.map((o) => (
              <label key={o.key}>
                <span>
                  {o.label}
                  {o.hint && <span className="muted">（{o.hint}）</span>}
                </span>
                <input
                  type="number"
                  min={o.min}
                  max={o.max}
                  value={config[o.key] ?? o.default}
                  onChange={(e) =>
                    setConfig((c) => ({
                      ...c,
                      [o.key]: Math.min(o.max, Math.max(o.min, Math.round(Number(e.target.value) || 0))),
                    }))
                  }
                />
              </label>
            ))}
          </div>
        </details>
      )}
      {view.me.isHost ? (
        <button
          type="button"
          className="primary"
          disabled={!playable}
          onClick={() => command({ type: "startGame", gameId: game.id, config })}
        >
          {playable ? "开始" : `需要 ${game.minPlayers}–${game.maxPlayers} 人（当前 ${count} 人）`}
        </button>
      ) : (
        <span className="muted">由房主开始游戏</span>
      )}
    </div>
  );
}
