/** Pixel glyphs for room objects. Zero raster assets. */

export function ObjectGlyph({ id }: { readonly id: string }) {
  if (id === 'meat') {
    return (
      <svg className="ldc-glyph" viewBox="0 0 18 12" aria-hidden="true">
        <rect x="1" y="4" width="4" height="3" fill="#e8dcc4" />
        <rect x="0" y="5" width="2" height="2" fill="#f4eee0" />
        <rect x="4" y="3" width="11" height="7" fill="#8a2a24" />
        <rect x="5" y="4" width="9" height="5" fill="#c43a32" />
        <rect x="6" y="5" width="6" height="3" fill="#e25a48" />
        <rect x="7" y="6" width="3" height="1" fill="#f2c4a0" />
        <rect x="10" y="5" width="2" height="1" fill="#f2c4a0" />
        <rect x="5" y="3" width="9" height="1" fill="#6a1c18" />
        <rect x="14" y="4" width="3" height="3" fill="#e8dcc4" />
        <rect x="16" y="5" width="2" height="2" fill="#f4eee0" />
        <rect x="4" y="9" width="10" height="1" fill="#3a1010" />
      </svg>
    );
  }

  if (id === 'water') {
    return (
      <svg className="ldc-glyph" viewBox="0 0 20 12" aria-hidden="true">
        <rect x="2" y="5" width="16" height="6" fill="#6a6e78" />
        <rect x="1" y="6" width="18" height="4" fill="#8a8e98" />
        <rect x="3" y="4" width="14" height="5" fill="#2a6aa8" />
        <rect x="4" y="5" width="12" height="3" fill="#3e8ad0" />
        <rect x="5" y="5" width="6" height="1" fill="#9ad4f4" />
        <rect x="8" y="6" width="3" height="1" fill="#d8f0fc" />
        <rect x="3" y="10" width="14" height="1" fill="#3a3e48" />
        <rect x="4" y="3" width="2" height="2" fill="#7ec8f0" opacity="0.9" />
        <rect x="12" y="2" width="2" height="2" fill="#7ec8f0" opacity="0.7" />
      </svg>
    );
  }

  if (id === 'bowl') {
    return (
      <svg className="ldc-glyph" viewBox="0 0 22 12" aria-hidden="true">
        <rect x="2" y="5" width="18" height="6" fill="#c4b496" />
        <rect x="1" y="6" width="20" height="4" fill="#d8c8a8" />
        <rect x="3" y="4" width="16" height="4" fill="#5a3a24" />
        <rect x="4" y="5" width="14" height="2" fill="#8a4a28" />
        <rect x="6" y="5" width="5" height="1" fill="#c47a48" />
        <rect x="3" y="10" width="16" height="1" fill="#6a5840" />
        <rect x="4" y="3" width="14" height="1" fill="#e8dcc0" />
      </svg>
    );
  }

  return (
    <svg className="ldc-glyph" viewBox="0 0 14 14" aria-hidden="true">
      <rect x="3" y="1" width="8" height="12" fill="#6bcf4a" />
      <rect x="1" y="3" width="12" height="8" fill="#6bcf4a" />
      <rect x="2" y="2" width="10" height="10" fill="#7fd85a" />
      <rect x="4" y="3" width="6" height="8" fill="#c8f08a" />
      <rect x="3" y="4" width="8" height="6" fill="#9ee868" />
      <rect x="2" y="6" width="10" height="2" fill="#f4f0d0" />
      <rect x="6" y="2" width="2" height="10" fill="#f4f0d0" />
      <rect x="4" y="3" width="2" height="2" fill="#f8fff0" />
      <rect x="1" y="4" width="1" height="6" fill="#3a7a28" />
      <rect x="12" y="4" width="1" height="6" fill="#3a7a28" />
    </svg>
  );
}
