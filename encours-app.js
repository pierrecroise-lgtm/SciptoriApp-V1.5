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
import { subscribePlayer, subscribeSeances, enregistrerSeance, updateSeance } from './player-layer.js';
import { calculerXpSavoir, calculerBonusSeance, calculerNiveau } from './xp-engine.js';

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

// --- Parchemin des notes ----------------------------------------------------

function renderNoteEntry(seanceId, date, noteText) {
  return `
    <div class="note-entry" data-seance-id="${escapeHtml(seanceId)}">
      <div class="note-header">
        <span class="note-date">${escapeHtml(date)}</span>
        <button class="note-edit-btn" data-edit-seance="${escapeHtml(seanceId)}" type="button" aria-label="Modifier">✏️</button>
      </div>
      <div class="note-text" data-note-text>${escapeHtml(noteText)}</div>
    </div>
  `;
}

function renderNoteEditForm(seanceId, date, noteText) {
  return `
    <div class="note-edit-form">
      <textarea class="note-edit-textarea" data-note-edit-text aria-label="Modifier la note">${escapeHtml(noteText)}</textarea>
      <div class="note-edit-actions">
        <button type="button" data-save-note>Enregistrer</button>
        <button type="button" data-cancel-note>Annuler</button>
      </div>
    </div>
  `;
}

function attachEditButton(entry) {
  const btn = entry.querySelector('[data-edit-seance]');
  if (btn) btn.addEventListener('click', () => enterEditMode(btn));
}

function enterEditMode(btn) {
  const entry = btn.closest('.note-entry');
  if (!entry) return;

  const seanceId = entry.dataset.seanceId;
  const date = entry.querySelector('.note-date')?.textContent || '';
  const noteText = entry.querySelector('[data-note-text]')?.textContent || '';

  entry.innerHTML = renderNoteEditForm(seanceId, date, noteText);

  const textarea = entry.querySelector('[data-note-edit-text]');
  const saveBtn = entry.querySelector('[data-save-note]');
  const cancelBtn = entry.querySelector('[data-cancel-note]');

  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);

  saveBtn.addEventListener('click', () => {
    const newNote = textarea.value.trim();

    // Mise à jour optimiste : l'interface est mise à jour immédiatement.
    entry.innerHTML = renderNoteEntry(seanceId, date, newNote);
    attachEditButton(entry);

    // Firestore suit en arrière-plan ; une erreur n'empêche pas l'édition
    // locale de rester fluide.
    updateSeance(seanceId, { note: newNote }).catch((error) => {
      console.error('Impossible de mettre à jour la note de séance', error);
    });
  });

  cancelBtn.addEventListener('click', () => {
    entry.innerHTML = renderNoteEntry(seanceId, date, noteText);
    attachEditButton(entry);
  });
}

function openNotesOverlay(livre) {
  const notes = currentSeances
    .filter((s) => s.livreId === livre.id && s.note && s.note.trim() !== '')
    .slice()
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)); // plus ancienne en premier

  const overlay = document.createElement('div');
  overlay.id = 'notes-overlay';
  overlay.innerHTML = `
    <style>
      #notes-overlay{
        position:fixed; inset:0; z-index:500;
        background:linear-gradient(180deg,#f3e6c8,#e8d5a8);
        overflow-y:auto;
        padding:70px 20px 40px;
        font-family:'VT323', monospace;
        color:#2a1c10;
      }
      #notes-overlay .notes-close{
        position:fixed; top:16px; right:16px; z-index:501;
        width:38px; height:38px; border-radius:50%;
        background:#2a1c10; color:#ede3c8; border:2px solid #c9a876;
        font-size:18px; line-height:1; cursor:pointer;
        display:flex; align-items:center; justify-content:center;
      }
      #notes-overlay .notes-scroll{ max-width:560px; margin:0 auto; }
      #notes-overlay h2{
        font-family:'Press Start 2P', monospace; font-size:14px; color:#4a3620;
        text-align:center; margin:0 0 26px; line-height:1.6;
      }
      #notes-overlay .note-entry{ padding:14px 0; border-bottom:1px dashed rgba(58,39,23,.3); }
      #notes-overlay .note-entry:last-child{ border-bottom:none; }
      #notes-overlay .note-header{ display:flex; justify-content:space-between; align-items:center; gap:8px; }
      #notes-overlay .note-date{ font-size:14px; color:#8a6a3a; margin-bottom:4px; font-weight:bold; }
      #notes-overlay .note-text{ font-size:19px; line-height:1.4; white-space:pre-wrap; }
      #notes-overlay .note-edit-btn{ background:none; border:none; cursor:pointer; font-size:16px; flex:none; }
      #notes-overlay .note-edit-textarea{
        width:100%; font-family:'VT323', monospace; font-size:19px; padding:6px;
        border:2px solid #4a3620; border-radius:4px; background:#fffdf6; color:#2a1c10;
        resize:vertical; box-sizing:border-box; margin-top:4px;
      }
      #notes-overlay .note-edit-actions{ display:flex; gap:8px; margin-top:6px; }
      #notes-overlay .note-edit-actions button{
        font-family:'VT323', monospace; font-size:16px; padding:4px 10px;
        border:1px solid #4a3620; border-radius:4px; cursor:pointer; background:#ede3c8; color:#2a1c10;
      }
      #notes-overlay .notes-empty{ text-align:center; font-style:italic; opacity:.7; margin-top:40px; }
    </style>
    <button class="notes-close" id="notes-close" type="button" aria-label="Fermer">✕</button>
    <div class="notes-scroll">
      <h2>${escapeHtml(livre.title)}<br>Notes de lecture</h2>
      ${notes.length
        ? notes.map((n) => renderNoteEntry(n.id, n.date, n.note)).join('')
        : '<p class="notes-empty">Aucune note pour ce livre pour l\'instant.</p>'}
    </div>
  `;

  document.body.appendChild(overlay);
  document.getElementById('notes-close').addEventListener('click', () => overlay.remove());

  overlay.querySelectorAll('[data-edit-seance]').forEach((btn) => {
    btn.addEventListener('click', () => enterEditMode(btn));
  });
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
    btnLireNotes.addEventListener('click', () => openNotesOverlay(livre));
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
