import { describe, expect, it } from "vitest";
import {
  applyCommandToHtml,
  createSafeWorkingDocument,
  stripEditorMetadata
} from "./html-document";
import { STRIP_SCRIPT_POLICY } from "./script-policy";

describe("HTML document model", () => {
  it("preserves sandboxed user scripts and assigns stable editor ids", () => {
    const html = createSafeWorkingDocument(
      "<html><body><h1>Hello</h1><script>alert(1)</script></body></html>"
    );
    expect(html).toContain("<script");
    expect(html).toContain("data-hs-user-script");
    expect(html).toContain("data-hs-id=");
  });

  it("can explicitly strip scripts for untrusted static imports", () => {
    const html = createSafeWorkingDocument(
      "<html><body><script>alert(1)</script></body></html>",
      STRIP_SCRIPT_POLICY
    );
    expect(html).not.toContain("<script");
  });

  it("applies explicit inline declarations", () => {
    const initial = createSafeWorkingDocument(
      '<html><body><h1 style="left:10px">Hello</h1></body></html>'
    );
    const id = initial.match(/data-hs-id="([^"]+)"/)?.[1];
    expect(id).toBeTruthy();
    const result = applyCommandToHtml(initial, {
      type: "styles.set",
      nodes: [{
        nodeId: id!,
        before: [{ property: "left", value: "10px", priority: "", existed: true }],
        after: [{ property: "left", value: "100px", priority: "", existed: true }]
      }]
    });
    expect(result).toContain("left:100px");
  });

  it("strips internal ids on export", () => {
    const working = createSafeWorkingDocument(
      "<html><body><p>Hello</p></body></html>"
    );
    expect(stripEditorMetadata(working)).not.toContain("data-hs-id");
  });

  it("reorders flow nodes by their final sibling index", () => {
    const initial = createSafeWorkingDocument(
      "<html><body><main><div>A</div><div>B</div><div>C</div></main></body></html>"
    );
    const ids = [...initial.matchAll(/<div data-hs-id="([^"]+)"/g)]
      .map((match) => match[1]);
    const parentId = initial.match(/<main data-hs-id="([^"]+)"/)?.[1];
    expect(ids).toHaveLength(3);
    expect(parentId).toBeTruthy();
    const result = applyCommandToHtml(initial, {
      type: "node.move",
      nodeId: ids[0]!,
      parentId: parentId!,
      beforeIndex: 0,
      afterIndex: 2
    });
    expect(result.indexOf(">B</div>")).toBeLessThan(result.indexOf(">C</div>"));
    expect(result.indexOf(">C</div>")).toBeLessThan(result.indexOf(">A</div>"));
  });

  it("persists chart patches in a project-level manifest", () => {
    const initial = createSafeWorkingDocument(
      '<html><body><div id="chart"></div></body></html>'
    );
    const result = applyCommandToHtml(initial, {
      type: "chart.patch",
      chartKey: "echarts:id:chart",
      before: {},
      after: {
        title: "Revenue",
        legendVisible: false,
        primaryColor: "#3366ff"
      }
    });
    expect(result).toContain("data-hs-chart-manifest");
    expect(result).toContain("echarts:id:chart");
    expect(result).toContain("Revenue");
  });
});
