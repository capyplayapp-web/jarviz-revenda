# Contrato da API na nuvem (versão celular dos relatórios)

Mesmos caminhos relativos da API local (`/api/...`). Tudo abaixo exige o cookie de sessão (`__Host-rv`, HttpOnly, 30 dias).
Sem sessão: `/api/*` devolve **401** `{erro:"login necessário"}` e qualquer página redireciona (302) para `/login`.
A tela deve, ao receber 401 em qualquer `/api/*`, fazer `location.href = '/login'`. Sair: `POST /logout` (volta a `/login`).

## Leitura (GET)
| Rota | Corpo |
|---|---|
| `/api/resumo?dias=1` ou `7` | O JSON de `lib.mjs resumo()` + campos extras abaixo. Outro valor de `dias`: 400. |
| `/api/revendedores` | `{gerado_em, total, revendedores[]}` + extras |
| `/api/pendentes` | `{quando, total, itens[{nome, desde_min, mensagens}]}` + extras. `desde_min` é o do momento do snapshot. |
| `/api/grafo?dias=1\|7` | Resultado de `grafo()` do PC (quando `relatorios\grafo.mjs` existe) + extras. |
| `/api/ping` | `{ok, nuvem:true, em, snapshot_em, idade_s, desatualizado}` |

Campos extras em todas as leituras de snapshot: `nuvem:true`, `snapshot_em` (ISO, última vez que o PC enviou ou confirmou que estava vivo), `idade_s` (segundos desde então), `desatualizado` (true se `idade_s` > 300).
A tela mostra "PC sem enviar há X min" quando `desatualizado` é true (X = `idade_s/60`). Sem nenhum envio ainda: 503 `{erro, desatualizado:true}`.

O limite é 5 min (não 3) por causa do limite de escritas do KV grátis: o PC confirma que está vivo a cada 150 s e a leitura do KV pode atrasar até 60 s.

## Comandos (nuvem -> PC)
Nada roda na nuvem: o POST põe o comando numa fila; o PC busca a fila a cada 12 s, executa e devolve o resultado.

`POST /api/reanalisar` | `POST /api/aprender` | `POST /api/ping` (corpo opcional `{eco:"texto"}`, só para teste)
-> `200 {ok:true, enfileirado:true, id, pedido_em, ja_pendente?}`. Se já existe um igual pendente (há menos de 5 min), não duplica: devolve o mesmo `id` com `ja_pendente:true`.

`GET /api/comando?tipo=reanalisar|aprender|ping` -> sempre `{tipo, estado, pc_vivo, ...}`:
- `estado:"nenhum"`: nunca pedido.
- `estado:"pendente"`: na fila, o PC ainda não devolveu (`id`, `pedido_em`).
- `estado:"feito"`: `feito_em` e os campos do resultado no mesmo nível. Reanalisar: `{ok, encontrados, nomes, ...}` (igual ao `POST /api/reanalisar` local); aprender: `{ok, motivo?, ultima_rodada}`; ping: `{ok, eco, pc_em}`.
- `estado:"expirado"`: pendente há mais de 10 min (PC desligado). Pedir de novo.
`pc_vivo` é false se o PC não aparece há mais de 5 min: a tela pode avisar na hora do clique.

Fluxo da tela: `POST /api/reanalisar` -> repetir `GET /api/comando?tipo=reanalisar` a cada 2-3 s até `estado === 'feito'` (típico: 5 a 30 s; a leitura do KV pode atrasar até 60 s). Desistir da espera com mensagem em ~3 min.
`aprender` demora mais (chamada ao Haiku, até ~2,5 min).

## PC -> nuvem (Bearer, só o PC usa)
- `PUT /sync/snapshot`: corpo = o objeto `dados` cru (todas as chaves de `CHAVES` no worker), hash em `X-Hash`, `X-Forcar: 1` opcional. Grava o snapshot inteiro se o hash mudou (hash e hora nos metadados da chave `snap`, sem ler o valor antigo); senão só marca "vivo". Formato antigo `{hash, dados, forcar}` ainda aceito. Intervalo mínimo no Worker: 60 s (30 s com `forcar`).
- `POST /sync/vivo`: só marca que o PC está vivo.
- `GET /sync/comandos` -> `{comandos:[{id,tipo,chave,pedido_em,eco?,rota?,corpo?}]}`.
- `POST /sync/resultado` `{id,tipo,chave,resultado}` (a fila é indexada por `chave`).

## Abas novas (09/11/2026)
GET (snapshot): `/api/escritorio|funil|followups|uso?dias=1|7`, `/api/jornada`, `/api/etiquetas`, `/api/backlog`, `/api/lacunas`, `/api/releitura`, `/api/versoes`, `/api/voz` (com pedido de voz pendente, devolve o `modo` pedido e `pedido_pendente:true`).
POST (viram comando `acao` na fila, chave = rota + hash do corpo; o PC repete o POST na API local uma única vez): `/api/funil/pausar|retomar|reaquecer|jogadas`, `/api/jornada/pausar|retomar|tocar`, `/api/releitura`, `/api/voz`, `/api/backlog/mapear|pausar|retomar`. Resposta: `{ok, enfileirado:true, id, pedido_em}`.
Limites: login 8/min por IP (`RL`), PC 40/min (`RL_SYNC`).

## Cabeçalhos
`X-Robots-Tag: noindex, nofollow, noarchive, nosnippet` em tudo; `/robots.txt` com `Disallow: /`; `Cache-Control: no-store` em `/api/*` e `/login`; CSP restrita (sem CDN, sem script inline: o JS fica em arquivo `.js`; `style` inline permitido).
Públicos sem login (só arquivos estáticos): `/fontes/`, `/icones/`, `/icons/`, `/manifest.webmanifest`, `/manifest.json`, `/sw.js`, `/favicon.ico`, `/apple-touch-icon.png`, `/robots.txt`, `/login`.
Atenção para o PWA: o `sw.js` não deve guardar em cache nada de `/api/*`.
