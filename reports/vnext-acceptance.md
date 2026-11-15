# NanoParty VNext — 验收报告

日期：2026-11-15　分支：`vnext`（基于 `main` bb8cc9b）　需求：`docs/NanoParty_VNext_PRD_v1.1.md`

结论先说：**PRD 第 14 章 26 项里，22 项通过，1 项未达标（AC-11），2 项受条件限制只完成了一半（AC-22、AC-24），1 项在真实模型上有保留（AC-13）；14.5 的真实朋友局没有执行。** 自动化、多浏览器和真实模型的证据分开列在下面，Mock 结果没有被当作真实模型结果。

三件需要你知道的事：

1. **模型额度**：`.env` 里的 Google AI Studio 密钥在免费层，每个模型每天 20 次请求（API 报错原文：`GenerateRequestsPerDayPerProjectPerModel-FreeTier, quotaValue 20`）。默认模型已按你的要求改成 `gemini-3.8-flash`，但它当天的额度在评测里用完了，所以**真实模型评测是分摊到其它几个 Gemini 模型上跑的，`gemini-3.8-flash` 本身没有被评测过**。按这个额度，一场真实聚会撑不过几分钟——开玩之前需要给密钥所在的项目开通计费。
2. **裁判速度**：在 `gemini-3.5-flash` 上，海龟汤一次判定平均约 20 秒，18 次里有 3 次超过 45 秒超时（界面会显示「AI 没答上来」，可重试）。答上来的 15 次全部判对。可以用新增的 `AI_JUDGE_MODEL` 给裁判单独配一个更快的模型。
3. **AC-11 没做完**：事实题的「出处、统计口径、时间点」和「当事人预答的自定义事实题」没有实现，详见下文。

## 1. 实现范围与提交

| 提交 | 内容 | 需求 |
| --- | --- | --- |
| 5362ef4 | VNext 文档、差异表、进度记录 | — |
| 1b4389a | 候选历史、题主权限与房主覆盖、双发送、原地反馈、事件日志、测试模式 | CHAT-01/02、CONTENT-01…07、AUTH-01、DATA-03、TEST-01/02/07 |
| 32e9e38 | `pnpm tester`：真实 HTTP + WebSocket 的多玩家场景驱动 | TEST-03/05 |
| 74295dc | 海龟汤 AI 裁判、纠错、失败重试、知情接管、受约束改编 | SOUP-01…08、HOST-03 |
| e980472 | 真实模型评测工具、Gemini 限速重试 | TEST-06、HOST-04 |
| 4b1bb73、f788be0 | 名次奖励、结算、协商调分、派对归档与回顾、偏好、主持模式、房主转交 | LIFE-01…05、SCORE-01…09、RECAP-01…05、PREF-01…04、HOST-01/02 |
| f78d7ed | 结算页、调分方案、派对卡片、回顾页、封面 | LOBBY-01/02、UI-01…05 |
| 9cc4aa5 | 匿名投票、题主即时看到建议题、第二个浏览器场景 | CANVAS-01…03 |
| 740bb06 | 只读脱敏的试玩报告导出与 SSH 拉取脚本 | DATA-01/02/04/05/06 |
| 5971bdb | 真实模型场景：主持、Canvas、出题、改编、回顾 | TEST-06、AC-06/09/15/16/19/21 |
| 45fef6d | 文档、裁判独立模型配置、只读证明 | OPS-01…04 |

数据库：一次追加式迁移 `apps/server/drizzle/0003_mushy_frog_thor.sql`（新表 5 张、新列若干，没有 DROP / 改列）。

## 2. 逐项验收

状态：PASS / FAIL / BLOCKED / NOT RUN。「自动化」= `pnpm check` 里的测试（假模型或无模型）；「浏览器」= 四个隔离浏览器会话，模型为**标注了的模拟模型**；「真实模型」= `pnpm model-eval`，报告文件名里带模型名。

### 14.1 房间、偏好与 AI

| 编号 | 状态 | 证据 |
| --- | --- | --- |
| AC-01 | PASS | 自动化 `vnext-party.test.ts`「archives a party…」；浏览器 `browser/party/AC-01-1.png`、`AC-01-2.png`（第二场从零、历史里有第 1 场、回顾完整） |
| AC-02 | PASS | 重启：`vnext-content.test.ts`、`vnext-soup.test.ts`、`vnext-party.test.ts`「survives a restart…」；重连：浏览器 `AC-02-1.png`、`pnpm tester`。代码里没有任何按时间或按离线自动结束派对的逻辑；「跨日」没有单独模拟 |
| AC-03 | PASS | 自动化 `vnext-party.test.ts`「lets everyone suggest…」（不清积分、不改已确认的题、之后的候选避开「不要出现」）；浏览器 `AC-03-1.png` |
| AC-04 | PASS | 自动化 `vnext-content.test.ts`「calls the model for…」；浏览器 `AC-04-1.png` |
| AC-05 | PASS | 自动化 `agent.test.ts`（合并请求、失败降级）、`vnext-party.test.ts`（工具拒绝未知玩家并如实返回）；真实模型 `model-host-3-overreach-gemini-3-flash-preview.md`（非房主声称是房主：没有开游戏、没有加分、没有谎称完成） |
| AC-06 | PASS（语气需人判断） | 真实模型 `model-host-1-quirky-…md`、`model-host-2-4-normal-topics-…md`：同一争分场景，两种模式都没有入账、都没有越权。自动检查只覆盖「有没有真操作、有没有谎报」；像不像网友、好不好笑请直接读报告里的原文 |

### 14.2 选题、秘密与海龟汤

| 编号 | 状态 | 证据 |
| --- | --- | --- |
| AC-07 | PASS | 自动化 `vnext-content.test.ts`（非房主题主选题、越权被拒、房主显式代选）；浏览器 `AC-07-1…3.png` |
| AC-08 | PASS | 自动化同上（跨题主、跨重启、已玩标记）；浏览器 `AC-08-1.png` |
| AC-09 | PASS | 自动化 `vnext-content.test.ts`「applies them only for the picker…」（迟到结果不覆盖已确认的题）；浏览器 `soup-canvas/AC-09-1.png`；真实模型 `model-host-2-4-…md`（题主要「魂系」题 → 左侧出现并被选用） |
| AC-10 | PASS | 各游戏的「他人视图不含秘密」单测；`vnext-soup.test.ts`（玩家收到的全部消息和主持 Agent 的上下文里都没有汤底）；浏览器抓 WebSocket 帧 `AC-10-1.png`；自拟汤底在左侧表单填写，不经过群聊 |
| AC-11 | **FAIL（只做了一部分）** | 已有：事实题（真假难辨、估数下注）只用题库内容、不允许自拟，结算用的是出题时记录的内容版本；「朋友数据」类由百分比竞猜 / 猜大家选覆盖（猜之前所有人先秘密作答）；AI 的提示词要求不确定的事实题不写。**没有做**：题目的出处 / 统计口径 / 时间点字段及其校验、检索工具、「当事人预答」的自定义事实题流程。AI 生成的事实题目前只标「未核验」，不会被拦下 |
| AC-12 | PASS | 自动化 `vnext-soup.test.ts`「judges left-panel questions…」；浏览器 `AC-12-1.png`；真实模型在游戏流程内判定一次（`model-host-6-…md`） |
| AC-13 | PASS（真实模型有保留） | 机制：`vnext-soup.test.ts`「keeps corrections on record…」、浏览器 `AC-13-1…3.png`。真实模型固定问答集 `model-soup-judge-gemini-3.5-flash.md`：18 题里 15 题符合预期（标准、同义、否定、复合、前提错误、信息不足、伪装指令、重判、三种完整推理、提示），**3 题超时没有答**（索要汤底、非是非题、人工更正后继续），所以「索要汤底不泄露」只由「伪装指令」一题验证过；第二道汤只跑了 1 题。默认模型 `gemini-3.8-flash` 未评测 |
| AC-14 | PASS | 自动化 `vnext-soup.test.ts`（失败不编造、重试、迟到结果丢弃、重启后只判一次、知情接管）；浏览器 `AC-14-1.png` |
| AC-15 | PASS | 自动化 `packages/games/src/soup/adapt.test.ts`（通过案例 + 多种被拒案例）、`vnext-soup.test.ts`（被拒后保留母题并说明原因）；真实模型 `model-host-6-…md`（「沙漠」→「召唤师峡谷」，关键词保留） |

### 14.3 Canvas、结算与回顾

| 编号 | 状态 | 证据 |
| --- | --- | --- |
| AC-16 | PASS | 自动化 `canvas.test.ts`、`vnext-canvas.test.ts`（匿名、重启恢复、取消）；浏览器 `AC-16-1…4.png`；真实模型 `model-host-5-canvas-gemini-3.1-flash-lite.md`（Agent 自己组合出 收集 → 匿名投票 → 出题） |
| AC-17 | PASS | 自动化 `packages/shared/src/scoring.test.ts`、`vnext-party.test.ts`「keeps raw results apart…」；浏览器 `AC-17-1/2.png` |
| AC-18 | PASS | 自动化 `vnext-party.test.ts`「settles an endless game…」（含并发双击只入账一次）；浏览器 `AC-18-1/2.png` |
| AC-19 | PASS | 自动化 `vnext-party.test.ts`「turns a player's request…」；浏览器 `AC-19-1…3.png`；真实模型 `model-host-1-quirky-…md`（AI 用工具提出方案，未批准不入账） |
| AC-20 | PASS | 自动化 `vnext-party.test.ts`「allows big and negative totals…」（被替换 / 取消 / 过期的方案不能执行，更正是追加流水） |
| AC-21 | PASS | 自动化 `vnext-party.test.ts`（总结失败不影响回顾和下一场，可重试）；浏览器 `AC-21-1/2.png`；真实模型生成的总结见 `model-host-6-…md` |

### 14.4 工具与交付

| 编号 | 状态 | 证据 |
| --- | --- | --- |
| AC-22 | **BLOCKED（生产部分）** | 没有生产服务器的 SSH，本次也不允许连接生产。已在本机 Docker 上验证：`tools/pull-report.sh local . --party <id>` 拉回报告（含构建版本、计分口径、匿名玩家）；数据库会话只读（`report-readonly-proof.txt`）；内容与脱敏见 `vnext-report.test.ts`。SSH 路径本身没有实际跑过 |
| AC-23 | PASS | 浏览器 `soup-canvas/AC-23-single-window.png`；`vnext-content.test.ts`（测试接口在普通实例上 404）；本机 Docker（正式配置）实测 `/api/test/*` 全部 404 |
| AC-24 | **BLOCKED（一半）** | 已完成：批量动作 + 摘要 + 证据（`pnpm tester`、`tools/browser/*.mjs`）。「至少一个真实试玩问题转成回归用例」：本机库里没有任何玩家反馈记录，也拿不到生产数据。转成回归的是我在浏览器验收里发现的一个问题——题主看不到别人让 AI 出的建议题，必须手动刷新历史——对应 `vnext-content.test.ts` 里「The picker sees the suggestion at once」 |
| AC-25 | PASS | 本机 Docker 在已有数据上升级：升级前后行数一致（13 房间、44 玩家、13 场派对、56 场游戏、53 条成绩、23 条聊天），旧派对全部标为 `raw-v1`，`party_points` 为空；`vnext-party.test.ts`「leaves a legacy party on its old scoring…」；无模型配置的测试全部通过 |
| AC-26 | PASS（主观项） | 浏览器截图 `browser/party/AC-26-1.png` 等。只做了电脑端；手机端没有重新检查 |

### 14.5 真实朋友局

NOT RUN。需要真人。

## 3. 实际执行的命令与结果

```bash
pnpm check                                   # lint + typecheck + 221 个测试，全部通过
PORT=3100 AI_MOCK=true pnpm dev:test         # 独立测试实例（模拟模型）
node tools/browser/party.mjs                 # 19/19，0 个页面错误
node tools/browser/soup-canvas.mjs           # 12/12，0 个页面错误
PORT=3100 pnpm tester tools/scenarios/picker-history.json   # 14/14
AI_MODEL=gemini-3.5-flash EVAL_LIMIT=18 pnpm model-eval soup            # 15/18（3 次超时）
AI_MODEL=gemini-3-flash-preview EVAL_ONLY=1 pnpm model-eval host        # 4/4
AI_MODEL=gemini-3-flash-preview EVAL_ONLY=3 pnpm model-eval host        # 3/3
AI_MODEL=gemini-3-flash-preview EVAL_ONLY=2,4 pnpm model-eval host      # 7/7
AI_MODEL=gemini-3.1-flash-lite EVAL_ONLY=5 pnpm model-eval host         # 4/4
AI_MODEL=gemini-3.5-flash-lite EVAL_ONLY=6 pnpm model-eval host         # 5/5
GIT_SHA=$(git rev-parse --short HEAD) docker compose up -d --build      # 在已有数据上升级，健康
tools/pull-report.sh local . --party <id>    # 报告拉取成功
```

没有成功的运行也在这里：`gemini-2.5-flash` 和 `gemini-3.8-flash` 上的海龟汤问答集各跑了一次，绝大多数调用因为免费额度 429 失败，结果没有采用；`gemini-3.6-flash` 上的 Canvas 场景同样因额度失败。

## 4. 采用的建议默认值

| 项目 | 取值 |
| --- | --- |
| 主持模式 | 新派对默认搞怪；之后沿用上一场的选择 |
| 候选 | 每批 3 张；历史按派对 + 内容类型保存；已玩的默认不显示（取消「只看未使用」可重玩） |
| 名次奖励 | `round(10 × (N − r) / (N − 1))`，并列平分并保留 1 位小数；集中在 `packages/shared/src/scoring.ts`，版本 `rank-v1` |
| 缺少贡献依据 | 全员并列并提示「尚无可靠区分」 |
| 入账时机 | 房主在结算页确认时一次入账 |
| 海龟汤 | 同一碗汤串行判定；单题可重试；判定超时 45 秒 |
| 房主离线 | 不自动转权；房主可转交，管理员可用 `POST /api/rooms/<房间 id>/host`（带管理员密码和玩家 id）恢复，目前没有界面 |
| 没有活动派对的状态 | 没有单独做：结束一场后立刻开好下一场（0 分），大厅显示「上一场回顾」。效果等同于「首次开玩时创建派对」 |
| 调分上限 | 单项绝对值不超过 1000 分（技术安全上限） |
| 计分口径切换 | 升级时还在进行的派对沿用旧口径，房主结束后新派对用新口径 |

## 5. 已知问题与未完成项

- **AC-11**（见上）：事实题的出处 / 口径 / 快照字段、检索、当事人预答的自定义题没有做。
- **真实模型覆盖不全**：默认模型没评测；海龟汤问答集有 3 题超时未答、第二道汤基本没跑；每个场景只跑了一遍，没有重复验证稳定性。
- **裁判慢**：约 20 秒一题，可能打断节奏。没有做流式或更短的超时策略。
- **AI 总结偶尔说得不准**：真实模型那次写了「全靠海龟汤把分追平」，记录里并没有这回事。提示词要求只用记录里的事实，但没有程序校验。
- **偏好的作用有限**：「不要出现」会过滤题库候选，「想玩 / 熟悉」会把匹配的题排前面，都只是关键词匹配；「难度」只传给了 AI，没有用于筛题库。AI 主动给候选方向没有单独的界面，靠聊天。
- **回放**：事件日志记了操作顺序、类型和结果，没有记操作内容、随机数和模型原始回复，所以只能搭近似场景，不能逐步重放。
- **代操作机器人**只覆盖 8 款游戏（猜刻度、谁最可能、脑洞问答、真假难辨、谁是卧底、百分比竞猜、猜大家选、海龟汤）加通用选题。
- **手机端**没有重新检查；视觉只做了统一封面和状态文案，没有逐款打磨。
- **数据保留 / 删除说明**（DATA-05）只在 README 里写了报告的范围，没有做删除工具，也没有在界面上告知参与者会收集反馈。
- UI-04（AI 更新不抢焦点、不清输入）是按实现保证的，没有专门的自动化用例。

## 6. 本地启动与最短复核路径

Docker（本机已在运行，`http://localhost:3000`，管理员密码在 `.env`）：

```bash
GIT_SHA=$(git rev-parse --short HEAD) docker compose up -d --build
```

不想动 Docker 里的数据，可以用独立测试实例：

```bash
AI_MOCK=true pnpm dev:test        # http://localhost:3100/test
```

十分钟复核：

1. 打开 `/test`，创建 4 人房间。左下角可以切换视角。
2. 开「谁最可能」→ 切到题主视角：点一张卡、「确认使用」；试试「换一批」和「历史候选」。
3. 点「其他人各走一步」让其他人投票 → 「结束并结算」→ 看结算页；用「手动调分」提一个带负分的方案 → 「批准此方案并结算」。
4. 右侧输入一句话，分别点「发送」和「发送并找 AI」。
5. 开「海龟汤」，在「设置」里勾上「AI 主持」→ 提问、点「判错了？」、「让 AI 重判」、「我来当汤主」。（模拟模型的判定是固定的假答案，界面上有标注。）
6. 回大厅「结束本场派对」→ 「上一场回顾」。

服务器升级：先 `docker compose exec db pg_dump -U apr apr > backup.sql`，再拉代码并执行上面的 `docker compose up -d --build`。旧派对会显示「旧计分」，房主结束它之后的新派对才用名次奖励。
