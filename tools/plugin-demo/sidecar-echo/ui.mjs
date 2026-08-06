/** Sidecar capability demo toast card. */
const { h } = globalThis.__CATRACE_VUE__ || {}
if (typeof h !== 'function') throw new Error('Catrace plugin Vue runtime missing')

const STYLE_ID = 'catrace-plugin-sidecar-echo-css'
const CSS = `
.sidecar-demo { display:flex; flex-direction:column; gap:0.625rem; color:#164e63; }
.sidecar-demo .header { display:flex; align-items:center; justify-content:space-between; gap:0.5rem; }
.sidecar-demo .title { margin:0; font-size:0.9375rem; font-weight:700; }
.sidecar-demo .badge { padding:0.1875rem 0.4375rem; border-radius:999px; background:#cffafe; color:#0e7490; font-size:0.6875rem; font-weight:700; }
.sidecar-demo .body { margin:0; color:#155e75; font-size:0.8125rem; line-height:1.5; }
.sidecar-demo .meta { display:grid; grid-template-columns:auto 1fr; gap:0.25rem 0.5rem; padding:0.5rem; border-radius:0.5rem; background:#ecfeff; font-size:0.75rem; }
.sidecar-demo .meta strong { color:#0e7490; }
.sidecar-demo .actions { display:flex; gap:0.375rem; }
.sidecar-demo button { border:0; border-radius:0.375rem; padding:0.375rem 0.625rem; cursor:pointer; font-size:0.75rem; font-weight:700; }
.sidecar-demo .echo { background:#0891b2; color:white; }
.sidecar-demo .done { background:#cffafe; color:#155e75; }
`

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
}

export default {
  name: 'SidecarCapabilityDemoCard',
  props: { event: { type: Object, required: true } },
  emits: ['close', 'action'],
  created() { ensureStyles() },
  render() {
    const event = this.event || {}
    const payload = event.payload || {}
    return h('div', { class: 'sidecar-demo' }, [
      h('div', { class: 'header' }, [
        h('h2', { class: 'title' }, event.title || 'Sidecar Demo'),
        h('span', { class: 'badge' }, 'NATIVE PROCESS')
      ]),
      h('p', { class: 'body' }, event.body || ''),
      h('div', { class: 'meta' }, [
        h('strong', 'PID'), h('span', String(payload.pid || '-')),
        h('strong', '序号'), h('span', String(payload.sequence || '-')),
        h('strong', '来源'), h('span', String(payload.reason || '-'))
      ]),
      h('div', { class: 'actions' }, (event.actions || []).map((action, index) =>
        h('button', {
          class: index === 0 ? 'echo' : 'done',
          type: 'button',
          onClick: () => {
            console.info('[sidecar-demo] action click', {
              eventId: event.id,
              actionId: action.id,
              payload
            })
            this.$emit('action', action.id)
          }
        }, action.label)
      ))
    ])
  }
}
