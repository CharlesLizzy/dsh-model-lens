import net from 'node:net'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { openSync, closeSync, existsSync, renameSync, readFileSync, readdirSync } from 'node:fs'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mergeEndpoints, normalizeEndpoint, KIND_LABEL, tagForType } from './lib/discover.js'
import { parseXinferenceMetrics, parseModelList } from './lib/prom.js'
import { LogTail } from './lib/logtail.js'
import { ResourceSampler } from './lib/resource.js'
import { scanLocalServices } from './lib/scan.js'
import { applyTemplate } from './lib/templates.js'
import { DEFAULT_PREFS, readPrefs, writePrefs } from './lib/prefs.js'

export const name = 'dsh-model-lens'
export const inject = ['webServer']

const here = dirname(fileURLToPath(import.meta.url))
const HUD_FILE = join(here, 'pet', 'hud.html')
const KNOWN_FILE = join(homedir(), '.dsh', 'dsh-model-lens-endpoints.json')
const SERVICE_FILE = join(homedir(), '.dsh', 'dsh-model-lens-services.json')
const LOCAL_FILE = join(homedir(), '.dsh', 'dsh-model-lens-local.json')
const LOG_DIR = join(homedir(), '.dsh', 'dsh-model-lens-logs')
const run = promisify(execFile)

const DEFAULTS = {
  pollMs: 2000,
  scan: true,
  scanPorts: null,
  endpoints: [],
  gpu: true,
}

const NAME_ALIAS = {
  'gpt-sovits': 'GPT-SoVITS',
}

function mergeConfig(config) {
  const cfg = { ...DEFAULTS, logs: { ...DEFAULTS.logs } }
  if (!config || typeof config !== 'object') return cfg
  for (const [key, value] of Object.entries(config)) {
    if (value !== undefined) cfg[key] = value
  }
  cfg.pollMs = Math.max(1000, Number(cfg.pollMs) || DEFAULTS.pollMs)
  return cfg
}

async function getJson(url, timeoutMs = 1200) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

async function getText(url, timeoutMs = 1600) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.text()
}

function tcpCheck(host, port, timeoutMs = 800) {
  return new Promise((resolve) => {
    let settled = false
    const socket = net.connect({ host, port })
    const finish = (ok) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

async function probeXinference(endpoint) {
  const result = { online: false, via: null, models: [], error: null }
  try {
    const models = parseXinferenceMetrics(await getText(endpoint.origin + '/metrics'))
    result.online = true
    result.via = 'metrics'
    result.models = models
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error)
  }
  if (!result.online || result.models.length === 0) {
    try {
      const payload = await getJson(endpoint.origin + '/v1/models')
      result.online = true
      result.via = result.via || 'models'
      if (result.models.length === 0) result.models = parseModelList(payload)
      result.error = null
    } catch (error) {
      if (!result.online) result.error = error instanceof Error ? error.message : String(error)
    }
  }
  return result
}

async function probeStt(endpoint) {
  try {
    const payload = await getJson(endpoint.origin + '/health')
    return {
      online: true,
      ready: payload?.ok !== false,
      model: typeof payload?.model === 'string' ? payload.model : null,
      error: null,
    }
  } catch (error) {
    return { online: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function probeTts(endpoint) {
  const online = await tcpCheck(endpoint.host, endpoint.port)
  if (!online) return { online: false, model: endpoint.model || null, error: 'TCP 未监听' }
  if (!endpoint.model) {
    try {
      const spec = await getJson(endpoint.origin + '/openapi.json', 900)
      const paths = spec?.paths && typeof spec.paths === 'object' ? Object.keys(spec.paths) : []
      if (paths.includes('/set_gpt_weights') || paths.includes('/set_sovits_weights')) {
        endpoint.model = 'GPT-SoVITS'
      } else if (typeof spec?.info?.title === 'string' && spec.info.title !== '' && !/^fastapi$/i.test(spec.info.title)) {
        endpoint.model = spec.info.title
      }
    } catch {}
  }
  return { online: true, model: endpoint.model || null, error: null }
}

async function probeOllama(endpoint) {
  try {
    const payload = await getJson(endpoint.origin + '/api/ps')
    const models = Array.isArray(payload?.models)
      ? payload.models.map((model) => ({
          name: String(model.name || model.model || ''),
          vramBytes: Number(model.size_vram) || 0,
          expiresAt: model.expires_at || null,
        }))
      : []
    return { online: true, models: models.filter((model) => model.name), error: null }
  } catch (error) {
    return { online: false, models: [], error: error instanceof Error ? error.message : String(error) }
  }
}

async function probeOpenAI(endpoint) {
  try {
    const payload = await getJson(endpoint.base + '/models')
    return { online: true, models: parseModelList(payload), error: null }
  } catch (error) {
    return { online: false, models: [], error: error instanceof Error ? error.message : String(error) }
  }
}

function probe(endpoint) {
  if (endpoint.kind === 'embedding' || endpoint.kind === 'rerank' || endpoint.kind === 'xinference') {
    return probeXinference(endpoint)
  }
  if (endpoint.kind === 'stt') return probeStt(endpoint)
  if (endpoint.kind === 'tts') return probeTts(endpoint)
  if (endpoint.kind === 'ollama') return probeOllama(endpoint)
  return probeOpenAI(endpoint)
}

function displayName(model, kind) {
  const raw = String(model || '').trim()
  if (!raw) return KIND_LABEL[kind] || kind
  return NAME_ALIAS[raw.toLowerCase()] || raw
}

function tagOf(endpoint, type) {
  const templateTag = endpoint.tagFromTemplate || (endpoint.template && endpoint.tag === '模型')
  if (endpoint.tag && !templateTag) return endpoint.tag
  if (type && type !== 'other') {
    const label = KIND_LABEL[type] || tagForType(type)
    if (label) return label
  }
  return endpoint.tag || KIND_LABEL[endpoint.kind] || endpoint.kind
}

function deltaRate(previous, current, dtMs) {
  if (!previous || dtMs <= 0 || current < previous.requests) return 0
  return (current - previous.requests) / (dtMs / 60_000)
}

function deltaLatency(previous, current) {
  if (!previous) return null
  const count = current.durationCount - previous.durationCount
  const sum = current.durationSum - previous.durationSum
  if (count <= 0 || sum < 0) return null
  return Math.round((sum / count) * 1000)
}

function emptySnapshot() {
  return {
    ok: true,
    updatedAt: 0,
    summary: { total: 0, active: 0, idle: 0, offline: 0, unloaded: 0, loading: 0 },
    models: [],
    endpoints: [],
    system: { cpuPct: 0, memUsedMb: 0, memTotalMb: 0, gpu: [], gpuBackend: null, dshRssMb: 0 },
  }
}

function optionalService(ctx, serviceName) {
  const get = ctx.get
  if (typeof get !== 'function') return undefined
  try {
    return get.call(ctx, serviceName, false)
  } catch {
    return undefined
  }
}

function migrateLegacyFiles() {
  const dir = join(homedir(), '.dsh')
  const pairs = [
    ['dsh-pet-lens.json', 'dsh-model-lens.json'],
    ['dsh-pet-lens-endpoints.json', 'dsh-model-lens-endpoints.json'],
    ['dsh-pet-lens-services.json', 'dsh-model-lens-services.json'],
    ['dsh-pet-lens-local.json', 'dsh-model-lens-local.json'],
    ['dsh-pet-lens-logs', 'dsh-model-lens-logs'],
  ]
  for (const [oldName, newName] of pairs) {
    const oldPath = join(dir, oldName)
    const newPath = join(dir, newName)
    if (!existsSync(oldPath) || existsSync(newPath)) continue
    try {
      renameSync(oldPath, newPath)
    } catch {}
  }
}

export function apply(ctx, config) {
  migrateLegacyFiles()
  const cfg = mergeConfig(config)
  const resources = new ResourceSampler({ gpu: cfg.gpu })
  const tracker = new Map()
  const tails = new Map()
  let prefs = { ...DEFAULT_PREFS }
  let snapshot = emptySnapshot()
  let ticking = false
  let scanAt = 0
  let scanned = []
  let knownEndpoints = []
  let localEndpoints = []
  let localConfig = { endpoints: [] }
  let hudDispose = null
  let hudSignature = ''
  let hudSuppressed = false
  let hudVersion = 0
  const owned = new Map()
  const pending = new Map()
  const failures = new Map()
  const controlToken = randomBytes(16).toString('hex')
  let lastEndpoints = []

  function findPetDir() {
    const candidates = []
    if (process.env.DSH_PROFILE_DIR) candidates.push(join(process.env.DSH_PROFILE_DIR, 'node_modules', 'dsh-pet'))
    const home = process.env.DSH_HOME || join(homedir(), '.dsh')
    if (process.env.DSH_PROFILE) candidates.push(join(home, 'profiles', process.env.DSH_PROFILE, 'node_modules', 'dsh-pet'))
    try {
      for (const name of readdirSync(join(home, 'profiles'))) {
        candidates.push(join(home, 'profiles', name, 'node_modules', 'dsh-pet'))
      }
    } catch {}
    return candidates.find((dir) => existsSync(join(dir, 'package.json'))) || null
  }

  function petPatchStatus() {
    const petDir = findPetDir()
    if (!petDir) {
      return { installed: false, active: false, patched: false, apiReady: false, petDir: null }
    }
    const helper = join(petDir, 'runtime', 'electron-helper')
    const has = (file, marker) => {
      try {
        return readFileSync(file, 'utf8').includes(marker)
      } catch {
        return false
      }
    }
    const host = has(join(petDir, 'lib', 'index.js'), 'dsh-pet-hud-api:start')
    const layer = existsSync(join(helper, 'hud-layer.js'))
    const index = has(join(helper, 'index.html'), 'hud-layer.js')
    const input = has(join(helper, 'sprite', 'input.js'), 'dsh-pet-hud-input:start')
    const windows = has(join(helper, 'main', 'windows.js'), 'dsh-pet-hud-hotspot:start')
    const actionAsset = existsSync(join(petDir, 'assets', 'webm', '戳戳小圆球.webm'))
    const actionConfig = has(join(petDir, 'assets', 'config.jsonc'), '"戳戳小圆球"')
    const actionInstalled = actionAsset && actionConfig
    const hud = optionalService(ctx, 'petApi7340')?.hud
    const apiReady = Boolean(hud && hud.apiVersion >= 1 && typeof hud.register === 'function')
    const patched = host && layer && index && input && windows && actionInstalled
    return { installed: true, active: patched && apiReady, patched, apiReady, actionInstalled, petDir }
  }

  function authorizeControl(req, options = {}) {
    const token = req.headers['x-dsh-model-lens-token']
    if (token !== undefined && token !== controlToken) return 'invalid control token'
    const trustedOrigin = !req.headers.origin || req.headers.origin === ctx.webServer.getOrigin()
    if (token === undefined && !trustedOrigin) return 'untrusted origin'
    if (options.requireServiceControl && token === controlToken && !prefs.allowServiceControl) {
      return 'service control is disabled'
    }
    if (options.requireExternalStop && !prefs.allowExternalStop) return 'external stop is disabled'
    return null
  }

  function syncTails(endpoints) {
    const seen = new Set()
    for (const endpoint of endpoints) {
      if (!endpoint.log) continue
      seen.add(endpoint.id)
      if (tails.has(endpoint.id)) continue
      const fallback = endpoint.kind === 'stt' ? /POST \/v1\/audio\/transcriptions/ : endpoint.kind === 'tts' ? /\/tts\?/ : null
      let pattern = fallback
      if (endpoint.logPattern) {
        try {
          pattern = new RegExp(endpoint.logPattern)
        } catch {
          pattern = fallback
        }
      }
      if (pattern) tails.set(endpoint.id, new LogTail(endpoint.log, [pattern]))
    }
    for (const id of [...tails.keys()]) {
      if (!seen.has(id)) tails.delete(id)
    }
  }

  function statsFor(endpoint, now) {
    const tail = tails.get(endpoint.id)
    return tail ? tail.stats(now) : { count: 0, last: null, active: false }
  }

  function persistKnown() {
    mkdir(dirname(KNOWN_FILE), { recursive: true })
      .then(() => writeFile(KNOWN_FILE, JSON.stringify(knownEndpoints, null, 2) + '\n', 'utf8'))
      .catch(() => {})
  }

  function rememberEndpoints(list) {
    const map = new Map(knownEndpoints.map((endpoint) => [endpoint.id, endpoint]))
    for (const endpoint of list) map.set(endpoint.id, endpoint)
    knownEndpoints = [...map.values()]
    persistKnown()
  }

  function updateKnownModels(endpoint, result) {
    if (!result?.online) return
    const type = endpoint.kind
    if ((type === 'stt' || type === 'tts') && typeof result.model === 'string' && result.model !== '') {
      if (endpoint.model === result.model) return
      endpoint.model = result.model
      const existing = knownEndpoints.find((entry) => entry.id === endpoint.id)
      if (existing) existing.model = result.model
      else knownEndpoints.push({ ...endpoint, source: 'remembered' })
      persistKnown()
      return
    }
    if (!['xinference', 'embedding', 'rerank', 'openai', 'ollama'].includes(type)) return
    let list = (Array.isArray(result.models) ? result.models : [])
      .filter((model) => model && typeof model.name === 'string')
      .map((model) => ({ name: model.name, type: model.type || type }))
    if (list.length === 0 && endpoint.model) list = [{ name: endpoint.model, type }]
    if (list.length === 0) return
    if (JSON.stringify(endpoint.knownModels || []) === JSON.stringify(list)) return
    endpoint.knownModels = list
    const existing = knownEndpoints.find((entry) => entry.id === endpoint.id)
    if (existing) existing.knownModels = list
    else knownEndpoints.push({ ...endpoint, source: 'remembered' })
    persistKnown()
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

  function pidAlive(pid) {
    if (!pid) return false
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }

  function saveServices() {
    mkdir(dirname(SERVICE_FILE), { recursive: true })
      .then(() => writeFile(SERVICE_FILE, JSON.stringify([...owned.values()], null, 2) + '\n', 'utf8'))
      .catch(() => {})
  }

  async function findPidOnPort(port) {
    if (!port) return null
    try {
      if (process.platform === 'win32') {
        const { stdout } = await run('netstat', ['-ano', '-p', 'tcp'], { windowsHide: true, timeout: 3000 })
        for (const line of stdout.split('\n')) {
          const parts = line.trim().split(/\s+/)
          if (parts[0] !== 'TCP' || !parts[1]?.endsWith(':' + port) || parts[3] !== 'LISTENING') continue
          const pid = Number(parts[4])
          if (pid > 0) return pid
        }
      } else if (process.platform === 'darwin') {
        const { stdout } = await run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { timeout: 3000 })
        const pid = Number(stdout.trim().split('\n')[0])
        if (pid > 0) return pid
      } else {
        const { stdout } = await run('ss', ['-ltnp'], { timeout: 3000 })
        for (const line of stdout.split('\n')) {
          if (!line.includes(`:${port}`)) continue
          const match = line.match(/pid=(\d+)/)
          if (match) return Number(match[1])
        }
      }
    } catch {}
    return null
  }

  async function killTree(pid, mode = 'tree') {
    if (!pid) return
    if (process.platform === 'win32') {
      await run('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 10_000 }).catch(() => {})
      return
    }
    const signal = (name) => {
      try {
        if (mode === 'tree') process.kill(-pid, name)
        else process.kill(pid, name)
      } catch {
        try {
          process.kill(pid, name)
        } catch {}
      }
    }
    signal('SIGTERM')
    await sleep(600)
    if (pidAlive(pid)) signal('SIGKILL')
  }

  function logPathFor(id) {
    return join(LOG_DIR, String(id).replace(/[^A-Za-z0-9._-]/g, '_') + '.log')
  }

  async function startService(endpoint) {
    if (!endpoint.start) throw new Error('no start descriptor')
    if (pending.has(endpoint.id) || owned.has(endpoint.id)) throw new Error('service is already managed')
    await mkdir(LOG_DIR, { recursive: true })
    const fd = openSync(logPathFor(endpoint.id), 'a')
    let child
    try {
      child = spawn(endpoint.start.command, endpoint.start.args, {
        cwd: endpoint.start.cwd || undefined,
        env: endpoint.start.env ? { ...process.env, ...endpoint.start.env } : process.env,
        detached: false,
        windowsHide: true,
        stdio: ['ignore', fd, fd],
        shell: endpoint.start.shell,
      })
      child.unref()
    } finally {
      closeSync(fd)
    }
    pending.set(endpoint.id, {
      action: 'starting',
      pid: child.pid,
      spawnedPid: child.pid,
      deadline: Date.now() + endpoint.start.timeoutMs,
      error: null,
    })
    failures.delete(endpoint.id)
    return child.pid
  }

  async function runStopCommand(endpoint) {
    const stop = endpoint.stop
    if (!stop?.command) return false
    try {
      await run(stop.command, stop.args || [], {
        cwd: stop.cwd || undefined,
        env: stop.env ? { ...process.env, ...stop.env } : process.env,
        timeout: stop.timeoutMs || 15_000,
        windowsHide: true,
        shell: stop.shell === true,
        maxBuffer: 1024 * 1024,
      })
      return true
    } catch (error) {
      throw new Error('停止命令失败：' + (error instanceof Error ? error.message : String(error)))
    }
  }

  async function stopService(endpoint) {
    const record = owned.get(endpoint.id)
    if (!record) throw new Error('service is not owned by dsh-model-lens')
    pending.set(endpoint.id, {
      action: 'stopping',
      pid: record.pid,
      spawnedPid: record.spawnedPid,
      deadline: Date.now() + (endpoint.stop?.timeoutMs || 15_000),
      error: null,
    })
    try {
      if (endpoint.stop?.command) await runStopCommand(endpoint)
      else await killTree(record.pid, endpoint.stop?.mode || 'tree')
    } catch (error) {
      pending.delete(endpoint.id)
      failures.set(endpoint.id, error instanceof Error ? error.message : String(error))
      throw error
    }
    return record.pid
  }

  async function stopExternal(endpoint) {
    if (!prefs.allowExternalStop) throw new Error('external stop is disabled')
    if (owned.has(endpoint.id)) throw new Error('service is managed by dsh-model-lens')
    if (endpoint.stop?.command) {
      await runStopCommand(endpoint)
      return { mode: 'command' }
    }
    const pid = await findPidOnPort(endpoint.port)
    if (!pid) throw new Error('未找到监听该端口的进程')
    await killTree(pid, endpoint.stop?.mode || 'tree')
    return { mode: 'takeover', pid }
  }

  function controlFor(endpoint, online) {
    if (!endpoint.start) {
      return {
        id: endpoint.id,
        enabled: prefs.allowServiceControl,
        pending: null,
        owned: false,
        canStart: false,
        canStop: false,
        canStopExternal: online && !owned.has(endpoint.id) && prefs.allowExternalStop,
        stopMode: online && !owned.has(endpoint.id) && prefs.allowExternalStop ? (endpoint.stop?.command ? 'command' : 'takeover') : null,
        canConfigure: true,
        error: null,
      }
    }
    const active = pending.get(endpoint.id)
    if (active) {
      return {
        id: endpoint.id,
        enabled: prefs.allowServiceControl,
        pending: active.action,
        owned: owned.has(endpoint.id),
        canStart: false,
        canStop: false,
        canStopExternal: false,
        stopMode: null,
        error: active.error || null,
      }
    }
    const record = owned.get(endpoint.id)
    return {
      id: endpoint.id,
      enabled: prefs.allowServiceControl,
      pending: null,
      owned: Boolean(record),
      canStart: !online && !record,
      canStop: Boolean(record) && online,
      canStopExternal: online && !record && prefs.allowExternalStop,
      stopMode: online && !record && prefs.allowExternalStop ? (endpoint.stop?.command ? 'command' : 'takeover') : null,
      error: failures.get(endpoint.id) || record?.error || null,
    }
  }

  function monitorRows() {
    return lastEndpoints.map((endpoint) => {
      const state = snapshot.endpoints.find((entry) => entry.id === endpoint.id)
      const online = Boolean(state?.online)
      const control = controlFor(endpoint, online)
      const row = snapshot.models.find((model) => model.key.startsWith(endpoint.id + ':'))
      const local = findLocal(endpoint.id)
      return {
        id: endpoint.id,
        kind: endpoint.kind,
        name: endpoint.label || endpoint.model || KIND_LABEL[endpoint.kind] || endpoint.kind,
        base: endpoint.base,
        port: endpoint.port,
        tag: endpoint.tag || KIND_LABEL[endpoint.kind] || endpoint.kind,
        template: endpoint.template || null,
        manual: Boolean(local?.manual),
        start: Boolean(endpoint.start),
        startConfig: endpoint.start || null,
        status: row?.status || (online ? 'idle' : 'offline'),
        owned: Boolean(control?.owned),
        pending: control?.pending || null,
        canStart: Boolean(control?.canStart),
        canStop: Boolean(control?.canStop),
        canStopExternal: Boolean(control?.canStopExternal),
        stopMode: control?.stopMode || null,
        canConfigure: Boolean(control?.canConfigure),
        error: control?.error || null,
      }
    })
  }

  async function advanceControl(now, endpoints, probes) {
    for (const [id, state] of [...pending]) {
      const index = endpoints.findIndex((endpoint) => endpoint.id === id)
      const endpoint = index >= 0 ? endpoints[index] : null
      const online = index >= 0 && Boolean(probes[index]?.online)
      if (state.action === 'starting') {
        if (online && endpoint) {
          const portPid = await findPidOnPort(endpoint.port)
          owned.set(id, {
            id,
            pid: portPid || state.spawnedPid,
            spawnedPid: state.spawnedPid,
            startedAt: Date.now(),
            command: endpoint.start.command,
          })
          pending.delete(id)
          failures.delete(id)
          saveServices()
        } else if (now > state.deadline) {
          await killTree(state.spawnedPid, 'tree')
          pending.delete(id)
          failures.set(id, '启动超时，请检查启动命令与日志')
        }
      } else if (state.action === 'stopping') {
        if (!pidAlive(state.pid)) {
          owned.delete(id)
          pending.delete(id)
          failures.delete(id)
          saveServices()
        } else if (now > state.deadline) {
          pending.delete(id)
          failures.set(id, '停止超时，进程可能仍在运行')
        }
      }
    }
    for (const [id, record] of [...owned]) {
      if (!pidAlive(record.pid)) {
        owned.delete(id)
        saveServices()
      }
    }
  }

  readFile(KNOWN_FILE, 'utf8')
    .then((text) => {
      const list = JSON.parse(text)
      knownEndpoints = (Array.isArray(list) ? list : [])
        .map((entry) => normalizeEndpoint({ ...entry, source: 'remembered' }, { includeRemote: true }))
        .filter(Boolean)
    })
    .catch(() => {})

  readFile(SERVICE_FILE, 'utf8')
    .then((text) => {
      const list = JSON.parse(text)
      for (const record of Array.isArray(list) ? list : []) {
        if (record && typeof record.id === 'string' && pidAlive(record.pid)) owned.set(record.id, record)
      }
    })
    .catch(() => {})

  function reloadLocal() {
    localEndpoints = (Array.isArray(localConfig.endpoints) ? localConfig.endpoints : [])
      .map((entry) => normalizeEndpoint({ ...entry, source: 'local' }, { includeRemote: true }))
      .filter(Boolean)
  }

  function persistLocal() {
    mkdir(dirname(LOCAL_FILE), { recursive: true })
      .then(() => writeFile(LOCAL_FILE, JSON.stringify(localConfig, null, 2) + '\n', 'utf8'))
      .catch(() => {})
  }

  function findLocal(id) {
    return localConfig.endpoints.find((entry) => entry.id === id) || null
  }

  function upsertLocal(entry) {
    const index = localConfig.endpoints.findIndex((item) => item.id === entry.id)
    if (index >= 0) localConfig.endpoints[index] = { ...localConfig.endpoints[index], ...entry }
    else localConfig.endpoints.push(entry)
    reloadLocal()
    persistLocal()
  }

  readFile(LOCAL_FILE, 'utf8')
    .then((text) => {
      const data = JSON.parse(text)
      localConfig = { endpoints: Array.isArray(data?.endpoints) ? data.endpoints : [] }
      reloadLocal()
    })
    .catch(() => {})

  function syncHud() {
    if (hudSuppressed) {
      if (hudDispose) {
        try {
          hudDispose()
        } catch {}
        hudDispose = null
        hudSignature = ''
      }
      return
    }
    const api = optionalService(ctx, 'petApi7340')?.hud
    if (!api || api.apiVersion < 1 || typeof api.register !== 'function') {
      if (hudDispose) {
        try {
          hudDispose()
        } catch {}
        hudDispose = null
        hudSignature = ''
      }
      return
    }
    const signature = JSON.stringify(prefs)
    if (hudDispose && signature === hudSignature) return
    if (hudDispose) {
      try {
        hudDispose()
      } catch {}
      hudDispose = null
    }
    try {
      hudDispose = api.register({
        id: 'dsh-model-lens',
        url:
          ctx.webServer.getOrigin() +
          '/dsh-model-lens/hud?theme=' + encodeURIComponent(prefs.theme) +
          '&fs=' + encodeURIComponent(String(prefs.fontScale)) +
          '&rows=' + prefs.maxRows +
          '&anchor=' + prefs.anchor +
          '&control=' + (prefs.allowServiceControl ? '1' : '0') +
          '&token=' + controlToken +
          '&v=' + (hudVersion += 1),
        width: prefs.width,
        height: 200,
        anchor: prefs.anchor,
        offsetX: prefs.offsetX,
        offsetY: prefs.offsetY,
        pointerEvents: prefs.allowServiceControl ? 'auto' : 'none',
        title: '本地模型监控',
      })
      hudSignature = signature
    } catch (error) {
      ctx.logger?.warn?.('dsh-model-lens: hud registration failed: ' + String(error?.message ?? error))
    }
  }

  async function tick() {
    if (ticking) return
    ticking = true
    const now = Date.now()
    try {
      const configured = (Array.isArray(cfg.endpoints) ? cfg.endpoints : [])
        .map((entry) => normalizeEndpoint({ ...entry, source: 'config' }, { includeRemote: true }))
        .filter(Boolean)
      const primary = mergeEndpoints(configured, localEndpoints)

      if (cfg.scan && (now - scanAt > 60_000 || scanned.length === 0)) {
        scanAt = now
        try {
          scanned = (await scanLocalServices(cfg.scanPorts || undefined))
            .map((entry) => normalizeEndpoint(entry, { includeRemote: true }))
            .filter(Boolean)
        } catch {
          scanned = []
        }
      }
      if (scanned.length > 0) rememberEndpoints(scanned)
      const covered = new Set(primary.map((endpoint) => endpoint.origin))
      const seenOrigins = new Set([...primary, ...scanned].map((endpoint) => endpoint.origin))
      const remembered = knownEndpoints.filter((endpoint) => !seenOrigins.has(endpoint.origin))
      const endpoints = mergeEndpoints(
        primary,
        scanned.filter((endpoint) => !covered.has(endpoint.origin)),
        remembered,
      )
      for (const endpoint of endpoints) applyTemplate(endpoint)
      lastEndpoints = endpoints
      syncTails(endpoints)

      const probes = await Promise.all(
        endpoints.map((endpoint) =>
          probe(endpoint).catch((error) => ({
            online: false,
            error: error instanceof Error ? error.message : String(error),
          })),
        ),
      )
      await advanceControl(now, endpoints, probes)
      for (let index = 0; index < endpoints.length; index += 1) {
        updateKnownModels(endpoints[index], probes[index])
      }
      await Promise.all([...tails.values()].map((tail) => tail.poll(now)))
      void resources.refreshGpu(now)

      const models = []
      const endpointState = []

      for (let index = 0; index < endpoints.length; index += 1) {
        const endpoint = endpoints[index]
        const result = probes[index]
        endpointState.push({
          id: endpoint.id,
          kind: endpoint.kind,
          base: endpoint.base,
          online: Boolean(result?.online),
          error: result?.error ?? null,
        })

        if (endpoint.kind === 'embedding' || endpoint.kind === 'rerank' || endpoint.kind === 'xinference') {
          const filterType = endpoint.kind === 'xinference' ? null : endpoint.kind
          if (!result?.online) {
            const known = Array.isArray(endpoint.knownModels) ? endpoint.knownModels : []
            let added = 0
            for (const model of known) {
              if (filterType && model.type !== filterType) continue
              models.push({
                key: `${endpoint.id}:${model.name}:offline`,
                name: displayName(model.name, model.type),
                kind: model.type,
                tag: tagOf(endpoint, model.type),
                status: 'offline',
                reqPerMin: 0,
                latencyMs: null,
                inflight: 0,
                vramMb: 0,
                error: result?.error ?? null,
              })
              added += 1
            }
            if (added > 0) continue
            models.push({
              key: `${endpoint.id}:offline`,
              name: endpoint.kind === 'xinference' && !endpoint.model
                ? endpoint.label || `Xinference:${endpoint.port}`
                : displayName(endpoint.model, endpoint.kind),
              kind: endpoint.kind,
              tag: tagOf(endpoint),
              status: 'offline',
              reqPerMin: 0,
              latencyMs: null,
              inflight: 0,
              vramMb: 0,
              error: result?.error ?? null,
            })
            continue
          }
          let list = Array.isArray(result.models) ? result.models : []
          if (filterType) {
            const typed = list.filter((model) => model.type === filterType)
            if (typed.length > 0) list = typed
          }
          const seen = new Set()
          const rowsBefore = models.length
          for (const model of list) {
            const key = `${endpoint.id}:${model.name}`
            const previous = tracker.get(key)
            const dt = previous ? now - previous.at : 0
            const rate = deltaRate(previous, model.requests, dt)
            const latency = deltaLatency(previous, model)
            tracker.set(key, {
              requests: model.requests,
              durationSum: model.durationSum,
              durationCount: model.durationCount,
              at: now,
            })
            seen.add(model.name)
            const active = model.inflight > 0.01 || rate > 0.5
            models.push({
              key,
              name: displayName(model.name, model.type),
              kind: model.type,
              tag: tagOf(endpoint, model.type),
              status: active ? 'active' : 'idle',
              reqPerMin: Math.round(rate),
              latencyMs: latency,
              inflight: Math.round(model.inflight),
              vramMb: Math.round((model.vramBytes || 0) / 1048576),
              error: null,
            })
          }
          if (endpoint.model && filterType && !seen.has(endpoint.model)) {
            models.push({
              key: `${endpoint.id}:${endpoint.model}:unloaded`,
              name: endpoint.kind === 'xinference' && !endpoint.model
                ? endpoint.label || `Xinference:${endpoint.port}`
                : displayName(endpoint.model, endpoint.kind),
              kind: endpoint.kind,
              tag: tagOf(endpoint),
              status: 'unloaded',
              reqPerMin: 0,
              latencyMs: null,
              inflight: 0,
              vramMb: 0,
              error: null,
            })
          }
          if (models.length === rowsBefore && endpoint.kind === 'xinference') {
            models.push({
              key: `${endpoint.id}:unloaded`,
              name: 'Xinference',
              kind: 'xinference',
              tag: tagOf(endpoint, 'xinference'),
              status: 'unloaded',
              reqPerMin: 0,
              latencyMs: null,
              inflight: 0,
              vramMb: 0,
              error: null,
            })
          }
          continue
        }

        if (endpoint.kind === 'stt') {
          const stats = statsFor(endpoint, now)
          const status = !result?.online
            ? 'offline'
            : result.ready === false
              ? 'loading'
              : stats.active
                ? 'active'
                : 'idle'
          models.push({
            key: `${endpoint.id}:stt`,
            name: displayName(result?.model || endpoint.model, 'stt'),
            kind: 'stt',
            tag: tagOf(endpoint, 'stt'),
            status,
            reqPerMin: stats.count,
            latencyMs: null,
            inflight: 0,
            vramMb: 0,
            error: result?.error ?? null,
          })
          continue
        }

        if (endpoint.kind === 'tts') {
          const stats = statsFor(endpoint, now)
          models.push({
            key: `${endpoint.id}:tts`,
            name: displayName(result?.model || endpoint.model || endpoint.label, 'tts'),
            kind: 'tts',
            tag: tagOf(endpoint, 'tts'),
            status: !result?.online ? 'offline' : stats.active ? 'active' : 'idle',
            reqPerMin: stats.count,
            latencyMs: null,
            inflight: 0,
            vramMb: 0,
            error: result?.error ?? null,
          })
          continue
        }

        if (endpoint.kind === 'ollama') {
          if (!result?.online) {
            models.push({
              key: `${endpoint.id}:offline`,
              name: 'Ollama',
              kind: 'ollama',
              tag: tagOf(endpoint, 'ollama'),
              status: 'offline',
              reqPerMin: 0,
              latencyMs: null,
              inflight: 0,
              vramMb: 0,
              error: result?.error ?? null,
            })
            continue
          }
          const list = Array.isArray(result.models) ? result.models : []
          if (list.length === 0) {
            models.push({
              key: `${endpoint.id}:idle`,
              name: 'Ollama',
              kind: 'ollama',
              tag: tagOf(endpoint, 'ollama'),
              status: 'idle',
              reqPerMin: 0,
              latencyMs: null,
              inflight: 0,
              vramMb: 0,
              error: null,
            })
          }
          for (const model of list) {
            models.push({
              key: `${endpoint.id}:${model.name}`,
              name: model.name,
              kind: 'ollama',
              tag: tagOf(endpoint, 'ollama'),
              status: 'idle',
              reqPerMin: 0,
              latencyMs: null,
              inflight: 0,
              vramMb: Math.round((model.vramBytes || 0) / 1048576),
              error: null,
            })
          }
          continue
        }

        if (!result?.online) {
          models.push({
            key: `${endpoint.id}:offline`,
            name: displayName(endpoint.model, endpoint.kind),
            kind: endpoint.kind,
            tag: tagOf(endpoint),
            status: 'offline',
            reqPerMin: 0,
            latencyMs: null,
            inflight: 0,
            vramMb: 0,
            error: result?.error ?? null,
          })
          continue
        }
        const list = Array.isArray(result.models) && result.models.length > 0
          ? result.models
          : [{ name: endpoint.model || endpoint.label || endpoint.kind }]
        for (const model of list) {
          models.push({
            key: `${endpoint.id}:${model.name}`,
            name: displayName(model.name, model.type || endpoint.kind),
            kind: model.type || endpoint.kind,
            tag: tagOf(endpoint, model.type),
            status: 'idle',
            reqPerMin: 0,
            latencyMs: null,
            inflight: 0,
            vramMb: 0,
            error: null,
          })
        }
      }

      for (const endpoint of endpoints) {
        const row = models.find((model) => model.key.startsWith(endpoint.id + ':'))
        if (!row) continue
        const index = endpoints.indexOf(endpoint)
        const control = controlFor(endpoint, Boolean(probes[index]?.online))
        if (control) {
          row.primary = true
          row.control = control
        }
      }

      const summary = { total: models.length, active: 0, idle: 0, offline: 0, unloaded: 0, loading: 0 }
      for (const model of models) {
        if (summary[model.status] !== undefined) summary[model.status] += 1
      }
      snapshot = {
        ok: true,
        updatedAt: now,
        summary,
        models,
        endpoints: endpointState,
        system: resources.sample(),
      }
    } catch (error) {
      snapshot = {
        ...snapshot,
        ok: false,
        updatedAt: now,
        error: error instanceof Error ? error.message : String(error),
      }
    } finally {
      ticking = false
    }
  }

  async function hudDocument() {
    return readFile(HUD_FILE, 'utf8')
  }

  readPrefs()
    .then((loaded) => {
      prefs = loaded
      syncHud()
    })
    .catch(() => {})

  ctx.effect(() => {
    let stopped = false
    const run = () => {
      if (!stopped) void tick()
    }
    run()
    const timer = setInterval(run, cfg.pollMs)
    timer.unref?.()
    return () => {
      stopped = true
      clearInterval(timer)
    }
  })

  ctx.effect(() => {
    const timer = setInterval(syncHud, 5000)
    timer.unref?.()
    syncHud()
    return () => {
      clearInterval(timer)
      if (hudDispose) {
        try {
          hudDispose()
        } catch {}
        hudDispose = null
      }
    }
  })

  ctx.effect(() => {
    // 卡片和设置页都从本服务的同源地址加载，所以这里不发任何 CORS 头。
    // 之前这里是 access-control-allow-origin: '*',任何网页都能读 /api/monitor、
    // 改端点配置和启动命令。
    const cors = {}
    const sendJson = (res, status, payload) => {
      res.writeHead(status, {
        ...cors,
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      })
      res.end(JSON.stringify(payload))
    }
    const readBody = async (req) => {
      const chunks = []
      let size = 0
      for await (const chunk of req) {
        size += chunk.length
        if (size > 16 * 1024) throw new Error('body too large')
        chunks.push(chunk)
      }
      return chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
    }
    const handler = async (req, res) => {
      if (req.method === 'OPTIONS') {
        res.writeHead(204)
        res.end()
        return
      }
      const path = String(req.url ?? '').split('?')[0].replace(/\/+$/, '')
      if (path === '/dsh-model-lens/api/snapshot' || path === '/dsh-model-lens/api') {
        sendJson(res, 200, snapshot)
        return
      }
      if (path === '/dsh-model-lens/api/prefs') {
        if (req.method === 'GET') {
          sendJson(res, 200, { ok: true, prefs })
          return
        }
        if (req.method === 'POST') {
          const authError = authorizeControl(req)
          if (authError) {
            sendJson(res, 403, { ok: false, error: authError })
            return
          }
          try {
            const body = await readBody(req)
            prefs = await writePrefs(body)
            syncHud()
            sendJson(res, 200, { ok: true, prefs })
          } catch (error) {
            sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
          }
          return
        }
      }
      if (path === '/dsh-model-lens/hud') {
        try {
          const html = await hudDocument()
          res.writeHead(200, {
            ...cors,
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store',
          })
          res.end(html)
        } catch (error) {
          sendJson(res, 500, { ok: false, error: String(error) })
        }
        return
      }
      if (path === '/dsh-model-lens/health') {
        sendJson(res, 200, { ok: true, updatedAt: snapshot.updatedAt, models: snapshot.models.length })
        return
      }
      if (path === '/dsh-model-lens/api/pet-patch' && req.method === 'GET') {
        const { petDir, ...status } = petPatchStatus()
        void petDir
        sendJson(res, 200, { ok: true, status })
        return
      }      if (path === '/dsh-model-lens/api/pet-patch' && req.method === 'POST') {
        const authError = authorizeControl(req)
        if (authError) {
          sendJson(res, 403, { ok: false, error: authError })
          return
        }
        const status = petPatchStatus()
        if (!status.installed) {
          sendJson(res, 409, { ok: false, error: 'dsh-pet is not installed' })
          return
        }
        try {
          const body = await readBody(req)
          const action = body.action === 'uninstall' ? 'uninstall' : 'install'
          const args = [join(here, 'tools', 'patch-dsh-pet-hud.mjs'), status.petDir]
          if (action === 'uninstall') args.push('--uninstall')
          await run(process.execPath, args, {
            timeout: 30_000,
            windowsHide: true,
            maxBuffer: 1024 * 1024,
          })
          if (action === 'uninstall') {
            hudSuppressed = true
            if (hudDispose) {
              try {
                hudDispose()
              } catch {}
              hudDispose = null
              hudSignature = ''
            }
          } else {
            hudSuppressed = false
            syncHud()
          }
          sendJson(res, 200, { ok: true, action, status: petPatchStatus() })
        } catch (error) {
          sendJson(res, 500, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
            status: petPatchStatus(),
          })
        }
        return
      }
      if (path === '/dsh-model-lens/api/monitor' && req.method === 'GET') {
        sendJson(res, 200, { ok: true, endpoints: monitorRows() })
        return
      }
      if (path === '/dsh-model-lens/api/monitor/endpoints' && req.method === 'POST') {
        const authError = authorizeControl(req)
        if (authError) {
          sendJson(res, 403, { ok: false, error: authError })
          return
        }
        try {
          const body = await readBody(req)
          const kind = String(body.kind || '').toLowerCase()
          if (!KIND_LABEL[kind] || kind === 'other') {
            sendJson(res, 400, { ok: false, error: 'unsupported kind' })
            return
          }
          const port = Number(body.port)
          if (!Number.isInteger(port) || port < 1 || port > 65535) {
            sendJson(res, 400, { ok: false, error: 'port must be 1..65535' })
            return
          }
          const name = String(body.name || '').trim().slice(0, 80)
          const id = `manual-${kind}-${port}`
          const existing = findLocal(id)
          const base = kind === 'openai' || kind === 'chat'
            ? `http://127.0.0.1:${port}/v1`
            : `http://127.0.0.1:${port}`
          const entry = {
            id,
            kind,
            base,
            model: name || existing?.model || null,
            label: name || existing?.label || KIND_LABEL[kind],
            tag: typeof body.tag === 'string' && body.tag.trim() ? body.tag.trim().slice(0, 12) : existing?.tag || null,
            manual: true,
            ...(existing?.start ? { start: existing.start } : {}),
          }
          const normalized = normalizeEndpoint(entry, { includeRemote: true })
          if (normalized) {
            applyTemplate(normalized)
            if (normalized.start) entry.start = normalized.start
          }
          upsertLocal(entry)
          void tick()
          sendJson(res, 200, { ok: true, endpoint: entry })
        } catch (error) {
          sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
        return
      }
      const monitorMatch = path.match(/^\/dsh-model-lens\/api\/monitor\/endpoints\/([^/]+)(?:\/(start-command))?$/)
      if (monitorMatch) {
        const id = decodeURIComponent(monitorMatch[1])
        const isStartCommand = monitorMatch[2] === 'start-command'
        const authError = authorizeControl(req)
        if (authError) {
          sendJson(res, 403, { ok: false, error: authError })
          return
        }
        if (req.method === 'DELETE' && !isStartCommand) {
          const index = localConfig.endpoints.findIndex((entry) => entry.id === id)
          if (index < 0) {
            sendJson(res, 404, { ok: false, error: 'manual endpoint not found' })
            return
          }
          localConfig.endpoints.splice(index, 1)
          knownEndpoints = knownEndpoints.filter((entry) => entry.id !== id)
          writeFile(KNOWN_FILE, JSON.stringify(knownEndpoints, null, 2) + '\n', 'utf8').catch(() => {})
          reloadLocal()
          persistLocal()
          void tick()
          sendJson(res, 200, { ok: true })
          return
        }
        if (isStartCommand && req.method === 'POST') {
          try {
            const body = await readBody(req)
            const endpoint = lastEndpoints.find((entry) => entry.id === id)
            if (!endpoint) {
              sendJson(res, 404, { ok: false, error: 'endpoint not found' })
              return
            }
            const command = String(body.command || '').trim()
            if (!command) {
              sendJson(res, 400, { ok: false, error: 'command is required' })
              return
            }
            const args = Array.isArray(body.args)
              ? body.args.map((value) => String(value)).slice(0, 64)
              : String(body.args || '').split(/\s+/).filter(Boolean).slice(0, 64)
            const local = findLocal(id)
            upsertLocal({
              id,
              kind: endpoint.kind,
              base: endpoint.base,
              model: endpoint.model || null,
              label: endpoint.label || null,
              tag: endpoint.tag || null,
              manual: Boolean(local?.manual),
              startDisabled: false,
              start: {
                command,
                args,
                cwd: typeof body.cwd === 'string' && body.cwd.trim() ? body.cwd.trim() : null,
                timeoutMs: Math.max(5000, Math.min(600000, Number(body.timeoutMs) || 180000)),
              },
            })
            void tick()
            sendJson(res, 200, { ok: true })
          } catch (error) {
            sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
          }
          return
        }
        if (isStartCommand && req.method === 'DELETE') {
          const endpoint = lastEndpoints.find((entry) => entry.id === id)
          const index = localConfig.endpoints.findIndex((entry) => entry.id === id)
          if (index < 0) {
            if (!endpoint) {
              sendJson(res, 404, { ok: false, error: 'endpoint not found' })
              return
            }
            upsertLocal({
              id,
              kind: endpoint.kind,
              base: endpoint.base,
              model: endpoint.model || null,
              label: endpoint.label || null,
              tag: endpoint.tag || null,
              manual: false,
              startDisabled: true,
            })
          } else {
            const entry = localConfig.endpoints[index]
            delete entry.start
            entry.startDisabled = true
          }
          reloadLocal()
          persistLocal()
          void tick()
          sendJson(res, 200, { ok: true })
          return
        }
        sendJson(res, 405, { ok: false, error: 'method not allowed' })
        return
      }
      const externalMatch = path.match(/^\/dsh-model-lens\/api\/services\/([^/]+)\/stop-external$/)
      if (externalMatch) {
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: 'method not allowed' })
          return
        }
        const authError = authorizeControl(req, { requireExternalStop: true })
        if (authError) {
          sendJson(res, 403, { ok: false, error: authError })
          return
        }
        const id = decodeURIComponent(externalMatch[1])
        const endpoint = lastEndpoints.find((entry) => entry.id === id)
        if (!endpoint) {
          sendJson(res, 404, { ok: false, error: 'unknown endpoint' })
          return
        }
        if (owned.has(id)) {
          sendJson(res, 409, { ok: false, error: 'service is managed by dsh-model-lens' })
          return
        }
        if (!snapshot.endpoints.find((entry) => entry.id === id)?.online) {
          sendJson(res, 409, { ok: false, error: 'service is offline' })
          return
        }
        try {
          const result = await stopExternal(endpoint)
          sendJson(res, 202, { ok: true, accepted: 'stop-external', ...result })
        } catch (error) {
          sendJson(res, 409, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
        return
      }
      const controlMatch = path.match(/^\/dsh-model-lens\/api\/services\/([^/]+)\/(start|stop)$/)
      if (controlMatch) {
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: 'method not allowed' })
          return
        }
        const authError = authorizeControl(req, { requireServiceControl: true })
        if (authError) {
          sendJson(res, 403, { ok: false, error: authError })
          return
        }
        const id = decodeURIComponent(controlMatch[1])
        const action = controlMatch[2]
        const endpoint = lastEndpoints.find((entry) => entry.id === id)
        if (!endpoint) {
          sendJson(res, 404, { ok: false, error: 'unknown endpoint' })
          return
        }
        try {
          if (action === 'start') {
            if (snapshot.endpoints.find((entry) => entry.id === id)?.online) {
              sendJson(res, 409, { ok: false, error: 'service is already online' })
              return
            }
            await startService(endpoint)
            sendJson(res, 202, { ok: true, accepted: 'start' })
          } else {
            await stopService(endpoint)
            sendJson(res, 202, { ok: true, accepted: 'stop' })
          }
        } catch (error) {
          sendJson(res, 409, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
        return
      }
      sendJson(res, 404, { ok: false, error: 'unknown dsh-model-lens endpoint' })
    }
    return ctx.webServer.register({ kind: 'prefix', path: '/dsh-model-lens', handler })
  })

  ctx.logger?.info?.('dsh-model-lens: monitoring started')
}
