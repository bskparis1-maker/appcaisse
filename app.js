// ================== CONFIG GOOGLE SHEETS ==================
const SHEET_URL =
  "https://script.google.com/macros/s/AKfycbwIuoPvoE_1DcLGWY5aoEdAHHM1l_2eoqL5VReGyF0P8ctbzmvQwt6tDcgSzRfxcbw/exec";

// ================== PRODUITS CAISSE ==================
const defaultProducts = [
  { id: 1, name: "Bar à Musc", price: 8000, stock: 99 },
  { id: 2, name: "Bar à Parfum", price: 8000, stock: 68 },
  { id: 3, name: "Bar à Thiouraye", price: 3000, stock: 111 },

  { id: 4, name: "Brume BUTTERFLY", price: 8000, stock: 40 },
  { id: 5, name: "Brume NEFERTITI", price: 8000, stock: 26 },
  { id: 6, name: "Brume SUMMER", price: 8000, stock: 22 },
  { id: 7, name: "Brume CRUSH", price: 8000, stock: 19 },

  { id: 8, name: "Musc BUTTERFLY", price: 8000, stock: 8 },
  { id: 9, name: "Musc NEFERTITI", price: 8000, stock: 2 },
  { id: 10, name: "Musc CRUSH", price: 8000, stock: 2 },
  { id: 11, name: "Musc SUMMER", price: 8000, stock: 5 },

  { id: 12, name: "Jardin suspendu", price: 5000, stock: 11 },
  { id: 13, name: "Nuit de noce", price: 5000, stock: 3 },
  { id: 14, name: "Figue d’amour", price: 5000, stock: 2 },
  { id: 15, name: "Linge de maman", price: 5000, stock: 2 },
  { id: 16, name: "Bonbon", price: 5000, stock: 2 },
  { id: 17, name: "Sweet Cotton", price: 5000, stock: 0 },
  { id: 18, name: "Couture", price: 0, stock: 999999 }
];

// ================== BAR À PARFUM ==================
const PERFUME_LEVELS = {
  full: { label: "1L ou plus", className: "perfume-full" },
  half: { label: "0,5L", className: "perfume-half" },
  out: { label: "Rupture", className: "perfume-out" }
};

// ================== ANNIVERSAIRES (VERSION UNIQUE) ==================
function parseClientBirthdate(client) {
  const raw =
    client?.birthdate ||
    client?.birthDate ||
    client?.dateOfBirth ||
    client?.date_naissance;

  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

function isClientBirthdaySoon(client, hours = 72) {
  const dob = parseClientBirthdate(client);
  if (!dob) return false;

  const now = new Date();
  const year = now.getFullYear();

  let nextBirthday = new Date(year, dob.getMonth(), dob.getDate());
  if (nextBirthday < now) nextBirthday.setFullYear(year + 1);

  const diffHours = (nextBirthday - now) / (1000 * 60 * 60);
  return diffHours >= 0 && diffHours <= hours;
}

function formatBirthdateShort(raw) {
  if (!raw) return "—";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
}

// ================== LOCAL STORAGE HELPERS (SIMPLIFIÉS) ==================
function loadProducts() {
  return defaultProducts.slice();
}
function saveProducts(products) {
  // optionnel : localStorage.setItem("products", JSON.stringify(products));
}
function loadSales() {
  return [];
}
function saveSales(sales) {
  // optionnel : localStorage.setItem("sales", JSON.stringify(sales));
}
function loadClients() {
  return [];
}
function saveClients(clients) {
  // optionnel : localStorage.setItem("clients", JSON.stringify(clients));
}

// ================== ÉTAT GLOBAL ==================
let products = loadProducts();
let sales = loadSales();
let clients = loadClients();
let cart = []; // [{ productId, qty, price, ... }]
let perfumes = []; // [{ name, level }]
let dashboardChart = null;
let lastTicketSale = null;
let stockHistory = [];
let expenses = [];
let credits = [];
let creditPayments = [];
let pendingCreditClient = null;
// ================== STOCK <-> SHEETS ==================
function fetchStockFromSheet() {
  const callbackName = "onStockFromSheet_" + Date.now();
  const script = document.createElement("script");

  window[callbackName] = function (data) {
    try {
      if (data && Array.isArray(data.products) && data.products.length > 0) {
        products = data.products.map((p) => ({
          id: Number(p.id),
          name: p.name,
          price: Number(p.price),
          stock: Number(p.stock)
        }));
        saveProducts(products);
      }
    } finally {
      renderProductsForSale();
      renderProductsTable();
      renderCart();
      // ✅ (les ventes sont déjà chargées au démarrage : on ne les recharge plus 2 fois)
      refreshProIfVisible();
      delete window[callbackName];
      script.remove();
    }
  };

  script.src = `${SHEET_URL}?action=getStock&callback=${callbackName}`;
  script.onerror = function () {
    console.warn("Erreur chargement stock, utilisation locale.");
    renderProductsForSale();
    renderProductsTable();
    renderCart();
  };
  document.body.appendChild(script);
}

function sendStockToSheet(productsToSend) {
  const payload = encodeURIComponent(JSON.stringify({ products: productsToSend }));
  const url = `${SHEET_URL}?action=updateStock&payload=${payload}`;

  const iframe = document.createElement("iframe");
  iframe.style.display = "none";
  iframe.src = url;
  document.body.appendChild(iframe);
  setTimeout(() => iframe.remove(), 5000);
}

// ================== CLIENTS <-> SHEETS ==================
function sendClientToSheet(client) {
  const payload = encodeURIComponent(JSON.stringify({ client }));
  const url = `${SHEET_URL}?action=addClient&payload=${payload}`;

  const iframe = document.createElement("iframe");
  iframe.style.display = "none";
  iframe.src = url;
  document.body.appendChild(iframe);
  setTimeout(() => iframe.remove(), 5000);
}

function fetchClientsFromSheet() {
  const callbackName = "onClientsFromSheet_" + Date.now();
  const script = document.createElement("script");

  window[callbackName] = function (data) {
    try {
      if (data && Array.isArray(data.clients)) {
        clients = data.clients.map((c) => ({
          id: c.id, // on garde tel quel (string ou number), on comparera avec String()
          name: c.name || "",
          phone: c.phone || "",
          createdAt: c.createdAt || new Date().toISOString(),
          birthdate: c.birthdate || ""
        }));
        saveClients(clients);
      }
    } finally {
      renderClientSelect();
      renderClientsTable();
      delete window[callbackName];
      script.remove();
    }
  };

  script.src = `${SHEET_URL}?action=getClients&callback=${callbackName}`;
  script.onerror = function () {
    console.warn("Erreur chargement clients.");
    renderClientSelect();
    renderClientsTable();
  };

  document.body.appendChild(script);
}

// ================== ENVOI VENTE -> SHEETS ==================
function sendSaleToSheet(sale) {
  const payload = encodeURIComponent(JSON.stringify({ sale }));
  const url = `${SHEET_URL}?action=sale&payload=${payload}`;

  const iframe = document.createElement("iframe");
  iframe.style.display = "none";
  iframe.src = url;
  document.body.appendChild(iframe);
  setTimeout(() => iframe.remove(), 5000);
}

// ================== VENTES <-> SHEETS ==================
function fetchSalesFromSheet() {
  const debugEl = document.getElementById("sales-debug");
  if (debugEl) debugEl.textContent = "Connexion à Google Sheets…";

  const callbackName = "onSalesFromSheet_" + Date.now();
  const script = document.createElement("script");

  window[callbackName] = function (data) {
    try {
      if (data && Array.isArray(data.sales)) {
        sales = data.sales.map((s) => {
          const info = s.info || {};

          const names = String(s.productNames || "")
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean);

          const qtys = String(s.quantities || "")
            .split(",")
            .map((t) => parseInt(t.trim(), 10) || 0);

          // Optionnel : si ton Apps Script renvoie unitPrices (ex: "8000,5000")
          const unitPrices = String(s.unitPrices || "")
            .split(",")
            .map((t) => Number(t.trim()) || 0);

          const items = names.map((name, index) => ({
            name,
            qty: qtys[index] || 0,
            price: unitPrices[index] || 0
          }));

          return {
            id: s.id, // souvent string dans Sheets
            date: s.date,
            total: Number(s.total) || 0,
            items,
            paymentMethod: info.paymentMethod || "cash",
            discountAmount: Number(info.discountAmount) || 0,
            discountReason: info.discountReason || "",
            clientId: info.clientId || "",
            clientName: info.clientName || "",
            clientPhone: info.clientPhone || ""
          };
        });

        if (debugEl) {
          debugEl.textContent = "Ventes reçues : " + sales.length;
        }
      } else {
        if (debugEl) debugEl.textContent = "Réponse vide ou invalide.";
      }
    } finally {
      updateSalesViewForSelectedDate();
      renderClientsTable();
      // si dashboard affiché, on rafraîchit sans casser
      loadDashboardStats?.();
      refreshProIfVisible();
      delete window[callbackName];
      script.remove();
    }
  };

  script.src = `${SHEET_URL}?action=getSales&callback=${callbackName}`;
  script.onerror = function () {
    console.warn("Erreur chargement ventes (getSales).");
    if (debugEl) debugEl.textContent = "Erreur connexion Google Sheets (getSales).";
    updateSalesViewForSelectedDate();
    renderClientsTable();
  };

  document.body.appendChild(script);
}

function refreshSalesFromSheet() {
  fetchSalesFromSheet();
}

function formatPaymentMethod(method) {
  if (method === "orange") return "Orange Money";
  if (method === "wave") return "Wave";
  return "Espèces";
}

// ================== BAR À PARFUM <-> SHEETS ==================
function fetchPerfumesFromSheet() {
  const callbackName = "onPerfumes_" + Date.now();
  const script = document.createElement("script");

  window[callbackName] = function (data) {
    try {
      if (data && Array.isArray(data.perfumes)) {
        perfumes = data.perfumes.map((p) => ({
          name: p.name,
          level: p.level || "full"
        }));
      }
    } finally {
      renderPerfumeBar();
      delete window[callbackName];
      script.remove();
    }
  };

  script.src = `${SHEET_URL}?action=getPerfumes&callback=${callbackName}`;
  script.onerror = function () {
    console.warn("Erreur chargement Bar à parfum.");
  };
  document.body.appendChild(script);
}

function sendPerfumesToSheet() {
  const payload = encodeURIComponent(JSON.stringify({ perfumes }));
  const url = `${SHEET_URL}?action=updatePerfumes&payload=${payload}`;

  const iframe = document.createElement("iframe");
  iframe.style.display = "none";
  iframe.src = url;
  document.body.appendChild(iframe);
  setTimeout(() => iframe.remove(), 5000);
}
// ================== CREDIT <-> SHEETS ==================
function fetchCreditsFromSheet() {
  const cb = "onCredits_" + Date.now();
  const script = document.createElement("script");

  window[cb] = function (data) {
    try {
      credits = Array.isArray(data?.credits) ? data.credits : [];
    } finally {
      renderCreditsUI();
      refreshProIfVisible();
      delete window[cb];
      script.remove();
    }
  };

  script.src = `${SHEET_URL}?action=getCredits&callback=${cb}`;
  script.onerror = () => console.warn("Erreur getCredits");
  document.body.appendChild(script);
}

function fetchCreditPaymentsFromSheet() {
  const cb = "onCreditPays_" + Date.now();
  const script = document.createElement("script");

  window[cb] = function (data) {
    try {
      creditPayments = Array.isArray(data?.payments) ? data.payments : [];
    } finally {
      renderCreditPaymentsTable();
      renderCreditTotals();
      delete window[cb];
      script.remove();
    }
  };

  script.src = `${SHEET_URL}?action=getCreditPayments&callback=${cb}`;
  script.onerror = () => console.warn("Erreur getCreditPayments");
  document.body.appendChild(script);
}

function sendCreditToSheet(credit) {
  const payload = encodeURIComponent(JSON.stringify({ credit }));
  fetch(`${SHEET_URL}?action=addCredit&payload=${payload}`).catch(console.error);
}

function updateCreditOnSheet(creditId, amountDue, status) {
  const payload = encodeURIComponent(JSON.stringify({ update: { creditId, amountDue, status } }));
  fetch(`${SHEET_URL}?action=updateCredit&payload=${payload}`).catch(console.error);
}

function sendCreditPaymentToSheet(payment) {
  const payload = encodeURIComponent(JSON.stringify({ payment }));
  fetch(`${SHEET_URL}?action=addCreditPayment&payload=${payload}`).catch(console.error);
}
// ================== NAVIGATION ==================
function showView(viewName) {
  document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
  const view = document.getElementById(`view-${viewName}`);
  if (view) view.classList.remove("hidden");

  if (viewName === "caisse") {
    renderProductsForSale();
    renderCart();
    renderClientSelect();
  } else if (viewName === "produits") {
    renderProductsTable();
  } else if (viewName === "clients") {
    renderClientsTable();
  } else if (viewName === "ventes") {
    initSalesDate();
    updateSalesViewForSelectedDate();
  } else if (viewName === "dashboard") {
    initDashboardDates();
    loadDashboardStats();
  } else if (viewName === "frais") {
    renderExpensesTable();
  } else if (viewName === "barparfum" || viewName === "bar-parfum") {
    renderPerfumeBar();
  } else if (viewName === "credit") {
    renderCreditsUI();
  } else if (viewName === "pro") {
    renderProView();
  }
}

// ================== CAISSE ==================
// -------- PROMO --------
function getCurrentPromo() {
  try {
    return JSON.parse(localStorage.getItem("promo") || "{}");
  } catch (e) {
    return {};
  }
}
function saveCurrentPromo(promo) {
  localStorage.setItem("promo", JSON.stringify(promo));
}

function getPromoPrice(basePrice) {
  const promo = getCurrentPromo();
  if (!promo.start || !promo.end) return basePrice;

  const now = new Date();
  const start = new Date(promo.start + "T00:00:00");
  const end = new Date(promo.end + "T23:59:59");
  if (now < start || now > end) return basePrice;

  if (basePrice === 8000) return promo.new8000 || basePrice;
  if (basePrice === 5000) return promo.new5000 || basePrice;
  return basePrice;
}

function isPromoActiveNow() {
  const promo = getCurrentPromo();
  if (!promo.start || !promo.end) return false;

  const now = new Date();
  const start = new Date(promo.start + "T00:00:00");
  const end = new Date(promo.end + "T23:59:59");
  return now >= start && now <= end;
}

function openPromoModal() {
  const popup = document.getElementById("promo-popup");
  if (!popup) return;

  const promo = getCurrentPromo();
  document.getElementById("promo-8000").value = promo.new8000 || 8000;
  document.getElementById("promo-5000").value = promo.new5000 || 5000;
  document.getElementById("promo-start").value = promo.start || "";
  document.getElementById("promo-end").value = promo.end || "";
  popup.classList.remove("hidden");
}

function closePromoPopup() {
  const popup = document.getElementById("promo-popup");
  if (!popup) return;
  popup.classList.add("hidden");
}

function savePromo() {
  const p8000 = Number(document.getElementById("promo-8000").value) || 8000;
  const p5000 = Number(document.getElementById("promo-5000").value) || 5000;
  const start = document.getElementById("promo-start").value;
  const end = document.getElementById("promo-end").value;

  if (!start || !end) {
    alert("Merci de définir une date de début et une date de fin.");
    return;
  }

  saveCurrentPromo({ start, end, new8000: p8000, new5000: p5000 });
  alert("Promo enregistrée.");
  closePromoPopup();
  renderProductsForSale();
}

function onToggleCreditMode(checked) {
  if (checked) {
    openCreditSaleModal();
  } else {
    pendingCreditClient = null;
  }
}

function openCreditSaleModal() {
  document.getElementById("credit-client-name").value = "";
  document.getElementById("credit-client-phone").value = "";
  document.getElementById("credit-sale-modal").classList.remove("hidden");
}

function closeCreditSaleModal() {
  document.getElementById("credit-sale-modal").classList.add("hidden");
  const cb = document.getElementById("credit-mode");
  if (cb) cb.checked = false;
  pendingCreditClient = null;
}

function confirmCreditClientInfo() {
  const name = (document.getElementById("credit-client-name").value || "").trim();
  const phone = (document.getElementById("credit-client-phone").value || "").trim();

  if (!name) {
    alert("Merci de renseigner le nom du client.");
    return;
  }

  pendingCreditClient = { name, phone };
  document.getElementById("credit-sale-modal").classList.add("hidden");

  alert("Client crédit enregistré. Ajoute maintenant les produits au panier puis valide la vente.");
}

function markCreditAsValidated(creditId) {
  const c = credits.find(x => String(x.id) === String(creditId));
  if (!c) return alert("Crédit introuvable.");

  const remaining = Number(c.amountDue) || 0;
  if (remaining <= 0) return alert("Crédit déjà réglé.");

  const paid = Number(prompt(`Montant payé (reste ${remaining} FCFA) :`));
  if (!paid || paid <= 0) return alert("Montant invalide.");
  if (paid > remaining) return alert("Le montant payé dépasse le reste.");

  const method = prompt("Méthode (cash/wave/orange) :", "cash") || "cash";
  const note = prompt("Note (optionnel) :", "") || "";

  // 1) paiement (historique)
  const payment = {
    id: Date.now(),
    creditId: String(c.id),
    amount: paid,
    date: new Date().toISOString(),
    method,
    note
  };
  creditPayments.push(payment);
  sendCreditPaymentToSheet(payment);

  // 2) mise à jour du crédit
  c.amountDue = remaining - paid;
  if (c.amountDue <= 0) {
    c.amountDue = 0;
    c.status = "closed";
  } else {
    c.status = "open";
  }
  updateCreditOnSheet(String(c.id), c.amountDue, c.status);

  // 3) ✅ ajouter le paiement dans les ventes du jour
  const sale = {
    id: Date.now(),
    date: new Date().toISOString(),
    baseTotal: paid,
    total: paid,
    items: [{ productId: 0, name: "Règlement crédit", qty: 1, price: paid, lineTotal: paid }],
    paymentMethod: method,
    promoDiscount: 0,
    manualDiscount: 0,
    birthdayDiscount: 0,
    discountAmount: 0,
    discountReason: `Paiement crédit (${c.name || ""}${c.phone ? " - " + c.phone : ""})`,
    clientId: "",
    clientName: c.name || "",
    clientPhone: c.phone || "",
    wholesale: false
  };

  sales.push(sale);
  saveSales(sales);
  sendSaleToSheet(sale);

  // UI refresh
  renderCreditsUI();
  updateSalesViewForSelectedDate();
  loadDashboardStats?.();

  alert(c.status === "closed"
    ? "Crédit totalement réglé ✅ (paiement ajouté aux ventes du jour)"
    : `Paiement enregistré ✅. Reste : ${c.amountDue} FCFA`
  );
}
// --------AFFICHAGE CREDIT --------
function renderCreditsUI() {
  renderCreditsTable();
  renderCreditPaymentsTable();
  renderCreditTotals();
}

function renderCreditTotals() {
  const outstanding = (credits || [])
    .filter(c => (c.status || "open") !== "closed")
    .reduce((sum, c) => sum + (Number(c.amountDue) || 0), 0);

  const paidTotal = (creditPayments || []).reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

  const openCount = (credits || []).filter(c => (c.status || "open") !== "closed").length;

  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };

  set("cr-outstanding", outstanding);
  set("cr-paid", paidTotal);
  set("cr-open-count", openCount);
}

function renderCreditsTable() {
  const tbody = document.getElementById("credits-table-body");
  if (!tbody) return;

  tbody.innerHTML = "";

  if (!credits || credits.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5">Aucune vente à crédit.</td></tr>`;
    renderCreditTotals();
    return;
  }

  const sorted = [...credits].sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));

  sorted.forEach(c => {
    const d = new Date(c.createdAt);
    const dateStr = isNaN(d.getTime()) ? (c.createdAt || "") : d.toLocaleString("fr-FR");
    const due = Number(c.amountDue) || 0;
    const closed = (c.status === "closed");

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${c.name || ""}</td>
      <td>${c.phone || ""}</td>
      <td><strong>${due}</strong> FCFA ${closed ? "<br><small>✅ Réglé</small>" : ""}</td>
      <td>${dateStr}</td>
      <td>
        <button class="primary-btn" onclick="markCreditAsValidated('${c.id}')" ${closed ? "disabled" : ""}>
          Valider
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  renderCreditTotals();
}

function renderCreditPaymentsTable() {
  const tbody = document.getElementById("credit-payments-body");
  if (!tbody) return;

  tbody.innerHTML = "";

  if (!creditPayments || creditPayments.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5">Aucun paiement enregistré.</td></tr>`;
    return;
  }

  const sorted = [...creditPayments].sort((a,b) => new Date(b.date) - new Date(a.date));

  sorted.slice(0, 300).forEach(p => {
    const d = new Date(p.date);
    const dateStr = isNaN(d.getTime()) ? (p.date || "") : d.toLocaleString("fr-FR");

    const c = (credits || []).find(x => String(x.id) === String(p.creditId));
    const clientLabel = c ? `${c.name || ""}${c.phone ? " (" + c.phone + ")" : ""}` : `Crédit ${p.creditId}`;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${dateStr}</td>
      <td>${clientLabel}</td>
      <td><strong>${Number(p.amount) || 0}</strong> FCFA</td>
      <td>${p.method || "cash"}</td>
      <td>${p.note || ""}</td>
    `;
    tbody.appendChild(tr);
  });
}

// -------- PRODUITS (AFFICHAGE CAISSE) --------
function renderProductsForSale() {
  const container = document.getElementById("products-list");
  if (!container) return;
  container.innerHTML = "";

  products.forEach((p) => {
    const promoPrice = getPromoPrice(p.price);
    const div = document.createElement("div");
    div.className = "product-card";
    div.innerHTML = `
      <strong>${p.name}</strong><br>
      Prix : ${promoPrice} FCFA<br>
      Stock : ${p.stock}<br>
      <label>Quantité :
        <input type="number" min="1" value="1" id="qty-${p.id}">
      </label><br>
      <button onclick="addToCart(${p.id})">Ajouter au panier</button>
    `;
    container.appendChild(div);
  });
}

// -------- PANIER --------
function addToCart(productId) {
  const product = products.find((p) => p.id === productId);
  if (!product) {
    alert("Produit introuvable.");
    return;
  }

  const qtyInput = document.getElementById(`qty-${productId}`);
  const qty = parseInt(qtyInput?.value, 10) || 1;
  if (qty <= 0) return;

  const alreadyInCart = cart
    .filter((item) => item.productId === productId)
    .reduce((sum, item) => sum + item.qty, 0);

  if (alreadyInCart + qty > product.stock) {
    alert("Stock insuffisant !");
    return;
  }

  const wholesaleMode = document.getElementById("wholesale-mode")?.checked;

  let unitPrice = getPromoPrice(product.price);
  let wholesale = false;
  
// ✅ Produit "Couture" : prix libre à chaque vente
if (product.name.toLowerCase() === "couture") {
  const customPrice = Number(prompt("Prix Couture (FCFA) :"));
  if (!customPrice || customPrice <= 0) {
    alert("Prix invalide.");
    return;
  }
  unitPrice = customPrice;
}

  if (wholesaleMode) {
    const custom = Number(prompt(`Prix unitaire (gros) pour ${product.name} (FCFA) :`));
    if (!custom || custom <= 0) return;
    unitPrice = custom;
    wholesale = true;
  }

  const existing = cart.find(
    (item) =>
      item.productId === productId &&
      item.price === unitPrice &&
      item.wholesale === wholesale
  );

  if (existing && !wholesale) {
    existing.qty += qty;
  } else {
    cart.push({
      productId: product.id,
      name: product.name,
      basePrice: product.price,
      price: unitPrice,
      qty,
      wholesale
    });
  }

  renderCart();
}

function calculateCartTotals() {
  const wholesaleMode = document.getElementById("wholesale-mode")?.checked;
  const promoPeriodActive = isPromoActiveNow();

  let baseTotal = 0;
  let promo8000Qty = 0;
  let thiourayeQty = 0;

  cart.forEach((item) => {
    baseTotal += item.price * item.qty;

    const isCouture = (item.name || "").toLowerCase() === "couture";

if (!wholesaleMode && !item.wholesale && !isCouture) {
  if (!promoPeriodActive && item.basePrice === 8000) promo8000Qty += item.qty;

  if (
    item.basePrice === 3000 &&
    item.name &&
    item.name.toLowerCase().includes("thiouraye")
  ) {
    thiourayeQty += item.qty;
  }
}
  });

  let promoDiscount = 0;
  if (!wholesaleMode) {
    if (!promoPeriodActive) promoDiscount += Math.floor(promo8000Qty / 2) * 1000;
    promoDiscount += Math.floor(thiourayeQty / 2) * 1000;
  }

  const discountInput = document.getElementById("cart-discount");
  let manualDiscount = 0;

  if (discountInput) {
    if (wholesaleMode) {
      discountInput.disabled = true;
      discountInput.value = "0";
    } else {
      discountInput.disabled = false;
      manualDiscount = Math.max(0, parseInt(discountInput.value, 10) || 0);
    }
  }

  const select = document.getElementById("client-select");
  let birthdayDiscount = 0;
  let isBirthdayClient = false;

  if (!wholesaleMode && select && select.value) {
    const client = clients.find((c) => String(c.id) === String(select.value));
    if (client && isClientBirthdaySoon(client)) {
      isBirthdayClient = true;
      promoDiscount = 0;
      manualDiscount = 0;
      birthdayDiscount = Math.round(baseTotal * 0.3);
    }
  }

  let finalTotal = baseTotal - promoDiscount - manualDiscount - birthdayDiscount;
  if (finalTotal < 0) finalTotal = 0;

  return { baseTotal, promoDiscount, manualDiscount, birthdayDiscount, isBirthdayClient, finalTotal };
}

function renderCart() {
  const container = document.getElementById("cart-list");
  const totalSpan = document.getElementById("cart-total");
  if (!container || !totalSpan) return;

  container.innerHTML = "";

  if (cart.length === 0) {
    container.textContent = "Panier vide.";
    totalSpan.textContent = "0";
    return;
  }

  cart.forEach((item, index) => {
    const labelGros = item.wholesale ? " (gros)" : "";

    const priceField = item.wholesale
      ? `<input type="number" min="0" value="${item.price}"
            onchange="updateCartItemPrice(${index}, this.value)"
            style="width:80px;"> FCFA`
      : `${item.price} FCFA`;

    const lineTotal = item.price * item.qty;

    const div = document.createElement("div");
    div.innerHTML = `
      ${item.name}${labelGros} - ${priceField} × ${item.qty}
      = ${lineTotal} FCFA
      <button class="secondary-btn" onclick="removeCartItem(${index})">X</button>
    `;
    container.appendChild(div);
  });

  const totals = calculateCartTotals();
  totalSpan.textContent = totals.finalTotal;
}

function updateCartItemPrice(index, newPrice) {
  const price = Number(newPrice);
  if (isNaN(price) || price < 0) return;
  if (!cart[index]) return;
  cart[index].price = price;
  renderCart();
}

function removeCartItem(index) {
  cart.splice(index, 1);
  renderCart();
}

function clearCart() {
  cart = [];
  const discountInput = document.getElementById("cart-discount");
  const discountReasonInput = document.getElementById("cart-discount-reason");
  if (discountInput) {
    discountInput.disabled = false;
    discountInput.value = "0";
  }
  if (discountReasonInput) discountReasonInput.value = "";
  renderCart();
}

// ================== CLIENTS EN CAISSE ==================
function renderClientSelect() {
  const select = document.getElementById("client-select");
  if (!select) return;

  const current = select.value;
  select.innerHTML = "";

  const optNone = document.createElement("option");
  optNone.value = "";
  optNone.textContent = "Sans compte client";
  select.appendChild(optNone);

  clients.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = String(c.id);
    opt.textContent = `${c.name}${c.phone ? " (" + c.phone + ")" : ""}`;
    select.appendChild(opt);
  });

  if (current && clients.some((c) => String(c.id) === String(current))) {
    select.value = current;
  }
}

function openAddClientModal() {
  const name = prompt("Nom du client :");
  if (!name || !name.trim()) return;

  const phone = prompt("Téléphone du client (optionnel) :") || "";
  const birthdateInput =
    prompt("Date de naissance (optionnel, format AAAA-MM-JJ, ex : 1995-08-21) :") ||
    "";

  let birthdate = "";
  if (birthdateInput.trim()) {
    const d = new Date(birthdateInput.trim());
    if (!isNaN(d.getTime())) birthdate = d.toISOString().slice(0, 10);
  }

  const newClient = {
    id: Date.now(),
    name: name.trim(),
    phone: phone.trim(),
    createdAt: new Date().toISOString(),
    birthdate
  };

  clients.push(newClient);
  saveClients(clients);
  sendClientToSheet(newClient);

  renderClientSelect();
  renderClientsTable();
  alert("Client ajouté.");
}

// ================== CONFIRMATION VENTE ==================
function confirmSale() {
  if (cart.length === 0) {
    alert("Panier vide !");
    return;
  }

  const isCreditSale = document.getElementById("credit-mode")?.checked === true;

  // ✅ CORRECTION : on vérifie les infos crédit AVANT de retirer le stock.
  // Avant, le stock était déjà retiré puis la vente bloquée → si on recliquait,
  // le stock était retiré 2 fois.
  if (isCreditSale && !pendingCreditClient) {
    alert("Infos client crédit manquantes. Décoche puis recoche « Vente à crédit ».");
    return;
  }

  // Vérif stock
  for (const item of cart) {
    const product = products.find((p) => p.id === item.productId);
    if (!product) return alert("Produit introuvable.");
    if (item.qty > product.stock) return alert(`Stock insuffisant pour ${product.name}`);
  }

  // Déstockage
  cart.forEach((item) => {
    const product = products.find((p) => p.id === item.productId);
    if (product) product.stock = Math.max(0, product.stock - item.qty);
  });

  saveProducts(products);
  sendStockToSheet(products);

  const totals = calculateCartTotals();

  // ✅ VENTE À CRÉDIT
  if (isCreditSale) {
    if (!pendingCreditClient) {
      alert("Infos client crédit manquantes.");
      return;
    }

    const credit = {
      id: Date.now(),
      name: pendingCreditClient.name,
      phone: pendingCreditClient.phone,
      originalAmount: totals.finalTotal,
      amountDue: totals.finalTotal,
      createdAt: new Date().toISOString(),
      items: cart.map(i => ({ name: i.name, qty: i.qty, price: i.price })),
      status: "open"
    };

    credits.push(credit);
    sendCreditToSheet(credit);
    renderCreditsUI();

    clearCart();
    renderProductsForSale();

    pendingCreditClient = null;
    const cb = document.getElementById("credit-mode");
    if (cb) cb.checked = false;

    alert("Vente enregistrée en CRÉDIT.");
    return; // stop ici
  }

  // ✅ VENTE NORMALE (ton code existant)
  const methodSelect = document.getElementById("payment-method");
  const paymentMethod = methodSelect ? methodSelect.value : "cash";
  const wholesaleMode = document.getElementById("wholesale-mode")?.checked;

  const select = document.getElementById("client-select");
  let clientId = "";
  let clientName = "";
  let clientPhone = "";

  if (select && select.value && !wholesaleMode) {
    clientId = select.value;
    const client = clients.find((c) => String(c.id) === String(clientId));
    if (client) {
      clientName = client.name;
      clientPhone = client.phone || "";
    }
  }

  const discountReasonInput = document.getElementById("cart-discount-reason");
  const userReason = discountReasonInput ? discountReasonInput.value.trim() : "";

  let promoDiscount = totals.promoDiscount || 0;
  let manualDiscount = totals.manualDiscount || 0;
  let birthdayDiscount = totals.birthdayDiscount || 0;

  if (wholesaleMode) {
    promoDiscount = 0;
    manualDiscount = 0;
    birthdayDiscount = 0;
  }

  let fullDiscountReason = userReason;
  if (birthdayDiscount > 0) {
    if (fullDiscountReason) fullDiscountReason += " + ";
    fullDiscountReason += "remise anniversaire -30%";
  } else if (promoDiscount > 0) {
    if (fullDiscountReason) fullDiscountReason += " + ";
    fullDiscountReason += "promo catalogue";
  }

  const baseTotal = totals.baseTotal;
  const totalDiscount = promoDiscount + manualDiscount + birthdayDiscount;
  const finalTotal = Math.max(0, baseTotal - totalDiscount);

  const sale = {
    id: Date.now(),
    date: new Date().toISOString(),
    baseTotal,
    total: finalTotal,
    items: cart.map((item) => ({
      productId: item.productId,
      name: item.name || "",
      qty: item.qty,
      price: item.price || 0,
      lineTotal: (item.price || 0) * item.qty
    })),
    paymentMethod,
    promoDiscount,
    manualDiscount,
    birthdayDiscount,
    discountAmount: totalDiscount,
    discountReason: fullDiscountReason,
    clientId,
    clientName,
    clientPhone,
    wholesale: !!wholesaleMode
  };

  sales.push(sale);
  saveSales(sales);
  sendSaleToSheet(sale);

  lastTicketSale = sale;

  clearCart();
  renderProductsForSale();
  updateSalesViewForSelectedDate();
  loadDashboardStats?.();

  alert("Vente enregistrée !");
}
// ================== TICKET DE CAISSE ==================
function openReceiptWindow(sale) {
  const boutiqueName = "BSK";
  const dateStr = new Date(sale.date).toLocaleString("fr-FR");

  let rowsHtml = "";
  (sale.items || []).forEach((item) => {
    const name = item.name || "Produit";
    const unitPrice = Number(item.price) || 0;
    const qty = Number(item.qty) || 0;
    const lineTotal = unitPrice * qty;

    rowsHtml += `
      <tr>
        <td>${name}</td>
        <td style="text-align:center;">${qty}</td>
        <td style="text-align:right;">${unitPrice} FCFA</td>
        <td style="text-align:right;">${lineTotal} FCFA</td>
      </tr>
    `;
  });

  const baseTotal = sale.baseTotal || sale.total;
  const promoDiscount = sale.promoDiscount || 0;
  const manualDiscount = sale.manualDiscount || 0;
  const birthdayDiscount = sale.birthdayDiscount || 0;
  const discountReason = sale.discountReason || "";

  let discountRowsHtml = `
    <tr class="discount-row">
      <td colspan="3" style="text-align:right;">Sous-total :</td>
      <td style="text-align:right;">${baseTotal} FCFA</td>
    </tr>
  `;

  const addDiscRow = (label, amount) => {
    discountRowsHtml += `
      <tr class="discount-row">
        <td colspan="3" style="text-align:right;">${label} :</td>
        <td style="text-align:right;">- ${amount} FCFA</td>
      </tr>
    `;
  };

  if (promoDiscount > 0) addDiscRow("Remise promo", promoDiscount);
  if (manualDiscount > 0) addDiscRow("Remise", manualDiscount);
  if (birthdayDiscount > 0) addDiscRow("Remise anniversaire", birthdayDiscount);

  if (discountReason) {
    discountRowsHtml += `
      <tr class="discount-row">
        <td colspan="4" style="text-align:left;">Raison : ${discountReason}</td>
      </tr>
    `;
  }

  const receiptHtml = `
    <!DOCTYPE html>
    <html lang="fr">
    <head>
      <meta charset="UTF-8">
      <title>Ticket de caisse - ${boutiqueName}</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 13px; margin: 10px; color: #111827; }
        .ticket-container { max-width: 320px; margin: 0 auto; }
        .ticket-logo { text-align: center; margin-bottom: 4px; }
        .ticket-logo img { width: 60px; height: 60px; object-fit: cover; border-radius: 14px; border: 1px solid #e5e7eb; }
        h1 { font-size: 18px; text-align: center; margin: 4px 0 2px; }
        .subtitle { text-align: center; font-size: 11px; color: #6b7280; margin-bottom: 8px; }
        .line { border-top: 1px dashed #9ca3af; margin: 6px 0; }
        table { border-collapse: collapse; width: 100%; }
        th, td { padding: 3px 0; }
        th { border-bottom: 1px solid #e5e7eb; font-size: 12px; text-align: left; }
        .total-row td { border-top: 1px solid #e5e7eb; padding-top: 6px; font-weight: 600; }
        .discount-row td { font-size: 12px; color: #6b7280; }
        .footer { margin-top: 12px; text-align: center; font-size: 12px; color: #374151; line-height: 1.4; }
        .print-btn { margin-top: 10px; padding: 6px 10px; font-size: 12px; }
        .qr { margin-top: 6px; width: 120px; height: 120px; }
      </style>
    </head>
    <body>
      <div class="ticket-container">
        <div class="ticket-logo">
          <img src="logo.png" alt="Logo BSK" onerror="this.style.display='none'">
        </div>
        <h1>${boutiqueName}</h1>
        <div class="subtitle">${dateStr}</div>
        <div class="line"></div>

        <table>
          <thead>
            <tr>
              <th>Produit</th>
              <th style="text-align:center;">Qté</th>
              <th style="text-align:right;">Prix</th>
              <th style="text-align:right;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
            ${discountRowsHtml}
            <tr class="total-row">
              <td colspan="3" style="text-align:right;">Total à payer :</td>
              <td style="text-align:right;">${sale.total} FCFA</td>
            </tr>
          </tbody>
        </table>

        <div class="footer">
          Merci pour votre achat 💛<br><br>
          <strong>BSK</strong><br>
          Grand Dakar – Garage Casamance<br>
          Téléphone : 77 876 92 01<br>
          Horaires : 12h à 23h (Lundi → Samedi)<br><br>
          <span>Scannez pour nous écrire sur WhatsApp :</span><br>
          <img class="qr"
            src="https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=https://wa.me/221778769201"
            alt="QR WhatsApp BSK">
        </div>

        <button class="print-btn" onclick="window.print()">Imprimer</button>
      </div>
    </body>
    </html>
  `;

  const win = window.open("", "_blank", "width=400,height=600");
  if (!win) {
    alert("Autorisez les pop-up pour voir le ticket.");
    return;
  }
  win.document.open();
  win.document.write(receiptHtml);
  win.document.close();
}

function printTicket() {
  let saleToPrint = lastTicketSale || (Array.isArray(sales) && sales.length ? sales[sales.length - 1] : null);
  if (!saleToPrint) {
    alert("Aucune vente à imprimer.");
    return;
  }
  openReceiptWindow(saleToPrint);
}

// ================== PRODUITS & STOCK ==================
function renderProductsTable() {
  const tbody = document.getElementById("products-table-body");
  if (!tbody) return;

  tbody.innerHTML = "";

  if (!Array.isArray(products) || products.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="5">Aucun produit.</td>`;
    tbody.appendChild(tr);
    return;
  }

  products.forEach((p) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${p.name}</td>
      <td>${p.price || 0} FCFA</td>
      <td>${p.stock || 0}</td>
      <td>
        <input type="number" id="stock-input-${p.id}" value="${p.stock || 0}" min="0" />
      </td>
      <td>
        <button onclick="updateProductStock(${p.id})">Mettre à jour</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function updateProductStock(productId) {
  const product = products.find((p) => p.id === productId);
  if (!product) {
    alert("Produit introuvable.");
    return;
  }

  const input = document.getElementById(`stock-input-${productId}`);
  if (!input) return;

  const newStock = parseInt(input.value, 10);
  if (isNaN(newStock) || newStock < 0) {
    alert("Stock invalide.");
    input.value = product.stock || 0;
    return;
  }

  const oldStock = product.stock || 0;
  if (newStock === oldStock) {
    alert("Le stock n'a pas changé.");
    return;
  }

  const reason = prompt("Motif de modification du stock :");
  if (!reason || !reason.trim()) {
    alert("Le motif est obligatoire.");
    input.value = oldStock;
    return;
  }

  product.stock = newStock;
  saveProducts(products);
  renderProductsTable();
  sendStockToSheetWithFallback(products);

  const change = {
    date: new Date().toISOString(),
    productId: product.id,
    productName: product.name,
    oldStock,
    newStock,
    delta: newStock - oldStock,
    reason: reason.trim()
  };

  logStockChangeToSheet(change);

  if (!Array.isArray(stockHistory)) stockHistory = [];
  stockHistory.push(change);
  renderStockHistoryTable();
}

function sendStockToSheetWithFallback(productsList) {
  if (typeof sendStockToSheet === "function") {
    sendStockToSheet(productsList);
    return;
  }
  const payload = JSON.stringify({ products: productsList });
  const url = `${SHEET_URL}?action=updateStock&payload=${encodeURIComponent(payload)}`;
  fetch(url)
    .then((r) => r.text())
    .then((txt) => console.log("updateStock ->", txt))
    .catch((err) => console.error("updateStock error:", err));
}

function logStockChangeToSheet(change) {
  const payload = JSON.stringify({ change });
  const url = `${SHEET_URL}?action=logStockChange&payload=${encodeURIComponent(payload)}`;
  fetch(url)
    .then((r) => r.text())
    .then((txt) => console.log("logStockChange ->", txt))
    .catch((err) => console.error("logStockChange error:", err));
}

function fetchStockHistoryFromSheet() {
  const callbackName = "onStockHistory_" + Date.now();
  const script = document.createElement("script");

  window[callbackName] = function (data) {
    try {
      if (data && Array.isArray(data.history)) {
        stockHistory = data.history.map((h) => {
          const oldStock = Number(h.oldStock) || 0;
          const newStock = Number(h.newStock) || 0;
          const delta =
            typeof h.delta !== "undefined" ? Number(h.delta) || 0 : newStock - oldStock;

          return {
            date: h.date,
            productId: h.productId,
            productName: h.productName,
            oldStock,
            newStock,
            delta,
            reason: h.reason || ""
          };
        });
      } else {
        stockHistory = [];
      }
      renderStockHistoryTable();
    } finally {
      delete window[callbackName];
      script.remove();
    }
  };

  script.src = `${SHEET_URL}?action=getStockHistory&callback=${callbackName}`;
  script.onerror = function () {
    console.warn("Erreur chargement historique de stock.");
  };

  document.body.appendChild(script);
}

function renderStockHistoryTable() {
  const tbody = document.getElementById("stock-history-body");
  if (!tbody) return;

  tbody.innerHTML = "";

  if (!Array.isArray(stockHistory) || stockHistory.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="6">Aucun mouvement de stock enregistré.</td>`;
    tbody.appendChild(tr);
    return;
  }

  const startInput = document.getElementById("stock-history-start");
  const endInput = document.getElementById("stock-history-end");

  let start = null;
  let end = null;

  if (startInput && startInput.value) start = new Date(startInput.value + "T00:00:00");
  if (endInput && endInput.value) end = new Date(endInput.value + "T23:59:59");

  const sorted = [...stockHistory].sort((a, b) => new Date(b.date) - new Date(a.date));

  const filtered = sorted
    .filter((entry) => {
      const d = new Date(entry.date);
      if (isNaN(d.getTime())) return !(start || end);
      if (start && d < start) return false;
      if (end && d > end) return false;
      return true;
    })
    .slice(0, 300);

  if (filtered.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="6">Aucun mouvement pour cette période.</td>`;
    tbody.appendChild(tr);
    return;
  }

  filtered.forEach((entry) => {
    const d = new Date(entry.date);
    const dateStr = isNaN(d.getTime()) ? entry.date : d.toLocaleString("fr-FR");
    const deltaSign = entry.delta > 0 ? "+" : "";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${dateStr}</td>
      <td>${entry.productName || ""}</td>
      <td>${entry.oldStock}</td>
      <td>${entry.newStock}</td>
      <td>${deltaSign}${entry.delta}</td>
      <td>${entry.reason || ""}</td>
    `;
    tbody.appendChild(tr);
  });
}

function setStockHistoryRangeToday() {
  const startInput = document.getElementById("stock-history-start");
  const endInput = document.getElementById("stock-history-end");
  if (!startInput || !endInput) return;

  const iso = new Date().toISOString().slice(0, 10);
  startInput.value = iso;
  endInput.value = iso;
  renderStockHistoryTable();
}

function setStockHistoryRangeWeek() {
  const startInput = document.getElementById("stock-history-start");
  const endInput = document.getElementById("stock-history-end");
  if (!startInput || !endInput) return;

  const today = new Date();
  const day = today.getDay();
  const diffToMonday = (day + 6) % 7;
  const monday = new Date(today);
  monday.setDate(today.getDate() - diffToMonday);

  startInput.value = monday.toISOString().slice(0, 10);
  endInput.value = today.toISOString().slice(0, 10);
  renderStockHistoryTable();
}

function setStockHistoryRangeMonth() {
  const startInput = document.getElementById("stock-history-start");
  const endInput = document.getElementById("stock-history-end");
  if (!startInput || !endInput) return;

  const today = new Date();
  const first = new Date(today.getFullYear(), today.getMonth(), 1);

  startInput.value = first.toISOString().slice(0, 10);
  endInput.value = today.toISOString().slice(0, 10);
  renderStockHistoryTable();
}

function setStockHistoryRangeYear() {
  const startInput = document.getElementById("stock-history-start");
  const endInput = document.getElementById("stock-history-end");
  if (!startInput || !endInput) return;

  const today = new Date();
  const first = new Date(today.getFullYear(), 0, 1);

  startInput.value = first.toISOString().slice(0, 10);
  endInput.value = today.toISOString().slice(0, 10);
  renderStockHistoryTable();
}

// ================== FRAIS ==================
function addExpense() {
  const labelInput = document.getElementById("expense-label");
  const amountInput = document.getElementById("expense-amount");
  if (!labelInput || !amountInput) return;

  const label = (labelInput.value || "").trim();
  const amount = Number(amountInput.value) || 0;

  if (!label) return alert("Merci de renseigner le motif de la dépense.");
  if (amount <= 0) return alert("Merci de renseigner un montant valide.");

  const expense = {
    id: Date.now(),
    date: new Date().toISOString(),
    label,
    amount
  };

  if (!Array.isArray(expenses)) expenses = [];
  expenses.push(expense);

  saveExpenses(expenses);
  sendExpenseToSheet(expense);

  labelInput.value = "";
  amountInput.value = "";

  renderExpensesTable();
  alert("Dépense enregistrée.");
}

function saveExpenses(list) {
  try {
    localStorage.setItem("bsk_expenses", JSON.stringify(list || []));
  } catch (e) {
    console.warn("Impossible de sauvegarder les frais en local", e);
  }
}
function loadExpensesFromLocal() {
  try {
    const raw = localStorage.getItem("bsk_expenses");
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}
function sendExpenseToSheet(expense) {
  const payload = JSON.stringify({ expense });
  const url = `${SHEET_URL}?action=addExpense&payload=${encodeURIComponent(payload)}`;
  fetch(url)
    .then((r) => r.text())
    .then((txt) => console.log("addExpense ->", txt))
    .catch((err) => console.error("addExpense error:", err));
}
function fetchExpensesFromSheet() {
  const callbackName = "onExpensesFromSheet_" + Date.now();
  const script = document.createElement("script");

  window[callbackName] = function (data) {
    try {
      if (data && Array.isArray(data.expenses)) {
        expenses = data.expenses.map((e) => ({
          id: e.id || Date.now(),
          date: e.date,
          label: e.label || "",
          amount: Number(e.amount) || 0
        }));
        saveExpenses(expenses);
      } else {
        expenses = loadExpensesFromLocal();
      }
      renderExpensesTable();
      refreshProIfVisible();
    } finally {
      delete window[callbackName];
      script.remove();
    }
  };

  script.src = `${SHEET_URL}?action=getExpenses&callback=${callbackName}`;
  script.onerror = function () {
    console.warn("Erreur chargement frais depuis Google Sheets.");
    expenses = loadExpensesFromLocal();
    renderExpensesTable();
  };

  document.body.appendChild(script);
}

function renderExpensesTable() {
  const tbody = document.getElementById("expense-history-body");
  if (!tbody) return;

  tbody.innerHTML = "";

  if (!Array.isArray(expenses) || expenses.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="3">Aucune dépense enregistrée.</td>`;
    tbody.appendChild(tr);
    return;
  }

  const startInput = document.getElementById("expense-history-start");
  const endInput = document.getElementById("expense-history-end");

  let start = null;
  let end = null;

  if (startInput && startInput.value) start = new Date(startInput.value + "T00:00:00");
  if (endInput && endInput.value) end = new Date(endInput.value + "T23:59:59");

  const sorted = [...expenses].sort((a, b) => new Date(b.date) - new Date(a.date));
  const filtered = sorted
    .filter((entry) => {
      const d = new Date(entry.date);
      if (isNaN(d.getTime())) return !(start || end);
      if (start && d < start) return false;
      if (end && d > end) return false;
      return true;
    })
    .slice(0, 300);

  if (filtered.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="3">Aucune dépense pour cette période.</td>`;
    tbody.appendChild(tr);
    return;
  }

  filtered.forEach((e) => {
    const d = new Date(e.date);
    const dateStr = isNaN(d.getTime()) ? e.date : d.toLocaleString("fr-FR");
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${dateStr}</td>
      <td>${e.label}</td>
      <td>${e.amount} FCFA</td>
    `;
    tbody.appendChild(tr);
  });
}

function setExpenseHistoryRangeToday() {
  const startInput = document.getElementById("expense-history-start");
  const endInput = document.getElementById("expense-history-end");
  if (!startInput || !endInput) return;

  const iso = new Date().toISOString().slice(0, 10);
  startInput.value = iso;
  endInput.value = iso;
  renderExpensesTable();
}
function setExpenseHistoryRangeWeek() {
  const startInput = document.getElementById("expense-history-start");
  const endInput = document.getElementById("expense-history-end");
  if (!startInput || !endInput) return;

  const today = new Date();
  const day = today.getDay();
  const diffToMonday = (day + 6) % 7;
  const monday = new Date(today);
  monday.setDate(today.getDate() - diffToMonday);

  startInput.value = monday.toISOString().slice(0, 10);
  endInput.value = today.toISOString().slice(0, 10);
  renderExpensesTable();
}
function setExpenseHistoryRangeMonth() {
  const startInput = document.getElementById("expense-history-start");
  const endInput = document.getElementById("expense-history-end");
  if (!startInput || !endInput) return;

  const today = new Date();
  const first = new Date(today.getFullYear(), today.getMonth(), 1);

  startInput.value = first.toISOString().slice(0, 10);
  endInput.value = today.toISOString().slice(0, 10);
  renderExpensesTable();
}
function setExpenseHistoryRangeYear() {
  const startInput = document.getElementById("expense-history-start");
  const endInput = document.getElementById("expense-history-end");
  if (!startInput || !endInput) return;

  const today = new Date();
  const first = new Date(today.getFullYear(), 0, 1);

  startInput.value = first.toISOString().slice(0, 10);
  endInput.value = today.toISOString().slice(0, 10);
  renderExpensesTable();
}

// ================== CLIENTS (ONGLET CLIENTS) ==================
function computeClientTotal(clientId) {
  let sum = 0;
  (sales || []).forEach((s) => {
    if (String(s.clientId) === String(clientId)) sum += Number(s.total) || 0;
  });
  return sum;
}

function renderClientsTable() {
  const tbody = document.getElementById("clients-table-body");
  if (!tbody) return;

  const searchInput = document.getElementById("client-search");
  const term = searchInput ? searchInput.value.trim().toLowerCase() : "";

  tbody.innerHTML = "";

  const list = (clients || []).filter(
    (c) =>
      (c.name || "").toLowerCase().includes(term) ||
      (c.phone || "").toLowerCase().includes(term)
  );

  if (list.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="5">Aucun client trouvé.</td>`;
    tbody.appendChild(tr);
    renderBirthdaySection();
    return;
  }

  list.forEach((c) => {
    const totalSpent = computeClientTotal(c.id);
    const soon = isClientBirthdaySoon(c);

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${c.name}${soon ? " 🎂" : ""}</td>
      <td>${c.phone || ""}</td>
      <td>${formatBirthdateShort(c.birthdate)}</td>
      <td>${totalSpent} FCFA</td>
      <td>
        <button class="secondary-btn" onclick="openClientPopup('${c.id}')">Détails</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  renderBirthdaySection();
}

function renderBirthdaySection() {
  const container = document.getElementById("birthday-list");
  if (!container) return;

  const birthdayClients = (clients || []).filter((c) => isClientBirthdaySoon(c));

  if (birthdayClients.length === 0) {
    container.innerHTML = `<p>Aucun anniversaire dans les 72 prochaines heures.</p>`;
    return;
  }

  container.innerHTML = "";
  birthdayClients.forEach((c) => {
    const div = document.createElement("div");
    div.className = "birthday-card";
    div.innerHTML = `
      <strong>${c.name}</strong>${c.phone ? " (" + c.phone + ")" : ""}<br>
      Anniversaire : ${formatBirthdateShort(c.birthdate)}<br>
      <button onclick="sendBirthdayMessage('${c.id}')">Envoyer un message</button>
    `;
    container.appendChild(div);
  });
}

function sendBirthdayMessage(clientId) {
  const c = (clients || []).find((cl) => String(cl.id) === String(clientId));
  if (!c) return alert("Client introuvable.");

  const baseMessage =
    `Bonjour ${c.name} 🎉\n\n` +
    `Toute l'équipe BSK te souhaite un très joyeux anniversaire ! 🥳\n` +
    `Pour l'occasion, tu bénéficies d'une remise exceptionnelle de -30% sur toute la boutique, ` +
    `valable 72h à partir d'aujourd'hui.\n\n` +
    `À très vite chez BSK 💛`;

  if (c.phone) {
    const phoneClean = c.phone.replace(/[^0-9]/g, "");
    const url = `https://wa.me/${phoneClean}?text=${encodeURIComponent(baseMessage)}`;
    window.open(url, "_blank");
  } else {
    alert("Message à envoyer :\n\n" + baseMessage);
  }
}

// ✅ Popup client sécurisée (ne casse plus ton JS si le HTML manque un id)
function openClientPopup(clientId) {
  const modal = document.getElementById("popup-client");
  const nameEl = document.getElementById("popup-client-name");
  const phoneEl = document.getElementById("popup-client-phone");
  const historyDiv = document.getElementById("popup-client-history");

  if (!modal || !nameEl || !phoneEl || !historyDiv) {
    console.error("Popup client manquante dans le HTML (ids requis).");
    alert("Erreur: la fenêtre client n'existe pas (vérifie le HTML: popup-client...).");
    return;
  }

  const c = (clients || []).find((x) => String(x.id) === String(clientId));
  if (!c) return;

  nameEl.textContent = c.name || "";
  phoneEl.textContent = c.phone || "—";
  historyDiv.innerHTML = "";

  const historySales = (sales || [])
    .filter((s) => String(s.clientId) === String(clientId))
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  if (historySales.length === 0) {
    historyDiv.textContent = "Aucun achat pour ce client.";
  } else {
    historySales.forEach((s) => {
      const div = document.createElement("div");
      div.style.marginBottom = "10px";
      const dateStr = new Date(s.date).toLocaleString("fr-FR");

      div.innerHTML = `
        <div><strong>${dateStr}</strong></div>
        <div>Montant : ${Number(s.total) || 0} FCFA</div>
        <div>Paiement : ${s.paymentMethod || "-"}</div>
        ${
          (Number(s.discountAmount) || 0) > 0
            ? `<div>Remise : -${Number(s.discountAmount)} FCFA (${s.discountReason || "—"})</div>`
            : ""
        }
        <div>Produits :</div>
        <ul>${(s.items || []).map((i) => `<li>${i.name} × ${i.qty}</li>`).join("")}</ul>
        <hr>
      `;
      historyDiv.appendChild(div);
    });
  }

  modal.classList.remove("hidden");
}

function closeClientPopup() {
  const modal = document.getElementById("popup-client");
  if (modal) modal.classList.add("hidden");
}

// ================== VENTES : AFFICHAGE JOURNALIER ==================
function initSalesDate() {
  const input = document.getElementById("sales-date");
  if (!input) return;
  if (!input.value) input.value = new Date().toISOString().slice(0, 10);
}

function updateSalesViewForSelectedDate() {
  const tbody = document.getElementById("sales-table-body");
  const dateInput = document.getElementById("sales-date");
  if (!tbody || !dateInput) return;

  if (!dateInput.value) dateInput.value = new Date().toISOString().slice(0, 10);
  const dayStr = dateInput.value;

  tbody.innerHTML = "";

  const daySales = (sales || []).filter((s) => String(s.date || "").slice(0, 10) === dayStr);

  if (daySales.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="5">Aucune vente pour ce jour.</td>`;
    tbody.appendChild(tr);
    return;
  }

  daySales.forEach((sale) => {
    const tr = document.createElement("tr");

    const d = new Date(sale.date);
    const timeStr = isNaN(d.getTime())
      ? ""
      : d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

    let productsHtml = "";
    if (Array.isArray(sale.items) && sale.items.length > 0) {
      productsHtml = sale.items
        .map((item) => {
          const name = item.name || "Produit";
          const qty = item.qty || 0;
          const unitPrice = item.price != null ? item.price : 0;
          return `${name} x ${qty} (${unitPrice} FCFA)`;
        })
        .join("<br>");
    }

    const amount = sale.total || 0;

    let pm = sale.paymentMethod || "cash";
    if (pm === "cash") pm = "Espèces";
    else if (pm === "orange") pm = "Orange Money";
    else if (pm === "wave") pm = "Wave";

    let clientLabel = "—";
    if (sale.clientName) {
      clientLabel = sale.clientName;
      if (sale.clientPhone) clientLabel += " (" + sale.clientPhone + ")";
    } else if (sale.clientPhone) {
      clientLabel = sale.clientPhone;
    }

    tr.innerHTML = `
      <td>${timeStr}</td>
      <td>${productsHtml}</td>
      <td>${amount} FCFA</td>
      <td>${pm}</td>
      <td>
        ${clientLabel}<br>
        <!-- ✅ IMPORTANT: id en string -->
        <button class="danger-btn" onclick="deleteSale('${sale.id}')">Supprimer</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// ================== VENTES : SUPPRESSION (CORRIGÉE) ==================
function deleteSale(saleId) {
  if (!confirm("Supprimer définitivement cette vente ?")) return;

  const before = (sales || []).length;
  sales = (sales || []).filter((s) => String(s.id) !== String(saleId));

  if (sales.length === before) {
    alert("Vente introuvable (local).");
  }

  saveSales(sales);
  updateSalesViewForSelectedDate();
  renderClientsTable();
  loadDashboardStats?.();

  // ✅ suppression côté Sheets (si ton Apps Script supporte action=deleteSale)
  const url = `${SHEET_URL}?action=deleteSale&id=${encodeURIComponent(saleId)}`;
  fetch(url)
    .then((r) => r.text())
    .then((txt) => {
      console.log("Suppression vente Sheets :", txt);
      // ✅ recharge pour être sûr
      fetchSalesFromSheet();
    })
    .catch((err) => {
      console.error("Erreur suppression vente Sheets :", err);
      alert("Supprimée localement, mais erreur côté Sheets.");
    });
}

// ================== DASHBOARD ==================
function initDashboardDates() {
  const startInput = document.getElementById("dashboard-start");
  const endInput = document.getElementById("dashboard-end");
  if (!startInput || !endInput) return;

  if (!startInput.value || !endInput.value) {
    const today = new Date().toISOString().slice(0, 10);
    startInput.value = today;
    endInput.value = today;
  }
}

function setDashboardRangeToday() {
  const startInput = document.getElementById("dashboard-start");
  const endInput = document.getElementById("dashboard-end");
  if (!startInput || !endInput) return;

  const today = new Date().toISOString().slice(0, 10);
  startInput.value = today;
  endInput.value = today;
  loadDashboardStats();
}

function setDashboardRangeWeek() {
  const startInput = document.getElementById("dashboard-start");
  const endInput = document.getElementById("dashboard-end");
  if (!startInput || !endInput) return;

  const now = new Date();
  const dayOfWeek = now.getDay() || 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - dayOfWeek + 1);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  startInput.value = monday.toISOString().slice(0, 10);
  endInput.value = sunday.toISOString().slice(0, 10);
  loadDashboardStats();
}

function setDashboardRangeMonth() {
  const startInput = document.getElementById("dashboard-start");
  const endInput = document.getElementById("dashboard-end");
  if (!startInput || !endInput) return;

  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  startInput.value = first.toISOString().slice(0, 10);
  endInput.value = last.toISOString().slice(0, 10);
  loadDashboardStats();
}

function setDashboardRangeYear() {
  const startInput = document.getElementById("dashboard-start");
  const endInput = document.getElementById("dashboard-end");
  if (!startInput || !endInput) return;

  const now = new Date();
  const first = new Date(now.getFullYear(), 0, 1);
  const last = new Date(now.getFullYear(), 11, 31);

  startInput.value = first.toISOString().slice(0, 10);
  endInput.value = last.toISOString().slice(0, 10);
  loadDashboardStats();
}

function loadDashboardStats() {
  const startEl = document.getElementById("dashboard-start");
  const endEl = document.getElementById("dashboard-end");
  if (!startEl || !endEl) {
    console.error("Dashboard inputs manquants (dashboard-start / dashboard-end).");
    return;
  }

  const startStr = startEl.value;
  const endStr = endEl.value;
  if (!startStr || !endStr) return;

  const start = new Date(startStr + "T00:00:00");
  const end = new Date(endStr + "T23:59:59");

  let total = 0;
  let count = 0;
  let discount = 0;
  let cash = 0;
  let orange = 0;
  let wave = 0;

  const perDay = {};

  (sales || []).forEach((s) => {
    const d = new Date(s.date);
    if (isNaN(d.getTime())) return;
    if (d < start || d > end) return;

    const amount = Number(s.total) || 0;
    total += amount;
    count += 1;
    discount += Number(s.discountAmount) || 0;

    if (s.paymentMethod === "orange") orange += amount;
    else if (s.paymentMethod === "wave") wave += amount;
    else cash += amount;

    const dayKey = String(s.date).slice(0, 10);
    if (!perDay[dayKey]) perDay[dayKey] = { total: 0, count: 0 };
    perDay[dayKey].total += amount;
    perDay[dayKey].count += 1;
  });

  const avg = count > 0 ? Math.round(total / count) : 0;

  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };

  setText("db-total", total);
  setText("db-count", count);
  setText("db-average", avg);
  setText("db-discount", discount);
  setText("db-cash", cash);
  setText("db-orange", orange);
  setText("db-wave", wave);

  renderDashboardChart(perDay);
}

function renderDashboardChart(perDay) {
  const canvas = document.getElementById("dashboard-chart");
  if (!canvas) {
    console.error("Canvas dashboard-chart introuvable.");
    return;
  }
  if (typeof Chart === "undefined") {
    console.error("Chart.js n'est pas chargé (Chart undefined).");
    return;
  }

  const labels = Object.keys(perDay).sort();
  const caData = labels.map((d) => perDay[d].total);
  const countData = labels.map((d) => perDay[d].count);

  if (dashboardChart) dashboardChart.destroy();

  dashboardChart = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "CA (FCFA)", data: caData, yAxisID: "y1", tension: 0.2 },
        { label: "Nombre de ventes", data: countData, yAxisID: "y2", tension: 0.2 }
      ]
    },
    options: {
      responsive: true,
      interaction: { mode: "index", intersect: false },
      scales: {
        y1: { type: "linear", position: "left" },
        y2: { type: "linear", position: "right", grid: { drawOnChartArea: false } }
      }
    }
  });
}

// ================== BAR À PARFUM (AFFICHAGE) ==================
function renderPerfumeBar() {
  const tbody = document.getElementById("perfume-table-body");
  if (!tbody) return;
  tbody.innerHTML = "";

  perfumes.forEach((p, index) => {
    const tr = document.createElement("tr");
    const cfg = PERFUME_LEVELS[p.level] || PERFUME_LEVELS.full;
    tr.className = cfg.className;

    const optionsHtml = Object.entries(PERFUME_LEVELS)
      .map(([key, conf]) => {
        const selected = key === p.level ? "selected" : "";
        return `<option value="${key}" ${selected}>${conf.label}</option>`;
      })
      .join("");

    tr.innerHTML = `
      <td>${p.name}</td>
      <td>
        <select onchange="changePerfumeLevel(${index}, this.value)">
          ${optionsHtml}
        </select>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function changePerfumeLevel(index, newLevel) {
  if (!perfumes[index]) return;
  perfumes[index].level = newLevel;
  renderPerfumeBar();
  sendPerfumesToSheet();
}

// ================== RAPPORT JOURNALIER (PDF) - CORRIGÉ ==================

// Retourne la date sélectionnée dans l’onglet Ventes, ou aujourd’hui par défaut
function getSelectedSalesDate() {
  const input = document.getElementById("sales-date");
  const today = new Date().toISOString().slice(0, 10);
  if (!input) return today;
  if (!input.value) input.value = today;
  return input.value;
}

function getSalesForDate(dateStr) {
  return (sales || []).filter(s => String(s.date || "").slice(0, 10) === dateStr);
}

function getExpensesForDate(dateStr) {
  return (expenses || []).filter(e => String(e.date || "").slice(0, 10) === dateStr);
}

function getUniqueClientsCountForDate(dateStr) {
  const daySales = getSalesForDate(dateStr);
  const seen = new Set();

  daySales.forEach(s => {
    if (s.clientId) seen.add("id:" + String(s.clientId));
    else if (s.clientPhone || s.clientName) seen.add("np:" + (s.clientPhone || "") + "|" + (s.clientName || ""));
  });

  return seen.size;
}

// Bouton "Rapport" (si tu l’appelles depuis l’UI)
function openDailyReportForSelectedDate() {
  const dateStr = getSelectedSalesDate();
  openDailyReportForDate(dateStr);
}

function openDailyReportForDate(dateStr) {
  const daySales = getSalesForDate(dateStr);
  const dayExpenses = getExpensesForDate(dateStr);
  const uniqueClients = getUniqueClientsCountForDate(dateStr);

  if (!daySales.length) {
    alert("Aucune vente pour ce jour.");
    return;
  }

  const dateLabel = new Date(dateStr + "T00:00:00").toLocaleDateString("fr-FR");

  // ===== Résumé ventes + remises =====
  let totalSalesAmount = 0;
  let totalDiscountAmount = 0;

  // Tableau produits : name -> { qty, amount, times[] }
  const productMap = {};

  daySales.forEach(sale => {
    const saleAmount = Number(sale.total) || 0;
    totalSalesAmount += saleAmount;

    const saleDiscountTotal =
      (Number(sale.promoDiscount) || 0) +
      (Number(sale.manualDiscount) || 0) +
      (Number(sale.loyaltyDiscount) || 0) +
      (Number(sale.birthdayDiscount) || 0) ||
      (Number(sale.discountAmount) || 0);

    totalDiscountAmount += saleDiscountTotal;

    // heure vente
    const saleTime = new Date(sale.date).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

    // baseSum = somme des lignes "avant remise" pour répartir la remise
    let baseSum = 0;

    (sale.items || []).forEach(item => {
      const qty = Number(item.qty) || 0;
      if (!qty) return;

      // Priorité: prix enregistré dans item.price (si ton Apps Script le renvoie)
      let unit = Number(item.price) || 0;

      // Sinon: essayer de retrouver par nom dans products (si dispo)
      if (!unit && item.name) {
        const p = (products || []).find(pp => String(pp.name).toLowerCase() === String(item.name).toLowerCase());
        if (p) unit = Number(p.price) || 0;
      }

      baseSum += unit * qty;
    });

    // Répartition par produit
    (sale.items || []).forEach(item => {
      const name = item.name || "Produit";
      const qty = Number(item.qty) || 0;
      if (!qty) return;

      let unit = Number(item.price) || 0;
      if (!unit && item.name) {
        const p = (products || []).find(pp => String(pp.name).toLowerCase() === String(item.name).toLowerCase());
        if (p) unit = Number(p.price) || 0;
      }

      const lineBase = unit * qty;

      // si baseSum=0, on ne répartit pas la remise (évite division par 0)
      let lineFinal = lineBase;
      if (baseSum > 0 && saleDiscountTotal > 0) {
        const ratio = lineBase / baseSum;
        const lineDiscount = Math.round(saleDiscountTotal * ratio);
        lineFinal = Math.max(0, lineBase - lineDiscount);
      }

      if (!productMap[name]) {
        productMap[name] = { qty: 0, amount: 0, times: [] };
      }
      productMap[name].qty += qty;
      productMap[name].amount += lineFinal;
      productMap[name].times.push(saleTime);
    });
  });

  const salesCount = daySales.length;
  const averageBasket = salesCount ? Math.round(totalSalesAmount / salesCount) : 0;

  // ===== Frais du jour =====
  let totalExpensesAmount = 0;
  let expensesRowsHtml = "";

  if (!dayExpenses.length) {
    expensesRowsHtml = `<tr><td colspan="3">Aucun frais enregistré pour ce jour.</td></tr>`;
  } else {
    dayExpenses.forEach(exp => {
      const d = new Date(exp.date);
      const timeStr = isNaN(d.getTime()) ? "" : d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

      const amount = Number(exp.amount) || 0;
      totalExpensesAmount += amount;

      expensesRowsHtml += `
        <tr>
          <td>${timeStr}</td>
          <td>${exp.label || ""}</td>
          <td style="text-align:right;">${amount} FCFA</td>
        </tr>
      `;
    });
  }

  // ===== Tableau produits vendus =====
  const productRows = Object.keys(productMap).sort().map(name => {
    const info = productMap[name];
    const timesStr = (info.times || []).join(", ");
    const avgUnit = info.qty ? Math.round(info.amount / info.qty) : 0;

    return `
      <tr>
        <td>${name}</td>
        <td style="text-align:center;">${info.qty}</td>
        <td style="text-align:right;">${avgUnit} FCFA</td>
        <td style="text-align:right;">${Math.round(info.amount)} FCFA</td>
        <td>${timesStr}</td>
      </tr>
    `;
  }).join("");

  const netResult = totalSalesAmount - totalExpensesAmount;

  const html = `
    <!DOCTYPE html>
    <html lang="fr">
    <head>
      <meta charset="UTF-8">
      <title>Rapport du ${dateLabel} - BSK</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 13px; margin: 20px; color: #111827; }
        .report-container { max-width: 900px; margin: 0 auto; }
        h1 { margin: 0; font-size: 22px; }
        .subtitle { font-size: 12px; color: #6b7280; margin-top: 4px; }
        h2 { font-size: 16px; margin-top: 16px; margin-bottom: 6px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
        table { border-collapse: collapse; width: 100%; margin-top: 6px; }
        th, td { border: 1px solid #e5e7eb; padding: 6px 8px; text-align: left; }
        th { background: #f3f4f6; font-size: 12px; }
        .summary { margin-top: 8px; font-size: 13px; }
        .print-btn { margin-top: 16px; padding: 8px 14px; font-size: 13px; }
      </style>
    </head>
    <body>
      <div class="report-container">
        <h1>Rapport journalier</h1>
        <div class="subtitle">Date : ${dateLabel} · BSK</div>

        <h2>1. Résumé des ventes du jour</h2>
        <div class="summary">
          Nombre de ventes : <strong>${salesCount}</strong><br>
          Nombre de clients : <strong>${uniqueClients}</strong><br>
          Chiffre d'affaires (après remises) : <strong>${totalSalesAmount} FCFA</strong><br>
          Total des remises : <strong>${totalDiscountAmount} FCFA</strong><br>
          Panier moyen : <strong>${averageBasket} FCFA</strong>
        </div>

        <h2>2. Produits vendus (prix après remise)</h2>
        <table>
          <thead>
            <tr>
              <th>Produit</th>
              <th>Quantité vendue</th>
              <th>Prix moyen</th>
              <th>Montant total</th>
              <th>Heure(s)</th>
            </tr>
          </thead>
          <tbody>
            ${productRows || `<tr><td colspan="5">Aucun détail produit.</td></tr>`}
          </tbody>
        </table>

        <h2>3. Frais / dépenses du jour</h2>
        <table>
          <thead>
            <tr>
              <th>Heure</th>
              <th>Motif</th>
              <th>Montant</th>
            </tr>
          </thead>
          <tbody>
            ${expensesRowsHtml}
            <tr>
              <td colspan="2" style="text-align:right;"><strong>Total des frais</strong></td>
              <td style="text-align:right;"><strong>${totalExpensesAmount} FCFA</strong></td>
            </tr>
          </tbody>
        </table>

        <h2>4. Synthèse CA du jour</h2>
        <div class="summary">
          Chiffre d'affaires (ventes) : <strong>${totalSalesAmount} FCFA</strong><br>
          Moins frais du jour : <strong>${totalExpensesAmount} FCFA</strong><br>
          Résultat net approximatif : <strong>${netResult} FCFA</strong>
        </div>

        <button class="print-btn" onclick="window.print()">Imprimer / Enregistrer en PDF</button>
      </div>
    </body>
    </html>
  `;

  const win = window.open("", "_blank", "width=1000,height=900");
  if (!win) {
    alert("Autorisez les pop-up pour afficher le rapport (blocage navigateur).");
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
}

// =====================================================================
// ================== ESPACE PRO (bénéfice / perte) ==================
// =====================================================================
// Calcul automatique à partir des VRAIES ventes de la caisse :
//   Résultat = CA (après remises) − coût de revient des produits vendus − charges fixes
//
// ⚠️ Le code est visible dans ce fichier : ça bloque un employé curieux,
// pas quelqu'un qui sait lire du code.
const PRO_PASSWORD = "0507";
const PRO_UNLOCK_KEY = "bsk_pro_unlocked";
const PRO_SETTINGS_KEY = "bsk_pro_settings";

// Coûts de revient par défaut (modifiables dans l'onglet Pro)
const DEFAULT_PRO_COSTS = {
  "bar à musc": 2000,
  "bar à parfum": 1500,
  "bar à thiouraye": 1000,
  "brume butterfly": 2000,
  "brume nefertiti": 2000,
  "brume summer": 2000,
  "brume crush": 2000,
  "jardin suspendu": 2000,
  "nuit de noce": 2000,
  "figue d'amour": 2000,
  "linge de maman": 2000,
  "bonbon": 2000,
  "sweet cotton": 2000,
  "couture": 0
};

const DEFAULT_PRO_SETTINGS = {
  fixedCharges: [
    { name: "Loyer", amount: 500000 },
    { name: "Salaires", amount: 400000 },
    { name: "Autres frais", amount: 100000 }
  ],
  costs: { ...DEFAULT_PRO_COSTS },
  includeExpenses: false
};

// Lignes de vente qui ne sont pas des produits (pas de coût de revient)
const PRO_NON_PRODUCT_ITEMS = ["règlement crédit"];

const proState = { period: "month", refDate: null };

function loadProSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(PRO_SETTINGS_KEY) || "null");
    if (!raw) return JSON.parse(JSON.stringify(DEFAULT_PRO_SETTINGS));
    return {
      fixedCharges: Array.isArray(raw.fixedCharges) ? raw.fixedCharges : DEFAULT_PRO_SETTINGS.fixedCharges,
      costs: { ...DEFAULT_PRO_COSTS, ...(raw.costs || {}) },
      includeExpenses: !!raw.includeExpenses
    };
  } catch (e) {
    return JSON.parse(JSON.stringify(DEFAULT_PRO_SETTINGS));
  }
}

let proSettings = loadProSettings();

function saveProSettings() {
  try {
    localStorage.setItem(PRO_SETTINGS_KEY, JSON.stringify(proSettings));
  } catch (e) {
    console.warn("Impossible d'enregistrer les réglages Pro", e);
  }
}

// ---------- Utilitaires ----------
function proKey(name) {
  // "Figue d’amour" et "Figue d'amour" → même clé
  return String(name || "").toLowerCase().replace(/[’`´]/g, "'").replace(/\s+/g, " ").trim();
}

function proEscape(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function fmt(n) {
  return Math.round(Number(n) || 0).toLocaleString("fr-FR");
}

function toLocalDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function todayLocalStr() {
  return toLocalDateStr(new Date());
}

function dateKeyOf(value) {
  const d = new Date(value);
  if (!isNaN(d.getTime())) return toLocalDateStr(d);
  const s = String(value || "");
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : "";
}

function fmtDateFr(s) {
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y}`;
}

// jour ; semaine = lundi → dimanche ; mois ; année
function getProRange(period, refStr) {
  const [y, m, d] = refStr.split("-").map(Number);
  const ref = new Date(y, m - 1, d);
  let from, to;
  if (period === "day") {
    from = new Date(ref); to = new Date(ref);
  } else if (period === "week") {
    const dow = (ref.getDay() + 6) % 7;
    from = new Date(ref); from.setDate(ref.getDate() - dow);
    to = new Date(from); to.setDate(from.getDate() + 6);
  } else if (period === "month") {
    from = new Date(ref.getFullYear(), ref.getMonth(), 1);
    to = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
  } else {
    from = new Date(ref.getFullYear(), 0, 1);
    to = new Date(ref.getFullYear(), 11, 31);
  }
  return { from: toLocalDateStr(from), to: toLocalDateStr(to) };
}

function monthlyFixedTotal() {
  return proSettings.fixedCharges.reduce((s, c) => s + (Number(c.amount) || 0), 0);
}

// Charges fixes ramenées à la période (base : montant mensuel)
function fixedForPeriod(period) {
  const m = monthlyFixedTotal();
  if (period === "day") return (m * 12) / 365;
  if (period === "week") return (m * 12) / 52;
  if (period === "month") return m;
  return m * 12;
}

function getUnitCost(name) {
  const v = proSettings.costs[proKey(name)];
  return v === undefined || v === "" ? null : Number(v) || 0;
}

function getCatalogPrice(name) {
  const p = (products || []).find((x) => proKey(x.name) === proKey(name));
  return p ? Number(p.price) || 0 : 0;
}

// ---------- Calcul principal ----------
function computePro(period, refStr) {
  const { from, to } = getProRange(period, refStr);
  const inRange = (v) => { const k = dateKeyOf(v); return k && k >= from && k <= to; };

  let revenue = 0;
  let cogs = 0;
  let qtySold = 0;
  let discounts = 0;
  const byProduct = {};
  const missingCost = new Set();

  const addItem = (item) => {
    const name = item.name || "Produit";
    if (PRO_NON_PRODUCT_ITEMS.includes(proKey(name))) return;
    const qty = Number(item.qty) || 0;
    if (!qty) return;
    const unitCost = getUnitCost(name);
    if (unitCost === null) missingCost.add(name);
    const cost = (unitCost || 0) * qty;
    const unitPrice = Number(item.price) || getCatalogPrice(name);

    cogs += cost;
    qtySold += qty;
    const k = proKey(name);
    if (!byProduct[k]) byProduct[k] = { name, qty: 0, revenue: 0, cost: 0 };
    byProduct[k].qty += qty;
    byProduct[k].revenue += unitPrice * qty;
    byProduct[k].cost += cost;
  };

  // 1) Ventes encaissées (y compris règlements de crédit)
  (sales || []).forEach((s) => {
    if (!inRange(s.date)) return;
    revenue += Number(s.total) || 0;
    discounts += Number(s.discountAmount) || 0;
    (s.items || []).forEach(addItem);
  });

  // 2) Ventes à crédit : la marchandise est sortie le jour du crédit → son coût compte ce jour-là
  //    (l'argent, lui, est compté quand le client paie, via « Règlement crédit »)
  (credits || []).forEach((c) => {
    if (!inRange(c.createdAt)) return;
    let items = c.items;
    if (typeof items === "string") { try { items = JSON.parse(items); } catch (e) { items = []; } }
    (Array.isArray(items) ? items : []).forEach(addItem);
  });

  // 3) Frais de l'onglet Frais (optionnel)
  const periodExpenses = (expenses || [])
    .filter((e) => inRange(e.date))
    .reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const deductedExpenses = proSettings.includeExpenses ? periodExpenses : 0;

  const grossMargin = revenue - cogs;
  const fixed = fixedForPeriod(period);
  const totalCharges = fixed + deductedExpenses;
  const net = grossMargin - totalCharges;

  // Taux de marge : celui des ventes réelles, sinon celui du catalogue
  let marginRate = revenue > 0 ? grossMargin / revenue : null;
  if (marginRate === null) {
    let tp = 0, tc = 0;
    (products || []).forEach((p) => {
      const c = getUnitCost(p.name);
      if (Number(p.price) > 0 && c !== null) { tp += Number(p.price); tc += c; }
    });
    if (tp > 0) marginRate = (tp - tc) / tp;
  }

  // Seuil de rentabilité = charges ÷ taux de marge
  const breakEven = marginRate && marginRate > 0 ? totalCharges / marginRate : null;
  const avgUnitMargin = qtySold > 0 ? grossMargin / qtySold : null;
  const unitsNeeded = avgUnitMargin && avgUnitMargin > 0 ? Math.ceil(totalCharges / avgUnitMargin) : null;

  return {
    from, to, revenue, cogs, grossMargin, fixed, periodExpenses, deductedExpenses,
    totalCharges, net, marginRate, breakEven, unitsNeeded, byProduct, discounts,
    missingCost: [...missingCost]
  };
}

// ---------- Verrou ----------
function isProUnlocked() {
  return sessionStorage.getItem(PRO_UNLOCK_KEY) === "1";
}

function unlockPro(e) {
  if (e) e.preventDefault();
  const input = document.getElementById("pro-password");
  const err = document.getElementById("pro-lock-error");
  if (input.value === PRO_PASSWORD) {
    sessionStorage.setItem(PRO_UNLOCK_KEY, "1");
    input.value = "";
    err.classList.add("hidden");
    renderProView();
  } else {
    input.value = "";
    err.classList.remove("hidden");
    input.focus();
  }
}

function lockPro() {
  sessionStorage.removeItem(PRO_UNLOCK_KEY);
  renderProView();
}

// ---------- Affichage ----------
function refreshProIfVisible() {
  const view = document.getElementById("view-pro");
  if (view && !view.classList.contains("hidden") && isProUnlocked()) {
    renderProNumbers();
  }
}

function renderProView() {
  const lock = document.getElementById("pro-lock");
  const content = document.getElementById("pro-content");
  if (!lock || !content) return;

  if (!isProUnlocked()) {
    lock.classList.remove("hidden");
    content.classList.add("hidden");
    setTimeout(() => document.getElementById("pro-password")?.focus(), 50);
    return;
  }

  lock.classList.add("hidden");
  content.classList.remove("hidden");
  if (!proState.refDate) proState.refDate = todayLocalStr();
  document.getElementById("pro-ref-date").value = proState.refDate;
  document.getElementById("pro-include-expenses").checked = proSettings.includeExpenses;

  renderProChargesList();
  renderProCostsList();
  renderProNumbers();
}

function setProPeriod(period) {
  proState.period = period;
  renderProNumbers();
}

function setProRefDate(value) {
  if (!value) return;
  proState.refDate = value;
  document.getElementById("pro-ref-date").value = value;
  renderProNumbers();
}

function toggleProExpenses(checked) {
  proSettings.includeExpenses = checked;
  saveProSettings();
  renderProNumbers();
}

const PRO_PERIOD_LABELS = { day: "Aujourd'hui", week: "Cette semaine", month: "Ce mois", year: "Cette année" };

function renderProNumbers() {
  if (!proState.refDate) proState.refDate = todayLocalStr();

  // ----- Résumé des 4 périodes (par rapport à aujourd'hui) -----
  const summary = document.getElementById("pro-summary");
  const today = todayLocalStr();
  summary.innerHTML = ["day", "week", "month", "year"].map((p) => {
    const r = computePro(p, today);
    const cls = r.net >= 0 ? "pos" : "neg";
    return `
      <div class="pro-summary-item ${cls}">
        <div class="label">${PRO_PERIOD_LABELS[p]}</div>
        <div class="value text-${cls}">${r.net >= 0 ? "+" : "−"}${fmt(Math.abs(r.net))} FCFA</div>
        <span class="badge ${cls}">${r.net >= 0 ? "Bénéfice" : "Perte"}</span>
        <div class="detail">CA ${fmt(r.revenue)} • Charges ${fmt(r.totalCharges)}</div>
      </div>`;
  }).join("");

  // ----- Boutons période -----
  document.querySelectorAll(".pro-period-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.period === proState.period)
  );

  // ----- Détail -----
  const r = computePro(proState.period, proState.refDate);
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };

  set("pro-range-label", r.from === r.to
    ? `Période : ${fmtDateFr(r.from)}`
    : `Période : du ${fmtDateFr(r.from)} au ${fmtDateFr(r.to)}`);
  set("pro-revenue", fmt(r.revenue));
  set("pro-cogs", fmt(r.cogs));
  set("pro-margin", fmt(r.grossMargin));
  set("pro-margin-rate", r.revenue > 0 ? `Taux de marge : ${Math.round((r.grossMargin / r.revenue) * 100)}%` : "");
  set("pro-fixed", fmt(r.fixed));
  set("pro-expenses", fmt(r.periodExpenses));
  set("pro-expenses-note", proSettings.includeExpenses ? "Déduits du résultat" : "Non déduits (case décochée)");
  set("pro-net", `${r.net >= 0 ? "+" : "−"}${fmt(Math.abs(r.net))} FCFA`);
  set("pro-net-label", r.net >= 0 ? "✅ Bénéfice" : "❌ Perte");

  const netCard = document.getElementById("pro-net-card");
  netCard.classList.toggle("pos", r.net >= 0);
  netCard.classList.toggle("neg", r.net < 0);

  // ----- Barre d'équilibre -----
  const fill = document.getElementById("breakeven-fill");
  if (!r.breakEven) {
    fill.style.width = "0%";
    fill.classList.remove("reached");
    set("breakeven-pct", "—");
    set("breakeven-text", "Pas encore assez de données pour calculer le seuil (aucune vente et coûts incomplets).");
  } else {
    const pct = (r.revenue / r.breakEven) * 100;
    fill.style.width = `${Math.min(pct, 150) / 1.5}%`; // 100% = trait noir aux 2/3
    fill.classList.toggle("reached", pct >= 100);
    set("breakeven-pct", `${Math.round(pct)}% du seuil`);

    let msg = `Seuil de rentabilité : ${fmt(r.breakEven)} FCFA de chiffre d'affaires sur la période`;
    if (r.unitsNeeded) msg += ` (≈ ${fmt(r.unitsNeeded)} articles vendus)`;
    msg += ". ";
    msg += pct >= 100
      ? "✅ Équilibre atteint : chaque vente en plus est du bénéfice."
      : `Il manque ${fmt(r.breakEven - r.revenue)} FCFA de ventes pour couvrir les charges.`;
    set("breakeven-text", msg);
  }

  // ----- Tableau par produit -----
  const tbody = document.getElementById("pro-products-body");
  const rows = Object.values(r.byProduct).sort((a, b) => b.revenue - a.revenue);
  tbody.innerHTML = rows.length
    ? rows.map((p) => {
        const m = p.revenue - p.cost;
        return `<tr>
          <td>${proEscape(p.name)}</td>
          <td>${p.qty}</td>
          <td>${fmt(p.revenue)}</td>
          <td>${fmt(p.cost)}</td>
          <td class="${m >= 0 ? "text-pos" : "text-neg"}">${fmt(m)}</td>
        </tr>`;
      }).join("") +
      (r.discounts > 0
        ? `<tr><td colspan="4" style="text-align:right;">Remises accordées sur la période</td><td class="text-neg">−${fmt(r.discounts)}</td></tr>`
        : "")
    : `<tr><td colspan="5">Aucune vente sur cette période.</td></tr>`;

  set("pro-warning", r.missingCost.length
    ? `⚠️ Coût de revient manquant pour : ${r.missingCost.join(", ")}. Ils sont comptés à 0 → le bénéfice est surestimé. Remplis-les plus bas.`
    : "");

  renderProChargesTotal();
}

// ---------- Charges fixes (éditables) ----------
function renderProChargesList() {
  const box = document.getElementById("pro-charges-list");
  box.innerHTML = proSettings.fixedCharges.map((c, i) => `
    <div class="pro-row">
      <input type="text" value="${proEscape(c.name)}" oninput="updateProCharge(${i}, 'name', this.value)" />
      <input type="number" min="0" step="1000" value="${Number(c.amount) || 0}" oninput="updateProCharge(${i}, 'amount', this.value)" />
      <button class="del-btn" title="Supprimer" onclick="removeProCharge(${i})">✕</button>
    </div>`).join("");
  renderProChargesTotal();
}

function renderProChargesTotal() {
  const el = document.getElementById("pro-charges-total");
  if (!el) return;
  const m = monthlyFixedTotal();
  el.innerHTML = `Total : <strong>${fmt(m)} FCFA / mois</strong><br>
    <span class="help-text">soit ${fmt((m * 12) / 52)} / semaine • ${fmt((m * 12) / 365)} / jour</span>`;
}

function updateProCharge(i, field, value) {
  if (!proSettings.fixedCharges[i]) return;
  proSettings.fixedCharges[i][field] = field === "amount" ? Number(value) || 0 : value;
  saveProSettings();
  renderProNumbers();
}

function addProCharge() {
  proSettings.fixedCharges.push({ name: "Nouvelle charge", amount: 0 });
  saveProSettings();
  renderProChargesList();
  renderProNumbers();
}

function removeProCharge(i) {
  const c = proSettings.fixedCharges[i];
  if (!c || !confirm(`Supprimer la charge « ${c.name} » ?`)) return;
  proSettings.fixedCharges.splice(i, 1);
  saveProSettings();
  renderProChargesList();
  renderProNumbers();
}

// ---------- Coûts de revient (éditables) ----------
function renderProCostsList() {
  const box = document.getElementById("pro-costs-list");
  // tous les produits de la caisse + ceux trouvés dans les ventes
  const names = new Map();
  (products || []).forEach((p) => names.set(proKey(p.name), p.name));
  (sales || []).forEach((s) => (s.items || []).forEach((it) => {
    const k = proKey(it.name);
    if (it.name && !PRO_NON_PRODUCT_ITEMS.includes(k) && !names.has(k)) names.set(k, it.name);
  }));

  box.innerHTML = [...names.entries()].map(([k, name]) => {
    const cost = getUnitCost(name);
    const price = getCatalogPrice(name);
    return `
      <div class="pro-cost-row">
        <span>${proEscape(name)}${price ? ` <small class="help-text">(vendu ${fmt(price)})</small>` : ""}</span>
        <input type="number" min="0" step="100" data-key="${proEscape(k)}"
          class="${cost === null ? "missing" : ""}"
          value="${cost === null ? "" : cost}" placeholder="à remplir"
          oninput="updateProCost(this)" />
      </div>`;
  }).join("");
}

function updateProCost(input) {
  const k = input.dataset.key;
  if (input.value === "") {
    proSettings.costs[k] = ""; // vide = à remplir (et ne revient pas à la valeur par défaut)
    input.classList.add("missing");
  } else {
    proSettings.costs[k] = Number(input.value) || 0;
    input.classList.remove("missing");
  }
  saveProSettings();
  renderProNumbers();
}

// ================== INIT ==================
document.addEventListener("DOMContentLoaded", () => {
  showView("caisse");

  fetchStockFromSheet();
  fetchClientsFromSheet();
  fetchPerfumesFromSheet();
  fetchSalesFromSheet();
  fetchStockHistoryFromSheet();
  fetchExpensesFromSheet();
  fetchCreditsFromSheet();
  fetchCreditPaymentsFromSheet();

  const discountInput = document.getElementById("cart-discount");
  if (discountInput) discountInput.addEventListener("input", renderCart);

  // Rafraîchissement auto ventes (30s)
  setInterval(() => {
    fetchSalesFromSheet();
  }, 30000);
});