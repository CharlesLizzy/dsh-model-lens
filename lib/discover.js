const KIND_WEIGHT = { embedding: 1, rerank: 2, xinference: 2, ollama: 3, stt: 4, tts: 5, chat: 6, openai: 6, other: 9 }

export const KIND_LABEL = {
  embedding: '嵌入',
  rerank: '重排',
  xinference: '模型',
  ollama: 'LLM',
  stt: 'ASR',
  tts: 'TTS',
  chat: 'LLM',
  openai: 'API',
  other: '服务',
}

export function tagForType(type) {
  if (typeof type !== 'string') return null
  const value = type.trim().toLowerCase()
  if (!value || value === 'other' || value === 'unknown') return null
  const known = {
    embedding: '嵌入',
    embed: '嵌入',
    rerank: '重排',
    reranker: '重排',
    stt: 'ASR',
    asr: 'ASR',
    tts: 'TTS',
    chat: 'LLM',
    llm: 'LLM',
    completion: 'LLM',
    ollama: 'LLM',
    image: '图像',
    vision: '视觉',
    ocr: 'OCR',
    vlm: '视觉',
  }
  if (known[value]) return known[value]
  if (/^[a-z0-9_-]{1,12}$/i.test(type.trim())) return type.trim().toUpperCase()
  return null
}

function isPrivateHost(hostname) {
  const host = hostname.toLowerCase()
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') return true
  if (/^10\./.test(host)) return true
  if (/^192\.168\./.test(host)) return true
  const m = host.match(/^172\.(\d+)\./)
  if (m) {
    const second = Number(m[1])
    return second >= 16 && second <= 31
  }
  return false
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function normalizeStart(raw) {
  if (!raw || typeof raw !== 'object') return null
  const command = typeof raw.command === 'string' ? raw.command.trim() : ''
  if (!command) return null
  const args = Array.isArray(raw.args) ? raw.args.map((value) => String(value)).slice(0, 64) : []
  const env =
    raw.env && typeof raw.env === 'object'
      ? Object.fromEntries(
          Object.entries(raw.env)
            .slice(0, 32)
            .filter(([, value]) => value !== undefined && value !== null)
            .map(([key, value]) => [key, String(value)]),
        )
      : null
  return {
    command,
    args,
    env,
    cwd: typeof raw.cwd === 'string' && raw.cwd.trim() !== '' ? raw.cwd.trim() : null,
    timeoutMs: Math.round(clamp(Number(raw.timeoutMs) || 180_000, 5_000, 600_000)),
    shell: raw.shell === true,
  }
}

function normalizeStop(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const command = typeof source.command === 'string' ? source.command.trim() : ''
  const args = Array.isArray(source.args) ? source.args.map((value) => String(value)).slice(0, 64) : []
  const env =
    source.env && typeof source.env === 'object'
      ? Object.fromEntries(
          Object.entries(source.env)
            .slice(0, 32)
            .filter(([, value]) => value !== undefined && value !== null)
            .map(([key, value]) => [key, String(value)]),
        )
      : null
  return {
    mode: source.mode === 'pid' ? 'pid' : 'tree',
    timeoutMs: Math.round(clamp(Number(source.timeoutMs) || 15_000, 1_000, 120_000)),
    command: command || null,
    args,
    env,
    cwd: typeof source.cwd === 'string' && source.cwd.trim() !== '' ? source.cwd.trim() : null,
    shell: source.shell === true,
  }
}

/** Normalize one endpoint definition; returns null when the URL is not a local service. */
export function normalizeEndpoint(raw, options = {}) {
  if (!raw || typeof raw !== 'object') return null
  const kind = String(raw.kind || '').toLowerCase()
  if (!KIND_WEIGHT[kind]) return null
  let base = String(raw.base || raw.baseUrl || '').trim()
  if (!base) return null
  if (!/^https?:\/\//i.test(base)) base = 'http://' + base
  base = base.replace(/\/+$/, '')
  let url
  try {
    url = new URL(base)
  } catch {
    return null
  }
  if (!options.includeRemote && !isPrivateHost(url.hostname)) return null
  return {
    id: String(raw.id || `${kind}-${url.port || (url.protocol === 'https:' ? 443 : 80)}`),
    kind,
    base,
    origin: url.origin,
    host: url.hostname,
    port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)),
    model: typeof raw.model === 'string' && raw.model.trim() !== '' ? raw.model.trim() : null,
    label: typeof raw.label === 'string' && raw.label.trim() !== '' ? raw.label.trim() : null,
    tag: typeof raw.tag === 'string' && raw.tag.trim() !== '' ? raw.tag.trim().slice(0, 12) : null,
    tagFromTemplate: raw.tagFromTemplate === true,
    log: typeof raw.log === 'string' && raw.log.trim() !== '' ? raw.log.trim() : null,
    logPattern: typeof raw.logPattern === 'string' && raw.logPattern.trim() !== '' ? raw.logPattern.trim() : null,
    start: normalizeStart(raw.start),
    startDisabled: raw.startDisabled === true,
    stop: normalizeStop(raw.stop),
    knownModels: Array.isArray(raw.knownModels)
      ? raw.knownModels
          .filter((model) => model && typeof model.name === 'string')
          .slice(0, 32)
          .map((model) => ({ name: model.name, type: typeof model.type === 'string' ? model.type : 'other' }))
      : null,
    enabled: raw.enabled !== false,
    source: raw.source || 'config',
  }
}

/** Merge several endpoint lists, keeping the first definition of each kind+base+model. */
export function mergeEndpoints(...lists) {
  const seen = new Set()
  const out = []
  for (const list of lists) {
    for (const endpoint of list) {
      if (!endpoint) continue
      const key = `${endpoint.kind}|${endpoint.base}|${endpoint.model || ''}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(endpoint)
    }
  }
  out.sort((a, b) => {
    const ka = KIND_WEIGHT[a.kind] ?? 9
    const kb = KIND_WEIGHT[b.kind] ?? 9
    if (ka !== kb) return ka - kb
    return a.base.localeCompare(b.base)
  })
  return out
}
