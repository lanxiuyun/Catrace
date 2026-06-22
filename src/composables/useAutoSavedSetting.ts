import { ref, watch, onMounted, type Ref } from 'vue'

export interface UseAutoSavedSettingOptions<T> {
  initialValue: T
  load: () => Promise<T>
  save: (value: T) => Promise<void>
  debounce?: number
  isEqual?: (a: T, b: T) => boolean
  onSuccess?: (value: T) => void
  onError?: () => void
}

export interface UseAutoSavedSettingReturn<T> {
  value: Ref<T>
  loading: Ref<boolean>
  isReady: Ref<boolean>
  refresh: () => Promise<void>
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

function deepEqual<T>(a: T, b: T): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function useAutoSavedSetting<T>(options: UseAutoSavedSettingOptions<T>): UseAutoSavedSettingReturn<T> {
  const {
    initialValue,
    load,
    save,
    debounce = 500,
    isEqual = deepEqual,
    onSuccess,
    onError,
  } = options

  const value = ref<T>(deepClone(initialValue)) as Ref<T>
  const savedValue = ref<T>(deepClone(initialValue)) as Ref<T>
  const loading = ref(false)
  const isReady = ref(false)
  let saveTimer: ReturnType<typeof setTimeout> | null = null

  async function refresh() {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    const v = await load()
    value.value = deepClone(v)
    savedValue.value = deepClone(v)
  }

  onMounted(async () => {
    try {
      await refresh()
      isReady.value = true
    } catch (e) {
      console.error('Failed to load setting', e)
    }
  })

  watch(
    () => value.value,
    async (newVal) => {
      if (!isReady.value) return
      if (isEqual(newVal, savedValue.value)) return

      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(async () => {
        loading.value = true
        try {
          await save(deepClone(newVal) as T)
          savedValue.value = deepClone(newVal)
          onSuccess?.(deepClone(newVal) as T)
        } catch (e) {
          console.error('Failed to save setting', e)
          value.value = deepClone(savedValue.value)
          onError?.()
        } finally {
          loading.value = false
          saveTimer = null
        }
      }, debounce)
    },
    { deep: true }
  )

  return { value, loading, isReady, refresh }
}
