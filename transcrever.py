# Transcritor do robô da revenda: fica ligado, recebe um caminho de áudio por linha
# no stdin e devolve uma linha JSON {"texto": "..."} no stdout.
import json, subprocess, sys
import numpy as np

def decodificar(caminho):
    # ffmpeg -> 16 kHz mono float32 (evita o PyAV, que está em versão incompatível)
    raw = subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-i', caminho, '-f', 'f32le', '-ac', '1', '-ar', '16000', '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32)

def carregar():
    from faster_whisper import WhisperModel
    # processador (a placa de vídeo está sem as bibliotecas CUDA); áudio de WhatsApp é curto
    return WhisperModel("small", device="cpu", compute_type="int8", cpu_threads=4), "cpu"

modelo, onde = carregar()
print(json.dumps({"pronto": onde}), flush=True)

for linha in sys.stdin:
    caminho = linha.strip()
    if not caminho:
        continue
    try:
        segs, _ = modelo.transcribe(decodificar(caminho), language="pt", beam_size=1, vad_filter=True)
        texto = " ".join(s.text.strip() for s in segs).strip()
        print(json.dumps({"texto": texto}, ensure_ascii=True), flush=True)
    except Exception as e:
        print(json.dumps({"erro": str(e)}, ensure_ascii=True), flush=True)
