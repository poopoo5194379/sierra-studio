import type { StylePreset } from "./style-preset";

const declaration = (
  property: string,
  value: string
): { property: string; value: string; priority: "" } => ({
  property,
  value,
  priority: ""
});

export const BUILTIN_STYLE_PRESETS: StylePreset[] = [
  {
    id: "builtin-title-blue",
    name: "报告蓝主标题",
    category: "标题",
    target: "text",
    source: "builtin",
    sampleText: "核心洞察",
    declarations: [
      declaration("color", "#1d4ed8"),
      declaration("font-size", "32px"),
      declaration("font-weight", "800"),
      declaration("line-height", "1.2"),
      declaration("letter-spacing", "-0.02em")
    ]
  },
  {
    id: "builtin-title-editorial",
    name: "杂志衬线标题",
    category: "标题",
    target: "text",
    source: "builtin",
    sampleText: "趋势观察",
    declarations: [
      declaration("color", "#172033"),
      declaration("font-family", "Noto Serif SC, serif"),
      declaration("font-size", "30px"),
      declaration("font-weight", "700"),
      declaration("line-height", "1.3")
    ]
  },
  {
    id: "builtin-section-marker",
    name: "章节标记标题",
    category: "标题",
    target: "text",
    source: "builtin",
    sampleText: "一、关键发现",
    declarations: [
      declaration("color", "#164e9a"),
      declaration("font-size", "20px"),
      declaration("font-weight", "750"),
      declaration("border-left", "5px solid #2563eb"),
      declaration("padding", "8px 12px"),
      declaration("background-color", "#eff6ff")
    ]
  },
  {
    id: "builtin-caption-muted",
    name: "数据来源说明",
    category: "正文",
    target: "text",
    source: "builtin",
    sampleText: "数据来源：公开资料整理",
    declarations: [
      declaration("color", "#64748b"),
      declaration("font-size", "12px"),
      declaration("font-weight", "400"),
      declaration("line-height", "1.6")
    ]
  },
  {
    id: "builtin-kpi-number",
    name: "KPI 大数字",
    category: "数据",
    target: "text",
    source: "builtin",
    sampleText: "972",
    declarations: [
      declaration("color", "#2563eb"),
      declaration("font-size", "40px"),
      declaration("font-weight", "850"),
      declaration("line-height", "1"),
      declaration("letter-spacing", "-0.035em")
    ]
  },
  {
    id: "builtin-card-soft",
    name: "白色轻阴影卡",
    category: "卡片",
    target: "surface",
    source: "builtin",
    declarations: [
      declaration("color", "#172033"),
      declaration("background-color", "#ffffff"),
      declaration("border", "1px solid #e5eaf1"),
      declaration("border-radius", "16px"),
      declaration("box-shadow", "0 12px 32px rgba(15, 23, 42, 0.10)"),
      declaration("padding", "20px")
    ]
  },
  {
    id: "builtin-card-blue",
    name: "蓝色强调卡",
    category: "卡片",
    target: "surface",
    source: "builtin",
    declarations: [
      declaration("color", "#ffffff"),
      declaration("background-color", "#2563eb"),
      declaration("background-image", "linear-gradient(135deg, #1d4ed8, #60a5fa)"),
      declaration("border", "1px solid rgba(255,255,255,.25)"),
      declaration("border-radius", "16px"),
      declaration("box-shadow", "0 16px 36px rgba(37, 99, 235, .22)"),
      declaration("padding", "22px")
    ]
  },
  {
    id: "builtin-card-insight",
    name: "浅蓝洞察卡",
    category: "卡片",
    target: "surface",
    source: "builtin",
    declarations: [
      declaration("color", "#17345f"),
      declaration("background-color", "#eff6ff"),
      declaration("border", "1px solid #bfdbfe"),
      declaration("border-radius", "12px"),
      declaration("box-shadow", "none"),
      declaration("padding", "18px")
    ]
  },
  {
    id: "builtin-card-dark",
    name: "深色结论卡",
    category: "卡片",
    target: "surface",
    source: "builtin",
    declarations: [
      declaration("color", "#f8fafc"),
      declaration("background-color", "#111827"),
      declaration("background-image", "linear-gradient(145deg, #111827, #263249)"),
      declaration("border", "1px solid #334155"),
      declaration("border-radius", "14px"),
      declaration("box-shadow", "0 18px 42px rgba(2, 6, 23, .28)"),
      declaration("padding", "22px")
    ]
  },
  {
    id: "builtin-image-rounded",
    name: "圆角柔光图片",
    category: "图片",
    target: "image",
    source: "builtin",
    declarations: [
      declaration("border", "1px solid #e2e8f0"),
      declaration("border-radius", "16px"),
      declaration("box-shadow", "0 12px 30px rgba(15, 23, 42, .14)"),
      declaration("object-fit", "cover")
    ]
  },
  {
    id: "builtin-image-report",
    name: "报告截图边框",
    category: "图片",
    target: "image",
    source: "builtin",
    declarations: [
      declaration("background-color", "#ffffff"),
      declaration("border", "8px solid #ffffff"),
      declaration("border-radius", "10px"),
      declaration("box-shadow", "0 0 0 1px #dbe3ee, 0 10px 24px rgba(15,23,42,.12)"),
      declaration("object-fit", "contain")
    ]
  },
  {
    id: "builtin-button-primary",
    name: "品牌主按钮",
    category: "按钮",
    target: "button",
    source: "builtin",
    declarations: [
      declaration("color", "#ffffff"),
      declaration("background-color", "#2563eb"),
      declaration("font-weight", "700"),
      declaration("border", "1px solid #2563eb"),
      declaration("border-radius", "999px"),
      declaration("box-shadow", "0 8px 18px rgba(37,99,235,.22)"),
      declaration("padding", "10px 18px")
    ]
  },
  {
    id: "builtin-table-clean",
    name: "清爽数据表",
    category: "表格",
    target: "table",
    source: "builtin",
    declarations: [
      declaration("color", "#243047"),
      declaration("background-color", "#ffffff"),
      declaration("font-size", "13px"),
      declaration("border", "1px solid #dbe3ee"),
      declaration("border-radius", "10px"),
      declaration("box-shadow", "0 8px 22px rgba(15,23,42,.08)")
    ]
  }
];

