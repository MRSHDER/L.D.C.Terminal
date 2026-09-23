export function ArchivePanel(props: {
  readonly open: boolean;
  readonly catalogNo: string;
  readonly displayName: string;
}): React.JSX.Element | null {
  if (!props.open) return null;
  return (
    <aside className="ldc-archive" aria-label="archive">
      <h2>ARCHIVE CABINET</h2>
      <p>
        {props.catalogNo} / {props.displayName}
      </p>
      <ul>
        <li>SPECIES FILE — SEALED</li>
        <li>FIELD NOTES — EMPTY</li>
        <li>OBSERVATION LOG — STANDBY</li>
        <li>UNLOCKS — 0 / ??</li>
      </ul>
    </aside>
  );
}
