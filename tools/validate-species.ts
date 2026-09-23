/**
 * L.D.C. — 构建期犬种校验工具
 *
 * 用法：npm run species:validate
 *
 * 为什么需要「构建期 + ajv 完整校验」而不只是运行时的轻量校验：
 *   贡献者提 PR 新增犬种时，JSON 写错必须在 CI 直接失败，
 *   而不是等到运行时白屏。这是「几乎不用修改核心代码」的安全网。
 *
 * 本工具做三件事：
 *   ① 用 JSON Schema 完整校验所有 species.json / behaviors.json
 *   ② 检查目录名 / id / catalogNo 的一致性
 *   ③ 报告每个犬种相对引擎默认值覆盖了哪些字段（用于生成文档）
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import type { AnySchema, ErrorObject } from 'ajv';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const SPECIES_SCHEMA_PATH = join(root, 'src/core/data/schema/species.schema.json');
const BEHAVIORS_SCHEMA_PATH = join(root, 'src/core/data/schema/behaviors.schema.json');
const SPECIES_DIR = join(root, 'src/species');

interface ValidationIssue {
  readonly species: string;
  readonly file: string;
  readonly message: string;
}

const errors: ValidationIssue[] = [];
const warnings: ValidationIssue[] = [];

function loadJson(path: string): unknown {
  const raw = readFileSync(path, 'utf8');
  return JSON.parse(raw) as unknown;
}

function formatAjvErrors(errs: ErrorObject[] | null | undefined): string[] {
  if (!errs) return [];
  return errs.map((e) => {
    const path = e.instancePath === '' ? '(root)' : e.instancePath;
    const extra =
      e.keyword === 'additionalProperties' && e.params && 'additionalProperty' in e.params
        ? ` → 未知字段 "${String((e.params as { additionalProperty: unknown }).additionalProperty)}"`
        : '';
    return `${path} ${e.message ?? '校验失败'}${extra}`;
  });
}

function main(): void {
  console.log('L.D.C. — 犬种数据校验\n');

  // ── 载入 schema ──
  if (!existsSync(SPECIES_SCHEMA_PATH)) {
    console.error(`✗ 找不到 species schema: ${SPECIES_SCHEMA_PATH}`);
    process.exit(1);
  }

  const ajv = new Ajv({ allErrors: true, strict: false });
  const validateSpecies = ajv.compile(loadJson(SPECIES_SCHEMA_PATH) as AnySchema);
  const validateBehaviors = ajv.compile(loadJson(BEHAVIORS_SCHEMA_PATH) as AnySchema);

  // ── 扫描犬种目录 ──
  if (!existsSync(SPECIES_DIR)) {
    console.error(`✗ 找不到犬种目录: ${SPECIES_DIR}`);
    process.exit(1);
  }

  const entries = readdirSync(SPECIES_DIR).filter((name) => {
    const full = join(SPECIES_DIR, name);
    return statSync(full).isDirectory() && !name.startsWith('_') && !name.startsWith('.');
  });

  if (entries.length === 0) {
    console.error('✗ 未发现任何犬种目录');
    process.exit(1);
  }

  const catalogNos = new Map<string, string>();
  let totalOverrides = 0;

  for (const id of entries) {
    const dir = join(SPECIES_DIR, id);
    const speciesPath = join(dir, 'species.json');
    const behaviorsPath = join(dir, 'behaviors.json');

    console.log(`▸ ${id}`);

    // species.json 必须存在
    if (!existsSync(speciesPath)) {
      errors.push({ species: id, file: 'species.json', message: '文件不存在' });
      console.log('  ✗ species.json 缺失');
      continue;
    }

    let species: Record<string, unknown>;
    try {
      species = loadJson(speciesPath) as Record<string, unknown>;
    } catch (err) {
      errors.push({
        species: id,
        file: 'species.json',
        message: `JSON 解析失败: ${err instanceof Error ? err.message : String(err)}`,
      });
      console.log('  ✗ JSON 解析失败');
      continue;
    }

    // ① Schema 校验
    if (!validateSpecies(species)) {
      for (const msg of formatAjvErrors(validateSpecies.errors)) {
        errors.push({ species: id, file: 'species.json', message: msg });
        console.log(`  ✗ species.json  ${msg}`);
      }
    }

    // ② id 一致性
    if (species['id'] !== id) {
      errors.push({
        species: id,
        file: 'species.json',
        message: `id 字段 ("${String(species['id'])}") 必须与目录名 ("${id}") 一致`,
      });
      console.log(`  ✗ id 与目录名不一致：${String(species['id'])} ≠ ${id}`);
    }

    // ③ catalogNo 唯一性
    const cat = species['catalogNo'];
    if (typeof cat === 'string') {
      const prev = catalogNos.get(cat);
      if (prev) {
        errors.push({
          species: id,
          file: 'species.json',
          message: `catalogNo "${cat}" 已被 "${prev}" 占用`,
        });
        console.log(`  ✗ catalogNo 重复：${cat}`);
      } else {
        catalogNos.set(cat, id);
      }
    }

    // ④ behaviors.json（可选）
    if (existsSync(behaviorsPath)) {
      let behaviors: Record<string, unknown>;
      try {
        behaviors = loadJson(behaviorsPath) as Record<string, unknown>;
      } catch (err) {
        errors.push({
          species: id,
          file: 'behaviors.json',
          message: `JSON 解析失败: ${err instanceof Error ? err.message : String(err)}`,
        });
        console.log('  ✗ behaviors.json 解析失败');
        continue;
      }

      if (!validateBehaviors(behaviors)) {
        for (const msg of formatAjvErrors(validateBehaviors.errors)) {
          errors.push({ species: id, file: 'behaviors.json', message: msg });
          console.log(`  ✗ behaviors.json  ${msg}`);
        }
      }

      if (behaviors['id'] !== undefined && behaviors['id'] !== id) {
        warnings.push({
          species: id,
          file: 'behaviors.json',
          message: `id ("${String(behaviors['id'])}") 与目录名不一致，运行时会被忽略`,
        });
        console.log(`  ! behaviors.id 与目录名不一致（非致命）`);
      }

      // 行为权重引用了不存在状态的检查
      const stateWeights = behaviors['stateWeights'];
      const bias = behaviors['personalityBias'];
      if (stateWeights && bias && typeof stateWeights === 'object' && typeof bias === 'object') {
        const known = new Set(Object.keys(stateWeights as object));
        for (const stateId of Object.keys(bias as object)) {
          if (!known.has(stateId)) {
            warnings.push({
              species: id,
              file: 'behaviors.json',
              message: `personalityBias."${stateId}" 对应的状态不在 stateWeights 中，该配置不会生效`,
            });
            console.log(`  ! personalityBias."${stateId}" 无对应 stateWeights 条目（非致命）`);
          }
        }
      }
    } else {
      warnings.push({ species: id, file: 'behaviors.json', message: '缺失，将使用引擎默认行为权重' });
      console.log('  ! behaviors.json 缺失（使用默认行为权重）');
    }

    // ⑤ 统计覆盖字段数（体现"新犬种 JSON 可以很短"）
    const overrideKeys = Object.keys(species).filter(
      (k) => !['$schema', 'version', 'id', 'displayName', 'catalogNo', 'description'].includes(k),
    );
    totalOverrides += overrideKeys.length;
    console.log(`  ✓ 通过（覆盖 ${overrideKeys.length} 个配置块）`);
  }

  // ── 汇总 ──
  console.log('\n' + '─'.repeat(56));
  console.log(`犬种数量: ${entries.length}   配置块合计: ${totalOverrides}`);
  console.log(`错误: ${errors.length}   告警: ${warnings.length}`);

  if (errors.length > 0) {
    console.log('\n✗ 校验失败。请修复以上错误。');
    process.exit(1);
  }

  console.log('\n✓ 全部犬种数据合法。');
  if (warnings.length > 0) {
    console.log('（告警不影响运行，但建议处理）');
  }
}

main();
