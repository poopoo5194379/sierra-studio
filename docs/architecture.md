# SierraStudio Architecture

## 不可破坏的约束

1. 只有 Electron Main 可以访问文件系统与 SQLite。
2. 导入的原稿只读，编辑只发生在可重建的 working copy。
3. 已校验的 checkpoint 与有序 command log 是唯一事实来源。
4. 每次持久化修改都是带 before/after 的版本化命令。
5. iframe 使用 opaque-origin sandbox；用户脚本、联网、弹窗和对象嵌入均禁用。
6. 几何和用户明确修改的样式写入节点内联 CSS，并完整保留旧值与 `!important`。
7. 编辑器覆盖框只存在于 runtime，不写入项目 HTML。

## 进程与依赖边界

```text
React host ──typed postMessage──> Editor Runtime (sandboxed iframe)
    │                                  │ optimistic DOM mutation
    └──narrow preload IPC──> Electron Main
                                  │
                            ProjectManager
                              │         │
                        ProjectSession  AssetImporter
                              │         │
                          SQLite     Filesystem/PostCSS
```

- React host 只保存项目元数据、选择状态和当前 revision，不持有整份 HTML。
- iframe 通过 `htmlstudio-project://<id>/working/index.html` 直接读取物化文件。
- Editor Runtime 是独立、类型化的构建入口，不是拼接进 HTML 的字符串。
- CommandCoordinator 串行提交乐观修改；提交失败立即重载权威 working copy。
- Domain command schema 不依赖 Electron、React、文件系统或 SQLite。

## 本地协议边界

`htmlstudio-project:` 只公开：

- `working/index.html`
- `assets/**`

`project.sqlite`、`project.json`、`source/**` 和 `snapshots/**` 均不可通过协议读取。
Main 在返回 working HTML 时注入严格 CSP 与唯一允许的
`htmlstudio-runtime://bundle/editor-runtime.js`。画布禁止任意网络连接。

## 项目目录

```text
project/
├── project.json
├── project.sqlite
├── source/
│   └── index.original.html
├── working/
│   └── index.html
├── assets/
└── snapshots/
```

导入先在同级 `.staging-<project-id>` 中完成。只有原稿、资源、数据库、
checkpoint 和 working copy 全部成功后才原子改名为正式项目；失败会删除 staging。

## 写入、恢复与历史

每条命令按以下顺序处理：

1. 校验 envelope、documentId 和 base revision。
2. 在内存模型上计算 next HTML。
3. 在一个 SQLite 事务写入 payload、inverse 与 head revision。
4. 原子替换 `working/index.html`。
5. 每 50 个 revision 写 Brotli checkpoint。

启动、撤销和重做始终从最近 checkpoint 开始严格 Replay，不修补可能过期的
working 文件。revision 0 永久保留，另保留最近 3 个 checkpoint，旧文件与数据库
记录同步清理。SQLite 使用显式 `PRAGMA user_version` 迁移版本。

## 布局策略

- Flow 是默认模式；识别出的重复卡片在同一父容器内换位，邻居由浏览器布局自动补位。
- Absolute/Fixed 元素直接修改内联 `left/top`。
- 转为自由定位时，以直接父容器为 containing block；仅在必要时给直接父级添加
  `position: relative`，并补偿边框和滚动量。
- 图片插入到点击位置所在 `.page` 的 `.page-inner`，使用显式高层级，不跨页查找容器。

## 导入与导出

AssetImporter 使用 DOM parser、PostCSS 与 `postcss-value-parser` 处理 HTML 资源、
外链 CSS、`url()` 和 `@import`。资源以 SHA-256 命名并去重，不使用正则解析 CSS。
导出时移除全部 `data-hs-id`，不会包含 runtime 或选择框。

## PDF 导出子系统

PDF 不是 Renderer 按钮里的临时脚本，而是独立的端到端能力：

```text
PDF Export Dialog
  -> narrow preload IPC
  -> PdfExportService
  -> PdfRenderer port
  -> ElectronPdfRenderer
       -> BrowserDocumentAnalyzer
       -> SmartPagination (pure domain)
       -> PdfComposer (pdf-lib)
```

- `long` 模式按实际 DOM 尺寸生成单页矢量 PDF。
- `smart` 模式先生成同一份单页矢量源，再根据显式页面、标题、视觉模块、
  卡片、图片和表格行计算安全切线，最后无损裁切为多页 PDF。
- 导出使用当前已提交的 working revision；专用 `?export=1` 文档响应不注入
  Editor Runtime，因此选框、缩放点和编辑脚本不会进入 PDF。
- 页面稳定阶段等待字体和图片、触发懒加载、禁用动画和滚动吸附，并把
  `vh/vw/vmin/vmax` 冻结为像素值。
- 分页规划是纯函数并有单元测试；Electron、DOM 分析和 `pdf-lib` 分别位于
  基础设施适配器中。

## 验证要求

- command 应用、inverse、checkpoint 校验与 Replay 的单元测试；
- CSS 嵌套资源导入测试；
- CSP/runtime 注入测试；
- Electron 导入冒烟测试；
- 使用真实大文件验证卡片换位、当前页图片插入及控制台零错误。
