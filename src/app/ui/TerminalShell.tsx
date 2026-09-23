import { useEffect, useState } from 'react';
import { TerminalHeader } from './TerminalHeader';
import { StatusHud } from './StatusHud';
import { BondToast } from './BondToast';
import { ItemDock, type DockItemId } from './ItemDock';
import { ArchivePanel } from './ArchivePanel';
import './terminal.css';

const SHELL_W = 480;
const SHELL_H = 270;
const ROOM_W = 320;
const ROOM_H = 200;

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
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const fit = (): void => {
      const w = props.immerse ? ROOM_W : SHELL_W;
      const h = props.immerse ? ROOM_H : SHELL_H;
      const next = Math.max(1, Math.floor(Math.min(window.innerWidth / w, window.innerHeight / h)));
      setScale(next);
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [props.immerse]);

  return (
    <div className="ldc-scale-host">
      <div
        className={props.immerse ? 'ldc-shell ldc-shell--immerse' : 'ldc-shell'}
        style={{ transform: `scale(${scale})` }}
      >
        <TerminalHeader catalogNo={props.catalogNo} onToggleImmerse={props.onToggleImmerse} />
        <div className="ldc-shell__mid">
          <div className="ldc-shell__gutter" />
          {props.children}
          <div className="ldc-shell__gutter ldc-shell__gutter--right">
            <StatusHud bond={props.bond} energy={props.energy} hunger={props.hunger} hot={props.hudHot} />
          </div>
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
    </div>
  );
}
