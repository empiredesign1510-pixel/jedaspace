export const ORDER_STATUS = {
  pending: "Pesanan diterima",
  accepted: "Diterima barista",
  preparing: "Sedang dibuat",
  ready: "Siap disajikan",
  completed: "Selesai",
  cancelled: "Dibatalkan"
};

export const PAYMENT_STATUS = {
  unpaid: "Belum dibayar",
  paid: "Sudah dibayar",
  refunded: "Dikembalikan"
};

export const VALID_TRANSITIONS = {
  pending: ["accepted", "cancelled"],
  accepted: ["preparing", "cancelled"],
  preparing: ["ready", "cancelled"],
  ready: ["completed", "cancelled"],
  completed: [],
  cancelled: []
};

export const formatIDR = (value = 0) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0
  }).format(Number(value) || 0);

export const formatTime = (value) => {
  if (!value) return "-";
  const date = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
};

export const formatDateTime = (value) => {
  if (!value) return "-";
  const date = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
};

export const escapeHTML = (value = "") =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

export const randomToken = (prefix = "tbl") => {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const token = Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("");
  return `${prefix}_${token}`;
};

export const randomId = (prefix = "id") =>
  `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;

export function makeOrderNumber() {
  const date = new Date();
  const yy = String(date.getFullYear()).slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 4).toUpperCase();
  return `JDS-${yy}${mm}${dd}-${suffix}`;
}

export function toast(message, type = "info") {
  let host = document.querySelector(".toast-host");
  if (!host) {
    host = document.createElement("div");
    host.className = "toast-host";
    document.body.appendChild(host);
  }
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.textContent = message;
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 220);
  }, 2600);
}

export function setButtonLoading(button, loading, text = "Memproses...") {
  if (!button) return;
  if (loading) {
    button.dataset.originalText = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span class="spinner"></span>${text}`;
  } else {
    button.disabled = false;
    if (button.dataset.originalText) button.innerHTML = button.dataset.originalText;
  }
}

export function showSetupRequired(target, title = "Firebase belum dihubungkan") {
  target.innerHTML = `
    <section class="state-card state-warning">
      <div class="state-icon">⚙️</div>
      <h2>${escapeHTML(title)}</h2>
      <p>Isi konfigurasi Firebase di <code>js/firebase-config.js</code>, lalu refresh halaman.</p>
      <p class="muted">Panduan langkah demi langkah tersedia di file <strong>SETUP-HP.txt</strong>.</p>
    </section>`;
}

export function parseVariantText(text = "") {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const [groupNameRaw, valuesRaw = ""] = line.split(":");
      const groupName = groupNameRaw.trim();
      const options = valuesRaw
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean)
        .map((entry, optionIndex) => {
          const [nameRaw, priceRaw = "0"] = entry.split("|");
          return {
            id: `${groupName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${optionIndex + 1}`,
            name: nameRaw.trim(),
            additionalPrice: Math.max(0, Number(priceRaw.trim()) || 0)
          };
        });
      return {
        id: `${groupName.toLowerCase().replace(/[^a-z0-9]+/g, "-") || `group-${index + 1}`}`,
        name: groupName || `Varian ${index + 1}`,
        required: true,
        options
      };
    })
    .filter((group) => group.options.length);
}

export function stringifyVariantGroups(groups = []) {
  return groups
    .map((group) => `${group.name}: ${(group.options || []).map((option) => `${option.name}|${option.additionalPrice || 0}`).join(", ")}`)
    .join("\n");
}

export function parseAddonText(text = "") {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const [nameRaw, priceRaw = "0"] = line.split("|");
      return {
        id: `${nameRaw.toLowerCase().replace(/[^a-z0-9]+/g, "-") || `addon-${index + 1}`}`,
        name: nameRaw.trim(),
        additionalPrice: Math.max(0, Number(priceRaw.trim()) || 0)
      };
    });
}

export function stringifyAddons(addons = []) {
  return addons.map((addon) => `${addon.name}|${addon.additionalPrice || 0}`).join("\n");
}
