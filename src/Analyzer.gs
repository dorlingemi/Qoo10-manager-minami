/**
 * Analyzer.gs — 競品分析・AI品質評価モジュール（Qoo10 University Checklist準拠）
 */

var Analyzer = (function () {

  /**
   * 単一商品の総合分析を実行する
   * @param {Object} product   parseProduct()の出力
   * @param {number} searchRank  検索結果での順位（0=未計測）
   * @param {Array}  allProducts  比較対象の全商品リスト（競合を含む）
   * @returns {Object} analyzed
   */
  function analyzeProduct(product, searchRank, allProducts) {
    var analyzed       = Object.assign({}, product);
    analyzed.searchRank= searchRank || 0;

    // 売上推計
    analyzed.sales     = Calculator.calcSalesMetrics(product);

    // 比較用集計値
    var prices         = _pluck(allProducts, 'finalPrice').filter(function (p) { return p > 0; });
    var maxReviews     = Math.max.apply(null, _pluck(allProducts, 'reviewCount'));
    var maxSales       = Math.max.apply(null, _pluck(allProducts, 'totalSales'));

    // 各次元のスコア
    var scores = {};
    scores.price       = Calculator.calcPriceScore(
                           product.finalPrice || product.salePrice, prices);
    scores.review      = Calculator.calcReviewScore(
                           product.reviewCount, product.reviewScore, maxReviews);
    scores.sales       = Calculator.calcSalesScore(product.totalSales, maxSales);
    scores.search      = Calculator.calcSearchScore(searchRank);
    scores.image       = Calculator.calcImageScore(product.imageCount, product.hasVideo);
    scores.description = Calculator.calcDescriptionScore(
                           product.descLength, product.hasVideo, product.imageCount);
    scores.delivery    = Calculator.calcDeliveryScore(product.isFreeShip, product.shippingDays);
    scores.store       = Calculator.calcStoreScore(product.storeScore);

    analyzed.scores    = scores;
    analyzed.competitive_score = Calculator.calcCompetitiveScore(scores);

    // AI定性分析
    analyzed.quality   = _qualityAnalysis(product, scores);

    // 強み・弱み・提言
    analyzed.swot      = _swot(scores, product);

    return analyzed;
  }

  /**
   * 複数商品の横断比較表を生成する（Qoo10 University Checklistに基づく）
   * @param {Array<Object>} analyzedProducts  analyzeProduct()の出力の配列
   * @returns {Array<Array>}  2次元配列（行×列）
   */
  function buildComparisonTable(analyzedProducts) {
    if (!analyzedProducts || analyzedProducts.length === 0) return [];

    var headers = [
      '項目',
      'カテゴリ',
    ].concat(analyzedProducts.map(function (p, i) {
      return (i === 0 ? '【自社】' : '競合' + i) + '\n' + _truncate(p.title, 20);
    }));

    var rows = [headers];

    function row(label, cat, fn) {
      var cells = [label, cat].concat(analyzedProducts.map(fn));
      rows.push(cells);
    }

    // ── 販売能力 ─────────────────────────────────────────
    row('累計販売数',    '販売能力', function (p) { return p.totalSales || 0; });
    row('レビュー数',   '販売能力', function (p) { return p.reviewCount || 0; });
    row('レビュー評価', '販売能力', function (p) { return p.reviewScore || 0; });
    row('月平均販売推計（Qoo10大学式）', '販売能力',
        function (p) { return p.sales && p.sales.avgMonthlySales || 0; });
    row('直近3ヶ月売上推計（円）', '販売能力',
        function (p) { return p.sales && p.sales.recentMoRevenue || 0; });

    // ── 検索競争力 ────────────────────────────────────────
    row('検索順位',     '検索競争力', function (p) { return p.searchRank || '-'; });
    row('スポンサー広告', '検索競争力', function (p) { return p.isSponsored ? '●' : '-'; });
    row('検索スコア',   '検索競争力', function (p) { return (p.scores && p.scores.search) || 0; });

    // ── 価格競争力 ────────────────────────────────────────
    row('販売価格（円）',   '価格競争力', function (p) { return p.salePrice || 0; });
    row('定価（円）',       '価格競争力', function (p) { return p.originalPrice || 0; });
    row('割引率（%）',      '価格競争力', function (p) { return p.discount || 0; });
    row('Shopクーポン（円）','価格競争力', function (p) { return p.shopCoupon || 0; });
    row('商品クーポン（円）','価格競争力', function (p) { return p.itemCoupon || 0; });
    row('最終支払価格（円）','価格競争力', function (p) { return p.finalPrice || p.salePrice || 0; });
    row('価格スコア',       '価格競争力', function (p) { return (p.scores && p.scores.price) || 0; });

    // ── 配送競争力 ────────────────────────────────────────
    row('送料',         '配送競争力', function (p) { return p.shippingFee || '-'; });
    row('送料無料',     '配送競争力', function (p) { return p.isFreeShip ? '●' : '-'; });
    row('配送方法',     '配送競争力', function (p) { return p.shippingMethod || '-'; });
    row('配送日数',     '配送競争力', function (p) { return p.shippingDays || '-'; });
    row('配送スコア',   '配送競争力', function (p) { return (p.scores && p.scores.delivery) || 0; });

    // ── 商品競争力 ────────────────────────────────────────
    row('画像枚数',     '商品競争力', function (p) { return p.imageCount || 0; });
    row('動画あり',     '商品競争力', function (p) { return p.hasVideo ? '●' : '-'; });
    row('タイトル文字数', '商品競争力', function (p) { return p.titleLength || 0; });
    row('詳細ページ量', '商品競争力', function (p) { return p.descLength || 0; });
    row('SKU数',        '商品競争力', function (p) { return p.skuCount || 0; });
    row('画像スコア',   '商品競争力', function (p) { return (p.scores && p.scores.image) || 0; });
    row('詳細スコア',   '商品競争力', function (p) { return (p.scores && p.scores.description) || 0; });

    // ── 店舗競争力 ────────────────────────────────────────
    row('店舗評価',     '店舗競争力', function (p) { return p.storeScore || '-'; });
    row('店舗グレード', '店舗競争力', function (p) { return p.storeGrade || '-'; });
    row('店舗スコア',   '店舗競争力', function (p) { return (p.scores && p.scores.store) || 0; });

    // ── 総合 ──────────────────────────────────────────────
    row('【総合競争力スコア】', '総合', function (p) { return p.competitive_score || 0; });

    return rows;
  }

  // ── AI定性評価 ─────────────────────────────────────────

  function _qualityAnalysis(product, scores) {
    return {
      image:       _evalImage(product, scores.image),
      title:       _evalTitle(product, scores.search),
      description: _evalDescription(product, scores.description),
    };
  }

  function _evalImage(product, imageScore) {
    var tips = [];
    if (product.imageCount < CONFIG.IMAGE.MIN_COUNT) {
      tips.push('画像数が少ない（推奨: ' + CONFIG.IMAGE.IDEAL_COUNT + '枚以上）');
    }
    if (!product.hasVideo) {
      tips.push('動画なし（追加で販促効果UP）');
    }
    return {
      score:       imageScore,
      suggestions: tips,
    };
  }

  function _evalTitle(product, searchScore) {
    var tips   = [];
    var title  = product.title || '';
    if (title.length < 30) {
      tips.push('タイトルが短い（30文字以上推奨）');
    }
    if (title.length > 80) {
      tips.push('タイトルが長すぎる（80文字以下推奨）');
    }
    if (!product.brand || title.indexOf(product.brand) < 0) {
      tips.push('タイトルにブランド名を含めることを推奨');
    }
    return {
      score:       searchScore,
      length:      title.length,
      suggestions: tips,
    };
  }

  function _evalDescription(product, descScore) {
    var tips    = [];
    if (product.descLength < 500) {
      tips.push('詳細ページが短い（500文字以上推奨）');
    }
    if (!product.hasVideo) {
      tips.push('動画埋め込みで詳細品質向上');
    }
    return {
      score:       descScore,
      charCount:   product.descLength,
      suggestions: tips,
    };
  }

  // ── SWOT風分析 ────────────────────────────────────────

  function _swot(scores, product) {
    var strengths  = [];
    var weaknesses = [];
    var actions    = [];

    Object.keys(scores).forEach(function (key) {
      var s = scores[key];
      if (s >= 70) strengths.push(key + '(' + s + 'pt)');
      if (s <  40) weaknesses.push(key + '(' + s + 'pt)');
    });

    if (scores.price < 50)    actions.push('価格またはクーポン競争力を強化する');
    if (scores.image < 60)    actions.push('商品画像を' + CONFIG.IMAGE.IDEAL_COUNT + '枚以上に増やす');
    if (!product.hasVideo)    actions.push('商品動画を追加する');
    if (scores.review < 50)   actions.push('レビュー獲得施策を実施する');
    if (scores.delivery < 50) actions.push('送料無料または配送速度を改善する');
    if (scores.search < 50)   actions.push('キーワード最適化でSEO改善する');

    return { strengths: strengths, weaknesses: weaknesses, actions: actions };
  }

  // ── ユーティリティ ────────────────────────────────────

  function _pluck(arr, key) {
    return (arr || []).map(function (o) { return o[key] || 0; });
  }

  function _truncate(str, len) {
    if (!str) return '';
    return str.length <= len ? str : str.slice(0, len) + '…';
  }

  // ── 公開API ───────────────────────────────────────────

  return {
    analyzeProduct:       analyzeProduct,
    buildComparisonTable: buildComparisonTable,
  };

})();
