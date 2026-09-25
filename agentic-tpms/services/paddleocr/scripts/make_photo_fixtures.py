"""Regenerate the session-photo EXIF fixtures used by the Node photo tests.

    services/paddleocr/.venv/bin/python services/paddleocr/scripts/make_photo_fixtures.py

Writes small JPEGs to tests/fixtures/photos/. The venue in the Node test is
the lifecycle helper's (3.0726, 101.6074); the test pins the package's
training dates to 2026-10-20..2026-10-21 so these fixed timestamps apply.
"""

from __future__ import annotations

from fractions import Fraction
from pathlib import Path

import piexif
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parents[3] / "tests" / "fixtures" / "photos"


def dms(value: float) -> tuple[tuple[int, int], tuple[int, int], tuple[int, int]]:
    value = abs(value)
    degrees = int(value)
    minutes_full = (value - degrees) * 60
    minutes = int(minutes_full)
    seconds = Fraction((minutes_full - minutes) * 60).limit_denominator(10000)
    return ((degrees, 1), (minutes, 1), (seconds.numerator, seconds.denominator))


def photo(name: str, *, lat: float | None, lng: float | None, taken: str | None, offset: str | None = "+08:00") -> None:
    img = Image.new("RGB", (160, 120), (214, 222, 235))
    draw = ImageDraw.Draw(img)
    draw.rectangle((10, 60, 150, 110), fill=(90, 110, 140))
    draw.text((12, 12), name[:22], fill=(20, 24, 31))
    path = OUT / name
    if lat is None and taken is None:
        img.save(path, "JPEG", quality=80)
        return
    exif: dict = {"0th": {piexif.ImageIFD.Make: b"TPMS", piexif.ImageIFD.Model: b"Fixture Cam"}, "Exif": {}, "GPS": {}, "1st": {}}
    if taken:
        exif["Exif"][piexif.ExifIFD.DateTimeOriginal] = taken.encode()
        if offset:
            exif["Exif"][piexif.ExifIFD.OffsetTimeOriginal] = offset.encode()
    if lat is not None and lng is not None:
        exif["GPS"] = {
            piexif.GPSIFD.GPSVersionID: (2, 3, 0, 0),
            piexif.GPSIFD.GPSLatitudeRef: b"N" if lat >= 0 else b"S",
            piexif.GPSIFD.GPSLatitude: dms(lat),
            piexif.GPSIFD.GPSLongitudeRef: b"E" if lng >= 0 else b"W",
            piexif.GPSIFD.GPSLongitude: dms(lng),
        }
    img.save(path, "JPEG", quality=80, exif=piexif.dump(exif))


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    near = (3.07295, 101.60795)  # ~70 m from the venue
    photo("near-venue.jpg", lat=near[0], lng=near[1], taken="2026:10:20 10:15:00")
    photo("near-venue-early-no-offset.jpg", lat=near[0], lng=near[1], taken="2026:10:20 07:30:00", offset=None)
    photo("far-away.jpg", lat=3.1579, lng=101.7123, taken="2026:10:20 10:15:00")  # KLCC, ~15 km
    photo("wrong-day.jpg", lat=near[0], lng=near[1], taken="2026:11:02 10:15:00")
    photo("no-gps.jpg", lat=None, lng=None, taken="2026:10:21 15:40:00")
    photo("no-exif.jpg", lat=None, lng=None, taken=None)
    for f in sorted(OUT.glob("*.jpg")):
        print(f"{f.name}: {f.stat().st_size} bytes")


if __name__ == "__main__":
    main()
