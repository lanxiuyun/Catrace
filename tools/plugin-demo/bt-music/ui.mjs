/** Bluetooth headset toast card. */
const { h } = globalThis.__CATRACE_VUE__ || {}
if (typeof h !== 'function') throw new Error('Catrace plugin Vue runtime missing')

const STYLE_ID = 'catrace-plugin-bt-music-css'
const CSS = `
.bt-music {
  display:flex; flex-direction:column; gap:0.625rem; width:100%;
  --accent:#2563eb; --title:#1e3a8a; --body:#1d4ed8; --bg:#eff6ff; --soft:#dbeafe;
  color:var(--title);
  font-family:system-ui,-apple-system,Segoe UI,sans-serif;
}
.bt-music .header { display:flex; align-items:center; justify-content:space-between; gap:0.5rem; }
.bt-music .left { display:flex; align-items:center; gap:0.5rem; min-width:0; }
.bt-music .icon {
  flex-shrink:0; width:1.75rem; height:1.75rem; border-radius:0.5rem;
  background:var(--soft); color:var(--accent);
  display:flex; align-items:center; justify-content:center;
}
.bt-music .title {
  margin:0; font-size:0.9375rem; font-weight:700; color:var(--title);
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
}
.bt-music .badge {
  flex-shrink:0; padding:0.1875rem 0.4375rem; border-radius:999px;
  background:var(--soft); color:var(--accent); font-size:0.6875rem; font-weight:700;
}
.bt-music .body { margin:0; color:var(--body); font-size:0.8125rem; line-height:1.5; }
.bt-music .meta {
  display:grid; grid-template-columns:auto 1fr; gap:0.25rem 0.5rem;
  padding:0.5rem 0.625rem; border-radius:0.5rem; background:var(--bg); font-size:0.75rem;
}
.bt-music .meta strong { color:var(--accent); font-weight:700; }
.bt-music .meta span { color:#1e40af; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.bt-music .actions { display:flex; flex-wrap:wrap; gap:0.375rem; }
.bt-music button {
  border:0; border-radius:0.375rem; padding:0.375rem 0.625rem;
  cursor:pointer; font-size:0.75rem; font-weight:700;
}
.bt-music .primary { background:var(--accent); color:#fff; }
.bt-music .ghost { background:var(--soft); color:var(--title); }
.bt-music button:hover { filter:brightness(0.97); }
.bt-music.disconnected { --accent:#64748b; --title:#334155; --body:#475569; --bg:#f8fafc; --soft:#e2e8f0; }
`

function ensureStyles() {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
}

function headsetIcon() {
  return h(
    'svg',
    {
      class: 'icon',
      width: 18,
      height: 18,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 2,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    },
    [
      h('path', { d: 'M3 14v-3a9 9 0 0 1 18 0v3' }),
      h('path', { d: 'M21 16a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z' }),
      h('path', { d: 'M3 16a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z' }),
    ],
  )
}

export default {
  name: 'BtMusicCard',
  props: { event: { type: Object, required: true } },
  emits: ['close', 'action'],
  created() {
    ensureStyles()
  },
  render() {
    const event = this.event || {}
    const payload = event.payload || {}
    const disconnected = String(event.eventType || '').includes('disconnected')
    const badge = disconnected ? 'DISCONNECTED' : payload.source === 'mock' ? 'MOCK' : 'CONNECTED'
    const actions = event.actions || []

    return h('div', { class: ['bt-music', disconnected ? 'disconnected' : ''] }, [
      h('div', { class: 'header' }, [
        h('div', { class: 'left' }, [
          headsetIcon(),
          h('h2', { class: 'title' }, event.title || (disconnected ? '耳机已断开' : '耳机已连接')),
        ]),
        h('span', { class: 'badge' }, badge),
      ]),
      h('p', { class: 'body' }, event.body || payload.deviceName || ''),
      h('div', { class: 'meta' }, [
        h('strong', '设备'),
        h('span', String(payload.deviceName || event.body || '-')),
        h('strong', '来源'),
        h('span', String(payload.source || payload.reason || '-')),
      ]),
      actions.length
        ? h(
            'div',
            { class: 'actions' },
            actions.map((action, index) =>
              h(
                'button',
                {
                  key: action.id,
                  class: index === 0 && !disconnected ? 'primary' : 'ghost',
                  type: 'button',
                  onClick: () => this.$emit('action', action.id),
                },
                action.label,
              ),
            ),
          )
        : null,
    ])
  },
}
