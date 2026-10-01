/* ===================================================================
   Глобус: ночная Земля (снимки NASA: огни городов + затемнённая суша),
   золотые дуги маршрутов с бегущими частицами, подписи стран поверх
   холста, управление касанием (одним пальцем — вращение, двумя — зум).
   Наружу отдаёт объект window.Globe.
   =================================================================== */
(function (global) {
  'use strict';

  var DEG = Math.PI / 180;
  var R = 1;

  /*
   * Текстуры из снимков NASA, их готовит tools/make_earth_textures.py.
   * Наборы разложены по темам, внутри темы — от большего к меньшему:
   * какой вариант грузить, решает pickTexture() по значению
   * renderer.capabilities.maxTextureSize.
   *
   * Огни городов. У синей темы два варианта (8192 и запасной 4096),
   * у зелёной свой файл: там ореол шире и цвет теплее, поэтому 8192
   * не нужен — мягкое свечение и на 4096 выглядит так же, а вес сборки
   * растёт вдвое медленнее (см. NIGHT_THEMES в make_earth_textures.py).
   */
  var TEX_LIGHTS = {
    // Огни у синей и зелёной тем общие: синяя — это перекрашенный зелёный
    // шар, огни в нём те же, тёплые и с широким ореолом. Прежние холодные
    // earth_night_8192 / 4096 остались в assets на случай возврата.
    navy: [
      { size: 4096, path: 'assets/textures/earth_night_4096_green.jpg' }
    ],
    green: [
      { size: 4096, path: 'assets/textures/earth_night_4096_green.jpg' }
    ]
  };
  /*
   * Подложка суши тоже своя у каждой темы: суша и океан покрашены прямо
   * в текстуре (см. LAND_THEMES в make_earth_textures.py).
   * Пути записаны здесь буквально, а не собираются из имени темы, — иначе
   * tools/build_dist.py не найдёт их в коде и не вошьёт в один файл.
   */
  var TEX_LAND = {
    // Синяя тема — дневная Земля со спутника по эталону из фигмы: снимок
    // NASA почти как есть, только сочнее и с вытянутым рельефом, океан
    // перекрашен в глубокий синий со светлым шельфом. Файлы с суффиксом
    // _figma, их делает tools/make_earth_textures.py (тема navy_figma).
    // Основной размер — 8192: стенд это панель 50" в 4K, на 4096 при
    // приближении видно мыло. Если видеокарта столько не тянет, pickTexture
    // возьмёт 4096 или 2048 — так же, как у ночных огней.
    // Прежние подложки синей темы — earth_land_4096_blue.jpg (перекрашенный
    // шар зелёной темы) и earth_land_4096.jpg (холодная, самая первая) —
    // остались в assets на случай возврата.
    navy: [
      { size: 8192, path: 'assets/textures/earth_land_8192_figma.jpg' },
      { size: 4096, path: 'assets/textures/earth_land_4096_figma.jpg' },
      { size: 2048, path: 'assets/textures/earth_land_2048_figma.jpg' }
    ],
    green: [
      { size: 4096, path: 'assets/textures/earth_land_4096_green.jpg' },
      { size: 2048, path: 'assets/textures/earth_land_2048_green.jpg' }
    ]
  };

  var cfg, colors, gcfg;
  var renderer, scene, camera, canvas;
  var pivotTilt, pivotSpin, world;      // tilt(rot.x) > spin(rot.y) > world
  var earth, borders, highlight, atmo, halo, edge, bgSphere;
  var arcGroup, ships = [], originDot, destDot;
  var endPointsBig = null, endPointsSmall = null, particles = null;

  var topoFeatures = null;              // контуры стран для подсветки
  var geoCountries = [];                // те же контуры для выбора касанием и подписей
  var namesRu = {};                     // iso -> русское название (из данных экспорта)
  var highlightCtx = null, highlightTex = null, highlightIso = null;
  var highlightLine = null, highlightGlow = null;

  var routes = [];                      // [{name, curve, pts, mesh, value, norm, baseHalf}]
  var routeByName = {};
  var routeByIso = {};                  // iso контура -> маршрут текущего года
  var selected = null;
  var shipCount = 0, shipSpeed = 0;     // сколько корабликов идёт по маршруту и с какой скоростью

  // Домашний ракурс: Россия, Чёрное море, Ближний Восток, Африка, Индия.
  // fx/fy — где на экране стоит центр планеты (доли ширины и высоты).
  // Тема может сдвинуть его полями homeX/homeY в config.json (themes.<имя>.globe):
  // в зелёной теме правая колонка шире, поэтому глобус уезжает левее и выше.
  var HOME = { phi: 0.33, theta: -2.36, fx: 0.52, fy: 0.52 };

  var view = { phi: HOME.phi, theta: HOME.theta, zoom: 4.3, fx: HOME.fx, fy: HOME.fy };
  var target = null;                    // анимация камеры
  var autoRotate = true;
  var lastFrame = 0;
  var drawAnim = null;                  // анимация прорисовки дуг
  var onPick = function () {};
  var onInteract = function () {};
  var onReady = function () {};
  /* Цикл отрисовки. В едином приложении (app.html) сцена создаётся один
     раз и живёт до конца показа, а когда раздел уходит с экрана, цикл
     останавливается (Globe.stop) и возобновляется при возврате
     (Globe.start) — сцена, текстуры и геометрия не пересоздаются. */
  var rafId = 0;                        // 0 — цикл не крутится
  var started = false;                  // init() уже отработал
  var texLeft = 0;                      // сколько текстур Земли ещё грузится

  /* ------------------------- геометрия сферы ------------------------- */

  function toVec3(lat, lon, r) {
    var la = lat * DEG, lo = lon * DEG;
    r = r || R;
    return new THREE.Vector3(
      r * Math.cos(la) * Math.cos(lo),
      r * Math.sin(la),
      -r * Math.cos(la) * Math.sin(lo)
    );
  }

  function slerp(a, b, t) {
    var d = Math.max(-1, Math.min(1, a.dot(b)));
    var omega = Math.acos(d);
    if (omega < 1e-6) return a.clone();
    var so = Math.sin(omega);
    return a.clone().multiplyScalar(Math.sin((1 - t) * omega) / so)
      .add(b.clone().multiplyScalar(Math.sin(t * omega) / so));
  }

  /** Углы, при которых точка (lat, lon) оказывается прямо перед камерой. */
  function faceAngles(lat, lon) {
    return { phi: lat * DEG, theta: -Math.PI / 2 - lon * DEG };
  }

  function vecToLatLon(v) {
    var n = v.clone().normalize();
    return {
      lat: Math.asin(n.y) / DEG,
      lon: -Math.atan2(n.z, n.x) / DEG
    };
  }

  /* ---------------- страна на холсте: заливка подсветки ---------------- */

  /**
   * Обводит страну на холсте текстуры (равнопрямоугольная проекция) —
   * нужен только для заливки, сам контур рисуется линиями в 3D.
   * Кольца, пересекающие 180-й меридиан (Россия, Фиджи), разворачиваются
   * в непрерывную последовательность долгот и рисуются трижды — со сдвигом
   * на -W, 0 и +W; лишнее обрезает холст.
   */
  function tracePath(ctx, feature, W, H) {
    var g = feature.geometry;
    if (!g) return;
    var polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    var SHIFTS = [-W, 0, W];
    ctx.beginPath();
    for (var s = 0; s < SHIFTS.length; s++) {
      for (var p = 0; p < polys.length; p++) {
        var poly = polys[p];
        for (var r = 0; r < poly.length; r++) {
          var ring = poly[r];
          var lon = ring[0][0];
          for (var i = 0; i < ring.length; i++) {
            if (i > 0) {
              var d = ring[i][0] - ring[i - 1][0];
              if (d > 180) d -= 360; else if (d < -180) d += 360;
              lon += d;
            }
            var x = (lon + 180) / 360 * W + SHIFTS[s];
            var y = (90 - ring[i][1]) / 180 * H;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.closePath();
        }
      }
    }
  }

  /* ------------------ линии на сфере: ширина в пикселях ------------------ */

  /*
   * Контуры стран нарисованы не на текстуре, а геометрией. Каждый отрезок
   * границы превращается в четырёхугольник, который вершинный шейдер
   * растягивает поперёк линии уже в координатах экрана: толщина задана
   * в пикселях и не зависит от приближения. Край гасится по alpha, поэтому
   * линия остаётся тонкой и гладкой даже вплотную к планете — на холсте
   * 2048×1024 она в этот момент разваливалась на ступеньки.
   *
   * Точки колец уплотняются дугами (LINE_STEP): в topojson длинные прямые
   * границы заданы двумя точками, и хорда между ними ушла бы под поверхность.
   */
  var uRes = { value: new THREE.Vector2(1920, 1080) };
  var LINE_STEP = 1.2 * DEG;            // максимальный шаг вдоль границы

  var LINE_VERT =
    'attribute vec3 aEnd; attribute vec2 aSideT;' +
    'uniform vec2 uRes; uniform float uHalf;' +
    'varying float vSide;' +
    'void main(){' +
    '  vec4 ca = projectionMatrix * modelViewMatrix * vec4(position, 1.0);' +
    '  vec4 cb = projectionMatrix * modelViewMatrix * vec4(aEnd, 1.0);' +
    '  vec2 d = (cb.xy / cb.w - ca.xy / ca.w) * uRes;' +
    '  float l = length(d);' +
    '  vec2 n = l > 1e-6 ? vec2(-d.y, d.x) / l : vec2(0.0);' +
    '  vec4 c = mix(ca, cb, aSideT.y);' +
    '  c.xy += n * (aSideT.x * uHalf * 2.0 * c.w) / uRes;' +
    '  vSide = aSideT.x;' +
    '  gl_Position = c; }';

  var LINE_FRAG =
    'uniform vec3 uColor; uniform float uOpacity;' +
    'varying float vSide;' +
    'void main(){' +
    '  float a = 1.0 - smoothstep(0.30, 1.0, abs(vSide));' +
    '  gl_FragColor = vec4(uColor, a * uOpacity); }';

  /** 'rgba(r,g,b,a)' -> прозрачность; у других записей цвета — 1. */
  function alphaOf(str) {
    var m = /rgba\(([^)]+)\)/.exec(str || '');
    if (!m) return 1;
    var p = m[1].split(',');
    return p.length > 3 ? parseFloat(p[3]) : 1;
  }

  /*
   * Цвет берётся как есть, без пересчёта в линейное пространство: шейдер
   * пишет его прямо в кадр, поэтому контур выглядит ровно тем цветом,
   * что записан в config.json, — как раньше на холсте.
   */
  function rawColor(str) {
    var c = new THREE.Color();
    if (THREE.LinearSRGBColorSpace) c.setStyle(str, THREE.LinearSRGBColorSpace);
    else c.setStyle(str);
    return c;
  }

  function lineMaterial(color, halfPx, opacity, additive) {
    return new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: {
        uRes: uRes,
        uHalf: { value: halfPx },
        uColor: { value: rawColor(color) },
        uOpacity: { value: opacity }
      },
      vertexShader: LINE_VERT,
      fragmentShader: LINE_FRAG
    });
  }

  /** Кольцо [[lon,lat],...] -> точки на сфере радиуса r, уплотнённые дугами. */
  function ringToPoints(ring, r) {
    var pts = [];
    for (var i = 0; i < ring.length; i++) {
      var v = toVec3(ring[i][1], ring[i][0], r);
      if (pts.length) {
        var prev = pts[pts.length - 1];
        var cos = Math.max(-1, Math.min(1, prev.dot(v) / (r * r)));
        var n = Math.ceil(Math.acos(cos) / LINE_STEP);
        for (var k = 1; k < n; k++) pts.push(slerp(prev, v, k / n));
      }
      pts.push(v);
    }
    return pts;
  }

  /** Геометрия GeoJSON (линии или полигоны) -> массив полилиний. */
  function geoToLines(geom, r, out) {
    var t = geom.type, c = geom.coordinates, i, j;
    if (t === 'LineString') {
      out.push(ringToPoints(c, r));
    } else if (t === 'MultiLineString' || t === 'Polygon') {
      for (i = 0; i < c.length; i++) out.push(ringToPoints(c[i], r));
    } else if (t === 'MultiPolygon') {
      for (i = 0; i < c.length; i++)
        for (j = 0; j < c[i].length; j++) out.push(ringToPoints(c[i][j], r));
    }
    return out;
  }

  var LINE_SIDE = [-1, -1, 1, -1, 1, 1];    // два треугольника на отрезок
  var LINE_T = [0, 1, 1, 0, 1, 0];

  function buildLineGeometry(lines) {
    var segs = 0, i, j, k;
    for (i = 0; i < lines.length; i++) segs += Math.max(0, lines[i].length - 1);
    var pa = new Float32Array(segs * 18);
    var pb = new Float32Array(segs * 18);
    var st = new Float32Array(segs * 12);
    var o3 = 0, o2 = 0;
    for (i = 0; i < lines.length; i++) {
      var pts = lines[i];
      for (j = 0; j + 1 < pts.length; j++) {
        var a = pts[j], b = pts[j + 1];
        for (k = 0; k < 6; k++) {
          pa[o3] = a.x; pa[o3 + 1] = a.y; pa[o3 + 2] = a.z;
          pb[o3] = b.x; pb[o3 + 1] = b.y; pb[o3 + 2] = b.z;
          o3 += 3;
          st[o2] = LINE_SIDE[k]; st[o2 + 1] = LINE_T[k];
          o2 += 2;
        }
      }
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pa, 3));
    g.setAttribute('aEnd', new THREE.BufferAttribute(pb, 3));
    g.setAttribute('aSideT', new THREE.BufferAttribute(st, 2));
    // вершины расходятся уже на экране, поэтому сфера отсечения задана вручную
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.2);
    return g;
  }

  /* --------------------------- контуры стран --------------------------- */

  /** Едва заметная сетка границ: общие участки topojson рисует один раз. */
  function buildBorders(topo) {
    topoFeatures = topojson.feature(topo, topo.objects.countries).features;
    var net = topojson.mesh(topo, topo.objects.countries);
    var geo = buildLineGeometry(geoToLines(net, R * 1.0018, []));
    // толщина и сила линии — из темы: на светлой зелёной суше золотая
    // сетка при синих настройках почти пропадает
    var mesh = new THREE.Mesh(geo, lineMaterial(colors.border,
      gcfg.borderWidth != null ? gcfg.borderWidth : 0.6,
      alphaOf(colors.border) * (gcfg.borderOpacity != null ? gcfg.borderOpacity : 0.55)));
    mesh.renderOrder = 1;
    return mesh;
  }

  /** Мягкая заливка выбранной страны (сам контур — линиями, см. ниже). */
  function buildHighlightTexture() {
    var W = 2048, H = 1024;
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    highlightCtx = cv.getContext('2d');
    highlightTex = new THREE.CanvasTexture(cv);
    if (THREE.SRGBColorSpace) highlightTex.colorSpace = THREE.SRGBColorSpace;
    highlightTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return highlightTex;
  }

  function disposeHighlightLine() {
    if (!highlightLine) return;
    world.remove(highlightLine);
    world.remove(highlightGlow);
    highlightLine.geometry.dispose();
    highlightLine.material.dispose();
    highlightGlow.material.dispose();
    highlightLine = highlightGlow = null;
  }

  function drawHighlight(iso) {
    if (!highlightCtx || highlightIso === iso) return;
    highlightIso = iso;
    var W = 2048, H = 1024;
    highlightCtx.clearRect(0, 0, W, H);
    disposeHighlightLine();

    var feat = null;
    if (iso && topoFeatures) {
      for (var i = 0; i < topoFeatures.length; i++) {
        if (String(topoFeatures[i].id) === String(iso)) { feat = topoFeatures[i]; break; }
      }
    }
    if (feat) {
      // заливка размыта: её край всё равно ступенчатый, а так он читается
      // как мягкое свечение внутри страны, границу держит контур-линия
      highlightCtx.filter = 'blur(4px)';
      tracePath(highlightCtx, feat, W, H);
      highlightCtx.fillStyle = colors.highlightFill;
      highlightCtx.fill('evenodd');
      highlightCtx.filter = 'none';

      // контур: тонкая сердцевина плюс широкая полупрозрачная копия
      var geo = buildLineGeometry(geoToLines(feat.geometry, R * 1.0034, []));
      var a = alphaOf(colors.highlight);
      // сердцевина по обычному смешиванию — иначе поверх светлой суши
      // золото складывается с фоном и выцветает в белое; ореол сложением
      highlightGlow = new THREE.Mesh(geo, lineMaterial(colors.highlight, 3.4, a * 0.22, true));
      highlightLine = new THREE.Mesh(geo, lineMaterial(colors.highlight, 0.95, Math.min(1, a * 1.25)));
      highlightGlow.renderOrder = 6;
      highlightLine.renderOrder = 7;
      world.add(highlightGlow);
      world.add(highlightLine);
    }
    highlightTex.needsUpdate = true;
    highlight.visible = !!feat;
  }

  /* ---------------- страна под пальцем: контуры в долготе/широте ----------------

     Чтобы страну можно было выбрать касанием по всей её территории, а не
     только по точке на конце дуги, контуры из countries-110m.json один раз
     раскладываются в плоские кольца «долгота — широта»:

       - долготы кольца разворачиваются в непрерывный ряд, как в tracePath:
         кольцо, пересекающее 180-й меридиан (Чукотка, Фиджи), не рвётся;
         точку касания потом проверяем со сдвигом на 0 и ±360;
       - кольцо, которое обходит полюс целиком (Антарктида), замыкается
         через сам полюс, иначе «внутри» у него не определено;
       - у каждого кольца заранее посчитана рамка (bbox): касание сначала
         отсекается по рамкам, до честной проверки доходят одна-две страны;
       - дыры в полигонах и мультиполигоны учитываются правилом чёт-нечет:
         точка внутри страны, если она внутри нечётного числа её колец.

     Контуров 177, проверка идёт только в момент касания, поэтому никакой
     сетки поверх рамок не нужно: на стенде это доли миллисекунды. */

  /* Русские названия для контуров, которых нет в данных экспорта (туда
     попадают только страны, куда хоть раз возили зерно); здесь — официальные
     краткие названия. Остальные имена берутся из data/export.json — это те
     же названия, что в списке стран и карточке (их источник —
     data/countries_ru.json). Контуры без кода (Северный
     Кипр, Сомалиленд, Косово) и спорные территории не подписываются. */
  var EXTRA_RU = {
    '242': 'Фиджи', '732': 'Западная Сахара', '148': 'Чад',
    '238': 'Фолклендские острова', '304': 'Гренландия', '626': 'Тимор-Лешти',
    '858': 'Уругвай', '084': 'Белиз', '328': 'Гайана', '388': 'Ямайка',
    '624': 'Гвинея-Бисау', '748': 'Эсватини', '548': 'Вануату', '064': 'Бутан',
    '540': 'Новая Каледония', '090': 'Соломоновы Острова', '010': 'Антарктида'
  };
  // Россию не подписываем: над портом отправления уже стоит «Россия».
  // Название на глобусе всегда ровно такое же, как в списке стран и
  // в карточке (data/export.json), — без сокращений и замен.
  var NAME_SKIP = { '643': 1, '158': 1, '260': 1 };

  /** Кольцо GeoJSON -> плоское кольцо с непрерывной долготой и рамкой. */
  function flatRing(ring) {
    var n = ring.length, xs = new Float64Array(n + 2), ys = new Float64Array(n + 2);
    var lon = ring[0][0], minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (var i = 0; i < n; i++) {
      if (i > 0) {
        var d = ring[i][0] - ring[i - 1][0];
        if (d > 180) d -= 360; else if (d < -180) d += 360;
        lon += d;
      }
      xs[i] = lon; ys[i] = ring[i][1];
    }
    // обошли полюс по кругу (Антарктида): замыкаем кольцо через полюс
    if (Math.abs(xs[n - 1] - xs[0]) > 180) {
      var pole = ys[0] < 0 ? -90 : 90;
      xs[n] = xs[n - 1]; ys[n] = pole;
      xs[n + 1] = xs[0]; ys[n + 1] = pole;
      n += 2;
    }
    for (var k = 0; k < n; k++) {
      if (xs[k] < minX) minX = xs[k]; if (xs[k] > maxX) maxX = xs[k];
      if (ys[k] < minY) minY = ys[k]; if (ys[k] > maxY) maxY = ys[k];
    }
    return { xs: xs, ys: ys, n: n, minX: minX, maxX: maxX, minY: minY, maxY: maxY };
  }

  /** Точка внутри плоского кольца (луч по долготе, правило чёт-нечет). */
  function inRing(r, x, y) {
    if (y < r.minY || y > r.maxY || x < r.minX || x > r.maxX) return false;
    var inside = false, xs = r.xs, ys = r.ys;
    for (var i = 0, j = r.n - 1; i < r.n; j = i++) {
      if ((ys[i] > y) !== (ys[j] > y) &&
          x < (xs[j] - xs[i]) * (y - ys[i]) / (ys[j] - ys[i]) + xs[i]) inside = !inside;
    }
    return inside;
  }

  /** Кольцо с учётом 180-го меридиана: пробуем долготу как есть и ±360. */
  function inRingWrap(r, lon, lat) {
    return inRing(r, lon, lat) || inRing(r, lon + 360, lat) || inRing(r, lon - 360, lat);
  }

  /** Площадь плоского кольца в «градусах²», поправленная на широту. */
  function ringArea(r) {
    var a = 0;
    for (var i = 0, j = r.n - 1; i < r.n; j = i++) a += (r.xs[j] - r.xs[i]) * (r.ys[j] + r.ys[i]);
    var midLat = (r.minY + r.maxY) / 2;
    return Math.abs(a / 2) * Math.cos(midLat * DEG);
  }

  /** Квадрат расстояния от точки до границ полигона (в локальной проекции). */
  function edgeDist2(poly, x, y, kx) {
    var best = Infinity;
    for (var p = 0; p < poly.length; p++) {
      var r = poly[p];
      for (var i = 0, j = r.n - 1; i < r.n; j = i++) {
        var d = segDist2(x * kx, y, r.xs[j] * kx, r.ys[j], r.xs[i] * kx, r.ys[i]);
        if (d < best) best = d;
      }
    }
    return best;
  }

  function inPoly(poly, x, y) {
    var c = false;
    for (var p = 0; p < poly.length; p++) if (inRing(poly[p], x, y)) c = !c;
    return c;
  }

  /**
   * Где ставить подпись: точка внутри самого большого полигона страны,
   * дальше всего отстоящая от его границ (упрощённый polylabel — перебор
   * по сетке и уточнение вокруг лучшей клетки). Центр масс не годится:
   * у Хорватии, Чили или Норвегии он лежит за пределами страны.
   */
  function labelPoint(poly) {
    var r0 = poly[0];
    var kx = Math.cos((r0.minY + r0.maxY) / 2 * DEG);
    var bx = (r0.minX + r0.maxX) / 2, by = (r0.minY + r0.maxY) / 2, bd = -1;
    var x0 = r0.minX, y0 = r0.minY, w = r0.maxX - r0.minX, h = r0.maxY - r0.minY;
    for (var pass = 0; pass < 2; pass++) {
      var N = pass ? 8 : 14;
      for (var i = 0; i < N; i++) {
        for (var j = 0; j < N; j++) {
          var x = x0 + (i + 0.5) / N * w, y = y0 + (j + 0.5) / N * h;
          if (!inPoly(poly, x, y)) continue;
          var d = edgeDist2(poly, x, y, kx);
          if (d > bd) { bd = d; bx = x; by = y; }
        }
      }
      // второй проход — мельче, вокруг найденной точки
      w = w / 14 * 2; h = h / 14 * 2; x0 = bx - w / 2; y0 = by - h / 2;
    }
    return { lat: by, lon: bx };
  }

  /** Раскладка контуров: вызывается один раз, после загрузки topojson. */
  function buildGeoIndex() {
    geoCountries = [];
    if (!topoFeatures) return;
    for (var f = 0; f < topoFeatures.length; f++) {
      var feat = topoFeatures[f], g = feat.geometry;
      if (!g || feat.id == null) continue;
      var polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
      var rings = [], best = null, bestA = -1;
      for (var p = 0; p < polys.length; p++) {
        var poly = [];
        for (var r = 0; r < polys[p].length; r++) {
          var fr = flatRing(polys[p][r]);
          poly.push(fr); rings.push(fr);
        }
        var a = ringArea(poly[0]);
        if (a > bestA) { bestA = a; best = poly; }
      }
      var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      rings.forEach(function (q) {
        if (q.minX < minX) minX = q.minX; if (q.maxX > maxX) maxX = q.maxX;
        if (q.minY < minY) minY = q.minY; if (q.maxY > maxY) maxY = q.maxY;
      });
      geoCountries.push({
        iso: String(feat.id), rings: rings, main: best, area: bestA,
        minX: minX, maxX: maxX, minY: minY, maxY: maxY, label: null
      });
    }
  }

  /** Контур страны под точкой (lat, lon) или null — океан. */
  function countryAt(lat, lon) {
    for (var c = 0; c < geoCountries.length; c++) {
      var g = geoCountries[c];
      if (lat < g.minY || lat > g.maxY) continue;
      var inside = false;
      for (var r = 0; r < g.rings.length; r++) {
        if (inRingWrap(g.rings[r], lon, lat)) inside = !inside;
      }
      if (inside) return g;
    }
    return null;
  }

  /*
   * Текстуры точек рисуются в 128 px и показываются без мипмапов: спрайты
   * и точки занимают на ретине 40–80 физических пикселей, то есть текстура
   * идёт с небольшим уменьшением — так она остаётся резкой.
   */
  function pointTexture(rgb, draw) {
    var s = 128;
    var cv = document.createElement('canvas');
    cv.width = cv.height = s;
    draw(cv.getContext('2d'), s, s / 2);
    var t = new THREE.CanvasTexture(cv);
    if (THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace;
    t.generateMipmaps = false;
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    return t;
  }

  /** Круглое мягкое свечение — маркеры стран и порт отправления. */
  function glowTexture(rgb) {
    return pointTexture(rgb, function (ctx, s, c) {
      var gr = ctx.createRadialGradient(c, c, 0, c, c, c);
      gr.addColorStop(0, 'rgba(' + rgb + ',1)');
      gr.addColorStop(0.25, 'rgba(' + rgb + ',.55)');
      gr.addColorStop(1, 'rgba(' + rgb + ',0)');
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, s, s);
    });
  }

  /**
   * Точка с чёткой сердцевиной и мягким ореолом вокруг — «корабль».
   * core — доля радиуса под ядро: при размере спрайта 20 px и core = 0.35
   * ядро занимает 7 px, остальное уходит в свечение.
   */
  function dotTexture(rgb, core) {
    return pointTexture(rgb, function (ctx, s, c) {
      var halo = ctx.createRadialGradient(c, c, 0, c, c, c);
      halo.addColorStop(0, 'rgba(' + rgb + ',.55)');
      halo.addColorStop(core, 'rgba(' + rgb + ',.34)');
      halo.addColorStop(0.6, 'rgba(' + rgb + ',.10)');
      halo.addColorStop(1, 'rgba(' + rgb + ',0)');
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, s, s);

      var cr = c * core;
      var dot = ctx.createRadialGradient(c, c, 0, c, c, cr);
      dot.addColorStop(0, 'rgba(255,255,255,1)');
      dot.addColorStop(0.70, 'rgba(255,255,255,1)');
      dot.addColorStop(0.88, 'rgba(' + rgb + ',.92)');
      dot.addColorStop(1, 'rgba(' + rgb + ',0)');
      ctx.fillStyle = dot;
      ctx.fillRect(0, 0, s, s);
    });
  }

  /**
   * Сухогруз сбоку — как на кадре 613:2268 (правка 30.09): светлый корпус
   * с золотой обводкой, надстройка с мостиком у кормы, грузовые люки
   * и краны на палубе, мягкое золотое свечение вокруг. Холст 2:1,
   * нос справа; flip рисует то же судно носом влево. Киль стоит на
   * SHIP_KEEL высоты холста — этой точкой судно садится на линию
   * маршрута (см. sprite.center в init).
   */
  var SHIP_W = 128, SHIP_H = 64, SHIP_KEEL = 0.80;
  function shipTexture(flip) {
    var W = SHIP_W, H = SHIP_H;
    var cv = document.createElement('canvas');
    cv.width = W * 2; cv.height = H * 2;       // вдвое плотнее: на 4K-панели не мылится
    var ctx = cv.getContext('2d');
    ctx.scale(2, 2);
    if (flip) { ctx.translate(W, 0); ctx.scale(-1, 1); }
    var X = function (f) { return f * W; }, Y = function (f) { return f * H; };

    function body() {
      ctx.beginPath();
      // корпус: корма слева почти отвесная, нос справа скошен вперёд
      ctx.moveTo(X(0.07), Y(0.60));
      ctx.lineTo(X(0.95), Y(0.56));
      ctx.lineTo(X(0.86), Y(SHIP_KEEL));
      ctx.lineTo(X(0.11), Y(SHIP_KEEL));
      ctx.closePath();
      // надстройка у кормы: корпус мостика, рубка, мачта
      ctx.rect(X(0.12), Y(0.30), X(0.19), Y(0.30));
      ctx.rect(X(0.10), Y(0.24), X(0.23), Y(0.07));
      ctx.rect(X(0.20), Y(0.08), X(0.025), Y(0.16));
      // грузовые люки на палубе
      ctx.rect(X(0.36), Y(0.49), X(0.13), Y(0.10));
      ctx.rect(X(0.51), Y(0.49), X(0.13), Y(0.10));
      ctx.rect(X(0.66), Y(0.49), X(0.13), Y(0.10));
    }
    function cranes() {
      ctx.beginPath();
      [0.50, 0.65].forEach(function (x) {
        ctx.moveTo(X(x), Y(0.49)); ctx.lineTo(X(x), Y(0.24));
        ctx.lineTo(X(x + 0.10), Y(0.40));
      });
    }

    // свечение: та же фигура, размытая золотом
    ctx.save();
    ctx.shadowColor = 'rgba(255,196,96,.95)';
    ctx.shadowBlur = 9;
    ctx.fillStyle = 'rgba(255,214,140,.9)';
    body(); ctx.fill();
    ctx.restore();

    ctx.fillStyle = '#FFF7EA';
    body(); ctx.fill();
    ctx.strokeStyle = '#E4AE55';
    ctx.lineWidth = 1.4;
    ctx.lineJoin = 'round';
    body(); ctx.stroke();
    cranes();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = '#FFF7EA';
    ctx.stroke();

    // окна мостика и полоса ватерлинии
    ctx.fillStyle = '#C98E35';
    for (var i = 0; i < 4; i++) ctx.fillRect(X(0.14 + i * 0.04), Y(0.35), X(0.025), Y(0.05));
    ctx.fillRect(X(0.11), Y(0.70), X(0.77), Y(0.03));

    var t = new THREE.CanvasTexture(cv);
    if (THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace;
    t.generateMipmaps = false;
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    return t;
  }

  /** Конец выбранного маршрута: белый диск с золотым ореолом (кадр 613:2268). */
  function endTexture() {
    return pointTexture('', function (ctx, s, c) {
      var gr = ctx.createRadialGradient(c, c, 0, c, c, c);
      gr.addColorStop(0, 'rgba(255,248,232,1)');
      gr.addColorStop(0.34, 'rgba(255,240,205,1)');
      gr.addColorStop(0.42, 'rgba(255,200,110,.75)');
      gr.addColorStop(0.7, 'rgba(255,190,90,.22)');
      gr.addColorStop(1, 'rgba(255,190,90,0)');
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, s, s);
    });
  }

  var TEX_GOLD = null, TEX_WHITE = null, TEX_SHIP = null, TEX_SHIP_L = null, TEX_END = null;
  var SHIP_MAX = 6;                     // потолок числа корабликов на маршруте (по ТЗ 1..6)
  // доля маршрута в мс: диапазон вокруг прежней фиксированной скорости
  // одиночной точки (0.00016) — на минимальном объёме идёт медленнее,
  // на максимальном быстрее.
  var SHIP_SPEED_MIN = 0.00010, SHIP_SPEED_MAX = 0.00026;

  /** Самый большой вариант текстуры, который тянет видеокарта. */
  function pickTexture(list) {
    var max = renderer.capabilities.maxTextureSize;
    for (var i = 0; i < list.length; i++) {
      if (list[i].size <= max) return list[i].path;
    }
    return list[list.length - 1].path;
  }

  /**
   * Общая подготовка снимков Земли: sRGB (иначе тёмные полутона уезжают),
   * мипмапы и максимальная анизотропия — без них огни на краю диска
   * рассыпаются в зернистую россыпь точек.
   */
  function prepTexture(t) {
    if (THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.wrapS = THREE.RepeatWrapping;
    t.needsUpdate = true;
    return t;
  }

  /* ----------------------- ободок и свечение ----------------------- */

  /** Значение из настроек темы или значение по умолчанию. */
  function num(v, def) {
    return v != null ? v : def;
  }

  var RIM_VERT =
    'varying vec3 vN; varying vec3 vP;' +
    'void main(){ vN = normalize(normalMatrix * normal);' +
    'vec4 mv = modelViewMatrix * vec4(position,1.0); vP = mv.xyz;' +
    'gl_Position = projectionMatrix * mv; }';

  /*
   * Ободок и свечение — сфера чуть больше планеты, у которой видна только
   * изнанка: сама планета непрозрачна, поэтому на экране от такой оболочки
   * остаётся кольцо между краем диска и её силуэтом. Яркость считается
   * по Френелю, степень uPow задаёт ширину полосы.
   *
   * Блик по кромке устроен наоборот — side: FrontSide: оболочка лежит поверх
   * планеты и светится только у самого силуэта, где взгляд идёт по касательной.
   * От этого край выглядит стеклянным, а не обведённым кольцом.
   */
  function rimMaterial(color, power, strength, front) {
    return new THREE.ShaderMaterial({
      transparent: true, blending: THREE.AdditiveBlending,
      side: front ? THREE.FrontSide : THREE.BackSide, depthWrite: false,
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uPow: { value: power },
        uStr: { value: strength }
      },
      vertexShader: RIM_VERT,
      fragmentShader:
        'uniform vec3 uColor; uniform float uPow; uniform float uStr;' +
        'varying vec3 vN; varying vec3 vP;' +
        'void main(){' +
        '  float f = pow(clamp(1.0 - abs(dot(normalize(vN), normalize(-vP))), 0.0, 1.0), uPow);' +
        '  gl_FragColor = vec4(uColor, f * uStr); }'
    });
  }

  /*
   * Блик по кромке — «серп». Оболочка чуть больше планеты, side: FrontSide:
   * она лежит поверх диска и светится только у силуэта, где взгляд идёт
   * по касательной. От прежнего ровного колечка отличается двумя вещами.
   *
   * 1. Яркость модулируется светом: считается косинус между нормалью и
   *    направлением на источник (uLight, в системе камеры — поэтому серп
   *    стоит на месте, когда планета вращается). На освещённой стороне
   *    кромка почти белая, к теневой плавно гаснет до доли uBias.
   * 2. Часть оболочки, торчащая наружу за край планеты, гасится отдельно
   *    (uSoft). Без этого свечение обрывалось бы ровным кольцом по силуэту
   *    оболочки — это и есть та самая «сфера в сфере». uInner — отношение
   *    радиусов планеты и оболочки, по нему шейдер знает, где проходит
   *    настоящая кромка диска.
   */
  var EDGE_FRAG =
    'uniform vec3 uColor; uniform vec3 uCore; uniform vec3 uLight;' +
    'uniform float uPow; uniform float uStr; uniform float uBias;' +
    'uniform float uSoft; uniform float uInner;' +
    'varying vec3 vN; varying vec3 vP;' +
    'void main(){' +
    '  vec3 n = normalize(vN);' +
    '  float c = abs(dot(n, normalize(-vP)));' +          // 1 в центре диска, 0 у силуэта
    '  float band = pow(clamp(1.0 - c, 0.0, 1.0), uPow);' +
    '  float lit = smoothstep(-0.55, 0.80, dot(n, normalize(uLight)));' +
    '  float m = clamp(uBias + (1.0 - uBias) * lit, 0.0, 1.0);' +
    '  float fall = 1.0;' +
    '  if (uSoft > 0.0) {' +
    '    float cRim = sqrt(max(1.0 - uInner * uInner, 0.0));' +   // косинус на кромке планеты
    '    if (cRim > 1e-4 && c < cRim) fall = pow(clamp(c / cRim, 0.0, 1.0), uSoft);' +
    '  }' +
    '  float a = band * m * fall * uStr;' +
    '  vec3 col = mix(uColor, uCore, clamp(a, 0.0, 1.0));' +
    '  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0)); }';

  /*
   * Внешнее свечение атмосферы от края диска наружу — правка 30.09
   * («свечение планеты не такое», кадры 553:1286 и 613:2268). Прежнее
   * свечение по Френелю на оболочке было ярче всего у её наружного края
   * и рисовало вокруг шара резкое синее кольцо. Здесь для каждой точки
   * оболочки считается, на каком расстоянии от центра планеты проходит
   * луч взгляда: у самой кромки свечение полное и гаснет наружу
   * экспонентой шириной uWidth (доля радиуса). Оболочка берётся с большим
   * запасом, поэтому к её краю свечение сходит на нет и края не видно.
   * Центр планеты в системе камеры — vC: сетка оболочки лежит в центре
   * world, её модельная матрица переносит начало координат туда же.
   */
  var GLOW_VERT =
    'varying vec3 vP; varying vec3 vC;' +
    'void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vP = mv.xyz;' +
    '  vC = (modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;' +
    '  gl_Position = projectionMatrix * mv; }';
  var GLOW_FRAG =
    'uniform vec3 uColor; uniform float uStr; uniform float uWidth; uniform float uR;' +
    'varying vec3 vP; varying vec3 vC;' +
    'void main(){' +
    '  vec3 d = normalize(vP);' +
    '  float dist = length(vC - d * dot(vC, d));' +      // от луча до центра планеты
    '  float x = max(dist - uR, 0.0) / uWidth;' +
    '  float a = exp(-x) * uStr;' +
    '  gl_FragColor = vec4(uColor, clamp(a, 0.0, 1.0)); }';

  function glowMaterial(color, strength, width) {
    return new THREE.ShaderMaterial({
      transparent: true, blending: THREE.AdditiveBlending,
      side: THREE.BackSide, depthWrite: false,
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uStr: { value: strength },
        uWidth: { value: width },
        uR: { value: R }
      },
      vertexShader: GLOW_VERT,
      fragmentShader: GLOW_FRAG
    });
  }

  function edgeMaterial(color, core, light, o) {
    return new THREE.ShaderMaterial({
      transparent: true, blending: THREE.AdditiveBlending,
      side: THREE.FrontSide, depthWrite: false,
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uCore: { value: new THREE.Color(core) },
        uLight: { value: light },
        uPow: { value: o.power },
        uStr: { value: o.strength },
        uBias: { value: o.bias },
        uSoft: { value: o.softness },
        uInner: { value: o.inner }
      },
      vertexShader: RIM_VERT,
      fragmentShader: EDGE_FRAG
    });
  }

  /* --------------------- дуги: ширина в пикселях --------------------- */

  /*
   * Трубка дуги строится один раз с фиксированным радиусом ARC_BASE, а её
   * настоящая толщина считается в вершинном шейдере: вершина возвращается
   * на ось (position − normal·ARC_BASE) и отодвигается обратно на радиус,
   * который даёт нужную ширину в пикселях на этой глубине. Поэтому дуга
   * выглядит одинаково и на общем плане, и при сильном приближении —
   * геометрию перестраивать не нужно, меняются только два uniform-а.
   *
   * Фрагментный шейдер гасит яркость к краю трубки: у обращённой к камере
   * стороны dot(нормаль, взгляд) равен единице, у силуэта — нулю. Резкая
   * степень даёт светящуюся сердцевину, пологая — ореол вокруг неё.
   */
  var ARC_BASE = 0.01;                  // радиус, с которым построена трубка
  var ARC_LIFT = 0.004;                 // на сколько (доля R) концы дуги над сушей — как точки стран
  var ARC_HALO = 3.0;                   // во сколько раз ореол шире сердцевины
  var uPxK = { value: 0.00064 };        // 2·tan(fov/2)/высота холста, общий uniform

  // Гашение дуги у порта отправления и общий множитель толщины дуг.
  // Значения по умолчанию ничего не меняют: 1 — «как было». Тема перебивает
  // их полями globe.arcStart, globe.arcStartLen и globe.arcWidth (см. init).
  var ARC_START = 1;                    // доля яркости в самой точке порта
  var ARC_START_LEN = 0.02;             // на какой доле пути выходит на полную
  var ARC_WIDTH = 1;                    // множитель толщины дуг

  /*
   * Приглушение золота у поверхности. Все три множителя по умолчанию равны
   * единице — то есть ничего не меняют; тема перебивает их полями
   * globe.arcOpacity, globe.arcHalo и globe.dotScale (см. init).
   * Нужны синей теме: на дневной текстуре веер дуг и точки стран забивали
   * сушу, а в эталоне заказчика золото — это тонкие линии и мелкие точки,
   * сквозь которые материки читаются.
   */
  var ARC_OPACITY = 1;                  // множитель непрозрачности дуг
  var ARC_HALO_K = 1;                   // множитель ширины ореола вокруг дуги
  var DOT_SCALE = 1;                    // множитель размера и яркости точек

  var ARC_VERT =
    'uniform float uBase; uniform float uHalf; uniform float uPxK;' +
    'varying vec3 vN; varying vec3 vP; varying float vT;' +
    'void main(){' +
    '  vec3 n = normalize(normal);' +
    '  vec4 mv = modelViewMatrix * vec4(position - n * uBase, 1.0);' +
    '  vec3 nv = normalize(normalMatrix * n);' +
    '  mv.xyz += nv * (uHalf * max(-mv.z, 0.05) * uPxK);' +
    '  vN = nv; vP = mv.xyz; vT = uv.x;' +      // uv.x трубки — доля пути от порта
    '  gl_Position = projectionMatrix * mv; }';

  /*
   * uStart и uStartLen гасят начало дуги. В порту отправления сходится больше
   * сотни маршрутов, и при аддитивном смешивании их яркости складывались
   * в белое пятно. Теперь у самого порта дуга светит на долю uStart и
   * выходит на полную яркость к uStartLen пути. По умолчанию uStart = 1 —
   * гашения нет, как было раньше.
   */
  var ARC_FRAG =
    'uniform vec3 uColor; uniform float uOpacity;' +
    'uniform float uStart; uniform float uStartLen;' +
    'varying vec3 vN; varying vec3 vP; varying float vT;' +
    'void main(){' +
    '  float d = clamp(dot(normalize(vN), normalize(-vP)), 0.0, 1.0);' +
    '  float core = pow(d, 12.0);' +
    '  float halo = pow(d, 1.3);' +
    '  float g = mix(uStart, 1.0, smoothstep(0.0, max(uStartLen, 1e-4), vT));' +
    '  vec3 c = uColor + vec3(0.28) * core;' +   // сердцевина горячее и белее
    '  gl_FragColor = vec4(c, (core + halo * 0.38) * uOpacity * g); }';

  function arcMaterial(color, half, opacity) {
    return new THREE.ShaderMaterial({
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      uniforms: {
        uBase: { value: ARC_BASE },
        uHalf: { value: half },
        uPxK: uPxK,                     // общий объект: обновляется при resize
        uColor: { value: new THREE.Color(color) },
        uOpacity: { value: opacity },
        uStart: { value: ARC_START },
        uStartLen: { value: ARC_START_LEN }
      },
      vertexShader: ARC_VERT,
      fragmentShader: ARC_FRAG
    });
  }

  /* ------------------------------ сцена ------------------------------ */

  function init(opts) {
    canvas = opts.canvas;
    cfg = opts.config;
    colors = cfg.colors;
    gcfg = cfg.globe;
    onPick = opts.onPick || onPick;
    onInteract = opts.onInteract || onInteract;
    onReady = opts.onReady || onReady;
    if (gcfg.homeX != null) HOME.fx = gcfg.homeX;
    if (gcfg.homeY != null) HOME.fy = gcfg.homeY;
    /* куда смотрит камера в домашнем ракурсе — широта и долгота точки
       в центре диска (правка 30.09, кадр 553:1286: Африка по центру,
       Россия сверху) */
    if (gcfg.homeLat != null && gcfg.homeLon != null) {
      var home = faceAngles(gcfg.homeLat, gcfg.homeLon);
      HOME.phi = home.phi;
      HOME.theta = home.theta;
    }
    ARC_START = num(gcfg.arcStart, 1);
    ARC_START_LEN = num(gcfg.arcStartLen, 0.02);
    ARC_WIDTH = num(gcfg.arcWidth, 1);
    ARC_OPACITY = num(gcfg.arcOpacity, 1);
    ARC_HALO_K = num(gcfg.arcHalo, 1);
    DOT_SCALE = num(gcfg.dotScale, 1);
    OTHER_ARCS = num(gcfg.otherArcs, 0.15);
    SEL_HALF = num(gcfg.selHalf, 3.0);
    OTHER_DOTS = num(gcfg.otherDots, 0.18);
    view.phi = HOME.phi;
    view.theta = HOME.theta;
    view.fx = HOME.fx;
    view.fy = HOME.fy;
    view.zoom = gcfg.defaultZoom;

    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 2));
    if (THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);

    scene = new THREE.Scene();
    // Угол обзора — из темы (globe.fov), по умолчанию прежние 38°.
    // Узкий угол с дальней камерой даёт почти ортографический вид: край
    // диска на 80° от центра, а не на 70°, — как в кадре 553:1286, где
    // по левому краю видна Южная Америка (правка 30.09). zoom при этом
    // остаётся в прежних числах, реальное расстояние считает camDist.
    FOV = num(gcfg.fov, FOV0);
    ZK = Math.tan(FOV0 * DEG / 2) / Math.tan(FOV * DEG / 2);
    camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 200);
    camera.position.set(0, 0, camDist(view.zoom));

    pivotTilt = new THREE.Group();
    pivotSpin = new THREE.Group();
    world = new THREE.Group();
    pivotTilt.add(pivotSpin);
    pivotSpin.add(world);
    scene.add(pivotTilt);

    /*
     * Фон раздела — не картинка за кадром, а огромная сфера со звёздным
     * небом внутри сцены, куда попадает камера. Раньше космос лежал
     * CSS-фоном на обёртке #sec-globe.theme-navy и был виден сквозь
     * прозрачный canvas (renderer alpha:true) — оттого при повороте
     * глобуса небо стояло на месте. Сфера — ребёнок world: та же группа,
     * что вращают перетаскивание, докрутка и автопилот, поэтому звёзды
     * уезжают вслед за глобусом, как и положено виду «из космоса».
     * side: BackSide — видна изнанка (мы внутри сферы), depthWrite: false
     * и renderOrder ниже всех остальных мешей — чтобы фон не мог
     * перекрыть дуги, точки и подсветку страны при любых стечениях глубины.
     * Только у синей темы: у зелёной свой фон (фактура card из CSS),
     * его не трогаем — не по теме и не по духу задачи.
     */
    /*
     * Правка 30.09 («фон в плохом качестве»): сферу заменил плоский слой
     * во весь экран. На сфере снимок 1920 px обходил все 360°, и в кадр
     * (62° по горизонтали) попадала шестая часть его ширины — растянутая
     * почти вшестеро. Теперь снимок лежит на экране один к одному, а
     * «живой фон» остался: при повороте глобуса слой сдвигается ровно
     * на столько, на сколько сдвинулась бы сфера (см. BG_* и render).
     * Края снимка зеркалятся (шейдер), поэтому шва при сдвиге нет —
     * на звёздном небе отражение незаметно.
     */
    if (cfg.theme === 'navy') {
      bgSphere = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
        depthTest: false, depthWrite: false,
        uniforms: {
          tMap: { value: null },
          uOffset: { value: new THREE.Vector2() },
          // приглушаем яркость снимка: без этого звёздная туманность
          // спорит с золотыми дугами. Тема задаёт свой множитель
          // (globe.bgBrightness): по кадрам 30.09 космос светлее
          uBright: { value: num(gcfg.bgBrightness, 0.38) }
        },
        vertexShader:
          'varying vec2 vUv;' +
          'void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.999, 1.0); }',
        fragmentShader:
          'uniform sampler2D tMap; uniform vec2 uOffset; uniform float uBright;' +
          'varying vec2 vUv;' +
          'void main(){' +
          '  vec2 uv = 1.0 - abs(mod(vUv + uOffset, 2.0) - 1.0);' +   // зеркальный повтор
          '  gl_FragColor = vec4(texture2D(tMap, uv).rgb * uBright, 1.0); }'
      }));
      bgSphere.frustumCulled = false;
      bgSphere.renderOrder = -10;
      bgSphere.visible = false;         // до загрузки снимка
      scene.add(bgSphere);
    }

    // общий множитель света: тема может сделать планету ярче, не трогая соседнюю
    var lk = gcfg.lightScale != null ? gcfg.lightScale : 1;
    scene.add(new THREE.AmbientLight(0xffffff, 0.85 * lk));
    var dir = new THREE.DirectionalLight(new THREE.Color(colors.sunLight || '#9FC0FF'), 0.45 * lk);
    dir.position.set(-2, 1.4, 2.2);
    scene.add(dir);

    TEX_GOLD = glowTexture('255,205,120');
    TEX_WHITE = glowTexture('255,240,214');
    TEX_END = endTexture();
    TEX_SHIP = shipTexture(false);          // нос вправо
    TEX_SHIP_L = shipTexture(true);         // нос влево

    // ночная Земля: холодная серо-голубая суша (карта)
    // + тёпло-белые огни городов с ореолом (emissive)
    var earthMat = new THREE.MeshPhongMaterial({
      color: new THREE.Color(colors.land),
      specular: new THREE.Color(colors.ocean),
      shininess: 6,
      emissive: new THREE.Color(colors.cityLights),
      emissiveIntensity: gcfg.lightsIntensity || 1.35
    });
    var loader = new THREE.TextureLoader();
    // Снимки Земли распаковываются долго, поэтому считаем их: когда все
    // готовы и попали в кадр, раздел докладывает onReady — по этому
    // сигналу оболочка гасит цикл у раздела, поднятого в фоне. Фон-космос
    // считаем тем же способом: иначе на долю кадра успеет мелькнуть серая
    // непрозрачная заливка без звёзд.
    texLeft = bgSphere ? 3 : 2;
    function texDone() {
      if (--texLeft > 0) return;
      // ещё кадр, чтобы текстуры успели уехать в видеопамять
      setTimeout(function () { onReady(); }, 0);
    }
    var landSet = TEX_LAND[cfg.theme] || TEX_LAND.navy;
    loader.load(U.asset(pickTexture(landSet)), function (t) {
      earthMat.map = prepTexture(t); earthMat.needsUpdate = true; texDone();
    }, null, texDone);
    var lightSet = TEX_LIGHTS[cfg.theme] || TEX_LIGHTS.navy;
    loader.load(U.asset(pickTexture(lightSet)), function (t) {
      earthMat.emissiveMap = prepTexture(t); earthMat.needsUpdate = true; texDone();
    }, null, texDone);
    // Снимок космоса от заказчика (1920x1080, сжат из assets/concept/src/
    // globe-space-bg.webp) — путь пишем буквально, а не собираем из имени
    // темы: tools/build_dist.py ищет ссылки на assets/ прямо в тексте кода.
    if (bgSphere) {
      loader.load(U.asset('assets/textures/bg_space.webp'), function (t) {
        // цветовое пространство не задаём: шейдер отдаёт значения снимка
        // как есть, без перекодирования — так и должно выглядеть на экране
        t.generateMipmaps = false;
        t.minFilter = THREE.LinearFilter;
        t.magFilter = THREE.LinearFilter;
        bgSphere.material.uniforms.tMap.value = t;
        bgSphere.visible = true;
        texDone();
      }, null, texDone);
    }
    // сегментов много: вблизи на гранёном шаре виден многоугольный край диска
    earth = new THREE.Mesh(new THREE.SphereGeometry(R, 160, 96), earthMat);
    world.add(earth);

    // едва заметные границы стран
    borders = buildBorders(opts.topo);
    world.add(borders);
    // те же контуры — для выбора страны касанием и для подписей названий
    namesRu = opts.names || {};
    buildGeoIndex();

    // мягкая заливка выбранной страны (контур добавляется отдельно, линиями)
    highlight = new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.0024, 96, 64),
      new THREE.MeshBasicMaterial({
        map: buildHighlightTexture(),
        transparent: true, depthWrite: false
      })
    );
    highlight.renderOrder = 2;
    highlight.visible = false;
    world.add(highlight);

    // Ободок атмосферы и мягкое внешнее свечение. Цвет, сила, ширина полосы
    // (степень Френеля: меньше — шире) и радиус оболочки берутся из темы.
    // Нулевая сила — оболочки в сцене нет совсем: в зелёной теме заказчик
    // просил убрать и кольцо, и внешнее свечение, остался только блик
    // по кромке. Лишний прозрачный меш в таком случае не создаётся.
    var rimStr = num(gcfg.rimStrength, 0.50);
    if (rimStr > 0) {
      atmo = new THREE.Mesh(new THREE.SphereGeometry(R * num(gcfg.rimRadius, 1.012), 64, 48),
        rimMaterial(colors.atmosphere, num(gcfg.rimPower, 6.5), rimStr));
      world.add(atmo);
    }
    var haloStr = num(gcfg.haloStrength, 0.15);
    // Дымка атмосферы внутри диска у кромки (кадры 30.09): голубая
    // вуаль по Френелю на оболочке чуть больше планеты, видна лицевая
    // сторона — поэтому светлеет сам край диска, а не кольцо снаружи.
    if (gcfg.hazeStrength) {
      var haze = new THREE.Mesh(new THREE.SphereGeometry(R * 1.002, 128, 96),
        rimMaterial(colors.glow || colors.atmosphere, num(gcfg.hazePower, 2.5), gcfg.hazeStrength, true));
      haze.renderOrder = 7;
      world.add(haze);
    }
    if (gcfg.glowStrength) {
      // свечение от кромки наружу (синяя тема, правка 30.09) — вместо halo
      halo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.35, 64, 48),
        glowMaterial(colors.glow || colors.atmosphere, gcfg.glowStrength, num(gcfg.glowWidth, 0.03)));
      world.add(halo);
    } else if (haloStr > 0) {
      halo = new THREE.Mesh(new THREE.SphereGeometry(R * num(gcfg.haloRadius, 1.13), 48, 32),
        rimMaterial(colors.halo, num(gcfg.haloPower, 4.5), haloStr));
      world.add(halo);
    }
    // Блик по кромке: светится сам край диска, а не кольцо снаружи.
    // Есть только у тем, где задан edgeStrength, — в синей теме
    // этого объекта в сцене нет и картинка не меняется.
    if (gcfg.edgeStrength) {
      var eRad = num(gcfg.edgeRadius, 1.003);
      // направление на свет в системе камеры: по умолчанию — туда же,
      // куда смотрит основной источник сцены (сверху слева)
      var eLight = gcfg.edgeLight
        ? new THREE.Vector3(gcfg.edgeLight[0], gcfg.edgeLight[1], gcfg.edgeLight[2]).normalize()
        : dir.position.clone().normalize();
      edge = new THREE.Mesh(new THREE.SphereGeometry(R * eRad, 160, 96),
        edgeMaterial(colors.edge || colors.atmosphere,
          colors.edgeCore || colors.edge || colors.atmosphere, eLight, {
            power: num(gcfg.edgePower, 6),
            strength: gcfg.edgeStrength,
            bias: num(gcfg.edgeBias, 1),          // 1 — ровное кольцо, как было
            softness: num(gcfg.edgeSoftness, 0),  // 0 — наружу не гасим, как было
            inner: 1 / eRad
          }));
      edge.renderOrder = 8;
      world.add(edge);
    }

    arcGroup = new THREE.Group();
    world.add(arcGroup);

    // Спрайты с sizeAttenuation:false меряют scale не в мировых единицах,
    // а как долю экрана, поэтому размер задаётся в пикселях (см. setPxSizes).
    // точка отправления
    var o = cfg.origin;
    originDot = new THREE.Sprite(new THREE.SpriteMaterial({
      map: TEX_WHITE, transparent: true, sizeAttenuation: false,
      opacity: Math.min(1, DOT_SCALE),
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    originDot.position.copy(toVec3(o.lat, o.lon, R * 1.004));
    world.add(originDot);
    // Концы выбранного маршрута (кадр 613:2268): светлые точки с золотым
    // ореолом у порта отправления и в стране назначения. Точки стран при
    // выборе гаснут, а у линии должны быть видимые концы. Обычное
    // смешивание: сложением белая точка пропадает на золотой заливке
    // страны.
    var endMat = new THREE.SpriteMaterial({
      map: TEX_END, transparent: true, sizeAttenuation: false, depthWrite: false
    });
    destDot = [new THREE.Sprite(endMat), new THREE.Sprite(endMat)];
    destDot[0].position.copy(toVec3(o.lat, o.lon, R * 1.004));
    destDot.forEach(function (d) { d.visible = false; d.renderOrder = 10; world.add(d); });

    // «корабли» — силуэты судов, бегущие друг за другом по выбранному
    // маршруту. Спрайтов заводим сразу SHIP_MAX штук и просто прячем
    // лишние (см. setSelected) — так же, как с фиксированным числом
    // конечных точек: создавать/удалять объекты сцены на каждый клик
    // по стране дороже, чем один раз переключить visible.
    ships = [];
    for (var si = 0; si < SHIP_MAX; si++) {
      // обычное смешивание, не сложение: светлый корпус иначе выгорает
      // в белое пятно на дневной суше синей темы
      var sh = new THREE.Sprite(new THREE.SpriteMaterial({
        map: TEX_SHIP, transparent: true, sizeAttenuation: false,
        depthWrite: false
      }));
      sh.center.set(0.5, 1 - SHIP_KEEL);    // точка на маршруте — киль, судно стоит на линии
      sh.renderOrder = 9;
      sh.visible = false;
      world.add(sh);
      ships.push(sh);
    }

    initLabels();
    bindPointer();
    resize();
    global.addEventListener('resize', resize);
    started = true;
    start();
  }

  /** Запустить цикл отрисовки (idempotent). */
  function start() {
    if (!started || rafId) return;
    lastFrame = 0;
    rafId = requestAnimationFrame(loop);
  }

  /** Остановить цикл: раздел ушёл с экрана, сцена остаётся в памяти. */
  function stop() {
    if (!rafId) return;
    cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function resize() {
    var w = canvas.clientWidth || 1920;
    var h = canvas.clientHeight || 1080;
    // Сцена 1920x1080 растягивается под окно через transform: на панели
    // 3840x2160 при масштабе Windows 100 % это увеличение вдвое при
    // devicePixelRatio = 1. Без поправки глобус рисовался бы в Full HD
    // и растягивался. Плотность считаем по настоящим пикселям экрана,
    // потолок прежний — 2.
    var rect = canvas.getBoundingClientRect();
    var stretch = rect.width > 0 && w > 0 ? rect.width / w : 1;
    renderer.setPixelRatio(Math.min((global.devicePixelRatio || 1) * stretch, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    uRes.value.set(w, h);
    setPxSizes(h);
    applyViewOffset();
  }

  /** Размеры в пикселях: спрайты и точки — CSS-пиксели, дуги — через uniform. */
  var PX = { origin: 28, ship: 64, end: 30, endBig: 38, endSmall: 22, particle: 10 };

  function setPxSizes(h) {
    // мировая длина, дающая один пиксель по вертикали на расстоянии 1 от камеры
    uPxK.value = 2 * Math.tan(camera.fov * DEG / 2) / h;
    if (originDot) originDot.scale.setScalar(PX.origin * DOT_SCALE * uPxK.value);
    if (destDot) destDot.forEach(function (d) { d.scale.setScalar(PX.end * uPxK.value); });
    // PX.ship — ширина судна; высота по пропорции холста
    for (var si = 0; si < ships.length; si++) {
      ships[si].scale.set(PX.ship * uPxK.value, PX.ship * SHIP_H / SHIP_W * uPxK.value, 1);
    }
  }

  function applyViewOffset() {
    var w = canvas.clientWidth || 1920;
    var h = canvas.clientHeight || 1080;
    camera.setViewOffset(w, h, -(view.fx - 0.5) * w, -(view.fy - 0.5) * h, w, h);
    camera.updateProjectionMatrix();
  }

  /* ----------------------------- подписи ----------------------------- */

  var labelHost = null;
  var labels = [];                      // подписи топ-стран
  var originLabel = null, selLabel = null;

  function makeLabel(cls) {
    var el = document.createElement('div');
    el.className = 'glabel' + (cls ? ' ' + cls : '');
    el.style.opacity = 0;
    labelHost.appendChild(el);
    return { el: el, w: 0, h: 0, x: 0, y: 0, vis: false };
  }

  function setLabelText(L, title, sub) {
    L.el.innerHTML = '<span>' + title + '</span><i>' + sub + '</i>';
    L.w = L.el.offsetWidth;
    L.h = L.el.offsetHeight;
  }

  function initLabels() {
    // ищем внутри обёртки раздела: в app.html рядом лежат ещё два раздела
    labelHost = U.scope('globe').querySelector('[id="glabels"]');
    originLabel = makeLabel('is-port');
    setLabelText(originLabel, cfg.origin.name, cfg.origin.note || '');
    selLabel = makeLabel('is-port');
    // до подгрузки шрифтов ширина подписей меряется неверно — пересчитываем
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () {
        var all = labels.concat([originLabel, selLabel]);
        all.forEach(function (L) { L.w = L.el.offsetWidth; L.h = L.el.offsetHeight; });
        namesMeasured = false;
      });
    }
    // Узлы названий стран и точки под них готовим заранее, в паузе после
    // запуска (десятки миллисекунд), а не в момент первого приближения.
    setTimeout(prepNames, 1500);
  }

  var pTmp = new THREE.Vector3(), pNrm = new THREE.Vector3();

  /** Экранная позиция точки на глобусе + признак «лицевая сторона». */
  function project(worldPos, out) {
    var w = canvas.clientWidth || 1920;
    var h = canvas.clientHeight || 1080;
    pTmp.copy(worldPos);
    pNrm.copy(pTmp).normalize();
    var toCam = pTmp.clone().sub(camera.position).normalize();
    out.front = -toCam.dot(pNrm) > 0.06;
    pTmp.project(camera);
    out.x = (pTmp.x * 0.5 + 0.5) * w;
    out.y = (-pTmp.y * 0.5 + 0.5) * h;
    out.front = out.front && pTmp.z < 1;
    return out;
  }

  /** Прямоугольник подписи с учётом transform: translate(-50%, -140%). */
  function labelRect(L, dy) {
    return { l: L.x - L.w / 2, r: L.x + L.w / 2, t: L.y - L.h * 1.4 + dy, b: L.y - L.h * 0.4 + dy };
  }

  function overlaps(a, b) {
    return a.l < b.r + 6 && a.r > b.l - 6 && a.t < b.b + 4 && a.b > b.t - 4;
  }

  var placed = [];
  var tmpV = new THREE.Vector3();
  var centre = { x: 960, y: 540, front: true };
  var originPt = { x: 960, y: 540 };
  var zeroV = new THREE.Vector3();

  /** Возвращает true, если подпись показана; её рамка остаётся в L.rect. */
  function placeLabel(L, worldPos, alpha, isOrigin) {
    L.rect = null;
    if (alpha <= 0.01) { L.el.style.opacity = 0; return false; }
    project(worldPos, L);
    if (isOrigin) { originPt.x = L.x; originPt.y = L.y; }
    if (!L.front) { L.el.style.opacity = 0; return false; }

    // Подпись отодвигается от центра глобуса, а рядом с точкой отправления —
    // от неё самой: иначе подписи ближних стран тонут в узле маршрутов.
    var ax = centre.x, ay = centre.y, push = 18;
    if (!isOrigin) {
      var d = Math.hypot(L.x - originPt.x, L.y - originPt.y);
      if (d > 2 && d < 170) { ax = originPt.x; ay = originPt.y; push = 52; }
    }
    var ox = L.x - ax, oy = L.y - ay;
    var len = Math.hypot(ox, oy) || 1;
    L.x += ox / len * push;
    L.y += oy / len * push;
    // если подпись налезает на уже размещённую — сдвигаем вниз, иначе прячем
    var dy = 0, ok = false;
    for (var step = 0; step < 3 && !ok; step++) {
      var rect = labelRect(L, dy);
      ok = true;
      for (var i = 0; i < placed.length; i++) {
        if (overlaps(rect, placed[i])) { ok = false; break; }
      }
      if (!ok) dy += L.h + 6;
    }
    if (!ok) { L.el.style.opacity = 0; return false; }
    L.rect = labelRect(L, dy);
    placed.push(L.rect);
    L.el.style.transform = 'translate(-50%, -140%) translate(' +
      L.x.toFixed(1) + 'px,' + (L.y + dy).toFixed(1) + 'px)';
    L.el.style.opacity = alpha;
    return true;
  }

  var topShown = {};                    // iso стран, у которых видна подпись с объёмом

  function updateLabels() {
    placed.length = 0;
    world.updateMatrixWorld();
    project(zeroV, centre);

    tmpV.copy(originDot.position).applyMatrix4(world.matrixWorld);
    placeLabel(originLabel, tmpV, 1, true);

    if (selected && routeByName[selected]) {
      var r = routeByName[selected];
      tmpV.copy(r.dest).multiplyScalar(1.004).applyMatrix4(world.matrixWorld);
      placeLabel(selLabel, tmpV, 1);
    } else {
      selLabel.el.style.opacity = 0;
    }

    for (var k in topShown) delete topShown[k];
    for (var i = 0; i < labels.length; i++) {
      var L = labels[i];
      if (selected) { L.el.style.opacity = 0; L.rect = null; continue; }
      tmpV.copy(L.pos).applyMatrix4(world.matrixWorld);
      if (placeLabel(L, tmpV, 1) && L.iso) topShown[L.iso] = 1;
    }
    updateNames();
  }

  function rebuildLabels(items) {
    for (var i = 0; i < labels.length; i++) labelHost.removeChild(labels[i].el);
    labels = [];
    var top = items.slice(0, 8);       // items уже отсортированы по убыванию
    for (var j = 0; j < top.length; j++) {
      var L = makeLabel(null);
      setLabelText(L, top[j].name, U.fmtVolume(top[j].value) + ' тыс. т');
      L.pos = toVec3(top[j].lat, top[j].lon, R * 1.004);
      L.iso = top[j].iso ? String(top[j].iso) : null;
      L.name = top[j].name;
      labels.push(L);
    }
  }

  /* ---------------- названия стран при сильном приближении ----------------

     Когда глобус подведён близко (zoom от NAMES_FROM до NAMES_FULL), на нём
     проявляются русские названия стран — чтобы страну можно было узнать
     и коснуться. Правила:

       - подпись стоит в «середине» самого большого полигона страны
         (labelPoint), а не в столице;
       - видна только на лицевой стороне шара и гаснет к его краю;
       - подписи не налезают друг на друга: раскладываются по порядку
         важности — сначала страны-импортёры выбранного года (по объёму),
         потом остальные по площади; не влезшая подпись скрывается;
       - у восьми крупнейших направлений уже есть подпись с объёмом —
         второе название поверх неё не ставим;
       - на кадре «Страна» названий нет: там своя подсветка и подпись.

     Узлы создаются один раз (около 170 штук), а в кадре меняются только
     transform и opacity — и только когда значение действительно
     изменилось. Пока глобус не приближен, цикл их вообще не трогает. */

  var NAMES_FROM = 2.9;                 // с какого расстояния камеры начинают проявляться
  var NAMES_FULL = 2.45;                // с какого видны целиком (ближе всего — minZoom 2.0)
  var nameLabels = null;                // [{el, w, h, pos, iso, area, imp, x, y, op, tf, rect}]
  var namesOn = false;                  // в прошлом кадре подписи были на экране
  var namesMeasured = false;
  var nv = new THREE.Vector3();

  function prepNames() {
    if (nameLabels || !labelHost) return;
    nameLabels = [];
    for (var i = 0; i < geoCountries.length; i++) {
      var g = geoCountries[i];
      if (NAME_SKIP[g.iso]) continue;
      var name = namesRu[g.iso] || EXTRA_RU[g.iso];
      if (!name) continue;
      var p = labelPoint(g.main);
      var el = document.createElement('div');
      el.className = 'glabel is-name';
      el.textContent = name;
      el.style.opacity = 0;
      labelHost.appendChild(el);
      nameLabels.push({ el: el, w: 0, h: 0, iso: g.iso, area: g.area, imp: 0,
        pos: toVec3(p.lat, p.lon, R * 1.004), x: 0, y: 0, op: 0, tf: '', rect: null });
    }
    namesMeasured = false;
    sortNames();
  }

  /** Порядок важности: импортёры года по объёму, затем крупные страны. */
  function sortNames() {
    if (!nameLabels) return;
    nameLabels.forEach(function (L) {
      var r = routeByIso[L.iso];
      L.imp = r ? r.value : 0;
      L.el.classList.toggle('is-imp', !!r);
    });
    nameLabels.sort(function (a, b) { return (b.imp - a.imp) || (b.area - a.area); });
  }

  function measureNames() {
    if (!nameLabels) return;
    nameLabels.forEach(function (L) { L.w = L.el.offsetWidth; L.h = L.el.offsetHeight; });
    namesMeasured = nameLabels.length > 0 && nameLabels[0].w > 0;
  }

  /** 0 — названий нет, 1 — видны целиком; плавно по расстоянию камеры. */
  function namesAlpha() {
    if (selected) return 0;
    var t = (NAMES_FROM - view.zoom) / (NAMES_FROM - NAMES_FULL);
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    return t * t * (3 - 2 * t);
  }

  /*
   * Плашки интерфейса поверх глобуса: панели, кнопки, заголовок. Подпись
   * под плашкой не видна целиком, а обрезок названия у её края («Туркменист»)
   * выглядит как ошибка — такие подписи не показываем. Рамки плашек
   * снимаются из разметки в координатах сцены 1920×1080 и обновляются
   * раз в полсекунды: кадр раздела мог смениться.
   */
  var obstacles = [], obstaclesT = 0;

  function readObstacles() {
    obstacles.length = 0;
    var host = labelHost && labelHost.parentNode;
    if (!host) return;
    var hr = host.getBoundingClientRect();
    var k = host.offsetWidth ? hr.width / host.offsetWidth : 1;
    if (!k) return;
    var els = host.querySelectorAll('.panel, .ghost-btn, .screen-title');
    for (var i = 0; i < els.length; i++) {
      var r = els[i].getBoundingClientRect();
      if (!r.width || !r.height) continue;       // скрыта на этом кадре
      obstacles.push({ l: (r.left - hr.left) / k, r: (r.right - hr.left) / k,
                       t: (r.top - hr.top) / k, b: (r.bottom - hr.top) / k });
    }
  }

  function updateNames() {
    var a = namesAlpha();
    if (a <= 0.01) {
      if (namesOn) {
        for (var h = 0; h < nameLabels.length; h++) {
          var Lh = nameLabels[h];
          Lh.rect = null;
          if (Lh.op) { Lh.el.style.opacity = 0; Lh.op = 0; }
        }
        namesOn = false;
      }
      return;
    }
    if (!nameLabels) prepNames();
    if (!nameLabels) return;
    if (!namesMeasured) measureNames();
    var now = performance.now();
    if (!namesOn || now - obstaclesT > 500) { readObstacles(); obstaclesT = now; }
    namesOn = true;

    var W = canvas.clientWidth || 1920, H = canvas.clientHeight || 1080;
    var cam = camera.position, m = world.matrixWorld;
    for (var i = 0; i < nameLabels.length; i++) {
      var L = nameLabels[i], op = 0;
      L.rect = null;
      nv.copy(L.pos).applyMatrix4(m);
      // косинус между нормалью в точке и направлением на камеру:
      // 1 — точка смотрит прямо на нас, 0 — на самом краю диска
      var tx = cam.x - nv.x, ty = cam.y - nv.y, tz = cam.z - nv.z;
      var c = (nv.x * tx + nv.y * ty + nv.z * tz) / (Math.sqrt(tx * tx + ty * ty + tz * tz) * 1.004);
      if (c > 0.05) {
        nv.project(camera);
        L.x = (nv.x * 0.5 + 0.5) * W;
        L.y = (-nv.y * 0.5 + 0.5) * H;
        var tf = 'translate(' + L.x.toFixed(1) + 'px,' + L.y.toFixed(1) + 'px) translate(-50%,-50%)';
        if (tf !== L.tf) { L.el.style.transform = tf; L.tf = tf; }
        if (c > 0.2 && !topShown[L.iso] && L.x > 0 && L.x < W && L.y > 0 && L.y < H) {
          var rect = { l: L.x - L.w / 2, r: L.x + L.w / 2, t: L.y - L.h / 2, b: L.y + L.h / 2 };
          var ok = true, j;
          for (j = 0; j < obstacles.length && ok; j++) {
            if (overlaps(rect, obstacles[j])) ok = false;
          }
          for (j = 0; j < placed.length && ok; j++) {
            if (overlaps(rect, placed[j])) ok = false;
          }
          if (ok) {
            placed.push(rect);
            L.rect = rect;
            var e = (c - 0.2) / 0.22;
            e = e > 1 ? 1 : e;
            op = a * e;
          }
        }
      }
      op = Math.round(op * 20) / 20;
      if (op !== L.op) { L.el.style.opacity = op; L.op = op; }
    }
  }

  /* ----------------------------- маршруты ----------------------------- */

  function disposeRoutes() {
    routes.forEach(function (r) {
      arcGroup.remove(r.mesh);
      r.mesh.geometry.dispose();
      r.mesh.material.dispose();
    });
    routes = [];
    routeByName = {};
    routeByIso = {};
    [endPointsBig, endPointsSmall, particles].forEach(function (p) {
      if (!p) return;
      world.remove(p);
      p.geometry.dispose();
      p.material.dispose();
    });
    endPointsBig = endPointsSmall = particles = null;
  }

  function endPoints(list, size, opacity) {
    if (!list.length) return null;
    // endDisc (синяя тема, кадр 553:1286): на конце каждой линии белая
    // точка с золотым ореолом, как у выбранного маршрута, — обычным
    // смешиванием: сложением на светлой суше точка выгорала бы в пятно
    var disc = !!gcfg.endDisc;
    var pos = [];
    for (var i = 0; i < list.length; i++) {
      var d = list[i].dest.clone().multiplyScalar(1.004);
      pos.push(d.x, d.y, d.z);
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    // sizeAttenuation:false — size прямо в CSS-пикселях, зум на него не влияет
    var p = new THREE.Points(g, new THREE.PointsMaterial({
      size: size, sizeAttenuation: false, map: disc ? TEX_END : TEX_GOLD,
      color: disc ? 0xFFFFFF : 0xFFD9A0, transparent: true, opacity: opacity,
      blending: disc ? THREE.NormalBlending : THREE.AdditiveBlending, depthWrite: false
    }));
    p.renderOrder = 4;
    world.add(p);
    return p;
  }

  var PPA = 3;                          // частиц на одну дугу

  /**
   * items: [{name, lat, lon, value, iso}] — только страны с объёмом > 0,
   * отсортированные по убыванию. animate: рисовать дуги «от РФ к стране».
   */
  function setRoutes(items, animate) {
    disposeRoutes();
    selected = null;
    shipCount = 0;
    for (var si = 0; si < ships.length; si++) ships[si].visible = false;
    if (destDot) destDot[0].visible = destDot[1].visible = false;
    drawHighlight(null);

    var origin = toVec3(cfg.origin.lat, cfg.origin.lon, R);
    var maxV = 0, minV = Infinity;
    items.forEach(function (it) {
      if (it.value > maxV) maxV = it.value;
      if (it.value < minV) minV = it.value;
    });
    var lgMin = Math.log10(Math.max(minV, 1e-4));
    var lgMax = Math.log10(Math.max(maxV, 1e-3));
    var span = Math.max(lgMax - lgMin, 0.001);

    items.forEach(function (it) {
      var norm = (Math.log10(Math.max(it.value, 1e-4)) - lgMin) / span;
      norm = Math.max(0, Math.min(1, norm));

      var dest = toVec3(it.lat, it.lon, R);
      var angle = Math.acos(Math.max(-1, Math.min(1, origin.dot(dest))));
      // высота дуги по дальности; наименьшую тема может поднять
      // (globe.arcAltMin): в кадре 613:2268 короткий маршрут заметно
      // выгнут над шаром, а не стелется по суше
      // arcAltK — насколько дальние маршруты выше ближних; в кадре
      // 553:1286 дуги стелются низко и изгибаются по шару, а не торчат
      var alt = num(gcfg.arcAltMin, 0.03) + num(gcfg.arcAltK, 0.235) * (angle / Math.PI);

      var pts = [];
      var N = gcfg.arcSegments;
      // arcLatLon: путь ведётся равномерно по широте и долготе, а не по
      // кратчайшей дуге. Так нарисованы маршруты в кадрах 553:1286
      // и 613:2268 (правка 30.09): веер из России расходится во все
      // стороны, дальние линии сначала уходят на запад или восток и лишь
      // потом спускаются, а не тянутся прямыми лучами через полюс.
      var o0 = cfg.origin, dLon = ((it.lon - o0.lon + 540) % 360) - 180;
      var dLat = it.lat - o0.lat;
      // arcBow — боковой изгиб веера (доля длины пути): дуги выгибаются
      // наружу — на запад или восток и вверх, — как в кадре 553:1286.
      // Нормаль к пути в плоскости «широта, долгота» берётся с той
      // стороны, что смотрит на север и в сторону назначения.
      var bow = num(gcfg.arcBow, 0), bLat = 0, bLon = 0;
      if (gcfg.arcLatLon && bow) {
        var ex = dLon * Math.cos(o0.lat * DEG), len = Math.sqrt(dLat * dLat + ex * ex) || 1;
        bLat = -ex / len; bLon = dLat / len;
        if (bLat + bLon * (dLon < 0 ? -1 : 1) < 0) { bLat = -bLat; bLon = -bLon; }
        bLat *= bow * len;
        bLon *= bow * len;
      }
      for (var i = 0; i <= N; i++) {
        var t = i / N;
        var sb = Math.sin(Math.PI * t);
        var p = gcfg.arcLatLon
          ? toVec3(o0.lat + dLat * t + bLat * sb, o0.lon + dLon * t + bLon * sb, R)
          : slerp(origin, dest, t);
        // ARC_LIFT: концы дуги не лежат на самой поверхности — иначе у края
        // диска шар перекрывал начало маршрута и линия обрывалась, не дойдя
        // до точки отправления (правка 30.09)
        p.multiplyScalar(1 + ARC_LIFT + alt * Math.sin(Math.PI * t));
        pts.push(p);
      }
      var curve = new THREE.CatmullRomCurve3(pts);

      // полуширина светящейся сердцевины в пикселях экрана — по лог-шкале объёма
      var half = (0.80 + 1.30 * norm * norm) * ARC_WIDTH;
      var opacity = (0.42 + 0.55 * norm) * ARC_OPACITY;
      var geo = new THREE.TubeGeometry(curve, N, ARC_BASE, 8, false);
      var mesh = new THREE.Mesh(geo,
        arcMaterial(colors.route, half * ARC_HALO * ARC_HALO_K, opacity));
      mesh.renderOrder = 3;
      arcGroup.add(mesh);

      var route = {
        name: it.name, value: it.value, norm: norm, iso: it.iso, port: it.port,
        curve: curve, pts: pts, mesh: mesh,
        baseHalf: half, baseOpacity: opacity, dest: dest, phase: Math.random()
      };
      routes.push(route);
      routeByName[it.name] = route;
      if (it.iso && !routeByIso[it.iso]) routeByIso[String(it.iso)] = route;
    });

    // светящиеся точки на концах: два размера — крупные направления заметнее
    var big = routes.slice(0, 8), small = routes.slice(8);
    if (gcfg.endDisc) {
      // размеры точки в px: ядро около трети спрайта, остальное — ореол
      endPointsBig = endPoints(big, num(gcfg.endBig, 34), 1);
      endPointsSmall = endPoints(small, num(gcfg.endSmall, 26), 0.92);
    } else {
      endPointsBig = endPoints(big, PX.endBig * DOT_SCALE, 0.95 * DOT_SCALE);
      endPointsSmall = endPoints(small, PX.endSmall * DOT_SCALE, 0.75 * DOT_SCALE);
    }

    // бегущие частицы: один Points-объект на все дуги
    if (routes.length) {
      var g = new THREE.BufferGeometry();
      g.setAttribute('position',
        new THREE.Float32BufferAttribute(new Float32Array(routes.length * PPA * 3), 3));
      // particleOpacity — тема может приглушить бегущие искры: в кадре
      // 553:1286 линии ровные, искр на них почти не видно
      particles = new THREE.Points(g, new THREE.PointsMaterial({
        size: PX.particle * DOT_SCALE, sizeAttenuation: false, map: TEX_GOLD,
        color: 0xFFD9A0, transparent: true, opacity: 0.9 * num(gcfg.particleOpacity, DOT_SCALE),
        blending: THREE.AdditiveBlending, depthWrite: false
      }));
      particles.renderOrder = 5;
      world.add(particles);
    }

    rebuildLabels(items);
    sortNames();                        // импортёры года — первыми в очереди подписей

    if (animate === false) {
      routes.forEach(function (r) { r.mesh.geometry.setDrawRange(0, Infinity); });
      drawAnim = null;
    } else {
      routes.forEach(function (r) { r.mesh.geometry.setDrawRange(0, 0); });
      drawAnim = { t0: performance.now(), dur: 900 };
    }
  }

  function stepDrawAnim(now) {
    if (!drawAnim) return;
    var p = (now - drawAnim.t0) / drawAnim.dur;
    for (var i = 0; i < routes.length; i++) {
      var stagger = (i % 12) * 0.02;
      var q = Math.max(0, Math.min(1, (p - stagger) / (1 - 0.24)));
      var geo = routes[i].mesh.geometry;
      var total = geo.index ? geo.index.count : geo.attributes.position.count;
      var n = Math.floor(total * U.easeInOutCubic(q) / 3) * 3;
      geo.setDrawRange(0, n);
    }
    if (p >= 1.3) {
      routes.forEach(function (r) { r.mesh.geometry.setDrawRange(0, Infinity); });
      drawAnim = null;
    }
  }

  /** Точка на дуге по доле пути — по заранее посчитанным узлам, без аллокаций. */
  function pointAt(r, f, out) {
    var n = r.pts.length - 1;
    var s = f * n;
    var i = s | 0;
    if (i >= n) i = n - 1;
    var k = s - i;
    var a = r.pts[i], b = r.pts[i + 1];
    out.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);
    return out;
  }

  /* ------------------------ выделение и фокус ------------------------ */

  var SEL_HALF = 3.0;                   // полуширина выбранной дуги, пиксели
  /* Насколько видны остальные маршруты и точки-страны, пока выбрана
     одна страна: доля обычной яркости. По умолчанию приглушены; в синей
     теме по макету 613:2268 (правка 30.09) их не видно вовсе — поля
     globe.otherArcs / globe.otherDots темы в config.json. */
  var OTHER_ARCS = 0.15;
  var OTHER_DOTS = 0.18;

  function setSelected(name) {
    selected = name && routeByName[name] ? name : null;
    routes.forEach(function (r) {
      var u = r.mesh.material.uniforms;
      var isSel = r.name === selected;
      // выбранный маршрут светит в полную силу от самого порта: гашение начала
      // нужно только там, где дуги сходятся пучком, а здесь она одна
      u.uStart.value = isSel ? 1 : ARC_START;
      if (!selected) {
        u.uColor.value.set(colors.route);
        u.uOpacity.value = r.baseOpacity;
        u.uHalf.value = r.baseHalf * ARC_HALO * ARC_HALO_K;
      } else if (isSel) {
        u.uColor.value.set(colors.routeActive);
        u.uOpacity.value = 1.0;
        u.uHalf.value = SEL_HALF * ARC_HALO;   // SEL_HALF тема может сузить (globe.selHalf)
      } else {
        u.uColor.value.set(colors.route);
        u.uOpacity.value = r.baseOpacity * OTHER_ARCS;   // остальные приглушены
        u.uHalf.value = r.baseHalf * ARC_HALO * ARC_HALO_K;
      }
    });
    var dim = selected ? OTHER_DOTS : 1;
    if (endPointsBig) endPointsBig.material.opacity = (gcfg.endDisc ? 1 : 0.95) * dim;
    if (endPointsSmall) endPointsSmall.material.opacity = (gcfg.endDisc ? 0.92 : 0.75) * dim;
    if (particles) particles.material.opacity = 0.9 * num(gcfg.particleOpacity, DOT_SCALE) * (selected ? 0.3 * OTHER_DOTS / 0.18 : 1);

    var r = selected ? routeByName[selected] : null;
    // сколько корабликов идёт по маршруту и с какой скоростью — по объёму
    // экспорта в эту страну за выбранный год: r.norm уже посчитан в
    // setRoutes на лог-шкале 0..1 относительно всех стран текущего года
    // (тем же числом подписан цвет и толщина дуги). Больше объём — больше
    // судов и идут они быстрее; потолок SHIP_MAX не даёт маршруту
    // превратиться в сплошную линию при самом большом объёме.
    shipCount = r ? U.clamp(Math.round(1 + r.norm * (SHIP_MAX - 1)), 1, SHIP_MAX) : 0;
    shipSpeed = r ? SHIP_SPEED_MIN + (SHIP_SPEED_MAX - SHIP_SPEED_MIN) * r.norm : 0;
    for (var si = 0; si < ships.length; si++) ships[si].visible = si < shipCount;
    if (destDot) {
      destDot[0].visible = destDot[1].visible = !!r;
      if (r) destDot[1].position.copy(r.dest).multiplyScalar(1.004);
    }

    drawHighlight(r ? r.iso : null);
    if (r) {
      setLabelText(selLabel, r.name,
        (r.port && r.port !== r.name ? r.port + ' · ' : '') +
        U.fmtVolume(r.value) + ' тыс. т');
    }
  }

  /**
   * Куда встаёт центр планеты на кадре «Страна». Справа лежат панели
   * страны и продукции (от 1326 px), слева панелей нет — поэтому глобус
   * уезжает левее середины, чтобы кадр не заваливался вправо.
   * Подстраивается полями globe.countryX / globe.countryY в config.json.
   */
  var focusFy = null;                   // fy последнего кадра «Страна» (см. focus)
  function countryFx() { return gcfg.countryX != null ? gcfg.countryX : 0.40; }
  function countryFy() { return gcfg.countryY != null ? gcfg.countryY : 0.51; }

  function focus(name) {
    var r = routeByName[name];
    if (!r) return;
    var origin = toVec3(cfg.origin.lat, cfg.origin.lon, R);
    var mid = slerp(origin, r.dest, 0.5).normalize();
    var ll = vecToLatLon(mid);
    var a = faceAngles(ll.lat, ll.lon);
    var angle = Math.acos(Math.max(-1, Math.min(1, origin.dot(r.dest.clone().normalize()))));
    // чем длиннее маршрут, тем дальше камера — чтобы дуга влезла целиком.
    // Верхняя граница своя (focusMaxZoom), а не defaultZoom: в зелёной теме
    // глобус на «Карте» крупнее, но экран «Путь» от этого меняться не должен.
    var far = gcfg.focusMaxZoom != null ? gcfg.focusMaxZoom : gcfg.defaultZoom;
    var zoom = U.clamp(gcfg.focusZoom + angle * 0.55, gcfg.focusZoom, far);
    /* countryLatShift — на сколько градусов южнее середины маршрута
       смотрит камера. Тогда шар ниже и крупнее, а маршрут идёт по его
       верхней части, как в кадре 613:2268 (правка 30.09). У дальних
       маршрутов сдвиг меньше, а от полутора радиан (Бразилия,
       Индонезия) его нет вовсе: иначе страна уезжает вниз под кнопку
       и шкалу лет. Без поля всё как раньше — камера на середину. */
    var shift = gcfg.countryLatShift || 0;
    var k = U.clamp(1 - (angle - 0.5) / 1.0, 0, 1);
    if (shift) a = faceAngles(ll.lat - shift * k, ll.lon);
    var fy = countryFy();
    if (shift && gcfg.countryYFar != null) fy = gcfg.countryYFar + (fy - gcfg.countryYFar) * k;
    animateTo({ phi: U.clamp(a.phi, -1.2, 1.2), theta: a.theta, zoom: zoom,
                fx: countryFx(), fy: fy }, 1000);
    focusFy = fy;
    autoRotate = false;
  }

  function resetView() {
    animateTo({ phi: HOME.phi, theta: HOME.theta, zoom: gcfg.defaultZoom, fx: HOME.fx, fy: HOME.fy }, 800);
    autoRotate = true;
  }

  function setLayout(mode) {
    if (mode === 'A') {
      animateTo({ fx: HOME.fx, fy: HOME.fy }, 700);
    } else {
      animateTo({ fx: countryFx(), fy: focusFy != null ? focusFy : countryFy() }, 700);
    }
  }

  function animateTo(to, dur) {
    var from = { phi: view.phi, theta: view.theta, zoom: view.zoom, fx: view.fx, fy: view.fy };
    var goal = {
      phi: to.phi != null ? to.phi : from.phi,
      zoom: to.zoom != null ? to.zoom : from.zoom,
      fx: to.fx != null ? to.fx : from.fx,
      fy: to.fy != null ? to.fy : from.fy,
      theta: from.theta
    };
    if (to.theta != null) {
      var d = (to.theta - from.theta) % (Math.PI * 2);
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      goal.theta = from.theta + d;
    }
    target = { from: from, to: goal, t0: performance.now(), dur: dur || 800 };
    spin.theta = spin.phi = 0;          // перелёт камеры отменяет докрутку
  }

  /* ---------------------------- управление ---------------------------- */

  var pointers = {};
  var dragging = false, pinchStart = 0, zoomStart = 0;
  var tapInfo = null;

  /*
   * Вращение «за пальцем». Шар крутится в ту же сторону, куда тянут,
   * и точка под пальцем остаётся под пальцем: угол поворота на один
   * пиксель — это размер пикселя на глубине ближней точки шара
   * (uPxK · (zoom − R)). Поэтому вблизи шар крутится медленнее,
   * вдали — быстрее, и выбрать страну при сильном приближении легко.
   * Касания приходят в пикселях окна, а сцена 1920×1080 масштабируется
   * под экран (fitStage в app.js) — делим на этот масштаб.
   *
   * После быстрого взмаха шар ещё немного докручивается по инерции
   * и плавно останавливается (spin, гасится в loop).
   */
  var spin = { theta: 0, phi: 0 };      // скорость докрутки, рад/с
  var SPIN_DAMP = 4.0;                  // чем больше, тем быстрее гаснет
  var lastMove = 0;

  /*
   * zoom — расстояние камеры при угле обзора 38°. При другом угле
   * (globe.fov) камера ставится так, чтобы шар на экране был того же
   * размера: радиус диска ∝ 1 / (√(d² − 1) · tan(fov / 2)). Поэтому все
   * числа zoom в config.json, пороги подписей и пределы масштаба
   * остаются прежними.
   */
  var FOV0 = 38, FOV = 38, ZK = 1;
  function camDist(z) {
    return ZK === 1 ? z : Math.sqrt(1 + (z * z - 1) * ZK * ZK);
  }

  function dragK() {
    var rect = canvas.getBoundingClientRect();
    var h = canvas.clientHeight || 1080;
    var s = rect.height > 0 ? rect.height / h : 1;
    return uPxK.value * Math.max(camera.position.z - R, 0.2) / s;
  }

  function bindPointer() {
    canvas.addEventListener('pointerdown', function (e) {
      canvas.setPointerCapture(e.pointerId);
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      var n = Object.keys(pointers).length;
      onInteract();
      spin.theta = spin.phi = 0;
      if (n === 1) {
        dragging = true;
        tapInfo = { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 };
        lastMove = performance.now();
        target = null;
        autoRotate = false;
      } else if (n === 2) {
        dragging = false;
        tapInfo = null;
        pinchStart = pinchDist();
        zoomStart = view.zoom;
      }
    });

    canvas.addEventListener('pointermove', function (e) {
      var p = pointers[e.pointerId];
      if (!p) return;
      var dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      var n = Object.keys(pointers).length;
      onInteract();

      if (n === 1 && dragging) {
        if (tapInfo) tapInfo.moved += Math.abs(dx) + Math.abs(dy);
        var k = dragK();
        // поворот вокруг наклонённой оси: у полюса точка на экране ходит
        // медленнее (cos широты), подгоняем, но не больше чем в 1,7 раза
        var dTh = dx * k / Math.max(Math.cos(view.phi), 0.6);
        var dPh = dy * k;
        view.theta += dTh;              // тянут вправо — шар крутится вправо
        view.phi = U.clamp(view.phi + dPh, -1.35, 1.35);
        // скорость для докрутки: сглаженная по последним движениям
        var now = performance.now(), dt = Math.max((now - lastMove) / 1000, 0.008);
        lastMove = now;
        spin.theta = spin.theta * 0.5 + (dTh / dt) * 0.5;
        spin.phi = spin.phi * 0.5 + (dPh / dt) * 0.5;
      } else if (n === 2) {
        var d = pinchDist();
        if (pinchStart > 4 && d > 4) {
          view.zoom = U.clamp(zoomStart * (pinchStart / d), gcfg.minZoom, gcfg.maxZoom);
        }
      }
    });

    function release(e) {
      // касание, а не перетаскивание: палец почти не сдвинулся и отпущен быстро
      var single = Object.keys(pointers).length === 1;
      if (tapInfo && single && tapInfo.moved < 12 && performance.now() - tapInfo.t < 500) {
        spin.theta = spin.phi = 0;
        var name = pick(e.clientX, e.clientY);
        if (name) onPick(name);
      } else if (!tapInfo || !single || performance.now() - lastMove > 90) {
        // палец остановился перед тем, как его убрали, или это был щипок —
        // шар остаётся там, где его отпустили
        spin.theta = spin.phi = 0;
      } else {
        spin.theta = U.clamp(spin.theta, -6, 6);
        spin.phi = U.clamp(spin.phi, -3, 3);
      }
      delete pointers[e.pointerId];
      if (!Object.keys(pointers).length) { dragging = false; tapInfo = null; }
    }
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', function (e) {
      delete pointers[e.pointerId];
      dragging = false; tapInfo = null;
      spin.theta = spin.phi = 0;
    });

    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      onInteract();
      target = null;
      autoRotate = false;
      spin.theta = spin.phi = 0;
      view.zoom = U.clamp(view.zoom * (1 + Math.sign(e.deltaY) * 0.10), gcfg.minZoom, gcfg.maxZoom);
    }, { passive: false });

    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }

  function pinchDist() {
    var ids = Object.keys(pointers);
    if (ids.length < 2) return 0;
    var a = pointers[ids[0]], b = pointers[ids[1]];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  /*
   * Попадание пальцем считается в экранных координатах: узлы дуг проецируются
   * на холст и сравниваются с точкой касания по расстоянию в пикселях. Допуск
   * не зависит от приближения — на общем плане в тонкую дугу попасть так же
   * легко, как раньше по толстой невидимой трубке, а вблизи соседние маршруты
   * не перехватывают касание. Заодно из сцены ушли 226 служебных объектов.
   */
  var HIT_ARC_PX = 14;                  // допуск по дуге
  var HIT_DOT_PX = 22;                  // допуск по маркеру страны
  var hitM = new THREE.Matrix4();
  var hv = new THREE.Vector3(), hd = new THREE.Vector3(), hc = new THREE.Vector3();
  var hpx = [], hpy = [], hvis = [];

  /** Точка мира видна, если отрезок «камера → точка» не протыкает планету. */
  function frontOf(p) {
    hd.copy(p).sub(camera.position);
    var dd = hd.lengthSq();
    var t = dd > 1e-9 ? -camera.position.dot(hd) / dd : 0;
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    hc.copy(camera.position).addScaledVector(hd, t);
    return hc.lengthSq() > 0.995 * 0.995;
  }

  /** Квадрат расстояния от точки до отрезка на экране. */
  function segDist2(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay;
    var dd = dx * dx + dy * dy;
    var t = dd > 1e-6 ? ((px - ax) * dx + (py - ay) * dy) / dd : 0;
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    var qx = ax + dx * t - px, qy = ay + dy * t - py;
    return qx * qx + qy * qy;
  }

  /*
   * Что открывается по касанию, по порядку:
   *   1. маркер страны на конце дуги (допуск HIT_DOT_PX);
   *   2. подпись страны — с объёмом или название при приближении;
   *   3. территория страны: луч из точки касания, точка на шаре,
   *      широта и долгота, контур из countries-110m.json (countryAt);
   *   4. дуга маршрута (допуск HIT_ARC_PX).
   * Страна открывается, только если в выбранном году в неё возили зерно;
   * касание океана, России или страны без поставок ничего не открывает
   * (если рядом нет дуги). Перетаскивание сюда не доходит: release()
   * зовёт pick только для короткого касания без сдвига.
   */
  function pick(clientX, clientY) {
    if (!routes.length) return null;
    var rect = canvas.getBoundingClientRect();
    var W = canvas.clientWidth || 1920;
    var H = canvas.clientHeight || 1080;
    var px = (clientX - rect.left) / rect.width * W;
    var py = (clientY - rect.top) / rect.height * H;

    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld();
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    hitM.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      .multiply(world.matrixWorld);

    var hit = pickRoutes(px, py, W, H);
    if (hit.dot) return hit.dot;
    var byLabel = pickLabel(px, py);
    if (byLabel) return byLabel;
    var land = landAt(px, py, W, H);
    if (land && land.route) return land.route.name;
    return hit.arc;
  }

  /** Подпись под пальцем: сначала подписи с объёмом, потом названия. */
  function pickLabel(px, py) {
    var M = 6;                          // палец толще курсора — чуть расширяем рамку
    function inside(r) { return r && px > r.l - M && px < r.r + M && py > r.t - M && py < r.b + M; }
    for (var i = 0; i < labels.length; i++) {
      if (inside(labels[i].rect) && routeByName[labels[i].name]) return labels[i].name;
    }
    if (nameLabels) {
      for (var j = 0; j < nameLabels.length; j++) {
        var L = nameLabels[j];
        if (L.op >= 0.5 && inside(L.rect) && routeByIso[L.iso]) return routeByIso[L.iso].name;
      }
    }
    return null;
  }

  var ray = new THREE.Raycaster(), rayNdc = new THREE.Vector2(), rayP = new THREE.Vector3();

  /**
   * Точка экрана -> страна на шаре. Возвращает null, если луч прошёл мимо
   * планеты, иначе {lat, lon, iso, route}: iso — контур под пальцем
   * (null — океан), route — маршрут выбранного года в эту страну.
   */
  function landAt(px, py, W, H) {
    rayNdc.set(px / W * 2 - 1, -(py / H * 2 - 1));
    ray.setFromCamera(rayNdc, camera);
    var o = ray.ray.origin, d = ray.ray.direction;
    // пересечение с шаром радиуса R в центре сцены
    var b = o.dot(d), c = o.lengthSq() - R * R, disc = b * b - c;
    if (disc < 0) return null;
    rayP.copy(o).addScaledVector(d, -b - Math.sqrt(disc));
    world.worldToLocal(rayP);
    var ll = vecToLatLon(rayP);
    var g = countryAt(ll.lat, ll.lon);
    return { lat: ll.lat, lon: ll.lon, iso: g ? g.iso : null,
             route: g ? (routeByIso[g.iso] || null) : null };
  }

  /** Маркеры и дуги маршрутов в экранных координатах. */
  function pickRoutes(px, py, W, H) {
    var dotBest = null, dotD2 = HIT_DOT_PX * HIT_DOT_PX;
    var arcBest = null, arcD2 = HIT_ARC_PX * HIT_ARC_PX;

    for (var i = 0; i < routes.length; i++) {
      var r = routes[i], pts = r.pts, n = pts.length;

      // маркер страны — по нему целиться проще, поэтому он в приоритете
      hv.copy(r.dest).multiplyScalar(1.005).applyMatrix4(world.matrixWorld);
      if (frontOf(hv)) {
        hv.copy(r.dest).multiplyScalar(1.005).applyMatrix4(hitM);
        var dx = (hv.x * 0.5 + 0.5) * W - px, dy = (-hv.y * 0.5 + 0.5) * H - py;
        var d2 = dx * dx + dy * dy;
        if (d2 < dotD2) { dotD2 = d2; dotBest = r.name; }
      }

      for (var k = 0; k < n; k++) {
        hv.copy(pts[k]).applyMatrix4(world.matrixWorld);
        hvis[k] = frontOf(hv);
        hv.copy(pts[k]).applyMatrix4(hitM);
        hpx[k] = (hv.x * 0.5 + 0.5) * W;
        hpy[k] = (-hv.y * 0.5 + 0.5) * H;
      }
      for (var s = 0; s < n - 1; s++) {
        if (!hvis[s] && !hvis[s + 1]) continue;
        var sd = segDist2(px, py, hpx[s], hpy[s], hpx[s + 1], hpy[s + 1]);
        if (sd < arcD2) { arcD2 = sd; arcBest = r.name; }
      }
    }
    return { dot: dotBest, arc: arcBest };
  }

  /* ------------------------------ цикл ------------------------------ */

  var partVec = new THREE.Vector3();
  var frames = 0, fps = 0, fpsT = 0;   // счётчик кадров: Globe.stats()

  function loop(now) {
    rafId = requestAnimationFrame(loop);
    frames++;
    if (now - fpsT > 1000) { fps = frames * 1000 / (now - fpsT); frames = 0; fpsT = now; }
    var dt = lastFrame ? Math.min((now - lastFrame) / 1000, 0.1) : 0.016;
    lastFrame = now;

    if (target) {
      var p = U.clamp((now - target.t0) / target.dur, 0, 1);
      var e = U.easeInOutCubic(p);
      view.phi = target.from.phi + (target.to.phi - target.from.phi) * e;
      view.theta = target.from.theta + (target.to.theta - target.from.theta) * e;
      view.zoom = target.from.zoom + (target.to.zoom - target.from.zoom) * e;
      view.fx = target.from.fx + (target.to.fx - target.from.fx) * e;
      view.fy = target.from.fy + (target.to.fy - target.from.fy) * e;
      applyViewOffset();
      if (p >= 1) target = null;
    } else if ((spin.theta || spin.phi) && !Object.keys(pointers).length) {
      // докрутка после взмаха: скорость гаснет по экспоненте
      view.theta += spin.theta * dt;
      view.phi = U.clamp(view.phi + spin.phi * dt, -1.35, 1.35);
      var fade = Math.exp(-SPIN_DAMP * dt);
      spin.theta *= fade; spin.phi *= fade;
      if (Math.abs(spin.theta) < 0.01 && Math.abs(spin.phi) < 0.01) spin.theta = spin.phi = 0;
    } else if (autoRotate && !Object.keys(pointers).length) {
      view.theta -= gcfg.autoRotateSpeed * dt;
    }

    pivotTilt.rotation.x = view.phi;
    pivotSpin.rotation.y = view.theta;
    // фон едет за глобусом: поворот на угол a сдвигает небо на a / FOV
    // ширины (высоты) кадра — столько же, сколько сдвигала прежняя сфера
    if (bgSphere) {
      var vf = FOV0 * DEG;             // как у прежней сферы при 38°: небо не мчится при узком угле
      var hf = 2 * Math.atan(Math.tan(vf / 2) * camera.aspect);
      bgSphere.material.uniforms.uOffset.value.set(-view.theta / hf, view.phi / vf);
    }
    camera.position.z = camDist(view.zoom);

    stepDrawAnim(now);

    // бегущие частицы вдоль всех дуг — один буфер на кадр
    if (particles) {
      var arr = particles.geometry.attributes.position.array;
      var t = now * 0.001, n = 0;
      for (var i = 0; i < routes.length; i++) {
        var r = routes[i];
        for (var k = 0; k < PPA; k++) {
          var f = (t * (0.10 + 0.05 * r.norm) + r.phase + k / PPA) % 1;
          pointAt(r, f, partVec);
          arr[n++] = partVec.x; arr[n++] = partVec.y; arr[n++] = partVec.z;
        }
      }
      particles.geometry.attributes.position.needsUpdate = true;
    }

    if (selected && routeByName[selected] && shipCount > 0) {
      var rSel = routeByName[selected];
      // Суда крупные (по макету 72 px), и на коротком маршруте шесть
      // штук налезли бы друг на друга. Поэтому сколько их идёт — по объёму
      // (shipCount), но не больше, чем помещается на линии на экране
      // с шагом SHIP_GAP.
      var n = Math.max(1, Math.min(shipCount, Math.floor(screenLen(rSel) / SHIP_GAP)));
      for (var si = 0; si < ships.length; si++) {
        var sp = ships[si];
        sp.visible = si < n;
        if (si >= n) continue;
        // идут друг за другом с равным интервалом: у каждого свой сдвиг
        // фазы si/n по той же дуге и с одной на всех скоростью
        var f = (now * shipSpeed + si / n) % 1;
        sp.position.copy(pointAt(rSel, f, partVec));
        // нос — туда, куда судно движется по экрану
        var map = headsLeft(rSel, f) ? TEX_SHIP_L : TEX_SHIP;
        if (sp.material.map !== map) { sp.material.map = map; sp.material.needsUpdate = true; }
      }
    }

    renderer.render(scene, camera);
    var tl = performance.now();
    updateLabels();
    labelMs = labelMs * 0.9 + (performance.now() - tl) * 0.1;
  }
  var labelMs = 0;                      // время раскладки подписей за кадр, мс (Globe.stats)

  var SHIP_GAP = 70;                    // наименьший шаг между судами на экране, px
  var scrA = new THREE.Vector3(), scrB = new THREE.Vector3();

  /** Точка маршрута на экране, в пикселях (x, y — в out). */
  function toScreen(r, f, out) {
    pointAt(r, f, out).applyMatrix4(world.matrixWorld).project(camera);
    out.x = (out.x + 1) / 2 * (canvas.clientWidth || 1920);
    out.y = (1 - out.y) / 2 * (canvas.clientHeight || 1080);
    return out;
  }

  /** Длина маршрута на экране, px: по восьми отрезкам дуги. */
  function screenLen(r) {
    var len = 0;
    toScreen(r, 0, scrA);
    for (var i = 1; i <= 8; i++) {
      toScreen(r, i / 8, scrB);
      len += Math.hypot(scrB.x - scrA.x, scrB.y - scrA.y);
      scrA.copy(scrB);
    }
    return len;
  }

  function headsLeft(r, f) {
    toScreen(r, f, scrA);
    toScreen(r, Math.min(1, f + 0.02), scrB);
    return scrB.x < scrA.x;
  }

  /* ------------------------------ API ------------------------------ */

  /** Перемерить подписи: пока раздел был скрыт, offsetWidth равнялся нулю. */
  function remeasure() {
    if (!started) return;
    labels.concat([originLabel, selLabel]).forEach(function (L) {
      if (!L) return;
      L.w = L.el.offsetWidth;
      L.h = L.el.offsetHeight;
    });
    namesMeasured = false;              // названия перемерятся при первом показе
  }

  global.Globe = {
    init: init,
    start: start,
    stop: stop,
    remeasure: remeasure,
    ready: function () { return started; },
    running: function () { return !!rafId; },
    /** Счётчик кадров и состояние цикла — для отладки и автотестов. */
    stats: function () {
      return { fps: Math.round(fps), running: !!rafId,
               frames: renderer ? renderer.info.render.frame : 0,
               routes: routes.length, labelMs: +labelMs.toFixed(2) };
    },
    setRoutes: setRoutes,
    setSelected: setSelected,
    focus: focus,
    resetView: resetView,
    setLayout: setLayout,
    setAutoRotate: function (v) { autoRotate = v; },
    resize: resize,
    /**
     * Отладочный/демонстрационный вид: точка на глобусе и расстояние камеры.
     * Вызывается из app.js по параметрам адресной строки (см. README).
     * zoom подменяет цель уже запущенного перелёта, поэтому его можно
     * сочетать с focus() — камера долетит до маршрута и остановится ближе.
     */
    setDebugView: function (o) {
      if (o.lat != null && o.lon != null) {
        target = null;
        autoRotate = false;
        var a = faceAngles(o.lat, o.lon);
        view.phi = U.clamp(a.phi, -1.35, 1.35);
        view.theta = a.theta;
      }
      if (o.zoom != null) {
        var z = U.clamp(o.zoom, 1.15, gcfg.maxZoom);   // ближе minZoom — только для отладки
        if (target) target.to.zoom = z; else view.zoom = z;
      }
      if (o.rotate === false) autoRotate = false;
      applyViewOffset();
    },
    // для отладки: попадание по экранным координатам
    _pick: function (x, y) { return pick(x, y); },
    // для отладки: какая страна на шаре под точкой экрана (координаты окна)
    _landAt: function (x, y) {
      scene.updateMatrixWorld(true);
      var rect = canvas.getBoundingClientRect();
      var W = canvas.clientWidth || 1920, H = canvas.clientHeight || 1080;
      var r = landAt((x - rect.left) / rect.width * W, (y - rect.top) / rect.height * H, W, H);
      return r ? { lat: +r.lat.toFixed(2), lon: +r.lon.toFixed(2), iso: r.iso,
                   route: r.route ? r.route.name : null } : null;
    },
    // для отладки: видимые названия стран и их рамки на экране
    _names: function () {
      return (nameLabels || []).filter(function (L) { return L.op > 0; }).map(function (L) {
        return { t: L.el.textContent, op: L.op, imp: !!L.imp,
                 r: L.rect && [Math.round(L.rect.l), Math.round(L.rect.t), Math.round(L.rect.r), Math.round(L.rect.b)] };
      });
    },
    _view: function () { return { phi: view.phi, theta: view.theta, zoom: view.zoom }; },
    _obstacles: function () { return obstacles.map(function (o) { return [o.l, o.t, o.r, o.b].map(Math.round); }); },
    _project: function (lat, lon) {
      scene.updateMatrixWorld(true);
      var v = toVec3(lat, lon, R * 1.006);
      world.localToWorld(v);
      var front = v.z > 0 || v.clone().sub(camera.position).length() < camera.position.length();
      v.project(camera);
      var rect = canvas.getBoundingClientRect();
      return {
        x: rect.left + (v.x * 0.5 + 0.5) * rect.width,
        y: rect.top + (-v.y * 0.5 + 0.5) * rect.height,
        front: front
      };
    },
    // для отладки: экранные координаты узлов дуги
    _arcScreen: function (name) {
      var r = routeByName[name];
      if (!r) return null;
      scene.updateMatrixWorld(true);
      var rect = canvas.getBoundingClientRect();
      var out = [];
      for (var i = 0; i < r.pts.length; i++) {
        var v = r.pts[i].clone().applyMatrix4(world.matrixWorld).project(camera);
        out.push([rect.left + (v.x * 0.5 + 0.5) * rect.width,
          rect.top + (-v.y * 0.5 + 0.5) * rect.height]);
      }
      return out;
    },
    _stats: function () {
      return {
        routes: routes.length,
        calls: renderer.info.render.calls,
        tris: renderer.info.render.triangles,
        zoom: +view.zoom.toFixed(3),
        pxK: uPxK.value,
        maxTex: renderer.capabilities.maxTextureSize,
        lights: earth.material.emissiveMap && earth.material.emissiveMap.image
          ? earth.material.emissiveMap.image.width : 0,
        land: earth.material.map && earth.material.map.image
          ? earth.material.map.image.width : 0,
        borderSegs: borders.geometry.attributes.position.count / 6,
        // отладка: экранные координаты всех видимых сейчас корабликов
        ships: shipCount > 0 ? ships.slice(0, shipCount).map(function (s) {
          var v = s.position.clone().applyMatrix4(world.matrixWorld).project(camera);
          return [Math.round((v.x * 0.5 + 0.5) * (canvas.clientWidth || 1920)),
            Math.round((-v.y * 0.5 + 0.5) * (canvas.clientHeight || 1080))];
        }) : null
      };
    }
  };
})(window);
