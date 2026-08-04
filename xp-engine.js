// ScriptoriApp — xp-engine.js
// Fonctions pures de calcul d'XP, dérivées de "LES 4 SOURCES D'XP.txt".
// Importé par toutes les rubriques qui déclenchent un gain d'XP
// (Réserve à la fin d'un livre, Home pour les séances, etc.)
// Aucune dépendance Firebase ici : uniquement des calculs, testables isolément.

import { getGenreGroup } from './genreGroups.js';

/** LE SAVOIR — 1 page = 0,5 XP, toujours attribué. */
export function calculerXpSavoir(pagesLues) {
  return pagesLues * 0.5;
}

/** LA DISCIPLINE — bonus de séance, plafonné à 25 XP, dès 10 pages minimum. */
export function calculerBonusSeance(pagesLues) {
  if (pagesLues < 10) return 0;
  return Math.min(25, Math.floor(pagesLues / 10) * 5);
}

/** LA DISCIPLINE — bonus de régularité selon le jour du streak (1 à 7). */
const BONUS_REGULARITE_PAR_JOUR = { 1: 0, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7 };

export function calculerBonusRegularite(jourDeSerie) {
  return BONUS_REGULARITE_PAR_JOUR[jourDeSerie] ?? 0;
}

/** LA MAITRISE DES ARCANES — bonus fixe selon le niveau de difficulté (1 à 5). */
const XP_ARCANES = { 1: 20, 2: 50, 3: 80, 4: 120, 5: 200 };

export function calculerBonusArcanes(niveauArcanes) {
  return XP_ARCANES[niveauArcanes] ?? 0;
}

/** LA CURIOSITE — bonus fixe selon le groupe de genre, attribué en fin de livre. */
const XP_CURIOSITE = { favori: 10, neutre: 50, oublie: 200 };

export function calculerBonusCuriosite(genreKey) {
  const groupe = getGenreGroup(genreKey);
  return XP_CURIOSITE[groupe] ?? 0;
}

/** Bonus fixe accordé à tout ouvrage terminé, indépendamment du reste. */
export const XP_BONUS_FIN_DE_LIVRE = 50;

/**
 * COURBE DE NIVEAUX — V1 (niveaux 1 à 5 uniquement, cf. LE SYSTÈME DE
 * NIVEAUX.txt). XP nécessaire pour passer AU niveau suivant.
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
 * Calcule le breakdown complet d'XP obtenu lorsqu'un livre est marqué terminé.
 * Ne recalcule pas le Savoir/Discipline déjà engrangés séance par séance :
 * ne couvre que les bonus attribués au moment où le livre passe en "finished"
 * (Maîtrise des Arcanes + Curiosité + bonus de fin de livre).
 */
export function calculerXpFinDeLivre({ arcanesLevel, genre }) {
  const maitriseArcanes = calculerBonusArcanes(arcanesLevel);
  const curiosite = calculerBonusCuriosite(genre);
  const finDeLivre = XP_BONUS_FIN_DE_LIVRE;

  return {
    maitriseArcanes,
    curiosite,
    finDeLivre,
    total: maitriseArcanes + curiosite + finDeLivre,
  };
}
