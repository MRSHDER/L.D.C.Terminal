/**
 * L.D.C. — 无头模拟器（Headless Simulator）
 *
 * 用法：npm run sim [speciesId] [seconds]
 *
 * ★ 本工具的架构意义：
 *   它只 import core/ 下的逻辑（World / GameLoop 之外的部分），
 *   完全不接触 PixiJS 与 DOM。如果本文件能跑，
 *   就证明「逻辑层与渲染层真的解耦了」——
 *   这是 Phase 0 最重要的一条验收标准。
 *
 * 用途：
 *   ① 在 CI 中验证行为逻辑不崩溃
 *   ② 用固定种子复现"这狗刚才为什么那样动"
 *   ③ 不打开浏览器就能调参
 */

import { EventBus } from '../src/core/event/EventBus';
import { World } from '../src/core/world/World';
import { SpeciesRegistry } from '../src/core/data/SpeciesRegistry';
import type { SpeciesSource } from '../src/core/data/SpeciesLoader';

import grayboxSpecies from '../src/species/graybox/species.json';
import grayboxBehaviors from '../src/species/graybox/behaviors.json';
import grayboxSwiftSpecies from '../src/species/graybox-swift/species.json';
import grayboxSwiftBehaviors from '../src/species/graybox-swift/behaviors.json';

const SOURCES: readonly SpeciesSource[] = [
  { id: 'graybox', species: grayboxSpecies, behaviors: grayboxBehaviors },
  { id: 'graybox-swift', species: grayboxSwiftSpecies, behaviors: grayboxSwiftBehaviors },
];

function main(): void {
  const args = process.argv.slice(2);
  const speciesId = args[0] ?? 'graybox';
  const seconds = Number.parseFloat(args[1] ?? '20');

  const bus = new EventBus();
  const registry = new SpeciesRegistry(bus);
  registry.registerAll(SOURCES);

  const loaded = registry.get(speciesId);
  if (!loaded) {
    console.error(`✗ 未知犬种: ${speciesId}`);
    console.error(`  可用: ${registry.ids().join(', ')}`);
    process.exit(1);
  }

  console.log('L.D.C. — 无头模拟\n');
  console.log(`犬种: ${loaded.species.displayName.zh ?? speciesId} (${loaded.species.catalogNo})`);
  console.log(`像素帧率: ${loaded.species.animation.targetFps} fps`);
  console.log(`行走速度: ${loaded.species.locomotion.walkSpeedPx} px/s`);
  console.log(`决策间隔: ${loaded.species.cognition.decisionIntervalMs} ms`);
  console.log(`模拟时长: ${seconds}s\n`);

  const world = new World({
    loaded,
    bounds: { w: 320, h: 200 },
    seed: 20250101,
    bus,
    debug: false,
  });

  // 统计
  const stateDurations = new Map<string, number>();
  const stateTransitions: string[] = [];

  bus.on('state:enter', ({ from, to, reason }) => {
    stateTransitions.push(`${from ?? '∅'}→${to}`);
    console.log(`  [${(world.elapsed / 1000).toFixed(2)}s] ${from ?? '∅'} → ${to}   (${reason})`);
  });

  // 固定步长：与浏览器端 GameLoop 一致（1/60s）
  const FIXED_DT = 1 / 60;
  const totalSteps = Math.round(seconds / FIXED_DT);

  for (let i = 0; i < totalSteps; i++) {
    const before = world.currentState;
    world.update(FIXED_DT);
    stateDurations.set(before, (stateDurations.get(before) ?? 0) + FIXED_DT);
  }

  // ── 汇报 ──
  console.log('\n' + '─'.repeat(56));
  console.log('状态时长分布:');
  const total = [...stateDurations.values()].reduce((a, b) => a + b, 0);
  for (const [state, dur] of [...stateDurations.entries()].sort((a, b) => b[1] - a[1])) {
    const pct = total > 0 ? (dur / total) * 100 : 0;
    const bar = '█'.repeat(Math.max(1, Math.round(pct / 2)));
    console.log(`  ${state.padEnd(8)} ${dur.toFixed(2).padStart(6)}s  ${pct.toFixed(1).padStart(5)}%  ${bar}`);
  }

  console.log('\n状态切换次数:', stateTransitions.length);
  console.log('切换序列:', stateTransitions.slice(0, 24).join(' '));
  if (stateTransitions.length > 24) console.log(`  … 共 ${stateTransitions.length} 次`);

  console.log('\n最终位置:', world.blackboard.x.toFixed(1), ',', world.blackboard.y.toFixed(1));
  console.log('逻辑帧数:', world.currentTick);

  if (loaded.warnings.length > 0) {
    console.log('\n告警:');
    for (const w of loaded.warnings) console.log(`  ! ${w}`);
  }

  world.dispose();
  console.log('\n✓ 模拟完成，未发生异常。');
}

main();
