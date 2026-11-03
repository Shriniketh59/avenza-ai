"""Convert a Meta MMS-TTS voice (VITS, PyTorch) to ONNX for AVENZA (backend/avenza/ai/mms.py).

    python backend/tools/export_mms_voice.py <iso639-3> <folder>
    e.g. python backend/tools/export_mms_voice.py kan backend/instance/voices/mms-kn

Needs torch and transformers, which AVENZA itself does not: run it in a separate throwaway environment
(uv venv /tmp/mms && uv pip install --python /tmp/mms/bin/python torch transformers onnx
 --extra-index-url https://download.pytorch.org/whl/cpu). The voices are licensed CC-BY-NC-4.0 (non-commercial).
"""
import json, sys, torch
from transformers import VitsModel, VitsTokenizer

lang, out = sys.argv[1], sys.argv[2]
repo = f"facebook/mms-tts-{lang}"
model = VitsModel.from_pretrained(repo).eval()
tok = VitsTokenizer.from_pretrained(repo)

class Wrapper(torch.nn.Module):
    def __init__(self, m):
        super().__init__()
        self.m = m
    def forward(self, input_ids, speaking_rate):
        self.m.speaking_rate = speaking_rate  # traced as a tensor: speed stays adjustable at run time
        return self.m(input_ids=input_ids).waveform

ids = tok(sys.argv[3] if len(sys.argv) > 3 else "வணக்கம் இது ஒரு சோதனை", return_tensors="pt").input_ids
torch.onnx.export(Wrapper(model), (ids, torch.tensor(1.0)), f"{out}/model.onnx", dynamo=False, opset_version=17,
                  input_names=["input_ids", "speaking_rate"], output_names=["waveform"],
                  dynamic_axes={"input_ids": {1: "text"}, "waveform": {1: "samples"}})
cfg = {"sample_rate": model.config.sampling_rate, "add_blank": model.config.add_blank if hasattr(model.config, "add_blank") else True,
       "pad_id": tok.pad_token_id, "vocab": tok.get_vocab(), "is_uroman": tok.is_uroman,
       "normalize": tok.normalize, "phonemize": tok.phonemize, "source": repo, "license": "CC-BY-NC-4.0",
       "reference_ids": ids[0].tolist(), "reference_text": sys.argv[3] if len(sys.argv) > 3 else "வணக்கம் இது ஒரு சோதனை"}
json.dump(cfg, open(f"{out}/config.json", "w"), ensure_ascii=False)
print("exported", repo, "sr", cfg["sample_rate"], "vocab", len(cfg["vocab"]), "uroman", cfg["is_uroman"], "ids", cfg["reference_ids"][:12])
