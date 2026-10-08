"""Local NLP models on ONNX Runtime (CPU, no LLM): a cross-encoder reranker and an extractive QA reader.

The reranker scores how well a passage answers a question. The reader returns the exact
span of a passage that answers it, or nothing. Neither model writes new text, so every
answer built from them is quoted from a source.
"""
import re
import threading
from dataclasses import dataclass

import numpy as np
from flask import current_app

from .nlp import sentence_spans

_load_lock = threading.Lock()
_models: dict[str, "_OnnxModel"] = {}


class _OnnxModel:
    def __init__(self, repo: str, filename: str, cache_dir: str, threads: int):
        import onnxruntime as ort
        from huggingface_hub import hf_hub_download
        from tokenizers import Tokenizer

        def fetch(name: str) -> str:
            # Cached copy first: no network round-trip on startup, and works offline.
            try:
                return hf_hub_download(repo, name, cache_dir=cache_dir, local_files_only=True)
            except Exception:
                return hf_hub_download(repo, name, cache_dir=cache_dir)

        self.tokenizer = Tokenizer.from_file(fetch("tokenizer.json"))
        self.tokenizer.no_padding()
        pad = self.tokenizer.token_to_id("<pad>")
        self.pad_id = pad if pad is not None else (self.tokenizer.token_to_id("[PAD]") or 0)
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = threads
        self.session = ort.InferenceSession(
            fetch(f"onnx/{filename}"), opts, providers=["CPUExecutionProvider"]
        )
        self.input_names = {i.name for i in self.session.get_inputs()}
        # The tokenizer's truncation settings are shared state, so one call at a time per model.
        self.lock = threading.Lock()

    def run(self, encodings) -> list[np.ndarray]:
        width = max(len(e.ids) for e in encodings)
        ids = np.full((len(encodings), width), self.pad_id, dtype=np.int64)
        mask = np.zeros_like(ids)
        types = np.zeros_like(ids)
        for row, e in enumerate(encodings):
            n = len(e.ids)
            ids[row, :n], mask[row, :n], types[row, :n] = e.ids, e.attention_mask, e.type_ids
        feeds = {"input_ids": ids, "attention_mask": mask, "token_type_ids": types}
        return self.session.run(None, {k: v for k, v in feeds.items() if k in self.input_names})


def _model(kind: str) -> _OnnxModel:
    cfg = current_app.config
    repo = cfg["RERANK_MODEL"] if kind == "rerank" else cfg["QA_MODEL"]
    with _load_lock:
        if kind not in _models:
            _models[kind] = _OnnxModel(repo, cfg["NLP_ONNX_FILE"], cfg["NLP_DIR"], cfg["NLP_THREADS"])
        return _models[kind]


def warm_up():
    _model("rerank")
    _model("qa")


# --- Reranking ---------------------------------------------------------------

def rerank(query: str, texts: list[str], batch: int = 16) -> list[float]:
    """Relevance logit per text (higher is better; above 0 is usually a direct match)."""
    if not texts:
        return []
    m = _model("rerank")
    scores: list[float] = []
    with m.lock:
        m.tokenizer.enable_truncation(max_length=512, strategy="only_second")
        for i in range(0, len(texts), batch):
            encs = m.tokenizer.encode_batch([(query, t) for t in texts[i:i + batch]])
            scores.extend(float(s) for s in m.run(encs)[0].reshape(-1))
    return scores


# --- Extractive question answering -------------------------------------------

@dataclass
class Answer:
    text: str  # the exact answer span
    sentence: str  # the source sentence containing it
    score: float  # span probability (0-1)
    passage: int  # index of the passage it came from


def sentence_around(text: str, start: int, end: int) -> str:
    """The sentence(s) of text that contain the character span [start, end)."""
    hits = [(a, b) for a, b in sentence_spans(text) if a < end and b > start]
    left, right = (hits[0][0], hits[-1][1]) if hits else (start, end)
    return re.sub(r"\s+", " ", text[left:right]).strip()


def _softmax(x: np.ndarray) -> np.ndarray:
    e = np.exp(x - x.max())
    return e / e.sum()


def read(question: str, passages: list[str], max_answer_tokens: int = 30, top_k: int = 20) -> list[Answer]:
    """Best answer span per passage, best first. Passages with no answer are left out."""
    if not passages:
        return []
    m = _model("qa")
    with m.lock:
        m.tokenizer.enable_truncation(max_length=384, stride=96, strategy="only_second")
        windows = []
        for index, text in enumerate(passages):
            enc = m.tokenizer.encode(question, text)
            windows.extend((index, w) for w in [enc, *enc.overflowing])
        starts, ends = [], []
        for i in range(0, len(windows), 8):
            s, e = m.run([w for _, w in windows[i:i + 8]])[:2]
            starts.extend(s)
            ends.extend(e)

    best: dict[int, Answer] = {}
    for (index, enc), start_logits, end_logits in zip(windows, starts, ends):
        seq = enc.sequence_ids
        context = np.array([sid == 1 for sid in seq[: len(start_logits)]] + [False] * max(0, len(start_logits) - len(seq)))
        if not context.any():
            continue
        # Probabilities over the context tokens plus the "no answer" token at position 0 (SQuAD 2.0 convention).
        allowed = context.copy()
        allowed[0] = True
        ps = np.where(allowed, _softmax(np.where(allowed, start_logits, -1e9)), 0.0)
        pe = np.where(allowed, _softmax(np.where(allowed, end_logits, -1e9)), 0.0)
        null = ps[0] * pe[0]
        top_starts = [i for i in np.argsort(-ps)[:top_k] if context[i]]
        top_ends = [j for j in np.argsort(-pe)[:top_k] if context[j]]
        span, span_score = None, 0.0
        for i in top_starts:
            for j in top_ends:
                if i <= j < i + max_answer_tokens and ps[i] * pe[j] > span_score:
                    span, span_score = (i, j), float(ps[i] * pe[j])
        if span is None or span_score <= null:
            continue
        char_start, char_end = enc.offsets[span[0]][0], enc.offsets[span[1]][1]
        text = passages[index]
        answer = text[char_start:char_end].strip(" ,;:").removesuffix(".")
        if not answer or (index in best and best[index].score >= span_score):
            continue
        best[index] = Answer(answer, sentence_around(text, char_start, char_end), span_score, index)
    return sorted(best.values(), key=lambda a: -a.score)
