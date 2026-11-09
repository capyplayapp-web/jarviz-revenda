# Catálogo no robô da revenda: como ligar (para o dono do bot.js)

Nada aqui foi aplicado em `bot.js` nem em `base.md`. O módulo só é lido quando o bot chamar.

## Estado em 08/11/2026

- Pronto e testado (87 verificações, `node --expose-gc catalogo\testar.mjs`): busca, limpeza de título, filtro de adulto, capa com cache e validação, legendas, atualização contra painel falso.
- **Falta a credencial de leitura do painel.** Sem `catalogo\credencial.json` o `atualizar.mjs` sai com código 2 e imprime o que fazer. Enquanto não existir `catalogo.json`, `responder()` devolve "Vou confirmar se esse título já está na lista e te aviso." com `avisar: true` (nunca nega, nunca inventa).
- A API oficial de Revenda (`/api/reseller-api/v1`) não lista conteúdo (só clientes, pacotes, servidores, relatórios), então não serve de fonte. O token de lá também não é necessário para o catálogo.

## Arquivos (pasta `catalogo\`)

| Arquivo | Para quê |
|---|---|
| `catalogo.js` | CommonJS. `carregar()`, `buscar(consulta,{max,min,tipo})`, `capa(item)`, `capaInfo(item)`, `responder(consulta,{jaEnviadas})`, `estado()` |
| `texto-disponibilidade.js` | `legenda(item)`, `naoAchou()`, `desambiguar(itens)`, `repetida(item)` |
| `atualizar.mjs` | Baixa do painel e grava `catalogo.json` + `catalogo-meta.json`. `--se-velho` (só se passou de 12 h), `--semente` (arquivo de teste fictício) |
| `credencial.json` | **A criar pelo senhor.** Fica ignorado pelo `.gitignore` da pasta |
| `capas\` | cache das capas baixadas |
| `testar.mjs` | testes |

`catalogo.js` recarrega sozinho quando o `catalogo.json` muda (confere no máximo 1 vez por minuto). Não precisa reiniciar o bot depois de cada atualização.

## 1. Credencial (uma vez)

Criar no painel uma linha (usuário e senha de cliente) só para o catálogo, com validade longa, 1 conexão e pacote com filmes e séries (o pacote de teste "COMPLETO SEM ADULTO" serve se não expirar; teste de 6 h não serve). Gravar em `C:\Users\gusta\Scripts\robo-revenda\catalogo\credencial.json`:

```json
{ "servidores": ["http://capyplay.space", "http://capyplay.fun", "http://spar.lat"], "usuario": "USUARIO", "senha": "SENHA" }
```

Primeira carga manual (o painel é lento, pode levar vários minutos): `node catalogo\atualizar.mjs`. Conferir `catalogo\catalogo-meta.json` (total, filmes, séries, adultos_ignorados, sem_capa). A atualização só usa `player_api.php` e as 4 ações de listagem. Não abre stream nem altera nada. Se o painel devolver uma lista menos da metade da anterior, ela é recusada e o catálogo antigo fica.

## 2. Atualizar a cada 12 h

Opção A (recomendada), dentro do `bot.js`, perto do fim do arquivo:

```js
const { execFile } = require('child_process');
function atualizarCatalogo() {
  if (!fs.existsSync(path.join(PASTA, 'catalogo', 'credencial.json'))) return; // ainda sem credencial: não faz nada
  execFile(process.execPath, [path.join(PASTA, 'catalogo', 'atualizar.mjs'), '--se-velho'],
    { windowsHide: true, timeout: 25 * 60000 },
    (err, out, errout) => log('catálogo: ' + (err ? 'falhou (' + String(errout || err.message).split('\n')[0].slice(0, 120) + ')' : String(out).trim().split('\n').pop())));
}
setTimeout(atualizarCatalogo, 60 * 1000);      // 1 min depois de ligar
setInterval(atualizarCatalogo, 60 * 60 * 1000); // confere de hora em hora; só baixa se passou de 12 h
```

Opção B, tarefa agendada do Windows (não criada; só se o senhor preferir): `schtasks /Create /TN "CapyPlay catalogo" /SC HOURLY /MO 12 /TR "\"<caminho do node.exe>\" C:\Users\gusta\Scripts\robo-revenda\catalogo\atualizar.mjs --se-velho"` (descobrir o caminho com `where node`).

## 3. Regra pronta para o `base.md`

Acrescentar antes de "# Formato da sua saída":

```
# Filmes e séries (o sistema confere no catálogo)
- Quando a pessoa perguntar se tem um filme ou uma série, ou pedir um título (ex.: "tem Pantera Negra?", "vocês têm La Casa de Papel?", "quero assistir Round 6"), preencha "conteudo" com SÓ o nome do título, como a pessoa falou (sem "filme", sem "tem", sem pontuação). Se ela disser o ano, pode incluir (ex.: "Batman 2022").
- Em "mensagens" mande no máximo uma frase curta, tipo "Vou conferir aqui para você.". NUNCA diga no texto que o título existe, que está disponível ou que não existe: quem confirma e manda a capa é o sistema, logo depois.
- Se pedirem vários títulos, preencha "conteudo" só com o primeiro e diga que já confere os outros.
- Pergunta geral, sem título ("tem filmes e séries?", "tem catálogo?"): não preencha "conteudo"; siga o roteiro e ofereça o teste grátis para a pessoa ver a lista. Canal ao vivo: não use "conteudo" (siga a regra de avisar = true).
```

E na linha de formato, acrescentar o campo:

```
{"mensagens": ["..."], "videos": [], "teste": false, "depois": [], "guia": "", "conteudo": "", "memoria": {"etapa": "explicando", "resumo": "..."}, "avisar": false, "motivo": ""}
```

## 4. Código do `bot.js`

Hoje já existe `buscarConteudo` (por volta da linha 516) chamando `cat.buscar(titulo)` e só enviando se vier texto. Como `buscar` devolve lista, esse trecho não manda nada (e registra `achou: true` até para lista vazia). Trocar a função inteira por esta (o ponto de chamada em `atenderCore`, `if (r.conteudo) await buscarConteudo(...)`, logo depois do teste grátis e antes do guia, já é o lugar certo: as mensagens do Haiku saem primeiro, depois a capa):

```js
const catalogo = require('./catalogo/catalogo.js'); // no topo do bot.js, junto dos outros require

async function buscarConteudo(chat, chatId, nome, titulo) {
  titulo = String(Array.isArray(titulo) ? titulo[0] : titulo).replace(/\s+/g, ' ').trim().slice(0, 120);
  if (titulo.length < 2) return;
  const f = ficha(chatId); f.capas = f.capas || [];
  const r = await catalogo.responder(titulo, { jaEnviadas: f.capas });
  evento('conteudo_pedido', chatId, nome, { titulo, achou: !!r.achou, ambiguo: !!r.ambiguo, capa: !!r.enviarCapa, motivo: r.motivo || null });
  log(`conteúdo pedido por ${nome}: ${titulo} -> ${r.ambiguo ? 'varios' : r.achou ? (r.repetida ? 'achou (capa já enviada)' : 'achou') : 'não achou'}${r.motivo ? ' [' + r.motivo + ']' : ''}`);
  const legenda = limpar(r.legenda);
  if (r.enviarCapa) {
    try { await chat?.sendStateTyping(); } catch {}
    await new Promise((ok) => setTimeout(ok, 1500));
    marcarEnvio(chatId);
    textosDoRobo.add(legenda); setTimeout(() => textosDoRobo.delete(legenda), 60000);
    const m = await client.sendMessage(chatId, MessageMedia.fromFilePath(r.capa), { caption: legenda });
    enviadasPeloRobo.add(m.id._serialized);
    f.capas.push(r.item.chave); f.capas = f.capas.slice(-30); salvarFichas(); // não repete a mesma capa na conversa
    evento('resposta_robo', chatId, nome, { texto: `[capa ${r.item.titulo}] ${legenda}`, midia: true });
  } else {
    await enviar(chat, legenda, chatId); // sem capa, repetida, ambígua ou "vou confirmar": só texto
  }
  if (r.avisar) { // não achou ou catálogo fora: o senhor confere. NÃO silencia o robô.
    f.conteudoAvisado = f.conteudoAvisado || [];
    const k = titulo.toLowerCase();
    if (!f.conteudoAvisado.includes(k)) {
      f.conteudoAvisado.push(k); f.conteudoAvisado = f.conteudoAvisado.slice(-20); salvarFichas();
      avisarSenhor(`Revenda: ${nome} perguntou por "${titulo}" e não achei no catálogo (${String(r.motivo).split(':')[0]}). Confira se esse título existe na lista e responda a ele.`);
    }
  }
}
```

Observações:

- A chamada em `atenderCore` já tem `.catch(...)` com `erroEv('catalogo', ...)`. `responder()` nunca lança por falha de capa, de rede ou de arquivo ausente.
- `r.item.chave` é `filme:ID` ou `serie:ID`; `ficha(chatId).capas` guarda as últimas 30 e vai para `clientes.json`, então sobrevive a reinício.
- Se o cliente pedir de novo um título cuja capa já saiu, `responder` devolve `repetida: true` e a legenda "Esse filme eu já te mostrei, ele está disponível na CapyPlay." (só texto).
- Se houver mais de um título com o mesmo nome (ex.: dois Batman), `ambiguo: true`: o bot pergunta qual, sem capa. Quando o cliente responder com o ano, o Haiku devolve `"conteudo": "Batman 2022"` e a busca resolve.
- Sem capa utilizável (painel e TMDB falharam), manda só a legenda e `r.motivo` traz o porquê (`sem_capa: ...`). Nesse caso o título continua "disponível", porque existe no catálogo.
- **TMDB como segunda opção de capa**: só ativa se existir chave em `catalogo\tmdb.local` (linha `tmdb.apiKey=CHAVE`) ou na variável `TMDB_API_KEY`. Hoje não há chave dentro do projeto do robô. Existe uma chave do TMDB em `D:\Projetos\capyapp-v3\.tmdb.local`; ela só passa a valer para o robô se o senhor mandar copiar (ou apontar `TMDB_KEY_FILE`). Sem chave, é só a capa do painel.

## 5. Teste antes de ligar de verdade (sem WhatsApp)

```
node --expose-gc catalogo\testar.mjs
node -e "const c=require('./catalogo/catalogo.js');c.responder('poderoso chefao').then(r=>console.log(r))"   // depois da 1ª carga real
```

## Riscos e limites

- Os títulos reais do painel ainda não foram vistos (sem credencial). A limpeza de prefixos/sufixos foi feita com padrões comuns de painel XUI; na primeira carga real, abrir uns 30 títulos de `catalogo.json` e conferir.
- A busca é por texto: título em inglês vs português diferente do painel ("Spider-Man" x "Homem-Aranha") não casa. Título genérico de uma palavra curta ("amor", "up") volta vazio de propósito.
- "Está disponível" vale para o que o painel lista na linha de leitura. Se o pacote do cliente for menor (ex.: sem adulto, sem 4K) a afirmação pode ficar maior que o pacote dele; usar uma linha com o pacote mais completo que a CapyPlay vende para clientes normais.
- Canais ao vivo não entram (pedido foi filmes e séries).
- Capas baixadas ficam em `catalogo\capas\` e não são apagadas sozinhas (cerca de 50 a 150 KB cada).
