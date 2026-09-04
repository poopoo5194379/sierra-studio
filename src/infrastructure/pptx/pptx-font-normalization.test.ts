import { describe, expect, it } from "vitest";
import { ensurePowerPointEastAsianFont } from "./pptx-font-normalization";

describe("ensurePowerPointEastAsianFont", () => {
  it("keeps the Latin face and adds an explicit Chinese face", () => {
    const xml = '<a:rPr lang="zh-CN"><a:latin typeface="Aptos"/></a:rPr>';

    expect(ensurePowerPointEastAsianFont(xml)).toBe(
      '<a:rPr lang="zh-CN"><a:latin typeface="Aptos"/><a:ea typeface="Microsoft YaHei"/></a:rPr>'
    );
  });

  it("replaces an unreliable existing East Asian fallback", () => {
    const xml = '<a:defRPr><a:latin typeface="Aptos"/><a:ea typeface="Arial"/></a:defRPr>';

    expect(ensurePowerPointEastAsianFont(xml)).toContain(
      '<a:ea typeface="Microsoft YaHei"/>'
    );
  });

  it("expands self-closing text properties", () => {
    expect(ensurePowerPointEastAsianFont("<a:endParaRPr/>"))
      .toBe('<a:endParaRPr><a:ea typeface="Microsoft YaHei"/></a:endParaRPr>');
  });
});
