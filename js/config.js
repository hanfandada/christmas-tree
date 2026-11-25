/**
 * 全局配置：几何尺寸、配色、三档画质。
 * 所有模块都从这里取值，调参只需要改这一个文件。
 */

export const TREE = {
  height: 9.0,        // 树高（从 baseY 到树尖）
  baseRadius: 3.02,   // 底部半径
  baseY: -2.7,        // 树冠底部高度
  trunkHeight: 1.3,   // 树干高度
  trunkRadius: 0.42,  // 树干底部半径
  turns: 26,          // 螺旋缠绕圈数，决定"层叠感"
};

/** 三档画质：粒子数、像素比、是否开泛光 */
export const QUALITY = {
  high:   { tree: 72000, snow: 7000, sky: 1400, ornaments: 26, pixelRatio: 2.0, bloom: true },
  medium: { tree: 44000, snow: 4200, sky: 900,  ornaments: 22, pixelRatio: 1.5, bloom: true },
  low:    { tree: 25000, snow: 2200, sky: 520,  ornaments: 18, pixelRatio: 1.0, bloom: false },
};

export const GROUND_Y = TREE.baseY - TREE.trunkHeight;

export const PALETTE = {
  backgroundHigh: 0x061021,
  backgroundLow: 0x010104,
  nebula: 0x07231d,
  treeBottom: 0x0a2c22,
  treeMid: 0x14a06c,
  treeTop: 0x86f2c4,
  treeWarm: 0xffa64d,
  string: 0xffd79a,
  star: 0xffe0a8,
  starGlow: 0xffb968,
  snow: 0xdfefff,
  ornaments: [0xff5064, 0xffb347, 0xeaf6ff, 0x6fd0ff],
  spark: 0xffd98a,
};

export const CAMERA = {
  fov: 42,
  near: 0.1,
  far: 260,
  position: [0, 2.9, 19.8],
  target: [0, 1.15, 0],
  minDistance: 9,
  maxDistance: 30,
};

/** 开场生长动画的节奏（秒） */
export const TIMELINE = {
  growDelay: 0.45,
  growDuration: 3.6, // 1.9 太快，差不多是"一眨眼就亮完了"，拉到 3.6 才有"慢慢亮起来"的感觉
  // 礼物 / 挂饰必须等树叶整体亮完（growDelay + growDuration ≈ 4.05 秒）才出来，
  // 否则会出现"树还黑着，礼物先亮"的顺序错乱
  stringDelay: 4.0,
  starDelay: 0.15, // 星星先亮，光是它撒下来的
  hudDelay: 5.3,
};
