import {
  auth,
  db,
  isFirebaseConfigured,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  doc,
  getDoc
} from "./firebase-core.js";
import { toast, setButtonLoading } from "./common.js";

export function mountStaffAuth({ requiredRole = null, onReady, onDenied } = {}) {
  const loginShell = document.querySelector("#loginShell");
  const staffShell = document.querySelector("#staffShell");
  const setup = document.querySelector("#staffSetup");
  const form = document.querySelector("#loginForm");
  const logout = document.querySelector("#logoutBtn");

  if (!isFirebaseConfigured()) {
    if (setup) setup.classList.remove("hidden");
    if (loginShell) loginShell.classList.add("hidden");
    return;
  }

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button[type=submit]");
    setButtonLoading(button, true, "Masuk...");
    try {
      const email = form.email.value.trim();
      const password = form.password.value;
      await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
      console.error(error);
      toast("Email atau password tidak valid.", "error");
      setButtonLoading(button, false);
    }
  });

  logout?.addEventListener("click", async () => {
    await signOut(auth);
    location.reload();
  });

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      loginShell?.classList.remove("hidden");
      staffShell?.classList.add("hidden");
      const submit = form?.querySelector("button[type=submit]");
      if (submit) setButtonLoading(submit, false);
      return;
    }

    try {
      const profileSnap = await getDoc(doc(db, "users", user.uid));
      if (!profileSnap.exists()) throw new Error("Profil staf belum dibuat");
      const profile = { uid: user.uid, ...profileSnap.data() };
      const allowedRole = requiredRole === "admin"
        ? profile.role === "admin"
        : requiredRole === "barista"
          ? ["barista", "admin"].includes(profile.role)
          : ["barista", "admin"].includes(profile.role);
      if (profile.active !== true || !allowedRole) throw new Error("Akun tidak memiliki akses");

      loginShell?.classList.add("hidden");
      staffShell?.classList.remove("hidden");
      document.querySelectorAll("[data-staff-name]").forEach((el) => el.textContent = profile.name || user.email || "Staff");
      document.querySelectorAll("[data-staff-role]").forEach((el) => el.textContent = profile.role);
      onReady?.({ user, profile });
    } catch (error) {
      console.error(error);
      await signOut(auth);
      toast(error.message || "Akses ditolak.", "error");
      onDenied?.(error);
    }
  });
}
