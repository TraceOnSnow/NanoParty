import { formatTenths, type GameMeta } from "@apr/shared";
import { type FormEvent, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Avatar } from "../components/Avatar.tsx";
import { ChatPanel } from "../components/ChatPanel.tsx";
import { Confetti } from "../components/Confetti.tsx";
import { PickPanel, pickOf } from "../games/PickPanel.tsx";
import { customTopicFields, gameComponents } from "../games/registry.tsx";
import { SCRIPTED_GAMES } from "./bots.ts";
import { CREDITS, GAME_COUNT } from "./catalog.ts";
import { type Seat, Table, type TableOptions } from "./engine.ts";
import phonesClip from "./media/phones.gif";
import { SeedRoom } from "./SeedRoom.tsx";
import { SEED_GAMES } from "./seed.ts";

const REPO_URL = (import.meta.env.VITE_REPO_URL as string | undefined) || "https://github.com/TraceOnSnow/NanoParty";
const coverHue = (id: string) => [...id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 7);
const randomCode = () => String(1000 + Math.floor(Math.random() * 9000));

const DEMO_SEATS: Seat[] = [
  { id: "you", nickname: "你", avatar: "🦊", kind: "human" },
  { id: "s1", nickname: "阿橘", avatar: "🐱", kind: "script" },
  { id: "s2", nickname: "大鹅", avatar: "🦆", kind: "script" },
  { id: "s3", nickname: "老潘", avatar: "🐼", kind: "script" },
];

type Screen = { at: "home" } | { at: "demo"; options: TableOptions } | { at: "seed"; code: string; players: number };

/** A room link looks like `#r=8270&n=4`: opening it puts a phone straight into that room. */
function roomFromHash(): Screen {
  const q = new URLSearchParams(location.hash.slice(1));
  const code = (q.get("r") ?? "").slice(0, 12);
  const players = Number(q.get("n"));
  return code && Number.isInteger(players) && players >= 2 && players <= 12
    ? { at: "seed", code, players }
    : { at: "home" };
}

export function StaticApp() {
  const [screen, setScreen] = useState<Screen>(roomFromHash);
  useEffect(() => {
    const hash = screen.at === "seed" ? `#r=${encodeURIComponent(screen.code)}&n=${screen.players}` : "";
    if (location.hash !== hash) history.replaceState(null, "", hash || location.pathname + location.search);
  }, [screen]);
  const home = () => setScreen({ at: "home" });
  if (screen.at === "demo") return <TableScreen key={screen.options.code} options={screen.options} onExit={home} />;
  if (screen.at === "seed") return <SeedRoom code={screen.code} players={screen.players} onExit={home} />;
  return <Landing go={setScreen} />;
}

// ------------------------------------------------------------------ landing

function Landing({ go }: { go(screen: Screen): void }) {
  const [players, setPlayers] = useState(4);
  const [code, setCode] = useState("");

  function enter(e: FormEvent) {
    e.preventDefault();
    go({ at: "seed", code: code.trim() || randomCode(), players });
  }

  return (
    <main className="static-landing">
      <header className="static-hero">
        <h1>NanoParty</h1>
        <p>朋友聚会用的小游戏房间：{GAME_COUNT} 款自制派对游戏，一个会接话的 AI 主持。</p>
        <p className="static-note">
          这个页面是不需要服务器的试玩版：不联网、不传数据，也没有真的 AI。完整版要自己部署，朋友各用各的手机加入。
          {REPO_URL && (
            <>
              {" "}
              <a href={REPO_URL} target="_blank" rel="noreferrer">
                源码和部署说明
              </a>
            </>
          )}
        </p>
      </header>

      <form className="card static-mode" onSubmit={enter}>
        <h2>线下开一桌</h2>
        <p>
          大家各拿各的手机，输入同一个房间号，看到的就是同一套题；需要保密的词和身份，每台手机只显示自己那一份。游戏由你们自己当面进行，页面只负责出题和发身份。
        </p>
        <label className="static-row">
          <span>房间号</span>
          <input
            value={code}
            maxLength={12}
            placeholder="随便起一个，如 8270"
            aria-label="房间号"
            onChange={(e) => setCode(e.target.value)}
          />
          <button type="button" onClick={() => setCode(randomCode())}>
            随机一个
          </button>
        </label>
        <div className="static-row">
          <span>人数</span>
          <div className="static-count">
            {[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => (
              <button key={n} type="button" className={n === players ? "on" : ""} onClick={() => setPlayers(n)}>
                {n}
              </button>
            ))}
          </div>
        </div>
        <p className="muted small">
          房间号和人数是「种子」，所有人填的必须一样。不留空就用你填的号；留空会随机给一个，记得念给大家。可玩{" "}
          {SEED_GAMES.length} 款。
        </p>
        <button type="submit" className="primary">
          进入房间
        </button>
      </form>

      <section className="card static-mode">
        <h2>看演示</h2>
        <p>一个人也能看：你和三个脚本玩家坐一桌，主持念的是提前写好的台词。用来感受联机版的一局是什么样子。</p>
        <p className="muted small">
          可玩 {SCRIPTED_GAMES.length} 款：脚本玩家会出牌、会报数、会乱写答案，但不会真的动脑子。
        </p>
        <button
          type="button"
          onClick={() =>
            go({
              at: "demo",
              options: { mode: "demo", code: randomCode(), seats: DEMO_SEATS, gameIds: SCRIPTED_GAMES },
            })
          }
        >
          进入演示房间
        </button>
      </section>

      <section className="card static-about">
        <h2>完整版长什么样</h2>
        <img
          src={phonesClip}
          alt="四台手机在同一个房间里玩吹牛骰子：叫数是公开的，每台手机只显示自己的骰子"
          loading="lazy"
          width={1200}
          height={585}
        />
        <p>
          完整版里每个人用自己的手机或电脑进同一个房间：公共信息所有人一样，自己的骰子、手牌和身份只在自己屏幕上。一共{" "}
          {GAME_COUNT} 款游戏，旁边可以有一个真的 AI 主持接话、出题、当裁判；不配 AI 也都能玩。
        </p>
        <h3>怎么做的</h3>
        <ul>
          <li>每款游戏是一段确定性的规则：不联网、不读时钟、不调用模型，所以能直接搬进这个静态页面里跑。</li>
          <li>秘密只留在服务端，每个人只收到自己该看到的那一份；每款有秘密的游戏都带一条「别人看不到」的测试。</li>
          <li>AI 主持只能通过一组受控工具行动，改不了规则，也动不了成绩。</li>
          <li>状态先写数据库再生效，掉线重连、服务重启之后都能接着玩。</li>
        </ul>
        <p>
          <a href={REPO_URL} target="_blank" rel="noreferrer">
            源码、设计说明和部署方法在 GitHub
          </a>
        </p>
      </section>

      <details className="card static-credits">
        <summary>题库来源</summary>
        <ul>
          {CREDITS.map((c) => (
            <li key={c.source}>
              {c.source}（{c.count} 条）
            </li>
          ))}
        </ul>
        <p className="muted small">事实类题目（估数字、真假难辨）没有逐条核查，答案仅供娱乐。</p>
      </details>
    </main>
  );
}

// ------------------------------------------------------------------ table

function TableScreen({ options, onExit }: { options: TableOptions; onExit(): void }) {
  // Made in an effect, not during render: the table owns timers and must be disposed exactly once.
  const [table, setTable] = useState<Table | null>(null);
  useEffect(() => {
    const made = new Table(options);
    setTable(made);
    return () => made.dispose();
  }, [options]);
  return table ? <TableView table={table} onExit={onExit} /> : null;
}

function TableView({ table, onExit }: { table: Table; onExit(): void }) {
  useSyncExternalStore(table.subscribe, table.getVersion);
  const view = table.roomView();
  const segment = view.segment;
  const result = table.result;
  const live = table.segmentLive;
  // Phones show one panel at a time, as in the real room.
  const [tab, setTab] = useState<"game" | "chat">("game");
  const seen = useRef(0);
  if (tab === "chat") seen.current = table.chat.length;
  const unread = Math.max(0, table.chat.length - seen.current);
  // A refresh would throw the table away; ask first while a game is on.
  useEffect(() => {
    if (!live) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [live]);
  const Game = segment ? gameComponents[segment.gameId] : undefined;
  const meta = segment ? view.games.find((g) => g.id === segment.gameId) : undefined;
  const name = (id: string) => view.members.find((m) => m.id === id)?.nickname ?? "?";
  const act = async (action: unknown) => table.act(table.viewer, action);
  // The final table of these games is worth seeing next to the result.
  const showFinal = segment && (live || ["seven", "platter"].includes(segment.gameId));

  return (
    <div className={`room static-room tab-${tab}`}>
      <header className="room-bar">
        <strong>{view.room.name}</strong>
        {meta && <span className="tag">{meta.name}</span>}
        <span className="tag static-tag">演示 · 脚本玩家</span>
        <span className="spacer" />
        {live && (
          <button type="button" onClick={() => confirm("结束这一局？已经完成的回合照常结算。") && table.leaveGame()}>
            结束这局
          </button>
        )}
        <button type="button" onClick={() => confirm("离开这个房间？这里的进度不会保存。") && onExit()}>
          退出
        </button>
      </header>

      <section className="main-panel">
        {segment && Game ? (
          <>
            {showFinal &&
              (pickOf(segment.view) ? (
                <PickPanel
                  key={`${segment.id}:${table.viewer}`}
                  view={segment.view}
                  room={view}
                  paused={false}
                  act={act}
                  fields={customTopicFields[segment.gameId] ?? []}
                />
              ) : (
                <Game key={`${segment.id}:${table.viewer}`} view={segment.view} room={view} paused={false} act={act} />
              ))}
            {live && segment.rawScores.length > 0 && (
              <p className="muted small raw-scores">
                本局游戏内得分（结算后按名次换成派对积分）：
                {segment.rawScores.map((s) => `${name(s.playerId)} ${s.points}`).join("　")}
              </p>
            )}
            {result && (
              <div className="game">
                {result.rows.some((r) => r.tenths > 0) && <Confetti key={segment.id} />}
                <div className="game-head">
                  <span className="tag">结算 · {result.gameName}</span>
                </div>
                <h2 className="question">这一场的结果</h2>
                <table className="results">
                  <thead>
                    <tr>
                      <th>名次</th>
                      <th>玩家</th>
                      <th>游戏内成绩</th>
                      <th>派对积分</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((r) => (
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
                {result.note && <p className="notice">{result.note}</p>}
                <div className="host-row">
                  <button type="button" className="primary" onClick={() => table.start(result.gameId)}>
                    再来一局
                  </button>
                  <button type="button" onClick={() => table.toLobby()}>
                    换个游戏
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <GameList
            metas={view.games}
            seats={view.members.length}
            onStart={(id) => {
              const ack = table.start(id);
              return ack.ok ? null : ack.error;
            }}
          />
        )}
      </section>

      <aside className="side-panel">
        <div className="scoreboard">
          <h3>派对积分</h3>
          <ul>
            {view.scoreboard.map((s) => {
              const top = Math.max(...view.scoreboard.map((x) => x.points), 0);
              return (
                <li key={s.playerId} className={s.playerId === table.viewer ? "me" : ""}>
                  <Avatar room={view} id={s.playerId} />
                  <span className="nick">
                    {name(s.playerId)}
                    {s.playerId === table.viewer && <span className="tag">我</span>}
                    {s.playerId !== table.viewer && <span className="tag">脚本</span>}
                  </span>
                  {top > 0 && s.points === top && <span className="crown">👑</span>}
                  <strong>{s.points}</strong>
                </li>
              );
            })}
          </ul>
        </div>
        <ChatPanel view={view} chat={table.chat} say={async (text, askAi) => table.say(text, askAi === true)} />
      </aside>

      <nav className="room-tabs">
        <button type="button" className={tab === "game" ? "on" : ""} onClick={() => setTab("game")}>
          {meta?.name ?? "选游戏"}
        </button>
        <button type="button" className={tab === "chat" ? "on" : ""} onClick={() => setTab("chat")}>
          聊天和积分
          {unread > 0 && <span className="badge">{unread > 99 ? "99+" : unread}</span>}
        </button>
      </nav>
    </div>
  );
}

function GameList(props: { metas: GameMeta[]; seats: number; onStart(id: string): string | null }) {
  const { metas, seats, onStart } = props;
  const [chosen, setChosen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fits = (g: GameMeta) => seats >= g.minPlayers && seats <= g.maxPlayers;
  const game = metas.find((g) => g.id === chosen);
  return (
    <div className="lobby">
      <div className="lobby-head">
        <h2>挑一个游戏</h2>
        <span className="muted small">
          {seats} 人桌 · {metas.filter(fits).length} 款可玩
        </span>
      </div>
      <div className="game-list">
        {metas.map((g) => (
          <button
            key={g.id}
            type="button"
            className={`game-tile${g.id === chosen ? " chosen" : ""}${fits(g) ? "" : " unfit"}`}
            style={{ "--hue": coverHue(g.id) } as React.CSSProperties}
            onClick={() => {
              setChosen(g.id === chosen ? null : g.id);
              setError(null);
            }}
          >
            <span className="cover-glyph">{[...g.name][0]}</span>
            <span className="cover-name">{g.name}</span>
            <span className="tile-meta">
              {g.minPlayers}–{g.maxPlayers} 人{g.contentType ? " · 有题库" : ""}
            </span>
          </button>
        ))}
      </div>
      {game ? (
        <div className="card game-detail">
          <div className="lobby-head">
            <h2>{game.name}</h2>
            <button type="button" className="primary" disabled={!fits(game)} onClick={() => setError(onStart(game.id))}>
              {fits(game) ? "开始" : `需要 ${game.minPlayers}–${game.maxPlayers} 人（当前 ${seats} 人）`}
            </button>
          </div>
          <p>{game.description}</p>
          <p className="muted small">{game.rulesSummary}</p>
          <p className="muted small">{game.scoringSummary}</p>
          {error && <p className="error">{error}</p>}
        </div>
      ) : (
        <p className="muted">点一个游戏看规则和开始。</p>
      )}
    </div>
  );
}
