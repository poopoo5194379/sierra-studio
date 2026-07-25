# SierraStudio

> 本地优先的视觉化 HTML 编辑器 + PDF 导出工作台。
> A local-first visual HTML editor and PDF export studio.

SierraStudio 把 GrapesJS 风格的 DOM 编辑器和 pdf-lib 排版引擎塞进同一个 Electron 应用。
你可以**双击修改任意 HTML 元素**、**插入图表/卡片组件/分割线**、**导出高质量 PDF**，
所有数据保存在本地 SQLite，云端只用来同步版本（可选）。

## 快速开始

```bash
npm install
npm run dev          # 启动开发模式（Electron + Vite hot-reload）
```

## 打包发布

```bash
npm run pack         # 生成 release/SierraStudio Setup 0.1.0.exe
```

## 自动更新

发布新版到 GitHub Releases 后，已安装用户会在工具栏"检查更新"按钮上收到推送。

设置环境变量：

```bash
export SIERRASTUDIO_UPDATE_REPO=你的用户名/sierra-studio
SierraStudio.exe
```

## 架构

| 层 | 文件 |
|------|------|
| 主进程 | `src/main/` |
| preload 桥 | `src/preload/index.ts` |
| 渲染进程（React UI） | `src/renderer/src/App.tsx` |
| 编辑器运行时（iframe 内） | `src/editor-runtime/index.ts` |
| 命令 / 领域层 | `src/domain/`、`src/application/`、`src/infrastructure/` |
| Cloudflare Worker（云同步） | `workers/api.ts` |

## License

MIT
