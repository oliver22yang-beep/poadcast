"""Merge public original episodes; optional experimental Edge or confirmed Azure F0 TTS."""
import hashlib, json, os, re, subprocess, tempfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "site/data/content.json"
AUDIO = ROOT / "site/audio"
BASE = "https://oliver22yang-beep.github.io/poadcast/"
KEY = os.getenv("AZURE_SPEECH_KEY", "")
REGION = os.getenv("AZURE_SPEECH_REGION", "")
VOICE = "zh-CN-XiaoxiaoNeural"
ENGINE = os.getenv("TTS_ENGINE", "edge").lower()
MAX_NEW = 3
new_attempts = 0
FREE_CONFIRMED = os.getenv("AZURE_F0_CONFIRMED") == "true"
LEDGER = ROOT / ".tts-state" / (datetime.now(timezone.utc).strftime("%Y-%m") + ".json")
LIMIT = 475000

def reserve(text):
    used = json.loads(LEDGER.read_text()).get("used", 0) if LEDGER.exists() else 0
    units = len(text) * 2
    if used + units > LIMIT: return False
    LEDGER.parent.mkdir(parents=True, exist_ok=True)
    LEDGER.write_text(json.dumps({"used": used + units}))
    if used + units >= 400000: print("TTS local budget warning: 80%")
    return True

def synthesize_azure(text, target):
    if target.exists() and target.stat().st_size > 0:
        return True
    if not FREE_CONFIRMED or not KEY or not re.fullmatch(r"[a-z0-9]+", REGION):
        return False
    if not reserve(text): return False
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        parts = []
        for i, chunk in enumerate(re.findall(r".{1,600}", text, re.S)):
            ssml = f"<speak version='1.0' xml:lang='zh-CN' xmlns='http://www.w3.org/2001/10/synthesis'><voice name='{VOICE}'>{escape(chunk)}</voice></speak>"
            req = Request(f"https://{REGION}.tts.speech.microsoft.com/cognitiveservices/v1", data=ssml.encode(), headers={"Ocp-Apim-Subscription-Key": KEY, "Content-Type": "application/ssml+xml", "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3", "User-Agent": "Shengjian"})
            part = Path(tmp) / f"{i}.mp3"
            with urlopen(req, timeout=90) as response:
                part.write_bytes(response.read())
            parts.append(part)
        listing = Path(tmp) / "list.txt"
        listing.write_text("".join(f"file '{p.name}'\n" for p in parts))
        output = Path(tmp) / "out.mp3"
        subprocess.run(["ffmpeg", "-v", "error", "-f", "concat", "-safe", "1", "-i", str(listing), "-c", "copy", str(output)], check=True)
        target.write_bytes(output.read_bytes())
    return True

def synthesize(text, target):
    global new_attempts
    if target.exists() and target.stat().st_size > 0:
        return True
    if ENGINE not in ("edge", "azure") or new_attempts >= MAX_NEW:
        return False
    new_attempts += 1
    if ENGINE == "azure":
        return synthesize_azure(text, target)
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        output = Path(tmp) / "output.mp3"
        input_file = Path(tmp) / "script.txt"
        input_file.write_text(text, encoding="utf-8")
        subprocess.run(["edge-tts", "--voice", VOICE, "--file", str(input_file), "--write-media", str(output)], check=True, timeout=180, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name", "-of", "csv=p=0", str(output)], check=True, capture_output=True, text=True, timeout=20)
        if not output.stat().st_size:
            return False
        target.write_bytes(output.read_bytes())
    return True

def main():
    data = json.loads(OUT.read_text())
    episodes = []
    seen = set()
    for path in sorted((ROOT / "originals").glob("*.json")):
        item = json.loads(path.read_text())
        ident, script = item["id"], item["script"].strip()
        if not re.fullmatch(r"[a-z0-9-]+", ident) or ident in seen or not script or len(script) > 12000:
            raise ValueError("Invalid or duplicate original: " + path.name)
        seen.add(ident)
        digest = hashlib.sha256((ENGINE + ":" + VOICE + ":" + script).encode()).hexdigest()[:20]
        target = AUDIO / f"{ident}-{digest}.mp3"
        ep = dict(id=ident, title=item["title"], date=item["date"], summary=item.get("summary", ""), script=script, kind="speech", source="AI 原创", url=BASE, sources=item.get("sources", []))
        try:
            if synthesize(script, target):
                ep.update(kind="audio", audio=BASE + "audio/" + target.name, ai=True, tts_engine=ENGINE)
        except Exception as exc:
            print("TTS unavailable for", ident, type(exc).__name__)
        episodes.append(ep)
    data["marketing"]["shows"] = [s for s in data["marketing"]["shows"] if s.get("url") != BASE+"#originals"]
    if episodes:
        data["marketing"]["shows"].insert(0, dict(title="AI 原创 · 商业案例研究室", url=BASE+"#originals", kind="speech", episodes=sorted(episodes,key=lambda x:x["date"],reverse=True)))
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2)+"\n")

if __name__ == "__main__":
    main()
