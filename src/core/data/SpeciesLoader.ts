/**
 * L.D.C. — 犬种数据加载器（SpeciesLoader）
 *
 * 职责（严格单一）：
 *   ① 取原始 JSON
 *   ② 与 DEFAULT_SPECIES 深合并（补齐缺省）
 *   ③ JSON Schema 校验（给出人类可读的错误路径）
 *   ④ 一致性检查（id 匹配、语义约束）
 *   ⑤ 深冻结
 *
 * ★ 本文件不含任何犬种专属内容，也不做任何行为判断。
 *   它的唯一职责是「保证交给引擎的数据是完整且合法的」。
 *
 * 降级策略（重要）：
 *   加载失败不抛异常崩溃，而是回退到 DEFAULT_SPECIES 并发出 species:failed。
 *   这让资源缺失 / JSON 写错的贡献者 PR 不会导致白屏。
 */

import type { EventBus } from '../event/EventBus';
import type { SpeciesData, BehaviorsData } from './types';
import { SPECIES_SCHEMA_VERSION, BEHAVIORS_SCHEMA_VERSION } from './types';
import { DEFAULT_SPECIES, DEFAULT_BEHAVIORS } from './defaults';
import { deepMerge, deepFreeze, diffPaths } from './merge';
import { validateSpeciesShape, validateBehaviorsShape } from './validate';
import { GRAYBOX_BASE_SIZE } from './defaults';

/** 一个犬种的「原始」数据来源。由 species/ 目录提供，loader 不认识具体内容。 */
export interface SpeciesSource {
  readonly id: string;
  /** 原始 species JSON（未合并、未校验） */
  readonly species: unknown;
  /** 原始 behaviors JSON；缺失时使用默认行为表 */
  readonly behaviors?: unknown;
  /** 资源清单结果，用于报告缺失的动画帧 */
  readonly assetsAvailable?: boolean;
}

export interface LoadedSpecies {
  readonly species: SpeciesData;
  readonly behaviors: BehaviorsData;
  /** 相对默认值被覆盖的字段路径，供调试面板与文档生成 */
  readonly overriddenPaths: readonly string[];
  /** 非致命问题（如缺少美术资源、未注册的 clip） */
  readonly warnings: readonly string[];
  /** 是否已降级为默认值（加载失败时为 true） */
  readonly degraded: boolean;
}

export interface LoadResult {
  readonly ok: boolean;
  readonly loaded: LoadedSpecies;
  readonly errors: readonly string[];
}

export class SpeciesLoader {
  private readonly bus: EventBus | undefined;

  constructor(bus?: EventBus) {
    this.bus = bus;
  }

  /**
   * 加载并归一化单个犬种。
   * 永不抛出 —— 失败时返回 degraded 结果。
   */
  load(source: SpeciesSource): LoadResult {
    this.bus?.emit('species:loading', { id: source.id });

    const errors: string[] = [];
    const warnings: string[] = [];

    // ① 结构校验（在合并之前，先抓"用户写错"而不是"默认值掩盖了错误"）
    const rawRecord = source.species as Record<string, unknown> | undefined;
    if (!rawRecord || typeof rawRecord !== 'object') {
      errors.push('species 数据缺失或不是对象');
      return this.degrade(source.id, errors);
    }

    if (rawRecord['$schema'] !== SPECIES_SCHEMA_VERSION) {
      errors.push(
        `$schema 不匹配：期望 "${SPECIES_SCHEMA_VERSION}"，实际 ${JSON.stringify(rawRecord['$schema'])}`,
      );
    }
    if (rawRecord['id'] !== source.id) {
      errors.push(`id 与目录不一致：目录/注册表为 "${source.id}"，JSON 内为 ${JSON.stringify(rawRecord['id'])}`);
    }

    const shapeErrors = validateSpeciesShape(rawRecord);
    errors.push(...shapeErrors);

    if (errors.length > 0) {
      return this.degrade(source.id, errors);
    }

    // ② 深合并补齐默认值
    const mergedSpecies = deepMerge(DEFAULT_SPECIES, source.species) as SpeciesData;

    // ③ behaviors：缺失则继承默认，存在则校验后合并
    let mergedBehaviors: BehaviorsData;
    if (source.behaviors !== undefined) {
      const bRecord = source.behaviors as Record<string, unknown>;
      if (bRecord['$schema'] !== BEHAVIORS_SCHEMA_VERSION) {
        warnings.push(
          `behaviors.$schema 不匹配（期望 ${BEHAVIORS_SCHEMA_VERSION}），已按当前版本解析`,
        );
      }
      if (bRecord['id'] !== undefined && bRecord['id'] !== source.id) {
        warnings.push(`behaviors.id ("${String(bRecord['id'])}") 与犬种 id 不一致，已忽略该字段`);
      }
      const bShapeErrors = validateBehaviorsShape(bRecord);
      if (bShapeErrors.length > 0) {
        warnings.push(...bShapeErrors.map((e) => `behaviors: ${e}`));
        mergedBehaviors = deepMerge(DEFAULT_BEHAVIORS, { ...bRecord, id: source.id });
      } else {
        mergedBehaviors = deepMerge(DEFAULT_BEHAVIORS, { ...bRecord, id: source.id });
      }
    } else {
      mergedBehaviors = deepMerge(DEFAULT_BEHAVIORS, { id: source.id });
      warnings.push('未提供 behaviors.json，已使用默认行为权重');
    }

    // ④ 语义一致性检查（非致命，仅告警）
    warnings.push(...checkSemantics(mergedSpecies, mergedBehaviors));

    // ⑤ 冻结
    const species = deepFreeze(mergedSpecies) as SpeciesData;
    const behaviors = deepFreeze(mergedBehaviors) as BehaviorsData;

    const overriddenPaths = [
      ...diffPaths(DEFAULT_SPECIES, source.species),
      ...(source.behaviors !== undefined ? diffPaths(DEFAULT_BEHAVIORS, source.behaviors) : []),
    ].filter((p) => !p.startsWith('$schema') && !p.endsWith('.id') && p !== 'id');

    this.bus?.emit('species:loaded', { id: species.id, catalogNo: species.catalogNo });

    return {
      ok: true,
      loaded: { species, behaviors, overriddenPaths, warnings, degraded: false },
      errors: [],
    };
  }

  /** 降级：回退到默认值，但保留 id 以便 UI 能显示"这是谁出了问题" */
  private degrade(id: string, errors: readonly string[]): LoadResult {
    const fallbackSpecies = deepMerge(DEFAULT_SPECIES, {
      id,
      displayName: { zh: `[加载失败] ${id}`, en: `[Load failed] ${id}` },
      catalogNo: 'LDC-000',
    }) as SpeciesData;

    const species = deepFreeze(fallbackSpecies) as SpeciesData;
    const behaviors = deepFreeze(deepMerge(DEFAULT_BEHAVIORS, { id })) as BehaviorsData;

    for (const e of errors) {
      console.error(`[SpeciesLoader] "${id}" 加载失败：${e}`);
      this.bus?.emit('species:failed', { id, error: e });
    }

    return {
      ok: false,
      loaded: {
        species,
        behaviors,
        overriddenPaths: [],
        warnings: ['已降级为默认值运行。请修复上述错误后重试。'],
        degraded: true,
      },
      errors,
    };
  }
}

/**
 * 语义检查：捕获"结构合法但逻辑上说不通"的配置。
 * 这些不是错误，但几乎总是作者笔误，所以要在控制台明确提示。
 */
function checkSemantics(species: SpeciesData, behaviors: BehaviorsData): string[] {
  const warnings: string[] = [];

  // 1. 动画帧率为 0 或负数（schema 已拦，双保险）
  if (species.animation.targetFps <= 0) {
    warnings.push('animation.targetFps 必须 > 0，已回落为默认 10');
    (species.animation as { targetFps: number }).targetFps = DEFAULT_SPECIES.animation.targetFps;
  }

  // 2. 帧间步进过大：超过 40px 会让低帧率下出现"瞬移感"
  const stepPx = species.locomotion.walkSpeedPx / species.animation.targetFps;
  if (stepPx > 40) {
    warnings.push(
      `walkSpeedPx(${species.locomotion.walkSpeedPx}) / targetFps(${species.animation.targetFps}) = ${stepPx.toFixed(1)}px 每帧，` +
        `超过 40px 会产生瞬移感。建议提高 targetFps 或降低 walkSpeedPx。`,
    );
  }

  // 3. 行为权重引用了未在 stateWeights 中定义的状态
  const knownStates = new Set(Object.keys(behaviors.stateWeights));
  for (const stateId of Object.keys(behaviors.personalityBias)) {
    if (!knownStates.has(stateId)) {
      warnings.push(`personalityBias 引用了 stateWeights 中不存在的状态 "${stateId}"，该配置不会生效`);
    }
  }

  // 4. 反应延迟上界小于下界
  const [lo, hi] = species.cognition.reactionDelayMs;
  if (hi < lo) {
    warnings.push(`cognition.reactionDelayMs = [${lo}, ${hi}] 上界小于下界，已交换`);
    (species.cognition as unknown as { reactionDelayMs: [number, number] }).reactionDelayMs = [hi, lo];
  }

  // 5. 决策间隔
  if (species.cognition.decisionIntervalMs < 16) {
    warnings.push('cognition.decisionIntervalMs 小于一帧（16ms），会退化为每帧决策');
  }

  // 6. 灰盒尺寸
  const w = GRAYBOX_BASE_SIZE.w * species.physical.bodyScale;
  if (w < 4) {
    warnings.push(`bodyScale(${species.physical.bodyScale}) 导致灰盒宽度 < 4px，已钳制`);
  }

  return warnings;
}
