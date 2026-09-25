"""Primary Form T3 engine: template-anchored grid reading.

We generate the T3 sheet, so we do not need to *find* a table in the scan —
we need to *register* a known one. Each page has four solid black corner
fiducials and a QR code carrying the layout (see ``layout.py``):

1. find the fiducials (dark, solid, square contours nearest each corner)
2. read the QR — first from a straightened crop at the template's default
   position, then from the raw scan — to get the page's layout
3. perspective-warp the scan onto the canonical page (PDF points x scale)
4. crop every AM/PM signature cell with an inset that keeps the ruling
   lines out, binarise (adaptive AND absolutely dark), strip any line that
   still intrudes, and measure the ink ratio
5. signed := ratio >= THRESHOLD; confidence is the distance from the
   threshold, mapped so that the ambiguous band [AMBIGUOUS_LOW,
   AMBIGUOUS_HIGH] always lands below REVIEW_CONFIDENCE (0.75)

Nothing here is a learned model; it is deterministic geometry, which is why
a low confidence is a reliable signal to send a slot to a human.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field

import cv2
import numpy as np

from . import layout as L
from .imaging import RASTER_DPI

SCALE = RASTER_DPI / 72.0  # canonical pixels per PDF point

THRESHOLD = 0.02
AMBIGUOUS_LOW = 0.01
AMBIGUOUS_HIGH = 0.04
REVIEW_CONFIDENCE = 0.75
# Registration without fiducials (a clean full-page render, a cropped photo)
# is plausible but unverified: every reading is capped below review level.
UNREGISTERED_CONFIDENCE_CAP = 0.6


@dataclass
class CellReading:
    signed: bool
    confidence: float
    ink_ratio: float

    def as_json(self) -> dict:
        return {"signed": self.signed, "confidence": round(self.confidence, 3), "inkRatio": round(self.ink_ratio, 4)}


@dataclass
class PageResult:
    page_index: int
    layout: L.T3Layout | None
    layout_source: str | None
    registration: str | None
    rows: list[dict] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def as_json(self) -> dict:
        lay = self.layout
        return {
            "pageIndex": self.page_index,
            "sheetPage": lay.page_index if lay else None,
            "sheetPageCount": lay.page_count if lay else None,
            "dayIndex": lay.day_index if lay else None,
            "packageId": lay.package_id if lay else None,
            "layoutSource": self.layout_source,
            "registration": self.registration,
            "rows": self.rows,
            "warnings": self.warnings,
        }


# --------------------------------------------------------------------------- classification


def classify(ratio: float, cap: float = 1.0) -> CellReading:
    """Map an ink ratio to (signed, confidence).

    Confidence is 0.5 at the threshold and rises linearly with distance from
    it; the slope on each side is chosen so the band edge maps to exactly
    0.75, hence anything inside the band is < 0.75 and goes to review.
    """
    if ratio >= THRESHOLD:
        span = 2 * (AMBIGUOUS_HIGH - THRESHOLD)
        confidence = 0.5 + 0.5 * min(1.0, (ratio - THRESHOLD) / span)
        signed = True
    else:
        span = 2 * (THRESHOLD - AMBIGUOUS_LOW)
        confidence = 0.5 + 0.5 * min(1.0, (THRESHOLD - ratio) / span)
        signed = False
    return CellReading(signed=signed, confidence=min(confidence, cap), ink_ratio=ratio)


def ink_ratio(cell: np.ndarray) -> float:
    """Fraction of the cell covered by ink, ruling lines and specks removed."""
    if cell.size == 0:
        return 0.0
    h, w = cell.shape
    paper = float(np.percentile(cell, 90))
    block = max(15, (min(h, w) // 2) | 1)
    local = cv2.adaptiveThreshold(cell, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, block, 12)
    # Adaptive alone turns paper noise into ink in a blank cell; requiring the
    # pixel to also be absolutely dark (relative to this cell's paper) stops it.
    dark = (cell < min(paper - 45.0, 175.0)).astype(np.uint8) * 255
    ink = cv2.bitwise_and(local, dark)
    # A few pixels of misregistration can pull a ruling line into the crop;
    # a line is a long, one-directional run, which a signature is not.
    horizontal = cv2.morphologyEx(ink, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (max(3, int(w * 0.45)), 1)))
    vertical = cv2.morphologyEx(ink, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (1, max(3, int(h * 0.8)))))
    ink = cv2.bitwise_and(ink, cv2.bitwise_not(cv2.bitwise_or(horizontal, vertical)))
    ink = cv2.morphologyEx(ink, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    return float(np.count_nonzero(ink)) / float(ink.size)


def crop_cell(canon: np.ndarray, rect: tuple[float, float, float, float]) -> np.ndarray:
    x, y, w, h = (v * SCALE for v in rect)
    inset_x = max(4.0, w * 0.04)
    inset_y = max(4.0, h * 0.16)
    x0, x1 = int(round(x + inset_x)), int(round(x + w - inset_x))
    y0, y1 = int(round(y + inset_y)), int(round(y + h - inset_y))
    hh, ww = canon.shape
    x0, x1 = max(0, x0), min(ww, x1)
    y0, y1 = max(0, y0), min(hh, y1)
    return canon[y0:y1, x0:x1]


# --------------------------------------------------------------------------- registration


def find_fiducials(gray: np.ndarray) -> np.ndarray | None:
    """Centres of the four corner fiducials as float32 [TL, TR, BL, BR], or None.

    A fixed darkness cut suits a flatbed scan; a dim phone photo, where the
    paper itself is mid-grey, gets a second pass with an Otsu threshold.
    """
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    found = _fiducials_in_mask(gray.shape, (blur < 110).astype(np.uint8) * 255)
    if found is None:
        _, otsu = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
        found = _fiducials_in_mask(gray.shape, otsu)
    return found


def _fiducials_in_mask(shape: tuple[int, ...], mask: np.ndarray) -> np.ndarray | None:
    h, w = shape[:2]
    longest = float(max(h, w))
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    min_side, max_side = longest * 0.008, longest * 0.06
    candidates: list[tuple[float, float, float]] = []
    for contour in contours:
        area = cv2.contourArea(contour)
        if area < min_side * min_side or area > max_side * max_side:
            continue
        (_, _), (rw, rh), _ = cv2.minAreaRect(contour)
        if rw <= 0 or rh <= 0 or min(rw, rh) / max(rw, rh) < 0.75:
            continue
        if area / (rw * rh) < 0.82:
            continue  # QR finder patterns and text blobs are hollow or ragged
        hull = cv2.convexHull(contour)
        if area / max(cv2.contourArea(hull), 1.0) < 0.9:
            continue
        m = cv2.moments(contour)
        if m["m00"] == 0:
            continue
        candidates.append((m["m10"] / m["m00"], m["m01"] / m["m00"], area))
    if len(candidates) < 4:
        return None

    corners = [(0.0, 0.0), (float(w), 0.0), (0.0, float(h)), (float(w), float(h))]
    limit = 0.3 * float(np.hypot(w, h))
    chosen: list[tuple[float, float]] = []
    used: set[int] = set()
    for cx, cy in corners:
        best, best_d = -1, limit
        for i, (x, y, _) in enumerate(candidates):
            if i in used:
                continue
            d = float(np.hypot(x - cx, y - cy))
            if d < best_d:
                best, best_d = i, d
        if best < 0:
            return None
        used.add(best)
        chosen.append((candidates[best][0], candidates[best][1]))
    pts = np.array(chosen, dtype=np.float32)
    # Sanity: the quadrilateral must span most of the image and be convex.
    if (pts[1][0] - pts[0][0]) < 0.5 * w or (pts[2][1] - pts[0][1]) < 0.5 * h:
        return None
    if not cv2.isContourConvex(pts[[0, 1, 3, 2]].reshape(-1, 1, 2)):
        return None
    areas = sorted(c[2] for i, c in enumerate(candidates) if i in used)
    if areas[0] < 0.4 * areas[-1]:
        return None  # four fiducials print at one size
    return pts


def canonical_size(geometry: L.Geometry) -> tuple[int, int]:
    return int(round(geometry.page[0] * SCALE)), int(round(geometry.page[1] * SCALE))


def warp_to_canonical(gray: np.ndarray, fiducials: np.ndarray, targets: tuple[tuple[float, float], ...], page: tuple[float, float]) -> np.ndarray:
    dst = np.array([[x * SCALE, y * SCALE] for x, y in targets], dtype=np.float32)
    matrix = cv2.getPerspectiveTransform(fiducials, dst)
    size = (int(round(page[0] * SCALE)), int(round(page[1] * SCALE)))
    return cv2.warpPerspective(gray, matrix, size, flags=cv2.INTER_LINEAR, borderValue=255)


# --------------------------------------------------------------------------- QR


def _decoders() -> list:
    decoders = [cv2.QRCodeDetector()]
    aruco = getattr(cv2, "QRCodeDetectorAruco", None)
    if aruco is not None:
        decoders.append(aruco())
    return decoders


def decode_qr_text(img: np.ndarray) -> str | None:
    variants = [img]
    _, otsu = cv2.threshold(img, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    variants.append(otsu)
    for decoder in _decoders():
        for variant in variants:
            try:
                text, points, _ = decoder.detectAndDecode(variant)
            except cv2.error:
                continue
            if text:
                return text
    return None


def read_layout_from_qr(gray: np.ndarray, fiducials: np.ndarray | None) -> tuple[L.T3Layout | None, list[str]]:
    """Find and parse the page's QR layout. Returns (layout, warnings)."""
    attempts: list[np.ndarray] = []
    if fiducials is not None:
        straight = warp_to_canonical(gray, fiducials, L.DEFAULT_FIDUCIALS, L.DEFAULT_PAGE)
        qx, qy, qs = L.DEFAULT_QR_BOX
        pad = qs * 0.2
        x0, y0 = int((qx - pad) * SCALE), int((qy - pad) * SCALE)
        x1, y1 = int((qx + qs + pad) * SCALE), int((qy + qs + pad) * SCALE)
        crop = straight[max(0, y0):y1, max(0, x0):x1]
        if crop.size:
            attempts.append(cv2.resize(crop, None, fx=2.0, fy=2.0, interpolation=cv2.INTER_CUBIC))
            attempts.append(crop)
        attempts.append(straight)
    attempts.append(gray)
    if max(gray.shape) > 2600:
        attempts.append(cv2.resize(gray, None, fx=0.5, fy=0.5, interpolation=cv2.INTER_AREA))

    warnings: list[str] = []
    for img in attempts:
        text = decode_qr_text(img)
        if not text:
            continue
        try:
            return L.parse_layout(text), warnings
        except L.LayoutError as error:
            warnings.append(f"QR_NOT_A_T3_LAYOUT: {error}")
            return None, warnings
    warnings.append("QR_NOT_DECODED")
    return None, warnings


# --------------------------------------------------------------------------- page


def read_page(gray: np.ndarray, page_index: int, supplied: L.T3Layout | None = None, name_reader=None) -> PageResult:
    result = PageResult(page_index=page_index, layout=None, layout_source=None, registration=None)
    fiducials = find_fiducials(gray)
    if fiducials is None:
        result.warnings.append("FIDUCIALS_NOT_FOUND")

    layout = supplied
    if layout is not None:
        result.layout_source = "param"
    else:
        layout, qr_warnings = read_layout_from_qr(gray, fiducials)
        result.warnings.extend(qr_warnings)
        result.layout_source = "qr" if layout else None
    if layout is None:
        return result
    result.layout = layout
    geometry = layout.geometry

    cap = 1.0
    if fiducials is not None:
        canon = warp_to_canonical(gray, fiducials, geometry.fiducials, geometry.page)
        result.registration = "fiducials"
    else:
        # Only a page that IS the sheet edge-to-edge can be read without
        # fiducials (a clean render); anything else would be guesswork.
        h, w = gray.shape
        expected = geometry.page[0] / geometry.page[1]
        if abs((w / h) - expected) / expected > 0.03:
            result.warnings.append("PAGE_NOT_REGISTERED")
            return result
        canon = cv2.resize(gray, canonical_size(geometry), interpolation=cv2.INTER_AREA)
        result.registration = "full_page"
        cap = UNREGISTERED_CONFIDENCE_CAP

    for row_index, participant_id in enumerate(layout.participant_ids):
        row: dict = {"rowIndex": row_index, "participantId": participant_id}
        for session, key in (("AM", "am"), ("PM", "pm")):
            ratio = ink_ratio(crop_cell(canon, geometry.cell(row_index, session)))
            row[key] = classify(ratio, cap).as_json()
        if name_reader is not None and geometry.name is not None:
            row["printedName"] = name_reader(crop_cell(canon, (geometry.name[0], geometry.row_top(row_index), geometry.name[1], geometry.row_height)))
        result.rows.append(row)
    return result


def parse_document(pages: list[np.ndarray], supplied: list[L.T3Layout] | None = None, name_reader=None) -> list[PageResult]:
    results: list[PageResult] = []
    for i, gray in enumerate(pages):
        chosen = supplied[i] if supplied and i < len(supplied) else None
        results.append(read_page(gray, i + 1, chosen, name_reader))
    return results


def layout_json(layout: L.T3Layout) -> str:
    """Re-encode a layout (used by the synthesiser's tests)."""
    g = layout.geometry
    return json.dumps(
        {
            "v": layout.version,
            "p": L.encode_uuid(layout.package_id),
            "d": layout.day_index,
            "pg": layout.page_index,
            "pc": layout.page_count,
            "r": [L.encode_uuid(r) for r in layout.participant_ids],
            "g": {
                "s": list(g.page),
                "f": [list(f) for f in g.fiducials],
                "fz": g.fiducial_size,
                "t": [g.table_left, g.table_top],
                "hh": g.header_height,
                "rh": g.row_height,
                "am": list(g.am),
                "pm": list(g.pm),
                **({"nm": list(g.name)} if g.name else {}),
            },
        },
        separators=(",", ":"),
    )
