// Dash de Tráfego (10/11/2026): resultado por anúncio (anuncio_id que o WhatsApp entrega no clique do anúncio)
// e o gasto digitado pelo senhor (gasto.json), para custo por lead e custo por painel.
// GET /api/anuncios?dias=1|7|30 · POST /api/gasto {dia:'AAAA-MM-DD', valor:number|null}
// Só leitura de eventos.jsonl + revendedores.json. Nenhum telefone ou id de conversa sai daqui.
import fs from 'node:fs';
import path from 'node:path';
import { lerEventos, lerRevendedoresLista, PASTA } from './lib.mjs';

const ARQ_GASTO = path.join(PASTA, 'gasto.json');
const chaveDia = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const inicioPeriodo = (dias) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (dias - 1)); return d.getTime(); };

export function lerGasto() {
  try { const g = JSON.parse(fs.readFileSync(ARQ_GASTO, 'utf8')); return g && typeof g.dias === 'object' ? g : { dias: {} }; }
  catch { return { dias: {} }; }
}

export function salvarGasto({ dia, valor }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dia || ''))) throw Error('dia inválido');
  const g = lerGasto();
  if (valor === null || valor === '' || valor === undefined) delete g.dias[dia];
  else {
    const v = Number(String(valor).replace(',', '.'));
    if (!Number.isFinite(v) || v < 0 || v > 1e6) throw Error('valor inválido');
    g.dias[dia] = Math.round(v * 100) / 100;
  }
  g.atualizado_em = new Date().toISOString();
  fs.writeFileSync(ARQ_GASTO, JSON.stringify(g, null, 1));
  return g;
}

export function resumoAnuncios({ dias = 7 } = {}) {
  dias = [1, 7, 30].includes(parseInt(dias, 10)) ? parseInt(dias, 10) : 7;
  const ini = inicioPeriodo(dias);
  const por = new Map();
  for (const e of lerEventos()) {
    if (!e.chat) continue;
    const t = Date.parse(e.t); if (!Number.isFinite(t)) continue;
    let x = por.get(e.chat); if (!x) por.set(e.chat, x = { nova: null, painel: null });
    if (e.tipo === 'conversa_nova' && (!x.nova || t < x.nova.t)) x.nova = { t, id: e.anuncio_id || null, titulo: e.anuncio_titulo || null, rede: e.origem_anuncio || 'sem_registro' };
    else if (e.tipo === 'painel_fechado' && (!x.painel || t < x.painel)) x.painel = t;
  }
  for (const p of lerRevendedoresLista()) {
    const t = Date.parse(p.quando), x = por.get(p.contato_id);
    if (x && Number.isFinite(t) && (!x.painel || t < x.painel)) x.painel = t;
  }

  const grupos = new Map();
  for (const x of por.values()) {
    if (!x.nova || x.nova.t < ini) continue;
    const k = x.nova.id || (x.nova.rede === 'sem_registro' ? '_sem' : '_rede');
    let g = grupos.get(k);
    if (!g) grupos.set(k, g = { id: x.nova.id, titulo: x.nova.titulo, tipo: x.nova.id ? 'anuncio' : k === '_sem' ? 'sem_origem' : 'anuncio_sem_id', leads: 0, paineis: 0, facebook: 0, instagram: 0, primeiro: x.nova.t, ultimo: x.nova.t, horas: [] });
    g.leads++;
    if (x.nova.rede === 'facebook') g.facebook++; else if (x.nova.rede === 'instagram') g.instagram++;
    g.primeiro = Math.min(g.primeiro, x.nova.t); g.ultimo = Math.max(g.ultimo, x.nova.t);
    if (x.painel && x.painel >= x.nova.t - 60e3) { g.paineis++; g.horas.push((x.painel - x.nova.t) / 36e5); }
  }
  const anuncios = [...grupos.values()].map((g) => {
    const h = g.horas.sort((a, b) => a - b);
    return {
      id: g.id, titulo: g.titulo, tipo: g.tipo, leads: g.leads, paineis: g.paineis,
      taxa: g.leads ? g.paineis / g.leads : null, facebook: g.facebook, instagram: g.instagram,
      mediana_h: h.length ? h[h.length >> 1] : null,
      primeiro: new Date(g.primeiro).toISOString(), ultimo: new Date(g.ultimo).toISOString(),
    };
  }).sort((a, b) => (a.tipo === 'sem_origem') - (b.tipo === 'sem_origem') || b.paineis - a.paineis || (b.taxa ?? 0) - (a.taxa ?? 0));

  const gasto = lerGasto(), dd = [];
  for (let i = 0; i < dias; i++) { const d = new Date(ini); d.setDate(d.getDate() + i); const k = chaveDia(d); dd.push({ dia: k, valor: gasto.dias[k] ?? null }); }
  const informados = dd.filter((d) => d.valor != null);
  return {
    gerado_em: new Date().toISOString(), dias,
    anuncios,
    gasto: { por_dia: dd, total: informados.length ? Math.round(informados.reduce((s, d) => s + d.valor, 0) * 100) / 100 : null, dias_informados: informados.length, dias_informados_lista: informados.map((d) => d.dia) },
    limites: ['O número do anúncio só é gravado desde 09/11/2026; leads anteriores aparecem como "sem origem".', 'O gasto não vem da Meta: é o valor que o senhor digita por dia.'],
  };
}
