import { type Ack, type AdjustmentView, type Command, formatTenths, type RoomView } from "@apr/shared";
import { useState } from "react";
import { draftForAi } from "../chatBus.ts";

type Run = (c: Command) => Promise<Ack>;
const signed = (tenths: number) => `${tenths > 0 ? "+" : ""}${formatTenths(tenths)}`;

/** A pending proposal: who gets what, why, and that it is not in effect yet. */
export function AdjustmentCard(props: { adj: AdjustmentView; view: RoomView; command: Run; inSettlement: boolean }) {
  const { adj, view, command } = props;
  const name = (id: string) => view.members.find((m) => m.id === id)?.nickname ?? "?";
  return (
    <div className="card adjustment">
      <div className="lobby-head">
        <strong>调分方案（待房主确认，尚未生效）</strong>
        <span className="tag">{adj.proposedBy} 提出</span>
      </div>
      <ul className="chips">
        {adj.items.map((i) => (
          <li key={i.playerId} className={i.tenths > 0 ? "chip done" : "chip undercover"}>
            {name(i.playerId)} {signed(i.tenths)}
          </li>
        ))}
      </ul>
      <p className="muted">理由：{adj.reason}</p>
      {view.me.isHost ? (
        <div className="host-row">
          <button
            type="button"
            className="primary"
            onClick={() => command({ type: "decideAdjustment", adjustmentId: adj.id, approve: true })}
          >
            {props.inSettlement ? "批准此方案并结算" : "批准并入账"}
          </button>
          <button
            type="button"
            onClick={() => command({ type: "decideAdjustment", adjustmentId: adj.id, approve: false })}
          >
            取消方案
          </button>
        </div>
      ) : (
        <span className="muted">等待房主决定</span>
      )}
    </div>
  );
}

/** Host-only manual adjustment; works without any AI. */
export function ManualAdjust({ view, command }: { view: RoomView; command: Run }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const items = Object.entries(values)
    .map(([playerId, v]) => ({ playerId, points: Number(v) }))
    .filter((i) => Number.isFinite(i.points) && i.points !== 0);
  return (
    <details className="manual-adjust">
      <summary>手动调分（房主）</summary>
      <div className="options">
        {view.members.map((m) => (
          <label key={m.id}>
            <span>{m.nickname}</span>
            <input
              type="number"
              step="0.5"
              value={values[m.id] ?? ""}
              placeholder="0"
              onChange={(e) => setValues((x) => ({ ...x, [m.id]: e.target.value }))}
            />
          </label>
        ))}
      </div>
      <div className="answer-row">
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={200}
          placeholder="理由（会显示在回顾里）"
        />
        <button
          type="button"
          disabled={items.length === 0 || !reason.trim()}
          onClick={async () => {
            const ack = await command({ type: "proposeAdjustment", items, reason: reason.trim() });
            if (ack.ok) {
              setValues({});
              setReason("");
            }
          }}
        >
          提出方案
        </button>
      </div>
      <p className="muted small">可以是负数。提出后还需要点「批准」才会入账。</p>
    </details>
  );
}

/** Shown when a game is over: raw results, placement, forecast party points; the host confirms once. */
export function SettlementPanel({ view, command }: { view: RoomView; command: Run }) {
  const st = view.settlement;
  if (!st) return null;
  const name = (id: string) => view.members.find((m) => m.id === id)?.nickname ?? "已离开的玩家";
  const proposals = view.adjustments.filter((a) => a.segmentId === st.segmentId);
  return (
    <div className="game">
      <div className="game-head">
        <span className="tag">结算 · {st.gameName}</span>
        <span className="tag">{st.endedReason === "finished" ? "已打完" : "房主提前结束"}</span>
      </div>
      <h2 className="question">这一场的结果</h2>
      <table className="results">
        <thead>
          <tr>
            <th>名次</th>
            <th>玩家</th>
            <th>游戏内成绩</th>
            <th>预计派对积分</th>
          </tr>
        </thead>
        <tbody>
          {st.rows.map((r) => (
            <tr key={r.playerId}>
              <td>
                {r.rank}
                {r.tied ? "（并列）" : ""}
              </td>
              <td>{name(r.playerId)}</td>
              <td>{r.raw}</td>
              <td>
                <strong className="plus">+{formatTenths(r.tenths)}</strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {st.note && <p className="notice">{st.note}</p>}
      <p className="muted">
        上面是预计值，房主确认后才记入右侧的派对积分。想争分、讨价还价？
        <button type="button" className="link" onClick={() => draftForAi("这把我应该加分，因为____")}>
          去右侧找 AI 提方案
        </button>
        ，房主批准才生效。
      </p>
      {proposals.map((adj) => (
        <AdjustmentCard key={adj.id} adj={adj} view={view} command={command} inSettlement />
      ))}
      {view.me.isHost ? (
        <>
          <div className="host-row">
            <button
              type="button"
              className="primary"
              onClick={() => command({ type: "confirmSettlement", segmentId: st.segmentId, adjustmentId: null })}
            >
              {proposals.length > 0 ? "不采纳方案，按默认结果结算" : "接受并返回大厅"}
            </button>
          </div>
          <ManualAdjust view={view} command={command} />
        </>
      ) : (
        <p className="muted">等待房主确认结算…</p>
      )}
    </div>
  );
}
