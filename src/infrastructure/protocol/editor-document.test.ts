import { describe, expect, it } from "vitest";
import {
  createEditorDocumentResponse,
  createPdfDocumentResponse
} from "./editor-document";

describe("createEditorDocumentResponse", () => {
  it("injects the isolated runtime and blocks network access", async () => {
    const response = createEditorDocumentResponse(
      '<!doctype html><html><head><script>const x = "</body>"</script></head>'
      + "<body><p>hello</p></body></html>"
    );
    const html = await response.text();
    expect(html).toContain(
      "script-src 'unsafe-inline' htmlstudio-project: htmlstudio-runtime:"
    );
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain(
      '<script type="module" src="htmlstudio-runtime://bundle/editor-runtime.js"></script>'
    );
    expect(html).toContain('const x = "</body>"');
    expect(html).toContain(
      '<p>hello</p><script type="module" src="htmlstudio-runtime://bundle/editor-runtime.js"></script></body>'
    );
    expect(response.headers.get("content-type")).toContain("text/html");
  });

  it("allows sandboxed project scripts while omitting the editor runtime for PDF", async () => {
    const html = await createPdfDocumentResponse(
      "<html><head></head><body>report</body></html>"
    ).text();
    expect(html).toContain("style-src 'unsafe-inline' htmlstudio-project:");
    expect(html).not.toContain("editor-runtime.js");
    expect(html).toContain("script-src 'unsafe-inline' htmlstudio-project:");
  });
});
