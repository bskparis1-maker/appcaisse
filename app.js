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
  full: { label: "1L ou plus", className: "perfume-full" },
  half: { label: "0,5L",       className: "perfume-half" },
  out:  { label: "Rupture",    className: "perfume-out" }
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
let dashboardChart = null;
let lastTicketSale = null; // dernière vente pour le bouton "Imprimer le ticket"
let stockHistory = [];
let expenses = [];

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
  const debugEl = document.getElementById("sales-debug");
  if (debugEl) {
    debugEl.textContent = "Connexion à Google Sheets…";
  }

  const callbackName = "onSalesFromSheet_" + Date.now();
  const script = document.createElement("script");

  window[callbackName] = function (data) {
    try {
      if (data && Array.isArray(data.sales)) {
        // On transforme ce que renvoie Code.gs en objets "vente"
        sales = data.sales.map(s => {
          const info = s.info || {};

          // Liste produits + quantités
          const names = (s.productNames || "")
            .split(",")
            .map(t => t.trim())
            .filter(Boolean);

          const qtys = (s.quantities || "")
            .split(",")
            .map(t => parseInt(t, 10) || 0);

          const items = names.map((name, index) => ({
            name,
            qty: qtys[index] || 0
          }));

          return {
            id: s.id,
            date: s.date,                            // "YYYY-MM-DDTHH:mm:ss"
            total: Number(s.total) || 0,             // montant payé
            items,
            paymentMethod: info.paymentMethod || "cash",
            discountAmount: Number(info.discountAmount) || 0,
            discountReason: info.discountReason || "",
            clientId: info.clientId || "",
            clientName: info.clientName || "",
            clientPhone: info.clientPhone || ""
          };
        });

        saveSales(sales);

        if (debugEl) {
          debugEl.textContent =
            "Ventes reçues depuis Google Sheets : " + sales.length;
        }
      } else {
        if (debugEl) {
          debugEl.textContent =
            "Réponse vide ou invalide depuis Google Sheets.";
        }
      }
    } finally {
      updateSalesViewForSelectedDate();
      renderClientsTable();
      delete window[callbackName];
      script.remove();
    }
  };

  script.src = `${SHEET_URL}?action=getSales&callback=${callbackName}`;
  script.onerror = function () {
    console.warn("Erreur chargement ventes (local uniquement).");
    if (debugEl) {
      debugEl.textContent =
        "Erreur de connexion à Google Sheets (getSales).";
    }
    updateSalesViewForSelectedDate();
    renderClientsTable();
  };

  document.body.appendChild(script);
}

function refreshSalesFromSheet() {
  fetchSalesFromSheet();
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
    initSalesDate();
    updateSalesViewForSelectedDate();
  } else if (viewName === "dashboard") {
    initDashboardDates();
    loadDashboardStats();
  } else if (viewName === "barparfum") {
    renderPerfumeBar();
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
  const end   = document.getElementById("promo-end").value;

  if (!start || !end) {
    alert("Merci de définir une date de début et une date de fin.");
    return;
  }

  saveCurrentPromo({
    start,
    end,
    new8000: p8000,
    new5000: p5000
  });

  alert("Promo enregistrée.");
  closePromoPopup();
  renderProductsForSale();
}

// -------- PRODUITS (AFFICHAGE CAISSE) --------

function renderProductsForSale() {
  const container = document.getElementById("products-list");
  if (!container) return;
  container.innerHTML = "";

  products.forEach(p => {
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
  const product = products.find(p => p.id === productId);
  if (!product) {
    alert("Produit introuvable.");
    return;
  }

  const qtyInput = document.getElementById(`qty-${productId}`);
  const qty = parseInt(qtyInput?.value, 10) || 1;
  if (qty <= 0) return;

  // Quantité déjà dans le panier
  const alreadyInCart = cart
    .filter(item => item.productId === productId)
    .reduce((sum, item) => sum + item.qty, 0);

  if (alreadyInCart + qty > product.stock) {
    alert("Stock insuffisant !");
    return;
  }

  const wholesaleMode = document.getElementById("wholesale-mode")?.checked;

  let unitPrice = getPromoPrice(product.price);
  let wholesale = false;

  if (wholesaleMode) {
    // on demande le prix unitaire pour cette vente
    const custom = Number(
      prompt(`Prix unitaire (gros) pour ${product.name} (FCFA) :`)
    );
    if (!custom || custom <= 0) {
      return;
    }
    unitPrice = custom;
    wholesale = true;
  }

  const existing = cart.find(
    item =>
      item.productId === productId &&
      item.price === unitPrice &&
      item.wholesale === wholesale
  );

  if (existing && !wholesale) {
    // on cumule uniquement en mode normal
    existing.qty += qty;
  } else {
    cart.push({
      productId: product.id,
      name: product.name,
      basePrice: product.price, // prix catalogue
      price: unitPrice,         // prix utilisé (modifiable si wholesale)
      qty,
      wholesale
    });
  }

  renderCart();
}

function calculateCartTotals() {
  const wholesaleMode = document.getElementById("wholesale-mode")?.checked;

  let baseTotal = 0;
  let promoEligibleQty = 0;

  cart.forEach(item => {
    baseTotal += item.price * item.qty;

    if (!wholesaleMode && !item.wholesale && item.basePrice === 8000) {
      promoEligibleQty += item.qty;
    }
  });

  let promoDiscount = 0;
  if (!wholesaleMode) {
    promoDiscount = Math.floor(promoEligibleQty / 2) * 1000;
  }

  const discountInput = document.getElementById("cart-discount");
  let manualDiscount = 0;

  if (discountInput) {
    if (wholesaleMode) {
      // en gros → remise désactivée
      discountInput.disabled = true;
      discountInput.value = "0";
    } else {
      discountInput.disabled = false;
      manualDiscount = Math.max(0, parseInt(discountInput.value, 10) || 0);
    }
  }

  let finalTotal = baseTotal - promoDiscount - manualDiscount;
  if (finalTotal < 0) finalTotal = 0;

  return {
    baseTotal,
    promoDiscount,
    manualDiscount,
    finalTotal
  };
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

    // si article en gros → prix modifiable dans le panier
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

function printTicket() {
  let saleToPrint = null;

  // 1) Priorité : la dernière vente enregistrée dans lastTicketSale
  if (typeof lastTicketSale !== "undefined" && lastTicketSale) {
    saleToPrint = lastTicketSale;
  }

  // 2) Si jamais lastTicketSale est vide, on prend la dernière vente du tableau sales
  if ((!saleToPrint || !saleToPrint.items) && Array.isArray(sales) && sales.length > 0) {
    saleToPrint = sales[sales.length - 1];
  }

  if (!saleToPrint) {
    alert("Aucune vente à imprimer.");
    return;
  }

  openReceiptWindow(saleToPrint);
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

  // 1) Vérifier le stock
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

  // 2) Soustraire du stock
  cart.forEach(item => {
    const product = products.find(p => p.id === item.productId);
    if (product) {
      product.stock = Math.max(0, product.stock - item.qty);
    }
  });
  saveProducts(products);
  if (typeof sendStockToSheet === "function") {
    sendStockToSheet(products);
  }

  // 3) Totaux (promo + remise manuelle)
  const totals = calculateCartTotals();

  // Mode de paiement
  const methodSelect = document.getElementById("payment-method");
  const paymentMethod = methodSelect ? methodSelect.value : "cash";

  // Vente en gros ?
  const wholesaleMode = document.getElementById("wholesale-mode")?.checked;

  // 4) Client & fidélité
  const select = document.getElementById("client-select");
  let clientId = null;
  let clientName = "";
  let clientPhone = "";
  let loyaltyDiscount = 0;
  let loyaltyReasonText = "";

  if (select && select.value && !wholesaleMode) {
    // En mode GROS : pas de remise fidélité
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
      const beforeTranches = Math.floor(clientTotalBefore / 100000);
      const afterTranches = Math.floor(
        (clientTotalBefore + totalBeforeLoyalty) / 100000
      );

      if (afterTranches > beforeTranches) {
        loyaltyDiscount = Math.floor(totalBeforeLoyalty * 0.10);
        loyaltyReasonText = "remise fidélité 10%";
      }
    }
  }

  // 5) Remise totale + raison
  const discountReasonInput = document.getElementById("cart-discount-reason");
  const userReason = discountReasonInput ? discountReasonInput.value.trim() : "";

  let promoDiscount = totals.promoDiscount || 0;
  let manualDiscount = totals.manualDiscount || 0;

  if (wholesaleMode) {
    // En gros : pas de remises
    promoDiscount = 0;
    manualDiscount = 0;
    loyaltyDiscount = 0;
  }

  let fullDiscountReason = userReason;
  if (promoDiscount > 0) {
    if (fullDiscountReason) fullDiscountReason += " + ";
    fullDiscountReason += "promo 2x8000";
  }
  if (loyaltyDiscount > 0) {
    if (fullDiscountReason) fullDiscountReason += " + ";
    fullDiscountReason += loyaltyReasonText;
  }
  if (wholesaleMode) {
    if (fullDiscountReason) fullDiscountReason += " + ";
    fullDiscountReason += "vente en gros";
  }

  const baseTotal = totals.baseTotal;
  const totalDiscount = promoDiscount + manualDiscount + loyaltyDiscount;
  const finalTotal = Math.max(0, baseTotal - totalDiscount);

  // 6) Construire l'objet vente (avec prix pour le ticket)
  const sale = {
    id: Date.now(),
    date: new Date().toISOString(),
    baseTotal: baseTotal,
    total: finalTotal,
    items: cart.map(item => {
      const product = products.find(p => p.id === item.productId);
      const unitPrice =
        item.price != null
          ? item.price
          : product
          ? product.price
          : 0;
      return {
        productId: item.productId,
        name: product ? product.name : (item.name || ""),
        qty: item.qty,
        price: unitPrice,
        lineTotal: unitPrice * item.qty
      };
    }),
    paymentMethod,
    promoDiscount,
    manualDiscount,
    loyaltyDiscount,
    discountAmount: totalDiscount,
    discountReason: fullDiscountReason,
    clientId,
    clientName,
    clientPhone,
    wholesale: wholesaleMode ? true : false
  };

  // 7) Mise à jour client local (si pas vente en gros)
  if (clientId && !wholesaleMode) {
    const client = clients.find(c => c.id === clientId);
    if (client) {
      let totalSpent = 0;
      sales.forEach(s => {
        if (s.clientId === clientId) totalSpent += s.total || 0;
      });
      totalSpent += finalTotal;

      client.totalSpent = totalSpent;
      client.orderCount = (client.orderCount || 0) + 1;
      saveClients(clients);
      renderClientsTable();
      renderClientSelect();
    }
  }

  // 8) Sauvegarde + envoi à Sheets
  sales.push(sale);
  saveSales(sales);
  if (typeof sendSaleToSheet === "function") {
    sendSaleToSheet(sale);
  }

  // 9) Préparer le ticket pour le bouton "Imprimer le ticket"
  lastTicketSale = sale;   // 👈 utilisé par printTicket()

  // 10) Nettoyage
  clearCart();
  renderProductsForSale();
  updateSalesViewForSelectedDate();

  alert("Vente enregistrée !");
}

// ================== TICKET DE CAISSE ==================
function openReceiptWindow(sale) {
  const boutiqueName = "BSK";
  const dateStr = new Date(sale.date).toLocaleString("fr-FR");

  let rowsHtml = "";
  sale.items.forEach(item => {
    const product = products.find(p => p.id === item.productId);
    const name = item.name || (product ? product.name : "");
    const unitPrice = item.price != null
      ? item.price
      : (product ? product.price : 0);
    const lineTotal = unitPrice * item.qty;

    rowsHtml += `
      <tr>
        <td>${name}</td>
        <td style="text-align:center;">${item.qty}</td>
        <td style="text-align:right;">${unitPrice} FCFA</td>
        <td style="text-align:right;">${lineTotal} FCFA</td>
      </tr>
    `;
  });

  const baseTotal = sale.baseTotal || sale.total;
  const promoDiscount = sale.promoDiscount || 0;
  const manualDiscount = sale.manualDiscount || 0;
  const loyaltyDiscount = sale.loyaltyDiscount || 0;
  const discountReason = sale.discountReason || "";

  let discountRowsHtml = `
    <tr class="discount-row">
      <td colspan="3" style="text-align:right;">Sous-total :</td>
      <td style="text-align:right;">${baseTotal} FCFA</td>
    </tr>
  `;

  if (promoDiscount > 0) {
    discountRowsHtml += `
      <tr class="discount-row">
        <td colspan="3" style="text-align:right;">Remise promo 2x8000 :</td>
        <td style="text-align:right;">- ${promoDiscount} FCFA</td>
      </tr>
    `;
  }

  if (manualDiscount > 0) {
    discountRowsHtml += `
      <tr class="discount-row">
        <td colspan="3" style="text-align:right;">Remise :</td>
        <td style="text-align:right;">- ${manualDiscount} FCFA</td>
      </tr>
    `;
  }

  if (loyaltyDiscount > 0) {
    discountRowsHtml += `
      <tr class="discount-row">
        <td colspan="3" style="text-align:right;">Remise fidélité 10% :</td>
        <td style="text-align:right;">- ${loyaltyDiscount} FCFA</td>
      </tr>
    `;
  }

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
        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          font-size: 13px;
          margin: 10px;
          color: #111827;
        }
        .ticket-container {
          max-width: 320px;
          margin: 0 auto;
        }
        .ticket-logo {
          text-align: center;
          margin-bottom: 4px;
        }
        .ticket-logo img {
          width: 60px;
          height: 60px;
          object-fit: cover;
          border-radius: 14px;
          border: 1px solid #e5e7eb;
        }
        h1 {
          font-size: 18px;
          text-align: center;
          margin: 4px 0 2px;
        }
        .subtitle {
          text-align: center;
          font-size: 11px;
          color: #6b7280;
          margin-bottom: 8px;
        }
        .line {
          border-top: 1px dashed #9ca3af;
          margin: 6px 0;
        }
        table {
          border-collapse: collapse;
          width: 100%;
        }
        th, td {
          padding: 3px 0;
        }
        th {
          border-bottom: 1px solid #e5e7eb;
          font-size: 12px;
          text-align: left;
        }
        .total-row td {
          border-top: 1px solid #e5e7eb;
          padding-top: 6px;
          font-weight: 600;
        }
        .discount-row td {
          font-size: 12px;
          color: #6b7280;
        }
        .footer {
          margin-top: 12px;
          text-align: center;
          font-size: 12px;
          color: #374151;
          line-height: 1.4;
        }
        .print-btn {
          margin-top: 10px;
          padding: 6px 10px;
          font-size: 12px;
        }
        .qr {
          margin-top: 6px;
          width: 120px;
          height: 120px;
        }
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
          <img
            class="qr"
            src="https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=https://wa.me/221778769201"
            alt="QR WhatsApp BSK"
          >
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

// ================== BOUTON "IMPRIMER LE TICKET" ==================
function printTicket() {
  // On utilise d'abord lastTicketSale, sinon la dernière vente du tableau sales
  let saleToPrint = null;

  if (lastTicketSale) {
    saleToPrint = lastTicketSale;
  } else if (Array.isArray(sales) && sales.length > 0) {
    saleToPrint = sales[sales.length - 1];
  }

  if (!saleToPrint) {
    alert("Aucune vente à imprimer.");
    return;
  }

  openReceiptWindow(saleToPrint);
}
// ================== PRODUITS & STOCK ==================

// Rendu de la table des produits (onglet "Produits & Stock")
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

  products.forEach(p => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${p.name}</td>
      <td>${p.price || 0} FCFA</td>
      <td>${p.stock || 0}</td>
      <td>
        <input
          type="number"
          id="stock-input-${p.id}"
          value="${p.stock || 0}"
          min="0"
        />
      </td>
      <td>
        <button onclick="updateProductStock(${p.id})">Mettre à jour</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// Modification manuelle du stock d'un produit
function updateProductStock(productId) {
  const product = products.find(p => p.id === productId);
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

  // 🔥 Motif obligatoire
  const reason = prompt("Motif de modification du stock :");
  if (!reason || !reason.trim()) {
    alert("Le motif est obligatoire.");
    input.value = oldStock;
    return;
  }

  // Mise à jour locale
  product.stock = newStock;
  saveProducts(products);
  renderProductsTable();

  // Envoi du stock complet vers Google Sheets (updateStock)
  sendStockToSheetWithFallback(products);

  // Historique : construire l'entrée
  const change = {
    date: new Date().toISOString(),
    productId: product.id,
    productName: product.name,
    oldStock,
    newStock,
    delta: newStock - oldStock,
    reason: reason.trim()
  };

  // Envoi dans l'historique Sheets
  logStockChangeToSheet(change);

  // Ajouter aussi localement & rafraîchir l'affichage
  if (!Array.isArray(stockHistory)) stockHistory = [];
  stockHistory.push(change);
  renderStockHistoryTable();
}

// Envoi du stock vers Sheets (action=updateStock)
function sendStockToSheetWithFallback(productsList) {
  // Si tu as déjà une fonction sendStockToSheet, on l'utilise
  if (typeof sendStockToSheet === "function") {
    sendStockToSheet(productsList);
    return;
  }

  // Sinon on fait un fallback direct
  const payload = JSON.stringify({ products: productsList });
  const url = `${SHEET_URL}?action=updateStock&payload=${encodeURIComponent(payload)}`;

  fetch(url)
    .then(r => r.text())
    .then(txt => {
      console.log("updateStock ->", txt);
    })
    .catch(err => {
      console.error("updateStock error:", err);
    });
}

// Envoi d'un mouvement de stock vers Sheets (logStockChange)
function logStockChangeToSheet(change) {
  const payload = JSON.stringify({ change });
  const url = `${SHEET_URL}?action=logStockChange&payload=${encodeURIComponent(payload)}`;

  fetch(url)
    .then(r => r.text())
    .then(txt => {
      console.log("logStockChange ->", txt);
    })
    .catch(err => {
      console.error("logStockChange error:", err);
    });
}

// Lecture de l'historique depuis Sheets
function fetchStockHistoryFromSheet() {
  const callbackName = "onStockHistory_" + Date.now();
  const script = document.createElement("script");

  window[callbackName] = function (data) {
    try {
      if (data && Array.isArray(data.history)) {
        stockHistory = data.history.map(h => {
          const oldStock = Number(h.oldStock) || 0;
          const newStock = Number(h.newStock) || 0;
          const delta =
            typeof h.delta !== "undefined"
              ? Number(h.delta) || 0
              : newStock - oldStock;

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

// Affichage de l'historique dans le tableau
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

  if (startInput && startInput.value) {
    start = new Date(startInput.value + "T00:00:00");
  }
  if (endInput && endInput.value) {
    end = new Date(endInput.value + "T23:59:59");
  }

  // Derniers mouvements en premier
  const sorted = [...stockHistory].sort((a, b) => {
    const da = new Date(a.date).getTime();
    const db = new Date(b.date).getTime();
    return db - da;
  });

  const filtered = sorted.filter(entry => {
    const d = new Date(entry.date);
    if (isNaN(d.getTime())) {
      // si la date est invalide et qu'il y a un filtre, on l'ignore
      if (start || end) return false;
      return true;
    }
    if (start && d < start) return false;
    if (end && d > end) return false;
    return true;
  }).slice(0, 300); // limite à 300 lignes max

  if (filtered.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="6">Aucun mouvement pour cette période.</td>`;
    tbody.appendChild(tr);
    return;
  }

  filtered.forEach(entry => {
    const d = new Date(entry.date);
    const dateStr = isNaN(d.getTime())
      ? entry.date
      : d.toLocaleString("fr-FR");

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

  const today = new Date();
  const iso = today.toISOString().slice(0, 10);
  startInput.value = iso;
  endInput.value = iso;

  renderStockHistoryTable();
}

function setStockHistoryRangeWeek() {
  const startInput = document.getElementById("stock-history-start");
  const endInput = document.getElementById("stock-history-end");
  if (!startInput || !endInput) return;

  const today = new Date();
  const day = today.getDay(); // 0=dimanche, 1=lundi, ...
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

// Ajout d'une dépense
function addExpense() {
  const labelInput = document.getElementById("expense-label");
  const amountInput = document.getElementById("expense-amount");
  if (!labelInput || !amountInput) return;

  const label = (labelInput.value || "").trim();
  const amount = Number(amountInput.value) || 0;

  if (!label) {
    alert("Merci de renseigner le motif de la dépense.");
    return;
  }
  if (amount <= 0) {
    alert("Merci de renseigner un montant valide.");
    return;
  }

  const nowIso = new Date().toISOString();

  const expense = {
    id: Date.now(),
    date: nowIso,
    label,
    amount
  };

  if (!Array.isArray(expenses)) expenses = [];
  expenses.push(expense);

  // Sauvegarde locale (optionnel mais pratique)
  saveExpenses(expenses);

  // Envoi à Google Sheets
  sendExpenseToSheet(expense);

  // Nettoyage des champs
  labelInput.value = "";
  amountInput.value = "";

  renderExpensesTable();

  alert("Dépense enregistrée.");
}

// Sauvegarde locale dans localStorage
function saveExpenses(list) {
  try {
    localStorage.setItem("bsk_expenses", JSON.stringify(list || []));
  } catch (e) {
    console.warn("Impossible de sauvegarder les frais en local", e);
  }
}

// Lecture locale (optionnel si Sheets ne répond pas)
function loadExpensesFromLocal() {
  try {
    const raw = localStorage.getItem("bsk_expenses");
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

// Envoi d'une dépense vers Google Sheets
function sendExpenseToSheet(expense) {
  const payload = JSON.stringify({ expense });
  const url = `${SHEET_URL}?action=addExpense&payload=${encodeURIComponent(payload)}`;

  fetch(url)
    .then(r => r.text())
    .then(txt => {
      console.log("addExpense ->", txt);
    })
    .catch(err => {
      console.error("addExpense error:", err);
    });
}

// Récupération des dépenses depuis Google Sheets
function fetchExpensesFromSheet() {
  const callbackName = "onExpensesFromSheet_" + Date.now();
  const script = document.createElement("script");

  window[callbackName] = function (data) {
    try {
      if (data && Array.isArray(data.expenses)) {
        expenses = data.expenses.map(e => ({
          id: e.id || Date.now(),
          date: e.date,
          label: e.label || "",
          amount: Number(e.amount) || 0
        }));
        saveExpenses(expenses);
      } else {
        // si rien depuis Sheets, on peut retomber sur le localStorage
        expenses = loadExpensesFromLocal();
      }
      renderExpensesTable();
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

// Affichage filtré de l'historique des frais
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

  if (startInput && startInput.value) {
    start = new Date(startInput.value + "T00:00:00");
  }
  if (endInput && endInput.value) {
    end = new Date(endInput.value + "T23:59:59");
  }

  const sorted = [...expenses].sort((a, b) => {
    const da = new Date(a.date).getTime();
    const db = new Date(b.date).getTime();
    return db - da;
  });

  const filtered = sorted.filter(entry => {
    const d = new Date(entry.date);
    if (isNaN(d.getTime())) {
      if (start || end) return false;
      return true;
    }
    if (start && d < start) return false;
    if (end && d > end) return false;
    return true;
  }).slice(0, 300);

  if (filtered.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="3">Aucune dépense pour cette période.</td>`;
    tbody.appendChild(tr);
    return;
  }

  filtered.forEach(e => {
    const d = new Date(e.date);
    const dateStr = isNaN(d.getTime())
      ? e.date
      : d.toLocaleString("fr-FR");

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${dateStr}</td>
      <td>${e.label}</td>
      <td>${e.amount} FCFA</td>
    `;
    tbody.appendChild(tr);
  });
}

// Raccourcis de filtre : aujourd'hui / semaine / mois / année
function setExpenseHistoryRangeToday() {
  const startInput = document.getElementById("expense-history-start");
  const endInput = document.getElementById("expense-history-end");
  if (!startInput || !endInput) return;

  const today = new Date();
  const iso = today.toISOString().slice(0, 10);
  startInput.value = iso;
  endInput.value = iso;

  renderExpensesTable();
}

function setExpenseHistoryRangeWeek() {
  const startInput = document.getElementById("expense-history-start");
  const endInput = document.getElementById("expense-history-end");
  if (!startInput || !endInput) return;

  const today = new Date();
  const day = today.getDay(); // 0=dimanche, 1=lundi, ...
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
function renderClientsTable() {
  const tbody = document.getElementById("clients-table-body");
  if (!tbody) return;

  const searchInput = document.getElementById("client-search");
  const term = searchInput ? searchInput.value.trim().toLowerCase() : "";

  tbody.innerHTML = "";

  const list = clients.filter(c =>
    c.name.toLowerCase().includes(term) ||
    (c.phone || "").toLowerCase().includes(term)
  );

  if (list.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="4">Aucun client trouvé.</td>`;
    tbody.appendChild(tr);
    return;
  }

  list.forEach(c => {
    const totalSpent = computeClientTotal(c.id);

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${c.name}</td>
      <td>${c.phone || ""}</td>
      <td>${totalSpent} FCFA</td>
      <td>
        <button class="secondary-btn" onclick="openClientPopup('${c.id}')">
          Détails
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}
function computeClientTotal(clientId) {
  let sum = 0;

  sales.forEach(s => {
    if (s.clientId == clientId) { // == pour accepter string ou nombre
      sum += Number(s.total) || 0;
    }
  });

  return sum;
}
function openClientPopup(clientId) {
  const c = clients.find(c => c.id == clientId);
  if (!c) return;

  // Nom & téléphone
  document.getElementById("popup-client-name").textContent = c.name;
  document.getElementById("popup-client-phone").textContent = c.phone || "—";

  const historyDiv = document.getElementById("popup-client-history");
  historyDiv.innerHTML = "";

  // Toutes les ventes de ce client, triées de la plus récente à la plus ancienne
  const historySales = sales
    .filter(s => s.clientId == clientId)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  if (historySales.length === 0) {
    historyDiv.textContent = "Aucun achat pour ce client.";
  } else {
    historySales.forEach(s => {
      const div = document.createElement("div");
      div.style.marginBottom = "10px";

      const dateStr = new Date(s.date).toLocaleString();

      div.innerHTML = `
        <div><strong>${dateStr}</strong></div>
        <div>Montant : ${s.total} FCFA</div>
        <div>Paiement : ${s.paymentMethod || "-"}</div>
        ${
          s.discountAmount > 0
            ? `<div>Remise : -${s.discountAmount} FCFA (${s.discountReason || "—"})</div>`
            : ""
        }
        <div>Produits :</div>
        <ul>
          ${
            (s.items || [])
              .map(i => `<li>${i.name} × ${i.qty}</li>`)
              .join("")
          }
        </ul>
        <hr>
      `;
      historyDiv.appendChild(div);
    });
  }

  document.getElementById("popup-client").classList.remove("hidden");
}

function closeClientPopup() {
  document.getElementById("popup-client").classList.add("hidden");
}
// ================== VENTES : AFFICHAGE JOURNALIER ==================
function updateSalesViewForSelectedDate() {
  const tbody = document.getElementById("sales-table-body");
  const dateInput = document.getElementById("sales-date");
  if (!tbody || !dateInput) return;

  // Si aucune date choisie, on met aujourd'hui
  if (!dateInput.value) {
    const todayIso = new Date().toISOString().slice(0, 10);
    dateInput.value = todayIso;
  }
  const dayStr = dateInput.value; // "YYYY-MM-DD"

  tbody.innerHTML = "";

  // Filtrer les ventes du jour
  const daySales = sales.filter(s => {
    if (!s.date) return false;
    const dStr = String(s.date).slice(0, 10);
    return dStr === dayStr;
  });

  if (daySales.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="5">Aucune vente pour ce jour.</td>`;
    tbody.appendChild(tr);
    return;
  }

  daySales.forEach(sale => {
    const tr = document.createElement("tr");

    // Heure
    const d = new Date(sale.date);
    const timeStr = isNaN(d.getTime())
      ? ""
      : d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

    // Produits (nom + qté + prix unitaire)
    let productsHtml = "";
    if (Array.isArray(sale.items) && sale.items.length > 0) {
      productsHtml = sale.items
        .map(item => {
          const name = item.name || "Produit";
          const qty = item.qty || 0;
          const unitPrice = item.price != null ? item.price : 0;
          return `${name} x ${qty} (${unitPrice} FCFA)`;
        })
        .join("<br>");
    }

    // Montant
    const amount = sale.total || 0;

    // Mode de paiement
    let pm = sale.paymentMethod || "cash";
    if (pm === "cash") pm = "Espèces";
    else if (pm === "orange") pm = "Orange Money";
    else if (pm === "wave") pm = "Wave";

    // Client
    let clientLabel = "—";
    if (sale.clientName) {
      clientLabel = sale.clientName;
      if (sale.clientPhone) {
        clientLabel += " (" + sale.clientPhone + ")";
      }
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
        <button class="danger-btn" onclick="deleteSale(${sale.id})">
          Supprimer
        </button>
      </td>
    `;

    tbody.appendChild(tr);
  });
}

// ================== VENTES : SUPPRESSION ==================
function deleteSale(saleId) {
  if (!confirm("Supprimer définitivement cette vente ?")) {
    return;
  }

  // Trouver la vente dans le tableau local
  const index = sales.findIndex(s => s.id === saleId);
  if (index === -1) {
    alert("Vente introuvable.");
    return;
  }

  // On enlève la vente du tableau
  sales.splice(index, 1);
  saveSales(sales); // met à jour le localStorage

  // Mettre à jour la vue Ventes & Clients & Dashboard
  updateSalesViewForSelectedDate();
  renderClientsTable();
  if (typeof loadDashboardStats === "function") {
    loadDashboardStats();
  }

  // Appeler Google Sheets pour supprimer aussi côté Sheets
  const url = `${SHEET_URL}?action=deleteSale&id=${encodeURIComponent(saleId)}`;
  fetch(url)
    .then(r => r.text())
    .then(txt => {
      console.log("Suppression vente Sheets :", txt);
    })
    .catch(err => {
      console.error("Erreur suppression vente Sheets :", err);
    });
}

// ================== RAPPORT JOURNALIER (PDF) ==================
function openDailyReportForSelectedDate() {
  const dateStr = getSelectedSalesDate();
  openDailyReportForDate(dateStr);
}

function openDailyReportForDate(dateStr) {
  const daySales = getSalesForDate(dateStr);
  if (daySales.length === 0) {
    alert("Aucune vente pour ce jour.");
    return;
  }

  const dateLabel = new Date(dateStr + "T00:00:00").toLocaleDateString("fr-FR");

  let total = 0;
  const productMap = {}; // name -> { qty, amount, unitPrice, times[] }

  daySales.forEach(sale => {
    total += sale.total;

    // Somme de base avant remise
    let baseSum = 0;
    sale.items.forEach(item => {
      const product = products.find(p => p.id === item.productId);
      const unit = product ? product.price : 0;
      baseSum += unit * item.qty;
    });

    const saleDiscountTotal =
      (sale.promoDiscount || 0) +
      (sale.manualDiscount || 0) +
      (sale.loyaltyDiscount || 0);

    const saleTime = new Date(sale.date).toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit"
    });

    sale.items.forEach(item => {
      const product = products.find(p => p.id === item.productId);
      const name = item.name || (product ? product.name : "");
      const unitPrice = product ? product.price : 0;
      const lineBase = unitPrice * item.qty;

      let lineFinal = lineBase;
      if (baseSum > 0 && saleDiscountTotal > 0) {
        const ratio = lineBase / baseSum;
        const lineDiscount = Math.round(saleDiscountTotal * ratio);
        lineFinal = lineBase - lineDiscount;
      }

      if (!productMap[name]) {
        productMap[name] = { qty: 0, amount: 0, unitPrice: unitPrice, times: [] };
      }
      productMap[name].qty += item.qty;
      productMap[name].amount += lineFinal;
      productMap[name].times.push(saleTime);
    });
  });

  const average = Math.round(total / daySales.length);

  let productRows = "";
  Object.keys(productMap).forEach(name => {
    const info = productMap[name];
    const timesStr = info.times.join(", ");
    const unitDisplay = info.qty > 0 ? Math.round(info.amount / info.qty) : info.unitPrice;
    productRows += `
      <tr>
        <td>${name}</td>
        <td style="text-align:center;">${info.qty}</td>
        <td style="text-align:right;">${unitDisplay} FCFA</td>
        <td style="text-align:right;">${info.amount} FCFA</td>
        <td>${timesStr}</td>
      </tr>
    `;
  });

  const html = `
    <!DOCTYPE html>
    <html lang="fr">
    <head>
      <meta charset="UTF-8">
      <title>Rapport du ${dateLabel} - BSK</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          font-size: 13px;
          margin: 20px;
          color: #111827;
        }
        .report-container {
          max-width: 800px;
          margin: 0 auto;
        }
        .report-header {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 10px;
        }
        .report-header img {
          width: 60px;
          height: 60px;
          object-fit: cover;
          border-radius: 14px;
          border: 1px solid #e5e7eb;
        }
        h1 {
          margin: 0;
          font-size: 22px;
        }
        .subtitle {
          font-size: 12px;
          color: #6b7280;
        }
        h2 {
          font-size: 16px;
          margin-top: 16px;
          margin-bottom: 6px;
          border-bottom: 1px solid #e5e7eb;
          padding-bottom: 4px;
        }
        table {
          border-collapse: collapse;
          width: 100%;
          margin-top: 6px;
        }
        th, td {
          border: 1px solid #e5e7eb;
          padding: 6px 8px;
          text-align: left;
        }
        th {
          background: #f3f4f6;
          font-size: 12px;
        }
        .summary {
          margin-top: 8px;
          font-size: 13px;
        }
        .print-btn {
          margin-top: 16px;
          padding: 8px 14px;
          font-size: 13px;
        }
      </style>
    </head>
    <body>
      <div class="report-container">
        <div class="report-header">
          <img src="logo.png" alt="Logo BSK" onerror="this.style.display='none'">
          <div>
            <h1>Rapport de ventes</h1>
            <div class="subtitle">
              Date : ${dateLabel}<br>
              Grand Dakar – Garage Casamance · Tél : 77 876 92 01
            </div>
          </div>
        </div>

        <h2>Résumé</h2>
        <div class="summary">
          Nombre de ventes : <strong>${daySales.length}</strong><br>
          Total du jour : <strong>${total} FCFA</strong><br>
          Panier moyen : <strong>${average} FCFA</strong>
        </div>

        <h2>Répartition par produit (prix après remise)</h2>
        <table>
          <thead>
            <tr>
              <th>Produit</th>
              <th>Quantité vendue</th>
              <th>Prix moyen (avec remise)</th>
              <th>Montant total (avec remise)</th>
              <th>Heure(s) de vente</th>
            </tr>
          </thead>
          <tbody>
            ${productRows}
          </tbody>
        </table>

        <button class="print-btn" onclick="window.print()">
          Imprimer / Enregistrer en PDF
        </button>
      </div>
    </body>
    </html>
  `;

  const win = window.open("", "_blank", "width=900,height=900");
  if (!win) {
    alert("Autorisez les pop-up pour afficher le rapport.");
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
}

// ================== DASHBOARD ==================

/**
 * Initialise les dates du tableau de bord à aujourd'hui
 * si rien n'est encore rempli.
 */
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

/** Raccourci : aujourd'hui */
function setDashboardRangeToday() {
  const today = new Date().toISOString().slice(0, 10);
  const startInput = document.getElementById("dashboard-start");
  const endInput = document.getElementById("dashboard-end");
  if (!startInput || !endInput) return;

  startInput.value = today;
  endInput.value = today;
  loadDashboardStats();
}

/** Raccourci : cette semaine (lundi -> dimanche) */
function setDashboardRangeWeek() {
  const now = new Date();
  const dayOfWeek = now.getDay() || 7; // Dimanche = 0 -> 7
  const monday = new Date(now);
  monday.setDate(now.getDate() - dayOfWeek + 1);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const startInput = document.getElementById("dashboard-start");
  const endInput = document.getElementById("dashboard-end");
  if (!startInput || !endInput) return;

  startInput.value = monday.toISOString().slice(0, 10);
  endInput.value = sunday.toISOString().slice(0, 10);
  loadDashboardStats();
}

/** Raccourci : ce mois-ci */
function setDashboardRangeMonth() {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const startInput = document.getElementById("dashboard-start");
  const endInput = document.getElementById("dashboard-end");
  if (!startInput || !endInput) return;

  startInput.value = first.toISOString().slice(0, 10);
  endInput.value = last.toISOString().slice(0, 10);
  loadDashboardStats();
}

/** Raccourci : cette année */
function setDashboardRangeYear() {
  const now = new Date();
  const first = new Date(now.getFullYear(), 0, 1);
  const last = new Date(now.getFullYear(), 11, 31);

  const startInput = document.getElementById("dashboard-start");
  const endInput = document.getElementById("dashboard-end");
  if (!startInput || !endInput) return;

  startInput.value = first.toISOString().slice(0, 10);
  endInput.value = last.toISOString().slice(0, 10);
  loadDashboardStats();
}

/**
 * Calcule les stats du tableau de bord à partir de `sales`
 * (CA, nb ventes, remises, répartition paiements, CA/jour, ventes/jour)
 * puis met à jour les cartes + le graphique.
 */
function loadDashboardStats() {
  const startStr = document.getElementById("dashboard-start").value;
  const endStr = document.getElementById("dashboard-end").value;

  if (!startStr || !endStr) {
    alert("Merci de choisir une date de début et une date de fin.");
    return;
  }

  const start = new Date(startStr + "T00:00:00");
  const end = new Date(endStr + "T23:59:59");

  let total = 0;
  let count = 0;
  let discount = 0;
  let cash = 0;
  let orange = 0;
  let wave = 0;

  // Objet pour le graphique : total & nombre de ventes par jour
  const perDay = {}; // { "YYYY-MM-DD": { total: number, count: number } }

  sales.forEach(s => {
    const d = new Date(s.date);
    if (isNaN(d)) return;
    if (d < start || d > end) return;

    const amount = Number(s.total) || 0;
    total += amount;
    count += 1;
    discount += Number(s.discountAmount) || 0;

    if (s.paymentMethod === "orange") {
      orange += amount;
    } else if (s.paymentMethod === "wave") {
      wave += amount;
    } else {
      cash += amount;
    }

    const dayKey = s.date.slice(0, 10); // "YYYY-MM-DD"
    if (!perDay[dayKey]) {
      perDay[dayKey] = { total: 0, count: 0 };
    }
    perDay[dayKey].total += amount;
    perDay[dayKey].count += 1;
  });

  const avg = count > 0 ? Math.round(total / count) : 0;

  // Mise à jour des cartes
  document.getElementById("db-total").textContent = total;
  document.getElementById("db-count").textContent = count;
  document.getElementById("db-average").textContent = avg;
  document.getElementById("db-discount").textContent = discount;
  document.getElementById("db-cash").textContent = cash;
  document.getElementById("db-orange").textContent = orange;
  document.getElementById("db-wave").textContent = wave;

  // Mise à jour du graphique
  renderDashboardChart(perDay);
}

/**
 * Affiche le graphique avec 2 courbes :
 * - CA par jour
 * - Nombre de ventes par jour
 */
function renderDashboardChart(perDay) {
  const ctx = document.getElementById("dashboard-chart");
  if (!ctx) return;

  const labels = Object.keys(perDay).sort(); // dates triées
  const caData = labels.map(d => perDay[d].total);
  const countData = labels.map(d => perDay[d].count);

  if (dashboardChart) {
    dashboardChart.destroy();
  }

  dashboardChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "CA (FCFA)",
          data: caData,
          yAxisID: "y1",
          tension: 0.2
        },
        {
          label: "Nombre de ventes",
          data: countData,
          yAxisID: "y2",
          tension: 0.2
        }
      ]
    },
    options: {
      responsive: true,
      interaction: {
        mode: "index",
        intersect: false
      },
      scales: {
        y1: {
          type: "linear",
          position: "left"
        },
        y2: {
          type: "linear",
          position: "right",
          grid: {
            drawOnChartArea: false
          }
        }
      }
    }
  });
}

/**
 * (Optionnel) Si tu utilises encore la route "dashboard" de Code.gs
 * qui renvoie un objet agrégé { totalAmount, salesCount, ... },
 * tu peux garder cette fonction.
 * Sinon tu peux la supprimer.
 */
function updateDashboardUI(data) {
  if (!data) data = {};

  const total = data.totalAmount || 0;
  const count = data.salesCount || 0;
  const avg = count > 0 ? Math.round(total / count) : 0;
  const discount = data.totalDiscount || 0;
  const byPayment = data.byPayment || {};

  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };

  setText("db-total", total);
  setText("db-count", count);
  setText("db-average", avg);
  setText("db-discount", discount);
  setText("db-cash", byPayment.cash || 0);
  setText("db-orange", byPayment.orange || 0);
  setText("db-wave", byPayment.wave || 0);
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
// ================== INIT ==================
document.addEventListener("DOMContentLoaded", () => {
  showView("caisse");

  // Charger les données au démarrage
  fetchStockFromSheet();      // produits + stock
  fetchClientsFromSheet();    // clients
  fetchPerfumesFromSheet();   // bar à parfum
  fetchSalesFromSheet();      // toutes les ventes déjà présentes
  fetchStockHistoryFromSheet();  // 
  fetchExpensesFromSheet();

  const discountInput = document.getElementById("cart-discount");
  if (discountInput) {
    discountInput.addEventListener("input", renderCart);
  }

  // 🔄 Rafraîchissement automatique des ventes toutes les 30 secondes
  setInterval(() => {
    fetchSalesFromSheet();
  }, 30000); // 30 000 ms = 30 secondes
});
