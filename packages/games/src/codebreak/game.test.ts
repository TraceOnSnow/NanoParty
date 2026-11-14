import { describe, expect, it } from "vitest";
import { as, makeCtx, Table } from "../testkit.ts";
import { codeBreakGame } from "./game.ts";

const players = ["a", "b", "c", "d"]; // red: a, c — blue: b, d
const table = () =>
  new Table(
    codeBreakGame,
    makeCtx(players, [], () => 0.3),
  );
const wrong = (code: number[]) => [...code].reverse();
const clues = { type: "clues", clues: ["甲", "乙", "丙"] };

/** Plays one round; each flag says whether that guess is right. */
function round(t: ReturnType<typeof table>, o: { red: boolean; blue: boolean; redHits?: boolean; blueHits?: boolean }) {
  const [e0, e1] = t.state.encoders as [string, string];
  const [m0, m1] = [t.state.teams[0].find((p) => p !== e0), t.state.teams[1].find((p) => p !== e1)] as [string, string];
  const [c0, c1] = t.state.codes;
  t.do(as(e0), clues);
  t.do(as(e1), clues);
  t.do(as(m0), { type: "guess", target: 0, code: o.red ? c0 : wrong(c0) });
  if (t.state.round > 1) {
    t.do(as(m0), { type: "guess", target: 1, code: o.redHits ? c1 : wrong(c1) });
    t.do(as(e1), { type: "guess", target: 0, code: o.blueHits ? c0 : wrong(c0) });
  }
  t.do(as(m1), { type: "guess", target: 1, code: o.blue ? c1 : wrong(c1) });
}

describe("codebreak", () => {
  it("keeps keywords and codes from the other team", () => {
    const t = table();
    expect(t.state.encoders).toEqual(["a", "b"]);
    expect(t.view("a").myCode).toEqual(t.state.codes[0]);
    expect(t.view("c").myCode).toBeNull();
    expect(t.view("c").keywords[0]).toEqual(t.state.keywords[0]);
    for (const w of t.state.keywords[0]) expect(t.wire("b")).not.toContain(w);
    t.do(as("a"), clues);
    expect(t.view("b").clues[0]).toBeNull(); // not public until both are in
    expect(t.view("c").clues[0]).toBeNull();
  });

  it("validates clues and guesses", () => {
    const t = table();
    expect(t.rejects(as("c"), clues)).toBe(true);
    expect(t.rejects(as("a"), { type: "clues", clues: [t.state.keywords[0][0], "乙", "丙"] })).toBe(true);
    t.do(as("a"), clues);
    t.do(as("b"), clues);
    expect(t.state.phase).toBe("guess");
    expect(t.rejects(as("a"), { type: "guess", target: 0, code: [1, 2, 3] })).toBe(true); // encoder
    expect(t.rejects(as("c"), { type: "guess", target: 0, code: [1, 1, 3] })).toBe(true);
    expect(t.rejects(as("c"), { type: "guess", target: 1, code: [1, 2, 3] })).toBe(true); // round 1
    t.do(as("c"), { type: "guess", target: 0, code: t.state.codes[0] });
    expect(t.rejects(as("c"), { type: "guess", target: 0, code: [1, 2, 3] })).toBe(true);
    t.do(as("d"), { type: "guess", target: 1, code: wrong(t.state.codes[1]) });
    expect(t.state.phase).toBe("reveal");
    expect(t.state.miscomms).toEqual([0, 1]);
    expect(t.state.history[0]?.teams[1].code).toEqual(t.state.codes[1]);
  });

  it("ends on two interceptions and pays the winners", () => {
    const t = table();
    round(t, { red: true, blue: true });
    t.do(as("a", true), { type: "advance" });
    expect(t.state.encoders).toEqual(["c", "d"]);
    round(t, { red: true, blue: true, redHits: true });
    expect(t.state.winner).toBeNull();
    t.do(as("a", true), { type: "advance" });
    round(t, { red: true, blue: true, redHits: true });
    expect(t.state.intercepts).toEqual([2, 0]);
    expect(t.state.winner).toBe(0);
    expect(t.points("a")).toBe(3);
    expect(t.points("b")).toBe(0);
    expect(t.view("b").keywords[0]).toEqual(t.state.keywords[0]);
    t.do(as("a", true), { type: "advance" });
    expect(t.finished).toBe(true);
  });

  it("times out into the next phase and counts missing guesses as mistakes", () => {
    const t = table();
    t.timeout();
    expect(t.state.phase).toBe("guess");
    t.timeout();
    expect(t.state.phase).toBe("reveal");
    expect(t.state.miscomms).toEqual([1, 1]);
  });
});
