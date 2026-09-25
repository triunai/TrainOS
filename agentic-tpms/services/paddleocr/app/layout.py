"""The T3 layout contract shared with ``src/server/attendance/t3Template.ts``.

Every generated Form T3 page carries a QR code whose payload is this compact
JSON (version 1). All geometry is in PDF points with a TOP-LEFT origin, so it
maps onto a raster by a single scale factor::

    {"v":1,"p":<pkg>,"d":<day>,"pg":<page 1-based>,"pc":<page count>,
     "r":[<participant>, ...],               # row order on this page
     "g":{"s":[W,H],                         # page size
          "f":[[x,y]x4],                     # fiducial centres TL, TR, BL, BR
          "fz":<fiducial side>,
          "t":[left, top],                   # table origin (header row top)
          "hh":<header row height>, "rh":<row height>,
          "am":[x, width], "pm":[x, width],
          "nm":[x, width]}}                  # optional: printed-name column

UUIDs travel as unpadded base64url of their 16 bytes (22 chars instead of 36)
because the QR has to stay large-moduled enough to survive a 200 dpi scan.
A hand-supplied layout may use canonical UUID strings instead; both decode.

R14: an unknown version or a missing key is an error, never a default.
"""

from __future__ import annotations

import base64
import json
import uuid
from dataclasses import dataclass
from typing import Any

LAYOUT_VERSION = 1

# Template v1 constants, mirrored from t3Template.ts. They are only used to
# warp a page whose QR could not be read in place (to retry the decode on a
# straightened crop); once the QR is decoded its own geometry is authoritative.
DEFAULT_PAGE = (841.89, 595.28)
DEFAULT_FIDUCIALS = ((30.0, 30.0), (812.0, 30.0), (30.0, 565.0), (812.0, 565.0))
DEFAULT_FIDUCIAL_SIZE = 20.0
DEFAULT_QR_BOX = (650.0, 44.0, 144.0)  # left, top, side


class LayoutError(ValueError):
    """The layout payload is not a v1 T3 layout."""


@dataclass(frozen=True)
class Geometry:
    page: tuple[float, float]
    fiducials: tuple[tuple[float, float], ...]
    fiducial_size: float
    table_left: float
    table_top: float
    header_height: float
    row_height: float
    am: tuple[float, float]
    pm: tuple[float, float]
    name: tuple[float, float] | None = None

    def row_top(self, row_index: int) -> float:
        return self.table_top + self.header_height + row_index * self.row_height

    def cell(self, row_index: int, session: str) -> tuple[float, float, float, float]:
        """(x, y, w, h) of a signature cell in points, top-left origin."""
        if session not in ("AM", "PM"):
            raise LayoutError(f"unknown session {session!r}")
        x, w = self.am if session == "AM" else self.pm
        return (x, self.row_top(row_index), w, self.row_height)


@dataclass(frozen=True)
class T3Layout:
    version: int
    package_id: str
    day_index: int
    page_index: int
    page_count: int
    participant_ids: tuple[str, ...]
    geometry: Geometry


def decode_uuid(value: Any) -> str:
    if not isinstance(value, str):
        raise LayoutError(f"expected an id string, got {type(value).__name__}")
    if len(value) == 36:
        return str(uuid.UUID(value))
    if len(value) == 22:
        raw = base64.urlsafe_b64decode(value + "==")
        if len(raw) != 16:
            raise LayoutError(f"id {value!r} does not decode to 16 bytes")
        return str(uuid.UUID(bytes=raw))
    raise LayoutError(f"id {value!r} is neither a UUID nor a 22-char base64url UUID")


def encode_uuid(value: str) -> str:
    return base64.urlsafe_b64encode(uuid.UUID(value).bytes).decode("ascii").rstrip("=")


def _pair(value: Any, name: str) -> tuple[float, float]:
    if not (isinstance(value, (list, tuple)) and len(value) == 2):
        raise LayoutError(f"g.{name} must be a pair")
    return (float(value[0]), float(value[1]))


def _require(obj: dict[str, Any], key: str, where: str) -> Any:
    if key not in obj:
        raise LayoutError(f"{where} is missing {key!r}")
    return obj[key]


def parse_geometry(g: Any) -> Geometry:
    if not isinstance(g, dict):
        raise LayoutError("g must be an object")
    fiducials = _require(g, "f", "g")
    if not (isinstance(fiducials, list) and len(fiducials) == 4):
        raise LayoutError("g.f must list four fiducial centres (TL, TR, BL, BR)")
    table = _pair(_require(g, "t", "g"), "t")
    geometry = Geometry(
        page=_pair(_require(g, "s", "g"), "s"),
        fiducials=tuple(_pair(f, "f[]") for f in fiducials),
        fiducial_size=float(_require(g, "fz", "g")),
        table_left=table[0],
        table_top=table[1],
        header_height=float(_require(g, "hh", "g")),
        row_height=float(_require(g, "rh", "g")),
        am=_pair(_require(g, "am", "g"), "am"),
        pm=_pair(_require(g, "pm", "g"), "pm"),
        name=_pair(g["nm"], "nm") if "nm" in g else None,
    )
    if geometry.row_height <= 0 or geometry.am[1] <= 0 or geometry.pm[1] <= 0:
        raise LayoutError("row height and column widths must be positive")
    return geometry


def parse_layout(payload: Any) -> T3Layout:
    """Parse a layout from a dict or its JSON text (the QR payload)."""
    if isinstance(payload, (str, bytes)):
        try:
            payload = json.loads(payload)
        except json.JSONDecodeError as error:
            raise LayoutError(f"layout is not JSON: {error.msg}") from error
    if not isinstance(payload, dict):
        raise LayoutError("layout must be a JSON object")
    version = _require(payload, "v", "layout")
    if version != LAYOUT_VERSION:
        raise LayoutError(f"unsupported layout version {version!r}")
    rows = _require(payload, "r", "layout")
    if not isinstance(rows, list):
        raise LayoutError("layout.r must be a list of participant ids")
    day = int(_require(payload, "d", "layout"))
    if day < 1:
        raise LayoutError("layout.d must be >= 1")
    return T3Layout(
        version=version,
        package_id=decode_uuid(_require(payload, "p", "layout")),
        day_index=day,
        page_index=int(payload.get("pg", 1)),
        page_count=int(payload.get("pc", 1)),
        participant_ids=tuple(decode_uuid(r) for r in rows),
        geometry=parse_geometry(_require(payload, "g", "layout")),
    )


def parse_layout_param(raw: str | None) -> list[T3Layout] | None:
    """The optional ``layout`` form field: one layout, or one per page."""
    if raw is None or raw.strip() == "":
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as error:
        raise LayoutError(f"layout is not JSON: {error.msg}") from error
    items = data if isinstance(data, list) else [data]
    if not items:
        raise LayoutError("layout list is empty")
    return [parse_layout(item) for item in items]
