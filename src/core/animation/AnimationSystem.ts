/**
 * L.D.C. — 动画系统（AnimationSystem）
 *
 * 职责：
 *   ① 把「状态」翻译成「动画请求」（clip + 播放速率）
 *   ② 按 FrameClock 的节拍推进关键帧
 *   ③ 叠加过程动画（ProceduralLayer）
 *   ④ 输出一个不可变的 RenderState 给渲染层
 *
 * ★ 本层是「状态 → 表现」的唯一桥梁。
 *   渲染层永远不读 FSM，FSM 永远不读渲染层。
 *   中间只有 RenderState 这一个数据结构。
 *
 * 灰盒模式（Phase 0/1）：
 *   species.resources.animationClips 为空 → 使用「程序化 clip」：
 *   走路用相位驱动的腿部摆动，坐下用压缩高度，睡觉用闭眼+降低。
 *   这样在没有美术素材时也能验证整套动画管线，且行为真实可信。
 */

import type { EventBus } from '../event/EventBus';
import type { SpeciesData } from '../data/types';
import type { StateId } from '../event/events';
import { FrameClock } from './FrameClock';
import { ProceduralLayer, type ProceduralContext, type ProceduralTransform } from './ProceduralLayer';

export interface ClipDefinition {
  readonly id: string;
  /** 帧名列表（图集内的帧）。空数组 = 程序化 clip */
  readonly frames: readonly string[];
  readonly loop: boolean;
  /** 每帧基础时长（ms），会再被 targetFps 量化 */
  readonly frameDurationMs: number;
}

/** 灰盒渲染状态。渲染层只依赖这个结构。 */
export interface RenderState {
  /** 世界坐标（未经过程动画偏移） */
  readonly x: number;
  readonly y: number;
  /** 灰盒尺寸 */
  readonly w: number;
  readonly h: number;
  readonly facingDeg: number;

  /** 当前播放的 clip */
  readonly clipId: string;
  /** 当前帧索引（程序化 clip 时表示相位帧） */
  readonly frameIndex: number;
  readonly frameCount: number;
  /** 0..1 的 clip 进度，供插值使用 */
  readonly clipProgress: number;

  /** 过程动画变换 */
  readonly procedural: ProceduralTransform;

  /** 灰盒姿态：由状态决定的额外形变 */
  readonly pose: GrayboxPose;

  /** 是否正在移动（渲染层可据此切换效果） */
  readonly moving: boolean;
  readonly speedRatio: number;
}

/** 灰盒姿态。美术接入后这些会被真实关键帧取代，但结构与语义保留。 */
export interface GrayboxPose {
  /** 身体高度比例 1.0 = 站立，0.7 = 坐下 */
  readonly bodyHeightRatio: number;
  /** 垂直阴影/接地偏移（像素） */
  readonly groundOffsetPx: number;
  /** 腿部摆动相位 -1..1（0 = 并拢） */
  readonly legPhase: number;
  /** 头部下沉量（像素），睡觉时下沉 */
  readonly headDropPx: number;
  /** 是否处于睡眠姿态 —— 渲染层据此把眼睛画成闭合线 */
  readonly sleeping: boolean;
  /**
   * 闭眼程度 0..1（Milestone 2）。
   *
   * ★ 与 procedural.eyeClosure 的区别：
   *   procedural.eyeClosure 是**眨眼反射**（短暂、周期性）
   *   pose.eyeClosure 是**情绪性闭眼**（持续、由享受程度驱动）
   *   两者取最大值渲染 —— 因为"享受时的闭眼"不会因为眨眼周期而睁开。
   */
  readonly eyeClosure: number;
}

export interface AnimationSystemOptions {
  readonly seed?: number;
  readonly debug?: boolean;
}

/** 每个状态对应的灰盒姿态插值目标 */
interface PoseTarget {
  readonly bodyHeightRatio: number;
  readonly headDropPx: number;
  readonly sleeping: boolean;
  /**
   * 该姿态下的眼睛闭合程度（情绪性，非眨眼）。
   * 缺省 0（睁眼）。仅 PetEnjoy / Sleep 等状态需要。
   */
  readonly eyeClosure?: number;
}

/**
 * 灰盒姿态表。
 * 这些是「通用状态 → 姿态」的映射，不含犬种特征。
 * 犬种差异通过 animation.targetFps / transitions 等参数体现。
 *
 * ★ Milestone 2 新增了互动状态的姿态：
 *   它们通过「身高比例 + 头部下沉」两个量就能表达出
 *   "看向你 / 走过来 / 坐下 / 享受 / 不高兴" 的区别，
 *   无需为每个状态单独做美术 —— 这正是灰盒的价值。
 */
const POSE_BY_STATE: Readonly<Record<string, PoseTarget>> = {
  // ── 常规行为 ──
  Idle: { bodyHeightRatio: 1, headDropPx: 0, sleeping: false },
  Walk: { bodyHeightRatio: 0.97, headDropPx: 0, sleeping: false },
  Sit: { bodyHeightRatio: 1, headDropPx: 0, sleeping: false },
  Sleep: { bodyHeightRatio: 1, headDropPx: 0, sleeping: false },

  // ── Milestone 2 互动姿态 ──
  // 看向玩家：站直、头抬起（headDropPx 为负 = 抬头）
  LookAt: { bodyHeightRatio: 1.0, headDropPx: -3, sleeping: false },
  // 靠近：走动姿态
  Approach: { bodyHeightRatio: 0.97, headDropPx: 0, sleeping: false },
  // 摇尾巴：站直且抬头，配合情绪层拉高的 arousal → 尾巴自动摆得欢
  WagTail: { bodyHeightRatio: 1.0, headDropPx: 0, sleeping: false },
  // 闭眼享受：坐下 + 头微垂（放松）。
  // ★ 目标值取 1.0 而非 0.85。
  //   姿态插值是指数逼近（每帧向目标靠近一部分），
  //   若目标恰好等于"判定为闭合"的阈值（0.85），
  //   插值会渐近逼近但永远达不到 —— 实测眼睛稳定在 0.81，
  //   视觉上一直停在"半闭"，玩家看不到明确的"闭上眼睛"。
  //   取 1.0 让插值有明确目标，约 600ms 后稳定在全闭状态。
  PetEnjoy: { bodyHeightRatio: 1, headDropPx: 0, sleeping: false, eyeClosure: 0 },
  // 烦躁：站直、头略偏（回避感）
  Annoyed: { bodyHeightRatio: 1.0, headDropPx: 2, sleeping: false },
  // 走开：走动姿态
  Retreat: { bodyHeightRatio: 0.97, headDropPx: 1, sleeping: false },
};

const DEFAULT_POSE: PoseTarget = POSE_BY_STATE['Idle']!;

export class AnimationSystem {
  private species: SpeciesData;
  private clock: FrameClock;
  private readonly procedural: ProceduralLayer;
  private readonly bus: EventBus | undefined;
  private readonly debug: boolean;

  private clips = new Map<string, ClipDefinition>();
  private currentClipId = 'Idle';
  private currentFrame = 0;

  // 姿态插值（sit/walk 之间平滑过渡，避免"啪"一下变矮）
  private pose: Required<PoseTarget> = {
    ...DEFAULT_POSE,
    eyeClosure: DEFAULT_POSE.eyeClosure ?? 0,
  };
  private legPhase = 0;

  // 上一次输出，用于复用与比较
  private lastProcedural: ProceduralTransform;

  constructor(species: SpeciesData, bus?: EventBus, options: AnimationSystemOptions = {}) {
    this.species = species;
    this.bus = bus;
    this.debug = options.debug ?? false;
    this.clock = new FrameClock({ targetFps: species.animation.targetFps });
    this.procedural = new ProceduralLayer(species, options.seed ?? 12345);
    this.lastProcedural = this.procedural.update(0);
    this.rebuildClips(species);
  }

  /** 运行时替换犬种（调试面板改 JSON 后调用） */
  setSpecies(species: SpeciesData): void {
    this.species = species;
    this.clock.setTargetFps(species.animation.targetFps);
    this.procedural.setSpecies(species);
    this.rebuildClips(species);
  }

  /** 从 species.resources.animationClips 构建 clip 表 */
  private rebuildClips(species: SpeciesData): void {
    this.clips.clear();
    const clipMap = species.resources.animationClips;

    for (const [id, frames] of Object.entries(clipMap)) {
      this.clips.set(id, {
        id,
        frames,
        loop: id !== 'Sleep' ? true : true,
        // 每帧时长由 targetFps 决定：8FPS → 125ms/帧
        frameDurationMs: 1000 / species.animation.targetFps,
      });
    }

    // 为常见状态补充程序化 clip（无美术素材时使用）。
    // Milestone 2 的互动状态也需要 clip 条目，否则 requestState 会回退到 Idle
    // 导致"看向玩家"与"待机"在调试面板上无法区分。
    for (const stateId of [
      'Idle',
      'Walk',
      'Sit',
      'Sleep',
      'LookAt',
      'Approach',
      'WagTail',
      'PetEnjoy',
      'Annoyed',
      'Retreat',
    ]) {
      if (!this.clips.has(stateId)) {
        this.clips.set(stateId, {
          id: stateId,
          frames: [],
          loop: true,
          frameDurationMs: 1000 / species.animation.targetFps,
        });
      }
    }
  }

  get clockFps(): number {
    return this.clock.fps;
  }

  get currentClip(): string {
    return this.currentClipId;
  }

  listClips(): readonly ClipDefinition[] {
    return [...this.clips.values()];
  }

  /**
   * 请求播放某个状态对应的动画。
   * 由 World 在状态切换时调用 —— 这是 FSM 与动画的唯一接触点。
   */
  requestState(stateId: StateId): void {
    const clip = this.clips.get(stateId) ?? this.clips.get('Idle');
    if (!clip) return;
    if (clip.id === this.currentClipId) return;

    const prev = this.currentClipId;
    this.currentClipId = clip.id;
    this.currentFrame = 0;

    this.bus?.emit('anim:clipEnd', { clipId: prev });
    this.bus?.emit('anim:clipStart', { clipId: clip.id });

    if (this.debug) console.debug(`[Anim] ${prev} → ${clip.id}`);
  }

  /**
   * 推进动画。
   * @param dtMs      逻辑帧时长
   * @param ctx       过程动画上下文
   * @param pose      由状态机推导的姿态上下文（速度、是否移动、是否睡眠）
   */
  update(
    dtMs: number,
    ctx: ProceduralContext,
    stateContext: { stateId: StateId; speedPxPerSec: number; moving: boolean },
  ): RenderState {
    const species = this.species;

    // ── ① 姿态插值 ──
    const target = POSE_BY_STATE[stateContext.stateId] ?? DEFAULT_POSE;
    // 过渡时长：优先取 species.animation.transitions 的 `${from}->${to}`，否则用默认值。
    // Phase 0/1 未记录 from，故使用 defaultTransitionMs —— 结构已为 Phase 5 预留。
    const transitionMs = species.animation.defaultTransitionMs;
    const t = transitionMs <= 0 ? 1 : Math.min(1, dtMs / transitionMs);

    this.pose = {
      bodyHeightRatio: this.pose.bodyHeightRatio + (target.bodyHeightRatio - this.pose.bodyHeightRatio) * t,
      headDropPx: this.pose.headDropPx + (target.headDropPx - this.pose.headDropPx) * t,
      sleeping: target.sleeping,
      eyeClosure:
        this.pose.eyeClosure + ((target.eyeClosure ?? 0) - this.pose.eyeClosure) * t,
    };

    // ── ② 像素帧推进（低帧率节拍）──
    const steps = this.clock.advance(dtMs);
    const clip = this.clips.get(this.currentClipId);
    const frameCount = Math.max(1, clip?.frames.length ?? 8); // 程序化 clip 用 8 相位

    if (steps > 0) {
      const prevFrame = this.currentFrame;
      this.currentFrame = (this.currentFrame + steps) % frameCount;
      if (this.currentFrame !== prevFrame) {
        this.bus?.emit('anim:frameChanged', {
          clipId: this.currentClipId,
          frame: this.currentFrame,
        });
      }
    }

    // ── ③ 腿部摆动相位 ──
    // 由速度驱动，而非帧号 —— 这样不同 targetFps 下"步频"仍然合理
    if (stateContext.moving && stateContext.speedPxPerSec > 0) {
      const stridesPerSec = stateContext.speedPxPerSec / 28;
      this.legPhase += dtMs / 1000 * stridesPerSec * Math.PI * 2;
      this.legPhase %= Math.PI * 2;
    } else {
      // 停止时归位到 0，避免腿停在奇怪角度
      const decay = Math.min(1, dtMs / 220);
      this.legPhase += (0 - this.legPhase) * decay;
    }

    // ── ④ 过程动画 ──
    // 睡眠时压低兴奋度、放大呼吸幅度（睡眠呼吸深而慢）
    const proceduralCtx: ProceduralContext = this.pose.sleeping
      ? { moving: false, speedRatio: 0, arousal: 0.03, alertness: 0.15 }
      : ctx;

    const procedural = this.procedural.update(dtMs, proceduralCtx);
    this.lastProcedural = procedural;

    // ── ⑤ 组装 RenderState ──
    const speedRatio = species.locomotion.runSpeedPx > 0
      ? Math.min(1, stateContext.speedPxPerSec / species.locomotion.runSpeedPx)
      : 0;

    return {
      x: 0, // 由 World 填充真实世界坐标
      y: 0,
      w: 0,
      h: 0,
      facingDeg: 0,
      clipId: this.currentClipId,
      frameIndex: this.currentFrame,
      frameCount,
      clipProgress: this.currentFrame / frameCount,
      procedural,
      pose: {
        bodyHeightRatio: this.pose.bodyHeightRatio,
        groundOffsetPx: 0,
        legPhase: Math.sin(this.legPhase),
        // ★ 微行为的额外低头（哈欠/伸懒腰）叠加在姿态低头之上。
        //   用加法而非覆盖：姿态低头表达"坐着/睡着"，
        //   微行为低头表达"打了个哈欠" —— 两者可以同时成立。
        headDropPx: this.pose.headDropPx + (ctx.extraHeadDropPx ?? 0),
        sleeping: this.pose.sleeping,
        eyeClosure: this.pose.eyeClosure,
      },
      moving: stateContext.moving,
      speedRatio,
    };
  }

  /** 最近一次的过程动画输出（只读，供调试面板） */
  get lastProceduralTransform(): ProceduralTransform {
    return this.lastProcedural;
  }

  reset(): void {
    this.currentFrame = 0;
    this.procedural.reset();
    this.clock.reset();
    this.pose = { ...DEFAULT_POSE, eyeClosure: DEFAULT_POSE.eyeClosure ?? 0 };
    this.legPhase = 0;
  }
}

