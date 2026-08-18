更新 readme，官网，发小红书
node自动安装
插件页面支持设置图标
codex 跳转页面 https://github.com/bohu8264/N-Agent-Bridge/releases/tag/v0.15.0-development
sms活跃提醒有bug，我那一分钟前30秒活跃了，后30秒去厕所了，可能就错过了这个通知。所有活跃提醒都有这个bug
定时提醒， 护眼提醒的 toast 颜色，允许设置颜色,允许设置提示音，自定义提示音
agent通知，完善opencode 以及 opencode小窗计划
ReminderToast.vue 重构
本机进程tag去掉?
api 调整为 webhook?先了解一下先
agent通知抽离
久坐提醒抽离
sms插件：com.android.mms 添加进黑名单无效 — 锁屏时通知 package name 是 com.android.mms，一旦添加，后续锁屏短信不会推送；需增加 title 黑名单过滤：包名是 com.android.mms 时按 title 匹配黑名单（已做：title 过滤 + block-app 按发送者拉黑 + 黑名单自动排序，插件 v0.1.2）
app黑名单自动排序：输入新项后，下次进入设置页自动排序（已做：失焦排序 + localeCompare zh 拼音排序）

## 已完成
toast window 光标穿透，并且能交互卡片（已完成）
优化toast卡片的消失速度（已完成）
toast window 使用 n-scrollbar 来显示滚动高度(已废弃，当前版本的滚动区域更简洁。)
优化sms插件描述
测试 toast window 弹出是否会影响全屏游戏
更新版本号，安装新版本测试
特殊日通知
