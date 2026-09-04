import { describe, expect, it } from "vitest";
import {
  applyCommandToHtml,
  createSafeWorkingDocument,
  stripEditorMetadata
} from "./html-document";
import { invertPayload } from "../commands/schema";
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

  it("preserves nested markup when inserting arbitrary HTML elements", () => {
    const initial = createSafeWorkingDocument(
      "<html><body><main></main></body></html>"
    );
    const parentId = initial.match(/<main data-hs-id="([^"]+)"/)?.[1];
    expect(parentId).toBeTruthy();
    const result = applyCommandToHtml(initial, {
      type: "node.insert",
      parentId: parentId!,
      index: 0,
      node: {
        id: "node-section",
        tagName: "section",
        attributes: { class: "card", "aria-label": "Summary" },
        text: "<h3>Title</h3><p>Body</p>"
      }
    });
    expect(result).toContain("<section");
    expect(result).toContain('data-hs-id="node-section"');
    expect(result).toContain('class="card"');
    expect(result).toContain('aria-label="Summary"');
    expect(result).toContain("<h3>Title</h3><p>Body</p>");
    expect(result).not.toContain("&lt;h3&gt;");
  });

  it("preserves inline markup when rich text is edited and undone", () => {
    const initial = createSafeWorkingDocument(
      "<html><body><p>Hello <strong>world</strong></p></body></html>"
    );
    const nodeId = initial.match(/<p data-hs-id="([^"]+)"/)?.[1];
    expect(nodeId).toBeTruthy();
    const command = {
      type: "text.patchStyle" as const,
      nodeId: nodeId!,
      before: "Hello <strong>world</strong>",
      after: "Updated <strong>world</strong>"
    };
    const updated = applyCommandToHtml(initial, command);
    expect(updated).toContain("Updated <strong");
    expect(updated).toContain(">world</strong>");

    const restored = applyCommandToHtml(updated, invertPayload(command));
    expect(restored).toContain("Hello <strong");
    expect(restored).toContain(">world</strong>");
  });

  it("wraps bare text runs inside structural cards so they can be selected", () => {
    const working = createSafeWorkingDocument(
      "<html><body><div class=\"card\"><div class=\"tag\">引用</div>"
      + "正文 <strong>重点</strong><sup>[1]</sup></div></body></html>"
    );
    expect(working).toContain("data-hs-text-run");
    expect(working).toMatch(
      /<span[^>]*data-hs-text-run[^>]*>正文 <strong[^>]*>重点<\/strong><sup[^>]*>\[1\]<\/sup><\/span>/
    );
    const exported = stripEditorMetadata(working);
    expect(exported).not.toContain("data-hs-text-run");
    expect(exported).toContain("正文 <strong>重点</strong><sup>[1]</sup>");
  });

  it("uses the reserved body id for top-level insertions", () => {
    const initial = createSafeWorkingDocument(
      "<html><body><h1>Existing</h1></body></html>"
    );
    const result = applyCommandToHtml(initial, {
      type: "node.insert",
      parentId: "__hs_body__",
      index: 1,
      node: {
        id: "node-top-level",
        tagName: "section",
        attributes: {},
        text: "<p>Top-level block</p>"
      }
    });
    expect(result).toContain(
      '<section data-hs-id="node-top-level"><p>Top-level block</p></section>'
    );
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

  it("atomically applies an export-stable class and managed stylesheet", () => {
    const initial = createSafeWorkingDocument(
      "<html><head></head><body><h1>Hello</h1></body></html>"
    );
    const nodeId = initial.match(/<h1 data-hs-id="([^"]+)"/)?.[1];
    expect(nodeId).toBeTruthy();
    const result = applyCommandToHtml(initial, {
      type: "document.patch",
      attributes: [{
        nodeId: nodeId!,
        name: "class",
        before: null,
        after: "hs-responsive-title"
      }],
      managedStyles: [{
        styleId: "responsive",
        before: null,
        after: "@media (max-width: 767px) { .hs-responsive-title { font-size: 20px; } }"
      }]
    });
    expect(result).toContain('class="hs-responsive-title"');
    expect(result).toContain('data-hs-managed-style="responsive"');
    const exported = stripEditorMetadata(result);
    expect(exported).not.toContain("data-hs-id");
    expect(exported).toContain(".hs-responsive-title");
  });

  it("applies and reverses a component update as one atomic command", () => {
    const initial = createSafeWorkingDocument(
      '<html><body><section><h2>Master</h2><h2 data-hs-component-version="1">Instance</h2></section></body></html>'
    );
    const ids = [...initial.matchAll(/<h2 data-hs-id="([^"]+)"/g)]
      .map((match) => match[1]);
    expect(ids).toHaveLength(2);
    const command = {
      type: "component.update" as const,
      texts: [
        { nodeId: ids[0]!, before: "Master", after: "Shared" },
        { nodeId: ids[1]!, before: "Instance", after: "Shared" }
      ],
      html: [],
      styles: [],
      attributes: [{
        nodeId: ids[1]!,
        name: "data-hs-component-version",
        before: "1",
        after: "2"
      }]
    };
    const updated = applyCommandToHtml(initial, command);
    expect(updated.match(/>Shared<\/h2>/g)).toHaveLength(2);
    expect(updated).toContain('data-hs-component-version="2"');

    const restored = applyCommandToHtml(updated, invertPayload(command));
    expect(restored).toContain(">Master</h2>");
    expect(restored).toContain(">Instance</h2>");
    expect(restored).toContain('data-hs-component-version="1"');
  });
});
