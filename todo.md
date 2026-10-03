codex 跳转APP对话 https://github.com/bohu8264/N-Agent-Bridge/releases/tag/v0.15.0-development
sms活跃提醒有bug，我那一分钟前30秒活跃了，后30秒去厕所了，可能就错过了这个通知。所有活跃提醒都有这个bug
api 调整为 webhook?先了解一下先
发小红书
用React来重构，让插件也支持使用 React，并且支持第三方包

添加类似rubick的启动器功能？
dsh 通知，dsh小窗模式
整个框架重构，像 DSH 一样，把所有的页面设置、信息统计面板都做成插件化？

## 已完成
测试 toast window 弹出是否会影响全屏游戏
测试 toast window 弹出是否会影响输入法是否正在输入
toast window 光标穿透，并且能交互卡片（已完成）
优化toast卡片的消失速度（已完成）
toast window 使用 n-scrollbar 来显示滚动高度(已废弃，当前版本的滚动区域更简洁。)
优化sms插件描述
更新版本号，安装新版本测试
特殊日通知
app黑名单自动排序：输入新项后，下次进入设置页自动排序（已做：失焦排序 + localeCompare zh 拼音排序）
锁屏时通知 package name 是 com.android.mms，一旦添加，后续锁屏短信不会推送；需增加 title 黑名单过滤：包名是 com.android.mms 时按 title 匹配黑名单
定时提醒， 护眼提醒的 toast 颜色，允许设置颜色,允许设置提示音，自定义提示音
本机进程tag去掉
agent通知抽离
久坐提醒抽离
插件页面支持设置图标（已完成）
node自动安装
agent通知，完善opencode 以及 opencode小窗计划
轻量模式（issue #82，两期已落地，PR #83 已合并进 main）
windows 通知劫持 → 系统通知转发（#87 已上线；26.10.2 补通知本体点击跳转）
ReminderToast.vue 重构
log 日志瘦身 + 全窗口 F12 DevTools + 插件日志全链路可见（PR #92 已合并进 main 3e9c128；Toast 窗点卡片拿焦点后按 F12 可看 [plugin:xxx] 日志；全量排查设 CATRACE_LOG_LEVEL=debug）
