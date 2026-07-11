/**
 * Guide.gs — システム説明シートの生成・更新
 *
 * 「🆙 説明を更新」メニューから実行すると
 * 「システム説明」シートを最新内容で上書きする。
 * 機能追加時はこのファイルの SECTIONS 定数を更新すること。
 */

var Guide = (function () {

  var SHEET_NAME   = 'システム説明';
  var LAST_UPDATED = '2026-07-11 (KeywordSuggest・KeywordValue追加)';

  // ── 説明コンテンツ定義 ───────────────────────────────────
  // 機能追加・変更時はここだけ編集する

  var SECTIONS = [

    {
      type: 'title',
      text: 'Qoo10 競合分析システム — 機能説明書',
    },
    {
      type: 'meta',
      text: '最終更新: ' + LAST_UPDATED + '　|　対象: Google Sheets + GAS + Render.com + Lark Bitable',
    },

    // ── 1. システム概要 ──────────────────────────────────
    {
      type: 'section',
      text: '1. システム概要',
    },
    {
      type: 'text',
      text: 'Qoo10の商品ページ・検索結果を自動取得し、競合分析・キーワード分析・順位確認を行うシステムです。\n結果はこのGoogle Sheetsに保存され、Lark Bitableにも自動同期されます。',
    },
    {
      type: 'arch',
      rows: [
        ['層', '役割', '技術'],
        ['操作UI', 'メニューから機能を呼び出す', 'Google Sheets メニュー'],
        ['処理エンジン', 'データ取得・分析・書き込み', 'Google Apps Script（GAS）'],
        ['ブラウザ代行', 'Qoo10のbot対策を回避してHTMLを取得', 'Render.com + Playwright'],
        ['一時保存', '処理中データ・ダッシュボード', 'このGoogle Sheets'],
        ['永久保存', '全履歴データの蓄積・社内共有', 'Lark Bitable（多維表格）'],
      ],
    },

    // ── 2. 機能一覧 ──────────────────────────────────────
    {
      type: 'section',
      text: '2. 機能一覧',
    },

    // 2-1 競合分析
    {
      type: 'feature',
      icon: '🔍',
      name: '競合分析（runAll）',
      menu: 'Qoo10分析 → ▶ 分析実行（全入力）',
    },
    {
      type: 'table',
      rows: [
        ['項目', '内容'],
        ['目的', '入力した商品URL・キーワードの競合データを一括取得・分析する'],
        ['入力方法', 'Inputシート A列: タイプ（url / keyword / own）　B列: URLまたはキーワード'],
        ['タイプ: url', '商品URLを直接指定。その商品＋関連キーワードの競合を取得'],
        ['タイプ: keyword', 'キーワードで検索し、上位2件の競合を取得・分析'],
        ['タイプ: own', '自社商品コードを指定。Qoo10公式APIで自社データを取得（要API設定）'],
        ['所要時間', '1件あたり約3〜5分（Render.com無料プランのため）'],
        ['出力シート', 'Products / Competitors / Analysis / Dashboard'],
        ['Lark連携', '完了後に自動でLark Bitableへ同期（商品マスタ・競合商品テーブル）'],
      ],
    },

    // 2-2 キーワード分析
    {
      type: 'feature',
      icon: '🔤',
      name: 'キーワード分析（KeywordAnalyzer）',
      menu: 'Qoo10分析 → 🔤 キーワード分析',
    },
    {
      type: 'table',
      rows: [
        ['項目', '内容'],
        ['目的', '検索結果の全商品名を分析し、効果的なキーワードを洗い出す'],
        ['入力方法', 'メニュー実行後のダイアログにキーワードを入力'],
        ['処理内容', '検索結果の商品名をトークン分割 → 各語の出現頻度・有効性を集計'],
        ['出力シート', 'KeywordAnalysis（毎回上書き）'],
      ],
    },
    {
      type: 'table',
      rows: [
        ['出力列', '意味'],
        ['出現率(%)', '何%の商品名にそのキーワードが含まれるか'],
        ['上位集中度(%)', '検索上位5件に集中して出現するか（高いほど重要キーワード）'],
        ['レビュー相関', 'そのキーワードを含む商品の平均レビュー数（集客力の指標）'],
        ['オーガニック率(%)', '広告でなく自然検索商品での出現割合'],
        ['総合有効性スコア', '上記4指標の加重合計（0〜100、70以上=緑・40以上=黄）'],
      ],
    },

    // 2-3 購買価値チェック
    {
      type: 'feature',
      icon: '💰',
      name: '購買価値チェック（KeywordValue）',
      menu: 'Qoo10分析 → 💰 購買価値チェック',
    },
    {
      type: 'table',
      rows: [
        ['項目', '内容'],
        ['目的', '指定キーワードの検索結果から「購買意図のある検索がどれだけあるか」を推定スコアで評価する'],
        ['入力方法', 'メニュー実行後のダイアログにキーワードを入力'],
        ['出力シート', 'KeywordValue（毎回上書き）/ KeywordValueHistory（追記・比較用）'],
        ['スコア構成', '広告競争率35% + 上位平均レビュー数40% + 市場規模15% + 価格帯10%'],
        ['判定基準', '75以上=🟢狙い目 / 55以上=🟡検討余地あり / 35以上=🟠需要は限定的 / それ以下=🔴購買需要が低い'],
      ],
    },

    // 2-4 補完キーワード取得
    {
      type: 'feature',
      icon: '🔮',
      name: '補完キーワード取得（KeywordSuggest）',
      menu: 'Qoo10分析 → 🔮 補完キーワード取得',
    },
    {
      type: 'table',
      rows: [
        ['項目', '内容'],
        ['目的', 'Qoo10の検索ボックスに実際に文字を入力し、表示される補完候補を収集する'],
        ['入力方法', 'ダイアログにベースキーワードを入力（例: まつげ）'],
        ['分析オプション', '候補一覧のみ表示 / 各候補をKeywordValueで購買価値評価（時間がかかる）'],
        ['仕組み', 'Render.com上のPlaywrightがQoo10検索ボックスに文字を入力し補完ドロップダウンを取得'],
        ['出力シート', 'KeywordSuggest（毎回上書き）'],
        ['注意', 'Qoo10サイトの構造変更により補完候補が取得できない場合がある'],
      ],
    },

    // 2-5 順位確認
    {
      type: 'feature',
      icon: '📍',
      name: '順位確認（RankChecker）',
      menu: 'Qoo10分析 → 📍 順位確認',
    },
    {
      type: 'table',
      rows: [
        ['項目', '内容'],
        ['目的', '指定商品が特定キーワードの検索結果で何位に表示されるかを調べる'],
        ['入力方法', 'ダイアログ①: 検索キーワード　ダイアログ②: 商品URL または 商品ID'],
        ['検索範囲', '最大5ページ・100件（見つかり次第即停止）'],
        ['所要時間', '1ページあたり約90秒。最悪ケース約8分'],
        ['出力シート', 'RankCheck（実行するたびに追記・履歴を保持）'],
      ],
    },
    {
      type: 'table',
      rows: [
        ['出力列', '意味'],
        ['全体順位', '広告を含む全商品の中での順位'],
        ['オーガニック順位', '広告を除いた自然検索商品の中での順位'],
        ['スポンサー', '「広告」または「オーガニック」'],
        ['ページ', '何ページ目に出現したか'],
      ],
    },

    // 2-4 その他
    {
      type: 'section',
      text: '3. その他のメニュー機能',
    },
    {
      type: 'table',
      rows: [
        ['メニュー項目', '機能'],
        ['📊 ダッシュボード更新', 'Dashboardシートのみ再生成する（分析は実行しない）'],
        ['📋 Inputシートを初期化', 'Inputシートをリセットしてサンプルデータを入力する'],
        ['📝 ログをクリア', 'Logシートの内容を全削除する'],
        ['⏰ 自動実行Triggerを設定', '毎日指定時刻にrunAllを自動実行するTriggerを作成する'],
        ['🗑 Triggerを削除', '自動実行Triggerを削除する'],
        ['🆙 説明を更新', 'このシートを最新内容に更新する'],
      ],
    },

    // ── 3. シート一覧 ────────────────────────────────────
    {
      type: 'section',
      text: '4. シート構成',
    },
    {
      type: 'table',
      rows: [
        ['シート名', '内容', '更新タイミング'],
        ['Input', '分析対象のURL・キーワードを入力する', '手動入力'],
        ['Products', '取得した商品の詳細データ（自社・競合）', 'runAll実行時'],
        ['Competitors', '競合商品の一覧', 'runAll実行時'],
        ['Analysis', '競合との比較分析表', 'runAll実行時'],
        ['Dashboard', '集計サマリー', 'runAll / ダッシュボード更新時'],
        ['KeywordAnalysis', 'キーワード有効性スコア', 'キーワード分析実行時（毎回上書き）'],
        ['KeywordValue', '購買価値レポート（1キーワード）', '購買価値チェック実行時（毎回上書き）'],
        ['KeywordValueHistory', '購買価値の比較履歴', '購買価値チェック実行時（追記）'],
        ['KeywordSuggest', 'Qoo10補完候補と購買価値', '補完キーワード取得実行時（毎回上書き）'],
        ['RankCheck', '商品の検索順位履歴', '順位確認実行時（追記）'],
        ['Log', 'エラー・実行ログ', '各機能実行時に自動追記'],
        ['システム説明', 'このシート（機能説明書）', '手動で「説明を更新」実行時'],
      ],
    },

    // ── 4. 設定・注意事項 ────────────────────────────────
    {
      type: 'section',
      text: '5. 設定・注意事項',
    },
    {
      type: 'table',
      rows: [
        ['設定項目', '場所', '内容'],
        ['Render API Key', 'Config.gs > RENDER.API_KEY', 'Render.comのAPIキー（GASエディタで直接入力）'],
        ['Render URL', 'Config.gs > RENDER.SERVICE_URL', 'デプロイ済みRenderサービスのURL'],
        ['Lark App Secret', 'Config.gs > LARK.APP_SECRET', 'LarkアプリのSecret（GASエディタで直接入力）'],
        ['Lark 同期ON/OFF', 'Config.gs > LARK.ENABLED', 'true=同期する / false=同期しない'],
        ['最大競合取得数', 'Config.gs > CRAWL.MAX_COMPETITORS', '現在2件（増やすと実行時間が増加）'],
        ['公式API', 'Config.gs > OFFICIAL_API', 'Qoo10公式APIキー（own タイプ使用時のみ必要）'],
      ],
    },
    {
      type: 'text',
      text: '⚠️ 注意：APIキー・Secretはチャットやメールなどにコピーしないこと。GASエディタ内でのみ設定する。',
    },
  ];

  // ── シート生成 ───────────────────────────────────────────

  function refresh() {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME, 0);  // 先頭に挿入
    }
    sheet.clearContents();
    sheet.clearFormats();
    sheet.setColumnWidth(1, 200);
    sheet.setColumnWidth(2, 340);
    sheet.setColumnWidth(3, 340);

    var cursor = 1;  // 現在の書き込み行

    SECTIONS.forEach(function (sec) {

      if (sec.type === 'title') {
        sheet.getRange(cursor, 1, 1, 3).merge()
          .setValue(sec.text)
          .setFontSize(16).setFontWeight('bold')
          .setBackground('#1F3864').setFontColor('#FFFFFF')
          .setHorizontalAlignment('center').setVerticalAlignment('middle');
        sheet.setRowHeight(cursor, 48);
        cursor++;

      } else if (sec.type === 'meta') {
        sheet.getRange(cursor, 1, 1, 3).merge()
          .setValue(sec.text)
          .setFontSize(9).setFontColor('#888888')
          .setBackground('#F8F9FA').setHorizontalAlignment('center');
        cursor++;

      } else if (sec.type === 'section') {
        cursor++;  // 空白行
        sheet.getRange(cursor, 1, 1, 3).merge()
          .setValue(sec.text)
          .setFontSize(12).setFontWeight('bold')
          .setBackground('#2E4057').setFontColor('#FFFFFF')
          .setVerticalAlignment('middle');
        sheet.setRowHeight(cursor, 32);
        cursor++;

      } else if (sec.type === 'feature') {
        sheet.getRange(cursor, 1, 1, 3).merge()
          .setValue(sec.icon + ' ' + sec.name)
          .setFontSize(11).setFontWeight('bold')
          .setBackground('#D9E8FB').setFontColor('#1F3864');
        cursor++;
        sheet.getRange(cursor, 1).setValue('メニュー').setFontWeight('bold').setFontColor('#555');
        sheet.getRange(cursor, 2, 1, 2).merge().setValue(sec.menu).setFontColor('#333');
        cursor++;

      } else if (sec.type === 'table') {
        sec.rows.forEach(function (row, i) {
          var isHeader = (i === 0);
          var numCols  = Math.min(row.length, 3);
          for (var c = 0; c < numCols; c++) {
            var cell = sheet.getRange(cursor, c + 1);
            if (numCols === 2 && c === 1) {
              sheet.getRange(cursor, 2, 1, 2).merge().setValue(row[c]);
            } else {
              cell.setValue(row[c]);
            }
            if (isHeader) {
              cell.setFontWeight('bold')
                .setBackground('#4A6FA5').setFontColor('#FFFFFF');
            } else {
              cell.setBackground(i % 2 === 0 ? '#F5F8FF' : '#FFFFFF');
            }
            cell.setWrap(true).setVerticalAlignment('middle');
          }
          sheet.setRowHeight(cursor, 36);
          cursor++;
        });

      } else if (sec.type === 'text') {
        sheet.getRange(cursor, 1, 1, 3).merge()
          .setValue(sec.text).setWrap(true)
          .setBackground('#FFFDE7').setFontColor('#5D4037')
          .setFontSize(10);
        sheet.setRowHeight(cursor, sec.text.indexOf('\n') >= 0 ? 60 : 36);
        cursor++;

      } else if (sec.type === 'arch') {
        sec.rows.forEach(function (row, i) {
          var isHeader = (i === 0);
          for (var c = 0; c < 3; c++) {
            var cell = sheet.getRange(cursor, c + 1).setValue(row[c] || '');
            cell.setWrap(true).setVerticalAlignment('middle');
            if (isHeader) {
              cell.setFontWeight('bold').setBackground('#4A6FA5').setFontColor('#FFFFFF');
            } else {
              cell.setBackground(i % 2 === 0 ? '#F5F8FF' : '#FFFFFF');
            }
          }
          sheet.setRowHeight(cursor, 36);
          cursor++;
        });
      }
    });

    // 全体に枠線
    sheet.getRange(1, 1, cursor - 1, 3)
      .setBorder(true, true, true, true, true, true, '#CCCCCC',
        SpreadsheetApp.BorderStyle.SOLID);

    ss.setActiveSheet(sheet);
    SpreadsheetApp.getActiveSpreadsheet()
      .toast('システム説明シートを更新しました', '完了', 3);
  }

  return { refresh: refresh };

})();
