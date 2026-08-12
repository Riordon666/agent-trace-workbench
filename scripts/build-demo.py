"""Build the README walkthrough GIF from real, synthetic-session UI captures."""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
DEMO_DIR = ROOT / "docs" / "demo"
OUTPUT = DEMO_DIR / "agent-trace-workbench-demo.gif"
WIDTH = 1200
HEADER_HEIGHT = 72

FRAMES = [
    ("01-live-capture.png", "1 · OBSERVE", "Bring local agent history into one trace", 6500, "#79b8e8"),
    ("02-session-explorer.png", "2 · EXPLORE", "Inspect models, tools, tokens, and reasoning availability", 7500, "#e891b5"),
    ("03-session-comparison.png", "3 · COMPARE", "See evidence-based deltas across agents", 8500, "#70c1b3"),
    ("04-replay-diagnostics.png", "4 · REPLAY", "Diagnose failures without inventing missing reasoning", 7500, "#f4a261"),
]


def font(name: str, size: int) -> ImageFont.ImageFont:
    path = Path("C:/Windows/Fonts") / name
    if path.exists():
        return ImageFont.truetype(str(path), size)
    return ImageFont.load_default()


def captioned_frame(filename: str, title: str, subtitle: str, accent: str) -> Image.Image:
    source = Image.open(DEMO_DIR / filename).convert("RGB")
    height = round(source.height * WIDTH / source.width)
    source = source.resize((WIDTH, height), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (WIDTH, height + HEADER_HEIGHT), "#172033")
    canvas.paste(source, (0, HEADER_HEIGHT))

    draw = ImageDraw.Draw(canvas)
    draw.rectangle((0, 0, 10, HEADER_HEIGHT), fill=accent)
    draw.text((32, 13), title, font=font("segoeuib.ttf", 25), fill="#ffffff")
    draw.text((220, 18), subtitle, font=font("segoeui.ttf", 19), fill="#dce6f3")
    watermark = "SYNTHETIC DATA · LOCAL-ONLY DEMO"
    watermark_font = font("segoeuib.ttf", 13)
    watermark_box = draw.textbbox((0, 0), watermark, font=watermark_font)
    watermark_width = watermark_box[2] - watermark_box[0]
    draw.text((WIDTH - watermark_width - 24, 48), watermark, font=watermark_font, fill="#9eabc0")
    return canvas.convert("P", palette=Image.Palette.ADAPTIVE, colors=192)


def main() -> None:
    missing = [filename for filename, *_ in FRAMES if not (DEMO_DIR / filename).exists()]
    if missing:
        raise SystemExit(f"Missing demo capture(s): {', '.join(missing)}")
    images = [captioned_frame(filename, title, subtitle, accent) for filename, title, subtitle, _, accent in FRAMES]
    durations = [duration for _, _, _, duration, _ in FRAMES]
    images[0].save(
        OUTPUT,
        save_all=True,
        append_images=images[1:],
        duration=durations,
        loop=0,
        optimize=True,
        disposal=2,
    )
    print(f"Built {OUTPUT.relative_to(ROOT)} ({sum(durations) / 1000:.1f}s, {OUTPUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
