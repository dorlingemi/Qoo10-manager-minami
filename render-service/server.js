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

    // 検索ボックスを探して入力
    // Qoo10のサイト構造に合わせて複数のセレクタ候補を試す
    const INPUT_SELECTORS = [
      'input[name="keyword"]',
      'input[type="search"]',
      '#searchKeyword',
      '.search_input input',
      'input[placeholder*="検索"]',
    ];

    let inputEl = null;
    for (const sel of INPUT_SELECTORS) {
      inputEl = await page.$(sel);
      if (inputEl) break;
    }

    if (!inputEl) {
      return res.status(500).json({ error: '検索ボックスが見つかりませんでした' });
    }

    await inputEl.click();
    await inputEl.fill('');
    await inputEl.type(keyword, { delay: 80 });

    // 補完ドロップダウンが出るまで最大3秒待機
    const SUGGEST_SELECTORS = [
      '.suggest_list li',
      '.autocomplete li',
      '[class*="suggest"] li',
      '[class*="autocomplete"] li',
      '[class*="dropdown"] li',
      'ul[class*="suggest"] li',
    ];

    let suggestions = [];
    const deadline = Date.now() + 3000;

    while (Date.now() < deadline) {
      await page.waitForTimeout(300);
      for (const sel of SUGGEST_SELECTORS) {
        const items = await page.$$(sel);
        if (items.length > 0) {
          suggestions = await Promise.all(
            items.map(el => el.innerText().catch(() => ''))
          );
          suggestions = suggestions.map(s => s.trim()).filter(s => s.length > 0);
          if (suggestions.length > 0) break;
        }
      }
      if (suggestions.length > 0) break;
    }

    // フォールバック: ページ内のdataからも試みる
    if (suggestions.length === 0) {
      suggestions = await page.evaluate(() => {
        // Qoo10がJSオブジェクトに補完データを持っている場合
        if (window.__AUTOCOMPLETE_DATA__) return window.__AUTOCOMPLETE_DATA__;
        return [];
      });
    }

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
