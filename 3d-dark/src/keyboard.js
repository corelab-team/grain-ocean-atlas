/* ===================================================================
   Экранная клавиатура стенда — одна на всё приложение.

   Физической клавиатуры на стенде нет, а системная клавиатура Windows
   в полноэкранном режиме выезжает поверх интерфейса и закрывает его.
   Поэтому у полей поиска стоит inputmode="none" (системная клавиатура
   не появляется) и атрибут data-osk: по касанию такого поля в правом
   нижнем углу выезжает эта клавиатура. Справа — потому что списки,
   которые фильтрует поиск («Топ-10 регионов» на госмониторинге, список
   стран на глобусе), стоят слева и должны оставаться на виду.

   Раскладка русская (ЙЦУКЕН), дефис (Кабардино-Балкарская,
   Ханты-Мансийский), пробел, «Стереть» и «Закрыть». Каждое нажатие
   меняет значение поля и посылает событие input — разделы фильтруют
   свои списки теми же обработчиками, что и при обычном вводе.
   Первая буква и буква после пробела или дефиса — заглавные.

   Клавиатура закрывается:
     - клавишей «Закрыть» или Esc;
     - касанием вне клавиатуры и вне поля;
     - сама, когда поле пропало с экрана (ушли из раздела);
     - вызовом Keyboard.close() — его делает оболочка src/shell.js
       при переходе между разделами и при уходе в аттрактор.

   Подключение: стиль styles/keyboard.css и скрипт src/keyboard.js
   после src/util.js (тег скрипта здесь не пишем: tools/build_dist.py
   принял бы его за внешнюю ссылку). Поля с атрибутом data-osk находятся сами,
   любое другое поле подключается вызовом Keyboard.attach(input).
   Раскладка в координатах кадра 1920x1080, под окно другого размера
   клавиатура масштабируется так же, как сцены разделов.
   =================================================================== */
(function (global) {
  'use strict';

  var doc = global.document;

  /* Ряды клавиш. Ширина всех рядов — 12 клавиш по 88 px с зазором 8,
     короткие ряды стоят по центру, как на обычной клавиатуре. */
  var ROWS = [
    ['й', 'ц', 'у', 'к', 'е', 'н', 'г', 'ш', 'щ', 'з', 'х', 'ъ'],
    ['ф', 'ы', 'в', 'а', 'п', 'р', 'о', 'л', 'д', 'ж', 'э'],
    ['я', 'ч', 'с', 'м', 'и', 'т', 'ь', 'б', 'ю', 'ё']
  ];

  var ICON_BACK = '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M19 38 5 24 19 10h24v28H19Zm2-4h18V14H21l-10 10 10 10Zm3.6-3.4 5.4-5.4 5.4 5.4 2.2-2.2-5.4-5.4 5.4-5.4-2.2-2.2-5.4 5.4-5.4-5.4-2.2 2.2 5.4 5.4-5.4 5.4 2.2 2.2Z"/></svg>';
  var ICON_HIDE = '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 44 15 35h18l-9 9ZM8 30q-1.65 0-2.825-1.175Q4 27.65 4 26V8q0-1.65 1.175-2.825Q6.35 4 8 4h32q1.65 0 2.825 1.175Q44 6.35 44 8v18q0 1.65-1.175 2.825Q41.65 30 40 30H8Zm0-4h32V8H8v18Zm8-2h16v-4H16v4Zm-6-6h4v-4h-4v4Zm8 0h4v-4h-4v4Zm8 0h4v-4h-4v4Zm8 0h4v-4h-4v4ZM10 12h4v4h-4v-4Zm8 0h4v4h-4v-4Zm8 0h4v4h-4v-4Zm8 0h4v4h-4v-4Z"/></svg>';

  var root = null;                     // .osk — клавиатура, создаётся при первом открытии
  var input = null;                    // поле, в которое сейчас печатаем
  var watch = 0;                       // таймер: не пропало ли поле с экрана

  /* ------------------------------ разметка ------------------------------ */

  function key(k, label, cls) {
    var b = doc.createElement('button');
    b.type = 'button';
    b.className = 'osk-key' + (cls ? ' ' + cls : '');
    b.setAttribute('data-k', k);
    b.setAttribute('tabindex', '-1');
    b.innerHTML = label;
    return b;
  }

  function build() {
    root = doc.createElement('div');
    root.className = 'osk';
    root.setAttribute('aria-hidden', 'true');
    var pad = doc.createElement('div');
    pad.className = 'osk-pad';
    ROWS.forEach(function (row, i) {
      var r = doc.createElement('div');
      r.className = 'osk-row';
      row.forEach(function (ch) {
        r.appendChild(key(ch, ch, /[а-яё]/.test(ch) ? 'is-letter' : ''));
      });
      if (i === ROWS.length - 1) r.appendChild(key('back', ICON_BACK + 'Стереть', 'is-fn'));
      pad.appendChild(r);
    });
    var last = doc.createElement('div');
    last.className = 'osk-row';
    last.appendChild(key('close', ICON_HIDE + 'Закрыть', 'is-fn'));
    last.appendChild(key('-', '−'));
    last.appendChild(key('space', 'Пробел', 'is-space'));
    pad.appendChild(last);
    root.appendChild(pad);

    // Касание клавиши не должно уводить фокус из поля: гасим pointerdown
    // и mousedown, а само нажатие ловим по click (он приходит и после
    // погашенного pointerdown). Подсветка клавиши — классом is-down:
    // :active на сенсорном экране срабатывает не всегда.
    root.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      var b = e.target.closest && e.target.closest('.osk-key');
      if (b) b.classList.add('is-down');
    });
    ['pointerup', 'pointercancel', 'pointerout'].forEach(function (n) {
      root.addEventListener(n, function (e) {
        var b = e.target.closest && e.target.closest('.osk-key');
        if (b) b.classList.remove('is-down');
      });
    });
    root.addEventListener('mousedown', function (e) { e.preventDefault(); });
    root.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-k]');
      if (b) press(b.getAttribute('data-k'));
    });

    doc.body.appendChild(root);
    fit();
    global.addEventListener('resize', fit);
  }

  /** Раскладка в пикселях кадра 1920x1080 — ужимаем под окно. */
  function fit() {
    if (!root) return;
    var s = Math.min(global.innerWidth / 1920, global.innerHeight / 1080) || 1;
    root.style.transform = 'scale(' + s + ')';
  }

  /* ------------------------------ ввод ------------------------------ */

  /** Следующая буква заглавная: в начале поля и после пробела или дефиса. */
  function caps() {
    return !input || !input.value || /[\s-]$/.test(input.value);
  }

  function sync() {
    if (root) root.classList.toggle('is-caps', caps());
  }

  function press(k) {
    if (!input) return;
    if (k === 'close') { close(); return; }
    var v = input.value;
    if (k === 'back') v = v.slice(0, -1);
    else if (k === 'space') { if (v && !/\s$/.test(v)) v += ' '; }
    else v += caps() ? k.toUpperCase() : k;
    if (input.maxLength > 0) v = v.slice(0, input.maxLength);
    if (v === input.value) return;
    input.value = v;
    try { input.setSelectionRange(v.length, v.length); } catch (e) { /* не всякое поле умеет */ }
    input.dispatchEvent(new Event('input', { bubbles: true }));
    sync();
  }

  /* ------------------------- открыть и закрыть ------------------------- */

  /** Поле видно: раздел на экране и экран раздела не спрятан. */
  function visible(el) {
    if (!el.isConnected || !el.getClientRects().length) return false;
    return global.getComputedStyle(el).visibility !== 'hidden';
  }

  function open(inp) {
    if (!root) build();
    input = inp;
    if (doc.activeElement !== inp) {
      try { inp.focus({ preventScroll: true }); } catch (e) { inp.focus(); }
    }
    root.classList.add('is-on');
    sync();
    if (watch) clearInterval(watch);
    watch = setInterval(function () {
      if (!input || !visible(input)) close();
    }, 400);
  }

  function close() {
    if (watch) { clearInterval(watch); watch = 0; }
    var inp = input;
    input = null;
    if (root) root.classList.remove('is-on');
    if (inp && doc.activeElement === inp) inp.blur();
  }

  /** Подключить поле: системную клавиатуру гасим, свою открываем по касанию. */
  function attach(inp) {
    if (!inp || inp.__osk) return;
    inp.__osk = true;
    inp.setAttribute('inputmode', 'none');
    inp.addEventListener('focus', function () { open(inp); });
    // поле уже в фокусе (клавиатуру закрыли кнопкой) — открыть снова
    inp.addEventListener('click', function () { if (input !== inp) open(inp); });
  }

  // касание вне клавиатуры и вне поля (вместе с его рамкой) закрывает её;
  // само касание при этом срабатывает как обычно — например, выбирает регион
  doc.addEventListener('pointerdown', function (e) {
    if (!input) return;
    var t = e.target;
    if (root && root.contains(t)) return;
    if (t === input || (input.parentNode && input.parentNode.contains(t))) return;
    close();
  }, true);

  doc.addEventListener('keydown', function (e) {
    if (input && e.key === 'Escape') close();
  });

  function scan() {
    var list = doc.querySelectorAll('input[data-osk]');
    for (var i = 0; i < list.length; i++) attach(list[i]);
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', scan);
  else scan();

  global.Keyboard = {
    attach: attach,
    open: open,
    close: close,
    /** Открыта ли клавиатура — для скриптов и автотестов. */
    isOpen: function () { return !!input; }
  };
})(window);
