export const WELCOME_SAMPLE_NAME = "SierraStudio 入门样例";

export const WELCOME_SAMPLE_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SierraStudio 入门样例</title>
  <style>
    :root { --ink: #172033; --muted: #657089; --line: #e5e9f1; --accent: #5b6cff; --surface: #fff; }
    * { box-sizing: border-box; }
    body { margin: 0; color: var(--ink); background: #f5f7fb; font-family: Inter, "Microsoft YaHei", system-ui, sans-serif; }
    main { width: min(1120px, calc(100% - 48px)); margin: 0 auto; padding: 72px 0 88px; }
    .eyebrow { margin: 0 0 16px; color: var(--accent); font-size: 14px; font-weight: 700; letter-spacing: .08em; }
    h1 { max-width: 760px; margin: 0; font-size: clamp(40px, 6vw, 72px); line-height: 1.05; letter-spacing: -.04em; }
    .intro { max-width: 680px; margin: 24px 0 40px; color: var(--muted); font-size: 18px; line-height: 1.8; }
    .tips { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; }
    .card { min-height: 210px; padding: 28px; border: 1px solid var(--line); border-radius: 22px; background: var(--surface); box-shadow: 0 16px 40px rgba(33, 43, 67, .07); }
    .number { display: grid; width: 38px; height: 38px; margin-bottom: 34px; place-items: center; border-radius: 12px; color: #fff; background: var(--accent); font-weight: 700; }
    h2 { margin: 0 0 10px; font-size: 20px; }
    .card p { margin: 0; color: var(--muted); line-height: 1.7; }
    .footer-note { margin: 32px 0 0; color: var(--muted); font-size: 14px; text-align: center; }
    @media (max-width: 760px) {
      main { width: min(100% - 32px, 560px); padding-top: 48px; }
      .tips { grid-template-columns: 1fr; }
      h1 { font-size: 42px; }
    }
  </style>
</head>
<body>
  <main data-hs-id="welcome-main">
    <p class="eyebrow" data-hs-id="welcome-eyebrow">WELCOME TO SIERRASTUDIO</p>
    <h1 data-hs-id="welcome-title">从这个样例开始，试着编辑你的第一个页面。</h1>
    <p class="intro" data-hs-id="welcome-intro">双击文字放置光标，再次双击可以选词。单击卡片后，可在右侧修改内容与样式，也可以开启自由移动。</p>
    <section class="tips" data-hs-id="welcome-cards">
      <article class="card" data-hs-id="welcome-card-edit">
        <span class="number" data-hs-id="welcome-number-1">01</span>
        <h2 data-hs-id="welcome-card-title-1">编辑文字</h2>
        <p data-hs-id="welcome-card-copy-1">双击这段文字进入编辑，右侧栏会同步显示当前样式。</p>
      </article>
      <article class="card" data-hs-id="welcome-card-style">
        <span class="number" data-hs-id="welcome-number-2">02</span>
        <h2 data-hs-id="welcome-card-title-2">调整样式</h2>
        <p data-hs-id="welcome-card-copy-2">尝试更换颜色、字号、圆角与间距，画布会实时更新。</p>
      </article>
      <article class="card" data-hs-id="welcome-card-move">
        <span class="number" data-hs-id="welcome-number-3">03</span>
        <h2 data-hs-id="welcome-card-title-3">移动组件</h2>
        <p data-hs-id="welcome-card-copy-3">选中卡片并开启自由移动，即可拖动或使用方向按钮微调。</p>
      </article>
    </section>
    <p class="footer-note" data-hs-id="welcome-footer">这是一个普通本地项目，你的修改可以撤销，也可以导出为 HTML。</p>
  </main>
</body>
</html>`;
