"""Merge public original episodes and optionally synthesize MP3 with Azure Speech."""
import hashlib, json, os, re, subprocess, tempfile
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

def synthesize(text, target):
    if not KEY or not re.fullmatch(r"[a-z0-9]+", REGION):
        return False
    if target.exists() and target.stat().st_size > 0:
        return True
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
        digest = hashlib.sha256((VOICE + script).encode()).hexdigest()[:20]
        target = AUDIO / f"{ident}-{digest}.mp3"
        ep = dict(title=item["title"], date=item["date"], summary=item.get("summary", ""), script=script, kind="speech", source="AI 原创", url=BASE, sources=item.get("sources", []))
        try:
            if synthesize(script, target):
                ep.update(kind="audio", audio=BASE + "audio/" + target.name, ai=True)
        except Exception as exc:
            print("TTS unavailable for", ident, type(exc).__name__)
        episodes.append(ep)
    if episodes:
        data["marketing"]["shows"].insert(0, dict(title="AI 原创 · 商业案例研究室", url=BASE+"#originals", kind="speech", episodes=sorted(episodes,key=lambda x:x["date"],reverse=True)))
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2)+"\n")

if __name__ == "__main__":
    main()
