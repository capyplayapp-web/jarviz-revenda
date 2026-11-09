// Voz do Jarvis (09/11/2026, pedido do senhor): liga/desliga a resposta em áudio pelo dashboard e mede o PC enquanto ela está ligada.
// Modo fica em arquivos da pasta do robô (o bot.js lê a cada resposta, sem reiniciar):
//   desligada = voz.off existe · primeira = nenhum dos dois (A/B 50/50 só na 1ª resposta) · todas = voz-tudo.on existe
// Medição: uso do processador (os.cpus, delta), temperatura da zona térmica ACPI (perf counter, sem admin), GPU pelo nvidia-smi.
// Só mede de 5 em 5 s enquanto a voz não está desligada (ou por 60 s depois de alguém abrir a tela); guarda 10 min.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { PASTA } from './lib.mjs';

const OFF = path.join(PASTA, 'voz.off'), TUDO = path.join(PASTA, 'voz-tudo.on');
const PASSO_MS = 5000, GUARDA = 120, TEMP_CADA = 2;   // temperatura e GPU a cada 10 s (PowerShell custa ~0,3 s de CPU)

export function modoVoz() {
  if (fs.existsSync(OFF)) return 'desligada';
  return fs.existsSync(TUDO) ? 'todas' : 'primeira';
}
export function mudarModo(modo) {
  if (!['desligada', 'primeira', 'todas'].includes(modo)) throw new Error('modo inválido');
  const rm = (f) => { try { fs.unlinkSync(f); } catch {} };
  if (modo === 'desligada') { fs.writeFileSync(OFF, 'desligada pelo dashboard em ' + new Date().toISOString()); rm(TUDO); }
  else if (modo === 'todas') { rm(OFF); fs.writeFileSync(TUDO, 'ligada pelo dashboard em ' + new Date().toISOString()); }
  else { rm(OFF); rm(TUDO); }
  vistoEm = Date.now(); garantirLaco();
  return modoVoz();
}

// ---------- medição ----------
let anterior = os.cpus();
function usoCpu() {
  const agora = os.cpus(); let ocup = 0, total = 0;
  agora.forEach((c, i) => {
    const a = anterior[i]?.times || c.times, t = c.times;
    const tot = (t.user - a.user) + (t.nice - a.nice) + (t.sys - a.sys) + (t.irq - a.irq) + (t.idle - a.idle);
    total += tot; ocup += tot - (t.idle - a.idle);
  });
  anterior = agora;
  return total > 0 ? Math.round((ocup / total) * 100) : null;
}
const rodar = (cmd, args, ms = 6000) => new Promise((ok) => execFile(cmd, args, { windowsHide: true, timeout: ms }, (e, out) => ok(e ? '' : String(out))));
async function tempCpu() {
  const out = await rodar('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '(Get-CimInstance Win32_PerfFormattedData_Counters_ThermalZoneInformation | Measure-Object HighPrecisionTemperature -Maximum).Maximum']);
  const dk = Number(out.trim().replace(',', '.'));   // décimos de Kelvin
  return Number.isFinite(dk) && dk > 2000 ? Math.round(dk / 10 - 273.15) : null;
}
async function gpu() {
  const out = await rodar('nvidia-smi', ['--query-gpu=temperature.gpu,utilization.gpu', '--format=csv,noheader,nounits']);
  const [t, u] = out.trim().split(',').map((x) => Number(x));
  return Number.isFinite(t) ? { temp: Math.round(t), uso: Number.isFinite(u) ? Math.round(u) : null } : null;
}
async function voiceStudioOnline() {
  try { const r = await fetch('http://localhost:3900/v1/models', { signal: AbortSignal.timeout(2500) }); return r.ok; } catch { return false; }
}

const historico = [];      // { t, cpu, temp, gpu_temp, gpu_uso }
let ultimaTemp = null, ultimaGpu = null, vs = null, volta = 0, laco = null, vistoEm = 0;

async function medir() {
  const cpu = usoCpu();
  if (volta++ % TEMP_CADA === 0) {
    [ultimaTemp, ultimaGpu, vs] = await Promise.all([tempCpu(), gpu(), voiceStudioOnline()]);
  }
  historico.push({ t: Date.now(), cpu, temp: ultimaTemp, gpu_temp: ultimaGpu?.temp ?? null, gpu_uso: ultimaGpu?.uso ?? null });
  while (historico.length > GUARDA) historico.shift();
}
function garantirLaco() {
  if (laco) return;
  const passo = async () => {
    const precisa = modoVoz() !== 'desligada' || Date.now() - vistoEm < 60000;
    if (!precisa) { laco = null; return; }
    try { await medir(); } catch {}
    laco = setTimeout(passo, PASSO_MS);
  };
  laco = setTimeout(passo, 0);
}

// Últimos áudios gerados (eventos voz_gerada do bot.js): quanto tempo a voz levou.
function ultimosAudios() {
  const arq = path.join(PASTA, 'eventos.jsonl');
  let txt = '';
  try { const st = fs.statSync(arq), fd = fs.openSync(arq, 'r'), n = Math.min(st.size, 400000), b = Buffer.alloc(n); fs.readSync(fd, b, 0, n, st.size - n); fs.closeSync(fd); txt = b.toString('utf8'); } catch {}
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const lista = [];
  for (const l of txt.split('\n')) {
    if (!l.includes('"voz_gerada"')) continue;
    try { const e = JSON.parse(l); if (Date.parse(e.t) >= hoje.getTime()) lista.push({ t: e.t, ms: e.ms ?? null, ok: e.ok !== false, chars: e.chars ?? null }); } catch {}
  }
  const ok = lista.filter((x) => x.ok && x.ms);
  return { hoje: lista.length, falhas: lista.filter((x) => !x.ok).length,
    media_ms: ok.length ? Math.round(ok.reduce((s, x) => s + x.ms, 0) / ok.length) : null, ultimo: lista.slice(-1)[0] || null };
}

export async function estadoVoz() {
  vistoEm = Date.now();
  if (!historico.length) await medir();
  garantirLaco();
  if (vs === null) vs = await voiceStudioOnline();
  return { modo: modoVoz(), voicestudio: vs, medindo: !!laco, agora: historico[historico.length - 1] || null,
    historico: historico.map((h) => [h.t, h.cpu, h.temp, h.gpu_temp, h.gpu_uso]), audios: ultimosAudios(),
    processador: os.cpus()[0]?.model?.trim() || null };
}

garantirLaco();   // se a voz estiver ligada quando o servidor sobe, já começa a medir
