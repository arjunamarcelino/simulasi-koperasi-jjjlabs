#!/usr/bin/env python3
"""
Tile inspector — crop & annotate a region of a 16x16 tileset so you can read
each tile's grid index and see an object's true bounds (incl. moss/canopy that
bulges past a tile). Use it to pick { col, row, w, h } for VillageScene stamps.

Requires: pip install pillow

Examples:
  # Annotate the whole village tileset with grid + frame indices (index = row*cols+col):
  python tile-inspect.py grid public/assets/ninja/tileset_village_abandoned.png

  # Zoom into a region (cols 11-15, rows 6-10) to find a building's exact bounds:
  python tile-inspect.py grid public/assets/ninja/tileset_village_abandoned.png \
      --c0 11 --r0 6 --c1 16 --r1 11 --scale 8 -o /tmp/region.png

  # Preview a single object exactly as a stamp would render it (col,row,w,h):
  python tile-inspect.py stamp public/assets/ninja/tileset_village_abandoned.png \
      --col 0 --row 6 --w 5 --h 3 -o /tmp/bigtree.png
"""
import argparse
from PIL import Image, ImageDraw

TILE = 16


def _checker(w, h):
    img = Image.new("RGBA", (w, h), (40, 40, 50, 255))
    d = ImageDraw.Draw(img)
    for y in range(0, h, TILE):
        for x in range(0, w, TILE):
            if ((x // TILE) + (y // TILE)) % 2 == 0:
                d.rectangle([x, y, x + TILE - 1, y + TILE - 1], fill=(58, 58, 70, 255))
    return img


def grid(args):
    im = Image.open(args.src).convert("RGBA")
    cols = im.size[0] // TILE
    c0, r0 = args.c0, args.r0
    c1 = args.c1 if args.c1 is not None else cols
    r1 = args.r1 if args.r1 is not None else im.size[1] // TILE
    sub = im.crop((c0 * TILE, r0 * TILE, c1 * TILE, r1 * TILE))
    s = args.scale
    big = _checker(sub.width * s, sub.height * s)
    big.alpha_composite(sub.resize((sub.width * s, sub.height * s), Image.NEAREST))
    d = ImageDraw.Draw(big)
    for r in range(r1 - r0 + 1):
        d.line([(0, r * TILE * s), (big.width, r * TILE * s)], fill=(255, 60, 60, 220))
    for c in range(c1 - c0 + 1):
        d.line([(c * TILE * s, 0), (c * TILE * s, big.height)], fill=(255, 60, 60, 220))
    for r in range(r1 - r0):
        for c in range(c1 - c0):
            idx = (r0 + r) * cols + (c0 + c)  # frame index; col=idx%cols, row=idx//cols
            d.text((c * TILE * s + 2, r * TILE * s + 1), str(idx), fill=(255, 255, 0, 255))
    big.save(args.out)
    print(f"{args.out}  cols {c0}-{c1 - 1} rows {r0}-{r1 - 1}  (index = row*{cols}+col)")


def stamp(args):
    im = Image.open(args.src).convert("RGBA")
    sub = im.crop((args.col * TILE, args.row * TILE,
                   (args.col + args.w) * TILE, (args.row + args.h) * TILE))
    s = args.scale
    out = _checker(sub.width * s, sub.height * s)
    out.alpha_composite(sub.resize((sub.width * s, sub.height * s), Image.NEAREST))
    out.save(args.out)
    print(f"{args.out}  stamp col={args.col} row={args.row} w={args.w} h={args.h}")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    g = sub.add_parser("grid", help="annotate a region with grid + frame indices")
    g.add_argument("src")
    g.add_argument("--c0", type=int, default=0)
    g.add_argument("--r0", type=int, default=0)
    g.add_argument("--c1", type=int, default=None)
    g.add_argument("--r1", type=int, default=None)
    g.add_argument("--scale", type=int, default=6)
    g.add_argument("-o", "--out", default="/tmp/tile-grid.png")
    g.set_defaults(func=grid)

    st = sub.add_parser("stamp", help="preview one object as {col,row,w,h}")
    st.add_argument("src")
    st.add_argument("--col", type=int, required=True)
    st.add_argument("--row", type=int, required=True)
    st.add_argument("--w", type=int, required=True)
    st.add_argument("--h", type=int, required=True)
    st.add_argument("--scale", type=int, default=8)
    st.add_argument("-o", "--out", default="/tmp/tile-stamp.png")
    st.set_defaults(func=stamp)

    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
