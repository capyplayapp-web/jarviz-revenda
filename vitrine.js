// Vitrine do cliente final (10/11/2026, pedido do senhor): quem quer ASSISTIR (não revender) recebe artes de conteúdo.
// O Haiku devolve "vitrine": "lancamentos" | "futebol" | "series" | "familia" | "geral" (ou "" para nada).
//  - "lancamentos": o vídeo mais recente do robô Novidades P2PRO (pôsteres dos lançamentos), se tiver até 15 dias.
//  - os outros: um pôster aprovado da leva s-pNN no preço do cliente final (R$ 29,90), escolhido pelo assunto.
// Cada peça vai uma vez só por conversa (ficha.vitrine). Nunca quebra o atendimento.
const fs = require('fs');
const path = require('path');

const PRECO = '29,90';
const NOVIDADES = 'C:/Users/gusta/.codex/.chatgpt-projects/g-p-6ad13036e67c819186ca8173794a4349/outputs/ILHA_CAPYPLAY/motions/p2pro-novidades/saida';
const POSTERES = 'D:/CAPY/Criativos com preco/2026-11-10_poster-s/final';
// Ordem de preferência por assunto (pôsteres aprovados: p05 futebol, p07 maratona, p09 família, p10 rei do sofá...).
const ORDEM = {
  futebol: ['p05', 'p10', 'p04', 'p07'],
  series: ['p07', 'p04', 'p06', 'p10'],
  familia: ['p09', 'p10', 'p07', 'p03'],
  geral: ['p10', 'p07', 'p09', 'p04', 'p01', 'p06', 'p02', 'p03', 'p05', 'p08'],
};
const LEGENDA = {
  futebol: 'Futebol ao vivo e muito mais, por R$ 29,90 por mês.',
  series: 'Séries e filmes para maratonar, por R$ 29,90 por mês.',
  familia: 'Tem para a família inteira, por R$ 29,90 por mês.',
  geral: 'Tudo isso por R$ 29,90 por mês.',
};

function ultimoLancamento() {
  try {
    const dirs = fs.readdirSync(NOVIDADES).filter((d) => /^\d+$/.test(d))
      .map((d) => ({ d, t: fs.statSync(path.join(NOVIDADES, d)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const { d, t } of dirs) {
      const mp4 = path.join(NOVIDADES, d, 'motion.mp4');
      if (fs.existsSync(mp4)) return Date.now() - t < 15 * 864e5 ? { arq: mp4, id: 'lanc-' + d } : null;
    }
  } catch {}
  return null;
}

function escolherPoster(assunto, jaFoi) {
  const ordem = ORDEM[assunto] || ORDEM.geral;
  for (const p of [...ordem, ...ORDEM.geral]) {
    const arq = path.join(POSTERES, `${p}-feed-${PRECO.replace(',', '-')}.png`);
    if (!jaFoi.includes(p) && fs.existsSync(arq)) return { arq, id: p };
  }
  return null;
}

function criarVitrine({ client, MessageMedia, log, marcarEnvio, enviadasPeloRobo, textosDoRobo }) {
  async function mandarArquivo(chatId, arq, legenda) {
    marcarEnvio(chatId);
    if (legenda) { textosDoRobo.add(legenda); setTimeout(() => textosDoRobo.delete(legenda), 60000); }
    const m = await client.sendMessage(chatId, MessageMedia.fromFilePath(arq), legenda ? { caption: legenda } : {});
    enviadasPeloRobo.add(m.id._serialized);
  }
  // Devolve a lista do que foi enviado (para log/evento).
  async function mandar(chatId, ficha, pedido) {
    const assunto = String(pedido || '').trim().toLowerCase();
    if (!assunto) return [];
    ficha.vitrine = ficha.vitrine || [];
    const enviados = [];
    try {
      if (assunto === 'lancamentos') {
        const l = ultimoLancamento();
        if (l && !ficha.vitrine.includes(l.id)) {
          await mandarArquivo(chatId, l.arq, 'Alguns dos lançamentos que chegaram esta semana.');
          ficha.vitrine.push(l.id); enviados.push(l.id);
        }
      }
      // Sempre fecha com um pôster no preço (se ainda não mandou nenhum nesta conversa) ou quando o assunto pede outro.
      const jaPosters = ficha.vitrine.filter((v) => /^p\d+$/.test(v));
      if ((assunto !== 'lancamentos' || !jaPosters.length) && jaPosters.length < 2) {   // no máximo 2 pôsteres por conversa
        const chave = ORDEM[assunto] ? assunto : 'geral';
        const p = escolherPoster(chave, jaPosters);
        if (p) { await mandarArquivo(chatId, p.arq, LEGENDA[chave]); ficha.vitrine.push(p.id); enviados.push(p.id); }
      }
    } catch (e) { log('vitrine falhou: ' + e.message); }
    return enviados;
  }
  return { mandar, catalogo: () => 'lancamentos (vídeo dos lançamentos da semana + pôster), futebol, series, familia, geral' };
}

module.exports = { criarVitrine, PRECO };
