import { TerminalHeader } from './TerminalHeader';
import { StatusHud } from './StatusHud';
import { BondToast } from './BondToast';
import { ItemDock, type DockItemId } from './ItemDock';
import { ArchivePanel } from './ArchivePanel';
import './terminal.css';

export function TerminalShell(props: {
  readonly catalogNo: string;
  readonly displayName: string;
  readonly bond: number;
  readonly energy: number;
  readonly hunger: number;
  readonly hudHot: boolean;
  readonly toastToken: number;
  readonly immerse: boolean;
  readonly selected: DockItemId;
  readonly archiveOpen: boolean;
  readonly onToggleImmerse: () => void;
  readonly onSelect: (id: DockItemId) => void;
  readonly onItemDown: (id: DockItemId, ev: React.PointerEvent<HTMLButtonElement>) => void;
  readonly onItemMove: (ev: React.PointerEvent<HTMLButtonElement>) => void;
  readonly onItemUp: (ev: React.PointerEvent<HTMLButtonElement>) => void;
  readonly onToggleArchive: () => void;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className={props.immerse ? 'ldc-shell ldc-shell--immerse' : 'ldc-shell'}>
      <TerminalHeader catalogNo={props.catalogNo} onToggleImmerse={props.onToggleImmerse} />
      <div className="ldc-shell__room">
        {props.children}
        <StatusHud bond={props.bond} energy={props.energy} hunger={props.hunger} hot={props.hudHot} />
        <BondToast token={props.toastToken} />
        <ArchivePanel open={props.archiveOpen} catalogNo={props.catalogNo} displayName={props.displayName} />
      </div>
      <ItemDock
        selected={props.selected}
        archiveOpen={props.archiveOpen}
        onSelect={props.onSelect}
        onItemDown={props.onItemDown}
        onItemMove={props.onItemMove}
        onItemUp={props.onItemUp}
        onToggleArchive={props.onToggleArchive}
      />
    </div>
  );
}
