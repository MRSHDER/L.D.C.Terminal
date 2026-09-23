/**
 * L.D.C. — 引擎默认值（DEFAULT_SPECIES / DEFAULT_BEHAVIORS）
 *
 * ★ 这是「新犬种 JSON 可以很短」的原因。
 *
 * 加载管线：
 *   DEFAULT_SPECIES  →  深合并  →  species.json  →  校验  →  冻结
 *
 * 新犬种只需写「与默认不同」的字段。
 * 伯恩山的 species.json 因此可以控制在 80 行左右。
 *
 * 注意：这里的数值是「中性犬」—— 不偏向任何犬种。
 * 任何看起来像具体犬种默认值的数字都是设计错误。
 */

import type {
  SpeciesData,
  BehaviorsData,
  Temperament,
  AnimationConfig,
  NeedsConfig,
  PreferencesConfig,
  LocomotionConfig,
  PhysicalConfig,
  CognitionConfig,
  ResourcesConfig,
  PersonalityConfig,
  AffectionConfig,
  RoomConfig,
  BondingConfig,
  PettingConfig,
  AnnoyanceConfig,
} from './types';
import { SPECIES_SCHEMA_VERSION, BEHAVIORS_SCHEMA_VERSION } from './types';

/**
 * 中性基准体型：灰盒方块尺寸（世界像素）。
 *
 * 比例刻意取"宽 > 高"（48×36，约 4:3）——
 * 这是侧视犬类躯干的粗略轮廓。若改成正方或竖长，
 * 灰盒会被读成"箱子"而不是"动物"，不利于验证姿态动画。
 */
export const GRAYBOX_BASE_SIZE = { w: 48, h: 36 } as const;

const DEFAULT_TEMPERAMENT: Temperament = {
  gentleness: 0.5,
  energy: 0.5,
  curiosity: 0.5,
  stubbornness: 0.5,
  shyness: 0.5,
  clinginess: 0.5,
  playfulness: 0.5,
  obedience: 0.5,
  randomness: 0.35,
};

const DEFAULT_PHYSICAL: PhysicalConfig = {
  bodyScale: 1,
  hitbox: { w: GRAYBOX_BASE_SIZE.w, h: GRAYBOX_BASE_SIZE.h, anchorY: 0.85 },
  pettingHotspots: [],
  grayboxTint: 0xffffff,
};

const DEFAULT_PERSONALITY: PersonalityConfig = {
  temperament: DEFAULT_TEMPERAMENT,
  traits: [],
};

const DEFAULT_COGNITION: CognitionConfig = {
  decisionIntervalMs: 500,
  reactionDelayMs: [200, 700],
  attentionSpanMs: 6000,
  memorySpanMs: 30000,
  learningRate: 0.15,
};

const DEFAULT_ANIMATION: AnimationConfig = {
  // 10FPS 是中性值：介于"迟钝"（8）与"敏捷"（12）之间
  targetFps: 10,
  breath: { freqHz: 0.22, ampPx: 1.2, bodyScaleY: 0.016 },
  blink: { baseIntervalMs: 4200, varianceMs: 2200, durationMs: 140 },
  tail: { segments: 3, baseAngleDeg: 8, maxSwingDeg: 18, delayPerSegMs: 80 },
  ear: { jitterDeg: 4, triggerBias: 0.22 },
  float: { ampPx: 0.8, freqHz: 0.13 },
  transitions: {},
  defaultTransitionMs: 200,
};

const DEFAULT_NEEDS: NeedsConfig = {
  hunger: { decayPerMin: 0.9, criticalAt: 0.85, restorePerMin: 12 },
  energy: { decayPerMin: 0.6, criticalAt: 0.8, restorePerMin: 6 },
  social: { decayPerMin: 1.4, criticalAt: 0.75, restorePerMin: 8 },
};

const DEFAULT_PREFERENCES: PreferencesConfig = {
  food: { base: 0.7, favorites: [], dislikes: [] },
  toys: { ball: 0.5, rope: 0.5, squeaky: 0.5 },
  places: { nearPlayer: 0.6, sunnySpot: 0.5, underTable: 0.4 },
  touch: { head: 0.7, back: 0.7, belly: 0.5 },
};

const DEFAULT_LOCOMOTION: LocomotionConfig = {
  walkSpeedPx: 30,
  runSpeedPx: 65,
  turnRateDeg: 200,
  idleWanderRadiusPx: 48,
  wanderChancePerMin: 3,
  arriveThresholdPx: 3,
};

const DEFAULT_RESOURCES: ResourcesConfig = {
  assetRoot: '',
  animationClips: {},
};

// ─────────────────────────────────────────────────────────────
// Milestone 2 默认值：羁绊 / 抚摸 / 骚扰 / 房间
// ─────────────────────────────────────────────────────────────

/**
 * 默认羁绊阶梯 —— Milestone 2 的核心体验。
 *
 * 这是项目要求的"五次抚摸"序列：
 *   看向 → 靠近 → 坐下 → 摇尾巴 → 闭眼
 *
 * ★ 关键设计：阶梯是**连续量**驱动的，不是点击计数器。
 *   羁绊值会因冷落而衰减，所以"它认识我了"必须靠持续陪伴维持。
 *
 * 数值含义：gainPerPet = 0.22，因此约 5 次抚摸走完阶梯。
 * 但每次抚摸的增益会随羁绊升高而**递减**（边际效应），
 * 避免"点满即永久满级"的游戏感 —— 详见 BondSystem。
 */
const DEFAULT_BONDING: BondingConfig = {
  gainPerPet: 0.22,
  // 每秒衰减 0.006 → 满羁绊约 2.8 分钟归零。
  // 足够慢，让玩家在 30 秒的首次体验里不会感到"倒退"；
  // 又足够快，让"离开一会儿回来它就没那么热情了"可以被察觉。
  decayPerSec: 0.006,
  penaltyPerSecWhenAnnoyed: 0.05,
  ladder: [
    {
      atBond: 0.0,
      state: 'LookAt',
      label: { zh: '看向玩家', en: 'Looks at you' },
    },
    {
      atBond: 0.32,
      state: 'Approach',
      label: { zh: '靠近一点', en: 'Comes closer' },
    },
    {
      atBond: 0.55,
      state: 'Sit',
      label: { zh: '坐到你旁边', en: 'Sits beside you' },
    },
    {
      atBond: 0.76,
      state: 'WagTail',
      label: { zh: '摇尾巴', en: 'Wags tail' },
    },
    {
      atBond: 0.93,
      state: 'PetEnjoy',
      label: { zh: '闭眼享受', en: 'Closes eyes, content' },
    },
  ],
  requiresTouchToNotice: true,
};

const DEFAULT_PETTING: PettingConfig = {
  minEffectiveMs: 90,
  pleasureBase: 0.35,
  arousalGain: 0.28,
  tolerance: 3,
};

const DEFAULT_ANNOYANCE: AnnoyanceConfig = {
  windowMs: 3200,
  // ★ Alpha 打磨：阈值从 4 提高到 7。
  //
  //   校准依据：抚摸的语义已修正为「一次按住 = 一次抚摸」，
  //   因此窗口内的次数就是**玩家实际的抚摸次数**。
  //   实测正常节奏（220ms 按住 / 340ms 间隔）8 次抚摸耗时约 2.7 秒，
  //   若阈值仍为 4，第 5 次就会被判为骚扰 ——
  //   玩家会觉得"它莫名其妙就生气了"。
  //
  //   7 次的含义：在 3.2 秒内摸超过 7 下（约 2.2 次/秒）才算骚扰。
  //   这个节奏在生理上已经不是"摸"而是"戳"。
  threshold: 7,
  annoyancePerExcess: 0.34,
  decayPerSec: 0.3,
  // ★ leaveAt 必须是**可达**的值。
  //   annoyance 经 clamp01 上限为 1.0，而性格修正还会乘一个可能 > 1 的系数。
  //   取 1.0 会导致"烦躁永远达不到阈值、狗永远不走开" ——
  //   这个 bug 在开发中真实出现过两次（graybox 与 graybox-shy）。
  //   校验器现已强制要求 ≤ 0.85。
  leaveAt: 0.78,
  sulkMs: 5200,
};

const DEFAULT_AFFECTION: AffectionConfig = {
  bonding: DEFAULT_BONDING,
  petting: DEFAULT_PETTING,
  annoyance: DEFAULT_ANNOYANCE,
};

/**
 * 默认房间。
 *
 * floorLineRatio 0.74 表示下方 26% 是地板 ——
 * 这个比例让狗有足够空间走动，同时地板占据画面下方形成"房间"的感觉。
 */
const DEFAULT_ROOM: RoomConfig = {
  floorLineRatio: 0.74,
  floorColor: 0x1e1e26,
  floorShadeColor: 0x16161c,
  wallColor: 0x121218,
  showGrid: false,
  // 玩家锚点：画面下方中央，代表"玩家坐在屏幕外看着狗"
  playerAnchor: { xRatio: 0.5, yRatio: 1.15 },
};

/** 中性兜底犬种。仅用于类型与默认值推导，不出现在犬种清单中 */
export const DEFAULT_SPECIES: SpeciesData = {
  $schema: SPECIES_SCHEMA_VERSION,
  version: '1.0.0',
  id: '__default__',
  displayName: { zh: '中性基准', en: 'Neutral Baseline' },
  catalogNo: 'LDC-000',
  description: { zh: '引擎默认值，不作为一个犬种出现。', en: 'Engine defaults. Not a real species.' },
  physical: DEFAULT_PHYSICAL,
  personality: DEFAULT_PERSONALITY,
  cognition: DEFAULT_COGNITION,
  animation: DEFAULT_ANIMATION,
  needs: DEFAULT_NEEDS,
  preferences: DEFAULT_PREFERENCES,
  locomotion: DEFAULT_LOCOMOTION,
  resources: DEFAULT_RESOURCES,
  affection: DEFAULT_AFFECTION,
  room: DEFAULT_ROOM,
};

/**
 * 引擎内置的通用状态集。
 * ★ 状态是「通用行为」，不是犬种专属。
 *   新增状态 = 架构级改动，需要同时更新这里与灰盒渲染。
 */
export const CORE_STATE_IDS = ['Idle', 'Walk', 'Sit', 'Sleep'] as const;
export type CoreStateId = (typeof CORE_STATE_IDS)[number];

/**
 * Milestone 2 新增的交互状态。
 *
 * ★ 为什么这些是「通用状态」而不是犬种专属：
 *   LookAt / Approach / PetEnjoy / Annoyed / Retreat 描述的是
 *   任何狗都会有的**互动姿态**，差异在于触发阈值与持续时间 ——
 *   那些全部来自 JSON。因此它们属于引擎，不属于犬种。
 */
export const INTERACTION_STATE_IDS = [
  'LookAt',
  'Approach',
  'WagTail',
  'PetEnjoy',
  'Annoyed',
  'Retreat',
] as const;
export type InteractionStateId = (typeof INTERACTION_STATE_IDS)[number];

/** 全部核心状态（通用行为 + 互动姿态） */
export const ALL_CORE_STATE_IDS = [...CORE_STATE_IDS, ...INTERACTION_STATE_IDS] as const;

/**
 * 中性行为权重。
 * 犬种通过 behaviors.json 覆盖，未覆盖的继承此处。
 */
const DEFAULT_STATE_WEIGHTS: Record<string, number> = {
  Idle: 40,
  Walk: 25,
  Sit: 18,
  Sleep: 10,
  // 以下为 Phase 2+ 预留，Phase 0/1 未注册对应状态，打分时会被自动忽略
  Eat: 5,
  Play: 3,
  Watch: 2,
};

const DEFAULT_PERSONALITY_BIAS: BehaviorsData['personalityBias'] = {
  Walk: { energy: { sensitivity: 1.5 } },
  Sit: { energy: { sensitivity: -0.6 } },
  Sleep: { energy: { sensitivity: -1.2 } },
  Idle: { curiosity: { sensitivity: 0.3 } },
};

export const DEFAULT_BEHAVIORS: BehaviorsData = {
  $schema: BEHAVIORS_SCHEMA_VERSION,
  id: '__default__',
  stateWeights: DEFAULT_STATE_WEIGHTS,
  personalityBias: DEFAULT_PERSONALITY_BIAS,
  interactionResponse: {},
  microBehaviors: [],
  extraRandomness: 0,

  // ── Milestone 2 默认：抚摸与骚扰的回应分布 ──
  //
  // 这两个表决定"被摸时怎么表现"。默认值是**中性犬**：
  // 大部分时候接受，偶尔转头，极少走开。
  // 犬种通过 behaviors.json 覆盖即可表达性格（柴犬回避权重更高、
  // 边牧几乎从不回避等），无需改代码。
  pettingResponse: {
    weights: {
      accept: 62, // 接受，继续享受
      leanIn: 18, // 主动贴近（依恋的狗权重更高）
      lookUp: 14, // 抬头看你
      pullAway: 6, // 轻微躲开
    },
    cooldownMs: 0,
  },

  annoyanceResponse: {
    weights: {
      turnHeadAway: 48, // 轻度：把头转开
      standUp: 30, // 中度：起身
      walkAway: 22, // 重度：走开
    },
    cooldownMs: 0,
  },

  annoyanceBias: {
    // 温柔的狗更能忍受反复抚摸
    gentleness: { sensitivity: -1.2 },
    // 固执的狗更容易被惹烦
    stubbornness: { sensitivity: 0.9 },
  },
};

/** 计算灰盒方块的最终像素尺寸 */
export function resolveGrayboxSize(species: SpeciesData): { w: number; h: number } {
  const scale = species.physical.bodyScale;
  return {
    w: Math.max(4, Math.round(GRAYBOX_BASE_SIZE.w * scale)),
    h: Math.max(4, Math.round(GRAYBOX_BASE_SIZE.h * scale)),
  };
}
