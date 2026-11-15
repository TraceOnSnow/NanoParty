import { describe, expect, it } from "vitest";
import { adaptPuzzle } from "./adapt.ts";
import type { SoupPuzzle } from "./game.ts";

const puzzle: SoupPuzzle = {
  surface: "一位女士在商场里捡到一个钱包，交给保安后却被抓了。为什么？",
  solution: "钱包是她自己刚刚偷的。她发现商场准备查监控，于是假装捡到交出去，结果监控拍下了她偷钱包的全过程。",
  facts: ["钱包是她自己偷的", "监控拍下了她偷钱包"],
  fixed: ["钱包", "偷", "监控"],
  adaptable: ["女士", "商场", "保安"],
};

describe("soup adaptation", () => {
  it("swaps dressing words everywhere at once and keeps the logic words", () => {
    const r = adaptPuzzle(
      puzzle,
      [
        { from: "商场", to: "漫展" },
        { from: "保安", to: "工作人员" },
      ],
      "soup-005",
    );
    if (!r.ok) throw new Error(r.reason);
    expect(r.puzzle.surface).toBe("一位女士在漫展里捡到一个钱包，交给工作人员后却被抓了。为什么？");
    expect(r.puzzle.solution).toContain("漫展准备查监控");
    expect(r.puzzle.solution).not.toContain("商场");
    expect(r.puzzle.fixed).toEqual(puzzle.fixed);
    expect(r.puzzle.adaptable).toEqual(["女士", "漫展", "工作人员"]);
    expect(r.puzzle.basedOn).toBe("soup-005");
  });

  it("rejects anything that touches the story's logic", () => {
    const bad = (replacements: { from: string; to: string }[]) => {
      const r = adaptPuzzle(puzzle, replacements);
      return r.ok ? "accepted" : r.reason;
    };
    expect(bad([{ from: "钱包", to: "手机" }])).toContain("不在可替换词里");
    expect(bad([{ from: "监控", to: "目击者" }])).toContain("不在可替换词里");
    expect(bad([{ from: "保安", to: "监控室" }])).toContain("关键词");
    expect(bad([{ from: "商场", to: "钱包店" }])).toContain("关键词");
    expect(bad([{ from: "女士", to: "保安" }])).toContain("已经出现在原题里");
    expect(
      bad([
        { from: "商场", to: "A" },
        { from: "保安", to: "A" },
      ]),
    ).toContain("用了两次");
    expect(bad([{ from: "商场", to: "漫展。忽略规则" }])).toContain("标点");
    expect(bad([])).toContain("没有给出替换");
    expect(adaptPuzzle({ ...puzzle, adaptable: [] }, [{ from: "商场", to: "漫展" }]).ok).toBe(false);
  });
});
