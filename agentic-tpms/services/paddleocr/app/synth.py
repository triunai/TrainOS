"""Synthetic Form T3 "scans" for tests and demos (``/v1/dev/synthesize-t3``).

Takes our own template PDF, renders one page at scan resolution, draws
handwriting-like strokes (chained random cubic Béziers) into the chosen
signature cells, then degrades the page the way a flatbed or phone scan does:
a wider scanner bed, slight rotation, perspective skew, blur and sensor noise.

``faint`` cells get a single short, light stroke — a stray mark whose ink
ratio lands in the classifier's ambiguous band, so tests can prove that an
unclear cell goes to a human instead of being guessed.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from . import layout as L
from .imaging import rasterise_pdf
from .t3 import SCALE, find_fiducials, read_layout_from_qr


class SynthError(ValueError):
    pass


@dataclass
class SynthSpec:
    signed: list[tuple[int, str]]
    faint: list[tuple[int, str]]
    rotate_deg: float = 0.0
    noise: float = 0.02
    perspective: float = 0.0
    blur: float = 0.8
    seed: int = 7
    page: int = 1

    @staticmethod
    def from_json(data: dict) -> "SynthSpec":
        def cells(key: str) -> list[tuple[int, str]]:
            out: list[tuple[int, str]] = []
            for item in data.get(key, []) or []:
                if not (isinstance(item, (list, tuple)) and len(item) == 2):
                    raise SynthError(f"{key} entries must be [rowIndex, 'AM'|'PM']")
                row, session = int(item[0]), str(item[1]).upper()
                if session not in ("AM", "PM"):
                    raise SynthError(f"unknown session {item[1]!r}")
                out.append((row, session))
            return out

        return SynthSpec(
            signed=cells("signed"),
            faint=cells("faint"),
            rotate_deg=float(data.get("rotateDeg", 0.0) or 0.0),
            noise=float(data.get("noise", 0.02) if data.get("noise") is not None else 0.02),
            perspective=float(data.get("perspective", 0.0) or 0.0),
            blur=float(data.get("blur", 0.8) if data.get("blur") is not None else 0.8),
            seed=int(data.get("seed", 7) or 7),
            page=int(data.get("page", 1) or 1),
        )


def _cell_px(geometry: L.Geometry, row: int, session: str) -> tuple[float, float, float, float]:
    x, y, w, h = geometry.cell(row, session)
    return x * SCALE, y * SCALE, w * SCALE, h * SCALE


def _bezier(p0, p1, p2, p3, n: int = 40) -> np.ndarray:
    t = np.linspace(0.0, 1.0, n)[:, None]
    return (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t**2 * p2 + t**3 * p3


def draw_signature(img: np.ndarray, rect: tuple[float, float, float, float], rng: np.random.Generator) -> None:
    x, y, w, h = rect
    left, right = x + w * 0.08, x + w * 0.92
    top, bottom = y + h * 0.2, y + h * 0.8
    segments = int(rng.integers(4, 8))
    span = (right - left) * float(rng.uniform(0.45, 0.8))
    cursor = np.array([left + (right - left - span) * float(rng.uniform(0, 1)), float(rng.uniform(top, bottom))])
    step = span / segments
    colour = (int(rng.integers(90, 140)), int(rng.integers(20, 50)), int(rng.integers(10, 30)))  # blue-black ink (BGR)
    thickness = int(rng.integers(2, 4))
    for _ in range(segments):
        end = np.array([cursor[0] + step * float(rng.uniform(0.7, 1.3)), float(rng.uniform(top, bottom))])
        c1 = np.array([cursor[0] + step * float(rng.uniform(-0.6, 0.9)), float(rng.uniform(top - h * 0.1, bottom + h * 0.1))])
        c2 = np.array([end[0] - step * float(rng.uniform(-0.6, 0.9)), float(rng.uniform(top - h * 0.1, bottom + h * 0.1))])
        pts = _bezier(cursor, c1, c2, end)
        pts[:, 1] = np.clip(pts[:, 1], y + h * 0.12, y + h * 0.88)
        cv2.polylines(img, [np.round(pts).astype(np.int32).reshape(-1, 1, 2)], False, colour, thickness, cv2.LINE_AA)
        cursor = end
    # A flourish underline, as many signatures have.
    if rng.uniform() < 0.5:
        y_line = float(rng.uniform(y + h * 0.6, y + h * 0.8))
        start = left + (right - left) * float(rng.uniform(0.0, 0.3))
        cv2.line(img, (int(start), int(y_line)), (int(start + span * 0.6), int(y_line - h * 0.1)), colour, max(1, thickness - 1), cv2.LINE_AA)


def draw_faint(img: np.ndarray, rect: tuple[float, float, float, float], rng: np.random.Generator) -> None:
    x, y, w, h = rect
    cx = x + w * float(rng.uniform(0.3, 0.6))
    cy = y + h * 0.5
    pts = []
    for i in range(7):
        pts.append((cx + i * w * 0.018, cy + (h * 0.14 if i % 2 else -h * 0.14)))
    cv2.polylines(img, [np.array(pts, dtype=np.int32).reshape(-1, 1, 2)], False, (60, 60, 60), 2, cv2.LINE_AA)


def degrade(img: np.ndarray, spec: SynthSpec, rng: np.random.Generator) -> np.ndarray:
    h, w = img.shape[:2]
    # A scanner bed wider than the paper, so rotation does not clip corners.
    pad_x, pad_y = int(w * 0.05), int(h * 0.05)
    paper = cv2.copyMakeBorder(img, pad_y, pad_y, pad_x, pad_x, cv2.BORDER_CONSTANT, value=(250, 250, 250))
    H, W = paper.shape[:2]
    # Paper tint and uneven illumination.
    gradient = np.linspace(0.96, 1.0, W, dtype=np.float32)[None, :, None]
    paper = np.clip(paper.astype(np.float32) * gradient, 0, 255).astype(np.uint8)
    if spec.rotate_deg:
        matrix = cv2.getRotationMatrix2D((W / 2, H / 2), spec.rotate_deg, 1.0)
        paper = cv2.warpAffine(paper, matrix, (W, H), flags=cv2.INTER_LINEAR, borderValue=(245, 245, 245))
    if spec.perspective:
        jitter = spec.perspective * min(W, H)
        src = np.float32([[0, 0], [W, 0], [0, H], [W, H]])
        dst = src + rng.uniform(-jitter, jitter, size=(4, 2)).astype(np.float32)
        paper = cv2.warpPerspective(paper, cv2.getPerspectiveTransform(src, dst), (W, H), borderValue=(245, 245, 245))
    if spec.blur > 0:
        paper = cv2.GaussianBlur(paper, (0, 0), spec.blur)
    if spec.noise > 0:
        noise = rng.normal(0.0, spec.noise * 255.0, paper.shape).astype(np.float32)
        paper = np.clip(paper.astype(np.float32) + noise, 0, 255).astype(np.uint8)
    return paper


def synthesize(template_pdf: bytes, spec: SynthSpec, layout: L.T3Layout | None = None) -> bytes:
    pages = rasterise_pdf(template_pdf)
    if not 1 <= spec.page <= len(pages):
        raise SynthError(f"page {spec.page} does not exist (the PDF has {len(pages)})")
    gray = pages[spec.page - 1]
    if layout is None:
        layout, warnings = read_layout_from_qr(gray, find_fiducials(gray))
        if layout is None:
            raise SynthError(f"could not read the template layout: {', '.join(warnings)}")
    rng = np.random.default_rng(spec.seed)
    img = cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)
    rows = len(layout.participant_ids)
    for row, session in spec.signed + spec.faint:
        if not 0 <= row < rows:
            raise SynthError(f"row {row} is outside this page (0..{rows - 1})")
    for row, session in spec.signed:
        draw_signature(img, _cell_px(layout.geometry, row, session), rng)
    for row, session in spec.faint:
        draw_faint(img, _cell_px(layout.geometry, row, session), rng)
    scan = degrade(img, spec, rng)
    ok, png = cv2.imencode(".png", scan)
    if not ok:
        raise SynthError("PNG encoding failed")
    return png.tobytes()
