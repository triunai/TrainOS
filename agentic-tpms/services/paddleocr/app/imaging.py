"""Loading uploads into grayscale page rasters.

PDFs are rasterised with PyMuPDF at 200 dpi (the resolution the T3 geometry
and the ink thresholds were tuned for); images are decoded with OpenCV. The
format is sniffed from the bytes, not trusted from the client's MIME type.
"""

from __future__ import annotations

import cv2
import numpy as np

RASTER_DPI = 200
MAX_PAGES = 40
MAX_PIXELS = 60_000_000


class UnsupportedMedia(ValueError):
    """The upload is not a PDF or an image OpenCV can decode."""


def is_pdf(data: bytes) -> bool:
    return data[:5] == b"%PDF-"


def pymupdf_available() -> bool:
    try:
        import pymupdf  # noqa: F401
    except ImportError:
        return False
    return True


def rasterise_pdf(data: bytes, dpi: int = RASTER_DPI) -> list[np.ndarray]:
    import pymupdf as fitz

    pages: list[np.ndarray] = []
    with fitz.open(stream=data, filetype="pdf") as doc:
        if doc.page_count > MAX_PAGES:
            raise UnsupportedMedia(f"PDF has {doc.page_count} pages; the limit is {MAX_PAGES}")
        zoom = dpi / 72.0
        for page in doc:
            pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), colorspace=fitz.csGRAY, alpha=False)
            img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.stride)[:, : pix.width]
            pages.append(img.copy())
    return pages


def decode_image(data: bytes, color: bool = False) -> np.ndarray:
    buf = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(buf, cv2.IMREAD_COLOR if color else cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise UnsupportedMedia("the upload is neither a PDF nor a decodable image (PNG, JPEG, TIFF, WebP, BMP)")
    if img.shape[0] * img.shape[1] > MAX_PIXELS:
        raise UnsupportedMedia("image is too large to process")
    return img


def load_pages(data: bytes) -> tuple[list[np.ndarray], str]:
    """Grayscale rasters for every page, and the detected source kind."""
    if not data:
        raise UnsupportedMedia("empty upload")
    if is_pdf(data):
        if not pymupdf_available():
            raise UnsupportedMedia("PDF input needs PyMuPDF, which is not installed")
        return rasterise_pdf(data), "pdf"
    return [decode_image(data)], "image"
