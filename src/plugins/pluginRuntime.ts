import * as React from 'react'
import * as RadixThemes from '@radix-ui/themes'
import { createPluginApi, type PluginApi } from './pluginApi'

/** External ESM modules share the host React instance; Blob modules cannot resolve bare imports. */
export type PluginReactRuntime = typeof React
export type PluginRadixRuntime = typeof RadixThemes

declare global {
  // eslint-disable-next-line no-var
  var __CATRACE_REACT__: PluginReactRuntime | undefined
  // eslint-disable-next-line no-var
  var __CATRACE_RADIX__: PluginRadixRuntime | undefined
  // eslint-disable-next-line no-var
  var __CATRACE_CREATE_PLUGIN_API__: ((pluginId: string) => PluginApi) | undefined
}

/** Install the React component contract in each WebView before importing plugin modules. */
export function ensurePluginRuntime(): void {
  globalThis.__CATRACE_REACT__ ??= React
  globalThis.__CATRACE_RADIX__ ??= RadixThemes
  globalThis.__CATRACE_CREATE_PLUGIN_API__ ??= createPluginApi
}
