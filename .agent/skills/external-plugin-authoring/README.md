# Catrace 外部插件开发（公开手册）

面向**插件作者**与 AI：不需要 Catrace 源码，只要本机已安装 Catrace，即可按本文生成可加载的插件包。

## 你会得到什么

- 插件如何被扫描、启用、发 Toast
- `manifest` / 自定义卡 / 设置页 / 后台脚本 / 本机 sidecar 的完整合同
- 可直接复制的文件模板

## 文档

| 文件 | 内容 |
|------|------|
| [how-to-develop-catrace-external-plugins-complete-guide.md](how-to-develop-catrace-external-plugins-complete-guide.md) | 完整开发指南 |
| [plugin-file-scaffolds-and-copy-paste-templates.md](plugin-file-scaffolds-and-copy-paste-templates.md) | 拷贝即用的脚手架 |

## 安装插件（无源码）

1. 打开 Catrace → 插件相关界面 → **打开插件目录**（若版本提供该入口）。
2. 在打开的 `plugins` 文件夹下新建子目录，**目录名 = 插件 id**（小写字母、数字、连字符）。
3. 放入 `manifest.json` 及本文要求的脚本文件。
4. 回到 Catrace **重新扫描 / 重启应用**后，在插件列表中**启用**该插件。

> 启用插件 = 信任其全部本地代码（含 sidecar 子进程）。不要安装来路不明的插件。

## 需要的运行环境

| 场景 | 要求 |
|------|------|
| 仅 ui / settings / background | 已安装并可运行的 Catrace |
| 使用 sidecar 且 command 为 `node` | 系统 PATH 中有 Node.js |
| sidecar 自带依赖 | 作者自行打包或说明用户如何安装；**Catrace 不会**替插件执行 `npm install` |
