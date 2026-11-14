/**
 * Installs the generic HUD API into dsh-pet and the HUD layer into its desktop helper.
 *
 * Host: adds `petApi7340.hud = { apiVersion, register, list }` to the built host bundle
 * and a `sections.hud` state leaf, so any plugin can register a HUD descriptor.
 * Helper: loads `hud-layer.js`, which renders whatever the host exposes as transparent
 * iframes beside the pet.
 *
 * Idempotent. Re-run after every dsh-pet upgrade.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const pluginDir = dirname(here)
const rawArgs = process.argv.slice(2)
const uninstall = rawArgs.includes('--uninstall')
const args = rawArgs.filter((arg) => arg !== '--uninstall')
const defaultPetDir = process.env.DSH_PROFILE_DIR
  ? join(process.env.DSH_PROFILE_DIR, 'node_modules', 'dsh-pet')
  : null
const petDir = args[0] || defaultPetDir
if (!petDir) {
  console.error('usage: node tools/patch-dsh-pet-hud.mjs <path-to-dsh-pet> [--uninstall]')
  console.error('tip: set DSH_PROFILE_DIR, or pass the package directory explicitly')
  process.exit(2)
}
const backupRoot = args[1] || join(homedir(), '.dsh', 'dsh-model-lens-backups')
const helperDir = join(petDir, 'runtime', 'electron-helper')
const hostFile = join(petDir, 'lib', 'index.js')
const indexFile = join(helperDir, 'index.html')
const inputFile = join(helperDir, 'sprite', 'input.js')
const windowsFile = join(helperDir, 'main', 'windows.js')
const layerSource = join(pluginDir, 'pet', 'hud-layer.js')
const layerTarget = join(helperDir, 'hud-layer.js')
const actionScript = join(here, 'patch-dsh-pet-action.mjs')
const WINDOWS_ANCHOR =
  '      const next = decideWindowIgnore(bounds, point, ignoring, busy, nextMs, inputRegions.get(win.id), margin);'

const HOST_BLOCK = `\t/* dsh-pet-hud-api:start */
\tconst HUD_ANCHORS = ["left", "right"];
\tconst HUD_POINTER_EVENTS = ["none", "auto"];
\tfunction isLocalHudHost(hostname) {
\t\tconst host = String(hostname || "").toLowerCase();
\t\tif (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]") return true;
\t\tif (/^10\\./.test(host)) return true;
\t\tif (/^192\\.168\\./.test(host)) return true;
\t\tif (/^172\\.(1[6-9]|2\\d|3[01])\\./.test(host)) return true;
\t\treturn false;
\t}
\tfunction normalizeHudRegistration(raw) {
\t\tif (!raw || typeof raw !== "object") return { ok: false, message: "hud registration must be an object" };
\t\tconst id = typeof raw.id === "string" ? raw.id.trim() : "";
\t\tif (!/^[A-Za-z0-9._:-]{1,64}$/.test(id)) return { ok: false, message: "hud id must match [A-Za-z0-9._:-]{1,64}" };
\t\tlet url;
\t\ttry { url = new URL(String(raw.url || "")); } catch { return { ok: false, message: "hud url must be an absolute http(s) URL" }; }
\t\tif (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, message: "hud url must be http(s)" };
\t\tif (!isLocalHudHost(url.hostname)) return { ok: false, message: "hud url must target a loopback or private address" };
\t\tconst width = Math.round(Number(raw.width));
\t\tconst height = Math.round(Number(raw.height));
\t\tif (!Number.isFinite(width) || width < 160 || width > 480) return { ok: false, message: "hud width must be 160..480" };
\t\tif (!Number.isFinite(height) || height < 60 || height > 420) return { ok: false, message: "hud height must be 60..420" };
\t\tconst anchor = HUD_ANCHORS.includes(raw.anchor) ? raw.anchor : "left";
\t\tconst pointerEvents = HUD_POINTER_EVENTS.includes(raw.pointerEvents) ? raw.pointerEvents : "none";
\t\tconst offsetX = Number.isFinite(Number(raw.offsetX)) ? Math.max(-400, Math.min(400, Math.round(Number(raw.offsetX)))) : 0;
\t\tconst offsetY = Number.isFinite(Number(raw.offsetY)) ? Math.max(-400, Math.min(400, Math.round(Number(raw.offsetY)))) : 0;
\t\tconst title = typeof raw.title === "string" ? raw.title.slice(0, 80) : void 0;
\t\treturn { ok: true, value: { id, url: url.toString(), width, height, anchor, pointerEvents, offsetX, offsetY, ...(title ? { title } : {}) } };
\t}
\tconst hudRegistry = new Map();
\tconst listHuds = () => [...hudRegistry.values()];
\tconst syncHudSection = () => state.writeSection("hud", { items: listHuds() });
\tconst registerHud = (raw) => {
\t\tconst parsed = normalizeHudRegistration(raw);
\t\tif (!parsed.ok) throw new Error(parsed.message);
\t\tif (hudRegistry.has(parsed.value.id)) throw new Error("duplicate hud id: " + parsed.value.id);
\t\thudRegistry.set(parsed.value.id, parsed.value);
\t\tsyncHudSection();
\t\tlet disposed = false;
\t\treturn () => {
\t\t\tif (disposed) return;
\t\t\tdisposed = true;
\t\t\thudRegistry.delete(parsed.value.id);
\t\t\tsyncHudSection();
\t\t};
\t};
\t/* dsh-pet-hud-api:end */
`

function stamp() {
  return new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
}

function backup(file) {
  if (!existsSync(file)) return null
  const dir = join(backupRoot, 'dsh-pet-hud-' + stamp())
  mkdirSync(dir, { recursive: true })
  const target = join(dir, file.replace(/[\\/:]/g, '_'))
  copyFileSync(file, target)
  return dir
}

function removeMarkedBlock(text, name) {
  const start = `/* ${name}:start */`
  const end = `/* ${name}:end */`
  const startIndex = text.indexOf(start)
  if (startIndex < 0) return text
  const endIndex = text.indexOf(end, startIndex)
  if (endIndex < 0) return text
  const lineStart = text.lastIndexOf('\n', startIndex) + 1
  let after = endIndex + end.length
  if (text[after] === '\r') after += 1
  if (text[after] === '\n') after += 1
  return text.slice(0, lineStart) + text.slice(after)
}

if (!existsSync(hostFile)) throw new Error('dsh-pet host bundle not found: ' + hostFile)
if (!uninstall && !existsSync(layerSource)) throw new Error('hud-layer.js source not found: ' + layerSource)
if (!uninstall && !existsSync(actionScript)) throw new Error('action patch script not found: ' + actionScript)

const backupDir = backup(hostFile)
backup(indexFile)
backup(inputFile)
backup(windowsFile)
backup(layerTarget)

let host = readFileSync(hostFile, 'utf8')
const hostBefore = host
let hostChanged = false
if (uninstall) {
  if (host.includes('dsh-pet-hud-api:start')) {
    host = removeMarkedBlock(host, 'dsh-pet-hud-api')
    host = host.replace(
      /\t\t\tfocusSession: emptyLeaf\(\),\r?\n\t\t\thud: emptyLeaf\(\)\r?\n/,
      '\t\t\tfocusSession: emptyLeaf()\n',
    )
    host = host.replace(
      /\t\thud: \{\r?\n\t\t\tapiVersion: 1,\r?\n\t\t\tregister: registerHud,\r?\n\t\t\tlist: listHuds\r?\n\t\t\},\r?\n/,
      '',
    )
  }
} else if (!host.includes('dsh-pet-hud-api:start')) {
  const stateLine = '\tconst state = new PollStateStore();'
  if (!host.includes(stateLine)) throw new Error('anchor not found: state store')
  host = host.replace(stateLine, stateLine + '\n' + HOST_BLOCK)

  const sectionLine = '\t\t\tfocusSession: emptyLeaf()\n'
  if (!host.includes(sectionLine)) throw new Error('anchor not found: sections')
  host = host.replace(sectionLine, '\t\t\tfocusSession: emptyLeaf(),\n\t\t\thud: emptyLeaf()\n')

  const provideLine = '\tctx.provide("petApi7340", {\n'
  if (!host.includes(provideLine)) throw new Error('anchor not found: petApi7340')
  host = host.replace(
    provideLine,
    provideLine + '\t\thud: {\n\t\t\tapiVersion: 1,\n\t\t\tregister: registerHud,\n\t\t\tlist: listHuds\n\t\t},\n',
  )
}
if (host !== hostBefore) {
  writeFileSync(hostFile, host, 'utf8')
  hostChanged = true
}

let html = readFileSync(indexFile, 'utf8')
const before = html
html = html.replace(/\s*<!-- dsh-model-hud:start -->[\s\S]*?<!-- dsh-model-hud:end -->/g, '')
if (uninstall) {
  html = html.replace(/\s*<!-- dsh-pet-hud-layer:start -->[\s\S]*?<!-- dsh-pet-hud-layer:end -->/g, '')
} else if (!html.includes('dsh-pet-hud-layer:start')) {
  if (!html.includes('</body>')) throw new Error('index.html has no </body>')
  const block =
    '    <!-- dsh-pet-hud-layer:start -->\n' +
    '    <script src="./hud-layer.js"></script>\n' +
    '    <!-- dsh-pet-hud-layer:end -->\n  '
  html = html.replace('</body>', block + '</body>')
}
if (html !== before) writeFileSync(indexFile, html, 'utf8')

let input = readFileSync(inputFile, 'utf8')
const inputBefore = input
if (uninstall) {
  input = removeMarkedBlock(input, 'dsh-pet-hud-input')
} else if (!input.includes('dsh-pet-hud-input:start')) {
  const anchor = '    const input = { dragging: this.dragState.active, rects };'
  if (!input.includes(anchor)) throw new Error('anchor not found: syncInputRegions')
  const inputBlock =
    '    /* dsh-pet-hud-input:start */\n' +
    '    const hudRects = Array.isArray(window.__dshPetHudInputRects) ? window.__dshPetHudInputRects : [];\n' +
    '    for (const rect of hudRects) {\n' +
    '      if (!rect || !(rect.width > 0) || !(rect.height > 0)) continue;\n' +
    '      rects.push({ x: toScreen(rect.x), y: toScreen(rect.y), width: toScreen(rect.width), height: toScreen(rect.height) });\n' +
    '    }\n' +
    '    /* dsh-pet-hud-input:end */\n'
  input = input.replace(anchor, inputBlock + anchor)
}
if (input !== inputBefore) writeFileSync(inputFile, input, 'utf8')

let windows = readFileSync(windowsFile, 'utf8')
const windowsBefore = windows
if (uninstall) {
  windows = windows.replace(
    /\s*\/\* dsh-pet-hud-hotspot:start \*\/[\s\S]*?\/\* dsh-pet-hud-hotspot:end \*\//,
    '\n' + WINDOWS_ANCHOR,
  )
} else if (!windows.includes('dsh-pet-hud-hotspot:start')) {
  const anchor = WINDOWS_ANCHOR
  if (!windows.includes(anchor)) throw new Error('anchor not found: pointer fallback')
  const hotspotBlock =
    '      /* dsh-pet-hud-hotspot:start */\n' +
    '      const hudInput = inputRegions.get(win.id);\n' +
    '      const hudHit =\n' +
    '        !busy &&\n' +
    '        hudInput &&\n' +
    '        Array.isArray(hudInput.rects) &&\n' +
    '        hudInput.rects.some(\n' +
    '          (r) =>\n' +
    '            point.x >= bounds.x + r.x &&\n' +
    '            point.x < bounds.x + r.x + r.width &&\n' +
    '            point.y >= bounds.y + r.y &&\n' +
    '            point.y < bounds.y + r.y + r.height,\n' +
    '        );\n' +
    '      const next = hudHit ? false : decideWindowIgnore(bounds, point, ignoring, busy, nextMs, hudInput, margin);\n' +
    '      /* dsh-pet-hud-hotspot:end */'
  windows = windows.replace(anchor, hotspotBlock)
}
if (windows !== windowsBefore) writeFileSync(windowsFile, windows, 'utf8')

if (uninstall) {
  if (existsSync(layerTarget)) rmSync(layerTarget, { force: true })
} else {
  const oldHud = join(helperDir, 'hud.js')
  if (existsSync(oldHud)) {
    backup(oldHud)
    rmSync(oldHud, { force: true })
  }
  copyFileSync(layerSource, layerTarget)
}

// 小动作是附加项：dsh-pet 改了动作列表、或视频写不进去时，只记一行，不要
// 把已经装好的状态卡一起带死。
const actionArgs = [actionScript, petDir]
if (uninstall) actionArgs.push('--uninstall')
const actionResult = spawnSync(process.execPath, actionArgs, {
  timeout: 30_000,
  windowsHide: true,
  encoding: 'utf8',
})
const actionOk = actionResult.status === 0
if (!actionOk) {
  console.error(
    'action patch skipped: ' +
      String(actionResult.stderr || actionResult.error || 'unknown error').trim(),
  )
}

console.log('uninstalled=' + uninstall)
console.log('hostChanged=' + hostChanged)
console.log('helper=' + indexFile)
console.log('layer=' + layerTarget)
console.log('action=' + join(petDir, 'assets', 'webm', '戳戳小圆球.webm'))
console.log('backup=' + (backupDir || '(none)'))
