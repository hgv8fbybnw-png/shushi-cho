/* 収支帳 ― 立ち上がりを速くするための控え
 *
 * 画面のもと（HTML/CSS/JS/アイコン）だけを手元にしまっておきます。
 * データはしまいません。データの控えは localStorage のほうです。
 *
 * 版を上げると、古い控えは捨てて入れ直します。
 */

var 版 = 'sj-v6';
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
    caches.open(版).then(function (c) { return c.addAll(もの); }).then(function () { return self.skipWaiting(); })
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

  // 画面のもとは「まず手元、裏で新しくする」
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
