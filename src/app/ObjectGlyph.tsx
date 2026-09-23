/** Pixel glyphs for room objects. Zero raster assets. */

export function ObjectGlyph({ id }: { readonly id: string }) {
  if (id === 'meat') {
    return (
      <svg className="ldc-glyph" viewBox="0 0 24 16" aria-hidden="true">
        <rect x="1" y="6" width="5" height="4" fill="#efe6d2" />
        <rect x="0" y="7" width="3" height="3" fill="#fff8ea" />
        <rect x="2" y="5" width="3" height="2" fill="#d2c4a4" />
        <rect x="5" y="3" width="14" height="10" fill="#6e1c1c" />
        <rect x="6" y="4" width="12" height="8" fill="#b43028" />
        <rect x="7" y="5" width="10" height="6" fill="#d44838" />
        <rect x="8" y="6" width="4" height="2" fill="#f0c8a8" />
        <rect x="13" y="7" width="3" height="1" fill="#f0c8a8" />
        <rect x="9" y="8" width="2" height="1" fill="#8a2420" />
        <rect x="6" y="3" width="12" height="1" fill="#4a1010" />
        <rect x="6" y="12" width="12" height="1" fill="#3a0c0c" />
        <rect x="18" y="6" width="5" height="4" fill="#efe6d2" />
        <rect x="21" y="7" width="3" height="3" fill="#fff8ea" />
        <rect x="19" y="5" width="3" height="2" fill="#d2c4a4" />
      </svg>
    );
  }

  if (id === 'water') {
    return (
      <svg className="ldc-glyph" viewBox="0 0 24 16" aria-hidden="true">
        <rect x="3" y="8" width="18" height="6" fill="#6a7078" />
        <rect x="2" y="9" width="20" height="4" fill="#8a9098" />
        <rect x="4" y="13" width="16" height="2" fill="#4a5058" />
        <rect x="5" y="5" width="14" height="6" fill="#1e5a96" />
        <rect x="6" y="6" width="12" height="4" fill="#2f7fc4" />
        <rect x="7" y="7" width="8" height="2" fill="#5eb4e8" />
        <rect x="8" y="7" width="4" height="1" fill="#d7f3ff" />
        <rect x="16" y="8" width="2" height="1" fill="#9ad4f4" />
        <rect x="4" y="4" width="16" height="2" fill="#a8aeb6" />
        <rect x="10" y="2" width="2" height="2" fill="#7ec8f0" />
        <rect x="15" y="1" width="2" height="2" fill="#7ec8f0" opacity="0.7" />
      </svg>
    );
  }

  if (id === 'bowl') {
    return (
      <svg className="ldc-glyph" viewBox="0 0 28 16" aria-hidden="true">
        <rect x="3" y="8" width="22" height="6" fill="#cbb792" />
        <rect x="2" y="9" width="24" height="4" fill="#e2d3b0" />
        <rect x="4" y="13" width="20" height="2" fill="#8a7858" />
        <rect x="5" y="5" width="18" height="6" fill="#6a3a20" />
        <rect x="6" y="6" width="16" height="4" fill="#8a4a28" />
        <rect x="8" y="7" width="3" height="2" fill="#c47a48" />
        <rect x="13" y="6" width="2" height="2" fill="#d49258" />
        <rect x="17" y="7" width="3" height="2" fill="#c47a48" />
        <rect x="4" y="4" width="20" height="2" fill="#f0e4c4" />
      </svg>
    );
  }

  return (
    <svg className="ldc-glyph" viewBox="0 0 18 18" aria-hidden="true">
      <rect x="5" y="1" width="8" height="16" fill="#3f8a28" />
      <rect x="1" y="5" width="16" height="8" fill="#3f8a28" />
      <rect x="3" y="3" width="12" height="12" fill="#5fb83a" />
      <rect x="4" y="2" width="10" height="14" fill="#6fd24a" />
      <rect x="2" y="4" width="14" height="10" fill="#6fd24a" />
      <rect x="5" y="4" width="8" height="10" fill="#8ee25e" />
      <rect x="6" y="5" width="2" height="2" fill="#f4ffe8" />
      <rect x="4" y="8" width="2" height="2" fill="#d8f0a0" />
      <rect x="11" y="7" width="2" height="3" fill="#f0f4c0" />
      <rect x="8" y="10" width="3" height="1" fill="#f0f4c0" />
      <rect x="1" y="6" width="1" height="6" fill="#2a5e1c" />
      <rect x="16" y="6" width="1" height="6" fill="#2a5e1c" />
    </svg>
  );
}
