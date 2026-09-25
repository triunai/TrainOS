"""Form T3 grid engine: registration, QR layout, and signed/blank accuracy
on synthesized scans of the REAL template (rendered by t3Template.ts)."""

import json
from pathlib import Path

import cv2
import numpy as np
import pytest

from app import layout as L
from app import t3
from app.imaging import decode_image, rasterise_pdf
from app.synth import SynthSpec, synthesize

SAMPLE_PACKAGE = "0b5e8f3e-2a41-4d7c-9a51-7c1f00d3a001"

SIGNED = [(r, "AM") for r in range(0, 15, 2)] + [(r, "PM") for r in (1, 3, 5, 8, 13, 14)]
FAINT = [(5, "AM"), (10, "PM")]


def _read(png: bytes) -> t3.PageResult:
    return t3.read_page(decode_image(png), 1)


def _assert_accuracy(result: t3.PageResult, signed, faint) -> None:
    assert result.layout is not None, result.warnings
    assert result.registration == "fiducials"
    for row in result.rows:
        for session, key in (("AM", "am"), ("PM", "pm")):
            cell = row[key]
            slot = (row["rowIndex"], session)
            if slot in faint:
                # A stray mark must never be decided silently either way.
                assert cell["confidence"] < t3.REVIEW_CONFIDENCE, (slot, cell)
            elif slot in signed:
                assert cell["signed"] is True, (slot, cell)
                assert cell["confidence"] >= t3.REVIEW_CONFIDENCE, (slot, cell)
            else:
                assert cell["signed"] is False, (slot, cell)
                assert cell["confidence"] >= t3.REVIEW_CONFIDENCE, (slot, cell)


# ------------------------------------------------------------------ classifier


def test_ambiguous_band_always_goes_to_review():
    for ratio in np.linspace(t3.AMBIGUOUS_LOW + 1e-6, t3.AMBIGUOUS_HIGH - 1e-6, 50):
        assert t3.classify(float(ratio)).confidence < t3.REVIEW_CONFIDENCE
    for ratio in (0.0, 0.004, t3.AMBIGUOUS_LOW - 1e-4, t3.AMBIGUOUS_HIGH + 1e-4, 0.08, 0.3):
        assert t3.classify(ratio).confidence >= t3.REVIEW_CONFIDENCE
    assert t3.classify(0.0).confidence == pytest.approx(1.0)
    assert t3.classify(t3.THRESHOLD).confidence == pytest.approx(0.5)
    assert t3.classify(0.05, cap=t3.UNREGISTERED_CONFIDENCE_CAP).confidence <= t3.UNREGISTERED_CONFIDENCE_CAP


# ------------------------------------------------------------------ layout


def test_layout_round_trip_and_rejects_unknown_version():
    compact = L.encode_uuid(SAMPLE_PACKAGE)
    assert len(compact) == 22
    assert L.decode_uuid(compact) == SAMPLE_PACKAGE
    assert L.decode_uuid(SAMPLE_PACKAGE.upper()) == SAMPLE_PACKAGE
    page = rasterise_pdf((Path(__file__).parent / "fixtures" / "sample-template-6.pdf").read_bytes())[0]
    layout, _ = t3.read_layout_from_qr(page, t3.find_fiducials(page))
    assert layout is not None
    payload = json.loads(t3.layout_json(layout))
    assert L.parse_layout(payload) == layout
    payload["v"] = 2
    with pytest.raises(L.LayoutError, match="unsupported layout version"):
        L.parse_layout(payload)
    with pytest.raises(L.LayoutError):
        L.parse_layout({"v": 1, "p": compact, "d": 1, "r": []})  # no geometry


# ------------------------------------------------------------------ clean template


def test_clean_template_pdf_reads_every_cell_blank(template_15):
    [page] = rasterise_pdf(template_15)
    result = t3.read_page(page, 1)
    assert result.layout.package_id == SAMPLE_PACKAGE
    assert result.layout.day_index == 1
    assert len(result.rows) == 15
    assert all(not r[k]["signed"] and r[k]["confidence"] == pytest.approx(1.0) for r in result.rows for k in ("am", "pm"))


def test_multi_page_template_carries_per_page_layout(template_20):
    pages = rasterise_pdf(template_20)
    results = t3.parse_document(pages)
    assert [len(r.rows) for r in results] == [15, 5]
    assert [(r.layout.page_index, r.layout.page_count) for r in results] == [(1, 2), (2, 2)]
    ids = [row["participantId"] for r in results for row in r.rows]
    assert len(set(ids)) == 20


# ------------------------------------------------------------------ synthesized scans


@pytest.mark.parametrize(
    "rotate,perspective,seed",
    [(0.0, 0.0, 1), (3.0, 0.0, 2), (-3.0, 0.0, 3), (1.5, 0.015, 4), (-2.0, 0.02, 5), (2.5, 0.01, 6)],
)
def test_detection_accuracy_on_synthesized_scans(template_15, rotate, perspective, seed):
    spec = SynthSpec(signed=SIGNED, faint=FAINT, rotate_deg=rotate, perspective=perspective, noise=0.03, blur=1.0, seed=seed)
    _assert_accuracy(_read(synthesize(template_15, spec)), SIGNED, FAINT)


def test_heavier_noise_and_blur_still_separates(template_15):
    spec = SynthSpec(signed=SIGNED, faint=[], rotate_deg=-1.0, perspective=0.01, noise=0.05, blur=1.6, seed=11)
    _assert_accuracy(_read(synthesize(template_15, spec)), SIGNED, [])


def test_jpeg_compressed_scan(template_15):
    spec = SynthSpec(signed=SIGNED, faint=[], rotate_deg=2.0, noise=0.02, seed=12)
    img = decode_image(synthesize(template_15, spec), color=True)
    ok, jpg = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 70])
    assert ok
    _assert_accuracy(_read(jpg.tobytes()), SIGNED, [])


def test_dim_phone_like_scan_uses_the_otsu_fallback(template_15):
    spec = SynthSpec(signed=SIGNED, faint=[], rotate_deg=1.0, noise=0.02, seed=13)
    dim = np.clip(decode_image(synthesize(template_15, spec)).astype(np.float32) * 0.5 + 5, 0, 255).astype(np.uint8)
    result = t3.read_page(dim, 1)
    _assert_accuracy(result, SIGNED, [])


def test_page_without_fiducials_or_qr_is_unresolved():
    blank = np.full((1654, 2339), 250, np.uint8)
    result = t3.read_page(blank, 1)
    assert result.layout is None
    assert "FIDUCIALS_NOT_FOUND" in result.warnings and "QR_NOT_DECODED" in result.warnings


def test_supplied_layout_without_fiducials_is_capped_below_review(template_15):
    [page] = rasterise_pdf(template_15)
    layout, _ = t3.read_layout_from_qr(page, t3.find_fiducials(page))
    # Paint over the fiducials: the page is still edge-to-edge, so the
    # fallback registers it, but nothing it reads may skip human review.
    for x, y in layout.geometry.fiducials:
        c = (int(x * t3.SCALE), int(y * t3.SCALE))
        cv2.rectangle(page, (c[0] - 40, c[1] - 40), (c[0] + 40, c[1] + 40), 255, -1)
    result = t3.read_page(page, 1, supplied=layout)
    assert result.registration == "full_page"
    assert "FIDUCIALS_NOT_FOUND" in result.warnings
    assert all(r[k]["confidence"] <= t3.UNREGISTERED_CONFIDENCE_CAP for r in result.rows for k in ("am", "pm"))


# ------------------------------------------------------------------ HTTP surface


def test_health(client):
    body = client.get("/health").json()
    assert body["status"] == "ok"
    assert body["engines"]["template_grid"] is True
    assert body["engines"]["pymupdf"] is True
    assert isinstance(body["engines"]["paddleocr"], bool)


def test_parse_endpoint_on_synthesized_png(client, template_15):
    png = client.post(
        "/v1/dev/synthesize-t3",
        files={"file": ("t3.pdf", template_15, "application/pdf")},
        data={"spec": json.dumps({"signed": [[r, s] for r, s in SIGNED], "faint": [[r, s] for r, s in FAINT], "rotateDeg": 2, "noise": 0.03, "seed": 3})},
    )
    assert png.status_code == 200 and png.headers["content-type"] == "image/png"
    response = client.post("/v1/t3/parse", files={"file": ("scan.png", png.content, "image/png")})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["engine"].startswith("template_grid")
    [page] = body["pages"]
    assert page["packageId"] == SAMPLE_PACKAGE and page["dayIndex"] == 1 and page["layoutSource"] == "qr"
    signed = {(r["rowIndex"], s) for r in page["rows"] for s, k in (("AM", "am"), ("PM", "pm")) if r[k]["signed"] and r[k]["confidence"] >= 0.75}
    assert signed == set(SIGNED)


def test_parse_endpoint_accepts_layout_param(client, template_15):
    [page] = rasterise_pdf(template_15)
    layout, _ = t3.read_layout_from_qr(page, t3.find_fiducials(page))
    response = client.post(
        "/v1/t3/parse",
        files={"file": ("t3.pdf", template_15, "application/pdf")},
        data={"layout": t3.layout_json(layout)},
    )
    assert response.status_code == 200
    assert response.json()["pages"][0]["layoutSource"] == "param"
    bad = client.post("/v1/t3/parse", files={"file": ("t3.pdf", template_15, "application/pdf")}, data={"layout": '{"v":9}'})
    assert bad.status_code == 422 and bad.json()["detail"]["code"] == "LAYOUT_INVALID"


def test_parse_endpoint_refusals(client):
    blank = cv2.imencode(".png", np.full((800, 1100), 255, np.uint8))[1].tobytes()
    response = client.post("/v1/t3/parse", files={"file": ("blank.png", blank, "image/png")})
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "LAYOUT_UNRESOLVED"
    junk = client.post("/v1/t3/parse", files={"file": ("x.bin", b"not an image", "application/octet-stream")})
    assert junk.status_code == 415 and junk.json()["detail"]["code"] == "UNSUPPORTED_MEDIA"


def test_synthesize_is_dev_only(monkeypatch, template_15):
    from fastapi.testclient import TestClient

    from app.main import app

    monkeypatch.delenv("TPMS_OCR_DEV", raising=False)
    response = TestClient(app).post("/v1/dev/synthesize-t3", files={"file": ("t3.pdf", template_15, "application/pdf")})
    assert response.status_code == 404
