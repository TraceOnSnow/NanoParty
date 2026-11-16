# 内置题库的来源

每条内置内容都有 `source` 字段。文件按来源分开，方便单独替换或移除：

| 文件 | 内容 | 来源 |
| --- | --- | --- |
| `packages/games/src/<game>/content.json` | 最初的基础题库 | 自制 |
| `packages/games/src/<game>/content.net.json` | 面向中文互联网年轻人语境的扩充（网络、打工、校园、游戏、二次元、吃喝、生活） | 自制 |
| `packages/games/src/undercover/content.imported.json` | 谁是卧底词对 306 组 | [Yue-Zeyi/undercover](https://github.com/Yue-Zeyi/undercover) 的 `server/word-bank/*.ts`。**该仓库没有声明许可**，这里只取了词对本身并注明出处；作者提出异议时删除此文件并去掉 `index.ts` 里的一行即可 |
| `packages/games/src/soup/content.imported.json` | 海龟汤 3 道（另有 2 道样例前后矛盾，没有收） | [AZHi-xinxin/haiguitang-coop](https://github.com/AZHi-xinxin/haiguitang-coop) 的 `samples/sample_soups.json`，MIT |

## 重新导入

```bash
# 先把上表两个仓库里的文件下载到一个目录（词对文件命名为 yz-<类别>.ts，汤命名为 soups.json）
node tools/content/import-external.mjs <目录>
```

脚本会跳过和自制题库重复的词对。导入后跑 `pnpm test`：`packages/games/src/content.test.ts` 会检查
所有内置内容的 ID 唯一、格式符合题型、同一题型内不重复、且都写了来源。

## 数字题和事实题

`numeric-fact`、`fact-blank` 的答案都标着 `verification: "unverified"`：它们是按常识和原著写的，
没有逐条对照权威来源核查。带计算的题在 `note` 里写了算式。发现错题直接改对应的 JSON。

## 没有收录的

Steam 创意工坊里的词库需要通过 Steam 客户端订阅下载，这里没有拿到文件。如果要用，把导出的词表
放进一个目录，再给 `tools/content/import-external.mjs` 加一段解析即可；群内梗和真人名字仍然只放
`private-content/`。
