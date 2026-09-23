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

const SOURCES: readonly SpeciesSource[] = [
  { id: 'graybox', species: grayboxSpecies, behaviors: grayboxBehaviors },
  { id: 'graybox-swift', species: swiftSpecies, behaviors: swiftBehaviors },
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
  const THRESHOLD = 26;

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
    peak: number;
    reachable: boolean;
    triggerMs: number | null;
    guarded: boolean;
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

    const peak = t.score(probeCtx);
    const reachable = !guarded && peak >= THRESHOLD;

    // 触发时间：数值扫描（窗口写在各迁移内部，无法解析反解）
    let triggerMs: number | null = null;
    if (!guarded && peak >= THRESHOLD) {
      for (let ms = 0; ms <= 30000; ms += 50) {
        bb.stateElapsedMs = ms;
        (probeCtx as { fsmCurrent: string }).fsmCurrent = t.from === '*' ? 'Idle' : t.from;
        if (t.guard && !t.guard(probeCtx)) continue;
        if (t.score(probeCtx) >= THRESHOLD) {
          triggerMs = ms;
          break;
        }
      }
    }

    rows.push({ from: t.from, to: t.to, peak, reachable, triggerMs, guarded });
  }

  bb.stateElapsedMs = savedElapsed;

  // ── 输出 ──
  console.log('门槛 UTILITY_THRESHOLD =', THRESHOLD, '\n');
  console.log(
    '来源'.padEnd(8) + '目标'.padEnd(8) + '峰值'.padStart(8) + '  可达  触发时间   守卫',
  );
  console.log('─'.repeat(58));

  for (const r of rows.sort((a, b) => a.from.localeCompare(b.from) || (a.triggerMs ?? 1e9) - (b.triggerMs ?? 1e9))) {
    const peakStr = r.peak.toFixed(1).padStart(8);
    const reach = r.reachable ? ' ✓ ' : ' ✗ ';
    const trig =
      r.triggerMs !== null ? `${r.triggerMs}ms`.padStart(8) : '       —';
    const g = r.guarded ? '拦' : '';
    const flag = !r.reachable ? '   ← 永不触发' : '';
    console.log(`${r.from.padEnd(8)}${r.to.padEnd(8)}${peakStr}  ${reach}${trig}   ${g}${flag}`);
  }

  console.log('\n提示：');
  console.log('  · 峰值应至少高于门槛 40%，否则性格乘子波动时会失效');
  console.log('  · 同一来源状态的多个目标，其"触发时间"应拉开差距');
  console.log('  · 触发时间远大于该状态典型存活时长 → 该迁移实际不会发生');

  // ── 实测分布 ──
  console.log('\n实测状态分布（120 秒）：');
  const dist = new Map<string, number>();
  const fresh = new World({ loaded, bounds: { w: 320, h: 200 }, seed: 7, bus: new EventBus() });
  const DT = 1 / 60;
  for (let i = 0; i < 120 / DT; i++) {
    const s = fresh.currentState;
    dist.set(s, (dist.get(s) ?? 0) + DT);
    fresh.update(DT);
  }
  for (const [s, d] of [...dist.entries()].sort((a, b) => b[1] - a[1])) {
    const pct = (d / 120) * 100;
    console.log(`  ${s.padEnd(8)} ${pct.toFixed(1).padStart(5)}%  ${'█'.repeat(Math.round(pct / 2))}`);
  }
  fresh.dispose();

  const missing = ['Idle', 'Walk', 'Sit', 'Sleep'].filter((s) => (dist.get(s) ?? 0) < 0.5);
  if (missing.length > 0) {
    console.log(`\n  ! 以下状态实际未出现: ${missing.join(', ')}`);
  } else {
    console.log('\n  ✓ 四个核心状态均已出现');
  }

  world.dispose();
}

main();
