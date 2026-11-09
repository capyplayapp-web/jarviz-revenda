// testar.mjs - testes do catálogo (busca, limpeza de título, adulto, capa, legenda, atualização com painel falso, desempenho).
//   node --expose-gc catalogo/testar.mjs          (o --expose-gc só deixa a medida de memória mais justa)
// Não toca no painel real, não escreve em catalogo.json de verdade e não manda mensagem a ninguém.
// Tudo roda com painel/TMDB FALSOS em localhost e em pastas temporárias.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const PASTA = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'catalogo-teste-'));
process.env.CATALOGO_SAIDA = path.join(TMP, 'saida'); fs.mkdirSync(process.env.CATALOGO_SAIDA);
const cat = require('./catalogo.js');
const T = require('./texto-disponibilidade.js');

let ok = 0, falhas = 0; const lista = [];
function t(nome, cond, detalhe = '') {
  if (cond) ok++; else { falhas++; lista.push(nome + (detalhe ? ' -> ' + detalhe : '')); }
  console.log((cond ? 'PASS ' : 'FAIL ') + nome + (!cond && detalhe ? '  [' + detalhe + ']' : ''));
}
const titulos = (r) => r.map((x) => x.titulo + (x.ano ? ' (' + x.ano + ')' : ''));

// ---------------------------------------------------------------- imagens de teste
function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function png(w, h, ruido = true) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  let s = 12345;
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w * 3; x++) { s = (Math.imul(s, 1103515245) + 12345) >>> 0; raw[y * (w * 3 + 1) + 1 + x] = ruido ? (s >>> 16) & 255 : 60; } }
  const chunk = (tipo, dados) => { const l = Buffer.alloc(4); l.writeUInt32BE(dados.length); const td = Buffer.concat([Buffer.from(tipo), dados]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const IMG_OK = png(300, 450), IMG_PEQUENA_DIM = png(100, 100), IMG_1X1 = png(1, 1, false);

// ---------------------------------------------------------------- servidor falso (painel Xtream + imagens + TMDB)
const CRED = { u: 'usuario-teste-123', p: 'senha-secreta-xyz' };
const hits = { capaOk: 0 };
let baseUrl = '';
const VOD_CATS = [{ category_id: '1', category_name: 'FILMES | AÇÃO' }, { category_id: '2', category_name: 'FILMES | ADULTOS +18' }, { category_id: '3', category_name: 'FILMES | DRAMA' }, { category_id: '4', category_name: 'XXX Hot' }];
const SER_CATS = [{ category_id: '10', category_name: 'SÉRIES | NETFLIX' }, { category_id: '11', category_name: 'SÉRIES | ADULTO' }];
const servidor = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const j = (o, st = 200) => { res.writeHead(st, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (u.pathname === '/player_api.php') {
    if (u.searchParams.get('username') !== CRED.u || u.searchParams.get('password') !== CRED.p) return j({ user_info: { auth: 0 } });
    const a = u.searchParams.get('action');
    if (!a) return j({ user_info: { auth: 1, status: 'Active' }, server_info: {} });
    if (a === 'get_vod_categories') return j(VOD_CATS);
    if (a === 'get_series_categories') return j(SER_CATS);
    if (a === 'get_vod_streams') return j([
      { stream_id: 101, name: 'FILMES | O PODEROSO CHEFÃO (1972) [4K]', category_id: '3', rating: '9.2', stream_icon: baseUrl + '/img/ok.png' },
      { stream_id: 102, name: '[LEG] O Poderoso Chefão (1972)', category_id: '3', rating: '9.2', stream_icon: '' },
      { stream_id: 103, name: 'Vingadores: Ultimato - 2019 DUBLADO', category_id: '1', rating: '8.4', stream_icon: baseUrl + '/img/ok.png' },
      { stream_id: 104, name: 'Filme Proibido XXX', category_id: '2', rating: '5', stream_icon: baseUrl + '/img/ok.png' },
      { stream_id: 105, name: 'Noites Quentes', category_id: '4', rating: '5', stream_icon: baseUrl + '/img/ok.png' },
      { stream_id: 106, name: 'Mad Max: Estrada da Fúria HD', category_id: '1', rating: '8.1', stream_icon: baseUrl + '/img/html' },
      { stream_id: 107, name: 'Matrix (1999) (LEG)', category_id: '1', rating_5based: 4.2, stream_icon: baseUrl + '/img/ok.png' },
    ]);
    if (a === 'get_series') return j([
      { series_id: 201, name: 'SERIES | NETFLIX | Round 6 FHD', category_id: '10', rating: '8.0', cover: baseUrl + '/img/ok.png' },
      { series_id: 202, name: 'Série Adulta Qualquer', category_id: '11', rating: '5', cover: baseUrl + '/img/ok.png' },
    ]);
    return j([]);
  }
  if (u.pathname === '/img/ok.png') { hits.capaOk++; res.writeHead(200, { 'content-type': 'image/png' }); return res.end(IMG_OK); }
  if (u.pathname === '/img/tmdb.png') { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(IMG_OK); }
  if (u.pathname === '/img/html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html>' + 'x'.repeat(9000) + '</html>'); }
  if (u.pathname === '/img/html-curto') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html>erro</html>'); }
  if (u.pathname === '/img/1x1.png') { res.writeHead(200); return res.end(IMG_1X1); }
  if (u.pathname === '/img/icone.png') { res.writeHead(200); return res.end(IMG_PEQUENA_DIM); }
  if (u.pathname === '/img/404') { res.writeHead(404); return res.end('nao'); }
  if (u.pathname === '/3/search/movie' || u.pathname === '/3/search/tv') {
    hits.tmdbKey = u.searchParams.get('api_key');
    const q = u.searchParams.get('query');
    if (/Raro Sem Capa/.test(q)) return j({ results: [{ title: 'Outro Filme Totalmente Diferente', poster_path: '/tmdb.png' }] });
    return j({ results: [{ title: q, poster_path: '/tmdb.png' }] });
  }
  res.writeHead(404); res.end();
});
await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
baseUrl = 'http://127.0.0.1:' + servidor.address().port;

// ================================================================ 1. limpeza de título
console.log('\n== 1. limpeza de título');
const L = (x) => cat.limparTitulo(x);
t('limpa prefixo FILMES | e [4K]', L('FILMES | O Poderoso Chefão (1972) [4K]').titulo === 'O Poderoso Chefão' && L('FILMES | O Poderoso Chefão (1972) [4K]').ano === '1972');
t('limpa [LEG] no começo', L('[LEG] Vingadores: Ultimato (2019)').titulo === 'Vingadores: Ultimato');
t('ano no fim " - 2022 DUBLADO"', JSON.stringify(L('Avatar - 2022 DUBLADO')) === JSON.stringify({ titulo: 'Avatar', ano: '2022' }));
t('não corta "Mad Max" nem "Star Wars"', L('Mad Max (1979)').titulo === 'Mad Max' && L('Star Wars - Episódio IV').titulo === 'Star Wars - Episódio IV');
t('título "2012" fica', L('2012').titulo === '2012');
t('prefixo duplo NETFLIX | 4K |', L('SERIES | NETFLIX | Round 6 FHD').titulo === 'Round 6');
t('normaliza acento e hífen', cat.normalizar('Homem-Aranha: De Volta ao Lar!') === 'homem aranha de volta ao lar');
t('embeleza título todo em maiúsculas', cat.embelezar('O PODEROSO CHEFÃO') === 'O Poderoso Chefão' && cat.embelezar('Vingadores') === 'Vingadores');

// ================================================================ 2. busca (catálogo-semente)
console.log('\n== 2. busca no catálogo-semente (FICTÍCIO, só para teste)');
const gen = await import('./atualizar.mjs');
const semente = gen.gerarSemente();
cat.configurar({ arquivo: semente.arq, permitirSemente: true, capasDir: path.join(TMP, 'capas') });
const car = cat.carregar();
t('semente carrega', car.ok && car.total === 32 && car.semente === true, JSON.stringify(car));
const primeiro = (q, opc) => cat.buscar(q, opc)[0];
const casos = [
  ['título exato com acento', 'O Poderoso Chefão', 'O Poderoso Chefão'],
  ['sem acento e minúsculas', 'o poderoso chefao', 'O Poderoso Chefão'],
  ['sem artigo', 'poderoso chefao', 'O Poderoso Chefão'],
  ['erro de digitação (z no lugar de s)', 'poderozo chefao', 'O Poderoso Chefão'],
  ['letras trocadas', 'vingadroes ultimato', 'Vingadores: Ultimato'],
  ['parcial pelo subtítulo', 'ultimato', 'Vingadores: Ultimato'],
  ['parcial sem subtítulo', 'sociedade do anel', 'O Senhor dos Anéis: A Sociedade do Anel'],
  ['hífen vira espaço', 'homem aranha sem volta para casa', 'Homem-Aranha: Sem Volta Para Casa'],
  ['número arábico = romano', 'rocky 2', 'Rocky II'],
  ['romano = arábico', 'toy story ii', 'Toy Story 2'],
  ['com ano certo desempata', 'batman 2022', 'Batman'],
  ['pedido com "o filme"', 'o filme pantera negra', 'Pantera Negra'],
  ['pedido "série X" devolve série', 'serie breaking bad', 'Breaking Bad'],
  ['título com artigo estrangeiro', 'casa de papel', 'La Casa de Papel'],
  ['artigo "a" no pedido', 'a freira', 'A Freira'],
  ['digitado grudado', 'pantheranegra', null], // sem chute para erro grande
  ['typo em título longo', 'stranger thinks', 'Stranger Things'],
  ['com ano no pedido', 'ainda estou aqui 2024', 'Ainda Estou Aqui'],
  ['número no título', 'velozes e furiosos 7', 'Velozes e Furiosos 7'],
  ['maiúsculas', 'GAME OF THRONES', 'Game of Thrones'],
];
for (const [nome, q, esperado] of casos) {
  const r = primeiro(q);
  t('busca: ' + nome + ' ("' + q + '")', esperado === null ? !r : !!r && r.titulo === esperado, JSON.stringify(titulos(cat.buscar(q))));
}
console.log('\n-- casos que devem voltar VAZIO (nunca chutar)');
for (const [nome, q] of [['título inexistente', 'Filme Que Nao Existe Xyz'], ['palavra genérica curta', 'amor'], ['sequência que não existe', 'toy story 5'], ['lixo digitado', 'asdkjh qwe'], ['vazio', ''], ['só ano', '2019'], ['palavra curtíssima', 'up']]) {
  const r = cat.buscar(q);
  t('vazio: ' + nome + ' ("' + q + '")', r.length === 0, JSON.stringify(titulos(r)));
}
t('ano errado derruba confiança', cat.buscar('batman 1999').every((x) => x.confianca < 0.9));
t('palavras em outra ordem derrubam confiança', cat.buscar('ultimato vingadores').every((x) => x.confianca < 0.9) && primeiro('vingadores ultimato').confianca === 1);
t('confiança dentro de 0..1 e ordenada', (() => { const r = cat.buscar('poderoso chefao', { max: 5 }); return r.every((x) => x.confianca >= 0 && x.confianca <= 1) && r.every((x, i) => i === 0 || r[i - 1].confianca >= x.confianca); })());
t('max respeita limite', cat.buscar('batman', { max: 1 }).length === 1);
t('campos do resultado', (() => { const r = cat.buscar('shrek')[0]; return r && ['titulo', 'ano', 'tipo', 'categoria', 'capa_url', 'nota', 'confianca'].every((k) => k in r); })());

// ---- semente nunca é usada de verdade
cat.configurar({ permitirSemente: false });
t('semente é IGNORADA por padrão (nunca confirma título fictício)', cat.buscar('o poderoso chefao').length === 0);
cat.configurar({ permitirSemente: true });

// ================================================================ 3. atualização com painel falso + adulto
console.log('\n== 3. atualizar.mjs contra painel FALSO (localhost)');
const credArq = path.join(TMP, 'credencial.json');
fs.writeFileSync(credArq, JSON.stringify({ servidores: ['http://127.0.0.1:1', baseUrl], usuario: CRED.u, senha: CRED.p }));
process.env.CATALOGO_CREDENCIAL_ARQUIVO = credArq;
const gen2 = await import('./atualizar.mjs?pipeline'); // novo módulo para ler a credencial do ambiente de teste
const linhas = [];
const r1 = await gen2.atualizar({ log: (...a) => linhas.push(a.join(' ')) });
t('atualização ok (pulou servidor fora do ar)', r1.ok === true, JSON.stringify(r1).slice(0, 200));
const saida = JSON.parse(fs.readFileSync(path.join(process.env.CATALOGO_SAIDA, 'catalogo.json'), 'utf8'));
const meta = JSON.parse(fs.readFileSync(path.join(process.env.CATALOGO_SAIDA, 'catalogo-meta.json'), 'utf8'));
const tit = saida.itens.map((i) => i.titulo);
t('meta: totais e data', meta.total === saida.itens.length && meta.filmes === 4 && meta.series === 1 && !!meta.atualizado_em, JSON.stringify(meta));
t('adulto ignorado (2 filmes + 1 série)', meta.adultos_ignorados === 3 && !tit.some((x) => /Proibido|Quentes|Adulta/.test(x)), JSON.stringify(tit));
t('versões do mesmo título viram um só', tit.filter((x) => x === 'O Poderoso Chefão').length === 1);
t('título limpo e capitalizado', tit.includes('O Poderoso Chefão') && tit.includes('Vingadores: Ultimato') && tit.includes('Round 6') && tit.includes('Matrix'), JSON.stringify(tit));
t('ano extraído do nome', saida.itens.find((i) => i.titulo === 'Vingadores: Ultimato')?.ano === '2019' && saida.itens.find((i) => i.titulo === 'Matrix')?.ano === '1999');
t('nota 5 estrelas convertida', saida.itens.find((i) => i.titulo === 'Matrix')?.nota === 8.4);
t('credencial NÃO aparece nos arquivos nem no log', ![JSON.stringify(saida), JSON.stringify(meta), linhas.join('\n')].some((x) => x.includes(CRED.p) || x.includes(CRED.u)));
t('stream_url/credencial não foram gravados', !JSON.stringify(saida).includes('player_api') && !JSON.stringify(saida).includes('username'));
// busca no catálogo recém-gerado (real, não semente)
cat.configurar({ arquivo: path.join(process.env.CATALOGO_SAIDA, 'catalogo.json'), permitirSemente: false });
cat.carregar();
t('busca no catálogo gerado funciona', primeiro('poderoso chefao')?.titulo === 'O Poderoso Chefão' && primeiro('rodada 6') === undefined);
t('ADULTO BLOQUEADO na busca (nome exato do título adulto)', cat.buscar('Filme Proibido XXX').length === 0 && cat.buscar('noites quentes').length === 0);
// adulto que vem escondido no arquivo (defesa na carga)
const adArq = path.join(TMP, 'com-adulto.json');
fs.writeFileSync(adArq, JSON.stringify({ itens: [{ id: 1, tipo: 'filme', titulo: 'Titulo Bonito Normal', categoria: 'Drama' }, { id: 2, tipo: 'filme', titulo: 'Outro Filme Qualquer', categoria: 'Adultos +18' }, { id: 3, tipo: 'filme', titulo: 'Coisa Hentai Total', categoria: 'Animes' }] }));
cat.configurar({ arquivo: adArq }); cat.carregar();
t('adulto escondido no arquivo é barrado na carga', cat.estado().total === 1 && cat.buscar('outro filme qualquer').length === 0 && cat.buscar('coisa hentai total').length === 0);
// sem credencial
const gen3 = await import('./atualizar.mjs?semcred');
process.env.CATALOGO_CREDENCIAL_ARQUIVO = path.join(TMP, 'nao-existe.json');
const gen4 = await import('./atualizar.mjs?semcred2');
let semCred = null; try { await gen4.atualizar({}); } catch (e) { semCred = e; }
t('sem credencial: erro claro, nada baixado', semCred instanceof gen4.SemCredencial && /credencial\.json/.test(gen4.MENSAGEM_SEM_CREDENCIAL));
// senha errada
fs.writeFileSync(credArq, JSON.stringify({ servidores: [baseUrl], usuario: CRED.u, senha: 'errada' }));
process.env.CATALOGO_CREDENCIAL_ARQUIVO = credArq;
const gen5 = await import('./atualizar.mjs?senhaerrada');
let erroLogin = null; try { await gen5.atualizar({ log() {} }); } catch (e) { erroLogin = e; }
t('login recusado: falha sem apagar o catálogo e sem vazar a senha', erroLogin && /login_falhou/.test(erroLogin.message) && !erroLogin.message.includes('errada') && fs.existsSync(path.join(process.env.CATALOGO_SAIDA, 'catalogo.json')));
void gen3;

// ================================================================ 4. capa
console.log('\n== 4. capa');
cat.configurar({ arquivo: path.join(process.env.CATALOGO_SAIDA, 'catalogo.json'), capasDir: path.join(TMP, 'capas2'), tmdbBase: baseUrl, tmdbImgBase: baseUrl + '/img', tmdbKeyFile: path.join(TMP, 'sem-chave.local') });
delete process.env.TMDB_API_KEY;
cat.carregar();
const poderoso = primeiro('poderoso chefao');
const c1 = await cat.capaInfo(poderoso);
t('capa do painel baixada e validada (png 300x450)', !!c1.caminho && c1.fonte === 'painel' && fs.statSync(c1.caminho).size > 6000 && cat.validarImagem(fs.readFileSync(c1.caminho)).ok, JSON.stringify(c1));
const antes = hits.capaOk;
const c2 = await cat.capaInfo(poderoso);
t('segunda chamada usa cache (não baixa de novo)', c2.caminho === c1.caminho && c2.fonte === 'cache' && hits.capaOk === antes);
const mad = primeiro('mad max estrada da furia');
t('capa HTML (painel devolveu página) é recusada e sem TMDB vira null', mad && (await cat.capa(mad)) === null, JSON.stringify(await cat.capaInfo(mad)));
const falsos = [
  ['HTML curto', { chave: 'x1', titulo: 'Fake Um', tipo: 'filme', capa_url: baseUrl + '/img/html-curto' }],
  ['imagem 1x1', { chave: 'x2', titulo: 'Fake Dois', tipo: 'filme', capa_url: baseUrl + '/img/1x1.png' }],
  ['imagem 100x100 (ícone)', { chave: 'x3', titulo: 'Fake Tres', tipo: 'filme', capa_url: baseUrl + '/img/icone.png' }],
  ['erro 404', { chave: 'x4', titulo: 'Fake Quatro', tipo: 'filme', capa_url: baseUrl + '/img/404' }],
  ['sem URL', { chave: 'x5', titulo: 'Fake Cinco', tipo: 'filme', capa_url: null }],
  ['URL inválida (file://)', { chave: 'x6', titulo: 'Fake Seis', tipo: 'filme', capa_url: 'file:///C:/Windows/win.ini' }],
];
for (const [nome, it] of falsos) { const r = await cat.capaInfo(it); t('capa ruim recusada: ' + nome, r.caminho === null, r.motivo); }
// TMDB
process.env.TMDB_API_KEY = 'CHAVE_FALSA_DE_TESTE';
const fb = await cat.capaInfo({ chave: 'filme:tmdb1', titulo: 'Matrix', ano: '1999', tipo: 'filme', capa_url: baseUrl + '/img/404' });
t('fallback TMDB quando a capa do painel é ruim (chave presente)', fb.fonte === 'tmdb' && !!fb.caminho && hits.tmdbKey === 'CHAVE_FALSA_DE_TESTE', JSON.stringify(fb));
const fb2 = await cat.capaInfo({ chave: 'filme:tmdb2', titulo: 'Filme Raro Sem Capa', tipo: 'filme', capa_url: null });
t('TMDB só vale se o título for igual (não troca por outro filme)', fb2.caminho === null && /tmdb_sem_resultado_igual/.test(fb2.motivo), fb2.motivo);
delete process.env.TMDB_API_KEY;
const fb3 = await cat.capaInfo({ chave: 'filme:tmdb3', titulo: 'Outro Sem Chave', tipo: 'filme', capa_url: null });
t('sem chave TMDB: sem capa, sem inventar chave', fb3.caminho === null && /sem_chave_tmdb/.test(fb3.motivo), fb3.motivo);

// ================================================================ 5. legendas e responder()
console.log('\n== 5. legenda e responder()');
const lf = T.legenda({ titulo: 'Shrek', ano: '2001', tipo: 'filme', chave: 'a' }), ls = T.legenda({ titulo: 'Round 6', ano: '2021', tipo: 'serie', chave: 'b' });
t('legenda de filme', /Shrek \(2001\)\nEsse filme (já )?está disponível na CapyPlay\.$/.test(lf), lf);
t('legenda de série não promete "todos os episódios"', /Essa série (já )?está disponível na CapyPlay\.$/.test(ls) && !/epis[oó]dios/i.test(ls), ls);
t('"todos os episódios" só com confirmação explícita', /todos os episódios/.test(T.legenda({ titulo: 'X', tipo: 'serie', chave: 'c' }, { todosEpisodios: true })));
t('não achou: nunca diz que não tem', T.naoAchou() === 'Vou confirmar se esse título já está na lista e te aviso.' && !/n[aã]o (tem|temos|existe)|indispon/i.test(T.naoAchou()));
t('legendas sem emoji', ![lf, ls, T.naoAchou(), T.desambiguar([{ titulo: 'A', ano: '1' }, { titulo: 'B', ano: '2' }]), T.repetida({ tipo: 'filme' })].some((x) => /\p{Extended_Pictographic}/u.test(x)));

const dois = path.join(TMP, 'dois.json');
fs.writeFileSync(dois, JSON.stringify({ itens: [
  { id: 1, tipo: 'filme', titulo: 'Batman', ano: '1989', categoria: 'Ação', nota: 7.5, capa: baseUrl + '/img/ok.png' },
  { id: 2, tipo: 'filme', titulo: 'Batman', ano: '2022', categoria: 'Ação', nota: 7.8, capa: baseUrl + '/img/ok.png' },
  { id: 3, tipo: 'serie', titulo: 'Round 6', ano: '2021', categoria: 'Suspense', nota: 8, capa: baseUrl + '/img/ok.png' },
  { id: 4, tipo: 'filme', titulo: 'Sem Capa Nenhuma', ano: '2020', categoria: 'Drama', nota: 6, capa: null },
] }));
cat.configurar({ arquivo: dois, capasDir: path.join(TMP, 'capas3'), permitirSemente: false }); cat.carregar();
const ra = await cat.responder('batman');
t('responder: título repetido (2 Batman) pergunta qual, sem capa', ra.ambiguo && !ra.enviarCapa && /Batman \((1989|2022)\) e Batman \((1989|2022)\)/.test(ra.legenda) && ra.avisar === false, ra.legenda);
const rb = await cat.responder('round 6');
t('responder: série com capa + legenda, sem avisar', rb.achou && rb.enviarCapa && fs.existsSync(rb.capa) && /Essa série/.test(rb.legenda) && !rb.avisar, JSON.stringify({ ...rb, itens: undefined }));
const rc = await cat.responder('round 6', { jaEnviadas: [rb.item.chave] });
t('responder: não manda a mesma capa duas vezes', rc.achou && rc.repetida && !rc.enviarCapa && /já te mostrei/.test(rc.legenda));
const rd = await cat.responder('coisa que ninguém tem');
t('responder: não achou -> "vou confirmar" + avisar', !rd.achou && rd.avisar === true && rd.legenda === T.naoAchou() && /conteudo_nao_encontrado/.test(rd.motivo));
const re = await cat.responder('sem capa nenhuma');
t('responder: achou mas sem capa -> só texto, ainda disponível', re.achou && !re.enviarCapa && /disponível/.test(re.legenda) && /sem_capa/.test(re.motivo), re.motivo);
cat.configurar({ arquivo: path.join(TMP, 'inexistente.json') }); cat.carregar();
const rf = await cat.responder('batman');
t('responder: catálogo ausente -> "vou confirmar" + avisar (nunca nega)', !rf.achou && rf.avisar && rf.legenda === T.naoAchou() && /catalogo_indisponivel/.test(rf.motivo));

// ================================================================ 6. desempenho (60 mil itens sintéticos)
console.log('\n== 6. desempenho com 60.000 itens SINTÉTICOS');
function sintetico(n) {
  let s = 987654321; const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const sil = 'ba be bi bo bu ca ce ci co cu da de di do du fa fe fi fo fu ga ge gi go gu la le li lo lu ma me mi mo mu na ne ni no nu pa pe pi po pu ra re ri ro ru sa se si so su ta te ti to tu va ve vi vo vu bra tra pro gra cha nha lha ção ões'.split(' ');
  const palavra = () => { let w = ''; const k = 2 + Math.floor(rnd() * 3); for (let i = 0; i < k; i++) w += sil[Math.floor(rnd() * sil.length)]; return w; };
  const vocab = Array.from({ length: 22000 }, palavra);
  const comuns = ['amor', 'vida', 'noite', 'casa', 'rei', 'guerra', 'dia', 'segredo', 'sombra', 'cidade', 'o', 'a', 'de', 'do', 'da', 'e', 'dos', 'um'];
  const itens = [];
  for (let i = 0; i < n; i++) {
    const k = 1 + Math.floor(rnd() * 4); const p = [];
    for (let j = 0; j < k; j++) p.push(rnd() < 0.3 ? comuns[Math.floor(rnd() * comuns.length)] : vocab[Math.floor(Math.pow(rnd(), 1.6) * vocab.length)]);
    const titulo = p.map((x) => x[0].toUpperCase() + x.slice(1)).join(' ');
    itens.push({ id: i + 1, tipo: rnd() < 0.55 ? 'filme' : 'serie', titulo, ano: String(1980 + Math.floor(rnd() * 45)), categoria: 'Drama', nota: Math.round(rnd() * 90) / 10, capa: 'http://x/' + i + '.jpg' });
  }
  return { itens, rnd };
}
const { itens: grande, rnd } = sintetico(60000);
const arqGrande = path.join(TMP, 'grande.json');
fs.writeFileSync(arqGrande, JSON.stringify({ itens: grande }));
if (global.gc) global.gc();
const m0 = process.memoryUsage();
const tc0 = process.hrtime.bigint();
cat.configurar({ arquivo: arqGrande, permitirSemente: false });
const cg = cat.carregar();
const tcarga = Number(process.hrtime.bigint() - tc0) / 1e6;
if (global.gc) global.gc();
const m1 = process.memoryUsage();
t('60 mil itens carregados', cg.ok && cg.total >= 59000, JSON.stringify(cg));
const mb = (x) => Math.round(x / 1048576);
console.log(`   arquivo ${mb(fs.statSync(arqGrande).size)} MB | carga+índice ${tcarga.toFixed(0)} ms | heap +${mb(m1.heapUsed - m0.heapUsed)} MB | rss +${mb(m1.rss - m0.rss)} MB (rss total ${mb(m1.rss)} MB)`);
const tipo = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const trocaLetra = (s) => { const i = 1 + Math.floor(rnd() * (s.length - 2)); return s.slice(0, i) + s[i + 1] + s[i] + s.slice(i + 2); };
const consultas = [];
for (let i = 0; i < 300; i++) {
  const it = grande[Math.floor(rnd() * grande.length)]; const tt = it.titulo;
  const k = i % 5;
  consultas.push({ q: k === 0 ? tt : k === 1 ? tipo(tt) : k === 2 ? tipo(tt.replace(/[^ ]+/, (w) => (w.length > 5 ? trocaLetra(w) : w))) : k === 3 ? tipo(tt).split(' ').slice(0, 2).join(' ') : 'zzqx ' + tt.slice(0, 3) + 'kw', alvo: it, k });
}
['amor', 'vida', 'o amor', 'noite de amor', 'a casa'].forEach((q) => consultas.push({ q, alvo: null, k: 9 }));
cat.buscar('aquecimento'); // aquece o JIT, como acontece com o robô ligado
const tempos = []; let acertoExato = 0, totalExato = 0, acertoTypo = 0, totalTypo = 0, lixoComResultado = 0, totalLixo = 0;
for (const c of consultas) {
  const a = process.hrtime.bigint(); const r = cat.buscar(c.q); const ms = Number(process.hrtime.bigint() - a) / 1e6; tempos.push(ms);
  const tgt = c.alvo && cat.normalizar(c.alvo.titulo);
  const acertou = c.alvo && r.some((x) => cat.normalizar(x.titulo) === tgt);
  if (c.k <= 1) { totalExato++; if (acertou) acertoExato++; }
  if (c.k === 2) { totalTypo++; if (acertou) acertoTypo++; }
  if (c.k === 4) { totalLixo++; if (r.length) lixoComResultado++; }
}
tempos.sort((x, y) => x - y);
const media = tempos.reduce((s, x) => s + x, 0) / tempos.length, p95 = tempos[Math.floor(tempos.length * 0.95)], maxi = tempos[tempos.length - 1], p50 = tempos[Math.floor(tempos.length / 2)];
console.log(`   ${tempos.length} buscas: mediana ${p50.toFixed(2)} ms | média ${media.toFixed(2)} ms | p95 ${p95.toFixed(2)} ms | máx ${maxi.toFixed(2)} ms`);
console.log(`   acerto exato/sem acento ${acertoExato}/${totalExato} | com erro de digitação ${acertoTypo}/${totalTypo} | lixo que devolveu resultado ${lixoComResultado}/${totalLixo}`);
t('tempo: média < 50 ms', media < 50, media.toFixed(2));
t('tempo: p95 < 50 ms', p95 < 50, p95.toFixed(2));
t('tempo: pior caso < 50 ms (inclui palavras muito comuns)', maxi < 50, maxi.toFixed(2));
t('acerto exato >= 98%', acertoExato / totalExato >= 0.98, `${acertoExato}/${totalExato}`);
t('acerto com 1 erro de digitação >= 85%', acertoTypo / totalTypo >= 0.85, `${acertoTypo}/${totalTypo}`);
t('lixo não devolve resultado (>= 98% vazio)', lixoComResultado / totalLixo <= 0.02, `${lixoComResultado}/${totalLixo}`);
t('memória: heap do catálogo < 250 MB', mb(m1.heapUsed - m0.heapUsed) < 250, mb(m1.heapUsed - m0.heapUsed) + ' MB');

// ================================================================ fim
servidor.close();
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ok */ }
try { fs.unlinkSync(path.join(PASTA, 'catalogo-semente.json')); } catch { /* ok */ }
console.log(`\nRESULTADO: ${ok} passaram, ${falhas} falharam (${ok + falhas} verificações)`);
if (falhas) { console.log('FALHAS:\n - ' + lista.join('\n - ')); process.exitCode = 1; }
