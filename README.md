# SierraStudio

> 本地优先的视觉化 HTML 编辑器 + PDF 导出工作台。
> A local-first visual HTML editor and PDF export studio.

SierraStudio 把 GrapesJS 风格的 DOM 编辑器和 pdf-lib 排版引擎塞进同一个 Electron 应用。
你可以**双击修改任意 HTML 元素**、**插入图表/卡片组件/分割线**、**导出高质量 PDF**，
所有数据保存在本地 SQLite，云端只用来同步版本（可选）。

应用会列出最近导入的项目，并在下次启动时恢复最后打开的项目。
云同步默认关闭；公网部署前必须配置允许来源和管理员密钥，详见
[`docs/CLOUD_DEPLOY.md`](docs/CLOUD_DEPLOY.md)。

## 快速开始

```bash
npm install
npm run dev          # 启动开发模式（Electron + Vite hot-reload）
npm run check        # 类型检查、单元测试和生产构建
npm run test:e2e     # Electron + iframe 核心交互冒烟
npm run test:e2e:full # 51 项编辑器交互回归
```

当前回归基线：

```text
Unit: 40/40
Electron E2E: 53/53
```

## 打包发布

```bash
npm run pack         # 生成 release/SierraStudio Setup 0.3.4.exe
```

本地安装包只用于开发测试。正式对外发布必须使用 GitHub Actions 的干净
Windows Runner。仓库提供 `Secure Windows Build` 手动验证工作流，以及
Microsoft Defender 扫描、SBOM、SHA-256 和构建来源证明的标签发布工作流。
Authenticode 签名为可选项，未签名版本会明确标注。配置步骤见
[`docs/SECURE_RELEASE.md`](docs/SECURE_RELEASE.md)。

## 自动更新

发布新版到 GitHub Releases 后，已安装用户会在工具栏"检查更新"按钮上收到推送。

设置环境变量：

```bash
export SIERRASTUDIO_UPDATE_REPO=你的用户名/sierra-studio
SierraStudio.exe
```

## 架构

建议开发前先阅读
[`html编辑器-迭代记录.md`](html编辑器-迭代记录.md)，其中包含当前架构、
历史决策、Bug 根因库、禁止事项、测试门槛和新项目开工清单。

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
