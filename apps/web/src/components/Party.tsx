import { type Ack, type Command, formatTenths, type PartyPrefs, type RoomView } from "@apr/shared";
import { useEffect, useState } from "react";
import { type PartyListItem, partyApi, type Recap } from "../api.ts";

type Run = (c: Command) => Promise<Ack>;
const signed = (tenths: number) => `${tenths > 0 ? "+" : ""}${formatTenths(tenths)}`;
const time = (ms: number) =>
  new Date(ms).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** Full recap of one party, built by the server from records. */
export function RecapView(props: {
  roomId: string;
  sessionId: string;
  isHost: boolean;
  command: Run;
  onClose(): void;
}) {
  const [recap, setRecap] = useState<Recap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `tick` re-fetches on demand
  useEffect(() => {
    let live = true;
    partyApi
      .recap(props.roomId, props.sessionId)
      .then((r) => live && setRecap(r))
      .catch((e) => live && setError(e instanceof Error ? e.message : "加载失败"));
    return () => {
      live = false;
    };
  }, [props.roomId, props.sessionId, tick]);
  // The AI summary arrives later; look again while it is being written.
  useEffect(() => {
    if (recap?.summary.status !== "pending") return;
    const t = setTimeout(() => setTick((n) => n + 1), 3000);
    return () => clearTimeout(t);
  }, [recap]);

  if (error) return <p className="error">{error}</p>;
  if (!recap) return <p className="muted">正在加载回顾…</p>;
  const name = (id: string) => recap.names[id] ?? "已离开的玩家";
  return (
    <div className="recap">
      <div className="lobby-head">
        <h2>
          第 {recap.number} 场派对回顾{recap.status === "active" ? "（进行中）" : ""}
        </h2>
        <button type="button" onClick={props.onClose}>
          返回大厅
        </button>
      </div>
      <p className="muted small">
        {time(recap.startedAt)} – {recap.endedAt ? time(recap.endedAt) : "现在"}
        {recap.scoring === "raw-v1" && " · 旧计分方式：游戏内得分直接累加（没有名次奖励和调分）"}
      </p>

      <div className="card">
        <strong>最终排名</strong>
        <ol className="standings">
          {recap.ranking.map((r) => (
            <li key={r.playerId} value={r.rank}>
              <span>{name(r.playerId)}</span>
              <strong>{formatTenths(r.tenths)}</strong>
            </li>
          ))}
          {recap.ranking.length === 0 && <li className="muted">这一场没有人得分。</li>}
        </ol>
      </div>

      <div className="card">
        <div className="lobby-head">
          <strong>AI 主持的话</strong>
          {props.isHost && recap.summary.status === "failed" && (
            <button
              type="button"
              onClick={async () => {
                await props.command({ type: "retrySummary", sessionId: recap.sessionId });
                setTick((n) => n + 1);
              }}
            >
              重试
            </button>
          )}
        </div>
        <p className={recap.summary.status === "ok" ? "" : "muted"}>
          {recap.summary.status === "ok"
            ? recap.summary.text
            : recap.summary.status === "pending"
              ? "正在写…（不影响查看下面的记录，也不影响开始新的一场）"
              : recap.summary.status === "failed"
                ? "这次没写出来。下面的记录是完整的。"
                : "没有 AI 总结（未配置模型，或派对还没结束）。下面的记录是完整的。"}
        </p>
      </div>

      <h3>每场游戏</h3>
      {recap.games.length === 0 && <p className="muted">这场派对没有玩完任何游戏。</p>}
      {recap.games.map((g, i) => (
        <div key={g.segmentId} className="card">
          <strong>
            {i + 1}. {g.gameName}
            {g.status === "aborted" && <span className="tag">放弃，不计派对积分</span>}
          </strong>
          {g.raw.length + g.rewards.length > 0 && (
            <table className="results">
              <thead>
                <tr>
                  <th>玩家</th>
                  <th>游戏内成绩</th>
                  {g.rewards.length > 0 && <th>名次</th>}
                  {g.rewards.length > 0 && <th>派对积分</th>}
                </tr>
              </thead>
              <tbody>
                {(g.rewards.length > 0 ? g.rewards.map((r) => r.playerId) : g.raw.map((r) => r.playerId)).map((p) => {
                  const reward = g.rewards.find((r) => r.playerId === p);
                  return (
                    <tr key={p}>
                      <td>{name(p)}</td>
                      <td>{g.raw.find((r) => r.playerId === p)?.points ?? 0}</td>
                      {reward && (
                        <td>
                          {reward.rank}
                          {reward.tied ? "（并列）" : ""}
                        </td>
                      )}
                      {reward && <td>+{formatTenths(reward.tenths)}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {g.note && <p className="muted small">{g.note}</p>}
          {recap.adjustments
            .filter((a) => a.segmentId === g.segmentId)
            .map((a) => (
              <p key={a.reason + a.items.map((x) => x.playerId).join()} className="muted">
                房主批准的{a.kind === "correction" ? "更正" : "派对调整"}（{a.proposedBy} 提出）：
                {a.items.map((x) => `${name(x.playerId)} ${signed(x.tenths)}`).join("、")} —— {a.reason}
              </p>
            ))}
        </div>
      ))}
      {recap.adjustments.filter((a) => a.segmentId === null).length > 0 && (
        <div className="card">
          <strong>游戏之外的派对调整</strong>
          {recap.adjustments
            .filter((a) => a.segmentId === null)
            .map((a) => (
              <p key={a.reason} className="muted">
                {a.approvedBy} 批准（{a.proposedBy} 提出）：
                {a.items.map((x) => `${name(x.playerId)} ${signed(x.tenths)}`).join("、")} —— {a.reason}
              </p>
            ))}
        </div>
      )}

      {recap.timeline.length > 0 && (
        <>
          <h3>积分变化</h3>
          <table className="results">
            <thead>
              <tr>
                <th>发生了什么</th>
                {recap.ranking.map((r) => (
                  <th key={r.playerId}>{name(r.playerId)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recap.timeline.map((t) => (
                <tr key={t.at + t.label}>
                  <td>{t.label}</td>
                  {recap.ranking.map((r) => (
                    <td key={r.playerId}>{formatTenths(t.totals[r.playerId] ?? 0)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {recap.events.length > 0 && (
        <>
          <h3>经过</h3>
          <ul className="facts">
            {recap.events.map((e) => (
              <li key={e.at + e.text}>
                <span className="muted small">{time(e.at)}</span> {e.text}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** The party's preferences: everyone can suggest, the host confirms. Never a prerequisite for playing. */
function Prefs({ view, command }: { view: RoomView; command: Run }) {
  const p = view.prefs;
  const [draft, setDraft] = useState<Pick<PartyPrefs, "familiar" | "want" | "avoid">>({
    familiar: p.familiar,
    want: p.want,
    avoid: p.avoid,
  });
  const [suggestion, setSuggestion] = useState("");
  const name = (id: string) => view.members.find((m) => m.id === id)?.nickname ?? "?";
  const field = (key: "familiar" | "want" | "avoid", label: string, placeholder: string) => (
    <label>
      <span>{label}</span>
      <input
        value={draft[key]}
        maxLength={120}
        placeholder={placeholder}
        disabled={!view.me.isHost}
        onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
      />
    </label>
  );
  return (
    <div className="prefs">
      <div className="options wide">
        {field("familiar", "大家熟悉", "例如：英雄联盟、魂系游戏、某个主播")}
        {field("want", "今天想玩", "例如：换换口味，来点动漫")}
        {field("avoid", "不要出现", "例如：恐怖、工作")}
        <label>
          <span>题目难度</span>
          <select
            value={p.difficulty}
            disabled={!view.me.isHost}
            onChange={(e) =>
              command({ type: "setPrefs", prefs: { difficulty: e.target.value as PartyPrefs["difficulty"] } })
            }
          >
            <option value="easy">轻松</option>
            <option value="normal">正常</option>
            <option value="hard">有挑战</option>
          </select>
        </label>
        <label>
          <span>AI 主持模式</span>
          <select
            value={p.hostMode}
            disabled={!view.me.isHost}
            onChange={(e) =>
              command({ type: "setPrefs", prefs: { hostMode: e.target.value as PartyPrefs["hostMode"] } })
            }
          >
            <option value="quirky">搞怪：敢接梗、敢提离谱方案</option>
            <option value="normal">普通：偏向按原规则来</option>
          </select>
        </label>
      </div>
      {view.me.isHost ? (
        <div className="host-row">
          <button type="button" className="primary" onClick={() => command({ type: "setPrefs", prefs: draft })}>
            保存偏好
          </button>
          <span className="muted small">只影响之后出现的题目，不清积分，不改已经确定的题。</span>
        </div>
      ) : (
        <p className="muted small">偏好由房主确认；你可以在下面提建议。</p>
      )}
      {p.suggestions.length > 0 && (
        <ul className="chips">
          {p.suggestions.map((s) => (
            <li key={s.playerId} className="chip">
              {name(s.playerId)}：{s.text}
            </li>
          ))}
        </ul>
      )}
      <form
        className="answer-row"
        onSubmit={async (e) => {
          e.preventDefault();
          if ((await command({ type: "suggestPrefs", text: suggestion.trim() })).ok) setSuggestion("");
        }}
      >
        <input
          value={suggestion}
          onChange={(e) => setSuggestion(e.target.value)}
          maxLength={120}
          placeholder="我的建议（留空提交 = 撤回）"
        />
        <button type="submit">提建议</button>
      </form>
    </div>
  );
}

/** Lobby header: the current party, its preferences, history and the end-party control. */
export function PartyCard(props: { view: RoomView; command: Run; onOpenRecap(sessionId: string): void }) {
  const { view, command } = props;
  const { party, prefs } = view;
  const [parties, setParties] = useState<PartyListItem[] | null>(null);
  const summary = [
    prefs.want && `想玩 ${prefs.want}`,
    prefs.familiar && `熟悉 ${prefs.familiar}`,
    prefs.avoid && `不要 ${prefs.avoid}`,
  ].filter(Boolean);
  return (
    <div className="card party-card">
      <div className="lobby-head">
        <div>
          <strong>第 {party.number} 场派对 · 进行中</strong>
          <p className="muted small">
            已结算 {party.gamesPlayed} 场游戏 · AI 主持：{prefs.hostMode === "quirky" ? "搞怪" : "普通"}
            {summary.length > 0 ? ` · ${summary.join("，")}` : " · 还没设置偏好（不设也能直接玩）"}
            {party.scoring === "raw-v1" && " · 这一场沿用旧计分方式，结束后新派对改用名次奖励"}
          </p>
        </div>
        {party.lastEndedSessionId && (
          <button type="button" onClick={() => props.onOpenRecap(party.lastEndedSessionId as string)}>
            上一场回顾
          </button>
        )}
      </div>
      <details>
        <summary>调整派对偏好</summary>
        <Prefs view={view} command={command} />
      </details>
      <details
        onToggle={(e) => {
          if (e.currentTarget.open)
            partyApi
              .list(view.room.id)
              .then((r) => setParties(r.parties))
              .catch(() => setParties([]));
        }}
      >
        <summary>历史派对</summary>
        <ul className="history-list">
          {parties === null && <li className="muted">加载中…</li>}
          {parties
            ?.slice()
            .reverse()
            .map((p) => (
              <li key={p.sessionId}>
                <button type="button" className="link" onClick={() => props.onOpenRecap(p.sessionId)}>
                  第 {p.number} 场{p.status === "active" ? "（进行中）" : ""}
                </button>
                <span className="muted small">
                  {time(p.startedAt)} · {p.games} 场游戏
                </span>
              </li>
            ))}
        </ul>
      </details>
      {view.me.isHost && (
        <div className="host-row">
          <button
            type="button"
            onClick={async () => {
              if (!confirm("结束本场派对？成绩会存档并生成回顾，新的一场从零开始。聊天和成员都保留。")) return;
              const ack = await command({ type: "endSession" });
              if (
                !ack.ok &&
                view.adjustments.length > 0 &&
                confirm(`${ack.error}\n\n放弃这些没处理的方案并结束派对？`)
              ) {
                await command({ type: "endSession", discardPending: true });
              }
            }}
          >
            结束本场派对
          </button>
        </div>
      )}
    </div>
  );
}
