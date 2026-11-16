# NanoParty

源码公开、自部署的 AI Native 聚会游戏房间（Jackbox 风格）。2–8 位朋友在外部软件开语音，在网页里完成答题、投票等正式操作；左侧是游戏主面板，右侧是共享群聊、AI 主持和积分榜。

- 游戏规则由确定性程序执行；AI 主持只能通过受控工具与系统交互。
- **不配置 AI 也能完整游玩**：内置题库、计分和房主操作都不依赖模型。
- 单实例、Docker Compose 部署，数据在你自己的 PostgreSQL 里。

**在线试玩（静态版，无服务器、无 AI）：<https://party.traceonsnow.com>** —— 可以看一局演示，也可以线下聚会时大家输入同一个房间号开一桌。它和正式版的区别见 [静态试玩版](#静态试玩版)。

> 当前状态：平台基础 + 27 款游戏（另有一个早期的架构验证示例「估数字」）。内置题库只是起步量，后续通过导入扩充。AI 主持可以在主面板组织多人互动（收集、投票、挑选、确认），并为「猜刻度」出候选题；主持和海龟汤裁判做过真实模型评测，结果和所用模型名见 `reports/artifacts/`。产品需求见 [AI_Party_Room_PRD_v1.0.md](AI_Party_Room_PRD_v1.0.md)（文档中的「AI Party Room / AI 聚会房间」是本项目早期的功能性称呼）。

| 游戏 | 人数 | 一句话 |
| --- | --- | --- |
| 猜刻度 | 2–8 | 提示者看到刻度上的秘密位置并给一句提示，其他人猜位置 |
| 谁是卧底 | 3–8 | 秘密发词，各自写描述、统一公开，讨论后投票 |
| 逛三园 | 2–8 | 围绕一个类别轮流打词，不能重复、不能超时 |
| 排排座 | 3–8 | 合作：按秘密数字回答情境，队长把回答排对 |
| 真假难辨 | 3–8 | 给冷知识编假答案，混入真答案互相欺骗 |
| 估数下注 | 3–8 | 先各自估数，再押谁估得最准 |
| 谁最可能 | 3–8 | 投票选出最符合情境的朋友 |
| 脑洞问答 | 3–8 | 写搞笑回答，匿名展示后投票 |
| 不撞词 | 3–8 | 合作猜词：每人给一个线索，撞了的线索作废 |
| 别拿第六张 | 2–8 | 纯规则卡牌：同时出牌，别当放下第六张的人 |
| 海龟汤 | 3–8 | 汤主知道真相，大家用是非问题还原离奇故事 |
| 五五开 | 3–8 | 补全两难题，让朋友们刚好分成两派 |
| 问出秘密词 | 4–8 | 限时问出村长的秘密词，狼人和预言家暗中较量 |
| 合作吃墩 | 3–5 | 合作打牌：让每个任务都由指定的人赢下 |
| 翻牌诈唬 | 3–8 | 暗叠花与骷髅，喊价后翻牌，别翻到骷髅 |
| 拒牌筹码 | 3–7 | 花筹码拒绝负分牌，或者连牌带筹码收下 |
| 压牌出清 | 3–8 | 大牌压掉小牌，相同的牌结盟，先出清手牌 |
| 暗牌对决 | 2–6 | 手里一张牌，摸一打一，用效果淘汰对手 |
| 暗号网格 | 4–8 | 两队对抗：队长用一个词加数字提示队友找词，别碰陷阱 |
| 密码传递 | 4–8 | 两队对抗：用提示传三位密码，同时破译对方 |
| 禁词描述 | 3–8 | 语音描述目标词但不能说禁词，其他人打字抢答 |
| 词块描述 | 3–8 | 只能用固定句式和词块拼句子来描述 |
| 四叶联想 | 3–6 | 合作：给相邻词对写提示，再凭提示还原彼此的卡片 |
| 猜大家选 | 4–8 | 先秘密投票，两队轮流猜哪些选项有人选 |
| 百分比竞猜 | 3–8 | 猜在场有多少比例的人答「是」，其他人押高低 |
| 凑一桌 | 2–6 | 每张牌一面是材料、一面是计分规则：拿一张规则，或者拿两张材料 |
| 攒七张 | 2–6 | 七张手牌摸一弃一，牌与牌互相加分、扣分、作废，总分最高者赢 |

各游戏完整规则见 [docs/games/](docs/games/)。这些游戏只借鉴常见的聚会游戏机制，名称、内容与分值均为本项目自定。

平台能力：

- **长期房间、独立派对**：同一个邀请房间可以开很多场派对，每场从零计分，结束后存档，大厅里能看任何一场的完整回顾。
- **两本账**：游戏内成绩只是原始记录；每场游戏结束后按名次换成派对积分（并列平分），由房主确认一次入账。可以「结束并结算」或「放弃本场」。
- **协商调分**：谁都可以在右侧找 AI 提加分 / 扣分方案，方案显示在左侧，房主批准才生效（房主也可以手动提）。可以是负分。
- **选题**：轮到的题主自己选题、换一批、回看本场出现过的候选、自己出题，或让 AI 按主题出题；房主可以显式代选。
- **AI 主持**：右侧聊天有「发送」和「发送并找 AI」两个按钮。主持有普通 / 搞怪两种模式。海龟汤可以由独立的 AI 裁判主持，判错可以标记、重判、更正，AI 不可用时可以由玩家知情接管。
- **派对偏好**：熟悉什么、今天想玩什么、不要出现什么，大家提建议、房主确认，随时可改，不影响积分和已确定的题。
- 其它：邀请加入、群聊、投票跳题、原地反馈、更换邀请链接、移除成员、房主转交、断线重连、重启恢复。

没有配置模型时，所有固定规则游戏和题库玩法照常可用；海龟汤改由真人当汤主。

## 用 Docker Compose 部署

需要 Docker 与 Docker Compose v2。

```bash
cp .env.example .env
# 编辑 .env：至少设置 ADMIN_PASSWORD（≥8 位）和 POSTGRES_PASSWORD；AI 相关可全部留空
docker compose up -d --build
```

打开 `http://<服务器地址>:3000`，用管理员密码创建房间，在大厅复制邀请链接发给朋友。

- **健康检查**：`GET /api/health`；`docker compose ps` 可看到容器健康状态。日志：`docker compose logs -f app`。
- **升级**：先备份（见下），再 `git pull && GIT_SHA=$(git rev-parse --short HEAD) docker compose up -d --build`。数据库迁移在启动时自动执行，都是追加式的（只加表、加列），数据保存在 `pgdata` 卷中，重建容器不会丢失。`GIT_SHA` 可省略，它只是写进试玩报告方便对应代码版本。
- **从旧版本升级到 VNext**：旧房间、玩家、聊天和成绩都保留。升级时还在进行的派对沿用旧计分方式（游戏内得分直接累加），界面上标「旧计分」；房主「结束本场派对」后，新开的派对才使用名次奖励。旧成绩不会被换算。
- **备份**：`docker compose exec db pg_dump -U apr apr > backup.sql`
- **恢复**：`docker compose exec -T db psql -U apr apr < backup.sql`（恢复到空库）
- **HTTPS**：本项目不自带证书。公网使用请放在反向代理（Caddy / Nginx 等）之后启用 HTTPS，代理需支持 WebSocket 升级，并设置 `TRUST_PROXY=1`。Caddy 示例：

  ```
  party.example.com {
      reverse_proxy localhost:3000
  }
  ```

- **安全提示**：邀请链接是随机令牌，拿到链接的人都能加入，请只发给朋友；管理员密码不是邀请码。模型密钥只在服务端使用，不会发送到浏览器。

## 启用 AI（可选）

在 `.env` 里填一个模型密钥后 `docker compose up -d`：

- `GOOGLE_API_KEY`：Google AI Studio 的密钥，默认模型 `gemini-3.8-flash`；
- 或 `ANTHROPIC_API_KEY`，默认模型 `claude-opus-5-5`。

两个都填时默认用 Anthropic，可用 `AI_PROVIDER=google|anthropic` 指定。普通聊天不会调用模型；只有「发送并找 AI」、正文里的 `@AI`、大厅的「让 AI 推荐」、AI 主持的海龟汤、按主题改编和派对总结才会。

> AI Studio 免费层的额度很小（实测为每个模型每天 20 次请求），不够玩一场。实际使用请给密钥所在的项目开通计费，或换一个额度够的模型。

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `AI_MODEL` | 按提供方 | 主持用的模型 ID |
| `AI_JUDGE_MODEL` | 同 `AI_MODEL` | 游戏裁判（海龟汤判定、改编、派对总结）单独用的模型 |
| `AI_MOCK` | `false` | 开发用：`true` 时用内置的固定话术代替模型（界面会标明「模拟模型」） |
| `AI_EFFORT` | `low` | 思考力度（仅 Anthropic） |
| `AI_ROOM_CALLS_PER_MINUTE` | `6` | 每房间主持调用限速 |
| `AI_DAILY_CALL_LIMIT` | `300` | 全实例每日调用上限；用完后停止调用，游戏照常 |
| `AI_MAX_CONCURRENCY` / `AI_TIMEOUT_MS` | `2` / `45000` | 并发与超时 |
| `AI_REFUSAL_FALLBACK` | `true` | 模型拒答时由 API 自动切换备用模型（仅 Anthropic） |

主持（Room AI）和裁判（Game AI）是两套提示词和上下文：主持只看得到公开信息，看不到谜底、秘密词和手牌；裁判拿得到汤底，但只返回「是 / 否 / 无关…」这样的受控结果。

## 试玩报告（给开发者）

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

### 使用 DeepSeek 官方接口

现有 Anthropic 适配器也支持 DeepSeek 官方兼容接口。在 `.env` 配置：

```dotenv
ANTHROPIC_API_KEY=你的DeepSeek密钥
ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic
AI_PROVIDER=anthropic
AI_MODEL=deepseek-v4-flash
AI_REFUSAL_FALLBACK=false
```

兼容接口发送完整工具对话历史，并在服务端验证工具参数和权限。模型 ID 以 DeepSeek 官方当前支持列表为准；旧模型名可能由提供方映射到新版。

### 本服务器的公网部署

`compose.production.yaml` 复用现有 Nginx 的 `homepage-web_default` 网络，应用别名为 `nanoparty-app`，宿主端口仅绑定 `127.0.0.1:3100`。数据库使用独立的 `nanoparty_pgdata` 卷。

```bash
docker compose -f docker-compose.yml -f compose.production.yaml up -d --build
docker compose -f docker-compose.yml -f compose.production.yaml ps
docker compose -f docker-compose.yml -f compose.production.yaml logs --tail=50 app
```

HTTPS、WebSocket 反代与证书续期沿用服务器现有入口。仅管理员密码持有者能创建房间；房主能获取和更换邀请链接，朋友凭邀请链接加入，无需管理员密码。当前没有独立的管理员账号登录系统。邀请链接属于凭证，反代不记录此站访问日志，并设置 `Referrer-Policy: no-referrer`。

停止时使用同一组 Compose 文件执行 `down`；保留数据库卷，勿添加 `--volumes`。开发模式仍使用内嵌 PGlite，与正式数据库分开。

## 本地开发与测试

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

### 多人测试

```bash
pnpm dev:test                                  # 独立测试实例：:3100，自己的数据目录，开启 TEST_MODE
AI_MOCK=true pnpm dev:test                     # 同上，用模拟模型
```

- **一个人开多人房间**：打开 `http://localhost:3100/test`，一键创建带 2–8 名测试玩家的房间，在同一个窗口里切换视角，「其他人各走一步」让其余玩家做最朴素的合法操作。
- **场景驱动（真实 HTTP + WebSocket）**：`PORT=3100 pnpm tester tools/scenarios/picker-history.json --out reports/artifacts/x.json`。每个测试玩家有自己的会话和连接，动作和真人一样经过服务端校验；输出是一行一步的摘要，完整轨迹写到 `--out`。
- **多浏览器验收**：`node tools/browser/party.mjs`、`node tools/browser/soup-canvas.mjs`（四个互相隔离的浏览器会话，截图在 `reports/artifacts/browser/`）。
- **真实模型评测**：`pnpm model-eval soup`、`pnpm model-eval host`（用 `.env` 里的密钥；`AI_MODEL=` 换模型，`EVAL_ONLY=1,3` 只跑部分场景），结果写到 `reports/artifacts/model-*.md`，与 Mock 测试分开。

`TEST_MODE=true` 会开放 `/api/test/*`（以任意玩家身份操作、读取完整游戏状态），**只用于本机或专用测试环境**；不设置时这些路由根本不存在。

## 静态试玩版

不需要服务器的版本：线下聚会时大家各拿手机输入同一个房间号，页面负责出题和发身份（17 款）；也可以一个人看一局演示（一个真人加三个脚本玩家）。构建出来是一组静态文件，可以放在个人主页或 Vercel 上。

线上地址：<https://party.traceonsnow.com>（Vercel 托管，推送到 `main` 后自动构建更新）。

```bash
pnpm demo:build      # 输出到 apps/web/dist-demo
pnpm demo:preview    # http://localhost:4173
```

它和正式版的区别、部署方式见 [docs/static-demo.md](docs/static-demo.md)。

## 仓库结构

```
apps/server      Node 服务端：REST、实时房间、Agent、内容系统、数据库
apps/web         React 网页
packages/shared  游戏内核契约（GameModule）与前后端协议类型
packages/games   游戏模块与内置题库（纯函数，无 IO）
docs/            架构说明、ADR、各游戏规则规格
```

进一步阅读：[docs/architecture.md](docs/architecture.md)、[docs/adr/](docs/adr/)、[AGENTS.md](AGENTS.md)（给 Coding Agent 和贡献者的工作约定）。

## 题库来源

内置题目位于 `packages/games/src/*/content.json`，目前均为项目自制的示例题，状态标记为「未核实」（`verification: "unverified"`）。

## 许可

[PolyForm Noncommercial License 1.0.0](LICENSE.md)：可以自由用于个人和其他非商业用途（自己部署和朋友玩、学习、修改、分享）；不允许商业使用。内置题库与代码采用相同许可。

## 私有内容包

朋友之间的梗、外号做成的主题和题目不适合进公开仓库。把它们写成 JSON 放在项目目录下的 `private-content/`（已被 git 忽略），服务启动时会加载进题库；不用 Docker 时用 `CONTENT_DIR` 指向任意目录。

每个文件是一个数组，每项为 `{ "id", "type", "payload", "version"?, "theme"? }`，`type` 和 `payload` 的格式与内置题库相同（见 `packages/games/src/contentTypes.ts`）。已经加载过的 `id + version` 不会被覆盖，修改内容时把 `version` 加一。

例：给「凑一桌」换一套自己的材料名（`weight` 高的主题优先使用）：

```json
[{ "id": "my-platter", "type": "platter-theme", "payload": { "name": "自己人", "weight": 10, "kinds": [{ "label": "甲" }, { "label": "乙" }, { "label": "丙" }, { "label": "丁" }, { "label": "戊" }, { "label": "己" }] } }]
```

同一个目录里的 `game-notes.json` 可以给游戏加只在这台服务器上显示的叫法和备注（例如这群人习惯的称呼），格式为 `{ "<游戏 id>": { "alias": "显示名", "note": "一句备注" } }`，两项都可省略。它只影响大厅和标题栏的显示，规则、记录和 AI 仍使用游戏本身的名称。
