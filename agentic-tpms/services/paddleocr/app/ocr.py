"""Optional PaddleOCR text recognition.

PaddleOCR is a SECONDARY engine here: it reads e-TRiS letters that arrive as
images or scanned PDFs, and printed names on a T3 for a cross-check warning.
The T3 attendance decision itself never depends on it. When the package is
not installed, is disabled (``TPMS_OCR_PADDLE=0``), or fails to initialise
(its models download on first use and the host may be offline), every
caller degrades to "no text" and ``/health`` reports ``paddleocr: false``.
"""

from __future__ import annotations

import importlib.util
import logging
import os
import threading

import numpy as np

log = logging.getLogger("tpms.ocr")

_lock = threading.Lock()
_engine = None
_failure: str | None = None


def installed() -> bool:
    return importlib.util.find_spec("paddleocr") is not None


def enabled() -> bool:
    return os.environ.get("TPMS_OCR_PADDLE", "1") != "0" and installed()


def status() -> str:
    if not installed():
        return "not_installed"
    if not enabled():
        return "disabled"
    if _failure:
        return f"failed: {_failure}"
    return "ready" if _engine is not None else "lazy"


def available() -> bool:
    return enabled() and _failure is None


def _get_engine():
    global _engine, _failure
    if not available():
        return None
    with _lock:
        if _engine is None and _failure is None:
            try:
                from paddleocr import PaddleOCR

                _engine = PaddleOCR(
                    use_doc_orientation_classify=False,
                    use_doc_unwarping=False,
                    use_textline_orientation=False,
                    lang=os.environ.get("TPMS_OCR_LANG", "en"),
                )
            except Exception as error:  # model download / runtime failure: degrade, never crash
                _failure = f"{type(error).__name__}: {str(error)[:200]}"
                log.warning("PaddleOCR unavailable: %s", _failure)
        return _engine


def recognise(img: np.ndarray) -> str | None:
    """Text lines in reading order, or None when no engine is usable."""
    engine = _get_engine()
    if engine is None:
        return None
    if img.ndim == 2:
        img = np.stack([img] * 3, axis=-1)
    try:
        results = engine.predict(img)
    except Exception as error:
        log.warning("PaddleOCR predict failed: %s", error)
        return None
    lines: list[str] = []
    for result in results or []:
        texts = result.get("rec_texts") if hasattr(result, "get") else None
        lines.extend(str(t) for t in (texts or []))
    return "\n".join(lines)


def read_name(cell: np.ndarray) -> str | None:
    text = recognise(cell)
    return " ".join(text.split()) if text else None
