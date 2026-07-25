import { injectChartOverrideBootstrap } from "../../domain/document/chart-override-bootstrap";
import { insertBeforeLastClosingTag } from "../../domain/document/html-injection";

export function createEditorDocumentResponse(
  sourceHtml: string,
  runtimeUrl = "htmlstudio-runtime://bundle/editor-runtime.js"
): Response {
  const runtimeOrigin = new URL(runtimeUrl).origin;
  const editorCsp = [
    "default-src 'none'",
    `script-src 'unsafe-inline' htmlstudio-project: ${
      runtimeOrigin === "null" ? "htmlstudio-runtime:" : runtimeOrigin
    }`,
    "style-src 'unsafe-inline' htmlstudio-project:",
    "img-src htmlstudio-project: data: blob:",
    "font-src htmlstudio-project: data:",
    "media-src htmlstudio-project: data: blob:",
    "connect-src 'none'",
    "worker-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
  ].join("; ");
  const securityHead =
    `<meta http-equiv="Content-Security-Policy" content="${editorCsp}">`;
  const runtimeScript =
    `<script type="module" src="${runtimeUrl}"></script>`;
  const withHead = /<head(?:\s[^>]*)?>/i.test(sourceHtml)
    ? sourceHtml.replace(
      /<head(?:\s[^>]*)?>/i,
      (head) => `${head}${securityHead}`
    )
    : `${securityHead}${sourceHtml}`;
  const document = insertBeforeLastClosingTag(
    withHead,
    "body",
    runtimeScript
  );
  return new Response(document, {
    headers: { "content-type": "text/html; charset=utf-8" }
  });
}

export function createPdfDocumentResponse(sourceHtml: string): Response {
  const csp = [
    "default-src 'none'",
    "script-src 'unsafe-inline' htmlstudio-project:",
    "style-src 'unsafe-inline' htmlstudio-project:",
    "img-src htmlstudio-project: data: blob:",
    "font-src htmlstudio-project: data:",
    "media-src htmlstudio-project: data: blob:",
    "connect-src 'none'",
    "worker-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
  ].join("; ");
  const meta =
    `<meta http-equiv="Content-Security-Policy" content="${csp}">`;
  const withRuntime = injectChartOverrideBootstrap(sourceHtml);
  const document = /<head(?:\s[^>]*)?>/i.test(withRuntime)
    ? withRuntime.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${meta}`)
    : `${meta}${withRuntime}`;
  return new Response(document, {
    headers: { "content-type": "text/html; charset=utf-8" }
  });
}
