/**
 * L.D.C. — 引擎 React 绑定
 *
 * React 只做两件事：挂载/卸载画布，展示只读状态。
 * 不参与每帧渲染。
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

type QueuedInput =
  | { kind: 'down'; sample: PointerSample }
  | { kind: 'move'; sample: PointerSample }
  | { kind: 'up'; sample: PointerSample }
  | { kind: 'cancel'; sample: PointerSample };

function drainInputs(world: World, queue: QueuedInput[], recognizer: GestureRecognizer): void {
  for (let i = 0; i < queue.length; i++) {
    const ev = queue[i]!;
    switch (ev.kind) {
      case 'down':
        recognizer.onDown(ev.sample, world.elapsed);
        world.pointerDown(ev.sample.x, ev.sample.y, world.elapsed, ev.sample.pointerType !== 'mouse');
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
  recognizer.update(world.elapsed);
}

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
  readonly silhouette: {
    readonly bodyLength: number;
    readonly headForward: number;
    readonly snoutLength: number;
    readonly legLength: number;
    readonly earLength: number;
  };
  readonly overriddenCount: number;
  readonly warnings: readonly string[];
  readonly degraded: boolean;
  readonly stateScores: Readonly<Record<string, number>>;
  readonly speciesIds: readonly string[];
  readonly bond: number;
  readonly energy: number;
  readonly hunger: number;
  readonly beingPetted: boolean;
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
  silhouette: {
    bodyLength: 1.32,
    headForward: 0.58,
    snoutLength: 0.42,
    legLength: 0.42,
    earLength: 0.48,
  },
  overriddenCount: 0,
  warnings: [],
  degraded: false,
  stateScores: {},
  speciesIds: [],
  bond: 0,
  energy: 0.72,
  hunger: 0.38,
  beingPetted: false,
};

export interface UseEngineResult {
  readonly containerRef: React.RefObject<HTMLDivElement>;
  readonly snapshot: EngineSnapshot;
  readonly switchSpecies: (id: string) => void;
  readonly patchSpecies: (patch: Record<string, unknown>) => void;
  readonly pause: () => void;
  readonly resume: () => void;
  readonly isPaused: boolean;
  readonly resetSpecies: () => void;
}

function readSilhouette(sp: LoadedSpecies['species']): EngineSnapshot['silhouette'] {
  const s = sp.physical.silhouette;
  return {
    bodyLength: s.bodyLength,
    headForward: s.headForward,
    snoutLength: s.snoutLength,
    legLength: s.legLength,
    earLength: s.earLength,
  };
}

export function useEngine(designWidth: number, designHeight: number): UseEngineResult {
  const containerRef = useRef<HTMLDivElement>(null);
  const registryRef = useRef<SpeciesRegistry | null>(null);
  const worldRef = useRef<World | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const rendererRef = useRef<GrayboxRenderer | null>(null);
  const busRef = useRef<EventBus | null>(null);
  const pointerAdapterRef = useRef<PointerAdapter | null>(null);
  const gestureRecognizerRef = useRef<GestureRecognizer | null>(null);
  const inputQueueRef = useRef<QueuedInput[] | null>(null);
  const [snapshot, setSnapshot] = useState<EngineSnapshot>(EMPTY_SNAPSHOT);
  const [isPaused, setIsPaused] = useState(false);
  const accRef = useRef({ fps: 0, stateScores: {} as Record<string, number>, lastPushMs: 0 });

  useEffect(() => {
    let disposed = false;
    const bus = new EventBus();
    busRef.current = bus;
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
      showGrid: false,
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
        animFps: renderer ? world.getRenderState().frameCount || 0 : 0,
        targetFps: sp.animation.targetFps,
        position: { x: Math.round(world.blackboard.x), y: Math.round(world.blackboard.y) },
        speed: Math.round(world.blackboard.speedPxPerSec),
        decisionIntervalMs: sp.cognition.decisionIntervalMs,
        reactionDelayMs: sp.cognition.reactionDelayMs,
        walkSpeedPx: sp.locomotion.walkSpeedPx,
        bodyScale: sp.physical.bodyScale,
        silhouette: readSilhouette(sp),
        overriddenCount: loaded.overriddenPaths.length,
        warnings: loaded.warnings,
        degraded: loaded.degraded,
        stateScores: acc.stateScores,
        speciesIds: registry.ids(),
        bond: world.bondSnapshot.bond,
        energy: deriveEnergy(world.currentState, world.moodSnapshot.arousal, world.moodSnapshot.annoyance),
        hunger: deriveHunger(world.elapsed),
        beingPetted: world.isBeingPetted,
      });
    };

    const debugRequested =
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('debug') === '1';

    if (import.meta.env.DEV || debugRequested) {
      (window as unknown as Record<string, unknown>)['__LDC__'] = {
        get world() { return world; },
        get renderer() { return renderer; },
        get loop() { return loop; },
        renderState: () => world.getRenderState(),
        stageChildren: () => renderer.app.stage.children.length,
        micro: () => world.microSnapshot,
        bond: () => world.bondSnapshot,
        mood: () => world.moodSnapshot,
        dogInfo: () => {
          const bb = world.blackboard;
          const rs = world.getRenderState();
          return {
            world: { x: Math.round(bb.x), y: Math.round(bb.y) },
            size: { w: rs.w, h: rs.h },
            state: world.currentState,
            moving: bb.moving,
            hitPaddingPx: 12,
          };
        },
      };
    }

    const snapshotTimer = window.setInterval(() => {
      const current = registry.get(world.speciesData.id);
      if (current) pushSnapshot(current);
    }, 250);

    const offDecision = bus.on('state:decision', (p) => {
      accRef.current.stateScores = { ...p.scores };
    });
    const offSample = bus.on('world:fpsSampled', (p) => {
      accRef.current.fps = p.fps;
    });

    const loop = new GameLoop({
      update: (dtSec) => {
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

    const inputQueue: QueuedInput[] = [];
    inputQueueRef.current = inputQueue;
    const recognizer = new GestureRecognizer({
      onGesture: () => {},
      onPettingTick: () => {},
    });
    gestureRecognizerRef.current = recognizer;

    void (async () => {
      try {
        await renderer.init(containerRef.current!);
        if (disposed) {
          renderer.destroy();
          return;
        }
        renderer.setSpecies(initial.species);
        pushSnapshot(initial);
        loop.start();
        bus.emit('app:ready', { at: performance.now() });
        const canvasEl = containerRef.current?.querySelector('canvas') ?? containerRef.current;
        if (canvasEl) {
          const adapter = new PointerAdapter(
            canvasEl as HTMLElement,
            {
              onDown: (s) => inputQueue.push({ kind: 'down', sample: s }),
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
        setSnapshot((s) => ({ ...s, error: err instanceof Error ? err.message : String(err) }));
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

  const patchSpecies = (patch: Record<string, unknown>): void => {
    const registry = registryRef.current;
    const world = worldRef.current;
    if (!registry || !world) return;
    const currentId = world.speciesData.id;
    const raw = deepClone(world.speciesData) as unknown as Record<string, unknown>;
    const merged = mergePatch(raw, patch);
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
      silhouette: readSilhouette(loaded.species),
      warnings: loaded.warnings,
      degraded: loaded.degraded,
    }));
  };

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

function deriveEnergy(state: StateId, arousal: number, annoyance: number): number {
  const sleeping = state === 'Sleep' || state === 'Sleeping';
  return clamp01(0.62 + arousal * 0.28 - annoyance * 0.3 - (sleeping ? 0.32 : 0));
}

function deriveHunger(elapsedMs: number): number {
  return clamp01(0.34 + (elapsedMs % 240000) / 480000);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function mergePatch(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof out[k] === 'object' && out[k] && !Array.isArray(out[k])) {
      out[k] = mergePatch(out[k] as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}
