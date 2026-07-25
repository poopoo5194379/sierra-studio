const fs = require("node:fs");
const { parseHTML } = require("linkedom");
const postcss = require("postcss");

const file = process.argv[2];
if (!file) throw new Error("Pass an HTML path");
const { document } = parseHTML(fs.readFileSync(file, "utf8"));
const classCounts = new Map();
for (const element of document.querySelectorAll("[class]")) {
  for (const className of element.classList) {
    classCounts.set(className, (classCounts.get(className) || 0) + 1);
  }
}
const topClasses = [...classCounts]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 60);

const groups = [];
for (const parent of document.querySelectorAll("body *")) {
  if (parent.children.length < 2) continue;
  const signatures = [...parent.children].map((child) =>
    `${child.tagName.toLowerCase()}.${[...child.classList].sort().join(".")}`
  );
  const frequencies = new Map();
  for (const signature of signatures) {
    frequencies.set(signature, (frequencies.get(signature) || 0) + 1);
  }
  const repeated = [...frequencies].sort((a, b) => b[1] - a[1])[0];
  if (repeated && repeated[1] >= 2) {
    groups.push({
      parent: `${parent.tagName.toLowerCase()}.${[...parent.classList].join(".")}`,
      child: repeated[0],
      count: repeated[1],
      totalChildren: parent.children.length
    });
  }
}

const cssRules = [];
for (const style of document.querySelectorAll("style")) {
  try {
    const root = postcss.parse(style.textContent || "");
    root.walkRules((rule) => {
      if (/(^|[\s>+~,.#])(?:page|page-inner|deck|board|rank-card|promo-card|promo-image-row)(?:\b|[.#:[\s>+~])/i.test(rule.selector)) {
        cssRules.push(rule.toString().slice(0, 800));
      }
    });
  } catch {}
}

console.log(JSON.stringify({
  bodyChildren: document.body.children.length,
  topClasses,
  relevantCssRules: cssRules.slice(0, 80),
  repeatedSiblingGroups: groups
    .sort((a, b) => b.count - a.count)
    .slice(0, 60)
}, null, 2));
