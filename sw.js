// Оболочка страницы и миниатюры, пережившие выключенный компьютер.
//
// Смысл ровно один: раньше при выключенном Маке страница не открывалась
// вовсе — её отдавал сам Мак. Теперь оболочка лежит в телефоне, страница
// открывается всегда, а показать ей есть что: список хранится рядом, в
// памяти самой страницы.
//
// Работает только на защищённом адресе: service worker по обычному http
// браузером не регистрируется вовсе. На старой дороге страница ведёт себя
// как прежде, и это нормально.
'use strict'

var SHELL = 'karman-shell-2'
var THUMBS = 'karman-thumbs-2'

// Потолок на миниатюры: без него кэш растёт вместе с историей скриншотов,
// а место на телефоне не наше.
var THUMB_LIMIT = 240

function shell() {
  return new URL('./', self.registration.scope).toString()
}

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(SHELL)
      // Относительно своей области, а не от корня: на постоянном адресе
      // страница лежит не в корне сайта, и `/` там чужой.
      .then(function (cache) { return cache.add(shell()) })
      // Свежая оболочка должна начать работать сразу, а не после того,
      // как человек закроет все вкладки: обновление приложения на Маке
      // иначе доезжало бы до телефона неделями.
      .then(function () { return self.skipWaiting() })
  )
})

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (names) {
        return Promise.all(names.map(function (name) {
          if (name !== SHELL && name !== THUMBS) return caches.delete(name)
          return null
        }))
      })
      .then(function () { return self.clients.claim() })
  )
})

self.addEventListener('fetch', function (event) {
  var request = event.request
  if (request.method !== 'GET') return

  var url
  try { url = new URL(request.url) } catch (e) { return }
  if (url.origin !== self.location.origin) return

  // Сама страница: сначала сеть, чтобы обновление доехало, потом память.
  if (request.mode === 'navigate') {
    event.respondWith(
      // no-store намеренно: хостинг разрешает держать страницу в обычном
      // кэше браузера десять минут, и всё это время «сначала сеть»
      // означало бы «сначала вчерашняя копия из кэша». Обновления
      // застревали именно здесь.
      fetch(request.url, { cache: 'no-store' })
        .then(function (response) {
          if (response && response.ok) {
            var copy = response.clone()
            caches.open(SHELL).then(function (cache) { cache.put(shell(), copy) })
          }
          return response
        })
        .catch(function () {
          // Адрес мог прийти с ключом в запросе — ищем без него.
          return caches.match(shell()).then(function (hit) {
            return hit || Response.error()
          })
        })
    )
    return
  }

  // Картинки: содержимое под данным id уже не меняется, поэтому сначала
  // память. Заодно это единственное, что позволяет посмотреть скриншот
  // при выключенном компьютере.
  if (url.pathname.indexOf('/thumb/') === 0 || url.pathname.indexOf('/file/') === 0) {
    event.respondWith(
      caches.match(request, { ignoreSearch: true }).then(function (hit) {
        if (hit) return hit
        return fetch(request).then(function (response) {
          if (response && response.ok) {
            var copy = response.clone()
            caches.open(THUMBS).then(function (cache) {
              cache.put(request, copy).then(function () { trim(cache) })
            })
          }
          return response
        })
      })
    )
    return
  }

  // Всё остальное — список, привязка, отправка — только через сеть.
  // Кэшировать их значило бы показывать вчерашнее как сегодняшнее.
})

// Выкидываем самые старые записи. Порядок в Cache API — порядок
// добавления, поэтому «самые старые» это первые в списке ключей.
function trim(cache) {
  return cache.keys().then(function (keys) {
    if (keys.length <= THUMB_LIMIT) return null
    return Promise.all(keys.slice(0, keys.length - THUMB_LIMIT).map(function (key) {
      return cache.delete(key)
    }))
  })
}
