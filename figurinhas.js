// Figurinhas da capivara no atendimento (pedido do senhor, 10/11/2026).
// Pacote "CapyPlay Atendimento": 12 figurinhas feitas no Higgsfield, em D:\CAPY\Figurinhas (webp 512x512, png e figurinhas.json).
// O bot manda figurinha em momentos certos (painel criado, teste liberado, comprovante, passou ao responsável...) e o Haiku
// pode escolher uma no campo "figurinha". Travas: no máximo 5 por conversa por dia, 3 min entre figurinhas escolhidas
// pelo Haiku, a mesma figurinha não se repete na conversa em 24 h (painel_criado só uma vez na vida).
// Desligar sem reiniciar: criar o arquivo figurinhas.off nesta pasta.
const fs = require('fs');
const path = require('path');

const PACOTE = 'D:/CAPY/Figurinhas/figurinhas.json';
const NOME_PACOTE = 'CapyPlay Atendimento';
const AUTOR = 'CapyPlay';
const MAX_DIA = 3;
const INTERVALO_HAIKU = 3 * 60e3;
const SEM_REPETIR = 24 * 3600e3;

// Quando cada uma entra (vai para o Haiku junto da lista).
const QUANDO = {
  oi_mestre: 'primeiro oi (o sistema já manda sozinho no primeiro contato)',
  bom_dia: 'primeiro oi da manhã (o sistema já manda sozinho)',
  aguardando: 'quando você pede algo ao cliente e fica esperando ele fazer (criar o painel, mandar print, instalar o app)',
  verificando: 'quando vai conferir algo para o cliente (acesso, pagamento, um erro que ele mandou)',
  so_um_instante: 'quando passa ao responsável ou precisa de um tempinho (o sistema já manda ao passar ao responsável)',
  teste_liberado: 'teste liberado (o sistema já manda sozinho)',
  comprovante_recebido: 'cliente mandou comprovante ou disse que pagou',
  painel_criado: 'painel criado (o sistema já manda sozinho)',
  resolvido: 'o problema do cliente foi resolvido e ele confirmou que voltou a funcionar',
  bora_vender: 'revendedor animado para começar a vender, ou depois de explicar como lucrar',
  valeu_mestre: 'cliente agradeceu, elogiou ou fechou algo com você',
  foi_mal: 'quando a Revenda errou, demorou ou houve instabilidade e você pede desculpa',
};
// 10/11/2026 (pedido do senhor): sem figurinha o tempo todo. O Haiku só pode escolher as de problema/pagamento;
// o resto é do sistema (painel criado, teste liberado, primeiro oi, passou ao responsável) ou não sai.
const SO_DO_SISTEMA = new Set(['oi_mestre', 'bom_dia', 'teste_liberado', 'painel_criado', 'aguardando', 'so_um_instante', 'bora_vender', 'valeu_mestre', 'resolvido']);

function lerPacote() {
  try {
    const p = JSON.parse(fs.readFileSync(PACOTE, 'utf8'));
    const mapa = {};
    for (const f of p.figurinhas || []) if (f && f.id && fs.existsSync(f.arquivo)) mapa[f.id] = f;
    return mapa;
  } catch { return {}; }
}

function criarFigurinhas({ client, MessageMedia, log, evento, ficha, salvarFichas, desligado, marcarEnvio, enviadasPeloRobo, PASTA, nomeDe }) {
  const desligadas = () => fs.existsSync(path.join(PASTA, 'figurinhas.off'));

  // Texto para o pedido do Haiku: só as que ele pode escolher.
  function catalogo() {
    const mapa = lerPacote();
    return Object.keys(mapa).filter((id) => !SO_DO_SISTEMA.has(id)).map((id) => `- ${id}: "${mapa[id].texto}" — ${QUANDO[id] || ''}`).join('\n');
  }

  // origem: 'haiku' | 'sistema'. Devolve true se mandou.
  async function mandar(chatId, id, origem = 'sistema', motivo = '') {
    try {
      if (!id || desligadas() || desligado(chatId)) return false;
      const mapa = lerPacote();
      const f = mapa[id];
      if (!f) { if (id) log(`figurinha desconhecida: ${id}`); return false; }
      const fx = ficha(chatId);
      const agora = Date.now();
      const hist = (fx.figurinhas || []).filter((h) => agora - Date.parse(h.em) < 7 * 24 * 3600e3);
      const hoje = hist.filter((h) => agora - Date.parse(h.em) < 24 * 3600e3);
      if (hoje.length >= MAX_DIA) return false;
      if (id === 'painel_criado' && (fx.figurinhas || []).some((h) => h.id === 'painel_criado')) return false;
      if (hoje.some((h) => h.id === id && agora - Date.parse(h.em) < SEM_REPETIR)) return false;
      if (origem === 'haiku' && hoje.some((h) => agora - Date.parse(h.em) < INTERVALO_HAIKU)) return false;
      marcarEnvio(chatId);
      await new Promise((r) => setTimeout(r, 900));
      const m = await client.sendMessage(chatId, MessageMedia.fromFilePath(f.arquivo), { sendMediaAsSticker: true, stickerName: NOME_PACOTE, stickerAuthor: AUTOR });
      if (m && m.id) enviadasPeloRobo.add(m.id._serialized);
      fx.figurinhas = [...hist, { id, em: new Date().toISOString(), origem }].slice(-20);
      salvarFichas();
      const nome = nomeDe ? nomeDe(chatId) : '';
      log(`robô -> ${nome || chatId}: [figurinha ${id}] (${origem}${motivo ? ', ' + motivo : ''})`);
      evento('figurinha', chatId, nome, { figurinha: id, origem, motivo });
      return true;
    } catch (e) { log(`figurinha ${id} falhou: ${e.message}`); return false; }
  }

  // Manda o pacote inteiro para uma conversa (ex.: "eu" = conversa do próprio número, para favoritar no celular).
  async function mandarPacote(destino) {
    const alvo = destino === 'eu' ? client.info.wid._serialized : destino;
    const mapa = lerPacote();
    let n = 0;
    for (const id of Object.keys(mapa)) {
      try {
        const m = await client.sendMessage(alvo, MessageMedia.fromFilePath(mapa[id].arquivo), { sendMediaAsSticker: true, stickerName: NOME_PACOTE, stickerAuthor: AUTOR });
        if (m && m.id) enviadasPeloRobo.add(m.id._serialized);
        n++;
      } catch (e) { log(`pacote: figurinha ${id} falhou: ${e.message}`); }
      await new Promise((r) => setTimeout(r, 2500));
    }
    log(`pacote de figurinhas enviado para ${alvo}: ${n} de ${Object.keys(mapa).length}`);
    return n;
  }

  return { mandar, mandarPacote, catalogo, lerPacote };
}

module.exports = { criarFigurinhas, QUANDO };
