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
import {
  calculerNiveau,
  calculerBonusRegularite,
  appliquerDoublementRegularite,
  estRegulariteActive,
  estJourSuivant,
  JOURS_SERIE_MAX,
} from './xp-engine.js';

function defaultPlayer() {
  return {
    xpTotal: 0,
    niveau: 1,
    // --- Régularité (série de connexion) ---
    // Dernier jour ("YYYY-MM-DD") où une séance a été enregistrée.
    derniereDateLecture: null,
    // Jour courant de la série, de 1 à 7. 0 = aucune série en cours.
    jourDeSerie: 0,
    // Bonus gagné mais pas encore affiché/crédité : il est mis en attente
    // au moment où le jour de série est établi (fin de séance), et crédité
    // au prochain lancement de l'app (barre de mana), pas immédiatement.
    bonusRegulariteEnAttente: null,
  };
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
      playerCache = {
        xpTotal: data.xpTotal ?? 0,
        niveau: data.niveau ?? 1,
        derniereDateLecture: data.derniereDateLecture ?? null,
        jourDeSerie: data.jourDeSerie ?? 0,
        bonusRegulariteEnAttente: data.bonusRegulariteEnAttente ?? null,
      };
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
 * sa propre sous-collection, met à jour xpTotal/niveau sur le document
 * joueur, et fait avancer la série de Régularité.
 *
 * `xpGagne` doit déjà inclure Savoir + Discipline (bonus de séance) +
 * Maîtrise des Arcanes (bonus de note) — calculé par l'appelant. Le bonus
 * de Régularité n'est PAS ajouté ici à xpTotal : il est mis en attente
 * (bonusRegulariteEnAttente) pour être crédité au prochain lancement de
 * l'app, cf. creditBonusRegulariteEnAttente().
 *
 * `difficulteLivre` (1 à 3) est celle du livre lu pendant cette séance :
 * elle est mémorisée avec le bonus en attente pour appliquer le
 * doublement de Curiosité (livre 3/3) au moment du crédit.
 */
export async function enregistrerSeance({ livreId, pagesLues, xpGagne, note, difficulteLivre }) {
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

  const patch = { xpTotal: nouveauXpTotal, niveau };

  // La série de Régularité n'avance qu'une fois par jour calendaire, et
  // seulement à partir du niveau 2 (cf. estRegulariteActive).
  const aujourdhui = new Date().toISOString().slice(0, 10);
  if (estRegulariteActive(niveau) && playerCache.derniereDateLecture !== aujourdhui) {
    let nouveauJourDeSerie;
    if (estJourSuivant(playerCache.derniereDateLecture, aujourdhui)) {
      // Prolonge la série. Si la série précédente venait d'atteindre 7
      // (rituel accompli, remis à zéro par creditBonusRegulariteEnAttente),
      // jourDeSerie vaut déjà 0 ici : ce jour redevient donc un jour 1.
      nouveauJourDeSerie = (playerCache.jourDeSerie || 0) >= JOURS_SERIE_MAX
        ? 1
        : (playerCache.jourDeSerie || 0) + 1;
    } else {
      // Premier jour de lecture, ou un jour a été manqué : la série repart.
      nouveauJourDeSerie = 1;
    }

    patch.derniereDateLecture = aujourdhui;
    patch.jourDeSerie = nouveauJourDeSerie;
    patch.bonusRegulariteEnAttente = {
      montant: calculerBonusRegularite(nouveauJourDeSerie),
      difficulte: difficulteLivre || 1,
      jourDeSerie: nouveauJourDeSerie,
      dateGagne: aujourdhui,
    };
  }

  await updateDoc(playerDocRef(), patch);
}

/**
 * À appeler une fois au lancement de l'app (Home) : crédite le bonus de
 * Régularité en attente s'il y en a un, applique le doublement Curiosité
 * si le livre concerné était noté 3/3, et boucle/réinitialise la série au
 * 7e jour ("Rituel hebdomadaire accompli").
 *
 * Retourne null s'il n'y a rien à créditer (rien à animer), sinon
 * { montant, ritualAccompli } pour piloter la barre de mana.
 */
export async function creditBonusRegulariteEnAttente() {
  await ready();
  const pending = playerCache.bonusRegulariteEnAttente;
  if (!pending || !estRegulariteActive(playerCache.niveau)) return null;

  const montant = appliquerDoublementRegularite(pending.montant, pending.difficulte);
  const ritualAccompli = pending.jourDeSerie >= JOURS_SERIE_MAX;
  const nouveauXpTotal = playerCache.xpTotal + montant;
  const { niveau } = calculerNiveau(nouveauXpTotal);

  await updateDoc(playerDocRef(), {
    xpTotal: nouveauXpTotal,
    niveau,
    bonusRegulariteEnAttente: null,
    // Le 7e jour boucle la série : le prochain jour de lecture redevient un jour 1.
    ...(ritualAccompli ? { jourDeSerie: 0 } : {}),
  });

  return { montant, ritualAccompli };
}

/**
 * Crédite l'XP de fin de livre (Curiosité + Maîtrise des Arcanes du
 * commentaire final, cf. xp-engine.calculerXpFinDeLivre) sans créer de
 * fausse séance de lecture.
 */
export async function crediterXpFinDeLivre(xpGagne) {
  await ready();
  if (!xpGagne) return;
  const nouveauXpTotal = playerCache.xpTotal + xpGagne;
  const { niveau } = calculerNiveau(nouveauXpTotal);
  await updateDoc(playerDocRef(), { xpTotal: nouveauXpTotal, niveau });
}


/**
 * Enregistre le commentaire final d'un livre comme une entrée de la même
 * sous-collection "seances" que les notes de séance classiques (afin de
 * réutiliser exactement le même parchemin, notes-overlay.js), mais taguée
 * `type: 'commentaireFinal'` pour être épinglée en tête de liste plutôt que
 * triée chronologiquement avec le reste.
 */
export async function enregistrerCommentaireFinal({ livreId, commentaire }) {
  await ready();
  await addDoc(seancesCollection(), {
    date: new Date().toISOString().slice(0, 10),
    livreId,
    pagesLues: 0,
    xpGagne: 0,
    note: commentaire,
    type: 'commentaireFinal',
    createdAt: Date.now(),
  });
}

export async function updateSeance(id, patch) {
  await ready();
  await updateDoc(seanceDoc(id), patch);
}
