import { describe, expect, it } from "vitest";
import { insertBeforeLastClosingTag } from "./html-injection";

describe("insertBeforeLastClosingTag", () => {
  it("does not inject into a closing-tag literal inside a user script", () => {
    const html =
      '<html><head><script>const template = "</body>"</script></head>'
      + "<body>report</body></html>";
    const result = insertBeforeLastClosingTag(html, "body", "<script>runtime()</script>");
    expect(result).toContain('const template = "</body>"');
    expect(result).toContain(
      "<body>report<script>runtime()</script></body></html>"
    );
  });
});
