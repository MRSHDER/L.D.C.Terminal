/**
 * L.D.C. — 犬种注册表（SpeciesRegistry）
 *
 * 唯一职责：把「已加载的犬种」集中管理，并提供按 id 查询。
 *
 * ★ 设计约束：注册表不认识任何具体犬种。
 *   犬种清单由 species/index.ts 提供（数据扩展区），
 *   核心层只消费 SpeciesSource 这一抽象。
 */

import type { EventBus } from '../event/EventBus';
import type { LoadedSpecies, SpeciesSource } from './SpeciesLoader';
import { SpeciesLoader } from './SpeciesLoader';

export class SpeciesRegistry {
  private readonly loader: SpeciesLoader;
  private readonly entries = new Map<string, LoadedSpecies>();
  private readonly bus: EventBus | undefined;

  constructor(bus?: EventBus) {
    this.bus = bus;
    this.loader = new SpeciesLoader(bus);
  }

  /** 加载并注册一批犬种。返回本次新增的 id 列表。 */
  registerAll(sources: readonly SpeciesSource[]): readonly string[] {
    const added: string[] = [];
    for (const source of sources) {
      const result = this.loader.load(source);
      this.entries.set(source.id, result.loaded);
      added.push(source.id);
    }
    return added;
  }

  /** 热重载单个犬种（开发期改 JSON 用） */
  reload(source: SpeciesSource): LoadedSpecies {
    const result = this.loader.load(source);
    this.entries.set(source.id, result.loaded);
    this.bus?.emit('species:reloaded', { id: source.id });
    return result.loaded;
  }

  get(id: string): LoadedSpecies | undefined {
    return this.entries.get(id);
  }

  /** 取默认（首个注册）的犬种；注册表为空时返回 undefined */
  getDefault(): LoadedSpecies | undefined {
    const first = this.entries.values().next();
    return first.done ? undefined : first.value;
  }

  ids(): readonly string[] {
    return [...this.entries.keys()];
  }

  count(): number {
    return this.entries.size;
  }

  /** 汇总所有犬种的告警，供调试面板展示 */
  allWarnings(): Readonly<Record<string, readonly string[]>> {
    const out: Record<string, readonly string[]> = {};
    for (const [id, entry] of this.entries) {
      if (entry.warnings.length > 0) out[id] = entry.warnings;
    }
    return out;
  }
}
