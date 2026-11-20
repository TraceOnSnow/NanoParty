# 本地开发与测试

需要 Node.js ≥ 22（推荐 24）和 pnpm 11。**不需要 Docker 或本机 PostgreSQL**：未设置 `DATABASE_URL` 时使用内嵌的 PGlite，数据在 `./data/pglite`。

```bash
pnpm install
cp .env.example .env      # 设置 ADMIN_PASSWORD 即可
pnpm dev                  # 服务端 :3000 + 网页 :5173（热更新）
```

打开 <http://localhost:5173>。想在一台电脑上模拟多名玩家，请用不同浏览器或无痕窗口（玩家身份保存在浏览器的 localStorage 中）。

| 命令 | 作用 |
| --- | --- |
| `pnpm dev` | 启动开发环境 |
| `pnpm test` | 全部自动化测试（规则单测、运行时、Agent、HTTP+WebSocket 端到端） |
| `pnpm typecheck` / `pnpm lint` / `pnpm format` | 类型检查 / Biome 检查 / 自动修复 |
| `pnpm check` | lint + typecheck + test |
| `pnpm build` && `pnpm start` | 生产构建并以单进程运行（服务端同时托管网页） |
| `pnpm db:generate` | 修改 `apps/server/src/db/schema.ts` 后生成迁移 |

在真实 PostgreSQL 上跑端到端测试：`TEST_DATABASE_URL=postgres://... pnpm vitest run apps/server/test/e2e.test.ts`

## 多人测试

```bash
pnpm dev:test                                  # 独立测试实例：:3100，自己的数据目录，开启 TEST_MODE
AI_MOCK=true pnpm dev:test                     # 同上，用模拟模型
```

- **一个人开多人房间**：打开 `http://localhost:3100/test`，一键创建带 2–8 名测试玩家的房间，在同一个窗口里切换视角，「其他人各走一步」让其余玩家做最朴素的合法操作。
- **场景驱动（真实 HTTP + WebSocket）**：`PORT=3100 pnpm tester tools/scenarios/picker-history.json --out reports/artifacts/x.json`。每个测试玩家有自己的会话和连接，动作和真人一样经过服务端校验；输出是一行一步的摘要，完整轨迹写到 `--out`。
- **多浏览器验收**：`node tools/browser/party.mjs`、`node tools/browser/soup-canvas.mjs`（四个互相隔离的浏览器会话，截图在 `reports/artifacts/browser/`）。
- **真实模型评测**：`pnpm model-eval soup`、`pnpm model-eval host`（用 `.env` 里的密钥；`AI_MODEL=` 换模型，`EVAL_ONLY=1,3` 只跑部分场景），结果写到 `reports/artifacts/model-*.md`，与 Mock 测试分开。

`TEST_MODE=true` 会开放 `/api/test/*`（以任意玩家身份操作、读取完整游戏状态），**只用于本机或专用测试环境**；不设置时这些路由根本不存在。

## 试玩报告

想知道某一场出了什么问题时，从服务器按需拉一份只读、脱敏的报告：

```bash
tools/pull-report.sh user@server /path/to/NanoParty --list
tools/pull-report.sh user@server /path/to/NanoParty --party <派对 id>
tools/pull-report.sh user@server /path/to/NanoParty --since 2026-11-14 --issues   # 只要有反馈或被拒绝操作的
tools/pull-report.sh local . --party <派对 id>                                    # 本机的 Compose
```

报告落在 `reports/pulled/<时间>/`（不进 git）。先读 `summary.md`，再按 `index.json` 找细节：排名与逐场战绩、事件顺序、被拒绝的操作、玩家反馈、模型调用的耗时和用量。

- 脚本只在应用容器里运行 `node dist/report.js`：数据库会话是只读的，不执行迁移、不重启、不开端口。
- 玩家以 P1、P2… 出现；昵称、邀请令牌、会话凭据、密钥都不会导出。
- 聊天原文和游戏秘密（如汤底）默认不包含；确实需要时加 `--with-chat` / `--with-state`，索引文件会标明。
- 游戏内的「反馈问题」会带上当时的游戏、阶段和题目，报告里能直接定位。

## 私有内容包

朋友之间的梗、外号做成的主题和题目不适合进公开仓库。把它们写成 JSON 放在项目目录下的 `private-content/`（已被 git 忽略），服务启动时会加载进题库；不用 Docker 时用 `CONTENT_DIR` 指向任意目录。

每个文件是一个数组，每项为 `{ "id", "type", "payload", "version"?, "theme"? }`，`type` 和 `payload` 的格式与内置题库相同（见 `packages/games/src/contentTypes.ts`）。已经加载过的 `id + version` 不会被覆盖，修改内容时把 `version` 加一。

例：给「凑一桌」换一套自己的材料名（`weight` 高的主题优先使用）：

```json
[{ "id": "my-platter", "type": "platter-theme", "payload": { "name": "自己人", "weight": 10, "kinds": [{ "label": "甲" }, { "label": "乙" }, { "label": "丙" }, { "label": "丁" }, { "label": "戊" }, { "label": "己" }] } }]
```

同一个目录里的 `game-notes.json` 可以给游戏加只在这台服务器上显示的叫法和备注（例如这群人习惯的称呼），格式为 `{ "<游戏 id>": { "alias": "显示名", "note": "一句备注" } }`，两项都可省略。它只影响大厅和标题栏的显示，规则、记录和 AI 仍使用游戏本身的名称。
