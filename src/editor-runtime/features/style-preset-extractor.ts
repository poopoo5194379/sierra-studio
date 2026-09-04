import type {
  StylePresetDeclaration,
  StylePresetTarget
} from "../../domain/styles/style-preset";

const PROPERTIES: Record<StylePresetTarget, readonly string[]> = {
  text: [
    "color", "font-family", "font-size", "font-weight", "font-style",
    "line-height", "letter-spacing", "text-align", "text-transform",
    "text-decoration", "background-color", "border-left", "border-radius",
    "padding"
  ],
  surface: [
    "color", "background-color", "background-image", "border",
    "border-radius", "box-shadow", "padding", "opacity"
  ],
  image: [
    "background-color", "border", "border-radius", "box-shadow",
    "object-fit", "filter", "opacity"
  ],
  button: [
    "color", "background-color", "background-image", "font-family",
    "font-size", "font-weight", "letter-spacing", "text-transform",
    "border", "border-radius", "box-shadow", "padding"
  ],
  table: [
    "color", "background-color", "font-family", "font-size", "font-weight",
    "text-align", "border", "border-radius", "box-shadow", "padding"
  ]
};

export function styleTargetForElement(element: Element): StylePresetTarget {
  const tag = element.tagName.toLowerCase();
  if (tag === "img" || tag === "picture" || tag === "figure") return "image";
  if (
    tag === "button"
    || element.getAttribute("role") === "button"
    || (tag === "a" && /button|btn/i.test(element.className))
  ) return "button";
  if (["table", "thead", "tbody", "tr", "th", "td"].includes(tag)) {
    return "table";
  }
  if (
    ["h1", "h2", "h3", "h4", "h5", "h6", "p", "span", "label",
      "blockquote", "figcaption"].includes(tag)
    && element.children.length === 0
  ) return "text";
  return "surface";
}

export function declarationsForPreset(
  computed: CSSStyleDeclaration,
  target: StylePresetTarget
): StylePresetDeclaration[] {
  return PROPERTIES[target].flatMap((property) => {
    const value = computed.getPropertyValue(property).trim();
    if (!value) return [];
    if (
      property === "background-image"
      && value !== "none"
      && !value.includes("gradient(")
    ) return [];
    return [{
      property,
      value,
      priority: computed.getPropertyPriority(property) === "important"
        ? "important" as const
        : "" as const
    }];
  });
}

export function presetSignature(
  declarations: StylePresetDeclaration[]
): string {
  return declarations
    .map(({ property, value, priority }) =>
      `${property}:${value}${priority ? "!important" : ""}`
    )
    .sort()
    .join(";");
}

