# dsh-pet HUD API — upstream proposal

This is the small generic extension `dsh-model-lens` relies on. It is intentionally
model-agnostic: dsh-pet only renders a URL; the plugin owns the content.

## Host service

Add a `hud` field to the existing `petApi7340` service (same `register` +
disposer pattern as balance / voice / speech / memory):

```ts
export interface PetHudRegistration {
  /** Plugin-owned stable id. */
  id: string
  /** Absolute http(s) URL, loopback or private address only. */
  url: string
  width: number
  height: number
  anchor?: 'left' | 'right'
  offsetX?: number
  offsetY?: number
  pointerEvents?: 'none' | 'auto'
  title?: string
}

export interface PetHudApi {
  apiVersion: 1
  register(reg: PetHudRegistration): () => void
  list(): PetHudRegistration[]
}
```

Validation in `register`:

- `id` matches `[A-Za-z0-9._:-]{1,64}` and is unique;
- URL scheme is `http:`/`https:`, host is loopback or RFC1918;
- width `160..480`, height `60..420`;
- offsets clamped to `-400..400`;
- returning the disposer removes the entry and notifies the helper.

The registry lives in memory. Registration is idempotent per id (duplicate ids
are rejected), and helper restarts rebuild from `sections.hud`.

## State

`PollStateStore` already has a `sections` map and `writeSection()`.
Registering/unregistering writes:

```json
{ "sections": { "hud": { "counter": 179..., "data": { "items": [ ... ] } } } }
```

The helper polls `GET /state` (long-poll or 1 s) and reacts to the
`sections.hud` leaf exactly like `sections.menu` today.

## Helper

`hud-layer.js` (loaded after `renderer.js`) does:

1. poll `/state` and read `sections.hud.data.items`;
2. for each item, create a transparent `<iframe class="dsh-pet-hud">` with
   `sandbox="allow-scripts allow-same-origin"` and `pointer-events` from the
   descriptor;
3. position it relative to `.pet-sprite` (left/right of the body, vertical
   center, offsets, clamp/flip at screen edges);
4. remove iframes whose ids disappear;
5. accept `{ type: 'dsh-model-lens:height', height }` from the iframe and update
   the frame height (content-driven auto-size);
6. append pet font hints (`petFont`, `petFamily`) to the iframe URL so the HUD
   can default to the pet's current font and bubble size.

The layer is generic: it has no knowledge of models, services, or the monitor
plugin.

## Interactive hotspots

A HUD that needs clicks (for example the start/stop button) sends its live
hotspot rectangles to the layer:

```js
parent.postMessage({ type: 'dsh-model-lens:hotspots', rects: [{ x, y, width, height }] }, '*')
```

The layer converts them to window coordinates and stores
`window.__dshPetHudInputRects`. The helper's `syncInputRegions()` merges those
rects into the normal input region IPC, and the pointer fallback treats them as
interactive even when no menu or chat panel is open. Everything outside the
hotspots remains click-through, so the card body does not block the desktop.

## Patch shape

`tools/patch-dsh-pet-hud.mjs` inserts:

- `lib/index.js`: the `normalizeHudRegistration` / `registerHud` / `listHuds`
  block before `ctx.provide("petApi7340", ...)`, the `hud` field on that object,
  and `hud: emptyLeaf()` in `PollStateStore`'s constructor.
- `runtime/electron-helper/index.html`: one `<script src="./hud-layer.js">`.
- `runtime/electron-helper/hud-layer.js`: the renderer above.
- `runtime/electron-helper/sprite/input.js`: merges the HUD hotspot rects into
  `syncInputRegions()`.
- `runtime/electron-helper/main/windows.js`: the pointer fallback treats those
  rects as interactive even when no menu/chat panel is open.

It is idempotent and backs up every touched file. Once this lands upstream, the
plugin only calls `petApi7340.hud.register(...)`; the patch and the local file
writes disappear.
