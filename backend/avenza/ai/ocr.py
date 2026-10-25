"""Local text recognition for images and scanned PDF pages (RapidOCR on ONNX Runtime, CPU, no API).

GPT-2 reads text only, so an attached image is turned into its printed text first: words are
detected, read, and put back into reading order (top to bottom, left to right on each line).
"""
import base64
import io
import threading

_lock = threading.Lock()
_engine = None


def _get():
    global _engine
    with _lock:
        if _engine is None:
            from rapidocr_onnxruntime import RapidOCR

            _engine = RapidOCR()
        return _engine


def warm_up() -> None:
    _get()


def read_image(data: bytes, min_score: float = 0.5) -> str:
    """Printed text of an image, one line per text row. Empty if none was found."""
    result, _ = _get()(data)
    boxes = []
    for box, text, score in result or []:
        if float(score) < min_score or not text.strip():
            continue
        ys = [p[1] for p in box]
        boxes.append({"top": min(ys), "bottom": max(ys), "left": min(p[0] for p in box), "text": text.strip()})
    # Group boxes whose vertical centres fall inside the current row, then read each row left to right.
    rows: list[list[dict]] = []
    for b in sorted(boxes, key=lambda b: (b["top"] + b["bottom"]) / 2):
        mid = (b["top"] + b["bottom"]) / 2
        if rows and rows[-1][0]["top"] <= mid <= rows[-1][0]["bottom"]:
            rows[-1].append(b)
        else:
            rows.append([b])
    return "\n".join("  ".join(b["text"] for b in sorted(r, key=lambda b: b["left"])) for r in rows)


def read_data_url(url: str) -> str:
    """Text of an image given as a data: URL (as the chat sends attachments)."""
    _, _, payload = url.partition(",")
    return read_image(base64.b64decode(payload))


def read_pil(image) -> str:
    buf = io.BytesIO()
    image.convert("RGB").save(buf, "PNG")
    return read_image(buf.getvalue())
