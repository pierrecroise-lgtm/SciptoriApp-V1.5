// ScriptoriApp — auth-guard.js
//
// Gère la connexion (email/mot de passe). Tant que personne n'est
// connecté, une overlay plein écran bloque l'app et propose de se
// connecter ou de créer un compte. Une fois connecté, l'overlay
// disparaît et authReady se résout avec l'uid — data-layer.js et
// player-layer.js attendent cette valeur avant de lire/écrire Firestore.
//
// Ce fichier n'a besoin d'aucune balise <script> dans le HTML : il est
// importé indirectement (par data-layer.js), et le code d'un module ES
// ne s'exécute qu'une seule fois même s'il est importé par plusieurs
// fichiers différents.

import { auth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword } from './firebase-init.js';

let resolveReady;
export const authReady = new Promise((resolve) => {
  resolveReady = resolve;
});

function traduireErreur(code) {
  const map = {
    'auth/invalid-email': 'Email invalide.',
    'auth/user-not-found': 'Aucun compte avec cet email.',
    'auth/wrong-password': 'Mot de passe incorrect.',
    'auth/email-already-in-use': 'Un compte existe déjà avec cet email.',
    'auth/weak-password': 'Mot de passe trop court (6 caractères minimum).',
    'auth/invalid-credential': 'Email ou mot de passe incorrect.',
  };
  return map[code] || `Erreur de connexion (${code || 'inconnue'}). Réessaie.`;
}

function buildOverlay() {
  const overlay = document.createElement('div');
  overlay.id = 'auth-overlay';
  overlay.innerHTML = `
    <style>
      #auth-overlay{
        position:fixed; inset:0; z-index:999;
        background:#170f08;
        display:flex; align-items:center; justify-content:center;
        font-family:'VT323', monospace; color:#ede3c8;
        padding:20px;
      }
      #auth-overlay .box{
        width:100%; max-width:320px; padding:24px;
        background:linear-gradient(180deg,#2b1c12,#1c1209);
        border:2px solid #c9a876; border-radius:8px;
        box-shadow:0 8px 24px rgba(0,0,0,.5);
      }
      #auth-overlay h2{
        font-family:'Press Start 2P', monospace; font-size:13px;
        color:#e8cd94; margin:0 0 18px; text-align:center;
      }
      #auth-overlay label{ font-size:15px; color:#e8cd94; display:block; margin-bottom:4px; }
      #auth-overlay input{
        width:100%; font-family:'VT323', monospace; font-size:18px;
        padding:8px 10px; margin-bottom:12px; box-sizing:border-box;
        border:2px solid #c9a876; border-radius:4px; background:#150e07; color:#ede3c8;
      }
      #auth-overlay button.submit{
        width:100%; padding:10px; border-radius:5px; border:2px solid #1c1209;
        font-family:'Press Start 2P', monospace; font-size:9px; text-transform:uppercase;
        cursor:pointer; background:linear-gradient(180deg,#e8cd94,#c9a876);
        color:#1c1209; font-weight:bold; margin-bottom:10px;
      }
      #auth-overlay .toggle{
        background:none; border:none; color:#c9a876; font-family:'VT323', monospace;
        font-size:15px; text-decoration:underline; cursor:pointer; display:block; margin:0 auto;
      }
      #auth-overlay .error{ color:#e07a6a; font-size:14px; margin-bottom:10px; min-height:18px; }
    </style>
    <div class="box">
      <h2 id="auth-title">Connexion</h2>
      <div class="error" id="auth-error"></div>
      <label for="auth-email">Email</label>
      <input id="auth-email" type="email" autocomplete="username" />
      <label for="auth-password">Mot de passe</label>
      <input id="auth-password" type="password" autocomplete="current-password" />
      <button class="submit" id="auth-submit" type="button">Se connecter</button>
      <button class="toggle" id="auth-toggle" type="button">Pas encore de compte ? Créer un compte</button>
    </div>
  `;
  document.body.appendChild(overlay);

  let mode = 'signin';
  const title = overlay.querySelector('#auth-title');
  const submitBtn = overlay.querySelector('#auth-submit');
  const toggleBtn = overlay.querySelector('#auth-toggle');
  const errorEl = overlay.querySelector('#auth-error');
  const emailInput = overlay.querySelector('#auth-email');
  const passInput = overlay.querySelector('#auth-password');

  toggleBtn.addEventListener('click', () => {
    mode = mode === 'signin' ? 'signup' : 'signin';
    title.textContent = mode === 'signin' ? 'Connexion' : 'Créer un compte';
    submitBtn.textContent = mode === 'signin' ? 'Se connecter' : 'Créer le compte';
    toggleBtn.textContent = mode === 'signin'
      ? 'Pas encore de compte ? Créer un compte'
      : 'Déjà un compte ? Se connecter';
    errorEl.textContent = '';
  });

  submitBtn.addEventListener('click', async () => {
    errorEl.textContent = '';
    const email = emailInput.value.trim();
    const password = passInput.value;
    if (!email || !password) {
      errorEl.textContent = 'Email et mot de passe requis.';
      return;
    }
    submitBtn.disabled = true;
    try {
      if (mode === 'signin') {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        await createUserWithEmailAndPassword(auth, email, password);
      }
      // onAuthStateChanged (plus bas) se charge de retirer l'overlay.
    } catch (err) {
      errorEl.textContent = traduireErreur(err.code);
    } finally {
      submitBtn.disabled = false;
    }
  });

  return overlay;
}

let overlay = null;

onAuthStateChanged(auth, (user) => {
  if (user) {
    if (overlay) {
      overlay.remove();
      overlay = null;
    }
    resolveReady(user.uid);
  } else if (!overlay) {
    overlay = buildOverlay();
  }
});
