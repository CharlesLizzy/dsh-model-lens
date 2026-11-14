/**
 * dsh-model-lens HUD layer for the dsh-pet desktop helper.
 *
 * Generic on purpose: it renders whatever `sections.hud.items` the host exposes.
 * A plugin registers through `petApi7340.hud.register(...)`; this layer only
 * turns those descriptors into transparent iframes beside the pet.
 */
(function () {
  'use strict'

  if (window.__dshModelLensHudLayer) return
  window.__dshModelLensHudLayer = true

  var POLL_MS = 1200
  var PLACE_MS = 500
  var GAP = 3
  var byId = new Map()
  var frames = new Map()
  var heights = new Map()
  var hotspots = new Map()

  function applyHotspots() {
    var rects = []
    for (var entry of frames) {
      var list = hotspots.get(entry[0])
      if (!list || list.length === 0) continue
      var box = entry[1].getBoundingClientRect()
      for (var r of list) {
        rects.push({ x: box.left + r.x, y: box.top + r.y, width: r.width, height: r.height })
      }
    }
    window.__dshPetHudInputRects = rects
    try {
      if (typeof sprites !== 'undefined') {
        for (var sprite of sprites) sprite.syncInputRegions()
      }
    } catch (error) {}
  }

  if (!document.getElementById('dsh-model-lens-hud-style')) {
    var style = document.createElement('style')
    style.id = 'dsh-model-lens-hud-style'
    style.textContent =
      '.dsh-pet-hud{position:fixed;border:0;background:transparent;overflow:hidden;' +
      'z-index:4;display:block;color-scheme:light;}'
    document.head.appendChild(style)
  }

  function number(value, fallback) {
    var n = Number(value)
    return Number.isFinite(n) ? n : fallback
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value))
  }

  function spriteMetrics() {
    var sprite = document.querySelector('.pet-sprite')
    if (!sprite) return null
    var width = sprite.offsetWidth || 550
    var stageH = width * 9 / 16
    return {
      bodyLeft: sprite.offsetLeft + width * (200 / 640),
      bodyRight: sprite.offsetLeft + width * (440 / 640),
      bodyFeet: sprite.offsetTop + stageH * (330 / 360),
    }
  }

  function petParams(raw) {
    var url
    try {
      url = new URL(raw)
    } catch (error) {
      return raw
    }
    var font = 13
    var family = ''
    var sprite = document.querySelector('.pet-sprite')
    if (sprite) {
      var styles = getComputedStyle(sprite)
      var px = parseFloat(styles.getPropertyValue('--dsh-pet-font-bubble'))
      if (Number.isFinite(px) && px > 0) font = clamp(px * 0.54, 11, 20)
      family = getComputedStyle(document.documentElement).getPropertyValue('--dsh-pet-font-family').trim()
    }
    url.searchParams.set('petFont', String(Math.round(font * 10) / 10))
    if (family) url.searchParams.set('petFamily', family)
    return url.toString()
  }

  function place(frame, item) {
    var metrics = spriteMetrics()
    if (!metrics) return
    var width = clamp(Math.round(number(item.width, 260)), 160, 480)
    var height = clamp(Math.round(heights.get(item.id) || number(item.height, 190)), 60, 420)
    var offsetX = clamp(number(item.offsetX, 0), -400, 400)
    var offsetY = clamp(number(item.offsetY, 0), -400, 400)
    var anchor = item.anchor === 'right' ? 'right' : 'left'
    // The collapsed ball sits at the card's bottom-right/bottom-left corner.
    // Anchor that corner, then grow upward when content makes the card taller.
    var anchorRight = anchor === 'right' ? metrics.bodyRight + GAP : metrics.bodyLeft - GAP
    var anchorBottom = metrics.bodyFeet + offsetY
    var left = anchorRight - width
    var top = anchorBottom - height
    if (anchor === 'left' && left < 8) left = metrics.bodyRight + GAP
    left = clamp(left + offsetX, 8, Math.max(8, window.innerWidth - width - 8))
    top = clamp(top, 8, Math.max(8, window.innerHeight - height - 8))
    frame.style.width = width + 'px'
    frame.style.height = height + 'px'
    frame.style.left = left + 'px'
    frame.style.top = top + 'px'
    applyHotspots()
  }

  function repositionAll() {
    for (var entry of frames) {
      var item = byId.get(entry[0])
      if (item) place(entry[1], item)
    }
  }

  function ensure(item) {
    if (!item || typeof item.id !== 'string' || typeof item.url !== 'string') return
    var frame = frames.get(item.id)
    if (!frame) {
      frame = document.createElement('iframe')
      frame.className = 'dsh-pet-hud'
      frame.id = 'dsh-pet-hud-' + item.id
      frame.setAttribute('sandbox', 'allow-scripts allow-same-origin')
      frame.setAttribute('referrerpolicy', 'no-referrer')
      frame.setAttribute('scrolling', 'no')
      frame.setAttribute('allowtransparency', 'true')
      if (item.title) frame.setAttribute('title', item.title)
      document.body.appendChild(frame)
      frames.set(item.id, frame)
    }
    frame.style.pointerEvents = item.pointerEvents === 'auto' ? 'auto' : 'none'
    var next = petParams(item.url)
    if (frame.getAttribute('src') !== next) frame.setAttribute('src', next)
    place(frame, item)
  }

  async function poll() {
    try {
      var response = await fetch(STATE_URL, { cache: 'no-store' })
      if (!response.ok) return
      var state = await response.json()
      var section = state && state.sections ? state.sections.hud : null
      var list = section && section.data && Array.isArray(section.data.items) ? section.data.items : []
      var seen = new Set()
      for (var item of list) {
        if (!item || typeof item.id !== 'string') continue
        seen.add(item.id)
        byId.set(item.id, item)
        ensure(item)
      }
      for (var entry of [...frames]) {
        if (seen.has(entry[0])) continue
        entry[1].remove()
        frames.delete(entry[0])
        byId.delete(entry[0])
        heights.delete(entry[0])
        hotspots.delete(entry[0])
      }
      applyHotspots()
    } catch (error) {
      /* host restarting: keep the last frames, retry next tick */
    }
  }

  window.addEventListener('message', function (event) {
    var data = event.data
    if (!data) return
    for (var entry of frames) {
      if (entry[1].contentWindow !== event.source) continue
      var item = byId.get(entry[0])
      if (!item) return
      if (data.type === 'dsh-model-lens:hotspots') {
        var rects = Array.isArray(data.rects) ? data.rects : []
        hotspots.set(
          entry[0],
          rects.filter((rect) => rect && Number(rect.width) > 0 && Number(rect.height) > 0),
        )
        applyHotspots()
        return
      }
      if (data.type === 'dsh-model-lens:height') {
        heights.set(entry[0], clamp(Math.round(number(data.height, 190)), 60, 420))
        place(entry[1], item)
        return
      }
      return
    }
  })

  window.addEventListener('resize', repositionAll)
  setInterval(repositionAll, PLACE_MS)
  setInterval(poll, POLL_MS)
  var ACTION_NAME = '戳戳小圆球'
  var lastAction = ''
  function watchPetAction() {
    var sprite = typeof sprites === 'undefined' ? null : sprites[0]
    if (!sprite) return
    var anim = sprite.anim
    if (anim === ACTION_NAME && lastAction !== ACTION_NAME) {
      for (var entry of frames) {
        entry[1].contentWindow.postMessage({ type: 'dsh-model-lens:pet-action' }, '*')
      }
    } else if (lastAction === ACTION_NAME && anim !== ACTION_NAME) {
      for (var done of frames) {
        done[1].contentWindow.postMessage({ type: 'dsh-model-lens:pet-action-end' }, '*')
      }
    }
    lastAction = anim
  }
  setInterval(watchPetAction, 150)
  poll()
})()
