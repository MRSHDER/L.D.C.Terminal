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

/**
 * 预留：交互对象的世界坐标。Phase 3 接入食物/球时使用，
 * 因此本文件从 Phase 0 起就保留 Vector2 的类型位置。
 */
export type WorldPosition = Vector2;

/** Schema 版本。结构发生不兼容变更时递增，并在 loader 中提供迁移。 */
export const SPECIES_SCHEMA_VERSION = 'ldc/species/v1';
export const BEHAVIORS_SCHEMA_VERSION = 'ldc/behaviors/v1';

// ─────────────────────────────────────────────────────────────
// 基础工具类型
// ─────────────────────────────────────────────────────────────

/** 多语言文本。至少要有 zh 或 en 之一。 */
export type LocalizedText = Partial<Record<'zh' | 'en' | 'ja', string>> & { zh?: string };

/** 数值区间 [min, max]，用于表达"每次都不一样" */
export type NumericRange = readonly [min: number, max: number];

/** 二维多边形（用于命中热区），按顺序连接，最后一点自动闭合 */
export type Polygon = readonly (readonly [x: number, y: number])[];

// ─────────────────────────────────────────────────────────────
// 1. 物理（Physical）
// ─────────────────────────────────────────────────────────────

export interface PettingHotspot {
  readonly id: string;
  /** 相对犬只锚点的多边形，单位为像素 */
  readonly poly: Polygon;
  /** 摸这里的语义标签，交给 behaviors.json 决定具体表现 */
  readonly reaction: string;
}

export interface PhysicalConfig {
  /** 相对基准体型的缩放。1.0 = 基准。伯恩山约 1.35，柴犬约 0.85 */
  readonly bodyScale: number;
  /** 碰撞体尺寸（世界像素，未乘 bodyScale） */
  readonly hitbox: { readonly w: number; readonly h: number; readonly anchorY: number };
  /** 可抚摸热区。空数组 = 不支持分区抚摸（仍有整体回应） */
  readonly pettingHotspots: readonly PettingHotspot[];
  /** 灰盒模式下的占位色（美术接入前的方块颜色） */
  readonly grayboxTint: number;
}

// ─────────────────────────────────────────────────────────────
// 2. 性格（Personality）—— 全部 0..1
// ─────────────────────────────────────────────────────────────

/**
 * 性格维度表。
 * 这些值本身不产生行为，它们作为「乘子输入」影响行为权重、动画节奏与认知参数。
 * 增加维度 = 让所有犬种都能多一个可调的表达面，属于架构级改动。
 */
export interface Temperament {
  /** 温柔程度：影响抚摸回应、被粗鲁对待时的容忍度 */
  readonly gentleness: number;
  /** 精力：影响走动频率、睡眠需求、动画幅度 */
  readonly energy: number;
  /** 好奇心：影响接近新物体的意愿 */
  readonly curiosity: number;
  /** 固执：影响指令遵从、被打断时的反应 */
  readonly stubbornness: number;
  /** 害羞：影响接近玩家的速度、对陌生交互的回避 */
  readonly shyness: number;
  /** 依恋：影响跟随玩家、靠近倾向 */
  readonly clinginess: number;
  /** 玩心：影响玩耍类行为权重 */
  readonly playfulness: number;
  /** 服从：影响对指令的响应概率 */
  readonly obedience: number;
  /** 随机性：影响所有权重表的"打散"程度 —— 越高越不按套路 */
  readonly randomness: number;
}

export type TemperamentKey = keyof Temperament;

export interface PersonalityConfig {
  readonly temperament: Temperament;
  /** 自由标签，供 UI 展示与检索，不参与逻辑计算 */
  readonly traits: readonly string[];
}

// ─────────────────────────────────────────────────────────────
// 3. 认知（Cognition）—— 决定"思考节奏"
// ─────────────────────────────────────────────────────────────

export interface CognitionConfig {
  /** 决策间隔（ms）。越大越"迟钝"。伯恩山 900，边牧 180 */
  readonly decisionIntervalMs: number;
  /** 反应延迟区间（ms）。感知到刺激到实际开始反应的时间 */
  readonly reactionDelayMs: NumericRange;
  /** 注意力维持时长（ms）。超过后可能放弃当前目标 */
  readonly attentionSpanMs: number;
  /** 记忆维持时长（ms）。目标消失后还记得多久 */
  readonly memorySpanMs: number;
  /** 学习率 0..1。越高越容易改变偏好、建立信任越快 */
  readonly learningRate: number;
}

// ─────────────────────────────────────────────────────────────
// 4. 动画（Animation）
// ─────────────────────────────────────────────────────────────

export interface BreathConfig {
  readonly freqHz: number;
  readonly ampPx: number;
  /** 身体纵向缩放幅度（0.018 = 1.8%） */
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
  /** 每节尾巴的延迟（ms），产生鞭状跟随效果 */
  readonly delayPerSegMs: number;
}

export interface EarConfig {
  readonly jitterDeg: number;
  /** 每帧触发抖动的偏置概率 */
  readonly triggerBias: number;
}

export interface FloatConfig {
  readonly ampPx: number;
  readonly freqHz: number;
}

export interface AnimationConfig {
  /** ★ 目标帧率。这本身就是性格语言：伯恩山 8，边牧 12 */
  readonly targetFps: number;
  readonly breath: BreathConfig;
  readonly blink: BlinkConfig;
  readonly tail: TailConfig;
  readonly ear: EarConfig;
  readonly float: FloatConfig;
  /** 状态过渡时长（ms），key 为 `${from}->${to}`，缺省用 fallback */
  readonly transitions: Readonly<Record<string, number>>;
  /** 过渡缺省时长（ms） */
  readonly defaultTransitionMs: number;
}

// ─────────────────────────────────────────────────────────────
// 5. 需求（Needs）—— 连续衰减模型
// ─────────────────────────────────────────────────────────────

export interface NeedConfig {
  /** 每分钟的衰减量（0..1 单位） */
  readonly decayPerMin: number;
  /** 超过此值时进入「紧急」，行为权重开始显著偏移 */
  readonly criticalAt: number;
  /** 可选：恢复速率（如睡觉恢复精力、被摸恢复社交） */
  readonly restorePerMin?: number;
}

export interface NeedsConfig {
  readonly hunger: NeedConfig;
  readonly energy: NeedConfig;
  readonly social: NeedConfig;
}

// ─────────────────────────────────────────────────────────────
// 6. 偏好（Preferences）—— 全部 0..1
// ─────────────────────────────────────────────────────────────

export interface PreferencesConfig {
  readonly food: {
    readonly base: number;
    readonly favorites: readonly string[];
    readonly dislikes: readonly string[];
  };
  /** 玩具 id → 喜好度 */
  readonly toys: Readonly<Record<string, number>>;
  /** 地点 id → 喜好度 */
  readonly places: Readonly<Record<string, number>>;
  /** 被抚摸部位 id → 接受度 */
  readonly touch: Readonly<Record<string, number>>;
}

// ─────────────────────────────────────────────────────────────
// 7. 运动（Locomotion）
// ─────────────────────────────────────────────────────────────

export interface LocomotionConfig {
  readonly walkSpeedPx: number;
  readonly runSpeedPx: number;
  readonly turnRateDeg: number;
  /** 闲逛半径（世界像素） */
  readonly idleWanderRadiusPx: number;
  /** 每分钟自行开始走动的期望次数 */
  readonly wanderChancePerMin: number;
  /** 到目标点的停止距离（像素），避免抖动 */
  readonly arriveThresholdPx: number;
}

// ─────────────────────────────────────────────────────────────
// 8. 声库 / 资源
// ─────────────────────────────────────────────────────────────

export interface ResourcesConfig {
  /** 资源根目录，相对 public/ */
  readonly assetRoot: string;
  /** 每状态对应的图集帧名。灰盒模式下可为空 —— 引擎会画方块 */
  readonly animationClips: Readonly<Record<string, readonly string[]>>;
  /** 可选音效，缺失 = 静音降级 */
  readonly audio?: Readonly<Record<string, string>>;
}

// ─────────────────────────────────────────────────────────────
// 9. SpeciesData —— 单一犬种的完整数据
// ─────────────────────────────────────────────────────────────

export interface SpeciesData {
  readonly $schema: string;
  readonly version: string;
  /** 全局唯一 id，同时也是目录名 */
  readonly id: string;
  readonly displayName: LocalizedText;
  /** 档案编号，如 "LDC-001" */
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
  /** ★ Milestone 2：亲昵与骚扰相关配置 */
  readonly affection: AffectionConfig;
  /** ★ Milestone 2：房间配置（本阶段只有一个房间） */
  readonly room: RoomConfig;
}

// ─────────────────────────────────────────────────────────────
// 9.5 羁绊（Bonding）—— Milestone 2「第一次建立连接」
// ─────────────────────────────────────────────────────────────

/**
 * 一次「抚摸」的回应阶梯（Petting Ladder）。
 *
 * ★ 这是 Milestone 2 的核心机制，也是最容易做错的地方。
 *
 * 设计意图（来自项目要求）：
 *   玩家第一次点 → 看向玩家
 *   第二次       → 慢慢走过来
 *   第三次       → 坐你旁边
 *   第四次       → 摇尾巴
 *   第五次       → 闭眼
 *   玩家什么按钮都没点，只是"摸"，却觉得"它认识我了"。
 *
 * 关键：这不是"点五次解锁五个动作"的计数器。
 *   它是一个**由羁绊值驱动的连续阶梯**，且会因冷落而回落。
 *   因此"认识我"这件事必须靠**持续陪伴**维持 —— 这才是"生命感"。
 *
 * 每一级包含：
 *   atBond    —— 触发该级所需的羁绊值（0..1）
 *   state     —— 该级对应的状态 id（必须在状态机中已注册）
 *   minBond   —— 进入该级后，羁绊至少要维持在此值以上才不会掉级
 */
export interface BondRung {
  /** 触发该级所需的羁绊值阈值（0..1，严格递增） */
  readonly atBond: number;
  /** 该级对应的状态 id */
  readonly state: string;
  /** 人类可读的说明（仅用于调试面板与文档） */
  readonly label: LocalizedText;
}

/**
 * 羁绊系统配置。
 *
 * 羁绊值 bond ∈ [0, 1]，是**慢变量**：
 *   - 每次被温柔对待都会缓慢上升
 *   - 长时间无人理会会缓慢下降
 *   - 连续骚扰（快速连点）会明显下降
 *
 * 它不直接控制行为，而是决定「回应阶梯踩到哪一级」。
 */
export interface BondingConfig {
  /**
   * 每次有效抚摸增加的羁绊值。
   * 参考：0.12 → 约 8 次抚摸达到满羁绊。
   * 数值越大，狗越"自来熟"。
   */
  readonly gainPerPet: number;
  /** 每秒自然衰减（无人理会时）。0.004 → 约 4 分钟从满到空 */
  readonly decayPerSec: number;
  /** 被骚扰（快速连点）时每秒额外扣除 */
  readonly penaltyPerSecWhenAnnoyed: number;
  /** 羁绊回应的阶梯。必须按 atBond 升序，且第一级通常为 0 */
  readonly ladder: readonly BondRung[];
  /**
   * 「看向玩家」是否需要玩家先进入狗的注意范围。
   * true  → 狗只在被摸到时才看过来（更被动，更像陌生狗）
   * false → 狗会主动留意玩家的存在
   */
  readonly requiresTouchToNotice: boolean;
}

/**
 * 抚摸回应配置。
 *
 * 决定「摸一下会发生什么」。与 bonding 分工：
 *   bonding  → 决定**长期**亲近程度（记得你）
 *   petting  → 决定**当下**这一下怎么回应（瞬间反应）
 */
export interface PettingConfig {
  /** 单次抚摸的判定：按住超过该时长算一次有效抚摸 */
  readonly minEffectiveMs: number;
  /**
   * 一次抚摸产生的基础愉悦（提升 valence）。
   * 会被当前羁绊值放大 —— 越亲近，被摸越开心。
   */
  readonly pleasureBase: number;
  /**
   * 抚摸时的兴奋度增量（尾巴摆得更欢）。
   * 高能量犬种数值更高。
   */
  readonly arousalGain: number;
  /** 同一位置连续抚摸的耐受次数，超过后开始烦躁 */
  readonly tolerance: number;
}

/**
 * 「骚扰」判定与反应。
 *
 * 项目要求里的"连续点 → 觉得烦 → 走开"。
 * 这里定义什么是"烦"：单位时间内的抚摸次数超过阈值。
 */
export interface AnnoyanceConfig {
  /** 统计窗口（ms）。在此窗口内的抚摸次数参与判定 */
  readonly windowMs: number;
  /** 窗口内超过该次数视为骚扰 */
  readonly threshold: number;
  /** 每次骚扰增加的不悦值 */
  readonly annoyancePerExcess: number;
  /** 不悦值的自然衰减（每秒） */
  readonly decayPerSec: number;
  /** 超过该值触发「走开」 */
  readonly leaveAt: number;
  /** 走开后需要多久才愿意再次接近（ms） */
  readonly sulkMs: number;
}

/** 亲昵/情绪相关配置集合 */
export interface AffectionConfig {
  readonly bonding: BondingConfig;
  readonly petting: PettingConfig;
  readonly annoyance: AnnoyanceConfig;
}

// ─────────────────────────────────────────────────────────────
// 9.6 房间（Room）—— Milestone 2 只有一个房间，无 UI
// ─────────────────────────────────────────────────────────────

/**
 * 房间配置。
 *
 * Milestone 2 刻意只做一个房间、不给任何 UI / 菜单 / 按钮。
 * 玩家能做的唯一事情就是「摸狗」。
 *
 * 地板高度用比例表示（0..1），便于适配不同窗口尺寸。
 */
export interface RoomConfig {
  /** 地板线位置（占画面高度的比例）。0.72 = 下方 28% 是地板 */
  readonly floorLineRatio: number;
  /** 地面色（十六进制） */
  readonly floorColor: number;
  /** 地面暗部色 */
  readonly floorShadeColor: number;
  /** 墙面色 */
  readonly wallColor: number;
  /** 是否绘制网格（仅开发期参考，正式体验应为 false） */
  readonly showGrid: boolean;
  /**
   * 玩家所在的"世界外"位置（点击点的默认落点）。
   * 用于「狗看向玩家」——狗需要知道玩家在哪。
   * 坐标同样为比例 0..1。
   */
  readonly playerAnchor: { readonly xRatio: number; readonly yRatio: number };
}

// ─────────────────────────────────────────────────────────────
// 10. BehaviorsData —— 行为权重表
// ─────────────────────────────────────────────────────────────

/** 性格维度对某状态的敏感度配置 */
export interface PersonalityBiasEntry {
  readonly sensitivity: number;
}

/**
 * 行为权重表。
 * 结构：状态 id → 性格维度 → 敏感度
 * 计算：multiplier = 1 + (temperamentValue - 0.5) * sensitivity * 2
 *
 * 例：Walk 对 energy 敏感度 1.6
 *     energy=0.95 → 1 + 0.45*1.6*2 = 2.44 倍（爱走动）
 *     energy=0.35 → 1 + (-0.15)*1.6*2 = 0.52 倍（不爱动）
 */
export type PersonalityBiasMap = Readonly<
  Record<string, Readonly<Partial<Record<TemperamentKey, PersonalityBiasEntry>>>>
>;

/** 条件分支：满足 when 时覆盖权重 */
export interface WeightCondition {
  /** 条件表达式，由 BehaviorResolver 的安全求值器解析 */
  readonly when: string;
  /** 覆盖的部分权重（未列出的沿用基础权重） */
  readonly weights?: Readonly<Record<string, number>>;
  /** 覆盖的随机性（用于"完全不按套路"的特殊情形） */
  readonly randomness?: number;
}

/** 交互响应表 */
export interface InteractionResponse {
  /** 结果 id → 基础权重 */
  readonly weights: Readonly<Record<string, number>>;
  readonly conditions?: readonly WeightCondition[];
  /** 冷却（ms），防止连续触发 */
  readonly cooldownMs?: number;
  /** 是否需要狗先"注意到"玩家 */
  readonly requiresAttention?: boolean;
}

/** 微行为：低频、随机触发的小动作（抖耳、打哈欠、伸懒腰） */
export interface MicroBehavior {
  readonly id: string;
  readonly chancePerMin: number;
  readonly when?: string;
}

export interface BehaviorsData {
  readonly $schema: string;
  readonly id: string;
  /** 各状态的基础权重 */
  readonly stateWeights: Readonly<Record<string, number>>;
  readonly personalityBias: PersonalityBiasMap;
  readonly interactionResponse: Readonly<Record<string, InteractionResponse>>;
  readonly microBehaviors: readonly MicroBehavior[];
  /** 全局随机性附加量 0..1，叠加在 temperament.randomness 之上 */
  readonly extraRandomness: number;

  // ── Milestone 2 新增：全部可选，未提供则继承引擎默认 ──

  /**
   * 抚摸回应权重。
   * 决定「被摸时」狗的具体表现分布（接受 / 转头 / 走开 / 无反应）。
   * 与 species.affection.bonding 的阶梯配合：
   *   阶梯决定"它现在多亲近你"，此表决定"这一下它怎么回应"。
   */
  readonly pettingResponse?: InteractionResponse;

  /**
   * 骚扰反应权重（按烦躁程度分档）。
   * 未提供时使用引擎默认：轻度=转头，中度=起身，重度=走开。
   */
  readonly annoyanceResponse?: InteractionResponse;

  /**
   * 性格对"烦躁阈值"的修正。
   * 例如 gentleness 高 → 更能忍受反复抚摸。
   * 缺省为空对象，即不修正。
   */
  readonly annoyanceBias?: Readonly<
    Partial<Record<TemperamentKey, PersonalityBiasEntry>>
  >;
}
