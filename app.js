// ================== CONFIG GOOGLE SHEETS ==================
const SHEET_URL = "https://script.google.com/macros/s/AKfycbwIuoPvoE_1DcLGWY5aoEdAHHM1l_2eoqL5VReGyF0P8ctbzmvQwt6tDcgSzRfxcbw/exec";

// ================== PRODUITS CAISSE ==================
const defaultProducts = [
  { id: 1,  name: "Bar à Musc",        price: 8000, stock: 99 },
  { id: 2,  name: "Bar à Parfum",      price: 8000, stock: 68 },
  { id: 3,  name: "Bar à Thiouraye",   price: 5000, stock: 111 },

  { id: 4,  name: "Brume BUTTERFLY",   price: 8000, stock: 40 },
  { id: 5,  name: "Brume NEFERTITI",   price: 8000, stock: 26 },
  { id: 6,  name: "Brume SUMMER",      price: 8000, stock: 22 },
  { id: 7,  name: "Brume CRUSH",       price: 8000, stock: 19 },

  { id: 8,  name: "Musc BUTTERFLY",    price: 8000, stock: 8 },
  { id: 9,  name: "Musc NEFERTITI",    price: 8000, stock: 2 },
  { id: 10, name: "Musc CRUSH",        price: 8000, stock: 2 },
  { id: 11, name: "Musc SUMMER",       price: 8000, stock: 5 },

  { id: 12, name: "Jardin suspendu",   price: 5000, stock: 11 },
  { id: 13, name: "Nuit de noce",      price: 5000, stock: 3 },
  { id: 14, name: "Figue d’amour",     price: 5000, stock: 2 },
  { id: 15, name: "Linge de maman",    price: 5000, stock: 2 },
  { id: 16, name: "Bonbon",            price: 5000, stock: 2 },
  { id: 17, name: "Sweet Cotton",      price: 5000, stock: 0 }
];

// ================== BAR À PARFUM ==================
const PERFUME_LEVELS = {
  full: { label: "1L ou plus", className: "perfume-full" }, // vert
  half: { label: "0,5L",       className: "perfume-half" }, // orange
  out:  { label: "Rupture",    className: "perfume-out" }   // rouge
};

// ================== LOCAL STORAGE HELPERS ==================
function loadProducts() {
  const data = localStorage.getItem("products");
  if (data) return JSON.parse(data);
  localStorage.setItem("products", JSON.stringify(defaultProducts));
  return defaultProducts;
}

function saveProducts(products) {
  localStorage.setItem("products", JSON.stringify(products));
}

function loadSales() {
  const data = localStorage.getItem("sales");
  return data ? JSON.parse(data) : [];
}

function saveSales(sales) {
  localStorage.setItem("sales", JSON.stringify(sales));
}

function loadClients() {
  const data = localStorage.getItem("clients");
  return data ? JSON.parse(data) : [];
}

function saveClients(clients) {
  localStorage.setItem("clients", JSON.stringify(clients));
}

// ================== ÉTAT GLOBAL ==================
let products = loadProducts();
let sales = loadSales();
let clients = loadClients();
let cart = [];    // [{ productId, qty }]
let perfumes = []; // [{ name, level }]

// ================== STOCK <-> SHEETS ==================
function fetchStockFromSheet() {
  const callbackName = "onStockFromSheet_" + Date.now();

  const script = document.createElement("script");
  window[callbackName] = function (data) {
    try {
      if (data && Array.isArray(data.products) && data.products.length > 0) {
        products = data.products.map(p => ({
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

      fetchSalesFromSheet();
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
    fetchSalesFromSheet();
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
        clients = data.clients.map(c => ({
          id: Number(c.id),
          name: c.name,
          phone: c.phone,
          createdAt: c.createdAt || new Date().toISOString()
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
    console.warn("Erreur chargement clients (local uniquement).");
    renderClientSelect();
    renderClientsTable();
  };
  document.body.appendChild(script);
}

// ================== VENTES <-> SHEETS ==================
function fetchSalesFromSheet() {
  const callbackName = "onSalesFromSheet_" + Date.now();
  const script = document.createElement("script");

  window[callbackName] = function (data) {
    try {
      if (data && Array.isArray(data.sales)) {
        sales = data.sales.map(s => {
          const info = s.info || {};
          const names = (s.productNames || "")
            .split(",")
            .map(t => t.trim())
            .filter(Boolean);
          const qtys = (s.quantities || "")
            .split(",")
            .map(t => parseInt(t, 10) || 0);

          const items = names.map((name, index) => {
            const product = products.find(p => p.name === name);
            return {
              productId: product ? product.id : null,
              name,
              qty: qtys[index] || 0
            };
          });

          const total = Number(s.total) || 0;
          const discountAmount = Number(info.discountAmount) || 0;
          const loyaltyDiscount = Number(info.loyaltyDiscount) || 0;
          const baseTotal = total + discountAmount;
          const manualDiscount = discountAmount - loyaltyDiscount;

          return {
            id: s.id,
            date: s.date,
            baseTotal: baseTotal,
            total: total,
            items,
            paymentMethod: info.paymentMethod || "cash",
            promoDiscount: 0,
            manualDiscount: manualDiscount > 0 ? manualDiscount : 0,
            loyaltyDiscount: loyaltyDiscount,
            discountAmount: discountAmount,
            discountReason: info.discountReason || "",
            clientId: info.clientId ? Number(info.clientId) : null,
            clientName: info.clientName || "",
            clientPhone: info.clientPhone || ""
          };
        });

        saveSales(sales);
      }
    } finally {
      renderSalesTable();
      updateTodayTotal();
      updateTodayTotalsByPayment();
      renderClientsTable();
      delete window[callbackName];
      script.remove();
    }
  };

  script.src = `${SHEET_URL}?action=getSales&callback=${callbackName}`;
  script.onerror = function () {
    console.warn("Erreur chargement ventes (local uniquement).");
    renderSalesTable();
    updateTodayTotal();
    updateTodayTotalsByPayment();
    renderClientsTable();
  };
  document.body.appendChild(script);
}

// ================== BAR À PARFUM <-> SHEETS ==================
function fetchPerfumesFromSheet() {
  const callbackName = "onPerfumes_" + Date.now();
  const script = document.createElement("script");

  window[callbackName] = function (data) {
    try {
      if (data && Array.isArray(data.perfumes)) {
        perfumes = data.perfumes.map(p => ({
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

// ================== NAVIGATION ==================
function showView(viewName) {
  document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
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
    renderSalesTable();
  } else if (viewName === "dashboard") {
    initDashboardDates();
    loadDashboardStats();
  } else if (viewName === "barparfum") {
    renderPerfumeBar();
  }
}

// ================== PRODUITS (CAISSE) ==================
function renderProductsForSale() {
  const container = document.getElementById("products-list");
  if (!container) return;
  container.innerHTML = "";

  products.forEach(p => {
    const div = document.createElement("div");
    div.className = "product-card";
    div.innerHTML = `
      <strong>${p.name}</strong><br>
      Prix : ${p.price} FCFA<br>
      Stock : ${p.stock}<br>
      <label>Quantité :
        <input type="number" min="1" value="1" id="qty-${p.id}">
      </label><br>
      <button onclick="addToCart(${p.id})">Ajouter au panier</button>
    `;
    container.appendChild(div);
  });
}

function addToCart(productId) {
  const product = products.find(p => p.id === productId);
  if (!product) return;

  const qtyInput = document.getElementById(`qty-${productId}`);
  const qty = parseInt(qtyInput.value, 10) || 1;
  if (qty <= 0) return;

  if (qty > product.stock) {
    alert("Stock insuffisant !");
    return;
  }

  const existing = cart.find(i => i.productId === productId);
  if (existing) {
    if (existing.qty + qty > product.stock) {
      alert("Stock insuffisant !");
      return;
    }
    existing.qty += qty;
  } else {
    cart.push({ productId, qty });
  }

  renderCart();
}

// ================== CALCUL TOTAL PANIER ==================
function calculateCartTotals() {
  let baseTotal = 0;
  let promoEligibleQty = 0;

  cart.forEach(item => {
    const product = products.find(p => p.id === item.productId);
    if (!product) return;
    baseTotal += product.price * item.qty;
    if (product.price === 8000) {
      promoEligibleQty += item.qty;
    }
  });

  const promoDiscount = Math.floor(promoEligibleQty / 2) * 1000;

  const discountInput = document.getElementById("cart-discount");
  const manualDiscount = discountInput
    ? Math.max(0, parseInt(discountInput.value, 10) || 0)
    : 0;

  let finalTotal = baseTotal - promoDiscount - manualDiscount;
  if (finalTotal < 0) finalTotal = 0;

  return {
    baseTotal,
    promoDiscount,
    manualDiscount,
    finalTotal
  };
}

// ================== PANIER ==================
function renderCart() {
  const container = document.getElementById("cart-list");
  const totalSpan = document.getElementById("cart-total");
  if (!container || !totalSpan) return;

  container.innerHTML = "";

  cart.forEach(item => {
    const product = products.find(p => p.id === item.productId);
    if (!product) return;
    const lineTotal = product.price * item.qty;
    const div = document.createElement("div");
    div.textContent = `${product.name} x ${item.qty} = ${lineTotal} FCFA`;
    container.appendChild(div);
  });

  const totals = calculateCartTotals();
  totalSpan.textContent = totals.finalTotal;
}

function clearCart() {
  cart = [];
  const discountInput = document.getElementById("cart-discount");
  const discountReasonInput = document.getElementById("cart-discount-reason");
  if (discountInput) discountInput.value = "0";
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

  clients.forEach(c => {
    const opt = document.createElement("option");
    opt.value = String(c.id);
    opt.textContent = `${c.name}${c.phone ? " (" + c.phone + ")" : ""}`;
    select.appendChild(opt);
  });

  if (current && clients.some(c => String(c.id) === current)) {
    select.value = current;
  }
}

function openAddClientModal() {
  const name = prompt("Nom du client :");
  if (!name || !name.trim()) return;

  const phone = prompt("Téléphone du client (optionnel) :") || "";

  const newClient = {
    id: Date.now(),
    name: name.trim(),
    phone: phone.trim(),
    createdAt: new Date().toISOString()
  };

  clients.push(newClient);
  saveClients(clients);

  sendClientToSheet(newClient);
  renderClientSelect();
  renderClientsTable();

  alert("Client ajouté.");
}

// ================== ENVOI VENTE -> SHEETS ==================
function sendSaleToSheet(sale) {
  const payload = encodeURIComponent(JSON.stringify({ sale }));
  const url = `${SHEET_URL}?payload=${payload}`;

  const iframe = document.createElement("iframe");
  iframe.style.display = "none";
  iframe.src = url;
  document.body.appendChild(iframe);

  setTimeout(() => iframe.remove(), 5000);
}

// ================== CONFIRMATION VENTE ==================
function confirmSale() {
  if (cart.length === 0) {
    alert("Panier vide !");
    return;
  }

  // Vérifier stock
  for (const item of cart) {
    const product = products.find(p => p.id === item.productId);
    if (!product) {
      alert("Produit introuvable.");
      return;
    }
    if (item.qty > product.stock) {
      alert(`Stock insuffisant pour ${product.name}`);
      return;
    }
  }

  // Soustraire du stock
  cart.forEach(item => {
    const product = products.find(p => p.id === item.productId);
    if (product) {
      product.stock -= item.qty;
    }
  });
  saveProducts(products);
  sendStockToSheet(products);

  // Totaux
  const totals = calculateCartTotals();

  // Mode de paiement
  const methodSelect = document.getElementById("payment-method");
  const paymentMethod = methodSelect ? methodSelect.value : "cash";

  // Client & fidélité par tranche de 100 000
  const select = document.getElementById("client-select");
  let clientId = null;
  let clientName = "";
  let clientPhone = "";
  let loyaltyDiscount = 0;
  let loyaltyReasonText = "";

  if (select && select.value) {
    clientId = Number(select.value);
    const client = clients.find(c => c.id === clientId);
    if (client) {
      clientName = client.name;
      clientPhone = client.phone || "";

      let clientTotalBefore = 0;
      sales.forEach(s => {
        if (s.clientId === clientId) clientTotalBefore += s.total || 0;
      });

      const totalBeforeLoyalty = totals.finalTotal;
      const beforeTranches = Math.floor(clientTotalBefore
