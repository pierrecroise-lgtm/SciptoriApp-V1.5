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
import {
  subscribePlayer,
  subscribeSeances,
  enregistrerSeance,
  crediterXpFinDeLivre,
  enregistrerCommentaireFinal,
} from './player-layer.js';
import {
  calculerXpSavoir,
  calculerBonusSeance,
  calculerBonusNoteSeance,
  calculerXpFinDeLivre,
  calculerNiveau,
  XP_COMMENTAIRE_FINAL,
} from './xp-engine.js';
import { openNotesOverlay } from './notes-overlay.js';

/** Seuil de pages à partir duquel le popup d'ajustement de difficulté peut apparaître. */
const SEUIL_POPUP_DIFFICULTE = 60;

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
    btnTerminer.addEventListener('click', () => openFinDeLivrePopup(livre));
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
    const noteRedigee = note !== '';
    const xpSavoir = calculerXpSavoir(pagesLues);
    const xpSeance = calculerBonusSeance(pagesLues);
    const xpNote = calculerBonusNoteSeance(noteRedigee);
    const xpGagne = xpSavoir + xpSeance + xpNote;

    const nouveauPagesRead = livre.pagesRead + pagesLues;
    const doitProposerPopupDifficulte =
      nouveauPagesRead >= SEUIL_POPUP_DIFFICULTE &&
      livre.pagesRead < SEUIL_POPUP_DIFFICULTE &&
      !livre.difficultePopupShown;

    updateBook(livre.id, { pagesRead: nouveauPagesRead });
    enregistrerSeance({ livreId: livre.id, pagesLues, xpGagne, note, difficulteLivre: livre.difficulte });

    pendingFeedbackHtml = `<strong>+${xpGagne} XP</strong><br>${pagesLues} pages · Savoir ${xpSavoir} XP` +
      (xpSeance > 0 ? ` · Bonus de séance ${xpSeance} XP` : ' · pas de bonus de séance (moins de 10 pages)') +
      (xpNote > 0 ? ` · Note rédigée +${xpNote} XP` : '');

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

    if (doitProposerPopupDifficulte) {
      // Affiché après le popup de difficulté potentiel, indépendamment du
      // repli de la fiche séance (l'overlay reste au-dessus).
      openDifficultePopup({ ...livre, pagesRead: nouveauPagesRead });
    }
  };
}

// --- Popup d'ajustement de difficulté (déclenché une fois, à 60 pages) -----

function openDifficultePopup(livre) {
  const overlay = document.createElement('div');
  overlay.id = 'difficulte-popup';
  overlay.innerHTML = `
    <style>
      #difficulte-popup{ position:fixed; inset:0; z-index:600; background:rgba(10,6,2,.72);
        display:flex; align-items:center; justify-content:center; padding:20px; }
      #difficulte-popup .sheet{ max-width:360px; width:100%; background:linear-gradient(180deg,#2a1c10,#1c1108);
        border:2px solid var(--brass,#c9a876); border-radius:6px; padding:20px; text-align:center;
        font-family:'VT323', monospace; color:var(--parchment,#ede3c8); }
      #difficulte-popup h2{ font-family:'Press Start 2P', monospace; font-size:13px; margin:0 0 14px; line-height:1.6; }
      #difficulte-popup p{ font-size:17px; line-height:1.4; margin:0 0 16px; opacity:.9; }
      #difficulte-popup .etoiles{ display:flex; justify-content:center; gap:10px; margin-bottom:18px; }
      #difficulte-popup .etoile{ font-size:34px; cursor:pointer; opacity:.35; background:none; border:none; padding:0; }
      #difficulte-popup .etoile.is-active{ opacity:1; }
      #difficulte-popup .actions{ display:flex; gap:10px; justify-content:center; }
    </style>
    <div class="sheet">
      <h2>60 pages franchies</h2>
      <p>Cet ouvrage se révèle à toi. Ajustes-tu son niveau de difficulté&nbsp;?</p>
      <div class="etoiles" id="difficulte-etoiles">
        ${[1, 2, 3].map((n) => `<button type="button" class="etoile${n <= (livre.difficulte || 1) ? ' is-active' : ''}" data-valeur="${n}">★</button>`).join('')}
      </div>
      <div class="actions">
        <button class="btn-dnd btn-dnd--ghost" id="difficulte-garder" type="button">Garder telle quelle</button>
        <button class="btn-dnd" id="difficulte-valider" type="button">Valider</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  let valeurChoisie = livre.difficulte || 1;
  const etoiles = overlay.querySelectorAll('.etoile');
  etoiles.forEach((btn) => {
    btn.addEventListener('click', () => {
      valeurChoisie = Number(btn.dataset.valeur);
      etoiles.forEach((e) => e.classList.toggle('is-active', Number(e.dataset.valeur) <= valeurChoisie));
    });
  });

  const fermer = (difficulte) => {
    updateBook(livre.id, { difficulte, difficultePopupShown: true });
    overlay.remove();
  };

  document.getElementById('difficulte-garder').addEventListener('click', () => fermer(livre.difficulte || 1));
  document.getElementById('difficulte-valider').addEventListener('click', () => fermer(valeurChoisie));
}

// --- Popup de fin de livre (note + commentaire final) ----------------------

function openFinDeLivrePopup(livre) {
  const overlay = document.createElement('div');
  overlay.id = 'fin-livre-popup';
  overlay.innerHTML = `
    <style>
      #fin-livre-popup{ position:fixed; inset:0; z-index:600; background:rgba(10,6,2,.78);
        display:flex; align-items:center; justify-content:center; padding:20px; overflow-y:auto; }
      #fin-livre-popup .sheet{ max-width:420px; width:100%; background:linear-gradient(180deg,#2a1c10,#1c1108);
        border:2px solid var(--brass,#c9a876); border-radius:6px; padding:22px; text-align:center;
        font-family:'VT323', monospace; color:var(--parchment,#ede3c8); }
      #fin-livre-popup h2{ font-family:'Press Start 2P', monospace; font-size:13px; margin:0 0 6px; line-height:1.6; }
      #fin-livre-popup .sous-titre{ font-size:16px; opacity:.75; margin:0 0 18px; }
      #fin-livre-popup .champ{ text-align:left; margin-bottom:16px; }
      #fin-livre-popup label{ display:block; font-size:15px; opacity:.85; margin-bottom:6px; }
      #fin-livre-popup .etoiles{ display:flex; gap:8px; }
      #fin-livre-popup .etoile{ font-size:30px; cursor:pointer; opacity:.35; background:none; border:none; padding:0; }
      #fin-livre-popup .etoile.is-active{ opacity:1; }
      #fin-livre-popup textarea{ width:100%; box-sizing:border-box; font-family:'VT323', monospace; font-size:18px;
        padding:8px; border:2px solid var(--brass,#c9a876); border-radius:4px; background:#150e07; color:var(--parchment,#ede3c8);
        resize:vertical; }
      #fin-livre-popup .hint{ font-size:14px; opacity:.6; margin-top:4px; }
      #fin-livre-popup .actions{ display:flex; gap:10px; justify-content:center; margin-top:6px; }
    </style>
    <div class="sheet">
      <h2>${escapeHtml(livre.title)}</h2>
      <p class="sous-titre">Le livre se referme. Un dernier mot avant de le ranger&nbsp;?</p>
      <div class="champ">
        <label>Ta note (facultatif)</label>
        <div class="etoiles" id="fin-livre-etoiles">
          ${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="etoile" data-valeur="${n}">★</button>`).join('')}
        </div>
      </div>
      <div class="champ">
        <label for="fin-livre-commentaire">Commentaire final (facultatif — +${XP_COMMENTAIRE_FINAL} XP si rédigé)</label>
        <textarea id="fin-livre-commentaire" rows="4" placeholder="Ce que tu retiens de cette lecture…"></textarea>
        <p class="hint">Sans commentaire, ce bonus n'est pas accordé — le livre peut tout de même être marqué terminé.</p>
      </div>
      <div class="actions">
        <button class="btn-dnd btn-dnd--ghost" id="fin-livre-annuler" type="button">Annuler</button>
        <button class="btn-dnd" id="fin-livre-valider" type="button">Marquer comme terminé</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  let noteChoisie = null;
  const etoiles = overlay.querySelectorAll('.etoile');
  etoiles.forEach((btn) => {
    btn.addEventListener('click', () => {
      noteChoisie = Number(btn.dataset.valeur);
      etoiles.forEach((e) => e.classList.toggle('is-active', Number(e.dataset.valeur) <= noteChoisie));
    });
  });

  document.getElementById('fin-livre-annuler').addEventListener('click', () => overlay.remove());

  document.getElementById('fin-livre-valider').addEventListener('click', async () => {
    const commentaireFinal = document.getElementById('fin-livre-commentaire').value.trim();
    const difficulte = livre.difficulte || 1;
    const { total } = calculerXpFinDeLivre({ difficulte, commentaireFinal });

    await updateBook(livre.id, {
      status: 'finished',
      finishedAt: Date.now(),
      noteFinale: noteChoisie,
      commentaireFinal,
      xpEarnedOnFinish: total,
    });

    if (total > 0) await crediterXpFinDeLivre(total);
    if (commentaireFinal) await enregistrerCommentaireFinal({ livreId: livre.id, commentaire: commentaireFinal });

    overlay.remove();
  });
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
