import type { Ack, Command, GameMeta, RoomView } from "@apr/shared";
import { useState } from "react";
import { PartyCard, RecapView } from "./Party.tsx";
import { AdjustmentCard, ManualAdjust } from "./Settlement.tsx";

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
  const [recap, setRecap] = useState<string | null>(null);

  if (recap) {
    return (
      <RecapView
        roomId={view.room.id}
        sessionId={recap}
        isHost={me.isHost}
        command={command}
        onClose={() => setRecap(null)}
      />
    );
  }
  return (
    <div className="lobby">
      {view.adjustments.map((adj) => (
        <AdjustmentCard key={adj.id} adj={adj} view={view} command={command} inSettlement={false} />
      ))}
      {lastSegment && (
        <div className="card">
          <strong>
            上一局：{lastSegment.gameName}
            {lastSegment.endedReason === "aborted" ? "（已放弃，不计派对积分）" : ""}
          </strong>
          <p className="muted">
            {lastSegment.endedReason === "aborted"
              ? "这一局没有结算。"
              : lastSegment.scores.length > 0
                ? `派对积分：${lastSegment.scores.map((s) => `${name(s.playerId)} +${s.points}`).join("　")}`
                : "这一局没有人得分。"}
          </p>
        </div>
      )}

      {suggestion && suggested && (
        <div className="card suggestion">
          <div>
            <strong>AI 主持推荐：{suggested.alias ?? suggested.name}</strong>
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
      <GamePicker view={view} command={command} />

      <h2 className="lobby-section">派对与房间</h2>
      <PartyCard view={view} command={command} onOpenRecap={setRecap} />
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

      {me.isHost && (
        <details className="card">
          <summary>
            <strong>房主管理</strong>
          </summary>
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
                      confirm(`把房主身份转交给 ${m.nickname}？之后由 TA 开始和结束游戏。`) &&
                      command({ type: "transferHost", playerId: m.id })
                    }
                  >
                    设为房主
                  </button>
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
            {members.length === 1 && <li className="muted">还没有其他成员。</li>}
          </ul>
          {view.party.scoring === "rank-v1" && <ManualAdjust view={view} command={command} />}
        </details>
      )}
    </div>
  );
}

/** A stable colour per game for its cover (self-made covers: a colour field and the game's first character). */
const coverHue = (id: string) => [...id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 7);

/** All games as compact tiles; the chosen one opens below the grid with its rules, settings and the start button. */
function GamePicker({ view, command }: Props) {
  const [chosen, setChosen] = useState<string | null>(null);
  const count = view.members.length;
  const fits = (g: GameMeta) => count >= g.minPlayers && count <= g.maxPlayers;
  const game = view.games.find((g) => g.id === chosen);
  return (
    <>
      <div className="game-list">
        {view.games.map((g) => (
          <button
            key={g.id}
            type="button"
            className={`game-tile${g.id === chosen ? " chosen" : ""}${fits(g) ? "" : " unfit"}`}
            style={{ "--hue": coverHue(g.id) } as React.CSSProperties}
            onClick={() => setChosen(g.id === chosen ? null : g.id)}
          >
            <span className="cover-glyph">{[...g.name][0]}</span>
            <span className="cover-name">{g.alias ?? g.name}</span>
            {g.note && <span className="tile-note">{g.note}</span>}
            <span className="tile-meta">
              {g.minPlayers}–{g.maxPlayers} 人{g.aiOption ? " · AI 主持" : g.contentType ? " · 有题库" : ""}
            </span>
          </button>
        ))}
      </div>
      {game ? (
        <GameDetail key={game.id} game={game} view={view} command={command} playable={fits(game)} />
      ) : (
        <p className="muted">点一个游戏看规则{view.me.isHost ? "和开始" : ""}。</p>
      )}
    </>
  );
}

function GameDetail(props: { game: GameMeta; view: RoomView; command: Props["command"]; playable: boolean }) {
  const { game, view, command, playable } = props;
  const count = view.members.length;
  const [config, setConfig] = useState<Record<string, number>>(() =>
    Object.fromEntries((game.options ?? []).map((o) => [o.key, o.default])),
  );
  return (
    <div className="card game-detail">
      <div className="lobby-head">
        <h2>
          {game.alias ?? game.name}
          {game.note && <span className="tag">{game.note}</span>}
        </h2>
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
      <p>{game.description}</p>
      <p className="muted small">{game.rulesSummary}</p>
      <p className="muted small">{game.scoringSummary}</p>
      {view.me.isHost && game.options && game.options.length > 0 && (
        <>
          <div className="options">
            {game.options.map((o) => (
              // biome-ignore lint/a11y/noLabelWithoutControl: the control is one of the two inputs below
              <label key={o.key}>
                <span>
                  {o.label}
                  {o.hint && <span className="muted">（{o.hint}）</span>}
                </span>
                {o.min === 0 && o.max === 1 ? (
                  <input
                    type="checkbox"
                    checked={(config[o.key] ?? o.default) === 1}
                    disabled={o.key === game.aiOption && !view.ai.enabled}
                    title={o.key === game.aiOption && !view.ai.enabled ? "没有配置 AI 模型" : ""}
                    onChange={(e) => setConfig((c) => ({ ...c, [o.key]: e.target.checked ? 1 : 0 }))}
                  />
                ) : (
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
                )}
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
