import { parseHTML } from "linkedom";
import {
  detectKnownExternalDependency,
  detectRuntimeDependency,
  detectRuntimeStyle,
  type RuntimeDependencyId
} from "../../domain/document/runtime-dependencies";
import type {
  CompatibilityFinding,
  ImportCompatibilityReport
} from "../../shared/import-compatibility";

const REMOTE_URL_PATTERN = /https?:\/\/[^\s"'`()<>]+/gi;
const DYNAMIC_RENDER_PATTERN =
  /\.(?:innerHTML|outerHTML)\s*=|insertAdjacentHTML\s*\(|document\.write\s*\(/g;

function unique<T>(values: Iterable<T>): T[] {
  return [...new Set(values)];
}

export function scanImportCompatibility(
  sourceHtml: string
): ImportCompatibilityReport {
  const { document } = parseHTML(sourceHtml);
  const findings: CompatibilityFinding[] = [];
  const scripts = [...document.querySelectorAll<HTMLScriptElement>("script")];
  const scriptSources = scripts
    .map((script) => script.getAttribute("src"))
    .filter((value): value is string => Boolean(value));
  const stylesheetSources = [
    ...document.querySelectorAll<HTMLLinkElement>(
      'link[rel~="stylesheet"][href]'
    )
  ]
    .map((link) => link.getAttribute("href"))
    .filter((value): value is string => Boolean(value));
  const remoteUrls = unique(sourceHtml.match(REMOTE_URL_PATTERN) ?? []);
  const detectedDependencies = unique(
    scriptSources
      .map(detectKnownExternalDependency)
      .filter((value): value is string => Boolean(value))
  );
  for (const href of stylesheetSources) {
    const dependency = detectKnownExternalDependency(href);
    if (dependency) detectedDependencies.push(dependency);
  }

  const mapped = unique(
    scriptSources
      .map(detectRuntimeDependency)
      .filter((value): value is RuntimeDependencyId => Boolean(value))
  );
  const mappedStyles = unique(
    stylesheetSources
      .map(detectRuntimeStyle)
      .filter((value): value is NonNullable<ReturnType<
        typeof detectRuntimeStyle
      >> => Boolean(value))
  );
  if (mapped.length > 0 || mappedStyles.length > 0) {
    findings.push({
      code: "DEPENDENCY_LOCAL_MAPPING",
      severity: "ok",
      category: "dependency",
      title: "已识别可本地运行的依赖",
      detail:
        `${[...mapped, ...mappedStyles].join("、")} 将使用应用内固定版本。`,
      count: mapped.length + mappedStyles.length
    });
  }
  if ([...mapped].some((dependency) => dependency.startsWith("highcharts"))) {
    findings.push({
      code: "HIGHCHARTS_LICENSE",
      severity: "info",
      category: "dependency",
      title: "Highcharts 授权提示",
      detail:
        "Highcharts 已可离线运行；商业用途仍需由使用方持有符合场景的授权。"
    });
  }

  const unsupportedKnownScripts = unique(
    scriptSources
      .filter(
        (source) => /^https?:\/\//i.test(source)
          && !detectRuntimeDependency(source)
      )
      .map(detectKnownExternalDependency)
      .filter((value): value is string => Boolean(value))
  );
  if (unsupportedKnownScripts.length > 0) {
    findings.push({
      code: "UNSUPPORTED_KNOWN_SCRIPT",
      severity: "blocked",
      category: "dependency",
      title: "已识别但未内置的脚本依赖",
      detail:
        `${unsupportedKnownScripts.join("、")} 的远程脚本会被安全策略阻止；`
        + "依赖这些脚本的组件或动效将降级。",
      count: unsupportedKnownScripts.length
    });
  }

  const unknownRemoteScripts = scriptSources.filter(
    (source) => /^https?:\/\//i.test(source)
      && !detectRuntimeDependency(source)
      && !detectKnownExternalDependency(source)
  );
  if (unknownRemoteScripts.length > 0) {
    findings.push({
      code: "UNKNOWN_REMOTE_SCRIPT",
      severity: "blocked",
      category: "security",
      title: "未知远程脚本已阻止",
      detail:
        "这些脚本不会获得网络执行权限；依赖它们的交互可能降级。",
      count: unknownRemoteScripts.length
    });
  }

  const remoteFontStylesheets = stylesheetSources.filter(
    (source) => /^https:\/\//i.test(source)
      && detectRuntimeStyle(source) === "bundled-fonts"
  );
  if (remoteFontStylesheets.length > 0) {
    findings.push({
      code: "BUNDLED_FONT_SUBSTITUTION",
      severity: "warning",
      category: "asset",
      title: "远程字体将使用内置字体替代",
      detail:
        "Google Fonts 网络请求会替换为内置的中西文字体包；"
        + "未内置的字体族将继续使用系统字体栈。",
      count: remoteFontStylesheets.length
    });
  }

  const localizableRemoteStylesheets = stylesheetSources.filter(
    (source) => /^https:\/\//i.test(source)
      && !detectRuntimeStyle(source)
  );
  if (localizableRemoteStylesheets.length > 0) {
    findings.push({
      code: "REMOTE_STYLESHEET_LOCALIZATION",
      severity: "info",
      category: "asset",
      title: "远程样式表将尝试离线化",
      detail:
        "CSS 及其图片、字体资源会下载到项目；"
        + "超时或下载失败的资源会在导入警告中列出。",
      count: localizableRemoteStylesheets.length
    });
  }

  const inlineScript = scripts
    .filter((script) => !script.getAttribute("src"))
    .map((script) => script.textContent ?? "")
    .join("\n");
  const dynamicRenderers =
    inlineScript.match(DYNAMIC_RENDER_PATTERN)?.length ?? 0;
  const spaSignals = [
    /createRoot\s*\(/,
    /ReactDOM\./,
    /createApp\s*\(/,
    /new\s+Vue\s*\(/,
    /customElements\.define\s*\(/,
    /attachShadow\s*\(/
  ].filter((pattern) => pattern.test(sourceHtml)).length;
  if (dynamicRenderers > 0 || spaSignals > 0) {
    findings.push({
      code: "RUNTIME_GENERATED_DOM",
      severity: "warning",
      category: "dynamic",
      title: "包含运行时生成内容",
      detail:
        "页面脚本会在加载后创建或替换 DOM；建议完成渲染后物化为静态内容。",
      count: dynamicRenderers + spaSignals
    });
  }

  if (remoteUrls.length > 0) {
    findings.push({
      code: "REMOTE_ASSETS",
      severity: "warning",
      category: "asset",
      title: "包含远程资源",
      detail: "导入器将尝试安全下载图片、字体和样式；失败项会保留提示。",
      count: remoteUrls.length
    });
  }

  const structuralCases = [
    ["IFRAME", "iframe", "嵌入页面不会自动转成可编辑内容。"],
    ["SHADOW_DOM", "attachShadow", "Shadow DOM 需要物化后才能完整编辑。"],
    ["CANVAS", "<canvas", "Canvas 像素内容不能直接拆成普通元素。"],
    ["SRCSET", "srcset=", "响应式图片需要同时导入全部候选资源。"],
    ["BASE_HREF", "<base", "base href 会改变所有相对资源的解析基准。"]
  ] as const;
  for (const [code, token, detail] of structuralCases) {
    if (!sourceHtml.toLowerCase().includes(token.toLowerCase())) continue;
    findings.push({
      code,
      severity: "info",
      category: "structure",
      title: `检测到 ${token}`,
      detail
    });
  }

  const mode = spaSignals > 0
    ? "web-app"
    : dynamicRenderers > 0
      ? "dynamic-report"
      : "static";
  const blocked = findings.some((finding) => finding.severity === "blocked");
  const warnings = findings.some((finding) => finding.severity === "warning");
  return {
    level: blocked || mode === "web-app"
      ? "limited"
      : warnings
        ? "partial"
        : "good",
    mode,
    findings,
    detectedDependencies: unique(detectedDependencies),
    metrics: {
      elements: document.querySelectorAll("*").length,
      scripts: scripts.length,
      remoteAssets: remoteUrls.length,
      dynamicRenderers
    }
  };
}
