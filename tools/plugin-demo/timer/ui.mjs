/** Timer plugin toast card — Vue options API ESM via __CATRACE_VUE__.
 * Contract: props.event (BusEvent), props.isHovered?; emits close / action(actionId)
 */
const { h } = globalThis.__CATRACE_VUE__ || {}
if (typeof h !== 'function') {
  throw new Error('Catrace plugin Vue runtime missing (__CATRACE_VUE__.h)')
}

const STYLE_ID = 'catrace-plugin-timer-css'
const CSS = `
.timer-card {
  display: flex; flex-direction: column; width: 100%; min-height: 0;
  --accent: #7c3aed; --title: #4c1d95; --body: #5b21b6; --bg: #f5f3ff;
  font-family: system-ui, -apple-system, Segoe UI, sans-serif;
}
.timer-card .hdr { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
.timer-card .left { display: flex; align-items: center; gap: 0.5rem; min-width: 0; }
.timer-card .icon {
  flex-shrink: 0; width: 1.5rem; height: 1.5rem; border-radius: 0.375rem;
  background: var(--bg); color: var(--accent);
  display: flex; align-items: center; justify-content: center;
}
.timer-card .title {
  margin: 0; font-size: 0.9375rem; font-weight: 600; color: var(--title);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.timer-card .x {
  flex-shrink: 0; width: 1.5rem; height: 1.5rem; border: none; background: transparent;
  border-radius: 0.25rem; color: #94a3b8; font-size: 1.125rem; line-height: 1; cursor: pointer;
}
.timer-card .x:hover { background: var(--bg); color: var(--accent); }
.timer-card .bar {
  height: 0.125rem; border-radius: 999px;
  background: linear-gradient(90deg, var(--accent), var(--bg));
  transform-origin: left center;
  animation: timer-card-shrink var(--toast-auto-hide-ms, 8000ms) linear forwards;
  margin: 0.25rem 0 0.5rem;
}
.timer-card .bar.paused { animation-play-state: paused; }
@keyframes timer-card-shrink { from { transform: scaleX(1); } to { transform: scaleX(0); } }
.timer-card .body {
  margin: 0; font-size: 0.8125rem; line-height: 1.45; color: var(--body);
  white-space: pre-wrap; word-break: break-word;
}
.timer-card .acts { display: flex; flex-wrap: wrap; gap: 0.375rem; margin-top: 0.625rem; }
.timer-card .btn {
  border: none; border-radius: 0.375rem; padding: 0.375rem 0.625rem;
  font-size: 0.75rem; font-weight: 600; cursor: pointer;
}
.timer-card .btn.ghost { background: var(--bg); color: var(--title); }
.timer-card .btn.primary { background: var(--accent); color: #fff; }
.timer-card .btn:hover { filter: brightness(0.97); }
`

function ensureStyles() {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID)) return
  const el = document.createElement('style')
  el.id = STYLE_ID
  el.textContent = CSS
  document.head.appendChild(el)
}

function clockIcon() {
  return h(
    'svg',
    {
      class: 'icon',
      width: 16,
      height: 16,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 2,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    },
    [
      h('circle', { cx: 12, cy: 12, r: 10 }),
      h('polyline', { points: '12 6 12 12 16 14' }),
    ],
  )
}

export default {
  name: 'TimerCard',
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
    const actions = event.actions || []

    const children = [
      h('div', { class: 'hdr' }, [
        h('div', { class: 'left' }, [
          clockIcon(),
          h('h2', { class: 'title' }, event.title || ''),
        ]),
        h(
          'button',
          {
            class: 'x',
            type: 'button',
            'aria-label': 'Close',
            onClick: () => this.$emit('close'),
          },
          '×',
        ),
      ]),
    ]

    if (!event.sticky) {
      children.push(
        h('div', {
          class: ['bar', this.isHovered ? 'paused' : ''],
        }),
      )
    }

    if (event.body) {
      children.push(h('p', { class: 'body' }, event.body))
    }

    if (actions.length) {
      children.push(
        h(
          'div',
          { class: 'acts' },
          actions.map((a, i) =>
            h(
              'button',
              {
                key: a.id,
                type: 'button',
                class: ['btn', i === actions.length - 1 ? 'primary' : 'ghost'],
                onClick: () => this.$emit('action', a.id),
              },
              a.label,
            ),
          ),
        ),
      )
    }

    return h('div', { class: 'timer-card' }, children)
  },
}
