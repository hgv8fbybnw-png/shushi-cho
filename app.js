/* 収支帳 ― 画面のうごき
 *
 * データの置き場は Google スプレッドシート（Apps Script のAPI）です。
 * 通信は JSONP だけを使っています。ブラウザの決まり（CORS）にひっかからないためです。
 *
 * 速く見せるしくみ：
 *   ひらく → 前に見た中身をすぐ出す（localStorage）→ 裏で新しいのを取りにいく → 差し替える
 *   入れる → 画面には先に出す → 裏で送る → こけたら「未送信」の札をつけて、あとで送り直す
 */

(function () {
  'use strict';

  // ================= 設定 =================

  var 既定のAPI = 'https://script.google.com/macros/s/AKfycbzq1bmdy8rhDf3ik_F1KcfsZY3rAX_cmLXCpCE7TYHqTmwnQTv4lmUuSUERy9ytm034/exec';
  var シートURL = 'https://docs.google.com/spreadsheets/d/1v3NwlMH8bDSps2d7O04xCgW4uuQI4cdWpWU4D4oBFBQ/edit';
  var 版 = '1.0.2';

  var 鍵 = { key: 'sj.key', data: 'sj.data', api: 'sj.api', tbl: 'sj.tbl' };

  // ================= 小さな道具 =================

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function 円(n) { return (Math.round(Number(n) || 0)).toLocaleString('ja-JP'); }

  function 二桁(n) { return (n < 10 ? '0' : '') + n; }

  function 今日文字() {
    var d = new Date();
    return d.getFullYear() + '-' + 二桁(d.getMonth() + 1) + '-' + 二桁(d.getDate());
  }

  function 日をずらす(文字, 差) {
    var p = 文字.split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    d.setDate(d.getDate() + 差);
    return d.getFullYear() + '-' + 二桁(d.getMonth() + 1) + '-' + 二桁(d.getDate());
  }

  function 月の文字(日付) { return String(日付).slice(0, 7); }

  function 月ラベル(m) {
    var p = String(m).split('-');
    return p[0] + '年' + Number(p[1]) + '月';
  }

  function 月をずらす(m, 差) {
    var p = String(m).split('-');
    var y = Number(p[0]), mo = Number(p[1]) - 1 + 差;
    y += Math.floor(mo / 12);
    mo = ((mo % 12) + 12) % 12;
    return y + '-' + 二桁(mo + 1);
  }

  function 月の日数(m) {
    var p = String(m).split('-');
    return new Date(Number(p[0]), Number(p[1]), 0).getDate();
  }

  function 曜日(日付) {
    var p = 日付.split('-');
    return '日月火水木金土'.charAt(new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])).getDay());
  }

  function 日ラベル(日付) {
    var 今日 = 今日文字();
    if (日付 === 今日) return '今日';
    if (日付 === 日をずらす(今日, -1)) return '昨日';
    var p = 日付.split('-');
    return Number(p[1]) + '月' + Number(p[2]) + '日（' + 曜日(日付) + '）';
  }

  /** グラフの目盛りの文字。1万を超えたら「万」でまとめる */
  function 目盛り(v) {
    v = Math.round(v);
    if (v === 0) return '0';
    var 負 = v < 0;
    var a = Math.abs(v), s;
    if (a >= 100000000) s = (a / 100000000).toFixed(a % 100000000 === 0 ? 0 : 1) + '億';
    else if (a >= 10000) s = (a / 10000).toFixed(a >= 100000 || a % 10000 === 0 ? 0 : 1) + '万';
    else s = a.toLocaleString('ja-JP');
    return (負 ? '−' : '') + s;
  }

  // ================= 覚えておく（localStorage） =================

  function 読む(k, 既定) {
    try {
      var v = localStorage.getItem(k);
      return v == null ? 既定 : JSON.parse(v);
    } catch (e) { return 既定; }
  }

  function 書く(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* いっぱいでも止めない */ }
  }

  function 控えを保存() {
    書く(鍵.data, { records: S.records, genres: S.genres, at: Date.now() });
  }

  // ================= 通信（JSONP） =================

  var 連番 = 0;

  function 呼ぶ(action, params) {
    return new Promise(function (resolve, reject) {
      var cb = '__sj' + (連番++) + '_' + Math.floor(Math.random() * 1e6);
      var s = document.createElement('script');
      var 時計 = setTimeout(function () { 片づけ(); reject(new Error('つながりませんでした')); }, 25000);

      function 片づけ() {
        clearTimeout(時計);
        try { delete window[cb]; } catch (e) { window[cb] = undefined; }
        if (s.parentNode) s.parentNode.removeChild(s);
      }

      window[cb] = function (d) { 片づけ(); resolve(d); };
      s.onerror = function () { 片づけ(); reject(new Error('つながりませんでした')); };

      var q = ['action=' + encodeURIComponent(action), 'k=' + encodeURIComponent(S.key), 'callback=' + cb];
      for (var key in params) {
        if (params.hasOwnProperty(key) && params[key] !== undefined && params[key] !== null) {
          q.push(encodeURIComponent(key) + '=' + encodeURIComponent(params[key]));
        }
      }
      s.src = S.api + '?' + q.join('&') + '&_=' + Date.now();
      document.head.appendChild(s);
    });
  }

  // ================= いまの状態 =================

  var S = {
    api: 読む(鍵.api, null) || 既定のAPI,
    key: 読む(鍵.key, ''),
    records: [],
    genres: [],
    view: 'input',
    kind: '支出',
    genre: null,
    amount: '',
    memo: '',
    date: 今日文字(),
    month: 月の文字(今日文字()),
    filter: 'all',
    表で見る: 読む(鍵.tbl, false),
    仮ジャンル: [],
    読込中: false,
    とれなかった: ''
  };

  // ================= 立ち上がり =================

  function 起動() {
    var u = new URL(location.href);
    var kq = u.searchParams.get('k');
    if (kq) {
      S.key = kq;
      書く(鍵.key, S.key);
      // ⚠️ ここで ?k= をアドレスから消してはいけません。
      // 消すと、そのあと「ホーム画面に追加」したときに合言葉なしのURLが焼き付き、
      // アイコンから開くたびに合言葉を聞かれるようになります（実際に起きました）。
      // iPhoneは Safari とホーム画面のアプリで保管場所が別なので、
      // 起動URLに合言葉が乗っていることが頼りです。
    }
    var aq = new URL(location.href).searchParams.get('api');
    if (aq) { S.api = aq; 書く(鍵.api, aq); }

    var c = 読む(鍵.data, null);
    if (c && c.records) { S.records = c.records; S.genres = c.genres || []; }

    $('#boot').hidden = true;

    if (!S.key) { 門をひらく(); return; }
    アプリを出す();
  }

  function 門をひらく(文言) {
    $('#gate').hidden = false;
    $('#app').hidden = true;
    if (文言) $('#gate-msg').textContent = 文言;
    setTimeout(function () { $('#gate-key').focus(); }, 60);
  }

  /**
   * 入れてもらった合言葉を、できるだけ受け取れる形に直す。
   * ・空白（全角も）をぜんぶ落とす
   * ・リンクをまるごと貼られたら、その中の k= を取り出す
   * 16文字を手で打つのは間違えます。貼り付けで済むようにしておくのが要。
   */
  function 合言葉を整える_(生) {
    var s = String(生 == null ? '' : 生).replace(/[　\s]/g, '');
    var m = s.match(/[?&#]k=([^&#]+)/);
    if (m) {
      try { s = decodeURIComponent(m[1]); } catch (e) { s = m[1]; }
    }
    return s;
  }

  var 門の失敗回数 = 0;

  $('#gate-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var v = 合言葉を整える_($('#gate-key').value);
    if (!v) return;
    $('#gate-msg').textContent = 'たしかめています…';
    門をためす_(v, [v.toLowerCase()]);
  });

  /**
   * 合言葉をためす。だめだったら、あとの候補（小文字にしたもの等）も順に試す。
   * 打ち間違いで1回落ちるのがいちばん多いので、粘る。
   */
  function 門をためす_(v, あとの候補) {
    S.key = v;
    呼ぶ('all', {}).then(function (r) {
      if (r && r.ok) {
        門の失敗回数 = 0;
        書く(鍵.key, v);
        S.records = r.records || [];
        S.genres = r.genres || [];
        控えを保存();
        $('#gate-msg').textContent = '';
        $('#gate').hidden = true;
        アプリを出す();
        return;
      }
      if (r && r.鍵ちがい) {
        var 次 = (あとの候補 || []).filter(function (x) { return x && x !== v; });
        if (次.length) { 門をためす_(次[0], 次.slice(1)); return; }
        S.key = '';
        門の失敗回数++;
        $('#gate-msg').innerHTML = 門の失敗回数 >= 2
          ? '合言葉がちがいます。<br>もらったリンクを長押しでコピーして、<br>この欄にそのまま貼り付けてみてください。'
          : '合言葉がちがいます';
        return;
      }
      S.key = '';
      $('#gate-msg').textContent = (r && r.error) || 'うまくいきませんでした';
    }).catch(function () {
      S.key = '';
      $('#gate-msg').innerHTML = 'つながりませんでした。<br>電波を確かめて、もう一度おしてください';
    });
  }

  function アプリを出す() {
    $('#app').hidden = false;
    document.body.setAttribute('data-kind', S.kind);
    描く();
    読み込む();
  }

  /**
   * 新しい中身を取りにいく。
   * Apps Script は、すいているときは2秒、こんでいるときは30秒かかることがあります
   * （実測：2.5秒／9秒／時間切れ）。なので、こけたら黙って取り直します。
   * 画面には前に見た中身がもう出ているので、待たされている感じはしません。
   */
  function 読み込む(あと何回) {
    if (S.読込中) return;
    あと何回 = (あと何回 === undefined) ? 2 : あと何回;
    S.読込中 = true;
    しるしを更新();

    呼ぶ('all', {}).then(function (r) {
      S.読込中 = false;
      if (!r || !r.ok) {
        if (r && r.鍵ちがい) { localStorage.removeItem(鍵.key); S.key = ''; 門をひらく('合言葉がちがいます'); return; }
        もう一度(あと何回, (r && r.error) || 'とれませんでした');
        return;
      }
      var 未送信 = S.records.filter(function (x) { return x.未送信; });
      var きた = r.records || [];
      var ある = {};
      きた.forEach(function (x) { if (x.cid) ある[x.cid] = 1; });
      S.records = きた.concat(未送信.filter(function (x) { return !x.cid || !ある[x.cid]; }));
      S.genres = r.genres || [];
      S.仮ジャンル = [];
      S.とれなかった = '';
      控えを保存();
      しるしを更新();
      描く();
      送りなおす();
    }).catch(function () {
      S.読込中 = false;
      もう一度(あと何回, 'つながりません');
    });
  }

  function もう一度(あと何回, 文言) {
    if (あと何回 > 0) {
      setTimeout(function () { 読み込む(あと何回 - 1); }, 2500);
      return;
    }
    S.とれなかった = 文言;
    しるしを更新();
  }

  /**
   * 右上の小さな字。
   * ・送れていないものがあるときは、赤で件数（これは伝えないといけない）
   * ・取りにいっている間は「よみこみ中」
   * ・取れなかっただけなら、控えがあるうちは何も言わない（画面は出ているので）
   */
  function しるしを更新() {
    var 待ち = S.records.filter(function (x) { return x.未送信; }).length;
    var 文 = '', わるい = false;
    if (待ち) { 文 = 待ち + '件 送れていません'; わるい = true; }
    else if (S.読込中) { 文 = 'よみこみ中'; }
    else if (S.とれなかった && !S.records.length) { 文 = S.とれなかった; わるい = true; }
    var e = $('#sync');
    e.textContent = 文;
    e.className = 'sync' + (わるい ? ' bad' : '');
  }

  // ================= 画面の切りかえ =================

  var 見出し = { input: '入れる', chart: 'グラフ', list: '明細' };

  function 画面へ(v) {
    S.view = v;
    $$('.tab').forEach(function (b) {
      var on = b.dataset.view === v;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $('#view-input').hidden = v !== 'input';
    $('#view-chart').hidden = v !== 'chart';
    $('#view-list').hidden = v !== 'list';
    $('#hd-title').textContent = 見出し[v];
    window.scrollTo(0, 0);
    描く();
  }

  $$('.tab').forEach(function (b) {
    b.addEventListener('click', function () { 画面へ(b.dataset.view); });
  });

  function 描く() {
    if (S.view === 'input') 入力を描く();
    else if (S.view === 'chart') グラフを描く();
    else 明細を描く();
  }

  // ================= 計算 =================

  function その月の(m) {
    return S.records.filter(function (r) { return 月の文字(r.日付) === m; });
  }

  function 合計(たち, 種別) {
    var s = 0;
    for (var i = 0; i < たち.length; i++) if (たち[i].種別 === 種別) s += Number(たち[i].金額) || 0;
    return s;
  }

  function ジャンル別(たち, 種別) {
    var m = {};
    たち.forEach(function (r) {
      if (r.種別 !== 種別) return;
      m[r.ジャンル] = (m[r.ジャンル] || 0) + (Number(r.金額) || 0);
    });
    return Object.keys(m).map(function (k) { return { 名前: k, 額: m[k] }; })
      .sort(function (a, b) { return b.額 - a.額; });
  }

  /** いま選べるジャンル。よく使う順にならべる */
  function 使えるジャンル(種別) {
    var 出 = S.genres.filter(function (g) { return g.種別 === 種別 && !g.しまった; })
      .map(function (g) { return { 名前: g.名前, 回数: g.回数 || 0, 最終: g.最終 || '' }; });
    S.仮ジャンル.forEach(function (g) {
      if (g.種別 === 種別 && !出.some(function (x) { return x.名前 === g.名前; })) {
        出.push({ 名前: g.名前, 回数: 0, 最終: '' });
      }
    });
    出.sort(function (a, b) {
      if (b.回数 !== a.回数) return b.回数 - a.回数;
      if (b.最終 !== a.最終) return b.最終 < a.最終 ? -1 : 1;
      return a.名前.localeCompare(b.名前, 'ja');
    });
    return 出;
  }

  // ================= 入れる画面 =================

  function 入力を描く() {
    var box = $('#amount-box');
    box.classList.toggle('is-zero', !S.amount);
    $('#amount-val').textContent = S.amount ? 円(S.amount) : '0';

    var 入れ物 = $('#genre-chips');
    var たち = 使えるジャンル(S.kind);
    var h = '';
    たち.forEach(function (g) {
      h += '<button class="chip' + (S.genre === g.名前 ? ' is-on' : '') + '" data-g="' + esc(g.名前) + '">' + esc(g.名前) + '</button>';
    });
    h += '<button class="chip chip-new" data-new="1">＋ ジャンル</button>';
    if (!たち.length) h = '<p class="chips-empty">まだジャンルがありません。「＋ ジャンル」から作ってください。</p>' + h;
    入れ物.innerHTML = h;

    $('#memo').value = S.memo;
    $('#date-chip').textContent = 日ラベル(S.date);
    $('#save').disabled = !(S.genre && Number(S.amount) > 0);
  }

  $$('.seg-b').forEach(function (b) {
    b.addEventListener('click', function () {
      S.kind = b.dataset.kind;
      document.body.setAttribute('data-kind', S.kind);
      $$('.seg-b').forEach(function (x) {
        var on = x === b;
        x.classList.toggle('is-on', on);
        x.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      var ある = 使えるジャンル(S.kind).some(function (g) { return g.名前 === S.genre; });
      if (!ある) S.genre = null;
      入力を描く();
    });
  });

  $('#genre-chips').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.new) { 新しいジャンルを聞く(b); return; }
    S.genre = (S.genre === b.dataset.g) ? null : b.dataset.g;
    入力を描く();
  });

  function 新しいジャンルを聞く(ボタン) {
    var i = document.createElement('input');
    i.type = 'text';
    i.className = 'chip-input';
    i.maxLength = 20;
    i.placeholder = S.kind === '収入' ? '例：アフィリ' : '例：外注';
    ボタン.replaceWith(i);
    i.focus();

    function 決める() {
      var v = i.value.replace(/[　\s]+/g, ' ').trim().slice(0, 20);
      if (v) {
        if (!S.仮ジャンル.some(function (g) { return g.名前 === v && g.種別 === S.kind; })) {
          S.仮ジャンル.push({ 名前: v, 種別: S.kind });
        }
        S.genre = v;
      }
      入力を描く();
    }
    i.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); 決める(); }
      if (e.key === 'Escape') 入力を描く();
    });
    i.addEventListener('blur', 決める);
  }

  $('#pad').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    var k = b.dataset.k;
    if (k === 'del') S.amount = S.amount.slice(0, -1);
    else if (k === '000') { if (S.amount) S.amount = (S.amount + '000').slice(0, 10); }
    else S.amount = (S.amount === '0' ? '' : S.amount) + k;
    S.amount = S.amount.replace(/^0+(?=\d)/, '').slice(0, 10);
    入力を描く();
  });

  document.addEventListener('keydown', function (e) {
    if (S.view !== 'input' || $('#app').hidden || !$('#sheet').hidden) return;
    if (document.activeElement && /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName)) return;
    if (/^[0-9]$/.test(e.key)) { S.amount = (S.amount + e.key).replace(/^0+(?=\d)/, '').slice(0, 10); 入力を描く(); }
    else if (e.key === 'Backspace') { S.amount = S.amount.slice(0, -1); 入力を描く(); }
    else if (e.key === 'Enter' && !$('#save').disabled) 記録する();
  });

  $('#memo').addEventListener('input', function () { S.memo = this.value; });

  $('#date-chip').addEventListener('click', function () {
    var 今日 = 今日文字();
    シート('いつのぶん？',
      '<div class="set-list">' +
      [['今日', 今日], ['昨日', 日をずらす(今日, -1)], ['おととい', 日をずらす(今日, -2)]].map(function (p) {
        return '<button class="set-item" data-d="' + p[1] + '">' + p[0] +
          (S.date === p[1] ? '<small>いま これ</small>' : '<small>' + p[1] + '</small>') + '</button>';
      }).join('') +
      '</div>' +
      '<div class="fld" style="margin-top:14px"><label>それより前</label>' +
      '<input type="date" id="pick-date" value="' + S.date + '" max="' + 今日 + '"></div>',
      function (箱) {
        箱.addEventListener('click', function (e) {
          var b = e.target.closest('[data-d]');
          if (!b) return;
          S.date = b.dataset.d;
          シートを閉じる();
          入力を描く();
        });
        $('#pick-date', 箱).addEventListener('change', function () {
          if (this.value) { S.date = this.value; シートを閉じる(); 入力を描く(); }
        });
      });
  });

  $('#save').addEventListener('click', 記録する);

  function 記録する() {
    if (!S.genre || !(Number(S.amount) > 0)) return;
    var cid = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    var rec = {
      id: 'tmp_' + cid, cid: cid,
      日付: S.date, 種別: S.kind, ジャンル: S.genre,
      金額: Number(S.amount), メモ: S.memo.trim(),
      未送信: true
    };
    S.records.push(rec);
    地元でジャンルを数える(rec);
    控えを保存();

    var 新しいか = !S.genres.some(function (g) { return g.名前 === rec.ジャンル && g.種別 === rec.種別 && (g.回数 || 0) > 1; });

    S.amount = '';
    S.memo = '';
    $('#memo').value = '';
    入力を描く();

    トースト(
      (新しいか ? '新しいジャンル「' + esc(rec.ジャンル) + '」<br>' : '') +
      esc(rec.ジャンル) + ' に <b>' + 円(rec.金額) + '円</b>',
      '取り消す',
      function () { 一件けす(rec.id); }
    );

    送る(rec);
  }

  function 地元でジャンルを数える(rec) {
    var g = S.genres.filter(function (x) { return x.名前 === rec.ジャンル && x.種別 === rec.種別; })[0];
    if (g) { g.回数 = (g.回数 || 0) + 1; g.最終 = rec.日付; }
    else S.genres.push({ 名前: rec.ジャンル, 種別: rec.種別, 回数: 1, 最終: rec.日付, 並び: S.genres.length + 1, しまった: false });
    S.仮ジャンル = S.仮ジャンル.filter(function (x) { return !(x.名前 === rec.ジャンル && x.種別 === rec.種別); });
  }

  function 送る(rec) {
    呼ぶ('add', {
      種別: rec.種別, ジャンル: rec.ジャンル, 金額: rec.金額,
      メモ: rec.メモ, 日付: rec.日付, cid: rec.cid
    }).then(function (r) {
      if (r && r.ok) {
        rec.id = r.id;
        delete rec.未送信;
        控えを保存();
        しるしを更新();
        if (S.view !== 'input') 描く();
      } else {
        しるしを更新();
      }
    }).catch(function () {
      しるしを更新();
      if (S.view === 'list') 描く();
    });
  }

  function 送りなおす() {
    var 待ち = S.records.filter(function (r) { return r.未送信; }).slice(0, 15);
    if (!待ち.length) return;
    呼ぶ('bulk', {
      items: JSON.stringify(待ち.map(function (r) {
        return { 種別: r.種別, ジャンル: r.ジャンル, 金額: r.金額, メモ: r.メモ, 日付: r.日付, cid: r.cid };
      }))
    }).then(function (r) {
      if (!r || !r.ok) { しるしを更新(); return; }
      (r.組 || []).forEach(function (組) {
        var t = S.records.filter(function (x) { return x.cid === 組.cid; })[0];
        if (t) { t.id = 組.id; delete t.未送信; }
      });
      控えを保存();
      しるしを更新();
      描く();
    }).catch(function () { しるしを更新(); });
  }

  window.addEventListener('online', function () { しるしを更新(); 送りなおす(); });

  // ================= グラフ画面 =================

  function グラフを描く() {
    var m = S.month;
    var たち = その月の(m);
    var 収入 = 合計(たち, '収入'), 支出 = 合計(たち, '支出');
    var のこり = 収入 - 支出;
    var 先 = 月の文字(今日文字());

    var h = '';

    h += '<div class="monthnav">' +
      '<button data-mv="-1" aria-label="前の月"><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg></button>' +
      '<span class="monthnav-l">' + 月ラベル(m) + '</span>' +
      '<button data-mv="1" aria-label="次の月"' + (m >= 先 ? ' disabled' : '') + '><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></button>' +
      '</div>';

    h += '<div class="hero">' +
      '<div class="hero-k">のこり</div>' +
      '<div class="hero-v ' + (のこり > 0 ? 'plus' : (のこり < 0 ? 'minus' : '')) + '">' +
      (のこり > 0 ? '+' : (のこり < 0 ? '−' : '')) + '¥' + 円(Math.abs(のこり)) + '</div>' +
      '<div class="hero-s">入ったお金 − つかったお金</div></div>';

    h += '<div class="tiles">' +
      タイル('入ったお金', 収入, 'var(--in)', たち.filter(function (r) { return r.種別 === '収入'; }).length) +
      タイル('つかったお金', 支出, 'var(--out)', たち.filter(function (r) { return r.種別 === '支出'; }).length) +
      '</div>';

    if (収入 > 0 || 支出 > 0) h += メーター(収入, 支出);

    h += ランキング('つかったお金のジャンル', ジャンル別(たち, '支出'), 支出, 'var(--out)');
    h += ランキング('入ったお金のジャンル', ジャンル別(たち, '収入'), 収入, 'var(--in)');

    h += '<div class="card"><p class="card-t">月ごとの動き<span class="sub">直近12か月</span></p>' +
      '<div class="chart" id="c-month"></div>' +
      '<div class="legend"><span><i style="background:var(--in)"></i>入った</span><span><i style="background:var(--out)"></i>つかった</span></div>' +
      '<button class="tbl-toggle" data-tbl="1">' + (S.表で見る ? '表を閉じる' : '表で見る') + '</button>' +
      (S.表で見る ? 月の表() : '') + '</div>';

    h += '<div class="card"><p class="card-t">のこりの動き<span class="sub">0より下は赤字の月</span></p>' +
      '<div class="chart" id="c-net"></div></div>';

    h += '<div class="card"><p class="card-t">日ごとにつかったお金<span class="sub">' + 月ラベル(m) + '</span></p>' +
      '<div class="chart" id="c-day"></div></div>';

    if (!たち.length) {
      h += '<p class="empty">' + 月ラベル(m) + 'の記録はまだありません。<br>「入れる」から1件いれてみてください。</p>';
    }

    var v = $('#view-chart');
    v.innerHTML = h;

    v.querySelectorAll('[data-mv]').forEach(function (b) {
      b.addEventListener('click', function () { S.month = 月をずらす(S.month, Number(b.dataset.mv)); グラフを描く(); });
    });
    var tb = v.querySelector('[data-tbl]');
    if (tb) tb.addEventListener('click', function () { S.表で見る = !S.表で見る; 書く(鍵.tbl, S.表で見る); グラフを描く(); });

    月グラフ($('#c-month'));
    のこりグラフ($('#c-net'));
    日グラフ($('#c-day'));
  }

  function タイル(名, 額, 色, 件) {
    return '<div class="tile"><div class="tile-k"><i style="background:' + 色 + '"></i>' + 名 + '</div>' +
      '<div class="tile-v">¥' + 円(額) + '</div>' +
      '<div class="tile-s">' + 件 + '件</div></div>';
  }

  function メーター(収入, 支出) {
    if (収入 <= 0) {
      return '<div class="card"><div class="meter-top"><span class="meter-pct">¥' + 円(支出) + '</span>' +
        '<span class="meter-note">この月はまだ収入の記録がありません</span></div></div>';
    }
    var 率 = 支出 / 収入;
    var 幅 = Math.min(100, 率 * 100);
    return '<div class="card">' +
      '<div class="meter-top"><span class="meter-pct">' + (率 * 100).toFixed(率 < 0.1 ? 1 : 0) + '%</span>' +
      '<span class="meter-note">入ったお金のうち、つかったぶん</span></div>' +
      '<div class="meter-track"><i class="meter-fill' + (幅 >= 99.5 ? ' full' : '') + '" style="width:' + 幅.toFixed(2) + '%"></i></div>' +
      '<div class="meter-legend"><span>つかった ¥' + 円(支出) + '</span><span>' +
      (支出 > 収入 ? '足りない ¥' + 円(支出 - 収入) : 'のこり ¥' + 円(収入 - 支出)) + '</span></div></div>';
  }

  function ランキング(題, 並び, 合, 色) {
    if (!並び.length) return '';
    var 最大 = 並び[0].額 || 1;
    var h = '<div class="card"><p class="card-t">' + 題 + '<span class="sub">' + 並び.length + '種類</span></p><div class="rank">';
    並び.forEach(function (g) {
      var 率 = 合 > 0 ? (g.額 / 合 * 100) : 0;
      h += '<div class="rank-row">' +
        '<span class="rank-name">' + esc(g.名前) + '</span>' +
        '<span class="rank-amt">¥' + 円(g.額) + '<span class="pct">' + 率.toFixed(率 < 10 ? 1 : 0) + '%</span></span>' +
        '<span class="rank-bar"><i style="width:' + (g.額 / 最大 * 100).toFixed(2) + '%;background:' + 色 + '"></i></span>' +
        '</div>';
    });
    return h + '</div></div>';
  }

  // ---- SVGのグラフ ----

  function 色を取る(名) {
    return getComputedStyle(document.documentElement).getPropertyValue(名).trim() || '#888';
  }

  function ふきだしを付ける(箱, 当たり, 文たち) {
    var tip = document.createElement('div');
    tip.className = 'tip';
    箱.appendChild(tip);

    function 出す(i, x, y) {
      if (!文たち[i]) return;
      tip.innerHTML = 文たち[i];
      tip.classList.add('on');
      var w = tip.offsetWidth;
      var 左 = Math.max(w / 2 + 2, Math.min(箱.clientWidth - w / 2 - 2, x));
      tip.style.left = 左 + 'px';
      tip.style.top = Math.max(tip.offsetHeight + 4, y - 6) + 'px';
    }
    function 消す() { tip.classList.remove('on'); }

    当たり.forEach(function (r, i) {
      r.addEventListener('mouseenter', function () { 出す(i, Number(r.dataset.cx), Number(r.dataset.cy)); });
      r.addEventListener('mouseleave', 消す);
      r.addEventListener('click', function (e) { e.stopPropagation(); 出す(i, Number(r.dataset.cx), Number(r.dataset.cy)); });
    });
    document.addEventListener('click', 消す);
    箱.addEventListener('scroll', 消す);
  }

  /** 月ごとの動き（入った／つかった の2本ならび） */
  function 月グラフ(箱) {
    if (!箱) return;
    var W = Math.max(260, 箱.clientWidth), H = 190;
    var L = 46, R = 6, T = 10, B = 24;
    var 幅 = W - L - R, 高 = H - T - B;

    var 月たち = [], i;
    for (i = 11; i >= 0; i--) 月たち.push(月をずらす(S.month, -i));

    var 値 = 月たち.map(function (m) {
      var t = その月の(m);
      return { m: m, 収: 合計(t, '収入'), 支: 合計(t, '支出') };
    });
    var 最大 = Math.max(1, Math.max.apply(null, 値.map(function (v) { return Math.max(v.収, v.支); })));

    var 一枠 = 幅 / 12;
    var 棒 = Math.max(4, Math.min(13, (一枠 - 6) / 2));
    var 青 = 色を取る('--in'), 橙 = 色を取る('--out');

    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" height="' + H + '" role="img" aria-label="月ごとの入ったお金とつかったお金">';
    [0, 0.5, 1].forEach(function (p) {
      var y = T + 高 - 高 * p;
      s += '<line class="gl" x1="' + L + '" y1="' + y + '" x2="' + (W - R) + '" y2="' + y + '"/>';
      s += '<text class="ax" x="' + (L - 6) + '" y="' + (y + 3.5) + '" text-anchor="end">' + 目盛り(最大 * p) + '</text>';
    });

    var 文たち = [];
    値.forEach(function (v, idx) {
      var cx = L + 一枠 * idx + 一枠 / 2;
      var h収 = 高 * (v.収 / 最大), h支 = 高 * (v.支 / 最大);
      if (v.収 > 0) s += '<rect x="' + (cx - 棒 - 1) + '" y="' + (T + 高 - h収) + '" width="' + 棒 + '" height="' + h収 + '" rx="2" fill="' + 青 + '"/>';
      if (v.支 > 0) s += '<rect x="' + (cx + 1) + '" y="' + (T + 高 - h支) + '" width="' + 棒 + '" height="' + h支 + '" rx="2" fill="' + 橙 + '"/>';
      if (idx % 2 === 1 || 一枠 > 30) {
        s += '<text class="ax" x="' + cx + '" y="' + (H - 7) + '" text-anchor="middle">' + Number(v.m.split('-')[1]) + '</text>';
      }
      s += '<rect class="hit" data-cx="' + cx + '" data-cy="' + T + '" x="' + (L + 一枠 * idx) + '" y="' + T + '" width="' + 一枠 + '" height="' + 高 + '"/>';
      文たち.push('<b>' + 月ラベル(v.m) + '</b><br>入った ¥' + 円(v.収) + '<br>つかった ¥' + 円(v.支) +
        '<br>のこり ' + (v.収 - v.支 >= 0 ? '+' : '−') + '¥' + 円(Math.abs(v.収 - v.支)));
    });
    s += '</svg>';
    箱.innerHTML = s;
    ふきだしを付ける(箱, $$('.hit', 箱), 文たち);
  }

  /** のこりの動き（0を境に、上が黒字・下が赤字） */
  function のこりグラフ(箱) {
    if (!箱) return;
    var W = Math.max(260, 箱.clientWidth), H = 160;
    var L = 46, R = 6, T = 10, B = 24;
    var 幅 = W - L - R, 高 = H - T - B;

    var 月たち = [], i;
    for (i = 11; i >= 0; i--) 月たち.push(月をずらす(S.month, -i));
    var 値 = 月たち.map(function (m) {
      var t = その月の(m);
      return { m: m, v: 合計(t, '収入') - 合計(t, '支出') };
    });

    var 上 = Math.max(0, Math.max.apply(null, 値.map(function (x) { return x.v; })));
    var 下 = Math.min(0, Math.min.apply(null, 値.map(function (x) { return x.v; })));
    var はば = Math.max(1, 上 - 下);
    var ゼロy = T + 高 * (上 / はば);

    var 一枠 = 幅 / 12;
    var 棒 = Math.max(6, Math.min(20, 一枠 - 8));
    var 青 = 色を取る('--in'), 赤 = 色を取る('--minus');

    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" height="' + H + '" role="img" aria-label="月ごとののこり">';
    s += '<text class="ax" x="' + (L - 6) + '" y="' + (T + 4) + '" text-anchor="end">' + 目盛り(上) + '</text>';
    if (下 < 0) s += '<text class="ax" x="' + (L - 6) + '" y="' + (T + 高) + '" text-anchor="end">' + 目盛り(下) + '</text>';
    s += '<line class="zero" x1="' + L + '" y1="' + ゼロy + '" x2="' + (W - R) + '" y2="' + ゼロy + '"/>';
    s += '<text class="ax" x="' + (L - 6) + '" y="' + (ゼロy + 3.5) + '" text-anchor="end">0</text>';

    var 文たち = [];
    値.forEach(function (x, idx) {
      var cx = L + 一枠 * idx + 一枠 / 2;
      var h = 高 * (Math.abs(x.v) / はば);
      if (Math.abs(x.v) > 0) {
        var y = x.v >= 0 ? ゼロy - h : ゼロy;
        s += '<rect x="' + (cx - 棒 / 2) + '" y="' + y + '" width="' + 棒 + '" height="' + Math.max(1.5, h) + '" rx="2" fill="' + (x.v >= 0 ? 青 : 赤) + '"/>';
      }
      if (idx % 2 === 1 || 一枠 > 30) {
        s += '<text class="ax" x="' + cx + '" y="' + (H - 7) + '" text-anchor="middle">' + Number(x.m.split('-')[1]) + '</text>';
      }
      s += '<rect class="hit" data-cx="' + cx + '" data-cy="' + T + '" x="' + (L + 一枠 * idx) + '" y="' + T + '" width="' + 一枠 + '" height="' + 高 + '"/>';
      文たち.push('<b>' + 月ラベル(x.m) + '</b><br>のこり ' + (x.v >= 0 ? '+' : '−') + '¥' + 円(Math.abs(x.v)));
    });
    s += '</svg>';
    箱.innerHTML = s;
    ふきだしを付ける(箱, $$('.hit', 箱), 文たち);
  }

  /** 日ごとにつかったお金 */
  function 日グラフ(箱) {
    if (!箱) return;
    var W = Math.max(260, 箱.clientWidth), H = 150;
    var L = 46, R = 6, T = 10, B = 24;
    var 幅 = W - L - R, 高 = H - T - B;

    var 日数 = 月の日数(S.month);
    var たち = その月の(S.month);
    var 日ごと = [], i;
    for (i = 1; i <= 日数; i++) 日ごと.push({ 日: i, 支: 0, 収: 0 });
    たち.forEach(function (r) {
      var d = Number(String(r.日付).slice(8, 10));
      if (!日ごと[d - 1]) return;
      if (r.種別 === '支出') 日ごと[d - 1].支 += Number(r.金額) || 0;
      else 日ごと[d - 1].収 += Number(r.金額) || 0;
    });
    var 最大 = Math.max(1, Math.max.apply(null, 日ごと.map(function (x) { return x.支; })));

    var 一枠 = 幅 / 日数;
    var 棒 = Math.max(3, 一枠 - 2.5);
    var 橙 = 色を取る('--out');

    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" height="' + H + '" role="img" aria-label="日ごとにつかったお金">';
    [0, 1].forEach(function (p) {
      var y = T + 高 - 高 * p;
      s += '<line class="gl" x1="' + L + '" y1="' + y + '" x2="' + (W - R) + '" y2="' + y + '"/>';
      s += '<text class="ax" x="' + (L - 6) + '" y="' + (y + 3.5) + '" text-anchor="end">' + 目盛り(最大 * p) + '</text>';
    });

    var 文たち = [];
    日ごと.forEach(function (x, idx) {
      var cx = L + 一枠 * idx + 一枠 / 2;
      var h = 高 * (x.支 / 最大);
      if (x.支 > 0) s += '<rect x="' + (cx - 棒 / 2) + '" y="' + (T + 高 - h) + '" width="' + 棒 + '" height="' + Math.max(1.5, h) + '" rx="1.5" fill="' + 橙 + '"/>';
      if (x.日 === 1 || x.日 % 5 === 0 || x.日 === 日数) {
        s += '<text class="ax" x="' + cx + '" y="' + (H - 7) + '" text-anchor="middle">' + x.日 + '</text>';
      }
      s += '<rect class="hit" data-cx="' + cx + '" data-cy="' + T + '" x="' + (L + 一枠 * idx) + '" y="' + T + '" width="' + 一枠 + '" height="' + 高 + '"/>';
      文たち.push('<b>' + Number(S.month.split('-')[1]) + '月' + x.日 + '日</b><br>つかった ¥' + 円(x.支) +
        (x.収 > 0 ? '<br>入った ¥' + 円(x.収) : ''));
    });
    s += '</svg>';
    箱.innerHTML = s;
    ふきだしを付ける(箱, $$('.hit', 箱), 文たち);
  }

  function 月の表() {
    var 月たち = [], i;
    for (i = 11; i >= 0; i--) 月たち.push(月をずらす(S.month, -i));
    var h = '<table class="tbl"><thead><tr><th>月</th><th>入った</th><th>つかった</th><th>のこり</th></tr></thead><tbody>';
    月たち.forEach(function (m) {
      var t = その月の(m), 収 = 合計(t, '収入'), 支 = 合計(t, '支出');
      h += '<tr><td>' + 月ラベル(m) + '</td><td>' + 円(収) + '</td><td>' + 円(支) + '</td><td>' +
        (収 - 支 >= 0 ? '+' : '−') + 円(Math.abs(収 - 支)) + '</td></tr>';
    });
    return h + '</tbody></table>';
  }

  var 待ち合わせ;
  window.addEventListener('resize', function () {
    clearTimeout(待ち合わせ);
    待ち合わせ = setTimeout(function () {
      if (S.view === 'chart' && !$('#app').hidden) {
        月グラフ($('#c-month')); のこりグラフ($('#c-net')); 日グラフ($('#c-day'));
      }
    }, 180);
  });

  // ================= 明細画面 =================

  function 明細を描く() {
    var m = S.month;
    var 先 = 月の文字(今日文字());
    var たち = その月の(m).filter(function (r) {
      return S.filter === 'all' || (S.filter === 'in' ? r.種別 === '収入' : r.種別 === '支出');
    }).sort(function (a, b) {
      if (a.日付 !== b.日付) return a.日付 < b.日付 ? 1 : -1;
      return String(b.登録 || '') < String(a.登録 || '') ? -1 : 1;
    });

    var h = '<div class="monthnav">' +
      '<button data-mv="-1" aria-label="前の月"><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg></button>' +
      '<span class="monthnav-l">' + 月ラベル(m) + '</span>' +
      '<button data-mv="1" aria-label="次の月"' + (m >= 先 ? ' disabled' : '') + '><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></button>' +
      '</div>';

    h += '<div class="filters">' +
      [['all', 'すべて'], ['out', 'つかった'], ['in', '入った']].map(function (p) {
        return '<button data-f="' + p[0] + '"' + (S.filter === p[0] ? ' class="is-on"' : '') + '>' + p[1] + '</button>';
      }).join('') + '</div>';

    if (!たち.length) {
      h += '<p class="empty">この月の記録はまだありません。</p>';
    } else {
      var 日ごと = {};
      たち.forEach(function (r) { (日ごと[r.日付] = 日ごと[r.日付] || []).push(r); });
      Object.keys(日ごと).sort().reverse().forEach(function (d) {
        var 群 = 日ごと[d];
        var 支 = 群.reduce(function (s, r) { return s + (r.種別 === '支出' ? r.金額 : 0); }, 0);
        var 収 = 群.reduce(function (s, r) { return s + (r.種別 === '収入' ? r.金額 : 0); }, 0);
        h += '<div class="daygrp"><div class="daygrp-h"><span class="daygrp-d">' + 日ラベル(d) + '</span>' +
          '<span class="daygrp-s">' + (収 ? '入 ¥' + 円(収) + '　' : '') + (支 ? '出 ¥' + 円(支) : '') + '</span></div><div class="rows">';
        群.forEach(function (r) {
          h += '<button class="row' + (r.未送信 ? ' pending' : '') + '" data-id="' + esc(r.id) + '">' +
            '<span class="row-tag" style="background:' + (r.種別 === '収入' ? 'var(--in)' : 'var(--out)') + '"></span>' +
            '<span class="row-mid"><span class="row-g">' + esc(r.ジャンル) + '</span>' +
            (r.メモ ? '<span class="row-m">' + esc(r.メモ) + '</span>' : '') + '</span>' +
            '<span class="row-a' + (r.種別 === '収入' ? ' in' : '') + '">' + (r.種別 === '収入' ? '+' : '−') + '¥' + 円(r.金額) + '</span>' +
            '</button>';
        });
        h += '</div></div>';
      });
    }

    var v = $('#view-list');
    v.innerHTML = h;
    v.querySelectorAll('[data-mv]').forEach(function (b) {
      b.addEventListener('click', function () { S.month = 月をずらす(S.month, Number(b.dataset.mv)); 明細を描く(); });
    });
    v.querySelectorAll('[data-f]').forEach(function (b) {
      b.addEventListener('click', function () { S.filter = b.dataset.f; 明細を描く(); });
    });
    v.querySelectorAll('.row').forEach(function (b) {
      b.addEventListener('click', function () { 直す画面(b.dataset.id); });
    });
  }

  // ================= 1件を直す =================

  function 直す画面(id) {
    var r = S.records.filter(function (x) { return x.id === id; })[0];
    if (!r) return;

    var たち = 使えるジャンル(r.種別);
    if (!たち.some(function (g) { return g.名前 === r.ジャンル; })) たち.unshift({ 名前: r.ジャンル });

    シート('記録を直す',
      '<div class="fld"><label>種類</label><select id="e-kind">' +
      '<option value="支出"' + (r.種別 === '支出' ? ' selected' : '') + '>つかったお金</option>' +
      '<option value="収入"' + (r.種別 === '収入' ? ' selected' : '') + '>入ったお金</option></select></div>' +
      '<div class="fld"><label>ジャンル</label><input id="e-genre" type="text" maxlength="20" list="e-glist" value="' + esc(r.ジャンル) + '">' +
      '<datalist id="e-glist">' + たち.map(function (g) { return '<option value="' + esc(g.名前) + '">'; }).join('') + '</datalist></div>' +
      '<div class="fld"><label>金額</label><input id="e-amt" type="text" inputmode="numeric" value="' + r.金額 + '"></div>' +
      '<div class="fld"><label>メモ</label><input id="e-memo" type="text" maxlength="60" value="' + esc(r.メモ || '') + '"></div>' +
      '<div class="fld"><label>日付</label><input id="e-date" type="date" value="' + esc(r.日付) + '"></div>' +
      '<div class="sheet-btns"><button class="btn-danger" id="e-del">消す</button>' +
      '<button class="btn-primary" id="e-save">直す</button></div>',
      function (箱) {
        $('#e-save', 箱).addEventListener('click', function () {
          var 新 = {
            種別: $('#e-kind', 箱).value,
            ジャンル: $('#e-genre', 箱).value.replace(/[　\s]+/g, ' ').trim().slice(0, 20),
            金額: Math.round(Number(String($('#e-amt', 箱).value).replace(/[^0-9]/g, ''))),
            メモ: $('#e-memo', 箱).value.trim(),
            日付: $('#e-date', 箱).value || r.日付
          };
          if (!新.ジャンル || !(新.金額 > 0)) { トースト('ジャンルと金額を入れてください'); return; }
          Object.keys(新).forEach(function (k) { r[k] = 新[k]; });
          控えを保存();
          シートを閉じる();
          描く();
          if (String(r.id).indexOf('tmp_') === 0) { 送る(r); return; }
          呼ぶ('update', {
            id: r.id, 種別: r.種別, ジャンル: r.ジャンル, 金額: r.金額, メモ: r.メモ, 日付: r.日付
          }).then(function (x) {
            if (x && x.ok) { しるしを更新(); 読み込む(); } else しるしを更新();
          }).catch(function () { しるしを更新(); });
        });
        $('#e-del', 箱).addEventListener('click', function () {
          シートを閉じる();
          一件けす(r.id);
        });
      });
  }

  function 一件けす(id) {
    var i = -1, j;
    for (j = 0; j < S.records.length; j++) if (S.records[j].id === id) { i = j; break; }
    if (i < 0) return;
    var r = S.records[i];
    S.records.splice(i, 1);
    var g = S.genres.filter(function (x) { return x.名前 === r.ジャンル && x.種別 === r.種別; })[0];
    if (g && g.回数 > 0) g.回数--;
    控えを保存();
    描く();
    トースト('1件けしました');
    if (String(id).indexOf('tmp_') === 0) return;
    呼ぶ('delete', { id: id }).catch(function () { しるしを更新(); });
  }

  // ================= 設定 =================

  $('#btn-settings').addEventListener('click', function () {
    シート('設定',
      '<div class="set-list">' +
      '<button class="set-item" data-a="reload">読み込み直す<small>いまの控え ' + S.records.length + '件</small></button>' +
      '<button class="set-item" data-a="genres">ジャンルの整理<small>名前を変える・しまう</small></button>' +
      (シートURL ? '<button class="set-item" data-a="sheet">スプレッドシートをひらく<small>もとのデータ</small></button>' : '') +
      '<button class="set-item" data-a="copy">ぜんぶコピー<small>CSVで書き出す</small></button>' +
      '<button class="set-item" data-a="logout">合言葉を入れ直す<small>この端末から消します</small></button>' +
      '<div class="set-item" style="color:var(--ink-3);font-size:13px">収支帳 ' + 版 + '</div>' +
      '</div>',
      function (箱) {
        箱.addEventListener('click', function (e) {
          var b = e.target.closest('[data-a]');
          if (!b) return;
          var a = b.dataset.a;
          if (a === 'reload') { シートを閉じる(); 読み込む(); トースト('読み込み直しています'); }
          if (a === 'sheet') { window.open(シートURL, '_blank', 'noopener'); }
          if (a === 'copy') {
            var csv = '日付,種別,ジャンル,金額,メモ\n' + S.records.slice().sort(function (x, y) {
              return x.日付 < y.日付 ? -1 : 1;
            }).map(function (r) {
              return [r.日付, r.種別, r.ジャンル, r.金額, String(r.メモ || '').replace(/[",\n]/g, ' ')]
                .map(function (v) { return '"' + String(v) + '"'; }).join(',');
            }).join('\n');
            (navigator.clipboard ? navigator.clipboard.writeText(csv) : Promise.reject())
              .then(function () { トースト('コピーしました（' + S.records.length + '件）'); })
              .catch(function () { トースト('コピーできませんでした'); });
          }
          if (a === 'logout') {
            localStorage.removeItem(鍵.key);
            localStorage.removeItem(鍵.data);
            location.reload();
          }
          if (a === 'genres') ジャンル整理();
        });
      });
  });

  function ジャンル整理() {
    var 中 = ['支出', '収入'].map(function (k) {
      var たち = S.genres.filter(function (g) { return g.種別 === k; })
        .sort(function (a, b) { return (b.回数 || 0) - (a.回数 || 0); });
      if (!たち.length) return '';
      return '<p class="card-t" style="margin-top:14px">' + (k === '支出' ? 'つかったお金' : '入ったお金') + '</p>' +
        たち.map(function (g) {
          return '<div class="gm-row"><span class="gm-k">' + (g.回数 || 0) + '回</span>' +
            '<input type="text" maxlength="20" value="' + esc(g.名前) + '" data-was="' + esc(g.名前) + '" data-kind="' + k + '"' +
            (g.しまった ? ' style="opacity:.5"' : '') + '>' +
            '<button data-hide="' + esc(g.名前) + '" data-hk="' + k + '">' + (g.しまった ? 'もどす' : 'しまう') + '</button></div>';
        }).join('');
    }).join('');

    シート('ジャンルの整理',
      '<p style="font-size:13px;color:var(--ink-2);margin:0 0 4px;line-height:1.7">' +
      '名前を直すと、その名前で入れた記録もぜんぶ書きかわります。<br>' +
      '「しまう」と、ボタンには出なくなります（記録は消えません）。</p>' +
      (中 || '<p class="empty">まだジャンルがありません</p>') +
      '<div class="sheet-btns"><button class="btn-ghost" data-close>閉じる</button>' +
      '<button class="btn-primary" id="gm-save">直す</button></div>',
      function (箱) {
        箱.addEventListener('click', function (e) {
          var b = e.target.closest('[data-hide]');
          if (!b) return;
          var g = S.genres.filter(function (x) { return x.名前 === b.dataset.hide && x.種別 === b.dataset.hk; })[0];
          if (!g) return;
          var もどす = !!g.しまった;
          g.しまった = !もどす;
          控えを保存();
          呼ぶ('genreHide', { ジャンル: g.名前, 種別: g.種別, もどす: もどす ? 1 : '' })
            .catch(function () { しるしを更新(); });
          シートを閉じる();
          トースト(もどす ? '「' + g.名前 + '」をもどしました' : '「' + g.名前 + '」をしまいました');
          描く();
        });
        var sv = $('#gm-save', 箱);
        if (sv) sv.addEventListener('click', function () {
          var 直し = [];
          $$('input[data-was]', 箱).forEach(function (i) {
            var 前 = i.dataset.was;
            var 後 = i.value.replace(/[　\s]+/g, ' ').trim().slice(0, 20);
            if (後 && 後 !== 前) 直し.push({ 前: 前, 後: 後, 種別: i.dataset.kind });
          });
          シートを閉じる();
          if (!直し.length) return;
          直し.forEach(function (d) {
            S.records.forEach(function (r) { if (r.種別 === d.種別 && r.ジャンル === d.前) r.ジャンル = d.後; });
            var g = S.genres.filter(function (x) { return x.名前 === d.前 && x.種別 === d.種別; })[0];
            if (g) g.名前 = d.後;
          });
          控えを保存();
          描く();
          トースト(直し.length + '件の名前を直しました');
          Promise.all(直し.map(function (d) { return 呼ぶ('genreRename', d); }))
            .then(function () { 読み込む(); })
            .catch(function () { しるしを更新(); });
        });
      });
  }

  // ================= 下からのシート・トースト =================

  function シート(題, 中身, あと) {
    var 箱 = $('#sheet-in');
    箱.innerHTML = '<div class="sheet-grab"></div><h2 class="sheet-t">' + esc(題) + '</h2>' + 中身;
    $('#sheet').hidden = false;
    if (あと) あと(箱);
    箱.querySelectorAll('[data-close]').forEach(function (b) { b.addEventListener('click', シートを閉じる); });
  }

  function シートを閉じる() { $('#sheet').hidden = true; $('#sheet-in').innerHTML = ''; }
  $('#sheet').querySelector('.sheet-bg').addEventListener('click', シートを閉じる);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') シートを閉じる(); });

  var トースト時計;
  function トースト(文, ボタン名, あと) {
    var t = $('#toast');
    t.innerHTML = '<span>' + 文 + '</span>';
    if (ボタン名) {
      var b = document.createElement('button');
      b.textContent = ボタン名;
      b.addEventListener('click', function () { t.hidden = true; if (あと) あと(); });
      t.appendChild(b);
    }
    t.hidden = false;
    clearTimeout(トースト時計);
    トースト時計 = setTimeout(function () { t.hidden = true; }, ボタン名 ? 7000 : 2600);
  }

  // ================= service worker =================

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* なくても動く */ });
    });
  }

  起動();
})();
