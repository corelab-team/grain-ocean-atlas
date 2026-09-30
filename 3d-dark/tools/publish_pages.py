#!/usr/bin/env python3
"""Кладёт готовые страницы подпроекта в ../dist, откуда их публикует GitHub Pages.

  ../app/index.html    — ЕДИНОЕ ПРИЛОЖЕНИЕ: презентация, глобус и мониторинг
                         в одном файле, разделы переключаются без перезагрузки
                         (адрес сайта /app/). Это то, что показывают на стенде.

Остальные адреса — вспомогательные, каждый раздел по отдельности:

  3d-dark/index.html        — тёмный макет (docs/mockup/preview.html, обёрнутый в html/head/body)
  3d-dark/proto/index.html  — глобус одним файлом, синяя тема (navy)
  ../green/index.html       — глобус в зелёной теме (адрес сайта /green/)
  ../path/index.html        — экран «Центр управления производства зерна» (/path/)
  ../story/index.html       — презентация «Путь зерна» (/story/)
  ../monitoring/index.html  — раздел «Мониторинг зерна РФ» (/monitoring/)

Обе темы лежат в каждом файле экрана глобуса, отличается только стартовая:
любую страницу можно переключить параметром адреса ?theme=navy / ?theme=green.
Экран блока 3 сделан только в зелёной теме.
"""
import pathlib, shutil, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parents[1]      # 3d-dark/
OUT = ROOT.parent / "dist" / "3d-dark"
GREEN_OUT = ROOT.parent / "dist" / "green"
PATH_OUT = ROOT.parent / "dist" / "path"
STORY_OUT = ROOT.parent / "dist" / "story"
MON_OUT = ROOT.parent / "dist" / "monitoring"
APP_OUT = ROOT.parent / "dist" / "app"
BUILD = ROOT / "tools" / "build_dist.py"

# синяя сборка кладётся в dist/index.html — это обычный результат build_dist.py,
# зелёная собирается отдельным файлом рядом и в репозиторий не попадает
proto_src = ROOT / "dist" / "index.html"
green_src = ROOT / "dist" / "index-green.html"
path_src = ROOT / "dist" / "path.html"
story_src = ROOT / "dist" / "story.html"
mon_src = ROOT / "dist" / "monitoring.html"
app_src = ROOT / "dist" / "app.html"


def check_sections():
    """Разметка разделов в app.html — те же блоки, что в отдельных страницах.

    Копия нужна, чтобы обе стороны открывались сами по себе; чтобы они
    не разъехались, здесь сверяются блоки <div id="sec-..."> ... </div>.
    Расхождение — не ошибка сборки, а предупреждение: иногда правку
    действительно вносят только в одну сторону.
    """
    def block(path, sec):
        text = (ROOT / path).read_text(encoding="utf-8")
        head = '<div id="%s"' % sec
        i = text.find(head)
        if i < 0:
            return None
        i = text.find(">", i) + 1          # сам тег пропускаем: там класс is-on
        j = text.find("\n</div>\n\n", i)   # обёртка закрывается строкой без отступа
        return text[i:j].strip() if j > 0 else None

    pairs = [
        ("sec-story", "story.html"),
        ("sec-globe", "index.html"),
        ("sec-monitoring", "monitoring.html"),
    ]
    for sec, page in pairs:
        a, b = block("app.html", sec), block(page, sec)
        if a is None or b is None:
            print("ВНИМАНИЕ: не найден блок %s (app.html / %s)" % (sec, page))
        elif a != b:
            print("ВНИМАНИЕ: разметка %s в app.html и %s разошлась — "
                  "правку нужно перенести." % (sec, page))


check_sections()

subprocess.run([sys.executable, str(BUILD)], check=True)
subprocess.run([sys.executable, str(BUILD), "--theme", "green",
                "--out", str(green_src)], check=True)
subprocess.run([sys.executable, str(BUILD), "--entry", "path.html",
                "--out", str(path_src)], check=True)
subprocess.run([sys.executable, str(BUILD), "--entry", "story.html",
                "--out", str(story_src)], check=True)
subprocess.run([sys.executable, str(BUILD), "--entry", "monitoring.html",
                "--out", str(mon_src)], check=True)
# единое приложение: внутри все три раздела, отсюда и порог размера
subprocess.run([sys.executable, str(BUILD), "--entry", "app.html",
                "--theme", "green", "--max-mb", "16",
                "--out", str(app_src)], check=True)

OUT.mkdir(parents=True, exist_ok=True)
(OUT / "proto").mkdir(exist_ok=True)
GREEN_OUT.mkdir(parents=True, exist_ok=True)
PATH_OUT.mkdir(parents=True, exist_ok=True)
STORY_OUT.mkdir(parents=True, exist_ok=True)
MON_OUT.mkdir(parents=True, exist_ok=True)
APP_OUT.mkdir(parents=True, exist_ok=True)

mock = (ROOT / "docs" / "mockup" / "preview.html").read_text(encoding="utf-8")
wrapped = ('<!doctype html>\n<html lang="ru">\n<head>\n<meta charset="utf-8">\n'
           '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
           '</head>\n<body style="margin:0;background:#05070C">\n' + mock + '\n</body>\n</html>\n')
(OUT / "index.html").write_text(wrapped, encoding="utf-8")

proto = proto_src.read_bytes()
(OUT / "proto" / "index.html").write_bytes(proto)
green = green_src.read_bytes()
(GREEN_OUT / "index.html").write_bytes(green)
grain = path_src.read_bytes()
(PATH_OUT / "index.html").write_bytes(grain)
story = story_src.read_bytes()
(STORY_OUT / "index.html").write_bytes(story)
monitoring = mon_src.read_bytes()
(MON_OUT / "index.html").write_bytes(monitoring)
app = app_src.read_bytes()
(APP_OUT / "index.html").write_bytes(app)

# Тяжёлые файлы (ролики глобусов, подложка суши 8192, ролик сканирования
# зерна) в страницу не вшиваются — build_dist.py кладёт их рядом с собранным
# файлом, в dist/assets. Переносим их к страницам теми же путями assets/...,
# иначе на сайте шар останется без текстуры, а экран скрининга без ролика.
#
# Раньше список страниц был задан руками — только те три, где есть раздел
# глобуса. Когда на экране лабораторного скрининга появился свой ролик
# (правка 30.09), страница презентации осталась без него: ролик не вшился
# по размеру, а копировать его было некуда, и на сайте экран открывался
# без видео.
#
# Определять нужные файлы по тексту собранной страницы нельзя: пути роликов
# глобуса лежат в config.json, а он вшивается во все страницы подряд, даже
# туда, где глобуса нет. Поэтому — явная таблица: какой странице что нужно.
GLOBE_SIDE = ("assets/textures/earth_land_8192_figma.jpg",
              "assets/video/globe-2016.mp4",
              "assets/video/globe-2025.mp4")
STORY_SIDE = ("assets/video/grain-scan.mp4",
              "assets/video/intro-loop.mp4")
SIDECARS = [
    (APP_OUT, GLOBE_SIDE + STORY_SIDE),   # единое приложение: в нём все разделы
    (GREEN_OUT, GLOBE_SIDE),
    (OUT / "proto", GLOBE_SIDE),
    (STORY_OUT, STORY_SIDE),
    # экраны Блока 3 и мониторинга тяжёлых файлов не показывают
]
side = ROOT / "dist" / "assets"
if side.is_dir():
    for dest, wanted in SIDECARS:
        for rel in wanted:
            src = ROOT / "dist" / rel
            if not src.is_file():
                continue
            out_file = dest / rel
            out_file.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(src, out_file)

print("ok:", APP_OUT / "index.html", len(app) // 1024, "KB;",
      OUT / "index.html", len(wrapped) // 1024, "KB;",
      OUT / "proto/index.html", len(proto) // 1024, "KB;",
      GREEN_OUT / "index.html", len(green) // 1024, "KB;",
      PATH_OUT / "index.html", len(grain) // 1024, "KB;",
      STORY_OUT / "index.html", len(story) // 1024, "KB;",
      MON_OUT / "index.html", len(monitoring) // 1024, "KB")
