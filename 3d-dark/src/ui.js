/* ===================================================================
   Раздел «Маршруты экспорта»: отрисовка панелей.

   Три кадра (класс состояния ставится на обёртку #sec-globe):

     is-intro     вход в раздел: два глобуса-слота и цифры за два года
     is-map       карта: поиск, топ-5, список стран, новости, годы
     is-country   выбранная страна: объём, место, продукция

   Состав экранов пересобран по макетам фигмы (docs/mockup/concept-18-09),
   оформление осталось прежним, зелёным — см. конец styles/app.css.
   Здесь только вёрстка и обработчики нажатий; данные считает src/app.js,
   сцену — src/globe.js.
   =================================================================== */
(function (global) {
  'use strict';

  // элементы ищем внутри обёртки раздела: в едином приложении рядом
  // лежат презентация и мониторинг, а часть идентификаторов совпадает
  var ROOT = U.scope('globe');
  var $ = U.byId('globe');
  var els = {};
  var handlers = {};
  var listState = { items: [], filter: '' };

  function init(h) {
    handlers = h;
    els = {
      search: $('search'),
      list: $('country-list'),
      top5: $('top5-list'),
      years: $('years'),
      summaryTitle: $('summary-title'),
      summaryNote: $('summary-note'),
      sumTotal: $('sum-total'),
      sumCountries: $('sum-countries'),
      news: $('news-list'),
      countryName: $('country-name'),
      countryTotal: $('country-total'),
      countryRank: $('country-rank'),
      countryProducts: $('country-products'),
      countryMore: $('country-more'),
      stars: $('stars'),
      loading: $('loading'),
      // слоты под видео: общий под кадрами «Карта» и «Страна»
      // и два круглых на входном кадре
      slotMain: $('globe-stage'),
      slotLeft: $('orb-left'),
      slotRight: $('orb-right'),
      videoMain: $('globe-video'),
      videoLeft: $('orb-video-left'),
      videoRight: $('orb-video-right'),
      posterLeft: $('orb-poster-left'),
      posterRight: $('orb-poster-right'),
      introNote: $('intro-note'),
      introLCap: $('intro-l-cap'),
      introLTotal: $('intro-l-total'),
      introLCrops: $('intro-l-crops'),
      introLCropsU: $('intro-l-crops-u'),
      introRCap: $('intro-r-cap'),
      introRTotal: $('intro-r-total'),
      introRCrops: $('intro-r-crops'),
      introRCropsU: $('intro-r-crops-u')
    };

    drawStars();

    els.search.addEventListener('input', function () {
      listState.filter = els.search.value.trim().toLowerCase();
      renderList();
      handlers.onInteract();
    });

    $('intro-go').addEventListener('click', function () { handlers.onIntroGo(); });
    $('back-map').addEventListener('click', function () { handlers.onBackToMap(); });
    $('reset-view').addEventListener('click', function () { handlers.onResetView(); });

    bindScrollbar(els.list, $('sb-countries'));
    bindScrollbar(els.news, $('sb-news'));
    bindScrollbar(els.countryProducts, $('sb-products'));
  }

  /* --------------------------- полосы прокрутки ---------------------------
     Нативную полосу браузер на стенде рисует по-своему (в macOS её вовсе
     не видно), а в кадре это тонкая зелёная линия в строго заданном месте.
     Поэтому полосу рисуем сами: дорожка стоит по координатам кадра
     (правила в styles/app.css), бегунок двигается за прокруткой списка.
     Полоса ничего не ловит — список листается пальцем и колесом. */

  function bindScrollbar(box, bar) {
    if (!box || !bar) return;
    var thumb = bar.firstElementChild;
    function sync() {
      var h = box.clientHeight, all = box.scrollHeight;
      if (!h || all <= h + 1) { bar.classList.add('is-off'); return; }
      bar.classList.remove('is-off');
      var track = bar.clientHeight;
      var th = Math.max(40, Math.round(track * h / all));
      var max = all - h;
      var y = max > 0 ? Math.round((track - th) * (box.scrollTop / max)) : 0;
      thumb.style.height = th + 'px';
      thumb.style.top = y + 'px';
    }
    box.addEventListener('scroll', sync, { passive: true });
    bar._sync = sync;
    sync();
  }

  /** Пересчитать бегунки после перерисовки списков. */
  function syncScrollbars() {
    ['sb-countries', 'sb-news', 'sb-products'].forEach(function (id) {
      var bar = $(id);
      if (bar && bar._sync) bar._sync();
    });
  }

  /* --------------------------- звёздное зерно --------------------------- */

  /*
   * Мелкое зерно по фону и десяток мягких светлых пятен. Цвета берутся
   * из темы (colors.stars и colors.starGlow — тройки «r,g,b»), поэтому
   * в синей теме зерно холодное, в зелёной — бирюзовое.
   */
  function drawStars() {
    var c = els.stars;
    if (!c) return;
    var dot = (handlers.colors && handlers.colors.stars) || '190,208,240';
    var glow = (handlers.colors && handlers.colors.starGlow) || '180,205,255';
    c.width = 1920; c.height = 1080;
    var g = c.getContext('2d');
    for (var i = 0; i < 620; i++) {
      var x = Math.random() * 1920, y = Math.random() * 1080;
      var r = Math.random() * 1.1 + 0.2, a = Math.random() * 0.38 + 0.04;
      g.fillStyle = 'rgba(' + dot + ',' + a.toFixed(3) + ')';
      g.beginPath(); g.arc(x, y, r, 0, 6.283); g.fill();
    }
    for (var j = 0; j < 22; j++) {
      var x2 = Math.random() * 1920, y2 = Math.random() * 1080;
      var gr = g.createRadialGradient(x2, y2, 0, x2, y2, 26);
      gr.addColorStop(0, 'rgba(' + glow + ',.16)');
      gr.addColorStop(1, 'rgba(' + glow + ',0)');
      g.fillStyle = gr;
      g.fillRect(x2 - 26, y2 - 26, 52, 52);
    }
  }

  /* ------------------------------ видео ------------------------------
     На стенде глобусы станут роликами. Пути к файлам лежат в config.json
     (globeVideo), поэтому готовый ролик подключается одной строкой, без
     правки кода. Пока пути нет:
       - в общем слоте продолжает работать сцена three.js;
       - в круглых слотах входного кадра виден постер (снимок нашего же
         глобуса за нужный год) и метка «[VIDEO]».                     */

  function setupVideos(paths, posters) {
    paths = paths || {};
    posters = posters || {};
    if (els.posterLeft && posters.intro2016) els.posterLeft.src = U.asset(posters.intro2016);
    if (els.posterRight && posters.intro2025) els.posterRight.src = U.asset(posters.intro2025);
    mount(els.slotMain, els.videoMain, paths.main, posters.main);
    mount(els.slotLeft, els.videoLeft, paths.intro2016, posters.intro2016);
    mount(els.slotRight, els.videoRight, paths.intro2025, posters.intro2025);
  }

  function mount(slot, video, src, poster) {
    if (!slot || !video) return;
    if (!src) { slot.classList.remove('has-video'); return; }
    if (poster) video.poster = U.asset(poster);
    // файл не открылся — молча возвращаемся к заглушке
    video.addEventListener('error', function () { slot.classList.remove('has-video'); });
    video.addEventListener('canplay', function () { slot.classList.add('has-video'); });
    video.src = U.asset(src);
    video.load();
    var p = video.play();
    if (p && p.catch) p.catch(function () { /* автозапуск включится по касанию */ });
  }

  /**
   * Ролики крутятся только на своём кадре: лишние кадры стенду ни к чему.
   * Входной кадр всегда начинается сначала — дуги на шарах должны
   * нарастать при каждом возврате и при срабатывании аттрактора.
   */
  function playVideos(state) {
    toggle(els.videoMain, state === 'map' || state === 'country');
    toggle(els.videoLeft, state === 'intro', true);
    toggle(els.videoRight, state === 'intro', true);
  }

  /** Уход в другой раздел: ролики ставим на паузу, они не видны. */
  function pauseVideos() {
    toggle(els.videoMain, false);
    toggle(els.videoLeft, false);
    toggle(els.videoRight, false);
  }

  function toggle(video, on, rewind) {
    if (!video || !video.src) return;
    try {
      if (on) {
        if (rewind) video.currentTime = 0;
        var p = video.play();
        if (p && p.catch) p.catch(function () {});
      } else video.pause();
    } catch (e) { /* ролика может не быть */ }
  }

  /* --------------------------- кадр «Вход» --------------------------- */

  /** info: {year, total, crops, demo} для левой и правой половины экрана. */
  function renderIntro(left, right) {
    fill(els.introLCap, els.introLTotal, els.introLCrops, els.introLCropsU, left);
    fill(els.introRCap, els.introRTotal, els.introRCrops, els.introRCropsU, right);
    if (!els.introNote) return;
    var demo = [left, right].filter(function (i) { return i.demo; })
      .map(function (i) { return i.year; });
    els.introNote.textContent = demo.length
      ? ('Цифры за ' + demo.join(' и ') + ' — демонстрационные: этих лет в данных пока нет.')
      : '';
  }

  function fill(cap, total, crops, cropsU, info) {
    if (!cap) return;
    cap.textContent = 'Экспорт зерна, ' + info.year;
    total.textContent = U.fmtVolume(info.total);
    crops.textContent = U.fmtInt(info.crops);
    cropsU.textContent = U.plural(info.crops, 'культура', 'культуры', 'культур');
  }

  /* --------------------------- панель годов ---------------------------
     years — [{year, has}]; has = false означает, что данных за этот год
     нет: чип показывается неактивным, цифры за него не выдумываются. */

  function renderYears(years, active) {
    els.years.innerHTML = '';
    years.forEach(function (y) {
      var cls = 'year-pill';
      if (y.year === active) cls += ' is-active';
      if (!y.has) cls += ' is-off';
      var b = U.el('button', cls);
      b.type = 'button';
      b.appendChild(U.el('span', 'mb'));      // мини-столбик: в зелёной теме скрыт
      b.appendChild(U.el('span', 'dot'));
      b.appendChild(U.el('span', 'yr', String(y.year)));
      if (y.has) b.addEventListener('click', function () { handlers.onYear(y.year); });
      els.years.appendChild(b);
    });
  }

  /* --------------------------- список стран ---------------------------
     Пять крупнейших направлений — в панели «Топ-5», остальные страны
     списком по алфавиту под ней. Поиск ищет по всем странам и на время
     убирает «Топ-5»: его место занимает список. */

  function setList(items) {
    listState.items = items;
    renderTop5(items.slice(0, 5));
    renderList();
  }

  /*
   * Медаль перед названием в «Топ-5» (макет от 25 сентября): лента-«галочка»
   * и круг под ней. 1–3 место — золото, серебро, бронза, 4–5 — приглушённый
   * зеленовато-серый. Рисунок один, цвет задаёт класс (styles/app.css,
   * .medal.m1…m5), поэтому иконка вшита прямо сюда, без файлов.
   */
  var MEDAL_SVG =
    '<svg class="medal-i" viewBox="0 0 18 21" aria-hidden="true">' +
    '<path fill-rule="evenodd" d="M0 0h18l-6.6 9.4H6.6zM5 2.2h8L9 7.4z"/>' +
    '<circle cx="9" cy="15" r="6"/></svg>';

  function renderTop5(items) {
    els.top5.innerHTML = '';
    items.forEach(function (it, i) { els.top5.appendChild(row(it, i + 1)); });
  }

  /** place — место в «Топ-5» (1…5): у такой строки перед названием медаль. */
  function row(it, place) {
    var n = U.el('div', 'country-row');
    if (place) {
      var m = U.el('i', 'medal m' + place);
      m.innerHTML = MEDAL_SVG;
      n.appendChild(m);
    }
    n.appendChild(U.el('span', 'nm', it.name));
    n.appendChild(U.el('span', 'vl', U.fmtVolume(it.value)));
    n.addEventListener('click', function () { handlers.onStart(it.name); });
    return n;
  }

  function byName(a, b) { return a.name.localeCompare(b.name, 'ru'); }

  function renderList() {
    var f = listState.filter;
    ROOT.classList.toggle('is-searching', !!f);

    var items = f
      ? listState.items.filter(function (it) {
          return it.name.toLowerCase().indexOf(f) >= 0;
        })
      : listState.items.slice(5);          // первые пять уже стоят в «Топ-5»

    items = items.slice().sort(byName);

    els.list.innerHTML = '';
    if (!items.length) {
      els.list.appendChild(U.el('div', 'list-hint', 'Ничего не найдено'));
      syncScrollbars();
      return;
    }
    items.forEach(function (it) { els.list.appendChild(row(it)); });
    syncScrollbars();
  }

  function clearSearch() { setSearch(''); }

  /** Вписать текст в поиск снаружи: параметр адреса ?q= (для снимков). */
  function setSearch(text) {
    els.search.value = text || '';
    listState.filter = (text || '').trim().toLowerCase();
    renderList();
    els.list.scrollTop = 0;
  }

  /* ------------------------------ сводка ------------------------------ */

  /**
   * note — пометка рядом с годом («на 30.06.2026»), может не быть.
   * countries — сколько стран-импортёров было в этом году: цифра из
   * блока summary в data/export.json, стоит в строке подписи справа.
   */
  function renderSummary(year, total, note, countries) {
    els.summaryTitle.textContent = 'Экспорт зерна, ' + year;
    els.sumTotal.textContent = U.fmtVolume(total);
    if (els.summaryNote) els.summaryNote.textContent = note ? ('(' + note + ')') : '';
    if (els.sumCountries) {
      els.sumCountries.textContent = countries
        ? (U.fmtInt(countries) + ' ' +
           U.plural(countries, 'страна-импортёр', 'страны-импортёра', 'стран-импортёров'))
        : '';
    }
  }

  /* ----------------------------- новости -----------------------------
     Аккордеон: раскрыт один пункт, у него круглая кнопка «×», у
     остальных «↓». Тексты лежат в data/news.json, по годам; за годы,
     которых в документе заказчика нет, лента просто скрывается. */

  var newsOpen = 0;

  // значки кнопки пункта: «×» у раскрытого, «↓» у свёрнутых — белые
  // линии в 2 px, как в макете (символы шрифта выходили тоньше и серее)
  var NEWS_CLOSE = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13"/></svg>';
  var NEWS_OPEN = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1v13M2.5 8.5L8 14l5.5-5.5"/></svg>';

  /** Новая лента (сменился год): раскрыт снова первый пункт. */
  function renderNews(items) {
    newsOpen = 0;
    drawNews(items || []);
  }

  function drawNews(items) {
    if (!els.news) return;
    ROOT.classList.toggle('is-nonews', !items.length);
    els.news.innerHTML = '';
    items.forEach(function (n, i) {
      var box = U.el('div', 'news-item' + (i === newsOpen ? '' : ' is-off'));
      var head = U.el('button', 'news-head');
      head.type = 'button';
      head.appendChild(U.el('i', 'news-n', String(i + 1)));
      // как в разметке кадра: заголовок и текст — одна колонка справа
      // от номера, текст идёт сразу под заголовком (зазор 6 px)
      var col = U.el('span', 'news-c');
      col.appendChild(U.el('span', 'news-t', n.title));
      col.appendChild(U.el('span', 'news-p', n.text));
      head.appendChild(col);
      var x = U.el('i', 'news-x');
      x.innerHTML = i === newsOpen ? NEWS_CLOSE : NEWS_OPEN;
      head.appendChild(x);
      head.addEventListener('click', function () {
        newsOpen = (newsOpen === i) ? -1 : i;
        drawNews(items);
        handlers.onInteract();
      });
      box.appendChild(head);
      els.news.appendChild(box);
    });
    syncScrollbars();
  }

  /* -------------------------- карточка страны --------------------------
     Список продукции — один столбец с прокруткой (правка заказчика от
     30.09): в макете нет обрезки «и ещё N позиций», вместо неё в шапке
     общая цифра видов продукции — считаем её по факту строк у страны,
     а не хардкодим, чтобы у каждой страны было своё число. */

  function renderCountry(info) {
    els.countryName.textContent = info.name;
    els.countryTotal.textContent = U.fmtVolume(info.value);
    els.countryRank.textContent = info.rank + ' место';

    els.countryProducts.innerHTML = '';
    info.products.forEach(function (p) {
      var item = U.el('div', 'product-item');
      item.appendChild(U.el('span', 'pn', U.capitalize(p.name)));
      item.appendChild(U.el('span', 'pv', U.fmtVolume(p.value)));
      els.countryProducts.appendChild(item);
    });
    els.countryProducts.scrollTop = 0;

    var n = info.products.length;
    els.countryMore.textContent = n > 0
      ? (n + ' ' + U.plural(n, 'вид', 'вида', 'видов') + ' продукции')
      : '';
    syncScrollbars();
  }

  /* ------------------------------ состояния ------------------------------ */

  /** state: 'intro' | 'map' | 'country' */
  function setState(state) {
    ROOT.classList.remove('is-intro', 'is-map', 'is-country');
    ROOT.classList.add('is-' + state);
    playVideos(state);
    syncScrollbars();
  }

  function hideLoading() {
    els.loading.classList.add('hidden');
  }

  global.UI = {
    init: init,
    setupVideos: setupVideos,
    renderIntro: renderIntro,
    renderYears: renderYears,
    setList: setList,
    clearSearch: clearSearch,
    setSearch: setSearch,
    renderSummary: renderSummary,
    renderNews: renderNews,
    renderCountry: renderCountry,
    setState: setState,
    pauseVideos: pauseVideos,
    hideLoading: hideLoading
  };
})(window);
