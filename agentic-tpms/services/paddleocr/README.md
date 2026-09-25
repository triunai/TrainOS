# Extraction service (Level 2)

FastAPI microservice behind `src/server/extraction/client.ts`. It reads
**our own** Form T3 attendance sheets back from scans, and pulls the fields
out of HRD Corp e-TRiS grant approval letters. Port **8866**.

| Endpoint | What it does |
| --- | --- |
| `GET /health` | `{status, version, engines:{template_grid, pymupdf, paddleocr}, paddleocrStatus, dev}` |
| `POST /v1/t3/parse` | multipart `file` (PDF or image), optional `layout` (JSON, one object or one per page) → per-page AM/PM readings |
| `POST /v1/grant-letter/extract` | multipart `file` (text PDF, image, or `text/*`) → fields with per-field and overall confidence |
| `POST /v1/dev/synthesize-t3` | **only with `TPMS_OCR_DEV=1`**: template PDF + `spec` JSON → synthetic PNG "scan" |

Errors: a `4xx` body is always `{"detail": {"code", "message"}}` — the Node
client turns it into `DomainError("EXTRACTION_REJECTED")` (never retried).
No answer, a timeout or a `5xx` is transport trouble and is retried.

## How a T3 is read (primary engine: `template_grid`)

We generate the sheet (`src/server/attendance/t3Template.ts`), so the engine
never has to find a table — it registers a known page:

1. **Fiducials.** Four solid black 20 pt squares at fixed page positions.
   Found as dark contours that are square, solid (fill ≥ 0.82, convex) and
   nearest each image corner. QR finder patterns are hollow and rejected.
2. **Layout QR.** Each page carries a QR with compact JSON v1 — package,
   day, page `pg`/`pc`, participant ids in row order (UUIDs as 22-char
   base64url), and the grid geometry in PDF points, top-left origin (see
   `app/layout.py`, the other half of the contract). Decoded from a
   straightened, upscaled crop first, then the raw scan.
3. **Warp** the scan onto the canonical page (points × 200/72) with the
   perspective transform fiducials → layout fiducial centres.
4. **Cells.** Each AM/PM signature cell is cropped with an inset (4 % x,
   16 % y) so ruling lines stay out; ink = adaptive threshold AND absolutely
   dark relative to the cell's paper; long horizontal/vertical runs (a ruling
   line pulled in by misregistration) are removed; specks are opened away.
5. **Decision.** `signed = inkRatio ≥ 0.02`. Confidence is 0.5 at the
   threshold and rises linearly to 1.0; the slopes put the ambiguous band
   `[0.01, 0.04]` strictly below **0.75**, the server's review threshold, so a
   stray mark always reaches a human. A page registered without fiducials
   (edge-to-edge render) is capped at 0.6 — all to review.

Measured on synthesized scans of the real template (8 seeds × 5 distortions,
±3° rotation, up to 2 % perspective, blur σ 1.0, noise σ 3 %):
signed cells `inkRatio ≥ 0.059`, blank cells `0.000`, faint marks ≈ `0.021`,
zero QR failures. Real pens are thinner than the synthetic strokes; a light
signature falls into the band and is reviewed rather than guessed.

PDF input is rasterised with PyMuPDF at 200 dpi.

## Grant letters

Text comes from PyMuPDF for text PDFs; for images and scanned PDFs from
PaddleOCR when it is installed, otherwise `engine: "none"` with empty text
(the operator keys the fields). Tolerant, label-anchored regexes (English
and Malay): grant/application reference (`Grant ID`, `Grant No`,
`Application No`, `No. Rujukan Geran`, `Our Ref`…), approved pax
(`No. of Trainees: 20`, `Bilangan Peserta`), approved amount (the `RM` figure
labelled Approved/Amount/Jumlah/Grant Value, same or previous line), dates
(`dd/mm/yyyy`, `d MMM yyyy` incl. Malay months, `yyyy-mm-dd`; a
`Training Date: … to/hingga …` range scores 0.9, unlabelled dates 0.4) and
employer (`Employer:`/`Company:`/`Nama Majikan:`; a bare `… Sdn Bhd` line
scores 0.45). Overall confidence is a weighted mean.

## PaddleOCR (optional, secondary)

`requirements-paddle.txt`, or `docker build --build-arg WITH_PADDLE=1`. Used
only for printed-name cross-check warnings on T3 rows and for image letters.
It pulls `opencv-contrib-python`, which collides with the base
`opencv-python-headless` (both ship `cv2`); the Dockerfile leaves exactly one.
Models download on first use from HuggingFace / ModelScope / AIStudio / BOS —
on a host that cannot reach them, initialisation fails once, is logged, and
`/health` reports `paddleocr: false` with `paddleocrStatus: "failed: …"`.
`TPMS_OCR_PADDLE=0` disables it outright.

## Local development

```bash
python3.11 -m venv services/paddleocr/.venv
services/paddleocr/.venv/bin/pip install -r services/paddleocr/requirements.txt
cd services/paddleocr
TPMS_OCR_DEV=1 .venv/bin/uvicorn app.main:app --port 8866
.venv/bin/python -m pytest -q
```

The Node integration tests (`tests/integration/attendance-t3.test.ts`,
`extraction-grant-letter.test.ts`) start and stop uvicorn from this venv
themselves, and skip with a message when the venv is missing.

Fixtures: `tests/fixtures/sample-template-{6,15,20}.pdf` are rendered by the
real Node renderer — regenerate with `npx tsx tests/fixtures/t3/generate-sample.ts`
after any geometry change. Session-photo EXIF fixtures for the Node tests:
`.venv/bin/python scripts/make_photo_fixtures.py`.
