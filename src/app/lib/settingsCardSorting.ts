import Sortable from 'sortablejs'

interface Point {
  x: number
  y: number
}

interface Swap {
  point: Point
  travel: Point
  from: number
  to: number
}

function eventPoint(event: Event | undefined): Point | null {
  if (!event) return null
  if ('changedTouches' in event) {
    const touch = (event as TouchEvent).changedTouches[0]
    return touch ? { x: touch.clientX, y: touch.clientY } : null
  }
  if ('clientX' in event && 'clientY' in event) {
    const pointer = event as MouseEvent
    return { x: pointer.clientX, y: pointer.clientY }
  }
  return null
}

/** Keep live Sortable animation, but never let layout changes drive swaps. */
export function createSettingsCardSorting(
  grid: HTMLElement,
  onReorder: (keys: string[]) => void,
): { destroy(): void } {
  let originalCards: HTMLElement[] = []
  let directionAnchor: Point | null = null
  let physicalPoint: Point | null = null
  let lastSwap: Swap | null = null
  let pendingSwap: Swap | null = null
  // Small movement hysteresis, in CSS pixels (not accumulated event deltas).
  const movementThreshold = 8

  function trackPointer(event: Event) {
    const point = eventPoint(event)
    if (!point) return
    if (physicalPoint && directionAnchor) {
      const dx = point.x - physicalPoint.x
      const dy = point.y - physicalPoint.y
      const gx = physicalPoint.x - directionAnchor.x
      const gy = physicalPoint.y - directionAnchor.y
      if (dx * gx + dy * gy < 0) directionAnchor = physicalPoint
    } else {
      directionAnchor = point
    }
    physicalPoint = point
  }

  function reset() {
    document.removeEventListener('pointermove', trackPointer, true)
    originalCards = []
    directionAnchor = null
    physicalPoint = null
    lastSwap = null
    pendingSwap = null
  }

  const sortable = Sortable.create(grid, {
    draggable: '.ct-settings-slot',
    forceFallback: true,
    fallbackOnBody: true,
    animation: 200,
    ghostClass: 'ct-dragging',
    dragClass: 'ct-drag-over',
    handle: '.ct-drag-handle',
    filter: 'input, textarea, select, button, a, .rt-SliderRoot, .rt-SwitchRoot, .rt-SelectTrigger',
    preventOnFilter: false,
    onStart: (event: Sortable.SortableEvent & { originalEvent?: Event }) => {
      reset()
      originalCards = Array.from(grid.querySelectorAll<HTMLElement>(':scope > .ct-settings-slot'))
      physicalPoint = directionAnchor = eventPoint(event.originalEvent)
      document.addEventListener('pointermove', trackPointer, { capture: true, passive: true })
    },
    onMove: (event, originalEvent) => {
      pendingSwap = null
      const point = eventPoint(originalEvent)
      if (!point) return false
      const cards = Array.from(grid.querySelectorAll<HTMLElement>(':scope > .ct-settings-slot'))
      const from = cards.indexOf(event.dragged)
      const related = cards.indexOf(event.related)
      if (from < 0 || related < 0) return false
      const to = related + (event.willInsertAfter ? 1 : 0) - (from < related ? 1 : 0)
      const anchor = directionAnchor ?? point
      const travel = { x: point.x - anchor.x, y: point.y - anchor.y }
      if (lastSwap) {
        // Fallback hit-testing runs on a timer, including when the mouse stops.
        // A layout/animation change alone must not authorize another insertion.
        if (Math.hypot(point.x - lastSwap.point.x, point.y - lastSwap.point.y) < movementThreshold) return false
        if (Math.hypot(travel.x, travel.y) < movementThreshold) return false
        if (Math.sign(to - from) !== Math.sign(lastSwap.to - lastSwap.from)) {
          // A reversed insertion requires an actual reversal or a deliberate turn
          // of the pointer, not new hit targets along the same forward gesture.
          const length = Math.hypot(lastSwap.travel.x, lastSwap.travel.y)
          const projection = travel.x * lastSwap.travel.x + travel.y * lastSwap.travel.y
          const sideways = Math.abs(travel.x * lastSwap.travel.y - travel.y * lastSwap.travel.x)
          const reversed = projection <= -movementThreshold * length
          const turned = sideways >= Math.max(Math.abs(projection), 2 * movementThreshold * length)
          if (length > 0 && !reversed && !turned) return false
        }
      }
      pendingSwap = { point, travel, from, to }
    },
    onChange: () => {
      // Consume movement only when Sortable actually inserts the dragged card.
      if (pendingSwap) lastSwap = pendingSwap
      pendingSwap = null
    },
    onEnd: () => {
      const cards = Array.from(grid.querySelectorAll<HTMLElement>(':scope > .ct-settings-slot'))
      const keys = cards.map((card) => card.dataset.groupKey!)
      const changed = cards.some((card, index) => card !== originalCards[index])
      // React still owns the old keyed order: undo Sortable's DOM mutations before
      // asking React to commit the new state, preserving card instances/inputs.
      for (const card of originalCards) grid.appendChild(card)
      reset()
      if (changed) onReorder(keys)
    },
  })

  return {
    destroy() {
      // Sortable 1.15 calls _onDrop without an event in destroy(), so its body
      // fallback/clone removal is skipped. Capture only this instance's nodes
      // before destroy clears Sortable's static references.
      const active = Sortable.active === sortable
      const ghost = active ? Sortable.ghost : null
      const clone = active ? Sortable.clone : null
      reset()
      sortable.destroy()
      ghost?.remove()
      clone?.remove()
    },
  }
}
