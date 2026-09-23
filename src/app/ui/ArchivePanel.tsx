export function ArchivePanel(props: {
  readonly open: boolean;
  readonly catalogNo: string;
  readonly displayName: string;
}): React.JSX.Element | null {
  if (!props.open) return null;
  return (
    <aside className="ldc-archive" aria-label="archive">
      <h2>ARCHIVE</h2>
      <p>
        {props.catalogNo} / {props.displayName}
      </p>
      <ul>
        <li>
          <b>PROFILE</b>
          <span>specimen file — sealed</span>
        </li>
        <li>
          <b>RECORD</b>
          <span>observation log — empty</span>
        </li>
        <li>
          <b>UNLOCKS</b>
          <span>0 / ??</span>
        </li>
      </ul>
    </aside>
  );
}
