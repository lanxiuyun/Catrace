/** Bluetooth headset toast — compact row: app icon + "Name 已连接" + launch + close. */
const { h } = globalThis.__CATRACE_VUE__ || {}
if (typeof h !== 'function') throw new Error('Catrace plugin Vue runtime missing')

const STYLE_ID = 'catrace-plugin-bt-music-css'
const CSS = `
.bt-root { position:relative; width:100%; box-sizing:border-box; }
.bt-row {
  display:flex; align-items:center; gap:0.5rem; width:100%;
  padding:0.0625rem 0.0625rem 0.375rem 0.0625rem; box-sizing:border-box;
  font-family:system-ui,-apple-system,"Segoe UI",sans-serif;
}
.bt-icon {
  flex-shrink:0; width:2rem; height:2rem; border-radius:0.5rem;
  object-fit:contain; background:#f1f5f9;
  box-shadow:0 0.0625rem 0.125rem rgba(15,23,42,0.06);
}
.bt-icon.fallback {
  display:flex; align-items:center; justify-content:center;
  background:linear-gradient(145deg,#7c3aed,#6366f1);
  color:#fff; font-size:0.875rem; font-weight:800;
}
.bt-mid { flex:1; min-width:0; display:flex; flex-direction:column; gap:0.0625rem; }
.bt-title {
  margin:0; font-size:0.8125rem; font-weight:700; color:#0f172a; line-height:1.3;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
}
.bt-sub {
  margin:0; font-size:0.6875rem; font-weight:500; color:#64748b; line-height:1.25;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
}
.bt-right { flex-shrink:0; display:flex; align-items:center; gap:0.25rem; }
.bt-launch {
  border:0; border-radius:999px; padding:0.3125rem 0.625rem; min-height:1.625rem;
  background:#2563eb; color:#fff; font-size:0.6875rem; font-weight:700;
  cursor:pointer; white-space:nowrap; line-height:1.2;
  box-shadow:0 0.0625rem 0.25rem rgba(37,99,235,0.28);
}
.bt-launch:hover { filter:brightness(1.05); }
.bt-x {
  flex-shrink:0; width:1.25rem; height:1.25rem; border:none; background:transparent;
  border-radius:999px; color:#94a3b8; font-size:0.875rem; line-height:1; cursor:pointer;
  display:flex; align-items:center; justify-content:center;
}
.bt-x:hover { background:#f1f5f9; color:#475569; }
.bt-bar-wrap {
  position:absolute; left:0.5rem; right:0.5rem; bottom:0; height:0.125rem;
  pointer-events:none; overflow:hidden; border-radius:999px; background:rgba(37,99,235,0.08);
}
.bt-bar {
  height:100%; border-radius:999px;
  background:linear-gradient(90deg,#2563eb,#93c5fd);
  transform-origin:left center;
  animation:bt-shrink var(--toast-auto-hide-ms, 5000ms) linear forwards;
}
.bt-bar.paused { animation-play-state:paused; }
@keyframes bt-shrink { from { transform:scaleX(1); } to { transform:scaleX(0); } }
`

function ensureStyles() {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
}

function playerLabel(payload) {
  const name = String(payload.playerName || '').trim()
  if (name) return name.toLowerCase().endsWith('.exe') ? name : `${name}.exe`
  const path = String(payload.playerPath || '').trim()
  if (!path) return ''
  const base = path.split(/[/\\]/).pop() || path
  return base
}

export default {
  name: 'BtMusicCard',
  props: {
    event: { type: Object, required: true },
    isHovered: { type: Boolean, default: false },
  },
  emits: ['close', 'action'],
  created() {
    ensureStyles()
  },
  render() {
    const event = this.event || {}
    const payload = event.payload || {}
    const deviceName = String(payload.deviceName || event.body || '蓝牙耳机').trim() || '蓝牙耳机'
    const exe = playerLabel(payload)
    const playerIcon = String(payload.playerIconDataUrl || '')
    const letter = (exe || deviceName || '?').replace(/\.exe$/i, '').slice(0, 1).toUpperCase()

    // Title: "荣耀亲选耳夹式耳机 已连接"
    const title = `${deviceName} 已连接`

    return h('div', { class: 'bt-root' }, [
      h('div', { class: 'bt-row' }, [
        playerIcon
          ? h('img', { class: 'bt-icon', src: playerIcon, alt: '' })
          : h('div', { class: 'bt-icon fallback' }, letter),
        h('div', { class: 'bt-mid' }, [
          h('h2', { class: 'bt-title' }, title),
          exe ? h('p', { class: 'bt-sub' }, `已关联: ${exe}`) : null,
        ]),
        h('div', { class: 'bt-right' }, [
          h(
            'button',
            {
              class: 'bt-launch',
              type: 'button',
              onClick: () => this.$emit('action', 'open-player'),
            },
            '启动程序',
          ),
          h(
            'button',
            {
              class: 'bt-x',
              type: 'button',
              'aria-label': '关闭',
              onClick: () => this.$emit('close'),
            },
            '×',
          ),
        ]),
      ]),
      !event.sticky
        ? h('div', { class: 'bt-bar-wrap' }, [
            h('div', { class: ['bt-bar', this.isHovered ? 'paused' : ''] }),
          ])
        : null,
    ])
  },
}
