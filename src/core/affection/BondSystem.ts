/**
 * L.D.C. — 羁绊系统（BondSystem）
 *
 * ★★★ Milestone 2 的核心 ★★★
 *
 * 它回答一个问题：**「它认识我了吗？」**
 *
 * ─────────────────────────────────────────────────────────────
 * 设计要点（这是最容易做错的地方，务必读完）
 * ─────────────────────────────────────────────────────────────
 *
 * 错误做法：把"摸五次"做成计数器。
 *   点第 1 次 → 播"看向"动画
 *   点第 2 次 → 播"靠近"动画
 *   ...
 *   这本质是一个进度条，玩家第三次点就会看穿它。
 *
 * 正确做法：维护一个**连续衰减的羁绊值** bond ∈ [0,1]，
 *   由 bond 落在一张「阶梯表」（ladder）的哪一级，决定当前亲昵程度。
 *
 *   后果：
 *   - 你摸它，羁绊上升，它越来越亲近 → "它记得我"
 *   - 你走开一会儿，羁绊缓慢衰减，回来它没那么热情 → "它有自己状态"
 *   - 你连点骚扰它，羁绊下降 → "它生我气了"
 *
 *   ★ 这三条合起来才是"生命感"。缺了衰减，它就只是进度条。
 *
 * ─────────────────────────────────────────────────────────────
 * 边际递减（关键细节）
 * ─────────────────────────────────────────────────────────────
 * 每次抚摸的增益不是恒定的，而是：
 *
 *   gain = gainPerPet × (1 - bond) ^ 0.6
 *
 * 含义：羁绊越低，摸一下涨得越快（陌生狗很容易建立初步信任）；
 *       羁绊越高，越难再进一步（真正亲密需要长期陪伴）。
 *
 * 没有这条，满羁绊只需 5 次点击，玩家 3 秒就"通关"了 ——
 * 那样就不像生命，像任务。
 *
 * ★ 本文件不含任何犬种专属内容，全部数值来自 species.affection.bonding。
 */

import type { BondRung, BondingConfig } from '../data/types';
import type { StateId } from '../event/events';

export interface BondSnapshot {
  /** 当前羁绊 0..1 */
  readonly bond: number;
  /** 当前阶梯索引（0 = 最低级） */
  readonly rungIndex: number;
  /** 当前阶梯对应的状态 id */
  readonly rungState: StateId;
  /** 当前阶梯的说明文本（调试面板展示） */
  readonly rungLabel: string;
  /** 距离下一级还差多少羁绊（0..1）。已是最高级时返回 0 */
  readonly toNextRung: number;
  /** 是否已达最高级 */
  readonly maxed: boolean;
}

export class BondSystem {
  private config: BondingConfig;
  private bond = 0;
  /** 排序后的阶梯（按 atBond 升序），构造时预处理避免每帧排序 */
  private ladder: readonly BondRung[];

  constructor(config: BondingConfig) {
    this.config = config;
    this.ladder = normalizeLadder(config.ladder);
  }

  setConfig(config: BondingConfig): void {
    this.config = config;
    this.ladder = normalizeLadder(config.ladder);
    // 配置变更后夹紧，防止越界
    this.bond = clamp01(this.bond);
  }

  /** 当前羁绊值 */
  get value(): number {
    return this.bond;
  }

  /** 重置（切换犬种时调用 —— 新狗不认识你） */
  reset(): void {
    this.bond = 0;
  }

  /**
   * 被抚摸一次。
   *
   * @param effectiveness 本次抚摸的"有效性"0..1。
   *        由抚摸时长与位置决定：轻轻点一下 < 按住一会儿。
   *        这让"敷衍地戳"和"认真地摸"有区别。
   * @returns 实际获得的羁绊增量
   */
  pet(effectiveness = 1): number {
    const eff = clamp01(effectiveness);
    if (eff <= 0) return 0;

    // ★ 边际递减：越亲近越难再进一步
    const diminishing = Math.pow(1 - this.bond, 0.6);
    const gain = this.config.gainPerPet * diminishing * eff;

    this.bond = clamp01(this.bond + gain);
    return gain;
  }

  /** 被骚扰：羁绊受损 */
  penalize(amount: number): void {
    if (amount <= 0) return;
    this.bond = clamp01(this.bond - amount);
  }

  /** 按时间自然衰减 */
  update(dtSec: number, annoyed: boolean): void {
    if (annoyed) {
      this.bond = clamp01(
        this.bond - this.config.penaltyPerSecWhenAnnoyed * dtSec,
      );
      return;
    }
    if (this.config.decayPerSec > 0) {
      this.bond = clamp01(this.bond - this.config.decayPerSec * dtSec);
    }
  }

  /**
   * 取当前阶梯。
   *
   * 阶梯是「bond 达到某阈值即升到该级」。
   * 注意这里**没有**降级迟滞 —— 也就是说 bond 掉到阈值以下会立刻降级。
   *
   * 为什么不做迟滞：
   *   降级本身就是"它冷淡下来了"的表达，是想要的效果。
   *   若加迟滞，玩家会看到"明明它已经不理我了，界面上还显示很亲密"的割裂。
   */
  currentRung(): BondRung {
    let rung = this.ladder[0]!;
    for (const r of this.ladder) {
      if (this.bond >= r.atBond) rung = r;
      else break;
    }
    return rung;
  }

  /** 当前阶梯对应的状态 id */
  currentState(): StateId {
    return this.currentRung().state;
  }

  snapshot(): BondSnapshot {
    const rung = this.currentRung();
    const idx = this.ladder.indexOf(rung);
    const next = this.ladder[idx + 1];

    return {
      bond: this.bond,
      rungIndex: idx,
      rungState: rung.state,
      rungLabel: rung.label.zh ?? rung.label.en ?? rung.state,
      toNextRung: next ? Math.max(0, next.atBond - this.bond) : 0,
      maxed: !next,
    };
  }

  /** 阶梯总数（供调试面板显示 "3/5 级"） */
  get rungCount(): number {
    return this.ladder.length;
  }
}

// ─────────────────────────────────────────────────────────────
// 工具
// ─────────────────────────────────────────────────────────────

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * 规范化阶梯：按 atBond 升序排列，并保证至少有一级。
 *
 * 若配置为空或全部非法，回退到「单级 Idle」——
 * 这样即使 JSON 写错，狗也不会失去全部行为。
 */
function normalizeLadder(ladder: readonly BondRung[]): readonly BondRung[] {
  const valid = ladder
    .filter((r) => typeof r.atBond === 'number' && typeof r.state === 'string' && r.state.length > 0)
    .slice()
    .sort((a, b) => a.atBond - b.atBond);

  if (valid.length === 0) {
    return [{ atBond: 0, state: 'Idle', label: { zh: '待机', en: 'Idle' } }];
  }

  // 保证第一级阈值为 0（否则羁绊值低于首级阈值时无级可选）
  if (valid[0]!.atBond > 0) {
    valid.unshift({ atBond: 0, state: 'Idle', label: { zh: '待机', en: 'Idle' } });
  }

  return valid;
}
