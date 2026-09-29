/* 収支帳 ― 立ち上がりを速くするための控え
 *
 * 画面のもと（HTML/CSS/JS/アイコン）だけを手元にしまっておきます。
 * データはしまいません。データの控えは localStorage のほうです。
 *
 * ★ここは2026-09-29に作り直しました。
 *   前の形は「HTMLも控えを先に出す」だったので、直したのに古い画面が出続け、
 *   しかも古いHTMLが新しいJSを読んで噛み合わず、アプリが起動しなくなりました。
 *
 *   いまの形：
 *     ・入口のページ（HTML）は いつも取りにいく。取れないときだけ控えを出す
 *     ・CSS/JS/アイコンは 控えを先に出す（住所に版が付いているので古いものを掴まない）
 */

var 版 = 'sj-v7';

// app.css / app.js は、版つきの住所（app.js?v=…）で読まれるので、ここには並べない。
// ここに素の住所を書くと、版なしの古いものを先に掴んでしまいます。
var もの = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-180.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(版).then(function (c) {
      // cache:'reload' が要ります。付けないと、ブラウザが前から持っている古いものを
      // そのまま控えに入れてしまいます（実際にそれで古い画面が残りました）。
      return Promise.all(もの.map(function (u) {
        return fetch(new Request(u, { cache: 'reload' })).then(function (res) {
          if (res && res.status === 200) return c.put(u, res);
        }).catch(function () { /* 1つ取れなくても、全体は止めない */ });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (名たち) {
      return Promise.all(名たち.map(function (n) { return n === 版 ? null : caches.delete(n); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);

  // Apps Script（データ）は絶対にしまわない。いつも取りにいく
  if (url.hostname.indexOf('google.com') >= 0) return;
  if (url.origin !== self.location.origin) return;

  // 入口のページ（HTML）は「まずネット、だめなら控え」。
  // ここを控え優先にすると、直したのに古い画面が出続けます。
  if (req.mode === 'navigate' || req.destination === 'document') {
    e.respondWith(
      fetch(req).then(function (res) {
        if (res && res.status === 200) {
          var 控え = res.clone();
          caches.open(版).then(function (c) { c.put('./', 控え); });
        }
        return res;
      }).catch(function () {
        return caches.match('./').then(function (あった) {
          return あった || caches.match('./index.html');
        });
      })
    );
    return;
  }

  // それ以外（CSS/JS/アイコン）は「まず控え、裏で新しくする」
  e.respondWith(
    caches.open(版).then(function (c) {
      return c.match(req).then(function (あった) {
        var とりに = fetch(req).then(function (res) {
          if (res && res.status === 200) c.put(req, res.clone());
          return res;
        }).catch(function () { return あった; });
        return あった || とりに;
      });
    })
  );
});
