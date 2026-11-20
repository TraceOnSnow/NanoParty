import { MELD_COLORS, MELD_OPENING, type MeldTile, meldFindSets, meldHandValue, meldShape } from "@apr/games";
import { useEffect, useState } from "react";
import type { GameProps } from "../registry.tsx";
import { useAct } from "../shared.ts";
import { Seats } from "../table.tsx";
import { GameHead, HostControls, useNames } from "../ui.tsx";

type Event =
  | { kind: "meld"; by: string; count: number; opening: boolean }
  | { kind: "draw"; by: string }
  | { kind: "pass"; by: string };
interface View {
  step: number;
  phase: "play" | "gameOver" | "finished";
  players: string[];
  current: string;
  table: MeldTile[][];
  myHand: MeldTile[] | null;
  counts: Record<string, number>;
  poolLeft: number;
  opened: Record<string, boolean>;
  lastPlayed: string[];
  log: Event[];
  ended: "out" | "stuck" | null;
  winners: string[];
  hands: Record<string, MeldTile[]> | null;
  deadlineAt: number | null;
}

const TONE: Record<string, string> = { 红: "red", 蓝: "blue", 黄: "yellow", 黑: "black", "": "wild" };
const colorRank = (t: MeldTile) => (t.n === 0 ? 9 : MELD_COLORS.indexOf(t.color));
const byColor = (a: MeldTile, b: MeldTile) => colorRank(a) - colorRank(b) || a.n - b.n;
const byNumber = (a: MeldTile, b: MeldTile) => (a.n || 99) - (b.n || 99) || colorRank(a) - colorRank(b);

function Tile(props: { tile: MeldTile; mark?: string; onPick?: () => void }) {
  const { tile } = props;
  const cls = `meld-tile ${TONE[tile.color]}${props.mark ? ` ${props.mark}` : ""}`;
  const face = tile.n === 0 ? "★" : tile.n;
  return props.onPick ? (
    <button
      type="button"
      className={cls}
      onClick={props.onPick}
      aria-label={tile.n === 0 ? "百搭" : `${tile.color}${tile.n}`}
    >
      {face}
    </button>
  ) : (
    <span className={cls}>{face}</span>
  );
}

export function MeldGame({ view, room, paused, act }: GameProps) {
  const v = view as View;
  const name = useNames(room);
  const me = room.me.playerId;
  const { error, setError, send } = useAct(act);
  const live = v.phase === "play";
  const myTurn = live && v.current === me && !paused;
  const opened = v.opened[me] ?? false;

  /** The table as this player is rearranging it, as tile ids; only sent on confirm. */
  const [draft, setDraft] = useState<string[][]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [sort, setSort] = useState<"color" | "number">("color");
  const reset = () => {
    setDraft(v.table.map((set) => set.map((t) => t.id)));
    setPicked([]);
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new step is a new table
  useEffect(reset, [v.step]);

  const known = new Map([...v.table.flat(), ...(v.myHand ?? [])].map((t) => [t.id, t]));
  const tilesOf = (ids: string[]) => ids.flatMap((id) => known.get(id) ?? []);
  const onTable = new Set(v.table.flat().map((t) => t.id));
  const sets = myTurn ? draft : v.table.map((set) => set.map((t) => t.id));
  const placed = new Set(sets.flat());
  const hand = (v.myHand ?? []).filter((t) => !myTurn || !placed.has(t.id)).sort(sort === "color" ? byColor : byNumber);
  const shapes = sets.map((ids) => meldShape(tilesOf(ids)));
  const played = sets.flat().filter((id) => !onTable.has(id)).length;
  /** Points in the sets built only from this player's own tiles: what counts towards opening. */
  const ownValue = sets.reduce(
    (sum, ids, i) => sum + (ids.some((id) => onTable.has(id)) ? 0 : (shapes[i]?.value ?? 0)),
    0,
  );
  const blocker = shapes.some((s) => !s)
    ? "还有不成立的组（红框）"
    : played === 0
      ? "还没出自己的牌"
      : !opened && ownValue < MELD_OPENING
        ? `第一次出牌要 ${MELD_OPENING} 点，现在 ${ownValue} 点`
        : null;

  const toggle = (id: string) => setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);
  function move(target: number | "new" | "hand") {
    if (target === "hand" && picked.some((id) => onTable.has(id))) return setError("桌上原有的牌不能收回手里");
    const next = draft.map((set) => set.filter((id) => !picked.includes(id)));
    if (target === "new") next.push([...picked]);
    else if (target !== "hand") next[target] = [...(next[target] ?? []), ...picked];
    setDraft(next.filter((set) => set.length > 0));
    setPicked([]);
  }
  function suggest() {
    const found = meldFindSets(hand);
    if (found.length === 0) return setError("手里没有现成的三张一组，试试拆桌上的牌，或者摸一张");
    setDraft([...draft, ...found.map((set) => set.map((t) => t.id))]);
    setPicked([]);
  }

  const line = (e: Event) =>
    e.kind === "meld"
      ? `${name(e.by)} ${e.opening ? "破冰，" : ""}出了 ${e.count} 张牌`
      : e.kind === "draw"
        ? `${name(e.by)} 摸了一张牌`
        : `${name(e.by)} 出不了牌，过`;

  return (
    <div className="game wide meld">
      <GameHead label={`牌堆 ${v.poolLeft} 张`} deadlineAt={live ? v.deadlineAt : null} paused={paused} />
      <Seats room={room} ids={v.players} current={live ? v.current : null} win={v.winners}>
        {(p) =>
          v.hands ? (
            <>
              {[...(v.hands[p] ?? [])].sort(byColor).map((t) => (
                <Tile key={t.id} tile={t} mark="small" />
              ))}
              <span className="muted small">
                {(v.hands[p] ?? []).length === 0 ? "出完了" : `剩 ${meldHandValue(v.hands[p] ?? [])} 点`}
              </span>
            </>
          ) : (
            <span className="muted small">
              {v.counts[p]} 张{v.opened[p] ? "" : " · 还没破冰"}
            </span>
          )
        }
      </Seats>

      <div className="meld-table">
        {sets.length === 0 && <span className="muted">桌上还没有牌。</span>}
        {sets.map((ids, i) => {
          const shape = shapes[i];
          // A valid set is shown in order; one still being built keeps the order it was put in.
          const shown = shape ? shape.tiles : tilesOf(ids);
          return (
            <div key={ids.join()} className={`meld-set${shape ? "" : " bad"}`}>
              {shown.map((t) => (
                <Tile
                  key={t.id}
                  tile={t}
                  mark={
                    picked.includes(t.id)
                      ? "picked"
                      : (myTurn ? !onTable.has(t.id) : v.lastPlayed.includes(t.id))
                        ? "fresh"
                        : undefined
                  }
                  onPick={myTurn ? () => toggle(t.id) : undefined}
                />
              ))}
              {myTurn && picked.length > 0 && (
                <button type="button" className="meld-drop" onClick={() => move(i)}>
                  放这
                </button>
              )}
            </div>
          );
        })}
        {myTurn && picked.length > 0 && (
          <button type="button" className="meld-drop new" onClick={() => move("new")}>
            ＋ 另起一组
          </button>
        )}
      </div>

      {live && (
        <p className="muted">
          {myTurn
            ? opened
              ? "轮到你：点牌选中（手里的、桌上的都行），再点「放这」或「另起一组」。桌上的牌可以随便拆，最后每组都成立就行。"
              : `轮到你：第一次出牌只能用自己的牌另起几组，合计至少 ${MELD_OPENING} 点；出不了就摸一张。`
            : `等 ${name(v.current)} 出牌…`}
        </p>
      )}
      {myTurn && (
        <div className="host-row">
          <button
            type="button"
            className="primary"
            disabled={blocker !== null}
            onClick={() => send({ type: "meld", sets: draft, step: v.step })}
          >
            {blocker ?? `出牌（${played} 张）`}
          </button>
          <button type="button" onClick={() => send({ type: "draw", step: v.step })}>
            {v.poolLeft > 0 ? "不出，摸一张" : "出不了，过"}
          </button>
          {(played > 0 || picked.length > 0) && (
            <button type="button" onClick={reset}>
              重来
            </button>
          )}
          <button type="button" onClick={suggest}>
            帮我找现成的组
          </button>
        </div>
      )}

      {v.myHand && live && (
        <div className="meld-rack">
          <div className="host-row">
            <span className="muted small">
              你的牌（{hand.length} 张）{!opened && myTurn && ownValue > 0 ? ` · 已摆 ${ownValue} 点` : ""}
            </span>
            <button type="button" className="small" onClick={() => setSort(sort === "color" ? "number" : "color")}>
              {sort === "color" ? "按数字排" : "按颜色排"}
            </button>
            {myTurn && picked.some((id) => placed.has(id)) && (
              <button type="button" className="small" onClick={() => move("hand")}>
                收回手里
              </button>
            )}
          </div>
          <div className="meld-hand">
            {hand.map((t) => (
              <Tile
                key={t.id}
                tile={t}
                mark={picked.includes(t.id) ? "picked" : undefined}
                onPick={myTurn ? () => toggle(t.id) : undefined}
              />
            ))}
            {hand.length === 0 && <span className="muted">手里的牌都摆上去了。</span>}
          </div>
        </div>
      )}

      <ul className="flip-log">
        {[...v.log]
          .reverse()
          .slice(0, 3)
          .map((e, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a short rolling log
            <li key={i} className={i === 0 ? "" : "muted small"}>
              {line(e)}
            </li>
          ))}
      </ul>
      {v.phase === "gameOver" && (
        <p className="answer">
          {v.ended === "out"
            ? `${v.winners.map(name).join("、")} 出完了手牌，获胜！`
            : `牌堆空了，谁也出不了牌：${v.winners.map(name).join("、")} 手里点数最少，获胜。`}
        </p>
      )}
      <HostControls isHost={room.me.isHost} waitNote={v.phase === "gameOver" ? "等待房主结束…" : undefined}>
        {v.phase === "gameOver" && (
          <button
            type="button"
            className="primary"
            disabled={paused}
            onClick={() => send({ type: "next", step: v.step })}
          >
            结束并回到大厅
          </button>
        )}
      </HostControls>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
