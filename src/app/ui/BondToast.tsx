export function BondToast(props: { readonly token: number }): React.JSX.Element | null {
  if (props.token <= 0) return null;
  return (
    <div key={props.token} className="ldc-toast">
      ♥ +Bond
    </div>
  );
}
