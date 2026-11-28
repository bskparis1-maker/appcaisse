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
  // ✅ l'anniversaire du jour compte (avant, il était exclu dès minuit passé)
  const today = new Date(year, now.getMonth(), now.getDate());
  if (nextBirthday < today) nextBirthday.setFullYear(year + 1);

  const diffHours = (nextBirthday - today) / (1000 * 60 * 60);
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
let productsLoadedFromSheet = false; // ✅ vrai stock reçu de Google Sheets ?
// ================== STOCK <-> SHEETS ==================
// ✅ 27/11 : le stock n'est plus réécrit en entier à chaque vente.
// On garde « stockServeur » = dernier stock connu de Google Sheets. À chaque envoi, l'app calcule
// la différence (ex : -2 pour un produit vendu) et envoie seulement ces mouvements (action stockMove).
// Le serveur les applique au stock actuel (un appareil à la fois) et renvoie le stock à jour.
let stockServeur = null;          // { id: {id, name, price, stock} } tel que dans Google Sheets
let stockEnvoiEnCours = false;
let stockARenvoyer = false;
let stockEchecs = 0;

function stockVersCarte(list) {
  const m = {};
  (list || []).forEach((p) => { m[String(p.id)] = { id: Number(p.id), name: p.name, price: Number(p.price) || 0, stock: Number(p.stock) || 0 }; });
  return m;
}

// Fusionne le stock reçu de Sheets avec les changements locaux pas encore envoyés
function stockFusionner(listeServeur) {
  const ancien = stockServeur || {};
  const nouveau = stockVersCarte(listeServeur);
  const locaux = {};
  (products || []).forEach((p) => { locaux[String(p.id)] = p; });

  const resultat = [];
  Object.values(nouveau).forEach((sp) => {
    const loc = locaux[String(sp.id)];
    const base = ancien[String(sp.id)];
    // changement fait sur cet appareil et pas encore envoyé
    const enAttente = loc && base ? (Number(loc.stock) || 0) - base.stock : 0;
    const prod = { id: sp.id, name: sp.name, price: sp.price, stock: Math.max(0, sp.stock + enAttente) };
    if (loc && base) {
      if (loc.name !== base.name) prod.name = loc.name;
      if (Number(loc.price) !== base.price) prod.price = Number(loc.price) || 0;
    }
    resultat.push(prod);
  });
  // produits créés ici et pas encore envoyés
  (products || []).forEach((p) => {
    if (!nouveau[String(p.id)] && !ancien[String(p.id)] && productsLoadedFromSheet) resultat.push(p);
  });
  stockServeur = nouveau;
  products = resultat;
  productsLoadedFromSheet = true;
  saveProducts(products);
}

function stockRafraichirEcran() {
  renderProductsForSale();
  renderProductsTable();
  renderCart();
  if (typeof updateNavBadges === "function") updateNavBadges();
  if (typeof renderTesteurPanel === "function") renderTesteurPanel();
  refreshProIfVisible();
}

// Appel JSONP générique (réponse du serveur)
function stockJsonp(action, payload, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const cb = "onStock_" + Date.now() + "_" + Math.floor(Math.random() * 1e6);
    const script = document.createElement("script");
    let fini = false;
    const finir = () => { fini = true; delete window[cb]; script.remove(); };
    const minuteur = setTimeout(() => { if (!fini) { finir(); reject(new Error("délai dépassé")); } }, timeoutMs);
    window[cb] = (data) => { clearTimeout(minuteur); finir(); resolve(data); };
    script.onerror = () => { clearTimeout(minuteur); finir(); reject(new Error("réseau")); };
    script.src = `${SHEET_URL}?action=${action}${payload ? "&payload=" + encodeURIComponent(JSON.stringify(payload)) : ""}&callback=${cb}`;
    document.body.appendChild(script);
  });
}

function fetchStockFromSheet() {
  if (stockEnvoiEnCours) return; // on attend la réponse de l'envoi en cours
  stockJsonp("getStock", null)
    .then((data) => {
      if (stockEnvoiEnCours) return;
      if (data && Array.isArray(data.products) && data.products.length > 0) stockFusionner(data.products);
      // des changements faits avant le chargement ? on les envoie maintenant
      if (productsLoadedFromSheet) stockEnvoyerDifferences();
    })
    .catch(() => console.warn("Erreur chargement stock, utilisation locale."))
    .finally(stockRafraichirEcran);
}

// Différences entre le stock de l'appareil et le dernier stock connu de Sheets
function stockCalculerMouvements() {
  const moves = [];
  const base = stockServeur || {};
  const vus = {};
  (products || []).forEach((p) => {
    const k = String(p.id);
    vus[k] = true;
    const b = base[k];
    if (!b) { moves.push({ op: "add", id: p.id, name: p.name, price: Number(p.price) || 0, stock: Number(p.stock) || 0 }); return; }
    const delta = (Number(p.stock) || 0) - b.stock;
    const infoChangee = p.name !== b.name || (Number(p.price) || 0) !== b.price;
    if (delta) moves.push({ op: "delta", id: p.id, name: p.name, price: Number(p.price) || 0, delta });
    else if (infoChangee) moves.push({ op: "info", id: p.id, name: p.name, price: Number(p.price) || 0 });
  });
  Object.keys(base).forEach((k) => { if (!vus[k]) moves.push({ op: "remove", id: base[k].id }); });
  return moves;
}

async function stockEnvoyerDifferences() {
  if (!productsLoadedFromSheet || !stockServeur) return; // stock pas encore chargé : rien à comparer
  if (stockEnvoiEnCours) { stockARenvoyer = true; return; }
  const moves = stockCalculerMouvements();
  if (!moves.length) return;

  stockEnvoiEnCours = true;
  stockARenvoyer = false;
  const avant = stockServeur;
  // on considère les mouvements comme envoyés (pour ne pas les compter 2 fois)
  const prevu = JSON.parse(JSON.stringify(stockServeur));
  moves.forEach((m) => {
    const k = String(m.id);
    if (m.op === "add") prevu[k] = { id: Number(m.id), name: m.name, price: m.price, stock: m.stock };
    else if (m.op === "remove") delete prevu[k];
    else if (prevu[k]) {
      prevu[k].name = m.name; prevu[k].price = m.price;
      if (m.op === "delta") prevu[k].stock = Math.max(0, prevu[k].stock + m.delta);
    }
  });
  stockServeur = prevu;
  const rid = Date.now() + "-" + Math.random().toString(36).slice(2, 8);

  let essai = 0, ok = false;
  while (essai < 3 && !ok) {
    essai++;
    try {
      const r = await stockJsonp("stockMove", { rid, moves });
      if (r && r.ok && Array.isArray(r.products)) {
        stockEnvoiEnCours = false;
        stockFusionner(r.products);
        ok = true;
      } else if (r && r.error && !/unknown action/i.test(r.error)) {
        console.warn("stockMove :", r.error);
      } else {
        // ancien Code.gs (sans stockMove) : on revient à l'ancienne méthode
        stockServeur = avant;
        stockEnvoiEnCours = false;
        stockAncienneMethode();
        return;
      }
    } catch (e) {
      console.warn("stockMove échec", essai, e.message);
    }
    if (!ok && essai < 3) await new Promise((res) => setTimeout(res, 3000 * essai));
  }
  stockEnvoiEnCours = false;
  if (!ok) {
    // pas de réponse : on remet l'ancien état pour renvoyer ces mouvements plus tard
    // (le serveur reconnaît l'identifiant et ne les applique pas 2 fois s'ils étaient passés)
    stockServeur = avant;
    stockEchecs++;
    stockAfficherAlerte(true);
    setTimeout(stockEnvoyerDifferences, 20000);
    return;
  }
  stockEchecs = 0;
  stockAfficherAlerte(false);
  stockRafraichirEcran();
  if (stockARenvoyer) stockEnvoyerDifferences();
}

// ancien envoi (tout le stock) si le Code.gs n'a pas encore été mis à jour
function stockAncienneMethode() {
  const payload = encodeURIComponent(JSON.stringify({ products }));
  const iframe = document.createElement("iframe");
  iframe.style.display = "none";
  iframe.src = `${SHEET_URL}?action=updateStock&payload=${payload}`;
  document.body.appendChild(iframe);
  setTimeout(() => iframe.remove(), 15000);
  stockServeur = stockVersCarte(products);
}

function stockAfficherAlerte(show) {
  let el = document.getElementById("stock-alerte");
  if (!el && show) {
    el = document.createElement("div");
    el.id = "stock-alerte";
    el.className = "stock-alerte";
    document.body.appendChild(el);
  }
  if (!el) return;
  el.textContent = "⚠️ Stock pas encore enregistré dans Google Sheets (internet ?). Nouvel essai automatique…";
  el.classList.toggle("hidden", !show);
}

// Le stock est-il chargé ? (sinon on bloque ventes / sorties de stock)
function stockPret() {
  if (productsLoadedFromSheet) return true;
  alert("⏳ Le stock n'est pas encore chargé depuis Google Sheets. Attends quelques secondes et réessaie.");
  fetchStockFromSheet();
  return false;
}

// ✅ Toutes les fonctions qui modifiaient le stock appellent encore sendStockToSheet(products) :
// elle envoie maintenant seulement les différences.
function sendStockToSheet() {
  stockEnvoyerDifferences();
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
            promoDiscount: Number(info.promoDiscount) || 0,
            manualDiscount: Number(info.manualDiscount) || 0,
            birthdayDiscount: Number(info.birthdayDiscount) || 0,
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
      updateNavBadges();
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
  renderProSubnav(viewName);

  if (viewName === "caisse") {
    renderProductsForSale();
    renderCart();
    renderClientSelect();
    renderCaisseBox();
    renderTesteurPanel();
  } else if (viewName === "pertes") {
    if (!applyViewLock("pertes")) return;
    renderPertesView();
  } else if (viewName === "coffre") {
    renderCoffreView();
  } else if (viewName === "bilan") {
    renderBilanView();
  } else if (viewName === "produits") {
    if (!applyViewLock("produits")) return;
    renderProductsTable();
    renderStockHistoryTable();
  } else if (viewName === "clients") {
    renderClientsTable();
  } else if (viewName === "ventes") {
    initSalesDate();
    updateSalesViewForSelectedDate();
  } else if (viewName === "dashboard") {
    if (!applyViewLock("dashboard")) return;
    initDashboardDates();
    loadDashboardStats();
  } else if (viewName === "frais") {
    renderExpensesTable();
    renderExpensesPie();
  } else if (viewName === "barparfum" || viewName === "bar-parfum") {
    renderPerfumeBar();
  } else if (viewName === "credit") {
    renderCreditsUI();
  } else if (viewName === "livraisons") {
    renderLivraisonsView();
  } else if (viewName === "b2b") {
    if (!applyViewLock("b2b")) return; // ✅ code obligatoire
    renderB2BView();
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
  refreshProIfVisible(); // ✅ met aussi à jour la caisse

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
    updateMonnaie();
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
  totalSpan.textContent = fmt(totals.finalTotal);
  // détail des remises sous le total
  const detail = document.getElementById("cart-total-detail");
  if (detail) {
    const rem = totals.promoDiscount + totals.manualDiscount + totals.birthdayDiscount;
    detail.textContent = rem > 0
      ? `Avant remise ${fmt(totals.baseTotal)} F • remise −${fmt(rem)} F${totals.isBirthdayClient ? " (anniversaire −30 %)" : ""}`
      : "";
  }
  updateMonnaie();
}

// =====================================================================
// ✅ ENCAISSEMENT : mode de paiement + monnaie à rendre
// =====================================================================
function setPaymentMode(mode) {
  const select = document.getElementById("payment-method");
  if (select) select.value = mode;
  document.querySelectorAll(".pay-mode").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
  document.getElementById("cash-zone")?.classList.toggle("hidden", mode !== "cash");
  updateMonnaie();
}

// billets proposés : montant exact puis les arrondis au-dessus
function montantsRapides(total) {
  if (!(total > 0)) return [];
  const vals = [total];
  [1000, 5000, 10000].forEach((pas) => vals.push(Math.ceil(total / pas) * pas));
  [20000, 50000, 100000].forEach((b) => { if (b > total) vals.push(b); });
  return [...new Set(vals)].filter((v) => v >= total).sort((a, b) => a - b).slice(0, 4);
}

function choisirMontantRecu(v) {
  const input = document.getElementById("cash-recu");
  if (input) input.value = v;
  updateMonnaie();
}

function updateMonnaie() {
  const out = document.getElementById("cash-rendu");
  const quick = document.getElementById("cash-quick");
  const input = document.getElementById("cash-recu");
  if (!out || !input) return;
  const total = cart.length ? calculateCartTotals().finalTotal : 0;
  if (quick) quick.innerHTML = montantsRapides(total).map((v) =>
    `<button type="button" onclick="choisirMontantRecu(${v})">${v === total ? "Montant exact" : fmt(v) + " F"}</button>`).join("");
  const recu = Number(input.value) || 0;
  if (!total || input.value === "") { out.className = "rendu"; out.innerHTML = ""; return; }
  if (recu >= total) {
    out.className = "rendu ok";
    out.innerHTML = `Monnaie à rendre<strong>${fmt(recu - total)} FCFA</strong>`;
  } else {
    out.className = "rendu manque";
    out.innerHTML = `Il manque<strong>${fmt(total - recu)} FCFA</strong>`;
  }
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
  const recu = document.getElementById("cash-recu");
  if (recu) recu.value = "";
  const remise = document.getElementById("remise-details");
  if (remise) remise.open = false;
  setPaymentMode("cash");
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
  renderClientPicker();
}

// ✅ Nouveau client : une seule fenêtre + alerte si le numéro existe déjà
function clientPhoneKey(phone) {
  // « +221 77 123 45 67 », « 771234567 », « 77-123-45-67 » → même clé (9 derniers chiffres)
  const d = String(phone || "").replace(/\D/g, "");
  return d.length > 9 ? d.slice(-9) : d;
}

function findClientByPhone(phone) {
  const k = clientPhoneKey(phone);
  if (k.length < 7) return null;
  return (clients || []).find((c) => clientPhoneKey(c.phone) === k) || null;
}

function formatClientPhone(phone) {
  // numéro sénégalais à 9 chiffres → « 77 123 45 67 », sinon on garde ce qui a été tapé
  const k = clientPhoneKey(phone);
  if (/^[37]\d{8}$/.test(k)) return `${k.slice(0, 2)} ${k.slice(2, 5)} ${k.slice(5, 7)} ${k.slice(7)}`;
  return String(phone || "").trim();
}

let clientFormDuplicate = null;

function openAddClientModal(prefill) {
  const $ = (id) => document.getElementById(id);
  const p = typeof prefill === "string" ? prefill.trim() : "";
  const estNumero = p && clientPhoneKey(p).length >= 7 && !/[a-zA-Z]/.test(p);
  $("client-form-name").value = p && !estNumero ? p : "";
  $("client-form-phone").value = estNumero ? p : "";
  $("client-form-birthdate").value = "";
  $("client-form-error").classList.add("hidden");
  checkClientFormDuplicate();
  $("client-form-modal").classList.remove("hidden");
  setTimeout(() => $("client-form-phone").focus(), 50);
}

function closeClientFormModal() {
  document.getElementById("client-form-modal").classList.add("hidden");
}

// Vérifie en direct si le numéro tapé appartient déjà à un client
function checkClientFormDuplicate() {
  const box = document.getElementById("client-form-duplicate");
  const phone = document.getElementById("client-form-phone").value;
  clientFormDuplicate = findClientByPhone(phone);
  if (!box) return;
  if (!clientFormDuplicate) { box.classList.add("hidden"); box.innerHTML = ""; return; }
  const c = clientFormDuplicate;
  box.innerHTML = `⚠️ Ce numéro est déjà celui de <strong>${proEscape(c.name)}</strong>` +
    `${c.birthdate ? " (né(e) le " + formatBirthdateShort(c.birthdate) + ")" : ""}.<br>` +
    `<button type="button" class="secondary-btn small-btn" onclick="useExistingClient()">Choisir ${proEscape(c.name)}</button>`;
  box.classList.remove("hidden");
}

// Doublon trouvé → on prend le client existant au lieu d'en créer un 2e
function useExistingClient() {
  const c = clientFormDuplicate;
  if (!c) return;
  closeClientFormModal();
  selectClientInCaisse(c.id);
}

function selectClientInCaisse(clientId) {
  renderClientSelect();
  const select = document.getElementById("client-select");
  if (select) { select.value = String(clientId); renderCart(); }
  renderClientPicker();
}

// ✅ Choix du client en caisse : on tape le nom ou le numéro (fini la liste de 5 000 noms)
const sansAccent = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function renderClientPicker() {
  const select = document.getElementById("client-select");
  const picked = document.getElementById("client-picked");
  const input = document.getElementById("client-picker-input");
  if (!select || !picked || !input) return;
  const c = select.value ? (clients || []).find((x) => String(x.id) === String(select.value)) : null;
  if (c) {
    picked.innerHTML = `👤 <strong>${proEscape(c.name)}</strong>${c.phone ? " • " + proEscape(c.phone) : ""}` +
      `${isClientBirthdaySoon(c) ? ` <span class="badge pos">🎂 -30 %</span>` : ""}` +
      ` <button type="button" class="secondary-btn small-btn" onclick="clientPickerClear()">✕ Changer</button>`;
    picked.classList.remove("hidden");
    input.classList.add("hidden");
  } else {
    picked.classList.add("hidden");
    input.classList.remove("hidden");
  }
  document.getElementById("client-picker-list")?.classList.add("hidden");
}

function clientPickerSearch() {
  const input = document.getElementById("client-picker-input");
  const list = document.getElementById("client-picker-list");
  const q = input.value.trim();
  if (q.length < 2) { list.classList.add("hidden"); list.innerHTML = ""; return; }
  const qn = sansAccent(q);
  const qTel = clientPhoneKey(q);
  const res = (clients || []).filter((c) =>
    sansAccent(c.name).includes(qn) || (qTel.length >= 3 && clientPhoneKey(c.phone).includes(qTel)))
    .sort((a, b) => (sansAccent(a.name).startsWith(qn) ? 0 : 1) - (sansAccent(b.name).startsWith(qn) ? 0 : 1) ||
      String(a.name).localeCompare(String(b.name), "fr"))
    .slice(0, 8);
  list.innerHTML = res.map((c) =>
    `<button type="button" onclick="clientPickerChoose('${proEscape(String(c.id))}')">` +
    `<strong>${proEscape(c.name)}</strong> <small>${proEscape(c.phone || "")}</small>${isClientBirthdaySoon(c) ? " 🎂" : ""}</button>`).join("") +
    (res.length ? "" : `<div class="help-text" style="padding:6px 8px;">Aucun client trouvé.</div>`) +
    `<button type="button" class="client-picker-new" onclick="openAddClientModal(${proEscape(JSON.stringify(q))})">➕ Nouveau client « ${proEscape(q)} »</button>`;
  list.classList.remove("hidden");
}

function clientPickerChoose(id) {
  const select = document.getElementById("client-select");
  if (!select) return;
  if (![...select.options].some((o) => o.value === String(id))) renderClientSelect();
  select.value = String(id);
  document.getElementById("client-picker-input").value = "";
  renderClientPicker();
  renderCart();
}

function clientPickerClear() {
  const select = document.getElementById("client-select");
  if (select) select.value = "";
  renderClientPicker();
  renderCart();
  setTimeout(() => document.getElementById("client-picker-input")?.focus(), 50);
}

function saveClientFromModal(e) {
  if (e) e.preventDefault();
  const $ = (id) => document.getElementById(id);
  const err = $("client-form-error");
  const showError = (msg) => { err.textContent = msg; err.classList.remove("hidden"); };

  const name = $("client-form-name").value.trim().replace(/\s+/g, " ");
  const phoneRaw = $("client-form-phone").value.trim();
  const birthdate = $("client-form-birthdate").value; // déjà au format AAAA-MM-JJ

  if (!name) return showError("Le nom est obligatoire.");
  if (phoneRaw && clientPhoneKey(phoneRaw).length < 7) return showError("Numéro de téléphone incomplet.");
  checkClientFormDuplicate();
  if (clientFormDuplicate) return showError(`Ce numéro existe déjà (${clientFormDuplicate.name}). Choisis ce client ou corrige le numéro.`);
  if (!phoneRaw) {
    const sameName = (clients || []).find((c) => (c.name || "").trim().toLowerCase() === name.toLowerCase());
    if (sameName && !confirm(`Un client s'appelle déjà « ${sameName.name} »${sameName.phone ? " (" + sameName.phone + ")" : ""}. Créer quand même un nouveau client ?`)) return;
  }

  const newClient = {
    id: Date.now(),
    name,
    phone: formatClientPhone(phoneRaw),
    createdAt: new Date().toISOString(),
    birthdate
  };

  clients.push(newClient);
  saveClients(clients);
  sendClientToSheet(newClient);

  closeClientFormModal();
  renderClientsTable();
  selectClientInCaisse(newClient.id); // ✅ le nouveau client est déjà choisi dans la caisse
}

// ================== CONFIRMATION VENTE ==================
function confirmSale() {
  if (cart.length === 0) {
    alert("Panier vide !");
    return;
  }
  if (!stockPret()) return; // ✅ jamais de vente sur un stock pas chargé

  const isCreditSale = document.getElementById("credit-mode")?.checked === true;

  // ✅ CORRECTION : on vérifie les infos crédit AVANT de retirer le stock.
  // Avant, le stock était déjà retiré puis la vente bloquée → si on recliquait,
  // le stock était retiré 2 fois.
  if (isCreditSale && !pendingCreditClient) {
    alert("Infos client crédit manquantes. Décoche puis recoche « Vente à crédit ».");
    return;
  }

  // ✅ espèces : le montant reçu doit couvrir le total (s'il est saisi)
  const modePaiement = document.getElementById("payment-method")?.value || "cash";
  const recuInput = document.getElementById("cash-recu");
  const montantRecu = recuInput && recuInput.value !== "" ? Number(recuInput.value) || 0 : null;
  const totalAPayer = calculateCartTotals().finalTotal;
  if (!isCreditSale && modePaiement === "cash" && montantRecu !== null && montantRecu < totalAPayer) {
    alert(`Montant reçu insuffisant : il manque ${fmt(totalAPayer - montantRecu)} FCFA.`);
    recuInput.focus();
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
    updateNavBadges();

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
  refreshProIfVisible(); // ✅ met aussi à jour la caisse
  updateNavBadges();

  // ✅ montant reçu / monnaie (affichés sur le ticket de cette vente)
  if (paymentMethod === "cash" && montantRecu !== null) {
    sale.montantRecu = montantRecu;
    sale.monnaie = montantRecu - sale.total;
  }
  alert(sale.monnaie > 0
    ? `✅ Vente enregistrée !\n\nMonnaie à rendre : ${fmt(sale.monnaie)} FCFA`
    : "✅ Vente enregistrée !");
}
// ================== TICKET DE CAISSE ==================
// ✅ Ticket de caisse (format imprimante ticket 80 mm, aussi lisible sur téléphone)
const BOUTIQUE = {
  nom: "BSK",
  adresse: "Grand Dakar – Garage Casamance",
  telephone: "77 876 92 01",
  whatsapp: "221778769201",
  horaires: "12h à 22h (lundi → samedi)",
  site: "bskparfum.com"
};

// ---------- Modèle commun : ticket de caisse, bon de livraison, bon de dépôt, facture B2B ----------
// o = { titre, numero, date, infos: [[label, valeur]], lignes: [{ nom, qte, prix }], recap: [[label, valeur, cls]],
//       totalLabel, total, apresTotal (html), bloc (html), pied (html), noteBas (html) }
function buildTicketHtml(o) {
  window.__posDernierTicket = o; // ✅ gardé pour l'impression directe sur la POS-80
  const esc = (v) => proEscape(v);
  const d = new Date(o.date || Date.now());
  const dateStr = isNaN(d.getTime()) ? "" : d.toLocaleDateString("fr-FR");
  const heureStr = isNaN(d.getTime()) ? "" : d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const logo = new URL("logo.png", window.location.href).href;
  let nbArticles = 0;
  const lignes = (o.lignes || []).map((l) => {
    const qty = Number(l.qte) || 0;
    const pu = Number(l.prix) || 0;
    nbArticles += qty;
    return `<div class="item"><div class="item-nom">${esc(l.nom || "Produit")}</div>
      <div class="item-calc"><span>${qty} × ${fmt(pu)}</span><span>${fmt(pu * qty)} F</span></div></div>`;
  }).join("");
  const infos = (o.infos || []).filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== "")
    .map(([l, v]) => `<div class="row small"><span class="muted">${esc(l)}</span><span class="right">${esc(v)}</span></div>`).join("");
  const recap = (o.recap || []).map(([l, v, cls]) => `<div class="row ${cls || ""}"><span>${esc(l)}</span><span>${v}</span></div>`).join("");
  const qrWa = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&margin=0&data=${encodeURIComponent("https://wa.me/" + BOUTIQUE.whatsapp)}`;
  const qrSite = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&margin=0&data=${encodeURIComponent("https://" + BOUTIQUE.site)}`;

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(o.titre || "Ticket")} ${esc(o.numero || "")} - ${BOUTIQUE.nom}</title>
<style>
  /* POS-80 : papier 80 mm, zone imprimable 72 mm. Marges à 0 = pas d'en-tête / pied de page du navigateur */
  @page { size: 80mm 297mm; margin: 0; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; font-size: 13px; color: #111; margin: 0; background: #f3f4f6; }
  .ticket { width: 72mm; max-width: 100%; margin: 10px auto; background: #fff; padding: 10px 6px 14px; }
  .center { text-align: center; }
  .right { text-align: right; }
  .logo { width: 64px; height: 64px; object-fit: cover; border-radius: 14px; }
  h1 { font-size: 22px; letter-spacing: 3px; margin: 4px 0 0; }
  .slogan { font-size: 11px; color: #555; margin-top: 2px; }
  .site { font-size: 14px; font-weight: 700; margin-top: 4px; }
  .doc-titre { font-size: 15px; font-weight: 800; letter-spacing: 1px; margin-top: 2px; }
  .muted { color: #666; }
  .small { font-size: 11.5px; }
  .line { border-top: 1px dashed #999; margin: 8px 0; }
  .row { display: flex; justify-content: space-between; gap: 8px; }
  .item { margin-bottom: 5px; }
  .item-nom { font-weight: 600; }
  .item-calc { display: flex; justify-content: space-between; color: #333; }
  .total { display: flex; justify-content: space-between; gap: 8px; font-size: 18px; font-weight: 800; margin-top: 4px; }
  .total span:last-child { white-space: nowrap; }
  .encadre { margin-top: 6px; padding: 5px 6px; border: 1.5px solid #111; border-radius: 6px; text-align: center; font-size: 12.5px; font-weight: 700; }
  .fort { font-weight: 800; }
  .bloc { font-size: 11.5px; line-height: 1.35; text-align: center; margin-top: 4px; }
  .merci { font-size: 15px; font-weight: 700; margin: 10px 0 2px; }
  .conditions { margin: 6px 0 8px; padding: 5px 6px; border: 1px dashed #111; border-radius: 6px; font-size: 11px; font-weight: 600; line-height: 1.3; }
  .signature { display: flex; justify-content: space-between; gap: 10px; margin-top: 14px; font-size: 11px; }
  .signature div { flex: 1; border-top: 1px solid #111; padding-top: 3px; text-align: center; margin-top: 26px; }
  .qrs { display: flex; justify-content: center; gap: 14px; margin-top: 8px; }
  .qrs div { font-size: 10px; text-align: center; }
  .qrs img { width: 78px; height: 78px; display: block; margin: 0 auto 2px; }
  .actions { text-align: center; margin: 12px 0 4px; }
  .actions button { padding: 8px 16px; font-size: 14px; border-radius: 999px; border: 1px solid #111; background: #111; color: #fff; cursor: pointer; margin: 3px; }
  .actions button.pos { background: #f97316; border-color: #f97316; }
  @media print {
    /* calé à gauche sur 72 mm : la tête d'impression commence au bord gauche de la zone imprimable */
    html, body { width: 72mm; background: #fff; }
    .ticket { width: 72mm; margin: 0; padding: 2mm 0 6mm; }
    .actions { display: none; }
    /* imprimante thermique : tout en noir franc (le gris sort trop pâle) */
    body, .muted, .slogan, .item-calc, .small { color: #000 !important; }
  }
</style>
<style id="page-size"></style>
</head>
<body>
  <div class="ticket">
    <div class="center">
      <img class="logo" src="${logo}" alt="BSK" onerror="this.style.display='none'">
      <h1>${BOUTIQUE.nom}</h1>
      <div class="slogan">Parfums • Brumes • Muscs</div>
      <div class="site">🌐 ${BOUTIQUE.site}</div>
      <div class="small muted">${esc(BOUTIQUE.adresse)}<br>📞 ${BOUTIQUE.telephone}</div>
    </div>

    <div class="line"></div>
    ${o.titre ? `<div class="center doc-titre">${esc(o.titre)}</div>` : ""}
    <div class="row small"><span>N° ${esc(o.numero || "—")}</span><span>${dateStr} ${heureStr}</span></div>
    ${infos ? `<div class="line"></div>${infos}` : ""}
    <div class="line"></div>

    ${lignes}

    <div class="line"></div>
    <div class="row small"><span>${nbArticles} article${nbArticles > 1 ? "s" : ""}</span><span></span></div>
    ${recap}
    <div class="total"><span>${esc(o.totalLabel || "TOTAL")}</span><span>${fmt(o.total)} FCFA</span></div>
    ${o.apresTotal || ""}
    ${o.bloc ? `<div class="line"></div>${o.bloc}` : ""}
    ${o.noteBas || ""}

    <div class="line"></div>
    <div class="center">
      ${o.pied || `<div class="merci">Merci pour votre achat 🧡</div>`}
      <div class="conditions">Pour tout échange ou remboursement, le ticket de caisse est obligatoire et le produit ne doit pas avoir été utilisé.</div>
      <div class="small">Commandez en ligne sur <strong>${BOUTIQUE.site}</strong><br>Livraison partout à Dakar 🛵</div>
      <div class="small muted" style="margin-top:4px;">Ouvert de ${BOUTIQUE.horaires}</div>
      <div class="qrs">
        <div><img src="${qrSite}" alt="Site BSK">Notre site</div>
        <div><img src="${qrWa}" alt="WhatsApp BSK">WhatsApp</div>
      </div>
    </div>

    <div class="actions">
      <button onclick="window.print()">🖨️ Imprimer</button>
      <button class="pos" onclick="try { (window.opener || window.parent).posImprimerDernier(); } catch (e) { alert('Impression POS-80 impossible depuis cette fenêtre.'); }">🧾 Imprimer sur POS-80</button>
    </div>
  </div>
<script>
  /* longueur du papier = longueur du ticket (pas de grand blanc après le ticket) */
  function tailleTicket() {
    var t = document.querySelector(".ticket"), a = document.querySelector(".actions");
    if (!t) return;
    var px = t.getBoundingClientRect().height - (a ? a.getBoundingClientRect().height : 0);
    var mm = Math.ceil(px * 25.4 / 96) + 12;
    document.getElementById("page-size").textContent = "@page { size: 80mm " + mm + "mm; margin: 0; }";
  }
  window.addEventListener("load", tailleTicket);
  window.addEventListener("beforeprint", tailleTicket);
  tailleTicket();
<\/script>
</body>
</html>`;
}

function openTicketWindow(html) {
  // ✅ impression directe sur la POS-80 (réglage « Imprimer directement ») : pas de fenêtre
  if (typeof posReglages === "function" && posReglages().direct && posConnecte()) {
    posImprimer(window.__posDernierTicket);
    return;
  }
  const win = window.open("", "_blank", "width=420,height=760");
  if (!win) return openTicketOverlay(html); // pop-up bloquée → ticket affiché dans l'app
  win.document.open();
  win.document.write(html);
  win.document.close();
}

// Ticket affiché par-dessus l'app (quand le navigateur bloque la fenêtre)
function openTicketOverlay(html) {
  document.getElementById("ticket-overlay")?.remove();
  const box = document.createElement("div");
  box.id = "ticket-overlay";
  box.className = "modal";
  box.innerHTML = `<div class="modal-content ticket-overlay-content">
      <div class="ticket-overlay-actions">
        <button class="primary-btn" type="button" id="ticket-overlay-print">🖨️ Imprimer</button>
        <button class="secondary-btn" type="button" onclick="posImprimerDernier()">🧾 POS-80</button>
        <button class="secondary-btn" type="button" id="ticket-overlay-close">Fermer</button>
      </div>
      <iframe id="ticket-overlay-frame" title="Ticket"></iframe>
    </div>`;
  document.body.appendChild(box);
  const frame = box.querySelector("iframe");
  frame.srcdoc = html;
  box.querySelector("#ticket-overlay-close").onclick = () => box.remove();
  box.querySelector("#ticket-overlay-print").onclick = () => { try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch (e) {} };
  box.addEventListener("click", (e) => { if (e.target === box) box.remove(); });
}

// Bloc fidélité (cumul d'achats → -10 % à 100 000 F)
function ticketFideliteHtml(clientId) {
  const client = clientId ? (clients || []).find((c) => String(c.id) === String(clientId)) : null;
  if (!client || typeof getClientStats !== "function") {
    return `<div class="bloc">📲 Donnez votre numéro à chaque achat : vos achats sont cumulés pour -10 % et votre remise anniversaire 🎁</div>`;
  }
  const cumul = getClientStats(client).total;
  const reste = FIDELITE_OBJECTIF - cumul;
  return reste > 0
    ? `<div class="bloc">⭐ Vos achats cumulés : <strong>${fmt(cumul)} F</strong><br>Plus que <strong>${fmt(reste)} F</strong> pour profiter de -10 % 🎁</div>`
    : `<div class="bloc">⭐ Vos achats cumulés : <strong>${fmt(cumul)} F</strong><br>Vous avez droit à votre réduction de -10 % 🎁</div>`;
}

// ---------- Ticket de caisse ----------
function openReceiptWindow(sale) {
  const items = sale.items || [];
  const sansPrix = items.length && items.every((i) => !Number(i.price));
  const lignes = items.map((i) => {
    let prix = Number(i.price) || 0;
    if (sansPrix) {
      // anciennes ventes sans prix unitaire enregistré
      if (items.length === 1 && Number(i.qty)) prix = Math.round((Number(sale.baseTotal) || (Number(sale.total) || 0) + (Number(sale.discountAmount) || 0)) / Number(i.qty));
      else prix = getCatalogPrice(i.name);
    }
    return { nom: i.name, qte: i.qty, prix };
  });
  const sousTotal = Number(sale.baseTotal) || lignes.reduce((s, l) => s + (Number(l.prix) || 0) * (Number(l.qte) || 0), 0) || Number(sale.total) || 0;
  const remises = [
    ["Remise promo", Number(sale.promoDiscount) || 0],
    ["Remise", Number(sale.manualDiscount) || 0],
    ["Remise anniversaire 🎂", Number(sale.birthdayDiscount) || 0]
  ].filter(([, v]) => v > 0);
  if (!remises.length && Number(sale.discountAmount) > 0) remises.push(["Remise", Number(sale.discountAmount)]);
  const totalRemises = remises.reduce((s, [, v]) => s + v, 0);
  const recap = totalRemises
    ? [["Sous-total", fmt(sousTotal) + " F"], ...remises.map(([l, v]) => [l, "- " + fmt(v) + " F", "small"])]
    : [];
  const client = sale.clientId ? (clients || []).find((c) => String(c.id) === String(sale.clientId)) : null;
  if (isRefundSale(sale)) {
    openTicketWindow(buildTicketHtml({
      titre: "TICKET DE REMBOURSEMENT",
      numero: String(sale.id || "").replace(/\D/g, "").slice(-6),
      date: sale.date,
      infos: [["Client", client ? client.name : sale.clientName], ["Motif", refundLabel(sale)]],
      lignes: lignes.map((l) => ({ ...l, qte: Math.abs(Number(l.qte) || 0) })),
      recap: [],
      totalLabel: "REMBOURSÉ",
      total: Math.abs(Number(sale.total) || 0),
      apresTotal: `<div class="row small"><span>Remboursé en</span><span>${proEscape(formatPaymentMethod(sale.paymentMethod))}</span></div>`,
      pied: `<div class="merci">Merci de votre visite 🧡</div>`
    }));
    return;
  }
  openTicketWindow(buildTicketHtml({
    titre: "",
    numero: String(sale.id || "").replace(/\D/g, "").slice(-6),
    date: sale.date,
    lignes,
    recap,
    total: sale.total,
    apresTotal: `<div class="row small"><span>Payé par</span><span>${proEscape(formatPaymentMethod(sale.paymentMethod))}</span></div>` +
      (sale.montantRecu != null ? `<div class="row small"><span>Reçu</span><span>${fmt(sale.montantRecu)} F</span></div><div class="row small"><span>Rendu</span><span>${fmt(sale.monnaie || 0)} F</span></div>` : "") +
      (sale.discountReason && totalRemises ? `<div class="small muted">${proEscape(sale.discountReason)}</div>` : "") +
      (totalRemises ? `<div class="encadre">🎉 Vous avez économisé ${fmt(totalRemises)} FCFA</div>` : ""),
    bloc: ((sale.clientName || client) ? `<div class="row small"><span>Client</span><span>${proEscape(client ? client.name : sale.clientName)}</span></div>` : "") +
      ticketFideliteHtml(sale.clientId)
  }));
}

// ✅ Réimprimer le ticket d'une vente déjà enregistrée (onglet Ventes)
function printSaleTicket(saleId) {
  const sale = (sales || []).find((s) => String(s.id) === String(saleId));
  if (!sale) return alert("Vente introuvable.");
  openReceiptWindow(sale);
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
    const isCouture = isServiceProduct(p);
    const threshold = getReorderThreshold(p);
    const low = !isCouture && (Number(p.stock) || 0) <= threshold;

    tr.innerHTML = `
      <td>${proEscape(p.name)}</td>
      <td>${fmt(p.price)} FCFA</td>
      <td class="${low ? "stock-low" : ""}">${isCouture ? "—" : fmt(p.stock)}${low ? " ⚠️" : ""}</td>
      <td>${isCouture ? "—" : `<input type="number" min="0" value="${threshold}" onchange="setReorderThreshold(${p.id}, this.value)" />`}</td>
      <td>
        ${isCouture ? "—" : `<input type="number" id="stock-input-${p.id}" value="${p.stock || 0}" min="0" />`}
      </td>
      <td>
        ${isCouture ? "" : `<button class="small-btn" onclick="updateProductStock(${p.id})">Mettre à jour</button>`}
        <button class="small-btn del-row" onclick="deleteProduct(${p.id})">Supprimer</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  renderStockValue();
  renderReorderTasks();
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
  renderProductsForSale();
  updateNavBadges();
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

function sendStockToSheetWithFallback() {
  stockEnvoyerDifferences();
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
      refreshProIfVisible();
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

  const startInput = document.getElementById("stock-history-start");
  const endInput = document.getElementById("stock-history-end");

  // ✅ le tableau ne s'affiche que si une période est choisie
  const hasPeriod = !!(startInput?.value || endInput?.value);
  document.getElementById("stock-history-table")?.classList.toggle("hidden", !hasPeriod);
  document.getElementById("stock-history-hint")?.classList.toggle("hidden", hasPeriod);
  if (!hasPeriod) return;

  if (!Array.isArray(stockHistory) || stockHistory.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="6">Aucun mouvement de stock enregistré.</td>`;
    tbody.appendChild(tr);
    return;
  }

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

function clearStockHistoryRange() {
  const s = document.getElementById("stock-history-start");
  const e = document.getElementById("stock-history-end");
  if (s) s.value = "";
  if (e) e.value = "";
  renderStockHistoryTable();
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
async function addExpense() {
  const labelInput = document.getElementById("expense-label");
  const amountInput = document.getElementById("expense-amount");
  const categorySelect = document.getElementById("expense-category");
  const sourceSelect = document.getElementById("expense-source");
  if (!labelInput || !amountInput) return;

  const motif = (labelInput.value || "").trim();
  const amount = Number(amountInput.value) || 0;
  const category = categorySelect ? categorySelect.value : "Autre";
  const source = sourceSelect ? sourceSelect.value : "caisse";

  if (!motif) return alert("Merci de renseigner le motif de la dépense.");
  if (amount <= 0) return alert("Merci de renseigner un montant valide.");

  // ✅ si payé avec la caisse, on vérifie qu'il y a assez d'espèces
  if (source === "caisse") {
    const available = computeCaisseBalance();
    if (amount > available &&
        !confirm(`La caisse affiche seulement ${fmt(available)} FCFA. Enregistrer quand même ?`)) {
      return;
    }
  }

  // ✅ payé avec le coffre : code obligatoire + solde suffisant
  if (source === "coffre") {
    const coffre = computeCoffreBalance();
    if (amount > coffre) {
      return alert(`Le coffre ne contient que ${fmt(coffre)} FCFA. Dépense non enregistrée.`);
    }
    const ok = await requirePassword({
      title: "🔐 Paiement avec le coffre",
      message: `Sortir <strong>${fmt(amount)} FCFA</strong> du coffre pour « ${proEscape(motif)} » ?`,
      messageIsHtml: true,
      confirmLabel: "Valider"
    });
    if (!ok) return;
  }

  const expense = createExpense({ category, motif, amount, source });

  // ✅ le coffre est diminué (même mouvement que « Décaisser du coffre »)
  if (source === "coffre") {
    addVaultMove({ at: expense.date, type: "withdraw", amount, motif, category, expenseId: String(expense.id) });
  }

  labelInput.value = "";
  amountInput.value = "";

  if (sourceSelect) sourceSelect.value = "caisse";

  renderExpensesTable();
  renderExpensesPie();
  refreshProIfVisible(); // met à jour caisse + coffre
  alert(source === "coffre" ? "Dépense enregistrée et retirée du coffre." : "Dépense enregistrée et retirée de la caisse.");
  return expense;
}

// ✅ Frais = uniquement les dépenses sorties de la caisse.
// Les anciennes dépenses « [coffre] » (décaissements) restent dans Google Sheets mais ne sont plus affichées ni comptées.
function fraisCaisse() {
  return (expenses || []).filter((e) => parseExpense(e).source !== "coffre");
}

// Crée + enregistre une dépense (utilisé par l'onglet Frais ET par le coffre)
// Le libellé est enregistré sous la forme « Catégorie : motif [caisse] » :
// comme ça la catégorie et la source restent même après rechargement depuis Google Sheets.
function createExpense({ category, motif, amount, source }) {
  const tag = source === "caisse" ? " [caisse]" : source === "coffre" ? " [coffre]" : "";
  const expense = {
    id: Date.now(),
    date: new Date().toISOString(),
    label: `${category} : ${motif}${tag}`,
    amount: Number(amount) || 0
  };

  if (!Array.isArray(expenses)) expenses = [];
  expenses.push(expense);
  saveExpenses(expenses);
  sendExpenseToSheet(expense);
  return expense;
}

// Lit un libellé de dépense → { category, motif, source }
function parseExpense(e) {
  let label = String(e?.label || "").trim();
  let source = "autre";
  const m = label.match(/\s*\[(caisse|coffre)\]\s*$/i);
  if (m) {
    source = m[1].toLowerCase();
    label = label.slice(0, m.index).trim();
  }
  let category = "Autre";
  let motif = label;
  const idx = label.indexOf(" : ");
  if (idx > 0) {
    category = label.slice(0, idx).trim();
    motif = label.slice(idx + 3).trim();
  } else {
    category = guessExpenseCategory(label);
  }
  return { category, motif, source };
}

// Pour les anciennes dépenses sans catégorie : on devine avec des mots-clés
function guessExpenseCategory(label) {
  const l = String(label || "").toLowerCase();
  const rules = [
    ["Loyer", ["loyer"]],
    ["Salaires", ["salaire", "paie", "employ"]],
    ["Marchandise / fournisseur", ["fournisseur", "marchandise", "achat", "stock", "commande"]],
    ["Transport / livraison", ["transport", "taxi", "livraison", "carburant", "essence", "yango"]],
    ["Électricité / eau / internet", ["senelec", "électricité", "electricite", "courant", "eau", "sen'eau", "internet", "wifi", "crédit tel", "credit tel"]],
    ["Emballages", ["emballage", "sachet", "carton", "flacon"]],
    ["Publicité", ["pub", "sponsor", "facebook", "instagram", "tiktok"]],
    ["Nourriture", ["repas", "manger", "déjeuner", "dejeuner", "nourriture"]],
    ["Entretien / réparation", ["entretien", "réparation", "reparation", "nettoyage"]]
  ];
  for (const [cat, words] of rules) {
    if (words.some((w) => l.includes(w))) return cat;
  }
  return "Autre";
}

const EXPENSE_CATEGORIES = [
  "Loyer",
  "Salaires",
  "Marchandise / fournisseur",
  "Transport / livraison",
  "Électricité / eau / internet",
  "Emballages",
  "Publicité",
  "Nourriture",
  "Entretien / réparation",
  "Autre"
];

function fillExpenseCategorySelect(select) {
  if (!select) return;
  select.innerHTML = EXPENSE_CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join("");
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

  const startInput = document.getElementById("expense-history-start");
  const endInput = document.getElementById("expense-history-end");

  // ✅ le tableau ne s'affiche que si une période est choisie
  const hasPeriod = !!(startInput?.value || endInput?.value);
  document.getElementById("expense-history-table")?.classList.toggle("hidden", !hasPeriod);
  document.getElementById("expense-history-hint")?.classList.toggle("hidden", hasPeriod);
  renderExpensesPie();
  if (!hasPeriod) return;

  if (!Array.isArray(expenses) || expenses.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="6">Aucune dépense enregistrée.</td>`;
    tbody.appendChild(tr);
    return;
  }

  let start = null;
  let end = null;

  if (startInput && startInput.value) start = new Date(startInput.value + "T00:00:00");
  if (endInput && endInput.value) end = new Date(endInput.value + "T23:59:59");

  const sorted = fraisCaisse().sort((a, b) => new Date(b.date) - new Date(a.date));
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
    tr.innerHTML = `<td colspan="6">Aucune dépense pour cette période.</td>`;
    tbody.appendChild(tr);
    return;
  }

  const SOURCE_LABELS = { caisse: "Caisse", coffre: "Coffre", autre: "Autre" };
  let total = 0;

  filtered.forEach((e) => {
    const d = new Date(e.date);
    const dateStr = isNaN(d.getTime()) ? e.date : d.toLocaleString("fr-FR");
    const info = parseExpense(e);
    total += Number(e.amount) || 0;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${dateStr}</td>
      <td>${proEscape(info.category)}</td>
      <td>${proEscape(info.motif)}</td>
      <td><span class="badge ${info.source === "coffre" ? "warn" : "neutral"}">${SOURCE_LABELS[info.source]}</span></td>
      <td>${fmt(e.amount)} FCFA</td>
      <td><button type="button" class="small-btn danger-btn" title="Supprimer ce frais" onclick="supprimerFrais('${proEscape(String(e.id))}', '${proEscape(String(e.date))}')">🗑️</button></td>
    `;
    tbody.appendChild(tr);
  });

  const trTotal = document.createElement("tr");
  trTotal.innerHTML = `<td colspan="6" style="text-align:right;"><strong>Total : ${fmt(total)} FCFA</strong></td>`;
  tbody.appendChild(trTotal);
}

// ✅ Supprimer un frais (code 0507) : retiré de Google Sheets, l'argent revient dans la caisse
async function supprimerFrais(id, date) {
  const e = (expenses || []).find((x) => String(x.id) === String(id) && String(x.date) === String(date));
  if (!e) return alert("Frais introuvable. Recharge la page.");
  const info = parseExpense(e);
  const d = new Date(e.date);
  const quand = isNaN(d.getTime()) ? e.date : d.toLocaleString("fr-FR");
  const liv = /Livraison CMD-/i.test(e.label || "")
    ? `<br><br>⚠️ Ce frais vient d'une livraison : la commande restera « Livrée ».`
    : "";
  const ok = await requireDeletePassword(
    `Supprimer ce frais ?<br><br><strong>${proEscape(info.category)}</strong> : ${proEscape(info.motif)}<br>` +
    `${fmt(e.amount)} FCFA • ${proEscape(quand)}<br><br>Les ${fmt(e.amount)} FCFA reviendront dans « Argent dans la caisse ».${liv}`,
    true
  );
  if (!ok) return;

  let r;
  try {
    r = await stockJsonp("deleteExpense", { code: DELETE_PASSWORD, date: isNaN(d.getTime()) ? e.date : d.toISOString(), label: e.label || "", amount: Number(e.amount) || 0 });
  } catch (err) {
    return alert("⚠️ Pas de réponse de Google Sheets (" + err.message + "). Le frais n'a pas été supprimé, réessaie.");
  }
  if (!r || !r.ok) {
    const msg = r && r.error ? r.error : "";
    if (/unknown action/i.test(msg)) return alert("⚠️ Le script Google (Code.gs) n'est pas encore à jour : remplace-le puis fais « Nouvelle version ».");
    return alert("⚠️ Suppression impossible : " + (msg || "erreur inconnue"));
  }
  expenses = expenses.filter((x) => x !== e);
  saveExpenses(expenses);
  renderExpensesTable();
  renderCaisseBox();
  refreshProIfVisible();
  alert("✅ Frais supprimé.");
}

function clearExpenseHistoryRange() {
  const s = document.getElementById("expense-history-start");
  const e = document.getElementById("expense-history-end");
  if (s) s.value = "";
  if (e) e.value = "";
  renderExpensesTable();
}

// ✅ CAMEMBERT DES FRAIS (suit la période choisie, sinon : ce mois)
let expensesPieChart = null;
const PIE_COLORS = ["#ec4899", "#f97316", "#facc15", "#10b981", "#3b82f6", "#8b5cf6", "#14b8a6", "#ef4444", "#64748b", "#a3a3a3"];

function renderExpensesPie() {
  const canvas = document.getElementById("expenses-pie");
  const legend = document.getElementById("expenses-pie-legend");
  if (!canvas || !legend) return;

  const startVal = document.getElementById("expense-history-start")?.value;
  const endVal = document.getElementById("expense-history-end")?.value;
  let from, to, label;
  if (startVal || endVal) {
    from = startVal || "0000-01-01";
    to = endVal || "9999-12-31";
    label = startVal && endVal
      ? (startVal === endVal ? `le ${fmtDateFr(startVal)}` : `du ${fmtDateFr(startVal)} au ${fmtDateFr(endVal)}`)
      : "période choisie";
  } else {
    const r = getProRange("month", todayLocalStr());
    from = r.from; to = r.to; label = "ce mois";
  }

  const byCat = {};
  let total = 0;
  fraisCaisse().forEach((e) => {
    const k = dateKeyOf(e.date);
    if (!k || k < from || k > to) return;
    const cat = parseExpense(e).category;
    const amount = Number(e.amount) || 0;
    byCat[cat] = (byCat[cat] || 0) + amount;
    total += amount;
  });

  const entries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);

  if (expensesPieChart) { expensesPieChart.destroy(); expensesPieChart = null; }

  if (!entries.length) {
    legend.innerHTML = `<p class="help-text">Aucune dépense ${label}.</p>`;
    return;
  }

  legend.innerHTML =
    `<div class="help-text" style="margin-bottom:6px;">Répartition ${label} — total <strong>${fmt(total)} FCFA</strong></div>` +
    entries.map(([cat, amount], i) => `
      <div class="pie-legend-row">
        <span class="pie-dot" style="background:${PIE_COLORS[i % PIE_COLORS.length]}"></span>
        <span>${i === 0 ? "🥇 " : ""}${proEscape(cat)}</span>
        <strong>${fmt(amount)}</strong>
        <span class="pie-pct">${Math.round((amount / total) * 100)}%</span>
      </div>`).join("");

  if (typeof Chart === "undefined") return;
  expensesPieChart = new Chart(canvas, {
    type: "pie",
    data: {
      labels: entries.map((e) => e[0]),
      datasets: [{
        data: entries.map((e) => e[1]),
        backgroundColor: entries.map((_, i) => PIE_COLORS[i % PIE_COLORS.length]),
        borderColor: "#ffffff",
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.label} : ${fmt(ctx.raw)} FCFA (${Math.round((ctx.raw / total) * 100)}%)`
          }
        }
      }
    }
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

// ✅ Statistiques d'un client : achats (ventes caisse + livraisons), adresse de livraison
// index des ventes et livraisons par client (recalculé seulement quand les données changent)
let clientIndexCache = { key: null };
function getClientIndex() {
  const livs = typeof liv !== "undefined" ? liv.commandes || [] : [];
  const key = [sales, (sales || []).length, livs, livs.length];
  const c = clientIndexCache;
  if (c.key && c.key.every((v, i) => v === key[i])) return c;
  const byId = {}, byPhone = {}, livByPhone = {};
  (sales || []).forEach((s) => {
    if (s.clientId) (byId[String(s.clientId)] = byId[String(s.clientId)] || []).push(s);
    else { const k = clientPhoneKey(s.clientPhone); if (k.length >= 9) (byPhone[k] = byPhone[k] || []).push(s); }
  });
  livs.forEach((l) => { const k = clientPhoneKey(l["Téléphone"]); if (k.length >= 9) (livByPhone[k] = livByPhone[k] || []).push(l); });
  clientIndexCache = { key, byId, byPhone, livByPhone };
  return clientIndexCache;
}

function getClientStats(c) {
  const k = clientPhoneKey(c.phone);
  const idx = getClientIndex();
  const achats = (idx.byId[String(c.id)] || []).concat(k.length >= 9 ? idx.byPhone[k] || [] : []);
  const vraisAchats = achats.filter((s) => !isRefundSale(s)); // un remboursement n'est pas un achat
  const dates = vraisAchats.map((s) => s.date).filter((d) => !isNaN(new Date(d).getTime()))
    .sort((a, b) => new Date(a) - new Date(b));
  const livs = (k.length >= 9 ? idx.livByPhone[k] || [] : []).slice()
    .sort((a, b) => String(a["Créée le"]).localeCompare(String(b["Créée le"])));
  const avecAdresse = livs.filter((l) => l["Adresse"]);
  const derniere = avecAdresse[avecAdresse.length - 1];
  const total = achats.reduce((sum, s) => sum + (Number(s.total) || 0), 0);
  const dernier = dates[dates.length - 1] || null;
  const derniereVente = dernier ? vraisAchats.filter((s) => s.date === dernier)[0] : null;
  const derniersProduits = derniereVente
    ? (derniereVente.items || []).map((i) => i.name).filter((n) => n && !PRO_NON_PRODUCT_ITEMS.includes(proKey(n)))
    : [];
  return {
    achats: vraisAchats.length,
    total,
    panier: vraisAchats.length ? total / vraisAchats.length : 0,
    premier: dates[0] || null,
    dernier,
    derniersProduits,
    joursDepuis: dernier ? Math.floor((Date.now() - new Date(dernier).getTime()) / 86400000) : null,
    heuresDepuis: dernier ? (Date.now() - new Date(dernier).getTime()) / 3600000 : null,
    adresse: derniere ? derniere["Adresse"] : "",
    repere: derniere ? derniere["Repère"] || "" : "",
    livraisons: livs.length,
    source: livs.length ? livs[0]["Source"] || "" : ""
  };
}

function joursAvantAnniversaire(c) {
  const dob = parseClientBirthdate(c);
  if (!dob) return 999;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let next = new Date(now.getFullYear(), dob.getMonth(), dob.getDate());
  if (next < today) next.setFullYear(now.getFullYear() + 1);
  return Math.round((next - today) / 86400000);
}

function joursTexte(j) {
  if (j === null || j === undefined) return "—";
  if (j === 0) return "aujourd'hui";
  if (j === 1) return "hier";
  if (j < 60) return `il y a ${j} j`;
  return `il y a ${Math.round(j / 30)} mois`;
}

// L'onglet Clients n'affiche plus qu'une seule liste : « Classements & relances » (catégorie « Tous » par défaut)
function renderClientsTable() {
  renderBirthdaySection();
  renderRelances();
}

// =====================================================================
// ================== ✅ CLASSEMENTS & RELANCES ==================
// =====================================================================
const RELANCE_KEY = "bsk_relances";            // { clientId: { at, cat } } (gardé sur cet appareil)
const RELANCE_MSG_KEY = "bsk_relance_messages";
const RELANCE_JOURS_DORMANT = 60;              // « pas commandé depuis 2 mois »
const FIDELITE_OBJECTIF = 100000;              // total d'achats qui donne droit à -10 %
const FIDELITE_PALIERS = [50000, 90000];       // caps où on prévient le client
// ajouté à la fin de TOUS les messages
const RAPPEL_COMPTE_CLIENT = "📲 Petit rappel : à chaque achat, donne ton numéro pour utiliser ton compte client BSK. C'est grâce à lui que tes achats sont cumulés pour ta réduction de -10 % et ta remise anniversaire 🎁";

const RELANCE_CATS = {
  tous: {
    help: "Tous les clients, ceux qui ont dépensé le plus en haut. Utilise la recherche pour trouver un nom, un numéro ou un quartier.",
    msg: "Bonjour {prenom} 👋\n\nC'est BSK ! Nous avons de nouveaux parfums et brumes en ce moment 😍\nRéponds à ce message si tu veux qu'on te conseille ou qu'on te livre.\n\nÀ très vite 💛"
  },
  vip: {
    help: "Les 20 clients qui ont dépensé le plus. Un petit message de remerciement les garde fidèles.",
    msg: "Bonjour {prenom} 💛\n\nTu fais partie de nos meilleures clientes chez BSK, merci pour ta confiance !\nPour te remercier, nous t'offrons une petite surprise sur ta prochaine commande cette semaine 🎁\n\nÀ très vite chez BSK !"
  },
  dormant: {
    help: `Clients qui ont déjà acheté mais rien depuis plus de ${RELANCE_JOURS_DORMANT} jours. Les plus gros clients sont en haut : commence par eux.`,
    msg: "Bonjour {prenom} 👋\n\nÇa fait longtemps qu'on ne t'a pas vue chez BSK ! Nous avons reçu de nouveaux parfums et brumes qui devraient te plaire 😍\n\nRéponds à ce message et on te livre où tu veux. À très vite 💛"
  },
  nouveau: {
    help: "Clients avec un seul achat il y a 7 à 45 jours. C'est le bon moment pour les faire revenir une 2e fois.",
    msg: "Bonjour {prenom} 😊\n\nMerci encore pour ton premier achat chez BSK ! Est-ce que ton parfum te plaît ?\n\nSi tu veux découvrir d'autres senteurs, on peut te conseiller et te livrer directement 💛"
  },
  satisfaction: {
    help: "Clients qui ont acheté ces dernières 72 heures. Ceux qui ont déjà reçu l'enquête pour ce dernier achat passent en bas de la liste.",
    msg: "Bonjour {prenom} 👋🏽,\nmerci encore pour ton achat chez BSK !\nOn espère que tu as apprécié ton passage chez nous 🧡\n\nSi tu as un moment, dis-nous ce que tu as pensé de ton expérience et du produit que tu as acheté. Ton retour compte beaucoup pour nous 🙏🏽\nTu peux répondre directement ici, ça ne prend qu’une minute 😊\n\nMerci pour ta confiance !\n— L’équipe BSK"
  },
  palier50: {
    help: "Clients qui ont cumulé entre 50 000 et 89 999 FCFA d'achats : on leur dit combien il leur reste pour avoir -10 %.",
    msg: "Bonjour {prenom} 👋🏽,\n\nMerci pour ta fidélité chez BSK 🧡\nTu as déjà cumulé {total} d'achats avec nous !\nPlus que {reste} et tu profites de -10 % de réduction 🎁\n\nÀ très vite chez BSK !"
  },
  palier90: {
    help: "Clients qui ont cumulé entre 90 000 et 99 999 FCFA d'achats : ils sont tout près de leur réduction de -10 %.",
    msg: "Bonjour {prenom} 👋🏽,\n\nBravo, tu as cumulé {total} d'achats chez BSK 🎉\nIl ne te reste plus que {reste} pour débloquer ta réduction de -10 % 🎁\nC'est le moment de te faire plaisir 😉\n\nÀ très vite chez BSK !"
  },
  anniversaire: {
    help: "Clients dont l'anniversaire est dans les 72 heures (date de naissance renseignée dans la fiche). La remise anniversaire de -30 % s'applique toute seule en caisse quand le client est choisi.",
    msg: "Joyeux anniversaire {prenom} 🎉🥳\n\nToute l'équipe BSK te souhaite une magnifique journée 🧡\nPour l'occasion, tu bénéficies de -30 % sur toute la boutique, valable 72h 🎁\n\nÀ très vite chez BSK !"
  },
  jamais: {
    help: "Clients enregistrés qui n'ont encore rien acheté (contact pris, live, demande de prix…).",
    msg: "Bonjour {prenom} 👋\n\nC'est BSK ! Tu nous avais contactés, est-ce qu'on peut t'aider à choisir ton parfum ?\nNous livrons partout à Dakar 🛵\n\nÀ très vite 💛"
  }
};

let relanceCat = "tous";

function loadRelances() {
  try { return JSON.parse(localStorage.getItem(RELANCE_KEY) || "{}"); } catch (e) { return {}; }
}
function loadRelanceMessages() {
  try { return JSON.parse(localStorage.getItem(RELANCE_MSG_KEY) || "{}"); } catch (e) { return {}; }
}
function getRelanceMessage(cat) {
  return loadRelanceMessages()[cat] || RELANCE_CATS[cat].msg;
}
function saveRelanceMessage(text) {
  const all = loadRelanceMessages();
  all[relanceCat] = text;
  try { localStorage.setItem(RELANCE_MSG_KEY, JSON.stringify(all)); } catch (e) {}
}
function resetRelanceMessage() {
  const all = loadRelanceMessages();
  delete all[relanceCat];
  try { localStorage.setItem(RELANCE_MSG_KEY, JSON.stringify(all)); } catch (e) {}
  document.getElementById("relance-message").value = RELANCE_CATS[relanceCat].msg;
}

function setRelanceCat(cat) {
  relanceCat = cat;
  renderRelances();
}

function computeRelanceLists() {
  const all = (clients || []).map((c) => ({ c, st: getClientStats(c) }));
  const relances = loadRelances();
  const dejaRelance = (x) => {
    const r = relances[String(x.c.id)];
    return r ? Math.floor((Date.now() - new Date(r.at).getTime()) / 86400000) : null;
  };
  all.forEach((x) => { x.relanceJours = dejaRelance(x); });

  const vip = all.filter((x) => x.st.total > 0).sort((a, b) => b.st.total - a.st.total).slice(0, 20);
  const dormant = all.filter((x) => x.st.achats > 0 && x.st.joursDepuis >= RELANCE_JOURS_DORMANT)
    // pas encore relancés d'abord (ou relancés il y a plus de 30 j), puis les plus gros clients
    .sort((a, b) => ((a.relanceJours !== null && a.relanceJours < 30) - (b.relanceJours !== null && b.relanceJours < 30)) || b.st.total - a.st.total);
  const nouveau = all.filter((x) => x.st.achats === 1 && x.st.joursDepuis >= 7 && x.st.joursDepuis <= 45)
    .sort((a, b) => a.st.joursDepuis - b.st.joursDepuis);
  // enquête déjà envoyée après le dernier achat ?
  all.forEach((x) => {
    const e = relances["sat:" + String(x.c.id)];
    x.enqueteFaite = !!(e && x.st.dernier && new Date(e.at) >= new Date(x.st.dernier));
  });
  const satisfaction = all.filter((x) => x.st.heuresDepuis !== null && x.st.heuresDepuis <= 72)
    .sort((a, b) => (a.enqueteFaite - b.enqueteFaite) || a.st.heuresDepuis - b.st.heuresDepuis);

  // caps de fidélité : message envoyé une seule fois par cap
  const [p50, p90] = FIDELITE_PALIERS;
  all.forEach((x) => {
    x.palierFait = { palier50: !!relances["palier50:" + x.c.id], palier90: !!relances["palier90:" + x.c.id] };
    const a = relances["anniversaire:" + x.c.id];
    x.annivFait = !!(a && Date.now() - new Date(a.at).getTime() < 30 * 86400000);
  });
  const palier50 = all.filter((x) => x.st.total >= p50 && x.st.total < p90)
    .sort((a, b) => (a.palierFait.palier50 - b.palierFait.palier50) || b.st.total - a.st.total);
  const palier90 = all.filter((x) => x.st.total >= p90 && x.st.total < FIDELITE_OBJECTIF)
    .sort((a, b) => (a.palierFait.palier90 - b.palierFait.palier90) || b.st.total - a.st.total);

  // anniversaires dans les 72h (le plus proche en premier)
  const anniversaire = all.filter((x) => isClientBirthdaySoon(x.c))
    .sort((a, b) => (a.annivFait - b.annivFait) || joursAvantAnniversaire(a.c) - joursAvantAnniversaire(b.c));
  const jamais = all.filter((x) => x.st.achats === 0)
    .sort((a, b) => new Date(b.c.createdAt || 0) - new Date(a.c.createdAt || 0));
  const tous = all.slice().sort((a, b) => b.st.total - a.st.total || String(a.c.name).localeCompare(String(b.c.name), "fr"));
  return { vip, dormant, nouveau, jamais, satisfaction, palier50, palier90, anniversaire, tous, all };
}

function renderRelances() {
  const tbody = document.getElementById("relance-body");
  if (!tbody) return;
  const L = computeRelanceLists();

  // chiffres clés
  const actifs = L.all.filter((x) => x.st.joursDepuis !== null && x.st.joursDepuis < RELANCE_JOURS_DORMANT).length;
  const caDormant = L.dormant.reduce((s, x) => s + x.st.panier, 0);
  const kpis = document.getElementById("relance-kpis");
  if (kpis) kpis.innerHTML =
    `<div class="card"><div class="label">Clients actifs (achat < 2 mois)</div><div class="value">${fmt(actifs)}</div></div>` +
    `<div class="card"><div class="label">À relancer (+2 mois)</div><div class="value">${fmt(L.dormant.length)}</div><div class="sub">≈ ${fmt(caDormant)} FCFA si chacun revient 1 fois</div></div>` +
    `<div class="card"><div class="label">Nouveaux à fidéliser</div><div class="value">${fmt(L.nouveau.length)}</div></div>` +
    `<div class="card"><div class="label">Jamais acheté</div><div class="value">${fmt(L.jamais.length)}</div></div>`;

  document.querySelectorAll(".relance-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.cat === relanceCat);
    const n = L[b.dataset.cat].length;
    if (!b.dataset.label) b.dataset.label = b.textContent.trim();
    b.textContent = `${b.dataset.label} (${n})`;
  });
  document.getElementById("relance-help").textContent = RELANCE_CATS[relanceCat].help;
  const ta = document.getElementById("relance-message");
  if (ta && document.activeElement !== ta) ta.value = getRelanceMessage(relanceCat);

  // recherche (nom, téléphone, quartier) appliquée à la liste affichée
  const term = (document.getElementById("client-search")?.value || "").trim().toLowerCase();
  const termTel = clientPhoneKey(term);
  const list = L[relanceCat].filter((x) => !term ||
    (x.c.name || "").toLowerCase().includes(term) ||
    (termTel.length >= 3 && clientPhoneKey(x.c.phone).includes(termTel)) ||
    (x.st.adresse || "").toLowerCase().includes(term));
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="7">${term ? "Aucun client trouvé." : "Personne dans cette liste pour le moment 👍"}</td></tr>`;
    return;
  }
  const max = relanceCat === "tous" ? 500 : 100;
  tbody.innerHTML = list.slice(0, max).map((x, i) => {
    const { c, st } = x;
    const rang = (relanceCat === "vip" || relanceCat === "tous") && st.total > 0 ? (i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1) : i + 1;
    const sat = relanceCat === "satisfaction";
    const palier = relanceCat === "palier50" || relanceCat === "palier90";
    const anniv = relanceCat === "anniversaire";
    const relance = sat
      ? (x.enqueteFaite ? `<small class="text-pos">✅ enquête envoyée</small><br>` : "")
      : palier ? (x.palierFait[relanceCat] ? `<small class="text-pos">✅ message envoyé</small><br>` : "")
      : anniv ? (x.annivFait ? `<small class="text-pos">✅ souhaité</small><br>` : "")
      : x.relanceJours !== null
      ? `<small class="${x.relanceJours < 30 ? "text-pos" : "help-text"}">✅ relancé ${joursTexte(x.relanceJours)}</small><br>` : "";
    const wa = clientPhoneKey(c.phone).length >= 9;
    const faite = sat ? x.enqueteFaite : palier ? x.palierFait[relanceCat] : anniv ? x.annivFait
      : x.relanceJours !== null && x.relanceJours < 30;
    return `<tr class="${faite ? "relance-faite" : ""}">
      <td>${rang}</td>
      <td><strong>${proEscape(c.name)}</strong>${isClientBirthdaySoon(c) ? " 🎂" : ""}<br><small>${proEscape(c.phone || "pas de numéro")}</small>${sat && st.derniersProduits.length ? `<br><small class="help-text">🛍️ ${proEscape(st.derniersProduits.join(", "))}</small>` : ""}</td>
      <td>${st.adresse ? proEscape(st.adresse) : "—"}</td>
      <td>${st.achats}${st.livraisons ? ` <small class="help-text">(${st.livraisons} livr.)</small>` : ""}</td>
      <td>${fmt(st.total)} FCFA${palier ? `<br><small class="text-neg">reste ${fmt(FIDELITE_OBJECTIF - st.total)} pour -10 %</small>`
        : anniv ? `<br><small class="help-text">🎂 ${formatBirthdateShort(c.birthdate)} (${joursAvantAnniversaire(c) === 0 ? "aujourd'hui" : "dans " + joursAvantAnniversaire(c) + " j"})</small>`
        : st.achats > 1 ? `<br><small class="help-text">panier ${fmt(st.panier)}</small>` : ""}</td>
      <td>${sat && st.heuresDepuis !== null ? (st.heuresDepuis < 24 ? `il y a ${Math.max(1, Math.round(st.heuresDepuis))} h` : joursTexte(st.joursDepuis)) : joursTexte(st.joursDepuis)}</td>
      <td>${relance}<button class="small-btn" onclick="openClientPopup('${c.id}')">Détails</button>
        ${wa ? `<button class="small-btn" onclick="relancerClient('${c.id}')">💬 WhatsApp</button>` : `<small class="help-text">pas de numéro</small>`}</td>
    </tr>`;
  }).join("") + (list.length > max ? `<tr><td colspan="7" class="help-text">… et ${list.length - max} autres : utilise la recherche.</td></tr>` : "");
}

// Ouvre WhatsApp avec le message de la liste et note la relance (date) sur cet appareil
function relancerClient(clientId) {
  const c = (clients || []).find((x) => String(x.id) === String(clientId));
  if (!c) return;
  let prenom = String(c.name || "").trim().split(/\s+/)[0] || "";
  if (/^client$/i.test(prenom) || !/[^\W\d_]/.test(prenom)) prenom = ""; // « Client WhatsApp » → pas de prénom
  const st = getClientStats(c);
  const msg = (getRelanceMessage(relanceCat).trim() + "\n\n" + RAPPEL_COMPTE_CLIENT)
    .replace(/\{prenom\}/g, prenom)
    .replace(/\{total\}/g, fmt(st.total) + " FCFA")
    .replace(/\{reste\}/g, fmt(Math.max(0, FIDELITE_OBJECTIF - st.total)) + " FCFA")
    .replace(/[ \t]+,/g, ",")           // prénom vide : « Bonjour  , » → « Bonjour, »
    .replace(/[ \t]{2,}/g, " ");
  const k = clientPhoneKey(c.phone);
  window.open(`https://wa.me/221${k}?text=${encodeURIComponent(msg)}`, "_blank");
  const r = loadRelances();
  r[String(c.id)] = { at: new Date().toISOString(), cat: relanceCat };
  if (relanceCat === "satisfaction") r["sat:" + String(c.id)] = { at: new Date().toISOString() };
  if (["palier50", "palier90", "anniversaire"].includes(relanceCat)) r[relanceCat + ":" + String(c.id)] = { at: new Date().toISOString() };
  try { localStorage.setItem(RELANCE_KEY, JSON.stringify(r)); } catch (e) {}
  renderRelances();
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
    `À très vite chez BSK 💛\n\n` + RAPPEL_COMPTE_CLIENT;

  if (c.phone) {
    const phoneClean = "221" + clientPhoneKey(c.phone);
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

  // ✅ adresse de livraison + résumé
  const extra = document.getElementById("popup-client-extra");
  if (extra) {
    const st = getClientStats(c);
    extra.innerHTML =
      `<div><strong>Adresse :</strong> ${st.adresse ? proEscape(st.adresse) : "—"}${st.repere ? ` <small class="help-text">(${proEscape(st.repere)})</small>` : ""}</div>` +
      (c.birthdate ? `<div><strong>Anniversaire :</strong> ${formatBirthdateShort(c.birthdate)}${isClientBirthdaySoon(c) ? " 🎂" : ""}</div>` : "") +
      `<div><strong>Achats :</strong> ${st.achats} • <strong>Total :</strong> ${fmt(st.total)} FCFA • <strong>Dernier achat :</strong> ${joursTexte(st.joursDepuis)}</div>` +
      (st.livraisons ? `<div><strong>Livraisons :</strong> ${st.livraisons}${st.source ? ` • 1re commande via ${proEscape(st.source)}` : ""}</div>` : "") +
      (clientPhoneKey(c.phone).length >= 9
        ? `<button class="secondary-btn small-btn" onclick="window.open('https://wa.me/221${clientPhoneKey(c.phone)}','_blank')">💬 Écrire sur WhatsApp</button>` : "");
  }

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

// =====================================================================
// ================== ✅ EXPORT DE LA BASE CLIENTS (code obligatoire) ==================
// =====================================================================
// Fichier .csv (séparateur « ; ») qui s'ouvre directement dans Excel en français.
function exportDateFr(v) {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString("fr-FR");
}

// Date de naissance : on garde le jour tel quel (pas de décalage de fuseau)
function exportBirthdate(v) {
  if (!v) return "";
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return fmtDateFr(s);
  const d = new Date(v);
  if (isNaN(d.getTime())) return s;
  // valeur Google Sheets (minuit heure locale du script) : on arrondit au jour le plus proche
  const r = new Date(d.getTime() + 12 * 3600 * 1000);
  return `${String(r.getUTCDate()).padStart(2, "0")}/${String(r.getUTCMonth() + 1).padStart(2, "0")}/${r.getUTCFullYear()}`;
}

async function exportClientsDatabase() {
  const ok = await requirePassword({
    title: "🔒 Exporter la base clients",
    message: `Télécharger la liste des ${(clients || []).length} clients (noms, téléphones, achats) ?`,
    confirmLabel: "Télécharger"
  });
  if (!ok) return;

  const livs = typeof liv !== "undefined" ? liv.commandes || [] : [];
  const key = (p) => clientPhoneKey(p);

  const rows = (clients || []).map((c) => {
    const k = key(c.phone);
    const achats = (sales || []).filter((s) =>
      (s.clientId && String(s.clientId) === String(c.id)) || (!s.clientId && k.length >= 9 && key(s.clientPhone) === k));
    const total = achats.reduce((sum, s) => sum + (Number(s.total) || 0), 0);
    const dernier = achats.map((s) => s.date).filter(Boolean).sort().pop();
    const sesLivraisons = livs.filter((l) => k.length >= 9 && key(l["Téléphone"]) === k)
      .sort((a, b) => String(a["Créée le"]).localeCompare(String(b["Créée le"])));
    const derniereLiv = sesLivraisons[sesLivraisons.length - 1];
    return [
      c.name || "",
      c.phone || "",
      exportBirthdate(c.birthdate),
      exportDateFr(c.createdAt),
      achats.length,
      total,
      exportDateFr(dernier),
      sesLivraisons.length,
      derniereLiv ? derniereLiv["Adresse"] || "" : "",
      derniereLiv ? derniereLiv["Repère"] || "" : "",
      sesLivraisons.length ? sesLivraisons[0]["Source"] || "" : ""
    ];
  }).sort((a, b) => b[5] - a[5]); // meilleurs clients en premier

  const header = ["Nom", "Téléphone", "Date de naissance", "Client depuis", "Nombre d'achats",
    "Total dépensé (FCFA)", "Dernier achat", "Livraisons", "Adresse", "Repère", "Source (1re commande)"];

  const cell = (v) => {
    const s = String(v ?? "");
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // le téléphone est écrit ="..." pour qu'Excel garde les espaces et le 0 de tête
  const lines = [header, ...rows].map((r, i) => r.map((v, j) =>
    i > 0 && j === 1 && v ? `="${String(v).replace(/"/g, "")}"` : cell(v)).join(";"));
  const csv = "﻿" + lines.join("\r\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `BSK-clients-${todayLocalStr()}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
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

    const rembourse = isRefundSale(sale);
    const resteARembourser = rembourse ? 0 : refundableLines(sale).reduce((s, l) => s + l.reste, 0);
    if (rembourse) tr.className = "vente-remboursement";
    tr.innerHTML = `
      <td>${timeStr}</td>
      <td>${rembourse ? `<strong>↩️ Remboursement</strong><br><small>${proEscape(refundLabel(sale))}</small><br>` : ""}${productsHtml}</td>
      <td class="${rembourse ? "text-neg" : ""}">${fmt(amount)} FCFA</td>
      <td>${pm}</td>
      <td>
        ${clientLabel}<br>
        <!-- ✅ IMPORTANT: id en string -->
        <button class="secondary-btn" onclick="printSaleTicket('${sale.id}')">🧾 Ticket</button>
        ${resteARembourser > 0 ? `<button class="secondary-btn" onclick="openRefundModal('${sale.id}')">↩️ Rembourser</button>` : ""}
        ${!rembourse && resteARembourser === 0 ? `<small class="help-text">entièrement remboursée</small>` : ""}
        <button class="danger-btn" onclick="deleteSale('${sale.id}')">Supprimer</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// =====================================================================
// ✅ REMBOURSEMENT d'un produit déjà vendu (n'importe quel jour)
// =====================================================================
// Un remboursement = une « vente » négative enregistrée le jour du remboursement :
//   • elle diminue la caisse, le CA du jour, le total du client et le bénéfice (onglet Pro)
//   • le produit revient dans le stock
//   • elle garde la référence de la vente d'origine : [ref:date de la vente]
const REFUND_TAG = "Remboursement";

function isRefundSale(s) {
  return (Number(s.total) || 0) < 0 || String(s.discountReason || "").indexOf(REFUND_TAG) === 0;
}
function refundRef(sale) { return `[ref:${sale.date}]`; }
function refundLabel(s) { return String(s.discountReason || "").replace(/\s*\[ref:[^\]]*\]\s*$/, ""); }

// lignes encore remboursables d'une vente : quantité vendue − déjà remboursée
function refundableLines(sale) {
  const tag = refundRef(sale);
  const deja = {};
  (sales || []).filter((s) => isRefundSale(s) && String(s.discountReason || "").includes(tag))
    .forEach((s) => (s.items || []).forEach((i) => { deja[proKey(i.name)] = (deja[proKey(i.name)] || 0) + Math.abs(Number(i.qty) || 0); }));
  const items = (sale.items || []).filter((i) => i.name && !PRO_NON_PRODUCT_ITEMS.includes(proKey(i.name)));
  // prix réellement payé par pièce (remise répartie au prorata)
  const brut = (sale.items || []).reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.qty) || 0), 0);
  const ratio = brut > 0 ? Math.min(1, (Number(sale.total) || 0) / brut) : 1;
  return items.map((i) => {
    let prix = Number(i.price) || 0;
    if (!prix) prix = items.length === 1 && Number(i.qty) ? (Number(sale.total) || 0) / Number(i.qty) : getCatalogPrice(i.name);
    else prix = prix * ratio;
    const vendu = Number(i.qty) || 0;
    const rendu = Math.min(vendu, deja[proKey(i.name)] || 0);
    deja[proKey(i.name)] = (deja[proKey(i.name)] || 0) - rendu; // même produit sur 2 lignes
    return { productId: i.productId, nom: i.name, vendu, rendu, reste: vendu - rendu, prix: Math.round(prix) };
  });
}

function openRefundModal(saleId) {
  const sale = (sales || []).find((s) => String(s.id) === String(saleId));
  if (!sale) return alert("Vente introuvable.");
  const lignes = refundableLines(sale).filter((l) => l.reste > 0);
  if (!lignes.length) return alert("Cette vente a déjà été entièrement remboursée.");
  document.getElementById("refund-modal")?.remove();
  const d = new Date(sale.date);
  const box = document.createElement("div");
  box.id = "refund-modal";
  box.className = "modal";
  box.innerHTML = `<div class="modal-content" style="max-width:520px;">
    <h3 style="margin-top:0;">↩️ Remboursement</h3>
    <p class="help-text">Vente du ${d.toLocaleDateString("fr-FR")} à ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })} • ${fmt(sale.total)} FCFA${sale.clientName ? " • " + proEscape(sale.clientName) : ""}</p>
    <div class="conditions-rappel">Vérifie : <strong>ticket de caisse présenté</strong> et <strong>produit non utilisé</strong>.</div>
    <table class="refund-table">
      <thead><tr><th>Produit</th><th>Payé / pièce</th><th>Vendu</th><th>À rembourser</th></tr></thead>
      <tbody>${lignes.map((l, i) => `<tr>
        <td>${proEscape(l.nom)}${l.rendu ? `<br><small class="help-text">déjà remboursé : ${l.rendu}</small>` : ""}</td>
        <td>${fmt(l.prix)} F</td><td>${l.vendu}</td>
        <td><input type="number" min="0" max="${l.reste}" value="${lignes.length === 1 ? l.reste : 0}" data-i="${i}" class="refund-qty" /></td>
      </tr>`).join("")}</tbody>
    </table>
    <label>Montant à rembourser (FCFA)</label>
    <input type="number" id="refund-montant" min="0" />
    <label>Rembourser en</label>
    <select id="refund-mode">
      <option value="cash">💵 Espèces</option><option value="wave">📱 Wave</option><option value="orange">🟠 Orange Money</option>
    </select>
    <label>Motif</label>
    <input type="text" id="refund-motif" placeholder="Ex : ne convient pas, erreur de produit…" />
    <p class="help-text">Les produits remboursés reviennent dans le stock. Le montant sort de la caisse aujourd'hui.</p>
    <p id="refund-error" class="pro-error hidden"></p>
    <div class="modal-actions">
      <button type="button" class="danger-btn" id="refund-ok" style="margin-top:0;">↩️ Rembourser</button>
      <button type="button" class="secondary-btn" style="margin-top:0;" onclick="document.getElementById('refund-modal').remove()">Annuler</button>
    </div>
  </div>`;
  document.body.appendChild(box);
  const $ = (id) => box.querySelector("#" + id);
  $("refund-mode").value = ["cash", "wave", "orange"].includes(sale.paymentMethod) ? sale.paymentMethod : "cash";
  let montantModifie = false;
  const calc = () => {
    const total = [...box.querySelectorAll(".refund-qty")].reduce((s, inp) => s + (Number(inp.value) || 0) * lignes[inp.dataset.i].prix, 0);
    if (!montantModifie) $("refund-montant").value = total;
  };
  box.querySelectorAll(".refund-qty").forEach((inp) => inp.addEventListener("input", calc));
  $("refund-montant").addEventListener("input", () => { montantModifie = true; });
  calc();
  $("refund-ok").onclick = () => validerRemboursement(sale, lignes, box);
}

async function validerRemboursement(sale, lignes, box) {
  if (!stockPret()) return;
  const $ = (id) => box.querySelector("#" + id);
  const err = (m) => { $("refund-error").textContent = m; $("refund-error").classList.remove("hidden"); };
  const choix = [...box.querySelectorAll(".refund-qty")].map((inp) => ({ ...lignes[inp.dataset.i], q: Number(inp.value) || 0 }))
    .filter((l) => l.q > 0);
  for (const l of choix) if (l.q > l.reste) return err(`${l.nom} : maximum ${l.reste}.`);
  if (!choix.length) return err("Indique au moins un produit à rembourser.");
  const montant = Number($("refund-montant").value) || 0;
  if (montant <= 0) return err("Indique le montant à rembourser.");
  if (montant > Number(sale.total)) return err(`Le montant dépasse le prix payé (${fmt(sale.total)} FCFA).`);
  const mode = $("refund-mode").value;
  const motif = $("refund-motif").value.trim();

  box.classList.add("hidden");
  const ok = await requirePassword({
    title: "🔒 Remboursement",
    message: `Rembourser <strong>${fmt(montant)} FCFA</strong> (${choix.map((l) => l.q + " × " + proEscape(l.nom)).join(", ")}) en ${proEscape(formatPaymentMethod(mode))} ?`,
    messageIsHtml: true,
    confirmLabel: "Rembourser"
  });
  if (!ok) { box.classList.remove("hidden"); return; }
  box.remove();

  // 1) produits remis en stock
  choix.forEach((l) => {
    const p = products.find((x) => x.id === Number(l.productId)) || products.find((x) => proKey(x.name) === proKey(l.nom));
    if (!p || isServiceProduct(p)) return;
    const old = Number(p.stock) || 0;
    p.stock = old + l.q;
    logStockChangeToSheet({ date: new Date().toISOString(), productId: p.id, productName: p.name, oldStock: old, newStock: p.stock, delta: l.q, reason: `Remboursement${motif ? " : " + motif : ""}` });
  });
  saveProducts(products);
  sendStockToSheet(products);

  // 2) vente négative (sort de la caisse, diminue le CA et le total du client)
  const d = new Date(sale.date);
  const refund = {
    id: Date.now(),
    date: new Date().toISOString(),
    baseTotal: -montant,
    total: -montant,
    items: choix.map((l) => ({ productId: l.productId || 0, name: l.nom, qty: -l.q, price: l.prix, lineTotal: -l.q * l.prix })),
    paymentMethod: mode,
    promoDiscount: 0, manualDiscount: 0, birthdayDiscount: 0, discountAmount: 0,
    discountReason: `${REFUND_TAG} du ticket du ${d.toLocaleDateString("fr-FR")} ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}${motif ? " – " + motif : ""} ${refundRef(sale)}`,
    clientId: sale.clientId || "",
    clientName: sale.clientName || "",
    clientPhone: sale.clientPhone || "",
    wholesale: false
  };
  sales.push(refund);
  saveSales(sales);
  sendSaleToSheet(refund);
  lastTicketSale = refund;

  renderProductsForSale();
  renderProductsTable();
  updateSalesViewForSelectedDate();
  renderClientsTable();
  loadDashboardStats?.();
  refreshProIfVisible();
  updateNavBadges();
  if (confirm(`✅ Remboursement de ${fmt(montant)} FCFA enregistré.\nLes produits sont remis en stock.\n\nImprimer le ticket de remboursement ?`)) openReceiptWindow(refund);
}

// ================== VENTES : SUPPRESSION (CORRIGÉE) ==================
async function deleteSale(saleId) {
  const sale = (sales || []).find((s) => String(s.id) === String(saleId));
  const detail = sale ? ` de ${fmt(sale.total)} FCFA` : "";
  if (!(await requireDeletePassword(`Supprimer définitivement cette vente${detail} ?`))) return;

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

  // ✅ listes rupture / bientôt vide
  const outList = perfumes.filter((p) => p.level === "out");
  const halfList = perfumes.filter((p) => p.level === "half");
  const setHtml = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
  setHtml("perfume-out-count", outList.length);
  setHtml("perfume-half-count", halfList.length);
  setHtml("perfume-out-list", outList.length
    ? outList.map((p) => `<span class="chip">${proEscape(p.name)}</span>`).join("")
    : `<span class="help-text">Aucune rupture 👍</span>`);
  setHtml("perfume-half-list", halfList.length
    ? halfList.map((p) => `<span class="chip">${proEscape(p.name)}</span>`).join("")
    : `<span class="help-text">Rien à signaler</span>`);

  if (perfumes.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3">Aucune référence. Ajoute-en une ci-dessus.</td></tr>`;
    return;
  }

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
      <td>${proEscape(p.name)}</td>
      <td>
        <select onchange="changePerfumeLevel(${index}, this.value)">
          ${optionsHtml}
        </select>
      </td>
      <td>
        <button class="small-btn del-row" onclick="deletePerfume(${index})">Supprimer</button>
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

// ✅ ajouter une référence
function addPerfume() {
  const nameInput = document.getElementById("new-perfume-name");
  const levelSelect = document.getElementById("new-perfume-level");
  const name = (nameInput?.value || "").trim();
  if (!name) return alert("Indique le nom de la référence.");
  if (perfumes.some((p) => proKey(p.name) === proKey(name))) {
    return alert("Cette référence existe déjà.");
  }
  perfumes.push({ name, level: levelSelect?.value || "full" });
  perfumes.sort((a, b) => a.name.localeCompare(b.name, "fr"));
  nameInput.value = "";
  renderPerfumeBar();
  sendPerfumesToSheet();
}

// ✅ supprimer une référence
async function deletePerfume(index) {
  const p = perfumes[index];
  if (!p || !(await requireDeletePassword(`Supprimer la référence « ${p.name} » ?`))) return;
  perfumes.splice(index, 1);
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
  return fraisCaisse().filter(e => String(e.date || "").slice(0, 10) === dateStr);
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
          <td>${(() => { const i = parseExpense(exp); return proEscape(i.category + " : " + i.motif); })()}</td>
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
  includeExpenses: false,
  prime: { objectif: 3000000, taux: 5 }
};

// Lignes de vente qui ne sont pas des produits (pas de coût de revient)
const PRO_NON_PRODUCT_ITEMS = ["règlement crédit", "frais de livraison"];

const proState = { period: "month", refDate: null };

function loadProSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(PRO_SETTINGS_KEY) || "null");
    if (!raw) return JSON.parse(JSON.stringify(DEFAULT_PRO_SETTINGS));
    return {
      fixedCharges: Array.isArray(raw.fixedCharges) ? raw.fixedCharges : DEFAULT_PRO_SETTINGS.fixedCharges,
      costs: { ...DEFAULT_PRO_COSTS, ...(raw.costs || {}) },
      includeExpenses: !!raw.includeExpenses,
      prime: { ...DEFAULT_PRO_SETTINGS.prime, ...(raw.prime || {}) }
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
  const periodExpenses = fraisCaisse()
    .filter((e) => inRange(e.date))
    .reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const deductedExpenses = proSettings.includeExpenses ? periodExpenses : 0;

  // 4) Testeurs & casse : produits sortis du stock sans être vendus (au coût de revient)
  const pertesCost = getPertes()
    .filter((x) => inRange(x.date))
    .reduce((s, x) => s + x.qty * (getUnitCost(x.productName) || 0), 0);

  const grossMargin = revenue - cogs;
  const fixed = fixedForPeriod(period);
  const totalCharges = fixed + deductedExpenses + pertesCost;
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
    totalCharges, net, marginRate, breakEven, unitsNeeded, byProduct, discounts, pertesCost,
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
  renderBilanView();
  renderCoffreView();
  applyViewLock("produits");
  applyViewLock("dashboard");
  applyViewLock("b2b");
  applyViewLock("pertes");
}

// ✅ Verrou des onglets Produits et Tableau de bord (même code, même déverrouillage)
// Renvoie true si l'onglet est déverrouillé.
function applyViewLock(view) {
  const lock = document.getElementById(`lock-${view}`);
  const content = document.getElementById(`${view}-content`);
  if (!lock || !content) return true;
  const unlocked = isProUnlocked();
  lock.classList.toggle("hidden", unlocked);
  content.classList.toggle("hidden", !unlocked);
  if (!unlocked) {
    const input = document.getElementById(`lock-${view}-input`);
    const v = document.getElementById(`view-${view}`);
    if (input && v && !v.classList.contains("hidden")) setTimeout(() => input.focus(), 50);
  }
  return unlocked;
}

function unlockView(e, view) {
  if (e) e.preventDefault();
  const input = document.getElementById(`lock-${view}-input`);
  const err = document.getElementById(`lock-${view}-error`);
  if (input.value === PRO_PASSWORD) {
    sessionStorage.setItem(PRO_UNLOCK_KEY, "1");
    input.value = "";
    err.classList.add("hidden");
    showView(view); // affiche et calcule l'onglet
  } else {
    input.value = "";
    err.classList.remove("hidden");
    input.focus();
  }
}

// ---------- Affichage ----------
// Appelée après chaque chargement depuis Google Sheets / chaque vente :
// met à jour tout ce qui est affiché (caisse, coffre, pro, bilan, badges…)
function refreshProIfVisible() {
  const isVisible = (id) => {
    const v = document.getElementById(id);
    return v && !v.classList.contains("hidden");
  };
  if (isVisible("view-pro") && isProUnlocked()) renderProNumbers();
  if (isVisible("view-bilan") && isProUnlocked()) renderBilanNumbers();
  if (isVisible("view-coffre")) renderCoffreView();
  if (isVisible("view-produits") && isProUnlocked()) { renderStockValue(); renderReorderTasks(); }
  if (isVisible("view-pertes") && isProUnlocked()) renderPertesView();
  if (isVisible("view-caisse")) renderTesteurPanel();
  renderCaisseBox();
  updateNavBadges();
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
  renderPrime();

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
  set("pro-pertes", fmt(r.pertesCost));
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
  renderProStockValue();
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

async function removeProCharge(i) {
  const c = proSettings.fixedCharges[i];
  if (!c || !(await requireDeletePassword(`Supprimer la charge « ${c.name} » ?`))) return;
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

// =====================================================================
// ================== CODE OBLIGATOIRE POUR TOUTE SUPPRESSION ==================
// =====================================================================
// Pour mettre un code différent de celui de l'espace Pro, remplace PRO_PASSWORD
// par un autre code entre guillemets, ex : const DELETE_PASSWORD = "1234";
const DELETE_PASSWORD = PRO_PASSWORD;

let deletePasswordResolver = null;

// Ouvre la fenêtre de code → renvoie true si le bon code est saisi, false si annulé
function requireDeletePassword(message, messageIsHtml = false) {
  return requirePassword({ title: "🔒 Suppression protégée", message, messageIsHtml, confirmLabel: "Supprimer" });
}

// ✅ Fenêtre de code générique (suppressions, paiement avec le coffre…)
function requirePassword({ title, message, messageIsHtml = false, confirmLabel = "Valider" }) {
  return new Promise((resolve) => {
    const $ = (id) => document.getElementById(id);
    $("pwd-title").textContent = title || "🔒 Code demandé";
    $("pwd-submit").textContent = confirmLabel;
    if (messageIsHtml) $("pwd-message").innerHTML = message;
    else $("pwd-message").textContent = message;
    $("pwd-input").value = "";
    $("pwd-error").classList.add("hidden");
    $("pwd-modal").classList.remove("hidden");
    deletePasswordResolver = resolve;
    setTimeout(() => $("pwd-input").focus(), 50);
  });
}

function submitDeletePassword(e) {
  if (e) e.preventDefault();
  const input = document.getElementById("pwd-input");
  if (input.value === DELETE_PASSWORD) {
    document.getElementById("pwd-modal").classList.add("hidden");
    const r = deletePasswordResolver;
    deletePasswordResolver = null;
    if (r) r(true);
  } else {
    input.value = "";
    document.getElementById("pwd-error").classList.remove("hidden");
    input.focus();
  }
}

function cancelDeletePassword() {
  document.getElementById("pwd-modal").classList.add("hidden");
  const r = deletePasswordResolver;
  deletePasswordResolver = null;
  if (r) r(false);
}

// =====================================================================
// ================== CAISSE & COFFRE ==================
// =====================================================================
// Caisse (espèces) = montant au dernier comptage
//                  + ventes payées en espèces depuis
//                  − dépôts dans le coffre depuis
//                  − dépenses payées avec la caisse depuis
// Coffre = dépôts − décaissements ± ajustements
//
// ✅ SAUVEGARDE : chaque mouvement est
//   1) gardé dans ce navigateur (copie de secours, marche sans internet)
//   2) envoyé dans l'onglet « Coffre » de Google Sheets (sauvegarde durable,
//      la même sur tous les appareils). Au démarrage, l'app recharge ce journal.
const VAULT_KEY = "bsk_vault";

function loadVault() {
  let v = null;
  try {
    v = JSON.parse(localStorage.getItem(VAULT_KEY) || "null");
  } catch (e) {}
  if (!v || !Array.isArray(v.moves)) v = { moves: [] };

  // Ancienne version : le comptage de caisse était à part → on le transforme en mouvement
  if (v.caisseBaseline && v.caisseBaseline.at &&
      !v.moves.some((m) => m.type === "caisse-count")) {
    v.moves.push({
      id: "base-" + new Date(v.caisseBaseline.at).getTime(),
      at: v.caisseBaseline.at,
      type: "caisse-count",
      amount: Number(v.caisseBaseline.amount) || 0,
      previous: Number(v.caisseBaseline.amount) || 0,
      motif: "Reprise de l'ancien comptage"
    });
  }
  delete v.caisseBaseline;
  return v;
}

let vault = loadVault();
let vaultSheetStatus = "loading"; // loading | ok | missing (script Google pas installé) | offline
let vaultSyncFailures = 0; // ✅ échecs d'affilée : on arrête de réessayer après 3

function saveVault() {
  try {
    localStorage.setItem(VAULT_KEY, JSON.stringify(vault));
  } catch (e) {
    console.warn("Impossible d'enregistrer le coffre dans ce navigateur.", e);
  }
}

// Ajoute un mouvement : navigateur + Google Sheets
function addVaultMove(move) {
  move.id = String(move.id || Date.now() + "-" + Math.random().toString(36).slice(2, 6));
  vault.moves.push(move);
  saveVault();
  sendVaultMoveToSheet(move);
  return move;
}

function sendVaultMoveToSheet(move) {
  const payload = encodeURIComponent(JSON.stringify({ move }));
  fetch(`${SHEET_URL}?action=addVaultMove&payload=${payload}`, { mode: "no-cors" })
    .catch((err) => console.warn("Envoi mouvement coffre impossible (sera renvoyé plus tard) :", err));
}

// Recharge le journal depuis Google Sheets et renvoie ce qui manquerait
function syncVaultFromSheet() {
  return new Promise((resolve) => {
    const cb = "onVault_" + Date.now();
    const script = document.createElement("script");
    let done = false;

    const finish = (status) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      delete window[cb];
      script.remove();
      vaultSheetStatus = status;
      vaultSyncFailures = status === "ok" ? 0 : vaultSyncFailures + 1;
      ensureCaisseBaseline();
      refreshProIfVisible();
      resolve(status);
    };

    const timer = setTimeout(() => finish("missing"), 10000);

    window[cb] = function (data) {
      if (!data || data.vault !== true || !Array.isArray(data.moves)) {
        // le script Google ne connaît pas encore « getVaultMoves »
        finish("missing");
        return;
      }
      const sheetIds = new Set(data.moves.map((m) => String(m.id)));
      const merged = new Map();
      data.moves.forEach((m) => merged.set(String(m.id), normalizeVaultMove(m)));
      // mouvements faits sur cet appareil mais pas encore dans Sheets → on les renvoie
      vault.moves.forEach((m) => {
        if (!sheetIds.has(String(m.id))) {
          merged.set(String(m.id), m);
          sendVaultMoveToSheet(m);
        }
      });
      vault.moves = [...merged.values()].sort((a, b) => new Date(a.at) - new Date(b.at));
      saveVault();
      finish("ok");
    };

    script.onerror = () => finish("offline");
    script.src = `${SHEET_URL}?action=getVaultMoves&callback=${cb}`;
    document.body.appendChild(script);
  });
}

function normalizeVaultMove(m) {
  return {
    id: String(m.id),
    at: m.at,
    type: m.type,
    amount: Number(m.amount) || 0,
    delta: Number(m.delta) || 0,
    previous: Number(m.previous) || 0,
    motif: m.motif || "",
    category: m.category || "",
    expenseId: m.expenseId || ""
  };
}

// Dernier comptage de caisse = point de départ du calcul
function getCaisseBaseline() {
  const counts = vault.moves
    .filter((m) => m.type === "caisse-count")
    .sort((a, b) => new Date(b.at) - new Date(a.at));
  if (counts.length) return { amount: Number(counts[0].amount) || 0, at: counts[0].at };
  // pas encore de comptage : on compte à partir du début de la journée
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return { amount: 0, at: d.toISOString(), temporary: true };
}

// Au tout premier lancement (et seulement après avoir vérifié Google Sheets),
// on enregistre un point de départ à 0 au début de la journée.
function ensureCaisseBaseline() {
  if (vault.moves.some((m) => m.type === "caisse-count")) return;
  if (vaultSheetStatus !== "ok") return; // ✅ attendre une vraie réponse de Google Sheets
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  addVaultMove({ at: d.toISOString(), type: "caisse-count", amount: 0, previous: 0, motif: "Démarrage du suivi de caisse" });
}

function isCashPayment(method) {
  const m = String(method || "cash").toLowerCase().trim();
  return ["cash", "espèces", "especes", "espece", "espèce", "liquide"].includes(m);
}

function computeCaisseBalance() {
  const baseline = getCaisseBaseline();
  const t0 = new Date(baseline.at).getTime();
  let total = Number(baseline.amount) || 0;

  (sales || []).forEach((s) => {
    const t = new Date(s.date).getTime();
    if (isNaN(t) || t <= t0) return;
    // ✅ tous les modes comptent comme des espèces : le mobile money est retiré en liquide chaque soir
    total += Number(s.total) || 0;
  });

  vault.moves.forEach((m) => {
    if (m.type !== "deposit") return;
    if (String(m.motif || "").indexOf("[B2B]") === 0) return; // ✅ dépôt venant de la caisse B2B
    if (new Date(m.at).getTime() > t0) total -= Number(m.amount) || 0;
  });

  (expenses || []).forEach((e) => {
    const t = new Date(e.date).getTime();
    if (isNaN(t) || t <= t0) return;
    if (parseExpense(e).source === "caisse") total -= Number(e.amount) || 0;
  });

  return total;
}

function computeCoffreBalance() {
  return vault.moves.reduce((sum, m) => {
    if (m.type === "deposit") return sum + (Number(m.amount) || 0);
    if (m.type === "withdraw") return sum - (Number(m.amount) || 0);
    if (m.type === "adjust") return sum + (Number(m.delta) || 0);
    return sum;
  }, 0);
}

// ✅ Wave / Orange Money encaissés depuis le dernier comptage (même période que les espèces)
function computeCaisseMobile() {
  const t0 = new Date(getCaisseBaseline().at).getTime();
  const r = { wave: 0, orange: 0 };
  (sales || []).forEach((s) => {
    const t = new Date(s.date).getTime();
    if (isNaN(t) || t <= t0) return;
    if (s.paymentMethod === "wave") r.wave += Number(s.total) || 0;
    else if (s.paymentMethod === "orange") r.orange += Number(s.total) || 0;
  });
  return r;
}

function renderCaisseBox() {
  if (!document.getElementById("caisse-total")) return;
  const mobile = computeCaisseMobile();
  const total = computeCaisseBalance(); // espèces + Wave + Orange Money (tout est retiré en espèces)
  const set = (id, v) => { const x = document.getElementById(id); if (x) x.textContent = v; };
  set("caisse-wave", fmt(mobile.wave));
  set("caisse-orange", fmt(mobile.orange));
  const tot = document.getElementById("caisse-total");
  if (tot) {
    tot.textContent = fmt(total);
    tot.parentElement.classList.toggle("negative", total < 0);
  }
  const sub = document.getElementById("caisse-balance-sub");
  if (sub) {
    const at = new Date(getCaisseBaseline().at);
    sub.innerHTML = `Depuis le dernier comptage (${at.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}) : toutes les ventes (espèces, Wave, Orange Money, livraisons, crédits), moins les remboursements, les dépôts au coffre et les frais payés avec la caisse.<br>${vaultStatusHtml()}`;
  }
}

function vaultStatusHtml() {
  if (vaultSheetStatus === "ok") return `<span class="text-pos">☁️ Sauvegardé dans Google Sheets</span>`;
  if (vaultSheetStatus === "loading") return `<span>⏳ Chargement de la sauvegarde…</span>`;
  if (vaultSheetStatus === "offline") return `<span class="text-neg">⚠️ Google Sheets ne répond pas correctement (pas d'internet, ou script Google pas mis à jour en « Nouvelle version »). Montants gardés sur cet appareil, envoyés dès que ça remarche.</span>`;
  return `<span class="text-neg">⚠️ Sauvegarde Google Sheets pas encore installée : montants gardés seulement sur cet appareil.</span>`;
}

// ---------- Fenêtre « montant » réutilisable ----------
let moneyModalHandler = null;

function openMoneyModal(cfg) {
  const $ = (id) => document.getElementById(id);
  $("mm-title").textContent = cfg.title;
  $("mm-info").innerHTML = cfg.info || "";
  $("mm-amount-label").textContent = cfg.amountLabel || "Montant (FCFA)";
  $("mm-amount").value = cfg.defaultAmount ?? "";
  $("mm-category-wrap").classList.toggle("hidden", !cfg.showCategory);
  $("mm-motif-wrap").classList.toggle("hidden", cfg.hideMotif === true);
  $("mm-motif-label").textContent = cfg.motifLabel || "Motif";
  $("mm-motif").placeholder = cfg.motifPlaceholder || "";
  $("mm-motif").value = "";
  $("mm-error").classList.add("hidden");
  $("mm-confirm").textContent = cfg.confirmLabel || "Valider";
  moneyModalHandler = cfg.onConfirm;
  $("money-modal").classList.remove("hidden");
  setTimeout(() => $("mm-amount").focus(), 50);
}

function closeMoneyModal() {
  document.getElementById("money-modal").classList.add("hidden");
  moneyModalHandler = null;
}

function submitMoneyModal() {
  if (!moneyModalHandler) return;
  const amountRaw = document.getElementById("mm-amount").value;
  const amount = Number(amountRaw);
  const motif = (document.getElementById("mm-motif").value || "").trim();
  const category = document.getElementById("mm-category").value;
  const errorMsg = moneyModalHandler({ amount, amountRaw, motif, category });
  if (errorMsg) {
    const err = document.getElementById("mm-error");
    err.textContent = errorMsg;
    err.classList.remove("hidden");
    return;
  }
  closeMoneyModal();
}

// ---------- Actions ----------
function openDepositModal() {
  const caisse = computeCaisseBalance();
  openMoneyModal({
    title: "🔐 Dépôt dans le coffre",
    info: `Disponible dans la caisse : <strong>${fmt(caisse)} FCFA</strong>`,
    amountLabel: "Montant à déposer (FCFA)",
    defaultAmount: caisse > 0 ? caisse : "",
    motifLabel: "Note (optionnel)",
    motifPlaceholder: "Ex : dépôt de fin de journée",
    confirmLabel: "Déposer",
    onConfirm: ({ amount, motif }) => {
      if (!(amount > 0)) return "Indique un montant valide.";
      if (amount > caisse) return `La caisse ne contient que ${fmt(caisse)} FCFA.`;
      addVaultMove({ at: new Date().toISOString(), type: "deposit", amount, motif: motif || "Dépôt depuis la caisse" });
      refreshProIfVisible();
      alert(`✅ ${fmt(amount)} FCFA déposés dans le coffre.`);
      return null;
    }
  });
}

function openWithdrawModal() {
  const coffre = computeCoffreBalance();
  openMoneyModal({
    title: "Décaisser du coffre",
    info: `Disponible dans le coffre : <strong>${fmt(coffre)} FCFA</strong><br>Le décaissement reste dans l'historique du coffre (il n'apparaît pas dans Frais).`,
    amountLabel: "Montant à sortir (FCFA)",
    showCategory: false,
    motifLabel: "Motif (obligatoire)",
    motifPlaceholder: "Ex : paiement fournisseur, loyer de novembre…",
    confirmLabel: "Décaisser",
    onConfirm: ({ amount, motif }) => {
      if (!(amount > 0)) return "Indique un montant valide.";
      if (amount > coffre) return `Le coffre ne contient que ${fmt(coffre)} FCFA.`;
      if (motif.length < 3) return "Le motif est obligatoire pour tout décaissement.";
      addVaultMove({ at: new Date().toISOString(), type: "withdraw", amount, motif, category: "" });
      refreshProIfVisible();
      alert(`✅ ${fmt(amount)} FCFA sortis du coffre.`);
      return null;
    }
  });
}

function openCoffreAdjustModal() {
  const coffre = computeCoffreBalance();
  openMoneyModal({
    title: "Ajuster le solde du coffre",
    info: `Le coffre affiche <strong>${fmt(coffre)} FCFA</strong>. Indique le montant réellement compté (ex : solde de départ).<br><small>Un ajustement n'est pas compté comme une dépense.</small>`,
    amountLabel: "Montant réel dans le coffre (FCFA)",
    defaultAmount: coffre,
    motifLabel: "Motif (obligatoire)",
    motifPlaceholder: "Ex : solde de départ, comptage du coffre",
    onConfirm: ({ amount, amountRaw, motif }) => {
      if (amountRaw === "" || !(amount >= 0)) return "Indique un montant valide.";
      if (motif.length < 3) return "Le motif est obligatoire.";
      const delta = amount - coffre;
      if (delta === 0) return "Le montant est identique au solde actuel.";
      addVaultMove({ at: new Date().toISOString(), type: "adjust", delta, previous: coffre, amount, motif });
      refreshProIfVisible();
      return null;
    }
  });
}

function openCaisseCountModal() {
  const caisse = computeCaisseBalance();
  openMoneyModal({
    title: "Compter / ajuster la caisse",
    info: `La caisse affiche <strong>${fmt(caisse)} FCFA</strong>. Compte les billets et pièces et indique le montant réel : le calcul repartira de ce montant.`,
    amountLabel: "Montant compté dans la caisse (FCFA)",
    defaultAmount: caisse,
    motifLabel: "Note (optionnel)",
    motifPlaceholder: "Ex : comptage du matin",
    onConfirm: ({ amount, amountRaw, motif }) => {
      if (amountRaw === "" || !(amount >= 0)) return "Indique un montant valide.";
      const now = new Date().toISOString();
      addVaultMove({ at: now, type: "caisse-count", amount, previous: caisse, motif: motif || "Comptage de caisse" });
      refreshProIfVisible();
      const diff = amount - caisse;
      if (diff !== 0) alert(`Caisse ajustée. Écart constaté : ${diff > 0 ? "+" : "−"}${fmt(Math.abs(diff))} FCFA.`);
      return null;
    }
  });
}

// ✅ Coffre protégé par le même code que Pro / Bilan
function unlockCoffre(e) {
  if (e) e.preventDefault();
  const input = document.getElementById("coffre-password");
  const err = document.getElementById("coffre-lock-error");
  if (input.value === PRO_PASSWORD) {
    sessionStorage.setItem(PRO_UNLOCK_KEY, "1");
    input.value = "";
    err.classList.add("hidden");
    renderCoffreView();
  } else {
    input.value = "";
    err.classList.remove("hidden");
    input.focus();
  }
}

function renderCoffreView() {
  const lock = document.getElementById("coffre-lock");
  const content = document.getElementById("coffre-content");
  if (lock && content) {
    const unlocked = isProUnlocked();
    lock.classList.toggle("hidden", unlocked);
    content.classList.toggle("hidden", !unlocked);
    if (!unlocked) {
      setTimeout(() => document.getElementById("coffre-password")?.focus(), 50);
      return; // rien n'est calculé ni affiché sans le code
    }
  }

  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  const coffre = computeCoffreBalance();
  const caisse = computeCaisseBalance();
  set("coffre-balance", fmt(coffre));
  set("coffre-caisse", fmt(caisse));
  set("coffre-total", fmt(coffre + caisse));

  const { from, to } = getProRange("month", todayLocalStr());
  let mIn = 0, mOut = 0;
  vault.moves.forEach((m) => {
    const k = dateKeyOf(m.at);
    if (k < from || k > to) return;
    if (m.type === "deposit") mIn += Number(m.amount) || 0;
    if (m.type === "withdraw") mOut += Number(m.amount) || 0;
  });
  set("coffre-month-in", fmt(mIn));
  set("coffre-month-out", fmt(mOut));

  // Historique avec solde après chaque opération
  const tbody = document.getElementById("coffre-history-body");
  if (!tbody) return;
  const coffreMoves = vault.moves
    .filter((m) => ["deposit", "withdraw", "adjust"].includes(m.type))
    .sort((a, b) => new Date(a.at) - new Date(b.at));

  let running = 0;
  const rows = coffreMoves.map((m) => {
    let label, amount;
    if (m.type === "deposit") { label = String(m.motif || "").indexOf("[B2B]") === 0 ? "⬇️ Dépôt depuis la caisse B2B" : "⬇️ Dépôt depuis la caisse"; amount = Number(m.amount); }
    else if (m.type === "withdraw") { label = m.category ? `⬆️ Décaissement (${proEscape(m.category)})` : "⬆️ Décaissement"; amount = -Number(m.amount); }
    else { label = "⚖️ Ajustement"; amount = Number(m.delta); }
    running += amount;
    return `<tr>
      <td>${new Date(m.at).toLocaleString("fr-FR")}</td>
      <td>${label}</td>
      <td class="${amount >= 0 ? "amount-in" : "amount-out"}">${amount >= 0 ? "+" : "−"}${fmt(Math.abs(amount))} FCFA</td>
      <td>${proEscape(m.motif || "")}</td>
      <td>${fmt(running)} FCFA</td>
    </tr>`;
  }).reverse();

  tbody.innerHTML = rows.length
    ? rows.slice(0, 200).join("")
    : `<tr><td colspan="5">Aucune opération. Commence par « Ajuster le solde » si le coffre contient déjà de l'argent.</td></tr>`;

  const status = document.getElementById("coffre-sync-status");
  if (status) status.innerHTML = vaultStatusHtml();

  renderEcarts();
}

// ✅ Tableau des écarts : devait y avoir / compté / différence
function renderEcarts() {
  const tbody = document.getElementById("ecarts-body");
  if (!tbody) return;
  const { from, to } = getProRange("month", todayLocalStr());

  // le tout premier ajustement du coffre = solde de départ, pas un écart
  const firstCoffreMove = vault.moves
    .filter((m) => ["deposit", "withdraw", "adjust"].includes(m.type))
    .sort((a, b) => new Date(a.at) - new Date(b.at))[0];

  const controls = vault.moves
    .filter((m) => (m.type === "caisse-count" && !/^Démarrage|^Reprise/.test(m.motif || "")) ||
                   (m.type === "adjust" && m !== firstCoffreMove))
    .map((m) => {
      if (m.type === "caisse-count") {
        const counted = Number(m.amount) || 0;
        const expected = Number(m.previous) || 0;
        return { at: m.at, where: "Caisse", expected, counted, diff: counted - expected, motif: m.motif };
      }
      const diff = Number(m.delta) || 0;
      const expected = Number(m.previous) || 0;
      return { at: m.at, where: "Coffre", expected, counted: expected + diff, diff, motif: m.motif };
    })
    .sort((a, b) => new Date(b.at) - new Date(a.at));

  let caisseMonth = 0, coffreMonth = 0, countMonth = 0;
  controls.forEach((c) => {
    const k = dateKeyOf(c.at);
    if (k < from || k > to) return;
    countMonth++;
    if (c.where === "Caisse") caisseMonth += c.diff; else coffreMonth += c.diff;
  });

  const showDiff = (d) => d === 0 ? `<span class="text-pos">0 ✅</span>`
    : `<span class="${d > 0 ? "amount-in" : "amount-out"}">${d > 0 ? "+" : "−"}${fmt(Math.abs(d))} FCFA${d < 0 ? " ⚠️" : ""}</span>`;

  const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
  set("ecart-caisse-month", showDiff(caisseMonth));
  set("ecart-coffre-month", showDiff(coffreMonth));
  set("ecart-count-month", String(countMonth));

  tbody.innerHTML = controls.length
    ? controls.slice(0, 200).map((c) => `
      <tr>
        <td>${new Date(c.at).toLocaleString("fr-FR")}</td>
        <td>${c.where}</td>
        <td>${fmt(c.expected)} FCFA</td>
        <td>${fmt(c.counted)} FCFA</td>
        <td>${showDiff(c.diff)}</td>
        <td>${proEscape(c.motif || "")}</td>
      </tr>`).join("")
    : `<tr><td colspan="6">Aucun comptage pour l'instant. Compte la caisse régulièrement (ex : chaque soir) pour repérer un problème.</td></tr>`;
}

// =====================================================================
// ================== STOCK : valeur, seuils, commandes ==================
// =====================================================================
const STOCK_SETTINGS_KEY = "bsk_stock_settings";

function loadStockSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(STOCK_SETTINGS_KEY) || "null");
    if (s) return { thresholds: s.thresholds || {}, ordered: s.ordered || {} };
  } catch (e) {}
  return { thresholds: {}, ordered: {} };
}

let stockSettings = loadStockSettings();

function saveStockSettings() {
  try { localStorage.setItem(STOCK_SETTINGS_KEY, JSON.stringify(stockSettings)); } catch (e) {}
}

function isServiceProduct(p) {
  return proKey(p.name) === "couture" || (Number(p.stock) || 0) >= 999999;
}

// Seuils demandés : bar à parfum 100, bar à musc 50, bar à thiouraye 50, le reste 20
function defaultThreshold(name) {
  const k = proKey(name);
  if (k === "bar à parfum") return 100;
  if (k === "bar à musc") return 50;
  if (k === "bar à thiouraye") return 50;
  return 20;
}

function getReorderThreshold(p) {
  const v = stockSettings.thresholds[proKey(p.name)];
  return v === undefined ? defaultThreshold(p.name) : Number(v) || 0;
}

function setReorderThreshold(productId, value) {
  const p = products.find((x) => x.id === productId);
  if (!p) return;
  stockSettings.thresholds[proKey(p.name)] = Math.max(0, Number(value) || 0);
  saveStockSettings();
  renderProductsTable();
  updateNavBadges();
}

// Produits sous le seuil (et nettoyage des tâches dont le stock est remonté)
function getReorderItems() {
  const items = [];
  let changed = false;
  (products || []).forEach((p) => {
    if (isServiceProduct(p)) return;
    const k = proKey(p.name);
    const threshold = getReorderThreshold(p);
    const stock = Number(p.stock) || 0;
    if (stock <= threshold) {
      items.push({ product: p, key: k, stock, threshold, ordered: stockSettings.ordered[k] || null });
    } else if (stockSettings.ordered[k] && productsLoadedFromSheet) {
      // stock remonté → tâche terminée (seulement avec le vrai stock de Google Sheets)
      delete stockSettings.ordered[k];
      changed = true;
    }
  });
  if (changed) saveStockSettings();
  // ruptures d'abord, puis le plus bas par rapport au seuil
  // (ordre fixe : une tâche cochée ne bouge pas, pour ne pas perdre le fil)
  return items.sort((a, b) =>
    a.stock / (a.threshold || 1) - b.stock / (b.threshold || 1) || a.product.name.localeCompare(b.product.name, "fr"));
}

function renderReorderTasks() {
  const box = document.getElementById("reorder-list");
  if (!box) return;
  const items = getReorderItems();

  if (!items.length) {
    box.innerHTML = `<div class="task-empty">✅ Aucun produit à commander pour le moment.</div>`;
    return;
  }

  box.innerHTML = items.map((it) => {
    const done = !!it.ordered;
    const urgent = it.stock === 0 && !done;
    const sub = done
      ? `Commande passée le ${new Date(it.ordered.at).toLocaleDateString("fr-FR")} • reste ${fmt(it.stock)}`
      : `${it.stock === 0 ? "🔴 RUPTURE" : `Reste ${fmt(it.stock)} pièce${it.stock > 1 ? "s" : ""}`} • seuil ${fmt(it.threshold)}`;
    return `
      <label class="task ${done ? "done" : ""} ${urgent ? "urgent" : ""}">
        <input type="checkbox" ${done ? "checked" : ""} data-key="${proEscape(it.key)}" onchange="toggleReorder(this)" />
        <span>
          <span class="task-title">Commander ${proEscape(it.product.name)}</span><br>
          <span class="task-sub">${sub}</span>
        </span>
      </label>`;
  }).join("");
}

function toggleReorder(checkbox) {
  const k = checkbox.dataset.key;
  if (checkbox.checked) stockSettings.ordered[k] = { at: new Date().toISOString() };
  else delete stockSettings.ordered[k];
  saveStockSettings();
  renderReorderTasks();
  renderStockValue();
  updateNavBadges();
}

function computeStockValue() {
  let sale = 0, cost = 0, units = 0, missingCost = 0;
  (products || []).forEach((p) => {
    if (isServiceProduct(p)) return;
    const stock = Number(p.stock) || 0;
    units += stock;
    sale += (Number(p.price) || 0) * stock;
    const c = getUnitCost(p.name);
    if (c === null) { if (stock > 0) missingCost++; } else cost += c * stock;
  });
  return { sale, cost, units, missingCost };
}

function renderStockValue() {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  const v = computeStockValue();
  set("stock-units", fmt(v.units));
  set("stock-to-order", getReorderItems().filter((i) => !i.ordered).length);
}

// ✅ Valeur du stock : affichée seulement dans l'onglet Pro
function renderProStockValue() {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  const v = computeStockValue();
  set("stock-value-sale", fmt(v.sale));
  set("stock-value-cost", fmt(v.cost) + (v.missingCost ? " *" : ""));
  set("stock-value-margin", fmt(v.sale - v.cost));
  set("pro-stock-units", fmt(v.units));

  const tbody = document.getElementById("pro-stock-body");
  if (!tbody) return;
  const rows = (products || [])
    .filter((p) => !isServiceProduct(p))
    .map((p) => {
      const stock = Number(p.stock) || 0;
      const c = getUnitCost(p.name);
      return { name: p.name, stock, sale: (Number(p.price) || 0) * stock, cost: c === null ? null : c * stock };
    })
    .sort((a, b) => b.sale - a.sale);

  tbody.innerHTML = rows.map((r) => `
    <tr>
      <td>${proEscape(r.name)}</td>
      <td>${fmt(r.stock)}</td>
      <td>${fmt(r.sale)} FCFA</td>
      <td>${r.cost === null ? `<span class="text-neg">coût à remplir</span>` : fmt(r.cost) + " FCFA"}</td>
    </tr>`).join("") +
    `<tr><td colspan="4" style="text-align:right;"><strong>Total : ${fmt(v.sale)} FCFA (vente) • ${fmt(v.cost)} FCFA (coût)</strong></td></tr>`;
}

// ---------- Créer / supprimer un produit ----------
function createProduct() {
  const $ = (id) => document.getElementById(id);
  const name = ($("new-product-name").value || "").trim();
  const price = Number($("new-product-price").value);
  const stock = Number($("new-product-stock").value) || 0;
  const costRaw = $("new-product-cost").value;
  const thresholdRaw = $("new-product-threshold").value;

  if (!name) return alert("Indique le nom du produit.");
  if (!(price >= 0) || $("new-product-price").value === "") return alert("Indique le prix de vente.");
  if (stock < 0) return alert("Stock invalide.");
  if (products.some((p) => proKey(p.name) === proKey(name))) return alert("Un produit porte déjà ce nom.");

  const id = products.reduce((max, p) => Math.max(max, Number(p.id) || 0), 0) + 1;
  const product = { id, name, price, stock };
  products.push(product);

  if (costRaw !== "") { proSettings.costs[proKey(name)] = Number(costRaw) || 0; saveProSettings(); }
  if (thresholdRaw !== "") { stockSettings.thresholds[proKey(name)] = Number(thresholdRaw) || 0; saveStockSettings(); }

  saveProducts(products);
  sendStockToSheetWithFallback(products);
  logStockChangeToSheet({
    date: new Date().toISOString(), productId: id, productName: name,
    oldStock: 0, newStock: stock, delta: stock, reason: "Création du produit"
  });

  ["new-product-name", "new-product-price", "new-product-stock", "new-product-cost", "new-product-threshold"]
    .forEach((i) => ($(i).value = ""));

  renderProductsTable();
  renderProductsForSale();
  updateNavBadges();
  alert(`✅ Produit « ${name} » créé.`);
}

async function deleteProduct(productId) {
  const p = products.find((x) => x.id === productId);
  if (!p) return;
  if (!(await requireDeletePassword(`Supprimer définitivement le produit « ${p.name} » ?<br><small>Les anciennes ventes restent dans l'historique.</small>`, true))) return;

  products = products.filter((x) => x.id !== productId);
  cart = cart.filter((item) => item.productId !== productId);
  delete stockSettings.ordered[proKey(p.name)];
  saveStockSettings();

  saveProducts(products);
  sendStockToSheetWithFallback(products);
  logStockChangeToSheet({
    date: new Date().toISOString(), productId, productName: p.name,
    oldStock: p.stock, newStock: 0, delta: -(Number(p.stock) || 0), reason: "Produit supprimé"
  });

  renderProductsTable();
  renderProductsForSale();
  renderCart();
  updateNavBadges();
}

// ---------- Petits compteurs rouges dans le menu ----------
function updateNavBadges() {
  const setBadge = (view, count) => {
    const btn = document.querySelector(`nav button[onclick="showView('${view}')"]`);
    if (!btn) return;
    if (!btn.dataset.label) btn.dataset.label = btn.textContent.trim();
    btn.innerHTML = proEscape(btn.dataset.label) + (count > 0 ? ` <span class="nav-badge">${count}</span>` : "");
  };
  const aCommander = getReorderItems().filter((i) => !i.ordered).length;
  setBadge("pro", aCommander);
  document.querySelectorAll('.pro-subnav button[data-sub="produits"]').forEach((b) => {
    b.innerHTML = "📦 Produits" + (aCommander > 0 ? ` <span class="nav-badge">${aCommander}</span>` : "");
  });
  setBadge("bar-parfum", (perfumes || []).filter((p) => p.level === "out").length);
}

// =====================================================================
// ================== BILAN (santé de la boutique) ==================
// =====================================================================
const bilanState = { period: "month", refDate: null };
let bilanChart = null;

function unlockBilan(e) {
  if (e) e.preventDefault();
  const input = document.getElementById("bilan-password");
  const err = document.getElementById("bilan-lock-error");
  if (input.value === PRO_PASSWORD) {
    sessionStorage.setItem(PRO_UNLOCK_KEY, "1");
    input.value = "";
    err.classList.add("hidden");
    renderBilanView();
  } else {
    input.value = "";
    err.classList.remove("hidden");
    input.focus();
  }
}

function renderBilanView() {
  const lock = document.getElementById("bilan-lock");
  const content = document.getElementById("bilan-content");
  if (!lock || !content) return;
  if (!isProUnlocked()) {
    lock.classList.remove("hidden");
    content.classList.add("hidden");
    return;
  }
  lock.classList.add("hidden");
  content.classList.remove("hidden");
  if (!bilanState.refDate) bilanState.refDate = todayLocalStr();
  document.getElementById("bilan-ref-date").value = bilanState.refDate;
  renderBilanNumbers();
}

function setBilanPeriod(p) { bilanState.period = p; renderBilanNumbers(); }
function setBilanRefDate(v) {
  if (!v) return;
  bilanState.refDate = v;
  document.getElementById("bilan-ref-date").value = v;
  renderBilanNumbers();
}

// date de référence de la période précédente
function previousRef(period, refStr) {
  const [y, m, d] = refStr.split("-").map(Number);
  let r;
  if (period === "day") r = new Date(y, m - 1, d - 1);
  else if (period === "week") r = new Date(y, m - 1, d - 7);
  else if (period === "month") r = new Date(y, m - 2, 1);
  else r = new Date(y - 1, 0, 1);
  return toLocalDateStr(r);
}

const PERIOD_NAMES = { day: "la veille", week: "la semaine précédente", month: "le mois précédent", year: "l'année précédente" };

function computeBilan(period, refStr) {
  const { from, to } = getProRange(period, refStr);
  const inRange = (v, f = from, t = to) => { const k = dateKeyOf(v); return k && k >= f && k <= t; };

  // Ventes
  const periodSales = (sales || []).filter((s) => inRange(s.date));
  const ca = periodSales.reduce((s, x) => s + (Number(x.total) || 0), 0);
  const count = periodSales.length;
  const discounts = periodSales.reduce((s, x) => s + (Number(x.discountAmount) || 0), 0);
  const pay = { cash: 0, orange: 0, wave: 0 };
  periodSales.forEach((s) => {
    const a = Number(s.total) || 0;
    if (s.paymentMethod === "orange") pay.orange += a;
    else if (s.paymentMethod === "wave") pay.wave += a;
    else pay.cash += a;
  });

  const prev = getProRange(period, previousRef(period, refStr));
  const caPrev = (sales || []).filter((s) => inRange(s.date, prev.from, prev.to))
    .reduce((s, x) => s + (Number(x.total) || 0), 0);
  const evolution = caPrev > 0 ? ((ca - caPrev) / caPrev) * 100 : null;

  // Rentabilité (même calcul que l'onglet Pro)
  const pro = computePro(period, refStr);

  // Dépenses
  const periodExpenses = fraisCaisse().filter((e) => inRange(e.date));
  const expTotal = periodExpenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const expByCat = {};
  periodExpenses.forEach((e) => {
    const c = parseExpense(e).category;
    expByCat[c] = (expByCat[c] || 0) + (Number(e.amount) || 0);
  });
  const topExp = Object.entries(expByCat).sort((a, b) => b[1] - a[1]);

  // Trésorerie
  const caisse = computeCaisseBalance();
  const coffre = computeCoffreBalance();
  const tresorerie = caisse + coffre;
  const monthly = monthlyFixedTotal();
  const coverage = monthly > 0 ? tresorerie / monthly : null;

  // Crédits
  const openCredits = (credits || []).filter((c) => (c.status || "open") !== "closed");
  const creditOutstanding = openCredits.reduce((s, c) => s + (Number(c.amountDue) || 0), 0);

  // Stock
  const stockVal = computeStockValue();
  const reorder = getReorderItems();
  const toOrder = reorder.filter((i) => !i.ordered);
  const ruptures = (products || []).filter((p) => !isServiceProduct(p) && (Number(p.stock) || 0) === 0);
  const perfumeOut = (perfumes || []).filter((p) => p.level === "out");

  // Clients
  const buyers = new Set();
  periodSales.forEach((s) => {
    if (s.clientId) buyers.add("id:" + s.clientId);
    else if (s.clientPhone || s.clientName) buyers.add("np:" + (s.clientPhone || "") + (s.clientName || ""));
  });
  const birthdays = (clients || []).filter((c) => isClientBirthdaySoon(c)).length;

  // Contient aujourd'hui ? (période en cours)
  const today = todayLocalStr();
  const inProgress = today >= from && today <= to && today < to;

  return {
    from, to, ca, count, discounts, pay, caPrev, evolution, pro, expTotal, topExp,
    caisse, coffre, tresorerie, coverage, monthly, openCredits, creditOutstanding,
    stockVal, toOrder, reorder, ruptures, perfumeOut, buyers: buyers.size, birthdays, inProgress, periodSales
  };
}

function computeHealthScore(b) {
  let score = 0;
  const pro = b.pro;

  // 1) Résultat net (30 pts)
  if (pro.net >= 0 && pro.revenue > 0) score += 30;
  else if (pro.breakEven) score += Math.round(20 * Math.min(1, pro.revenue / pro.breakEven));

  // 2) Évolution du CA (15 pts)
  if (b.evolution === null) score += b.ca > 0 ? 10 : 0;
  else if (b.evolution >= 0) score += 15;
  else if (b.evolution >= -10) score += 10;
  else if (b.evolution >= -25) score += 5;

  // 3) Trésorerie : combien de mois de charges couverts (15 pts)
  if (b.coverage === null) score += 15;
  else if (b.coverage >= 1) score += 15;
  else if (b.coverage >= 0.5) score += 10;
  else if (b.coverage > 0) score += 5;

  // 4) Taux de marge (10 pts)
  const rate = pro.revenue > 0 ? pro.grossMargin / pro.revenue : pro.marginRate || 0;
  score += rate >= 0.5 ? 10 : rate >= 0.35 ? 6 : 2;

  // 5) Remises (10 pts)
  const discRate = b.ca + b.discounts > 0 ? b.discounts / (b.ca + b.discounts) : 0;
  score += discRate <= 0.05 ? 10 : discRate <= 0.1 ? 6 : discRate <= 0.2 ? 3 : 0;

  // 6) Crédits non payés vs CA mensuel (10 pts)
  const monthCa = computeBilanMonthCa();
  const credRate = monthCa > 0 ? b.creditOutstanding / monthCa : b.creditOutstanding > 0 ? 1 : 0;
  score += credRate <= 0.05 ? 10 : credRate <= 0.15 ? 6 : credRate <= 0.3 ? 3 : 0;

  // 7) Stock : commandes à passer / ruptures (10 pts)
  const issues = b.toOrder.length + b.ruptures.length + b.perfumeOut.length;
  score += issues === 0 ? 10 : issues <= 3 ? 6 : issues <= 6 ? 3 : 0;

  return Math.max(0, Math.min(100, score));
}

function computeBilanMonthCa() {
  const { from, to } = getProRange("month", todayLocalStr());
  return (sales || []).filter((s) => { const k = dateKeyOf(s.date); return k && k >= from && k <= to; })
    .reduce((s, x) => s + (Number(x.total) || 0), 0);
}

function bilanCard(label, value, sub = "", cls = "") {
  return `<div class="card ${cls}"><div class="label">${label}</div><div class="value">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ""}</div>`;
}

function renderBilanNumbers() {
  if (!bilanState.refDate) bilanState.refDate = todayLocalStr();
  document.querySelectorAll(".bilan-period-btn").forEach((btn) =>
    btn.classList.toggle("active", btn.dataset.period === bilanState.period));

  const b = computeBilan(bilanState.period, bilanState.refDate);
  const pro = b.pro;
  const $ = (id) => document.getElementById(id);

  $("bilan-range-label").textContent = (b.from === b.to
    ? `Période : ${fmtDateFr(b.from)}`
    : `Période : du ${fmtDateFr(b.from)} au ${fmtDateFr(b.to)}`) + (b.inProgress ? " (en cours)" : "");

  // ----- Score -----
  const score = computeHealthScore(b);
  const level = score >= 70 ? "good" : score >= 45 ? "mid" : "bad";
  $("bilan-health").className = `health-card ${level}`;
  $("bilan-score").textContent = score;
  $("bilan-score-fill").style.width = score + "%";
  $("bilan-verdict").textContent = level === "good" ? "🟢 La boutique se porte bien"
    : level === "mid" ? "🟠 Santé correcte, à surveiller" : "🔴 Situation fragile";
  $("bilan-verdict-text").textContent = b.inProgress
    ? "Période en cours : les charges fixes de toute la période sont déjà comptées, le résultat va s'améliorer avec les prochaines ventes."
    : "Score calculé sur le résultat, l'évolution des ventes, la trésorerie, la marge, les remises, les crédits et le stock.";

  // ----- Points forts / attention -----
  const good = [], bad = [];
  const pct = (x) => `${x > 0 ? "+" : ""}${Math.round(x)}%`;

  if (pro.revenue > 0 && pro.net >= 0) good.push(`Période en <strong>bénéfice : +${fmt(pro.net)} FCFA</strong>.`);
  else if (pro.revenue > 0 || pro.totalCharges > 0) {
    bad.push(`Période en <strong>perte : −${fmt(Math.abs(pro.net))} FCFA</strong>.` +
      (pro.breakEven ? ` Il faut ${fmt(Math.max(0, pro.breakEven - pro.revenue))} FCFA de ventes en plus pour être à l'équilibre.` : ""));
  }

  if (b.evolution !== null) {
    if (b.evolution >= 5) good.push(`Les ventes progressent de <strong>${pct(b.evolution)}</strong> par rapport à ${PERIOD_NAMES[bilanState.period]}.`);
    else if (b.evolution <= -5) bad.push(`Les ventes baissent de <strong>${pct(b.evolution)}</strong> par rapport à ${PERIOD_NAMES[bilanState.period]}${b.inProgress ? " (période pas encore terminée)" : ""}.`);
  }

  const rate = pro.revenue > 0 ? pro.grossMargin / pro.revenue : null;
  if (rate !== null) {
    if (rate >= 0.5) good.push(`Bonne marge sur les produits : <strong>${Math.round(rate * 100)}%</strong>.`);
    else if (rate < 0.35) bad.push(`Marge faible : <strong>${Math.round(rate * 100)}%</strong>. Vérifie tes prix et tes remises.`);
  }

  const discRate = b.ca + b.discounts > 0 ? b.discounts / (b.ca + b.discounts) : 0;
  if (discRate > 0.1) bad.push(`Les remises représentent <strong>${Math.round(discRate * 100)}%</strong> des ventes (${fmt(b.discounts)} FCFA).`);

  if (b.coverage !== null) {
    if (b.coverage >= 1) good.push(`Trésorerie solide : caisse + coffre couvrent <strong>${b.coverage.toFixed(1)} mois</strong> de charges.`);
    else bad.push(`Caisse + coffre (${fmt(b.tresorerie)} FCFA) couvrent seulement <strong>${Math.round(b.coverage * 100)}%</strong> d'un mois de charges.`);
  }

  if (b.creditOutstanding > 0) bad.push(`<strong>${fmt(b.creditOutstanding)} FCFA</strong> de crédits à encaisser (${b.openCredits.length} client${b.openCredits.length > 1 ? "s" : ""}). Pense à relancer.`);
  else good.push("Aucun crédit client en attente.");

  if (b.toOrder.length) bad.push(`<strong>${b.toOrder.length}</strong> commande${b.toOrder.length > 1 ? "s" : ""} de stock à passer (${b.toOrder.slice(0, 4).map((i) => proEscape(i.product.name)).join(", ")}${b.toOrder.length > 4 ? "…" : ""}).`);
  if (b.ruptures.length) bad.push(`Produits en rupture : ${b.ruptures.map((p) => proEscape(p.name)).join(", ")}.`);
  if (b.perfumeOut.length) bad.push(`Bar à parfum : ${b.perfumeOut.length} référence${b.perfumeOut.length > 1 ? "s" : ""} en rupture.`);
  if (!b.toOrder.length && !b.ruptures.length && !b.perfumeOut.length) good.push("Stock et bar à parfum bien approvisionnés.");

  if (b.topExp.length && b.expTotal > 0 && b.topExp[0][1] / b.expTotal > 0.4) {
    bad.push(`La catégorie <strong>${proEscape(b.topExp[0][0])}</strong> pèse ${Math.round((b.topExp[0][1] / b.expTotal) * 100)}% des frais.`);
  }

  const top = Object.values(pro.byProduct).sort((x, y) => y.revenue - x.revenue)[0];
  if (top) good.push(`Produit vedette : <strong>${proEscape(top.name)}</strong> (${top.qty} vendus).`);
  if (b.birthdays) good.push(`${b.birthdays} anniversaire${b.birthdays > 1 ? "s" : ""} client dans les 72h : une occasion de vendre (onglet Clients).`);
  if (pro.missingCost.length) bad.push(`Coût de revient manquant pour : ${pro.missingCost.map(proEscape).join(", ")} (onglet Pro).`);

  $("bilan-good").innerHTML = good.length ? good.map((x) => `<li>${x}</li>`).join("") : "<li>—</li>";
  $("bilan-bad").innerHTML = bad.length ? bad.map((x) => `<li>${x}</li>`).join("") : "<li>Rien à signaler 👍</li>";

  // ----- Cartes -----
  const evoTxt = b.evolution === null ? "Pas de comparaison possible"
    : `<span class="${b.evolution >= 0 ? "text-pos" : "text-neg"}">${pct(b.evolution)}</span> vs ${PERIOD_NAMES[bilanState.period]}`;

  $("bilan-sales").innerHTML =
    bilanCard("Chiffre d'affaires", fmt(b.ca) + " FCFA", evoTxt) +
    bilanCard("Nombre de ventes", fmt(b.count)) +
    bilanCard("Panier moyen", fmt(b.count ? b.ca / b.count : 0) + " FCFA") +
    bilanCard("Remises accordées", fmt(b.discounts) + " FCFA", b.ca ? `${Math.round(discRate * 100)}% des ventes` : "") +
    bilanCard("Espèces", fmt(b.pay.cash) + " FCFA") +
    bilanCard("Orange Money", fmt(b.pay.orange) + " FCFA") +
    bilanCard("Wave", fmt(b.pay.wave) + " FCFA");

  const netCls = pro.net >= 0 ? "pro-net pos" : "pro-net neg";
  $("bilan-profit").innerHTML =
    bilanCard("Marge brute", fmt(pro.grossMargin) + " FCFA", rate !== null ? `Taux de marge ${Math.round(rate * 100)}%` : "") +
    bilanCard("Coût des produits vendus", fmt(pro.cogs) + " FCFA") +
    bilanCard("Charges fixes (période)", fmt(pro.fixed) + " FCFA") +
    bilanCard("Résultat net", `${pro.net >= 0 ? "+" : "−"}${fmt(Math.abs(pro.net))} FCFA`, pro.net >= 0 ? "✅ Bénéfice" : "❌ Perte", netCls) +
    bilanCard("Seuil de rentabilité", pro.breakEven ? fmt(pro.breakEven) + " FCFA" : "—",
      pro.breakEven ? `${Math.round((pro.revenue / pro.breakEven) * 100)}% atteint` : "");

  $("bilan-cash").innerHTML =
    bilanCard("Caisse (espèces)", fmt(b.caisse) + " FCFA") +
    bilanCard("Coffre", fmt(b.coffre) + " FCFA") +
    bilanCard("Trésorerie totale", fmt(b.tresorerie) + " FCFA",
      b.coverage !== null ? `≈ ${b.coverage.toFixed(1)} mois de charges` : "") +
    bilanCard("Crédits à encaisser", fmt(b.creditOutstanding) + " FCFA", `${b.openCredits.length} crédit(s) ouvert(s)`);

  $("bilan-stock").innerHTML =
    bilanCard("Valeur du stock (vente)", fmt(b.stockVal.sale) + " FCFA") +
    bilanCard("Valeur du stock (coût)", fmt(b.stockVal.cost) + " FCFA", `${fmt(b.stockVal.units)} articles`) +
    bilanCard("Commandes à passer", fmt(b.toOrder.length), `${b.reorder.length - b.toOrder.length} déjà commandée(s)`) +
    bilanCard("Produits en rupture", fmt(b.ruptures.length)) +
    bilanCard("Parfums en rupture", fmt(b.perfumeOut.length));

  $("bilan-other").innerHTML =
    bilanCard("Frais enregistrés", fmt(b.expTotal) + " FCFA",
      b.topExp.length ? `1ʳᵉ dépense : ${proEscape(b.topExp[0][0])}` : "") +
    bilanCard("Clients identifiés", fmt(b.buyers), "ayant acheté sur la période") +
    bilanCard("Anniversaires (72h)", fmt(b.birthdays));

  // ----- Top produits -----
  const topRows = Object.values(pro.byProduct).sort((x, y) => y.revenue - x.revenue).slice(0, 8);
  $("bilan-top-body").innerHTML = topRows.length
    ? topRows.map((p) => `<tr><td>${proEscape(p.name)}</td><td>${p.qty}</td><td>${fmt(p.revenue)}</td>
        <td class="${p.revenue - p.cost >= 0 ? "text-pos" : "text-neg"}">${fmt(p.revenue - p.cost)}</td></tr>`).join("")
    : `<tr><td colspan="4">Aucune vente sur cette période.</td></tr>`;

  renderBilanChart(b);
}

function renderBilanChart(b) {
  const canvas = document.getElementById("bilan-chart");
  if (!canvas || typeof Chart === "undefined") return;

  const buckets = [];
  const period = bilanState.period;
  if (period === "year") {
    const y = Number(b.from.slice(0, 4));
    for (let m = 0; m < 12; m++) buckets.push({ key: `${y}-${String(m + 1).padStart(2, "0")}`, label: new Date(y, m, 1).toLocaleDateString("fr-FR", { month: "short" }), ca: 0, exp: 0 });
  } else if (period === "day") {
    for (let h = 0; h < 24; h++) buckets.push({ key: h, label: `${h}h`, ca: 0, exp: 0 });
  } else {
    const [y, m, d] = b.from.split("-").map(Number);
    const start = new Date(y, m - 1, d);
    for (let cur = new Date(start); toLocalDateStr(cur) <= b.to; cur.setDate(cur.getDate() + 1)) {
      buckets.push({ key: toLocalDateStr(cur), label: cur.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }), ca: 0, exp: 0 });
    }
  }

  const bucketOf = (dateVal) => {
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return null;
    if (period === "year") return toLocalDateStr(d).slice(0, 7);
    if (period === "day") return d.getHours();
    return toLocalDateStr(d);
  };
  const map = new Map(buckets.map((x) => [x.key, x]));
  b.periodSales.forEach((s) => { const k = map.get(bucketOf(s.date)); if (k) k.ca += Number(s.total) || 0; });
  fraisCaisse().forEach((e) => {
    const key = dateKeyOf(e.date);
    if (!key || key < b.from || key > b.to) return;
    const k = map.get(bucketOf(e.date));
    if (k) k.exp += Number(e.amount) || 0;
  });

  if (bilanChart) bilanChart.destroy();
  bilanChart = new Chart(canvas, {
    type: "bar",
    data: {
      labels: buckets.map((x) => x.label),
      datasets: [
        { label: "Ventes (FCFA)", data: buckets.map((x) => x.ca), backgroundColor: "#10b981", borderRadius: 4 },
        { label: "Frais (FCFA)", data: buckets.map((x) => x.exp), backgroundColor: "#f97316", borderRadius: 4 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom" },
        tooltip: { callbacks: { label: (c) => ` ${c.dataset.label} : ${fmt(c.raw)}` } }
      },
      scales: { y: { beginAtZero: true, ticks: { callback: (v) => fmt(v) } } }
    }
  });
}

// =====================================================================
// ================== TABLEAUX EN CARTES SUR MOBILE ==================
// =====================================================================
// Sur téléphone, chaque ligne de tableau devient une carte et chaque
// cellule affiche le nom de sa colonne (ex : « Téléphone : 77… »).
function labelTableCells(table) {
  const headers = [...table.querySelectorAll("thead th")].map((th) => th.textContent.trim());
  if (!headers.length) return;
  table.classList.add("cards-mobile");
  table.querySelectorAll("tbody tr").forEach((tr) => {
    let col = 0;
    [...tr.children].forEach((td) => {
      if (!td.hasAttribute("colspan")) td.setAttribute("data-label", headers[col] || "");
      col += Number(td.getAttribute("colspan")) || 1;
    });
  });
}

function setupResponsiveTables() {
  const container = document.querySelector(".app-container");
  if (!container) return;
  const run = () => container.querySelectorAll("table").forEach(labelTableCells);
  run();
  let timer = null;
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(run, 30);
  }).observe(container, { childList: true, subtree: true });
}

// ================== INIT ==================
document.addEventListener("DOMContentLoaded", () => {
  // ✅ V2
  fillExpenseCategorySelect(document.getElementById("expense-category"));
  fillExpenseCategorySelect(document.getElementById("mm-category"));
  document.getElementById("mm-confirm")?.addEventListener("click", submitMoneyModal);
  document.getElementById("mm-amount")?.addEventListener("keydown", (e) => { if (e.key === "Enter") submitMoneyModal(); });
  syncVaultFromSheet(); // ✅ recharge caisse + coffre depuis Google Sheets
  setupResponsiveTables();
  renderExpensesTable();
  renderStockHistoryTable();

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

  // ✅ monnaie à rendre
  document.getElementById("cash-recu")?.addEventListener("input", updateMonnaie);
  setPaymentMode("cash");

  // ✅ recherche du client en caisse
  document.getElementById("client-picker-input")?.addEventListener("input", clientPickerSearch);
  document.getElementById("client-picker-input")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); document.querySelector("#client-picker-list button")?.click(); }
    if (e.key === "Escape") { e.target.value = ""; clientPickerSearch(); }
  });

  // ✅ formulaire nouveau client
  document.getElementById("client-form-phone")?.addEventListener("input", checkClientFormDuplicate);
  document.getElementById("client-form-modal")?.addEventListener("keydown", (e) => { if (e.key === "Escape") closeClientFormModal(); });

  // Rafraîchissement auto ventes (30s)
  // ✅ caisse + coffre resynchronisés avec Google Sheets toutes les 60 s (plusieurs appareils)
  setInterval(() => {
    // ✅ on arrête après 3 échecs d'affilée (évite d'insister si le script n'est pas à jour)
    if (vaultSheetStatus !== "missing" && vaultSyncFailures < 3) syncVaultFromSheet();
  }, 60000);

  setInterval(() => {
    fetchSalesFromSheet();
  }, 30000);

  // ✅ stock rechargé toutes les 45 s (ventes faites sur un autre appareil)
  setInterval(() => {
    if (!document.hidden) fetchStockFromSheet();
  }, 45000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) fetchStockFromSheet(); });
});
// =====================================================================
// ================== SOUS-ONGLETS DE PRO ==================
// =====================================================================
// Tableau de bord, Produits, Bilan, Coffre et Testeurs & casse sont regroupés dans Pro
const PRO_SOUS_ONGLETS = [
  { view: "pro", label: "💰 Résultat" },
  { view: "dashboard", label: "📊 Tableau de bord" },
  { view: "produits", label: "📦 Produits" },
  { view: "bilan", label: "🩺 Bilan" },
  { view: "coffre", label: "🏦 Coffre" },
  { view: "pertes", label: "🧪 Testeurs & casse" }
];

function renderProSubnav(viewName) {
  const estPro = PRO_SOUS_ONGLETS.some((o) => o.view === viewName);
  const btnPro = document.querySelector(`nav button[onclick="showView('pro')"]`);
  if (btnPro) btnPro.classList.toggle("nav-current", estPro);
  if (!estPro) return;
  const section = document.getElementById(`view-${viewName}`);
  if (!section) return;
  let bar = section.querySelector(".pro-subnav");
  if (!bar) {
    bar = document.createElement("div");
    bar.className = "pro-subnav";
    const h2 = section.querySelector("h2");
    if (h2) h2.insertAdjacentElement("afterend", bar); else section.prepend(bar);
  }
  bar.innerHTML = PRO_SOUS_ONGLETS.map((o) =>
    `<button type="button" data-sub="${o.view}" class="${o.view === viewName ? "active" : ""}" onclick="showView('${o.view}')">${o.label}</button>`
  ).join("");
  updateNavBadges();
}

// =====================================================================
// ================== PRIME DU GÉRANT ==================
// =====================================================================
// Prime = taux % de la partie du chiffre d'affaires du mois qui dépasse l'objectif
function computePrime(refStr) {
  const r = computePro("month", refStr);
  const objectif = Number(proSettings.prime.objectif) || 0;
  const taux = Number(proSettings.prime.taux) || 0;
  const depassement = Math.max(0, r.revenue - objectif);
  const prime = Math.round((depassement * taux) / 100);
  return { from: r.from, to: r.to, ca: r.revenue, objectif, taux, depassement, prime, net: r.net };
}

function moisLabel(fromStr) {
  const [y, m] = fromStr.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
}

function setPrimeReglage(champ, valeur) {
  const v = Math.max(0, Number(valeur) || 0);
  proSettings.prime[champ] = champ === "taux" ? Math.min(v, 100) : v;
  saveProSettings();
  renderPrime();
}

function renderPrime() {
  const box = document.getElementById("prime-box");
  if (!box) return;
  const ref = proState.refDate || todayLocalStr();
  const p = computePrime(ref);
  const pct = p.objectif > 0 ? Math.min((p.ca / p.objectif) * 100, 150) : 0;
  const atteint = p.ca >= p.objectif && p.objectif > 0;

  // 6 derniers mois (jusqu'au mois de la date de référence)
  const [y, m] = ref.split("-").map(Number);
  const historique = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1);
    historique.push(computePrime(toLocalDateStr(d)));
  }

  const objIn = document.getElementById("prime-objectif");
  const tauxIn = document.getElementById("prime-taux");
  if (objIn && document.activeElement !== objIn) objIn.value = p.objectif;
  if (tauxIn && document.activeElement !== tauxIn) tauxIn.value = p.taux;

  box.innerHTML = `
    <div class="prime-titre">Mois de ${moisLabel(p.from)}</div>
    <div class="dashboard-summary">
      <div class="card"><div class="label">Chiffre d'affaires du mois</div><div class="value">${fmt(p.ca)} FCFA</div></div>
      <div class="card"><div class="label">Objectif</div><div class="value">${fmt(p.objectif)} FCFA</div></div>
      <div class="card"><div class="label">Au-dessus de l'objectif</div><div class="value">${fmt(p.depassement)} FCFA</div></div>
      <div class="card pro-net ${atteint ? "pos" : ""}"><div class="label">Prime du gérant (${p.taux} %)</div><div class="value">${fmt(p.prime)} FCFA</div></div>
    </div>
    <div class="breakeven-bar prime-bar"><div class="breakeven-fill ${atteint ? "reached" : ""}" style="width:${pct / 1.5}%"></div><div class="breakeven-mark" title="Objectif"></div></div>
    <p class="help-text">${atteint
      ? `✅ Objectif atteint : ${p.taux} % de ${fmt(p.depassement)} FCFA = <strong>${fmt(p.prime)} FCFA</strong> de prime. Chaque 10 000 F de ventes en plus ajoute ${fmt(100 * p.taux)} F.`
      : `Il manque <strong>${fmt(Math.max(0, p.objectif - p.ca))} FCFA</strong> de ventes ce mois-ci pour débloquer la prime.`}
      Résultat du mois après prime : <strong class="${p.net - p.prime >= 0 ? "text-pos" : "text-neg"}">${p.net - p.prime >= 0 ? "+" : "−"}${fmt(Math.abs(p.net - p.prime))} FCFA</strong>.</p>
    <table class="prime-historique">
      <thead><tr><th>Mois</th><th>CA</th><th>Objectif atteint</th><th>Prime</th></tr></thead>
      <tbody>${historique.slice().reverse().map((h) => `<tr>
        <td>${moisLabel(h.from)}</td>
        <td>${fmt(h.ca)}</td>
        <td>${h.ca >= h.objectif && h.objectif > 0 ? "✅" : `${h.objectif > 0 ? Math.round((h.ca / h.objectif) * 100) : 0} %`}</td>
        <td><strong>${fmt(h.prime)}</strong></td></tr>`).join("")}</tbody>
    </table>`;
}

// =====================================================================
// ================== TESTEURS & CASSE ==================
// =====================================================================
// Enregistrés dans l'historique de stock (feuille StockHistory) avec un motif « [TESTEUR] … » ou « [CASSE] … »
const PERTE_TYPES = {
  testeur: { label: "Testeur", pluriel: "testeurs", icon: "🧪", tag: "[TESTEUR]" },
  casse: { label: "Casse", pluriel: "casse", icon: "💥", tag: "[CASSE]" }
};
const perteState = { type: "testeur", productId: null, period: "month", refDate: null };

function perteTypeOf(reason) {
  const r = String(reason || "").trim().toUpperCase();
  if (r.startsWith("[TESTEUR]")) return "testeur";
  if (r.startsWith("[CASSE]")) return "casse";
  return null;
}

function getPertes() {
  return (stockHistory || []).map((h) => {
    const type = perteTypeOf(h.reason);
    if (!type) return null;
    const qty = Math.max(0, -(Number(h.delta) || 0));
    if (!qty) return null;
    return {
      date: h.date, type, qty,
      productId: h.productId,
      productName: h.productName || "Produit",
      note: String(h.reason || "").trim().replace(/^\[[A-Z]+\]\s*/i, "")
    };
  }).filter(Boolean);
}

// ---------- Caisse ----------
function testeurType(type) {
  perteState.type = type;
  document.querySelectorAll("#testeur-types .pay-mode").forEach((b) => b.classList.toggle("active", b.dataset.type === type));
}

function testeurChercher() {
  const input = document.getElementById("testeur-recherche");
  const list = document.getElementById("testeur-liste");
  const q = sansAccent(input.value.trim());
  // ✅ seulement les produits en stock (sans recherche : toute la liste, triée par nom)
  const res = (products || []).filter((p) => !isServiceProduct(p) && (Number(p.stock) || 0) > 0 && (!q || sansAccent(p.name).includes(q)))
    .sort((a, b) => (q ? (sansAccent(a.name).startsWith(q) ? 0 : 1) - (sansAccent(b.name).startsWith(q) ? 0 : 1) : 0) ||
      String(a.name).localeCompare(String(b.name), "fr"));
  list.innerHTML = res.map((p) =>
    `<button type="button" onclick="testeurChoisir('${proEscape(String(p.id))}')"><strong>${proEscape(p.name)}</strong> <small>stock ${Number(p.stock) || 0}</small></button>`
  ).join("") || `<div class="help-text" style="padding:6px 8px;">${q ? "Aucun produit en stock ne correspond." : "Aucun produit en stock."}</div>`;
  list.classList.remove("hidden");
}

function testeurChoisir(id) {
  perteState.productId = id;
  document.getElementById("testeur-recherche").value = "";
  document.getElementById("testeur-liste").classList.add("hidden");
  renderTesteurPanel();
}

function testeurProduit() {
  return (products || []).find((p) => String(p.id) === String(perteState.productId)) || null;
}

function testeurValider() {
  if (!stockPret()) return;
  const p = testeurProduit();
  if (!p) return alert("Choisis d'abord le produit.");
  const qty = parseInt(document.getElementById("testeur-qte").value, 10);
  if (!qty || qty < 1) return alert("Quantité invalide.");
  const stock = Number(p.stock) || 0;
  if (qty > stock) return alert(`Stock insuffisant : il reste ${stock} × ${p.name}.`);
  const t = PERTE_TYPES[perteState.type];
  const note = document.getElementById("testeur-note").value.trim();
  if (!confirm(`${t.icon} ${t.label} : retirer ${qty} × ${p.name} du stock ?\n\nStock : ${stock} → ${stock - qty}`)) return;

  p.stock = stock - qty;
  saveProducts(products);
  sendStockToSheetWithFallback(products);

  const change = {
    date: new Date().toISOString(),
    productId: p.id,
    productName: p.name,
    oldStock: stock,
    newStock: p.stock,
    delta: -qty,
    reason: `${t.tag} ${note || t.label}`.trim()
  };
  logStockChangeToSheet(change);
  if (!Array.isArray(stockHistory)) stockHistory = [];
  stockHistory.push(change);

  perteState.productId = null;
  document.getElementById("testeur-qte").value = 1;
  document.getElementById("testeur-note").value = "";
  renderProductsForSale();
  renderProductsTable();
  renderStockHistoryTable();
  updateNavBadges();
  renderTesteurPanel();
  refreshProIfVisible();
}

function renderTesteurPanel() {
  const choisi = document.getElementById("testeur-choisi");
  if (!choisi) return;
  const p = testeurProduit();
  choisi.innerHTML = p
    ? `<span class="testeur-produit">${proEscape(p.name)} <small>(stock ${Number(p.stock) || 0})</small>
        <button type="button" class="small-btn" onclick="perteState.productId=null;renderTesteurPanel()">✕</button></span>`
    : "";
  document.getElementById("testeur-recherche").classList.toggle("hidden", !!p);

  const today = todayLocalStr();
  const jour = getPertes().filter((x) => dateKeyOf(x.date) === today).sort((a, b) => new Date(b.date) - new Date(a.date));
  const nb = (type) => jour.filter((x) => x.type === type).reduce((s, x) => s + x.qty, 0);
  const resume = document.getElementById("testeur-resume");
  if (resume) resume.textContent = jour.length ? `aujourd'hui ${nb("testeur")} testeur(s), ${nb("casse")} casse` : "rien aujourd'hui";
  const box = document.getElementById("testeur-jour");
  if (box) box.innerHTML = jour.length
    ? `<div class="help-text" style="margin-top:10px;"><strong>Sortis aujourd'hui :</strong></div>` + jour.map((x) =>
        `<div class="testeur-ligne">${PERTE_TYPES[x.type].icon} ${x.qty} × ${proEscape(x.productName)}
          <small>${new Date(x.date).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}${x.note && x.note !== PERTE_TYPES[x.type].label ? " • " + proEscape(x.note) : ""}</small></div>`).join("")
    : "";
}

// ---------- Pro → Testeurs & casse ----------
function setPertesPeriode(period) { perteState.period = period; renderPertesView(); }
function setPertesRef(v) { if (v) { perteState.refDate = v; renderPertesView(); } }

function resumePertes(from, to) {
  const dans = (v) => { const k = dateKeyOf(v); return k && k >= from && k <= to; };
  const L = getPertes().filter((x) => dans(x.date));
  const res = { liste: L, testeurs: 0, casse: 0, cout: 0, valeur: 0, parProduit: {} };
  L.forEach((x) => {
    const k = proKey(x.productName);
    const cout = x.qty * (getUnitCost(x.productName) || 0);
    const valeur = x.qty * getCatalogPrice(x.productName);
    if (x.type === "testeur") res.testeurs += x.qty; else res.casse += x.qty;
    res.cout += cout; res.valeur += valeur;
    if (!res.parProduit[k]) res.parProduit[k] = { name: x.productName, testeurs: 0, casse: 0, cout: 0, vendus: 0 };
    res.parProduit[k][x.type === "testeur" ? "testeurs" : "casse"] += x.qty;
    res.parProduit[k].cout += cout;
  });
  // unités vendues sur la même période, pour comparer
  (sales || []).forEach((s) => {
    if (!dans(s.date)) return;
    (s.items || []).forEach((i) => {
      const k = proKey(i.name);
      if (res.parProduit[k]) res.parProduit[k].vendus += Number(i.qty) || 0;
    });
  });
  return res;
}

function renderPertesView() {
  if (!document.getElementById("pertes-kpis")) return;
  if (!perteState.refDate) perteState.refDate = todayLocalStr();
  document.getElementById("pertes-ref").value = perteState.refDate;
  document.querySelectorAll(".pertes-period-btn").forEach((b) => b.classList.toggle("active", b.dataset.period === perteState.period));

  const { from, to } = getProRange(perteState.period, perteState.refDate);
  const r = resumePertes(from, to);
  const prev = getProRange(perteState.period, previousRef(perteState.period, perteState.refDate));
  const rp = resumePertes(prev.from, prev.to);
  const evo = (a, b) => b > 0 ? (a === b ? "pareil que la période d'avant" : `${a > b ? "+" : "−"}${Math.round(Math.abs(a - b) * 100 / b)} % vs période d'avant`) : (a > 0 ? "rien la période d'avant" : "");

  document.getElementById("pertes-range").textContent = `Période : du ${fmtDateFr(from)} au ${fmtDateFr(to)}`;
  const card = (label, value, sub = "") => `<div class="card"><div class="label">${label}</div><div class="value">${value}</div>${sub ? `<div class="label">${sub}</div>` : ""}</div>`;
  document.getElementById("pertes-kpis").innerHTML =
    card("🧪 Testeurs ouverts", fmt(r.testeurs), evo(r.testeurs, rp.testeurs)) +
    card("💥 Produits cassés", fmt(r.casse), evo(r.casse, rp.casse)) +
    card("Coût (prix de revient)", fmt(r.cout) + " FCFA", "déduit du résultat dans Pro") +
    card("Valeur au prix de vente", fmt(r.valeur) + " FCFA");

  // Par produit
  const rows = Object.values(r.parProduit).sort((a, b) => b.cout - a.cout || (b.testeurs + b.casse) - (a.testeurs + a.casse));
  document.getElementById("pertes-produits").innerHTML = rows.length
    ? rows.map((p) => `<tr>
        <td>${proEscape(p.name)}</td>
        <td>${p.testeurs || ""}</td>
        <td>${p.casse || ""}</td>
        <td>${fmt(p.cout)}</td>
        <td>${p.vendus}</td>
        <td>${p.testeurs ? (p.vendus ? (Math.round((p.vendus / p.testeurs) * 10) / 10).toLocaleString("fr-FR") : "0") : "—"}</td>
      </tr>`).join("")
    : `<tr><td colspan="6">Aucun testeur ni casse sur cette période.</td></tr>`;

  // Conseils
  const conseils = [];
  const testeursSansVente = rows.filter((p) => p.testeurs > 0 && p.vendus === 0);
  if (testeursSansVente.length) conseils.push(`🔎 Testeur ouvert mais <strong>aucune vente</strong> sur la période : ${testeursSansVente.map((p) => proEscape(p.name)).join(", ")}. Vérifie s'il faut vraiment un testeur pour ces parfums.`);
  const bons = rows.filter((p) => p.testeurs > 0 && p.vendus / p.testeurs >= 10).sort((a, b) => b.vendus / b.testeurs - a.vendus / a.testeurs);
  if (bons.length) conseils.push(`✅ Testeurs rentables (10 ventes ou plus par testeur) : ${bons.slice(0, 5).map((p) => `${proEscape(p.name)} (${Math.round(p.vendus / p.testeurs)})`).join(", ")}.`);
  if (r.casse > 0) {
    const topCasse = rows.filter((p) => p.casse > 0).sort((a, b) => b.casse - a.casse)[0];
    conseils.push(`💥 Casse : ${fmt(r.casse)} produit(s) pour ${fmt(r.liste.filter((x) => x.type === "casse").reduce((s, x) => s + x.qty * (getUnitCost(x.productName) || 0), 0))} FCFA. Le plus touché : ${proEscape(topCasse.name)} (${topCasse.casse}). Pense au rangement et aux étagères.`);
  }
  const sansCout = rows.filter((p) => getUnitCost(p.name) === null);
  if (sansCout.length) conseils.push(`⚠️ Coût de revient manquant (compté 0) : ${sansCout.map((p) => proEscape(p.name)).join(", ")}. À remplir dans Pro → Résultat.`);
  document.getElementById("pertes-conseils").innerHTML = conseils.map((c) => `<li>${c}</li>`).join("") || "<li>Rien à signaler.</li>";

  // 6 derniers mois
  const [y, m] = perteState.refDate.split("-").map(Number);
  const mois = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1);
    const rg = getProRange("month", toLocalDateStr(d));
    mois.push({ from: rg.from, ...resumePertes(rg.from, rg.to) });
  }
  const max = Math.max(1, ...mois.map((x) => x.cout));
  document.getElementById("pertes-mois").innerHTML = mois.map((x) => `<tr>
      <td>${moisLabel(x.from)}</td><td>${x.testeurs}</td><td>${x.casse}</td>
      <td><div class="pertes-barre"><span style="width:${(x.cout / max) * 100}%"></span></div>${fmt(x.cout)} F</td></tr>`).join("");

  // Détail
  const liste = r.liste.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  document.getElementById("pertes-detail").innerHTML = liste.length
    ? liste.map((x) => `<tr>
        <td>${new Date(x.date).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
        <td>${PERTE_TYPES[x.type].icon} ${PERTE_TYPES[x.type].label}</td>
        <td>${proEscape(x.productName)}</td><td>${x.qty}</td>
        <td>${fmt(x.qty * (getUnitCost(x.productName) || 0))}</td>
        <td>${x.note && x.note !== PERTE_TYPES[x.type].label ? proEscape(x.note) : ""}</td></tr>`).join("")
    : `<tr><td colspan="6">Rien sur cette période.</td></tr>`;
}

// ferme la liste des produits (testeurs) quand on touche ailleurs
document.addEventListener("click", (e) => {
  const list = document.getElementById("testeur-liste");
  if (list && !list.classList.contains("hidden") && !e.target.closest("#testeur-panel .client-picker")) list.classList.add("hidden");
});
