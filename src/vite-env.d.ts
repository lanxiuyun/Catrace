/// <reference types="vite/client" />

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<{}, {}, any>;
  export default component;
}

import type {
  PluginNaiveRuntime,
  PluginUiRuntime,
  PluginVueRuntime,
} from "./plugins/pluginRuntime";

declare global {
  // External plugin Blob modules read these host-injected globals.
  // eslint-disable-next-line no-var
  var __CATRACE_VUE__: PluginVueRuntime | undefined;
  // eslint-disable-next-line no-var
  var __CATRACE_NAIVE__: PluginNaiveRuntime | undefined;
  // eslint-disable-next-line no-var
  var __CATRACE_UI__: PluginUiRuntime | undefined;
}

export {};
