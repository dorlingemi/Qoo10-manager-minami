/**
 * Parser.gs — HTML解析モジュール（正規表現ベース）
 *
 * Qoo10のHTML構造に合わせたセレクタ。
 * サイト改修でセレクタが変わった場合はここのみ修正する。
 */

var Parser = (function () {

  // ── ユーティリティ ────────────────────────────────────

  /**
   * 正規表現で最初にマッチした第1キャプチャグループを返す
   */
  function _extract(html, pattern, flags) {
    var re    = new RegExp(pattern, flags || 'i');
    var match = html.match(re);
    return match ? (match[1] || '').trim() : '';
  }

  /**
   * 正規表現でマッチした全キャプチャを配列で返す
   */
  function _extractAll(html, pattern, flags) {
    var re      = new RegExp(pattern, flags || 'gi');
    var results = [];
    var match;
    while ((match = re.exec(html)) !== null) {
      results.push(match[1] ? match[1].trim() : match[0].trim());
    }
    return results;
  }

  /** 数値文字列をパース（カンマ・円記号を除去） */
  function _num(str) {
    if (!str) return 0;
    var n = parseFloat(String(str).replace(/[^0-9.]/g, ''));
    return isNaN(n) ? 0 : n;
  }

  /**
   * HTML内のJSON-LD（schema.org Product）ブロックをパースして返す。
   * 実際のQoo10商品ページで確認済み（2026-06-30検証）の構造:
   *   {"@type":"Product","name":..,"image":[...],"brand":{"name":..},
   *    "sku":..,"offers":{"price":..,"priceSpecification":[{"priceType":"ListPrice"|"SalePrice","price":..}]}}
   * aggregateRating（レビュー数・評価）は含まれないため別途HTML解析が必要。
   * @returns {Object|null}
   */
  function _parseJsonLd(html) {
    var block = _extract(html, '<script[^>]+type="application/ld\\+json"[^>]*>([\\s\\S]*?)</script>');
    if (!block) return null;
    try {
      return JSON.parse(block);
    } catch (e) {
      return null;
    }
  }

  // ── 商品ページ解析 ────────────────────────────────────

  /**
   * 商品ページHTMLから商品情報オブジェクトを生成する
   *
   * JSON-LD構造化データ（schema.org Product）を最優先のデータ源とする
   * （title/brand/image/price/skuは実データで検証済み・高信頼）。
   * JSON-LDに含まれない項目（店舗名/レビュー/販売累計/カテゴリ/店舗評価）は
   * HTML正規表現フォールバックだが、こちらは実HTML未検証の暫定パターン。
   * オートコンプリート用の隠しウィジェット（id="ac_total_*"）が同名クラスを
   * 使い回しているため、誤検出を避けるため "mshop_bar"（実店舗バー）以降の
   * 範囲に限定して検索する。
   *
   * @param {string} html
   * @param {string} url
   * @returns {Object} product
   */
  function parseProduct(html, url) {
    if (!html) return null;

    var p  = {};
    var ld = _parseJsonLd(html);

    p.url       = url;
    p.fetchedAt = new Date().toISOString();
    p.itemNo    = (ld && ld.sku) || _extract(url, '/g/(\\d+)') || _extract(url, '/(\\d+)(?:[?#]|$)');

    // mshop_bar以降に限定した検索範囲（自動補完ウィジェットの誤検出回避）
    var shopBarIdx = html.indexOf('mshop_bar');
    var tail       = shopBarIdx >= 0 ? html.slice(shopBarIdx) : html;

    // タイトル・ブランド（JSON-LD優先）
    p.title = (ld && ld.name) ||
              _extract(html, '<title>([^<]+)</title>').replace(/\s*[\|｜]\s*Qoo10.*$/, '').trim();
    p.brand = (ld && ld.brand && ld.brand.name) ||
              _extract(html, 'class="[^"]*brand[^"]*"[^>]*>([^<]+)<');

    // 画像（JSON-LDのimage配列を優先。実データで複数枚を確認済み）
    var images = (ld && Array.isArray(ld.image)) ? ld.image
               : _extractAll(html, 'itemprop="image"[^>]+content="([^"]+)"');
    p.imageCount = images.length;
    p.mainImage  = images[0] || '';
    p.hasVideo   = /(?:youtube|vimeo|mp4|\.m3u8|video)/i.test(html);

    // 価格（JSON-LDのoffers.priceSpecificationにListPrice/SalePriceが分かれて入る）
    var listPrice = 0, salePrice = 0;
    if (ld && ld.offers) {
      salePrice = _num(ld.offers.price);
      if (Array.isArray(ld.offers.priceSpecification)) {
        ld.offers.priceSpecification.forEach(function (ps) {
          if (ps.priceType === 'ListPrice') listPrice = _num(ps.price);
          if (ps.priceType === 'SalePrice') salePrice = _num(ps.price) || salePrice;
        });
      }
    }
    p.salePrice     = salePrice || _num(_extract(html, 'class="prc">\\s*<strong>([\\d,]+)円'));
    p.originalPrice = listPrice > p.salePrice ? listPrice : 0;
    p.discount      = p.originalPrice > 0
                     ? Math.round((1 - p.salePrice / p.originalPrice) * 100)
                     : 0;

    // クーポン（未検証の暫定パターン）
    p.shopCoupon = _num(_extract(tail, 'shop[_-]?coupon[^>]*>[^<]*([\\d,]+)'));
    p.itemCoupon = _num(_extract(tail, 'item[_-]?coupon[^>]*>[^<]*([\\d,]+)'));
    p.finalPrice = p.salePrice - p.shopCoupon - p.itemCoupon;

    // 配送（未検証の暫定パターン）
    p.shippingFee     = _extract(tail, '(?:配送料|送料)[^<]*([\\d,]+円|無料|FREE)') ||
                        _extract(tail, 'shipping[_-]?(?:fee|cost)[^>]*>([^<]+)<');
    p.isFreeShip       = /無料|FREE|0円/i.test(p.shippingFee);
    p.shippingDays     = _extract(tail, '(?:発送|配送)[^<]*?(\\d+)[^<]*?(?:日|days?)') || '';
    p.shippingMethod   = _extract(tail, '(?:配送方法|shipping method)[^<]*<[^>]+>([^<]+)<') || '';

    // 店舗名（mshop_bar内のshopリンクのslugから推定。表示名が取れた場合はそちらを優先）
    var shopSlug = _extract(tail, '/shop/([a-zA-Z0-9_-]+)');
    p.shopName   = _extract(tail, 'class="[^"]*shop[_-]?nm[^"]*"[^>]*>([^<]+)<') ||
                  _extract(tail, '/shop/[a-zA-Z0-9_-]+"[^>]*>([^<]+)<') ||
                  (shopSlug ? shopSlug.replace(/[_-]/g, ' ') : '');  // 推測フォールバック

    // 販売累計・レビュー（JSON-LDに含まれないため要実データ検証。現状は未確定の暫定パターン）
    p.totalSales  = _num(_extract(tail, '販売累計[^<]*<[^>]+>([\\d,]+)') ||
                         _extract(tail, 'sales[_-]?count[^>]*>([\\d,]+)'));
    p.reviewCount = _num(_extract(tail, '(?:レビュー|review)[^<]*?([\\d,]+)件') ||
                         _extract(tail, 'review[_-]?count[^>]*>([\\d,]+)'));
    p.reviewScore = _num(_extract(tail, 'class="[^"]*rating[^"]*"[^>]*>([\\d.]+)<'));
    p.wishlistCount = _num(_extract(tail, 'wishlist[^>]*>([\\d,]+)') ||
                           _extract(tail, '気になる[^<]*([\\d,]+)'));

    // カテゴリ（未検証の暫定パターン）
    p.category = _extractAll(html, 'class="[^"]*breadcrumb[^"]*"[^>]*>([^<]+)<').join(' > ');

    // 店舗評価（未検証の暫定パターン）
    p.storeScore = _num(_extract(tail, 'seller[_-]?(?:score|rating)[^>]*>([\\d.]+)'));
    p.storeGrade = _extract(tail, 'seller[_-]?grade[^>]*>([^<]+)<') || '';

    // 上市日（JSON-LDにdatePublishedがあれば使用。今回未確認のため空の可能性あり）
    p.listedDate = (ld && ld.datePublished) || '';

    // SKU数（未検証の暫定パターン）
    var skus = _extractAll(tail, 'class="[^"]*(?:option|sku)[^"]*"[^>]*>([^<]+)<');
    p.skuCount = skus.length;

    p.titleLength = p.title.length;

    // 詳細ページ推定文字数（未検証の暫定パターン）
    var descHtml = _extract(html, 'id="[^"]*(?:desc|detail|itemDetail)[^"]*"[^>]*>([\\s\\S]*?)</div>', 'i');
    p.descLength = descHtml ? descHtml.replace(/<[^>]+>/g, '').length
                 : ((ld && ld.description) || '').length;

    return p;
  }

  // ── 検索結果ページ解析 ────────────────────────────────

  /**
   * 検索結果HTMLから商品リストを抽出する
   *
   * 実際のQoo10検索結果ページ（https://www.qoo10.jp/s/{keyword}?keyword=...）を
   * レンダリングサービス経由で取得・解析し、以下の実HTML構造を確認済み（2026-06-30検証）:
   *
   *   <tr id="g_{itemNo}" goodscode="{itemNo}" list_type="search_new_list_type" ga-product="goods|goods_power|cps_goods|keywordplus">
   *     <td class="td_thmb">
   *       <a class="img_cut" ... img_cnt="44">images:</a>
   *       <a href="https://www.qoo10.jp/item/{slug}/{itemNo}..." title="{title}">
   *         <img src="..." gd_src="{realImgUrl}" alt="{title}">
   *       </a>
   *     </td>
   *     <td class="td_item">
   *       <a class="txt_brand" title="{brand}" href=".../Brand.aspx?...">{brand}</a>   ← ブランドがある場合のみ
   *       <a href="...">{title}</a>
   *       <div class="review_rating_star" style="width: 86%"></div>   ← 86% ÷ 100 × 5 = 評価スコア
   *       <span class="review_total_count">(200)</span>               ← レビュー数
   *       <a href="https://www.qoo10.jp/shop/{shopId}?cit=..." title="{shopTitle}" class="lnk_sh">{shopName}</a>
   *     </td>
   *     <td class="td_prc">
   *       <div class="prc"><strong>4,950円</strong><span class="dc_prc"><del>5,050円</del> (100円 ↓)</span></div>
   *     </td>
   *     <td class="td_ship">
   *       <div class="ship_area"><div class="ship free"><dfn>Shipping rate:</dfn> 無料</div>...
   *     </td>
   *   </tr>
   *
   * ga-product="keywordplus" は検索キーワード連動のスポンサー広告枠（プラスアイテム）。
   * "goods" / "goods_power" / "cps_goods" は自然検索結果（goods_powerはパワーセラー商品の可能性、推測）。
   *
   * @param {string} html
   * @returns {Array<{itemNo, title, url, brand, shopName, price, originalPrice,
   *                   reviewCount, reviewScore, imageCount, isFreeShip, rank, isSponsored}>}
   */
  function parseSearchResults(html) {
    if (!html) return [];

    var results    = [];
    var rowPattern  = /<tr id="g_(\d+)"[^>]*ga-product="([^"]+)"[^>]*>([\s\S]*?)<\/tr>/gi;
    var rank        = 0;
    var match;

    while ((match = rowPattern.exec(html)) !== null) {
      var itemNo   = match[1];
      var gaProduct= match[2];
      var chunk    = match[3];
      rank++;

      var item = {};
      item.rank        = rank;
      item.itemNo       = itemNo;
      item.isSponsored  = (gaProduct === 'keywordplus');
      item.gaProduct    = gaProduct;

      item.title        = _extract(chunk, 'title="([^"]+)"\\s+target="_blank"\\s+data-type="goods_url"') ||
                          _extract(chunk, 'alt="([^"]+)"');
      item.url          = _extract(chunk, '(https://www\\.qoo10\\.jp/item/[^"]+)"\\s+title=') ||
                          (CONFIG.CRAWL.PRODUCT_URL_PREFIX + itemNo);
      item.brand        = _extract(chunk, 'class="txt_brand"\\s+title="([^"]+)"');

      // 画像数（img_cntは画像オーバーレイ数のため未確定だが現状唯一の指標として採用）
      item.imageCount   = parseInt(_extract(chunk, 'img_cnt="(\\d+)"'), 10) || 0;
      item.mainImage    = _extract(chunk, 'gd_src="([^"]+)"') ||
                          _extract(chunk, '<img[^>]+src="([^"]+)"');

      // 評価：星表示の幅(%) ÷ 100 × 5
      var ratingPct     = _num(_extract(chunk, 'review_rating_star"\\s+style="width:\\s*([\\d.]+)%'));
      item.reviewScore  = ratingPct > 0 ? Math.round((ratingPct / 100) * 5 * 10) / 10 : 0;
      item.reviewCount  = _num(_extract(chunk, 'review_total_count">\\(([\\d,]+)\\)'));

      item.shopName     = _extract(chunk, 'class="lnk_sh"[^>]*>(?:<span[^>]*>[^<]*</span>)?([^<]+)<') ||
                          _extract(chunk, 'class="lnk_sh"\\s+title="([^"]+)"');

      item.price         = _num(_extract(chunk, 'class="prc">\\s*<strong>([\\d,]+)円'));
      item.originalPrice = _num(_extract(chunk, '<del>([\\d,]+)円</del>'));

      item.isFreeShip    = /<div class="ship free">/.test(chunk);

      // 累計販売数は検索結果カードには表示されないため商品詳細ページ側で取得する
      item.totalSales    = 0;

      results.push(item);
    }

    if (results.length === 0) {
      AppLogger.warn('parseSearchResults: 0件抽出。Qoo10のHTML構造が変更された可能性あり', html.slice(0, 300));
    }

    return results;
  }

  // ── 公開API ───────────────────────────────────────────

  return {
    parseProduct:       parseProduct,
    parseSearchResults: parseSearchResults,
  };

})();
