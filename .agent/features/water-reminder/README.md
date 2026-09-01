# 喝水提醒

宿主不再有独立喝水模块。喝水是 **定时提醒插件（`timer`）** 的一条间隔规则/预设。

产品路径：插件中心 → 定时提醒 → 预设「喝水」，或自建间隔规则。

旧 `water.rs` / `WaterWidget` / `WaterSettingsCard` / `WaterToastCard` / 设置页喝水卡 / `kind=water` 已从宿主删除。保留 kind 列表也不再占用 `water`。

实现与调度见 [[timer-plugin]]；护眼同类路径见 [[eye-reminder]]。
