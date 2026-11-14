/**
 * Registry of content types: the payload shape each type must have, plus a short description
 * that is given to whoever writes content (a person, an import script or the AI host).
 * Anything entering the library from outside is validated against this.
 */
import type { z } from "zod";
import { bluffContentSchema } from "./bluff/game.ts";
import { categoriesContentSchema } from "./categories/game.ts";
import { estimateContentSchema } from "./estimate/game.ts";
import { mostlikelyContentSchema } from "./mostlikely/game.ts";
import { oneclueContentSchema } from "./oneclue/game.ts";
import { yesnoContentSchema } from "./percent/game.ts";
import { pollContentSchema } from "./pollmine/game.ts";
import { quipContentSchema } from "./quip/game.ts";
import { rankingContentSchema } from "./ranking/game.ts";
import { soupContentSchema } from "./soup/game.ts";
import { spectrumContentSchema } from "./spectrum/game.ts";
import { splitContentSchema } from "./split/game.ts";
import { tabooContentSchema } from "./taboo/game.ts";
import { undercoverContentSchema } from "./undercover/game.ts";

export interface ContentTypeDef {
  schema: z.ZodType;
  /** Field-by-field guidance with an example, in the players' language. */
  guide: string;
}

export const contentTypes: Record<string, ContentTypeDef> = {
  spectrum: {
    schema: spectrumContentSchema,
    guide:
      '猜刻度的刻度：{"left": 一端, "right": 相反的另一端}，各不超过 12 字。两端要是同一维度上的对立概念，中间有发挥空间。例：{"left":"脆皮","right":"坦克"}',
  },
  "word-pair": {
    schema: undercoverContentSchema,
    guide:
      '谁是卧底的词对：{"a": 词, "b": 相近但不同的词}。两个词要容易混淆、都能被含糊地描述。例：{"a":"牛奶","b":"豆浆"}',
  },
  "numeric-fact": {
    schema: estimateContentSchema,
    guide:
      '数字题：{"text": 题干, "unit": 单位, "answer": 数字, "note": 可选的口径说明}。答案必须可核查，不确定就不要写。例：{"text":"一台标准钢琴有多少个琴键？","unit":"个","answer":88}',
  },
  "who-prompt": {
    schema: mostlikelyContentSchema,
    guide:
      '谁最可能：{"text": 以「谁最可能」开头的情境}。通用情境，不涉及真实个人经历。例：{"text":"谁最可能出门忘带手机？"}',
  },
  "quip-prompt": {
    schema: quipContentSchema,
    guide: '脑洞问答的题目：{"text": 一个能引出多种搞笑回答的开放问题}。例：{"text":"最没用的超能力是什么？"}',
  },
  "fact-blank": {
    schema: bluffContentSchema,
    guide:
      '真假难辨的事实题：{"text": 带 ____ 空缺的事实陈述, "answer": 空缺处的真答案, "note": 可选说明}。必须是可核查的事实。例：{"text":"章鱼有____颗心脏。","answer":"三"}',
  },
  category: {
    schema: categoriesContentSchema,
    guide:
      '逛三园的类别：{"name": 类别名, "hint": 可选提示}。类别要大家都能说出很多个。例：{"name":"水果园","hint":"说一种水果"}',
  },
  "scale-scenario": {
    schema: rankingContentSchema,
    guide:
      '排排座的情境：{"text": 要大家说什么, "low": 1 分代表的程度, "high": 10 分代表的程度}。例：{"text":"说一种食物","low":"最难吃","high":"最好吃"}',
  },
  soup: {
    schema: soupContentSchema,
    guide:
      '海龟汤：{"surface": 汤面（一个看似离奇的简短情境）, "solution": 汤底（能解释一切的完整真相）}。汤底要能通过是非问题一步步推出，不能依赖冷僻知识。例：{"surface":"他在电梯里按了 10 楼，却在 7 楼下电梯走楼梯。为什么？","solution":"他个子矮，只够得着 7 楼的按钮；下雨天带伞时才能用伞按到 10 楼。"}',
  },
  "split-prompt": {
    schema: splitContentSchema,
    guide:
      '五五开的两难题：{"text": 含且仅含一个「____」空格的情境, "yes": 同意选项（可选，默认「愿意」）, "no": 反对选项（可选）}。空格处由玩家填写代价或条件。例：{"text":"有个按钮，按下就能得到一百万，但____。你按吗？","yes":"按","no":"不按"}',
  },
  "guess-word": {
    schema: oneclueContentSchema,
    guide: '不撞词的目标词：{"word": 一个常见名词}。例：{"word":"月亮"}',
  },
  "taboo-card": {
    schema: tabooContentSchema,
    guide:
      '禁词描述的词卡：{"word": 目标词, "taboo": [2–5 个描述它时最容易说出口的禁词]}。例：{"word":"火锅","taboo":["辣","涮","重庆","锅底"]}',
  },
  poll: {
    schema: pollContentSchema,
    guide:
      '猜大家选的选择题：{"text": 关于个人偏好的问题, "options": [4–8 个选项，每个不超过 16 字]}。没有标准答案，选项之间要势均力敌。例：{"text":"最想拥有哪种超能力？","options":["飞行","隐身","读心","时间暂停"]}',
  },
  "yesno-prompt": {
    schema: yesnoContentSchema,
    guide:
      '百分比竞猜的是非题：{"text": 一个每个人都能如实回答「是 / 否」的关于自己的问题}。不要涉及隐私或让人难堪的内容。例：{"text":"你今天喝过咖啡或茶吗？"}',
  },
};
