/**
 * Crawler.gs — HTTP取得モジュール
 *
 * Qoo10はbot対策（Cloudflare等のWAF）を行っており、GASの UrlFetchApp による
 * 直接アクセスはブロックされることが実機検証で確認されている
 * （UrlFetchApp自体はGoogleのサーバーIPから発信され、JSも実行しないため）。
 *
 * そのため実際の取得は render-service/（Cloud Run + Playwright のヘッドレスブラウザ）
 * 経由で行う。このサービスが実ブラウザでQoo10ページを開き、
 * JS/Ajax/LazyLoad完了・ポップアップ閉じまで済ませた最終HTMLを返す。
 * GASからQoo10へ直接アクセスすることはない。
 */

var Crawler = (function () {

  /**
   * レンダリングサービス経由でURLの最終HTMLを取得する（リトライあり）
   * @param {string} url
   * @returns {string|null} HTML文字列
   */
  function fetch(url) {
    var renderCfg = CONFIG.RENDER;

    if (!renderCfg.SERVICE_URL || renderCfg.SERVICE_URL.indexOf('YOUR-CLOUD-RUN') >= 0) {
      AppLogger.error('RENDER.SERVICE_URLが未設定です。render-service/をCloud Runにデプロイし、Config.gsに設定してください。', url);
      return null;
    }

    var options = {
      method:             'POST',
      contentType:        'application/json',
      headers: {
        'x-api-key': renderCfg.API_KEY,
      },
      payload: JSON.stringify({
        url:    url,
        waitMs: renderCfg.WAIT_MS,
      }),
      followRedirects:    true,
      muteHttpExceptions: true,
    };

    for (var attempt = 1; attempt <= CONFIG.CRAWL.RETRY_COUNT; attempt++) {
      try {
        Utilities.sleep(CONFIG.CRAWL.REQUEST_DELAY_MS);
        var response = UrlFetchApp.fetch(renderCfg.SERVICE_URL, options);
        var code     = response.getResponseCode();

        if (code === 200) {
          var body = JSON.parse(response.getContentText('UTF-8'));
          AppLogger.info('Render OK (status ' + body.status + ')', url);
          return body.html;
        }

        AppLogger.warn('Render service HTTP ' + code + ' (attempt ' + attempt + ')',
          url + ' :: ' + response.getContentText('UTF-8').slice(0, 300));

      } catch (e) {
        AppLogger.error('Render fetch error (attempt ' + attempt + '): ' + e.message, url);
      }

      if (attempt < CONFIG.CRAWL.RETRY_COUNT) {
        Utilities.sleep(CONFIG.CRAWL.RETRY_DELAY_MS);
      }
    }

    AppLogger.error('All retries failed (render service)', url);
    return null;
  }

  /**
   * Qoo10検索結果ページのHTMLを取得する
   * URL形式: https://www.qoo10.jp/s/{keyword}?keyword={keyword}&keyword_auto_change=
   * （実ブラウザで確認済み。pageパラメータは未確認のため "推測" で付与）
   * @param {string} keyword
   * @param {number} page 1-based
   * @returns {string|null}
   */
  function fetchSearch(keyword, page) {
    var encoded = encodeURIComponent(keyword);
    var url = CONFIG.CRAWL.SEARCH_URL + encoded
      + '?keyword=' + encoded
      + '&keyword_auto_change='
      + (page && page > 1 ? '&page=' + page : '');  // 推測: pageパラメータ未検証
    return fetch(url);
  }

  /**
   * 商品ページHTMLを取得する
   * @param {string} productUrl  完全URL または 商品ID
   * @returns {string|null}
   */
  function fetchProduct(productUrl) {
    var url = productUrl.indexOf('http') === 0
      ? productUrl
      : CONFIG.CRAWL.PRODUCT_URL_PREFIX + productUrl;
    return fetch(url);
  }

  /**
   * カテゴリランキングページを取得する
   * @param {string} categoryCode
   * @returns {string|null}
   */
  function fetchRanking(categoryCode) {
    var url = CONFIG.CRAWL.BASE_URL + '/gmkt.inc/Best/Best.aspx?cat=' + categoryCode;
    return fetch(url);
  }

  return {
    fetch:        fetch,
    fetchSearch:  fetchSearch,
    fetchProduct: fetchProduct,
    fetchRanking: fetchRanking,
  };

})();
