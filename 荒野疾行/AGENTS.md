# 荒野疾行：AI 项目上下文

## 项目目标与玩法

单页网页恐龙跑酷游戏。玩家通过跳跃、下蹲躲避障碍，收集金币提升距离纪录；金币可用于解锁和升级飞行器、双倍金币道具。支持键盘和触屏操作，进度保存在当前浏览器。

## 技术栈与目录

- 原生 HTML、CSS、JavaScript；Canvas 2D 绘制，无框架、构建工具或第三方运行时依赖。
- 当前项目只有根目录文件：`index.html`（页面、样式与游戏逻辑）、`README.md`（项目简介）、`star_game.bat`（启动本地静态服务器）、`.gitignore`。
- 游戏画面和角色由 Canvas/CSS 绘制；字体通过 CSS 从 Google Fonts 加载。没有独立素材目录。

## 常用命令

- 无需安装依赖；当前没有 `package.json`，不要使用 npm 命令。
- 开发预览：`python -m http.server 8000`，然后打开 `http://localhost:8000`；也可运行 `star_game.bat`。
- 构建、自动化测试和部署目前均未配置。项目是静态网页；不要假定已选定 GitHub Pages、Vercel 或 Netlify，也不要声称已部署。
- 修改后至少在浏览器检查主界面、开始游戏、键盘/触屏操作、商店和本地存档。

## 核心模块

游戏逻辑目前集中在 `index.html` 的内联脚本中：

- 游戏循环：`requestAnimationFrame` 驱动 `frame`、`updateGame` 和 `drawGame`。
- 玩家控制：`jump`、`duck`、`activateFlight`、`activateDouble`；支持 Space/方向键、F/G 和触屏按钮。
- 障碍物与金币：`spawnObstacle`、`spawnCoins` 按距离生成。
- 碰撞检测：`hitObstacle` 按障碍类型、跳跃/下蹲/飞行状态判定。
- 计分与存档：`collectCoin`、`finishRun` 更新金币和纪录；`loadSave`、`persist` 使用 `localStorage`。
- 商店、排行榜和界面切换：`renderShop`、`purchase`、`renderLeaderboard`、`showView`。
- 绘制与资源：Canvas 绘制游戏场景、角色、障碍、金币和粒子；目前没有音效模块，也没有本地图片/音频资源加载模块。不要假定这些功能已实现。

## 代码约定

- 缩进使用 2 个空格；JavaScript 使用双引号并加分号。修改时沿用 `index.html` 的现有格式。
- 函数和变量使用 `camelCase`，常量使用 `UPPER_SNAKE_CASE`；DOM 元素按现有 `id` / `class` 命名。
- 保持当前单页组织方式；若任务要求拆分文件，先说明方案并确保资源路径在静态服务器及部署环境中可用。
- 不要忽略或移除源码、游戏画面或未来添加的素材；`.gitignore` 不应屏蔽源码、`public` 静态资源或 `.env.example` 等模板。
- 不要改动 `star_game.bat`、`README.md` 或 `.gitignore`，除非任务确实涉及对应文件；不要添加密钥、密码或真实环境变量。

## 当前进度与待办

- 已实现：主界面、跑酷循环、障碍和金币、碰撞、距离/金币计分、排行榜、升级商店、浏览器本地存档及键盘/触屏控制。
- 尚未配置：自动化测试、构建流程和部署平台；当前没有独立音效或本地素材加载模块。
- 仓库未记录正式待办清单。接到新需求时先核对现状，不要把建议当作已确认任务。

## 给 AI 的协作规则

1. 修改前先阅读本文件、`README.md`、`index.html`；涉及启动、忽略规则或部署时，再阅读 `star_game.bat`、`.gitignore` 及相关现有配置。
2. 优先复用原生浏览器能力和现有代码；未经用户明确要求，不引入依赖，不新增框架、构建工具或配置。
3. 保持玩法、触屏适配、本地存档和现有部署可用；不要覆盖或重置用户已有的本地进度。
4. 修改范围尽量小；不要改无关文件。没有明确要求时，不创建或改动构建、测试、部署配置。
5. 完成后说明改了什么、如何验证；若未能运行浏览器检查，明确说明未验证的部分。
6. 不要在文件、示例或输出中写入任何密钥、密码或真实 `.env` 内容。
