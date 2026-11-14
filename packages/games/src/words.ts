/**
 * Built-in word deck for games that need many words at once (grids, keyword sets).
 * It is a game component like a deck of cards, not library content; everyday nouns only.
 */
import type { PlayerId } from "@apr/shared";
import { shuffle } from "./util.ts";

export const WORDS: readonly string[] =
  `月亮 太阳 星星 彩虹 闪电 火山 沙漠 森林 海洋 河流 瀑布 冰川 草原 岛屿 山洞 雪花 台风 地震 云朵 露水
火锅 饺子 面条 包子 米饭 蛋糕 巧克力 冰淇淋 咖啡 奶茶 啤酒 可乐 西瓜 苹果 香蕉 葡萄 柠檬 辣椒 大蒜 蜂蜜
老虎 狮子 大象 熊猫 猴子 兔子 狐狸 企鹅 海豚 鲨鱼 蝴蝶 蜜蜂 蚂蚁 蜘蛛 乌龟 青蛙 老鹰 鸽子 骆驼 恐龙
医生 老师 警察 厨师 司机 画家 歌手 演员 记者 律师 农民 渔夫 士兵 侦探 魔术师 宇航员 国王 海盗 忍者 机器人
手机 电脑 电视 冰箱 空调 相机 耳机 键盘 手表 眼镜 雨伞 钥匙 镜子 蜡烛 剪刀 锤子 梯子 水桶 枕头 毛巾
医院 学校 银行 超市 机场 车站 公园 图书馆 博物馆 电影院 餐厅 酒店 工厂 教堂 城堡 监狱 灯塔 桥 隧道 码头
飞机 火车 地铁 汽车 自行车 轮船 火箭 气球 滑板 电梯 篮球 足球 乒乓球 象棋 扑克 风筝 吉他 钢琴 鼓 话筒
眼睛 鼻子 耳朵 牙齿 头发 心脏 骨头 手指 影子 梦 血 眼泪 笑容 声音 秘密 时间 记忆 运气 爱情 谎言
春节 生日 婚礼 考试 假期 旅行 比赛 游戏 电影 小说 报纸 信 地图 照片 密码 礼物 奖杯 红包 烟花 灯笼
金子 钻石 石头 木头 玻璃 塑料 纸 丝绸 铁 沙子 火 水 冰 风 烟 雾 泥 油 盐 糖`
    .split(/\s+/)
    .filter(Boolean);

/** `count` distinct words from the built-in deck. */
export const dealWords = (count: number, random: () => number): string[] => shuffle(WORDS, random).slice(0, count);

/** Two teams by alternating join order, so late joiners and friends spread evenly. */
export function splitTeams(players: readonly PlayerId[]): [PlayerId[], PlayerId[]] {
  return [players.filter((_, i) => i % 2 === 0), players.filter((_, i) => i % 2 === 1)];
}

export type TeamId = 0 | 1;
export const teamOf = (teams: readonly PlayerId[][], p: PlayerId): TeamId | null =>
  teams[0]?.includes(p) ? 0 : teams[1]?.includes(p) ? 1 : null;
export const TEAM_NAMES = ["红队", "蓝队"] as const;
