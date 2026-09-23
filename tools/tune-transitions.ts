/**
 * L.D.C. — 迁移标定工具
 *
 * 用法：npm run tune [speciesId]
 *
 * ★ 存在理由（这是本项目最重要的开发工具之一）
 *
 * FSM 的迁移分由「基础峰值 × patience 窗口 × 性格乘子 × 节奏因子」相乘得到，
 * 与门槛 UTILITY_THRESHOLD 比较。手工推算这些乘积极易出错 ——
 * 实际开发中反复出现两类失衡：
 *   - 某迁移峰值贴着门槛 → 该行为完全消失（Walk 曾整段不见）
 *   - 某迁移峰值远超门槛且窗口短 → 它垄断全部时间（Sit 曾占 62%）
 *
 * 本工具直接输出每个迁移的：
 *   峰值效用       —— 窗口走满时的最大分
 *   是否可达       —— 峰值 > 门槛
 *   触发时间       —— 从状态开始到过门槛所需毫秒（smoothstep 反解）
 *
 * 有了"触发时间"这一列，四条迁移的相对节奏一目了然：
 * 谁先谁后、谁永远不会发生，全部量化可见，不再靠猜。
 */

import { EventBus } from '../src/core/event/EventBus';
import { World } from '../src/core/world/World';
import { SpeciesRegistry } from '../src/core/data/SpeciesRegistry';
import type { SpeciesSource } from '../src/core/data/SpeciesLoader';

import grayboxSpecies from '../src/species/graybox/species.json';
import grayboxBehaviors from '../src/species/graybox/behaviors.json';
import swiftSpecies from '../src/species/graybox-swift/species.json';
import swiftBehaviors from '../src/species/graybox-swift/behaviors.json';
import shySpecies from '../src/species/graybox-shy/species.json';
import shyBehaviors from '../src/species/graybox-shy/behaviors.json';
import { INTERACTION_STATE_IDS } from '../src/core/data/defaults';

const SOURCES: readonly SpeciesSource[] = [
  { id: 'graybox', species: grayboxSpecies, behaviors: grayboxBehaviors },
  { id: 'graybox-swift', species: swiftSpecies, behaviors: swiftBehaviors },
  { id: 'graybox-shy', species: shySpecies, behaviors: shyBehaviors },
];

/**
 * 反解 smoothstep：给定目标值 y，求 t。
 * 当前标定流程用数值扫描（见下方循环），此处保留供解析式推导参考。
 */
// @ts-expect-error 保留工具函数，暂未在主流程中使用
function inverseSmoothstep(y: number): number {
  if (y <= 0) return 0;
  if (y >= 1) return 1;
  // smoothstep(t) = 3t² - 2t³ = y → 牛顿迭代足够快且稳定
  let t = y;
  for (let i = 0; i < 12; i++) {
    const f = 3 * t * t - 2 * t * t * t - y;
    const df = 6 * t - 6 * t * t;
    if (Math.abs(df) < 1e-9) break;
    t -= f / df;
    t = Math.min(1, Math.max(0, t));
  }
  return t;
}

function main(): void {
  const speciesId = process.argv[2] ?? 'graybox';
  const bus = new EventBus();
  const registry = new SpeciesRegistry(bus);
  registry.registerAll(SOURCES);

  const loaded = registry.get(speciesId);
  if (!loaded) {
    console.error(`✗ 未知犬种: ${speciesId}（可用: ${registry.ids().join(', ')}）`);
    process.exit(1);
  }

  const world = new World({
    loaded,
    bounds: { w: 320, h: 200 },
    seed: 20250101,
    bus,
    debug: false,
  });

  // 用反射读取私有 FSM 的迁移表 —— 这是开发工具，可以接受
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fsm = (world as any).fsm as {
    transitions: readonly {
      from: string;
      to: string;
      score: (ctx: unknown) => number;
      guard?: (ctx: unknown) => boolean;
    }[];
  };

  const sp = loaded.species;
  const rhythm = Math.max(0.4, Math.min(1.0, 400 / Math.max(200, sp.cognition.decisionIntervalMs)));

  console.log('L.D.C. — 迁移标定报告\n');
  console.log(`犬种: ${sp.displayName.zh ?? speciesId}  (${sp.catalogNo})`);
  console.log(`决策间隔: ${sp.cognition.decisionIntervalMs}ms   节奏因子: ${rhythm.toFixed(3)}`);
  console.log(`像素帧率: ${sp.animation.targetFps}fps   行走速度: ${sp.locomotion.walkSpeedPx}px/s`);
  console.log(`漫游半径: ${sp.locomotion.idleWanderRadiusPx}px   驻足: ${world.blackboard ? 2200 : 0}ms`);
  console.log('');

  // 门槛（与 StateMachine 保持一致）
  // ── 引擎常量镜像 ──
  //
  // ★ 这些值定义在 src/core/fsm/StateMachine.ts 内部（未导出）。
  //   之所以不导出：它们是引擎的调参细节，不应该成为对外契约。
  //   代价是本工具必须手动保持同步。
  //
  //   为防止悄悄漂移，下方会打印实际使用的值 ——
  //   若与引擎行为不符，报告会立刻显示出矛盾（例如"可达 ✓ 但实测从未出现"）。
  const SCORE_THRESHOLD = 0.3;
  const RESPONSE_BASE_SCORE = 0.5;
  const PREFERENCE_REFERENCE_SCALE = 30;

  /** 响应态集合（互动状态） */
  const RESPONSE_STATES = new Set<string>(INTERACTION_STATE_IDS);

  // 取样：把 stateElapsedMs 拉到很大，观察每个迁移的"峰值效用"
  const bb = world.blackboard;
  const savedElapsed = bb.stateElapsedMs;
  bb.stateElapsedMs = 1e9;

  // 构造一个近似完整的 ctx（借用 world 的公开数据）
  const probeCtx = {
    dtSec: 1 / 60,
    dtMs: 1000 / 60,
    tick: 0,
    elapsedMs: 1e9,
    species: sp,
    behaviors: loaded.behaviors,
    rng: { next: () => 0.5, range: (a: number, b: number) => (a + b) / 2, int: () => 0, chance: () => false, pick: () => undefined, seed: 1 },
    bus,
    blackboard: bb,
    allowDecision: true,
    fsmCurrent: '',
  };

  interface Row {
    from: string;
    to: string;
    /** 迁移表返回的原始效用 */
    peak: number;
    /** 换算到 scores 尺度后的分数（与门槛直接可比） */
    peakScore: number;
    reachable: boolean;
    triggerMs: number | null;
    guarded: boolean;
    /** 是否为响应态（互动状态） */
    isResponse: boolean;
  }

  const rows: Row[] = [];

  for (const t of fsm.transitions) {
    // ★ 峰值必须在 stateElapsedMs 拉满时单独测量。
    //   早期版本把"峰值计算"与"触发时间扫描"混在一个循环里，
    //   扫描过程会反复改写 stateElapsedMs，导致峰值读到的是扫描残留值 ——
    //   报告出现"Idle→Sit 峰值 20.3 永不触发"这种与真实相反的错误结论。
    //   测量与扫描必须分开。
    bb.stateElapsedMs = 1e9;
    (probeCtx as { fsmCurrent: string }).fsmCurrent = t.from === '*' ? 'Idle' : t.from;

    let guarded = false;
    if (t.guard) {
      guarded = !t.guard(probeCtx);
    }

    // ★ 峰值语义已更新（Alpha 打磨）。
    //
    //   旧版报告的是「效用峰值」并与 UTILITY_THRESHOLD 比较。
    //   但引擎已统一到 scores 尺度（偏好 × 效用加成），
    //   效用峰值不再直接决定可达性 —— 报告与引擎脱节，会给出错误结论。
    //
    //   现在报告**该迁移实际贡献的 scores**：
    //     响应态（互动）→ RESPONSE_BASE_SCORE × (1 + u/30)
    //     常规态        → 偏好份额 × (1 + u/30)
    //   与 SCORE_THRESHOLD 直接可比。
    const peak = t.score(probeCtx);

    // 该迁移目标状态的"基础权重"：响应态用固定基分，常规态用偏好份额。
    //
    // ★ 必须复现引擎的 computeStatePreferences，不能只用原始份额。
    //
    //   引擎的份额计算是：
    //     偏好 = (stateWeights[状态] / 总和) × ∏ personalityFactor(维度)
    //   其中 personalityBias 会按性格维度进一步缩放每个状态。
    //
    //   早期版本只取原始份额，忽略了 personalityBias ——
    //   于是报告与引擎系统性不一致：
    //     报告 Idle→Walk = 0.318（可达）
    //     实测        = 0.291（不可达，永不触发）
    //   差 9%，恰好跨过门槛，导致"报告说没问题、狗却不动"。
    //
    //   这类"工具与引擎各算一遍"的漂移是标定工具最危险的失效模式：
    //   它让人相信一个错误的结论，并据此去改一个不存在的问题。
    const isResponse = RESPONSE_STATES.has(t.to);
    const personality = sp.personality.temperament;
    const bias = loaded.behaviors.personalityBias[t.to];

    const rawWeights = loaded.behaviors.stateWeights;
    const weightTotal = Object.values(rawWeights).reduce((a, b) => a + b, 0);

    /** 复现引擎：份额 × 性格乘子 */
    const engineShare = (stateId: string): number => {
      const raw = rawWeights[stateId];
      if (raw === undefined || weightTotal <= 0) return 0;
      let mult = 1;
      const b = loaded.behaviors.personalityBias[stateId];
      if (b) {
        for (const [dim, entry] of Object.entries(b)) {
          if (!entry) continue;
          const v = personality[dim as keyof typeof personality];
          if (typeof v !== 'number') continue;
          // 与 transitions.ts 的 PERSONALITY_FACTOR_FLOOR 保持一致
          mult *= Math.max(0.5, 1 + (v - 0.5) * entry.sensitivity * 2);
        }
      }
      return (raw / weightTotal) * Math.max(0.02, mult);
    };

    const baseWeight = isResponse
      ? RESPONSE_BASE_SCORE
      : engineShare(t.to);

    void bias;

    /** 把效用换算为该迁移实际能贡献的分数 */
    const toScore = (utility: number): number =>
      baseWeight * (1 + utility / PREFERENCE_REFERENCE_SCALE);

    const peakScore = toScore(peak);
    const reachable = !guarded && peakScore >= SCORE_THRESHOLD;

    // 触发时间：扫描 patience 增长到足以越过门槛的时刻
    let triggerMs: number | null = null;
    if (!guarded && reachable) {
      for (let ms = 0; ms <= 30000; ms += 50) {
        bb.stateElapsedMs = ms;
        (probeCtx as { fsmCurrent: string }).fsmCurrent = t.from === '*' ? 'Idle' : t.from;
        if (t.guard && !t.guard(probeCtx)) continue;
        if (toScore(t.score(probeCtx)) >= SCORE_THRESHOLD) {
          triggerMs = ms;
          break;
        }
      }
    }

    rows.push({ from: t.from, to: t.to, peak, peakScore, reachable, triggerMs, guarded, isResponse });
  }

  bb.stateElapsedMs = savedElapsed;

  // ── 输出 ──
  console.log(`门槛 SCORE_THRESHOLD = ${SCORE_THRESHOLD}（在 scores 尺度上）`);
  console.log(`响应态基分 RESPONSE_BASE_SCORE = ${RESPONSE_BASE_SCORE}\n`);
  console.log(
    '来源'.padEnd(8) +
      '目标'.padEnd(9) +
      '效用'.padStart(7) +
      '分数'.padStart(7) +
      '  可达  触发时间   类型',
  );
  console.log('─'.repeat(66));

  for (const r of rows.sort((a, b) => a.from.localeCompare(b.from) || (a.triggerMs ?? 1e9) - (b.triggerMs ?? 1e9))) {
    const reach = r.reachable ? ' ✓ ' : ' ✗ ';
    const trig = r.triggerMs !== null ? `${r.triggerMs}ms`.padStart(8) : '       —';
    const g = r.guarded ? '拦' : '  ';
    const kind = r.isResponse ? '响应' : '常规';
    const flag = !r.reachable && !r.guarded ? '   ← 永不触发' : '';
    console.log(
      `${r.from.padEnd(8)}${r.to.padEnd(9)}${r.peak.toFixed(1).padStart(7)}${r.peakScore.toFixed(3).padStart(7)}  ${reach}${trig}  ${g}${kind}${flag}`,
    );
  }

  console.log('\n提示：');
  console.log('  · 常规态分数 = 偏好份额 × (1 + 效用/30)；响应态分数 = 0.5 × (1 + 效用/30)');
  console.log('  · 常规态分数应高于门槛 40%，否则性格波动时会失效');
  console.log('  · 同一来源状态的多个目标，其"触发时间"应拉开差距');
  console.log('  · 触发时间远大于该状态典型存活时长 → 该迁移实际不会发生');

  // ── 实测分布 ──
  //
  // ★ 统计口径修正（Alpha 打磨中发现）：
  //
  //   旧实现每帧累加 `dist[currentState] += DT`，看似正确，
  //   但它把"最后一个未结束的状态"也算满了整个采样窗口 ——
  //   当切换次数很少时（本例 120 秒内仅约 30 次），
  //   这个尾段会严重拉高该状态的占比。
  //
  //   实测症状：报告显示 Walk 占 90%，
  //   而实际逐段统计（每个状态真实停留时长）只有 2240ms/次、
  //   与 Idle/Sit 的 900ms 处于同一量级，占比约 35%。
  //   差了一倍以上，会让人去改一个根本不存在的问题。
  //
  //   现在改为**逐段统计**：在状态切换时结算上一段的真实时长。
  //   这与人的直觉一致（"它走了多久"= 每段时长之和）。
  console.log('\n实测状态分布（180 秒，逐段统计）：');
  const SAMPLE_SEC = 180;
  const dist = new Map<string, number>();
  const durations = new Map<string, number[]>();
  const fresh = new World({ loaded, bounds: { w: 320, h: 200 }, seed: 7, bus: new EventBus() });
  const DT = 1 / 60;

  let prevState = fresh.currentState;
  let segStart = 0;
  const onEnter = ({ from }: { from: string | null }): void => {
    if (from === null) return;
    const dur = fresh.elapsed - segStart;
    dist.set(from, (dist.get(from) ?? 0) + dur);
    if (!durations.has(from)) durations.set(from, []);
    durations.get(from)!.push(dur);
    segStart = fresh.elapsed;
  };
  fresh.bus.on('state:enter', onEnter);

  for (let i = 0; i < SAMPLE_SEC / DT; i++) fresh.update(DT);
  // 结算最后一段
  const tailDur = fresh.elapsed - segStart;
  dist.set(prevState, (dist.get(prevState) ?? 0) + tailDur);
  if (!durations.has(prevState)) durations.set(prevState, []);
  durations.get(prevState)!.push(tailDur);

  void prevState;

  const totalMs = [...dist.values()].reduce((a, b) => a + b, 0);
  for (const [s, d] of [...dist.entries()].sort((a, b) => b[1] - a[1])) {
    const pct = totalMs > 0 ? (d / totalMs) * 100 : 0;
    const arr = durations.get(s) ?? [];
    const avg = arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    const sd =
      arr.length > 1
        ? Math.sqrt(arr.reduce((a, b) => a + (b - avg) ** 2, 0) / arr.length)
        : 0;
    console.log(
      `  ${s.padEnd(8)} ${pct.toFixed(1).padStart(5)}%  n=${String(arr.length).padStart(3)}  ` +
        `平均=${avg.toFixed(0).padStart(5)}ms σ=${sd.toFixed(0).padStart(4)}ms  ${'█'.repeat(Math.round(pct / 2))}`,
    );
  }
  fresh.dispose();

  const missing = ['Idle', 'Walk', 'Sit', 'Sleep'].filter((s) => (dist.get(s) ?? 0) < 1);
  if (missing.length > 0) {
    console.log(`\n  ! 以下状态实际未出现: ${missing.join(', ')}`);
  } else {
    console.log('\n  ✓ 四个核心状态均已出现');
  }

  world.dispose();
}

main();
