"""FastAPI surface of the extraction service.

Error contract (the Node client maps it; see src/server/extraction/client.ts):
  4xx  -> the service understood the request and refuses it (not a T3, no
          layout, unsupported media). A refusal: never retried.
  5xx / no answer -> transport failure; the caller retries with backoff.
Every 4xx body is ``{"detail": {"code": ..., "message": ...}}``.
"""

from __future__ import annotations

import json
import os

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import Response

from . import __version__, ocr
from . import grant_letter as G
from . import layout as L
from . import t3
from .imaging import UnsupportedMedia, decode_image, is_pdf, load_pages, pymupdf_available, rasterise_pdf

MAX_UPLOAD_BYTES = 30 * 1024 * 1024

app = FastAPI(title="Agentic TPMS extraction service", version=__version__)


def dev_enabled() -> bool:
    return os.environ.get("TPMS_OCR_DEV") == "1"


def refuse(status: int, code: str, message: str, **extra) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message, **extra})


def read_upload(file: UploadFile) -> bytes:
    data = file.file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise refuse(413, "UPLOAD_TOO_LARGE", f"uploads are limited to {MAX_UPLOAD_BYTES // (1024 * 1024)} MB")
    if not data:
        raise refuse(422, "EMPTY_UPLOAD", "the uploaded file is empty")
    return data


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "version": __version__,
        "engines": {"template_grid": True, "pymupdf": pymupdf_available(), "paddleocr": ocr.available()},
        "paddleocrStatus": ocr.status(),
        "dev": dev_enabled(),
    }


@app.post("/v1/t3/parse")
def parse_t3(file: UploadFile = File(...), layout: str | None = Form(None)) -> dict:
    data = read_upload(file)
    try:
        layouts = L.parse_layout_param(layout)
    except L.LayoutError as error:
        raise refuse(422, "LAYOUT_INVALID", str(error)) from error
    try:
        pages, source = load_pages(data)
    except UnsupportedMedia as error:
        raise refuse(415, "UNSUPPORTED_MEDIA", str(error)) from error

    name_reader = ocr.read_name if ocr.available() else None
    results = t3.parse_document(pages, layouts, name_reader)
    if not any(r.layout for r in results):
        raise refuse(
            422,
            "LAYOUT_UNRESOLVED",
            "no page carried a readable T3 layout QR code (is this one of our generated Form T3 sheets?)",
            pages=[{"pageIndex": r.page_index, "warnings": r.warnings} for r in results],
        )
    return {
        "engine": "template_grid+paddleocr" if name_reader else "template_grid",
        "source": source,
        "dpi": t3.RASTER_DPI,
        "thresholds": {
            "signed": t3.THRESHOLD,
            "ambiguousLow": t3.AMBIGUOUS_LOW,
            "ambiguousHigh": t3.AMBIGUOUS_HIGH,
            "reviewConfidence": t3.REVIEW_CONFIDENCE,
        },
        "pages": [r.as_json() for r in results],
    }


@app.post("/v1/grant-letter/extract")
def extract_grant_letter(file: UploadFile = File(...)) -> dict:
    data = read_upload(file)
    warnings: list[str] = []
    page_count = 1
    if is_pdf(data):
        if not pymupdf_available():
            raise refuse(415, "UNSUPPORTED_MEDIA", "PDF input needs PyMuPDF, which is not installed")
        text, page_count = G.pdf_text(data)
        engine = "pymupdf"
        if len(text.strip()) < 20:
            warnings.append("NO_TEXT_LAYER")
            if ocr.available():
                texts = [ocr.recognise(page) or "" for page in rasterise_pdf(data)]
                text, engine = "\n".join(texts), "paddleocr"
            else:
                text, engine = "", "none"
    elif (file.content_type or "").startswith("text/"):
        try:
            text, engine = data.decode("utf-8"), "text"
        except UnicodeDecodeError as error:
            raise refuse(415, "UNSUPPORTED_MEDIA", "text upload is not UTF-8") from error
    else:
        try:
            image = decode_image(data, color=True)
        except UnsupportedMedia as error:
            raise refuse(415, "UNSUPPORTED_MEDIA", str(error)) from error
        recognised = ocr.recognise(image) if ocr.available() else None
        if recognised is None:
            text, engine = "", "none"
            warnings.append("OCR_ENGINE_UNAVAILABLE")
        else:
            text, engine = recognised, "paddleocr"

    fields = G.extract_fields(text) if text.strip() else {k: G.Field(None, 0.0) for k in G.WEIGHTS}
    return {
        "engine": engine,
        "text": text,
        "pageCount": page_count,
        "fields": {k: f.as_json() for k, f in fields.items()},
        "confidence": G.overall_confidence(fields),
        "warnings": warnings,
    }


@app.post("/v1/dev/synthesize-t3")
def synthesize_t3(file: UploadFile = File(...), spec: str = Form("{}"), layout: str | None = Form(None)) -> Response:
    if not dev_enabled():
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "dev endpoints are disabled"})
    from .synth import SynthError, SynthSpec, synthesize

    data = read_upload(file)
    if not is_pdf(data):
        raise refuse(415, "UNSUPPORTED_MEDIA", "synthesize-t3 takes one of our template PDFs")
    try:
        parsed = SynthSpec.from_json(json.loads(spec or "{}"))
        layouts = L.parse_layout_param(layout)
        chosen = layouts[parsed.page - 1] if layouts and parsed.page - 1 < len(layouts) else None
        png = synthesize(data, parsed, chosen)
    except (SynthError, L.LayoutError, json.JSONDecodeError, ValueError) as error:
        raise refuse(422, "SYNTH_INVALID", str(error)) from error
    return Response(content=png, media_type="image/png")
