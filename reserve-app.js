// ScriptoriApp — reserve-app.js
// Logique de la rubrique Réserve (Bibliothèque / Archives).
//
// NOTE V1 : xp-engine.js contient déjà tout le futur système (Arcanes,
// Curiosité, Régularité, bonus de fin de livre). Pour la V1 on n'importe
// PAS ces fonctions ici — la Réserve ne calcule aucune XP.
//
// NOTE FIRESTORE : books n'est plus lu via getBooks() à chaque action, mais
// reçu en continu via subscribeBooks() — books se met à jour automatiquement
// si un livre est ajouté/modifié depuis un autre appareil.
//
// V1.5 : le mode édition global (crayon dans la topbar) a disparu — chaque
// carte affiche désormais toujours son propre bouton "modifier". Le bouton
// "notes" ouvre le même parchemin de notes de séance que "En cours" (voir
// notes-overlay.js, module partagé).
//
// V1.6 : la page ne scrolle plus dans son ensemble — reserve-bg.png garde
// toujours la taille de l'écran. Seule la liste de Grimoires défile, dans un
// carrousel qui met en avant l'ouvrage le plus proche du haut (60vw, net) et
// assombrit/rétrécit les suivants (50vw). La plaque évolutive apparaît au
// chargement puis se rétracte sous la topbar (comme le HUD de la home, mais
// avec un déplacement vertical) ; un tap au centre de la topbar la rappelle.

import { subscribeBooks, getBooks, addBook, updateBook, deleteBook, startReading } from './data-layer.js';
import { subscribeSeances } from './player-layer.js';
import { getGenreLabel } from './genreGroups.js';
import { processBookIllustration } from './image-pixelart.js';
import { openNotesOverlay } from './notes-overlay.js';

let currentSort = 'none';
let editingId = null; // id du livre en cours de modification, null = mode "ajout"
let currentSeances = [];
let pendingIllustrationUrl = '';
let illustrationDirty = false;

const els = {
  phrase: document.getElementById('evolutive-phrase'),
  plaque: document.getElementById('evolutive-plaque'),
  topbarHitbox: document.getElementById('topbar-hitbox'),
  tabBiblio: document.getElementById('tab-bibliotheque'),
  tabArchives: document.getElementById('tab-archives'),
  panelBiblio: document.getElementById('panel-bibliotheque'),
  panelArchives: document.getElementById('panel-archives'),
  listBiblio: document.getElementById('bibliotheque-list'),
  listArchives: document.getElementById('archives-list'),
  sortSelect: document.getElementById('sort-select'),
  fab: document.getElementById('open-add-modal'),
  modalManual: document.getElementById('modal-manual'),
  modalTitle: document.getElementById('modal-title'),
  submitBtn: document.getElementById('modal-submit-btn'),
  cancelManual: document.getElementById('cancel-manual'),
  deleteManual: document.getElementById('delete-manual'),
  manualForm: document.getElementById('manual-form'),
  synopsisInput: document.getElementById('f-synopsis'),
  synopsisCount: document.getElementById('synopsis-count'),
  illustrationInput: document.getElementById('f-illustration'),
  illustrationPreview: document.getElementById('illustration-preview'),
  illustrationPreviewImg: document.getElementById('illustration-preview-img'),
  illustrationStatus: document.getElementById('illustration-status'),
};

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---- Plaque évolutive : texte + rétractation automatique -------------------

function renderPhrase(books) {
  const total = books.length;
  if (total === 0) {
    els.phrase.textContent = 'Ta Réserve est encore vide. Le premier Grimoire attend.';
    return;
  }
  const inexplores = books.filter((b) => b.status === 'backlog' || b.status === 'reading').length;
  els.phrase.innerHTML =
    `<strong>${total}</strong> Grimoire${total > 1 ? 's' : ''} reposent dans ta Réserve, ` +
    `<strong>${inexplores}</strong> demeure${inexplores > 1 ? 'nt' : ''} inexploré${inexplores > 1 ? 's' : ''}.`;
}

let plaqueCollapseTimer = null;
function schedulePlaqueCollapse(delay = 4000) {
  clearTimeout(plaqueCollapseTimer);
  plaqueCollapseTimer = setTimeout(() => els.plaque.classList.add('collapsed'), delay);
}
window.addEventListener('load', () => schedulePlaqueCollapse(4000));
els.topbarHitbox.addEventListener('click', () => {
  const willExpand = els.plaque.classList.contains('collapsed');
  els.plaque.classList.toggle('collapsed');
  if (willExpand) schedulePlaqueCollapse(4500);
  else clearTimeout(plaqueCollapseTimer);
});

// ---- Carrousel : boucle infinie + mise en avant de la carte la plus proche du haut --

// La liste DOM est triplée (copie1 + copie2 + copie3) : l'utilisateur reste
// toujours visuellement dans la copie du milieu, et dès qu'il s'approche du
// début ou de la fin de cette copie, on retranche/rajoute silencieusement la
// hauteur d'une copie à scrollTop (saut instantané, imperceptible puisque les
// trois copies sont identiques) — donnant l'illusion d'un défilement infini.
function buildLoopedListHtml(items, renderFn, emptyHtml) {
  if (!items.length) return emptyHtml;
  const html = items.map(renderFn).join('');
  return html + html + html;
}

function initCarouselFocus(container) {
  let ticking = false;
  let loopReady = false;

  function update() {
    ticking = false;

    if (loopReady) {
      const copyHeight = container.scrollHeight / 3;
      if (copyHeight > 0) {
        if (container.scrollTop < copyHeight * 0.5) {
          container.scrollTop += copyHeight;
        } else if (container.scrollTop > copyHeight * 1.5) {
          container.scrollTop -= copyHeight;
        }
      }
    }

    const containerTop = container.getBoundingClientRect().top;
    let closest = null;
    let closestDist = Infinity;
    container.querySelectorAll('.grimoire-card').forEach((card) => {
      const dist = Math.abs(card.getBoundingClientRect().top - containerTop);
      if (dist < closestDist) { closestDist = dist; closest = card; }
    });
    container.querySelectorAll('.grimoire-card').forEach((card) => {
      card.classList.toggle('is-focused', card === closest);
    });
  }

  container.addEventListener('scroll', () => {
    if (!ticking) { ticking = true; requestAnimationFrame(update); }
  });

  // Point de départ : le début de la copie du milieu, pour avoir de la marge
  // pour boucler dans les deux sens dès le premier scroll.
  const hasCards = container.querySelector('.grimoire-card');
  if (hasCards && container.scrollHeight > 0) {
    container.scrollTop = container.scrollHeight / 3;
    loopReady = true;
  }
  update();
}

function sortBooks(list) {
  if (currentSort === 'author') return [...list].sort((a, b) => a.author.localeCompare(b.author));
  if (currentSort === 'genre') return [...list].sort((a, b) => getGenreLabel(a.genre).localeCompare(getGenreLabel(b.genre)));
  return list;
}

function renderTabContent(books) {
  const biblio = sortBooks(books.filter((b) => b.status === 'backlog' || b.status === 'reading'));
  const archives = sortBooks(books.filter((b) => b.status === 'finished'));

  els.listBiblio.innerHTML = buildLoopedListHtml(
    biblio,
    renderBiblioCard,
    '<li class="empty-state">Aucun ouvrage en attente. La Bibliothèque respire.</li>'
  );

  els.listArchives.innerHTML = buildLoopedListHtml(
    archives,
    renderArchiveCard,
    '<li class="empty-state">Aucun ouvrage achevé pour l\'instant.</li>'
  );

  els.listBiblio.querySelectorAll('[data-start-id]').forEach((btn) => {
    btn.addEventListener('click', () => startReading(btn.dataset.startId));
  });

  document.querySelectorAll('[data-edit-id]').forEach((btn) => {
    btn.addEventListener('click', (e) => openEditModal(e.currentTarget.dataset.editId));
  });

  document.querySelectorAll('[data-notes-id]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const book = getBooks().find((b) => b.id === e.currentTarget.dataset.notesId);
      if (book) openNotesOverlay(book, currentSeances);
    });
  });

  initCarouselFocus(els.panelBiblio);
  initCarouselFocus(els.panelArchives);
}

function coverOrPlaceholder(book) {
  const cover = book.coverUrl || 'images/grimoire-reserve.png';
  return `<div class="book-row__cover" style="background-image:url('${cover}')"></div>`;
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

function actionButtonsHtml(book) {
  return `
    <div class="book-row__actions">
      <button class="icon-action-btn" data-edit-id="${book.id}" type="button" aria-label="Modifier">
        <img src="images/button-modify.png" alt="">
      </button>
      <button class="icon-action-btn" data-notes-id="${book.id}" type="button" aria-label="Lire les notes">
        <img src="images/button-accesnotes.png" alt="">
      </button>
    </div>
  `;
}

function metaRowHtml(book, { enCours = false, aDejaCommence = false } = {}) {
  return `
    <div class="book-row__meta">
      <span class="tag--light">${getGenreLabel(book.genre)}</span>
      <span class="tag--light">${book.pageCount} pages</span>
      ${enCours ? '<span class="tag--light tag--progress">en cours</span>' : ''}
      ${!enCours && aDejaCommence ? `<span class="tag--light tag--progress">en pause · ${book.pagesRead}/${book.pageCount}</span>` : ''}
    </div>
  `;
}

function renderBiblioCard(book) {
  const enCours = book.status === 'reading';
  const aDejaCommence = book.pagesRead > 0;
  const synopsis = book.synopsis ? escapeHtml(book.synopsis) : '';
  return `
    <li class="grimoire-card">
      ${panelWrap(`
        <div class="book-row">
          ${coverOrPlaceholder(book)}
          <div class="book-row__body">
            <h3 class="book-row__title">${escapeHtml(book.title)}</h3>
            <p class="book-row__author">${escapeHtml(book.author)}</p>
            ${metaRowHtml(book, { enCours, aDejaCommence })}
            ${synopsis ? `<div class="book-row__divider"></div><p class="book-row__synopsis">${synopsis}</p>` : ''}
            ${!enCours ? `
              <div class="card-actions">
                <button class="btn-dnd btn-dnd--small" data-start-id="${book.id}" type="button">
                  ${aDejaCommence ? 'Reprendre' : 'Commencer'}
                </button>
              </div>` : ''}
          </div>
          ${actionButtonsHtml(book)}
        </div>
      `)}
    </li>
  `;
}

function renderArchiveCard(book) {
  const synopsis = book.synopsis ? escapeHtml(book.synopsis) : '';
  return `
    <li class="grimoire-card">
      ${panelWrap(`
        <div class="book-row">
          ${coverOrPlaceholder(book)}
          <div class="book-row__body">
            <h3 class="book-row__title">${escapeHtml(book.title)}</h3>
            <p class="book-row__author">${escapeHtml(book.author)}</p>
            ${metaRowHtml(book)}
            ${synopsis ? `<div class="book-row__divider"></div><p class="book-row__synopsis">${synopsis}</p>` : ''}
          </div>
          ${actionButtonsHtml(book)}
        </div>
      `)}
    </li>
  `;
}

function switchTab(tab) {
  const isBiblio = tab === 'bibliotheque';
  els.tabBiblio.setAttribute('aria-selected', String(isBiblio));
  els.tabArchives.setAttribute('aria-selected', String(!isBiblio));
  els.panelBiblio.hidden = !isBiblio;
  els.panelArchives.hidden = isBiblio;
}
els.tabBiblio.addEventListener('click', () => switchTab('bibliotheque'));
els.tabArchives.addEventListener('click', () => switchTab('archives'));

els.sortSelect.addEventListener('change', (e) => {
  currentSort = e.target.value;
  renderTabContent(getBooks());
});

function openModal(modal) { modal.classList.add('is-open'); }
function closeModal(modal) { modal.classList.remove('is-open'); }

function resetIllustrationPicker() {
  pendingIllustrationUrl = '';
  illustrationDirty = false;
  els.illustrationInput.value = '';
  els.illustrationPreview.classList.remove('is-visible');
  els.illustrationPreviewImg.removeAttribute('src');
  els.illustrationStatus.textContent = '';
}

function showIllustrationPreview(dataUrl, message = 'Illustration pixel art prête.') {
  els.illustrationPreviewImg.src = dataUrl;
  els.illustrationPreview.classList.add('is-visible');
  els.illustrationStatus.textContent = message;
}

function openAddModal() {
  editingId = null;
  els.modalTitle.textContent = 'Ajouter un Grimoire';
  els.submitBtn.textContent = 'Ajouter';
  els.deleteManual.hidden = true;
  els.manualForm.reset();
  els.synopsisCount.textContent = '0';
  resetIllustrationPicker();
  openModal(els.modalManual);
}

function openEditModal(id) {
  const book = getBooks().find((b) => b.id === id);
  if (!book) return;
  editingId = id;
  els.modalTitle.textContent = 'Modifier le Grimoire';
  els.submitBtn.textContent = 'Enregistrer';
  els.deleteManual.hidden = false;
  els.manualForm.elements['title'].value = book.title;
  els.manualForm.elements['author'].value = book.author;
  els.manualForm.elements['pageCount'].value = book.pageCount;
  els.manualForm.elements['genre'].value = book.genre;
  els.manualForm.elements['synopsis'].value = book.synopsis || '';
  els.synopsisCount.textContent = String((book.synopsis || '').length);
  els.manualForm.elements['provenance'].value = book.provenance;
  els.manualForm.elements['destination'].value = book.status === 'finished' ? 'finished' : 'backlog';
  resetIllustrationPicker();
  if (book.coverUrl) showIllustrationPreview(book.coverUrl, 'Illustration actuelle. Choisis une nouvelle image pour la remplacer.');
  openModal(els.modalManual);
}

els.synopsisInput.addEventListener('input', () => {
  els.synopsisCount.textContent = String(els.synopsisInput.value.length);
});

els.illustrationInput.addEventListener('change', async () => {
  const file = els.illustrationInput.files?.[0];
  if (!file) return;

  els.illustrationStatus.textContent = 'Transformation pixel art…';
  els.illustrationPreview.classList.add('is-visible');
  els.submitBtn.disabled = true;
  try {
    pendingIllustrationUrl = await processBookIllustration(file);
    illustrationDirty = true;
    showIllustrationPreview(pendingIllustrationUrl, 'Image allégée et transformée en pixel art D&D.');
  } catch (error) {
    pendingIllustrationUrl = '';
    illustrationDirty = false;
    els.illustrationPreview.classList.remove('is-visible');
    els.illustrationStatus.textContent = error.message || 'Impossible de traiter cette image.';
  } finally {
    els.submitBtn.disabled = false;
  }
});

els.fab.addEventListener('click', openAddModal);
els.cancelManual.addEventListener('click', () => closeModal(els.modalManual));

els.deleteManual.addEventListener('click', async () => {
  if (!editingId) return;
  const book = getBooks().find((b) => b.id === editingId);
  const nom = book ? book.title : 'ce Grimoire';
  if (confirm(`Supprimer "${nom}" ? Cette action est irréversible.`)) {
    await deleteBook(editingId);
    editingId = null;
    closeModal(els.modalManual);
  }
});

els.modalManual.addEventListener('click', (e) => {
  if (e.target === els.modalManual) closeModal(els.modalManual);
});

els.manualForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = new FormData(els.manualForm);
  const destination = data.get('destination');

  const payload = {
    title: data.get('title').trim(),
    author: data.get('author').trim(),
    pageCount: data.get('pageCount'),
    genre: data.get('genre'),
    synopsis: (data.get('synopsis') || '').trim().slice(0, 120),
    provenance: data.get('provenance'),
    status: destination,
    countsForXp: destination !== 'finished',
  };

  if (editingId) {
    const patch = { ...payload, pageCount: Number(payload.pageCount) || 0 };
    if (illustrationDirty) patch.coverUrl = pendingIllustrationUrl;
    await updateBook(editingId, patch);
  } else {
    await addBook({ ...payload, coverUrl: pendingIllustrationUrl });
  }

  els.manualForm.reset();
  els.synopsisCount.textContent = '0';
  editingId = null;
  resetIllustrationPicker();
  closeModal(els.modalManual);
});

subscribeBooks((books) => {
  renderPhrase(books);
  renderTabContent(books);
});

subscribeSeances((seances) => {
  currentSeances = seances;
});
