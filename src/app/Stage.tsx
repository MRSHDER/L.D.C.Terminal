/**
 * L.D.C. — Stage（Milestone 3：Interaction Foundation）
 *
 * 默认体验仍然是：一个房间，一只狗。
 * Milestone 3 的第一步只加入三个可拖动物体，让玩家开始表达意图：
 *   - meat 拖到嘴边：手喂
 *   - meat 拖到地面：丢到地上
 *   - meat 拖到碗里：放进碗
 *
 * 这一步只识别 intent，不在这里决定狗怎么回应。
 * 狗的回应后续仍然交给 core/world/FSM 与犬种数据。
 */

import { useRef, useState } from 'react';
import { useEngine } from './hooks/useEngine';
import { TuningPanel } from './ui/TuningPanel';
import { SnapshotPanel } from './ui/SnapshotPanel';
import { DiagnosticsPanel } from './ui/DiagnosticsPanel';
import {
  createInteractionObjects,
  intentForDrop,
  resolveDropTarget,
  type DropIntentResult,
  type DropZone,
  type InteractionObjectState,
} from '@core/interaction/ObjectInteraction';
import './Stage.css';
import './InteractionObjects.css';

/** 设计分辨率：低分辨率像素风的基础画布尺寸 */
const DESIGN_W = 320;
const DESIGN_H = 200;

/**
 * ★ 设计分辨率的宽高比必须与 Stage.css 中 `.ldc-stage__frame` 的
 *   `padding-top` 一致，否则画布会被裁切或拉伸。
 *   CSS 无法读取 TS 常量，因此在此做运行时断言 ——
 *   改动下面的数字却忘了改 CSS 时，会立刻在控制台报错。
 */
const PADDING_TOP_PERCENT = 62.5;
if (import.meta.env.DEV) {
  const actual = (DESIGN_H / DESIGN_W) * 100;
  if (Math.abs(actual - PADDING_TOP_PERCENT) > 0.01) {
    console.error(
      `[LDC] Stage.css 的 padding-top (${PADDING_TOP_PERCENT}%) 与设计分辨率 ` +
        `${DESIGN_W}×${DESIGN_H} 的宽高比 (${actual.toFixed(2)}%) 不一致。请同步修改。`,
    );
  }
}

type DragSession = {
  readonly id: string;
  readonly offsetX: number;
  readonly offsetY: number;
};

export function Stage(): React.JSX.Element {
  const engine = useEngine(DESIGN_W, DESIGN_H);
  const { snapshot } = engine;
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragSession | null>(null);
  const [objects, setObjects] = useState<readonly InteractionObjectState[]>(() => createInteractionObjects());
  const [lastIntent, setLastIntent] = useState<DropIntentResult | null>(null);

  // 调试面板仅在 ?debug=1 时出现。
  // 默认体验 = 一个房间 + 一只狗，没有任何界面元素。
  const debugVisible =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('debug') === '1';

  const toWorldPoint = (ev: React.PointerEvent): { x: number; y: number } => {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
    return {
      x: ((ev.clientX - rect.left) / rect.width) * DESIGN_W,
      y: ((ev.clientY - rect.top) / rect.height) * DESIGN_H,
    };
  };

  const moveObject = (id: string, x: number, y: number, dragging: boolean): void => {
    setObjects((prev) =>
      prev.map((obj) =>
        obj.id === id
          ? {
              ...obj,
              x: clamp(x, obj.size.w / 2, DESIGN_W - obj.size.w / 2),
              y: clamp(y, obj.size.h / 2, DESIGN_H - obj.size.h / 2),
              dragging,
            }
          : obj,
      ),
    );
  };

  const resetObject = (id: string): void => {
    setObjects((prev) =>
      prev.map((obj) =>
        obj.id === id
          ? {
              ...obj,
              x: obj.home.x,
              y: obj.home.y,
              dragging: false,
            }
          : obj,
      ),
    );
  };

  const onObjectDown = (ev: React.PointerEvent<HTMLButtonElement>, obj: InteractionObjectState): void => {
    ev.preventDefault();
    ev.stopPropagation();
    ev.currentTarget.setPointerCapture(ev.pointerId);
    const p = toWorldPoint(ev);
    dragRef.current = {
      id: obj.id,
      offsetX: obj.x - p.x,
      offsetY: obj.y - p.y,
    };
    moveObject(obj.id, obj.x, obj.y, true);
  };

  const onObjectMove = (ev: React.PointerEvent<HTMLButtonElement>): void => {
    const drag = dragRef.current;
    if (!drag) return;
    ev.preventDefault();
    ev.stopPropagation();
    const p = toWorldPoint(ev);
    moveObject(drag.id, p.x + drag.offsetX, p.y + drag.offsetY, true);
  };

  const onObjectUp = (ev: React.PointerEvent<HTMLButtonElement>): void => {
    const drag = dragRef.current;
    if (!drag) return;
    ev.preventDefault();
    ev.stopPropagation();
    dragRef.current = null;

    const p = toWorldPoint(ev);
    const obj = objects.find((candidate) => candidate.id === drag.id);
    if (!obj) return;

    const at = {
      x: clamp(p.x + drag.offsetX, obj.size.w / 2, DESIGN_W - obj.size.w / 2),
      y: clamp(p.y + drag.offsetY, obj.size.h / 2, DESIGN_H - obj.size.h / 2),
    };
    const result = intentForDrop(obj, resolveDropTarget(at, createDropZones(snapshot.position, objects)), at);
    setLastIntent(result);
    resetObject(obj.id);
  };

  const interactionLayer = (
    <div className="ldc-objects" aria-label="Interaction objects">
      {objects.map((obj) => (
        <button
          key={obj.id}
          type="button"
          className={obj.dragging ? 'ldc-object ldc-object--dragging' : 'ldc-object'}
          style={{
            left: `${(obj.x / DESIGN_W) * 100}%`,
            top: `${(obj.y / DESIGN_H) * 100}%`,
            width: `${(obj.size.w / DESIGN_W) * 100}%`,
            height: `${(obj.size.h / DESIGN_H) * 100}%`,
            backgroundColor: colorToCss(obj.color),
          }}
          title={`${obj.label}: drag to dog, floor, or bowl`}
          onPointerDown={(ev) => onObjectDown(ev, obj)}
          onPointerMove={onObjectMove}
          onPointerUp={onObjectUp}
          onPointerCancel={onObjectUp}
        >
          <span>{obj.label}</span>
        </button>
      ))}
      {lastIntent && debugVisible && (
        <div className="ldc-intent-readout">
          {lastIntent.objectId} → {lastIntent.target} / {lastIntent.intent}
        </div>
      )}
    </div>
  );

  return (
    <div className={debugVisible ? 'ldc-root ldc-root--debug' : 'ldc-root ldc-root--room'}>
      {!debugVisible && (
        <div className="ldc-room">
          <div ref={frameRef} className="ldc-room__frame">
            <div ref={engine.containerRef} className="ldc-room__canvas" />
            {interactionLayer}
            {snapshot.error && (
              <div className="ldc-room__error">
                <strong>渲染器初始化失败</strong>
                <pre>{snapshot.error}</pre>
              </div>
            )}
          </div>
        </div>
      )}

      {debugVisible && (
        <>
          <header className="ldc-header">
            <div className="ldc-brand">
              <span className="ldc-brand__mark">L.D.C.</span>
              <span className="ldc-brand__sub">LOW-DEFINITION CANINE DATABASE</span>
            </div>
            <div className="ldc-header__phase">
              <span className="ldc-badge">M3 · INTERACTION FOUNDATION</span>
              <span className="ldc-header__note">调试模式（?debug=1）</span>
            </div>
          </header>

          <main className="ldc-main">
            <section className="ldc-stage">
              <div ref={frameRef} className="ldc-stage__frame">
                <div ref={engine.containerRef} className="ldc-stage__canvas" />
                {interactionLayer}
                {snapshot.error && (
                  <div className="ldc-stage__error">
                    <strong>渲染器初始化失败</strong>
                    <pre>{snapshot.error}</pre>
                  </div>
                )}
                {!snapshot.ready && !snapshot.error && (
                  <div className="ldc-stage__loading">引擎启动中…</div>
                )}
              </div>

              <div className="ldc-stage__bar">
                <button className="ldc-btn" onClick={engine.isPaused ? engine.resume : engine.pause}>
                  {engine.isPaused ? '▶ 继续' : '⏸ 暂停'}
                </button>
                <button className="ldc-btn" onClick={engine.resetSpecies}>
                  ↺ 还原 JSON
                </button>
                <span className="ldc-stage__hint">
                  状态：<code>{snapshot.currentState}</code>
                </span>
                {lastIntent && (
                  <span className="ldc-stage__hint">
                    意图：<code>{lastIntent.intent}</code>
                  </span>
                )}
              </div>
            </section>

            <aside className="ldc-side">
              <SnapshotPanel snapshot={snapshot} onSwitchSpecies={engine.switchSpecies} />
              <DiagnosticsPanel snapshot={snapshot} />
              <TuningPanel snapshot={snapshot} onPatch={engine.patchSpecies} />
            </aside>
          </main>

          <footer className="ldc-footer">
            <span>
              逻辑帧 <b>{snapshot.tick}</b>
            </span>
            <span>
              渲染 <b>{snapshot.fps.toFixed(0)}</b> fps
            </span>
            <span>
              像素帧 <b>{snapshot.targetFps}</b> fps
            </span>
          </footer>
        </>
      )}
    </div>
  );
}

function createDropZones(
  dog: { readonly x: number; readonly y: number },
  objects: readonly InteractionObjectState[],
): readonly DropZone[] {
  const bowl = objects.find((obj) => obj.id === 'bowl');
  return [
    {
      kind: 'mouth',
      x: dog.x + 4,
      y: dog.y - 42,
      w: 34,
      h: 28,
    },
    bowl
      ? {
          kind: 'bowl',
          x: bowl.home.x - 18,
          y: bowl.home.y - 14,
          w: 36,
          h: 28,
        }
      : {
          kind: 'bowl',
          x: 252,
          y: 156,
          w: 44,
          h: 32,
        },
    {
      kind: 'ground',
      x: 0,
      y: 142,
      w: DESIGN_W,
      h: DESIGN_H - 142,
    },
  ];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function colorToCss(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}
