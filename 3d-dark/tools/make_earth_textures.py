# -*- coding: utf-8 -*-
"""Готовит текстуры глобуса из снимков NASA.

Оригиналы NASA лежат рядом и не меняются:

  assets/textures/nasa_black_marble_8192.jpg  — Black Marble 2016, ночные огни
  assets/textures/nasa_black_marble_4096.jpg  — то же, вдвое меньше
  assets/textures/nasa_blue_marble_4096.jpg   — Blue Marble Next Generation, день
  assets/textures/nasa_blue_marble_2048.jpg   — то же, вдвое меньше

Скрипт делает из них рабочие текстуры — по две на каждый слой: основную
и уменьшенную запасную (её берёт `src/globe.js`, если видеокарта не тянет
текстуру нужного размера, см. README, раздел «Текстуры Земли»):

  assets/textures/earth_night_8192.jpg  — огни городов для emissive:
  assets/textures/earth_night_4096.jpg      синеватая ночная дымка гасится
      плавной кривой (не по порогу), цвет огней уводится к тёплому белому,
      поверх резкой картинки подмешиваются две размытые копии — от них
      у огней появляется ореол и агломерации сливаются в светящиеся области;
      света прижимаются мягкой кривой, поэтому в рендере они не уходят
      в жёлтый клиппинг;
  assets/textures/earth_night_4096_green.jpg — огни для зелёной темы:
      тот же снимок, но ореол вдвое шире, цвет теплее (золото вместо
      бело-жёлтого) и усиление больше — агломерации сливаются в светящиеся
      пятна. Размер только 4096: ореол всё равно мягкий, а 8192 добавил бы
      к сборке лишние два мегабайта. См. словарь NIGHT_THEMES ниже;
  assets/textures/earth_land_4096.jpg   — подложка суши для diffuse:
  assets/textures/earth_land_2048.jpg       дневной снимок разделяется по маске
      «вода/суша». Суша становится светлой холодно-серой с сохранённым
      рельефом, океан — тёмно-синим. Общую яркость и оттенок задаёт
      `colors.land` из config.json;
  assets/textures/earth_land_4096_green.jpg — то же для зелёной темы:
  assets/textures/earth_land_2048_green.jpg     сочная зелёная суша: тёмные
      места (леса, хребты) уходят в зелень, светлые (степи, пустыни) —
      в оливково-жёлтый, океан бирюзовый с заметно более светлым
      мелководьем. См. словарь LAND_THEMES ниже.

Радиусы размытия заданы в пикселях для ширины 4096 и пересчитываются
пропорционально размеру снимка, поэтому текстуры разного разрешения
выглядят на общем плане одинаково.

Запуск:  python3 tools/make_earth_textures.py
"""
from __future__ import print_function

import math
import os

from PIL import Image, ImageChops, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEX = os.path.join(ROOT, "assets", "textures")

REF_W = 4096.0        # ширина, для которой заданы радиусы размытия

# (исходник, размер в имени результата, качество JPEG). Если ширина снимка
# не совпадает с размером в имени, снимок уменьшается LANCZOS-ом — так из
# одного большого оригинала получаются все рабочие размеры сразу.
LAND_JOBS = [
    ("nasa_blue_marble_4096.jpg", 4096, 90),
    ("nasa_blue_marble_2048.jpg", 2048, 92),
]

# --- ночные огни ---------------------------------------------------------
DEBLUE = 0.90         # сколько холодного оттенка снять с ночной дымки (0..1)
HAZE_FLOOR = 0.03     # что остаётся от дымки в самых тёмных местах
HAZE_LO = 12          # яркость: ниже — это дымка
HAZE_HI = 64          # яркость: выше — это уже город, не трогаем
LIGHT_SAT = 0.45      # сколько исходной насыщенности оставить огням
SHARP_W = 0.46        # вес резкой картинки в сумме
GLOW_NEAR_R = 5.0     # радиус ближнего ореола, px по 4096
GLOW_NEAR_W = 0.32
GLOW_WIDE_R = 17.0    # радиус дальнего свечения, px по 4096
GLOW_WIDE_W = 0.22
NIGHT_GAIN = 2.9      # общее усиление перед сжатием светов
NIGHT_CEIL = 0.93     # потолок мягкой кривой: пики не доходят до 255

# Огни по темам. Значения выше — общие, тема перебивает только то, что ей нужно.
# jobs: (исходник, размер в имени результата, качество JPEG);
# имя результата — earth_night_<размер><суффикс>.jpg, у navy суффикса нет.
NIGHT_THEMES = {
    "navy": {
        "suffix": "",
        "jobs": [("nasa_black_marble_8192.jpg", 8192, 93),
                 ("nasa_black_marble_4096.jpg", 4096, 93)],
    },
    "green": {
        "suffix": "_green",
        # только 4096: ореол тут заведомо мягкий, а 8192 добавил бы к каждой
        # сборке около 2,7 МБ вшитого base64 без видимой пользы
        "jobs": [("nasa_black_marble_4096.jpg", 4096, 85)],
        "light_sat": 0.72,      # огни остаются тёплым золотом, а не белеют
        "sharp_w": 0.34,        # резкой картинки меньше — точки крупнее
        "glow_near_r": 8.0,     # ближний ореол вдвое шире
        "glow_near_w": 0.36,
        "glow_wide_r": 26.0,    # дальний тоже: агломерации сливаются в пятна
        "glow_wide_w": 0.30,
        "gain": 3.9,            # ярче
        "ceil": 0.86,           # но потолок ниже — пики не уходят в белое
    },
}

# --- подложка суши -------------------------------------------------------
SEA_LO = 6            # (синий - красный): ниже — точно суша
SEA_HI = 26           # выше — точно вода
SEA_BLUR_R = 0.7      # сглаживание маски берега, px по 4096
LAND_SAT = 0.16       # сколько цвета оставить суше: 0 — серая
LAND_GAMMA = 0.85     # <1 — светлее, сильнее всего в полутонах
LAND_KNEE = 0.45      # с какой яркости поджимаются света (снег, пустыни)
LAND_KNEE_SLOPE = 0.18
LAND_FLOOR = 0.10     # самая тёмная суша не проваливается в чёрное
LAND_CEIL = 0.62
OCEAN_FLOOR = 0.210   # глубокий океан
OCEAN_SPAN = 0.080    # насколько мелководье светлее глубин

# Темы. Общая обработка одна, различаются только множители по каналам
# (и насыщенность суши). Имя результата — earth_land_<размер><суффикс>.jpg,
# то есть у navy суффикса нет и файлы остаются прежними.
LAND_THEMES = {
    "navy": {
        "suffix": "",
        "land_sat": LAND_SAT,
        "land_tint": (0.64, 0.74, 1.23),    # лёгкий холодный уклон суши
        "ocean_tint": (0.62, 0.80, 1.18),   # тёмно-синий океан
    },
    # Синяя тема — тот же шар, что в зелёной, только перекрашенный.
    # Обработка один в один зелёная (та же гамма, те же диапазоны, тот же
    # растянутый океан), отличается только палитра: суша естественная —
    # тёмные места зелёные, светлые бежевые, как в кадрах фигмы, — а океан
    # глубокий синий с заметно более светлым шельфом.
    "navy_blue": {
        "suffix": "_blue",
        "land_sat": 0.30,
        "land_gamma": 0.50,
        "land_knee": 0.66,
        "land_knee_slope": 0.34,
        "land_floor": 0.34,
        "land_ceil": 1.00,
        "land_tint": (0.60, 0.86, 0.52),     # тёмные места: зелень лесов
        "land_tint_hi": (1.00, 0.90, 0.66),  # светлые: бежевые степи и пустыни
        "tone_lo": 0.26,
        "tone_hi": 0.70,
        "ocean_tint": (0.30, 0.58, 1.20),    # глубокий синий
        "ocean_gamma": 0.70,
        "ocean_floor": 0.30,
        "ocean_span": 0.46,
        "quality": {4096: 80, 2048: 85},
    },
    # Синяя тема по эталону из фигмы: дневная Земля со спутника почти как есть.
    # Главная мысль — снимок NASA сам по себе уже такой, как на эталоне
    # (песочная Сахара, тёмно-зелёные леса, серые хребты, снег на Гималаях),
    # поэтому суша не перекрашивается двумя оттенками, как в зелёной теме,
    # а только подкручивается: цвет сочнее (land_sat > 1), лёгкая S-кривая
    # по яркости и нерезкая маска в два радиуса — крупный радиус даёт
    # локальный контраст (рельеф, складки гор), мелкий добавляет резкости.
    # Океан рисуется заново по батиметрии снимка: линейка от глубокого
    # ocean_deep к шельфовому ocean_shelf, плюс подсветка у самого берега
    # по размытой маске суши (coast_*).
    "navy_figma": {
        "suffix": "_figma",
        # Свой набор размеров и свой исходник: стенд — панель 50" в 4K,
        # на ней подложке нужен 8192, иначе при приближении видно мыло.
        # Все три размера уменьшаются LANCZOS-ом из оригинала 21600×10800
        # (Blue Marble NG, июль 2004, topo+bathy) — он чище, чем прежний
        # снимок 4096. Оригинал в репозиторий не кладётся, см. .gitignore
        # и README, раздел «Текстуры Земли»
        "jobs": [("nasa_blue_marble_21600_src.jpg", 8192, 84),
                 ("nasa_blue_marble_21600_src.jpg", 4096, 88),
                 ("nasa_blue_marble_21600_src.jpg", 2048, 90)],
        # чуть выше единицы: цвет сочнее исходного снимка, но песок Сахары
        # остаётся спокойно-бежевым, а не рыжим — заказчик просил, чтобы
        # жёлтого на шаре было меньше
        # Правка 30.09 («улучшить качество текстур планеты и воды», кадры
        # 553:1286 и 613:2268): суша сочнее и зеленее, полутона не
        # поднимаются (в макете леса тёмные), рельеф чуть резче; вода —
        # шире линейка батиметрии, чтобы проступали хребты и шельф;
        # озёра синие (lake_tint); JPEG 90 вместо 84.
        "land_sat": 1.42,
        "land_gamma": 1.00,
        "land_knee": 0.80,                   # света поджимаются поздно:
        "land_knee_slope": 0.62,             # снег и пустыни не выгорают
        "land_floor": 0.045,
        "land_ceil": 1.00,
        "land_tint": (0.98, 1.03, 0.90),     # чуть зеленее
        # нерезкая маска: (радиус px по 4096, сила %, порог). Радиусы
        # пересчитываются под ширину снимка, поэтому рельеф на 8192 и на 2048
        # выглядит одинаково. Сила умеренная: оригинал 21600 сам по себе
        # резкий, сильнее — и вдоль берегов пойдут светлые ореолы
        "unsharp": [(14.0, 60, 3),           # крупный радиус — рельеф
                    (1.6, 70, 3)],           # мелкий — резкость деталей
        "ocean_deep": "#061638",             # глубокая вода
        "ocean_shelf": "#2a6cbc",            # шельф у берегов
        "ocean_lo": 0.10,                    # диапазон батиметрии снимка,
        "ocean_hi": 0.56,                    # который растягивается на линейку
        "ocean_gamma": 0.75,
        "coast_r": 9.0,                      # подсветка у берега: радиус px/4096
        "coast_w": 0.55,                     # и её сила
        "coast_tint": "#2a68b8",
        "lake_tint": "#1d4f96",
        # качество по размеру: на 8192 ниже, иначе файл уходит за 4 МБ,
        # а вшивать его в страницу всё равно не нужно — build_dist.py кладёт
        # тяжёлые файлы рядом со страницей
        "quality": {8192: 90, 4096: 92, 2048: 92},
    },
    # Зелёная тема: заказчик просил «ярче и сочнее». Суша поднята гаммой
    # и диапазоном, а вместо одного оттенка у неё два — по яркости снимка:
    # тёмное (леса, хребты) уходит в зелень, светлое (степи, пустыни) —
    # в оливково-жёлтый. Океан бирюзовый, мелководье заметно светлее.
    "green": {
        "suffix": "_green",
        "land_sat": 0.30,                   # больше исходного цвета
        "land_gamma": 0.50,                 # сильный подъём полутонов
        "land_knee": 0.66,                  # света поджимаются позже
        "land_knee_slope": 0.34,
        "land_floor": 0.34,                 # тени не проваливаются в чёрное
        "land_ceil": 1.00,
        "land_tint": (0.52, 1.00, 0.54),    # тёмные места: сочная зелень
        "land_tint_hi": (0.86, 0.92, 0.44),  # светлые: оливково-жёлтый
        "tone_lo": 0.26,                    # яркость снимка, с которой
        "tone_hi": 0.70,                    # начинается и заканчивается переход
        "ocean_tint": (0.34, 0.96, 0.94),   # бирюза
        "ocean_gamma": 0.70,                 # растягивает батиметрию:
        "ocean_floor": 0.36,                 # глубины тёмные,
        "ocean_span": 0.44,                  # шельф у берегов заметно светлее
        # своё качество JPEG: светлая суша жмётся хуже тёмной, а лишний вес
        # вдвойне дорог — текстура вшивается в dist как base64
        "quality": {4096: 80, 2048: 85},
    },
}


def save(img, name, quality):
    path = os.path.join(TEX, name)
    img.save(path, quality=quality, optimize=True, progressive=True)
    print("Готово: %s  %dx%d, %.0f КБ, качество %d"
          % (name, img.size[0], img.size[1],
             os.path.getsize(path) / 1024.0, quality))


def smoothstep(x, lo, hi):
    if hi <= lo:
        return 1.0 if x >= hi else 0.0
    t = min(1.0, max(0.0, (x - lo) / float(hi - lo)))
    return t * t * (3.0 - 2.0 * t)


def clamp8(v):
    return int(round(max(0.0, min(255.0, v))))


def scale_channel(ch, w):
    """Умножает канал на вес < 1 (для сложения без переполнения)."""
    return ch.point([clamp8(i * w) for i in range(256)])


# --------------------------- ночные огни ---------------------------------

def haze_lut():
    """Яркость -> во сколько раз пригасить: плавно, без порога."""
    return [clamp8(255 * (HAZE_FLOOR + (1.0 - HAZE_FLOOR)
                          * smoothstep(i, HAZE_LO, HAZE_HI)))
            for i in range(256)]


def night_lut(theme):
    """Усиление + мягкое сжатие светов (экспоненциальная кривая)."""
    gain = theme.get("gain", NIGHT_GAIN)
    ceil = theme.get("ceil", NIGHT_CEIL)
    lut = []
    for i in range(256):
        x = (i / 255.0) * gain
        lut.append(clamp8(255 * ceil * (1.0 - math.exp(-x / ceil))))
    return lut


def make_night(src_name, out_name, quality, theme):
    img = Image.open(os.path.join(TEX, src_name)).convert("RGB")
    k = img.size[0] / REF_W          # радиусы размытия — пропорционально ширине
    r, g, b = img.split()

    # 1. холодная дымка: у огней синевы нет, у дымки она вся
    cold = ImageChops.subtract(b, ImageChops.lighter(r, g))
    b = ImageChops.subtract(b, scale_channel(cold, DEBLUE))
    img = Image.merge("RGB", (r, g, b))

    # 2. гасим дымку плавной кривой, города оставляем как есть
    mul = img.convert("L").point(haze_lut())
    img = Image.merge("RGB", tuple(ImageChops.multiply(c, mul) for c in img.split()))

    # 3. цвет огней — к тёплому белому (в зелёной теме теплее: золото)
    grey = img.convert("L").convert("RGB")
    img = Image.blend(grey, img, theme.get("light_sat", LIGHT_SAT))

    # 4. ореол: резкая картинка + две размытые копии
    near = img.filter(ImageFilter.GaussianBlur(theme.get("glow_near_r", GLOW_NEAR_R) * k))
    wide = img.filter(ImageFilter.GaussianBlur(theme.get("glow_wide_r", GLOW_WIDE_R) * k))
    parts = []
    for i in range(3):
        s = scale_channel(img.split()[i], theme.get("sharp_w", SHARP_W))
        s = ImageChops.add(s, scale_channel(near.split()[i], theme.get("glow_near_w", GLOW_NEAR_W)))
        s = ImageChops.add(s, scale_channel(wide.split()[i], theme.get("glow_wide_w", GLOW_WIDE_W)))
        parts.append(s)
    img = Image.merge("RGB", parts)

    # 5. усиление и мягкое сжатие пиков вместо клиппинга
    img = img.point(night_lut(theme) * 3)
    save(img, out_name, quality)


# --------------------------- подложка суши -------------------------------

def sea_mask_lut():
    return [clamp8(255 * smoothstep(i, SEA_LO, SEA_HI)) for i in range(256)]


def land_lut(theme):
    floor = theme.get("land_floor", LAND_FLOOR)
    ceil = theme.get("land_ceil", LAND_CEIL)
    gamma = theme.get("land_gamma", LAND_GAMMA)
    knee = theme.get("land_knee", LAND_KNEE)
    slope = theme.get("land_knee_slope", LAND_KNEE_SLOPE)
    lut = []
    for i in range(256):
        v = (i / 255.0) ** gamma
        if v > knee:
            v = knee + (v - knee) * slope
        v = floor + (ceil - floor) * min(1.0, v)
        lut.append(clamp8(255 * v))
    return lut


def tone_lut(theme):
    """Яркость снимка -> насколько это «светлая равнина», а не «тёмный лес»."""
    lo = theme.get("tone_lo", 0.30) * 255.0
    hi = theme.get("tone_hi", 0.70) * 255.0
    return [clamp8(255 * smoothstep(i, lo, hi)) for i in range(256)]


def ocean_lut(theme):
    floor = theme.get("ocean_floor", OCEAN_FLOOR)
    span = theme.get("ocean_span", OCEAN_SPAN)
    gamma = theme.get("ocean_gamma", 1.4)
    return [clamp8(255 * (floor + span * (i / 255.0) ** gamma))
            for i in range(256)]


def hex_rgb(s):
    s = s.lstrip("#")
    return tuple(int(s[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


def ocean_ramp(theme):
    """Батиметрия снимка -> три LUT: линейка от глубокой воды к шельфу.

    Вместо «серый × множитель» (как в старых темах) океан красится
    явными цветами: ocean_deep на глубине, ocean_shelf на мелководье.
    """
    deep = hex_rgb(theme["ocean_deep"])
    shelf = hex_rgb(theme["ocean_shelf"])
    lo = theme.get("ocean_lo", 0.16)
    hi = theme.get("ocean_hi", 0.52)
    gamma = theme.get("ocean_gamma", 1.0)
    luts = []
    for c in range(3):
        lut = []
        for i in range(256):
            t = min(1.0, max(0.0, (i / 255.0 - lo) / float(hi - lo))) ** gamma
            lut.append(clamp8(255 * (deep[c] + (shelf[c] - deep[c]) * t)))
        luts.append(lut)
    return luts


def tint(img, factors):
    return Image.merge("RGB", [scale_channel(ch, f)
                               for ch, f in zip(img.split(), factors)])


def load_land_src(src_name, size):
    """Открывает снимок и, если надо, уменьшает его до нужной ширины.

    LANCZOS на понижении усредняет по большому окну: мелкие детали не
    рассыпаются в шум, а собираются в честные полутона. Именно поэтому
    4096, полученный из оригинала 21600, заметно чище готового снимка 4096.
    """
    img = Image.open(os.path.join(TEX, src_name)).convert("RGB")
    if img.size[0] != size:
        img = img.resize((size, size // 2), Image.LANCZOS)
    return img


def make_land(src_name, size, quality, theme):
    img = load_land_src(src_name, size)
    k = img.size[0] / REF_W
    r, g, b = img.split()
    grey = img.convert("L")

    # вода отличается от суши тем, что синего в ней заметно больше красного
    mask = ImageChops.subtract(b, r).point(sea_mask_lut())
    mask = mask.filter(ImageFilter.GaussianBlur(SEA_BLUR_R * k))

    land = Image.blend(grey.convert("RGB"), img, theme["land_sat"])
    land = land.point(land_lut(theme) * 3)
    for radius, percent, threshold in theme.get("unsharp", []):
        # крупный радиус работает как high-pass: вытаскивает рельеф,
        # мелкий добавляет резкости. Радиус пересчитан под размер снимка
        land = land.filter(ImageFilter.UnsharpMask(
            radius=max(0.5, radius * k), percent=percent, threshold=threshold))
    if theme.get("land_tint_hi"):
        # два оттенка по яркости снимка: тёмное — зелёное, светлое — оливковое
        land = Image.composite(tint(land, theme["land_tint_hi"]),
                               tint(land, theme["land_tint"]),
                               grey.point(tone_lut(theme)))
    else:
        land = tint(land, theme["land_tint"])

    if theme.get("ocean_deep"):
        # океан красится явной линейкой «глубина -> шельф»
        ocean = Image.merge("RGB", [grey.point(l) for l in ocean_ramp(theme)])
        if theme.get("coast_w"):
            # у самого берега вода ещё чуть светлее: размытая маска суши
            coast = ImageChops.invert(mask).filter(
                ImageFilter.GaussianBlur(theme["coast_r"] * k))
            coast = scale_channel(coast, theme["coast_w"])
            ocean = Image.composite(
                Image.new("RGB", img.size,
                          tuple(clamp8(255 * v)
                                for v in hex_rgb(theme["coast_tint"]))),
                ocean, coast)
    else:
        ocean = tint(grey.point(ocean_lut(theme)).convert("RGB"), theme["ocean_tint"])

    out = Image.composite(ocean, land, mask)
    if theme.get("lake_tint"):
        # Озёра во внутренних районах на снимке NASA почти чёрные, без
        # синевы, поэтому маска «синее красного» их не ловит и они
        # оставались чёрными дырами (Виктория, Байкал, Ладога). Отличаем
        # их по зелёному каналу: у озёр он ниже 12, у самого тёмного
        # тропического леса (Конго, Амазония) — выше 26. Где зелёный
        # ниже lake_lo, красим в цвет воды, к lake_hi — плавный переход.
        lo, hi = theme.get("lake_lo", 10), theme.get("lake_hi", 20)
        lake = g.point([clamp8(255 * (1.0 - smoothstep(i, lo, hi)))
                        for i in range(256)])
        lake = ImageChops.multiply(lake, ImageChops.invert(mask))
        lake = lake.filter(ImageFilter.GaussianBlur(0.6 * k))
        water = Image.new("RGB", img.size,
                          tuple(clamp8(255 * v) for v in hex_rgb(theme["lake_tint"])))
        out = Image.composite(water, out, lake)

    out_name = "earth_land_%d%s.jpg" % (size, theme["suffix"])
    quality = theme.get("quality", {}).get(size, quality)
    save(out, out_name, quality)


def main():
    Image.MAX_IMAGE_PIXELS = None
    srcs = [j[0] for t in NIGHT_THEMES.values() for j in t["jobs"]]
    srcs += [j[0] for j in LAND_JOBS]
    srcs += [j[0] for t in LAND_THEMES.values() for j in t.get("jobs", [])]
    for src in srcs:
        if not os.path.exists(os.path.join(TEX, src)):
            raise SystemExit("нет файла assets/textures/%s" % src)
    for name in sorted(NIGHT_THEMES):
        theme = NIGHT_THEMES[name]
        print("Огни, тема %s:" % name)
        for src, size, q in theme["jobs"]:
            make_night(src, "earth_night_%d%s.jpg" % (size, theme["suffix"]), q, theme)
    for name in sorted(LAND_THEMES):
        theme = LAND_THEMES[name]
        print("Суша, тема %s:" % name)
        for src, size, q in theme.get("jobs", LAND_JOBS):
            make_land(src, size, q, theme)


if __name__ == "__main__":
    main()
