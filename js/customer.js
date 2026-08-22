import {
  db,
  isFirebaseConfigured,
  doc,
  getDoc,
  getDocs,
  setDoc,
  collection,
  query,
  where,
  onSnapshot,
  serverTimestamp
} from "./firebase-core.js";
import {
  ORDER_STATUS,
  PAYMENT_STATUS,
  formatIDR,
  escapeHTML,
  makeOrderNumber,
  randomId,
  toast,
  setButtonLoading,
  showSetupRequired
} from "./common.js";

const state = {
  token: new URLSearchParams(location.search).get("t") || "",
  table: null,
  settings: { cafeName: "JedaSpace" },
  categories: [],
  menu: [],
  category: "all",
  search: "",
  cart: [],
  product: null,
  productQty: 1,
  selectedOptions: {},
  selectedAddons: new Set(),
  activeOrderId: null,
  unsubscribeOrder: null
};

const app = document.querySelector("#customerState");
const tableChip = document.querySelector("#tableChip");
const brandName = document.querySelector("#brandName");
const setupBanner = document.querySelector("#setupBanner");
const productOverlay = document.querySelector("#productOverlay");
const cartOverlay = document.querySelector("#cartOverlay");
const statusOverlay = document.querySelector("#statusOverlay");
let catalogFallbackTimer = null;
let orderFallbackTimer = null;

function safeImageUrl(url) {
  try {
    const parsed = new URL(String(url || "").trim(), location.href);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : "";
  } catch {
    return "";
  }
}

function cartKey() {
  return `jeda_cart_${state.token}`;
}

function orderKey() {
  return `jeda_last_order_${state.token}`;
}

function checkoutKey() {
  return `jeda_checkout_${state.token}`;
}

function loadCart() {
  try {
    const parsed = JSON.parse(localStorage.getItem(cartKey()) || "[]");
    state.cart = Array.isArray(parsed) ? parsed : [];
  } catch {
    state.cart = [];
  }
}

function saveCart() {
  localStorage.setItem(cartKey(), JSON.stringify(state.cart));
  updateCartFab();
}

function cartSubtotal() {
  return state.cart.reduce((sum, item) => sum + (Number(item.unitPrice) || 0) * (Number(item.quantity) || 0), 0);
}

function cartCount() {
  return state.cart.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
}

function openOverlay(el) {
  el.classList.add("open");
  el.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function closeOverlay(el) {
  el.classList.remove("open");
  el.setAttribute("aria-hidden", "true");
  if (!document.querySelector(".overlay.open")) document.body.style.overflow = "";
}

async function initialize() {
  if (!isFirebaseConfigured()) {
    setupBanner.classList.remove("hidden");
    tableChip.textContent = "Setup Firebase";
    showSetupRequired(app);
    return;
  }

  if (!state.token || !/^tbl_[A-Za-z0-9_-]{12,}$/.test(state.token)) {
    tableChip.textContent = "QR tidak valid";
    app.innerHTML = `
      <section class="state-card">
        <div class="state-icon">📵</div>
        <h2>QR meja tidak valid</h2>
        <p>Silakan scan QR yang tersedia di meja JedaSpace. Link tanpa token meja tidak dapat digunakan untuk memesan.</p>
      </section>`;
    return;
  }

  try {
    const tokenSnap = await getDoc(doc(db, "tableTokens", state.token));
    if (!tokenSnap.exists() || tokenSnap.data().active !== true) throw new Error("Meja tidak aktif");
    state.table = { token: state.token, ...tokenSnap.data() };
    tableChip.textContent = state.table.tableName || `Meja ${state.table.tableNumber}`;
    loadCart();
    await loadPublicSettings();
    renderMenuShell();
    subscribeCatalog();
    restoreLastOrder();
  } catch (error) {
    console.error(error);
    tableChip.textContent = "Meja tidak aktif";
    app.innerHTML = `
      <section class="state-card">
        <div class="state-icon">🔒</div>
        <h2>Meja tidak tersedia</h2>
        <p>QR ini tidak aktif, sudah diganti, atau tidak terdaftar. Silakan minta bantuan staf JedaSpace.</p>
      </section>`;
  }
}

async function loadPublicSettings() {
  try {
    const snap = await getDoc(doc(db, "settings", "public"));
    if (snap.exists()) state.settings = { ...state.settings, ...snap.data() };
  } catch (error) {
    console.warn("Settings tidak tersedia", error);
  }
  brandName.textContent = state.settings.cafeName || "JedaSpace";
  document.title = `${state.settings.cafeName || "JedaSpace"} — Self Order`;
}

function renderMenuShell() {
  app.innerHTML = `
    <section class="hero">
      <div class="hero-panel">
        <div class="small" style="font-weight:800;opacity:.82;margin-bottom:8px">${escapeHTML(state.table.tableName || `Meja ${state.table.tableNumber}`)}</div>
        <h1>Ambil jeda,<br>pilih yang kamu suka.</h1>
        <p>Pesan langsung dari meja. Setelah dikirim, pembayaran dilakukan di kasir dan status pesanan dapat dipantau dari HP ini.</p>
      </div>
      <aside class="hero-side">
        <div><span class="muted small">Meja aktif</span><div class="big-number">${escapeHTML(state.table.tableNumber || "-")}</div></div>
        <span class="badge badge-blue">Tanpa login customer</span>
      </aside>
    </section>

    <div class="search-wrap">
      <span class="search-icon">⌕</span>
      <input id="menuSearch" type="search" placeholder="Cari kopi, makanan, snack..." autocomplete="off">
    </div>

    <div class="section-title"><div><h2>Kategori</h2><p>Geser untuk melihat kategori lainnya</p></div></div>
    <div id="categoryRow" class="category-row"><button class="category-btn active" data-category="all">Semua</button></div>

    <div class="section-title"><div><h2>Menu</h2><p id="menuCount">Memuat menu...</p></div><button id="activeOrderBtn" class="btn btn-secondary btn-sm hidden">Lihat pesanan</button></div>
    <div id="menuGrid" class="menu-grid">
      ${Array.from({ length: 6 }, () => `<div class="menu-card"><div class="menu-image skeleton"></div><div class="menu-body"><div class="skeleton" style="height:17px;width:75%"></div><div class="skeleton" style="height:14px;width:48%;margin-top:10px"></div></div></div>`).join("")}
    </div>
    <button id="cartFab" class="cart-fab hidden"><span class="count">0</span><div style="text-align:left;flex:1;margin-left:10px"><strong>Keranjang</strong><span style="display:block">Lihat pesananmu</span></div><div class="cart-fab-price">Rp0</div></button>`;

  document.querySelector("#menuSearch").addEventListener("input", (event) => {
    state.search = event.target.value.trim().toLowerCase();
    renderMenu();
  });
  document.querySelector("#categoryRow").addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");
    if (!button) return;
    state.category = button.dataset.category;
    document.querySelectorAll(".category-btn").forEach((el) => el.classList.toggle("active", el === button));
    renderMenu();
  });
  document.querySelector("#menuGrid").addEventListener("click", (event) => {
    const button = event.target.closest("[data-menu-id]");
    if (!button) return;
    const item = state.menu.find((menuItem) => menuItem.id === button.dataset.menuId);
    if (!item || item.available === false) return;
    openProduct(item);
  });
  document.querySelector("#cartFab").addEventListener("click", openCart);
  document.querySelector("#activeOrderBtn").addEventListener("click", () => state.activeOrderId && openOrderStatus(state.activeOrderId));
  updateCartFab();
}

function subscribeCatalog() {
  const categoriesQuery = query(collection(db, "categories"), where("active", "==", true));
  onSnapshot(categoriesQuery, (snapshot) => {
    state.categories = snapshot.docs.map((snap) => ({ id: snap.id, ...snap.data() })).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    renderCategories();
  }, (error) => { console.error("Categories realtime", error); startCatalogFallback(); });

  const menuQuery = query(collection(db, "menu"), where("active", "==", true));
  onSnapshot(menuQuery, (snapshot) => {
    state.menu = snapshot.docs.map((snap) => ({ id: snap.id, ...snap.data() })).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    renderMenu();
  }, (error) => {
    console.error("Menu realtime", error);
    startCatalogFallback();
    const grid = document.querySelector("#menuGrid");
    if (grid && !state.menu.length) grid.innerHTML = `<div class="empty" style="grid-column:1/-1">Menu gagal dimuat. Mencoba polling fallback...</div>`;
  });
}

function startCatalogFallback() {
  if (catalogFallbackTimer) return;
  const poll = async () => {
    try {
      const [categorySnap, menuSnap] = await Promise.all([
        getDocs(query(collection(db, "categories"), where("active", "==", true))),
        getDocs(query(collection(db, "menu"), where("active", "==", true)))
      ]);
      state.categories = categorySnap.docs.map((snap) => ({ id: snap.id, ...snap.data() })).sort((a,b)=>(a.sortOrder||0)-(b.sortOrder||0));
      state.menu = menuSnap.docs.map((snap) => ({ id: snap.id, ...snap.data() })).sort((a,b)=>(a.sortOrder||0)-(b.sortOrder||0));
      renderCategories();
      renderMenu();
    } catch (error) {
      console.warn("Catalog fallback polling gagal", error);
    }
  };
  poll();
  catalogFallbackTimer = setInterval(poll, 15000);
}

function renderCategories() {
  const row = document.querySelector("#categoryRow");
  if (!row) return;
  row.innerHTML = `<button class="category-btn ${state.category === "all" ? "active" : ""}" data-category="all">Semua</button>` +
    state.categories.map((cat) => `<button class="category-btn ${state.category === cat.id ? "active" : ""}" data-category="${escapeHTML(cat.id)}">${escapeHTML(cat.name)}</button>`).join("");
}

function renderMenu() {
  const grid = document.querySelector("#menuGrid");
  const count = document.querySelector("#menuCount");
  if (!grid) return;
  const filtered = state.menu.filter((item) => {
    const categoryOK = state.category === "all" || item.categoryId === state.category;
    const haystack = `${item.name || ""} ${item.description || ""}`.toLowerCase();
    return categoryOK && (!state.search || haystack.includes(state.search));
  });
  if (count) count.textContent = `${filtered.length} menu tersedia`;
  if (!filtered.length) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1">Tidak ada menu yang cocok.</div>`;
    return;
  }
  grid.innerHTML = filtered.map((item) => {
    const image = safeImageUrl(item.imageUrl || "");
    const available = item.available !== false;
    return `<article class="menu-card ${available ? "" : "unavailable"}">
      <div class="menu-image">
        ${image ? `<img src="${escapeHTML(image)}" alt="${escapeHTML(item.name)}" loading="lazy">` : `<div class="menu-placeholder">JEDA</div>`}
        ${available ? "" : `<span class="soldout">Habis</span>`}
      </div>
      <div class="menu-body">
        <h3 class="menu-name">${escapeHTML(item.name)}</h3>
        <div class="menu-desc">${escapeHTML(item.description || "Pilihan favorit dari JedaSpace")}</div>
        <div class="menu-footer"><span class="menu-price">${formatIDR(item.basePrice)}</span><button class="add-btn" data-menu-id="${escapeHTML(item.id)}" ${available ? "" : "disabled"} aria-label="Tambah ${escapeHTML(item.name)}">+</button></div>
      </div>
    </article>`;
  }).join("");
}

function openProduct(item) {
  state.product = item;
  state.productQty = 1;
  state.selectedOptions = {};
  state.selectedAddons = new Set();
  (item.optionGroups || []).forEach((group) => {
    if (group.required !== false && group.options?.[0]) state.selectedOptions[group.id] = group.options[0].id;
  });
  document.querySelector("#productTitle").textContent = item.name;
  document.querySelector("#productPrice").textContent = `Mulai ${formatIDR(item.basePrice)}`;
  document.querySelector("#itemNote").value = "";
  renderProductOptions();
  updateProductTotal();
  openOverlay(productOverlay);
}

function renderProductOptions() {
  const host = document.querySelector("#productOptions");
  const groups = state.product.optionGroups || [];
  const addons = state.product.addons || [];
  host.innerHTML = groups.map((group) => `
    <div class="option-group" data-option-group="${escapeHTML(group.id)}">
      <div class="option-group-title">${escapeHTML(group.name)} ${group.required === false ? `<span class="muted">(opsional)</span>` : ""}</div>
      <div class="option-list">${(group.options || []).map((option) => `<button type="button" class="option-pill ${state.selectedOptions[group.id] === option.id ? "selected" : ""}" data-group="${escapeHTML(group.id)}" data-option="${escapeHTML(option.id)}">${escapeHTML(option.name)}${option.additionalPrice ? ` · +${formatIDR(option.additionalPrice)}` : ""}</button>`).join("")}</div>
    </div>`).join("") + (addons.length ? `
    <div class="option-group">
      <div class="option-group-title">Topping <span class="muted">(opsional)</span></div>
      <div class="option-list">${addons.map((addon) => `<button type="button" class="option-pill ${state.selectedAddons.has(addon.id) ? "selected" : ""}" data-addon="${escapeHTML(addon.id)}">${escapeHTML(addon.name)}${addon.additionalPrice ? ` · +${formatIDR(addon.additionalPrice)}` : ""}</button>`).join("")}</div>
    </div>` : "");

  host.onclick = (event) => {
    const option = event.target.closest("[data-option]");
    if (option) {
      state.selectedOptions[option.dataset.group] = option.dataset.option;
      renderProductOptions();
      updateProductTotal();
      return;
    }
    const addon = event.target.closest("[data-addon]");
    if (addon) {
      const id = addon.dataset.addon;
      if (state.selectedAddons.has(id)) state.selectedAddons.delete(id); else state.selectedAddons.add(id);
      renderProductOptions();
      updateProductTotal();
    }
  };
}

function configuredUnitPrice() {
  if (!state.product) return 0;
  let total = Number(state.product.basePrice) || 0;
  (state.product.optionGroups || []).forEach((group) => {
    const selectedId = state.selectedOptions[group.id];
    const option = (group.options || []).find((entry) => entry.id === selectedId);
    if (option) total += Number(option.additionalPrice) || 0;
  });
  (state.product.addons || []).forEach((addon) => {
    if (state.selectedAddons.has(addon.id)) total += Number(addon.additionalPrice) || 0;
  });
  return total;
}

function updateProductTotal() {
  document.querySelector("#qtyValue").textContent = state.productQty;
  document.querySelector("#productTotal").textContent = formatIDR(configuredUnitPrice() * state.productQty);
}

function addConfiguredItem() {
  if (!state.product) return;
  const selectedOptions = (state.product.optionGroups || []).map((group) => {
    const option = (group.options || []).find((entry) => entry.id === state.selectedOptions[group.id]);
    return option ? { groupId: group.id, groupName: group.name, optionId: option.id, optionName: option.name, additionalPrice: Number(option.additionalPrice) || 0 } : null;
  }).filter(Boolean);
  const selectedAddons = (state.product.addons || []).filter((addon) => state.selectedAddons.has(addon.id)).map((addon) => ({ id: addon.id, name: addon.name, additionalPrice: Number(addon.additionalPrice) || 0 }));
  state.cart.push({
    cartId: randomId("cart"),
    menuItemId: state.product.id,
    menuNameSnapshot: state.product.name,
    basePriceSnapshot: Number(state.product.basePrice) || 0,
    unitPrice: configuredUnitPrice(),
    quantity: state.productQty,
    selectedOptions,
    addons: selectedAddons,
    itemNote: document.querySelector("#itemNote").value.trim(),
    imageUrl: safeImageUrl(state.product.imageUrl || "")
  });
  saveCart();
  closeOverlay(productOverlay);
  toast(`${state.product.name} ditambahkan`, "success");
}

function updateCartFab() {
  const fab = document.querySelector("#cartFab");
  if (!fab) return;
  const count = cartCount();
  fab.classList.toggle("hidden", count === 0);
  fab.querySelector(".count").textContent = count;
  fab.querySelector(".cart-fab-price").textContent = formatIDR(cartSubtotal());
}

function openCart() {
  renderCart();
  openOverlay(cartOverlay);
}

function renderCart() {
  document.querySelector("#cartTableInfo").textContent = state.table.tableName || `Meja ${state.table.tableNumber}`;
  const host = document.querySelector("#cartItems");
  if (!state.cart.length) {
    host.innerHTML = `<div class="empty">Keranjang masih kosong.</div>`;
  } else {
    host.innerHTML = state.cart.map((item) => `<div class="line-item" data-cart-id="${escapeHTML(item.cartId)}">
      <div><strong>${item.quantity}× ${escapeHTML(item.menuNameSnapshot)}</strong><div class="line-meta">${[...(item.selectedOptions || []).map((o) => o.optionName), ...(item.addons || []).map((a) => `+ ${a.name}`)].map(escapeHTML).join(" · ") || "Tanpa varian"}${item.itemNote ? `<br>Catatan: ${escapeHTML(item.itemNote)}` : ""}</div><div style="margin-top:7px"><button class="btn btn-secondary btn-sm" data-action="minus">−</button> <button class="btn btn-secondary btn-sm" data-action="plus">+</button> <button class="btn btn-ghost btn-sm text-danger" data-action="remove">Hapus</button></div></div>
      <strong>${formatIDR(item.unitPrice * item.quantity)}</strong>
    </div>`).join("");
  }
  document.querySelector("#cartSummary").innerHTML = `<div class="summary-row"><span>Subtotal</span><strong>${formatIDR(cartSubtotal())}</strong></div><div class="summary-row total"><span>Total</span><span>${formatIDR(cartSubtotal())}</span></div>`;
  document.querySelector("#checkoutBtn").disabled = !state.cart.length;
  host.onclick = (event) => {
    const row = event.target.closest("[data-cart-id]");
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (!row || !action) return;
    const item = state.cart.find((entry) => entry.cartId === row.dataset.cartId);
    if (!item) return;
    if (action === "plus") item.quantity += 1;
    if (action === "minus") item.quantity = Math.max(1, item.quantity - 1);
    if (action === "remove") state.cart = state.cart.filter((entry) => entry.cartId !== item.cartId);
    saveCart();
    renderCart();
  };
}

async function revalidateCartFromFirestore() {
  const refreshed = [];
  const menuCache = new Map();
  for (const cartItem of state.cart) {
    let liveItem = menuCache.get(cartItem.menuItemId);
    if (!liveItem) {
      const snap = await getDoc(doc(db, "menu", cartItem.menuItemId));
      if (!snap.exists()) throw new Error(`${cartItem.menuNameSnapshot} sudah tidak tersedia.`);
      liveItem = { id: snap.id, ...snap.data() };
      menuCache.set(cartItem.menuItemId, liveItem);
    }
    if (liveItem.active !== true || liveItem.available === false) {
      throw new Error(`${liveItem.name || cartItem.menuNameSnapshot} sedang habis/tidak aktif.`);
    }
    let unitPrice = Number(liveItem.basePrice) || 0;
    const selectedOptions = [];
    for (const selected of cartItem.selectedOptions || []) {
      const group = (liveItem.optionGroups || []).find((entry) => entry.id === selected.groupId);
      const option = group?.options?.find((entry) => entry.id === selected.optionId);
      if (!group || !option) throw new Error(`Varian ${selected.optionName || "menu"} sudah berubah. Pilih ulang item.`);
      unitPrice += Number(option.additionalPrice) || 0;
      selectedOptions.push({ groupId: group.id, groupName: group.name, optionId: option.id, optionName: option.name, additionalPrice: Number(option.additionalPrice) || 0 });
    }
    const addons = [];
    for (const selected of cartItem.addons || []) {
      const addon = (liveItem.addons || []).find((entry) => entry.id === selected.id);
      if (!addon) throw new Error(`Topping ${selected.name || "menu"} sudah berubah. Pilih ulang item.`);
      unitPrice += Number(addon.additionalPrice) || 0;
      addons.push({ id: addon.id, name: addon.name, additionalPrice: Number(addon.additionalPrice) || 0 });
    }
    refreshed.push({
      ...cartItem,
      menuNameSnapshot: liveItem.name,
      basePriceSnapshot: Number(liveItem.basePrice) || 0,
      unitPrice,
      selectedOptions,
      addons
    });
  }
  state.cart = refreshed;
  saveCart();
}

async function checkout() {
  if (!state.cart.length || !state.table) return;
  const button = document.querySelector("#checkoutBtn");
  setButtonLoading(button, true, "Mengirim...");
  try {
    await revalidateCartFromFirestore();
  } catch (error) {
    console.error(error);
    toast(error.message || "Menu berubah. Periksa keranjang.", "warning");
    setButtonLoading(button, false);
    renderCart();
    return;
  }
  let session;
  try {
    session = JSON.parse(localStorage.getItem(checkoutKey()) || "null");
  } catch { session = null; }
  if (!session || !session.orderId) {
    session = { orderId: randomId("order"), idempotencyKey: crypto.randomUUID(), orderNumber: makeOrderNumber() };
    localStorage.setItem(checkoutKey(), JSON.stringify(session));
  }

  const subtotal = cartSubtotal();
  const orderData = {
    orderNumber: session.orderNumber,
    tableId: state.table.tableId,
    tableNumber: state.table.tableNumber,
    tableName: state.table.tableName || `Meja ${state.table.tableNumber}`,
    tableToken: state.token,
    status: "pending",
    paymentStatus: "unpaid",
    subtotal,
    discount: 0,
    total: subtotal,
    customerNote: document.querySelector("#orderNote").value.trim(),
    cancelReason: "",
    idempotencyKey: session.idempotencyKey,
    schemaVersion: 1,
    items: state.cart.map((item) => ({
      menuItemId: item.menuItemId,
      menuNameSnapshot: item.menuNameSnapshot,
      basePriceSnapshot: item.basePriceSnapshot,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      subtotal: item.unitPrice * item.quantity,
      selectedOptions: item.selectedOptions || [],
      addons: item.addons || [],
      itemNote: item.itemNote || ""
    })),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  try {
    await setDoc(doc(db, "orders", session.orderId), orderData);
    finishCheckout(session.orderId);
  } catch (error) {
    console.error(error);
    try {
      const existing = await getDoc(doc(db, "orders", session.orderId));
      if (existing.exists()) {
        finishCheckout(session.orderId);
        return;
      }
    } catch (readError) {
      console.warn(readError);
    }
    toast("Pesanan gagal dikirim. Periksa koneksi dan coba lagi.", "error");
    setButtonLoading(button, false);
  }
}

function finishCheckout(orderId) {
  state.activeOrderId = orderId;
  localStorage.setItem(orderKey(), orderId);
  localStorage.removeItem(checkoutKey());
  state.cart = [];
  localStorage.removeItem(cartKey());
  updateCartFab();
  closeOverlay(cartOverlay);
  const activeButton = document.querySelector("#activeOrderBtn");
  if (activeButton) activeButton.classList.remove("hidden");
  toast("Pesanan berhasil dikirim", "success");
  openOrderStatus(orderId);
}

function restoreLastOrder() {
  const orderId = localStorage.getItem(orderKey());
  if (!orderId) return;
  state.activeOrderId = orderId;
  const activeButton = document.querySelector("#activeOrderBtn");
  if (activeButton) activeButton.classList.remove("hidden");
}

function openOrderStatus(orderId) {
  if (state.unsubscribeOrder) state.unsubscribeOrder();
  openOverlay(statusOverlay);
  document.querySelector("#statusOrderNumber").textContent = "Memuat pesanan...";
  state.unsubscribeOrder = onSnapshot(doc(db, "orders", orderId), (snap) => {
    if (!snap.exists()) {
      document.querySelector("#statusOrderNumber").textContent = "Pesanan tidak ditemukan";
      return;
    }
    renderOrderStatus({ id: snap.id, ...snap.data() });
  }, (error) => {
    console.error(error);
    toast("Realtime status terputus. Menggunakan polling fallback.", "warning");
    startOrderFallback(orderId);
  });
}

function startOrderFallback(orderId) {
  if (orderFallbackTimer) clearInterval(orderFallbackTimer);
  const poll = async () => {
    try {
      const snap = await getDoc(doc(db, "orders", orderId));
      if (snap.exists()) renderOrderStatus({ id: snap.id, ...snap.data() });
    } catch (error) {
      console.warn("Order fallback polling gagal", error);
    }
  };
  poll();
  orderFallbackTimer = setInterval(poll, 8000);
}

function renderOrderStatus(order) {
  document.querySelector("#statusOrderNumber").textContent = order.orderNumber || "Pesanan JedaSpace";
  document.querySelector("#statusTable").textContent = `${order.tableName || `Meja ${order.tableNumber}`} · realtime`;
  const paymentClass = order.paymentStatus === "paid" ? "text-success" : "";
  document.querySelector("#paymentStatusBox").innerHTML = `<strong class="${paymentClass}">${escapeHTML(PAYMENT_STATUS[order.paymentStatus] || order.paymentStatus)}</strong><br><span class="small">${order.paymentStatus === "paid" ? "Pembayaran sudah dikonfirmasi staf." : "Silakan lakukan pembayaran di kasir."}</span>`;

  const statuses = ["pending", "accepted", "preparing", "ready", "completed"];
  const currentIndex = statuses.indexOf(order.status);
  document.querySelector("#statusTimeline").innerHTML = statuses.map((status, index) => {
    const done = order.status !== "cancelled" && index <= currentIndex;
    const active = order.status === status;
    return `<div class="status-step ${done ? "done" : ""} ${active ? "active" : ""}"><span class="status-mark"></span><div><strong>${escapeHTML(ORDER_STATUS[status])}</strong><small>${active ? "Status saat ini" : done ? "Selesai" : "Menunggu"}</small></div></div>`;
  }).join("");

  document.querySelector("#statusItems").innerHTML = `<div class="summary-row"><strong>Pesanan</strong><strong>${formatIDR(order.total)}</strong></div>` + (order.items || []).map((item) => `<div class="summary-row"><span>${item.quantity}× ${escapeHTML(item.menuNameSnapshot)}</span><span>${formatIDR(item.subtotal)}</span></div>`).join("");
  const cancelBox = document.querySelector("#statusCancelReason");
  cancelBox.classList.toggle("hidden", order.status !== "cancelled");
  if (order.status === "cancelled") cancelBox.innerHTML = `<strong>Pesanan dibatalkan</strong><br>${escapeHTML(order.cancelReason || "Hubungi staf untuk informasi lebih lanjut.")}`;
}

document.querySelector("#closeProduct").addEventListener("click", () => closeOverlay(productOverlay));
document.querySelector("#closeCart").addEventListener("click", () => closeOverlay(cartOverlay));
document.querySelector("#closeStatus").addEventListener("click", () => closeOverlay(statusOverlay));
document.querySelector("#qtyMinus").addEventListener("click", () => { state.productQty = Math.max(1, state.productQty - 1); updateProductTotal(); });
document.querySelector("#qtyPlus").addEventListener("click", () => { state.productQty += 1; updateProductTotal(); });
document.querySelector("#addConfiguredItem").addEventListener("click", addConfiguredItem);
document.querySelector("#checkoutBtn").addEventListener("click", checkout);
document.querySelector("#newOrderBtn").addEventListener("click", () => closeOverlay(statusOverlay));
[productOverlay, cartOverlay, statusOverlay].forEach((overlay) => overlay.addEventListener("click", (event) => { if (event.target === overlay) closeOverlay(overlay); }));

initialize();
