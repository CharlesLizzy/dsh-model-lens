import { open, stat } from 'node:fs/promises'

const MAX_READ = 256 * 1024
const KEEP_MS = 120_000

/**
 * Tails one uvicorn access log and counts matching request lines.
 * Initial poll starts at EOF so old history is not replayed.
 */
export class LogTail {
  constructor(path, patterns) {
    this.path = path
    this.patterns = patterns
    this.offset = null
    this.events = []
  }

  async poll(now) {
    if (!this.path) return
    let info
    try {
      info = await stat(this.path)
    } catch {
      return
    }
    if (this.offset === null) {
      this.offset = info.size
      return
    }
    if (info.size < this.offset) this.offset = 0
    if (info.size === this.offset) return
    const length = Math.min(info.size - this.offset, MAX_READ)
    let text = ''
    let handle
    try {
      handle = await open(this.path, 'r')
      const buffer = Buffer.alloc(length)
      await handle.read(buffer, 0, length, this.offset)
      text = buffer.toString('utf8')
    } catch {
      return
    } finally {
      await handle?.close().catch(() => {})
    }
    this.offset += length
    for (const line of text.split('\n')) {
      if (this.patterns.some((pattern) => pattern.test(line))) this.events.push(now)
    }
    const cutoff = now - KEEP_MS
    while (this.events.length > 0 && this.events[0] < cutoff) this.events.shift()
  }

  stats(now, windowMs = 60_000) {
    const cutoff = now - windowMs
    let count = 0
    for (let i = this.events.length - 1; i >= 0; i -= 1) {
      if (this.events[i] < cutoff) break
      count += 1
    }
    const last = this.events.length > 0 ? this.events[this.events.length - 1] : null
    return { count, last, active: last !== null && last > now - 5_000 }
  }
}
