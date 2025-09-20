#!/usr/bin/env python3
from PIL import Image
import sys, os

def remove_background_to_alpha(img: Image.Image, bg=(255,255,255), tol=12):
    """
    Make near-white background fully transparent; preserve existing alpha elsewhere.
    Does NOT force opaque alpha for non-background pixels.
    """
    img = img.convert('RGBA')
    datas = img.getdata()
    out = []
    br,bg_,bb = bg
    for (r,g,b,a) in datas:
        if abs(r-br) <= tol and abs(g-bg_) <= tol and abs(b-bb) <= tol and a != 0:
            out.append((r,g,b,0))
        else:
            out.append((r,g,b,a))
    img.putdata(out)
    return img

def to_white_silhouette(img: Image.Image):
    img = img.convert('RGBA')
    datas = img.getdata()
    out = []
    for r,g,b,a in datas:
        if a == 0:
            out.append((255,255,255,0))
        else:
            out.append((255,255,255,255))
    img.putdata(out)
    return img

def main():
    if len(sys.argv) < 2:
        print('usage: make_glyphs.py <source_icon>')
        sys.exit(1)
    src = sys.argv[1]
    out_dir = os.path.dirname(src)
    base = Image.open(src)

    # 1) Transparent glyph from white background
    glyph = remove_background_to_alpha(base)
    glyph.save(os.path.join(out_dir, 'icon-glyph.png'))

    # 2) White-only silhouette
    white = to_white_silhouette(glyph)
    white.save(os.path.join(out_dir, 'icon-glyph-white.png'))

if __name__ == '__main__':
    main()
