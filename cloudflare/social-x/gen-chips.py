"""Generate legend/title chip PNGs for the forecast map (requires PIL).

Prints base64 constants in the src/brand.ts format — paste output into
brand.ts, or tweak OUT to add/retheme chips and re-run.
"""
from PIL import Image, ImageDraw, ImageFont
import base64, io

FONT = "C:/Windows/Fonts/DejaVuSans-Bold.ttf"
WHITE = (238, 238, 238, 255)

def b64(img):
    buf = io.BytesIO(); img.save(buf, "PNG")
    return base64.b64encode(buf.getvalue()).decode()

def title(text, size=24):
    f = ImageFont.truetype(FONT, size)
    tmp = Image.new("RGBA", (10, 10)); d = ImageDraw.Draw(tmp)
    l, t, r, b = d.textbbox((0, 0), text, font=f)
    im = Image.new("RGBA", (r - l + 4, b - t + 8), (0, 0, 0, 0))
    ImageDraw.Draw(im).text((2 - l, 4 - t), text, font=f, fill=WHITE)
    return im

def chip(text, color, swatch=False):
    """~26px tall: colored dot/swatch at x~6-27, caps text from x~34."""
    f = ImageFont.truetype(FONT, 19)
    tmp = Image.new("RGBA", (10, 10)); d = ImageDraw.Draw(tmp)
    l, t, r, b = d.textbbox((0, 0), text, font=f)
    im = Image.new("RGBA", (34 + (r - l) + 8, 26), (0, 0, 0, 0))
    dr = ImageDraw.Draw(im)
    cy = 13
    if swatch:
        dr.rounded_rectangle([5, cy - 9, 27, cy + 9], 4, fill=color + (255,))
    else:
        dr.ellipse([7, cy - 9, 25, cy + 9], fill=color + (255,))
    dr.text((34 - l, 16 - t), text, font=f, fill=WHITE)
    return im

OUT = {
    "WZ_TITLE_PNG_B64":   (title("WORK ZONE REPORT · US"),       "Work Zone Report title sprite."),
    "WZ_CHIP_PNG_B64":    (chip("WORK ZONES", (245, 166, 35)),   "Amber work-zone legend dot."),
    "WIN_TITLE_PNG_B64":  (title("WINTER ROADS · US"),           "Winter Roads title sprite."),
    "WIN_CHIP_PNG_B64":   (chip("WINTER ROADS", (77, 195, 255)), "Ice-blue winter-roads legend dot."),
    "WIN_ALERT_PNG_B64":  (chip("WINTER ALERT", (77, 166, 255), swatch=True), "Blue winter-alert legend swatch."),
}
for name, (img, doc) in OUT.items():
    s = b64(img)
    print(f"/** {doc} */")
    print(f"export const {name} =")
    for i in range(0, len(s), 100):
        sep = " +" if i + 100 < len(s) else ";"
        print(f'  "{s[i:i+100]}"{sep}')
    print()
