/**
 * OfficialApi.gs — Qoo10公式API（QSM/QAPI）連携モジュール
 *
 * 自社店舗の商品・売上データ専用。競合他社の商品情報はこのAPIでは取得できない
 * （QAPIは販売者自身の店舗管理用インターフェースのため）。
 * 競合データの取得は引き続き Crawler.gs（render-service経由）を使用する。
 *
 * 利用メソッド（Qoo10 API連動定義書 全体Methodリストより）:
 *   - GetItemDetailInfo          : 商品コードを指定して単一商品の詳細を照会
 *   - GetSellingReportDetailList : 販売内訳（売上明細）を照会
 *   - GetAllGoodsInfo            : 販売状態別の商品番号一覧を照会（最大500件/ページ）
 *
 * ⚠️ レスポンスJSONの正確なフィールド名は未検証（公式ドキュメント非公開のため）。
 *    debugTestOfficialApi() を実行し、Logシートに出力された実際のJSON構造を確認のうえ
 *    _mapItemDetail() / _mapSellingReport() のフィールド名を実データに合わせて修正すること。
 */

var OfficialApi = (function () {

  /**
   * QAPIへPOSTリクエストを送信する
   * @param {string} method  例: 'GetItemDetailInfo'
   * @param {Object} params  メソッド固有パラメータ（returnTypeは自動付与）
   * @returns {Object|null} パース済みJSON、失敗時null
   */
  function _call(method, params) {
    var cfg = CONFIG.OFFICIAL_API;
    if (!cfg.ENABLED) {
      AppLogger.warn('OfficialApi: ENABLED=falseのため呼び出しをスキップ', method);
      return null;
    }
    if (!cfg.SAK || cfg.SAK.indexOf('YOUR_GIOSIS') >= 0) {
      AppLogger.error('OfficialApi: SAK（GiosisCertificationKey）が未設定です', method);
      return null;
    }

    var url     = cfg.BASE_URL + method;
    var payload = Object.assign({ returnType: 'application/json' }, params || {});

    var options = {
      method:             'POST',
      contentType:        'application/x-www-form-urlencoded',
      headers: {
        'GiosisCertificationKey': cfg.SAK,
        'QAPIVersion':            cfg.QAPI_VERSION,
      },
      payload:            payload,
      muteHttpExceptions: true,
    };

    try {
      var response = UrlFetchApp.fetch(url, options);
      var code     = response.getResponseCode();
      var text     = response.getContentText('UTF-8');

      if (code !== 200) {
        AppLogger.error('OfficialApi HTTP ' + code, method + ' :: ' + text.slice(0, 300));
        return null;
      }

      var json = JSON.parse(text);
      AppLogger.info('OfficialApi OK: ' + method, JSON.stringify(json).slice(0, 200));
      return json;

    } catch (e) {
      AppLogger.error('OfficialApi error: ' + e.message, method);
      return null;
    }
  }

  /**
   * 自社商品の詳細情報を取得する
   * @param {string} itemCode  Qoo10商品コード（商品番号）
   * @returns {Object|null} parseProduct()と互換のproductオブジェクト
   */
  function getItemDetail(itemCode) {
    var json = _call('GetItemDetailInfo', { ItemCode: itemCode });
    if (!json) return null;
    return _mapItemDetail(json, itemCode);
  }

  /**
   * 自社商品の販売実績（売上明細）を取得する
   * @param {string} itemCode
   * @param {number} lookbackDays  何日分遡って集計するか（デフォルト: Config値）
   * @returns {{totalQty: number, totalRevenue: number, recordCount: number}}
   */
  function getSellingReport(itemCode, lookbackDays) {
    var days      = lookbackDays || CONFIG.OFFICIAL_API.SALES_LOOKBACK_DAYS;
    var endDate   = new Date();
    var startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    var fmt = function (d) { return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyyMMdd'); };

    var json = _call('GetSellingReportDetailList', {
      ItemCode:        itemCode,
      SearchStartDate: fmt(startDate),
      SearchEndDate:   fmt(endDate),
    });
    if (!json) return { totalQty: 0, totalRevenue: 0, recordCount: 0 };

    return _mapSellingReport(json);
  }

  /**
   * 自社商品のproductオブジェクトを構築する（商品詳細＋売上実績を統合）
   * Crawler/Parser経由で取得したproductと同じスキーマで返すため、
   * Analyzer.gs / SheetWriter.gs はデータ取得元を意識せず利用できる。
   * @param {string} itemCode
   * @returns {Object|null} product
   */
  function getOwnProduct(itemCode) {
    var detail = getItemDetail(itemCode);
    if (!detail) return null;

    var report = getSellingReport(itemCode);
    detail.totalSales = report.totalQty || detail.totalSales || 0;
    detail._officialApi = true;  // データ取得元の識別用フラグ
    detail._salesReportNote = '直近' + CONFIG.OFFICIAL_API.SALES_LOOKBACK_DAYS
      + '日間の公式販売実績: 数量=' + report.totalQty + ' / 売上=' + report.totalRevenue + '円';

    return detail;
  }

  // ── レスポンスマッピング（フィールド名は要検証） ─────────

  /**
   * GetItemDetailInfo のレスポンスを product スキーマへ変換する
   * ⚠️ フィールド名は一般的なQAPI命名規則からの推測。実データで要検証。
   */
  function _mapItemDetail(json, itemCode) {
    var d = json.ResultObject || json.Result || json;

    return {
      url:            CONFIG.CRAWL.PRODUCT_URL_PREFIX + itemCode,
      itemNo:         itemCode,
      title:          d.ItemTitle || d.GoodsName || d.ItemName || '',
      brand:          d.Brand || d.BrandName || '',
      shopName:       d.SellerName || d.ShopName || '',
      category:       d.CategoryName || d.SecondCategory || '',
      salePrice:      _num(d.SettlePrice || d.SalePrice || d.ItemPrice),
      originalPrice:  _num(d.OriginalPrice || d.RetailPrice || d.SalePrice),
      discount:       0,
      shopCoupon:     0,
      itemCoupon:     0,
      finalPrice:     _num(d.SettlePrice || d.SalePrice || d.ItemPrice),
      shippingFee:    d.ShippingRate || '',
      isFreeShip:     /^0$|無料/.test(String(d.ShippingRate || '')),
      shippingMethod: d.ShippingMethod || '',
      shippingDays:   '',
      totalSales:     0,  // getOwnProduct() 内でgetSellingReport()の値に上書きされる
      reviewCount:    _num(d.ReviewCount),
      reviewScore:    _num(d.ReviewScore || d.ReviewAverage),
      wishlistCount:  0,
      imageCount:     _num(d.ImageCount) || (d.ItemImageUrl ? 1 : 0),
      mainImage:      d.ItemImageUrl || d.MainImage || '',
      hasVideo:       !!(d.VideoUrl || d.MovieUrl),
      category2:      '',
      storeScore:      0,
      storeGrade:      '',
      listedDate:      d.RegDate || d.SaleStartDate || '',
      skuCount:        _num(d.OptionCount),
      titleLength:     (d.ItemTitle || d.GoodsName || '').length,
      descLength:      (d.ItemDetail || d.GoodsDetail || '').length,
      fetchedAt:       new Date().toISOString(),
      _raw:            d,  // 未マッピングの生データを保持（フィールド名検証用）
    };
  }

  /**
   * GetSellingReportDetailList のレスポンスから数量・売上を集計する
   * ⚠️ フィールド名は要検証。複数明細行を合算する想定。
   */
  function _mapSellingReport(json) {
    var rows = json.ResultObject || json.Result || json.List || json.Items || [];
    if (!Array.isArray(rows)) rows = [];

    var totalQty     = 0;
    var totalRevenue = 0;

    rows.forEach(function (row) {
      totalQty     += _num(row.SaleQty || row.OrderQty || row.Qty);
      totalRevenue += _num(row.SaleAmt || row.SettleAmt || row.Amount);
    });

    return { totalQty: totalQty, totalRevenue: totalRevenue, recordCount: rows.length };
  }

  function _num(val) {
    var n = parseFloat(String(val || '0').replace(/[^0-9.]/g, ''));
    return isNaN(n) ? 0 : n;
  }

  // ── 公開API ───────────────────────────────────────────

  return {
    getItemDetail:    getItemDetail,
    getSellingReport: getSellingReport,
    getOwnProduct:    getOwnProduct,
  };

})();
