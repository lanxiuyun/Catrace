/// <reference types="vite/client" />

import type { PluginReactRuntime, PluginRadixRuntime } from './plugins/pluginRuntime'

declare global {
  // External plugin Blob modules share the host React and Radix runtimes.
  // eslint-disable-next-line no-var
  var __CATRACE_REACT__: PluginReactRuntime | undefined
  // eslint-disable-next-line no-var
  var __CATRACE_RADIX__: PluginRadixRuntime | undefined
}

export {}
