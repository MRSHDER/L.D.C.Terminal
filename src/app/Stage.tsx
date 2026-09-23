/**
 * L.D.C. — Stage
 * 默认画面就是终端本身：顶栏 + 房间 + 底栏。
 * ?debug=1 仍打开开发侧栏。
 */

import { useEffect, useRef, useState } from 'react';
import { useEngine } from './hooks/useEngine';
import { TuningPanel } from './ui/TuningPanel';
import { SnapshotPanel } from './ui/SnapshotPanel';
import { DiagnosticsPanel } from './ui/DiagnosticsPanel';
import { TerminalShell } from './ui/TerminalShell';
import { type DockItemId } from './ui/ItemDock';
import { ObjectGlyph } from './ObjectGlyph';
import {
  createInteractionObjects,
  intentForDrop,
  resolveDropTarget,
  type DropIntentResult,
  type DropTargetKind,
  type DropZone,
  type InteractionObjectState,
} from '@core/interaction/ObjectInteraction';
import './Stage.css';
import './InteractionObjects.css';

const DESIGN_W = 320;
const DESIGN_H = 200;

type DragSession = {
  readonly id: string;
  readonly offsetX: number;
  readonly offsetY: number;
};

type RoomObject = InteractionObjectState & {
  readonly parked: boolean;
  readonly consumed: boolean;
};

export function Stage(): React.JSX.Element {
  const engine = useEngine(DESIGN_W, DESIGN_H);
  const { snapshot } = engine;
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragSession | null>(null);
  const prevBondRef = useRef(snapshot.bond);
  const [objects, setObjects] = useState<readonly RoomObject[]>(() =>
    createInteractionObjects().map((obj) => ({ ...obj, parked: obj.id === 'bowl', consumed: false })),
  );
  const [lastIntent, setLastIntent] = useState<DropIntentResult | null>(null);
  const [hoverTarget, setHoverTarget] = useState<DropTargetKind | null>(null);
  const [immerse, setImmerse] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [selected, setSelected] = useState<DockItemId>('meat');
  const [toastToken, setToastToken] = useState(0);
  const [toastText, setToastText] = useState('♥ +Bond');
  const hungerRef = useRef(0.32);
  const energyRef = useRef(0.78);
  const [hunger, setHunger] = useState(0.32);
  const [energy, setEnergy] = useState(0.78);

  const debugVisible =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('debug') === '1';

  const flash = (text: string): void => {
    setToastText(text);
    setToastToken((n) => n + 1);
  };

  useEffect(() => {
    if (snapshot.beingPetted) flash('♥ +Bond');
  }, [snapshot.beingPetted]);

  useEffect(() => {
    if (snapshot.bond > prevBondRef.current + 0.01) flash('♥ +Bond');
    prevBondRef.current = snapshot.bond;
  }, [snapshot.bond]);

  useEffect(() => {
    const id = window.setInterval(() => {
      hungerRef.current = Math.min(1, hungerRef.current + 0.016 * 0.25);
      const moving =
        snapshot.currentState === 'Walk' ||
        snapshot.currentState === 'Approach' ||
        snapshot.currentState === 'Retreat';
      if (snapshot.currentState === 'Sleep') energyRef.current = Math.min(1, energyRef.current + 0.03);
      else if (moving) energyRef.current = Math.max(0, energyRef.current - 0.011);
      else energyRef.current = Math.min(1, energyRef.current + 0.003);
      setHunger(hungerRef.current);
      setEnergy(energyRef.current);
    }, 250);
    return () => window.clearInterval(id);
  }, [snapshot.currentState]);

  const toWorldPoint = (ev: React.PointerEvent): { x: number; y: number } => {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return { x: DESIGN_W / 2, y: DESIGN_H * 0.72 };
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
              consumed: false,
            }
          : obj,
      ),
    );
  };

  const beginDrag = (ev: React.PointerEvent<HTMLButtonElement>, obj: RoomObject): void => {
    ev.preventDefault();
    ev.stopPropagation();
    ev.currentTarget.setPointerCapture(ev.pointerId);
    const p = toWorldPoint(ev);
    dragRef.current = {
      id: obj.id,
      offsetX: obj.dragging || obj.parked ? obj.x - p.x : 0,
      offsetY: obj.dragging || obj.parked ? obj.y - p.y : 0,
    };
    moveObject(obj.id, p.x, p.y, true);
  };

  const onObjectMove = (ev: React.PointerEvent<HTMLButtonElement>): void => {
    const drag = dragRef.current;
    if (!drag) return;
    ev.preventDefault();
    ev.stopPropagation();
    const p = toWorldPoint(ev);
    const at = { x: p.x + drag.offsetX, y: p.y + drag.offsetY };
    moveObject(drag.id, at.x, at.y, true);
    setHoverTarget(resolveDropTarget(at, createDropZones(snapshot.position, objects)));
  };

  const onObjectUp = (ev: React.PointerEvent<HTMLButtonElement>): void => {
    const drag = dragRef.current;
    if (!drag) return;
    ev.preventDefault();
    ev.stopPropagation();
    dragRef.current = null;
    setHoverTarget(null);

    const p = toWorldPoint(ev);
    const obj = objects.find((candidate) => candidate.id === drag.id);
    if (!obj) return;

    const at = {
      x: clamp(p.x + drag.offsetX, obj.size.w / 2, DESIGN_W - obj.size.w / 2),
      y: clamp(p.y + drag.offsetY, obj.size.h / 2, DESIGN_H - obj.size.h / 2),
    };
    const result = intentForDrop(obj, resolveDropTarget(at, createDropZones(snapshot.position, objects)), at);
    setLastIntent(result);

    if (result.intent === 'FEED_HAND') {
      hungerRef.current = Math.max(0, hungerRef.current - 0.42);
      setHunger(hungerRef.current);
      flash('🍖 ate');
      setObjects((prev) =>
        prev.map((item) =>
          item.id === obj.id
            ? { ...item, dragging: false, parked: false, consumed: true, x: item.home.x, y: item.home.y }
            : item,
        ),
      );
      return;
    }

    if (result.intent === 'FEED_BOWL') {
      const bowl = objects.find((item) => item.id === 'bowl');
      flash('▾ in bowl');
      setObjects((prev) =>
        prev.map((item) =>
          item.id === obj.id
            ? {
                ...item,
                x: bowl ? bowl.x : at.x,
                y: bowl ? bowl.y - 10 : at.y,
                dragging: false,
                parked: true,
                consumed: false,
              }
            : item,
        ),
      );
      return;
    }

    setObjects((prev) =>
      prev.map((item) =>
        item.id === obj.id
          ? { ...item, x: item.home.x, y: item.home.y, dragging: false, parked: item.id === 'bowl', consumed: false }
          : item,
      ),
    );
  };

  const onDockSelect = (id: DockItemId): void => setSelected(id);

  const onDockItemDown = (id: DockItemId, ev: React.PointerEvent<HTMLButtonElement>): void => {
    const obj = objects.find((candidate) => candidate.id === id);
    if (!obj) return;
    setSelected(id);
    beginDrag(ev, obj);
  };

  const visibleObjects = objects.filter((obj) => obj.id === 'bowl' || obj.dragging || obj.parked);
  const zones = createDropZones(snapshot.position, objects);

  const interactionLayer = (
    <div className="ldc-objects" aria-label="Interaction objects">
      {hoverTarget && (
        <i
          className={`ldc-target ldc-target--${hoverTarget}`}
          style={zoneStyle(zones.find((zone) => zone.kind === hoverTarget))}
        />
      )}
      {visibleObjects.map((obj) => (
        <button
          key={obj.id}
          type="button"
          className={
            obj.dragging
              ? `ldc-object ldc-object--${obj.id} ldc-object--dragging`
              : `ldc-object ldc-object--${obj.id}`
          }
          style={{
            left: `${(obj.x / DESIGN_W) * 100}%`,
            top: `${(obj.y / DESIGN_H) * 100}%`,
            width: `${(obj.size.w / DESIGN_W) * 100}%`,
            height: `${(obj.size.h / DESIGN_H) * 100}%`,
          }}
          title={`${obj.label}: drag to mouth or bowl`}
          onPointerDown={(ev) => beginDrag(ev, obj)}
          onPointerMove={onObjectMove}
          onPointerUp={onObjectUp}
          onPointerCancel={onObjectUp}
        >
          <ObjectGlyph id={obj.id} />
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

  const roomFrame = (
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
  );

  return (
    <div className={debugVisible ? 'ldc-root ldc-root--debug' : 'ldc-root ldc-root--room'}>
      {!debugVisible && (
        <TerminalShell
          catalogNo={snapshot.catalogNo}
          displayName={snapshot.displayName}
          bond={snapshot.bond}
          energy={energy}
          hunger={hunger}
          hudHot={snapshot.beingPetted || snapshot.currentState !== 'Idle' || hunger > 0.72}
          toastToken={toastToken}
          toastText={toastText}
          immerse={immerse}
          selected={selected}
          archiveOpen={archiveOpen}
          onToggleImmerse={() => setImmerse((v) => !v)}
          onSelect={onDockSelect}
          onItemDown={onDockItemDown}
          onItemMove={onObjectMove}
          onItemUp={onObjectUp}
          onToggleArchive={() => setArchiveOpen((v) => !v)}
        >
          {roomFrame}
        </TerminalShell>
      )}

      {debugVisible && (
        <>
          <header className="ldc-header">
            <div className="ldc-brand">
              <span className="ldc-brand__mark">L.D.C.</span>
              <span className="ldc-brand__sub">LOW-DEFINITION CANINE DATABASE</span>
            </div>
          </header>
          <main className="ldc-main">
            <section className="ldc-stage">
              <div ref={frameRef} className="ldc-stage__frame">
                <div ref={engine.containerRef} className="ldc-stage__canvas" />
                {interactionLayer}
              </div>
            </section>
            <aside className="ldc-side">
              <SnapshotPanel snapshot={snapshot} onSwitchSpecies={engine.switchSpecies} />
              <DiagnosticsPanel snapshot={snapshot} />
              <TuningPanel snapshot={snapshot} onPatch={engine.patchSpecies} />
            </aside>
          </main>
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
    { kind: 'mouth', x: dog.x - 10, y: dog.y - 52, w: 52, h: 40 },
    bowl
      ? { kind: 'bowl', x: bowl.x - 22, y: bowl.y - 18, w: 44, h: 32 }
      : { kind: 'bowl', x: 252, y: 156, w: 44, h: 32 },
  ];
}

function zoneStyle(zone: DropZone | undefined): React.CSSProperties | undefined {
  if (!zone) return undefined;
  return {
    left: `${(zone.x / DESIGN_W) * 100}%`,
    top: `${(zone.y / DESIGN_H) * 100}%`,
    width: `${(zone.w / DESIGN_W) * 100}%`,
    height: `${(zone.h / DESIGN_H) * 100}%`,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
