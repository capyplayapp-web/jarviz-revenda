// Leitura (SOMENTE GET) dos revendedores do painel painel.capyplay.site, pelo mesmo Chrome logado do teste grátis.
// Serve para achar o "id do painel" (hashid) e o número de cada revendedor que fechou, casando pelo usuário
// (e-mail) ou pelo telefone. Nunca cria, altera ou apaga nada no painel e nunca imprime o token.
// O token da API paga (D:\Projetos\_segredos) está recusado pelo painel (401); por isso usa-se a sessão do navegador.
'use strict';
const tg = require('./teste-gratis.js');

const soDigitos = (t) => String(t || '').replace(/\D/g, '');
const fim8 = (t) => soDigitos(t).slice(-8);

// Lista todos os revendedores abaixo da conta mestre. numero = ordem de criação (1 = o mais antigo).
function listarRevendedores() {
  return tg.naFila(async () => {
    const { browser, page } = await tg.abrir();
    try {
      const estado = await tg.irParaDashboard(page);
      if (estado !== 'ok') throw new Error('painel: ' + estado);
      const todos = [];
      for (let p = 1; p <= 40; p++) {
        const r = await tg.chamar(page, 'GET', `/api/resellers?per_page=15&page=${p}`);
        if (r.status !== 200) throw new Error(`revendedores HTTP ${r.status}`);
        const lista = r.json?.data || [];
        for (const x of lista) todos.push({ id: x.id, username: x.username || null, email: x.email || null, nome: x.name || null, whatsapp: soDigitos(x.whatsapp) || null, criado_em: x.created_at || null, status: x.status || null,
          creditos: Number.isFinite(Number(x.credits)) ? Number(x.credits) : null, ultimo_login: x.last_login_at || null, ultima_recarga: x.last_recharge_at || null });   // uso (08/11, jornada do revendedor)
        if (!lista.length || !r.json?.meta || p >= (r.json.meta.last_page || 1)) break;
      }
      todos.sort((a, b) => Date.parse(a.criado_em) - Date.parse(b.criado_em));
      todos.forEach((x, i) => { x.numero = i + 1; });
      return todos;
    } finally { await browser.close().catch(() => {}); }
  });
}

// Acha o revendedor do painel que corresponde a um registro (usuário/e-mail ou telefone real).
function casar(reg, lista) {
  const u = String(reg.usuario_painel || '').trim().toLowerCase();
  if (u) {
    const a = lista.find((x) => (x.username || '').toLowerCase() === u || (x.email || '').toLowerCase() === u);
    if (a) return a;
  }
  const f = fim8(reg.telefone);
  if (f.length === 8) {
    const a = lista.filter((x) => x.whatsapp && fim8(x.whatsapp) === f);
    if (a.length === 1) return a[0];
  }
  return null;
}

module.exports = { listarRevendedores, casar, soDigitos, fim8 };
