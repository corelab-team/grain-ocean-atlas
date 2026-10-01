/* ===================================================================
   «Путь зерна» — сквозная презентация, каркас всех экранов.

   Одно приложение, экраны переключаются без перезагрузки страницы.
   Тексты и данные лежат отдельно, в src/story-content.js: чтобы
   поправить формулировку, сюда лезть не нужно.

   Что здесь:
     - движок: реестр экранов, переход с затуханием, история для «назад»;
     - раскладки — новый экран добавляется описанием в справочнике,
       а не вёрсткой. Их осталось две, обе по макетам
       «Design concept 17.09»:
         scene   основная: сцена во весь экран, поверх неё плавающие
                 панели, метки и навигация;
         intro   заставка: коллаж, заголовок, касание в любом месте;
     - детали раскладки scene: панели, кнопки, табы, метки, ползунки,
       шкалы, меню шагов, карточки-снимки — собираются по описанию
       экрана, ручной разметки в HTML нет нигде;
     - блоки, зависящие от выбора или шага, — словарь SLOTS;
     - аттрактор: возврат на первый экран по таймауту из config.json;
     - адрес ?screen=<id> открывает нужный экран сразу,
       ?sel= и ?tab= — сразу в нужном состоянии.

   Раздел единого приложения app.html (обёртка #sec-story); та же логика
   работает и отдельной страницей story.html.

   Экраны глобуса (index.html) и Блока 3 (path.html) этот файл не трогает.
   =================================================================== */
(function (global) {
  'use strict';

  var C = global.StoryContent;
  // элементы ищем внутри обёртки раздела: в едином приложении рядом
  // лежат ещё глобус и мониторинг, а часть идентификаторов совпадает
  var ROOT = U.scope('story');
  var $ = U.byId('story');
  var el = function (t, c, x) { return U.el(t, c, x); };

  var byId = {};
  C.screens.forEach(function (s) { byId[s.id] = s; });

  var CFG = { attractorTimeoutSec: 90 };
  var HOME = 'intro';                    // куда возвращает аттрактор
  var FADE = 250;                        // мс затухания при переходе

  var cur = null;                        // текущий экран
  var st = {};                           // состояние экрана (сбрасывается при переходе)
  var hist = [];                         // история переходов для «назад»
  var idleTimer = null, idleOff = false;
  var busy = false;
  var scanTimers = [];
  function cancelDroneScan() { scanTimers.forEach(clearTimeout); scanTimers = []; }

  /* =================================================================
     Состояние экрана: вкладка, выбор, шаг

     Экраны с несколькими состояниями держат его в двух полях:
     st.tab — вкладка или состояние сцены, st.sel — выбранный объект
     (элемент почвы, продукт, страна) или номер шага на хранении.
     Оба приходят и из адреса: ?tab= и ?sel=.
     ================================================================= */

  /**
   * Кнопка:
   *   to     — переход на экран презентации (или 'back');
   *   link   — уход в другой раздел стенда: 'globe' — экран глобуса
   *            «Маршруты экспорта», 'monitoring' — карта мониторинга.
   *            Адрес и затемнение — U.goSection;
   *   action — поведение самого экрана из словаря ACTIONS.
   */
  function button(b, cls) {
    var n = el('button', cls || 'sc-btn', b.label);
    n.type = 'button';
    if (b.action) n.setAttribute('data-action', b.action);
    n.addEventListener('click', function () {
      resetIdle();
      if (b.to === 'back') back();
      else if (b.link) U.goSection(b.link, b.params);
      else if (b.to) go(b.to);
      else if (b.action && ACTIONS[b.action]) ACTIONS[b.action]();
    });
    return n;
  }

  /* Заглушённый экран (tabsWip) всегда показывает кадр по умолчанию:
     так состояния недоступны и адресом ?tab=…, и через ?demo=1. */
  function tabKey() {
    if (cur && cur.tabsWip) return cur.defaultTab;
    return st.tab || cur.defaultTab;
  }
  function selKey() { return st.sel != null ? st.sel : cur.defaultSel; }

  function find(list, key) {
    for (var i = 0; i < list.length; i++) if (list[i].key === key) return list[i];
    return list[0];
  }

  /** Станция 4: сценарий экрана (силос или ангар, поле flow) и его
      текущий шаг — номер лежит в st.sel. */
  function flow() { return C.flows[cur.flow]; }
  function flowStep() {
    var steps = flow().steps;
    var n = parseInt(selKey(), 10);
    if (!(n >= 1 && n <= steps.length)) n = 1;
    return steps[n - 1];
  }

  /** Экран 16: выбранная вкладка продовольственного маршрута. */
  function foodTab() { return find(C.food, tabKey()); }

  /** Экран 17: состояние кормового маршрута — корм или животное. */
  function feedState() { return C.feed[tabKey()] || C.feed.feed; }

  /* Кадр сцены: общий, по вкладке или по шагу. Имя вместо объекта —
     ссылка на справочник (см. поля sceneByTab и sceneBySel). */
  var SCENES = {
    food: function () {
      var f = foodTab();
      return { pic: C.pic(f.name, f.img, 'фото', '', f.at) };
    },
    feed: function () {
      var s = feedState();
      return { pic: C.pic(s.title, s.img, 'фото', '', s.at) };
    },
    /* станция 4: сцена меняется вслед за шагом (st.sel) — см.
       sceneBySel: 'flow' у store-silo и store-1. sceneFor() ждёт
       объект { pic: ... }, как у food/feed выше. */
    flow: function () { return { pic: flowStep().scene }; }
  };

  function sceneFor(scr) {
    var name = scr.sceneBySel || scr.sceneByTab;
    if (typeof name === 'string') return SCENES[name] ? SCENES[name]() : {};
    if (scr.sceneByTab) return scr.sceneByTab[tabKey()] || {};
    return scr.scene || {};
  }

  /* =================================================================
     Раскладка «scene» — макеты «Design concept 17.09»

     Экран описывается объектом в справочнике, здесь только сборка:

       scene:    { pic }                  картинка во весь экран
       shade:    'top' | 'bottom' | 'soft'  затемнение под текст
       eyebrow / title / sub              шапка слева сверху
       topRight: { label, to|link }       кнопка «В Центр» справа сверху
       left / right: { at, width, items } колонки плавающих панелей
       markers:  [{ key, n, label, x, y, to }]  метки на объектах сцены
       links:    ['M … L …']              линии между метками (SVG)
       tiles:    [{ name, sub, img, … }]  плитки переходов (экран меню)
       boxes:    [{ at, items }]          блоки по координатам кадра
       tabsFrom: 'food'                   табы из справочника
       overlay:  'feed'                   метки и подсказки на сцене
       picks3:   'routes'                 три карточки во весь экран
       hero:     'Раздел в разработке'    крупная надпись по центру
       nav:      { back, next }           навигация снизу
       navWidth: [528, 556]               ширина кнопок навигации

     Элемент колонки — панель ({ title, text, rows, note }), кнопка
     ({ label, to|link|action, gold: true }) или блок, который движок
     собирает сам по выбору на экране ({ dyn: 'station' }).
     ================================================================= */

  /**
   * Картинка-сцена. Лежит в скруглённом блоке 1888x1048 (отступ 16 px
   * от краёв экрана). Поле at кадра — его место внутри этого блока
   * [слева, сверху, ширина, высота] в числах выгрузки Figma; без него
   * кадр просто обрезается по месту.
   */
  /* soil-3 и soil-4 (мелиорация, рекультивация): фон студии взят из
     кадра макета как есть, и участки лежат над затемнением — с ним
     фон по краям темнел бы, а участок нет. */
  var NO_VIGNETTE = { intro: 1, start: 1, hub: 1, 'soil-1': 1, 'soil-2': 1,
    'soil-3': 1, 'soil-4': 1, 'store-silo': 1, 'store-1': 1 };

  /**
   * Ролик на сцене (кадр 04): статичный кадр p.img — постер, пока ролик
   * грузится. Создаётся один раз на заход на экран, см. sceneLayer.
   */
  function videoEl(p, vid) {
    var vv = document.createElement('video');
    vv.autoplay = true;
    vv.loop = true;
    vv.muted = true;
    vv.defaultMuted = true;
    vv.setAttribute('muted', '');       // автозапуск в некоторых браузерах смотрит на атрибут, а не на свойство
    vv.playsInline = true;
    vv.setAttribute('playsinline', '');
    vv.preload = 'auto';
    if (p && p.img) vv.poster = U.asset(p.img);         // статичный кадр виден, пока ролик не загрузился
    vv.style.pointerEvents = 'none';    // стенд сенсорный — слой видео не должен ловить касания
    var vat = vid.at || (p && p.at);
    if (vat) {
      vv.className = 'is-at';
      vv.style.left = vat[0] + 'px';
      vv.style.top = vat[1] + 'px';
      vv.style.width = vat[2] + 'px';
      vv.style.height = vat[3] + 'px';
    }
    vv.src = U.asset(vid.src);
    vv.load();
    /* play() зовём отложенно: сейчас box ещё не вставлен в документ
       (это сделает вызывающий код чуть позже), а часть браузеров
       не запускает автовоспроизведение у ролика, пока его нет в
       дереве страницы. setTimeout(0) откладывает вызов до конца
       текущего цикла отрисовки, когда сцена уже на странице. */
    setTimeout(function () {
      var playPromise = vv.play();
      if (playPromise && playPromise.catch) playPromise.catch(function () { /* автозапуск включится по касанию */ });
    }, 0);
    return vv;
  }

  function sceneLayer(scr) {
    var p = sceneFor(scr).pic || null;
    /* Виньетка: в кадрах Figma поверх сцены лежит внутренняя тень 250 px
       цвета #172d31 — она затемняет края и прячет блики по углам картинок.
       Её нет только у заставки, меню, Центра, почвы и хранения. */
    var vig = !NO_VIGNETTE[scr.id];
    var box = el('div', 'sc-scene' + (p && p.fit === 'contain' ? ' is-contain' : '') +
      (vig ? ' is-vig' : '') + (scr.grainAnim ? ' is-grain-anim' : ''));
    /* Видео на сцене (кадр 04, лабораторный скрининг): заказчик прислал
       ролик сканирования зерна вместо статичной картинки. Поле video
       задаётся в справочнике рядом с pic — { src, at }; свои координаты
       at нужны, потому что кадр ролика шире и сдвинут иначе, чем у
       статичной картинки (см. ниже про водяной знак). Если video нет —
       рисуется обычная картинка, как раньше. */
    var vid = sceneFor(scr).video || null;
    if (vid) {
      /* Правка заказчика 30.09: выбор показателя на лабораторном
         скрининге перерисовывает экран целиком, и ролик каждый раз
         начинался сначала. Поэтому элемент видео живёт в состоянии
         экрана st (оно сбрасывается только при уходе с экрана) и при
         перерисовке переставляется в новую сцену тот же самый.
         Браузер ставит ролик на паузу, лишь если к концу текущей
         задачи его так и не вернули в документ, — а draw() вставляет
         его обратно сразу, поэтому видео просто идёт дальше. */
      var vv = st.video && st.video.src === vid.src ? st.video.el : null;
      if (!vv) {
        vv = videoEl(p, vid);
        st.video = { src: vid.src, el: vv };
      }
      box.appendChild(vv);
      /* Заплатка поверх ролика: гасит вшитый в исходник водяной знак.
         Поле mask — [x, y, ширина, высота] в координатах блока сцены,
         цвет берётся из самого кадра (см. справочник). Пятно мягкое:
         в центре сплошное, к краям сходит на нет, поэтому на ровном
         тёмном фоне ролика его не видно. Появится чистый экспорт —
         достаточно убрать mask в справочнике. */
      if (vid.mask) {
        var mk = el('div', 'sc-scene-mask');
        mk.style.left = vid.mask[0] + 'px';
        mk.style.top = vid.mask[1] + 'px';
        mk.style.width = vid.mask[2] + 'px';
        mk.style.height = vid.mask[3] + 'px';
        if (vid.maskColor) {
          mk.style.background = 'radial-gradient(ellipse at center, ' +
            vid.maskColor + ' 0%, ' + vid.maskColor + ' 62%, ' +
            vid.maskColor.replace('rgb(', 'rgba(').replace(')', ', 0)') + ' 100%)';
        }
        box.appendChild(mk);
      }
    } else if (p && p.img) {
      var im = new Image();
      im.src = U.asset(p.img);
      im.alt = p.cap || '';
      if (p.at) {
        im.className = 'is-at' + (scr.grainAnim ? ' is-grain-spin' : '');
        im.style.left = p.at[0] + 'px';
        im.style.top = p.at[1] + 'px';
        im.style.width = p.at[2] + 'px';
        im.style.height = p.at[3] + 'px';
      }
      box.appendChild(im);
      /* Правка заказчика 29.09: зерно на экранах лабораторного скрининга
         и результата исследования медленно вращается вокруг оси, и по
         нему проходит полоса «сканирования» сверху вниз и обратно.
         Отдельного слоя с одним зерном в кадрах нет (весь кадр — это
         зерно в подсветке), поэтому вращается и сканируется вся картинка
         целиком — на тёмном фоне кадра это не режет глаз. Средствами
         проекта: только CSS-анимация, см. .is-grain-spin/.sc-grain-scan
         в story-theme.css, новых библиотек не добавляли. */
      if (scr.grainAnim && p.at) {
        var scan = el('div', 'sc-grain-scan');
        scan.style.left = p.at[0] + 'px';
        scan.style.top = p.at[1] + 'px';
        scan.style.width = p.at[2] + 'px';
        scan.style.height = p.at[3] + 'px';
        box.appendChild(scan);
      }
    }
    /* Предметы, лежащие на сцене отдельным слоем (беспилотник на кадре 09-c):
       координаты at — как у сцены, внутри блока 1888x1048. */
    (sceneFor(scr).objs || []).forEach(function (o) {
      var oi = new Image();
      oi.src = U.asset(o.img);
      oi.alt = o.cap || '';
      oi.className = 'is-at is-obj';
      oi.style.left = o.at[0] + 'px';
      oi.style.top = o.at[1] + 'px';
      oi.style.width = o.at[2] + 'px';
      oi.style.height = o.at[3] + 'px';
      box.appendChild(oi);
    });
    return box;
  }

  /** Шапка экрана: надзаголовок, заголовок, подзаголовок. */
  function headEl(scr) {
    var h = el('header', 'sc-head');
    if (scr.eyebrow) h.appendChild(el('div', 'sc-eyebrow', scr.eyebrow));
    if (scr.title) h.appendChild(el('h1', 'sc-title', scr.title));
    // подзаголовок может зависеть от состояния сцены (кормовой маршрут)
    var sub = scr.subByTab ? (C[scr.subByTab][tabKey()] || {}).sub : scr.sub;
    if (sub) h.appendChild(el('div', 'sc-sub' + (scr.subBig ? ' is-big' : ''), sub));
    return h;
  }

  /* ------------------- заглушка «в разработке» -------------------
     Нерабочий блок — без визуала и без данных — по правке заказчика
     от 21.09 показывается серым, с подписью «в разработке», и касания
     не ловит. Один класс .is-wip на все экраны (styles/story-theme.css):
     когда блок доделают, достаточно убрать поле wip в справочнике.

     quiet — заглушить без подписи: так помечают верхнюю часть блока,
     когда подпись уже стоит на соседней плашке под ней (переключатель
     страны и «Требования направления» на экране 21 читаются вместе). */
  function wip(node, quiet) {
    node.classList.add('is-wip');
    if (quiet) node.classList.add('is-quiet');
    node.setAttribute('aria-disabled', 'true');
    if (node.tagName === 'BUTTON') node.disabled = true;
    return node;
  }

  /** Стеклянная панель: надпись, заголовок, текст, строки, пометка. */
  function panelEl(p) {
    var n = el('section', 'sc-panel' + (p.cls ? ' ' + p.cls : ''));
    /* у части панелей в кадрах задана точная высота — она больше или
       меньше содержимого, и по ней встают соседи в колонке */
    if (p.h) n.style.height = p.h + 'px';
    if (p.cap) n.appendChild(el('div', 'sc-panel-cap', p.cap));
    if (p.title) n.appendChild(el('h3', 'sc-panel-t' + (p.small ? ' is-small' : ''), p.title));
    if (p.sub) n.appendChild(el('div', 'sc-panel-sub', p.sub));
    if (p.text) n.appendChild(el('p', 'sc-panel-p', p.text));
    if (p.big) n.appendChild(el('div', 'sc-big', p.big));
    if (p.picture) n.appendChild(shotEl({ img: p.picture, h: p.pictureHeight || 280, cap: p.title }));
    if (p.items) {
      var list = el('ul', 'sc-types');
      p.items.forEach(function (t) { list.appendChild(el('li', null, t)); });
      n.appendChild(list);
    }
    if (p.defs) {
      var df = el('div', 'sc-defs');
      p.defs.forEach(function (d) {
        var row = el('div', 'sc-def');
        row.appendChild(el('div', 'sc-def-k', d[0]));
        row.appendChild(el('div', 'sc-def-v', d[1]));
        df.appendChild(row);
      });
      n.appendChild(df);
    }
    if (p.leads) {
      p.leads.forEach(function (d) {
        var line = el('p', 'sc-lead');
        line.appendChild(el('b', null, d[0]));
        line.appendChild(document.createTextNode(' ' + d[1]));
        n.appendChild(line);
      });
    }
    /* пары «название — пояснение» столбиком: сопроводительные
       документы на экране 21 */
    if (p.leads2) {
      var lb = el('div', 'sc-leads2');
      p.leads2.forEach(function (d) {
        var row = el('div', 'sc-lead2');
        row.appendChild(el('div', 'sc-lead2-k', d[0]));
        row.appendChild(el('div', 'sc-lead2-v', d[1]));
        lb.appendChild(row);
      });
      n.appendChild(el('div', 'sc-scroll-hint', 'Прокрутите список документов ↓'));
      n.appendChild(lb);
    }
    if (p.grid) n.appendChild(gridEl(p.grid));
    if (p.slider) n.appendChild(sliderEl(
      typeof p.slider === 'string' ? SLIDERS[p.slider]() : p.slider));
    if (p.gauge) n.appendChild(gaugeEl(GAUGES[p.gauge]()));
    if (p.rows) {
      var rt = el('div', 'sc-rows');
      p.rows.forEach(function (r, i) {
        var row = el('div', 'sc-row');
        row.appendChild(el('span', 'sc-row-n', String(i + 1)));
        row.appendChild(el('span', 'sc-row-k', r[0]));
        row.appendChild(el('span', 'sc-row-v', r[1]));
        rt.appendChild(row);
      });
      n.appendChild(rt);
    }
    if (p.note) n.appendChild(el('div', 'sc-note', p.note));
    if (p.button) n.appendChild(button(p.button,
      'sc-btn sc-panel-btn' + (p.button.gold ? ' is-gold' : '')));
    if (p.wip) wip(n);
    return n;
  }

  /* Полоски долей (несоответствия за сезон) убраны вместе с экраном
     приёмки зерна — правка заказчика 21.09. */

  /** Шаги 01–03 отдельными плашками (экран контроля экспорта). */
  function stepsEl(list) {
    var box = el('div', 'sc-steps');
    list.forEach(function (s, i) {
      var row = el('div', 'sc-step' + (i === list.length - 1 ? ' is-on' : ''));
      row.appendChild(el('span', 'sc-step-n', '0' + (i + 1)));
      var t = el('div', 'sc-step-t');
      t.appendChild(el('div', 'sc-step-k', s[0]));
      t.appendChild(el('div', 'sc-step-v', s[1]));
      row.appendChild(t);
      box.appendChild(row);
    });
    return box;
  }

  /** Стеклянная карточка с одним снимком: «увеличенный фрагмент». */
  function shotEl(s) {
    var box = el('div', 'sc-shot');
    if (s.h) box.style.height = s.h + 'px';
    var im = new Image();
    im.src = U.asset(s.img);
    im.alt = s.cap || '';
    /* at — место кадра внутри карточки по выгрузке Figma:
       [слева, сверху, ширина, высота]. Без него снимок просто
       обрезается по центру. */
    if (s.at) {
      im.className = 'is-at';
      im.style.left = s.at[0] + 'px';
      im.style.top = s.at[1] + 'px';
      im.style.width = s.at[2] + 'px';
      im.style.height = s.at[3] + 'px';
    }
    box.appendChild(im);
    return box;
  }

  /** Плитка со значением: «Жир 3,2 %» на кормовом маршруте. */
  function statEl(s) {
    var n = el('div', 'sc-stat');
    n.appendChild(el('div', 'sc-stat-k', s.name));
    var v = el('div', 'sc-stat-v', s.value);
    v.appendChild(el('span', 'sc-stat-u', s.unit));
    n.appendChild(v);
    if (s.note) n.appendChild(el('div', 'sc-stat-note', s.note));
    if (s.wip) wip(n);
    return n;
  }

  /* ВНИМАНИЕ: по правке 21.09 ползунки убрали со всех плашек, а потом
     заказчик попросил вернуть один — концентрацию элемента на экране
     почвы (05). Он и стоит: поле slider там задано снова. Ползунки
     продовольственного маршрута («Измените качество муки» и такие же
     на соседних вкладках) заказчик убрал осознанно — не возвращать. */

  /**
   * Переключатель из двух-трёх сегментов внутри панели: «До / После».
   * Выбранный сегмент светлее, золото по киту тут не используется.
   * Сейчас ни один экран его не показывает (он стоял на последнем шаге
   * подготовки зернохранилища, снятом с маршрута 21.09) — деталь
   * оставлена в движке на случай, если переключатель попросят вернуть.
   */
  function toggleEl(t) {
    var box = el('div', 'sc-toggle');
    t.items.forEach(function (label, i) {
      var b = el('button', 'sc-toggle-b' + (i === t.at ? ' is-on' : ''), label);
      b.type = 'button';
      b.addEventListener('click', function () { resetIdle(); t.on(i); });
      box.appendChild(b);
    });
    return box;
  }

  /**
   * Выпадающий выбор страны: плашка с названием и золотая круглая
   * кнопка-стрелка. Список раскрывается по касанию любой из двух.
   */
  function selectEl(name) {
    var list = C[name];
    var box = el('div', 'sc-select' + (st.open ? ' is-open' : ''));
    var cur2 = find(list, selKey());

    var head = el('button', 'sc-select-head', cur2.name);
    head.type = 'button';
    var arrow = el('button', 'sc-select-go');
    arrow.type = 'button';
    /* стрелка «раскрыть» нарисована уголком: в шрифте нужного знака нет */
    arrow.appendChild(el('i'));
    function toggle() { resetIdle(); st.open = !st.open; rerender(); }
    head.addEventListener('click', toggle);
    arrow.addEventListener('click', toggle);
    box.appendChild(head);
    box.appendChild(arrow);

    if (st.open) {
      var menu = el('div', 'sc-select-menu');
      list.forEach(function (it) {
        var b = el('button', 'sc-select-i' + (it.key === cur2.key ? ' is-on' : ''),
          it.name);
        b.type = 'button';
        b.addEventListener('click', function () {
          resetIdle();
          st.sel = it.key;
          st.open = false;
          rerender();
        });
        menu.appendChild(b);
      });
      box.appendChild(menu);
    }
    return box;
  }

  /* =================================================================
     Общие детали новой раскладки

     Плитка-кнопка, ползунок, шкала показателя, плашка-статус,
     карточки-картинки, радио-метка. Все они собираются из описания
     в справочнике; ручной разметки в HTML нет нигде.
     ================================================================= */

  /* Иконки плиток — svg из выгрузки Figma. Пути пишутся целиком:
     tools/build_dist.py ищет в коде готовые строки «assets/…»,
     склейка из кусков ему не видна. */
  var ICONS = {
    science: 'assets/concept/svg/ico-science.svg',
    mushroom: 'assets/concept/svg/ico-mushroom.svg',
    drop: 'assets/concept/svg/ico-drop.svg',
    eco: 'assets/concept/svg/ico-eco.svg',
    ant: 'assets/concept/svg/ico-ant.svg',
    /* Экран 9, кадр 08c: сетка карточек сорняков — готовые PNG
       с прозрачным фоном (белый штриховой рисунок), а не svg из общей
       выгрузки, поэтому лежат в assets/photos/concept, не в svg/. */
    weedAmbrosia: 'assets/photos/concept/weed-icon-ambrosia.png',
    weedBorshchevik: 'assets/photos/concept/weed-icon-borshchevik.png',
    weedGorchak: 'assets/photos/concept/weed-icon-gorchak.png',
    weedPovilika: 'assets/photos/concept/weed-icon-povilika.png'
  };

  function iconEl(name) {
    var box = el('span', 'sc-pick-ico');
    if (!ICONS[name]) return box;
    var im = new Image();
    im.src = U.asset(ICONS[name]);
    im.alt = '';
    box.appendChild(im);
    return box;
  }

  /**
   * Сетка плиток-кнопок.
   *   src     имя списка в справочнике (C[src]);
   *   cols    сколько столбцов; gap — зазор, если он не 16;
   *   mid     подпись по центру, ico — с иконкой, tall — высокая плитка;
   *   noClick — блок некликабельный (правка заказчика 29.09, экран
   *             «Направления исследования» на 07): плитки остаются
   *             видимыми и сохраняют вид выбранной по умолчанию, но
   *             касания не ловят и выбор не меняют.
   * Плитка выбирается касанием, выбор живёт в st.sel.
   */
  function gridEl(g) {
    var box = el('div', 'sc-grid' + (g.mid ? ' is-mid' : '') +
      (g.ico ? ' is-ico' : '') + (g.tall ? ' is-tall' : ''));
    /* minmax(0, 1fr), а не 1fr: иначе длинное слово («Кобальт», «Кадмий»)
       раздувает свой столбец, плитки перестают быть равными и вылезают
       за отступ панели. В макетах столбцы всегда равной ширины. */
    box.style.gridTemplateColumns = 'repeat(' + (g.cols || 3) + ', minmax(0, 1fr))';
    if (g.gap != null) box.style.gap = g.gap + 'px';
    (C[g.src] || []).forEach(function (it) {
      var b = el('button', 'sc-pick' + (selKey() === it.key ? ' is-on' : ''));
      b.type = 'button';
      if (it.span) b.style.gridColumn = '1 / -1';
      if (it.icon) b.appendChild(iconEl(it.icon));
      b.appendChild(el('span', null, it.name));
      if (g.noClick) {
        // «некликабельный» здесь значит именно это: касание не ловим,
        // но внешний вид не трогаем — поэтому не b.disabled (в паре
        // браузеров он приглушает даже кастомно раскрашенную кнопку),
        // а просто не вешаем обработчик
        b.style.cursor = 'default';
        b.setAttribute('aria-disabled', 'true');
        b.tabIndex = -1;
      } else {
        b.addEventListener('click', function () {
          resetIdle();
          st.sel = it.key;
          if (PICKED[cur.id]) PICKED[cur.id]();
          rerender();
        });
      }
      box.appendChild(b);
    });
    return box;
  }

  /**
   * Ползунок кита: подпись слева, единица справа, тонкая дорожка
   * с круглой ручкой, подписи «Минимум/Максимум» под ней.
   * Значение — доля 0…1; тянут за прозрачный системный ползунок.
   */
  var STEPS = 1000;

  function sliderEl(s) {
    var box = el('div', 'sc-slider' + (s.wide ? ' is-wide' : ''));
    var top = el('div', 'sc-slider-top');
    top.appendChild(el('span', null, s.label));
    var unit = el('span', 'sc-slider-unit', s.unit || '');
    top.appendChild(unit);
    box.appendChild(top);

    var track = el('div', 'sc-track');
    track.appendChild(el('div', 'sc-rail'));
    var fill = el('div', 'sc-fill');
    var knob = el('div', 'sc-knob');
    track.appendChild(fill);
    track.appendChild(knob);
    var input = el('input', 'sc-range');
    input.type = 'range';
    input.min = 0;
    input.max = STEPS;
    input.step = 1;
    input.value = Math.round(s.value * STEPS);
    track.appendChild(input);
    box.appendChild(track);

    /* Подписи под дорожкой: две по краям или три-четыре по делениям —
       в макетах продовольственного маршрута их три. */
    var labels = s.marks || [s.left || 'Минимум', s.right || 'Максимум'];
    var ends = el('div', 'sc-ends');
    var marks = labels.map(function (t) {
      var n = el('span', null, t);
      ends.appendChild(n);
      return n;
    });
    box.appendChild(ends);

    function put() {
      var part = input.value / STEPS;
      var p = part * 100;
      fill.style.width = p + '%';
      knob.style.left = p + '%';
      if (marks.length > 2) {
        var at = Math.round(part * (marks.length - 1));
        marks.forEach(function (n, i) { n.classList.toggle('is-on', i === at); });
      }
    }
    input.addEventListener('input', function () {
      resetIdle();
      put();
      var t = s.on && s.on(input.value / STEPS);
      if (t) unit.textContent = t;
    });
    put();
    return box;
  }

  /**
   * Шкала показателя: символ элемента крупно, рядом формула, под ними
   * дорожка — зелёная зона до норматива, красная за ним, ручка на
   * текущем значении.
   */
  function gaugeEl(g) {
    var box = el('div', 'sc-gauge' + (g.bad ? ' is-bad' : ''));
    var head = el('div', 'sc-gauge-head');
    head.appendChild(el('span', 'sc-gauge-sym', g.sym));
    head.appendChild(el('span', 'sc-gauge-f', g.formula));
    box.appendChild(head);

    var track = el('div', 'sc-track');
    var rail = el('div', 'sc-rail');
    var m = Math.round(g.mark * 100);
    rail.style.background = 'linear-gradient(90deg, var(--sc-ok) 0 ' + m +
      '%, var(--sc-bad) ' + m + '% 100%)';
    track.appendChild(rail);
    var knob = el('div', 'sc-knob');
    knob.style.left = Math.round(g.at * 100) + '%';
    track.appendChild(knob);
    box.appendChild(track);

    var ends = el('div', 'sc-ends');
    ends.appendChild(el('span', null, g.left));
    ends.appendChild(el('span', null, g.right));
    box.appendChild(ends);
    /* шкалу и ручку двигает ползунок концентрации на экране 05,
       поэтому запоминаем их — см. soilRefresh */
    st.gauge = box;
    st.gaugeKnob = knob;
    return box;
  }

  /** Плашка-статус: зелёная — всё в норме, красноватая — превышение. */
  function statusEl(s) {
    var kind = s.bad ? ' is-bad' : (s.warn ? ' is-warn' : '');
    var n = el('div', 'sc-status' + kind + (s.dot ? ' is-dot' : ''));
    if (s.dot) n.appendChild(el('span', 'sc-status-m', ''));
    /* Знак стоит в самой строке, а не отдельной колонкой: в кадре 05
       вторая строка начинается от края панели, а не под текстом. */
    n.appendChild(el('span', null, s.dot ? s.text : (s.bad ? '! ' : '✓ ') + s.text));
    st.status = n;
    return n;
  }

  /** Карточки-картинки с галочкой у выбранной. */
  function picksEl(p) {
    var box = el('div', 'sc-cards2');
    (C[p.src] || []).forEach(function (it) {
      var on = selKey() === it.key;
      var b = el('button', 'sc-card2' + (on ? ' is-on' : ''));
      b.type = 'button';
      var ph = el('div', 'sc-card2-pic');
      var im = new Image();
      im.src = U.asset(it.img);
      im.alt = it.name;
      ph.appendChild(im);
      b.appendChild(ph);
      b.appendChild(el('div', 'sc-card2-name', it.label || it.name));
      if (on) b.appendChild(el('span', 'sc-card2-ok', '✓'));
      // заглушённую карточку не выбирают: она серая и не ловит касания
      if (it.wip) wip(b);
      else b.addEventListener('click', function () {
        resetIdle();
        st.sel = it.key;
        if (PICKED[cur.id]) PICKED[cur.id]();
        rerender();
      });
      box.appendChild(b);
    });
    return box;
  }

  /** Радио-метки прямо на объектах сцены (экран 8). */
  function radiosEl(scr, root) {
    scr.radios.forEach(function (r) {
      var b = el('button', 'sc-radio' + (selKey() === r.key ? ' is-on' : ''));
      b.type = 'button';
      b.style.left = r.x + 'px';
      b.style.top = r.y + 'px';
      b.appendChild(el('span', 'sc-radio-d'));
      b.appendChild(el('span', null, r.label));
      b.addEventListener('click', function () {
        resetIdle();
        st.sel = r.key;
        rerender();
      });
      root.appendChild(b);
    });
  }

  /** Картинка сцены, поставленная по координатам кадра. */
  function figsEl(scr, root) {
    scr.figs.forEach(function (f) {
      var n = el('div', 'sc-fig');
      n.style.left = f.at[0] + 'px';
      n.style.top = f.at[1] + 'px';
      n.style.width = f.at[2] + 'px';
      n.style.height = f.at[3] + 'px';
      var im = new Image();
      im.src = U.asset(f.img);
      im.alt = f.cap || '';
      n.appendChild(im);
      root.appendChild(n);
    });
  }

  /** Кнопка действия на экране фитосанитарного мониторинга. */
  function weedBtn(label, action, on) {
    var b = button({ label: label, action: action },
      'sc-btn' + (on ? ' is-gold-on' : ' is-gold'));
    if (cur.tabsWip) wip(b);
    return b;
  }

  /** Мелкие подписи прямо на сцене; count — счётчик найденных сорняков. */
  function capsEl(scr, root) {
    scr.caps.forEach(function (c) {
      var n = el('div', 'sc-cap' + (c.count ? ' sc-count' : ''), c.text || '');
      n.style.left = c.x + 'px';
      n.style.top = c.y + 'px';
      if (c.w) n.style.width = c.w + 'px';
      if (c.right) n.style.textAlign = 'right';
      if (c.center) n.style.textAlign = 'center';
      if (c.count) {
        st.countEl = n;
        // в макете счётчика нет: показываем его после первой находки
        n.style.display = 'none';
      }
      root.appendChild(n);
    });
  }

  /**
   * Шторка сравнения на предметном снимке (экран 7, зерно).
   *
   * Снизу лежит кадр «с внешними повреждениями», сверху — «здоровое»
   * состояние, обрезанное по ручке. Ручку тянут пальцем или мышью;
   * доля запоминается в st.wipe, чтобы перерисовка экрана её не сбила.
   *
   * Нижний слой обрезается с другой стороны. У зерна это ничего не
   * меняет (верхний кадр непрозрачный и нижний закрывает сам), а на
   * мелиорации и рекультивации оба слоя — участки на прозрачном фоне
   * поверх общей сцены: без обрезки края «после» проступали бы слева
   * там, где участок «до» ниже или уже.
   */
  function curtainEl(scr, root) {
    var c = scr.curtain;
    if (st.wipe == null) st.wipe = c.x;

    var box = el('div', 'sc-fig sc-curtain');
    box.style.left = c.at[0] + 'px';
    box.style.top = c.at[1] + 'px';
    box.style.width = c.at[2] + 'px';
    box.style.height = c.at[3] + 'px';

    var base = el('div', 'sc-curtain-l');
    var im = new Image();
    im.src = U.asset(c.img);
    im.alt = c.cap || '';
    base.appendChild(im);
    box.appendChild(base);

    /* Верхний слой. Кадра здорового зерна дизайнеры не давали:
       пока там рамка-заглушка того же размера. */
    var top = el('div', 'sc-curtain-l is-top');
    if (c.top.img) {
      var im2 = new Image();
      im2.src = U.asset(c.top.img);
      im2.alt = c.top.cap || '';
      if (c.top.at) {
        im2.className = 'is-at';
        im2.style.left = c.top.at[0] + 'px';
        im2.style.top = c.top.at[1] + 'px';
        im2.style.width = c.top.at[2] + 'px';
        im2.style.height = c.top.at[3] + 'px';
      }
      top.appendChild(im2);
    } else {
      top.classList.add('is-stub');
      top.appendChild(el('span', null, c.top.cap));
    }
    box.appendChild(top);
    root.appendChild(box);

    var line = el('div', 'sc-split');
    line.style.top = c.y + 'px';
    line.style.height = c.h + 'px';
    var knob = el('i', null, '◄ ►');
    knob.style.top = c.knob + 'px';
    line.appendChild(knob);
    root.appendChild(line);

    function put(p) {
      st.wipe = U.clamp(p, 6, 94);
      top.style.clipPath = 'inset(0 ' + (100 - st.wipe) + '% 0 0)';
      top.style.webkitClipPath = top.style.clipPath;
      base.style.clipPath = 'inset(0 0 0 ' + st.wipe + '%)';
      base.style.webkitClipPath = base.style.clipPath;
      line.style.left = (c.at[0] + c.at[2] * st.wipe / 100) + 'px';
    }
    put(st.wipe);

    /* Тянуть можно за всю картинку: на сенсорной панели попасть
       в тонкую линию пальцем неудобно. */
    var down = false;
    function at(e) {
      var r = box.getBoundingClientRect();
      put((e.clientX - r.left) / r.width * 100);
    }
    box.addEventListener('pointerdown', function (e) {
      down = true; box.setPointerCapture(e.pointerId); at(e); resetIdle();
    });
    box.addEventListener('pointermove', function (e) { if (down) at(e); });
    box.addEventListener('pointerup', function () { down = false; });
    box.addEventListener('pointercancel', function () { down = false; });
  }

  /**
   * Цели-сорняки поверх сцены. Пока не нашли — прозрачные, по касанию
   * появляется кольцо и подпись. Обзор с БПЛА последовательно отмечает найденные растения.
   *
   * total — число целей в текущей сцене.
   */
  function weedsEl(marks, root, total) {
    if (!st.found) st.found = {};
    st.weedEls = [];
    marks.forEach(function (m, i) {
      var b = el('button', 'sc-weed' + (st.found[i] ? ' is-found' : ''));
      b.type = 'button';
      b.style.left = m.x + 'px';
      b.style.top = m.y + 'px';
      b.appendChild(el('i'));
      b.appendChild(el('b', null, 'Сорняк'));
      b.addEventListener('click', function () {
        resetIdle();
        st.found[i] = true;
        b.classList.add('is-found');
        if (st.countEl) countWeeds(marks.length, total);
        showWeed('ambrosia');
      });
      st.weedEls.push(b);
      root.appendChild(b);
    });
    if (st.countEl) countWeeds(marks.length, total);
  }

  function showWeed(key) {
    if (st.over) st.over.remove();
    var w = find(C.weedCards, key);
    var over = el('div', 'sc-over');
    var panel = panelEl({ title: w.name, picture: w.img, pictureHeight: 410, text: w.text, cls: 'is-weed-detail' });
    panel.classList.add('sc-over-panel');
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', w.name);
    var close = button({ label: 'Закрыть', action: 'closeOver' }, 'sc-btn');
    panel.appendChild(close); over.appendChild(panel); $('view').appendChild(over);
    st.over = over; close.focus();
    over.addEventListener('click', function (e) { if (e.target === over) ACTIONS.closeOver(); });
    over.addEventListener('keydown', function (e) { if (e.key === 'Escape') ACTIONS.closeOver(); });
  }

  function countWeeds(available, total) {
    total = total || available;
    var n = 0;
    for (var k in st.found) if (st.found[k]) n++;
    /* все найдены, но по условию их должно быть больше: реакция —
       не «баг», а явная подсказка, что поле обследовано не до конца */
    var short = n >= available && n < total;
    st.countEl.style.display = n ? '' : 'none';
    st.countEl.textContent = short
      ? 'Найдено ' + n + ' из ' + total + ' — похоже, поле обследовано не до конца'
      : 'Найдено ' + n + ' из ' + total;
    st.countEl.classList.toggle('is-done', n === total);
    st.countEl.classList.toggle('is-partial', short);
  }

  /** Плавающие блоки по координатам кадра: панель, кнопки, сетка. */
  function boxesEl(scr, root) {
    scr.boxes.forEach(function (b) {
      if (scr.id === 'seed-3' && tabKey() === 'iso' && !b.items.some(function (it) { return it.dyn === 'weedBtnDrone'; })) return;
      var n = el('div', 'sc-box' + (b.row ? ' is-row' : ''));
      n.style.left = b.at[0] + 'px';
      n.style.top = b.at[1] + 'px';
      n.style.width = b.at[2] + 'px';
      if (b.at[3]) n.style.height = b.at[3] + 'px';
      if (b.gap != null) n.style.gap = b.gap + 'px';
      (b.items || []).forEach(function (item) { n.appendChild(slotEl(item)); });
      root.appendChild(n);
    });
  }

  /* -------------------- станция 4: силос и ангар --------------------
     Правка заказчика 30.09, кадры раздела 623:3511. Меню разделов
     слева, золотая кнопка шага, подсказки и «горячие» места на ангаре.
     Всё собирается по текущему шагу из C.flows (см. story-content.js). */

  /** Меню разделов: текущий подсвечен, пройденные — с галочкой
      (у силоса галочек в кадрах нет, поле ticks). Касание открывает
      первый шаг раздела. */
  function flowMenuEl() {
    var f = flow();
    var step = flowStep();
    var passed = true;                   // разделы до текущего пройдены
    var box = el('nav', 'sc-menu');
    f.menu.forEach(function (m) {
      if (m.key === step.sec) passed = false;
      var on = m.key === step.sec && !step.done;
      var done = f.ticks && (step.done || passed);  // на последнем шаге пройдены все
      var b = el('button', 'sc-menu-i' + (on ? ' is-on' : '') +
        (done ? ' is-done' : ''));
      b.type = 'button';
      var t = el('div', 'sc-menu-t');
      t.appendChild(el('div', 'sc-menu-k', m.name));
      t.appendChild(el('div', 'sc-menu-v', m.sub));
      b.appendChild(t);
      if (done) b.appendChild(el('span', 'sc-menu-ok', '✓'));
      b.addEventListener('click', function () {
        resetIdle();
        goStep(m.from);
      });
      box.appendChild(b);
    });
    return box;
  }

  /** Переход к шагу n: состояние прежнего шага сбрасывается. */
  function goStep(n) {
    st.sel = String(n);
    st.spot = null;
    st.done = false;
    st.before = false;
    st.itemAt = null;
    rerender();
  }

  /** Сцена ангара: метка, подсветки, таблетка, «горячие» места, плашка. */
  function storeOverlay(root) {
    var step = flowStep();
    /* метка в кадре 623:3512 — две плашки голубого стекла: номер
       60x64 и название 302x77 справа от него, с зазором 6 */
    if (step.marker) {
      var mn = el('div', 'sc-focus', String(step.marker.n));
      mn.style.left = step.marker.x + 'px';
      mn.style.top = step.marker.y + 'px';
      root.appendChild(mn);
      var mt = el('div', 'sc-focus is-wide', step.marker.label);
      mt.style.left = (step.marker.x + 66) + 'px';
      mt.style.top = step.marker.y + 'px';
      root.appendChild(mt);
    }
    /* Подсветки пола, решётки и поток воздуха дизайнеры отдали
       отдельными svg — кладём их по координатам кадра. Подсветка
       пола гаснет, когда препарат уже на месте. */
    (step.marks || []).forEach(function (mk) {
      if (step.item && st.done) return;
      var n = el('div', 'sc-mark');
      place(n, mk.at);
      var im = new Image();
      im.src = U.asset(mk.img);
      im.alt = '';
      n.appendChild(im);
      root.appendChild(n);
    });
    (step.spots || []).forEach(function (sp) {
      var b = el('button', 'sc-spot' + (st.done ? ' is-on' : ''));
      b.type = 'button';
      place(b, sp.at);
      b.addEventListener('click', function () { resetIdle(); ACTIONS.storeSpot(sp.key); });
      root.appendChild(b);
    });
    if (step.floor) floorEl(step, root);
    if (step.item) itemEl(step, root);
    if (step.chip) {
      var c = el('div', 'sc-chip', st.done ? step.chip.done : step.chip.text);
      c.style.left = step.chip.at[0] + 'px';
      c.style.top = step.chip.at[1] + 'px';
      root.appendChild(c);
    }
  }

  function place(n, at) {
    n.style.left = at[0] + 'px';
    n.style.top = at[1] + 'px';
    n.style.width = at[2] + 'px';
    n.style.height = at[3] + 'px';
  }

  /** Пол ангара: второе касание после выбора таблетки кладёт её сюда. */
  function floorEl(step, root) {
    var f = el('button', 'sc-spot is-floor');
    f.type = 'button';
    place(f, step.floor);
    st.floorEl = f;
    f.addEventListener('click', function (e) {
      resetIdle();
      if (st.spot !== 'item' || st.done) return;
      st.itemAt = dropAt(e.clientX, e.clientY, step);
      st.done = true;
      st.spot = null;
      rerender();
    });
    root.appendChild(f);
  }

  /**
   * Таблетка препарата (кадр 623:3644, «Перенесите предмет сюда»).
   * Её можно перетащить пальцем на подсвеченный пол, а можно двумя
   * касаниями: таблетка, затем пол — так написано в пояснении справа.
   * Отпущенная мимо пола, таблетка возвращается на место.
   */
  function itemEl(step, root) {
    var at = step.item.at;
    var n = el('div', 'sc-item' + (st.spot === 'item' ? ' is-on' : '') +
      (st.done ? ' is-placed' : ''));
    var pos = st.itemAt || [at[0], at[1]];
    place(n, [pos[0], pos[1], at[2], at[3]]);
    var im = new Image();
    im.src = U.asset(step.item.img);
    im.alt = 'Таблетка препарата';
    n.appendChild(im);
    root.appendChild(n);
    if (st.done) return;

    var drag = null;
    n.addEventListener('pointerdown', function (e) {
      resetIdle();
      n.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, moved: false, k: viewScale() };
    });
    n.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var dx = (e.clientX - drag.x) / drag.k;
      var dy = (e.clientY - drag.y) / drag.k;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 8) return;
      drag.moved = true;
      n.classList.add('is-drag');
      n.style.transform = 'translate(' + dx + 'px, ' + dy + 'px) rotate(-12.92deg)';
    });
    function up(e, cancel) {
      if (!drag) return;
      var moved = drag.moved;
      drag = null;
      n.classList.remove('is-drag');
      if (!moved) {                      // простое касание: выбрать / снять выбор
        st.spot = st.spot === 'item' ? null : 'item';
        rerender();
        return;
      }
      if (!cancel && overFloor(e.clientX, e.clientY)) {
        st.itemAt = dropAt(e.clientX, e.clientY, step);
        st.done = true;
        st.spot = null;
        rerender();
        return;
      }
      n.style.transform = '';            // мимо пола — назад на место
    }
    n.addEventListener('pointerup', function (e) { up(e, false); });
    n.addEventListener('pointercancel', function (e) { up(e, true); });
  }

  /** Во сколько раз экран 1920x1080 ужат или растянут в окне. */
  function viewScale() {
    var r = $('view').getBoundingClientRect();
    return r.width / 1920 || 1;
  }

  function overFloor(x, y) {
    if (!st.floorEl) return false;
    var r = st.floorEl.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  /** Куда лечь таблетке: центр карточки — под пальцем, в пределах пола. */
  function dropAt(x, y, step) {
    var r = $('view').getBoundingClientRect();
    var k = viewScale();
    var f = step.floor, w = step.item.at[2], h = step.item.at[3];
    var cx = U.clamp((x - r.left) / k, f[0] + w / 2, f[0] + f[2] - w / 2);
    var cy = U.clamp((y - r.top) / k, f[1] + h / 2, f[1] + f[3] - h / 2);
    return [Math.round(cx - w / 2), Math.round(cy - h / 2)];
  }

  /** Метки-чипы кормового маршрута: выбор меняет карточку справа. */
  function feedOverlay(root) {
    var s = feedState();
    var sel = st.sel != null ? st.sel : s.sel;
    s.marks.forEach(function (m) {
      var b = el(tabKey() === 'feed' ? 'div' : 'button', 'sc-marker sc-marker-prod sc-marker-feed' +
        (sel === m.key ? ' is-on' : ''));
      b.type = 'button';
      b.style.left = m.x + 'px';
      b.style.top = m.y + 'px';
      b.appendChild(el('span', 'sc-marker-t', m.label));
      if (tabKey() !== 'feed') b.addEventListener('click', function () { resetIdle(); st.sel = m.key; rerender(); });
      else b.classList.add('is-static');
      root.appendChild(b);
    });
  }

  function technicalOverlay(root) {
    var drawings = {
      biofuel: '<ellipse cx="180" cy="95" rx="95" ry="28"/><path d="M85 95v215c0 38 190 38 190 0V95M85 170c0 38 190 38 190 0M85 240c0 38 190 38 190 0"/><path d="M325 115c-90 90-90 160 0 160s90-70 0-160Z"/>',
      polymer: '<path d="M85 125h240l-20 220H105Z"/><path d="M130 125V95c0-70 150-70 150 0v30"/><path d="M155 215q100-100 125-15q-15 80-100 65M155 285l105-75"/>',
      textile: '<path d="M60 75h300v285H60Z"/><path d="M95 75v285M135 75v285M175 75v285M215 75v285M255 75v285M295 75v285M60 110h300M60 150h300M60 190h300M60 230h300M60 270h300M60 310h300"/>'
    };
    var figure = el('div', 'sc-tech-figure');
    figure.innerHTML = '<svg viewBox="0 0 420 420" aria-hidden="true">' + drawings[tabKey()] + '</svg>';
    figure.appendChild(el('div', 'sc-tech-caption', find(C.technical, tabKey()).name));
    root.appendChild(figure);
  }
  var OVERLAYS = { store: storeOverlay, feed: feedOverlay, technical: technicalOverlay };

  /**
   * Три карточки маршрута во всю высоту экрана (кадр 15). У каждой
   * своя золотая кнопка: так в макете, правило «одна золотая кнопка
   * на экран» здесь не действует.
   */
  function picks3El(name) {
    var box = el('div', 'sc-picks3');
    C[name].forEach(function (r) {
      var card = el('section', 'sc-pick3');
      card.appendChild(el('h3', 'sc-pick3-t', r.title));
      card.appendChild(el('p', 'sc-pick3-p', r.text));
      var ph = el('div', 'sc-pick3-pic');
      var im = new Image();
      im.src = U.asset(r.img);
      im.alt = r.title;
      ph.appendChild(im);
      card.appendChild(ph);
      var go2 = button({ label: 'Выбрать маршрут', to: r.to }, 'sc-btn is-gold');
      if (r.wip) go2.disabled = true;
      card.appendChild(go2);
      // карточка «в разработке»: серая, кнопка маршрута не нажимается
      if (r.wip) wip(card);
      box.appendChild(card);
    });
    return box;
  }

  /* Блоки, которые зависят от выбора на экране: тексты всё равно лежат
     в справочнике, здесь только сборка. */
  var SLOTS = {
    /** Центр: панель «Об этапе» — про выбранную метку. */
    station: function () {
      var s = find(C.stations, selKey());
      return panelEl({ title: 'Об этапе', text: s.hint });
    },
    /** Центр: золотая кнопка «Начать с почвы →» / «Открыть станцию →». */
    stationBtn: function () {
      var s = find(C.stations, selKey());
      var first = C.stations[0];
      return button({ label: s.key === first.key ? 'Начать с почвы →' : 'Открыть станцию →',
        to: s.to }, 'sc-btn is-gold');
    },

    /* --- экран 5: плашка «превышения нет» / «превышение порога» --- */
    soilStatus: function () {
      var over = soilLevel() > C.soilMark;
      return statusEl({ bad: over, text: over ? C.soilStatus.bad : C.soilStatus.ok });
    },

    /* --- экран 6: доза удобрения --- */
    fertilizerAbout: function () {
      var f = find(C.fertilizers, selKey());
      return panelEl({ title: f.name, text: f.text });
    },

    /* --- экран 7: панель слева с пояснением выбранного направления.
           В макете пояснений нет, но плитки должны на что-то отвечать:
           текст встаёт в ту же панель «Лабораторная проверка». --- */
    seedCheck: function () {
      var c = find(C.seedChecks, selKey());
      return panelEl({
        title: 'Лабораторная проверка',
        sub: 'Помогает убедиться в качестве\nпосевного материала',
        text: c.name + '. ' + c.text
      });
    },

    /* --- экран 8: карточка выбранной области поля --- */
    seedZone: function () {
      var z = find(C.seedZones, selKey());
      return panelEl({ title: z.title, text: z.text });
    },

    /* --- экран 11: карточка выбранного показателя --- */
    grainIndicator: function () {
      var i = find(C.grainIndicators, selKey());
      return panelEl({ title: i.name, text: i.text });
    },

    /* --- экран 9: две кнопки под подсказкой. Золотая — та, которой
           стоит воспользоваться дальше; вторая стеклянная. --- */
    /* На изометрии обе кнопки золотые — так в кадре. Нажатая кнопка
       остаётся пилюлей, но золото приглушается (#79623e, как в кадре):
       видно, какое состояние сейчас открыто. */
    /* Экран открывается заросшим полем (кадр photo), поэтому
       «Посмотреть самостоятельно» переводит на изометрию, где сорняки
       ищут касанием, и обратно.

       Пока у экрана стоит tabsWip, обе кнопки серые, с подписью
       «в разработке», и касания не ловят. */
    weedBtnSelf: function () {
      var on = tabKey() === 'iso';
      // правка заказчика 30.09 (кадр 08b): нажатая подпись — «Смотрим»
      return weedBtn(on ? 'Смотрим' : 'Посмотреть самостоятельно',
        'weedSelf', on);
    },
    weedBtnDrone: function () {
      var on = tabKey() === 'drone';
      return weedBtn(on ? (st.scanning ? 'Обследование поля…' : 'Обзор завершён') : 'Запустить обзор с БПЛА',
        'weedDrone', on);
    },

    /* --- экран 9, кадр 08c: сетка 2x2 карточек сорняков под панелью
           «Зачем это нужно», только в состоянии drone --- */
    weedCardsGrid: function () {
      if (tabKey() !== 'drone') return null;
      var box = el('div', 'sc-grid is-ico');
      box.style.gridTemplateColumns = 'repeat(2, minmax(0, 1fr))';
      C.weedCards.forEach(function (w) {
        var b = el('button', 'sc-pick'); b.type = 'button';
        b.appendChild(iconEl(w.icon)); b.appendChild(el('span', null, w.name));
        b.addEventListener('click', function () { resetIdle(); showWeed(w.key); });
        box.appendChild(b);
      });
      /* в кадре сетка уже колонки (426 px против 514 у панели выше) и
         стоит вплотную к правому краю — своя ширина плюс выравнивание
         по правому краю флекс-колонки (сама колонка растягивает детей
         на всю ширину по умолчанию, см. .sc-col в story.css) */
      box.style.width = '426px';
      box.style.alignSelf = 'flex-end';
      return box;
    },

    /* --- станция 4: силос и ангар, шаги из C.flows --- */

    flowHead: function () {
      var s = flowStep();
      return panelEl({ title: s.title, sub: s.sub });
    },
    flowMenu: function () { return flowMenuEl(); },
    /** Золотая кнопка шага. На последнем шаге ангара она переключает
        «до / после обработки»; у чистого силоса её нет вовсе. */
    flowBtn: function () {
      var s = flowStep();
      if (!s.btn) return el('div');
      var label = (st.before && s.btnBack) ? s.btnBack : s.btn;
      return button({ label: label, action: 'flowNext' }, 'sc-btn is-gold');
    },
    flowCard: function () {
      var s = flowStep();
      return panelEl({ cap: s.cap,
        title: st.before && s.cardBefore ? s.cardBefore : s.card,
        text: s.text });
    },
    flowShot: function () {
      var s = flowStep();
      var sh = st.before && s.shotBefore ? s.shotBefore : s.shot;
      return sh ? shotEl(sh) : el('div');
    },
    /** Под снимком: плашка-статус или пояснение. */
    flowFoot: function () {
      var s = flowStep();
      if (s.status) {
        var ok = st.done && s.status.done;
        return statusEl({ dot: true, warn: s.status.warn && !ok,
          text: ok ? s.status.done : s.status.text });
      }
      if (!s.note) return el('div');
      /* не is-note: этим классом помечены служебные пометки, стенд
         прячет их (util.js), и пояснение пропадало вместе с ними */
      return panelEl({ text: s.note, cls: 'is-foot' });
    },

    /* --- экран 16: продовольственный маршрут --- */

    foodAbout: function () {
      var f = foodTab();
      return panelEl({ title: f.title, text: f.text });
    },
    foodTypes: function () {
      var f = foodTab();
      if (!f.types) return null;
      var titles = { flour: 'Виды исследуемой муки', groats: 'Виды исследуемых круп', oil: 'Виды исследуемого масла' };
      return panelEl({ title: titles[f.key], items: f.types, cls: 'is-types' });
    },
    technicalAbout: function () {
      var t = find(C.technical, tabKey());
      return panelEl({ cap: 'Прокрутите, чтобы прочитать полностью ↓', title: t.name, text: t.text, cls: 'is-technical' });
    },
    foodCheck: function () {
      var f = foodTab();
      return panelEl({ title: 'Что оценивают', text: f.check });
    },
    /* ползунок «Измените качество муки» и его собратья на других
       вкладках убраны по правке 21.09 */
    foodNext: function () {
      var f = foodTab();
      return button(f.next.to ? { label: f.next.label, to: f.next.to }
        : { label: f.next.label, action: 'foodNext' }, 'sc-btn');
    },

    /* --- экран 17: кормовой маршрут, два состояния --- */

    feedAbout: function () {
      var s = feedState();
      return panelEl({ title: s.title, text: s.text });
    },
    /* Проверки кормов, молока и мяса: тексты из замечаний 30.09. */
    feedCheck: function () {
      var s = feedState();
      var animal = tabKey() === 'animal';
      var key = st.sel || 'milk';
      return panelEl({ title: animal ? 'Что проверяют · ' + (key === 'meat' ? 'мясо' : 'молоко') : 'Что проверяют',
        text: animal ? C.animalChecks[key] : C.feedCheck, cls: 'is-feed-check' });
    },
    feedStats: function () {
      var row = el('div', 'sc-stats');
      C.feedStats.forEach(function (x) { row.appendChild(statEl(x)); });
      return row;
    },
    feedNext: function () {
      var s = feedState();
      return button(s.next.to ? { label: s.next.label, to: s.next.to }
        : { label: s.next.label, action: 'feedNext' }, 'sc-btn');
    },

    /* --- экран 19: карточка выбранного продукта ---
       У продукта может быть своё пояснение (C.productAbout); если его
       нет — показываем общий текст с кадра. */
    productCard: function () {
      var p = find(C.products, selKey());
      var a = C.productAbout[p.key] || C.productText;
      return panelEl({ title: 'Выбран продукт · ' + p.name.toLowerCase(),
        text: a.lead });
    },
    productCheck: function () {
      var p = find(C.products, selKey());
      var a = C.productAbout[p.key] || C.productText;
      return panelEl({ title: 'Что проверяют', sub: a.check });
    },

    /* --- экран 21: требования выбранной страны --- */
    countryCard: function () {
      var c = find(C.countries, selKey());
      /* в кадре 21 пометки под текстом нет. Поле countryWip у экрана
         раньше глушило этот блок (перечня требований не было) — правка
         29.09 принесла дословные тексты по пяти странам, а координатор
         30.09 попросил снять заглушку: у export-2 countryWip больше
         не выставляется, wip здесь всегда false. Тексты Ирана
         и Индонезии заметно длиннее прежней заглушки (по три пункта),
         панель у левого края невысокая (до нижней навигации), поэтому
         у неё уменьшен кегль текста (cls: is-country) — иначе длинные
         тексты наезжали на кнопку «Назад». Слова из текста не менялись,
         правка только визуальная. */
      return panelEl({ cls: 'is-country', title: 'Требования\nнаправления',
        text: c.text, wip: cur.countryWip });
    }
  };

  function slotEl(item) {
    if (item.dyn) return SLOTS[item.dyn] ? SLOTS[item.dyn]() : el('div');
    if (item.label) {
      var b = button(item, 'sc-btn' + (item.gold ? ' is-gold' : ''));
      /* заглушённая кнопка: серая, с подписью «в разработке»
         и без касаний (экран подготовки складов) */
      if (item.wip) wip(b);
      return b;
    }
    if (item.picks) return picksEl(item.picks);
    if (item.select) {
      var sel = selectEl(item.select);
      /* подпись «в разработке» стоит на плашке под переключателем,
         поэтому сам он гасится без второй подписи */
      if (item.wip) wip(sel, true);
      return sel;
    }
    if (item.steps) return stepsEl(item.steps);
    if (item.shot) return shotEl(item.shot);
    if (item.grid && !item.title) return gridEl(item.grid);
    return panelEl(item);
  }

  /** Колонка панелей слева или справа; at: 'top' (по умолчанию) или 'bottom'. */
  function colEl(spec, side, top) {
    var box = el('div', 'sc-col is-' + side + ' is-' + (spec.at || 'top') +
      (spec.hasNav ? ' has-nav' : ''));
    if (side === 'right' && (cur.id === 'route-food' || cur.id === 'route-feed')) box.appendChild(el('div', 'sc-scroll-hint', 'Прокрутите, чтобы прочитать полностью ↓'));
    if (spec.width) box.style.width = spec.width + 'px';
    /* edge — свой отступ колонки от края экрана: в паре кадров Figma
       панель стоит не на общих 64 px */
    if (spec.edge != null) box.style[side === 'left' ? 'left' : 'right'] = spec.edge + 'px';
    if (top || spec.top) box.style.top = (top || spec.top) + 'px';
    if (spec.gap != null) box.style.gap = spec.gap + 'px';
    /* dyn-слот может вернуть null (сетка карточек сорняков, экран 9,
       видна только в одном состоянии сцены) — такой слот просто
       не вставляем, а не заглушку пустым div: иначе flex-gap колонки
       добавлял бы призрачный отступ в состояниях без сетки. */
    (spec.items || []).forEach(function (item) {
      var node = slotEl(item);
      if (node) box.appendChild(node);
    });
    return box;
  }

  /* ---------------- почва: элемент, концентрация, статус ----------------
     Концентрация хранится долей 0…1 от шкалы. Норматив стоит на отметке
     C.soilMark, поэтому «превышение» — это просто доля выше неё,
     а подпись в мг/кг считается из норматива элемента. Сами нормативы
     демонстрационные, см. справочник.

     Ползунок концентрации 21.09 сняли со всех экранов, но заказчик
     попросил вернуть его здесь: на экране почвы он был рабочим.
     На продовольственном маршруте ползунков по-прежнему нет. */

  function soilLevel() {
    if (st.level == null) st.level = find(C.soilElements, selKey()).start;
    return st.level;
  }

  /** Значение в мг/кг для текущей доли шкалы. */
  function soilMg(e, part) {
    var v = part * e.limit / C.soilMark;
    return (e.limit < 10 ? v.toFixed(1).replace('.', ',') : String(Math.round(v))) + ' мг/кг';
  }

  /** Перерисовать только то, что зависит от ползунка: ручку и плашку.
      Перерисовывать весь экран нельзя — ползунок потерял бы захват. */
  function soilRefresh() {
    var over = st.level > C.soilMark;
    if (st.gaugeKnob) st.gaugeKnob.style.left = Math.round(st.level * 100) + '%';
    if (st.gauge) st.gauge.classList.toggle('is-bad', over);
    if (st.status) {
      st.status.className = 'sc-status' + (over ? ' is-bad' : '');
      st.status.innerHTML = '';
      st.status.appendChild(el('span', null, (over ? '! ' : '✓ ') +
        (over ? C.soilStatus.bad : C.soilStatus.ok)));
    }
  }

  /* Ползунки экранов: имя из справочника → описание для sliderEl. */
  var SLIDERS = {
    soil: function () {
      var e = find(C.soilElements, selKey());
      var part = soilLevel();
      return {
        label: 'Содержание ' + e.gen,
        unit: soilMg(e, part),
        value: part,
        on: function (v) { st.level = v; soilRefresh(); return soilMg(e, v); }
      };
    }
  };

  /* Шкалы показателей. */
  var GAUGES = {
    soil: function () {
      var e = find(C.soilElements, selKey());
      var part = soilLevel();
      return { sym: e.sym, formula: 'C < T', at: part, mark: C.soilMark,
        bad: part > C.soilMark, left: 'Концентрация C', right: 'Норматив T' };
    }
  };

  /* Что сделать, когда на экране сменили выбор. */
  var PICKED = {
    // другой элемент — своя привычная концентрация
    'soil-1': function () { st.level = find(C.soilElements, st.sel).start; },
    // другое удобрение — расчёт нужно запустить заново
    'soil-2': function () { }
  };

  /**
   * Метки-чипы на объектах сцены. Координаты — левый верхний угол чипа
   * в пикселях кадра 1920x1080. markerCls задаёт вид чипов на экране.
   */
  function markersEl(scr, root) {
    scr.markers.forEach(function (m) {
      var b = el('button', 'sc-marker' + (scr.markerCls ? ' ' + scr.markerCls : '') +
        (selKey() === m.key ? ' is-on' : ''));
      b.type = 'button';
      b.style.left = m.x + 'px';
      b.style.top = m.y + 'px';
      /* длинные подписи в кадре стоят в чипе заданной ширины и
         переносятся на вторую строку (кадр 19: «Кондитерские изделия») */
      if (m.w) { b.style.width = m.w + 'px'; b.classList.add('is-wrap'); }
      if (m.n) b.appendChild(el('span', 'sc-marker-n', String(m.n)));
      b.appendChild(el('span', 'sc-marker-t', m.label));
      b.addEventListener('click', function () {
        resetIdle();
        // первое касание выбирает объект, повторное открывает станцию
        if (selKey() === m.key && m.to) go(m.to);
        else { st.sel = m.key; rerender(); }
      });
      root.appendChild(b);
    });
  }

  /** Линии между метками: готовые пути SVG в координатах кадра. */
  function linksEl(scr) {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'sc-links');
    svg.setAttribute('viewBox', '0 0 1920 1080');
    scr.links.forEach(function (d) {
      var p = document.createElementNS(ns, 'path');
      p.setAttribute('d', d);
      svg.appendChild(p);
    });
    return svg;
  }

  /** Плитки переходов в другие разделы стенда (экран меню). */
  function tilesEl(scr) {
    var box = el('div', 'sc-tiles');
    scr.tiles.forEach(function (t) {
      var b = el('button', 'sc-tile');
      b.type = 'button';
      if (t.w) b.style.width = t.w + 'px';
      var ph = el('div', 'sc-tile-pic');
      if (t.img) {
        var im = new Image();
        im.src = U.asset(t.img);
        im.alt = t.name;
        if (t.at) {
          im.className = 'is-at';
          im.style.left = t.at[0] + 'px';
          im.style.top = t.at[1] + 'px';
          im.style.width = t.at[2] + 'px';
          im.style.height = t.at[3] + 'px';
        }
        ph.appendChild(im);
      }
      b.appendChild(ph);
      var body = el('div', 'sc-tile-body');
      var txt = el('div', 'sc-tile-text');
      txt.appendChild(el('div', 'sc-tile-name', t.name));
      txt.appendChild(el('div', 'sc-tile-sub', t.sub || 'Узнайте больше'));
      body.appendChild(txt);
      body.appendChild(el('span', 'sc-tile-go', '→'));
      b.appendChild(body);
      b.addEventListener('click', function () {
        resetIdle();
        if (t.link) U.goSection(t.link, t.params);
        else if (t.to) go(t.to);
      });
      box.appendChild(b);
    });
    return box;
  }

  /** Навигация новой раскладки: «← Назад» слева, «Вперёд →» справа. */
  function navSceneEl(scr, root) {
    ['back', 'next'].forEach(function (slot, i) {
      var b = scr.nav && scr.nav[slot];
      if (!b) return;
      var cell = el('div', 'sc-nav-' + slot);
      if (scr.navWidth) cell.style.width = scr.navWidth[i] + 'px';
      cell.appendChild(b.dyn ? SLOTS[b.dyn]()
        : button(b, 'sc-btn' + (b.gold ? ' is-gold' : '')));
      root.appendChild(cell);
    });
  }

  /** Табы под шапкой: список берётся из справочника (tabsFrom). */
  function tabsSceneEl(scr) {
    var slot = el('div', 'sc-tabs-slot');
    var box = el('nav', 'sc-tabs');
    C[scr.tabsFrom].forEach(function (t) {
      var b = el('button', 'sc-tab' + (t.key === tabKey() ? ' is-on' : ''), t.name);
      b.type = 'button';
      b.addEventListener('click', function () {
        resetIdle();
        st.tab = t.key;
        st.level = null;
        rerender();
      });
      box.appendChild(b);
    });
    slot.appendChild(box);
    return slot;
  }

  /** Экран по макетам: сцена во весь экран и плавающие панели поверх. */
  function renderSceneLayout(scr, root) {
    root.appendChild(sceneLayer(scr));
    if (scr.shade) {
      // затемнений может быть несколько: 'top bottom'
      root.appendChild(el('div', 'sc-shade is-' + scr.shade.split(' ').join(' is-')));
    }
    if (scr.figs) figsEl(scr, root);
    if (scr.curtain) curtainEl(scr, root);
    if (scr.caps) capsEl(scr, root);
    if (scr.links) root.appendChild(linksEl(scr));
    if (scr.markers) markersEl(scr, root);
    if (scr.radios) radiosEl(scr, root);
    if (scr.overlay && OVERLAYS[scr.overlay]) OVERLAYS[scr.overlay](root);
    /* .length-проверка, а не просто truthy: состояние photo экрана 9
       (кадр 08a, чистое поле) держит weedsByTab.photo пустым массивом —
       меток там нет по сценарию. Без проверки длины weedsEl всё равно
       вызывался бы и через countWeeds включал счётчик, если сорняки уже
       найдены в другом состоянии (st.found общий на все вкладки) —
       на чистом поле счётчика в кадре нет вообще, поэтому просто
       не заходим в весь блок, когда меток нет. */
    if (scr.weedsByTab && scr.weedsByTab[tabKey()] && scr.weedsByTab[tabKey()].length) {
      weedsEl(scr.weedsByTab[tabKey()], root, scr.weedsTotal);
    }
    if (scr.title || scr.eyebrow) root.appendChild(headEl(scr));
    if (scr.hero) root.appendChild(el('div', 'sc-hero', scr.hero));
    if (scr.tabsFrom) root.appendChild(tabsSceneEl(scr));
    if (scr.topRight) {
      var top = el('div', 'sc-top');
      top.appendChild(button(scr.topRight, 'sc-btn'));
      root.appendChild(top);
    }
    if (scr.picks3) root.appendChild(picks3El(scr.picks3));
    if (scr.left) root.appendChild(colEl(scr.left, 'left'));
    if (scr.right) root.appendChild(colEl(scr.right, 'right',
      scr.rightByTab && scr.rightByTab[tabKey()]));
    if (scr.boxes) boxesEl(scr, root);
    if (scr.tiles) root.appendChild(tilesEl(scr));
    if (scr.nav) navSceneEl(scr, root);
  }

  /** Заставка: коллаж, заголовок, подпись, касание в любом месте.

      Правка 30.09: заказчик прислал заставку роликом. В нём уже есть и
      фон, и коллаж, и новые продукты — масло, спирт, кофе, — поэтому при
      заданном поле video ни фоновая картинка, ни слой коллажа не рисуются:
      иначе они лягут поверх ролика. Заголовок и подпись остаются текстом
      страницы, в самом ролике их нет. Убрать ролик — убрать поле video,
      прежние картинки останутся на месте. */
  function renderIntro(scr, root) {
    var cover = el('div', 'sc-cover');
    if (scr.video) {
      var vv = document.createElement('video');
      vv.className = 'sc-cover-bg';
      vv.autoplay = true;
      vv.loop = true;
      vv.muted = true;
      vv.defaultMuted = true;
      vv.setAttribute('muted', '');        // автозапуск смотрит на атрибут, а не только на свойство
      vv.playsInline = true;
      vv.setAttribute('playsinline', '');
      vv.preload = 'auto';
      if (scr.videoPoster) vv.poster = U.asset(scr.videoPoster);
      vv.style.pointerEvents = 'none';     // стенд сенсорный: касание должно доходить до слоя .sc-tap
      vv.src = U.asset(scr.video);
      cover.appendChild(vv);
      vv.load();
      /* play() зовём отложенно: сейчас cover ещё не в документе, а часть
         браузеров не запускает автовоспроизведение, пока элемента нет
         в дереве страницы. */
      setTimeout(function () {
        var p = vv.play();
        if (p && p.catch) p.catch(function () { /* запустится по касанию */ });
      }, 0);
    } else {
      if (scr.scene && scr.scene.pic && scr.scene.pic.img) {
        var bg = new Image();
        bg.className = 'sc-cover-bg';
        bg.src = U.asset(scr.scene.pic.img);
        bg.alt = '';
        cover.appendChild(bg);
      }
      if (scr.collage && scr.collage.img) {
        var box = el('div', 'sc-collage');
        var im = new Image();
        im.src = U.asset(scr.collage.img);
        im.alt = scr.collage.cap || '';
        box.appendChild(im);
        cover.appendChild(box);
      }
    }
    cover.appendChild(el('h1', 'sc-cover-title', scr.title));
    if (scr.sub) cover.appendChild(el('div', 'sc-cover-hint', scr.sub));
    root.appendChild(cover);

    // слушатель висит на своём слое, а не на #view — иначе он пережил бы
    // смену экрана
    var tap = el('button', 'sc-tap');
    tap.type = 'button';
    tap.setAttribute('aria-label', scr.sub || 'Дальше');
    tap.addEventListener('click', function () { resetIdle(); go(scr.tapTo); });
    root.appendChild(tap);
  }

  /* =================================================================
     Действия кнопок (кнопка задаётся полем action в справочнике)
     ================================================================= */

  var ACTIONS = {
    /* --- станция 4 --- */

    /** Золотая кнопка: следующий шаг, а на последнем шаге ангара —
        переключение «до / после обработки». */
    flowNext: function () {
      var s = flowStep();
      if (s.compare) { st.before = !st.before; rerender(); return; }
      goStep(Math.min(s.n + 1, flow().steps.length));
    },

    /** Касание решётки вентиляции на ангаре (шаг 6): закрыта. */
    storeSpot: function () {
      st.done = true;
      rerender();
    },


    /** Экран 9: переключение «поле издалека → поле вблизи, ищем сами».
        st.found общий на все состояния сцены, поэтому при входе в поиск
        его сбрасываем: иначе посетитель, который сначала запустил БПЛА
        (тот отмечает все три), а потом вернулся искать сам, увидел бы
        «Найдено 3 из 3» над полем, где кликабельных куста два. На стенде
        кнопки жмут в любом порядке, так что случай рабочий. */
    weedSelf: function () {
      if (cur.tabsWip) return;
      cancelDroneScan(); st.scanning = false;
      st.tab = tabKey() === 'iso' ? 'photo' : 'iso';
      if (st.tab === 'iso') st.found = {};
      rerender();
    },

    /** Экран 9: обзор с БПЛА, три последовательных обнаружения. */
    weedDrone: function () {
      if (cur.tabsWip) return;
      if (tabKey() === 'drone') { cancelDroneScan(); st.scanning = false; st.tab = 'photo'; rerender(); return; }
      cancelDroneScan();
      st.tab = 'drone'; st.found = {}; st.scanning = true;
      var scanState = st;
      rerender();
      [0, 1, 2].forEach(function (i) {
        scanTimers.push(setTimeout(function () {
          if (st !== scanState || !cur || cur.id !== 'seed-3' || tabKey() !== 'drone') return;
          st.found[i] = true;
          if (st.weedEls[i]) st.weedEls[i].classList.add('is-found');
          if (st.countEl) countWeeds(3, 3);
          if (i === 2) {
            st.scanning = false;
            $('view').classList.remove('is-scanning');
            var scanButton = $('view').querySelector('[data-action="weedDrone"]');
            if (scanButton) scanButton.textContent = 'Обзор завершён';
          }
        }, 1700 + i * 1700));
      });
    },

    /* --- экраны 16 и 17: следующая вкладка маршрута --- */
    foodNext: function () { st.tab = foodTab().next.tab; st.level = null; rerender(); },
    feedNext: function () { st.tab = feedState().next.tab; st.sel = null; rerender(); },

    /** Экран 21: окно «Пакет документов». Кадра в макетах нет, образцов
        документов тоже, поэтому окно собрано из того, что есть на экране:
        четыре документа с их пояснениями. На месте скана — нейтральный
        лист; настоящие образцы встанут сюда полем img у документа.
        Служебных надписей посетитель видеть не должен. */
    showDocs: function () {
      var over = el('div', 'sc-over');
      var panel = el('div', 'sc-over-panel is-docs');
      var country = find(C.countries, selKey());
      panel.appendChild(el('div', 'sc-panel-cap', 'Пакет документов'));
      panel.appendChild(el('h3', 'sc-panel-t',
        'Сопроводительные документы' + (country && country.key !== 'other' ? ' · ' + country.name : '')));
      var grid = el('div', 'sc-docs');
      C.exportDocs.forEach(function (d, i) {
        var card = el('div', 'sc-doc');
        var sheet = el('div', 'sc-doc-sheet');
        if (d[2]) {
          var im = new Image();
          im.src = U.asset(d[2]);
          im.alt = d[0];
          sheet.appendChild(im);
        } else {
          sheet.appendChild(el('span', 'sc-doc-n', '0' + (i + 1)));
          for (var k = 0; k < 5; k++) sheet.appendChild(el('i'));
        }
        card.appendChild(sheet);
        var t = el('div', 'sc-doc-t');
        t.appendChild(el('div', 'sc-doc-k', d[0]));
        t.appendChild(el('div', 'sc-doc-v', d[1]));
        card.appendChild(t);
        grid.appendChild(card);
      });
      panel.appendChild(grid);
      panel.appendChild(button({ label: 'Закрыть', action: 'closeOver' }, 'sc-btn'));
      over.appendChild(panel);
      over.addEventListener('click', function (e) { if (e.target === over) over.remove(); });
      $('view').appendChild(over);
      st.over = over;
    },

    closeOver: function () { if (st.over) { st.over.remove(); st.over = null; } }
  };

  /* Что доигрывает ?demo=1 на каждом экране — для снимков и показа. */
  var DEMOS = {
    'seed-3': function () { ACTIONS.weedDrone(); }
  };

  /* =================================================================
     Движок: переходы, история, адресная строка, аттрактор
     ================================================================= */

  function draw() {
    var view = $('view');
    view.className = '';
    view.innerHTML = '';
    view.setAttribute('data-screen', cur.id);
    var layout = cur.layout || 'scene';
    view.setAttribute('data-layout', layout);
    if (cur.id === 'seed-3') {
      view.classList.toggle('is-self-search', tabKey() === 'iso');
      view.classList.toggle('is-drone-search', tabKey() === 'drone');
      view.classList.toggle('is-scanning', !!st.scanning);
    }
    if (layout === 'intro') renderIntro(cur, view);
    else renderSceneLayout(cur, view);
  }

  /** Перерисовать текущий экран без затухания (смена вкладки или выбора). */
  function rerender() { draw(); }

  function go(id, opts) {
    opts = opts || {};
    var scr = byId[id];
    if (!scr || busy) return;
    if (cur && cur.id === id && !opts.force) return;
    if (cur && !opts.reset) hist.push(cur.id);
    if (opts.reset) hist = [];
    swap(scr);
  }

  function back() {
    var id = hist.pop();
    if (!id || !byId[id]) { swap(byId[HOME]); return; }
    swap(byId[id]);
  }

  function swap(scr) {
    if (busy) return;
    busy = true;
    var view = $('view');
    view.classList.add('is-out');
    setTimeout(function () {
      cancelDroneScan();
      cur = scr;
      st = {};
      draw();
      view.classList.add('is-out');      // draw() чистит классы, вернём затухание
      setUrl(scr.id);
      // проявление следующим тиком. Специально не requestAnimationFrame:
      // в свёрнутой вкладке кадры не идут, и экран завис бы в busy.
      setTimeout(function () {
        view.classList.remove('is-out');
        busy = false;
      }, 20);
    }, FADE);
  }

  function setUrl(id) {
    if (global.Shell) { global.Shell.url('story', { screen: id }); return; }
    if (!global.history || !global.history.replaceState) return;
    try {
      global.history.replaceState(null, '', '?screen=' + encodeURIComponent(id));
    } catch (e) { /* file:// не разрешает replaceState — не беда */ }
  }

  /* --------------------------- аттрактор --------------------------- */

  /* В едином приложении таймер бездействия один на все разделы и живёт
     в src/shell.js — здесь мы только сообщаем ему, что был отклик. */

  function resetIdle() {
    if (global.Shell) { global.Shell.ping(); return; }
    if (idleTimer) clearTimeout(idleTimer);
    if (idleOff) { idleTimer = null; return; }
    idleTimer = setTimeout(toAttractor, (CFG.attractorTimeoutSec || 90) * 1000);
  }

  function toAttractor() {
    resetIdle();
    if (cur && cur.id === HOME) return;
    hist = [];
    swap(byId[HOME]);
  }

  /** Аттрактор оболочки: вернуться на заставку без затухания раздела. */
  function reset() {
    hist = [];
    if (cur && cur.id === HOME) return;
    openScreen(HOME);
  }

  /** Показать экран сразу, без затухания: так входят в раздел из меню. */
  function openScreen(id) {
    var scr = byId[id];
    if (!scr || (cur && cur.id === id)) return;
    hist = [];
    cancelDroneScan();
    cur = scr;
    st = {};
    draw();
    setUrl(scr.id);
  }

  /* --------------------------- масштаб --------------------------- */

  function fitStage() {
    var s = Math.min(global.innerWidth / 1920, global.innerHeight / 1080);
    $('stage').style.transform = 'scale(' + s + ')';
  }

  /* ---------------------- зерно на фоне ---------------------- */

  function drawStars(colors) {
    var c = $('stars');
    if (!c) return;
    var dot = (colors && colors.stars) || '150,205,190';
    var glow = (colors && colors.starGlow) || '130,215,195';
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

  function applyColors(c) {
    if (!c) return;
    var root = document.documentElement.style;
    if (c.pageBg) root.setProperty('--page-bg', c.pageBg);
    if (c.cardBg) root.setProperty('--card-bg', c.cardBg);
    if (c.panelBg) root.setProperty('--panel', c.panelBg);
    if (c.accent) root.setProperty('--accent', c.accent);
    if (c.text) root.setProperty('--text', c.text);
    if (c.textMuted) root.setProperty('--muted', c.textMuted);
  }

  /* ------------------------------ старт ------------------------------ */

  function boot() {
    return U.loadJSON('inline-config', 'config.json').then(function (cfg) {
      CFG = cfg || CFG;
      var green = (CFG.themes && CFG.themes.green) || {};
      applyColors(green.colors);
      drawStars(green.colors);
    }).catch(function () {
      drawStars(null);
    }).then(function () {
      fitStage();
      global.addEventListener('resize', fitStage);
      ['pointerdown', 'pointermove', 'keydown', 'wheel'].forEach(function (ev) {
        document.addEventListener(ev, resetIdle, { passive: true });
      });

      var q = U.query('story');
      if (q.idle === '0') idleOff = true;
      cur = byId[q.screen] || byId[HOME];
      st = {};
      // ?sel= и ?tab= открывают экран сразу в нужном состоянии,
      // ?demo=1 доигрывает интерактив (нашлись сорняки, посчиталась доза) —
      // это для снимков экрана и показа заказчику
      if (q.sel) st.sel = q.sel;
      if (q.tab) st.tab = q.tab;
      draw();
      if (q.demo === '1' && DEMOS[cur.id]) DEMOS[cur.id]();
      setUrl(cur.id);
      resetIdle();
      $('loading').classList.add('hidden');
      U.revealPage();
      if (global.Shell) global.Shell.ready('story');
    });
  }

  /* Для показа и отладки: StoryApp.go('product'), StoryApp.list() */
  global.StoryApp = {
    go: function (id) { go(id, { force: true }); },
    back: back,
    list: function () { return C.screens.map(function (s) { return s.id; }); },
    state: function () { return { screen: cur && cur.id, st: st, hist: hist.slice() }; }
  };

  /* Раздел единого приложения (app.html) или отдельная страница story.html */
  if (global.Shell) {
    global.Shell.register('story', {
      boot: boot,
      show: function (p) {
        fitStage();
        if (p && p.screen) openScreen(p.screen);
        else setUrl(cur ? cur.id : HOME);
      },
      hide: function () {
        ACTIONS.closeOver(); cancelDroneScan();
        if (st.scanning) { st.scanning = false; st.tab = 'photo'; rerender(); }
      },
      reset: reset
    });
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
