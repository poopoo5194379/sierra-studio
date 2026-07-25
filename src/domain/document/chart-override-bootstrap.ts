import { CHART_MANIFEST_ATTRIBUTE } from "../charts/chart-manifest";
import { insertBeforeLastClosingTag } from "./html-injection";

const CHART_OVERRIDE_RUNTIME = String.raw`
(function () {
  var manifestElement = document.querySelector("script[data-hs-chart-manifest]");
  if (!manifestElement) return;
  var manifest;
  try { manifest = JSON.parse(manifestElement.textContent || "{}"); }
  catch (_) { return; }
  var asObject = function (value) {
    return value && typeof value === "object" ? value : {};
  };
  var pathFromAnchor = function (element, anchor) {
    var indexes = [];
    var current = element;
    while (current && current !== anchor) {
      var parent = current.parentElement;
      if (!parent) break;
      indexes.unshift(Array.prototype.indexOf.call(parent.children, current));
      current = parent;
    }
    return indexes.join(".");
  };
  var keyFor = function (element, engine, candidates) {
    var nodeId = element.getAttribute("data-hs-id")
      || element.getAttribute("data-hs-chart-stable-id");
    if (nodeId) return engine + ":node:" + nodeId;
    if (element.id) return engine + ":id:" + element.id;
    var anchor = element.closest(
      "[data-hs-id], [data-hs-chart-stable-id]"
    );
    if (anchor) {
      var anchorId = anchor.getAttribute("data-hs-id")
        || anchor.getAttribute("data-hs-chart-stable-id");
      return engine + ":anchor:" + anchorId + ":" + pathFromAnchor(element, anchor);
    }
    return engine + ":ordinal:" + candidates.indexOf(element);
  };
  var applyECharts = function () {
    if (!window.echarts || typeof window.echarts.getInstanceByDom !== "function") {
      return;
    }
    var elements = Array.from(document.querySelectorAll("[_echarts_instance_]"));
    elements.forEach(function (element) {
      var patch = manifest[keyFor(element, "echarts", elements)];
      var chart = window.echarts.getInstanceByDom(element);
      if (!patch || !chart) return;
      var option = {};
      if (patch.title !== undefined) option.title = { text: patch.title };
      if (patch.legendVisible !== undefined) {
        option.legend = { show: patch.legendVisible };
      }
      if (patch.primaryColor !== undefined) {
        var current = chart.getOption();
        var palette = Array.isArray(current.color) ? current.color.slice() : [];
        palette[0] = patch.primaryColor;
        option.color = palette;
      }
      if (patch.data !== undefined) {
        if (patch.data.labels) option.xAxis = { data: patch.data.labels };
        option.series = patch.data.series.map(function (series) {
          return {
            name: series.name,
            type: series.type,
            data: series.data
          };
        });
      }
      chart.setOption(option, false);
      chart.resize();
    });
  };
  var chartJsInstances = function () {
    var instances = window.Chart && window.Chart.instances;
    return instances instanceof Map
      ? Array.from(instances.values())
      : Object.values(instances || {});
  };
  var applyChartJs = function () {
    var charts = chartJsInstances();
    var canvases = charts.map(function (chart) { return chart.canvas; });
    charts.forEach(function (chart) {
      if (!chart || !chart.canvas) return;
      var patch = manifest[keyFor(chart.canvas, "chartjs", canvases)];
      if (!patch) return;
      var plugins = asObject(chart.options.plugins);
      chart.options.plugins = plugins;
      if (patch.title !== undefined) {
        var title = asObject(plugins.title);
        title.display = patch.title.length > 0;
        title.text = patch.title;
        plugins.title = title;
      }
      if (patch.legendVisible !== undefined) {
        var legend = asObject(plugins.legend);
        legend.display = patch.legendVisible;
        plugins.legend = legend;
      }
      if (
        patch.primaryColor !== undefined
        && chart.config.data
        && chart.config.data.datasets
        && chart.config.data.datasets[0]
      ) {
        chart.config.data.datasets[0].backgroundColor = patch.primaryColor;
        chart.config.data.datasets[0].borderColor = patch.primaryColor;
      }
      if (patch.data !== undefined && chart.config.data) {
        if (patch.data.labels) chart.config.data.labels = patch.data.labels;
        chart.config.data.datasets = patch.data.series.map(function (series, index) {
          var current = chart.config.data.datasets[index] || {};
          return Object.assign({}, current, {
            label: series.name,
            data: series.data
          });
        });
      }
      chart.update("none");
      chart.resize();
    });
  };
  var apply = function () {
    applyECharts();
    applyChartJs();
  };
  [0, 100, 500, 1500].forEach(function (delay) {
    window.setTimeout(apply, delay);
  });
  window.addEventListener("load", apply, { once: true });
})();`;

export function injectChartOverrideBootstrap(sourceHtml: string): string {
  if (!sourceHtml.includes(CHART_MANIFEST_ATTRIBUTE)) return sourceHtml;
  const script = `<script data-hs-chart-runtime>${CHART_OVERRIDE_RUNTIME}</script>`;
  return insertBeforeLastClosingTag(sourceHtml, "body", script);
}
