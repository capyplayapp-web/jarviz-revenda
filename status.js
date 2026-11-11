// Status do WhatsApp do número do robô (pedido do senhor, 10/11/2026): "meu status precisa estar sempre em movimentação".
// Posta sozinho, sem IA (não gasta token): tabela de jogos do dia, conteúdos novos do CapySports, artes antigas e vídeos já gerados.
// Desligar: criar o arquivo status.off nesta pasta. Estado: status-estado.json. Janela: 8h às 22h, um status a cada ~75 min.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PASTA = __dirname;
const ESTADO = path.join(PASTA, 'status-estado.json');
const OFF = path.join(PASTA, 'status.off');
const INTERVALO_MIN = 75;
const HORA_INI = 8, HORA_FIM = 22;
const MOTIONS = 'C:/Users/gusta/.codex/.chatgpt-projects/g-p-6ad13036e67c819186ca8173794a4349/outputs/ILHA_CAPYPLAY/motions';
const TABELA = path.join(MOTIONS, 'tabela-do-dia');
const SPORTS = 'D:/CAPY/CapySports_Redes';
const ARTES = ['D:/CAPY/Criativos com preco/2026-11-10_poster-s/final', 'D:/CAPY/Criativos com preco/2026-11-10_poster-publicado'];
const VIDEOS = ['D:/CAPY/MOTIONS'];
const MAX_MB = 14, MAX_SEG = 30;

const hoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const hora = () => Number(new Date().toLocaleString('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }));
const ler = () => { try { return JSON.parse(fs.readFileSync(ESTADO, 'utf8')); } catch { return { postados: [], ultimo: 0, tabelaDia: '', rodada: 0 }; } };
const gravar = (e) => { try { e.postados = e.postados.slice(-600); fs.writeFileSync(ESTADO, JSON.stringify(e)); } catch {} };
const mb = (f) => fs.statSync(f).size / 1048576;
function duracao(f) { try { return Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' })); } catch { return 999; } }
function listar(dir, rx, fundo = 3) {
  const out = [];
  (function r(d, n) { let l; try { l = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const x of l) { const p = path.join(d, x.name).replace(/\\/g, '/'); if (x.isDirectory()) { if (n < fundo) r(p, n + 1); } else if (rx.test(x.name)) out.push(p); } })(dir, 0);
  return out;
}
const aleatorio = (a) => a[Math.floor(Math.random() * a.length)];

function candidatos(est) {
  const feitos = new Set(est.postados);
  const novos = (f) => f.filter((x) => !feitos.has(x));
  // 1) tabela de jogos do dia (uma vez por dia)
  const tab = listar(TABELA, /^JOGOS_\d{4}-\d{2}-\d{2}\.mp4$/, 0).filter((f) => path.basename(f).includes(hoje()));
  const tabela = est.tabelaDia === hoje() ? [] : tab;
  // 2) conteúdos novos do CapySports de hoje: vídeo do plantão (ou a capa)
  const plt = listar(path.join(SPORTS, hoje()), /^(video\.mp4|capa\.jpg)$/i, 2);
  const novosPlt = novos(plt).filter((f) => !/capa\.jpg$/i.test(f) || !plt.includes(f.replace(/capa\.jpg$/i, 'video.mp4')))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  // 3) artes antigas (story 9:16) e 4) vídeos já gerados
  const artes = [].concat(...ARTES.map((d) => listar(d, /story.*\.(png|jpg)$/i, 2)));
  const videos = [].concat(...VIDEOS.map((d) => listar(d, /(final|filme|motion)[^/]*\.mp4$/i, 3)));
  return { tabela, novosPlt, artes: novos(artes).length ? novos(artes) : artes, videos: novos(videos).length ? novos(videos) : videos };
}

function escolher(est) {
  const c = candidatos(est);
  if (c.tabela.length) return { tipo: 'tabela', arq: c.tabela[0], legenda: 'Os jogos de hoje' };
  if (c.novosPlt.length) return { tipo: 'novo', arq: c.novosPlt[0], legenda: '' };
  const ordem = ['artes', 'videos', 'artes'];
  for (let k = 0; k < ordem.length; k++) {
    const tipo = ordem[(est.rodada + k) % ordem.length];
    const lista = c[tipo].filter((f) => mb(f) <= MAX_MB);
    if (!lista.length) continue;
    const arq = aleatorio(lista);
    if (tipo === 'videos' && duracao(arq) > MAX_SEG) continue;
    return { tipo, arq, legenda: '' };
  }
  return null;
}

function iniciar({ client, MessageMedia, log }) {
  let ocupado = false;
  async function ciclo(forcar = false) {
    if (ocupado || fs.existsSync(OFF) || !client.info) return;
    const est = ler(), agora = Date.now(), h = hora();
    if (!forcar && (h < HORA_INI || h >= HORA_FIM || agora - est.ultimo < INTERVALO_MIN * 60e3)) return;
    ocupado = true;
    try {
      const it = escolher(est);
      if (!it) { log('status: nada para postar agora'); return; }
      const media = MessageMedia.fromFilePath(it.arq);
      await client.sendMessage('status@broadcast', media, it.legenda ? { caption: it.legenda } : {});
      est.postados.push(it.arq); est.ultimo = Date.now(); est.rodada++;
      if (it.tipo === 'tabela') est.tabelaDia = hoje();
      gravar(est);
      log(`status postado (${it.tipo}): ${path.basename(it.arq)}`);
    } catch (e) { log('status falhou: ' + String(e.stack || e.message || e).replace(/\s+/g, ' ').slice(0, 900)); const est2 = ler(); est2.ultimo = Date.now() - (INTERVALO_MIN - 10) * 60e3; gravar(est2); }
    finally { ocupado = false; }
  }
  setInterval(() => ciclo().catch(() => {}), 60000);
  setTimeout(() => ciclo().catch(() => {}), 90000);
  log('status do WhatsApp: ligado (a cada ~' + INTERVALO_MIN + ' min, ' + HORA_INI + 'h às ' + HORA_FIM + 'h; status.off desliga)');
  return { ciclo };
}
module.exports = { iniciar, escolher, candidatos };
