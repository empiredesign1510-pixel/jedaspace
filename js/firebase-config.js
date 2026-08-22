// JedaSpace Firebase Web configuration
// Project: jedaspace-96b6e
// Firebase Storage is intentionally NOT used in this project.
// Security is enforced by Firebase Authentication + Firestore Security Rules.

export const firebaseConfig = {
  apiKey: "AIzaSyCYsL-OCePulzxZBioPo3KVXuv4DdqBgdg",
  authDomain: "jedaspace-96b6e.firebaseapp.com",
  projectId: "jedaspace-96b6e",
  messagingSenderId: "541190751334",
  appId: "1:541190751334:web:b58e513d7a3c0c8bb0d9a7",
  measurementId: "G-GHWM17D4QR"
};

export function isFirebaseConfigured() {
  return firebaseConfig.projectId === "jedaspace-96b6e" && Boolean(firebaseConfig.apiKey);
}
