/* ===================================================================
   Раздел «Маршруты экспорта»: загрузка данных, три кадра раздела,
   аттрактор-режим, масштабирование макета под окно.

   Кадры (класс состояния ставит src/ui.js на обёртку #sec-globe):

     intro     вход в раздел: два глобуса-ролика и цифры за два года
     map       карта: поиск, топ-10, список стран, новости, годы
     country   выбранная страна: объём, место в рейтинге, продукция

   Раздел единого приложения app.html (обёртка #sec-globe); та же логика
   работает и отдельной страницей index.html. Сцена three.js создаётся
   один раз: при уходе с раздела цикл отрисовки останавливается,
   при возврате возобновляется (см. Globe.stop / Globe.start).
   =================================================================== */
(function (global) {
  'use strict';

  // элементы ищем внутри обёртки раздела: в едином приложении рядом
  // лежат презентация и мониторинг, а часть идентификаторов совпадает
  var ROOT = U.scope('globe');
  var $ = U.byId('globe');

  var CFG = null;
  var THEME = 'navy';
  var DATA = null;
  var NEWS = {};                       // новости по годам, data/news.json
  var byName = {};
  var year = null;
  var yearIdx = 0;
  var state = 'intro';                 // intro | map | country
  var selected = null;
  var idleTimer = null;
  var live = true;                     // раздел на экране (в app.html — не всегда)

  /* --------------------- масштабирование макета --------------------- */

  function fitStage() {
    var s = Math.min(global.innerWidth / 1920, global.innerHeight / 1080);
    var stage = $('stage');
    if (stage) stage.style.transform = 'scale(' + s + ')';
    if (global.Globe && Globe.ready()) Globe.resize();
  }

  /* ---------------------------- данные ---------------------------- */

  function countriesForYear(y) {
    var i = DATA.years.indexOf(y);
    var out = [];
    DATA.countries.forEach(function (c) {
      var v = c.totals[i];
      if (v > 0) {
        out.push({
          name: c.name, value: v, lat: c.lat, lon: c.lon,
          iso: c.iso, port: c.port || c.name
        });
      }
    });
    out.sort(function (a, b) { return b.value - a.value; });
    return out;
  }

  function productsFor(name, y) {
    var c = byName[name];
    var raw = (c && c.years[String(y)]) || [];
    return raw.map(function (p) {
      return { name: DATA.products[p[0]].n, value: p[1] };
    });
  }

  /** Сколько разных позиций продукции вывезли за год (для входного экрана). */
  function cropsFor(y) {
    var key = String(y), seen = {}, n = 0;
    DATA.countries.forEach(function (c) {
      var arr = c.years[key];
      if (!arr) return;
      for (var i = 0; i < arr.length; i++) {
        if (!seen[arr[i][0]]) { seen[arr[i][0]] = 1; n++; }
      }
    });
    return n;
  }

  /**
   * Чипы годов: от первого года данных до `yearsUntil` из config.json.
   * Год, которого в данных нет, показывается неактивным — цифры
   * за него не выдумываем.
   */
  function yearChips() {
    var last = DATA.years[DATA.years.length - 1];
    var from = CFG.yearsFrom || DATA.years[0];
    var to = Math.max(last, CFG.yearsUntil || last);
    var out = [];
    for (var y = from; y <= to; y++) {
      out.push({ year: y, has: DATA.years.indexOf(y) >= 0 });
    }
    return out;
  }

  /* ---------------------------- состояния ---------------------------- */

  var listCache = [];

  function setYear(y, animate) {
    // на кадре «Страна» выбор года не сбрасывает страну: она остаётся
    // выбранной, а её цифры пересчитываются на новый год
    var keep = state === 'country' ? selected : null;
    var sum = DATA.summary[String(y)];

    year = y;
    yearIdx = DATA.years.indexOf(y);
    listCache = countriesForYear(y);

    UI.renderYears(yearChips(), y);
    UI.setList(listCache);
    UI.renderSummary(y, sum.total, (CFG.yearNote || {})[String(y)], sum.countries);
    UI.renderNews(NEWS[String(y)]);
    Globe.setRoutes(listCache, animate !== false);
    Globe.setSelected(null);
    selected = null;

    if (!keep) return;
    goToCountry(keep, false);
  }

  /* ---- кадр A: вход в раздел ---- */

  function goIntro() {
    // входной кадр с двумя шарами выключен в config.json (introScreen: false):
    // раздел сразу открывается картой, сброс по бездействию тоже ведёт на неё
    if (CFG.introScreen === false) { UI.clearSearch(); goMap(); return; }
    state = 'intro';
    selected = null;
    UI.setState('intro');
    UI.clearSearch();
    Globe.setSelected(null);
    Globe.resetView();
  }

  /**
   * Цифры входного кадра: два года из config.json (intro.leftYear
   * и intro.rightYear). Если такого года в данных нет, берём крайний.
   */
  function renderIntro() {
    var ic = CFG.intro || {};
    var first = DATA.years[0], last = DATA.years[DATA.years.length - 1];
    UI.renderIntro(introInfo(ic.leftYear != null ? ic.leftYear : first),
                   introInfo(ic.rightYear != null ? ic.rightYear : last));
  }

  /**
   * Год входного экрана. Если он есть в данных — цифры настоящие;
   * если нет (в макете это, например, 2026) — берутся demo-значения
   * из config.json, и под карточками появляется пометка.
   */
  function introInfo(y) {
    y = +y;
    if (DATA.years.indexOf(y) >= 0) {
      return { year: y, total: DATA.summary[String(y)].total, crops: cropsFor(y) };
    }
    var demo = ((CFG.intro || {}).demo || {})[String(y)] || { total: 0, crops: 0 };
    return { year: y, total: demo.total, crops: demo.crops, demo: true };
  }

  /* ---- кадр B: карта ---- */

  function goMap() {
    state = 'map';
    selected = null;
    UI.setState('map');
    Globe.setSelected(null);
    Globe.resetView();
    flashHint();
  }

  /* ---- кадры C/D: страна ---- */

  /**
   * refocus = false — страна уже выбрана и меняется только год:
   * камеру заново не ведём, чтобы глобус не дёргался на каждом чипе.
   */
  function goToCountry(name, refocus) {
    if (!byName[name]) return;
    var i = listCache.findIndex(function (it) { return it.name === name; });

    selected = name;
    state = 'country';
    UI.setState('country');
    var c = i >= 0 ? listCache[i] : byName[name];
    UI.renderCountry({
      name: name,
      value: i >= 0 ? c.value : 0,
      noDeliveries: i < 0,
      year: year,
      rank: i >= 0 ? i + 1 : null,
      products: i >= 0 ? productsFor(name, year) : [],
      origin: CFG.origin.name,
      port: c.port,
      distanceKm: U.greatCircleKm(CFG.origin.lat, CFG.origin.lon, c.lat, c.lon)
    });
    Globe.setSelected(name);
    if (refocus !== false) Globe.focus(name);
  }

  /* --------------------------- подсказка --------------------------- */

  /*
   * «Коснитесь страны или маршрута, чтобы узнать больше».
   * Постоянного места в макетах у неё нет, поэтому подсказка всплывает
   * под глобусом на пять секунд — при входе на карту.
   */
  var hintTimer = null;

  function flashHint() {
    var el = $('touch-hint');
    if (!el) return;
    if (hintTimer) clearTimeout(hintTimer);
    el.classList.add('is-on');
    hintTimer = setTimeout(function () { el.classList.remove('is-on'); }, 5000);
  }

  /* --------------------------- аттрактор --------------------------- */

  var idleOff = false;                 // отключается параметром ?idle=0
  var urlState = false;                // кадр задан адресом (?view=, ?country=)

  /* В едином приложении таймер бездействия один на все разделы и живёт
     в src/shell.js — здесь мы только сообщаем ему, что был отклик. */

  function resetIdle() {
    if (global.Shell) { global.Shell.ping(); return; }
    if (idleTimer) clearTimeout(idleTimer);
    if (idleOff) { idleTimer = null; return; }
    var sec = (CFG.attractorTimeoutSec || 90) * 1000;
    idleTimer = setTimeout(toAttractor, sec);
  }

  /** Сброс состояния: раздел возвращается на входной кадр A. */
  function toAttractor() {
    var start = CFG.startYear || DATA.years[DATA.years.length - 1];
    state = CFG.introScreen === false ? 'map' : 'intro';
    setYear(start, true);
    goIntro();
    resetIdle();
  }

  /* ------------------------------ старт ------------------------------ */

  function boot(active) {
    live = active !== false;
    return Promise.all([
      U.loadJSON('inline-config', 'config.json'),
      U.loadJSON('inline-export', 'data/export.json'),
      U.loadJSON('inline-topo', 'data/geo/countries-110m.json'),
      U.loadJSON('inline-news', 'data/news.json')
    ]).then(function (res) {
      // конфиг общий на все разделы (U.loadJSON его запоминает), а тема
      // правит поля прямо в нём — поэтому работаем со своей копией
      CFG = JSON.parse(JSON.stringify(res[0]));
      DATA = res[1];
      var topo = res[2];
      NEWS = res[3] || {};

      DATA.countries.forEach(function (c) { byName[c.name] = c; });

      applyTheme();
      applyColors(CFG.colors);

      UI.init({
        colors: CFG.colors,
        onYear: function (y) { resetIdle(); if (y !== year) setYear(y, true); },
        onStart: function (name) { resetIdle(); goToCountry(name); },
        onIntroGo: function () { resetIdle(); goMap(); },
        onBackToMap: function () { resetIdle(); goMap(); },
        onResetView: function () { resetIdle(); Globe.resetView(); },
        onInteract: resetIdle
      });
      UI.setupVideos(CFG.globeVideo, CFG.globeVideoPoster);

      // русские названия контуров для подписей на глобусе: iso -> название
      var names = {};
      DATA.countries.forEach(function (c) { if (c.iso && !names[c.iso]) names[c.iso] = c.name; });

      Globe.init({
        canvas: $('globe'),
        config: CFG,
        topo: topo,
        names: names,
        onInteract: resetIdle,
        // тап по дуге или по маркеру страны сразу открывает «Путь»
        onPick: function (name) {
          resetIdle();
          if (state === 'map') goToCountry(name);
        },
        // Сцена готова и текстуры залиты в видеопамять. Если раздел
        // готовился в фоне, дальше крутить его незачем — цикл отрисовки
        // останавливается до первого показа.
        onReady: function () {
          if (!live) setTimeout(function () { if (!live) Globe.stop(); }, 120);
        }
      });

      // «Главное меню» — обратно в презентацию, на экран start.
      var home = $('home-btn');
      if (home) {
        home.addEventListener('click', function () {
          resetIdle();
          U.goSection('story', { screen: 'start' });
        });
      }

      fitStage();
      var start = CFG.startYear || DATA.years[DATA.years.length - 1];
      setYear(start, true);
      renderIntro();
      if (CFG.introScreen === false) goMap(); else UI.setState('intro');
      if (!live) UI.pauseVideos();     // раздел готовился в фоне — не крутим
      UI.hideLoading();
      U.revealPage();
      resetIdle();
      applyUrlParams();

      ['pointerdown', 'pointermove', 'keydown', 'wheel'].forEach(function (ev) {
        document.addEventListener(ev, resetIdle, { passive: true });
      });
      global.addEventListener('resize', fitStage);
      if (global.Shell) global.Shell.ready('globe');
    }).catch(function (err) {
      var box = $('loading');
      box.textContent = 'Ошибка загрузки: ' + err.message;
      box.style.color = '#c0392b';
      U.revealPage();                  // иначе ошибку не видно из-под шторы
      global.console && console.error(err);
    });
  }

  /* ---------------- параметры адресной строки (отладка) ---------------- */

  /**
   * Позволяет открыть приложение сразу в нужном состоянии — для снимков
   * экрана, показа заказчику и автотестов. Все параметры необязательные,
   * список — в README, раздел «Параметры адресной строки».
   */
  function applyUrlParams() {
    var q = U.query('globe');
    if (!Object.keys(q).length) return;

    if (q.year && DATA.years.indexOf(+q.year) >= 0 && +q.year !== year) setYear(+q.year, false);

    // ?view=map открывает сразу карту (кадр B), ?view=intro — входной кадр;
    // ?country= и ?select= тоже уводят с входного кадра
    if (q.view === 'map') { goMap(); urlState = true; }
    if (q.view === 'intro') { goIntro(); urlState = true; }
    if (q.select) { goMap(); Globe.setSelected(q.select); urlState = true; }
    if (q.country) { goToCountry(q.country); urlState = true; }
    if (q.q) { goMap(); UI.setSearch(q.q); urlState = true; }

    var v = {};
    if (q.lat && q.lon) { v.lat = +q.lat; v.lon = +q.lon; }
    if (q.zoom) v.zoom = +q.zoom;
    if (q.rotate === '0') v.rotate = false;
    if (Object.keys(v).length) Globe.setDebugView(v);

    if (q.idle === '0') { idleOff = true; resetIdle(); }
  }

  /**
   * Выбор темы: поле `theme` в config.json, поверх — параметр ?theme=green.
   * Тема подменяет CFG.colors и часть CFG.globe (их берёт globe.js) и
   * ставит класс `theme-<ключ>`, по которому работает CSS.
   *
   * Отдельная страница index.html красится целиком: класс уходит на
   * <html>. В едином приложении app.html рядом лежат презентация и
   * мониторинг — они зелёные, поэтому класс зелёной темы остаётся на
   * <html>, а раздел глобуса получает свой класс на обёртку #sec-globe.
   * Какая тема у раздела в app.html — поле `appGlobeTheme` в config.json
   * (сейчас navy; «green» одной строкой возвращает зелёный раздел).
   * Темы описаны в config.json в блоке `themes`, см. README, раздел «Темы».
   */
  function themeScope() {
    return global.Shell ? (ROOT || document.documentElement) : document.documentElement;
  }

  function applyTheme() {
    var themes = CFG.themes || {};
    var inShell = !!global.Shell;
    var base = inShell ? (CFG.appGlobeTheme || CFG.theme) : CFG.theme;
    var want = U.query('globe').theme || base;
    var name = themes[want] ? want : (themes[base] ? base : Object.keys(themes)[0]);
    if (!name) return;                 // конфиг без тем — всё как в CSS по умолчанию

    THEME = name;
    CFG.theme = name;
    var th = themes[name];
    if (th.colors) CFG.colors = th.colors;
    if (th.globe) {
      Object.keys(th.globe).forEach(function (k) { CFG.globe[k] = th.globe[k]; });
    }
    if (inShell) {
      // на <html> — зелёная тема соседних разделов, на обёртке — своя
      document.documentElement.classList.add('theme-green');
      themeScope().classList.add('theme-' + name);
    } else {
      document.documentElement.classList.add('theme-' + name);
    }
  }

  function applyColors(c) {
    if (!c) return;
    var root = themeScope().style;
    if (c.pageBg) root.setProperty('--page-bg', c.pageBg);
    if (c.cardBg) root.setProperty('--card-bg', c.cardBg);
    if (c.panelBg) root.setProperty('--panel', c.panelBg);
    if (c.accent) root.setProperty('--accent', c.accent);
    if (c.text) root.setProperty('--text', c.text);
    if (c.textMuted) root.setProperty('--muted', c.textMuted);
    if (c.route) root.setProperty('--route', c.route);
    if (c.routeActive) root.setProperty('--gold2', c.routeActive);
  }

  /* Раздел единого приложения (app.html) или отдельная страница index.html.

     Сцена three.js создаётся один раз. При уходе с раздела цикл отрисовки
     останавливается, при возврате возобновляется — ни текстуры, ни
     геометрия заново не собираются. */

  if (global.Shell) {
    global.Shell.register('globe', {
      boot: boot,
      show: function () {
        live = true;
        fitStage();
        Globe.start();
        Globe.remeasure();               // пока раздел был скрыт, подписи не мерились
        // из презентации раздел всегда открывается с входного кадра;
        // исключение — кадр, заданный адресом при запуске (для снимков)
        if (urlState) { urlState = false; }
        else if (state !== 'intro') goIntro();
        // уже были на входном кадре: ролики шаров заводим сначала
        else if (CFG.introScreen !== false) UI.setState('intro');
        if (state === 'map') flashHint();
      },
      hide: function () {
        live = false;
        Globe.stop();
        UI.pauseVideos();               // ролики шаров не крутятся вхолостую
      },
      reset: function () {
        if (!DATA) return;
        toAttractor();
      }
    });
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
