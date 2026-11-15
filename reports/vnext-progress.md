# NanoParty VNext — 进度记录

分支：`vnext`（从 `main` bb8cc9b 切出）。需求：`docs/NanoParty_VNext_PRD_v1.1.md`，交接：`docs/NanoParty_VNext_Coding_Handoff.md`。
本文件持续更新；中断后从「恢复入口」继续。

## 现状差异表（开工前核对，2026-11-14）

| 模块 | 状态 | 说明 / 关键文件 |
| --- | --- | --- |
| 房间、邀请、身份恢复、重启恢复（暂停等房主继续） | 已有 | `apps/server/src/rooms/RoomRuntime.ts`，`http/routes.ts` |
| 派对独立计分 | 需完善 | 已有 `party_sessions`（结束即开新场并清零），缺存档回顾、历史入口、偏好、聊天按派对分段 |
| 大厅 | 需完善 | `apps/web/src/components/Lobby.tsx`：有游戏卡与人数原因；缺派对状态、偏好入口、封面、AI 依赖标记 |
| 两种结束（结算 / 放弃） | 缺失 | 现在只有「结束本游戏」= aborted |
| 双发送入口 | 缺失 | `ChatPanel.tsx` 只有发送；服务端靠正文 `@AI` 触发 |
| AI 状态、限流、预算、失败降级 | 已有 | `agent/AgentService.ts` |
| 普通 / 搞怪模式 | 缺失 | `agent/prompt.ts` 只有一种口吻 |
| Room AI 与 Game AI 分离 | 缺失 | 只有 Room Agent |
| 选题阶段（题主选、换一批、自己出题） | 已有 | `packages/games/src/pick.ts` + 12 款游戏；`PickPanel.tsx` |
| 题主权限 / 房主覆盖 | 需完善 | 只有题主能操作；房主没有显式覆盖入口 |
| AI 出题联动 | 需完善 | `save_content`/`offer_content` 已有；不区分请求者，迟到结果会排到下一轮 |
| 候选历史（跨回合、跨题主、持久化） | 缺失 | 未选的候选不留痕 |
| 选中待确认 | 缺失 | 点击即确认 |
| 海龟汤真人主持 | 已有 | `packages/games/src/soup/game.ts` |
| 海龟汤 AI 裁判、纠错、接管、母题改编 | 缺失 | |
| Canvas 原语（collect/choose/show/confirm）与多步流程 | 已有 | `rooms/canvas.ts`、`packages/shared/src/canvas.ts`；缺匿名投票、真实模型验证 |
| 原始成绩流水 | 已有 | `score_events`（只追加、幂等 key） |
| 派对积分（名次奖励）、结算页、协商调分、更正 | 缺失 | 现在原始分直接累加进总榜 |
| 完整回顾、AI 总结 | 缺失 | |
| 局内反馈 | 需完善 | 只有对题目的四类反馈（`content_feedback`），无附言、无 AI 判定/界面类 |
| 事件记录、试玩报告导出 / 拉取 | 缺失 | |
| 多玩家测试房间、身份切换、代操作、测试驱动 | 缺失 | 以前用临时 Playwright 脚本 |
| 真实模型适配 | 已有 | Anthropic、Gemini（`agent/model.ts`、`agent/geminiModel.ts`）；`.env` 已配 Gemini 密钥 |
| 房主转交 / 管理员恢复 | 缺失 | |
| Docker Compose、PGlite 开发、迁移自动执行 | 已有 | |

## 会影响已有数据的变更

全部为追加式迁移（新表、新列带默认值），不删除、不改写旧记录：
- `party_sessions.scoring`：旧记录默认 `raw-v1`（原始分累加），新派对用 `rank-v1`（名次奖励）。旧的进行中派对沿用旧口径直到房主结束。
- `chat_messages.session_id`：旧消息为空（视为历史聊天，不进入新派对的 AI 上下文）。
- 新表：`party_points`、`adjustments`、`candidate_history`、`feedback`、`events`。

## 分批顺序

1. 第一批：事件/反馈/测试支撑；双发送；题主权限与房主覆盖；候选历史；AI 联动规则。
2. 第二批：海龟汤 AI 裁判、纠错、接管、母题改编；搞怪模式；真实模型验证。
3. 第三批：派对生命周期、名次奖励、协商调分、回顾、偏好、视觉。
4. 最终：Docker / 迁移验证、多浏览器回归、报告回流、验收文档。

## 决策记录

（随实现追加）

## 已完成

（随实现追加）

## 当前工作

第一批：数据结构与候选历史。

## 阻塞

- AC-22 的「从服务器拉取」：没有生产 SSH 条件，且本次不允许连接生产；只能在本机 Docker 上验证导出与拉取脚本。
- 14.5 真实朋友局：需要真人，无法由我执行。

## 恢复入口

`git log --oneline main..vnext` 查看已提交批次；`pnpm check` 验证；本文件「当前工作」一节是下一步。
