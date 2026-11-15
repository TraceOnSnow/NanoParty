/**
 * Dynamic Canvas helpers: pure functions over one interaction. The RoomRuntime owns
 * queueing, persistence, permissions and effects.
 */
import type { InteractionResult, InteractionSpec, InteractionView, PlayerId } from "@apr/shared";

export type ResponseValue = string | boolean;

export interface LiveInteraction {
  id: string;
  spec: InteractionSpec;
  status: "queued" | "open" | "closed";
  responses: Record<PlayerId, ResponseValue>;
  result: InteractionResult | null;
  createdBy: "agent" | "system";
}

/** Who may respond, limited to people actually in the room. `show` takes no responses. */
export function respondersOf(spec: InteractionSpec, members: PlayerId[]): PlayerId[] {
  if (spec.kind === "show") return [];
  if (spec.audience === "all") return members;
  return spec.audience.filter((p) => members.includes(p));
}

export function validateResponse(
  spec: InteractionSpec,
  value: ResponseValue,
): { ok: true; value: ResponseValue } | { ok: false; error: string } {
  switch (spec.kind) {
    case "collect": {
      const text = typeof value === "string" ? value.trim() : "";
      if (!text) return { ok: false, error: "请输入内容" };
      if (text.length > spec.maxLength) return { ok: false, error: `最多 ${spec.maxLength} 个字` };
      return { ok: true, value: text };
    }
    case "choose":
      return spec.options.some((o) => o.id === value) ? { ok: true, value } : { ok: false, error: "没有这个选项" };
    case "confirm":
      return typeof value === "boolean" ? { ok: true, value } : { ok: false, error: "请选择同意或拒绝" };
    case "show":
      return { ok: false, error: "这条内容不需要回应" };
  }
}

/** Structured result of an interaction from the responses received. */
export function computeResult(live: LiveInteraction, confirmOutcome = ""): InteractionResult {
  const { spec, responses } = live;
  switch (spec.kind) {
    case "collect":
      return {
        kind: "collect",
        entries: Object.entries(responses).map(([playerId, text]) => ({ playerId, text: String(text) })),
      };
    case "choose": {
      const tally = spec.options.map((o) => {
        const voters = Object.entries(responses)
          .filter(([, v]) => v === o.id)
          .map(([p]) => p);
        // An anonymous vote keeps only the count: who voted for what is not stored in the result,
        // so it cannot reach players, the chat or the AI host.
        return { id: o.id, label: o.label, voters: spec.anonymous ? [] : voters, count: voters.length };
      });
      const top = Math.max(0, ...tally.map((t) => t.count));
      return {
        kind: "choose",
        tally,
        winners: top > 0 ? tally.filter((t) => t.count === top).map((t) => t.id) : [],
        anonymous: spec.anonymous === true,
      };
    }
    case "confirm":
      return { kind: "confirm", approved: Object.values(responses).some((v) => v === true), outcome: confirmOutcome };
    case "show":
      return { kind: "show" };
  }
}

/** One-paragraph description of a result, for the chat log and for the AI host's context. */
/** `withIds` adds option ids, which the AI host needs and players do not. */
export function summarize(live: LiveInteraction, name: (id: PlayerId) => string, withIds = false): string {
  const r = live.result;
  if (!r) return `「${live.spec.title}」进行中`;
  switch (r.kind) {
    case "collect":
      return `「${live.spec.title}」收到：${r.entries.map((e) => `${name(e.playerId)}：${e.text}`).join("；") || "没有人提交"}`;
    case "choose": {
      const lines = r.tally
        .filter((t) => (t.count ?? t.voters.length) > 0)
        .map(
          (t) =>
            `${t.label}${withIds ? `（id=${t.id}）` : ""} ${t.count ?? t.voters.length} 票${r.anonymous ? "" : `：${t.voters.map(name).join("、")}`}`,
        );
      const winners = r.tally.filter((t) => r.winners.includes(t.id)).map((t) => t.label);
      return `「${live.spec.title}」${r.anonymous ? "（匿名）" : ""}结果：${lines.join("；") || "没有人选择"}${winners.length > 0 ? `。得票最高：${winners.join("、")}` : ""}`;
    }
    case "confirm":
      return `「${live.spec.title}」${r.approved ? "已批准" : "未批准"}${r.outcome ? `：${r.outcome}` : ""}`;
    case "show":
      return `「${live.spec.title}」已展示`;
  }
}

export function toView(
  live: LiveInteraction,
  viewer: PlayerId,
  members: PlayerId[],
  effectSummary?: string,
): InteractionView {
  const { spec } = live;
  const responders = respondersOf(spec, members);
  const mine = live.responses[viewer];
  return {
    id: live.id,
    kind: spec.kind,
    title: spec.title,
    description: spec.description,
    ...(spec.kind === "collect" ? { placeholder: spec.placeholder, maxLength: spec.maxLength } : {}),
    ...(spec.kind === "choose" ? { options: spec.options } : {}),
    ...(spec.kind === "show" ? { items: spec.items } : {}),
    ...(effectSummary ? { effectSummary } : {}),
    responders,
    responded: Object.keys(live.responses),
    canRespond: live.status === "open" && responders.includes(viewer) && mine === undefined,
    myResponse: mine ?? null,
    status: live.status === "closed" ? "closed" : "open",
    result: live.result,
  };
}
