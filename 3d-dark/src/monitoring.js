/* ===================================================================
   Раздел 09 — «Мониторинг зерна РФ».

   Раздел единого приложения app.html (обёртка #sec-monitoring); та же
   логика работает и отдельной страницей monitoring.html. С глобусом
   и презентацией кода не делит: общие только util.js, переменные темы
   и настройки из config.json.

   Три экрана на одной подложке:

     scr-map        карта госмониторинга (экран 23): год, поиск,
                    «Всего по России», «Топ-10 регионов», легенда;
     scr-region     карточка выбранного региона (экран 24): валовой
                    сбор, обследовано, классы зерна;
     scr-presence   «Регионы присутствия ЦОК АПК» — самостоятельный
                    раздел стенда (?section=presence): та же карта,
                    подсвечены регионы с филиалами и точки лабораторий,
                    отдельной отметкой — головной офис, справа карточка
                    филиала с адресом, телефонами и почтой.

   Между картой госмониторинга и регионами присутствия переключают
   вкладки под заголовком (макеты 25.09: 553:1480 и 553:1029).
   Карта управляется пальцами: одним — перетаскивание, двумя — щипок
   (масштаб вокруг точки между пальцами); касание без движения выбирает
   регион. Кнопки +/− остаются.

   Карта одна на два экрана: холст во весь кадр 1920x1080, панели лежат
   поверх и размывают её под собой. Страна вписывается не в весь холст,
   а в прямоугольник FIT — свой на каждом экране, чтобы её не закрывала
   колонка панелей.

   Данные — три файла, кода они не касаются:
     assets/geo/russia-regions.json  контуры субъектов (tools/make_regions.py)
     data/monitoring.json            цифры мониторинга (tools/make_monitoring.py)
     data/presence.json              филиалы и лаборатории ЦОК АПК

   ЦИФРЫ НАСТОЯЩИЕ: data/monitoring.json собирается из таблиц заказчика
   (tools/make_monitoring.py, исходники в data/monitoring-src). Региона
   нет в таблице за этот год — он серый и подписан «госмониторинг
   не проводится», ничего не достраиваем.
   =================================================================== */
(function (global) {
  'use strict';

  // элементы ищем внутри обёртки раздела: в едином приложении рядом
  // лежат презентация и глобус, а часть идентификаторов совпадает
  var ROOT = U.scope('monitoring');
  var $ = U.byId('monitoring');
  var el = function (t, c, x) { return U.el(t, c, x); };

  /* ------------------------------ настройки ------------------------------ */

  var CFG = { attractorTimeoutSec: 90 };

  var MAP_W = 1888, MAP_H = 1048;      // холст во всю карточку кадра (1920x1080 минус 16 по краям)
  var ZOOM_MAX = 3.6, ZOOM_STEP = 1.45;
  var TAP_SLOP = 7;                    // сколько пикселей можно проехать, чтобы это был тап
  var WHEEL_ZOOM_SENS = 0.0015;        // сила зума колесом на единицу deltaY, подобрана опытным путём
  var WHEEL_LINE_PX = 16;              // во сколько px переводим «строчный» шаг колеса (deltaMode === 1)

  /* Куда вписывается страна: [x0, y0, x1, y1] в координатах кадра.
     На карте госмониторинга слева колонка панелей, на регионах
     присутствия карта занимает почти весь кадр. Числа сняты с кадров
     docs/mockup/concept-18-09. */
  var FIT = {
    /* снизу освободилось место от ленты годов, а легенда уехала
       к нижнему краю — карта стала крупнее и стоит ниже, как в макете */
    map: [552, 208, 1878, 884],
    presence: [44, 184, 1884, 996]
  };

  /* Вид карты при открытии экрана — по макетам 25.09 (553:1480
     «Госмониторинг», 553:1029 «Регионы присутствия»): страна там крупнее,
     чем «вписать целиком», прижата влево, а восток уходит за правый край —
     его видно, если сдвинуть карту пальцем или отдалить щипком (отдалить
     можно до страны целиком в прямоугольнике FIT).
     k — пикселей кадра на единицу контуров, x и y — куда в кадре встаёт
     середина рамки страны. Подобраны совмещением золотых границ с кадрами
     docs/mockup/figma-1920/27-monitoring-2026 и 26-presence. */
  var VIEW = {
    map: { k: 0.0769, x: 1364, y: 487 },
    presence: { k: 0.0938, x: 1022, y: 580 }
  };

  /* Заливка карты — два цвета: зелёный там, где есть данные по сборам,
     серый там, где госмониторинг не проводится. Оттенков по объёму
     в макете нет: объёмы читаются в списке «Топ-10» и в подписи под
     пальцем. Сильная пшеница заливкой не показывается — у таких
     регионов в центре контура стоит золотой колосок (drawStrongRye). */
  /* Цвета сняты по пикселям кадра 27-monitoring-2026 (макет 553:1480):
     заливки там сплошные, без просвета фона. */
  var C_DATA = [20, 68, 52];           // #425965 — slate
  var C_STRONG = [230, 180, 22];       // #e6b416 — цвет колоска и метки в легенде
  var C_NONE = [42, 53, 51];           // #2b3138

  /* Регион считается охваченным госмониторингом, если за выбранный год
     в таблицах заказчика есть цифры хотя бы по одному виду пшеницы.
     Где их нет — регион серый и везде подписан одинаково: «госмониторинг
     не проводится». Цифры не выдумываем и «данные уточняются» больше
     не пишем (решение заказчика от 21.09). */
  function hasMon(id) {
    return !!(rec(id, 'soft') || rec(id, 'durum'));
  }

  function noDataLabel(id) {
    // «нет данных» не пишем (правки 25.09): регион, где цифры есть только
    // по второму виду пшеницы, остаётся просто без подписи
    return hasMon(id) ? '' : 'госмониторинг не проводится';
  }

  /* «Сильная пшеница» — признак из таблицы заказчика «Регионы
     с сильной пшеницей» (белок выше 13,5 %, клейковина выше 28 %).
     На карте такие субъекты помечены золотым колоском в центре
     контура, заливка у них обычная. */

  var BORDER = 'rgba(229,199,115,.55)';
  var BORDER_MON = 'rgb(206,170,26)';  // госмониторинг: #CDAA1C, линия 0,9 px — по векторам кадра 553:1480 (правка 30.09)
  var BORDER_HOT = '#F6E8C8';

  /* Экран «Регионы присутствия» — цвета и толщины сняты с векторного
     слоя кадра 553:1029 (правка 30.09, «точно по фигме»):
       остальные регионы — #073D34 с прозрачностью 0,52 (сквозь них
         виден рельеф фона), граница #E6B416 с прозрачностью 0,65, 1,2 px;
       регионы присутствия — #1A6045, обводка #CDB06A, 1,9 px;
       выбранный — золотой градиент #F7D980 → #DAB454 → #A68434
         с прозрачностью 0,9 и золотым свечением вокруг. */
  var PRES_ON = [26, 96, 69];
  var PRES_OFF = [7, 61, 52];
  var PRES_OFF_A = 0.52;
  var PRES_PICK = [218, 180, 84];      // середина градиента — для наведения
  var PRES_PICK_STOPS = ['#F7D980', '#DAB454', '#A68434'];
  var PRES_BORDER = 'rgba(230,180,22,.65)';
  var PRES_BORDER_ON = '#CDB06A';
  /* Точка филиала — как в макете: светлое ядро 11,7 px и три кольца
     свечения 22,7 / 35,6 / 51,8 px. Одна и та же у всех 18 филиалов
     (замечание заказчика 30.09: «в макетах все точки одинаковые»). */
  var DOT_RINGS = [[25.9, 'rgba(248,209,102,.05)'], [17.8, 'rgba(248,209,102,.11)'],
                   [11.3, 'rgba(255,227,145,.23)'], [5.83, '#FFF2B5']];

  /* Основные (средневзвешенные) показатели зерна: поле в данных, подпись,
     единица, номер метки вокруг зерна (n) и пояснение. Значения берутся
     из data/monitoring.json, пояснения — справочные, в таблицах заказчика
     их нет. */
  var SPECS = [
    { key: 'protein', name: 'Белок', unit: '%', n: 1,
      hint: 'Доля белка в зерне. Чем её больше, тем выше пищевая ценность зерна и его класс.' },
    { key: 'gluten', name: 'Клейковина', unit: '%', n: 2,
      hint: 'Сколько в зерне клейковины. От неё зависит, насколько тесто тянется и держит форму.' },
    { key: 'nature', name: 'Натура', unit: 'г/л', n: 3,
      hint: 'Масса зерна в одном литре. Показывает, насколько зерно налитое и плотное.' },
    { key: 'falling', name: 'Число падения', unit: 'с', n: 4,
      hint: 'Показатель активности ферментов. Низкое значение означает проросшее зерно.' },
    { key: 'vitreous', name: 'Стекловидность', unit: '%', n: 5,
      hint: 'Доля стекловидных зёрен. Важна для крупы и макаронных изделий.' }
  ];

  /* Метки-кружки вокруг зерна на экране региона: пять основных
     показателей. Порядок и места — из макета 24-region: 1 и 2 слева,
     3 и 4 справа, 5 внизу по центру. Координаты в поле карточки
     1888x1048; подпись стоит над кружком, lx — её середина. */
  var MARKS = [
    { n: 1, key: 'protein', label: 'Белок', x: 520, y: 300, lx: 548, ly: 262, lw: 180 },
    { n: 2, key: 'gluten', label: 'Клейковина', x: 520, y: 660, lx: 548, ly: 622, lw: 200 },
    { n: 3, key: 'nature', label: 'Натура', x: 1150, y: 300, lx: 1178, ly: 262, lw: 180 },
    { n: 4, key: 'falling', label: 'ЧП', x: 1150, y: 660, lx: 1178, ly: 622, lw: 180 },
    { n: 5, key: 'vitreous', label: 'Стекловидность', x: 872, y: 922, lx: 900, ly: 884, lw: 240 }
  ];

  var KINDS = [
    { key: 'soft', label: 'Мягкая пшеница' },
    { key: 'durum', label: 'Твёрдая пшеница' }
  ];

  var SCENE_IMG = 'assets/photos/concept/mon-region-scene.webp';
  var SCENE_VIDEO = 'assets/video/grain-scan.mp4';

  /* Проекция контуров: Альберса, как в tools/make_regions.py. Точки
     лабораторий лежат в файле в градусах, здесь переводим их в те же
     единицы, в которых лежат контуры (0,4 км на единицу).
     ORIGIN — сдвиг рамки страны в ноль, сделанный при подготовке
     контуров; если контуры пересобрать с другими параметрами,
     эти два числа нужно пересчитать (см. README). */
  var ORIGIN = [-11367, -8675];

  /* ------------------------------ состояние ------------------------------ */

  var geo = null, mon = null, pres = null;
  var byId = {};                       // код региона -> запись данных
  var shapes = [];                     // {id, name, path, bbox, c}
  var year = null;
  var kind = 'soft';
  var regionId = null;                 // открытый регион (экран 24)
  var specKey = 'protein';             // выбранный основной показатель
  var presId = null;                   // выбранный регион присутствия
  var presOf = {};                     // код субъекта -> код записи о присутствии
  var labs = [];                       // {id, name, x, y} — точки лабораторий
  var hq = null;                       // {x, y} — головной офис в координатах контуров
  var query = '';
  var hits = null;                     // результат поиска: код региона -> true
  var hoverId = null;
  var screen = 'map';                  // map | region | presence

  var view = { z: 1, cx: 0, cy: 0, k0: 1, ox: 960, oy: 540 };
  var anim = null;                     // плавный переход зума
  var need = false;                    // карту нужно перерисовать
  var ctx = null, dpr = 1, stageScale = 1;
  var idleTimer = null, idleOff = false;
  var frames = 0, fps = 0, fpsT = 0;
  var live = true;                     // раздел на экране (в app.html — не всегда)

  /* --------------------------- масштаб под окно --------------------------- */

  function fitStage() {
    stageScale = Math.min(global.innerWidth / 1920, global.innerHeight / 1080);
    $('stage').style.transform = 'scale(' + stageScale + ')';
    sizeCanvas();
  }

  /** Холст под настоящее число пикселей: сцена ужимается под окно,
      а на ретине к этому добавляется devicePixelRatio. */
  function sizeCanvas() {
    var c = $('map');
    if (!c) return;
    var r = Math.max(1, Math.min(3, (global.devicePixelRatio || 1) * stageScale));
    var w = Math.round(MAP_W * r), h = Math.round(MAP_H * r);
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
      dpr = r;
      need = true;
    }
  }

  /* ------------------------------ числа ------------------------------ */

  function fmt1(v) {
    if (v == null || isNaN(v)) return '—';
    return U.fmtVolume(v >= 100 ? v : Math.round(v * 10) / 10);
  }

  function dec1(v) {
    return v == null || isNaN(v) ? '—' : v.toFixed(1).replace('.', ',');
  }

  /** Запись региона за выбранный год и вид пшеницы. */
  function rec(id, k, y) {
    var r = byId[id];
    if (!r) return null;
    var ys = r.years[String(y == null ? year : y)];
    return ys ? (ys[k || kind] || null) : null;
  }

  /** Обследовано по выбранному виду пшеницы: этим числом красится
      карта, считается «Топ-10» и полоски в нём. */
  function volume(id) {
    var b = rec(id, kind);
    return b && b.surveyed ? b.surveyed : 0;
  }

  /** Сильная пшеница — признак из таблицы заказчика. */
  function isStrong(id) {
    var b = rec(id, 'soft');
    return !!(b && b.strong);
  }

  /* ------------------------------ цвет региона ------------------------------ */

  var maxVol = 1;                      // нужен полоскам в списке «Топ-10»

  function rgb(c) {
    return 'rgb(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ')';
  }

  function lighten(c, k) {
    return [c[0] + (255 - c[0]) * k, c[1] + (255 - c[1]) * k, c[2] + (255 - c[2]) * k];
  }

  function fillFor(id, hot) {
    var c;
    if (screen === 'presence') {
      var here = presOf[id];
      c = here ? (here === presId ? PRES_PICK : PRES_ON) : PRES_OFF;
      return rgb(hot && here ? lighten(c, 0.16) : c);
    }
    c = hasMon(id) ? C_DATA : C_NONE;
    return rgb(hot ? lighten(c, 0.26) : c);
  }

  /* ------------------------------ контуры ------------------------------ */

  /** Path2D по одному разу на регион: координаты мировые, на экран
      их переводит матрица холста — так и рисование, и попадание
      пальцем считает сам браузер. */
  function buildShapes() {
    shapes = [];
    geo.regions.forEach(function (r) {
      var p = new Path2D();
      r.polys.forEach(function (poly) {
        poly.forEach(function (ring) {
          var x = ring[0], y = ring[1];
          p.moveTo(x, y);
          for (var i = 2; i < ring.length; i += 2) {
            x += ring[i];
            y += ring[i + 1];
            p.lineTo(x, y);
          }
          p.closePath();
        });
      });
      shapes.push({ id: r.id, name: r.name, path: p, bbox: r.bbox, c: r.c });
    });
  }

  /* --------------------------- точки лабораторий ---------------------------
     Равновеликая коническая проекция Альберса — та же, что в
     tools/make_regions.py, параметры берутся из самого файла контуров. */

  function project(lon, lat) {
    var pr = (geo && geo.projection) || {};
    var lon0 = pr.lon0 == null ? 100 : pr.lon0;
    var lat0 = pr.lat0 == null ? 56 : pr.lat0;
    var lat1 = pr.lat1 == null ? 52 : pr.lat1;
    var lat2 = pr.lat2 == null ? 64 : pr.lat2;
    var unit = pr.unitKm || 0.4;
    var D = Math.PI / 180, R = 6371.0;
    var n = (Math.sin(lat1 * D) + Math.sin(lat2 * D)) / 2;
    var C = Math.cos(lat1 * D) * Math.cos(lat1 * D) + 2 * n * Math.sin(lat1 * D);
    var rho0 = Math.sqrt(C - 2 * n * Math.sin(lat0 * D)) / n;
    var d = lon - lon0;
    while (d > 180) d -= 360;
    while (d <= -180) d += 360;
    var theta = n * d * D;
    var v = C - 2 * n * Math.sin(lat * D);
    var rho = Math.sqrt(v > 0 ? v : 0) / n;
    var x = rho * Math.sin(theta) * R;
    var y = -(rho0 - rho * Math.cos(theta)) * R;
    return [Math.round(x / unit) - ORIGIN[0], Math.round(y / unit) - ORIGIN[1]];
  }

  /** Точки лабораторий и таблица «субъект -> запись о присутствии».
      Поле also нужно городам федерального значения: Москва лежит внутри
      Московской области отдельным субъектом, а филиал у них один. */
  function buildLabs() {
    labs = [];
    presOf = {};
    hq = null;
    if (pres && pres.hq && pres.hq.point) {
      var h = project(pres.hq.point.lon, pres.hq.point.lat);
      hq = { x: h[0], y: h[1] };
    }
    if (!pres || !pres.regions) return;
    Object.keys(pres.regions).forEach(function (id) {
      var r = pres.regions[id];
      presOf[id] = id;
      (r.also || []).forEach(function (a) { presOf[a] = id; });
      (r.points || []).forEach(function (p) {
        var xy = project(p.lon, p.lat);
        labs.push({ id: id, name: p.name, x: xy[0], y: xy[1] });
      });
    });
  }

  /* ------------------------------ вид карты ------------------------------ */

  function fitRect() {
    return FIT[screen === 'presence' ? 'presence' : 'map'];
  }

  /** Страна целиком влезает в FIT — стоит по середине. Иначе её можно
      двигать, пока под серединой FIT остаётся хоть край страны: так
      карту не утащить за экран, а восток, уходящий за край кадра
      в макетном виде, можно подтянуть пальцем. */
  function clampView() {
    var k = view.k0 * view.z, r = fitRect();
    var W = geo.box[0], H = geo.box[1];
    view.cx = W * k <= r[2] - r[0] ? W / 2 : U.clamp(view.cx, 0, W);
    view.cy = H * k <= r[3] - r[1] ? H / 2 : U.clamp(view.cy, 0, H);
  }

  /** Самое сильное отдаление: страна целиком в прямоугольнике FIT. */
  function zoomMin() {
    var r = fitRect();
    var all = Math.min((r[2] - r[0]) / geo.box[0], (r[3] - r[1]) / geo.box[1]) * 0.98;
    return Math.min(1, all / view.k0);
  }

  function resetView() {
    var r = fitRect(), v = VIEW[screen === 'presence' ? 'presence' : 'map'];
    view.k0 = v.k;
    view.ox = (r[0] + r[2]) / 2;
    view.oy = (r[1] + r[3]) / 2;
    view.z = 1;
    // середина рамки страны встаёт в точку (v.x, v.y) кадра
    view.cx = geo.box[0] / 2 + (view.ox - v.x) / v.k;
    view.cy = geo.box[1] / 2 + (view.oy - v.y) / v.k;
    clampView();
    anim = null;
    need = true;
  }

  /** Матрица холста: мир -> пиксели картинки. */
  function applyTransform() {
    var k = view.k0 * view.z * dpr;
    ctx.setTransform(k, 0, 0, k,
      view.ox * dpr - view.cx * k,
      view.oy * dpr - view.cy * k);
  }

  function toCanvas(wx, wy) {
    var k = view.k0 * view.z;
    return [view.ox + (wx - view.cx) * k, view.oy + (wy - view.cy) * k];
  }

  function zoomTo(z, cx, cy) {
    var from = { z: view.z, cx: view.cx, cy: view.cy };
    var to = { z: U.clamp(z, zoomMin(), ZOOM_MAX) };
    view.z = to.z;
    if (cx != null) { view.cx = cx; view.cy = cy; }
    clampView();
    to.cx = view.cx; to.cy = view.cy;
    view.z = from.z; view.cx = from.cx; view.cy = from.cy;
    anim = { from: from, to: to, t0: performance.now(), ms: 320 };
    need = true;
  }

  /** Приблизить карту к региону, не открывая карточку: нужно для показа
      и снимков экрана (параметр адреса ?at=UA-43&zoom=3). */
  function focusOn(id, z) {
    var s = shapes.filter(function (x) { return x.id === id; })[0];
    if (!s) return;
    zoomTo(z || 2.4, s.c[0], s.c[1]);
  }

  /* ------------------------------ отрисовка ------------------------------ */

  function draw() {
    if (!ctx || !geo) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, MAP_W * dpr, MAP_H * dpr);
    applyTransform();

    var k = view.k0 * view.z;
    var onPres = screen === 'presence';
    ctx.lineJoin = 'round';

    if (onPres) {
      drawPresMap(k);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      drawLabs();
      drawTransportPoints();
      return;
    }

    for (var i = 0; i < shapes.length; i++) {
      var s = shapes[i];
      var dim = !onPres && hits && !hits[s.id];
      // серый регион (госмониторинг не проводится) на наведение
      // не отзывается: по нему и карточка не открывается
      var hot = (s.id === hoverId && (onPres || hasMon(s.id))) ||
        (!onPres && s.id === regionId) ||
        (onPres && presOf[s.id] === presId);
      // заливка чуть прозрачная: сквозь неё видна фактура фона, как в макете
      ctx.globalAlpha = dim ? 0.26 : 1;
      ctx.fillStyle = fillFor(s.id, hot);
      ctx.fill(s.path, 'evenodd');
      ctx.lineWidth = (hot ? 2.0 : 0.9) / k;
      ctx.strokeStyle = hot ? BORDER_HOT : (onPres ? BORDER : BORDER_MON);
      ctx.stroke(s.path);
    }

    // выбранный и найденные обводятся поверх всех, чтобы соседи их не перекрыли
    ctx.globalAlpha = 1;
    for (var j = 0; j < shapes.length; j++) {
      var t = shapes[j];
      var mark = t.id === hoverId ||
        (onPres ? presOf[t.id] === presId : (t.id === regionId || (hits && hits[t.id])));
      if (!mark) continue;
      ctx.lineWidth = 2.0 / k;
      ctx.strokeStyle = BORDER_HOT;
      ctx.stroke(t.path);
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawStrongRye();
  }

  /**
   * Регионы присутствия по кадру 553:1029. Три прохода, чтобы обводки
   * не перекрывали друг друга как попало: сначала остальные регионы
   * (полупрозрачные, с тонкой золотой границей), поверх — регионы
   * с филиалами со своей обводкой, последним — выбранный регион
   * в золотом градиенте со свечением.
   */
  function drawPresMap(k) {
    // выбранных контуров может быть несколько: у филиала бывают соседние
    // субъекты (поле also) — Ленинградская область вместе с Петербургом,
    // Московская — с Москвой. Раньше золотился только последний из них,
    // а остальные пропускались вовсе (замечание 30.09 про Ленобласть).
    var i, s, picks = [];
    for (i = 0; i < shapes.length; i++) {
      s = shapes[i];
      if (presOf[s.id]) continue;
      ctx.globalAlpha = PRES_OFF_A;
      ctx.fillStyle = rgb(PRES_OFF);
      ctx.fill(s.path, 'evenodd');
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1.215 / k;
      ctx.strokeStyle = PRES_BORDER;
      ctx.stroke(s.path);
    }
    for (i = 0; i < shapes.length; i++) {
      s = shapes[i];
      if (!presOf[s.id]) continue;
      if (presOf[s.id] === presId) { picks.push(s); continue; }
      ctx.fillStyle = fillFor(s.id, s.id === hoverId);
      ctx.fill(s.path, 'evenodd');
      ctx.lineWidth = 1.86 / k;
      ctx.strokeStyle = PRES_BORDER_ON;
      ctx.stroke(s.path);
    }
    if (!picks.length) return;
    // градиент по диагонали общей рамки выбранных контуров, как в макете
    // (сверху слева светлее) — один на всех, без шва между областью и городом
    var b = picks[0].bbox.slice();   // [minX, minY, maxX, maxY] в координатах контуров
    picks.forEach(function (p) {
      b[0] = Math.min(b[0], p.bbox[0]); b[1] = Math.min(b[1], p.bbox[1]);
      b[2] = Math.max(b[2], p.bbox[2]); b[3] = Math.max(b[3], p.bbox[3]);
    });
    var g = ctx.createLinearGradient(b[0], b[1], b[2], b[3]);
    g.addColorStop(0, PRES_PICK_STOPS[0]);
    g.addColorStop(0.5, PRES_PICK_STOPS[1]);
    g.addColorStop(1, PRES_PICK_STOPS[2]);
    ctx.save();
    ctx.shadowColor = 'rgba(247,207,98,.85)';
    ctx.shadowBlur = 28 * dpr;
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = g;
    picks.forEach(function (p) { ctx.fill(p.path, 'evenodd'); });
    ctx.restore();
    ctx.lineWidth = 1.86 / k;
    ctx.strokeStyle = PRES_BORDER;
    picks.forEach(function (p) { ctx.stroke(p.path); });
  }

  /* Золотой колосок в центре регионов с сильной пшеницей — слой «rye»
     из макета 553:1480. Рисунок в поле 24x60, тот же путь стоит в легенде
     (monitoring.html / app.html, svg.is-rye). Размер постоянный,
     в пикселях кадра: при зуме колоски не раздуваются. На карте колосок
     14.4x36, с плавным золотым бликом. */
  var RYE = 'M12 1C14.6 1 15.6 4.5 15.6 8C15.6 11.5 14 14.5 12 15.5C10 14.5 8.4 11.5 8.4 8C8.4 4.5 9.4 1 12 1Z' +
    'M11.3 22.5C6 22.5 1.2 19 1.2 13.5C6.5 13.5 11.3 16.5 11.3 22.5Z' +
    'M12.7 22.5C18 22.5 22.8 19 22.8 13.5C17.5 13.5 12.7 16.5 12.7 22.5Z' +
    'M11.3 31.7C6 31.7 1.2 28.2 1.2 22.7C6.5 22.7 11.3 25.7 11.3 31.7Z' +
    'M12.7 31.7C18 31.7 22.8 28.2 22.8 22.7C17.5 22.7 12.7 25.7 12.7 31.7Z' +
    'M11.3 40.9C6 40.9 1.2 37.4 1.2 31.9C6.5 31.9 11.3 34.9 11.3 40.9Z' +
    'M12.7 40.9C18 40.9 22.8 37.4 22.8 31.9C17.5 31.9 12.7 34.9 12.7 40.9Z' +
    'M11.3 50.1C6 50.1 1.2 46.6 1.2 41.1C6.5 41.1 11.3 44.1 11.3 50.1Z' +
    'M12.7 50.1C18 50.1 22.8 46.6 22.8 41.1C17.5 41.1 12.7 44.1 12.7 50.1Z' +
    'M10.8 49H13.2V59.5H10.8Z';
  var RYE_SCALE = 0.60;                 // 24x60 -> 14.4x36 px кадра
  var ryePath = null;

  var strongWheatImage = new Image();
  strongWheatImage.onload = function () { need = true; };
  strongWheatImage.src = U.asset('assets/photos/concept/mon-strong-wheat.webp');

  function drawStrongRye() {
    if (!strongWheatImage.complete || !strongWheatImage.naturalWidth) return;
    var pulse = 1 + Math.sin(performance.now() / 650) * .06;
    var size = 32 * dpr * pulse;
    for (var i = 0; i < shapes.length; i++) {
      var shape = shapes[i]; if (!isStrong(shape.id)) continue;
      var point = toCanvas(shape.c[0], shape.c[1]);
      ctx.globalAlpha = hits && !hits[shape.id] ? .3 : 1;
      ctx.drawImage(strongWheatImage, point[0] * dpr - size / 2, point[1] * dpr - size / 2, size, size);
    }
    ctx.globalAlpha = 1;
  }

  // Geographic port positions use the same projection as regions and laboratories.
  var transportPoints = [
    [33.525,44.616], [37.78,44.72], [38.94,47.205],
    [39.42,47.10], [39.72,47.23], [30.22,59.90], [28.40,59.67]
  ];
  var transportImage = new Image();
  transportImage.onload = function () { need = true; };
  transportImage.src = U.asset('assets/concept/svg/presence-anchor.svg');
  function drawTransportPoints() {
    if (!transportImage.complete || !transportImage.naturalWidth || !geo) return;
    transportPoints.forEach(function (lonLat) {
      var world = project(lonLat[0], lonLat[1]);
      var point = toCanvas(world[0], world[1]);
      ctx.drawImage(transportImage, (point[0] - 8) * dpr, (point[1] - 8) * dpr, 16 * dpr, 16 * dpr);
    });
  }

  /** Точка филиала — ядро и три кольца свечения, как в макете (DOT_RINGS).
      Одинаковая у всех филиалов и не зависит от выбора региона.
      Отдельной отметки головного офиса на карте больше нет: в кадре
      553:1029 все 18 точек одинаковые (правка заказчика 30.09). */
  function drawDot(x, y) {
    for (var i = 0; i < DOT_RINGS.length; i++) {
      ctx.fillStyle = DOT_RINGS[i][1];
      ctx.beginPath(); ctx.arc(x, y, DOT_RINGS[i][0] * dpr, 0, 6.283); ctx.fill();
    }
  }

  /** Точки лабораторий поверх карты. */
  function drawLabs() {
    for (var i = 0; i < labs.length; i++) {
      var p = toCanvas(labs[i].x, labs[i].y);
      var x = p[0] * dpr, y = p[1] * dpr;
      if (x < -40 || y < -40 || x > MAP_W * dpr + 40 || y > MAP_H * dpr + 40) continue;
      drawDot(x, y);
    }
  }

  var rafId = 0, ryeTime = 0;                       // 0 — цикл не крутится

  /** Запустить цикл отрисовки карты (idempotent). */
  function startLoop() {
    if (rafId) return;
    fpsT = performance.now();
    rafId = requestAnimationFrame(frame);
  }

  /** Остановить цикл: раздел ушёл с экрана, данные и контуры остаются. */
  function stopLoop() {
    if (!rafId) return;
    cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function frame(now) {
    rafId = requestAnimationFrame(frame);
    if (anim) {
      var t = U.clamp((now - anim.t0) / anim.ms, 0, 1);
      var e = U.easeInOutCubic(t);
      view.z = anim.from.z + (anim.to.z - anim.from.z) * e;
      view.cx = anim.from.cx + (anim.to.cx - anim.from.cx) * e;
      view.cy = anim.from.cy + (anim.to.cy - anim.from.cy) * e;
      need = true;
      if (t >= 1) anim = null;
    }
    if (screen === 'map' && now - ryeTime > 80) { need = true; ryeTime = now; }
    if (need) { need = false; draw(); placeCall(); }
    frames++;
    if (now - fpsT > 1000) { fps = frames * 1000 / (now - fpsT); frames = 0; fpsT = now; }
  }

  /* ------------------------------ попадание ------------------------------ */

  /** Какой регион под точкой холста (координаты в пикселях макета).
      Сперва грубый отсев по рамке региона, потом точная проверка
      попадания в контур силами самого браузера. */
  function pick(px, py) {
    var k = view.k0 * view.z;
    var wx = view.cx + (px - view.ox) / k;
    var wy = view.cy + (py - view.oy) / k;
    var pad = 2 / k;
    applyTransform();
    var x = px * dpr, y = py * dpr;
    for (var i = shapes.length - 1; i >= 0; i--) {
      var b = shapes[i].bbox;
      if (wx < b[0] - pad || wx > b[2] + pad || wy < b[1] - pad || wy > b[3] + pad) continue;
      if (ctx.isPointInPath(shapes[i].path, x, y, 'evenodd')) return shapes[i].id;
    }
    return null;
  }

  /* ------------------------------ экраны раздела ------------------------------ */

  /** Открыть «Регионы присутствия»: это самостоятельный раздел стенда,
      переключателей на госмониторинг на экране нет. */
  function openPresence(id) {
    setHover(null);
    showPresCard(true);
    show('presence');
    resetView();
    selectPresence(id || presId || (pres && pres.start));
    if (!presId) drawPresence();
    need = true;
  }

  /* ------------------------------ левая колонка ------------------------------ */

  /** Лента годов под картой. Рисуем всю ленту из поля ribbon, но
      нажимаются только годы, по которым есть данные (поле years). */
  function drawYears() {
    // в новом макете карты ленты годов нет, разметку убрали —
    // функция остаётся на случай, если ленту вернут
    var box = $('years');
    if (!box) return;
    box.textContent = '';
    var ribbon = mon.ribbon && mon.ribbon.length ? mon.ribbon : mon.years;
    ribbon.forEach(function (y) {
      var has = mon.years.indexOf(y) >= 0;
      var b = el('button', 'mn-year' + (y === year ? ' is-on' : '') +
        (has ? '' : ' is-off'));
      b.type = 'button';
      b.disabled = !has;
      b.appendChild(el('span', 'yr', String(y)));
      b.appendChild(el('i', 'dot'));
      b.title = has ? String(y) : y + ': данных пока нет';
      b.addEventListener('click', function () {
        resetIdle();
        if (!has || y === year) return;
        year = y;
        recalcMax();
        drawYears();
        drawTotal();
        drawTop();
        drawHead();
        if (regionId) drawRegion();
        setUrl();
        need = true;
      });
      box.appendChild(b);
    });
  }

  function drawHead() {
    // заголовок в две строки, как в кадре: «ГОСМОНИТОРИНГ ЗЕРНА / ПШЕНИЦЫ 2026»
    $('map-title').textContent = 'Госмониторинг зерна\nпшеницы ' + year;
    $('reg-eyebrow').textContent = 'Госмониторинг пшеницы · ' + year;
  }

  /** Крупное число с единицей и подписью под ним. */
  function bigNum(box, value, unit, note) {
    box.textContent = '';
    var n = el('div', 'mn-num', value);
    if (unit) n.appendChild(el('i', null, unit));
    box.appendChild(n);
    if (note) box.appendChild(el('div', 'mn-note', note));
  }

  /** Сумма поля по обоим видам пшеницы: в плашке «Всего по России»
      цифры общие, мягкая и твёрдая вместе. Если нет ни одной — null. */
  function bothSum(field) {
    var r = mon.russia[String(year)] || {};
    var sum = null;
    KINDS.forEach(function (k) {
      var v = r[k.key] && r[k.key][field];
      if (v != null) sum = (sum || 0) + v;
    });
    return sum;
  }

  /**
   * «Всего по России» — две цифры одна под другой, как в макете:
   * валовой сбор и обследованный объём, обе по мягкой и твёрдой вместе.
   * Выбора вида пшеницы на этой плашке нет: обе цифры общие.
   * Процент ГОСТ в соседней плашке тоже общий — взвешен по
   * обследованному объёму (bothCompliance).
   */
  function drawTotal() {
    var box = $('total-body');
    box.textContent = '';
    bigNum(el2(box), fmt1(bothSum('gross')), 'тыс. т',
      'общий валовой сбор мягкой и твёрдой пшеницы');
    // слово «урожай» из подписи убрали (правка заказчика 29.09): просят,
    // чтобы мониторинг читался сам по себе за год, без отсылки к урожаю
    bigNum(el2(box), fmt1(bothSum('surveyed')), 'тыс. т',
      'обследовано зерна за ' + year + ' год');
    bigNum($('gost-body'), dec1(bothCompliance()), '%',
      'соответствует требованиям ГОСТ');
  }

  /** Доля ГОСТ по обоим видам пшеницы: проценты складывать нельзя,
      поэтому взвешиваем их по обследованному объёму. Если цифр по виду
      нет, он просто не участвует в среднем. */
  function bothCompliance() {
    var r = mon.russia[String(year)] || {};
    var sum = 0, w = 0;
    KINDS.forEach(function (k) {
      var b = r[k.key];
      if (!b || b.compliance == null || !b.surveyed) return;
      sum += b.compliance * b.surveyed;
      w += b.surveyed;
    });
    return w ? sum / w : null;
  }

  /** Вложенный блок под одну цифру плашки «Всего по России». */
  function el2(box) {
    var d = el('div', 'mn-slot');
    box.appendChild(d);
    return d;
  }

  /** Вид пшеницы общий на весь раздел: карта, список, карточка региона. */
  function setKind(k) {
    if (k !== 'soft' && k !== 'durum') return;
    if (kind === k) return;
    kind = k;
    recalcMax();
    drawTotal();
    drawTop();
    if (regionId) drawRegion();
    setUrl();
    need = true;
  }

  function norm(s) {
    return s.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, ' ').trim();
  }

  /** Пересчёт совпадений поиска: делается один раз на ввод, не на кадр. */
  function setQuery(q) {
    query = q;
    var n = norm(query);
    if (!n) { hits = null; return; }
    hits = {};
    shapes.forEach(function (s) {
      if (norm(s.name).indexOf(n) >= 0) hits[s.id] = true;
    });
  }

  /** Список: без поиска — топ-10 за год, с поиском — все совпадения. */
  function listed() {
    var arr = shapes.filter(function (s) {
      return hits ? hits[s.id] : volume(s.id) > 0;
    });
    arr.sort(function (a, b) { return volume(b.id) - volume(a.id); });
    return hits ? arr : arr.slice(0, 10);
  }

  function drawSuggestions() {
    var box = $('search-results');
    if (!box) return;
    box.textContent = '';
    box.hidden = !query;
    $('search').setAttribute('aria-expanded', query ? 'true' : 'false');
    if (!query) return;
    var arr = listed();
    box.appendChild(el('div', 'mn-result-count', 'Найдено регионов: ' + arr.length));
    if (!arr.length) box.appendChild(el('div', 'mn-result-empty', 'Ничего не найдено'));
    arr.forEach(function (s) {
      var b = el('button', 'mn-result'); b.type = 'button';
      b.appendChild(el('span', null, s.name));
      b.appendChild(el('small', null, hasMon(s.id) ? 'Проводится госмониторинг' : 'Не проводится госмониторинг'));
      b.addEventListener('click', function () {
        resetIdle(); if (global.Keyboard) global.Keyboard.close();
        box.hidden = true; $('search').setAttribute('aria-expanded', 'false');
        if (hasMon(s.id)) openRegion(s.id); else { focusOn(s.id, 2.2); pinTip(s.id); }
      });
      box.appendChild(b);
    });
  }

  function drawTop() {
    drawSuggestions();
    var arr = listed();
    $('top-head').textContent = query
      ? 'Найдено регионов: ' + arr.length
      : 'Топ-10 регионов';
    var box = $('top-body');
    box.textContent = '';
    if (!arr.length) {
      box.appendChild(el('div', 't-empty', 'Ничего не нашлось. Проверьте название региона.'));
      syncTopBar();
      return;
    }
    var top = volume(arr[0].id) || 1;
    var bars = [];
    arr.forEach(function (s, i) {
      // строка кадра: слева плашка с номером, справа название, объём и полоска
      // регион без цифр остаётся в результатах поиска, но карточки
      // у него нет: строка приглушена, а нажатие ведёт к региону
      // на карте и показывает подпись «госмониторинг не проводится»
      var mon = hasMon(s.id);
      var row = el('button', 't-row' + (s.id === hoverId ? ' is-hot' : '') +
        (mon ? '' : ' is-dim'));
      row.type = 'button';
      row.appendChild(el('span', 't-rk', String(i + 1)));
      var main = el('div', 't-main');
      var line = el('div', 't-line');
      line.appendChild(el('span', 'nm', s.name));
      var v = volume(s.id);
      line.appendChild(el('span', 'vl', v > 0 ? fmt1(v) + ' тыс. т'
        : noDataLabel(s.id)));
      main.appendChild(line);
      var bar = el('div', 't-bar');
      var fill = el('i');
      bar.appendChild(fill);
      main.appendChild(bar);
      row.appendChild(main);
      bars.push([fill, v / top]);
      row.addEventListener('click', function () {
        resetIdle();
        if (mon) { openRegion(s.id); return; }
        focusOn(s.id, 2.2);
        pinTip(s.id);
      });
      row.addEventListener('pointerenter', function () { setHover(s.id); });
      row.addEventListener('pointerleave', function () { setHover(null); });
      box.appendChild(row);
    });
    setTimeout(function () {
      bars.forEach(function (b) { b[0].style.width = (b[1] > 0 ? Math.max(3, b[1] * 100) : 0) + '%'; });
    }, 30);
    syncTopBar();
  }

  /* Своя полоса прокрутки «Топ-10»: нативную браузер на стенде рисует
     по-своему, а в кадре это тонкая зелёная линия у правого края панели
     (место и цвета — в styles/monitoring.css). Полоса ничего не ловит,
     список листается пальцем и колесом. */
  function syncTopBar() {
    var box = $('top-body'), bar = $('top-sb');
    if (!box || !bar) return;
    var thumb = bar.firstElementChild;
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

  /** Подпись у пальца, которая гаснет сама: по тапу на регион,
      где госмониторинг не проводится, карточка не открывается,
      и человеку надо объяснить, почему ничего не случилось. */
  var tipTimer = null;

  function pinTip(id) {
    setHover(id);
    if (tipTimer) clearTimeout(tipTimer);
    tipTimer = setTimeout(function () {
      tipTimer = null;
      if (hoverId === id) setHover(null);
    }, 2600);
  }

  function setHover(id) {
    // на регионах присутствия регион без филиала неактивен: без подсветки
    // и без подписи (правки 25.09 — «нет данных» не пишем)
    if (id && screen === 'presence' && !presOf[id]) id = null;
    if (hoverId === id) return;
    if (tipTimer) { clearTimeout(tipTimer); tipTimer = null; }
    // курсор «рука» только там, где есть что открыть
    var c = $('map');
    if (c) {
      c.style.cursor = (!id || screen === 'presence' || hasMon(id))
        ? 'pointer' : 'default';
    }
    hoverId = id;
    need = true;
    var tip = $('map-tip');
    var s = id && shapes.filter(function (x) { return x.id === id; })[0];
    if (!s) { tip.classList.remove('is-on'); }
    else {
      tip.textContent = s.name;
      if (screen === 'presence') {
        tip.appendChild(el('b', null, 'есть филиал'));
      } else {
        var v = volume(id);
        var lab = v > 0 ? fmt1(v) + ' тыс. т' : noDataLabel(id);
        if (lab) tip.appendChild(el('b', null, lab));
      }
      var p2 = toCanvas(s.c[0], s.c[1]);
      // Подсказка лежит под панелями, поэтому целиком держим её в свободном
      // поле карты: правее левой колонки (на присутствии — левее карточки
      // региона) и ниже шапки. Ширину меряем после подстановки текста.
      var half = tip.offsetWidth / 2, th = tip.offsetHeight;
      var box = screen === 'presence'
        ? { l: 24, r: 1346, t: 190 }
        : { l: 602, r: MAP_W - 24, t: 300 };
      tip.style.left = U.clamp(p2[0], box.l + half, Math.max(box.l + half, box.r - half)) + 'px';
      tip.style.top = U.clamp(p2[1], box.t + th * 1.4, MAP_H - 40) + 'px';
      tip.classList.add('is-on');
    }
    // подсветить строку списка
    var rows = $('top-body').children;
    var arr = listed();
    for (var i = 0; i < rows.length && i < arr.length; i++) {
      rows[i].classList.toggle('is-hot', arr[i].id === id);
    }
  }

  /* ------------------------------ экран региона ------------------------------ */

  /** Кнопки «Мягкая пшеница / Твёрдая пшеница» в подписи региона: вид
      пшеницы общий на весь раздел (карта, «Топ-10», карточка — см. setKind
      и комментарий над ней), но выбирать его теперь можно и прямо тут,
      по клику (правка заказчика 29.09, слайд 1 презентации). Вида, по
      которому у региона в этом году нет цифр, кнопка не открывает —
      как и везде в разделе, «нет данных» не пишем, а просто гасим
      кнопку (тот же приём, что у mn-year.is-off и card-key.is-off). */
  function appendKindButtons(box, id) {
    KINDS.forEach(function (k, i) {
      if (i > 0) box.appendChild(el('span', 'mn-kind-sep', ' / '));
      var has = !!rec(id, k.key);
      var btn = el('button', 'mn-kind-btn' +
        (kind === k.key ? ' is-on' : '') + (has ? '' : ' is-off'), k.label);
      btn.type = 'button';
      btn.disabled = !has;
      btn.addEventListener('click', function () {
        resetIdle();
        setKind(k.key);
      });
      box.appendChild(btn);
    });
  }

  /** Метки-цифры вокруг зерна: кружок и подпись над ним. */
  function drawMarks(b) {
    var box = $('marks');
    if (!box) return;
    box.textContent = '';
    MARKS.forEach(function (m) {
      var spec = specByKey(m.key);
      var off = !b || b[m.key] == null;
      var lab = el('div', 'mn-mark-lab', m.label);
      lab.style.left = m.lx + 'px';
      lab.style.top = m.ly + 'px';
      lab.style.width = m.lw + 'px';
      if (off) lab.style.opacity = '.45';
      box.appendChild(lab);

      var on = !off && specKey === m.key;
      var btn = el('button', 'mn-mark' + (off ? ' is-off' : '') + (on ? ' is-on' : ''),
        String(m.n));
      btn.type = 'button';
      btn.style.left = m.x + 'px';
      btn.style.top = m.y + 'px';
      btn.title = off ? spec.name + ': по региону данных нет'
        : spec.name + ' — ' + dec1(b[m.key]) + ' ' + spec.unit;
      btn.addEventListener('click', function () {
        resetIdle();
        showSpec(m.key);
      });
      box.appendChild(btn);
    });
  }

  function drawRegion() {
    var s = shapes.filter(function (x) { return x.id === regionId; })[0];
    if (!s) return;
    fixSpecKey(rec(regionId, kind));
    $('reg-title').textContent = s.name;
    drawHead();

    var b = rec(regionId, kind);
    if (!b) { kind = 'soft'; b = rec(regionId, 'soft'); }
    if (!b) { drawMarks(null); drawEmptyRegion(); return; }
    drawMarks(b);

    // подпись строим из узлов, не из textContent: первая часть — кликабельные
    // кнопки вида пшеницы, дальше год и (если есть) пометка про сильную
    // пшеницу — как раньше, через разделитель, чтобы « · » не повисло в конце
    var sub = $('reg-sub');
    sub.textContent = '';
    appendKindButtons(sub, regionId);
    sub.appendChild(document.createTextNode('  ·  ' + year +
      (b.strong && strongOn() ? '  ·  регион с сильной пшеницей' : '')));

    // было «Урожай 2026» — то же самое слово убрали и здесь (см. выше)
    bigNum($('gross-body'), fmt1(b.gross), 'тыс. т');
    bigNum($('surv-body'), fmt1(b.surveyed), 'тыс. т',
      b.cover != null ? dec1(b.cover) + ' % валового сбора' : '');

    // классы: название, объём в тоннах от обследованного и доля.
    // Полосок в кадре нет — только числа. Классы, которых в регионе
    // не нашли, не показываем: пустых строк в кадре нет.
    $('cls-sub').textContent = '';
    // отметку о соответствии/несоответствии ГОСТу из карточки региона убрали
    // (правка заказчика 29.09, слайд 1 презентации): в интерфейсе региона
    // её быть не должно. Общий процент по стране — отдельная плашка слева
    // («Всего по России», drawTotal/bothCompliance), её это не касается.
    $('cls-foot').style.display = 'none';
    var cls = $('cls-body');
    cls.textContent = '';
    (b.classes || []).forEach(function (p, i) {
      if (!p) return;
      var row = el('div', 'c-row');
      var name = el('div', 'c-name');
      name.appendChild(el('b', null, 'Класс ' + (i + 1)));
      var t = (b.classT && b.classT[i]) || b.surveyed * p / 100;
      name.appendChild(el('span', null, fmt1(t) + ' тыс. т'));
      row.appendChild(name);
      // мелкие доли округляются до десятых, крупные — до целых процентов
      row.appendChild(el('div', 'c-pct',
        (p < 10 ? dec1(p) : String(Math.round(p))) + ' %'));
      cls.appendChild(row);
    });
    // плашка под панелью классов — только у регионов с сильной пшеницей
    // и только на мягкой: сильная пшеница — класс именно мягкой
    strongNote(kind === 'soft' && isStrong(regionId));
    drawKey(b);
    drawSpec(b);
  }

  /** Показать или спрятать плашку «Регион с сильной пшеницей».
      Ключ monitoring.strongNote в config.json — общий выключатель
      упоминаний сильной пшеницы в карточке региона: при false нет
      ни плашки, ни подписи в шапке (пороги белка и клейковины
      уточняют аналитики заказчика). Звёздочек на карте и легенды
      это не касается. */
  function strongNote(on) {
    var box = $('cls-strong');
    if (!box) return;
    box.classList.toggle('is-on', strongOn() && !!on);
  }

  /** Общий выключатель упоминаний сильной пшеницы в карточке региона. */
  function strongOn() {
    return !CFG.monitoring || CFG.monitoring.strongNote !== false;
  }

  /** Панель «Основные показатели» в правой колонке. По решению
      заказчика справа остаются только классы зерна, а выбранный
      показатель выводится в левой плашке; ключ monitoring.specsPanel
      в config.json возвращает раскладку из двух панелей. */
  function specsOn() {
    return !!(CFG.monitoring && CFG.monitoring.specsPanel);
  }

  /* --------------------- основные показатели зерна ---------------------
     Плашка «Основные показатели» в левой колонке — переключатель: справа
     вместо «Классов зерна» показывается разбор пяти средневзвешенных
     показателей. Те же пять показателей вынесены метками 1–5 вокруг
     зерна: нажатие на метку открывает тот же разбор на нужной строке. */

  /** Ведущий показатель плашки: в макете это белок. */
  var KEY_SPEC = 'protein';

  function specByKey(k) {
    for (var i = 0; i < SPECS.length; i++) if (SPECS[i].key === k) return SPECS[i];
    return SPECS[0];
  }

  /** Если выбранного показателя у региона нет, берём первый, который
      есть: иначе в плашке всегда стоял бы прочерк. */
  function fixSpecKey(b) {
    if (!b || b[specKey] != null) return;
    for (var i = 0; i < SPECS.length; i++) {
      if (b[SPECS[i].key] != null) { specKey = SPECS[i].key; return; }
    }
  }

  /** Следующий показатель по кругу — нажатие на саму плашку. */
  function nextSpec() {
    var b = rec(regionId, kind);
    if (!b) return;
    var i = 0;
    for (var j = 0; j < SPECS.length; j++) if (SPECS[j].key === specKey) i = j;
    for (var k = 1; k <= SPECS.length; k++) {
      var s = SPECS[(i + k) % SPECS.length];
      if (b[s.key] != null) { showSpec(s.key); return; }
    }
  }

  /** Есть ли у региона хоть один основной показатель. */
  function hasSpec(b) {
    if (!b) return false;
    for (var i = 0; i < SPECS.length; i++) if (b[SPECS[i].key] != null) return true;
    return false;
  }

  /** Левая плашка: заголовок и крупное число ВЫБРАННОГО показателя.
      Метки 1–5 вокруг зерна выводят свои значения сюда; смена значения
      подсвечивается коротким появлением (класс is-new, анимация в CSS). */
  function drawKey(b) {
    var box = $('key-body');
    if (!box) return;
    var s = specByKey(specKey);
    var v = b ? b[specKey] : null;
    bigNum(box, v != null ? dec1(v) : '—', v != null ? s.unit : '',
      s.name.toLowerCase());
    box.classList.remove('is-new');
    // перезапуск анимации: браузеру нужно заметить снятие класса
    void box.offsetWidth;
    box.classList.add('is-new');
    // показателей по региону нет — нажимать плашку не на что
    var key = $('card-key');
    key.disabled = !hasSpec(b);
    key.classList.toggle('is-off', key.disabled);
    // подсветка плашки постоянная, как в макете: панелями она
    // больше не переключает, а только выбирает белок
    key.classList.toggle('is-pick', !key.disabled);
  }

  /** Панель «Основные показатели» под классами зерна: пять строк
      с кружком-номером метки, названием и значением. Панель видна
      сразу, вместе с классами; если показателей по региону нет —
      прячем её целиком, метки вокруг зерна и так приглушены. */
  function drawSpec(b) {
    var box = $('spec-body');
    if (!box) return;
    var any = hasSpec(b) && specsOn();
    $('card-spec').classList.toggle('is-off', !any);
    // колонка из одной панели: классы стоят на макетном месте
    var col = document.querySelector('#sec-monitoring .mn-right') ||
      document.querySelector('.mn-right');
    if (col) col.classList.toggle('is-solo', !specsOn());
    if (!any) { box.textContent = ''; return; }

    $('spec-sub').textContent = 'Средневзвешенно по обследованному объёму, ' +
      fmt1(b.surveyed) + ' тыс. т';
    box.textContent = '';
    SPECS.forEach(function (s) {
      var v = b[s.key];
      if (v == null) return;            // показателя по региону нет — строки нет
      var row = el('button', 'k-row' + (s.key === specKey ? ' is-on' : ''));
      row.type = 'button';
      var name = el('div', 'k-name');
      name.appendChild(el('span', 'k-num', String(s.n)));
      name.appendChild(el('b', null, s.name));
      row.appendChild(name);
      row.appendChild(el('div', 'k-val', dec1(v) + ' ' + s.unit));
      row.addEventListener('click', function () { resetIdle(); showSpec(s.key); });
      box.appendChild(row);
    });
    $('spec-foot').textContent = specByKey(specKey).hint;
  }

  /** Выбрать показатель: по метке у зерна, по строке панели или
      по плашке «Основные показатели» слева. Классы зерна при этом
      остаются на месте — панели больше не подменяют друг друга. */
  function showSpec(key) {
    specKey = key;
    drawRegion();
  }

  function drawEmptyRegion() {
    // Два случая: за выбранный год цифр по региону нет вовсе —
    // госмониторинг там не проводится; или есть только по мягкой,
    // а открыта твёрдая — её в регионе не возделывают.
    var noMon = !hasMon(regionId);
    var note = noMon ? 'Госмониторинг не проводится'
      : 'Твёрдую пшеницу в регионе не возделывают';
    var sub = $('reg-sub');
    sub.textContent = '';
    if (noMon) {
      // ни по одному виду цифр нет — переключать нечего, кнопки не нужны
      sub.appendChild(document.createTextNode('Госмониторинг в этом регионе не проводится'));
    } else {
      appendKindButtons(sub, regionId);
      sub.appendChild(document.createTextNode('  ·  ' + note));
    }
    bigNum($('gross-body'), '—', '', note);
    bigNum($('surv-body'), '—', '', note);
    $('cls-sub').textContent = note;
    $('cls-body').textContent = '';
    $('cls-foot').style.display = 'none';
    strongNote(false);
    // цифр по региону нет — панель показателей просто не показываем
    drawKey(null);
    $('card-spec').classList.add('is-off');
    $('card-cls').classList.remove('is-off');
    $('spec-body').textContent = '';
    $('spec-foot').textContent = '';
  }

  /* --------------------- экран «Регионы присутствия» --------------------- */

  /** Карточка филиала закрывает восток карты, поэтому её можно убрать
      крестиком: под ней открываются Приморский и Хабаровский края.
      Вместе с карточкой снимаем и выбор региона — иначе на карте
      осталась бы выноска, показывающая на спрятанное окно. */
  function showPresCard(on) {
    ROOT.classList.toggle('pres-card-off', !on);
  }

  function closePresCard() {
    showPresCard(false);
    presId = null;
    $('map-call').classList.remove('is-on');
    setUrl();
    need = true;
  }

  /** Запись о присутствии: регион с филиалом или головной офис ('hq'). */
  function presRec(id) {
    if (!id || !pres) return null;
    return id === 'hq' ? (pres.hq || null) : (pres.regions[id] || null);
  }

  function selectPresence(id) {
    id = id === 'hq' ? (pres && pres.hq ? 'hq' : null) : (id && presOf[id]);
    if (!id) return;
    presId = id;
    showPresCard(true);
    drawPresence();
    placeCall();
    setUrl();
    need = true;
  }

  /** Контакты филиала внизу карточки, как в макете 553:1029: адрес
      строкой (адресов несколько — списком), пустая строка, телефоны
      по одному в строке и почта с подчёркиванием. Ссылкой почта
      не сделана: на стенде почтовой программы нет. */
  function drawContacts(box, c) {
    var addr = (c && c.addresses) || [], phones = (c && c.phones) || [];
    var mails = (c && c.emails) || [];
    if (!addr.length && !phones.length && !mails.length) return;
    var wrap = el('div', 'mn-pres-contacts');
    if (addr.length === 1) wrap.appendChild(el('div', 'mn-pres-addr', 'Адрес: ' + addr[0]));
    else if (addr.length) {
      var list = el('div', 'mn-pres-addr');
      list.appendChild(el('div', null, 'Адреса:'));
      addr.forEach(function (a) { list.appendChild(el('div', 'mn-pres-li', '• ' + a)); });
      wrap.appendChild(list);
    }
    if (phones.length || mails.length) {
      var tel = el('div', 'mn-pres-tel');
      phones.forEach(function (t) { tel.appendChild(el('div', null, t)); });
      mails.forEach(function (m) { tel.appendChild(el('div', 'mn-pres-mail', m)); });
      wrap.appendChild(tel);
    }
    box.appendChild(wrap);
  }

  function drawTransportSummary() {
    var box = $('pres-transport');
    if (!box) return;
    box.textContent = '';
    box.scrollTop = 0;
    var icons = {
      road: 'assets/concept/svg/presence-road.svg',
      port: 'assets/concept/svg/presence-port.svg',
      sea: 'assets/concept/svg/presence-port.svg',
      rail: 'assets/concept/svg/presence-rail.svg',
      warehouse: 'assets/concept/svg/presence-warehouse.svg'
    };
    var branch = presRec(presId);
    var items = (branch && branch.transportSummary) || [];
    if (!items.length) {
      box.appendChild(el('section', 'mn-panel mn-transport-empty', 'Данные об инфраструктуре этого филиала не предоставлены'));
      return;
    }
    items.forEach(function (item) {
      var card = el('section', 'mn-panel mn-transport-card');
      if (icons[item.key]) {
        var icon = new Image();
        icon.src = U.asset(icons[item.key]); icon.alt = ''; icon.width = icon.height = 40;
        card.appendChild(icon);
      } else card.classList.add('is-no-icon');
      var row = el('div', 'mn-transport-row');
      row.appendChild(el('b', 'mn-transport-value', String(item.count)));
      row.appendChild(el('span', 'mn-transport-label', item.label));
      card.appendChild(row); box.appendChild(card);
    });
  }

  function drawPresence() {
    drawTransportSummary();
    var box = $('card-pres');
    box.textContent = '';
    box.scrollTop = 0;
    var p = presRec(presId);
    if (!p) {
      box.appendChild(el('div', 'mn-pres-body',
        'Выберите подсвеченный регион на карте.'));
      syncPresBar();
      return;
    }
    box.appendChild(el('h2', 'mn-pres-name', p.name));
    if (p.areas && p.areas.length) {
      box.appendChild(el('strong', 'mn-pres-areas-title', 'Основные направления'));
      box.appendChild(el('div', 'mn-pres-body', p.areas.map(function (area) { return '• ' + area; }).join('\n')));
    }
    if ((!p.areas || !p.areas.length) && p.todo) {
      box.appendChild(el('div', 'mn-pres-todo', p.todo));
    }
    // поля note и about в файле — комментарии для разработчика, на экран
    // они не идут; сноску про лаборатории под карточкой убрали (25.09)
    drawContacts(box, p.contacts);
    syncPresBar();
  }

  /* Карточка филиала не выше кадра: длинная (три адреса Красноярского
     филиала) листается пальцем. Полоса прокрутки своя, как у «Топ-10»:
     лежит поверх правого края карточки и ничего не ловит. */
  function syncPresBar() {
    var box = $('card-pres'), bar = $('pres-sb');
    if (!box || !bar) return;
    var h = box.clientHeight, all = box.scrollHeight;
    if (!h || all <= h + 1) { bar.classList.add('is-off'); return; }
    bar.classList.remove('is-off');
    bar.style.top = (box.offsetTop + 32) + 'px';
    bar.style.height = (h - 64) + 'px';
    var thumb = bar.firstElementChild;
    var track = h - 64;
    var th = Math.max(40, Math.round(track * h / all));
    var max = all - h;
    thumb.style.height = th + 'px';
    thumb.style.top = (max > 0 ? Math.round((track - th) * (box.scrollTop / max)) : 0) + 'px';
  }

  /** Выноска с названием у выбранного региона: подпись и линия к контуру. */
  function placeCall() {
    var call = $('map-call');
    if (!call) return;
    var p = screen === 'presence' && presRec(presId);
    var s = p && presId !== 'hq' && shapes.filter(function (x) { return x.id === presId; })[0];
    var at = presId === 'hq' ? hq : (s && { x: s.c[0], y: s.c[1] });
    if (!p || !at) { call.classList.remove('is-on'); return; }
    var c = toCanvas(at.x, at.y);
    // Кадр 553:1029: подпись слева от точки филиала (её левый край на
    // 257 px левее точки, верх на 78 выше), линия идёт под подписью
    // на 51 px ниже её верха, за 37 px до точки ломается и доходит до
    // неё наискось. У левого края кадра всё зеркально — подпись справа.
    var right = c[0] < 300;
    var left = U.clamp(right ? c[0] + 70 : c[0] - 257, 24, MAP_W - 300);
    var top = U.clamp(c[1] - 78, 80, MAP_H - 140);
    call.classList.toggle('is-right', right);
    call.style.left = left + 'px';
    call.style.top = top + 'px';
    var dx = c[0] - left, dy = c[1] - top;          // точка в системе подписи
    var knee = right ? dx + 37 : dx - 37;
    var end = right ? 150 : 0;             // под подписью, до её дальнего края
    var path = call.querySelector('.mn-call-line path');
    if (path) {
      path.setAttribute('d', 'M' + dx.toFixed(1) + ' ' + dy.toFixed(1) +
        'L' + knee.toFixed(1) + ' 51H' + end);
    }
    $('call-name').textContent = p.name;
    call.classList.add('is-on');
  }

  /* ------------------------------ переходы ------------------------------ */

  function syncRegionVideo() {
    var video = $('scene-video');
    if (!video) return;
    if (live && screen === 'region') {
      if (!video.getAttribute('src')) video.src = U.asset(SCENE_VIDEO);
      var playing = video.play();
      if (playing && playing.catch) playing.catch(function () {});
    } else video.pause();
  }

  function show(name) {
    screen = name;
    syncRegionVideo();
    if (global.Keyboard) global.Keyboard.close();
    $('scr-map').classList.toggle('is-on', name === 'map');
    $('scr-region').classList.toggle('is-on', name === 'region');
    $('scr-presence').classList.toggle('is-on', name === 'presence');
    // класс состояния — на обёртке раздела, а не на body: в едином
    // приложении body общий на все разделы
    ROOT.classList.toggle('on-map', name === 'map');
    ROOT.classList.toggle('on-region', name === 'region');
    ROOT.classList.toggle('on-presence', name === 'presence');
    if (name !== 'presence') $('map-call').classList.remove('is-on');
    setUrl();
  }

  function openRegion(id) {
    // карточка открывается только у субъекта с цифрами за выбранный год
    if (!shapes.some(function (s) { return s.id === id; })) return;
    // регион без цифр за этот год карточку не открывает: ни тапом,
    // ни из списка, ни адресом ?region=
    if (!hasMon(id)) return;
    regionId = id;
    if (!rec(id, kind)) kind = 'soft';
    // карточка всегда открывается на белке — метка 1, как в макете
    specKey = KEY_SPEC;
    drawRegion();
    show('region');
    need = true;
  }

  function backToMap() {
    regionId = null;
    show('map');
    setHover(null);
    resetView();
    need = true;
  }

  function setUrl() {
    var p = { year: year };
    var palette = ROOT.getAttribute('data-palette');
    if (palette && palette !== 'slate') p.palette = palette;
    if (screen === 'presence') {
      p.view = 'presence';
      if (presId) p.region = presId;     // hq — головной офис
    } else if (screen === 'region' && regionId) {
      p.region = regionId;
      if (kind !== 'soft') p.kind = kind;
    }
    // в едином приложении у регионов присутствия своё имя раздела
    // в адресе — ?section=presence, отдельный view там уже не нужен
    if (global.Shell) {
      var pres0 = screen === 'presence';
      if (pres0) delete p.view;
      global.Shell.url('monitoring', p, pres0 ? 'presence' : null);
      return;
    }
    if (!global.history || !history.replaceState) return;
    var q = [];
    for (var k in p) q.push(k + '=' + encodeURIComponent(p[k]));
    if (idleOff) q.push('idle=0');
    history.replaceState(null, '', '?' + q.join('&'));
  }

  /* ------------------------------ аттрактор ------------------------------ */

  /* В едином приложении таймер бездействия один на все разделы и живёт
     в src/shell.js — здесь мы только сообщаем ему, что был отклик. */

  function resetIdle() {
    if (global.Shell) { global.Shell.ping(); return; }
    if (idleTimer) clearTimeout(idleTimer);
    if (idleOff) { idleTimer = null; return; }
    idleTimer = setTimeout(toAttractor, (CFG.attractorTimeoutSec || 90) * 1000);
  }

  function toAttractor() {
    if (global.Keyboard) global.Keyboard.close();
    $('search').value = '';
    setQuery('');
    kind = 'soft';
    year = mon.years[mon.years.length - 1];
    recalcMax();
    drawYears();
    drawTotal();
    drawTop();
    drawHead();
    backToMap();
    resetIdle();
  }

  /* ------------------------------ жесты карты ------------------------------
     Стенд сенсорный, мыши нет. Все жесты — pointer-события на холсте
     (у холста touch-action: none, поэтому браузер отдаёт касания нам;
     щипковый зум всей страницы при этом по-прежнему запрещён блоком
     kiosk в src/util.js):
       один палец  — перетаскивание карты; касание без движения (сдвиг
                     не больше TAP_SLOP) выбирает регион;
       два пальца  — щипок: масштаб меняется вокруг точки между пальцами,
                     и карта едет вслед за ней. После щипка касание
                     уже не считается выбором региона, даже если один
                     палец остался и отпущен без движения. */

  var ptrs = {};                       // активные касания: id -> [x, y] в px кадра
  var gest = null;                     // текущий жест: перетаскивание или щипок

  function ptrIds() { return Object.keys(ptrs); }

  function startPinch() {
    var ids = ptrIds(), a = ptrs[ids[0]], b = ptrs[ids[1]];
    var mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    var k = view.k0 * view.z;
    anim = null;
    setHover(null);
    gest = {
      pinch: true,
      d: Math.max(1, Math.hypot(a[0] - b[0], a[1] - b[1])),
      z: view.z,
      // точка мира под серединой между пальцами
      wx: view.cx + (mx - view.ox) / k,
      wy: view.cy + (my - view.oy) / k
    };
  }

  function startDrag(p, moved) {
    gest = { x: p[0], y: p[1], cx: view.cx, cy: view.cy, moved: moved || 0 };
  }

  function bindMap() {
    var c = $('map');

    function local(e) {
      var r = c.getBoundingClientRect();
      return [(e.clientX - r.left) / (r.width / MAP_W),
              (e.clientY - r.top) / (r.height / MAP_H)];
    }

    c.addEventListener('pointerdown', function (e) {
      resetIdle();
      // первое касание нового жеста: забываем касания, у которых
      // потерялось отпускание (палец ушёл за край экрана и т. п.)
      if (e.isPrimary) ptrs = {};
      ptrs[e.pointerId] = local(e);
      try { c.setPointerCapture(e.pointerId); } catch (er) { /* касание уже снято */ }
      var n = ptrIds().length;
      if (n === 1) startDrag(ptrs[e.pointerId]);
      else if (n === 2) startPinch();
    });

    c.addEventListener('pointermove', function (e) {
      var p = local(e);
      if (!ptrs[e.pointerId]) {
        // мышь без нажатия (отладка на компьютере) — подпись под курсором
        if (e.pointerType === 'mouse' && !ptrIds().length) setHover(pick(p[0], p[1]));
        return;
      }
      ptrs[e.pointerId] = p;
      if (!gest) return;
      var k;
      if (gest.pinch) {
        var ids = ptrIds();
        if (ids.length < 2) return;
        var a = ptrs[ids[0]], b = ptrs[ids[1]];
        var mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
        var d = Math.max(1, Math.hypot(a[0] - b[0], a[1] - b[1]));
        view.z = U.clamp(gest.z * d / gest.d, zoomMin(), ZOOM_MAX);
        k = view.k0 * view.z;
        // точка мира, взятая между пальцами, остаётся между пальцами
        view.cx = gest.wx - (mx - view.ox) / k;
        view.cy = gest.wy - (my - view.oy) / k;
        clampView();
        need = true;
        return;
      }
      k = view.k0 * view.z;
      var dx = p[0] - gest.x, dy = p[1] - gest.y;
      gest.moved = Math.max(gest.moved, Math.abs(dx) + Math.abs(dy));
      if (gest.moved > TAP_SLOP) {
        anim = null;
        view.cx = gest.cx - dx / k;
        view.cy = gest.cy - dy / k;
        clampView();
        need = true;
        setHover(null);
      }
    });

    c.addEventListener('pointerleave', function (e) {
      if (e.pointerType === 'mouse') setHover(null);
    });

    function release(e) {
      var p = ptrs[e.pointerId] ? local(e) : null;
      var was = gest;
      delete ptrs[e.pointerId];
      var left = ptrIds();
      if (left.length === 1 && was && was.pinch) {
        // щипок закончен, один палец остался — дальше он тянет карту
        startDrag(ptrs[left[0]], TAP_SLOP + 1);
        return;
      }
      if (left.length) return;
      gest = null;
      // выбор региона — только чистое касание одним пальцем без движения
      if (e.type !== 'pointerup' || !p || !was || was.pinch || was.moved > TAP_SLOP) return;
      var id = pick(p[0], p[1]);
      if (id && screen === 'presence') selectPresence(id);
      // карточка открывается только там, где есть цифры; иначе
      // показываем подпись «госмониторинг не проводится»
      else if (id && screen === 'map') {
        if (hasMon(id)) openRegion(id); else pinTip(id);
      }
    }

    c.addEventListener('pointerup', release);
    c.addEventListener('pointercancel', release);

    // колесо мыши: тот же приём, что и в щипке — точка мира под курсором
    // остаётся под курсором, только жест один, без второго пальца.
    // preventDefault нужен, чтобы страница за карточкой не проскроллилась.
    c.addEventListener('wheel', function (e) {
      e.preventDefault();
      resetIdle();
      anim = null;
      setHover(null);
      var p = local(e);
      var k = view.k0 * view.z;
      var wx = view.cx + (p[0] - view.ox) / k;
      var wy = view.cy + (p[1] - view.oy) / k;
      // строчный/страничный режим колеса переводим в пиксели, чтобы шаг
      // не скакал между браузерами (Firefox отдаёт deltaMode line, не pixel)
      var dy = e.deltaMode === 1 ? e.deltaY * WHEEL_LINE_PX : e.deltaY;
      view.z = U.clamp(view.z * Math.exp(-dy * WHEEL_ZOOM_SENS), zoomMin(), ZOOM_MAX);
      k = view.k0 * view.z;
      view.cx = wx - (p[0] - view.ox) / k;
      view.cy = wy - (p[1] - view.oy) / k;
      clampView();
      need = true;
    }, { passive: false });

    $('zoom-in').addEventListener('click', function () {
      resetIdle();
      zoomTo(view.z * ZOOM_STEP);
    });
    $('zoom-out').addEventListener('click', function () {
      resetIdle();
      zoomTo(view.z / ZOOM_STEP);
    });
    $('zoom-reset').addEventListener('click', function () {
      resetIdle();
      resetView();
    });
  }

  /* ------------------------------ старт ------------------------------ */

  function recalcMax() {
    maxVol = 1;
    shapes.forEach(function (s) { maxVol = Math.max(maxVol, volume(s.id)); });
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

  function fail(msg) {
    $('loading').textContent = msg;
    $('loading').classList.remove('hidden');
    U.revealPage();
  }

  function boot(active) {
    live = active !== false;
    ctx = $('map').getContext('2d');
    $('scene-video').poster = U.asset(SCENE_IMG);
    $('scene-video').muted = true;

    return U.loadJSON('inline-config', 'config.json').then(function (cfg) {
      CFG = cfg || CFG;
      var green = (CFG.themes && CFG.themes.green) || {};
      applyColors(green.colors);
    }).catch(function () { /* без конфига живём со значениями по умолчанию */
    }).then(function () {
      return Promise.all([
        U.loadJSON('inline-regions', 'assets/geo/russia-regions.json'),
        U.loadJSON('inline-monitoring', 'data/monitoring.json'),
        // без файла филиалов второй таб просто пустой — раздел работает
        U.loadJSON('inline-presence', 'data/presence.json').catch(function (e) {
          if (global.console) {
            console.warn('Не загрузить data/presence.json — вкладка ' +
              '«Регионы присутствия» будет пустой:', e);
          }
          return { regions: {} };
        })
      ]);
    }).then(function (res) {
      geo = res[0];
      mon = res[1];
      pres = res[2];
      mon.regions.forEach(function (r) { byId[r.id] = r; });

      buildShapes();
      buildLabs();
      fitStage();

      var q = U.query('monitoring');
      if (q.idle === '0') idleOff = true;
      var palette = q.palette || (CFG.monitoring && CFG.monitoring.palette) || 'figma';
      var palettes = { figma: [[20,68,52],[42,53,51]], slate: [[66,89,101],[43,49,56]], navy: [[41,73,111],[37,43,60]], earth: [[105,91,69],[52,47,43]] };
      if (!palettes[palette]) palette = 'figma';
      ROOT.setAttribute('data-palette', palette);
      C_DATA = palettes[palette][0]; C_NONE = palettes[palette][1];
      year = mon.years.indexOf(parseInt(q.year, 10)) >= 0
        ? parseInt(q.year, 10)
        : mon.years[mon.years.length - 1];
      if (q.kind === 'durum') kind = 'durum';
      recalcMax();

      drawYears();
      drawHead();
      drawTotal();
      if (q.q) { setQuery(q.q); $('search').value = q.q; }
      drawTop();
      bindMap();

      $('top-body').addEventListener('scroll', syncTopBar, { passive: true });

      var suggestions = el('div', 'mn-results');
      suggestions.id = 'search-results'; suggestions.hidden = true;
      suggestions.setAttribute('aria-label', 'Результаты поиска регионов');
      $('search').parentNode.appendChild(suggestions);
      $('search').setAttribute('aria-controls', 'search-results');
      $('search').setAttribute('aria-expanded', 'false');
      drawSuggestions();
      $('search').addEventListener('input', function () {
        resetIdle();
        setQuery(this.value.trim());
        drawTop();
        need = true;
      });
      $('search').addEventListener('focus', drawSuggestions);
      $('search').addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { $('search-results').hidden = true; this.setAttribute('aria-expanded', 'false'); return; }
        if (e.key !== 'Enter') return;
        $('search-results').hidden = true; this.setAttribute('aria-expanded', 'false');
        if (global.Keyboard) global.Keyboard.close();
        openFirst();
      });
      $('back-map').addEventListener('click', function () { resetIdle(); backToMap(); });
      $('pres-close').addEventListener('click', function () {
        resetIdle();
        closePresCard();
      });
      // плашка «Основные показатели» слева листает показатели по кругу
      $('card-key').addEventListener('click', function () { resetIdle(); nextSpec(); });
      ['home-btn', 'home-btn-reg'].forEach(function (id) {
        $(id).addEventListener('click', function () {
          U.goSection('story', { screen: 'start' });
        });
      });
      // с регионов присутствия — «В Центр», в центр управления
      // презентации, как на экранах «Пути зерна» (макет 553:1029)
      $('hub-btn').addEventListener('click', function () {
        U.goSection('story', { screen: 'hub' });
      });
      // вкладки под заголовком: госмониторинг и регионы присутствия
      Array.prototype.forEach.call(ROOT.querySelectorAll('.mn-tab'), function (b) {
        b.addEventListener('click', function () {
          resetIdle();
          var v = b.getAttribute('data-view');
          if (v === 'presence' && screen !== 'presence') openPresence();
          else if (v === 'map' && screen !== 'map') backToMap();
        });
      });
      $('card-pres').addEventListener('scroll', syncPresBar, { passive: true });
      drawPresCount();

      global.addEventListener('resize', fitStage);
      ['pointerdown', 'pointermove', 'keydown', 'wheel'].forEach(function (ev) {
        document.addEventListener(ev, resetIdle, { passive: true });
      });

      // что открыть при старте: карта, карточка региона или регионы присутствия
      if (q.view === 'presence') {
        show('presence');
        selectPresence(q.region || pres.start);
        if (!presId) drawPresence();
      } else if (q.region) {
        // openRegion сам проверит, есть ли такой контур: субъекта может
        // не быть в цифрах мониторинга, но карточка всё равно открывается
        show('map');
        openRegion(q.region);
      } else {
        show('map');
      }
      resetView();
      if (q.at) focusOn(q.at, parseFloat(q.zoom));
      else if (q.zoom) zoomTo(parseFloat(q.zoom));

      resetIdle();
      $('loading').classList.add('hidden');
      // раздел, поднятый в фоне, один раз рисуется и замирает до показа
      draw();
      placeCall();
      need = false;
      if (live) startLoop();
      U.revealPage();
      if (global.Shell) global.Shell.ready('monitoring');
    }).catch(function (e) {
      fail('Не загрузить данные мониторинга: ' + (e && e.message ? e.message : e));
    });
  }

  /** «18 филиалов ЦОК АПК по всей России» — число берётся из файла. */
  function drawPresCount() {
    var n = pres && pres.regions ? Object.keys(pres.regions).length : 0;
    $('pres-count').textContent = n + ' ' + U.plural(n, 'филиал', 'филиала', 'филиалов') +
      ' ЦОК АПК по всей России';
  }

  /** Enter или кнопка «Искать»: открыть первое совпадение. */
  function openFirst() {
    var arr = listed();
    if (!arr.length) return;
    // первое совпадение без цифр карточку не открывает — просто
    // показываем регион на карте
    if (hasMon(arr[0].id)) openRegion(arr[0].id);
    else { focusOn(arr[0].id, 2.2); pinTip(arr[0].id); }
  }

  /* Для показа и отладки: MonScreen.open('RU-ROS'), MonScreen.stats() */
  global.MonScreen = {
    open: openRegion,
    back: backToMap,
    focus: focusOn,
    openPresence: openPresence,
    kind: setKind,
    presence: selectPresence,
    /** Точка региона в координатах страницы — для скриптов и автотестов. */
    point: function (id) {
      var s = shapes.filter(function (x) { return x.id === id; })[0];
      if (!s) return null;
      var p = toCanvas(s.c[0], s.c[1]);
      var r = $('map').getBoundingClientRect();
      return [r.left + p[0] * (r.width / MAP_W), r.top + p[1] * (r.height / MAP_H)];
    },
    list: function () {
      return shapes.map(function (s) { return s.id + ' — ' + s.name; });
    },
    stats: function () {
      return { fps: Math.round(fps), dpr: dpr, regions: shapes.length,
               year: year, zoom: Math.round(view.z * 100) / 100,
               screen: screen, kind: kind,
               region: regionId, presence: presId,
               labs: labs.length, running: !!rafId };
    }
  };

  /* Раздел единого приложения (app.html) или отдельная страница
     monitoring.html. Контуры субъектов строятся один раз; при уходе
     с раздела останавливается только цикл отрисовки. */

  if (global.Shell) {
    global.Shell.register('monitoring', {
      boot: boot,
      show: function (params) {
        live = true;
        fitStage();
        // раздел один, а входов в него два: плитка «Мониторинг зерна РФ»
        // и плитка «Регионы присутствия» (?section=presence)
        if (mon) {
          if (params && params.view === 'presence') openPresence(params.region);
          else if (params && params.region) openRegion(params.region);
          else toAttractor();
        }
        need = true;
        startLoop();
      },
      hide: function () {
        live = false;
        syncRegionVideo();
        if (global.Keyboard) global.Keyboard.close();
        stopLoop();
      },
      reset: function () {
        if (!mon) return;
        toAttractor();
      }
    });
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
