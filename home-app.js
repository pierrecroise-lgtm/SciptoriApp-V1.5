// ScriptoriApp — home-app.js
// Données dynamiques du HUD de l'Antre : livre en cours + progression XP.

import { subscribeBooks } from './data-layer.js';
import { subscribePlayer, creditBonusRegulariteEnAttente } from './player-layer.js';
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

// --- Barre de mana : bonus de Régularité, affiché une fois au lancement ---
//
// creditBonusRegulariteEnAttente() (player-layer.js) crédite l'XP en
// attente ET la retire du document joueur en une seule opération : on est
// donc certain de ne l'afficher qu'une fois, même si la Home est rechargée
// juste après (le pending n'existe déjà plus).

function afficherBarreDeMana({ montant, ritualAccompli }) {
  const overlay = document.createElement('div');
  overlay.id = 'mana-bonus-overlay';
  overlay.innerHTML = `
    <style>
      #mana-bonus-overlay{
        position:fixed; inset:0; z-index:700;
        background:rgba(6,4,10,.55);
        display:flex; flex-direction:column; align-items:center; justify-content:center;
        gap:14px; padding:20px; pointer-events:none;
      }
      #mana-bonus-overlay .mana-titre{
        font-family:'Press Start 2P', monospace; font-size:12px; color:#cfe6ff;
        text-shadow:0 0 8px rgba(90,170,255,.8); text-align:center; line-height:1.6;
      }
      #mana-bonus-overlay .mana-flacon{
        width:34px; height:150px; border-radius:16px;
        border:2px solid rgba(170,210,255,.65);
        background:rgba(8,12,24,.6);
        box-shadow:0 0 14px rgba(70,140,255,.35), inset 0 0 10px rgba(0,0,0,.5);
        overflow:hidden; position:relative;
      }
      #mana-bonus-overlay .mana-liquide{
        position:absolute; left:0; right:0; bottom:0; height:0%;
        background:linear-gradient(180deg,#8fd6ff,#3d8bff 45%,#1d4fbf 100%);
        background-size:100% 200%;
        animation:mana-fill 10s linear forwards, mana-gradient 2.4s ease-in-out infinite;
      }
      @keyframes mana-fill{ from{ height:0%; } to{ height:100%; } }
      @keyframes mana-gradient{ 0%{ background-position:0 0; } 50%{ background-position:0 100%; } 100%{ background-position:0 0; } }
      #mana-bonus-overlay .mana-montant{
        font-family:'Press Start 2P', monospace; font-size:15px; color:#dff0ff;
        text-shadow:0 0 10px rgba(90,170,255,.9);
        opacity:0; animation:mana-montant-in .6s ease-out 9.4s forwards;
      }
      @keyframes mana-montant-in{ to{ opacity:1; transform:translateY(-4px); } }
    </style>
    <div class="mana-titre">${ritualAccompli ? 'Rituel hebdomadaire accompli' : 'Régularité récompensée'}</div>
    <div class="mana-flacon"><div class="mana-liquide"></div></div>
    <div class="mana-montant">+${montant} XP</div>
  `;
  document.body.appendChild(overlay);
  setTimeout(() => overlay.remove(), 11200);
}

let regulariteVerifiee = false;

subscribeBooks(renderBookProgress);
subscribePlayer((player) => {
  renderXp(player);
  if (!regulariteVerifiee) {
    regulariteVerifiee = true;
    creditBonusRegulariteEnAttente()
      .then((resultat) => { if (resultat && resultat.montant > 0) afficherBarreDeMana(resultat); })
      .catch((error) => console.error('Impossible de créditer le bonus de Régularité', error));
  }
});
