# 启用 AI

不配置模型时，所有固定规则游戏和题库玩法照常可用；海龟汤改由真人当汤主。

## 配置

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

## 使用 DeepSeek 官方接口

现有 Anthropic 适配器也支持 DeepSeek 官方兼容接口。在 `.env` 配置：

```dotenv
ANTHROPIC_API_KEY=你的DeepSeek密钥
ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic
AI_PROVIDER=anthropic
AI_MODEL=deepseek-v4-flash
AI_REFUSAL_FALLBACK=false
```

兼容接口发送完整工具对话历史，并在服务端验证工具参数和权限。模型 ID 以 DeepSeek 官方当前支持列表为准；旧模型名可能由提供方映射到新版。
