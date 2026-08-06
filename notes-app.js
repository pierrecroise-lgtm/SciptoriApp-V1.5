// ScriptoriApp — notes-app.js
// Logique de la rubrique Guilde : les ouvrages achevés (status "finished"
// dans data-layer.js), triables et cherchables. Chaque carte, une fois
// dépliée, ouvre le même parchemin de notes de séance que la Réserve
// (onglet Archives) et En cours — voir notes-overlay.js, module partagé
// entre les trois rubriques : elles renvoient toutes aux mêmes notes.
//
// NOTE V2 : le livre (data-layer.js) porte désormais noteFinale (1 à 5
// étoiles, facultative) renseignée via le popup de fin de livre dans
// "En cours". Le commentaire final, lui, n'est pas dupliqué ici : il vit
// dans la sous-collection "seances" (type "commentaireFinal") et reste
// consultable, épinglé en tête, via "Lire les notes" (notes-overlay.js,
// module partagé entre la Guilde, la Réserve et En cours).

import { subscribeBooks, getBooks } from './data-layer.js';
import { subscribeSeances } from './player-layer.js';
import { getGenreLabel } from './genreGroups.js';
import { openNotesOverlay } from './notes-overlay.js';

let currentSort = 'recent';
let currentQuery = '';
let openId = null;
let currentSeances = [];
let lastKnownBooks = [];

const els = {
  phrase: document.getElementById('guilde-phrase'),
  list: document.getElementById('guilde-list'),
  sortSelect: document.getElementById('sort-select'),
  toggleSearch: document.getElementById('toggle-search'),
  searchRow: document.getElementById('search-row'),
  searchInput: document.getElementById('search-input'),
};

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function joursEntre(debut, fin) {
  if (!debut || !fin) return null;
  return Math.max(1, Math.round((fin - debut) / 86400000));
}

function formatDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('fr-FR');
}

function panelWrap(innerHtml) {
  return `
    <div class="panel">
      <div class="panel-corner top-left"></div>
      <div class="panel-edge top"></div>
      <div class="panel-corner top-right"></div>
      <div class="panel-edge left"></div>
      <div class="panel-content">${innerHtml}</div>
      <div class="panel-edge right"></div>
      <div class="panel-corner bottom-left"></div>
      <div class="panel-edge bottom"></div>
      <div class="panel-corner bottom-right"></div>
    </div>
  `;
}

function coverOrPlaceholder(book) {
  const cover = book.coverUrl || 'images/grimoire-notes.png';
  return `<div class="book-row__cover" style="background-image:url('${cover}')"></div>`;
}

function sortBooks(list) {
  const sorted = [...list];
  switch (currentSort) {
    case 'title':
      return sorted.sort((a, b) => a.title.localeCompare(b.title, 'fr'));
    case 'author':
      return sorted.sort((a, b) => a.author.localeCompare(b.author, 'fr'));
    case 'genre':
      return sorted.sort((a, b) => getGenreLabel(a.genre).localeCompare(getGenreLabel(b.genre), 'fr'));
    case 'recent':
    default:
      return sorted.sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0));
  }
}

function filterBooks(list) {
  const q = currentQuery.trim().toLowerCase();
  if (!q) return list;
  return list.filter((b) =>
    (b.title || '').toLowerCase().includes(q) ||
    (b.author || '').toLowerCase().includes(q)
  );
}

function renderPhrase(finished) {
  if (finished.length === 0) {
    els.phrase.textContent = "La Guilde n'a encore consigné aucun ouvrage achevé.";
    return;
  }
  els.phrase.innerHTML =
    `<strong>${finished.length}</strong> ouvrage${finished.length > 1 ? 's' : ''} ` +
    `achevé${finished.length > 1 ? 's' : ''} reposent dans les archives de la Guilde.`;
}

function renderEtoiles(note) {
  if (!note) return '';
  return `<span class="guilde-note" aria-label="Note : ${note}/5">${'★'.repeat(note)}${'☆'.repeat(5 - note)}</span>`;
}

function renderCard(book) {
  const isOpen = book.id === openId;
  const jours = joursEntre(book.startedAt, book.finishedAt);
  const synopsis = book.synopsis ? escapeHtml(book.synopsis) : '';

  return `
    <li class="grimoire-card">
      ${panelWrap(`
        <div class="book-row" data-toggle="${book.id}">
          ${coverOrPlaceholder(book)}
          <div class="book-row__body">
            <h3 class="book-row__title">${escapeHtml(book.title)}</h3>
            <p class="book-row__author">${escapeHtml(book.author)}</p>
            <div class="book-row__meta">
              <span class="tag--light">${getGenreLabel(book.genre)}</span>
              <span class="tag--light">${book.pageCount} pages</span>
              <span class="tag--light">Achevé le ${formatDate(book.finishedAt)}</span>
              ${renderEtoiles(book.noteFinale)}
            </div>
          </div>
          <span class="guilde-chevron">${isOpen ? '▼' : '▶'}</span>
        </div>
        <div class="guilde-detail ${isOpen ? 'is-open' : ''}">
          ${synopsis ? `<div class="book-row__divider"></div><p class="book-row__synopsis">${synopsis}</p>` : ''}
          <div class="guilde-detail__stats">
            <div class="guilde-stat">
              <span class="label">Durée de lecture</span>
              <span class="value">${jours ? `${jours} jour${jours > 1 ? 's' : ''}` : 'non renseignée'}</span>
            </div>
            <div class="guilde-stat">
              <span class="label">Provenance</span>
              <span class="value">${escapeHtml(book.provenance || '—')}</span>
            </div>
          </div>
          <button class="btn-dnd btn-dnd--ghost btn-dnd--small guilde-notes-btn" data-notes-id="${book.id}" type="button">
            <img src="images/button-accesnotes.png" alt="">
            Lire les notes
          </button>
        </div>
      `)}
    </li>
  `;
}

function render(books) {
  const finished = books.filter((b) => b.status === 'finished');
  renderPhrase(finished);

  const visible = sortBooks(filterBooks(finished));

  els.list.innerHTML = visible.length
    ? visible.map(renderCard).join('')
    : `<li class="empty-state">${
        finished.length === 0
          ? "Aucun ouvrage achevé pour l'instant."
          : 'Aucun ouvrage ne correspond à ta recherche.'
      }</li>`;

  els.list.querySelectorAll('[data-toggle]').forEach((row) => {
    row.addEventListener('click', () => {
      const id = row.dataset.toggle;
      openId = openId === id ? null : id;
      render(books);
    });
  });

  els.list.querySelectorAll('[data-notes-id]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const book = getBooks().find((b) => b.id === e.currentTarget.dataset.notesId);
      if (book) openNotesOverlay(book, currentSeances);
    });
  });
}

subscribeBooks((books) => {
  lastKnownBooks = books;
  render(books);
});

subscribeSeances((seances) => {
  currentSeances = seances;
});

els.sortSelect.addEventListener('change', (e) => {
  currentSort = e.target.value;
  render(lastKnownBooks);
});

els.toggleSearch.addEventListener('click', () => {
  const willOpen = els.searchRow.classList.contains('hidden');
  els.searchRow.classList.toggle('hidden');
  els.toggleSearch.classList.toggle('is-active', willOpen);
  if (willOpen) els.searchInput.focus();
});

els.searchInput.addEventListener('input', (e) => {
  currentQuery = e.target.value;
  render(lastKnownBooks);
});
