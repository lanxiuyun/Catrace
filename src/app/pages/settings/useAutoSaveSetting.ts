import { useEffect, useRef, useState } from 'react'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function deepEqual<T>(a: T, b: T): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

interface Options<T> {
  initialValue: T
  load: () => Promise<T>
  save: (value: T) => Promise<void>
  debounce?: number
  isEqual?: (a: T, b: T) => boolean
  onSuccess?: (value: T) => void
  onError?: () => void
}

/**
 * React 版 useAutoSavedSetting：挂载时 load，值变化后 debounce 保存；
 * 保存失败回滚到上次成功的值并触发 onError。
 */
export function useAutoSaveSetting<T>(options: Options<T>) {
  const { initialValue, load, save, debounce = 500, isEqual = deepEqual, onSuccess, onError } =
    options

  const [value, setValue] = useState<T>(() => clone(initialValue))
  const [ready, setReady] = useState(false)
  const savedRef = useRef<T>(clone(initialValue))
  const loadedRef = useRef(false)

  useEffect(() => {
    if (loadedRef.current) return
    loadedRef.current = true
    let alive = true
    void load()
      .then((next) => {
        if (!alive) return
        savedRef.current = clone(next)
        setValue(clone(next))
        setReady(true)
      })
      .catch((error) => {
        console.error('Failed to load setting', error)
        if (alive) setReady(true)
      })
    return () => {
      alive = false
    }
    // load 只需在挂载时跑一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!ready || isEqual(value, savedRef.current)) return
    const timer = setTimeout(async () => {
      try {
        await save(clone(value))
        savedRef.current = clone(value)
        onSuccess?.(value)
      } catch (error) {
        console.error('Failed to save setting', error)
        setValue(savedRef.current)
        onError?.()
      }
    }, debounce)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, ready])

  return { value, setValue, ready }
}
