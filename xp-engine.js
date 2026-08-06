// ScriptoriApp — xp-engine.js
// Fonctions pures de calcul d'XP (règles v2, cf. "regles-XP.txt").
// Importé par toutes les rubriques qui déclenchent un gain d'XP
// (Réserve à la fin d'un livre, En cours pour les séances, Home pour la
// Régularité). Aucune dépendance Firebase ici : uniquement des calculs,
// testables isolément.
//
// V2 — changements par rapport à la V1 :
// - Discipline : nouvelle table de paliers (l'ancienne accordait trop
//   d'XP pour 10 pages par rapport au rythme du Savoir).
// - Curiosité : ne dépend plus du genre du livre, mais de sa difficulté
//   (champ "difficulte", 1 à 3, ex-"arcanesLevel"). Le genre reste géré
//   par genreGroups.js mais uniquement pour le tri/filtre en Réserve et
//   Notes — il ne sert plus au calcul d'XP.
// - Maîtrise des Arcanes : ne dépend plus de la difficulté du livre, mais
//   de l'écrit du joueur (note de séance, commentaire final).
// - Bonus fixe de fin de livre (50 XP) : supprimé, remplacé par
//   Curiosité + Maîtrise des Arcanes.
// - Régularité : le bonus d'un livre noté 3/3 est doublé, en continu,
//   pendant toute sa lecture (et non recalculé rétroactivement à la fin).

/** LE SAVOIR — 1 page = 0,5 XP, toujours attribué. */
export function calculerXpSavoir(pagesLues) {
  return pagesLues * 0.5;
}

/**
 * LA DISCIPLINE — bonus de fin de séance, par palier de 10 pages.
 * Entre deux paliers, on retient le palier inférieur (Math.floor).
 * Plafonné à 45 XP au-delà de 50 pages.
 */
const PALIERS_DISCIPLINE = [
  { seuil: 50, bonus: 45 },
  { seuil: 40, bonus: 34 },
  { seuil: 30, bonus: 23 },
  { seuil: 20, bonus: 12 },
  { seuil: 10, bonus: 5 },
];

export function calculerBonusSeance(pagesLues) {
  const palier = PALIERS_DISCIPLINE.find((p) => pagesLues >= p.seuil);
  return palier ? palier.bonus : 0;
}

/**
 * LA DISCIPLINE — bonus de régularité selon le jour de la série (1 à 7).
 * Le compteur ne dépasse jamais 7 : au 7e jour consécutif de lecture, la
 * série est bouclée ("Rituel hebdomadaire accompli") puis réinitialisée.
 * Si un jour de lecture est manqué, le compteur repart à zéro.
 * N'est actif qu'à partir du niveau 2 du joueur (cf. estRegulariteActive).
 */
const BONUS_REGULARITE_PAR_JOUR = { 1: 0, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7 };
export const JOURS_SERIE_MAX = 7;

export function calculerBonusRegularite(jourDeSerie) {
  return BONUS_REGULARITE_PAR_JOUR[jourDeSerie] ?? 0;
}

/** La Régularité (série de connexion) ne se déclenche qu'à partir du niveau 2. */
export function estRegulariteActive(niveauJoueur) {
  return niveauJoueur >= 2;
}

/**
 * Deux dates ("YYYY-MM-DD") sont-elles des jours calendaires consécutifs ?
 * Utilisé pour savoir si une nouvelle séance prolonge la série en cours
 * (dateVeille = jour précédent) ou si un jour a été manqué (la série doit
 * repartir de zéro).
 */
export function estJourSuivant(dateVeille, dateAujourdhui) {
  if (!dateVeille) return false;
  const veille = new Date(`${dateVeille}T00:00:00`);
  const jour = new Date(`${dateAujourdhui}T00:00:00`);
  const diffJours = Math.round((jour - veille) / 86400000);
  return diffJours === 1;
}

/**
 * Applique le doublement de Curiosité : un livre noté 3/3 double tout bonus
 * de Régularité gagné pendant sa lecture. `difficulte` est celle du livre
 * actuellement en cours au moment où le bonus est crédité (ouverture de
 * l'app à J+1).
 */
export function appliquerDoublementRegularite(bonusRegulariteBase, difficulte) {
  return difficulte === 3 ? bonusRegulariteBase * 2 : bonusRegulariteBase;
}

/**
 * LA MAITRISE DES ARCANES — plus liée à l'écrit du joueur, plus à la
 * difficulté du livre :
 * - +3 XP à chaque séance où une note a été rédigée (illimité, pas de
 *   plafond de séances).
 * - +25 XP si un commentaire final est rédigé à la fin du livre.
 */
export const XP_NOTE_SEANCE = 3;
export const XP_COMMENTAIRE_FINAL = 25;

export function calculerBonusNoteSeance(noteRedigee) {
  return noteRedigee ? XP_NOTE_SEANCE : 0;
}

export function calculerBonusCommentaireFinal(commentaireRedige) {
  return commentaireRedige ? XP_COMMENTAIRE_FINAL : 0;
}

/**
 * LA CURIOSITE — bonus fixe selon la difficulté déclarée du livre (1 à 3
 * étoiles, champ "difficulte"), attribué en fin de livre.
 */
const XP_CURIOSITE_PAR_DIFFICULTE = { 1: 25, 2: 50, 3: 100 };

export function calculerBonusCuriosite(difficulte) {
  return XP_CURIOSITE_PAR_DIFFICULTE[difficulte] ?? 0;
}

/**
 * COURBE DE NIVEAUX — V1 (niveaux 1 à 5 uniquement). XP nécessaire pour
 * passer AU niveau suivant. Inchangée par les règles XP v2.
 * Les niveaux 6 à 20 suivront la même logique d'incrément croissant
 * (+50 à chaque palier) mais ne sont pas encore figés.
 */
const PALIERS_NIVEAUX_V1 = { 1: 300, 2: 500, 3: 750, 4: 1050 };
const NIVEAU_MAX_V1 = 5;

/**
 * Convertit un total d'XP en niveau courant + progression dans ce niveau.
 * Plafonne au niveau 5 pour la V1 : xpProchainPalier vaut null une fois
 * ce plafond atteint (pas encore de palier suivant défini).
 */
export function calculerNiveau(xpTotal) {
  let niveau = 1;
  let xpDansNiveau = xpTotal;
  while (niveau < NIVEAU_MAX_V1 && xpDansNiveau >= PALIERS_NIVEAUX_V1[niveau]) {
    xpDansNiveau -= PALIERS_NIVEAUX_V1[niveau];
    niveau += 1;
  }
  const xpProchainPalier = PALIERS_NIVEAUX_V1[niveau] ?? null;
  return { niveau, xpDansNiveau, xpProchainPalier };
}

/**
 * Calcule le breakdown complet d'XP obtenu lorsqu'un livre est marqué
 * terminé. Ne recalcule pas le Savoir/Discipline déjà engrangés séance par
 * séance : ne couvre que les bonus attribués au moment où le livre passe
 * en "finished" (Curiosité + Maîtrise des Arcanes du commentaire final).
 * Le bonus fixe de fin de livre de la V1 (50 XP) a été supprimé en V2.
 */
export function calculerXpFinDeLivre({ difficulte, commentaireFinal }) {
  const curiosite = calculerBonusCuriosite(difficulte);
  const maitriseArcanes = calculerBonusCommentaireFinal(Boolean(commentaireFinal));

  return {
    curiosite,
    maitriseArcanes,
    total: curiosite + maitriseArcanes,
  };
}
