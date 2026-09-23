/**
 * L.D.C. — 犬种清单（唯一的数据扩展点）
 *
 * ★★★ 新增犬种时，你只需要修改这一个文件的一行 ★★★
 *
 * 步骤：
 *   1. 建目录 src/species/<your-dog>/
 *   2. 放 species.json 与 behaviors.json
 *   3. 在本文件 import 并加入 SPECIES_SOURCES
 *   4. （可选）把美术资源放进 public/assets/species/<your-dog>/
 *
 * 不需要写任何 TypeScript 逻辑。
 *
 * ────────────────────────────────────────────────────────────
 * 当前仅包含「灰盒」条目 —— Phase 0/1 的目标是验证管线，
 * 不是制作电子宠物。伯恩山等真实犬种在后续阶段加入。
 * ────────────────────────────────────────────────────────────
 */

import type { SpeciesSource } from '@core/data/SpeciesLoader';

import grayboxSpecies from './graybox/species.json';
import grayboxBehaviors from './graybox/behaviors.json';

import grayboxSwiftSpecies from './graybox-swift/species.json';
import grayboxSwiftBehaviors from './graybox-swift/behaviors.json';

import grayboxShySpecies from './graybox-shy/species.json';
import grayboxShyBehaviors from './graybox-shy/behaviors.json';

/**
 * 全部已注册犬种。
 * 顺序决定默认犬种（列表首项）。
 */
export const SPECIES_SOURCES: readonly SpeciesSource[] = [
  {
    id: 'graybox',
    species: grayboxSpecies,
    behaviors: grayboxBehaviors,
  },
  {
    id: 'graybox-swift',
    species: grayboxSwiftSpecies,
    behaviors: grayboxSwiftBehaviors,
  },
  {
    id: 'graybox-shy',
    species: grayboxShySpecies,
    behaviors: grayboxShyBehaviors,
  },
];

/** 默认犬种 id */
export const DEFAULT_SPECIES_ID = SPECIES_SOURCES[0]!.id;
