// texto-disponibilidade.js - legendas padrão para a capa (sem emoji, frase curta, tom de gente).
// Regra do senhor (08/11/2026): quando NÃO achar, nunca dizer que não tem; dizer que vai confirmar e avisar.
'use strict';

function hash(s) { let h = 0; for (const c of String(s)) h = (Math.imul(31, h) + c.charCodeAt(0)) | 0; return Math.abs(h); }
function rotulo(item) { return item.titulo + (item.ano ? ' (' + item.ano + ')' : ''); }

/**
 * Legenda da capa de um título que EXISTE no catálogo.
 * opcoes.todosEpisodios: só passe true se tiver certeza (o catálogo não guarda número de episódios, então o padrão é false).
 */
function legenda(item, opcoes = {}) {
  const serie = item.tipo === 'serie';
  const v = hash(item.chave || item.titulo) % 2;
  const fraseFilme = ['Esse filme está disponível na CapyPlay.', 'Esse filme já está disponível na CapyPlay.'][v];
  let fraseSerie = ['Essa série está disponível na CapyPlay.', 'Essa série já está disponível na CapyPlay.'][v];
  if (opcoes.todosEpisodios === true) fraseSerie = 'Essa série está disponível na CapyPlay, com todos os episódios que o painel tem.';
  return rotulo(item) + '\n' + (serie ? fraseSerie : fraseFilme);
}

/** Quando o título não está no catálogo (ou o catálogo não está disponível): nunca nega, promete confirmar. */
function naoAchou() {
  return 'Vou confirmar se esse título já está na lista e te aviso.';
}

/** Quando há mais de um título parecido: pergunta qual, sem mandar capa. */
function desambiguar(itens) {
  const nomes = itens.slice(0, 3).map(rotulo);
  const lista = nomes.length === 2 ? nomes.join(' e ') : nomes.slice(0, -1).join(', ') + ' e ' + nomes[nomes.length - 1];
  return 'Tenho mais de um com esse nome: ' + lista + '. Qual deles você quer?';
}

/** Quando a capa desse título já foi enviada nesta conversa. */
function repetida(item) {
  return item.tipo === 'serie' ? 'Essa série eu já te mostrei, ela está disponível na CapyPlay.' : 'Esse filme eu já te mostrei, ele está disponível na CapyPlay.';
}

module.exports = { legenda, naoAchou, desambiguar, repetida };
