"""e-TRiS approval letter field extraction (English, Malay, OCR-ish)."""

import pymupdf
import pytest

from app import grant_letter as G

ENGLISH = """PEMBANGUNAN SUMBER MANUSIA BERHAD (HRD CORP)
Date: 25/09/2026
Our Ref: HRDC/SBL-KHAS/2026/0915

KENANGA RETAIL GROUP BERHAD
Level 12, Menara Kenanga, Kuala Lumpur

GRANT APPROVAL - SBL-KHAS SCHEME
Employer: Kenanga Retail Group Berhad
MyCoID: 123456-A
Grant ID: ETRIS-2026-001234
Programme Title: Leading Through Change
Training Provider: Alex Training Sdn Bhd
Training Date: 20/10/2026 to 21/10/2026
No. of Trainees: 20
Approved Amount: RM 16,000.00
"""

MALAY = """Tarikh: 3 Oktober 2026
No. Rujukan Geran: SBLK/2026/88731
Nama Majikan: Syarikat Maju Jaya Sdn. Bhd.
Tajuk Latihan: Kemahiran Komunikasi Berkesan
Tarikh Latihan: 12 November 2026 hingga 14 November 2026
Bilangan Peserta: 25
Jumlah Diluluskan: RM 21,375.00
"""

OCR_ISH = """Application No. : 2026-APP-00917
Company : PERSADA LOGISTICS SDN BHD
Course Date 5 Jan 2027 - 6 Jan 2027
Pax 12
Total Grant Value
RM 9,600.00
Training fee (per pax) RM 800.00
"""


def values(text):
    return {k: f.value for k, f in G.extract_fields(text).items()}


def test_english_letter():
    fields = G.extract_fields(ENGLISH)
    assert values(ENGLISH) == {
        "grantId": "ETRIS-2026-001234",
        "approvedPax": 20,
        "approvedAmount": "16000.00",
        "startDate": "2026-10-20",
        "endDate": "2026-10-21",
        "employerName": "Kenanga Retail Group Berhad",
    }
    assert fields["grantId"].confidence >= 0.9
    assert G.overall_confidence(fields) >= 0.85


def test_malay_letter():
    assert values(MALAY) == {
        "grantId": "SBLK/2026/88731",
        "approvedPax": 25,
        "approvedAmount": "21375.00",
        "startDate": "2026-11-12",
        "endDate": "2026-11-14",
        "employerName": "Syarikat Maju Jaya Sdn. Bhd.",
    }


def test_ocr_ish_layout_prefers_labelled_amount():
    fields = G.extract_fields(OCR_ISH)
    assert values(OCR_ISH) == {
        "grantId": "2026-APP-00917",
        "approvedPax": 12,
        "approvedAmount": "9600.00",
        "startDate": "2027-01-05",
        "endDate": "2027-01-06",
        "employerName": "PERSADA LOGISTICS SDN BHD",
    }
    assert fields["grantId"].confidence < fields["employerName"].confidence + 0.1  # application no < grant id


def test_missing_fields_score_zero_and_placeholders_are_not_refs():
    fields = G.extract_fields("Grant No: PENDING\nThank you for your application.")
    assert fields["grantId"].value is None and fields["grantId"].confidence == 0
    assert G.overall_confidence(fields) == 0


def test_unlabelled_dates_fall_back_with_low_confidence():
    fields = G.extract_fields("Date: 01/09/2026\nThe programme runs 7 Oct 2026 and 8 Oct 2026.")
    assert (fields["startDate"].value, fields["endDate"].value) == ("2026-10-07", "2026-10-08")
    assert fields["startDate"].confidence < 0.5


def test_pdf_endpoint(client):
    doc = pymupdf.open()
    page = doc.new_page()
    y = 72
    for line in ENGLISH.splitlines():
        page.insert_text((56, y), line, fontsize=10)
        y += 14
    pdf = doc.tobytes()
    body = client.post("/v1/grant-letter/extract", files={"file": ("letter.pdf", pdf, "application/pdf")}).json()
    assert body["engine"] == "pymupdf"
    assert body["fields"]["grantId"]["value"] == "ETRIS-2026-001234"
    assert body["fields"]["approvedAmount"]["value"] == "16000.00"
    assert body["confidence"] >= 0.85


def test_image_without_ocr_engine_returns_engine_none(client, monkeypatch):
    import cv2
    import numpy as np

    from app import ocr

    monkeypatch.setattr(ocr, "available", lambda: False)
    png = cv2.imencode(".png", np.full((200, 300, 3), 255, np.uint8))[1].tobytes()
    body = client.post("/v1/grant-letter/extract", files={"file": ("letter.png", png, "image/png")}).json()
    assert body["engine"] == "none" and body["text"] == "" and body["confidence"] == 0
    assert "OCR_ENGINE_UNAVAILABLE" in body["warnings"]


def test_date_parser_rejects_impossible_dates():
    assert G.parse_date("31/02/2026") is None
    assert G.parse_date("2 Mei 2026").isoformat() == "2026-05-02"
    assert G.parse_date("15th August, 2026").isoformat() == "2026-08-15"
