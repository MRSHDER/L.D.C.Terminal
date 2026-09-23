import { ObjectGlyph } from '../ObjectGlyph';

export const DOCK_ITEMS = ['meat', 'bowl', 'ball', 'water'] as const;
export type DockItemId = (typeof DOCK_ITEMS)[number];

const LABELS: Record<DockItemId, string> = {
  meat: 'FOOD',
  bowl: 'BOWL',
  ball: 'BALL',
  water: 'WATER',
};

export function ItemDock(props: {
  readonly selected: DockItemId;
  readonly archiveOpen: boolean;
  readonly onSelect: (id: DockItemId) => void;
  readonly onItemDown: (id: DockItemId, ev: React.PointerEvent<HTMLButtonElement>) => void;
  readonly onItemMove: (ev: React.PointerEvent<HTMLButtonElement>) => void;
  readonly onItemUp: (ev: React.PointerEvent<HTMLButtonElement>) => void;
  readonly onToggleArchive: () => void;
}): React.JSX.Element {
  return (
    <nav className="ldc-dock" aria-label="terminal tools">
      <div className="ldc-dock__slots">
        {DOCK_ITEMS.map((id) => (
          <button
            key={id}
            type="button"
            className={props.selected === id ? 'ldc-dock__slot ldc-dock__slot--on' : 'ldc-dock__slot'}
            title={LABELS[id]}
            onClick={() => props.onSelect(id)}
            onPointerDown={(ev) => props.onItemDown(id, ev)}
            onPointerMove={props.onItemMove}
            onPointerUp={props.onItemUp}
            onPointerCancel={props.onItemUp}
          >
            <ObjectGlyph id={id} />
            <span className="ldc-dock__label">{LABELS[id]}</span>
          </button>
        ))}
      </div>
      <button
        type="button"
        className="ldc-archive-door"
        aria-pressed={props.archiveOpen}
        onClick={props.onToggleArchive}
      >
        <span>▣</span>
        ARCHIVE
      </button>
    </nav>
  );
}
