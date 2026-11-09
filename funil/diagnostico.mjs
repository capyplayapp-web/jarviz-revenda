// Diagnóstico do funil com dados reais (sem IA, sem custo): node funil\diagnostico.mjs
// Junta analise\conversas.json (22/10 a 08/11 11h, export do WhatsApp), os eventos do robô (08/11), backlog.json (categoria
// de cada conversa em 14 dias) e revendedores.json. Grava funil\diagnostico.json e as tabelas de funil\DIAGNOSTICO-tabelas.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const P = path.resolve(AQUI, '..');
const lerJson = (a, p) => { try { return JSON.parse(fs.readFileSync(path.join(P, a), 'utf8')); } catch { return p; } };
const lerJsonl = (a) => { try { return fs.readFileSync(path.join(P, a), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };

const conversas = lerJson('analise/conversas.json', []);
const mapa = lerJson('backlog.json', { itens: [] });
const revs = lerJson('revendedores.json', {});
const evs = lerJsonl('eventos-historico.jsonl').concat(lerJsonl('eventos.jsonl')).sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
const porId = new Map(conversas.map((c) => [c.id, c]));
const corteAnalise = Math.max(...conversas.flatMap((c) => c.mensagens.map((m) => Date.parse(m.quando))));

// mensagens unificadas por conversa
function mensagens(id) {
  const base = (porId.get(id)?.mensagens || []).map((m) => ({ t: Date.parse(m.quando), quem: m.quem, tipo: m.tipo, texto: String(m.texto || '') }));
  const extra = evs.filter((e) => e.chat === id && Date.parse(e.t) > corteAnalise).map((e) => e.tipo === 'mensagem_cliente' ? { t: Date.parse(e.t), quem: 'cliente', tipo: e.msg_tipo || 'chat', texto: e.texto || '' }
    : ['resposta_robo', 'followup', 'followup_backlog', 'toque_cadencia'].includes(e.tipo) ? { t: Date.parse(e.t), quem: 'robo', tipo: 'chat', texto: e.texto || '', proativo: e.tipo !== 'resposta_robo', fu: e.tipo } : e.tipo === 'senhor_escreveu' ? { t: Date.parse(e.t), quem: 'senhor', tipo: e.msg_tipo || 'chat', texto: '' } : null).filter(Boolean);
  return base.concat(extra).sort((a, b) => a.t - b.t);
}
const RX = {
  soube: /cr[eé]dito|p[oó]s-?pago|3,50|500 |ativos?\b|sem taxa|dia 5|acerto/i,
  link: /painel\.capyplay\.site\/#\/rs\//i,
  conta: /R\$ ?70|20 clientes|R\$ ?35|10 cr[eé]ditos|m[ií]nimo/i,
  video: /\[v[ií]deo/i,
  canal: /t\.me\/capyplayoficial|escola\.capyapp|banner/i,
  teste: /teste|testar/i,
  anuncio: /^(j[aá] fa[cç]o revenda e quero conhecer|quero come[cç]ar a revender|quero saber os valores e as condi)/i,
  ja_revende: /j[aá] fa[cç]o revenda|j[aá] revendo|j[aá] trabalho|tenho clientes|tenho painel/i,
  comecar: /quero come[cç]ar|come[cç]ando|nunca revendi|primeira vez|n[aã]o revendo/i,
};
const OBJ = {
  preco_minimo: /pre[cç]o|valor|quanto|caro|m[ií]nimo|taxa|cobra|custa/i,
  pagamento: /pix|pagar|pagamento|boleto|cart[aã]o|acerto|vencimento/i,
  aparelho_app: /tv|box|fire|celular|iphone|app|aplicativo|lotus|smart|roku|instal/i,
  teste: /teste|testar/i,
  confianca: /golpe|confi|seguro|garantia|cnpj|empresa/i,
  conteudo: /canal|canais|filme|s[eé]rie|futebol|globo|premiere|esporte|lista/i,
  credito_ativo: /cr[eé]dito|ativo|conex[aã]o|tela/i,
  subrevenda: /sub ?revend|revender para/i,
};
const mediana = (a) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const media = (a) => { const s = a.filter(Number.isFinite); return s.length ? s.reduce((x, y) => x + y, 0) / s.length : null; };
const pct = (k, n) => (n ? Math.round((k / n) * 1000) / 10 : null);

const linhas = [];
for (const it of mapa.itens) {
  const todas = mensagens(it.id);
  if (!todas.length) continue;
  // Só o que aconteceu ANTES do painel (senão o passo 4 pós-painel, o "Usuário: ... Senha" e a Escola contam como causa).
  const rev0 = revs[it.id];
  const marcoPainel = Math.min(rev0 && rev0.fechou_em ? Date.parse(rev0.fechou_em) : Infinity, ...todas.filter((m) => (m.quem === 'cliente' && /usu[aá]rio:\s*\S+|criei|criado|consegui criar|j[aá] criei/i.test(m.texto)) || (m.quem !== 'cliente' && /manual_do_revenda|membership\/renew|seja bem-vind|mensalidade/i.test(m.texto))).map((m) => m.t));
  const ms = it.categoria === 'painel_criado' && Number.isFinite(marcoPainel) ? todas.filter((m) => m.t < marcoPainel) : todas;
  if (!ms.length) continue;
  const cli = ms.filter((m) => m.quem === 'cliente'), nos = ms.filter((m) => m.quem !== 'cliente');
  if (!cli.length) continue;
  const t0 = cli[0].t;
  const primeiro = (rx) => nos.find((m) => rx.test(m.texto));
  const soube = primeiro(RX.soube), link = primeiro(RX.link);
  const rev = revs[it.id];
  // tempos de resposta (cliente -> nossa próxima mensagem)
  const resp = []; let semResposta = 0;
  for (let i = 0; i < ms.length; i++) {
    if (ms[i].quem !== 'cliente') continue;
    if (i + 1 < ms.length && ms[i + 1].quem === 'cliente') continue;              // conta só o fim de uma rajada
    const prox = ms.slice(i + 1).find((m) => m.quem !== 'cliente');
    if (prox) resp.push((prox.t - ms[i].t) / 60000);
    if (/\?/.test(ms[i].texto) && (!prox || prox.t - ms[i].t > 30 * 60e3)) semResposta++;
  }
  const textosNos = nos.filter((m) => m.tipo === 'chat').map((m) => m.texto);
  const repetidas = textosNos.length - new Set(textosNos.map((x) => x.trim().toLowerCase())).size;
  const objecoes = Object.entries(OBJ).filter(([, rx]) => cli.some((m) => rx.test(m.texto))).map(([k]) => k);
  linhas.push({
    id: it.id, categoria: it.categoria, criou: it.categoria === 'painel_criado',
    origem: RX.anuncio.test(cli[0].texto) ? 'anuncio' : 'direto',
    perfil: RX.ja_revende.test(cli.map((m) => m.texto).join(' ')) ? 'ja_revende' : RX.comecar.test(cli.map((m) => m.texto).join(' ')) ? 'quer_comecar' : 'nao_disse',
    soube: !!soube, link: !!link, min_ate_soube: soube ? (soube.t - t0) / 60000 : null, min_ate_link: link ? (link.t - t0) / 60000 : null,
    nossas_antes_link: link ? nos.filter((m) => m.t < link.t).length : null,
    min_link_ate_painel: link && rev && rev.fechou_em ? (Date.parse(rev.fechou_em) - link.t) / 60000 : null,
    conta: nos.some((m) => RX.conta.test(m.texto)), video: nos.some((m) => m.tipo === 'video' || RX.video.test(m.texto)), canal: nos.some((m) => RX.canal.test(m.texto)), teste: ms.some((m) => RX.teste.test(m.texto)),
    audio_nosso: nos.some((m) => m.tipo === 'ptt' || m.tipo === 'audio'), robo: nos.some((m) => m.quem === 'robo'),
    resp_mediana_min: mediana(resp), resp_max_min: resp.length ? Math.max(...resp) : null, sem_resposta: semResposta,
    tam_medio_nosso: media(textosNos.map((x) => x.length)), msgs_nossas: nos.length, msgs_cliente: cli.length, repetidas,
    cliente_so_frase_anuncio: cli.length === 1 && RX.anuncio.test(cli[0].texto), objecoes,
    ultimo: ms[ms.length - 1].quem,
  });
}
const grupo = (f) => linhas.filter(f);
const criou = grupo((l) => l.criou), esfriou = grupo((l) => l.categoria === 'esfriou');
const comparar = (nome, f, tipo = 'pct') => {
  const a = criou.map(f), b = esfriou.map(f);
  if (tipo === 'pct') return { nome, criou: pct(a.filter(Boolean).length, a.length), esfriou: pct(b.filter(Boolean).length, b.length) };
  return { nome, criou: Math.round((mediana(a) ?? NaN) * 10) / 10, esfriou: Math.round((mediana(b) ?? NaN) * 10) / 10 };
};
const comp = [
  comparar('Recebeu o link do painel (%)', (l) => l.link), comparar('Soube como funciona (texto) (%)', (l) => l.soube), comparar('Recebeu exemplo de conta (%)', (l) => l.conta),
  comparar('Recebeu vídeo (%)', (l) => l.video), comparar('Falou de teste (%)', (l) => l.teste), comparar('Recebeu canal/Escola/banners (%)', (l) => l.canal),
  comparar('Teve áudio nosso (%)', (l) => l.audio_nosso), comparar('Atendida pelo robô (%)', (l) => l.robo), comparar('Pergunta do cliente sem resposta em 30 min (%)', (l) => l.sem_resposta > 0),
  comparar('Mensagem nossa repetida (%)', (l) => l.repetidas > 0), comparar('Cliente mandou só a frase do anúncio (%)', (l) => l.cliente_so_frase_anuncio),
  comparar('Minutos até o link (mediana)', (l) => l.min_ate_link, 'num'), comparar('Mensagens nossas antes do link (mediana)', (l) => l.nossas_antes_link, 'num'),
  comparar('Tempo de resposta (min, mediana)', (l) => l.resp_mediana_min, 'num'), comparar('Maior espera por resposta (min, mediana)', (l) => l.resp_max_min, 'num'),
  comparar('Tamanho médio da nossa mensagem (letras)', (l) => l.tam_medio_nosso, 'num'), comparar('Mensagens do cliente (mediana)', (l) => l.msgs_cliente, 'num'),
];
const corte = (campo) => { const out = {}; for (const l of linhas) { const k = l[campo]; out[k] = out[k] || { conversas: 0, criou: 0 }; out[k].conversas++; if (l.criou) out[k].criou++; } for (const v of Object.values(out)) v.taxa = pct(v.criou, v.conversas); return out; };
const objecoes = {}; for (const l of linhas) for (const o of l.objecoes) { objecoes[o] = objecoes[o] || { conversas: 0, criou: 0 }; objecoes[o].conversas++; if (l.criou) objecoes[o].criou++; } for (const v of Object.values(objecoes)) v.taxa = pct(v.criou, v.conversas);
// funil por etapas (14 dias)
const funil14 = [['Entrou em contato', linhas.length], ['Soube como funciona (texto)', grupo((l) => l.soube || l.link || l.criou).length], ['Recebeu o link', grupo((l) => l.link || l.criou).length], ['Criou o painel', criou.length]];
const linkSemCriar = grupo((l) => l.link && !l.criou).length, criouSemLinkTexto = grupo((l) => l.criou && !l.link).length;
// follow-ups
const fus = evs.filter((e) => e.tipo === 'followup');
const respFu = evs.filter((e) => e.tipo === 'cliente_respondeu_followup');
const fechou = evs.filter((e) => e.tipo === 'painel_fechado');
const porDegrau = [1, 2, 3, 4].map((n) => {
  const f = fus.filter((x) => x.n === n);
  const r = f.filter((x) => respFu.some((y) => y.chat === x.chat && Date.parse(y.followup_t) === Date.parse(x.t)) || evs.some((y) => y.tipo === 'mensagem_cliente' && y.chat === x.chat && Date.parse(y.t) > Date.parse(x.t) && Date.parse(y.t) - Date.parse(x.t) < 48 * 3600e3));
  const p = f.filter((x) => fechou.some((y) => y.chat === x.chat && Date.parse(y.t) > Date.parse(x.t) && Date.parse(y.t) - Date.parse(x.t) < 48 * 3600e3));
  return { degrau: ['7 min', '20 min', '1 h', '3 h'][n - 1], enviados: f.length, responderam: r.length, taxa: pct(r.length, f.length), paineis_48h: p.length };
});
const fb = evs.filter((e) => e.tipo === 'followup_backlog');
const fbResp = fb.filter((x) => evs.some((y) => y.tipo === 'mensagem_cliente' && y.chat === x.chat && Date.parse(y.t) > Date.parse(x.t) && Date.parse(y.t) - Date.parse(x.t) < 48 * 3600e3));
const fbPainel = fb.filter((x) => fechou.some((y) => y.chat === x.chat && Date.parse(y.t) > Date.parse(x.t)));
// hoje (eventos ao vivo)
const hoje0 = new Date(); hoje0.setHours(0, 0, 0, 0);
const evHoje = evs.filter((e) => Date.parse(e.t) >= hoje0.getTime());
const cH = new Set(evHoje.filter((e) => e.tipo === 'mensagem_cliente').map((e) => e.chat));
const sH = new Set(evHoje.filter((e) => e.tipo === 'resposta_robo' && RX.soube.test(e.texto || '')).map((e) => e.chat));
const lH = new Set(evHoje.filter((e) => e.tipo === 'resposta_robo' && RX.link.test(e.texto || '')).map((e) => e.chat));
const pH = Object.values(revs).filter((r) => Date.parse(r.fechou_em) >= hoje0.getTime()).length;
const funilHoje = [['Entrou em contato', cH.size], ['Soube como funciona', sH.size], ['Recebeu o link', lH.size], ['Criou o painel', pH]];
const tempos = { contato_ate_soube_min: Math.round(mediana(linhas.map((l) => l.min_ate_soube)) * 10) / 10, contato_ate_link_min: Math.round(mediana(linhas.map((l) => l.min_ate_link)) * 10) / 10, link_ate_painel_min: Math.round(mediana(linhas.map((l) => l.min_link_ate_painel).filter((x) => x != null && x >= 0)) * 10) / 10, amostra_link_ate_painel: linhas.filter((l) => l.min_link_ate_painel != null && l.min_link_ate_painel >= 0).length };
const saida = { gerado_em: new Date().toISOString(), base: { conversas_no_mapa: mapa.itens.length, com_mensagens_lidas: linhas.length, criou: criou.length, esfriou: esfriou.length, corte_export: new Date(corteAnalise).toISOString(), categorias: mapa.contagens?.por_categoria },
  funil_14d: funil14.map(([etapa, qtd], i) => ({ etapa, qtd, taxa_da_anterior: i ? pct(qtd, funil14[i - 1][1]) : null })), funil_hoje: funilHoje.map(([etapa, qtd], i) => ({ etapa, qtd, taxa_da_anterior: i ? pct(qtd, funilHoje[i - 1][1]) : null })),
  link_sem_criar: linkSemCriar, criou_sem_link_no_texto: criouSemLinkTexto, tempos, comparacao: comp, por_origem: corte('origem'), por_perfil: corte('perfil'), por_objecao: objecoes,
  sem_link: { conversas: grupo((l) => !l.link && !l.criou).length, so_frase_anuncio: grupo((l) => !l.link && !l.criou && l.cliente_so_frase_anuncio).length },
  followups_ao_vivo: porDegrau, atrasado: { enviados: fb.length, responderam: fbResp.length, taxa: pct(fbResp.length, fb.length), paineis: fbPainel.length } };
fs.writeFileSync(path.join(AQUI, 'diagnostico.json'), JSON.stringify(saida, null, 1));
const tab = (cab, rows) => `| ${cab.join(' | ')} |\n|${cab.map(() => '---').join('|')}|\n` + rows.map((r) => `| ${r.join(' | ')} |`).join('\n');
const md = `## Funil (14 dias, ${linhas.length} conversas lidas)\n\n${tab(['Etapa', 'Conversas', 'Da etapa anterior'], saida.funil_14d.map((x) => [x.etapa, x.qtd, x.taxa_da_anterior == null ? '' : x.taxa_da_anterior + '%']))}\n\n## Funil de hoje (robô)\n\n${tab(['Etapa', 'Conversas', 'Da etapa anterior'], saida.funil_hoje.map((x) => [x.etapa, x.qtd, x.taxa_da_anterior == null ? '' : x.taxa_da_anterior + '%']))}\n\nTempos (mediana): contato até saber como funciona ${tempos.contato_ate_soube_min} min; contato até o link ${tempos.contato_ate_link_min} min; link até o painel ${tempos.link_ate_painel_min} min (amostra ${tempos.amostra_link_ate_painel}).\n\n## Fechou x esfriou (${criou.length} x ${esfriou.length})\n\n${tab(['O que', 'Criou painel', 'Esfriou'], comp.map((c) => [c.nome, c.criou, c.esfriou]))}\n\n## Por origem\n\n${tab(['Origem', 'Conversas', 'Criou', 'Taxa'], Object.entries(saida.por_origem).map(([k, v]) => [k, v.conversas, v.criou, v.taxa + '%']))}\n\n## Por perfil\n\n${tab(['Perfil', 'Conversas', 'Criou', 'Taxa'], Object.entries(saida.por_perfil).map(([k, v]) => [k, v.conversas, v.criou, v.taxa + '%']))}\n\n## Por dúvida/objeção (o cliente tocou no assunto)\n\n${tab(['Assunto', 'Conversas', 'Criou', 'Taxa'], Object.entries(objecoes).sort((a, b) => b[1].conversas - a[1].conversas).map(([k, v]) => [k, v.conversas, v.criou, v.taxa + '%']))}\n\n## Follow-ups\n\n${tab(['Degrau', 'Enviados', 'Responderam em 48 h', 'Taxa', 'Painel em 48 h'], porDegrau.map((x) => [x.degrau, x.enviados, x.responderam, (x.taxa ?? 0) + '%', x.paineis_48h]))}\n| Atrasado (backlog) | ${fb.length} | ${fbResp.length} | ${saida.atrasado.taxa ?? 0}% | ${fbPainel.length} |\n`;
fs.writeFileSync(path.join(AQUI, 'DIAGNOSTICO-tabelas.md'), md);
console.log(JSON.stringify({ ok: true, conversas: linhas.length, criou: criou.length, esfriou: esfriou.length }));
