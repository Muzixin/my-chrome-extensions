# Ulauncher File Search (EN/CN)

**Ulauncher 插件**(Linux 启动器,非 Chrome 扩展;本仓库为个人工具 monorepo)。

Ulauncher v5 扩展:基于 **plocate** 全盘索引的文件名搜索,支持:

- 英文文件名(子串,不区分大小写)
- 中文文件名(直接输入汉字)
- 拼音全拼(如 `baobiao` → 报表.xlsx)
- 拼音首字母(如 `bb` / `zfbj` → 报表 / 支付报表)

## 使用

- 关键词默认 `f`,后跟搜索词:`f 报表`、`f zfbj`、`f report`
- **回车**:打开文件;**Alt+回车**:打开所在目录
- 偏好设置(Ulauncher 设置 → 扩展 → File Search):
  - `Max results`:最大结果数(默认 10)
  - `Exclude paths`:逗号分隔的路径子串黑名单(默认 `/.cache/,/.git/,/snap/`)

## 原理

- 直接匹配:每次查询调用 `plocate -i -l N -- <query>`(毫秒级,系统索引)
- 拼音匹配:启动时从 plocate 全量导出中筛出文件名含 CJK 的条目,
  用 pypinyin 生成全拼/首字母键存内存,并缓存到
  `~/.cache/ulauncher-file-search/pinyin_index.pickle`(按 db mtime+size 失效重建)
- 新文件要等 `updatedb` 刷新(系统默认每天一次);手动刷新:`sudo updatedb`

## 安装(本机已装)

```bash
ln -s ~/projects/my-chrome-extensions/ulauncher-file-search ~/.local/share/ulauncher/extensions/ulauncher-file-search
# 重启 ulauncher 生效
```

## 依赖

- `plocate`(系统索引,Ubuntu 默认自带)
- pypinyin:已 vendor 到 `vendor/`(零外部依赖;重装:`uv pip install --target vendor pypinyin`)

## 测试

```bash
uv run --no-project python test_logic.py
```
