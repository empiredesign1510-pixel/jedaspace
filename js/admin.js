import {
  db,
  storage,
  doc,
  setDoc,
  updateDoc,
  collection,
  onSnapshot,
  serverTimestamp,
  writeBatch,
  ref,
  uploadBytes,
  getDownloadURL
} from "./firebase-core.js";
import { mountStaffAuth } from "./staff-auth.js";
import {
  ORDER_STATUS,
  PAYMENT_STATUS,
  formatIDR,
  formatDateTime,
  escapeHTML,
  randomId,
  randomToken,
  toast,
  setButtonLoading,
  parseVariantText,
  stringifyVariantGroups,
  parseAddonText,
  stringifyAddons
} from "./common.js";

let currentStaff = null;
let categories = [];
let menuItems = [];
let tables = [];
let staff = [];
let orders = [];
let settings = { cafeName: "JedaSpace", mapsUrl: "", tagline: "Ambil jeda, nikmati momennya." };
let currentQrUrl = "";

mountStaffAuth({ requiredRole: "admin", onReady: ({ profile }) => {
  currentStaff = profile;
  wireNavigation();
  wireForms();
  startRealtime();
}});

function wireNavigation() {
  document.querySelectorAll(".nav-btn[data-view]").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
}

function switchView(view) {
  document.querySelectorAll(".nav-btn[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  ["dashboard", "menu", "categories", "tables", "staff", "orders", "settings"].forEach((name) => document.querySelector(`#view-${name}`).classList.toggle("hidden", name !== view));
  const meta = {
    dashboard: ["Dashboard", "Ringkasan operasional JedaSpace"],
    menu: ["Kelola menu", "Harga, foto, varian, topping, dan ketersediaan"],
    categories: ["Kategori", "Susun kelompok menu"],
    tables: ["Meja & QR", "Token QR unik untuk setiap meja"],
    staff: ["Staff", "Role admin dan barista"],
    orders: ["Riwayat transaksi", "Filter dan pantau order"],
    settings: ["Pengaturan", "Identitas publik JedaSpace"]
  }[view];
  document.querySelector("#pageTitle").textContent = meta[0];
  document.querySelector("#pageSubtitle").textContent = meta[1];
}

function openModal(id) {
  const el = document.querySelector(`#${id}`);
  el.classList.add("open");
  document.body.style.overflow = "hidden";
}
function closeModal(id) {
  document.querySelector(`#${id}`).classList.remove("open");
  if (!document.querySelector(".overlay.open")) document.body.style.overflow = "";
}

function wireForms() {
  document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => closeModal(button.dataset.close)));
  document.querySelectorAll(".overlay").forEach((overlay) => overlay.addEventListener("click", (event) => { if (event.target === overlay) closeModal(overlay.id); }));

  document.querySelector("#addMenuBtn").addEventListener("click", () => openMenuForm());
  document.querySelector("#addCategoryBtn").addEventListener("click", () => openCategoryForm());
  document.querySelector("#addTableBtn").addEventListener("click", () => openTableForm());
  document.querySelector("#addStaffBtn").addEventListener("click", () => openStaffForm());
  document.querySelector("#seedBtn").addEventListener("click", seedDemoData);
  document.querySelector("#menuForm").addEventListener("submit", saveMenu);
  document.querySelector("#categoryForm").addEventListener("submit", saveCategory);
  document.querySelector("#tableForm").addEventListener("submit", saveTable);
  document.querySelector("#staffForm").addEventListener("submit", saveStaff);
  document.querySelector("#settingsForm").addEventListener("submit", saveSettings);
  document.querySelector("#orderSearch").addEventListener("input", renderOrders);
  document.querySelector("#orderStatusFilter").addEventListener("change", renderOrders);
  document.querySelector("#copyQrBtn").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(currentQrUrl); toast("Link QR disalin", "success"); }
    catch { toast("Browser tidak mengizinkan copy otomatis.", "warning"); }
  });
  document.querySelector("#downloadQrBtn").addEventListener("click", downloadCurrentQr);
}

function startRealtime() {
  onSnapshot(collection(db, "categories"), (snapshot) => {
    categories = snapshot.docs.map((snap) => ({ id: snap.id, ...snap.data() })).sort((a,b)=>(a.sortOrder||0)-(b.sortOrder||0));
    renderCategories(); renderMenu(); fillCategorySelect(); renderStats();
  }, realtimeError);
  onSnapshot(collection(db, "menu"), (snapshot) => {
    menuItems = snapshot.docs.map((snap) => ({ id: snap.id, ...snap.data() })).sort((a,b)=>(a.sortOrder||0)-(b.sortOrder||0));
    renderMenu(); renderStats();
  }, realtimeError);
  onSnapshot(collection(db, "tables"), (snapshot) => {
    tables = snapshot.docs.map((snap) => ({ id: snap.id, ...snap.data() })).sort((a,b)=>String(a.tableNumber).localeCompare(String(b.tableNumber),"id",{numeric:true}));
    renderTables(); renderStats();
  }, realtimeError);
  onSnapshot(collection(db, "users"), (snapshot) => {
    staff = snapshot.docs.map((snap) => ({ uid: snap.id, ...snap.data() })).sort((a,b)=>(a.name||"").localeCompare(b.name||""));
    renderStaff();
  }, realtimeError);
  onSnapshot(collection(db, "orders"), (snapshot) => {
    orders = snapshot.docs.map((snap) => ({ id: snap.id, ...snap.data() })).sort((a,b)=>timestampMs(b.createdAt)-timestampMs(a.createdAt));
    renderOrders(); renderStats();
  }, realtimeError);
  onSnapshot(doc(db, "settings", "public"), (snapshot) => {
    if (snapshot.exists()) settings = { ...settings, ...snapshot.data() };
    document.querySelector("#settingCafeName").value = settings.cafeName || "JedaSpace";
    document.querySelector("#settingMapsUrl").value = settings.mapsUrl || "";
    document.querySelector("#settingTagline").value = settings.tagline || "";
  }, realtimeError);
}

function realtimeError(error) {
  console.error(error);
  toast("Sebagian data gagal dimuat. Periksa Firestore Rules.", "error");
}

function timestampMs(value) {
  if (!value) return 0;
  if (value.toMillis) return value.toMillis();
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function renderStats() {
  const now = new Date();
  const today = orders.filter((order) => {
    const date = order.createdAt?.toDate ? order.createdAt.toDate() : new Date(timestampMs(order.createdAt));
    return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  });
  document.querySelector("#statToday").textContent = today.length;
  document.querySelector("#statRevenue").textContent = formatIDR(today.filter((o)=>o.paymentStatus === "paid").reduce((sum,o)=>sum+(Number(o.total)||0),0));
  document.querySelector("#statMenu").textContent = menuItems.filter((item)=>item.active !== false).length;
  document.querySelector("#statTables").textContent = tables.filter((table)=>table.active === true).length;
}

function fillCategorySelect() {
  const select = document.querySelector("#menuCategory");
  if (!select) return;
  select.innerHTML = categories.map((cat)=>`<option value="${escapeHTML(cat.id)}">${escapeHTML(cat.name)}</option>`).join("");
}

function renderMenu() {
  const body = document.querySelector("#menuBody"); if (!body) return;
  body.innerHTML = menuItems.length ? menuItems.map((item)=>{
    const cat = categories.find((entry)=>entry.id===item.categoryId);
    return `<tr><td><strong>${escapeHTML(item.name)}</strong><div class="small muted">${escapeHTML(item.description||"")}</div></td><td>${escapeHTML(cat?.name||"-")}</td><td>${formatIDR(item.basePrice)}</td><td><span class="badge ${item.available === false ? "badge-red" : "badge-green"}">${item.available === false ? "Habis" : "Tersedia"}</span></td><td><span class="badge ${item.active === false ? "badge-gray" : "badge-blue"}">${item.active === false ? "Nonaktif" : "Aktif"}</span></td><td><div class="actions"><button class="btn btn-secondary btn-sm" data-menu-edit="${escapeHTML(item.id)}">Edit</button><button class="btn btn-secondary btn-sm" data-menu-availability="${escapeHTML(item.id)}">${item.available === false ? "Jadikan tersedia" : "Tandai habis"}</button><button class="btn btn-ghost btn-sm ${item.active === false ? "" : "text-danger"}" data-menu-active="${escapeHTML(item.id)}">${item.active === false ? "Aktifkan" : "Nonaktifkan"}</button></div></td></tr>`;
  }).join("") : `<tr><td colspan="6" class="empty">Belum ada menu.</td></tr>`;
  body.onclick = async (event) => {
    const edit = event.target.closest("[data-menu-edit]");
    const availability = event.target.closest("[data-menu-availability]");
    const active = event.target.closest("[data-menu-active]");
    const id = edit?.dataset.menuEdit || availability?.dataset.menuAvailability || active?.dataset.menuActive;
    const item = menuItems.find((entry)=>entry.id===id); if (!item) return;
    if (edit) openMenuForm(item);
    if (availability) await updateDoc(doc(db,"menu",item.id),{available:item.available===false,updatedAt:serverTimestamp()});
    if (active) await updateDoc(doc(db,"menu",item.id),{active:item.active===false,updatedAt:serverTimestamp()});
  };
}

function openMenuForm(item = null) {
  document.querySelector("#menuModalTitle").textContent = item ? "Edit menu" : "Tambah menu";
  document.querySelector("#menuId").value = item?.id || "";
  document.querySelector("#menuName").value = item?.name || "";
  fillCategorySelect();
  document.querySelector("#menuCategory").value = item?.categoryId || categories[0]?.id || "";
  document.querySelector("#menuDescription").value = item?.description || "";
  document.querySelector("#menuPrice").value = item?.basePrice ?? 0;
  document.querySelector("#menuSort").value = item?.sortOrder ?? 0;
  document.querySelector("#menuAvailable").value = String(item?.available !== false);
  document.querySelector("#menuActive").value = String(item?.active !== false);
  document.querySelector("#menuVariants").value = stringifyVariantGroups(item?.optionGroups || []);
  document.querySelector("#menuAddons").value = stringifyAddons(item?.addons || []);
  document.querySelector("#menuImageUrl").value = item?.imageUrl || "";
  document.querySelector("#menuImage").value = "";
  document.querySelector("#currentImageHint").textContent = item?.imageUrl ? "Foto saat ini terisi. Upload file baru hanya jika Firebase Storage sudah aktif." : "Upload file membutuhkan Firebase Storage.";
  openModal("menuModal");
}

async function saveMenu(event) {
  event.preventDefault();
  const button = event.submitter;
  setButtonLoading(button,true,"Menyimpan...");
  try {
    const existingId = document.querySelector("#menuId").value;
    const id = existingId || randomId("menu");
    const existing = menuItems.find((item)=>item.id===id);
    let imageUrl = document.querySelector("#menuImageUrl").value.trim() || existing?.imageUrl || "";
    const file = document.querySelector("#menuImage").files[0];
    if (file) {
      if (!file.type.startsWith("image/")) throw new Error("File harus berupa gambar");
      if (file.size > 5 * 1024 * 1024) throw new Error("Ukuran gambar maksimal 5 MB");
      const storageRef = ref(storage, `menu/${id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,"-")}`);
      await uploadBytes(storageRef,file,{contentType:file.type});
      imageUrl = await getDownloadURL(storageRef);
    }
    await setDoc(doc(db,"menu",id),{
      name:document.querySelector("#menuName").value.trim(),
      categoryId:document.querySelector("#menuCategory").value,
      description:document.querySelector("#menuDescription").value.trim(),
      basePrice:Math.max(0,Number(document.querySelector("#menuPrice").value)||0),
      sortOrder:Number(document.querySelector("#menuSort").value)||0,
      available:document.querySelector("#menuAvailable").value==="true",
      active:document.querySelector("#menuActive").value==="true",
      optionGroups:parseVariantText(document.querySelector("#menuVariants").value),
      addons:parseAddonText(document.querySelector("#menuAddons").value),
      imageUrl,
      createdAt:existing?.createdAt || serverTimestamp(),
      updatedAt:serverTimestamp()
    },{merge:true});
    closeModal("menuModal"); toast("Menu tersimpan", "success");
  } catch (error) { console.error(error); toast(error.message || "Gagal menyimpan menu", "error"); }
  finally { setButtonLoading(button,false); }
}

function renderCategories() {
  const body=document.querySelector("#categoryBody"); if(!body)return;
  body.innerHTML=categories.length?categories.map((cat)=>`<tr><td><strong>${escapeHTML(cat.name)}</strong></td><td>${cat.sortOrder||0}</td><td><span class="badge ${cat.active===false?"badge-gray":"badge-green"}">${cat.active===false?"Nonaktif":"Aktif"}</span></td><td><div class="actions"><button class="btn btn-secondary btn-sm" data-cat-edit="${escapeHTML(cat.id)}">Edit</button><button class="btn btn-ghost btn-sm ${cat.active===false?"":"text-danger"}" data-cat-active="${escapeHTML(cat.id)}">${cat.active===false?"Aktifkan":"Nonaktifkan"}</button></div></td></tr>`).join(""):`<tr><td colspan="4" class="empty">Belum ada kategori.</td></tr>`;
  body.onclick=async(event)=>{const edit=event.target.closest("[data-cat-edit]");const active=event.target.closest("[data-cat-active]");const id=edit?.dataset.catEdit||active?.dataset.catActive;const cat=categories.find((x)=>x.id===id);if(!cat)return;if(edit)openCategoryForm(cat);if(active)await updateDoc(doc(db,"categories",cat.id),{active:cat.active===false,updatedAt:serverTimestamp()});};
}
function openCategoryForm(cat=null){document.querySelector("#categoryId").value=cat?.id||"";document.querySelector("#categoryName").value=cat?.name||"";document.querySelector("#categorySort").value=cat?.sortOrder??0;document.querySelector("#categoryActive").value=String(cat?.active!==false);openModal("categoryModal");}
async function saveCategory(event){event.preventDefault();const button=event.submitter;setButtonLoading(button,true,"Menyimpan...");try{const existingId=document.querySelector("#categoryId").value;const id=existingId||randomId("cat");await setDoc(doc(db,"categories",id),{name:document.querySelector("#categoryName").value.trim(),sortOrder:Number(document.querySelector("#categorySort").value)||0,active:document.querySelector("#categoryActive").value==="true",updatedAt:serverTimestamp()},{merge:true});closeModal("categoryModal");toast("Kategori tersimpan","success");}catch(error){console.error(error);toast("Gagal menyimpan kategori","error");}finally{setButtonLoading(button,false);}}

function renderTables(){const body=document.querySelector("#tableBody");if(!body)return;body.innerHTML=tables.length?tables.map((table)=>`<tr><td><strong>${escapeHTML(table.tableName||`Meja ${table.tableNumber}`)}</strong><div class="small muted">Nomor ${escapeHTML(table.tableNumber||"-")}</div></td><td><span class="mono small">${escapeHTML((table.qrToken||"").slice(0,22))}…</span></td><td><span class="badge ${table.active?"badge-green":"badge-gray"}">${table.active?"Aktif":"Nonaktif"}</span></td><td><div class="actions"><button class="btn btn-secondary btn-sm" data-table-qr="${escapeHTML(table.id)}">QR</button><button class="btn btn-secondary btn-sm" data-table-edit="${escapeHTML(table.id)}">Edit</button><button class="btn btn-secondary btn-sm" data-table-rotate="${escapeHTML(table.id)}">Ganti token</button></div></td></tr>`).join(""):`<tr><td colspan="4" class="empty">Belum ada meja.</td></tr>`;body.onclick=async(event)=>{const qr=event.target.closest("[data-table-qr]");const edit=event.target.closest("[data-table-edit]");const rotate=event.target.closest("[data-table-rotate]");const id=qr?.dataset.tableQr||edit?.dataset.tableEdit||rotate?.dataset.tableRotate;const table=tables.find((x)=>x.id===id);if(!table)return;if(qr)showQr(table);if(edit)openTableForm(table);if(rotate)await rotateTableToken(table);};}
function openTableForm(table=null){document.querySelector("#tableId").value=table?.id||"";document.querySelector("#tableNumber").value=table?.tableNumber||"";document.querySelector("#tableName").value=table?.tableName||"";document.querySelector("#tableActive").value=String(table?.active!==false);openModal("tableModal");}
async function saveTable(event){event.preventDefault();const button=event.submitter;setButtonLoading(button,true,"Menyimpan...");try{const existingId=document.querySelector("#tableId").value;const id=existingId||randomId("table");const old=tables.find((x)=>x.id===id);const token=old?.qrToken||randomToken("tbl");const tableNumber=document.querySelector("#tableNumber").value.trim();const tableName=document.querySelector("#tableName").value.trim()||`Meja ${tableNumber}`;const active=document.querySelector("#tableActive").value==="true";const batch=writeBatch(db);batch.set(doc(db,"tables",id),{tableNumber,tableName,qrToken:token,active,createdAt:old?.createdAt||serverTimestamp(),updatedAt:serverTimestamp()},{merge:true});batch.set(doc(db,"tableTokens",token),{tableId:id,tableNumber,tableName,active,updatedAt:serverTimestamp()},{merge:true});await batch.commit();closeModal("tableModal");toast("Meja tersimpan","success");}catch(error){console.error(error);toast("Gagal menyimpan meja","error");}finally{setButtonLoading(button,false);}}
async function rotateTableToken(table){if(!confirm(`Ganti token QR ${table.tableName||table.tableNumber}? QR lama akan tidak berlaku.`))return;try{const newToken=randomToken("tbl");const batch=writeBatch(db);batch.update(doc(db,"tables",table.id),{qrToken:newToken,updatedAt:serverTimestamp()});batch.set(doc(db,"tableTokens",table.qrToken),{tableId:table.id,tableNumber:table.tableNumber,tableName:table.tableName,active:false,revokedAt:serverTimestamp()},{merge:true});batch.set(doc(db,"tableTokens",newToken),{tableId:table.id,tableNumber:table.tableNumber,tableName:table.tableName,active:table.active===true,updatedAt:serverTimestamp()});await batch.commit();toast("Token QR berhasil diganti","success");}catch(error){console.error(error);toast("Gagal mengganti token","error");}}
function customerBaseUrl(){return new URL("../",location.href);}
function showQr(table){const url=customerBaseUrl();url.search="";url.searchParams.set("t",table.qrToken);currentQrUrl=url.href;document.querySelector("#qrTitle").textContent=`QR ${table.tableName||table.tableNumber}`;document.querySelector("#qrUrl").textContent=currentQrUrl;const box=document.querySelector("#qrBox");box.innerHTML="";if(window.QRCode)new QRCode(box,{text:currentQrUrl,width:240,height:240,colorDark:"#101828",colorLight:"#ffffff",correctLevel:QRCode.CorrectLevel.H});else box.textContent="Library QR gagal dimuat.";openModal("qrModal");}
function downloadCurrentQr(){const box=document.querySelector("#qrBox");const canvas=box.querySelector("canvas");const image=box.querySelector("img");const href=canvas?.toDataURL("image/png")||image?.src;if(!href)return toast("QR belum siap.","warning");const link=document.createElement("a");link.href=href;link.download=`JedaSpace-QR-${Date.now()}.png`;link.click();}

function renderStaff(){const body=document.querySelector("#staffBody");if(!body)return;body.innerHTML=staff.length?staff.map((user)=>`<tr><td><strong>${escapeHTML(user.name||"-")}</strong></td><td>${escapeHTML(user.email||"-")}</td><td><span class="badge badge-blue">${escapeHTML(user.role||"-")}</span></td><td><span class="badge ${user.active?"badge-green":"badge-gray"}">${user.active?"Aktif":"Nonaktif"}</span></td><td><span class="mono small">${escapeHTML(user.uid.slice(0,10))}…</span></td><td><button class="btn btn-secondary btn-sm" data-staff-edit="${escapeHTML(user.uid)}">Edit</button></td></tr>`).join(""):`<tr><td colspan="6" class="empty">Belum ada profil staff.</td></tr>`;body.onclick=(event)=>{const button=event.target.closest("[data-staff-edit]");if(!button)return;openStaffForm(staff.find((x)=>x.uid===button.dataset.staffEdit));};}
function openStaffForm(user=null){document.querySelector("#staffUid").value=user?.uid||"";document.querySelector("#staffUid").readOnly=Boolean(user);document.querySelector("#staffName").value=user?.name||"";document.querySelector("#staffEmail").value=user?.email||"";document.querySelector("#staffRole").value=user?.role||"barista";document.querySelector("#staffActive").value=String(user?.active!==false);openModal("staffModal");}
async function saveStaff(event){event.preventDefault();const button=event.submitter;setButtonLoading(button,true,"Menyimpan...");try{const uid=document.querySelector("#staffUid").value.trim();const role=document.querySelector("#staffRole").value;const active=document.querySelector("#staffActive").value==="true";if(uid===currentStaff.uid&&(role!=="admin"||!active))throw new Error("Akun admin yang sedang digunakan tidak boleh menonaktifkan dirinya sendiri.");await setDoc(doc(db,"users",uid),{name:document.querySelector("#staffName").value.trim(),email:document.querySelector("#staffEmail").value.trim(),role,active,updatedAt:serverTimestamp()},{merge:true});closeModal("staffModal");toast("Profil staff tersimpan","success");}catch(error){console.error(error);toast(error.message||"Gagal menyimpan staff","error");}finally{setButtonLoading(button,false);}}

function renderOrders(){const body=document.querySelector("#ordersBody");if(!body)return;const search=document.querySelector("#orderSearch").value.trim().toLowerCase();const status=document.querySelector("#orderStatusFilter").value;const list=orders.filter((order)=>{const hay=`${order.orderNumber||""} ${order.tableNumber||""} ${order.tableName||""}`.toLowerCase();return(!search||hay.includes(search))&&(status==="all"||order.status===status);});body.innerHTML=list.length?list.map((order)=>`<tr><td><strong>${escapeHTML(order.orderNumber||order.id)}</strong></td><td>${escapeHTML(order.tableName||order.tableNumber||"-")}</td><td>${formatDateTime(order.createdAt)}</td><td>${formatIDR(order.total)}</td><td><span class="badge ${order.paymentStatus==="paid"?"badge-green":"badge-yellow"}">${escapeHTML(PAYMENT_STATUS[order.paymentStatus]||order.paymentStatus)}</span></td><td><span class="badge ${order.status==="completed"?"badge-green":order.status==="cancelled"?"badge-red":"badge-blue"}">${escapeHTML(ORDER_STATUS[order.status]||order.status)}</span></td></tr>`).join(""):`<tr><td colspan="6" class="empty">Tidak ada order yang cocok.</td></tr>`;}

async function saveSettings(event){event.preventDefault();const button=event.submitter;setButtonLoading(button,true,"Menyimpan...");try{await setDoc(doc(db,"settings","public"),{cafeName:document.querySelector("#settingCafeName").value.trim()||"JedaSpace",mapsUrl:document.querySelector("#settingMapsUrl").value.trim(),tagline:document.querySelector("#settingTagline").value.trim(),updatedAt:serverTimestamp()},{merge:true});toast("Pengaturan tersimpan","success");}catch(error){console.error(error);toast("Gagal menyimpan pengaturan","error");}finally{setButtonLoading(button,false);}}

async function seedDemoData(event){if(categories.length||menuItems.length||tables.length){toast("Seed demo hanya untuk database kosong. Data Anda tidak diubah.","warning");return;}if(!confirm("Isi database kosong dengan data demo JedaSpace?"))return;const button=event.currentTarget;setButtonLoading(button,true,"Mengisi data...");try{const batch=writeBatch(db);const demoCategories=[
  ["cat-coffee",{name:"Coffee",sortOrder:1,active:true}],
  ["cat-noncoffee",{name:"Non Coffee",sortOrder:2,active:true}],
  ["cat-food",{name:"Food",sortOrder:3,active:true}],
  ["cat-snack",{name:"Snack",sortOrder:4,active:true}]
];
demoCategories.forEach(([id,data])=>batch.set(doc(db,"categories",id),{...data,updatedAt:serverTimestamp()},{merge:true}));
const demoMenu=[
  ["menu-jeda-signature",{categoryId:"cat-coffee",name:"Jeda Signature",description:"Espresso, susu, dan gula aren dengan rasa seimbang.",basePrice:28000,active:true,available:true,sortOrder:1,optionGroups:[{id:"suhu",name:"Suhu",required:true,options:[{id:"hot",name:"Hot",additionalPrice:0},{id:"iced",name:"Iced",additionalPrice:3000}]},{id:"ukuran",name:"Ukuran",required:true,options:[{id:"regular",name:"Regular",additionalPrice:0},{id:"large",name:"Large",additionalPrice:5000}]}],addons:[{id:"extra-shot",name:"Extra Shot",additionalPrice:5000}]}],
  ["menu-americano",{categoryId:"cat-coffee",name:"Americano",description:"Espresso dengan air, clean dan ringan.",basePrice:22000,active:true,available:true,sortOrder:2,optionGroups:[{id:"suhu",name:"Suhu",required:true,options:[{id:"hot",name:"Hot",additionalPrice:0},{id:"iced",name:"Iced",additionalPrice:2000}]}],addons:[{id:"extra-shot",name:"Extra Shot",additionalPrice:5000}]}],
  ["menu-matcha",{categoryId:"cat-noncoffee",name:"Matcha Latte",description:"Matcha creamy dengan aftertaste lembut.",basePrice:30000,active:true,available:true,sortOrder:3,optionGroups:[{id:"suhu",name:"Suhu",required:true,options:[{id:"hot",name:"Hot",additionalPrice:0},{id:"iced",name:"Iced",additionalPrice:2000}]}],addons:[]}],
  ["menu-croissant",{categoryId:"cat-snack",name:"Butter Croissant",description:"Croissant renyah dan buttery untuk teman ngopi.",basePrice:24000,active:true,available:true,sortOrder:4,optionGroups:[],addons:[]}]
];
demoMenu.forEach(([id,data])=>batch.set(doc(db,"menu",id),{...data,imageUrl:"",updatedAt:serverTimestamp()},{merge:true}));
for(let i=1;i<=8;i++){const id=`table-${String(i).padStart(2,"0")}`;const token=randomToken("tbl");const tableNumber=String(i).padStart(2,"0");const tableName=`Meja ${tableNumber}`;batch.set(doc(db,"tables",id),{tableNumber,tableName,qrToken:token,active:true,updatedAt:serverTimestamp()},{merge:true});batch.set(doc(db,"tableTokens",token),{tableId:id,tableNumber,tableName,active:true,updatedAt:serverTimestamp()});}
batch.set(doc(db,"settings","public"),{cafeName:"JedaSpace",tagline:"Ambil jeda, nikmati momennya.",mapsUrl:"",updatedAt:serverTimestamp()},{merge:true});await batch.commit();toast("Data demo berhasil dibuat","success");}catch(error){console.error(error);toast("Seed gagal. Periksa Firestore Rules.","error");}finally{setButtonLoading(button,false);}}
