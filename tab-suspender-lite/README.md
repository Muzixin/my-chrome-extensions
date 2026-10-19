# Tab Suspender Lite — 极简标签页休眠

基于 Chrome MV3 的极简标签页休眠扩展。标签离开活动状态并超过设定时间后，调用浏览器原生 `tabs.discard()` 卸载页面内存；再次点击标签时由 Chrome 重新加载。

## 功能

- 默认闲置 30 分钟后休眠，可在弹窗中调整为 1～10080 分钟。
- 白名单不限数量，支持手动添加、删除和一键加入当前网站。
- 域名规则同时覆盖本域及子域，例如 `example.com` 覆盖 `app.example.com`。
- 活动、固定、有声、已休眠、正在加载及非 HTTP(S) 标签不会休眠。
- 顶层页面及 HTTP(S) iframe 存在未保存输入时暂缓休眠；未被页面取消的表单提交或重置会解除对应保护。
- 无广告、无付费限制、无许可证校验、无统计、无外部网络请求。

## 安装

1. 打开 `chrome://extensions`，开启「开发者模式」。
2. 点击「加载已解压的扩展程序」，选择本目录 `tab-suspender-lite/`。
3. 点击工具栏图标设置休眠时间并维护白名单。

扩展安装或重新加载之前已经打开的页面，需要刷新一次才会注入表单保护脚本；刷新前无法确认表单状态，因此会暂缓这些标签的自动休眠。

## 数据与权限

- `alarms`：每分钟检查一次超时标签。
- `storage`：休眠时间和白名单存于 `storage.local`；标签活动时间仅保存在浏览器会话内存中。
- `tabs`：读取标签状态与网址、执行原生休眠。
- `webNavigation`：枚举标签内的 frame，以便逐一确认表单状态；不持久化 frame 地址或导航记录。
- 内容脚本只在各 frame 内记录被编辑的控件，并仅在后台询问时返回“是否有未保存内容”；不上传表单内容或浏览历史。无法确认任一 HTTP(S) frame 的状态时，后台会保守地跳过本次休眠。

表单保护采用保守策略：撤销编辑但尚未提交或重置时，仍可能继续保护标签。页面通过 `preventDefault()` 接管提交或重置时也不会立即清除保护；SPA 保存完成后可刷新页面清除状态。

## 文件结构

```text
manifest.json     MV3 清单
background.js     活动时间跟踪、白名单过滤与原生休眠
content.js        未保存表单检测
utils.js          域名、设置和标签资格的纯函数
popup.*           休眠时间与白名单界面
icons/            扩展图标
tests/            Node.js 纯函数测试
scripts/          图标生成脚本
```

## 校验

```bash
node --check background.js
node --check content.js
node --check popup.js
node --test tests/*.test.js
uv run --with pillow python -I scripts/icon_gen.py
```
