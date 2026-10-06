# -*- coding: utf-8 -*-
"""Цифры госмониторинга пшеницы для экрана «Мониторинг зерна РФ».

    python3 tools/make_monitoring.py

Собирает data/monitoring.json из таблиц заказчика, которые лежат рядом,
в data/monitoring-src/:

  +1. Мягкая пшеница.xlsx   лист «Пшеница мягкая 5 окт»
  +2.Твердая пшеница.xlsx  лист «Пшеница твердая 5 окт»
  Регионы с сильной пшеницей.xlsx    белок > 13,5 % и клейковина > 28 %
  Спец. характеристики пшеницы.xlsx    белок, клейковина, натура, ЧП,
                                       стекловидность (мягкая и твёрдая)

ЧИСЛА НАСТОЯЩИЕ. Ничего не достраиваем и не сглаживаем: если в таблице
клетка пустая, в json уходит null, а на экране пишется «нет данных».

Год в таблицах один — 2026 (свод на 28 сентября). Лента годов на экране
рисуется целиком, с 2015 по 2026, но нажимаются только годы из поля
`years`. Когда заказчик пришлёт прошлые годы, достаточно положить такие
же таблицы и дописать их сюда — разметка и код не меняются.

Структура файла описана в README, раздел «Мониторинг зерна РФ».
"""
from __future__ import print_function

import json
import os
import re

import openpyxl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GEO = os.path.join(ROOT, "assets", "geo", "russia-regions.json")
SRC = os.path.join(ROOT, "data", "monitoring-src")
OUT = os.path.join(ROOT, "data", "monitoring.json")

YEAR = 2026                       # год, за который пришли таблицы
RIBBON = list(range(2015, 2027))  # лента годов на экране
UPDATED = "05.10.2026"            # «по состоянию на» из шапки таблиц

SOFT_FILE = "+1. Мягкая пшеница.xlsx"
SOFT_SHEET = "Пшеница мягкая 5 окт"
DURUM_FILE = "+2.Твердая пшеница.xlsx"
DURUM_SHEET = "Пшеница твердая 5 окт"
STRONG_FILE = "Регионы с сильной пшеницей.xlsx"
SPEC_FILE = "Спец. характеристики пшеницы.xlsx"

# Колонки сводов (одинаковые в обоих файлах), считая с нуля:
# A название, B валовой сбор, дальше парами «тыс. т | % от обследованного»
# для классов 1–5, между 4 и 5 стоит «ИТОГО 1–4», в конце — «не соответствует ГОСТ».
COL_NAME, COL_GROSS = 0, 1
COL_CLASS = [2, 4, 6, 8, 12]      # тыс. т по классам 1, 2, 3, 4, 5
COL_TOTAL14 = 10
COL_BAD = 14                      # не соответствует ГОСТ, тыс. т

# Названия, которые сами по себе не сходятся с геоданными.
ALIAS = {
    "еао": "RU-YEV",
    "красноярск красноярский": "RU-KYA",
    "москва московская": "RU-MOW",
    "кемеровская кузбасс": "RU-KEM",
}

# Слова, которые в названии субъекта ничего не различают.
STOP = set("область областей край республика республики автономный автономная "
           "автономного округ округа народная г город кузбасс".split())


def key(name):
    """Ключ названия субъекта: набор значащих слов, без типа и знаков."""
    s = (name or "").lower().replace(u"ё", u"е")
    s = re.sub(r"[^a-zа-я0-9]+", " ", s)
    words = [w for w in s.split() if w and w not in STOP]
    return " ".join(sorted(words))


def num(v):
    """Число из клетки: у заказчика попадаются и числа, и строки."""
    if v is None:
        return None
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace(",", ".").replace(" ", "")
    if not s or s.startswith("#"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def r1(v, digits=1):
    return None if v is None else round(v, digits)


def is_total_row(name):
    """Строки «Всего» и «… фед. округ» — это итоги, не субъекты."""
    s = (name or "").lower()
    return (not s) or s.startswith(u"всего") or u"фед. округ" in s or u"#ref" in s


def read_summary(path, sheet):
    """Свод по субъектам: {название: {gross, surveyed, classes, bad}}."""
    ws = openpyxl.load_workbook(path, data_only=True)[sheet]
    out = {}
    for row in ws.iter_rows(min_row=6, values_only=True):
        name = row[COL_NAME]
        if isinstance(name, str):
            name = name.strip()
        if is_total_row(name):
            continue
        gross = num(row[COL_GROSS])
        cls = [num(row[c]) if c < len(row) else None for c in COL_CLASS]
        bad = num(row[COL_BAD]) if COL_BAD < len(row) else None
        total14 = num(row[COL_TOTAL14]) if COL_TOTAL14 < len(row) else None
        # Обследовано в таблице нет: это сумма классов и несоответствующего
        # ГОСТ зерна. Где класс не указан, зерна этого класса не нашли.
        parts = [v for v in cls if v] + ([bad] if bad else [])
        surveyed = sum(parts) if parts else None
        # сверка: сумма классов 1–4 должна совпасть с колонкой «ИТОГО 1–4»
        if total14 and surveyed:
            got = sum(v for v in cls[:4] if v)
            if abs(got - total14) > max(0.5, total14 * 0.01):
                print(u"  сверка: %s — классы 1–4 дают %.1f, в таблице %.1f"
                      % (name, got, total14))
        out[name] = {"gross": gross, "surveyed": surveyed,
                     "classes": cls, "bad": bad}
    return out


def read_strong(path):
    """Регионы с сильной пшеницей: {название: {mass, protein, gluten}}."""
    ws = openpyxl.load_workbook(path, data_only=True)["Лист1"]
    out = {}
    for row in ws.iter_rows(min_row=3, values_only=True):
        name = row[0]
        if not name:
            continue
        out[str(name).strip()] = {"mass": r1(num(row[1])),
                                  "protein": r1(num(row[2]), 2),
                                  "gluten": r1(num(row[3]), 2)}
    return out


def read_spec(path):
    """Спец. характеристики: {вид: {название: {protein, gluten, …}}}."""
    wb = openpyxl.load_workbook(path, data_only=True)
    sheets = {"soft": u"мягкая пшеница", "durum": u"твердая пшеница"}
    out = {}
    for kind, sheet in sheets.items():
        ws = wb[sheet]
        got = {}
        for row in ws.iter_rows(min_row=4, values_only=True):
            name = row[0]
            if not name:
                continue
            got[str(name).strip()] = {
                "protein": r1(num(row[1]), 2),
                "gluten": r1(num(row[2]), 2),
                "nature": r1(num(row[3]), 0),
                "falling": r1(num(row[4]), 0),
                "vitreous": r1(num(row[5]), 1),
            }
        out[kind] = got
    return out


def match(table, codes, what, unmatched):
    """Таблица «название → строка» превращается в «код субъекта → строка»."""
    out = {}
    for name, val in table.items():
        code = ALIAS.get(key(name)) or codes.get(key(name))
        if not code:
            unmatched.append(u"%s: %s" % (what, name))
            continue
        out[code] = val
    return out


def block(row, spec, strong):
    """Один вид пшеницы по одному субъекту — то, что читает экран."""
    gross, surveyed = row["gross"], row["surveyed"]
    cls, bad = row["classes"], row["bad"]
    if not surveyed:
        return None
    share = [round(((v or 0) / surveyed) * 100.0, 1) for v in cls]
    b = {
        "gross": r1(gross),
        "surveyed": r1(surveyed),
        # доля обследованного от валового сбора, %
        "cover": r1(surveyed / gross * 100.0) if gross else None,
        # доли классов 1–5 от обследованного объёма, %
        "classes": share,
        "classT": [r1(v) for v in cls],
        "bad": r1(bad),
        # соответствует требованиям ГОСТ — всё, кроме несоответствующего зерна
        "compliance": round(100.0 - (bad or 0) / surveyed * 100.0, 1),
        "updated": UPDATED,
    }
    if spec:
        b.update(spec)
    if strong:
        b["strong"] = True
        b["strongMass"] = strong["mass"]
        b["strongProtein"] = strong["protein"]
        b["strongGluten"] = strong["gluten"]
    return b


def summarize(regions, kind, rows):
    """Итог по стране из исходных масс: округляем один раз после суммирования."""
    gross = sum(row["gross"] or 0 for row in rows.values())
    surveyed = sum(row["surveyed"] or 0 for row in rows.values())
    bad = sum(row["bad"] or 0 for row in rows.values())
    cls = [sum(row["classes"][i] or 0 for row in rows.values()) for i in range(5)]
    if not surveyed:
        return None
    top = max(regions, key=lambda r: (rows.get(r["id"]) or {}).get("surveyed") or 0)
    return {
        "gross": r1(gross),
        "surveyed": r1(surveyed),
        "cover": r1(surveyed / gross * 100.0) if gross else None,
        "classes": [round(c / surveyed * 100.0, 1) for c in cls],
        "classT": [r1(c) for c in cls],
        "bad": r1(bad),
        "compliance": round(100.0 - bad / surveyed * 100.0, 1),
        "regions": sum(bool(row["surveyed"]) for row in rows.values()),
        "leader": top["name"],
        "updated": UPDATED,
    }


def main():
    with open(GEO, encoding="utf-8") as f:
        geo = json.load(f)
    names = [(r["id"], r["name"]) for r in geo["regions"]]
    codes = {}
    for code, name in names:
        codes[key(name)] = code

    unmatched = []
    soft = match(read_summary(os.path.join(SRC, SOFT_FILE), SOFT_SHEET),
                 codes, u"мягкая пшеница", unmatched)
    durum = match(read_summary(os.path.join(SRC, DURUM_FILE), DURUM_SHEET),
                  codes, u"твёрдая пшеница", unmatched)
    strong = match(read_strong(os.path.join(SRC, STRONG_FILE)),
                   codes, u"сильная пшеница", unmatched)
    spec_raw = read_spec(os.path.join(SRC, SPEC_FILE))
    spec = {k: match(v, codes, u"спец. характеристики (%s)" % k, unmatched)
            for k, v in spec_raw.items()}

    regions = []
    for code, name in names:
        years = {}
        item = {}
        if code in soft:
            b = block(soft[code], spec["soft"].get(code), strong.get(code))
            if b:
                item["soft"] = b
        if code in durum:
            b = block(durum[code], spec["durum"].get(code), None)
            if b:
                item["durum"] = b
        if item:
            years[str(YEAR)] = item
        regions.append({"id": code, "name": name, "years": years})

    russia = {str(YEAR): {}}
    for kind in ("soft", "durum"):
        s = summarize(regions, kind, soft if kind == "soft" else durum)
        if s:
            russia[str(YEAR)][kind] = s

    doc = {
        "demo": False,
        "note": u"Данные заказчика: свод госмониторинга качества зерна "
                u"урожая 2026 года по состоянию на 28 сентября. Исходные "
                u"таблицы — data/monitoring-src/.",
        "unit": u"тыс. т",
        "years": [YEAR],
        "ribbon": RIBBON,
        "strongNote": u"Сильная пшеница: белок выше 13,5 % и клейковина выше 28 %",
        "russia": russia,
        "regions": regions,
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))

    kb = os.path.getsize(OUT) / 1024.0
    have_soft = len([r for r in regions if (r["years"].get(str(YEAR)) or {}).get("soft")])
    have_durum = len([r for r in regions if (r["years"].get(str(YEAR)) or {}).get("durum")])
    print(u"Готово: %s — %.0f КБ" % (os.path.relpath(OUT, ROOT), kb))
    print(u"  субъектов в геоданных: %d" % len(regions))
    print(u"  с мягкой пшеницей: %d, с твёрдой: %d, «сильных»: %d"
          % (have_soft, have_durum, len(strong)))
    for kind, label in (("soft", u"мягкая"), ("durum", u"твёрдая")):
        s = russia[str(YEAR)].get(kind)
        if not s:
            continue
        print(u"  %s: валовой сбор %.0f, обследовано %.0f тыс. т, "
              u"соответствует ГОСТ %.1f %%, лидер — %s"
              % (label, s["gross"], s["surveyed"], s["compliance"], s["leader"]))
    if unmatched:
        print(u"  НЕ СОПОСТАВЛЕНО с кодами субъектов (%d):" % len(unmatched))
        for u in unmatched:
            print(u"    " + u)


if __name__ == "__main__":
    main()
