# -*- coding: utf-8 -*-
"""Сборка dist/index.html — одного самодостаточного файла.

Внутрь складываются CSS, все скрипты (включая vendor) и все данные
(config.json, data/export.json, data/geo/countries-110m.json) как блоки
<script type="application/json">. Файлы из assets/ (шрифты, текстуры глобуса,
видео) вшиваются как data:URI: шрифты — прямо в CSS, текстуры — в объект
window.INLINE_ASSETS, откуда их берёт U.asset() в src/util.js.
Ни одного внешнего запроса — файл открывается двойным щелчком по file://
и годится для публикации как есть.

Запуск:  python3 tools/build_dist.py
Перед этим — python3 tools/build_data.py, если менялся xlsx.

Ключи:
  --theme green   тема по умолчанию во вшитом конфиге (сам config.json
                  не меняется). В сборку всегда попадают обе темы,
                  вторую видно по адресу ?theme=navy / ?theme=green.
  --out ПУТЬ      куда положить готовый файл (по умолчанию dist/index.html)
  --entry ФАЙЛ    какую страницу собирать (по умолчанию index.html).
                  Экран «Путь зерна» собирается так:
                  python3 tools/build_dist.py --entry path.html --out dist/path.html
                  Единое приложение (все три раздела в одном файле):
                  python3 tools/build_dist.py --entry app.html --out dist/app.html
  --max-mb ЧИСЛО  с какого размера ругаться (по умолчанию 8 МБ; у app.html
                  внутри все разделы сразу, там уместно 16)

Что вшивать, скрипт решает сам по коду страницы: блок данных попадает
в файл, только если его id (inline-config, inline-export, inline-news,
inline-topo, inline-regions, inline-monitoring, inline-presence)
встречается в скриптах, а видео —
только если код вообще про него знает. Поэтому экран без глобуса
не тащит за собой карту мира и справочник, а экран без карты России —
контуры субъектов.
"""
from __future__ import print_function

import argparse
import base64
import json
import mimetypes
import os
import re
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "dist")

# какие данные во что превращаются
INLINE_JSON = [
    ("inline-config", "config.json"),
    ("inline-export", os.path.join("data", "export.json")),
    ("inline-news", os.path.join("data", "news.json")),
    ("inline-topo", os.path.join("data", "geo", "countries-110m.json")),
    ("inline-regions", os.path.join("assets", "geo", "russia-regions.json")),
    ("inline-monitoring", os.path.join("data", "monitoring.json")),
    ("inline-presence", os.path.join("data", "presence.json")),
]

MAX_VIDEO_MB = 60
# Предупреждение, если файл разросся. 8 МБ, а не 6: у зелёной темы свои
# текстуры — второй набор суши и своя карта огней (вместе около 1,3 МБ).
# У единого приложения (app.html) внутри лежат все три раздела сразу,
# поэтому там порог поднимается ключом --max-mb.
MAX_DIST_MB = 8

# Ролик из assets/ тяжелее этого в страницу не вшивается: он ляжет рядом
# с собранным index.html обычным файлом (см. шаг 4a).
INLINE_MAX_ASSET_MB = 1.0

# То же для картинок, но порог выше: почти все текстуры лёгкие и удобнее,
# когда они внутри страницы. Не влезает сюда только подложка суши 8192
# (около 3,6 МБ) — она ляжет рядом со страницей. В base64 она раздулась бы
# почти до 5 МБ, а нужна лишь там, где видеокарта её тянет.
INLINE_MAX_IMAGE_MB = 3.0

mimetypes.add_type("font/woff2", ".woff2")
mimetypes.add_type("font/woff", ".woff")

# ссылки на файлы из assets/ ищутся в CSS и в скриптах
ASSET_RE = re.compile(r"assets/[A-Za-z0-9_./-]+\.(?:png|jpe?g|webp|svg|woff2?|mp4|webm)")
# начало пути в assets/, к которому что-то приклеивают: 'assets/photos/' + name
CONCAT_ASSET_RE = re.compile(r"[\"']assets/[^\"'\n]*[\"']\s*\+")


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def data_uri(path):
    mime = mimetypes.guess_type(path)[0] or "application/octet-stream"
    with open(path, "rb") as f:
        return "data:%s;base64,%s" % (mime, base64.b64encode(f.read()).decode("ascii"))


def die(msg):
    print("ОШИБКА: " + msg)
    sys.exit(1)


def json_block(el_id, obj):
    """JSON внутри <script>: экранируем '</', чтобы не порвать тег."""
    txt = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    return '<script type="application/json" id="%s">%s</script>' % (el_id, txt)


def guard(code, what):
    if "</script" in code.lower():
        die("в %s встречается '</script' — инлайн сломается, нужен другой файл." % what)
    return code


def main(theme=None, out_path=None, entry=None, max_mb=None):
    max_mb = max_mb or MAX_DIST_MB
    entry = entry or "index.html"
    entry_path = os.path.join(ROOT, entry)
    if not os.path.exists(entry_path):
        die("нет страницы %s" % entry)
    html = read(entry_path)

    # 0. скрипты читаем первыми: по их коду видно, какие данные нужны экрану
    scripts = re.findall(r'<script src="([^"]+)"></script>', html)
    if not scripts:
        die("в %s не найдено ни одного <script src=...>" % entry)
    codes = []
    for rel in scripts:
        path = os.path.join(ROOT, rel)
        if not os.path.exists(path):
            die("нет скрипта %s" % rel)
        codes.append(guard(read(path), rel))
    all_code = "\n".join(codes)

    def used(el_id):
        return ("'%s'" % el_id) in all_code or ('"%s"' % el_id) in all_code

    # 1. данные: только те блоки, к которым обращается код страницы
    blocks = []
    cfg = None
    for el_id, rel in INLINE_JSON:
        if not used(el_id):
            continue
        path = os.path.join(ROOT, rel)
        if not os.path.exists(path):
            die("нет файла %s. Сначала запустите tools/build_data.py." % rel)
        obj = json.loads(read(path))
        if el_id == "inline-config":
            cfg = obj
        blocks.append((el_id, obj, rel))

    # 1a. тема по умолчанию: в файле обе, меняется только стартовая
    if cfg is not None:
        if theme:
            if theme not in (cfg.get("themes") or {}):
                die("темы «%s» нет в config.json (есть: %s)"
                    % (theme, ", ".join(sorted((cfg.get("themes") or {}).keys()))))
            cfg["theme"] = theme
        print("Тема по умолчанию: %s (переключается параметром ?theme=)" % cfg.get("theme"))

    # 2. видео: вшиваем, только если экран вообще умеет его показывать
    if cfg is not None and "shipVideo" in all_code:
        video_rel = cfg.get("shipVideo") or ""
        video_path = os.path.join(ROOT, video_rel) if video_rel else ""
        if video_path and os.path.exists(video_path):
            size_mb = os.path.getsize(video_path) / (1024.0 * 1024.0)
            if size_mb > MAX_VIDEO_MB:
                die("видео %s весит %.1f МБ (лимит %d МБ). Сожмите файл."
                    % (video_rel, size_mb, MAX_VIDEO_MB))
            mime = mimetypes.guess_type(video_path)[0] or "video/mp4"
            with open(video_path, "rb") as f:
                data = base64.b64encode(f.read()).decode("ascii")
            cfg["shipVideo"] = "data:%s;base64,%s" % (mime, data)
            print("Видео вшито: %s (%.1f МБ)" % (video_rel, size_mb))
        else:
            cfg["shipVideo"] = ""
            print("Видео не найдено (%s) — в dist будет заглушка."
                  % (video_rel or "путь не задан"))
    elif cfg is not None:
        cfg["shipVideo"] = ""              # экрану видео не нужно

    data_html = "\n".join(json_block(el_id, obj) for el_id, obj, _ in blocks)
    if blocks:
        print("Данные вшиты: %s" % ", ".join(rel for _, _, rel in blocks))

    # 3. стили: заодно вшиваем шрифты и картинки из url(...)
    fonts_kb = [0]

    def repl_css(m):
        rel_css = m.group(1)
        path = os.path.join(ROOT, rel_css)
        if not os.path.exists(path):
            die("нет стиля %s" % rel_css)
        css_dir = os.path.dirname(path)

        def repl_url(u):
            raw = u.group(1).strip().strip("'\"")
            if raw.startswith("data:") or raw.startswith("#"):
                return u.group(0)
            src = os.path.normpath(os.path.join(css_dir, raw))
            if not os.path.exists(src):
                die("в %s не найден файл %s" % (rel_css, raw))
            fonts_kb[0] += os.path.getsize(src)
            return "url(%s)" % data_uri(src)

        css = re.sub(r"url\(([^)]+)\)", repl_url, read(path))
        return "<style>\n" + guard(css, rel_css) + "\n</style>"

    html = re.sub(r'<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>', repl_css, html)
    if fonts_kb[0]:
        print("Файлы из CSS (шрифты и т. п.) вшиты: %.0f КБ" % (fonts_kb[0] / 1024.0))

    # 4. скрипты (прочитаны на шаге 0)
    inlined = []
    assets = {}
    for rel, code in zip(scripts, codes):
        # Путь, склеенный из кусков ('assets/...' + имя), сборка не видит:
        # файл не вшивается, и на сайте вместо картинки пустой значок
        # (так пропали снимки справа на станции 4, правки 30.09).
        m = CONCAT_ASSET_RE.search(code)
        if m:
            die("в %s путь к файлу склеивается из кусков: %s — сборка его "
                "не найдёт, пишите путь целиком." % (rel, m.group(0)))
        for a in ASSET_RE.findall(code):
            assets.setdefault(a, None)
        inlined.append("<!-- %s -->\n<script>\n%s\n</script>" % (rel, code))

    # Пути из config.json (постеры и ролики глобусов) в коде не встречаются,
    # поэтому ищем их отдельно — иначе на сайте шары входного экрана пустые.
    # Только для страниц с глобусом: остальным эти файлы ни к чему.
    if "globeVideo" in all_code:
        for a in ASSET_RE.findall(read(os.path.join(ROOT, "config.json"))):
            if os.path.exists(os.path.join(ROOT, a)):
                assets.setdefault(a, None)

    # 4a. файлы из assets/, на которые ссылаются скрипты (текстуры глобуса)
    #     Мелкие вшиваются как data:URI. Тяжёлые (ролики глобусов — по 3 МБ,
    #     а в base64 это ещё на треть больше) вшивать нельзя: страница
    #     разбухнет. Они кладутся рядом с собранным файлом, теми же путями
    #     assets/..., и браузер подтягивает их обычной ссылкой. На стенде
    #     папка 3d-dark открывается как есть, там файлы и так лежат рядом.
    assets_bytes = 0
    sidecars = []
    for rel in list(assets):
        src = os.path.join(ROOT, rel)
        if not os.path.exists(src):
            die("нет файла %s, на который ссылается код" % rel)
        size = os.path.getsize(src)
        video = rel.lower().endswith((".mp4", ".webm"))
        limit = INLINE_MAX_ASSET_MB if video else INLINE_MAX_IMAGE_MB
        if size > limit * 1024 * 1024:
            del assets[rel]
            sidecars.append((rel, src, size))
            continue
        assets_bytes += size
        assets[rel] = data_uri(src)
    if assets:
        print("Файлы из assets/ вшиты: %d шт., %.0f КБ"
              % (len(assets), assets_bytes / 1024.0))
    assets_html = ("<script>window.INLINE_ASSETS=%s;</script>"
                   % json.dumps(assets, ensure_ascii=False))

    first = '<script src="%s"></script>' % scripts[0]
    html = html.replace(first, data_html + "\n" + assets_html + "\n" + inlined[0], 1)
    for rel, code in zip(scripts[1:], inlined[1:]):
        html = html.replace('<script src="%s"></script>' % rel, code, 1)

    # 5. проверка: не осталось внешних ссылок
    leftovers = re.findall(r'(?:src|href)="((?!#|data:)[^"]+)"', html)
    if leftovers:
        die("в dist остались внешние ссылки: %s" % ", ".join(sorted(set(leftovers))))

    out = os.path.abspath(out_path or os.path.join(DIST, "index.html"))
    out_dir = os.path.dirname(out)
    if not os.path.exists(out_dir):
        os.makedirs(out_dir)
    with open(out, "w", encoding="utf-8") as f:
        f.write(html)

    # тяжёлые файлы (ролики глобусов) — рядом со страницей, теми же путями
    for rel, src, size in sidecars:
        dst = os.path.join(out_dir, rel)
        dst_dir = os.path.dirname(dst)
        if not os.path.exists(dst_dir):
            os.makedirs(dst_dir)
        shutil.copyfile(src, dst)
        print("Рядом со страницей: %s (%.1f МБ)" % (rel, size / 1048576.0))

    size_mb = os.path.getsize(out) / 1048576.0
    print("Собрано: %s (%.1f МБ)" % (os.path.relpath(out, ROOT), size_mb))
    if size_mb > max_mb:
        print("ВНИМАНИЕ: файл больше %d МБ — проверьте, что вшито." % max_mb)
    print("Файл открывается двойным щелчком, сервер не нужен.")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Сборка одного файла dist/index.html")
    ap.add_argument("--theme", help="тема по умолчанию во вшитом конфиге (navy, green)")
    ap.add_argument("--out", help="путь к результату, по умолчанию dist/index.html")
    ap.add_argument("--entry", help="какую страницу собирать, по умолчанию index.html")
    ap.add_argument("--max-mb", type=float,
                    help="порог предупреждения о размере, по умолчанию %d МБ" % MAX_DIST_MB)
    args = ap.parse_args()
    main(theme=args.theme, out_path=args.out, entry=args.entry, max_mb=args.max_mb)
