export function StatusHud(props: {
  readonly bond: number;
  readonly energy: number;
  readonly hunger: number;
  readonly hot: boolean;
}): React.JSX.Element {
  return (
    <aside className={props.hot ? 'ldc-hud ldc-hud--hot' : 'ldc-hud'} aria-label="status">
      <HudRow icon="♥" label="BOND" value={props.bond} warn={false} />
      <HudRow icon="⚡" label="ENERGY" value={props.energy} warn={props.energy < 0.26} />
      <HudRow icon="🍖" label="HUNGER" value={1 - props.hunger} warn={props.hunger > 0.72} />
    </aside>
  );
}

function HudRow(props: {
  readonly icon: string;
  readonly label: string;
  readonly value: number;
  readonly warn: boolean;
}): React.JSX.Element {
  const filled = Math.max(0, Math.min(8, Math.round(props.value * 8)));
  return (
    <div className="ldc-hud__row">
      <span className="ldc-hud__icon">{props.icon}</span>
      <div className="ldc-hud__stack">
        <span className="ldc-hud__label">{props.label}</span>
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
    </div>
  );
}
