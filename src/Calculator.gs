/**
 * Calculator.gs — 市場規模・売上推計モジュール（Qoo10 University準拠）
 *
 * 公式：近X月売上 = 近X月レビュー数 ÷ レビュー率 × 現在の販売価格
 * 出典：https://article-university.qoo10.jp/entry/132
 */

var Calculator = (function () {

  /**
   * 商品の売上・市場規模を推計する
   * @param {Object} product  parseProduct()の出力
   * @returns {Object} metrics
   */
  function calcSalesMetrics(product) {
    var metrics = {};

    var reviewRate  = CONFIG.MARKET.REVIEW_RATE;           // デフォルト30%（設定可）
    var recentMo    = CONFIG.MARKET.RECENT_MONTHS;         // 直近3ヶ月
    var totalSales  = product.totalSales  || 0;
    var totalReview = product.reviewCount || 0;
    var price       = product.finalPrice  || product.salePrice || 0;

    // 上市からの経過月数
    var monthsOnSale = _monthsSince(product.listedDate);

    // ── Qoo10 University推奨式：レビュー数から売上を逆算 ──────────
    // 直近X月のレビュー数を推計（累計レビュー ÷ 上市月数 × X）
    var avgMonthlyReview = monthsOnSale > 0 ? totalReview / monthsOnSale : totalReview;
    var recentReview     = avgMonthlyReview * recentMo;

    // 直近X月の販売数（推測）
    // 注記：Qoo10 Universityが示すレビュー率30%を使用
    metrics.recentMoSales    = reviewRate > 0 ? Math.round(recentReview / reviewRate) : 0;
    metrics.recentMoRevenue  = metrics.recentMoSales * price;

    // ── 累計データから月次・日次平均を計算 ───────────────────────
    metrics.totalSales       = totalSales;
    metrics.totalRevenue     = totalSales * price;
    metrics.monthsOnSale     = monthsOnSale;

    if (monthsOnSale > 0 && totalSales >= CONFIG.MARKET.MIN_SALES_FOR_TREND) {
      metrics.avgMonthlySales  = Math.round(totalSales / monthsOnSale);
      metrics.avgDailySales    = Math.round(totalSales / (monthsOnSale * 30));
    } else {
      metrics.avgMonthlySales  = 0;
      metrics.avgDailySales    = 0;
    }

    // ── 直近30日・90日推計 ────────────────────────────────────────
    metrics.est30dSales      = metrics.avgDailySales * 30;
    metrics.est90dSales      = metrics.avgDailySales * 90;
    metrics.est30dRevenue    = metrics.est30dSales * price;
    metrics.est90dRevenue    = metrics.est90dSales * price;

    // ── 将来予測（線形外挿） ──────────────────────────────────────
    metrics.forecast = {};
    CONFIG.MARKET.FORECAST_MONTHS.forEach(function (mo) {
      metrics.forecast['mo' + mo] = {
        salesQty:  metrics.avgMonthlySales * mo,
        revenue:   metrics.avgMonthlySales * mo * price,
      };
    });

    // ── 推計の根拠を明示（透明性確保） ──────────────────────────
    metrics._note = [
      'レビュー率=' + (reviewRate * 100) + '% (Config.MARKET.REVIEW_RATE)',
      '上市月数='   + monthsOnSale + 'ヶ月',
      '月平均レビュー=' + avgMonthlyReview.toFixed(1),
      '直近' + recentMo + 'ヶ月レビュー推計=' + recentReview.toFixed(1),
    ].join(' | ');

    return metrics;
  }

  /**
   * 価格競争力スコア（0-100）を計算する
   * 同一検索結果内での相対的な位置で評価
   * @param {number} targetPrice
   * @param {Array<number>} competitorPrices
   * @returns {number} 0-100
   */
  function calcPriceScore(targetPrice, competitorPrices) {
    if (!competitorPrices || competitorPrices.length === 0) return 50;
    var prices  = competitorPrices.concat(targetPrice).filter(function (p) { return p > 0; });
    var min     = Math.min.apply(null, prices);
    var max     = Math.max.apply(null, prices);
    if (max === min) return 50;
    // 価格が低いほど高スコア
    return Math.round(((max - targetPrice) / (max - min)) * 100);
  }

  /**
   * レビュースコア（0-100）
   * @param {number} reviewCount
   * @param {number} reviewScore  (0-5スケール想定)
   * @param {number} maxReviewCount  競合中の最大レビュー数
   */
  function calcReviewScore(reviewCount, reviewScore, maxReviewCount) {
    var countScore = maxReviewCount > 0
      ? Math.min((reviewCount / maxReviewCount) * 60, 60)
      : 0;
    var ratingScore = (reviewScore / 5) * 40;
    return Math.round(countScore + ratingScore);
  }

  /**
   * 販売実績スコア（0-100）
   * @param {number} totalSales
   * @param {number} maxSales  競合中の最大販売累計
   */
  function calcSalesScore(totalSales, maxSales) {
    if (maxSales <= 0) return 0;
    return Math.round(Math.min((totalSales / maxSales) * 100, 100));
  }

  /**
   * 検索順位スコア（0-100）
   * 1位=100, 20位=0 の線形
   * @param {number} rank  1-based（0 = 圏外）
   */
  function calcSearchScore(rank) {
    if (!rank || rank <= 0) return 0;
    var maxRank = CONFIG.CRAWL.MAX_COMPETITORS;
    return Math.round(Math.max(0, ((maxRank - rank + 1) / maxRank) * 100));
  }

  /**
   * 画像スコア（0-100）
   */
  function calcImageScore(imageCount, hasVideo) {
    var cfg      = CONFIG.IMAGE;
    var countPct = Math.min(imageCount / cfg.IDEAL_COUNT, 1);
    var base     = Math.round(countPct * (100 - cfg.HAS_VIDEO_BONUS));
    return Math.min(base + (hasVideo ? cfg.HAS_VIDEO_BONUS : 0), 100);
  }

  /**
   * 配送スコア（0-100）
   */
  function calcDeliveryScore(isFreeShip, shippingDays) {
    var cfg   = CONFIG.DELIVERY;
    var base  = isFreeShip ? 60 : 30;
    var days  = _num(shippingDays);
    var speed = days === 0 ? 40
              : days <= cfg.FAST_DAYS  ? 40
              : days <= cfg.SLOW_DAYS  ? 20
              : 0;
    return Math.min(base + speed, 100);
  }

  /**
   * 詳細ページスコア（0-100）
   */
  function calcDescriptionScore(descLength, hasVideo, imageCount) {
    var lengthScore = Math.min(descLength / 2000 * 60, 60);
    var videoBonus  = hasVideo   ? 20 : 0;
    var imgBonus    = imageCount >= CONFIG.IMAGE.MIN_COUNT ? 20 : 0;
    return Math.round(Math.min(lengthScore + videoBonus + imgBonus, 100));
  }

  /**
   * 店舗スコア（0-100）
   * Parser.parseProductのstoreScoreはQoo10の「MINISHOP RATE」表記（実データ検証済み、
   * 0-100%スケール）をそのまま使用するため、追加の変換は不要。
   */
  function calcStoreScore(storeScore) {
    return Math.round(Math.min(_num(storeScore), 100));
  }

  /**
   * 総合競争力スコアを計算する
   * @param {Object} scores  各カテゴリのスコア
   * @returns {number} 0-100
   */
  function calcCompetitiveScore(scores) {
    var w      = CONFIG.SCORE_WEIGHTS;
    var total  = 0;
    total += (scores.price       || 0) * w.price;
    total += (scores.review      || 0) * w.review;
    total += (scores.sales       || 0) * w.sales;
    total += (scores.search      || 0) * w.search;
    total += (scores.image       || 0) * w.image;
    total += (scores.description || 0) * w.description;
    total += (scores.delivery    || 0) * w.delivery;
    total += (scores.store       || 0) * w.store;
    return Math.round(total);
  }

  // ── プライベートユーティリティ ────────────────────────

  function _monthsSince(dateStr) {
    if (!dateStr) return 12; // デフォルト：データなしの場合は1年と仮定
    try {
      var d    = new Date(dateStr);
      var now  = new Date();
      var diff = (now.getFullYear() - d.getFullYear()) * 12
               + (now.getMonth()   - d.getMonth());
      return Math.max(diff, 1);
    } catch (e) {
      return 12;
    }
  }

  function _num(val) {
    var n = parseFloat(String(val || '0').replace(/[^0-9.]/g, ''));
    return isNaN(n) ? 0 : n;
  }

  // ── 公開API ───────────────────────────────────────────

  return {
    calcSalesMetrics:      calcSalesMetrics,
    calcPriceScore:        calcPriceScore,
    calcReviewScore:       calcReviewScore,
    calcSalesScore:        calcSalesScore,
    calcSearchScore:       calcSearchScore,
    calcImageScore:        calcImageScore,
    calcDeliveryScore:     calcDeliveryScore,
    calcDescriptionScore:  calcDescriptionScore,
    calcStoreScore:        calcStoreScore,
    calcCompetitiveScore:  calcCompetitiveScore,
  };

})();
