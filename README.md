# Pokechill 存档修改器

纯前端的 [Pokechill](https://play-pokechill.github.io/) 存档编辑器，部署在 GitHub Pages 上，所有数据只在浏览器本地处理，不会上传到任何服务器。

## 功能

- 导入游戏 `Settings → Export Data` 导出的 JSON，修改后导出同结构 JSON
- 宝可梦：等级、经验、IV、性格、闪光、昵称、捕获数、4 个招式槽、招式池、普通特性、隐藏特性解锁
- 详情页显示专属招式 / 蛋招式，并可一键加入招式池
- 道具：全部道具的 `got` / `newItem`，瓶盖单独置顶
- 批量操作：全部满级、全部 IV 6、解锁全部隐藏特性、所有道具 999
- 完整的图鉴筛选（属性、属性 2、等级、分级、进化、特性、闪光、专属/蛋招、缎带、标签）
- 图鉴搜索语法：空格 AND、`or` OR、`!` 排除、`ivsum>36` 等数值比较
- 按 Generation 和图鉴编号分页，每页 50
- 中英文对照显示，中文优先；招式/特性/道具下拉均可搜索中文或英文
- 深色 / 浅色主题切换（默认深色）
- 撤销 / 重做（Ctrl+Z / Ctrl+Y），最多 30 步
- 响应式布局：桌面、平板横竖屏、手机横竖屏

## 使用

1. 游戏内 `Settings → Export Data`，得到 `Pokechill-YYYY-MM-DD.json`
2. 打开修改器，点击「导入存档」
3. 修改数据
4. 点击「导出 JSON」，把文件放回游戏目录
5. 游戏内 `Settings → Import Data` 选择导出的文件

> 修改前请务必备份原始存档。`saved.version` 不会被改动，未修改的字段原样保留。

## 校验规则

导出前会校验，错误会阻止导出，警告会提示确认：

- 等级 1–100，经验 0–99，IV 0–6
- 招式槽必须是合法 move id，且同一招式不重复
- 招式池不限制「是否是普通可学招式」（蛋招/专属/遗传招必须允许）
- 隐藏特性只能给有 `hiddenAbility` 的宝可梦解锁
- 道具数量为非负整数，超过 9999 仅警告
- `saved.version` 只读

## 本地运行

```bash
python -m http.server 8765
# 打开 http://127.0.0.1:8765/
```

不能直接用 `file://` 打开，浏览器会拦截 `fetch('data/meta.json')`。

## 重新生成数据

`data/meta.json` 由脚本从游戏源码与中文数据集生成。游戏更新后重新运行：

```bash
node tools/build-meta.mjs
```

默认读取同级目录：

- `../play-pokechill.github.io`（游戏源码）
- `../pokemon-dataset-zh`（中文名数据）

也可以显式传路径：

```bash
node tools/build-meta.mjs /path/to/pokechill /path/to/pokemon-dataset-zh
```

生成内容：

- 1407 个宝可梦条目（含 mega / Gmax / 地区形态），图鉴编号、Generation、分级、BST 星级、进化关系
- 417 个招式
- 195 个特性
- 507 个道具
- 中文名：精确匹配数据集 `name_en` 后取 `name_zh`；形态词按官方译名拼接；匹配不到或本作原创的保持英文

## 部署

仓库根目录就是站点根目录，不需要构建：

1. 推送到 GitHub
2. `Settings → Pages`
3. Source 选择 `Deploy from a branch`，分支 `main`，目录 `/ (root)`

## 免责声明

这是非官方的第三方工具，与 Pokechill 作者无关。使用前请备份存档，因修改存档导致的进度丢失由使用者自行承担。
