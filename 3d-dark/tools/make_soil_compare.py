#!/usr/bin/env python3
"""Кадры сравнения «до/после» для экранов мелиорации и рекультивации.

Правка заказчика 30.09: оба экрана — как в макете, участок во весь экран
и шторка с разделителем через всю высоту. В фигме сравнение собрано
половинками (левая — кадр «до», правая — «после», каждая со своим фоном),
поэтому целиком оттуда ни один кадр не достаётся. Заказчик прислал
участки отдельно — четыре PNG с прозрачным фоном, по размеру слоя фигмы
(около 1959x1086, слой стоит в блоке сцены со сдвигом -34, -26).

Скрипт собирает из них:
  soil-restore-bg.webp   — общий фон студии без участка (сцена обоих экранов);
  soil-3-before/after    — мелиорация, участок на прозрачном слое 1888x1048;
  soil-4-before/after    — рекультивация, то же.

Фон взят из эталонного кадра рекультивации (docs/mockup/concept-30-09):
шов по центру, где в фигме сходятся половинки, сглажен, а место под
участком залито плавным переходом от краёв с зерном как у фона рядом.
Заливку почти целиком закрывает сам участок, видны только её края.

Исходники кладутся в assets/concept/src под именами
soil-3-before.png, soil-3-after.png, soil-4-before.png, soil-4-after.png.

Запуск:  python3 tools/make_soil_compare.py
"""

import os

import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets", "concept", "src")
OUT = os.path.join(ROOT, "assets", "photos", "concept")
FRAME = os.path.join(ROOT, "docs", "mockup", "concept-30-09",
                     "05b-rekultivaciya-sravnenie.jpg")

W, H = 1888, 1048          # блок сцены
DX, DY = -34, -26          # где слой участка стоит в блоке сцены (сверено по кадрам)
NAMES = ["soil-3-before", "soil-3-after", "soil-4-before", "soil-4-after"]
SEAM = (925, 933)          # между этими столбцами в кадре шов половинок


def layer(name):
    """Участок на прозрачном слое размером с блок сцены."""
    im = Image.open(os.path.join(SRC, name + ".png")).convert("RGBA")
    out = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    out.paste(im, (DX, DY))
    return out


def blur(a, r):
    """Гауссово размытие массива HxWxC средствами Pillow (по каналам)."""
    chans = [np.asarray(Image.fromarray(a[..., c]).filter(ImageFilter.GaussianBlur(r)))
             for c in range(a.shape[2])]
    return np.stack(chans, -1)


def seam_fix(f, hole):
    """Левую половину кадра подтягиваем к правой: у половин свой фон."""
    a0, a1 = SEAM
    left, right = f[:, a0 - 8:a0].mean(1), f[:, a1:a1 + 8].mean(1)
    ok = ~hole[:, a0 - 10:a1 + 10].any(1)
    rows = np.arange(H)
    k = np.exp(-0.5 * (np.arange(-75, 76) / 25.0) ** 2)
    k /= k.sum()
    d = np.stack([np.convolve(np.pad(np.interp(rows, rows[ok], (right - left)[ok, c]),
                                     75, mode="edge"), k, mode="valid")
                  for c in range(3)], -1)
    x = np.arange(W)
    w = np.clip(1 - (a0 - x) / 320.0, 0, 1)
    w[x > a0] = 0
    f = f + d[:, None, :] * w[None, :, None]
    for i, xx in enumerate(range(a0 + 1, a1)):
        t = (i + 1) / float(a1 - a0)
        f[:, xx] = f[:, a0] * (1 - t) + f[:, a1] * t
    return f


def harmonic_fill(f, hole):
    """Дыра заливается гладко от краёв: пирамида и итерации Якоби."""
    u = None
    for s, it in ((16, 3000), (8, 1500), (4, 800), (2, 400), (1, 250)):
        w, h = W // s, H // s
        fs = np.asarray(Image.fromarray(np.clip(f, 0, 255).astype(np.uint8))
                        .resize((w, h), Image.BOX)).astype(np.float32)
        ms = np.asarray(Image.fromarray((hole * 255).astype(np.uint8))
                        .resize((w, h), Image.BOX)) > 0
        cur = fs.copy()
        if u is None:
            cur[ms] = fs[~ms].mean(0)
        else:
            up = np.asarray(Image.fromarray(np.clip(u, 0, 255).astype(np.uint8))
                            .resize((w, h), Image.BILINEAR)).astype(np.float32)
            cur[ms] = up[ms]
        for _ in range(it):
            v = (np.roll(cur, 1, 0) + np.roll(cur, -1, 0) +
                 np.roll(cur, 1, 1) + np.roll(cur, -1, 1)) / 4
            cur[ms] = v[ms]
        u = cur
    return u


def main():
    layers = {n: layer(n) for n in NAMES}
    alpha = np.max([np.asarray(l)[..., 3] for l in layers.values()], 0)
    hole_im = Image.fromarray(((alpha > 2) * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(13))
    hole = np.asarray(hole_im) > 0

    f = np.asarray(Image.open(FRAME).convert("RGB")).astype(np.float32)
    f = seam_fix(f, hole)
    fill = harmonic_fill(f, hole)

    # зерно фона: в залитом месте такой же мелкий шум, как рядом
    hp = f - blur(np.clip(f, 0, 255).astype(np.uint8), 1.5).astype(np.float32)
    std = float(hp[~hole].std())
    n = np.random.default_rng(7).normal(128, 40, (H, W, 1)).clip(0, 255).astype(np.uint8)
    n = n.astype(np.float32) - blur(n, 1.5).astype(np.float32)
    fill = fill + n / n.std() * std

    soft = np.asarray(hole_im.filter(ImageFilter.GaussianBlur(3))).astype(np.float32) / 255
    soft = np.clip(soft * 1.5, 0, 1)[..., None]
    bg = np.clip(f * (1 - soft) + fill * soft, 0, 255).astype(np.uint8)

    os.makedirs(OUT, exist_ok=True)
    # фон гладкий и тёмный: на обычных 78–82 WebP рисует на нём квадраты,
    # поэтому качество выше (блочность, что остаётся, пришла с JPEG-кадра)
    Image.fromarray(bg).save(os.path.join(OUT, "soil-restore-bg.webp"),
                             "WEBP", quality=92, method=6)
    for n_, l in layers.items():
        l.save(os.path.join(OUT, n_ + ".webp"), "WEBP", quality=86, method=6)
    for n_ in ["soil-restore-bg"] + NAMES:
        p = os.path.join(OUT, n_ + ".webp")
        print("%s: %d КБ" % (os.path.relpath(p, ROOT), os.path.getsize(p) // 1024))


if __name__ == "__main__":
    main()
