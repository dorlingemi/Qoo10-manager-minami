/**
 * server.js — Qoo10ページをヘッドレスブラウザで実際にレンダリングし、
 * JS/Ajax/LazyLoad完了後の最終HTMLを返すサービス。
 *
 * GAS (Crawler.gs) からはこのサービスのみを叩く。Qoo10へは直接アクセスしない。
 *
 * POST /render
 *   body: { url: string, waitMs?: number }
 *   resp: { html: string, finalUrl: string, status: number }
 */

const express  = require('express');
const { chromium } = require('playwright');

const app  = express();
app.use(express.json());

const PORT      = process.env.PORT || 8080;
const API_KEY   = process.env.API_KEY || '';  // 必須: Cloud Runデプロイ時に環境変数で設定
const UA        = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// 閉じるべきポップアップ/バナーの候補セレクタ（推測：実際のQoo10 DOMに合わせて要調整）
const DISMISS_SELECTORS = [
  'button:has-text("同意")',
  'button:has-text("許可")',
  'button:has-text("閉じる")',
  'button:has-text("ACCEPT")',
  '[class*="cookie"] button',
  '[class*="modal"] [class*="close"]',
  '[class*="popup"] [class*="close"]',
  '[aria-label="Close"]',
  '.btn_close',
];

let browserPromise = null;

function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      headless: true,
      args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
    });
  }
  return browserPromise;
}

app.get('/health', (req, res) => res.json({ ok: true }));

app.post('/render', async (req, res) => {
  // ── 認証 ──────────────────────────────────────────────
  if (API_KEY && req.headers['x-api-key'] !== API_KEY) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const { url, waitMs } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url is required' });

  let context, page;
  try {
    const browser = await getBrowser();
    context = await browser.newContext({
      userAgent: UA,
      viewport: { width: 1366, height: 900 },
      locale: 'ja-JP',
    });
    page = await context.newPage();

    // 不要なリソース（広告計測等）をブロックして高速化（任意）
    await page.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (type === 'font' || type === 'media') return route.abort();
      return route.continue();
    });

    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // networkidleは継続的なポーリング（広告/解析タグ等）があるサイトでは
    // 永久に発火しないため使用しない。代わりに固定+条件待機を併用する。
    try {
      await page.waitForLoadState('load', { timeout: 10000 });
    } catch (e) { /* ロード未完了でも続行 */ }

    // ── ポップアップ・バナーを自動で閉じる ────────────────
    for (const sel of DISMISS_SELECTORS) {
      try {
        const el = await page.$(sel);
        if (el) await el.click({ timeout: 1000 });
      } catch (e) { /* 存在しない場合は無視 */ }
    }

    // ── Lazy Load対策：複数回スクロールして画像読み込みを促す ─
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight));
      await page.waitForTimeout(400);
    }
    await page.evaluate(() => window.scrollTo(0, 0));

    // ── 追加待機（Ajaxの遅延読み込み対策） ─────────────────
    await page.waitForTimeout(waitMs || 1500);

    const html = await page.content();

    res.json({
      html:     html,
      finalUrl: page.url(),
      status:   response ? response.status() : 0,
    });

  } catch (e) {
    console.error('Render error:', e.message);
    res.status(500).json({ error: e.message });
  } finally {
    if (page)    await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
  }
});

/**
 * POST /autocomplete
 *   body: { keyword: string }
 *   resp: { suggestions: string[] }
 *
 * Qoo10の検索ボックスにキーワードを入力し、
 * 表示された補完候補を返す。
 */
app.post('/autocomplete', async (req, res) => {
  if (API_KEY && req.headers['x-api-key'] !== API_KEY) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const { keyword } = req.body || {};
  if (!keyword) return res.status(400).json({ error: 'keyword is required' });

  let context, page;
  try {
    const browser = await getBrowser();
    context = await browser.newContext({
      userAgent: UA,
      viewport: { width: 1366, height: 900 },
      locale: 'ja-JP',
    });
    page = await context.newPage();

    // 画像/フォント/メディアをブロックして高速化
    await page.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (['image', 'font', 'media', 'stylesheet'].includes(type)) return route.abort();
      return route.continue();
    });

    await page.goto('https://www.qoo10.jp/', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    let suggestions = [];

    await page.goto('https://www.qoo10.jp/', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    // ポップアップを閉じる
    for (const sel of DISMISS_SELECTORS) {
      try {
        const el = await page.$(sel);
        if (el) await el.click({ timeout: 2000 });
      } catch (e) {}
    }
    await page.waitForTimeout(300);

    // 検索ボックスを探す
    const INPUT_SELECTORS = [
      'input[name="keyword"]',
      'input[type="search"]',
      '#searchKeyword',
      '.search_input input',
      'input[placeholder*="検索"]',
    ];

    let inputSel = null;
    for (const sel of INPUT_SELECTORS) {
      const el = await page.$(sel);
      if (el) { inputSel = sel; break; }
    }

    if (!inputSel) {
      return res.status(500).json({ error: '検索ボックスが見つかりませんでした' });
    }

    // キーワードを入力して補完候補を出現させる
    await page.focus(inputSel);
    await page.fill(inputSel, '');
    await page.type(inputSel, keyword, { delay: 100 });

    // 補完ドロップダウンが描画されるまで待機
    await page.waitForTimeout(2000);

    // キーワードの先頭2文字で部分一致フィルタ（ナビ・無関係リストを除外）
    const prefix = keyword.slice(0, 2);
    const allLiTexts = await page.$$eval('li', els =>
      els.map(el => el.innerText.trim()).filter(t => t.length >= 2 && t.length <= 60)
    );

    suggestions = allLiTexts
      .filter(text => text.includes(prefix))  // 入力語の先頭2文字を含むもののみ
      .slice(0, 20);                           // 最大20件

    console.log('[autocomplete] prefix="' + prefix + '" → ' + suggestions.length + '件:', suggestions);

    res.json({ keyword, suggestions });

  } catch (e) {
    console.error('Autocomplete error:', e.message);
    res.status(500).json({ error: e.message });
  } finally {
    if (page)    await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
  }
});

app.listen(PORT, () => {
  console.log(`Qoo10 render service listening on port ${PORT}`);
});
