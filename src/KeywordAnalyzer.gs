/**
 * KeywordAnalyzer.gs — 商品名キーワード分析モジュール
 *
 * 指定キーワードでQoo10検索 → 全商品名をトークン分割 →
 * 出現頻度・上位集中度・レビュー相関・オーガニック率を集計し
 * KeywordAnalysisシートに出力する。
 */

var KeywordAnalyzer = (function () {

  // ── トークン分割 ─────────────────────────────────────────

  /**
   * 商品名から有効なトークンを抽出する
   * 戦略：
   *   1. 括弧・記号で区切り → チャンクに分解
   *   2. 各チャンクから日本語連続列（ひらがな/カタカナ/漢字）を抽出
   *   3. 英数字の意味ありトークン（ブランド名・型番等）も保持
   *   4. ストップワード除去
   */
  function _tokenize(title) {
    if (!title) return [];

    // 括弧内容を除去（装飾タグ）
    var cleaned = title
      .replace(/[\[【《〔(（][^\]】》〕)）]{0,30}[\]】》〕)）]/g, ' ')
      .replace(/[★☆◆◇●○■□▶▷]/g, ' ');

    var tokens = [];

    // 日本語トークン（2文字以上）
    var jpMatches = cleaned.match(/[ぁ-んァ-ヾ一-龠々]{2,}/g) || [];
    jpMatches.forEach(function (t) { tokens.push(t); });

    // 英数字トークン（2文字以上、意味ありそうなもの）
    var enMatches = cleaned.match(/[A-Za-z0-9][A-Za-z0-9\-_.]{1,}/g) || [];
    enMatches.forEach(function (t) {
      // 純粋な数字だけは除外
      if (!/^\d+$/.test(t)) tokens.push(t.toUpperCase());
    });

    return tokens.filter(function (t) { return !_isStopWord(t); });
  }

  var STOP_WORDS = [
    // 汎用助詞的トークン
    'セット', 'タイプ', 'サイズ', 'カラー', 'カラーバリエーション',
    'バージョン', 'スタイル', 'デザイン', 'シリーズ', 'モデル',
    // 数量・単位
    '個入', '枚入', '本入', '枚セット', '個セット',
    // 汎用EC表現
    '送料無料', '正規品', '公式', '最新', '新品', 'レビュー',
    'ランキング', '人気', 'おすすめ', '在庫あり', '即納',
    // 英語ストップ
    'SET', 'NEW', 'FOR', 'THE', 'AND',
  ];

  function _isStopWord(token) {
    return STOP_WORDS.indexOf(token) >= 0 || token.length < 2;
  }

  // ── 集計ロジック ─────────────────────────────────────────

  /**
   * 検索結果アイテム配列からキーワード統計を生成する
   * @param {Array} items  parseSearchResults()の出力
   * @returns {Array} stats  各トークンの統計オブジェクト配列
   */
  function _analyze(items) {
    if (!items || !items.length) return [];

    var totalCount  = items.length;
    var topN        = Math.min(5, totalCount);
    var tokenMap    = {};  // token → {docs, topDocs, reviewSum, reviewCount, organicDocs}

    items.forEach(function (item) {
      var tokens  = _tokenize(item.title);
      var isTop   = item.rank <= topN;
      var isOrganic = !item.isSponsored;
      var review  = item.reviewCount || 0;

      // 重複除去（同一商品名内で同じトークンを複数回カウントしない）
      var seen = {};
      tokens.forEach(function (token) {
        if (seen[token]) return;
        seen[token] = true;

        if (!tokenMap[token]) {
          tokenMap[token] = { docs: 0, topDocs: 0, reviewSum: 0, reviewCount: 0, organicDocs: 0 };
        }
        var s = tokenMap[token];
        s.docs++;
        if (isTop)    s.topDocs++;
        if (isOrganic) s.organicDocs++;
        s.reviewSum   += review;
        s.reviewCount++;
      });
    });

    // 全体の平均レビュー数（スコア正規化用）
    var totalReviewSum = items.reduce(function (acc, i) { return acc + (i.reviewCount || 0); }, 0);
    var avgReview      = totalCount > 0 ? totalReviewSum / totalCount : 1;

    // スコア計算
    var stats = Object.keys(tokenMap).map(function (token) {
      var s = tokenMap[token];

      // 各スコア（0〜100）
      var freqScore    = Math.round((s.docs / totalCount) * 100);
      var topScore     = Math.round((s.topDocs / topN) * 100);
      var reviewScore  = avgReview > 0
        ? Math.min(Math.round((s.reviewSum / s.reviewCount / avgReview) * 50), 100)
        : 0;
      var organicScore = s.docs > 0 ? Math.round((s.organicDocs / s.docs) * 100) : 0;

      // 総合有効性スコア（重み付き平均）
      var effectScore  = Math.round(
        freqScore   * 0.35 +
        topScore    * 0.35 +
        reviewScore * 0.20 +
        organicScore* 0.10
      );

      // キーワード分類
      var category;
      if (freqScore >= 60) {
        category = '🔴 大词';
      } else if (freqScore >= 20 && topScore >= 40) {
        category = '🟠 品类词';
      } else if (freqScore < 15 && effectScore >= 40) {
        category = '🟢 长尾词';
      } else {
        category = '🔵 属性词';
      }

      return {
        token:        token,
        docs:         s.docs,
        freqPct:      freqScore,       // 出現率(%)
        topDocs:      s.topDocs,       // 上位5件中の出現数
        topScore:     topScore,        // 上位集中度(%)
        avgReview:    s.reviewCount > 0 ? Math.round(s.reviewSum / s.reviewCount) : 0,
        reviewScore:  reviewScore,     // レビュー相関スコア
        organicPct:   organicScore,    // オーガニック率(%)
        effectScore:  effectScore,     // 総合有効性スコア
        category:     category,        // キーワード分類
      };
    });

    // 有効性スコア降順でソート
    stats.sort(function (a, b) { return b.effectScore - a.effectScore; });
    return stats;
  }

  // ── シート出力 ───────────────────────────────────────────

  function _writeSheet(keyword, items, stats) {
    var ss         = SpreadsheetApp.getActiveSpreadsheet();
    var sheetName  = 'KeywordAnalysis';
    var sheet      = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
    }

    // 毎回クリアして書き直し
    sheet.clearContents();
    sheet.clearFormats();

    var headers = [
      'キーワード', '分類', 'トークン', '出現件数', '出現率(%)',
      '上位5件中', '上位集中度(%)', '平均レビュー数',
      'レビュー相関', 'オーガニック率(%)', '総合有効性スコア',
    ];

    var rows = [headers];
    stats.forEach(function (s) {
      rows.push([
        keyword, s.category, s.token, s.docs, s.freqPct,
        s.topDocs, s.topScore, s.avgReview,
        s.reviewScore, s.organicPct, s.effectScore,
      ]);
    });

    sheet.getRange(1, 1, rows.length, headers.length).setValues(rows);
    sheet.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold')
      .setBackground('#1F3864')
      .setFontColor('#FFFFFF');
    sheet.setFrozenRows(1);

    // 分類列（B列）に背景色を付ける
    var dataRows = sheet.getLastRow() - 1;
    if (dataRows > 0) {
      var categoryRange = sheet.getRange(2, 2, dataRows, 1);
      var categories = categoryRange.getValues();
      var catColors = categories.map(function (row) {
        var c = row[0];
        if (c.indexOf('大词') >= 0)  return ['#FFCDD2'];  // 赤系
        if (c.indexOf('品类词') >= 0) return ['#FFE0B2'];  // オレンジ系
        if (c.indexOf('长尾词') >= 0) return ['#C8E6C9'];  // 緑系
        return ['#BBDEFB'];                                 // 青系（属性词）
      });
      categoryRange.setBackgrounds(catColors);

      // 総合有効性スコア列（K列=11列目）に背景色を付ける
      var scoreRange = sheet.getRange(2, 11, dataRows, 1);
      var scores = scoreRange.getValues();
      var colors = scores.map(function (row) {
        var s = row[0];
        if (s >= 70) return ['#C8E6C9'];
        if (s >= 40) return ['#FFF9C4'];
        return ['#FFFFFF'];
      });
      scoreRange.setBackgrounds(colors);
    }

    sheet.autoResizeColumns(1, headers.length);
    AppLogger.info('KeywordAnalyzer: 書き込み完了', keyword + ' / ' + stats.length + 'トークン');
  }

  // ── メイン実行 ───────────────────────────────────────────

  /**
   * 指定キーワードで検索 → 商品名分析 → KeywordAnalysisシートに出力
   * @param {string} keyword
   */
  function run(keyword) {
    if (!keyword) {
      AppLogger.warn('KeywordAnalyzer: キーワードが空です');
      return;
    }

    AppLogger.info('KeywordAnalyzer: 開始', keyword);

    var html  = Crawler.fetchSearch(keyword, 1);
    if (!html) {
      AppLogger.error('KeywordAnalyzer: 検索HTML取得失敗', keyword);
      return;
    }

    var items = Parser.parseSearchResults(html);
    AppLogger.info('KeywordAnalyzer: 商品取得', items.length + '件');

    if (!items.length) {
      AppLogger.warn('KeywordAnalyzer: 検索結果0件', keyword);
      return;
    }

    var stats = _analyze(items);
    _writeSheet(keyword, items, stats);

    AppLogger.info('KeywordAnalyzer: 完了', keyword + ' → ' + stats.length + 'トークン分析');
    SpreadsheetApp.getActiveSpreadsheet().toast(
      keyword + ' → ' + stats.length + 'トークン / ' + items.length + '件商品',
      'キーワード分析完了', 5
    );
  }

  return { run: run };

})();
