// ScriptoriApp — home-app.js
// Données dynamiques du HUD de l'Antre : livre en cours + progression XP.

import { subscribeBooks } from './data-layer.js';
import { subscribePlayer } from './player-layer.js';
import { calculerNiveau } from './xp-engine.js';

const bookTitle = document.getElementById('bookTitle');
const bookBar = document.getElementById('bookBar');
const bookPct = document.getElementById('bookPct');
const levelNum = document.getElementById('levelNum');
const xpBar = document.getElementById('xpBar');
const xpLabel = document.getElementById('xpLabel');

function renderBookProgress(books) {
  const livre = books.find((book) => book.status === 'reading');

  if (!livre) {
    bookTitle.textContent = '📖 Aucun livre en cours';
    bookBar.style.width = '0%';
    bookPct.textContent = '0 / 0';
    return;
  }

  const pagesRead = Math.max(0, Number(livre.pagesRead) || 0);
  const pageCount = Math.max(0, Number(livre.pageCount) || 0);
  const pct = pageCount > 0
    ? Math.min(100, Math.round((pagesRead / pageCount) * 100))
    : 0;

  bookTitle.textContent = `📖 ${livre.title || 'Livre en cours'}`;
  bookBar.style.width = `${pct}%`;
  bookPct.textContent = `${pagesRead} / ${pageCount} (${pct}%)`;
}

function renderXp(player) {
  const xpTotal = Math.max(0, Number(player.xpTotal) || 0);
  const { niveau, xpDansNiveau, xpProchainPalier } = calculerNiveau(xpTotal);

  levelNum.textContent = niveau;

  if (xpProchainPalier === null) {
    xpBar.style.width = '100%';
    xpLabel.textContent = `${xpTotal} XP`;
    return;
  }

  const pct = Math.min(100, (xpDansNiveau / xpProchainPalier) * 100);
  xpBar.style.width = `${pct}%`;
  xpLabel.textContent = `${xpDansNiveau} / ${xpProchainPalier} XP`;
}

subscribeBooks(renderBookProgress);
subscribePlayer(renderXp);
