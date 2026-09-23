# Bernese Mountain Dog sprites

First-pass pipeline: optional `resources.sprites` on any species.
This folder is the asset root for `bernese-mountain-dog`.

## Required for idle (this slice)

Put a **horizontal sprite sheet** here:

```text
side-idle.png
```

Rules:

- canvas per frame: `96 × 64`
- facing right
- transparent background
- no anti-aliasing
- no baked shadow
- same baseline on every frame
- sheet size: `96 * frames` wide × `64` tall (4 frames → `384 × 64`)
- spacing / margin: `0`

Declared in `src/species/bernese-mountain-dog/species.json` as `resources.sprites.clips.idle`.

If this file is missing, the renderer falls back to existing graybox frames. Do not leave a broken PNG.

## Later clips (do not hook yet)

```text
side-walk.png
side-run.png
side-sit.png
side-sniff.png
side-tail-wag.png
side-eat.png
side-drink.png
```

Same 96×64 row-sheet rules. One format per clip — do not mix sheet + numbered frames.
