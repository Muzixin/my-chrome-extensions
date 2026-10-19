# my-chrome-extensions

Chrome 浏览器扩展 Monorepo。每个扩展使用独立的一级子目录，保留各自的 `manifest.json`、源码和说明文档。

## 扩展列表

| 目录 | 说明 |
| --- | --- |
| [`immersive-lite/`](immersive-lite/) | 极简沉浸式翻译：整页双语翻译与还原。 |

## 本地加载

1. 打开 `chrome://extensions` 并开启「开发者模式」。
2. 点击「加载已解压的扩展程序」。
3. 选择具体扩展目录，例如 `immersive-lite/`，不要选择仓库根目录。

新增扩展时，在仓库根目录下新建独立目录，并补充对应的 README 和上方列表。
