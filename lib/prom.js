/**
 * Minimal Prometheus text-format parser.
 * Only the subset Xinference emits is supported: `name{labels} value`.
 */

function unescapeLabel(value) {
  return value
    .replace(/\\n/g, '\n')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
}

function parseLabels(source) {
  const labels = {}
  const re = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g
  let match
  while ((match = re.exec(source)) !== null) {
    labels[match[1]] = unescapeLabel(match[2])
  }
  return labels
}

/**
 * @param {string} text
 * @returns {Array<{name: string, labels: Record<string, string>, value: number}>}
 */
export function parsePrometheus(text) {
  const samples = []
  for (const raw of String(text).split('\n')) {
    const line = raw.trim()
    if (!line || line[0] === '#') continue
    const split = line.lastIndexOf(' ')
    if (split <= 0) continue
    const value = Number(line.slice(split + 1))
    if (!Number.isFinite(value)) continue
    const head = line.slice(0, split)
    const brace = head.indexOf('{')
    if (brace < 0) {
      samples.push({ name: head, labels: {}, value })
      continue
    }
    const close = head.lastIndexOf('}')
    if (close < brace) continue
    samples.push({
      name: head.slice(0, brace),
      labels: parseLabels(head.slice(brace + 1, close)),
      value,
    })
  }
  return samples
}

/**
 * Aggregate the per-model metrics Xinference exposes on `/metrics`.
 *
 * Labels: model_name, model_uid, model_type, replica_index, gpu_index, ...
 * @param {string} text
 */
export function parseXinferenceMetrics(text) {
  const models = new Map()
  for (const sample of parsePrometheus(text)) {
    if (!sample.name.startsWith('xinference:model_')) continue
    const name = sample.labels.model_name || sample.labels.model_uid
    if (!name) continue
    const entry = models.get(name) || {
      name,
      uid: sample.labels.model_uid || name,
      type: sample.labels.model_type || 'other',
      present: false,
      inflight: 0,
      requests: 0,
      durationSum: 0,
      durationCount: 0,
      vramBytes: 0,
    }
    switch (sample.name) {
      case 'xinference:model_info':
        entry.present = true
        entry.type = sample.labels.model_type || entry.type
        break
      case 'xinference:model_status':
        entry.present = true
        break
      case 'xinference:model_serve_count':
        entry.inflight += sample.value
        break
      case 'xinference:model_request_total':
        entry.requests += sample.value
        break
      case 'xinference:model_request_duration_seconds_sum':
        entry.durationSum += sample.value
        break
      case 'xinference:model_request_duration_seconds_count':
        entry.durationCount += sample.value
        break
      case 'xinference:model_gpu_memory_used_bytes':
        entry.vramBytes += sample.value
        break
      default:
        break
    }
    models.set(name, entry)
  }
  return [...models.values()]
}

/**
 * Parse the native `/v1/models` list as a fallback when `/metrics` is off.
 * Accepts both Xinference's native shape and an OpenAI `/v1/models` shape.
 */
export function parseModelList(payload) {
  const data = Array.isArray(payload?.data) ? payload.data : []
  const models = []
  for (const item of data) {
    if (!item || typeof item !== 'object') continue
    const name = item.model_name || item.model_uid || item.id
    if (typeof name !== 'string' || name === '') continue
    models.push({
      name,
      uid: item.model_uid || item.id || name,
      type: item.model_type || item.type || item.task || 'other',
      present: true,
      inflight: 0,
      requests: 0,
      durationSum: 0,
      durationCount: 0,
      vramBytes: 0,
    })
  }
  return models
}
