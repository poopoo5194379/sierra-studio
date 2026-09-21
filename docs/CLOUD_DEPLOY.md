# SierraStudio 联网部署指南

## 一次性操作（10分钟）

### 1. 注册 Cloudflare（免费）
https://dash.cloudflare.com/sign-up

### 2. 安装 Wrangler CLI
```bash
npm install -g wrangler
wrangler login
```

### 3. 创建 D1 数据库
```bash
wrangler d1 create sierrastudio-db
```
复制输出的 `database_id` → 粘贴到 `wrangler.toml` 的 `database_id` 字段

### 4. 执行建表 SQL
```bash
wrangler d1 execute sierrastudio-db --file=workers/schema.sql
```

### 5. 创建 R2 存储桶
```bash
wrangler r2 bucket create sierrastudio-files
```

### 6. 部署 Workers

先配置允许访问 API 的浏览器来源。打包后的 Electron 页面通常使用
`null` origin；开发地址请按实际 Vite 地址填写：

```toml
# wrangler.toml
[vars]
ALLOWED_ORIGINS = "null,http://127.0.0.1:5173"
```

管理后台默认关闭。生成一个长随机值并保存为 Worker secret：

```bash
wrangler secret put ADMIN_TOKEN
```

随后部署：

```bash
wrangler deploy
```
部署后你会得到一个 `https://sierrastudio.你的账户名.workers.dev` 的 URL

### 7. 在应用中启用实验性云模式
编辑 `.env` 或在打包时设置环境变量：
```
VITE_CLOUD_API_URL=https://sierrastudio.你的账户名.workers.dev
```

云端 API 以匿名 session ID 作为访问凭据。所有文件读取、保存、
undo/redo 都会校验文件归属。不要把 session ID 写入日志或公开链接。

当前桌面端的自动上传调度仍保持关闭，配置 URL 只用于后续云同步联调；
本地 SQLite、working copy 和 checkpoint 仍是权威数据源。

### 8. 启用自动更新
1. Fork 此项目到 GitHub 公开仓库
2. 设置 GitHub Actions secret `GH_TOKEN`
3. 打包时:
```bash
SIERRASTUDIO_UPDATE_REPO=你的用户名/sierrastudio npm run pack
```

---

## 成本

| 服务 | 免费额度 | 预计用量 |
|------|---------|---------|
| Workers API | 10万请求/天 | ~1000/天 |
| D1 数据库 | 5GB / 50亿读/月 | <10MB |
| R2 存储 | 10GB | <100MB |
| 合计 | **¥0/月** | 够100人用 |

## 用户使用流程

1. 下载 `SierraStudio.exe` → 双击运行
2. 自动生成匿名会话（无登录）
3. 编辑 HTML → 自动保存到本地项目
4. 云同步启用并完成联调后，才会上传版本快照
5. 新版本发布 → 应用自动提示更新

## 查看错误报告

```bash
wrangler d1 execute sierrastudio-db --command="SELECT * FROM crashes ORDER BY created_at DESC LIMIT 20"
```

## 查看用户文件

```bash
wrangler d1 execute sierrastudio-db --command="SELECT id, name, revision, created_at FROM files ORDER BY created_at DESC"
```
