/**
 * L.D.C. — 引擎 React 绑定
 *
 * 设计原则：React 只做两件事
 *   ① 挂载 / 卸载画布
 *   ② 展示状态（只读）
 *
 * React 绝不参与每帧渲染 —— 那会导致每秒 60 次 re-render。
 * 引擎状态通过「低频订阅」推给 React（默认 4Hz），仅用于 UI 展示。
 */

import { useEffect, useRef, useState } from 'react';
import { EventBus } from '@core/event/EventBus';
import { World } from '@core/world/World';
import { GameLoop } from '@core/time/GameLoop';
import { GrayboxRenderer } from '@core/render/GrayboxRenderer';
import { SpeciesRegistry } from '@core/data/SpeciesRegistry';
import { PointerAdapter, type PointerSample } from '@core/interaction/PointerAdapter';
import { GestureRecognizer } from '@core/interaction/GestureRecognizer';
import { SPECIES_SOURCES, DEFAULT_SPECIES_ID } from '@species/index';
import type { LoadedSpecies } from '@core/data/SpeciesLoader';
import type { StateId } from '@core/event/events';

// ─────────────────────────────────────────────────────────────
// 输入队列
//
// 浏览器指针回调发生在 rAF 之外的任意时刻，
// 而引擎必须按固定步长消费输入才能保证确定性。
// 因此输入先进队列，由逻辑帧统一 drain。
// ─────────────────────────────────────────────────────────────

type QueuedInput =
  | { kind: 'down'; sample: PointerSample }
  | { kind: 'move'; sample: PointerSample }
  | { kind: 'up'; sample: PointerSample }
  | { kind: 'cancel'; sample: PointerSample };

/**
 * 消费输入队列并驱动世界。
 *
 * ★ 设计要点：抚摸的"结算"完全由 World.update() 内部的
 *   updateInteraction() 按**逻辑帧**完成，输入层只负责维护
 *   "指针是否按在狗身上"这一状态。
 *
 *   为什么不让输入层直接结算：
 *     输入回调发生在 rAF 之外，若在那里累加时长，
 *     同一段按压在不同刷新率下会结算出不同的次数 ——
 *     行为变得不可复现，且"摸多久 = 多亲密"的关系会漂移。
 *     把时间推进权交给逻辑帧，是保证确定性的关键。
 *
 * GestureRecognizer 仍然保留，因为它提供了
 *   rapid（连点）判定所需的**抬手时刻**信息，
 *   而这正是"骚扰"机制的时间基准。
 */
function drainInputs(world: World, queue: QueuedInput[], recognizer: GestureRecognizer): void {
  for (let i = 0; i < queue.length; i++) {
    const ev = queue[i]!;
    switch (ev.kind) {
      case 'down':
        recognizer.onDown(ev.sample, world.elapsed);
        world.pointerDown(
          ev.sample.x,
          ev.sample.y,
          world.elapsed,
          ev.sample.pointerType !== 'mouse',
        );
        break;

      case 'move':
        recognizer.onMove(ev.sample, world.elapsed);
        world.pointerMove(ev.sample.x, ev.sample.y, ev.sample.pointerType !== 'mouse');
        break;

      case 'up':
        recognizer.onUp(ev.sample, world.elapsed);
        world.pointerUp(world.elapsed);
        break;

      case 'cancel':
        recognizer.onCancel(ev.sample);
        world.pointerUp(world.elapsed);
        break;
    }
  }

  queue.length = 0;

  // 即使没有新事件也要推进 ——
  // 它负责在"按住不动"时持续产生抚摸心跳（闭眼享受依赖这个）。
  recognizer.update(world.elapsed);
}

/** 推送给 React 的只读快照。刻意保持极小，避免 UI 开销 */
export interface EngineSnapshot {
  readonly ready: boolean;
  readonly error: string | null;
  readonly speciesId: string;
  readonly displayName: string;
  readonly catalogNo: string;
  readonly currentState: StateId;
  readonly tick: number;
  readonly elapsedMs: number;
  readonly fps: number;
  readonly animFps: number;
  readonly targetFps: number;
  readonly position: { x: number; y: number };
  readonly speed: number;
  readonly decisionIntervalMs: number;
  readonly reactionDelayMs: readonly [number, number];
  readonly walkSpeedPx: number;
  readonly bodyScale: number;
  readonly overriddenCount: number;
  readonly warnings: readonly string[];
  readonly degraded: boolean;
  readonly stateScores: Readonly<Record<string, number>>;
  readonly speciesIds: readonly string[];
}

const EMPTY_SNAPSHOT: EngineSnapshot = {
  ready: false,
  error: null,
  speciesId: '',
  displayName: '',
  catalogNo: '',
  currentState: 'Idle',
  tick: 0,
  elapsedMs: 0,
  fps: 0,
  animFps: 10,
  targetFps: 10,
  position: { x: 0, y: 0 },
  speed: 0,
  decisionIntervalMs: 500,
  reactionDelayMs: [200, 700],
  walkSpeedPx: 30,
  bodyScale: 1,
  overriddenCount: 0,
  warnings: [],
  degraded: false,
  stateScores: {},
  speciesIds: [],
};

export interface UseEngineResult {
  readonly containerRef: React.RefObject<HTMLDivElement>;
  readonly snapshot: EngineSnapshot;  /** 切换犬种（验证「同代码不同数据」） */
  readonly switchSpecies: (id: string) => void;
  /** 运行时改参数（验证「不改代码即可调参」） */
  readonly patchSpecies: (patch: Record<string, unknown>) => void;
  readonly pause: () => void;
  readonly resume: () => void;
  readonly isPaused: boolean;
  readonly resetSpecies: () => void;
}

export function useEngine(designWidth: number, designHeight: number): UseEngineResult {
  const containerRef = useRef<HTMLDivElement>(null);

  // 引擎对象放在 ref 里 —— 它们不是 React 状态，变动不该触发 re-render
  const registryRef = useRef<SpeciesRegistry | null>(null);
  const worldRef = useRef<World | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const rendererRef = useRef<GrayboxRenderer | null>(null);
  const busRef = useRef<EventBus | null>(null);

  // Milestone 2：输入管线
  const pointerAdapterRef = useRef<PointerAdapter | null>(null);
  const gestureRecognizerRef = useRef<GestureRecognizer | null>(null);
  const inputQueueRef = useRef<QueuedInput[] | null>(null);

  const [snapshot, setSnapshot] = useState<EngineSnapshot>(EMPTY_SNAPSHOT);
  const [isPaused, setIsPaused] = useState(false);

  // 快照累积器（避免每秒 setState 60 次）
  const accRef = useRef({ fps: 0, stateScores: {} as Record<string, number>, lastPushMs: 0 });

  useEffect(() => {
    let disposed = false;
    const bus = new EventBus();
    busRef.current = bus;

    // 防御性清理：清空容器中任何遗留的 canvas。
    // StrictMode 双挂载、热重载、或上一次清理异常都可能留下孤儿画布；
    // 它们会盖住新画布导致"什么都看不见"。这里主动兜底。
    const host = containerRef.current;
    if (host) {
      while (host.firstChild) host.removeChild(host.firstChild);
    }

    const registry = new SpeciesRegistry(bus);
    registryRef.current = registry;
    registry.registerAll(SPECIES_SOURCES);

    const initial = registry.get(DEFAULT_SPECIES_ID) ?? registry.getDefault();
    if (!initial) {
      setSnapshot((s) => ({ ...s, error: '没有可用的犬种数据（SPECIES_SOURCES 为空）' }));
      return;
    }

    const world = new World({
      loaded: initial,
      bounds: { w: designWidth, h: designHeight },
      seed: 20250101,
      bus,
      debug: false,
    });
    worldRef.current = world;

    const renderer = new GrayboxRenderer({
      designWidth,
      designHeight,
      showGrid: true,
    });
    rendererRef.current = renderer;

    const pushSnapshot = (loaded: LoadedSpecies, extra: { fps?: number } = {}): void => {
      const sp = loaded.species;
      const acc = accRef.current;
      if (extra.fps !== undefined) acc.fps = extra.fps;

      setSnapshot({
        ready: true,
        error: null,
        speciesId: sp.id,
        displayName: sp.displayName.zh ?? sp.displayName.en ?? sp.id,
        catalogNo: sp.catalogNo,
        currentState: world.currentState,
        tick: world.currentTick,
        elapsedMs: world.elapsed,
        fps: acc.fps,
        animFps: renderer ? (world.getRenderState().frameCount || 0) : 0,
        targetFps: sp.animation.targetFps,
        position: { x: Math.round(world.blackboard.x), y: Math.round(world.blackboard.y) },
        speed: Math.round(world.blackboard.speedPxPerSec),
        decisionIntervalMs: sp.cognition.decisionIntervalMs,
        reactionDelayMs: sp.cognition.reactionDelayMs,
        walkSpeedPx: sp.locomotion.walkSpeedPx,
        bodyScale: sp.physical.bodyScale,
        overriddenCount: loaded.overriddenPaths.length,
        warnings: loaded.warnings,
        degraded: loaded.degraded,
        stateScores: acc.stateScores,
        speciesIds: registry.ids(),
      });
    };

    // ── 开发期调试入口 ──
    // 把引擎内部暴露到 window.__LDC__，便于在浏览器控制台/自动化中
    // 检查场景图、RenderState 与渲染调用次数。
    // 生产构建会被 Vite 的 dead-code 消除移除。
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>)['__LDC__'] = {
        get world() {
          return world;
        },
        get renderer() {
          return renderer;
        },
        get loop() {
          return loop;
        },
        /** 当前渲染状态（用于核对灰盒是否真的有几何数据） */
        renderState: () => world.getRenderState(),
        /** 场景图节点数（若为 0 说明构造期就出了问题） */
        stageChildren: () => renderer.app.stage.children.length,
      };
    }

    // ── 低频快照推送（4Hz）──
    const snapshotTimer = window.setInterval(() => {
      const current = registry.get(world.speciesData.id);
      if (current) pushSnapshot(current);
    }, 250);

    // ── 事件订阅 ──
    const offDecision = bus.on('state:decision', (p) => {
      accRef.current.stateScores = { ...p.scores };
    });
    const offSample = bus.on('world:fpsSampled', (p) => {
      accRef.current.fps = p.fps;
    });

    const loop = new GameLoop({
      update: (dtSec) => {
        // ★ 先消费输入队列，再推进世界。
        //   顺序不能反：如果先 update 再消费输入，
        //   玩家按下后要等下一帧才被世界感知（多 16ms 延迟）。
        //   在 30 秒的首次体验里，这种"粘滞感"会被察觉。
        const q = inputQueueRef.current;
        const rec = gestureRecognizerRef.current;
        if (q && rec) drainInputs(world, q, rec);
        world.update(dtSec);
      },
      render: () => {
        renderer.render(world.getRenderState());
        renderer.renderFrame();
      },
      onSample: (fps, frameMs) => {
        bus.emit('world:fpsSampled', { fps, frameMs });
      },
    });
    loopRef.current = loop;

    // ── Milestone 2：输入管线 ──
    //
    // PointerAdapter  鼠标/触摸归一化
    //      ↓
    // GestureRecognizer  点击 / 长按 / 连点识别
    //      ↓
    // inputQueue     事件缓冲（回调在 rAF 之外，消费在逻辑帧内）
    //      ↓
    // World          狗的实际反应
    //
    // ★ 为什么要用队列而不是在回调里直接调 world：
    //   pointer 回调发生在 rAF 之外（可能在两次逻辑帧之间），
    //   直接调用会破坏"固定步长"的确定性 —— 同一段输入在不同刷新率下
    //   会产生不同的狗行为。入队后由逻辑帧统一消费，才能保证可复现。
    const inputQueue: QueuedInput[] = [];
    inputQueueRef.current = inputQueue;

    const recognizer = new GestureRecognizer({
      // 手势结果不直接驱动世界 —— 抚摸的结算由 World 按逻辑帧完成。
      // 这里保留回调是为了将来接入"轻点提示"等表现（Milestone 3+）。
      onGesture: () => {},
      onPettingTick: () => {},
    });
    gestureRecognizerRef.current = recognizer;

    void (async () => {
      try {
        await renderer.init(containerRef.current!);

        // ★ 必须在 init 之后再检查一次 disposed。
        //
        // 为什么：React StrictMode 在开发环境会「挂载 → 卸载 → 再挂载」。
        // 首次挂载的 effect 在 init() 的 await 期间就被清理了，
        // 但 init() 自己仍会继续跑完并 appendChild 一个画布。
        // 若不在此处检查，就会多出一个属于废弃渲染器的画布，
        // 且它盖在正常画布之上、永不重绘 → 整个舞台全黑。
        // （这个 bug 排查了很久：场景图/数据/渲染调用全部正常，就是看不见东西。）
        if (disposed) {
          renderer.destroy();
          return;
        }

        renderer.setSpecies(initial.species);
        pushSnapshot(initial);
        loop.start();
        bus.emit('app:ready', { at: performance.now() });

        // ★ 输入适配器必须在渲染器 init 之后创建 ——
        //   它需要绑定到 Pixi 的 canvas 元素上（而不是外层容器），
        //   这样才能拿到正确的坐标系，并把触摸事件限制在画布内。
        const canvasEl = containerRef.current?.querySelector('canvas') ?? containerRef.current;
        if (canvasEl) {
          const adapter = new PointerAdapter(
            canvasEl as HTMLElement,
            {
              onDown: (s) => {
                inputQueue.push({ kind: 'down', sample: s });
              },
              onMove: (s) => inputQueue.push({ kind: 'move', sample: s }),
              onUp: (s) => inputQueue.push({ kind: 'up', sample: s }),
              onCancel: (s) => inputQueue.push({ kind: 'cancel', sample: s }),
            },
            { primaryOnly: true },
          );
          adapter.setDesignSize(designWidth, designHeight);
          pointerAdapterRef.current = adapter;
        }
      } catch (err) {
        if (disposed) return;
        console.error('[LDC] 渲染器初始化失败', err);
        setSnapshot((s) => ({
          ...s,
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    })();

    return () => {
      disposed = true;
      window.clearInterval(snapshotTimer);
      offDecision();
      offSample();
      loop.stop();
      pointerAdapterRef.current?.dispose();
      world.dispose();
      renderer.destroy();
      bus.clear();
      loopRef.current = null;
      worldRef.current = null;
      rendererRef.current = null;
      registryRef.current = null;
      busRef.current = null;
      pointerAdapterRef.current = null;
      gestureRecognizerRef.current = null;
      inputQueueRef.current = null;
    };
    // 只在尺寸变化时重建（尺寸变更属于重初始化场景）
  }, [designWidth, designHeight]);

  const switchSpecies = (id: string): void => {
    const registry = registryRef.current;
    const world = worldRef.current;
    if (!registry || !world) return;
    const loaded = registry.get(id);
    if (!loaded) return;
    world.applySpecies(loaded);
    rendererRef.current?.setSpecies(loaded.species);
  };

  /**
   * 运行时补丁：把深路径 patch 合并进当前犬种数据并热应用。
   * ★ 这是「改 JSON 立即生效」的验证入口 —— 不重新加载页面、不重建引擎。
   */
  const patchSpecies = (patch: Record<string, unknown>): void => {
    const registry = registryRef.current;
    const world = worldRef.current;
    if (!registry || !world) return;

    const currentId = world.speciesData.id;
    const raw = deepClone(world.speciesData) as unknown as Record<string, unknown>;
    const merged = mergePatch(raw, patch);
    // 保留 schema/id，避免被 patch 破坏
    merged['$schema'] = 'ldc/species/v1';
    merged['id'] = currentId;

    const behaviorsRaw = deepClone(world.behaviorsData) as unknown as Record<string, unknown>;
    behaviorsRaw['$schema'] = 'ldc/behaviors/v1';
    behaviorsRaw['id'] = currentId;

    const loaded = registry.reload({ id: currentId, species: merged, behaviors: behaviorsRaw });
    world.applySpecies(loaded);
    rendererRef.current?.setSpecies(loaded.species);
    setSnapshot((s) => ({
      ...s,
      speciesId: loaded.species.id,
      displayName: loaded.species.displayName.zh ?? loaded.species.id,
      targetFps: loaded.species.animation.targetFps,
      walkSpeedPx: loaded.species.locomotion.walkSpeedPx,
      decisionIntervalMs: loaded.species.cognition.decisionIntervalMs,
      reactionDelayMs: loaded.species.cognition.reactionDelayMs,
      bodyScale: loaded.species.physical.bodyScale,
      warnings: loaded.warnings,
      degraded: loaded.degraded,
    }));
  };

  /** 从原始 JSON 重新加载，丢弃所有 patch */
  const resetSpecies = (): void => {
    const registry = registryRef.current;
    const world = worldRef.current;
    if (!registry || !world) return;
    const id = world.speciesData.id;
    const source = SPECIES_SOURCES.find((s) => s.id === id);
    if (!source) return;
    const loaded = registry.reload(source);
    world.applySpecies(loaded);
    rendererRef.current?.setSpecies(loaded.species);
  };

  const pause = (): void => {
    loopRef.current?.pause();
    setIsPaused(true);
    busRef.current?.emit('app:paused', { at: performance.now() });
  };

  const resume = (): void => {
    loopRef.current?.resume();
    setIsPaused(false);
    busRef.current?.emit('app:resumed', { at: performance.now() });
  };

  return { containerRef, snapshot, switchSpecies, patchSpecies, pause, resume, isPaused, resetSpecies };
}

// ─────────────────────────────────────────────────────────────
// 极小的深克隆 / 深合并工具
// 刻意不使用 JSON.parse(JSON.stringify())，以保留 undefined 语义（跳过而非清空）
// ─────────────────────────────────────────────────────────────

function deepClone<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => deepClone(v)) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = deepClone(v);
  }
  return out as unknown as T;
}

function mergePatch(
  target: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const existing = out[key];
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      existing !== null &&
      typeof existing === 'object' &&
      !Array.isArray(existing)
    ) {
      out[key] = mergePatch(existing as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      out[key] = value;
    }
  }
  return out;
}
