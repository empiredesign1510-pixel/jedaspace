// JedaSpace Firebase configuration
// 1) Firebase Console > Project settings > Your apps > Web app
// 2) Replace the values below with your own config.
// Firebase web config is not a service-account secret. Security is enforced by
// Firebase Authentication + Firestore/Storage Security Rules.

export const firebaseConfig = {
  apiKey: "PASTE_API_KEY_HERE",
  authDomain: "PASTE_PROJECT_ID.firebaseapp.com",
  projectId: "PASTE_PROJECT_ID",
  storageBucket: "PASTE_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "PASTE_MESSAGING_SENDER_ID",
  appId: "PASTE_APP_ID"
};

export function isFirebaseConfigured() {
  return Boolean(
    firebaseConfig.apiKey &&
    !firebaseConfig.apiKey.includes("PASTE_") &&
    firebaseConfig.projectId &&
    !firebaseConfig.projectId.includes("PASTE_")
  );
}
