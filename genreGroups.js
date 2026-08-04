// ScriptoriApp — genreGroups.js
// Config statique des groupes de genres littéraires (cf. "LES 4 SOURCES D'XP").
// Règles fixes de l'app pour l'instant, donc pas de collection Firestore dédiée.
// Si un jour ça devient personnalisable par joueur, migrer vers
// users/{uid}/settings/genreGroups.

export const GENRE_GROUPS = {
  fantasy: 'favori',
  'science-fiction': 'favori',
  'medieval-fantastique': 'favori',

  thriller: 'neutre',
  policier: 'neutre',
  biographie: 'neutre',
  philosophie: 'neutre',
  aventure: 'neutre',

  classique: 'oublie',
  theatre: 'oublie',
  poesie: 'oublie',
  essai: 'oublie',
  'ouvrage-prime': 'oublie',
};

export const GENRE_LABELS = {
  fantasy: 'Fantasy',
  'science-fiction': 'Science-fiction',
  'medieval-fantastique': 'Médiéval fantastique',
  thriller: 'Thriller',
  policier: 'Policier',
  biographie: 'Biographie',
  philosophie: 'Philosophie',
  aventure: 'Aventure',
  classique: 'Classique',
  theatre: 'Théâtre',
  poesie: 'Poésie',
  essai: 'Essai',
  'ouvrage-prime': 'Ouvrage primé',
};

export function getGenreGroup(genreKey) {
  return GENRE_GROUPS[genreKey] || 'neutre';
}

export function getGenreLabel(genreKey) {
  return GENRE_LABELS[genreKey] || genreKey;
}
