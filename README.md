# Jarviz · robô da revenda CapyPlay

Repositório **privado** do atendimento automático do WhatsApp da revenda (11 97052-1624), dos relatórios (dashboard do PC e versão na nuvem) e do Slava, o produto que nasce dele.

| Pasta | O que é |
|---|---|
| `/` (raiz) | O robô: `bot.js` (whatsapp-web.js + Haiku), `base.md` (o que ele sabe e o tom), `ligar.ps1` (sobe com o Windows), atrasados (`backlog.js`), lacunas, voz, testes grátis |
| `funil/` | Motor do funil: vigia de leads, cadência, jornada dos revendedores, etiquetas, releitura, livro de jogadas |
| `catalogo/` | Catálogo de filmes e séries para o robô responder o que tem disponível |
| `relatorios/` | Servidor local `http://127.0.0.1:8811` (`server.mjs`), as libs de cada aba e a tela em `relatorios/web/` |
| `nuvem/` | Worker da Cloudflare em **https://jarviz.copythief.men** (login por senha, dados enviados pelo PC) |
| `vendas/` | Slava: modelo de negócio e site de vendas (`vendas/site/`, ainda não publicado) |
| `docs/` | `APRIMORAMENTOS.md` (feito e proposto), `HISTORICO.md` (diário completo) |

## O que nunca sobe para cá
Sessão do WhatsApp (`sessao/`), perfis de navegador, tokens (`nuvem.local.json`, `.env` do Telegram), a senha da nuvem (`nuvem/SENHA.txt`) e os dados de clientes (`clientes.json`, `conversas.log`, `eventos.jsonl`, leads, backlog). Tudo isso fica só no PC. Ver `.gitignore`.

## Rodar
- Robô: atalho "Robo da revenda" na pasta Inicializar chama `ligar.ps1` (religa em 15 s se cair). Pausar: criar o arquivo `pausado`.
- Relatórios no PC: `node relatorios/server.mjs` → http://127.0.0.1:8811 (o mesmo processo envia os dados para a nuvem).
- Nuvem: `powershell -ExecutionPolicy Bypass -File nuvem\publicar.ps1` (copia `relatorios/web` para `nuvem/public` e publica). Detalhes em `nuvem/README.md` e `nuvem/CONTRATO.md`.

## Caminhos antigos
`D:\Projetos\robo-relatorios-nuvem` e `D:\Projetos\slava` são atalhos (junção) para `nuvem/` e `vendas/`; tudo que apontava para lá continua funcionando.

## Salvar no GitHub
```powershell
cd C:\Users\gusta\Scripts\robo-revenda
git add -A; git commit -m "o que mudou"; git push
```
