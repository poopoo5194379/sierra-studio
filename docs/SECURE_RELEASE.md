# SierraStudio 安全发布流程

## 安全目标

正式安装包不得直接从个人电脑上传。所有对外版本必须由 GitHub Actions 的全新 Windows Runner 从确定的 Git commit 构建，并经过依赖审计、Microsoft Defender 扫描、哈希生成与构建来源证明。Authenticode 签名是可选增强项；未购买证书时，发布物会明确标记为 `UNSIGNED`。

## 两条工作流

### Secure Windows Build

在 GitHub Actions 中手动运行。它会：

1. 使用 `npm ci` 严格按锁文件安装；
2. 阻止 high/critical 级生产依赖漏洞；
3. 执行类型检查、测试和构建；
4. 在干净 Runner 中生成未签名测试安装包；
5. 生成 CycloneDX SBOM；
6. 使用 Microsoft Defender 扫描；
7. 生成 `SHA256SUMS.txt` 与 `SECURITY-MANIFEST.json`；
8. 创建 GitHub build provenance attestation；
9. 上传保留 14 天的测试产物。

该产物用于内部验证，不作为正式公开版本。

### Build & Release

推送 `v*` 标签时运行。缺少付费证书时仍可发布，但 `SIGNING-STATUS.txt` 和 `SECURITY-MANIFEST.json` 会明确记录未签名状态。依赖审计失败、Defender 不可用或发现威胁时，工作流仍会停止，不会创建 GitHub Release。

## 可选：配置 Windows 签名证书

如果以后决定购买 Windows Authenticode 代码签名证书，可以导出为带密码的 `.pfx`。不购买时直接跳过本节。不要把证书或密码提交到仓库。

在 PowerShell 中生成 Base64：

```powershell
[Convert]::ToBase64String(
  [IO.File]::ReadAllBytes("C:\secure\sierrastudio-signing.pfx")
) | Set-Content -NoNewline cert-base64.txt
```

进入 GitHub 仓库：

```text
Settings
→ Secrets and variables
→ Actions
→ New repository secret
```

添加：

- `WIN_CSC_LINK`：`cert-base64.txt` 的完整内容；
- `WIN_CSC_KEY_PASSWORD`：PFX 导出密码。

GitHub Secrets 只用于 CI。不要把 `cert-base64.txt` 放进项目目录或发送给其他人。

## 正式发布

1. 更新 `package.json` 版本，例如 `0.3.5`；
2. 提交代码并等待 CI 全绿；
3. 运行一次 `Secure Windows Build`，安装并人工验证测试产物；
4. 创建与版本一致的标签：`v0.3.5`；
5. 推送标签；
6. 等待 `Build & Release` 完成；
7. 从 GitHub Release 下载最终 EXE，核对签名与 SHA-256。

用户可以执行：

```powershell
Get-AuthenticodeSignature ".\SierraStudio Setup 0.3.5.exe"
Get-FileHash ".\SierraStudio Setup 0.3.5.exe" -Algorithm SHA256
```

购买并配置证书后，签名状态应为 `Valid`。未签名发布时状态会是 `NotSigned`，用户需要接受 SmartScreen 可能出现的“未知发布者”提示。两种情况下，哈希都应与 Release 中的 `SHA256SUMS.txt` 完全一致。

代码签名和病毒扫描是两回事：不付费签名不会让文件自动带病毒，只是 Windows 无法显示一个受信任的发布者身份。干净 Runner、依赖审计、Defender 扫描、哈希与 GitHub attestation 仍然有效。

## 已知依赖风险

安全审计对 high/critical 漏洞执行硬阻断。Moderate 漏洞仍会显示在日志中，需要逐项评估。

当前 ECharts 5.x 的公开 XSS 修复位于 ECharts 6.1，而 `echarts-wordcloud@2.1.0` 的 peer dependency 仍限定 ECharts 5.x。升级前必须完成词云和导入 HTML 的兼容性回归；在此之前，不应把导入的未知 HTML 当作可信代码。
