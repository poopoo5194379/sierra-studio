# SierraStudio 功能架构边界

本文约束响应式、主题、组件、数据绑定、文档导航、命名快照和交互管理的实现。
这些能力不能继续直接堆入 `App.tsx` 或 `editor-runtime/index.ts`。

## 1. 分层

```text
domain/
  responsive/       断点、级联、规则与审计结果
  theme/            设计令牌与主题 CSS
  components/       组件定义、实例覆盖与升级
  data/             数据源、字段映射、重复器
  versions/         命名快照与差异模型
application/
  projects/         用例编排，不包含 DOM/UI 细节
infrastructure/
  sqlite/           项目能力数据、迁移、快照
editor-runtime/
  features/         iframe 内 DOM 读取、预览和命令生成
renderer/
  features/         独立面板、hooks 和 view-model
```

依赖方向固定为：

```text
renderer -> application/shared protocol -> domain
main -> application -> domain
infrastructure -> domain ports
editor-runtime -> domain/shared protocol
```

领域层不得依赖 Electron、React、DOM 或 SQLite。

## 2. 事实来源

- 原始导入文件继续不可变。
- 工作 HTML 是可导出的物化视图。
- SQLite command log 是 HTML 编辑历史的事实来源。
- 项目级主题、断点、组件、数据源和命名快照是结构化项目数据，不以 React state
  或 `localStorage` 为事实来源。
- 导出所需样式必须使用稳定 class/CSS 变量；不能依赖会在导出时清除的
  `data-hs-id`。
- iframe 只能生成可校验的命令或报告，不能直接写项目文件或数据库。

## 3. 命令与撤销

- 用户可见的持久修改必须是版本化命令。
- 一个用户动作涉及 DOM 与样式表时，必须原子提交，不能产生“撤销一次只恢复一半”。
- 高频拖动、调色和断点预览走 Preview；失焦或确认时才 Commit。
- 新命令必须提供 inverse、replay、checkpoint recovery 和 packaged E2E。

## 4. 响应式

- 画布设备与 CSS 断点是两个概念：设备负责预览宽高，断点决定规则作用域。
- 导入已有 `@media` 时先解析和展示，不覆盖原规则。
- SierraStudio 新增规则写入独立 managed stylesheet。
- 元素使用稳定的导出 class；编辑器节点 ID 只负责编辑期寻址。
- PDF 始终显式使用导出配置的 viewport，不继承编辑器当前手机画布。

## 5. 主题

- 主题使用 CSS custom properties 输出，项目结构化数据保留令牌名称、类型和模式。
- 自动提取只产生建议；用户确认后才创建变量和替换引用。
- 浅色/深色为同一令牌集的不同 mode，不复制整份页面。

## 6. 组件

- 组件定义、实例和实例覆盖分离。
- 实例覆盖只能作用于显式暴露的文字、图片、链接、可见性和数据字段。
- 主组件升级必须保留版本，并提供冲突结果；不能静默覆盖实例内容。
- “分离实例”产生普通 DOM，之后不再接收组件升级。

## 7. 数据绑定

- 数据源保存原始数据摘要、schema 和字段类型；页面只保存稳定 source/field 引用。
- 更新数据必须保留组件样式和图表表现配置。
- 解除绑定会物化当前值并清除 binding metadata。
- 批量生成先预览数量、缺失字段和输出名称，再一次提交。

## 8. 大文档与审计

- 图层/大纲搜索使用 runtime 生成的轻量索引，不把完整 DOM 镜像进 React。
- 5000 个以上节点的树采用增量查询或虚拟化，不一次渲染全部节点。
- 响应式检查、链接检查和视觉对比产生结构化报告；UI 只负责筛选和定位。
- 审计必须区分 error、warning、info，并提供可执行的修复动作。

## 9. 发布门槛

每个能力至少通过：

1. 领域纯函数单元测试；
2. command inverse/replay 测试；
3. 大型真实 HTML Electron E2E；
4. 导出后重新导入；
5. packaged EXE 回归；
6. 旧项目 schema 迁移测试。

