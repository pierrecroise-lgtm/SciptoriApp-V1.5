// ScriptoriApp — notes-overlay.js
//
// Parchemin plein écran listant les notes de lecture d'un livre, séance après
// séance (de la plus ancienne en haut à la plus récente en bas).
//
// Module PARTAGÉ entre encours.html (bouton "Lire les notes") et reserve.html
// (bouton button-accesnotes.png sur chaque Grimoire) : les deux renvoient
// exactement au même endroit, sur les mêmes notes prises séance après séance
// dans "En cours". Voir data-layer.js/player-layer.js pour le modèle de
// données (une "séance" = { id, livreId, note, date, createdAt }).

import { updateSeance } from './player-layer.js';

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

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

/**
 * Ouvre le parchemin de notes pour `livre`, à partir de la liste complète des
 * séances (fournie par l'appelant via subscribeSeances/getSeances de
 * player-layer.js).
 */
export function openNotesOverlay(livre, seances) {
  const notes = (seances || [])
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
