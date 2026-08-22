import {
  db,
  doc,
  collection,
  query,
  getDocs,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  writeBatch,
  updateDoc
} from "./firebase-core.js";
import { mountStaffAuth } from "./staff-auth.js";
import { ORDER_STATUS, PAYMENT_STATUS, formatIDR, formatTime, formatDateTime, escapeHTML, randomId, toast, VALID_TRANSITIONS } from "./common.js";

let currentStaff = null;
let orders = [];
let menuItems = [];
let orderListenerStarted = false;
let soundEnabled = false;
let audioContext = null;
let fallbackTimer = null;

mountStaffAuth({ requiredRole: "barista", onReady: ({ profile }) => {
  currentStaff = profile;
  startRealtime();
  wireNavigation();
}});

function wireNavigation() {
  document.querySelectorAll(".nav-btn[data-view]").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
  document.querySelector("#soundBtn").addEventListener("click", () => {
    soundEnabled = !soundEnabled;
    if (soundEnabled && !audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
    document.querySelector("#soundBtn").textContent = soundEnabled ? "🔊 Suara" : "🔇 Suara";
    toast(soundEnabled ? "Notifikasi suara aktif" : "Notifikasi suara nonaktif");
  });
  document.querySelector("#refreshHistory").addEventListener("click", renderHistory);
}

function switchView(view) {
  document.querySelectorAll(".nav-btn[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  ["orders", "inventory", "history"].forEach((name) => document.querySelector(`#view-${name}`).classList.toggle("hidden", name !== view));
  const meta = {
    orders: ["Pesanan aktif", "Order baru masuk secara real-time"],
    inventory: ["Ketersediaan menu", "Tandai menu tersedia atau habis"],
    history: ["Riwayat pesanan", "Pesanan selesai dan dibatalkan"]
  }[view];
  document.querySelector("#pageTitle").textContent = meta[0];
  document.querySelector("#pageSubtitle").textContent = meta[1];
  if (view === "history") renderHistory();
}

function startRealtime() {
  const orderQuery = query(collection(db, "orders"), orderBy("createdAt", "desc"), limit(150));
  onSnapshot(orderQuery, (snapshot) => {
    if (orderListenerStarted) {
      const newOrders = snapshot.docChanges().filter((change) => change.type === "added" && change.doc.data().status === "pending");
      if (newOrders.length) {
        playBeep();
        toast(`${newOrders.length} pesanan baru masuk`, "success");
      }
    }
    orderListenerStarted = true;
    orders = snapshot.docs.map((snap) => ({ id: snap.id, ...snap.data() }));
    renderBoard();
    renderHistory();
  }, (error) => {
    console.error(error);
    toast("Realtime pesanan terputus. Polling fallback aktif.", "warning");
    startFallbackPolling();
  });

  onSnapshot(collection(db, "menu"), (snapshot) => {
    menuItems = snapshot.docs.map((snap) => ({ id: snap.id, ...snap.data() })).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    renderInventory();
  }, (error) => { console.error(error); startFallbackPolling(); });
}

function startFallbackPolling() {
  if (fallbackTimer) return;
  const poll = async () => {
    try {
      const [orderSnap, menuSnap] = await Promise.all([
        getDocs(query(collection(db, "orders"), orderBy("createdAt", "desc"), limit(150))),
        getDocs(collection(db, "menu"))
      ]);
      orders = orderSnap.docs.map((snap) => ({ id: snap.id, ...snap.data() }));
      menuItems = menuSnap.docs.map((snap) => ({ id: snap.id, ...snap.data() })).sort((a,b)=>(a.sortOrder||0)-(b.sortOrder||0));
      renderBoard(); renderHistory(); renderInventory();
    } catch (error) {
      console.warn("Fallback polling gagal", error);
    }
  };
  poll();
  fallbackTimer = setInterval(poll, 10000);
}

function playBeep() {
  if (!soundEnabled || !audioContext) return;
  try {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.frequency.value = 760;
    gain.gain.setValueAtTime(0.12, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.45);
    osc.connect(gain); gain.connect(audioContext.destination);
    osc.start(); osc.stop(audioContext.currentTime + 0.45);
  } catch (error) { console.warn(error); }
}

function renderBoard() {
  const active = orders.filter((order) => !["completed", "cancelled"].includes(order.status));
  const colNew = active.filter((order) => order.status === "pending");
  const colProgress = active.filter((order) => ["accepted", "preparing"].includes(order.status));
  const colReady = active.filter((order) => order.status === "ready");
  document.querySelector("#statPending").textContent = colNew.length;
  document.querySelector("#statPreparing").textContent = colProgress.length;
  document.querySelector("#statReady").textContent = colReady.length;
  document.querySelector("#statUnpaid").textContent = active.filter((order) => order.paymentStatus === "unpaid").length;
  document.querySelector("#countNew").textContent = colNew.length;
  document.querySelector("#countProgress").textContent = colProgress.length;
  document.querySelector("#countReady").textContent = colReady.length;
  renderOrderColumn("#colNew", colNew);
  renderOrderColumn("#colProgress", colProgress);
  renderOrderColumn("#colReady", colReady);
}

function renderOrderColumn(selector, list) {
  const host = document.querySelector(selector);
  host.innerHTML = list.length ? list.map(orderCard).join("") : `<div class="empty small">Tidak ada pesanan.</div>`;
  host.onclick = handleOrderAction;
}

function orderCard(order) {
  const next = { pending: "accepted", accepted: "preparing", preparing: "ready", ready: "completed" }[order.status];
  const nextLabel = { accepted: "Terima pesanan", preparing: "Mulai dibuat", ready: "Siap disajikan", completed: "Tandai selesai" }[next];
  const statusClass = order.status === "ready" ? "badge-green" : order.status === "pending" ? "badge-yellow" : "badge-blue";
  return `<article class="order-card ${order.status === "pending" ? "new-order" : ""}" data-order-id="${escapeHTML(order.id)}">
    <div class="order-card-head"><div><h3>${escapeHTML(order.orderNumber || order.id)}</h3><div class="small muted">${formatTime(order.createdAt)} · <span class="badge ${statusClass}">${escapeHTML(ORDER_STATUS[order.status] || order.status)}</span></div></div><div class="table-number">${escapeHTML(order.tableNumber || "-")}</div></div>
    <div class="order-items">${(order.items || []).map((item) => `<div class="order-item-row"><span class="qty">${item.quantity}×</span><div><strong>${escapeHTML(item.menuNameSnapshot)}</strong><div class="line-meta">${[...(item.selectedOptions || []).map((o) => o.optionName), ...(item.addons || []).map((a) => `+ ${a.name}`)].map(escapeHTML).join(" · ")}${item.itemNote ? `<br>↳ ${escapeHTML(item.itemNote)}` : ""}</div></div><span>${formatIDR(item.subtotal)}</span></div>`).join("")}</div>
    ${order.customerNote ? `<div class="order-note"><strong>Catatan:</strong> ${escapeHTML(order.customerNote)}</div>` : ""}
    <div class="summary-row"><span>Pembayaran</span><strong class="${order.paymentStatus === "paid" ? "text-success" : "text-danger"}">${escapeHTML(PAYMENT_STATUS[order.paymentStatus] || order.paymentStatus)}</strong></div>
    <div class="order-actions">
      ${next ? `<button class="btn btn-primary btn-block" data-order-action="status" data-next="${next}">${nextLabel}</button>` : ""}
      ${order.paymentStatus === "unpaid" ? `<button class="btn btn-secondary btn-block" data-order-action="paid">Tandai sudah dibayar</button>` : ""}
      ${VALID_TRANSITIONS[order.status]?.includes("cancelled") ? `<button class="btn btn-ghost btn-block text-danger" data-order-action="cancel">Batalkan pesanan</button>` : ""}
    </div>
  </article>`;
}

async function handleOrderAction(event) {
  const actionButton = event.target.closest("[data-order-action]");
  const card = event.target.closest("[data-order-id]");
  if (!actionButton || !card) return;
  const order = orders.find((entry) => entry.id === card.dataset.orderId);
  if (!order) return;
  if (actionButton.dataset.orderAction === "status") {
    await changeStatus(order, actionButton.dataset.next, "");
  } else if (actionButton.dataset.orderAction === "paid") {
    await markPaid(order);
  } else if (actionButton.dataset.orderAction === "cancel") {
    const reason = prompt("Alasan pembatalan (wajib):", "");
    if (reason === null) return;
    if (!reason.trim()) return toast("Alasan pembatalan wajib diisi.", "warning");
    await changeStatus(order, "cancelled", reason.trim());
  }
}

async function changeStatus(order, nextStatus, reason) {
  if (!VALID_TRANSITIONS[order.status]?.includes(nextStatus)) return toast("Perubahan status tidak diizinkan.", "error");
  try {
    const batch = writeBatch(db);
    const orderRef = doc(db, "orders", order.id);
    batch.update(orderRef, { status: nextStatus, cancelReason: nextStatus === "cancelled" ? reason : order.cancelReason || "", updatedAt: serverTimestamp() });
    const historyRef = doc(db, "orders", order.id, "history", randomId("hist"));
    batch.set(historyRef, { previousStatus: order.status, newStatus: nextStatus, changedBy: currentStaff.uid, changedByName: currentStaff.name || "Staff", reason: reason || "", createdAt: serverTimestamp() });
    await batch.commit();
    toast(`Status → ${ORDER_STATUS[nextStatus]}`, "success");
  } catch (error) {
    console.error(error); toast("Gagal mengubah status.", "error");
  }
}

async function markPaid(order) {
  try {
    await updateDoc(doc(db, "orders", order.id), { paymentStatus: "paid", paymentUpdatedBy: currentStaff.uid, updatedAt: serverTimestamp() });
    toast("Pembayaran dikonfirmasi", "success");
  } catch (error) { console.error(error); toast("Gagal mengubah pembayaran.", "error"); }
}

function renderInventory() {
  const host = document.querySelector("#inventoryList");
  if (!host) return;
  const activeItems = menuItems.filter((item) => item.active !== false);
  host.innerHTML = activeItems.length ? activeItems.map((item) => `<div class="inventory-card"><div><strong>${escapeHTML(item.name)}</strong><div class="small muted">${item.available === false ? "Habis" : "Tersedia"}</div></div><button class="switch ${item.available === false ? "" : "on"}" data-menu-toggle="${escapeHTML(item.id)}" aria-label="Ubah ketersediaan"></button></div>`).join("") : `<div class="empty">Belum ada menu.</div>`;
  host.onclick = async (event) => {
    const button = event.target.closest("[data-menu-toggle]"); if (!button) return;
    const item = menuItems.find((entry) => entry.id === button.dataset.menuToggle); if (!item) return;
    try {
      await updateDoc(doc(db, "menu", item.id), { available: item.available === false, updatedAt: serverTimestamp() });
      toast(`${item.name}: ${item.available === false ? "tersedia" : "habis"}`, "success");
    } catch (error) { console.error(error); toast("Gagal memperbarui menu.", "error"); }
  };
}

function renderHistory() {
  const body = document.querySelector("#historyBody");
  if (!body) return;
  const history = orders.filter((order) => ["completed", "cancelled"].includes(order.status));
  body.innerHTML = history.length ? history.map((order) => `<tr><td><strong>${escapeHTML(order.orderNumber || order.id)}</strong></td><td>${escapeHTML(order.tableNumber || "-")}</td><td>${formatDateTime(order.createdAt)}</td><td>${formatIDR(order.total)}</td><td><span class="badge ${order.paymentStatus === "paid" ? "badge-green" : "badge-yellow"}">${escapeHTML(PAYMENT_STATUS[order.paymentStatus] || order.paymentStatus)}</span></td><td><span class="badge ${order.status === "completed" ? "badge-green" : "badge-red"}">${escapeHTML(ORDER_STATUS[order.status] || order.status)}</span></td></tr>`).join("") : `<tr><td colspan="6" class="empty">Belum ada riwayat.</td></tr>`;
}
