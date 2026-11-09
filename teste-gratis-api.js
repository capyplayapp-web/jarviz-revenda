// teste-gratis.js — cria TESTE GRÁTIS no painel CapyPlay (painel.capyplay.site)
// Usa a API oficial "Sigma Reseller API" do painel (contrato OpenAPI público em
// https://painel.capyplay.site/api/reseller-api/v1/openapi.json).
//
// Uso no robô:
//   const { criarTeste } = require('./teste-gratis');
//   const r = await criarTeste({ nome: 'Fulano', telefone: '5511999999999' });
//   // r = { ok, usuario, senha, validade, extras, erro }
//
// Token: lido em tempo de execução de D:\Projetos\_segredos\painel-capyplay-api-token.txt
// (ou da variável PAINEL_CAPY_TOKEN_FILE). Nunca é impresso.
// O token precisa dos escopos: packages.read e customers.create
// (customers.read opcional, para não repetir teste do mesmo número).
//
// Ajustes opcionais por variável de ambiente:
//   TESTE_PACOTE_ID     hashid do pacote de teste (senão usa o 1º pacote is_trial=YES)
//   TESTE_HORAS         horas do teste (padrão 6, igual ao "Teste Rápido" do painel)
//   TESTE_PERMITE_CREDITO=1  permite usar pacote de teste que custa crédito (padrão: recusa)
//   TESTE_DIAS_ENTRE    dias mínimos entre testes do mesmo telefone (padrão 30; 0 desliga)

'use strict';
const fs = require('fs');
const path = require('path');

const BASE = 'https://painel.capyplay.site/api/reseller-api/v1';
const TOKEN_FILE = process.env.PAINEL_CAPY_TOKEN_FILE || 'D:/Projetos/_segredos/painel-capyplay-api-token.txt';
const HORAS = Number(process.env.TESTE_HORAS || 6);
const DIAS_ENTRE = Number(process.env.TESTE_DIAS_ENTRE ?? 30);
const REGISTRO = path.join(__dirname, 'testes-gerados.json');

let pacoteCache = null;

function lerToken() {
  return fs.readFileSync(TOKEN_FILE, 'utf8').replace(/^\uFEFF/, '').trim();
}

async function api(metodo, rota, corpo) {
  const token = lerToken();
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const r = await fetch(BASE + rota, {
      method: metodo,
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/json',
        ...(corpo ? { 'Content-Type': 'application/json' } : {}),
      },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    // Respeita o limite (120/min). Só repete leitura; criação nunca é repetida às cegas.
    if (r.status === 429 && metodo === 'GET' && tentativa === 0) {
      const espera = Math.min(Number(r.headers.get('retry-after') || 5), 30);
      await new Promise((ok) => setTimeout(ok, espera * 1000));
      continue;
    }
    let dados = null;
    const texto = await r.text();
    try { dados = texto ? JSON.parse(texto) : null; } catch { dados = { message: texto.slice(0, 200) }; }
    return { status: r.status, dados };
  }
}

function explicarErro(status, dados) {
  const msg = dados?.message || '';
  if (status === 401) return 'token_invalido: token recusado pelo painel (gere outro em Integrações > Reseller API)';
  if (status === 402) return 'integracao_inativa: a integração Reseller API não está ativa/paga no painel';
  if (status === 403) return `sem_permissao (${dados?.error || 'forbidden'}): ${msg}`;
  if (status === 409) return 'conflito: ' + msg;
  if (status === 422) {
    const campos = dados?.errors ? Object.entries(dados.errors).map(([k, v]) => `${k}: ${[].concat(v).join(', ')}`).join('; ') : '';
    return 'validacao: ' + (campos || msg);
  }
  if (status === 429) return 'limite_de_chamadas: tente de novo em instantes';
  return `erro_http_${status}: ${msg}`;
}

async function escolherPacote() {
  if (pacoteCache) return pacoteCache;
  const fixo = process.env.TESTE_PACOTE_ID;
  const todos = [];
  for (let pagina = 1; pagina <= 5; pagina++) {
    const r = await api('GET', `/packages?per_page=100&page=${pagina}`);
    if (r.status !== 200) throw new Error(explicarErro(r.status, r.dados));
    todos.push(...(r.dados?.data || []));
    const meta = r.dados?.meta;
    if (!meta || !meta.last_page || pagina >= meta.last_page) break;
  }
  let p = fixo
    ? todos.find((x) => x.id === fixo)
    : todos.find((x) => x.is_trial === 'YES' && String(x.status).toUpperCase() === 'ACTIVE' && !x.is_adult)
      || todos.find((x) => x.is_trial === 'YES');
  if (!p) throw new Error('sem_pacote_de_teste: nenhum pacote com is_trial=YES no painel (defina TESTE_PACOTE_ID)');
  if (Number(p.credits || 0) > 0 && process.env.TESTE_PERMITE_CREDITO !== '1') {
    throw new Error(`pacote_custa_credito: o pacote "${p.name}" consome ${p.credits} crédito(s); recusado por segurança`);
  }
  pacoteCache = p;
  return p;
}

function soDigitos(t) { return String(t || '').replace(/\D/g, ''); }

function lerRegistro() { try { return JSON.parse(fs.readFileSync(REGISTRO, 'utf8')); } catch { return {}; } }
function gravarRegistro(reg) { try { fs.writeFileSync(REGISTRO, JSON.stringify(reg, null, 2)); } catch {} }

async function criarTeste({ nome, telefone } = {}) {
  const fone = soDigitos(telefone);
  const vazio = { ok: false, usuario: null, senha: null, validade: null, extras: {} };
  try {
    if (DIAS_ENTRE > 0 && fone) {
      const ultimo = lerRegistro()[fone];
      if (ultimo && Date.now() - Date.parse(ultimo.criado_em) < DIAS_ENTRE * 864e5) {
        return { ...vazio, erro: `ja_teve_teste: este número já recebeu teste em ${ultimo.criado_em} (usuário ${ultimo.usuario})` };
      }
    }

    const pacote = await escolherPacote();
    const corpo = {
      server_id: pacote.server_id,
      package_id: pacote.id,
      trial_hours: HORAS,
      connections: 1,
      name: (nome || 'Teste WhatsApp').toString().slice(0, 80),
      whatsapp: fone || null,
      note: 'Teste grátis gerado pelo robô do WhatsApp',
    };
    const r = await api('POST', '/customers', corpo);
    if (r.status !== 201 && r.status !== 200) return { ...vazio, erro: explicarErro(r.status, r.dados) };

    const c = r.dados?.data || r.dados || {};
    const saida = {
      ok: true,
      usuario: c.username || null,
      senha: c.password || null,
      validade: c.expires_at || null,
      extras: {
        id: c.id || null,
        validade_local: c.expires_at_tz || null,
        is_trial: c.is_trial || null,
        pacote: c.package || pacote.name || null,
        servidor: c.server || pacote.server || null,
        conexoes: c.connections ?? null,
        m3u: c.m3u_url || null,
        m3u_curto: c.m3u_url_short || null,
        playlist: c.playlist || null,
        renovar: c.renew_url || null,
        horas: HORAS,
      },
      erro: null,
    };
    if (fone) {
      const reg = lerRegistro();
      reg[fone] = { criado_em: new Date().toISOString(), usuario: saida.usuario, id: saida.extras.id };
      gravarRegistro(reg);
    }
    return saida;
  } catch (e) {
    return { ...vazio, erro: e.message || String(e) };
  }
}

// Leitura para diagnóstico: perfil, saldo e pacotes de teste (não cria nada).
async function diagnostico() {
  const me = await api('GET', '/me');
  if (me.status !== 200) return { ok: false, erro: explicarErro(me.status, me.dados) };
  const pk = await api('GET', '/packages?per_page=100');
  const pacotes = (pk.dados?.data || []).map((p) => ({ id: p.id, nome: p.name, servidor: p.server, teste: p.is_trial, creditos: p.credits, duracao: `${p.duration} ${p.duration_in}`, status: p.status }));
  return { ok: true, perfil: me.dados?.data || me.dados, pacotes, erro: pk.status === 200 ? null : explicarErro(pk.status, pk.dados) };
}

module.exports = { criarTeste, diagnostico };

// node teste-gratis.js --diag   (só leitura)
if (require.main === module && process.argv.includes('--diag')) {
  diagnostico().then((r) => console.log(JSON.stringify(r, null, 2)));
}
