import type { ComponentType } from 'react'

/** React functions/classes and React's memo/forwardRef descriptors are valid module exports. */
export function isPluginComponent<P>(value: unknown): value is ComponentType<P> {
  if (typeof value === 'function') return true
  if (!value || typeof value !== 'object') return false
  const tag = (value as { $$typeof?: unknown }).$$typeof
  return tag === Symbol.for('react.memo') || tag === Symbol.for('react.forward_ref')
}
