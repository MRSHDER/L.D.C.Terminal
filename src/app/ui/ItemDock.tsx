import { ObjectGlyph } from '../ObjectGlyph';

export const DOCK_ITEMS = ['pet', 'meat', 'ball', 'water', 'more'] as const;
export type DockItemId = (typeof DOCK_ITEMS)[number];

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
            title={labelFor(id)}
            onClick={() => props.onSelect(id)}
            onPointerDown={(ev) => props.onItemDown(id, ev)}
            onPointerMove={props.onItemMove}
            onPointerUp={props.onItemUp}
            onPointerCancel={props.onItemUp}
          >
            {id === 'pet' || id === 'more' ? <i className="ldc-dock__glyph" aria-hidden="true" /> : <ObjectGlyph id={id} />}
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

function labelFor(id: DockItemId): string {
  if (id === 'pet') return 'Pet';
  if (id === 'meat') return 'Food';
  if (id === 'water') return 'Water';
  if (id === 'ball') return 'Ball';
  return 'More';
}
