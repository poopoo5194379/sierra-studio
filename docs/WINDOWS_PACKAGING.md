# SierraStudio Windows 打包说明

## 最常用命令

在项目目录 `D:\桌面2\html-studio` 中打开 PowerShell：

```powershell
npm run pack
```

完成后，安装包位于：

```text
release\SierraStudio Setup 版本号.exe
```

例如当前版本：

```text
release\SierraStudio Setup 0.3.3.exe
```

## 首次在新电脑上打包

先安装 Node.js，然后在项目目录执行：

```powershell
npm ci
npm run pack
```

`npm ci` 会严格按照 `package-lock.json` 安装依赖，适合构建和发布。

## 发布新版本

先修改 `package.json` 顶部的版本号：

```json
{
  "version": "0.3.4"
}
```

然后执行：

```powershell
npm test
npm run pack
```

新的安装包会自动命名为：

```text
release\SierraStudio Setup 0.3.4.exe
```

不要用同一个版本号反复对外发布，否则用户难以判断安装的是哪一版。

## 项目中的打包流程

`package.json` 中的 `pack` 命令依次完成：

1. `npm run build`
2. TypeScript 类型检查
3. 使用 electron-vite 构建主进程、预加载脚本和界面
4. 将本地字体、Chart.js、ECharts 等运行库复制到构建目录
5. 使用 electron-builder 打包 Windows x64 程序
6. 使用 NSIS 生成安装向导

当前 NSIS 配置支持：

- 用户选择安装目录
- 创建桌面快捷方式
- 生成卸载程序
- 以当前用户身份安装

## 常用命令区别

```powershell
# 开发调试
npm run dev

# 只检查并构建代码，不生成安装包
npm run build

# 运行自动化测试
npm test

# 生成免安装程序目录
npm run pack:dir

# 生成正式安装包
npm run pack
```

免安装程序位置：

```text
release\win-unpacked\SierraStudio.exe
```

正式安装包位置：

```text
release\SierraStudio Setup 版本号.exe
```

## 打包配置位置

打包名称、图标、安装器和输出目录都配置在 `package.json` 的 `build` 字段：

```json
{
  "build": {
    "appId": "com.sierrastudio.app",
    "productName": "SierraStudio",
    "directories": {
      "output": "release"
    },
    "win": {
      "target": ["nsis"],
      "icon": "build/icon.png"
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true,
      "createDesktopShortcut": true,
      "shortcutName": "SierraStudio"
    }
  }
}
```

## 常见问题

### Windows 提示“未知发布者”

当前安装包没有配置商业代码签名证书，因此 Windows SmartScreen 可能显示“未知发布者”。本地自用不影响安装；正式分发时应购买代码签名证书，并在打包环境中配置证书。

### 打包时提示 Electron 下载失败

本项目的命令已经通过 `config.electronDist` 使用本机 `node_modules\electron\dist`，通常不需要重新下载 Electron。先运行：

```powershell
npm ci
npm run pack
```

### 安装包仍是旧功能

确认：

1. 已保存代码。
2. `npm run pack` 最终显示成功。
3. 安装的是最新版本号和最新修改时间的文件。
4. 安装前关闭正在运行的 SierraStudio。

### 打包前推荐检查

```powershell
npm run typecheck
npm test
npm run pack
```

如果三个命令都成功，安装包通常可以发布给其他 Windows x64 用户测试。
