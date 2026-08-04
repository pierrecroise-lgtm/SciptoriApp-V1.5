// ScriptoriApp — firebase-init.js
//
// Point d'entrée unique vers Firebase (Auth + Firestore).
// Chargé via CDN en modules ES — pas besoin d'ajouter de <script> dans le
// HTML, l'import suffit (fonctionne parce que reserve-app.js/encours-app.js
// sont déjà chargés en type="module").

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCYuV6fjkLnXR7CFGHzezNnutxCm1B1CQw",
  authDomain: "scriptoriapp.firebaseapp.com",
  projectId: "scriptoriapp",
  storageBucket: "scriptoriapp.firebasestorage.app",
  messagingSenderId: "1069894611987",
  appId: "1:1069894611987:web:f233614219e2d8bb853be6",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

export { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut };
