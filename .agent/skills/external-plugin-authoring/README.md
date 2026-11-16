# Catrace 外部插件开发入口

开发或修改外部插件时，进入独立仓库 [catrace-plugin](https://github.com/lanxiuyun/catrace-plugin)，先读其 [README](https://github.com/lanxiuyun/catrace-plugin/blob/main/README.md) 与 [SKILL](https://github.com/lanxiuyun/catrace-plugin/blob/main/SKILL.md)。插件业务、模板、测试与插件专属知识在该仓库维护。

修改宿主接入边界时，按任务读取：

- [外部插件合同](../../architecture/desktop-event-os/m10-external-plugins.md)：manifest、卡片、设置与源码加载。
- [Sidecar Runtime](../../architecture/desktop-event-os/plugin-native-sidecar-runtime.md)：进程托管、JSONL、RPC 与动作回传。
- [宿主桌面 API](../../architecture/desktop-event-os/外部插件-settings调用宿主桌面能力-demo.md)：WebView facade、Rust 能力边界与实现真源。
- [插件中心](../../features/plugin-center/README.md)：仓库安装、启用与卸载。
