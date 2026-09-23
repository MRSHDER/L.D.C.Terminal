/**
 * L.D.C. — 数据契约（Data Contracts）
 *
 * ★★★ 本文件是整个项目扩展性的地基 ★★★
 *
 * 规则：
 *  - 这里只定义「数据结构」，不含任何行为逻辑、不含任何犬种专属内容。
 *  - 所有字段分为两类：
 *      Required（必需）：新犬种必须显式填写，代表"这是这只狗的独特性所在"
 *      Optional（可选）：有 DEFAULT_SPECIES 兜底，不写就是继承默认值
 *  - 新增犬种时本文件不应被修改。若确实需要新字段：
 *      1) 加为 optional + 给默认值（向后兼容）
 *      2) 升级 SPECIES_SCHEMA_VERSION 并写迁移函数
 */

import type { Vector2 } from '../world/Vector2';

export type WorldPosition = Vector2;

export const SPECIES_SCHEMA_VERSION = 'ldc/species/v1';
export const BEHAVIORS_SCHEMA_VERSION = 'ldc/behaviors/v1';

export type LocalizedText = Partial<Record<'zh' | 'en' | 'ja', string>> & { zh?: string };
export type NumericRange = readonly [min: number, max: number];
export type Polygon = readonly (readonly [x: number, y: number])[];

export interface PettingHotspot {
  readonly id: string;
  readonly poly: Polygon;
  readonly reaction: string;
}

/** 耳型。渲染器只认识这三种画法，不认识具体犬种。 */
export type EarShape = 'prick' | 'drop' | 'fold';

export interface SilhouetteConfig {
  readonly bodyLength: number;
  readonly chestDepth: number;
  readonly legLength: number;
  readonly headForward: number;
  readonly headSize: number;
  readonly snoutLength: number;
  readonly earShape: EarShape;
  readonly earLength: number;
  readonly tailAttach: number;
}

/**
 * 程序化毛色。渲染器只认识色板 + 开关，不认识「伯恩山」。
 * 三色犬把 markings 打开即可，单色灰盒保持全 false。
 */
export interface CoatMarkings {
  readonly blaze: boolean;
  readonly muzzle: boolean;
  readonly bib: boolean;
  readonly socks: boolean;
  readonly rustPoints: boolean;
  readonly tailTip: boolean;
}

export interface CoatConfig {
  readonly base: number;
  readonly shade: number;
  readonly highlight: number;
  readonly outline: number;
  readonly rust: number;
  readonly rustShade: number;
  readonly white: number;
  readonly whiteShade: number;
  readonly nose: number;
  readonly eye: number;
  readonly markings: CoatMarkings;
}

export interface PhysicalConfig {
  readonly bodyScale: number;
  readonly hitbox: { readonly w: number; readonly h: number; readonly anchorY: number };
  readonly pettingHotspots: readonly PettingHotspot[];
  readonly grayboxTint: number;
  readonly silhouette: SilhouetteConfig;
  readonly coat: CoatConfig;
}

export interface Temperament {
  readonly gentleness: number;
  readonly energy: number;
  readonly curiosity: number;
  readonly stubbornness: number;
  readonly shyness: number;
  readonly clinginess: number;
  readonly playfulness: number;
  readonly obedience: number;
  readonly randomness: number;
}

export type TemperamentKey = keyof Temperament;

export interface PersonalityConfig {
  readonly temperament: Temperament;
  readonly traits: readonly string[];
}

export interface CognitionConfig {
  readonly decisionIntervalMs: number;
  readonly reactionDelayMs: NumericRange;
  readonly attentionSpanMs: number;
  readonly memorySpanMs: number;
  readonly learningRate: number;
}

export interface BreathConfig {
  readonly freqHz: number;
  readonly ampPx: number;
  readonly bodyScaleY: number;
}

export interface BlinkConfig {
  readonly baseIntervalMs: number;
  readonly varianceMs: number;
  readonly durationMs: number;
}

export interface TailConfig {
  readonly segments: number;
  readonly baseAngleDeg: number;
  readonly maxSwingDeg: number;
  readonly delayPerSegMs: number;
}

export interface EarConfig {
  readonly jitterDeg: number;
  readonly triggerBias: number;
}

export interface FloatConfig {
  readonly ampPx: number;
  readonly freqHz: number;
}

export interface AnimationConfig {
  readonly targetFps: number;
  readonly breath: BreathConfig;
  readonly blink: BlinkConfig;
  readonly tail: TailConfig;
  readonly ear: EarConfig;
  readonly float: FloatConfig;
  readonly transitions: Readonly<Record<string, number>>;
  readonly defaultTransitionMs: number;
}

export interface NeedConfig {
  readonly decayPerMin: number;
  readonly criticalAt: number;
  readonly restorePerMin?: number;
}

export interface NeedsConfig {
  readonly hunger: NeedConfig;
  readonly energy: NeedConfig;
  readonly social: NeedConfig;
}

export interface PreferencesConfig {
  readonly food: {
    readonly base: number;
    readonly favorites: readonly string[];
    readonly dislikes: readonly string[];
  };
  readonly toys: Readonly<Record<string, number>>;
  readonly places: Readonly<Record<string, number>>;
  readonly touch: Readonly<Record<string, number>>;
}

export interface LocomotionConfig {
  readonly walkSpeedPx: number;
  readonly runSpeedPx: number;
  readonly turnRateDeg: number;
  readonly idleWanderRadiusPx: number;
  readonly wanderChancePerMin: number;
  readonly arriveThresholdPx: number;
}

export interface ResourcesConfig {
  readonly assetRoot: string;
  readonly animationClips: Readonly<Record<string, readonly string[]>>;
  readonly audio?: Readonly<Record<string, string>>;
}

export interface SpeciesData {
  readonly $schema: string;
  readonly version: string;
  readonly id: string;
  readonly displayName: LocalizedText;
  readonly catalogNo: string;
  readonly description: LocalizedText;
  readonly physical: PhysicalConfig;
  readonly personality: PersonalityConfig;
  readonly cognition: CognitionConfig;
  readonly animation: AnimationConfig;
  readonly needs: NeedsConfig;
  readonly preferences: PreferencesConfig;
  readonly locomotion: LocomotionConfig;
  readonly resources: ResourcesConfig;
  readonly affection: AffectionConfig;
  readonly room: RoomConfig;
}

export interface BondRung {
  readonly atBond: number;
  readonly state: string;
  readonly label: LocalizedText;
}

export interface BondingConfig {
  readonly gainPerPet: number;
  readonly decayPerSec: number;
  readonly penaltyPerSecWhenAnnoyed: number;
  readonly ladder: readonly BondRung[];
  readonly requiresTouchToNotice: boolean;
}

export interface PettingConfig {
  readonly minEffectiveMs: number;
  readonly pleasureBase: number;
  readonly arousalGain: number;
  readonly tolerance: number;
}

export interface AnnoyanceConfig {
  readonly windowMs: number;
  readonly threshold: number;
  readonly annoyancePerExcess: number;
  readonly decayPerSec: number;
  readonly leaveAt: number;
  readonly sulkMs: number;
}

export interface AffectionConfig {
  readonly bonding: BondingConfig;
  readonly petting: PettingConfig;
  readonly annoyance: AnnoyanceConfig;
}

export interface RoomConfig {
  readonly floorLineRatio: number;
  readonly floorColor: number;
  readonly floorShadeColor: number;
  readonly wallColor: number;
  readonly showGrid: boolean;
  readonly playerAnchor: { readonly xRatio: number; readonly yRatio: number };
}

export interface PersonalityBiasEntry {
  readonly sensitivity: number;
}

export type PersonalityBiasMap = Readonly<
  Record<string, Readonly<Partial<Record<TemperamentKey, PersonalityBiasEntry>>>>
>;

export interface WeightCondition {
  readonly when: string;
  readonly weights?: Readonly<Record<string, number>>;
  readonly randomness?: number;
}

export interface InteractionResponse {
  readonly weights: Readonly<Record<string, number>>;
  readonly conditions?: readonly WeightCondition[];
  readonly cooldownMs?: number;
  readonly requiresAttention?: boolean;
}

export interface MicroBehavior {
  readonly id: string;
  readonly chancePerMin: number;
  readonly when?: string;
}

export interface BehaviorsData {
  readonly $schema: string;
  readonly id: string;
  readonly stateWeights: Readonly<Record<string, number>>;
  readonly personalityBias: PersonalityBiasMap;
  readonly interactionResponse: Readonly<Record<string, InteractionResponse>>;
  readonly microBehaviors: readonly MicroBehavior[];
  readonly extraRandomness: number;
  readonly pettingResponse?: InteractionResponse;
  readonly annoyanceResponse?: InteractionResponse;
  readonly annoyanceBias?: Readonly<Partial<Record<TemperamentKey, PersonalityBiasEntry>>>;
}
