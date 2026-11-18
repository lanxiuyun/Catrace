import { create } from 'zustand'

export interface AppUpdateNotice {
  version: string
  body: string
}

interface AppUpdateState {
  /** 自动检查发现的新版本；侧栏红点和设置页软件版本行共用这一份状态。 */
  notice: AppUpdateNotice | null
  setNotice: (notice: AppUpdateNotice | null) => void
}

export const useAppUpdateStore = create<AppUpdateState>((set) => ({
  notice: null,
  setNotice: (notice) => set({ notice }),
}))
