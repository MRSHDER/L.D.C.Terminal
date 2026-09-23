export function StatusHud(props: {
  readonly bond: number;
  readonly energy: number;
  readonly hunger: number;
  readonly hot: boolean;
}): React.JSX.Element {
  return (
    <aside className={props.hot ? 'ldc-hud ldc-hud--hot' : 'ldc-hud'} aria-label="status">
      <HudRow icon="♥" value={props.bond} warn={false} />
      <HudRow icon="⚡" value={props.energy} warn={props.energy < 0.26} />
      <HudRow icon="🍖" value={1 - props.hunger} warn={props.hunger > 0.72} />
    </aside>
  );
}

function HudRow(props: { readonly icon: string; readonly value: number; readonly warn: boolean }): React.JSX.Element {
  const filled = Math.max(0, Math.min(8, Math.round(props.value * 8)));
  return (
    <div className="ldc-hud__row">
      <span className="ldc-hud__icon">{props.icon}</span>
      <div className="ldc-hud__bar">
        {Array.from({ length: 8 }, (_, i) => (
          <i
            key={i}
            className={
              i < filled
                ? props.warn
                  ? 'ldc-hud__cell ldc-hud__cell--on ldc-hud__cell--warn'
                  : 'ldc-hud__cell ldc-hud__cell--on'
                : 'ldc-hud__cell'
            }
          />
        ))}
      </div>
    </div>
  );
}
