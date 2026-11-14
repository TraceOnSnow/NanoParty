/**
 * Shared "choose this round's topic" phase for content games.
 *
 * Before a round formally starts, the round's picker sees a few candidate items from the
 * library and may take one, ask for others (unlimited, nothing is used up), or — where the
 * game allows it — write their own. Content offered from outside (e.g. by the AI host) replaces
 * the candidates, or waits for the next pick if a round is already running.
 * Changing the candidates before the start is not a skip.
 */
import type { ContentItem, ContributedContent, GameContext, PlayerId } from "@apr/shared";
import { z } from "zod";

export const PICK_CANDIDATES = 3;
const MAX_OFFERED = 6;
/** Limit for each text field of a player-written item. */
export const CUSTOM_FIELD_MAX = 60;

/** `contentId` is null for an item written by a player. */
export interface Candidate<T> {
  contentId: string | null;
  data: T;
}

export interface PickState<T> {
  picker: PlayerId;
  /** How many times each player has picked; drives fair rotation. */
  turns: Record<PlayerId, number>;
  candidates: Candidate<T>[];
  /** Offered while a round was running; shown at the next pick. */
  queued: Candidate<T>[];
}

/** What a player sees of the pick phase. */
export interface PickView {
  picker: PlayerId;
  /** Candidate labels; null when this viewer must not see them (e.g. the guesser of a secret word). */
  candidates: string[] | null;
  allowCustom: boolean;
}

export const emptyPick = <T>(): PickState<T> => ({ picker: "", turns: {}, candidates: [], queued: [] });

export const pickActionSchemas = [
  z.object({ type: z.literal("choose"), step: z.number().int(), index: z.number().int().min(0) }),
  z.object({ type: z.literal("refresh"), step: z.number().int() }),
  z.object({
    type: z.literal("custom"),
    step: z.number().int(),
    payload: z.record(z.string(), z.string().trim().min(1).max(CUSTOM_FIELD_MAX)),
  }),
] as const;

export type PickAction =
  | { type: "choose"; step: number; index: number }
  | { type: "refresh"; step: number }
  | { type: "custom"; step: number; payload: Record<string, string> };

export const isPickAction = (action: { type: string }): action is PickAction =>
  action.type === "choose" || action.type === "refresh" || action.type === "custom";

/** The eligible player who has picked least often (ties: join order). Counts the turn. */
export function rotatePicker<T>(pick: PickState<T>, eligible: PlayerId[]): PlayerId {
  let picker = eligible[0] as PlayerId;
  for (const p of eligible) if ((pick.turns[p] ?? 0) < (pick.turns[picker] ?? 0)) picker = p;
  pick.turns[picker] = (pick.turns[picker] ?? 0) + 1;
  return picker;
}

function toCandidates<T>(items: ContentItem[], schema: z.ZodType<T>): Candidate<T>[] {
  const out: Candidate<T>[] = [];
  for (const item of items) {
    const parsed = schema.safeParse(item.payload);
    if (parsed.success) out.push({ contentId: item.id, data: parsed.data });
  }
  return out;
}

/** Opens the pick for `picker`: queued offers first, otherwise a look at the library. */
export function openPick<T>(pick: PickState<T>, picker: PlayerId, schema: z.ZodType<T>, ctx: GameContext): void {
  pick.picker = picker;
  pick.candidates = pick.queued.length > 0 ? pick.queued : toCandidates(ctx.peekContent(PICK_CANDIDATES), schema);
  pick.queued = [];
}

export type PickOutcome<T> =
  | { ok: false; error: string }
  | { ok: true; chosen: null }
  | { ok: true; chosen: Candidate<T>; contributed?: ContributedContent[] };

export function applyPick<T>(
  pick: PickState<T>,
  action: PickAction,
  actor: PlayerId,
  ctx: GameContext,
  opts: { schema: z.ZodType<T>; contentType: string; allowCustom: boolean },
): PickOutcome<T> {
  if (actor !== pick.picker) return { ok: false, error: "这一轮不是你选题" };
  switch (action.type) {
    case "refresh": {
      const fresh = toCandidates(ctx.peekContent(PICK_CANDIDATES), opts.schema);
      if (fresh.length === 0) {
        return { ok: false, error: opts.allowCustom ? "题库里没有更多候选了，可以自己出一道" : "题库里没有更多候选了" };
      }
      pick.candidates = fresh;
      return { ok: true, chosen: null };
    }
    case "choose": {
      const chosen = pick.candidates[action.index];
      if (!chosen) return { ok: false, error: "没有这个候选" };
      if (chosen.contentId) ctx.consumeContent(chosen.contentId);
      pick.candidates = [];
      return { ok: true, chosen };
    }
    case "custom": {
      if (!opts.allowCustom) return { ok: false, error: "这个游戏不能自己出题" };
      const parsed = opts.schema.safeParse(action.payload);
      if (!parsed.success) return { ok: false, error: "题目格式不对" };
      pick.candidates = [];
      return {
        ok: true,
        chosen: { contentId: null, data: parsed.data },
        contributed: [{ type: opts.contentType, theme: "玩家自拟", payload: parsed.data, authorId: actor }],
      };
    }
  }
}

/** Accepts outside candidates. `picking` = the pick phase is open right now. */
export function offerToPick<T>(
  pick: PickState<T>,
  picking: boolean,
  items: ContentItem[],
  schema: z.ZodType<T>,
  gameName: string,
): { ok: true; message: string } | { ok: false; error: string } {
  const candidates = toCandidates(items, schema).slice(0, MAX_OFFERED);
  if (candidates.length === 0) return { ok: false, error: `这些内容不是「${gameName}」能用的题目` };
  if (picking) {
    pick.candidates = candidates;
    return { ok: true, message: `已作为候选题展示给本轮出题人（${candidates.length} 道），由 TA 决定用哪道` };
  }
  pick.queued = candidates;
  return { ok: true, message: `本轮已经开始，这 ${candidates.length} 道将在下一轮选题时展示给出题人` };
}

/** On timeout the first candidate is taken (and marked used). Null if there is none. */
export function pickOnTimeout<T>(pick: PickState<T>, ctx: GameContext): Candidate<T> | null {
  const first = pick.candidates[0] ?? null;
  if (first?.contentId) ctx.consumeContent(first.contentId);
  pick.candidates = [];
  return first;
}

export function pickView<T>(
  pick: PickState<T>,
  label: (data: T) => string,
  allowCustom: boolean,
  visible = true,
): PickView {
  return { picker: pick.picker, candidates: visible ? pick.candidates.map((c) => label(c.data)) : null, allowCustom };
}

export const pickSecondsOption = {
  key: "pickSeconds",
  label: "选题时限（秒）",
  min: 0,
  max: 600,
  default: 60,
  hint: "0 = 不限时",
};
