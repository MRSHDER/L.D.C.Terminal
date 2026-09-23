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
};

/**
 * 引擎内置的通用状态集。
 * ★ 状态是「通用行为」，不是犬种专属。
 *   新增状态 = 架构级改动，需要同时更新这里与灰盒渲染。
 */
export const CORE_STATE_IDS = ['Idle', 'Walk', 'Sit', 'Sleep'] as const;
export type CoreStateId = (typeof CORE_STATE_IDS)[number];

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
};

/** 计算灰盒方块的最终像素尺寸 */
export function resolveGrayboxSize(species: SpeciesData): { w: number; h: number } {
  const scale = species.physical.bodyScale;
  return {
    w: Math.max(4, Math.round(GRAYBOX_BASE_SIZE.w * scale)),
    h: Math.max(4, Math.round(GRAYBOX_BASE_SIZE.h * scale)),
  };
}
