# Relatórios da revenda na nuvem (celular)

Worker `robo-relatorios` (Cloudflare) em subdomínio escondido de copythief.men. Endereço e senha: `SENHA.txt` (fora do git).
O PC não abre porta: o servidor dos relatórios (`C:\Users\gusta\Scripts\robo-revenda\relatorios\server.mjs`) manda os dados por HTTPS (`sync-nuvem.mjs`, config em `relatorios\nuvem.local.json`).

## Arquivos
- `worker.mjs`: login, sessão, API, fila de comandos, sync. `wrangler.toml`: Worker, assets, KV `RELATORIOS`, rate limit.
- `publicar.ps1`: copia `relatorios\web\` para `public\` (sem `mock\`, `prints\`, `*.antes-*`) e roda `wrangler deploy`. `-SoCopiar` só prepara.
- `CONTRATO.md`: rotas e formatos (a tela se baseia nele).

## Publicar de novo (depois de mudar a tela ou o worker)
`powershell -ExecutionPolicy Bypass -File D:\Projetos\robo-relatorios-nuvem\publicar.ps1`

## Segredos (wrangler secret, nunca no código)
`SENHA`, `SESSAO_SEGREDO`, `SYNC_TOKEN`. Trocar a senha: `npx wrangler secret put SENHA` (derruba as sessões abertas). Trocar o token de sync: `npx wrangler secret put SYNC_TOKEN` e o mesmo valor em `token_sync` no `nuvem.local.json` (o sync lê o arquivo a cada ciclo, sem reiniciar).

## Consumo do KV (plano grátis: 1.000 escritas, 100.000 leituras, 1.000 listagens por dia)
Escritas: o PC grava conteúdo novo no máximo a cada 75 s e confirma "vivo" a cada 150 s (uma escrita por ciclo, nunca as duas); só envia o conteúdo quando o hash mudou (ignora relógios). Teto no PC: 800 escritas por dia UTC; depois disso, uma a cada 15 min. Worker: mínimo de 60 s entre escritas (proteção).
- Dia parado/PC ocioso: ~576 (uma a cada 150 s). Dia movimentado: no máximo 800 (teto).
- Comando: 2 escritas (pedido + resultado). Login errado: 1 escrita por falha, com bloqueio crescente (30 s, 1 min, 2 min... até 1 h) e Rate Limiting sem KV na frente. Sessão válida: zero.
- Pior caso somado: ~800 + 2 x 20 comandos + ~20 logins = ~860, abaixo de 1.000.
Leituras: o PC consulta a fila a cada 12 s (7.200/dia, 1 leitura) e o celular lê 2 chaves por tela (snapshot e vivo). Com a tela aberta o dia todo, atualizando a cada 30 s: ~6.000. Total típico ~15.000, muito abaixo de 100.000.
Se a cota estourar, o KV recusa novas escritas até 00:00 UTC (21h em Brasília): a tela mostra o último snapshot como desatualizado. Plano pago (US$ 5) remove o limite.

## Como desfazer
1. `cd D:\Projetos\robo-relatorios-nuvem; npx wrangler delete` (remove o Worker e o custom domain; o registro DNS some junto).
2. Opcional: `npx wrangler kv namespace delete --namespace-id 510e99edc8ba468088f9286578750cf0`.
3. Parar o sync: apagar `relatorios\nuvem.local.json` (o servidor local continua normal).

## Conferência (otimizacao-sites), 08/11/2026, medida no endereço publicado
HTML comprimido em gzip pelo Worker (index 12.123 B -> 2.855 B; login 2.792 B -> 1.419 B); app.js 56.756 B e estilo.css 41.721 B saem em Brotli pelo Cloudflare; fonte com cache de 1 ano (immutable), ícones 7 dias; app.js/css `private, no-cache` (revalidam por ETag); dados `no-store`. Celular emulado (390 px, 4G lento, CPU 4x): FCP 1,18 s, LCP 1,39 s, CLS 0, 107 KB transferidos, console limpo. Rede normal: LCP 0,38 s.
Detalhe técnico: o `Cache-Control: no-transform` no HTML impede o Cloudflare de injetar o script de analytics (a CSP o bloquearia e deixaria erro no console), mas também desliga a compressão automática dele; por isso o Worker declara `Content-Encoding: gzip` e o runtime comprime (comprimir à mão duplica a codificação).
