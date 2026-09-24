/**
 * L.D.C. — 犬种清单（唯一的数据扩展点）
 *
 * 新增犬种：建 src/species/<id>/ ，在本文件加一条。
 * 不要在这里写犬种特殊逻辑。
 */

import type { SpeciesSource } from '@core/data/SpeciesLoader';

import grayboxSpecies from './graybox/species.json';
import grayboxBehaviors from './graybox/behaviors.json';

import grayboxSwiftSpecies from './graybox-swift/species.json';
import grayboxSwiftBehaviors from './graybox-swift/behaviors.json';

import grayboxShySpecies from './graybox-shy/species.json';
import grayboxShyBehaviors from './graybox-shy/behaviors.json';

import berneseSpecies from './bernese-mountain-dog/species.json';
import berneseBehaviors from './bernese-mountain-dog/behaviors.json';

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
  {
    id: 'bernese-mountain-dog',
    species: berneseSpecies,
    behaviors: berneseBehaviors,
  },
];

/** 默认犬种使用伯恩山；graybox 仍保留为回归基线犬种。 */
export const DEFAULT_SPECIES_ID = 'bernese-mountain-dog';
