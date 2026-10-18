/**
 * L.D.C. — Milestone 2 互动验证器
 *
 * 用法：npm run pet -- <speciesId>
 *
 * ★ 存在理由
 *
 * Milestone 2 的成败标准不是"代码能跑"，而是：
 *   "玩家第一次点，狗看过来；第二次，它慢慢走过来；
 *    第三次，坐你旁边；第四次，摇尾巴；第五次，闭眼。
 *    玩家什么按钮都没点，只是摸，却觉得它认识我了。"
 *
 * 这是一条**时序体验**，无法靠肉眼盯着屏幕判断是否达标。
 * 本工具把这条体验在无头环境里完整重放一遍，
 * 打印出每一次抚摸后的羁绊值、阶梯级别与状态，
 * 让"它认不认识我"变成可读的数字。
 *
 * 同时验证反面：
 *   快速连续点 → 烦躁上升 → 走开
 *   长时间不摸 → 羁绊衰减 → 降级
 *
 * 这两条（亲近与疏远）都必须成立，才有"生命感"。
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
import berneseSpecies from '../src/species/bernese-mountain-dog/species.json';
import berneseBehaviors from '../src/species/bernese-mountain-dog/behaviors.json';

const SOURCES: readonly SpeciesSource[] = [
  { id: 'graybox', species: grayboxSpecies, behaviors: grayboxBehaviors },
  { id: 'graybox-swift', species: swiftSpecies, behaviors: swiftBehaviors },
  { id: 'graybox-shy', species: shySpecies, behaviors: shyBehaviors },
  { id: 'bernese-mountain-dog', species: berneseSpecies, behaviors: berneseBehaviors },
];

const BOUNDS = { w: 320, h: 200 };
const FIXED_DT = 1 / 60;

interface Harness {
  world: World;
  /** 推进虚拟时间 */
  advance(ms: number): void;
  /** 模拟一次抚摸（按下 → 按住 holdMs → 抬起） */
  pet(holdMs: number): void;
  /**
   * 抚摸并采样"按住期间"的状态序列。
   * @returns 按住期间逐帧采集到的状态名（去重前的原始序列）
   */
  petAndSample(holdMs: number, pauseMs: number): string[];
}

function createHarness(speciesId: string): Harness {
  const bus = new EventBus();
  const registry = new SpeciesRegistry(bus);
  registry.registerAll(SOURCES);

  const loaded = registry.get(speciesId);
  if (!loaded) {
    console.error(`✗ 未知犬种: ${speciesId}`);
    process.exit(1);
  }

  const world = new World({ loaded, bounds: BOUNDS, seed: 20250101, bus });

  const advance = (ms: number): void => {
    const steps = Math.round(ms / (FIXED_DT * 1000));
    for (let i = 0; i < steps; i++) world.update(FIXED_DT);
  };

  const pet = (holdMs: number): void => {
    // 按下 —— 使用狗**当前**的实际位置（狗可能已经走动）
    const x = world.blackboard.x;
    const y = world.blackboard.y;
    world.pointerDown(x, y, world.elapsed, false);
    // 按住：世界会在每帧 update 里按逻辑时间结算有效抚摸
    advance(holdMs);
    // 抬起：未产生过结算时（轻点）由 World 内部补一次
    world.pointerUp(world.elapsed);
  };

  const petAndSample = (holdMs: number, pauseMs: number): string[] => {
    const x = world.blackboard.x;
    const y = world.blackboard.y;
    world.pointerDown(x, y, world.elapsed, false);

    const states: string[] = [];
    const steps = Math.round(holdMs / (FIXED_DT * 1000));
    for (let i = 0; i < steps; i++) {
      world.update(FIXED_DT);
      states.push(world.currentState);
    }

    world.pointerUp(world.elapsed);
    advance(pauseMs);
    return states;
  };

  return { world, advance, pet, petAndSample };
}

// ─────────────────────────────────────────────────────────────

function main(): void {
  const speciesId = process.argv[2] ?? 'graybox';

  console.log('L.D.C. — Milestone 2 互动验证\n');

  // ── 场景一：温柔地摸五次（项目要求的核心体验）──
  console.log('═'.repeat(62));
  console.log('场景一：温柔地摸五次（每次按住 420ms，间隔 900ms）');
  console.log('═'.repeat(62));
  console.log('  次  bond   阶梯   状态        期望');
  console.log('  ' + '─'.repeat(56));

  {
    const h = createHarness(speciesId);
    const expectations = [
      '看向玩家',
      '靠近一点',
      '坐定 / 摇尾巴',
      '摇尾巴 / 享受',
      '闭眼享受',
    ];

    // 先让狗进入一个稳定的待机状态
    h.advance(1200);

    for (let i = 1; i <= 5; i++) {
      // ★ 采样时机很重要：必须记录**抚摸过程中**的状态。
      //
      //   因为"回应"是在被摸的当下发生的 —— 摸完抬手后，
      //   狗会自然地回到常态（这正是想要的行为：
      //   你不摸它了，它就不必一直保持回应姿态）。
      //
      //   早期版本的测试在抚摸结束 900ms 后才采样，
      //   于是永远看到 Idle，误判为"没有回应"。
      //   测量点错了，结论就会完全相反。
      const responseStates = h.petAndSample(420, 900);

      const bond = h.world.bondSnapshot;
      // 取抚摸期间"最有意义"的状态（排除物理移动态）
      const notable =
        responseStates.find((s) => s === 'PetEnjoy') ??
        responseStates.find((s) => s === 'WagTail') ??
        responseStates.find((s) => s === 'Sit') ??
        responseStates.find((s) => s === 'Approach') ??
        responseStates.find((s) => s === 'LookAt') ??
        responseStates[responseStates.length - 1] ??
        '?';

      console.log(
        `  ${String(i).padStart(2)}  ${bond.bond.toFixed(2)}   ` +
          `${bond.rungIndex + 1}/${h.world.bondRungCount}   ` +
          `${notable.padEnd(11)} ${expectations[i - 1] ?? ''}`,
      );
    }

    const finalBond = h.world.bondSnapshot;
    console.log(
      `\n  最终：羁绊 ${finalBond.bond.toFixed(3)}，阶梯「${finalBond.rungLabel}」` +
        `${finalBond.maxed ? '（已达最高）' : ''}`,
    );
    h.world.dispose();
  }

  // ── 场景二：长时间不理会 → 羁绊衰减 ──
  console.log('\n' + '═'.repeat(62));
  console.log('场景二：摸到亲近后，长时间不理会（4 分钟）');
  console.log('═'.repeat(62));

  {
    const h = createHarness(speciesId);
    h.advance(1200);
    for (let i = 0; i < 8; i++) {
      h.pet(500);
      h.advance(700);
    }
    const before = h.world.bondSnapshot;
    console.log(`  冷落前：羁绊 ${before.bond.toFixed(3)}  阶梯「${before.rungLabel}」`);

    // 4 分钟不理
    h.advance(240_000);

    const after = h.world.bondSnapshot;
    console.log(`  冷落后：羁绊 ${after.bond.toFixed(3)}  阶梯「${after.rungLabel}」`);
    console.log(
      after.bond < before.bond
        ? '  ✓ 羁绊会自然衰减 —— 它不会永远记得你，这需要陪伴维持'
        : '  ✗ 羁绊未衰减 —— 缺少"生命感"，会退化成进度条',
    );
    h.world.dispose();
  }

  // ── 场景三：快速连点 → 烦躁 → 走开 ──
  //
  // ★ 节奏参数很重要：骚扰的本质是"频率"，不是"总次数"。
  //   每 150ms 一下（按住 80ms + 间隔 70ms）才是真正的连点；
  //   若在这个场景里用"按住 90ms + 间隔 90ms"，其实接近正常快速抚摸，
  //   狗不应该走开 —— 测试会误判为"惩罚不足"。
  console.log('\n' + '═'.repeat(62));
  console.log('场景三：快速连点骚扰（按住 80ms + 间隔 70ms，共 20 次）');
  console.log('═'.repeat(62));
  console.log('  次  烦躁    状态        说明');
  console.log('  ' + '─'.repeat(52));

  {
    const h = createHarness(speciesId);
    h.advance(1200);

    let walkedAway = false;
    let awayAt = -1;
    let annoyedSeen = false;

    for (let i = 1; i <= 20; i++) {
      h.pet(80);
      h.advance(70);

      const mood = h.world.moodSnapshot;
      const state = h.world.currentState;

      if (state === 'Annoyed') annoyedSeen = true;
      if (state === 'Retreat' && !walkedAway) {
        walkedAway = true;
        awayAt = i;
      }

      if (state === 'Retreat' || state === 'Annoyed' || i % 5 === 0) {
        const note =
          state === 'Retreat' ? '← 走开了' : state === 'Annoyed' ? '← 不高兴' : '';
        console.log(
          `  ${String(i).padStart(2)}  ${mood.annoyance.toFixed(2)}   ${state.padEnd(11)} ${note}`,
        );
      }
    }

    console.log(
      annoyedSeen ? '  ✓ 出现过「不耐烦」反应' : '  ✗ 从未表现不耐烦 —— 连点惩罚不足',
    );
    console.log(
      walkedAway
        ? `  ✓ 第 ${awayAt} 次连点后走开 —— 符合"觉得烦，走开"的预期`
        : '  ✗ 始终没有走开 —— 骚扰惩罚不足或阈值过高',
    );
    h.world.dispose();
  }

  // ── 场景四：正常快速抚摸**不应**被误判为骚扰 ──
  //
  // ★ 这是反向验证，与场景三同等重要。
  //   玩家自然地在 2 秒内摸七八下是很正常的，
  //   若被判定为骚扰，体验会变成"它莫名其妙就生气了"。
  console.log('\n' + '═'.repeat(62));
  console.log('场景四（反向验证）：正常节奏抚摸不应被误判为骚扰');
  console.log('═'.repeat(62));

  {
    const h = createHarness(speciesId);
    h.advance(1200);

    // ★ 节奏说明（Alpha 打磨后重新校准）：
    //   抚摸语义已修正为「一次按住 = 一次抚摸」，
    //   因此这里的 8 次 = 玩家实际的 8 次抚摸。
    //
    //   300ms 按住 / 500ms 间隔 ≈ 每 0.8 秒摸一下 ——
    //   这是**偏快但仍属正常**的互动节奏（1.25 次/秒）。
    //   狗不应该因为玩家摸得比较起劲就生气。
    for (let i = 0; i < 8; i++) {
      h.pet(300);
      h.advance(500);
    }

    const bond = h.world.bondSnapshot;
    const mood = h.world.moodSnapshot;
    const ok = h.world.currentState !== 'Retreat' && !h.world.isSulking;

    console.log(
      `  8 次正常抚摸（300ms 按住 / 500ms 间隔）后：` +
        `羁绊 ${bond.bond.toFixed(3)}，阶梯「${bond.rungState}」，烦躁 ${mood.annoyance.toFixed(2)}`,
    );
    console.log(
      ok
        ? '  ✓ 未被误判为骚扰 —— 正常互动不会被惩罚'
        : '  ✗ 正常抚摸被判成了骚扰 —— 阈值过低，玩家会觉得"它莫名其妙生气"',
    );
    h.world.dispose();
  }

  // ── 场景五：长按享受（闭眼）──
  console.log('\n' + '═'.repeat(62));
  console.log('场景五：长时间温柔抚摸（持续按住 6 秒）');
  console.log('═'.repeat(62));

  {
    const h = createHarness(speciesId);
    h.advance(1200);
    // 先把羁绊摸上去，才能进入最高阶梯
    for (let i = 0; i < 10; i++) {
      h.pet(600);
      h.advance(600);
    }
    console.log(`  预热后羁绊：${h.world.bondSnapshot.bond.toFixed(3)}`);

    const dogX = h.world.blackboard.x;
    const dogY = h.world.blackboard.y;
    h.world.pointerDown(dogX, dogY, h.world.elapsed, false);

    let sawEnjoy = false;
    let eyesClosed = false;
    const samples: string[] = [];

    for (let s = 0; s < 12; s++) {
      h.advance(500);
      const state = h.world.currentState;
      const rs = h.world.getRenderState();
      if (state === 'PetEnjoy') sawEnjoy = true;
      if (rs.pose.eyeClosure > 0.5) eyesClosed = true;
      if (s % 3 === 0) {
        samples.push(`${state}(眼${rs.pose.eyeClosure.toFixed(2)})`);
      }
    }

    h.world.pointerUp(h.world.elapsed);

    console.log(`  状态采样：${samples.join(' → ')}`);
    console.log(
      sawEnjoy ? '  ✓ 进入「闭眼享受」状态' : '  ✗ 从未进入享受状态',
    );
    console.log(
      eyesClosed ? '  ✓ 眼睛确实闭上了（pose.eyeClosure > 0.5）' : '  ✗ 眼睛未闭合',
    );

    // 松手后应该睁眼
    h.advance(1500);
    const afterRelease = h.world.getRenderState();
    console.log(
      afterRelease.pose.eyeClosure < 0.5
        ? `  ✓ 松手后睁眼（eyeClosure ${afterRelease.pose.eyeClosure.toFixed(2)}）`
        : '  ✗ 松手后仍闭眼 —— 闭眼没有成为对玩家的回应',
    );
    h.world.dispose();
  }

  // ── 场景六：生气之后会原谅 ──
  //
  // ★ 这一条同样重要：如果狗永远记仇，玩家会觉得"坏了，救不回来"。
  //   Milestone 2 要传达的是"它有情绪，但会消气"。
  console.log('\n' + '═'.repeat(62));
  console.log('场景六：惹恼它之后安静等待，它应该会消气');
  console.log('═'.repeat(62));

  {
    const h = createHarness(speciesId);
    h.advance(1200);

    // 骚扰到它走开
    for (let i = 0; i < 20; i++) {
      h.pet(80);
      h.advance(70);
      if (h.world.isSulking) break;
    }

    const angryMood = h.world.moodSnapshot;
    console.log(
      `  惹恼后：状态 ${h.world.currentState}，烦躁 ${angryMood.annoyance.toFixed(2)}，` +
        `闹别扭 ${h.world.isSulking ? '是' : '否'}`,
    );

    // 安静等待足够久（闹别扭时长 + 余量）
    h.advance(14000);

    const calmMood = h.world.moodSnapshot;
    const ok = !h.world.isSulking && calmMood.annoyance < 0.2;

    console.log(
      `  等待 14 秒后：状态 ${h.world.currentState}，烦躁 ${calmMood.annoyance.toFixed(2)}，` +
        `闹别扭 ${h.world.isSulking ? '是' : '否'}`,
    );
    console.log(
      ok
        ? '  ✓ 会消气 —— 它有情绪，但不会永远记仇'
        : '  ✗ 无法消气 —— 玩家会觉得"惹恼了就救不回来"',
    );

    // 而且消气后应该能重新建立关系
    for (let i = 0; i < 5; i++) {
      h.pet(420);
      h.advance(900);
    }
    const after = h.world.bondSnapshot;
    console.log(
      after.bond > 0.2
        ? `  ✓ 消气后能重新亲近（羁绊回到 ${after.bond.toFixed(3)}）`
        : `  ✗ 消气后仍无法亲近（羁绊仅 ${after.bond.toFixed(3)}）`,
    );
    h.world.dispose();
  }

  console.log('\n' + '═'.repeat(62));
  console.log('完成。');
}

main();
