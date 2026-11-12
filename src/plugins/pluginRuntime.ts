import * as React from 'react'
import * as RadixThemes from '@radix-ui/themes'
import * as HeroUI from '@heroui/react'
import { createPluginApi, type PluginApi } from './pluginApi'

/**
 * External ESM modules share the host React instance; Blob modules cannot resolve bare imports.
 * HeroUI is the host's own component library, so injected plugin UI gets the exact same
 * components, theme tokens and dark-mode behaviour as the host pages without shipping a copy.
 */
export type PluginReactRuntime = typeof React
export type PluginRadixRuntime = typeof RadixThemes
export type PluginHeroUIRuntime = typeof HeroUI

declare global {
  // eslint-disable-next-line no-var
  var __CATRACE_REACT__: PluginReactRuntime | undefined
  // eslint-disable-next-line no-var
  var __CATRACE_RADIX__: PluginRadixRuntime | undefined
  // eslint-disable-next-line no-var
  var __CATRACE_HEROUI__: PluginHeroUIRuntime | undefined
  // eslint-disable-next-line no-var
  var __CATRACE_CREATE_PLUGIN_API__: ((pluginId: string) => PluginApi) | undefined
}

/** Install the React component contract in each WebView before importing plugin modules. */
export function ensurePluginRuntime(): void {
  globalThis.__CATRACE_REACT__ ??= React
  globalThis.__CATRACE_RADIX__ ??= RadixThemes
  globalThis.__CATRACE_HEROUI__ ??= HeroUI
  globalThis.__CATRACE_CREATE_PLUGIN_API__ ??= createPluginApi
}
