/**
 * L.D.C. — 类型安全事件总线
 *
 * 特性：
 *  - 编译期校验事件名与 payload 结构
 *  - 单个 handler 抛错不影响其他 handler（隔离，避免一个 UI bug 让整只狗死掉）
 *  - 支持 once / off / 通配调试监听
 *  - 事件在派发时对订阅列表做快照，允许 handler 内部增删订阅
 */

import type { LdcEventHandler, LdcEventKey, LdcEvents } from './events';

type AnyHandler = (payload: never) => void;

interface Subscription {
  readonly handler: AnyHandler;
  readonly once: boolean;
  readonly label: string;
}

export interface EventBusStats {
  readonly totalEmitted: number;
  readonly subscriberCounts: Readonly<Record<string, number>>;
}

export class EventBus {
  private readonly subs = new Map<LdcEventKey, Subscription[]>();
  /** 调试用：监听所有事件（只读，不参与派发顺序保证） */
  private readonly sniffers = new Set<(key: LdcEventKey, payload: unknown) => void>();
  private totalEmitted = 0;

  on<K extends LdcEventKey>(key: K, handler: LdcEventHandler<K>, label = ''): () => void {
    return this.add(key, handler as AnyHandler, false, label);
  }

  once<K extends LdcEventKey>(key: K, handler: LdcEventHandler<K>, label = ''): () => void {
    return this.add(key, handler as AnyHandler, true, label);
  }

  private add(key: LdcEventKey, handler: AnyHandler, once: boolean, label: string): () => void {
    let list = this.subs.get(key);
    if (!list) {
      list = [];
      this.subs.set(key, list);
    }
    const sub: Subscription = { handler, once, label };
    list.push(sub);
    return () => this.removeSubscription(key, sub);
  }

  /** 取消订阅。也支持传入 on() 返回的 disposer。 */
  off<K extends LdcEventKey>(key: K, handler: LdcEventHandler<K>): void {
    const list = this.subs.get(key);
    if (!list) return;
    const idx = list.findIndex((s) => s.handler === (handler as AnyHandler));
    if (idx >= 0) list.splice(idx, 1);
  }

  private removeSubscription(key: LdcEventKey, sub: Subscription): void {
    const list = this.subs.get(key);
    if (!list) return;
    const idx = list.indexOf(sub);
    if (idx >= 0) list.splice(idx, 1);
  }

  emit<K extends LdcEventKey>(key: K, payload: LdcEvents[K]): void {
    this.totalEmitted++;

    for (const sniffer of this.sniffers) {
      try {
        sniffer(key, payload);
      } catch {
        /* 调试监听器不得影响主流程 */
      }
    }

    const list = this.subs.get(key);
    if (!list || list.length === 0) return;

    // 快照：允许 handler 内部订阅/退订而不破坏本次派发
    const snapshot = list.slice();

    for (const sub of snapshot) {
      if (sub.once) this.removeSubscription(key, sub);
      try {
        (sub.handler as (p: LdcEvents[K]) => void)(payload);
      } catch (err) {
        // 隔离：一个订阅者崩溃不应中断其他订阅者或主循环
        console.error(`[EventBus] handler 抛错 key="${String(key)}" label="${sub.label}"`, err);
      }
    }
  }

  /** 监听所有事件，仅用于调试面板 / 档案记录。返回取消函数。 */
  sniff(fn: (key: LdcEventKey, payload: unknown) => void): () => void {
    this.sniffers.add(fn);
    return () => this.sniffers.delete(fn);
  }

  listenerCount(key: LdcEventKey): number {
    return this.subs.get(key)?.length ?? 0;
  }

  clear(): void {
    this.subs.clear();
    this.sniffers.clear();
  }

  stats(): EventBusStats {
    const counts: Record<string, number> = {};
    for (const [key, list] of this.subs) counts[String(key)] = list.length;
    return { totalEmitted: this.totalEmitted, subscriberCounts: counts };
  }
}
