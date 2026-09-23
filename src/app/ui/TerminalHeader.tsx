import { useEffect, useState } from 'react';

export function TerminalHeader(props: {
  readonly catalogNo: string;
  readonly onToggleImmerse: () => void;
}): React.JSX.Element {
  const [clock, setClock] = useState(() => formatClock(new Date()));

  useEffect(() => {
    const id = window.setInterval(() => setClock(formatClock(new Date())), 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <header className="ldc-term-header">
      <div className="ldc-term-header__brand">
        <i className="ldc-term-header__mark" aria-hidden="true" />
        <div className="ldc-term-header__titles">
          <div className="ldc-term-header__title">L.D.C. TERMINAL</div>
          <div className="ldc-term-header__sub">LOW-DEFINITION CANINE DATABASE</div>
        </div>
      </div>
      <div className="ldc-term-header__specimen">{toSpecimen(props.catalogNo)}</div>
      <div className="ldc-term-header__meta">
        <span className="ldc-term-header__clock">{clock}</span>
        <button type="button" className="ldc-icon-btn" title="沉浸模式" onClick={props.onToggleImmerse}>
          [ ]
        </button>
      </div>
    </header>
  );
}

function toSpecimen(catalogNo: string): string {
  const digits = catalogNo.replace(/\D+/g, '') || '001';
  return `SPECIMEN_${digits.padStart(3, '0')}`;
}

function formatClock(date: Date): string {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}
