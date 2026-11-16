import { games } from "@apr/games";
import { useState } from "react";
import { type Block, type DealInput, type Owner, SEED_GAMES, type SeedGame } from "./seed.ts";

const coverHue = (id: string) => [...id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 7);
const nameOf = (g: SeedGame) => games[g.id]?.meta.name ?? g.name;
const TEAMS = ["红队", "蓝队"] as const;
const OWNER_LABEL: Record<Owner, string> = { red: "红", blue: "蓝", neutral: "路人", trap: "陷阱" };

/**
 * A room that exists only as a code: every phone that enters the same code (and the same
 * number of players) is dealt the same topics and matching secrets. Nothing leaves the phone.
 */
export function SeedRoom({ code, players, onExit }: { code: string; players: number; onExit(): void }) {
  const [gameId, setGameId] = useState<string | null>(null);
  const game = SEED_GAMES.find((g) => g.id === gameId);
  return (
    <div className="seed-room">
      <header className="room-bar">
        <strong>房间 {code}</strong>
        <span className="tag static-tag">{players} 人</span>
        {game && <span className="tag">{nameOf(game)}</span>}
        <span className="spacer" />
        {game && (
          <button type="button" onClick={() => setGameId(null)}>
            换游戏
          </button>
        )}
        <button type="button" onClick={onExit}>
          退出
        </button>
      </header>
      <main className="seed-main">
        {game ? (
          <SeedTable key={game.id} game={game} code={code} players={players} />
        ) : (
          <>
            <p className="seed-check">
              所有人输入同一个房间号 <b>{code}</b> 和同样的人数 <b>{players}</b>
              ，看到的题目就是同一套。手机之间不联网：谁出局、谁得分，大家当面说了算。
            </p>
            <ShareLink />
            <div className="game-list">
              {SEED_GAMES.map((g) => {
                const fits = players >= g.minPlayers && players <= g.maxPlayers;
                return (
                  <button
                    key={g.id}
                    type="button"
                    className={`game-tile${fits ? "" : " unfit"}`}
                    style={{ "--hue": coverHue(g.id) } as React.CSSProperties}
                    disabled={!fits}
                    onClick={() => setGameId(g.id)}
                  >
                    <span className="cover-glyph">{[...nameOf(g)][0]}</span>
                    <span className="cover-name">{nameOf(g)}</span>
                    <span className="tile-meta">
                      {g.minPlayers} 人起
                      {g.needs.includes("seat")
                        ? " · 每人选座位号"
                        : g.needs.length
                          ? " · 每人选身份"
                          : " · 大家看同一题"}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function SeedTable({ game, code, players }: { game: SeedGame; code: string; players: number }) {
  const [round, setRound] = useState(1);
  const [seat, setSeat] = useState<number | null>(null);
  const [team, setTeam] = useState<0 | 1 | null>(null);
  const [captain, setCaptain] = useState<boolean | null>(null);
  const needSeat = game.needs.includes("seat") && seat === null;
  const needTeam = game.needs.includes("team") && team === null;
  const needCaptain = game.needs.includes("captain") && captain === null;
  const ready = !needSeat && !needTeam && !needCaptain;
  const input: DealInput = { code, round, players, seat: seat ?? 1, team: team ?? 0, captain: captain ?? false };
  const me = [
    seat !== null && game.needs.includes("seat") ? `${seat} 号` : null,
    team !== null && game.needs.includes("team") ? TEAMS[team] : null,
    captain !== null && game.needs.includes("captain") ? (captain ? "队长" : "队员") : null,
  ].filter(Boolean);

  return (
    <div className="game seed-table">
      <div className="game-head">
        <span className="tag">
          第 {round} {game.unit}
        </span>
        {me.length > 0 && (
          <button
            type="button"
            className="link"
            onClick={() => {
              setSeat(null);
              setTeam(null);
              setCaptain(null);
            }}
          >
            我是 {me.join(" · ")}（改）
          </button>
        )}
      </div>
      <details className="seed-how" open={round === 1 && !ready}>
        <summary>怎么玩</summary>
        <p>{game.how}</p>
      </details>

      {needSeat && (
        <div className="seed-ask">
          <h3>你是几号？</h3>
          <p className="muted small">大家先按座位报数，每人一个号，不能重复。</p>
          <div className="static-count">
            {Array.from({ length: players }, (_, k) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: seats are fixed positions
              <button key={k} type="button" onClick={() => setSeat(k + 1)}>
                {k + 1}
              </button>
            ))}
          </div>
        </div>
      )}
      {!needSeat && needTeam && (
        <div className="seed-ask">
          <h3>你是哪一队？</h3>
          <div className="static-count">
            <button type="button" className="team-red" onClick={() => setTeam(0)}>
              红队
            </button>
            <button type="button" className="team-blue" onClick={() => setTeam(1)}>
              蓝队
            </button>
          </div>
        </div>
      )}
      {!needSeat && !needTeam && needCaptain && (
        <div className="seed-ask">
          <h3>你是队长还是队员？</h3>
          <p className="muted small">队长能看到每个词属于谁，队员看不到。请自觉选择。</p>
          <div className="static-count">
            <button type="button" onClick={() => setCaptain(true)}>
              我是队长
            </button>
            <button type="button" onClick={() => setCaptain(false)}>
              我是队员
            </button>
          </div>
        </div>
      )}

      {ready && (
        <>
          <Blocks key={round} blocks={game.deal(input)} />
          <div className="seed-nav">
            <button type="button" disabled={round <= 1} onClick={() => setRound((r) => r - 1)}>
              上一{game.unit}
            </button>
            <span className="muted small">
              所有人一起翻到第 {round + 1} {game.unit}
            </span>
            <button type="button" className="primary" onClick={() => setRound((r) => r + 1)}>
              下一{game.unit}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <div className="seed-blocks">
      {blocks.map((b, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a deal is a fixed list
        <BlockView key={i} block={b} />
      ))}
    </div>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case "line":
      return (
        <div className="seed-line">
          {block.label && <span className="muted small">{block.label}</span>}
          {block.big ? <strong className="seed-big">{block.text}</strong> : <p>{block.text}</p>}
        </div>
      );
    case "list": {
      const List = block.numbered ? "ol" : "ul";
      return (
        <div className="seed-line">
          {block.label && <span className="muted small">{block.label}</span>}
          <List className={`seed-list${block.struck ? " struck" : ""}`}>
            {block.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </List>
        </div>
      );
    }
    case "scale":
      return (
        <div className="seed-scale">
          <div className="seed-scale-ends">
            <span>0 · {block.left}</span>
            <span>{block.right} · 100</span>
          </div>
          <div className="seed-scale-bar">{block.target !== null && <i style={{ left: `${block.target}%` }} />}</div>
          {block.target !== null && <strong className="seed-big">{block.target}</strong>}
        </div>
      );
    case "grid":
      return <Grid words={block.words} owners={block.owners} showAll={block.showAll} />;
    case "secret":
      return <Secret label={block.label} who={block.who} body={block.body} />;
  }
}

/** Covered until tapped, and covered again with one more tap, so a phone can lie on the table. */
function Secret({ label, who, body }: { label: string; who: string; body: Block[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`seed-secret${open ? " open" : ""}`}>
      <button type="button" className="seed-secret-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <strong>{label}</strong>
        <span>{open ? "点这里盖上" : "点这里翻开"}</span>
      </button>
      {open ? <Blocks blocks={body} /> : <p className="seed-who">{who}</p>}
    </div>
  );
}

/**
 * The word grid. A captain's phone shows every owner. A member's phone shows a word's owner
 * only after the member marks it as called — the table decides when, the phone just keeps notes.
 */
function Grid({ words, owners, showAll }: { words: string[]; owners: Owner[]; showAll: boolean }) {
  const [marked, setMarked] = useState<number[]>([]);
  const [asking, setAsking] = useState<number | null>(null);
  const left = (o: Owner) => owners.filter((x, i) => x === o && !marked.includes(i)).length;
  return (
    <div className="seed-grid-wrap">
      <p className="muted small">
        还没指到：红 {left("red")} · 蓝 {left("blue")}
        {showAll ? "　点一个词给它打上「已指到」的记号。" : "　有人指了一个词，就点它翻开。"}
      </p>
      <div className="seed-grid">
        {words.map((w, i) => {
          const seen = showAll || marked.includes(i);
          const owner = owners[i] as Owner;
          return (
            <button
              key={w}
              type="button"
              className={`seed-cell${seen ? ` own-${owner}` : ""}${marked.includes(i) ? " marked" : ""}`}
              onClick={() => {
                if (marked.includes(i)) setMarked((m) => m.filter((x) => x !== i));
                else if (showAll) setMarked((m) => [...m, i]);
                else setAsking(i);
              }}
            >
              <span>{w}</span>
              {seen && <em>{OWNER_LABEL[owner]}</em>}
            </button>
          );
        })}
      </div>
      {asking !== null && (
        <div className="seed-confirm">
          <span>翻开「{words[asking]}」？翻开就能看到它是谁的。</span>
          <button
            type="button"
            className="primary"
            onClick={() => {
              setMarked((m) => [...m, asking]);
              setAsking(null);
            }}
          >
            翻开
          </button>
          <button type="button" onClick={() => setAsking(null)}>
            不翻
          </button>
        </div>
      )}
    </div>
  );
}

/** The address of this room; opening it on another phone enters the same room. */
function ShareLink() {
  const [copied, setCopied] = useState(false);
  return (
    <p className="seed-share">
      <span className="muted small">也可以把这个页面的网址发给大家，打开就是这个房间。</span>
      <button
        type="button"
        onClick={() =>
          navigator.clipboard
            ?.writeText(location.href)
            .then(() => setCopied(true))
            .catch(() => setCopied(false))
        }
      >
        {copied ? "已复制" : "复制网址"}
      </button>
    </p>
  );
}
