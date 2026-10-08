"""Turn uploaded files into plain text that keeps their structure.

Page, slide and sheet markers ("[Page 3]", "[Slide 2]", "[Sheet Q1]") are kept so answers can say
where something came from; headings stay as Markdown headings and table rows become labelled
lines. Scanned PDFs (no text layer) are transcribed page by page by the vision model.
"""
import base64
import csv
import io
import json
import re
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from flask import current_app

TEXT = {".txt", ".md", ".log", ".xml", ".yaml", ".yml", ".ini", ".toml", ".sql", ".py", ".js", ".ts", ".tsx", ".jsx",
        ".java", ".c", ".cpp", ".h", ".cs", ".go", ".rs", ".rb", ".php", ".sh", ".css", ".kt", ".swift", ".r"}
SUPPORTED = {".pdf", ".docx", ".pptx", ".xlsx", ".csv", ".tsv", ".json", ".html", ".htm"} | TEXT
CODE_LANG = {".py": "python", ".js": "javascript", ".ts": "typescript", ".tsx": "tsx", ".jsx": "jsx", ".java": "java",
             ".c": "c", ".cpp": "cpp", ".h": "c", ".cs": "csharp", ".go": "go", ".rs": "rust", ".rb": "ruby",
             ".php": "php", ".sh": "bash", ".css": "css", ".kt": "kotlin", ".swift": "swift", ".r": "r", ".sql": "sql"}
# A PDF page with fewer characters than this is treated as scanned (image only).
_MIN_PAGE_TEXT = 40
_OCR_MAX_PAGES = 30


class UnsupportedFile(ValueError):
    pass


def extract_text(filename: str, data: bytes) -> str:
    ext = Path(filename).suffix.lower()
    if ext not in SUPPORTED:
        raise UnsupportedFile(
            f"{ext or 'This file type'} is not supported. Use PDF, Word, PowerPoint, Excel, CSV, HTML, JSON, text or code files."
        )
    if ext in CODE_LANG:
        # Code stays one fenced block per file so the model sees it as code, with line structure intact.
        return f"File {filename}:\n```{CODE_LANG[ext]}\n{_decode(data)}\n```"
    if ext in TEXT:
        return _decode(data)
    if ext == ".json":
        return json.dumps(json.loads(_decode(data)), indent=1, ensure_ascii=False)
    if ext in {".csv", ".tsv"}:
        return _rows_text(list(csv.reader(io.StringIO(_decode(data)), delimiter="\t" if ext == ".tsv" else ",")))
    if ext in {".html", ".htm"}:
        import trafilatura

        return trafilatura.extract(_decode(data), include_tables=True, include_formatting=True) or ""
    if ext == ".pdf":
        return _pdf(data)
    if ext == ".docx":
        return _docx(data)
    if ext == ".pptx":
        return _pptx(data)
    if ext == ".xlsx":
        return _xlsx(data)
    raise UnsupportedFile(ext)


def _decode(data: bytes) -> str:
    for enc in ("utf-8-sig", "utf-16"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("latin-1", errors="replace")


def _rows_text(rows: list[list], title: str = "") -> str:
    """Table rows as labelled lines ("Revenue: Q1 120, Q2 180") when there is a header row, so figures keep
    their meaning when a chunk is read on its own."""
    rows = [[("" if v is None else str(v)).strip() for v in r] for r in rows if any(str(v or "").strip() for v in r)]
    if not rows:
        return ""
    header = rows[0]
    labelled = len(rows) > 1 and all(h and not re.fullmatch(r"[\d.,%₹$€£ -]+", h) for h in header[1:] if h)
    out = [f"[{title}]"] if title else []
    out.append(" | ".join(header))
    for r in rows[1:]:
        if labelled:
            pairs = [f"{h} {v}".strip() for h, v in zip(header[1:], r[1:]) if v]
            out.append(f"{r[0]}: {', '.join(pairs)}" if r[0] else ", ".join(pairs))
        else:
            out.append(" | ".join(r))
    return "\n".join(out)


# --- PDF ---------------------------------------------------------------------

def _pdf(data: bytes) -> str:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    pages = [(p.extract_text() or "").strip() for p in reader.pages]
    scanned = [i for i, t in enumerate(pages) if len(t) < _MIN_PAGE_TEXT]
    # Mostly image pages: transcribe them with the vision model (capped; the rest keep their text layer).
    if scanned and len(scanned) >= max(1, len(pages) // 3):
        for i, text in _ocr_pages(data, scanned[:_OCR_MAX_PAGES]).items():
            pages[i] = text
    return "\n\n".join(f"[Page {i + 1}]\n{t}" for i, t in enumerate(pages) if t)


_OCR_PROMPT = """Transcribe this document page exactly. Keep reading order, headings (as Markdown #), lists, and tables (as Markdown tables).
Copy every number, date and name exactly as printed. Describe charts or diagrams in one line in [brackets]. Do not add, summarise or correct anything.
If the page is blank, reply with nothing."""


def _ocr_pages(data: bytes, indexes: list[int]) -> dict[int, str]:
    """Text of scanned PDF pages via the vision model, several pages in parallel. Empty on failure."""
    from . import llm

    try:
        import pypdfium2 as pdfium
    except ImportError:
        return {}
    pdf = pdfium.PdfDocument(data)
    images = {}
    for i in indexes:
        bitmap = pdf[i].render(scale=1.6).to_pil()
        buf = io.BytesIO()
        bitmap.convert("RGB").save(buf, "JPEG", quality=80)
        images[i] = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
    pdf.close()
    app = current_app._get_current_object()

    def one(i: int) -> tuple[int, str]:
        with app.app_context():
            try:
                text = llm.complete([{"role": "user", "content": [
                    {"type": "text", "text": _OCR_PROMPT},
                    {"type": "image_url", "image_url": {"url": images[i]}},
                ]}], mode="fast")
                return i, text.strip()
            except Exception:
                app.logger.exception("OCR failed for page %d", i + 1)
                return i, ""

    with ThreadPoolExecutor(max_workers=4) as pool:
        return dict(pool.map(one, images))


# --- Office ------------------------------------------------------------------

def _docx(data: bytes) -> str:
    from docx import Document

    doc = Document(io.BytesIO(data))
    out = []
    # Body order: paragraphs and tables interleaved as they appear in the document.
    for block in doc.element.body.iterchildren():
        tag = block.tag.rsplit("}", 1)[-1]
        if tag == "p":
            from docx.text.paragraph import Paragraph

            p = Paragraph(block, doc)
            text = p.text.strip()
            if not text:
                continue
            style = ((p.style.name if p.style is not None else "") or "").lower()
            level = re.search(r"heading (\d)", style)
            if level:
                out.append(f"{'#' * min(int(level.group(1)), 6)} {text}")
            elif style == "title":
                out.append(f"# {text}")
            elif "list" in style:
                out.append(f"- {text}")
            else:
                out.append(text)
        elif tag == "tbl":
            from docx.table import Table

            table = Table(block, doc)
            out.append(_rows_text([[c.text for c in row.cells] for row in table.rows]))
    return "\n\n".join(out)


def _pptx(data: bytes) -> str:
    from pptx import Presentation

    prs = Presentation(io.BytesIO(data))
    out = []
    for n, slide in enumerate(prs.slides, 1):
        parts = [f"[Slide {n}]"]
        for shape in slide.shapes:
            if shape.has_text_frame and shape.text_frame.text.strip():
                text = shape.text_frame.text.strip()
                parts.append(f"## {text}" if shape == getattr(slide.shapes, "title", None) else text)
            elif getattr(shape, "has_table", False) and shape.has_table:
                parts.append(_rows_text([[c.text for c in row.cells] for row in shape.table.rows]))
            elif getattr(shape, "has_chart", False) and shape.has_chart:
                try:
                    for plot in shape.chart.plots:
                        cats = [str(c) for c in plot.categories]
                        for s in plot.series:
                            vals = ", ".join(f"{c} {v}" for c, v in zip(cats, s.values))
                            parts.append(f"Chart series {s.name}: {vals}")
                except Exception:  # unusual chart types: keep the rest of the slide
                    parts.append("[Chart]")
        if slide.has_notes_slide and slide.notes_slide.notes_text_frame.text.strip():
            parts.append(f"Speaker notes: {slide.notes_slide.notes_text_frame.text.strip()}")
        out.append("\n".join(parts))
    return "\n\n".join(out)


def _xlsx(data: bytes) -> str:
    from openpyxl import load_workbook

    wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    return "\n\n".join(_rows_text(list(ws.iter_rows(values_only=True)), f"Sheet {ws.title}") for ws in wb.worksheets)


# --- Page numbers for chunks ---------------------------------------------------

_MARKER = re.compile(r"\[(?:Page|Slide) (\d+)\]")


def chunk_pages(chunks: list[str]) -> list[int | None]:
    """The page (or slide) each chunk starts on, from the markers kept in the text."""
    pages, current = [], None
    for chunk in chunks:
        m = _MARKER.search(chunk)
        # Text before the first marker is the overlap from the previous page.
        start = int(m.group(1)) if m and (current is None or m.start() < 40) else current
        pages.append(start)
        found = _MARKER.findall(chunk)
        current = int(found[-1]) if found else current
    return pages
