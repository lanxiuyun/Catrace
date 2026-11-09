# 插件详情内容区边界

[PluginCenter.tsx](../../../src/app/pages/plugins/PluginCenter.tsx) 统一拥有整页详情外壳；内置 React 设置和外部 Vue 设置只提供业务内容。页面交互以[插件中心](README.md)为真源。

## 挂载结构

```text
PageScroll.ct-plugin-scroll
└── .ct-plugins-page
    └── .ct-plugin-detail
        ├── .ct-plugin-detail-nav       # 吸顶返回条
        ├── .ct-plugin-detail-header    # 图标、名称、版本、总开关 / 安装
        └── .ct-plugin-detail-body
            ├── RestSettings           # 内置久坐提醒
            └── ExternalPluginSettings # 已启用的外部插件 → VueIsland
```

## 宿主与面板分工

- 宿主负责页面 padding、内容列最大宽度、标题、总开关和唯一纵向滚动区。
- 详情内容列 `max-width: 48.5rem`，导航与内容使用相同的左边缘算法；响应式边距只在宿主 [plugins.css](../../../src/app/pages/plugins.css) 调整。
- 面板根节点吃满内容列，只写业务卡片、规则列表和控件内部的间距，不再叠加根 padding / max-width / 水平居中。
- 总开关只在宿主标题行；外部插件未启用时不挂载设置模块。
- 外部 Vue 浮层可以 teleport 到 body，样式应自包含，不依赖设置根节点选择器。

设置行与控件尺寸见[行语言与控件规范](插件详情页设置面板的行语言与控件尺寸规范.md)，外部模块合同见[外部插件加载](../../architecture/desktop-event-os/m10-external-plugins.md)。
