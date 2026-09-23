/**
 * L.D.C. — 指针边界回归测试
 *
 * 用法：npm run pointer:test
 *
 * ★ 存在理由（这个文件是一次真实事故的产物）
 *
 * 曾经有一个 bug 让整个交互完全失效：
 * 玩家在页面上怎么点狗都没有任何反应。
 * 根因在 PointerAdapter.toSample()：把屏幕坐标乘以了设计宽度（320），
 * 而不是按 CSS 尺寸按比例缩小。
 * 于是点击 (124, 102) 被换算成 x = 103540，命中判定永远失败。
 *
 * 为什么所有自动化测试都没抓到它：
 *   tools/pet-test.ts 直接调用 World.pointerDown(x, y, ...) 并传入世界坐标，
 *   完全绕过了 PointerAdapter 这一层。
 *   被测的是逻辑，出错的是边界换算 —— 典型的测试覆盖盲区。
 *
 * 本文件补上这段盲区：不假设坐标，而是从屏幕像素出发，
 * 走完整的 事件 → adapter → 世界坐标 → 命中判定 链路，
 * 并断言点在狗身上这件事在任意视口尺寸下都成立。
 *
 * 注意：本文件是 UTF-8 源码，不要用 PowerShell 的 Set-Content 改写，
 *       那会把中文注释写成乱码。
 */

import { PointerAdapter } from '../src/core/interaction/PointerAdapter';
import type { PointerSample } from '../src/core/interaction/PointerAdapter';
import { World } from '../src/core/world/World';
import { EventBus } from '../src/core/event/EventBus';
import { SpeciesRegistry } from '../src/core/data/SpeciesRegistry';
import type { SpeciesSource } from '../src/core/data/SpeciesLoader';

import grayboxSpecies from '../src/species/graybox/species.json';
import grayboxBehaviors from '../src/species/graybox/behaviors.json';

const SOURCES: readonly SpeciesSource[] = [
  { id: 'graybox', species: grayboxSpecies, behaviors: grayboxBehaviors },
];

const DESIGN_W = 320;
const DESIGN_H = 200;
const BOUNDS = { w: DESIGN_W, h: DESIGN_H };
const FIXED_DT = 1 / 60;

/** 狗锚点在脚底中心；身体向上延伸 h。这里取狗身中心做点击目标 */
const DOG_FEET = { x: 124, y: 102 };
const DOG_BODY_H = 36;
const DOG_BODY_CENTRE = { x: DOG_FEET.x, y: DOG_FEET.y - DOG_BODY_H / 2 };

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed++;
    console.log(`  ✓ ${label}${detail ? `  ${detail}` : ''}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}${detail ? `  ${detail}` : ''}`);
  }
}

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const windowListeners = new Map<string, ((e: unknown) => void)[]>();

/**
 * window 替身。
 *
 * ★ PointerAdapter 在 attach() 里直接引用裸的 window（这是对的 ——
 *   它本来就只在浏览器里跑）。Node 环境没有 window，所以这里造一个替身。
 *   不给生产代码加环境判断分支：测试负责适配环境，而不是让生产代码为测试变形。
 */
const fakeWindow = {
  addEventListener(type: string, fn: (e: unknown) => void) {
    const arr = windowListeners.get(type) ?? [];
    arr.push(fn);
    windowListeners.set(type, arr);
  },
  removeEventListener(type: string, fn: (e: unknown) => void) {
    const arr = windowListeners.get(type) ?? [];
    windowListeners.set(type, arr.filter((f) => f !== fn));
  },
};

function installWindowStub(): void {
  (globalThis as unknown as { window: unknown }).window = fakeWindow;
}

function restoreWindow(): void {
  delete (globalThis as unknown as { window?: unknown }).window;
}

/**
 * 极简 DOM 替身。
 *
 * ★ 不引入 jsdom：
 *   PointerAdapter 只用到 addEventListener / getBoundingClientRect /
 *   preventDefault 这几个能力，造一个假元素比拖进一整个 DOM 实现更稳定，
 *   也避免测试环境行为与真实浏览器不一致这类更难查的问题。
 *   真实浏览器验证仍有独立环节（部署后 Playwright 点击）。
 */
function createFakeElement(rect: Rect) {
  const listeners = new Map<string, ((e: unknown) => void)[]>();
  return {
    rect,
    addEventListener(type: string, fn: (e: unknown) => void) {
      const arr = listeners.get(type) ?? [];
      arr.push(fn);
      listeners.set(type, arr);
    },
    removeEventListener(type: string, fn: (e: unknown) => void) {
      const arr = listeners.get(type) ?? [];
      listeners.set(type, arr.filter((f) => f !== fn));
    },
    getBoundingClientRect() {
      return {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        right: rect.left + rect.width,
        bottom: rect.top + rect.height,
        x: rect.left,
        y: rect.top,
      };
    },
    dispatch(type: string, e: unknown) {
      for (const fn of listeners.get(type) ?? []) fn(e);
    },
  };
}

function makePointerEvent(
  clientX: number,
  clientY: number,
  over: Partial<{
    pointerId: number;
    isPrimary: boolean;
    pointerType: string;
    button: number;
  }> = {},
): unknown {
  return {
    clientX,
    clientY,
    pointerId: over.pointerId ?? 1,
    isPrimary: over.isPrimary ?? true,
    pointerType: over.pointerType ?? 'mouse',
    button: over.button ?? 0,
    type: 'pointerdown',
    preventDefault() {},
    stopPropagation() {},
  };
}

function createWorld(): World {
  const bus = new EventBus();
  const registry = new SpeciesRegistry(bus);
  registry.registerAll(SOURCES);
  const loaded = registry.get('graybox');
  if (!loaded) {
    console.error('✗ 无法加载 graybox');
    process.exit(1);
  }
  const world = new World({ loaded, bounds: BOUNDS, seed: 20250101, bus });
  // 固定狗的位置，去掉随机漫游带来的不确定性
  world.blackboard.x = DOG_FEET.x;
  world.blackboard.y = DOG_FEET.y;
  return world;
}

function makeAdapter(
  el: ReturnType<typeof createFakeElement>,
  onDown: (s: PointerSample) => void = () => {},
): PointerAdapter {
  const adapter = new PointerAdapter(
    el as unknown as HTMLElement,
    { onDown, onMove: () => {}, onUp: () => {}, onCancel: () => {} },
    { primaryOnly: true },
  );
  adapter.setDesignSize(DESIGN_W, DESIGN_H);
  return adapter;
}

// ───────────────────────────────────────────────
// 1. 核心回归：设计分辨率 == CSS 尺寸时，点击狗身必须命中
// ───────────────────────────────────────────────

function testIdentityScale(): void {
  console.log('\n[1] 1:1 视口（CSS 尺寸 == 设计分辨率）');

  const world = createWorld();
  const el = createFakeElement({ left: 0, top: 0, width: DESIGN_W, height: DESIGN_H });

  let down: PointerSample | null = null;
  const adapter = makeAdapter(el, (s) => (down = s));

  el.dispatch('pointerdown', makePointerEvent(DOG_BODY_CENTRE.x, DOG_BODY_CENTRE.y));

  check('adapter 收到 pointerdown', down !== null);
  const sample = down as PointerSample | null;
  if (sample) {
    check(
      '坐标换算未放大（x 应约 124）',
      Math.abs(sample.x - DOG_BODY_CENTRE.x) < 0.5,
      `x=${sample.x.toFixed(2)}`,
    );
    check(
      '坐标换算未放大（y 应约 84）',
      Math.abs(sample.y - DOG_BODY_CENTRE.y) < 0.5,
      `y=${sample.y.toFixed(2)}`,
    );
    check(
      '命中狗身',
      world.hitsDog(sample.x, sample.y),
      `hitsDog(${sample.x.toFixed(1)}, ${sample.y.toFixed(1)})`,
    );
  }

  adapter.dispose();
}

// ───────────────────────────────────────────────
// 2. 缩放视口：画布被 CSS 放大时仍必须命中
// ───────────────────────────────────────────────

function testScaledViewport(): void {
  console.log('\n[2] 放大视口（CSS 拉伸到 960x600，3 倍缩放，画布有外边距）');

  const world = createWorld();
  const rect = { left: 40, top: 25, width: 960, height: 600 };
  const el = createFakeElement(rect);

  let down: PointerSample | null = null;
  const adapter = makeAdapter(el, (s) => (down = s));

  // 狗身中心的世界坐标 → 屏幕像素
  const screenX = rect.left + (DOG_BODY_CENTRE.x / DESIGN_W) * rect.width;
  const screenY = rect.top + (DOG_BODY_CENTRE.y / DESIGN_H) * rect.height;

  el.dispatch('pointerdown', makePointerEvent(screenX, screenY));

  const sample = down as PointerSample | null;
  check('adapter 收到 pointerdown', sample !== null);
  if (sample) {
    check(
      '缩放后仍能还原世界坐标',
      Math.abs(sample.x - DOG_BODY_CENTRE.x) < 0.5 &&
        Math.abs(sample.y - DOG_BODY_CENTRE.y) < 0.5,
      `得到 (${sample.x.toFixed(2)}, ${sample.y.toFixed(2)})，` +
        `期望 (${DOG_BODY_CENTRE.x}, ${DOG_BODY_CENTRE.y})`,
    );
    check('缩放视口下命中狗身', world.hitsDog(sample.x, sample.y));
  }

  adapter.dispose();
}

// ───────────────────────────────────────────────
// 3. 负向断言：点空白处不应命中
// ───────────────────────────────────────────────

function testMiss(): void {
  console.log('\n[3] 负向：点空白处不应命中');

  const world = createWorld();
  const el = createFakeElement({ left: 0, top: 0, width: DESIGN_W, height: DESIGN_H });

  let down: PointerSample | null = null;
  const adapter = makeAdapter(el, (s) => (down = s));

  el.dispatch('pointerdown', makePointerEvent(4, 4));

  const sample = down as PointerSample | null;
  check('adapter 收到 pointerdown', sample !== null);
  if (sample) {
    check(
      '角落坐标未被放大',
      sample.x < DESIGN_W && sample.y < DESIGN_H,
      `(${sample.x.toFixed(1)}, ${sample.y.toFixed(1)})`,
    );
    check('未命中狗身', !world.hitsDog(sample.x, sample.y));
  }

  adapter.dispose();
}

// ───────────────────────────────────────────────
// 4. 端到端：真实事件流应能建立抚摸会话并结算羁绊
// ───────────────────────────────────────────────

function testEndToEndPetting(): void {
  console.log('\n[4] 端到端：事件 → adapter → World → 羁绊结算');

  const world = createWorld();
  const el = createFakeElement({ left: 0, top: 0, width: DESIGN_W, height: DESIGN_H });

  let virtualMs = 0;
  const adapter = new PointerAdapter(
    el as unknown as HTMLElement,
    {
      onDown: (s) => world.pointerDown(s.x, s.y, virtualMs, s.pointerType === 'touch'),
      onMove: (s) => world.pointerMove(s.x, s.y, s.pointerType === 'touch'),
      onUp: () => world.pointerUp(virtualMs),
      onCancel: () => world.pointerUp(virtualMs),
    },
    { primaryOnly: true },
  );
  adapter.setDesignSize(DESIGN_W, DESIGN_H);

  const bondBefore = world.bondSnapshot.bond;

  el.dispatch('pointerdown', makePointerEvent(DOG_BODY_CENTRE.x, DOG_BODY_CENTRE.y));
  check('按下后进入抚摸状态', world.isBeingPetted, `isBeingPetted=${world.isBeingPetted}`);

  // 按住约 900ms，逐帧推进（模拟真实逻辑帧）
  // 注意 World.update(dtSec) 只接收步长，逻辑时钟由 World 自己维护 ——
  // 所以这里也要推进 virtualMs，它只用于喂给 pointerDown / pointerUp。
  for (let i = 0; i < 54; i++) {
    virtualMs += FIXED_DT * 1000;
    world.update(FIXED_DT);
  }

  const upListeners = windowListeners.get('pointerup') ?? [];
  check('pointerup 挂在 window 上（滑出元素也能收到）', upListeners.length > 0);
  for (const fn of upListeners) fn(makePointerEvent(DOG_BODY_CENTRE.x, DOG_BODY_CENTRE.y));

  const bondAfter = world.bondSnapshot.bond;
  check(
    '一次抚摸提升了羁绊',
    bondAfter > bondBefore,
    `${bondBefore.toFixed(4)} → ${bondAfter.toFixed(4)}`,
  );
  check('抬手后结束抚摸状态', !world.isBeingPetted);

  adapter.dispose();
}

// ───────────────────────────────────────────────
// 5. 主指针过滤：非主指针 / 右键不应触发
// ───────────────────────────────────────────────

function testPointerFiltering(): void {
  console.log('\n[5] 主指针过滤');

  const el = createFakeElement({ left: 0, top: 0, width: DESIGN_W, height: DESIGN_H });
  const downs: PointerSample[] = [];
  const adapter = makeAdapter(el, (s) => downs.push(s));

  el.dispatch('pointerdown', makePointerEvent(100, 100, { pointerId: 2, isPrimary: false }));
  check('非主指针被忽略', downs.length === 0, `收到 ${downs.length} 次`);

  el.dispatch('pointerdown', makePointerEvent(100, 100, { button: 2 }));
  check('右键被忽略', downs.length === 0, `收到 ${downs.length} 次`);

  el.dispatch('pointerdown', makePointerEvent(100, 100));
  check('左键被接受', downs.length === 1, `收到 ${downs.length} 次`);

  adapter.dispose();
}

// ───────────────────────────────────────────────
// main
// ───────────────────────────────────────────────

console.log('L.D.C. — 指针边界回归测试');
console.log('（覆盖 PointerAdapter → World 命中判定 这段曾经的测试盲区）');

installWindowStub();

testIdentityScale();
testScaledViewport();
testMiss();
testEndToEndPetting();
testPointerFiltering();

restoreWindow();

console.log(`\n${'─'.repeat(56)}`);
console.log(`通过 ${passed} / ${passed + failed}`);
if (failed > 0) {
  console.log(`✗ 有 ${failed} 项未通过`);
  process.exit(1);
}
console.log('✓ 指针边界全部正常');
