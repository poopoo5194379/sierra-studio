const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const outputDirectory = path.join(root, "out", "renderer", "vendor");

const vendors = [
  ["node_modules/echarts/dist/echarts.min.js", "echarts.min.js"],
  [
    "node_modules/echarts-wordcloud/dist/echarts-wordcloud.min.js",
    "echarts-wordcloud.min.js"
  ],
  ["node_modules/chart.js/dist/chart.umd.js", "chart.umd.min.js"],
  [
    "node_modules/@tailwindcss/browser/dist/index.global.js",
    "tailwind-browser.js"
  ],
  [
    "node_modules/bootstrap/dist/js/bootstrap.bundle.min.js",
    "bootstrap.bundle.min.js"
  ],
  ["node_modules/bootstrap/dist/css/bootstrap.min.css", "bootstrap.min.css"],
  ["node_modules/d3/dist/d3.min.js", "d3.min.js"],
  ["node_modules/highcharts/highcharts.js", "highcharts.min.js"],
  ["node_modules/highcharts/highcharts-more.js", "highcharts-more.min.js"],
  [
    "node_modules/highcharts/modules/exporting.js",
    "highcharts-exporting.min.js"
  ],
  [
    "node_modules/highcharts/modules/export-data.js",
    "highcharts-export-data.min.js"
  ],
  [
    "node_modules/highcharts/modules/accessibility.js",
    "highcharts-accessibility.min.js"
  ],
  ["node_modules/plotly.js-dist-min/plotly.min.js", "plotly.min.js"],
  ["node_modules/mermaid/dist/mermaid.min.js", "mermaid.min.js"],
  ["node_modules/gsap/dist/gsap.min.js", "gsap.min.js"],
  ["node_modules/gsap/dist/ScrollTrigger.min.js", "ScrollTrigger.min.js"],
  ["node_modules/three/build/three.min.js", "three.min.js"],
  ["node_modules/animejs/lib/anime.min.js", "anime.min.js"],
  ["node_modules/alpinejs/dist/cdn.min.js", "alpine.min.js"],
  ["node_modules/swiper/swiper-bundle.min.js", "swiper-bundle.min.js"],
  ["node_modules/swiper/swiper-bundle.min.css", "swiper-bundle.min.css"],
  ["node_modules/aos/dist/aos.js", "aos.min.js"],
  ["node_modules/aos/dist/aos.css", "aos.min.css"]
];

const fontSources = [
  {
    packageName: "@fontsource-variable/inter",
    directory: "inter",
    familyFrom: "Inter Variable",
    familyTo: "Inter",
    cssFiles: ["index.css"]
  },
  {
    packageName: "@fontsource-variable/noto-sans-sc",
    directory: "noto-sans-sc",
    familyFrom: "Noto Sans SC Variable",
    familyTo: "Noto Sans SC",
    cssFiles: ["index.css"]
  },
  {
    packageName: "@fontsource-variable/noto-serif-sc",
    directory: "noto-serif-sc",
    familyFrom: "Noto Serif SC Variable",
    familyTo: "Noto Serif SC",
    cssFiles: ["index.css"]
  },
  {
    packageName: "@fontsource-variable/roboto",
    directory: "roboto",
    familyFrom: "Roboto Variable",
    familyTo: "Roboto",
    cssFiles: ["index.css"]
  },
  {
    packageName: "@fontsource-variable/open-sans",
    directory: "open-sans",
    familyFrom: "Open Sans Variable",
    familyTo: "Open Sans",
    cssFiles: ["index.css"]
  },
  {
    packageName: "@fontsource-variable/montserrat",
    directory: "montserrat",
    familyFrom: "Montserrat Variable",
    familyTo: "Montserrat",
    cssFiles: ["index.css"]
  },
  {
    packageName: "@fontsource/poppins",
    directory: "poppins",
    familyFrom: "Poppins",
    familyTo: "Poppins",
    cssFiles: ["400.css", "500.css", "600.css", "700.css"]
  },
  {
    packageName: "@fontsource/barlow-condensed",
    directory: "barlow-condensed",
    familyFrom: "Barlow Condensed",
    familyTo: "Barlow Condensed",
    cssFiles: ["500.css", "700.css"]
  },
  {
    packageName: "@fontsource/ibm-plex-mono",
    directory: "ibm-plex-mono",
    familyFrom: "IBM Plex Mono",
    familyTo: "IBM Plex Mono",
    cssFiles: ["400.css", "600.css"]
  },
  {
    packageName: "@fontsource-variable/roboto-mono",
    directory: "roboto-mono",
    familyFrom: "Roboto Mono Variable",
    familyTo: "Roboto Mono",
    cssFiles: ["index.css"]
  }
];

function requireFile(source) {
  const absolute = path.join(root, source);
  if (!fs.existsSync(absolute)) {
    throw new Error(`Missing runtime vendor: ${source}`);
  }
  return absolute;
}

fs.rmSync(outputDirectory, { recursive: true, force: true });
fs.mkdirSync(outputDirectory, { recursive: true });

for (const [source, target] of vendors) {
  fs.copyFileSync(requireFile(source), path.join(outputDirectory, target));
}

const fontAwesomeCss = fs.readFileSync(
  requireFile("node_modules/@fortawesome/fontawesome-free/css/all.min.css"),
  "utf8"
).replaceAll("../webfonts/", "./webfonts/");
fs.writeFileSync(
  path.join(outputDirectory, "fontawesome.min.css"),
  fontAwesomeCss
);
fs.cpSync(
  requireFile("node_modules/@fortawesome/fontawesome-free/webfonts"),
  path.join(outputDirectory, "webfonts"),
  { recursive: true }
);

const fontCss = [];
for (const font of fontSources) {
  const packageDirectory = path.join(root, "node_modules", font.packageName);
  const filesDirectory = requireFile(
    `node_modules/${font.packageName}/files`
  );
  fs.cpSync(
    filesDirectory,
    path.join(outputDirectory, "fonts", font.directory),
    { recursive: true }
  );
  for (const cssFile of font.cssFiles) {
    const css = fs.readFileSync(
      path.join(packageDirectory, cssFile),
      "utf8"
    )
      .replaceAll(font.familyFrom, font.familyTo)
      .replaceAll(
        "./files/",
        `./fonts/${font.directory}/`
      );
    fontCss.push(css);
  }
}
const alibabaFontSource = path.join(
  process.env.LOCALAPPDATA || "",
  "Microsoft",
  "Windows",
  "Fonts",
  "AlibabaPuHuiTi-3-95-ExtraBold.ttf"
);
if (!fs.existsSync(alibabaFontSource)) {
  throw new Error(`Missing required Alibaba PuHuiTi ExtraBold font: ${alibabaFontSource}`);
}
const alibabaFontDirectory = path.join(
  outputDirectory,
  "fonts",
  "alibaba-puhuiti"
);
fs.mkdirSync(alibabaFontDirectory, { recursive: true });
fs.copyFileSync(
  alibabaFontSource,
  path.join(alibabaFontDirectory, "alibaba-puhuiti-extra-bold.ttf")
);
fontCss.push(`@font-face {
  font-family: "Alibaba PuHuiTi 3.0";
  font-style: normal;
  font-display: swap;
  font-weight: 800;
  src: url("./fonts/alibaba-puhuiti/alibaba-puhuiti-extra-bold.ttf") format("truetype");
}`);
fs.writeFileSync(
  path.join(outputDirectory, "fonts.css"),
  `/* SierraStudio bundled offline fonts */\n${fontCss.join("\n")}`
);

console.log(
  `[runtime-vendors] Copied ${vendors.length} libraries, Font Awesome, `
  + `${fontSources.length + 1} font families to ${outputDirectory}`
);
