/**
 * L.D.C. — 新犬种脚手架生成器
 *
 * 用法：npm run species:new -- --id shiba-inu --name "柴犬"
 *
 * 生成一个可直接编辑的犬种目录，让贡献者 30 分钟内能跑起一只新狗。
 *
 * 设计取舍：生成的文件**故意带详细注释**。
 *   因为贡献者读的第一个文件就是这个模板，
 *   把"每个字段是什么意思"直接放在他眼前，比让他翻文档更有效。
 *   JSON 不支持注释，因此这里生成的是 .jsonc 风格的说明性 JSON ——
 *   实际上仍是合法 JSON（注释放在独立的 _comment 字段里）。
 */

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

interface Args {
  id: string;
  nameZh: string;
  nameEn: string;
  catalogNo: string;
}

function parseArgs(argv: readonly string[]): Args | null {
  let id = '';
  let nameZh = '';
  let nameEn = '';
  let catalogNo = '';

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--id' && next) {
      id = next;
      i++;
    } else if (a === '--name' && next) {
      nameZh = next;
      i++;
    } else if (a === '--name-en' && next) {
      nameEn = next;
      i++;
    } else if (a === '--catalog' && next) {
      catalogNo = next;
      i++;
    }
  }

  if (!id) return null;

  return {
    id,
    nameZh: nameZh || id,
    nameEn: nameEn || id,
    // 默认给一个占位编号；validate 会检查冲突
    catalogNo: catalogNo || 'LDC-099',
  };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  if (!args) {
    console.log('L.D.C. — 新建犬种\n');
    console.log('用法:');
    console.log('  npm run species:new -- --id <kebab-case-id> --name "<中文名>" [可选参数]\n');
    console.log('可选参数:');
    console.log('  --name-en "<英文名>"    英文显示名');
    console.log('  --catalog "LDC-0XX"     档案编号\n');
    console.log('示例:');
    console.log('  npm run species:new -- --id shiba-inu --name "柴犬" --name-en "Shiba Inu" --catalog "LDC-004"');
    process.exit(1);
  }

  const { id, nameZh, nameEn, catalogNo } = args;

  // ── 校验 id 格式 ──
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) {
    console.error(`✗ id 必须是小写 kebab-case（如 "shiba-inu"），实际为 "${id}"`);
    process.exit(1);
  }

  const speciesDir = join(root, 'src/species', id);
  const assetsDir = join(root, 'public/assets/species', id);

  if (existsSync(speciesDir)) {
    console.error(`✗ 目录已存在: ${speciesDir}`);
    console.error('  若要重新生成，请先手动删除该目录。');
    process.exit(1);
  }

  // ── 生成 species.json ──
  const speciesJson = {
    $schema: 'ldc/species/v1',
    version: '1.0.0',
    id,
    displayName: { zh: nameZh, en: nameEn },
    catalogNo,
    description: {
      zh: '（请填写一句话描述这只狗的性格）',
      en: '(One-line description of this dog\u2019s character)',
    },

    // ── 体型 ──
    // bodyScale 相对基准体型（基准躯干 48×36 像素）
    //   0.7 ≈ 柴犬/柯基    1.0 ≈ 中型犬    1.35 ≈ 伯恩山/金毛
    physical: {
      bodyScale: 1.0,
      hitbox: { w: 48, h: 36, anchorY: 0.9 },
      grayboxTint: 16777215,
    },

    // ── 性格九维（全部必填，0..1，0.5 为中性）──
    // 这是犬种的身份。其余字段都有默认值，只有这九个必须你想清楚。
    // 对照表见 docs/SPECIES_AUTHORING.md 的「性格 → 表现对照表」
    personality: {
      temperament: {
        gentleness: 0.5, // 温柔：被抚摸时的容忍度
        energy: 0.5, // 精力：走动频率、入睡倾向
        curiosity: 0.5, // 好奇：接近新事物的意愿
        stubbornness: 0.5, // 固执：被打断时的反应
        shyness: 0.5, // 害羞：接近玩家的速度
        clinginess: 0.5, // 依恋：跟随倾向
        playfulness: 0.5, // 玩心：玩耍类行为权重
        obedience: 0.5, // 服从：指令响应概率
        randomness: 0.35, // 随机：行为可预测性
      },
      traits: [],
    },

    // ── 认知节奏 ──
    // decisionIntervalMs 是"思考一次"的间隔：越大越迟钝
    //   180 ≈ 边牧（极快）   500 ≈ 中型犬   900 ≈ 伯恩山（沉稳）
    cognition: {
      decisionIntervalMs: 500,
      reactionDelayMs: [200, 700], // 感知到刺激后"愣一下"的时间
      attentionSpanMs: 6000,
      memorySpanMs: 30000,
      learningRate: 0.15,
    },

    // ── 动画 ──
    // targetFps 是最重要的性格参数之一：低帧率 = 生命感，不是性能妥协
    //   8 ≈ 大型犬（厚重）   10 ≈ 中型犬   12 ≈ 敏捷犬种
    animation: {
      targetFps: 10,
      breath: { freqHz: 0.22, ampPx: 1.2, bodyScaleY: 0.016 },
      blink: { baseIntervalMs: 4200, varianceMs: 2200, durationMs: 140 },
      tail: { segments: 3, baseAngleDeg: 8, maxSwingDeg: 18, delayPerSegMs: 80 },
      ear: { jitterDeg: 4, triggerBias: 0.22 },
      float: { ampPx: 0.8, freqHz: 0.13 },
      transitions: {},
      defaultTransitionMs: 220,
    },

    // ── 运动 ──
    locomotion: {
      walkSpeedPx: 30, // 22 ≈ 慢   30 ≈ 中   62 ≈ 快
      runSpeedPx: 65,
      turnRateDeg: 200, // 120 ≈ 转身笨重   400 ≈ 灵活
      idleWanderRadiusPx: 48, // 闲逛半径；25 ≈ 走两步就停   140 ≈ 满屋跑
      wanderChancePerMin: 3,
      arriveThresholdPx: 3,
    },

    // ── 资源（美术接入前留空即可）──
    resources: {
      assetRoot: '',
      animationClips: {},
    },
  };

  // ── 生成 behaviors.json ──
  const behaviorsJson = {
    $schema: 'ldc/behaviors/v1',
    id,

    // 各状态的基础权重。
    // ★ 只有**相对**关系重要，绝对值不重要：
    //   {Idle:40, Walk:25} 与 {Idle:4, Walk:2.5} 行为完全一致。
    stateWeights: {
      Idle: 40,
      Walk: 25,
      Sit: 18,
      Sleep: 10,
    },

    // 性格维度 → 状态偏好的敏感度
    //   multiplier = 1 + (性格值 - 0.5) × sensitivity × 2
    //   正值 = 该维度高时更倾向此状态；负值 = 反向
    //   建议敏感度绝对值不超过 2.0
    personalityBias: {
      Walk: { energy: { sensitivity: 1.5 } },
      Sit: { energy: { sensitivity: -0.6 } },
      Sleep: { energy: { sensitivity: -1.2 } },
      Idle: { curiosity: { sensitivity: 0.3 } },
    },

    // 交互响应权重（Phase 3 起使用，现在留空即可）
    interactionResponse: {},

    // 低频小动作：每分钟触发的期望次数
    microBehaviors: [
      { id: 'earTwitch', chancePerMin: 4 },
      { id: 'blink', chancePerMin: 14 },
    ],

    extraRandomness: 0,
  };

  // ── 写入 ──
  try {
    mkdirSync(speciesDir, { recursive: true });
    mkdirSync(join(assetsDir, 'audio'), { recursive: true });

    writeFileSync(join(speciesDir, 'species.json'), JSON.stringify(speciesJson, null, 2) + '\n', 'utf8');
    writeFileSync(
      join(speciesDir, 'behaviors.json'),
      JSON.stringify(behaviorsJson, null, 2) + '\n',
      'utf8',
    );

    writeFileSync(
      join(assetsDir, 'README.md'),
      [
        `# ${nameZh} 美术资源`,
        '',
        'Phase 5 起在此放置：',
        '',
        '- `atlas.png` — 纹理图集',
        '- `atlas.json` — Pixi Spritesheet 格式的帧定义',
        '- `audio/` — 吠叫、呼吸等音效（可选，缺失则静音降级）',
        '',
        '> 灰盒阶段（Phase 0/1）无需任何资源，引擎会自动使用程序化方块。',
        '',
      ].join('\n'),
      'utf8',
    );

    const rel = (p: string) => p.replace(root, '').replace(/\\/g, '/').replace(/^\//, '');
    console.log('✓ 犬种脚手架已生成\n');
    console.log(`  ${rel(speciesDir)}/species.json`);
    console.log(`  ${rel(speciesDir)}/behaviors.json`);
    console.log(`  ${rel(assetsDir)}/README.md\n`);
    console.log('下一步：');
    console.log('  1. 编辑 species.json 的 personality.temperament 九个维度');
    console.log('     （对照 docs/SPECIES_AUTHORING.md 的「性格 → 表现对照表」）');
    console.log(`  2. 在 src/species/index.ts 中注册 "${id}"`);
    console.log(`  3. npm run species:validate`);
    console.log(`  4. npm run tune -- ${id}`);
    console.log(`  5. npm run sim -- ${id} 300\n`);
    console.log('提示：先跑 tune 确认所有行为「可达 ✓」，再看 sim 的状态分布。');
  } catch (err) {
    console.error('✗ 生成失败:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

main();
