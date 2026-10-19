# Immersive Lite — 极简沉浸式翻译

[沉浸式翻译](https://immersivetranslate.com/)的极简自建替代:网页右侧一枚悬浮按钮,点击即整页双语翻译,再点还原。**零配置、无商业元素**,全部代码不到 300 行,可直接读完。

## 安装(开发者模式加载)

1. 打开 `chrome://extensions`,右上角开启「开发者模式」
2. 点「加载已解压的扩展程序」,选择本目录(`immersive-lite/`)
3. 任意网页右侧出现半透明「译」按钮,点击翻译;再次点击还原

## 设计

| 项 | 取值 |
| --- | --- |
| 目标语言 | 固定 `zh-CN`(源语言自动检测) |
| 翻译接口 | Google 免费接口 `translate.googleapis.com/translate_a/t`(`client=gtx`,无需任何 key) |
| 批量策略 | 多段文本以重复 `q` 参数单请求批量提交(单请求 ≤16 段且 ≤3200 字符) |
| 限速 | 并发 3,失败按 1.2s/2.4s 退避重试 2 次(官方默认限速约 10 次/1.05s) |
| 请求通道 | content script → background service worker 代理 fetch,绕开页面 CSP |
| 跳过内容 | `code`/`pre`/表单控件/隐藏元素;中文占比 >60% 的段落;纯数字、URL |
| 双语呈现 | 译文以弱化样式(`opacity .82`,0.94em)插在原文下方;列表/表格单元格内插入 |
| 悬浮按钮 | 默认右侧中部;**可拖拽**(移动 ≥5px 判拖拽,否则点击),位置存 `chrome.storage.local` 跨页面记忆,出界自动钳回 |
| 显隐开关 | **点击工具栏图标**切换悬浮按钮显示/关闭,状态持久;关闭时图标带 `off` 角标 |

接口与请求格式提取自官方 `dist/chrome` 构建产物中 Google 免费服务的实现
(`enableBrowserApi ? translate-pa : translate_a/t` 分支),返回 `[译文, 检测语言]` 数组,
与官方解析逻辑一致(`Array.isArray(u) ? u[0] : u`)。

## 已知边界(刻意不做)

- 不跟随 SPA 动态插入的内容(点击那一刻的页面快照)
- 不翻译 iframe 内部、划词、悬停、PDF/字幕
- 无设置页、无快捷键(按钮位置拖拽即改,无位置设置项)
- 免费接口无 SLA,Google 可能对高频 IP 临时限流;扩展已做退避,极端情况下部分段落跳过并提示

## 文件结构

```
manifest.json   MV3 清单;permissions 仅 storage(记忆按钮位置),host 仅 translate.googleapis.com
background.js   后台代理翻译请求(约 40 行)
content.js      悬浮按钮 + DOM 分段 + 批量调度 + 双语渲染
content.css     译文样式
icons/          由 scripts/icon_gen.py 生成(uv run --with pillow python scripts/icon_gen.py)
```
