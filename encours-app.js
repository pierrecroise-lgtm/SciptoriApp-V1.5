// ScriptoriApp — encours-app.js
//
// V1.2 : la carte du livre est repliée par défaut. Trois états d'affichage :
//   'collapsed' -> juste la carte (comportement au chargement)
//   'continuer' -> boutons "Continuer" et "Lire les notes" (après tap sur la carte)
//   'form'      -> formulaire de séance visible (après tap sur "Continuer")
// Cet état est mémorisé dans une variable de module (uiState) pour ne pas
// "sauter" si une synchro Firestore (autre appareil) déclenche un re-rendu
// pendant que le joueur est en train d'interagir.
//
// "Lire les notes" ouvre un parchemin plein écran (injecté en JS, comme
// l'overlay de connexion) listant les notes du livre en cours, de la plus
// ancienne en haut à la plus récente en bas.

import { subscribeBooks, updateBook, getCurrentReadingBook } from './data-layer.js';
import { subscribePlayer, subscribeSeances, enregistrerSeance } from './player-layer.js';
import { calculerXpSavoir, calculerBonusSeance, calculerNiveau } from './xp-engine.js';
import { openNotesOverlay } from './notes-overlay.js';

const contentArea = document.getElementById('content-area');
const niveauLabel = document.getElementById('niveau-label');
const niveauXp = document.getElementById('niveau-xp');
const xpBarFill = document.getElementById('xp-bar-fill');
const niveauNext = document.getElementById('niveau-next');

let uiState = 'collapsed';
let pendingFeedbackHtml = null;
let collapseTimer = null;
let lastKnownBooks = [];
let currentSeances = [];

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function renderNiveauPlaque(player) {
  const { niveau, xpDansNiveau, xpProchainPalier } = calculerNiveau(player.xpTotal);

  niveauLabel.textContent = `Niveau ${niveau}`;
  niveauXp.textContent = `${player.xpTotal} XP`;

  if (xpProchainPalier === null) {
    xpBarFill.style.width = '100%';
    niveauNext.textContent = 'Niveau maximum de la V1 atteint.';
  } else {
    const pct = Math.min(100, (xpDansNiveau / xpProchainPalier) * 100);
    xpBarFill.style.width = `${pct}%`;
    niveauNext.textContent = `${xpDansNiveau} / ${xpProchainPalier} XP avant le niveau ${niveau + 1}`;
  }
}

// --- Contenu principal -------------------------------------------------------

function renderContent(books) {
  const livre = getCurrentReadingBook(books);

  if (!livre) {
    uiState = 'collapsed';
    contentArea.innerHTML = `
      <div class="empty-state">
        <p>Aucun livre en cours pour l'instant.<br>Choisis ton prochain ouvrage dans la Réserve.</p>
        <a class="btn-dnd" href="reserve.html">Aller à la Réserve</a>
      </div>
    `;
    return;
  }

  const pct = Math.min(100, Math.round((livre.pagesRead / livre.pageCount) * 100));
  const termine = livre.pagesRead >= livre.pageCount;

  contentArea.innerHTML = `
    <div class="livre-card" id="livre-card" role="button" tabindex="0" aria-expanded="${uiState !== 'collapsed'}">
      <div class="livre-card__cover" style="background-image:url('${livre.coverUrl || 'images/grimoire-encours.png'}')"></div>
      <div class="livre-card__body">
        <span class="livre-card__title">${escapeHtml(livre.title)}</span>
        <span class="livre-card__author">${escapeHtml(livre.author)}</span>
        <div class="livre-card__progress-text">${livre.pagesRead} / ${livre.pageCount} pages (${pct}%)</div>
        <div class="progress-bar"><div class="progress-bar__fill" style="width:${pct}%"></div></div>
      </div>
    </div>

    ${uiState === 'collapsed' ? `<p class="tap-hint">Touche le livre pour commencer une séance</p>` : ''}

    ${uiState === 'continuer' ? `
      <button class="btn-dnd" id="btn-continuer" type="button">Continuer</button>
      <button class="btn-dnd btn-dnd--ghost" id="btn-lire-notes" type="button">Lire les notes</button>
    ` : ''}

    ${uiState === 'form' ? `
    <div class="seance-form">
      <h2>Nouvelle séance de lecture</h2>
      <form id="seance-form">
        <div class="field">
          <label for="f-pages-jour">Pages lues aujourd'hui</label>
          <input id="f-pages-jour" type="number" min="1" max="${livre.pageCount - livre.pagesRead}" required />
        </div>
        <div class="field">
          <label for="f-note">Note — que se passe-t-il dans le récit ?</label>
          <textarea id="f-note" rows="3" placeholder="Ex : Frodo quitte la Comté avec Sam..."></textarea>
        </div>
        <button class="btn-dnd" type="submit">Valider la séance</button>
      </form>
      <div class="seance-feedback ${pendingFeedbackHtml ? 'is-visible' : ''}" id="seance-feedback">${pendingFeedbackHtml || ''}</div>
      ${termine ? `<button class="btn-dnd btn-dnd--ghost" id="btn-terminer" type="button">Marquer le livre comme terminé</button>` : ''}
    </div>` : ''}
  `;

  const livreCard = document.getElementById('livre-card');
  livreCard.addEventListener('click', () => {
    if (uiState === 'collapsed') {
      uiState = 'continuer';
      renderContent(books);
    }
  });
  livreCard.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && uiState === 'collapsed') {
      e.preventDefault();
      uiState = 'continuer';
      renderContent(books);
    }
  });

  const btnContinuer = document.getElementById('btn-continuer');
  if (btnContinuer) {
    btnContinuer.addEventListener('click', () => {
      uiState = 'form';
      renderContent(books);
    });
  }

  const btnLireNotes = document.getElementById('btn-lire-notes');
  if (btnLireNotes) {
    btnLireNotes.addEventListener('click', () => openNotesOverlay(livre, currentSeances));
  }

  const seanceForm = document.getElementById('seance-form');
  if (seanceForm) seanceForm.addEventListener('submit', onSubmitSeance(livre));

  const btnTerminer = document.getElementById('btn-terminer');
  if (btnTerminer) {
    btnTerminer.addEventListener('click', () => {
      updateBook(livre.id, { status: 'finished', finishedAt: Date.now() });
    });
  }
}

function onSubmitSeance(livre) {
  return (e) => {
    e.preventDefault();
    const input = document.getElementById('f-pages-jour');
    const noteInput = document.getElementById('f-note');
    const pagesLues = Math.max(0, Math.min(Number(input.value) || 0, livre.pageCount - livre.pagesRead));
    if (pagesLues <= 0) return;

    const note = noteInput ? noteInput.value.trim() : '';
    const xpSavoir = calculerXpSavoir(pagesLues);
    const xpSeance = calculerBonusSeance(pagesLues);
    const xpGagne = xpSavoir + xpSeance;

    updateBook(livre.id, { pagesRead: livre.pagesRead + pagesLues });
    enregistrerSeance({ livreId: livre.id, pagesLues, xpGagne, note });

    pendingFeedbackHtml = `<strong>+${xpGagne} XP</strong><br>${pagesLues} pages · Savoir ${xpSavoir} XP` +
      (xpSeance > 0 ? ` · Bonus de séance ${xpSeance} XP` : ' · pas de bonus de séance (moins de 10 pages)');

    const feedbackEl = document.getElementById('seance-feedback');
    if (feedbackEl) {
      feedbackEl.innerHTML = pendingFeedbackHtml;
      feedbackEl.classList.add('is-visible');
    }

    clearTimeout(collapseTimer);
    collapseTimer = setTimeout(() => {
      uiState = 'collapsed';
      pendingFeedbackHtml = null;
      renderContent(lastKnownBooks);
    }, 1600);
  };
}

subscribeBooks((books) => {
  lastKnownBooks = books;
  renderContent(books);
});

subscribePlayer((player) => {
  renderNiveauPlaque(player);
});

subscribeSeances((seances) => {
  currentSeances = seances;
});
