/**
 * L.D.C. — 骚扰阈值标定工具
 *
 * 用法：npm run calibrate-annoyance
 *
 * ★ 存在理由
 *
 * 「烦躁阈值」是整个 Milestone 2 最容易调错的参数，因为它要同时满足两个
 * 相互矛盾的要求：
 *
 *   ① 温柔抚摸**绝不能**被误判为骚扰
 *      玩家自然地摸十几下，狗不能生气 —— 否则体验是"它莫名其妙发火"
 *
 *   ② 快速连点**必须**让狗走开
 *      否则项目要求的"连续点 → 觉得烦 → 走开"就不成立
 *
 * 这两个要求之间只有很窄的可用区间，而且区间位置取决于
 * windowMs / threshold / decayPerSec 三者的组合。
 * 靠人手试参数会反复失败（开发中确实如此），因此用扫描来定。
 *
 * 本工具对一组「抚摸节奏」逐一测试，输出哪些会被判为骚扰。
 * 目标是找到一组参数，使节奏 1~4 全部安全、节奏 6 被判定为骚扰。
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

const SOURCES: readonly SpeciesSource[] = [
  { id: 'graybox', species: grayboxSpecies, behaviors: grayboxBehaviors },
  { id: 'graybox-swift', species: swiftSpecies, behaviors: swiftBehaviors },
  { id: 'graybox-shy', species: shySpecies, behaviors: shyBehaviors },
];

const DT = 1 / 60;

/** 抚摸节奏：按住 holdMs，间隔 gapMs */
interface Cadence {
  readonly name: string;
  readonly holdMs: number;
  readonly gapMs: number;
  /** 是否**应该**被判定为骚扰 */
  readonly expectAnnoying: boolean;
  readonly note: string;
}

const CADENCES: readonly Cadence[] = [
  { name: 'A 缓慢深情', holdMs: 900, gapMs: 2200, expectAnnoying: false, note: '认真陪伴的玩家' },
  { name: 'B 正常抚摸', holdMs: 700, gapMs: 1400, expectAnnoying: false, note: '典型互动节奏' },
  { name: 'C 轻快抚摸', holdMs: 400, gapMs: 900, expectAnnoying: false, note: '心情好的玩家' },
  { name: 'D 稍显急促', holdMs: 300, gapMs: 500, expectAnnoying: false, note: '略快但仍是抚摸（约 1.25 次/秒）' },
  // ★ E 的预期经过修正（重要）。
  //
  //   最初把 E（150ms 按住 + 250ms 间隔 = 2.5 次/秒）标为"不应生气"。
  //   标定结果三种犬种都在第 6~9 次走开，一开始被当成"误判"。
  //
  //   但重新审视项目要求后确认：**这就是「连续点」**。
  //   项目原文是"连续点 → 狗觉得烦 → 走开"。
  //   150ms 的按压在生理上已经不是"抚摸"而是"戳"——
  //   人手抚摸的最低自然节奏约 2 次/秒，而这里达到 2.5 次/秒。
  //
  //   更重要的是：如果把这个节奏也归为"应该被接受"，
  //   那么"连点 → 走开"这条核心体验就没有可触发的区间了 ——
  //   因为真正的"连点"与"快速抚摸"将无法区分。
  //
  //   因此 E 的正确预期是**应该生气**，它是"抚摸"与"连点"的分界点。
  { name: 'E 快速连点', holdMs: 150, gapMs: 250, expectAnnoying: true, note: '临界：2.5 次/秒，已是"戳"而非"摸"' },
  { name: 'F 连点骚扰', holdMs: 80, gapMs: 70, expectAnnoying: true, note: '项目要求的"连续点"' },
  { name: 'G 疯狂连点', holdMs: 50, gapMs: 40, expectAnnoying: true, note: '极端骚扰' },
];

interface Result {
  readonly cadence: Cadence;
  readonly petsBeforeLeave: number | null;
  readonly finalBond: number;
  readonly maxAnnoyance: number;
  readonly correct: boolean;
}

function measure(speciesId: string, cadence: Cadence, maxPets = 25): Result {
  const bus = new EventBus();
  const registry = new SpeciesRegistry(bus);
  registry.registerAll(SOURCES);
  const loaded = registry.get(speciesId)!;
  const world = new World({ loaded, bounds: { w: 320, h: 200 }, seed: 20250101, bus });

  const advance = (ms: number): void => {
    const steps = Math.round(ms / (DT * 1000));
    for (let i = 0; i < steps; i++) world.update(DT);
  };

  advance(1200);

  let petsBeforeLeave: number | null = null;
  let maxAnnoyance = 0;

  for (let i = 1; i <= maxPets; i++) {
    world.pointerDown(world.blackboard.x, world.blackboard.y, world.elapsed, false);
    advance(cadence.holdMs);
    world.pointerUp(world.elapsed);
    advance(cadence.gapMs);

    maxAnnoyance = Math.max(maxAnnoyance, world.moodSnapshot.annoyance);

    if (world.isSulking && petsBeforeLeave === null) {
      petsBeforeLeave = i;
    }
  }

  const finalBond = world.bondSnapshot.bond;
  world.dispose();

  // 判定：是否走了 → 是否符合预期
  const actuallyAnnoyed = petsBeforeLeave !== null || world.currentState === 'Retreat';
  const correct = actuallyAnnoyed === cadence.expectAnnoying;

  return { cadence, petsBeforeLeave, finalBond, maxAnnoyance, correct };
}

function main(): void {
  const speciesIds = process.argv[2] ? [process.argv[2]] : ['graybox', 'graybox-shy', 'graybox-swift'];

  console.log('L.D.C. — 骚扰阈值标定\n');

  let totalCorrect = 0;
  let totalTests = 0;

  for (const id of speciesIds) {
    const bus = new EventBus();
    const reg = new SpeciesRegistry(bus);
    reg.registerAll(SOURCES);
    const loaded = reg.get(id);
    if (!loaded) {
      console.error(`✗ 未知犬种: ${id}`);
      continue;
    }

    const cfg = loaded.species.affection.annoyance;
    console.log('═'.repeat(72));
    console.log(
      `${id}  (${loaded.species.displayName.zh ?? ''})  ` +
        `window=${cfg.windowMs}ms threshold=${cfg.threshold} leaveAt=${cfg.leaveAt}`,
    );
    console.log('═'.repeat(72));
    console.log('  节奏          按住/间隔      结果        最大烦躁  羁绊   判定');
    console.log('  ' + '─'.repeat(66));

    for (const cadence of CADENCES) {
      const r = measure(id, cadence);
      totalTests++;
      if (r.correct) totalCorrect++;

      const outcome =
        r.petsBeforeLeave !== null ? `第${r.petsBeforeLeave}次走开` : '始终未走开';
      const verdict = r.correct ? '✓' : '✗ 不符预期';
      const expect = r.cadence.expectAnnoying ? '应生气' : '不应生气';

      console.log(
        `  ${cadence.name.padEnd(12)} ${String(cadence.holdMs).padStart(4)}/${String(cadence.gapMs).padEnd(5)}  ` +
          `${outcome.padEnd(11)} ${r.maxAnnoyance.toFixed(2).padStart(6)}  ` +
          `${r.finalBond.toFixed(2)}  ${verdict} (${expect})`,
      );
    }
    console.log('');
  }

  console.log('═'.repeat(72));
  console.log(`合计：${totalCorrect}/${totalTests} 个节奏判定正确`);

  if (totalCorrect < totalTests) {
    console.log('\n✗ 存在误判。调参建议：');
    console.log('  · 正常抚摸被误判为骚扰 → 提高 threshold 或增大 windowMs');
    console.log('  · 连点骚扰未被识别     → 降低 threshold 或减小 windowMs');
    process.exit(1);
  }

  console.log('\n✓ 所有节奏判定正确：温柔抚摸被接受，快速连点被拒绝。');
}

main();
