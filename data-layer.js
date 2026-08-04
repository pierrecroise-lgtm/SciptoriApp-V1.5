// ScriptoriApp — data-layer.js
//
// Couche d'accès aux données de la Réserve — maintenant branchée sur
// Firestore (users/{uid}/books/{bookId}), en temps réel via onSnapshot :
// un livre ajouté sur un appareil apparaît automatiquement sur les autres,
// sans recharger la page.
//
// IMPORTANT — changement de pattern par rapport à la version localStorage :
// getBooks() ne suffit plus pour être notifié des changements distants.
// Utilise subscribeBooks(callback) pour être rappelé à chaque mise à jour
// (locale ou venant d'un autre appareil). getBooks() reste disponible pour
// une lecture ponctuelle du cache déjà chargé (ex: ouvrir la modale
// d'édition avec les valeurs actuelles).

import { db } from './firebase-init.js';
import { authReady } from './auth-guard.js';
import {
  collection,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getGenreGroup } from './genreGroups.js';

let uid = null;
let booksCache = [];
let listeners = [];
let snapshotStarted = false;

async function ready() {
  if (!uid) uid = await authReady;
  return uid;
}

function booksCollection() {
  return collection(db, 'users', uid, 'books');
}

function bookDoc(id) {
  return doc(db, 'users', uid, 'books', id);
}

async function startListening() {
  await ready();
  if (snapshotStarted) return;
  snapshotStarted = true;
  onSnapshot(booksCollection(), (snap) => {
    booksCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    listeners.forEach((cb) => cb(booksCache));
  });
}

export function subscribeBooks(callback) {
  listeners.push(callback);
  callback(booksCache);
  startListening();
  return () => {
    listeners = listeners.filter((cb) => cb !== callback);
  };
}

export function getBooks() {
  return booksCache;
}

export async function addBook(bookData) {
  await ready();
  const newBook = {
    title: bookData.title,
    author: bookData.author,
    genre: bookData.genre,
    pageCount: Number(bookData.pageCount) || 0,
    pagesRead: 0,
    provenance: bookData.provenance,
    coverUrl: bookData.coverUrl || '',
    synopsis: bookData.synopsis || '',
    notes: bookData.notes || '',
    status: bookData.status || 'backlog',
    countsForXp: bookData.countsForXp !== false,
    arcanesLevel: bookData.arcanesLevel || 1,
    finishedAt: bookData.status === 'finished' ? Date.now() : null,
    xpEarnedOnFinish: null,
    addedAt: Date.now(),
  };
  await addDoc(booksCollection(), newBook);
}

export async function startReading(id) {
  await ready();
  // .filter (pas .find) : si un doublon existe déjà (deux appareils ayant
  // démarré une lecture avant synchronisation), on les repasse TOUS en pause,
  // pas seulement le premier trouvé.
  const autresEnCours = booksCache.filter((b) => b.status === 'reading' && b.id !== id);
  await Promise.all(autresEnCours.map((b) => updateDoc(bookDoc(b.id), { status: 'backlog' })));
  await updateDoc(bookDoc(id), { status: 'reading', startedAt: Date.now() });
}

/**
 * Sélectionne LE livre en cours parmi une liste, même si plusieurs livres ont
 * (par accident, ex. collision multi-appareils) le statut "reading" : on
 * garde celui dont startedAt est le plus récent. S'auto-corrige donc même
 * si des doublons existent déjà dans Firestore, sans intervention manuelle.
 */
export function getCurrentReadingBook(books) {
  const enCours = books.filter((b) => b.status === 'reading');
  if (enCours.length === 0) return null;
  return enCours.reduce((plusRecent, b) =>
    (b.startedAt || 0) > (plusRecent.startedAt || 0) ? b : plusRecent
  );
}

export async function updateBook(id, patch) {
  await ready();
  await updateDoc(bookDoc(id), patch);
}

export async function deleteBook(id) {
  await ready();
  await deleteDoc(bookDoc(id));
}

export function computeStats(books) {
  const totalBooksOwned = books.length;
  const finished = books.filter((b) => b.status === 'finished');
  const totalBooksFinished = finished.length;

  const genresExplored = new Set(finished.map((b) => b.genre));
  const genresNeverExplored = new Set(
    books
      .filter((b) => b.status !== 'finished')
      .map((b) => b.genre)
      .filter((g) => !genresExplored.has(g))
  );

  const hasFinishedHorsTheme = finished.some(
    (b) => b.countsForXp && getGenreGroup(b.genre) !== 'favori'
  );

  return {
    totalBooksOwned,
    totalBooksFinished,
    genresNeverExploredCount: genresNeverExplored.size,
    hasFinishedHorsTheme,
  };
}
function seanceDoc(id) {
  return doc(db, 'users', uid, 'seances', id);
}

export async function updateSeance(id, patch) {
  await ready();
  await updateDoc(seanceDoc(id), patch);
}
