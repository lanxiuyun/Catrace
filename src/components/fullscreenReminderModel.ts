import type { CSSProperties } from 'react'
import { DEFAULT_ELEMENT_TRANSFORMS, type ElementTransform, type ElementTransforms } from '../api/tauri'

export type FullscreenElementName = keyof ElementTransforms
export const FULLSCREEN_ELEMENT_NAMES: FullscreenElementName[] = ['title', 'body', 'countdown', 'actions']

/** Window and inline preview must resolve saved layouts in exactly the same way. */
export function readFullscreenTransforms(serialized = ''): ElementTransforms {
  const result: ElementTransforms = {
    title: { ...DEFAULT_ELEMENT_TRANSFORMS.title },
    body: { ...DEFAULT_ELEMENT_TRANSFORMS.body },
    countdown: { ...DEFAULT_ELEMENT_TRANSFORMS.countdown },
    actions: { ...DEFAULT_ELEMENT_TRANSFORMS.actions },
  }
  if (!serialized) return result
  try {
    const parsed = JSON.parse(serialized) as Partial<ElementTransforms> | null
    if (!parsed || typeof parsed !== 'object') return result
    for (const name of FULLSCREEN_ELEMENT_NAMES) {
      const saved = parsed[name]
      if (!saved || typeof saved !== 'object') continue
      for (const field of ['x', 'y', 'scale', 'rotate'] as const) {
        if (typeof saved[field] === 'number' && Number.isFinite(saved[field])) {
          result[name][field] = saved[field]
        }
      }
    }
  } catch { /* Invalid saved JSON falls back to the default layout. */ }
  return result
}

export function fullscreenElementStyle(transform: ElementTransform): CSSProperties {
  return {
    left: `${transform.x}%`,
    top: `${transform.y}%`,
    transform: `translate(-50%, -50%) scale(${transform.scale}) rotate(${transform.rotate}deg)`,
  }
}

export function formatFullscreenTime(seconds: number): string {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}
