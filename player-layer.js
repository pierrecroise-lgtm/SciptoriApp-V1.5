// ScriptoriApp — player-layer.js
//
// État du joueur (XP total, niveau) sur Firestore, document users/{uid}.
//
// V1.2 : les séances de lecture (avec leur note) ne vivent plus dans un
// tableau à l'intérieur de ce document (historiqueSeances), mais dans leur
// propre sous-collection users/{uid}/seances/{seanceId}. Un document
// Firestore est plafonné à 1 Mo ; un tableau qui grossit indéfiniment avec
// des notes de lecture aurait fini par l'atteindre après des années
// d'usage. Une sous-collection n'a pas cette limite.
//
// MIGRATION AUTOMATIQUE : au premier chargement après cette mise à jour,
// migrateLegacySeancesIfNeeded() détecte l'ancien tableau historiqueSeances
// s'il existe encore, recopie chaque entrée dans la nouvelle sous-collection,
// puis supprime le champ historiqueSeances du document. Ne s'exécute qu'une
// fois : une fois le champ supprimé, il n'y a plus rien à migrer.

import { db } from './firebase-init.js';
import { authReady } from './auth-guard.js';
import {
  doc,
  onSnapshot,
  setDoc,
  updateDoc,
  getDoc,
  deleteField,
  collection,
  addDoc,
  query,
  orderBy,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { calculerNiveau } from './xp-engine.js';

function defaultPlayer() {
  return { xpTotal: 0, niveau: 1 };
}

let uid = null;
let playerCache = defaultPlayer();
let seancesCache = [];
let playerListeners = [];
let seancesListeners = [];
let started = false;

async function ready() {
  if (!uid) uid = await authReady;
  return uid;
}

function playerDocRef() {
  return doc(db, 'users', uid);
}

function seancesCollection() {
  return collection(db, 'users', uid, 'seances');
}

function seanceDoc(id) {
  return doc(db, 'users', uid, 'seances', id);
}

async function migrateLegacySeancesIfNeeded(playerData) {
  const legacy = playerData.historiqueSeances;
  if (!Array.isArray(legacy) || legacy.length === 0) return;

  for (const seance of legacy) {
    await addDoc(seancesCollection(), {
      ...seance,
      createdAt: seance.createdAt || Date.now(),
    });
  }
  await updateDoc(playerDocRef(), { historiqueSeances: deleteField() });
}

async function startListening() {
  await ready();
  if (started) return;
  started = true;

  const snap = await getDoc(playerDocRef());
  if (!snap.exists()) {
    await setDoc(playerDocRef(), defaultPlayer());
  } else {
    await migrateLegacySeancesIfNeeded(snap.data());
  }

  onSnapshot(playerDocRef(), (docSnap) => {
    if (docSnap.exists()) {
      const data = docSnap.data();
      playerCache = { xpTotal: data.xpTotal ?? 0, niveau: data.niveau ?? 1 };
      playerListeners.forEach((cb) => cb(playerCache));
    }
  });

  onSnapshot(query(seancesCollection(), orderBy('createdAt', 'desc')), (snap) => {
    seancesCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    seancesListeners.forEach((cb) => cb(seancesCache));
  });
}

/**
 * S'abonne à l'état du joueur (XP/niveau). Appelle immédiatement callback
 * avec l'état courant, puis à chaque changement (y compris depuis un autre
 * appareil). Retourne une fonction de désabonnement.
 */
export function subscribePlayer(callback) {
  playerListeners.push(callback);
  callback(playerCache);
  startListening();
  return () => {
    playerListeners = playerListeners.filter((cb) => cb !== callback);
  };
}

/**
 * S'abonne à l'historique des séances (notes comprises), triées de la plus
 * récente à la plus ancienne.
 */
export function subscribeSeances(callback) {
  seancesListeners.push(callback);
  callback(seancesCache);
  startListening();
  return () => {
    seancesListeners = seancesListeners.filter((cb) => cb !== callback);
  };
}

export function getPlayer() {
  return playerCache;
}

export function getSeances() {
  return seancesCache;
}

/**
 * Enregistre une séance de lecture (pages, XP gagnée, note optionnelle) dans
 * sa propre sous-collection, et met à jour xpTotal/niveau sur le document
 * joueur.
 */
export async function enregistrerSeance({ livreId, pagesLues, xpGagne, note }) {
  await ready();
  const nouveauXpTotal = playerCache.xpTotal + xpGagne;
  const { niveau } = calculerNiveau(nouveauXpTotal);

  await addDoc(seancesCollection(), {
    date: new Date().toISOString().slice(0, 10),
    livreId,
    pagesLues,
    xpGagne,
    note: note || '',
    createdAt: Date.now(),
  });

  await updateDoc(playerDocRef(), {
    xpTotal: nouveauXpTotal,
    niveau,
  });
}


export async function updateSeance(id, patch) {
  await ready();
  await updateDoc(seanceDoc(id), patch);
}
