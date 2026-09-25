"""e-TRiS grant approval letter extraction.

Text comes from PyMuPDF for text PDFs, and from PaddleOCR for images and
scanned PDFs when it is installed (otherwise the engine is ``none`` and the
text is empty — the operator keys the fields by hand). The fields are pulled
with tolerant, label-anchored regexes over English and Malay wording.

Every field carries its own confidence: a value found right after its label
scores high, a value inferred from context (the only RM amount on the page,
the earliest and latest dates) scores low, and nothing found scores 0. The
server never auto-approves a grant from this; it pre-fills a form a human
verifies (GRANT_VERIFICATION gate).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date

MONTHS = {
    "jan": 1, "january": 1, "januari": 1,
    "feb": 2, "february": 2, "februari": 2,
    "mar": 3, "march": 3, "mac": 3,
    "apr": 4, "april": 4,
    "may": 5, "mei": 5,
    "jun": 6, "june": 6,
    "jul": 7, "july": 7, "julai": 7,
    "aug": 8, "august": 8, "ogos": 8, "ogo": 8,
    "sep": 9, "sept": 9, "september": 9,
    "oct": 10, "october": 10, "okt": 10, "oktober": 10,
    "nov": 11, "november": 11,
    "dec": 12, "december": 12, "dis": 12, "disember": 12,
}
_MONTH_ALT = "|".join(sorted(MONTHS, key=len, reverse=True))

DATE_PATTERN = (
    r"(?:\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4}"
    r"|\d{4}-\d{2}-\d{2}"
    rf"|\d{{1,2}}(?:st|nd|rd|th)?\s+(?:{_MONTH_ALT})\.?,?\s+\d{{4}})"
)
DATE_RE = re.compile(DATE_PATTERN, re.IGNORECASE)

GRANT_LABELS = [
    (r"grant\s*(?:id|no\.?|number|ref(?:erence)?(?:\s*no\.?)?)", 0.95),
    (r"(?:no\.?\s*)?rujukan\s*geran|no\.?\s*geran", 0.9),
    (r"application\s*(?:no\.?|number|id|ref(?:erence)?)", 0.8),
    (r"no\.?\s*rujukan|rujukan\s*(?:kami|tuan)?|our\s*ref(?:erence)?|reference\s*(?:no\.?|number)", 0.7),
]
GRANT_VALUE = r"[:：.#\-]?\s*([A-Z0-9][A-Z0-9/\-]{4,63})"
GRANT_SHAPE = re.compile(r"^[A-Z0-9][A-Z0-9/-]{5,63}$")

PAX_RE = re.compile(
    r"(?:no\.?\s*of\s*(?:trainees|participants|pax|pelatih|peserta)"
    r"|number\s*of\s*(?:trainees|participants)"
    r"|bilangan\s*(?:peserta|pelatih)"
    r"|approved\s*(?:pax|trainees|participants)"
    r"|total\s*(?:pax|trainees|participants)"
    r"|pax)\s*(?:approved)?\s*[:：]?\s*(\d{1,4})\b",
    re.IGNORECASE,
)

AMOUNT_RE = re.compile(r"\bRM\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\.([0-9]{2}))?\b", re.IGNORECASE)
AMOUNT_LABEL_RE = re.compile(
    r"approved|amount|jumlah|diluluskan|financial\s*assistance|grant\s*value|total\s*grant|nilai\s*geran|allocation|peruntukan",
    re.IGNORECASE,
)

RANGE_RE = re.compile(
    rf"(?:training\s*(?:date|period|dates)|tarikh\s*(?:latihan|kursus)|programme\s*date|course\s*date|date\s*of\s*training)s?"
    rf"\s*[:：]?\s*(?:from\s*)?({DATE_PATTERN})\s*(?:to|until|till|hingga|sehingga|-|–|—)\s*({DATE_PATTERN})",
    re.IGNORECASE,
)
SINGLE_TRAINING_DATE_RE = re.compile(
    rf"(?:training\s*(?:date|period)|tarikh\s*(?:latihan|kursus))\s*[:：]?\s*({DATE_PATTERN})",
    re.IGNORECASE,
)
LETTER_DATE_RE = re.compile(rf"^\s*(?:date|tarikh)\s*[:：]\s*({DATE_PATTERN})", re.IGNORECASE | re.MULTILINE)

EMPLOYER_RE = re.compile(
    r"^\s*(?:employer(?:'s)?\s*name|employer|company\s*name|company|nama\s*majikan|majikan|nama\s*syarikat|syarikat)\s*[:：]\s*(.+?)\s*$",
    re.IGNORECASE | re.MULTILINE,
)
COMPANY_LINE_RE = re.compile(r"^\s*([A-Z0-9][A-Za-z0-9&.,'()\- ]{2,120}?\b(?:Sdn\.?\s*Bhd\.?|Berhad|Bhd\.?|PLT))\s*$", re.MULTILINE)

WEIGHTS = {"grantId": 0.3, "approvedAmount": 0.25, "startDate": 0.1, "endDate": 0.1, "approvedPax": 0.15, "employerName": 0.1}


@dataclass
class Field:
    value: object | None
    confidence: float

    def as_json(self) -> dict:
        return {"value": self.value, "confidence": round(self.confidence, 3)}


def parse_date(text: str) -> date | None:
    text = text.strip().rstrip(".,")
    m = re.fullmatch(r"(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})", text)
    try:
        if m:
            return date(int(m.group(3)), int(m.group(2)), int(m.group(1)))  # Malaysian day-first
        m = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", text)
        if m:
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        m = re.fullmatch(rf"(\d{{1,2}})(?:st|nd|rd|th)?\s+({_MONTH_ALT})\.?,?\s+(\d{{4}})", text, re.IGNORECASE)
        if m:
            return date(int(m.group(3)), MONTHS[m.group(2).lower()], int(m.group(1)))
    except ValueError:
        return None
    return None


def extract_grant_id(text: str) -> Field:
    for label, confidence in GRANT_LABELS:
        for m in re.finditer(rf"(?:{label})\s*{GRANT_VALUE}", text, re.IGNORECASE):
            value = m.group(1).upper().rstrip("-/")
            if not re.search(r"\d", value):
                continue  # "Grant No: PENDING" is not a reference
            return Field(value, confidence if GRANT_SHAPE.match(value) else confidence * 0.5)
    return Field(None, 0.0)


def extract_pax(text: str) -> Field:
    m = PAX_RE.search(text)
    if m:
        n = int(m.group(1))
        if 1 <= n <= 1000:
            return Field(n, 0.9)
    return Field(None, 0.0)


def _amount(m: re.Match) -> str:
    whole = m.group(1).replace(",", "")
    return f"{int(whole)}.{m.group(2) or '00'}"


def extract_amount(text: str) -> Field:
    matches = list(AMOUNT_RE.finditer(text))
    if not matches:
        return Field(None, 0.0)
    scored = []
    for m in matches:
        line_start = text.rfind("\n", 0, m.start()) + 1
        before = text[max(line_start, m.start() - 80): m.start()]
        prev_line_start = text.rfind("\n", 0, max(line_start - 1, 0)) + 1
        previous_line = text[prev_line_start:line_start]
        if AMOUNT_LABEL_RE.search(before):
            score = 0.9
        elif AMOUNT_LABEL_RE.search(previous_line):
            score = 0.75
        else:
            score = 0.0
        scored.append((score, float(_amount(m)), m))
    best = max(scored, key=lambda s: (s[0], s[1]))
    if best[0] > 0:
        return Field(_amount(best[2]), best[0])
    if len(matches) == 1:
        return Field(_amount(matches[0]), 0.55)
    return Field(_amount(best[2]), 0.35)  # the largest unlabelled amount


def extract_dates(text: str) -> tuple[Field, Field]:
    m = RANGE_RE.search(text)
    if m:
        start, end = parse_date(m.group(1)), parse_date(m.group(2))
        if start and end and start <= end:
            return Field(start.isoformat(), 0.9), Field(end.isoformat(), 0.9)
    m = SINGLE_TRAINING_DATE_RE.search(text)
    if m:
        single = parse_date(m.group(1))
        if single:
            return Field(single.isoformat(), 0.8), Field(single.isoformat(), 0.6)
    # Fallback: every date on the page except the letter's own date.
    letter = LETTER_DATE_RE.search(text)
    letter_date = parse_date(letter.group(1)) if letter else None
    found = sorted({d for d in (parse_date(x.group(0)) for x in DATE_RE.finditer(text)) if d and d != letter_date})
    if len(found) >= 2:
        return Field(found[0].isoformat(), 0.4), Field(found[-1].isoformat(), 0.4)
    if len(found) == 1:
        return Field(found[0].isoformat(), 0.3), Field(found[0].isoformat(), 0.2)
    return Field(None, 0.0), Field(None, 0.0)


def extract_employer(text: str) -> Field:
    m = EMPLOYER_RE.search(text)
    if m:
        value = re.sub(r"\s{2,}", " ", m.group(1)).strip(" ,;:")
        if value:
            return Field(value[:255], 0.85)
    m = COMPANY_LINE_RE.search(text)
    if m:
        return Field(m.group(1).strip(), 0.45)
    return Field(None, 0.0)


def extract_fields(text: str) -> dict[str, Field]:
    start, end = extract_dates(text)
    return {
        "grantId": extract_grant_id(text),
        "approvedPax": extract_pax(text),
        "approvedAmount": extract_amount(text),
        "startDate": start,
        "endDate": end,
        "employerName": extract_employer(text),
    }


def overall_confidence(fields: dict[str, Field]) -> float:
    return round(sum(WEIGHTS[k] * fields[k].confidence for k in WEIGHTS), 3)


def pdf_text(data: bytes) -> tuple[str, int]:
    import pymupdf as fitz

    with fitz.open(stream=data, filetype="pdf") as doc:
        return "\n".join(page.get_text("text") for page in doc), doc.page_count
