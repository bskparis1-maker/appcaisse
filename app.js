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

  const finalTotal = Math.max(0, totals.finalTotal - loyaltyDiscount);

  const discountReasonInput = document.getElementById("cart-discount-reason");
  const userReason = discountReasonInput ? discountReasonInput.value.trim() : "";

  let fullDiscountReason = userReason;
  if (totals.promoDiscount > 0) {
    if (fullDiscountReason) fullDiscountReason += " + ";
    fullDiscountReason += "promo 2x8000";
  }
  if (loyaltyDiscount > 0) {
    if (fullDiscountReason) fullDiscountReason += " + ";
    fullDiscountReason += loyaltyReasonText;
  }

  const sale = {
    id: Date.now(),
    date: new Date().toISOString(),
    baseTotal: totals.baseTotal,
    total: finalTotal,
    items: cart.map(item => {
      const product = products.find(p => p.id === item.productId);
      return {
        productId: item.productId,
        name: product ? product.name : "",
        qty: item.qty
      };
    }),
    paymentMethod,
    promoDiscount: totals.promoDiscount,
    manualDiscount: totals.manualDiscount,
    loyaltyDiscount,
    discountAmount: totals.promoDiscount + totals.manualDiscount + loyaltyDiscount,
    discountReason: fullDiscountReason,
    clientId,
    clientName,
    clientPhone
  };

  // Mise à jour client local
  if (clientId) {
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

  sales.push(sale);
  saveSales(sales);
  sendSaleToSheet(sale);

  openReceiptWindow(sale);
  clearCart();
  renderProductsForSale();
  updateTodayTotal();
  updateTodayTotalsByPayment();

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
    const unitPrice = product ? product.price : 0;
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

// ================== PRODUITS / STOCK (ONGLET PRODUITS) ==================
function renderProductsTable() {
  const tbody = document.getElementById("products-table-body");
  if (!tbody) return;
  tbody.innerHTML = "";

  products.forEach(p => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${p.name}</td>
      <td>${p.price} FCFA</td>
      <td>${p.stock}</td>
      <td>
        <input type="number" id="new-stock-${p.id}" value="${p.stock}">
        <button onclick="updateStock(${p.id})">Sauver</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function updateStock(productId) {
  const input = document.getElementById(`new-stock-${productId}`);
  const newStock = parseInt(input.value, 10);
  if (isNaN(newStock) || newStock < 0) {
    alert("Stock invalide.");
    return;
  }

  const product = products.find(p => p.id === productId);
  if (!product) return;

  product.stock = newStock;
  saveProducts(products);
  renderProductsTable();
  renderProductsForSale();
  sendStockToSheet(products);
  alert("Stock mis à jour.");
}

// ================== CLIENTS (ONGLET CLIENTS) ==================
function renderClientsTable() {
  const tbody = document.getElementById("clients-table-body");
  if (!tbody) return;
  tbody.innerHTML = "";

  const searchInput = document.getElementById("client-search");
  const term = searchInput ? searchInput.value.trim().toLowerCase() : "";

  let list = clients;
  if (term) {
    list = clients.filter(c =>
      c.name.toLowerCase().includes(term) ||
      (c.phone || "").toLowerCase().includes(term)
    );
  }

  if (list.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="4">Aucun client trouvé.</td>`;
    tbody.appendChild(tr);
    return;
  }

  list.forEach(c => {
    let totalSpent = c.totalSpent || 0;
    if (!totalSpent) {
      sales.forEach(s => {
        if (s.clientId === c.id) totalSpent += s.total || 0;
      });
      c.totalSpent = totalSpent;
    }

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${c.name}</td>
      <td>${c.phone || ""}</td>
      <td>${c.totalSpent || 0} FCFA</td>
      <td><button onclick="alertClientInfo(${c.id})">Détails</button></td>
    `;
    tbody.appendChild(tr);
  });

  saveClients(clients);
}

function alertClientInfo(clientId) {
  const client = clients.find(c => c.id === clientId);
  if (!client) return;

  let totalSpent = client.totalSpent || 0;
  if (!totalSpent) {
    sales.forEach(s => {
      if (s.clientId === clientId) totalSpent += s.total || 0;
    });
  }

  alert(
    `Client : ${client.name}\n` +
    `Téléphone : ${client.phone || "—"}\n` +
    `Total achats : ${totalSpent} FCFA`
  );
}

// ================== VENTES (ONGLET VENTES) ==================
function updateTodayTotal() {
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth();
  const d = today.getDate();

  let total = 0;
  sales.forEach(sale => {
    const sd = new Date(sale.date);
    if (sd.getFullYear() === y && sd.getMonth() === m && sd.getDate() === d) {
      total += sale.total;
    }
  });

  const span = document.getElementById("today-total");
  if (span) span.textContent = total;
}

function updateTodayTotalsByPayment() {
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth();
  const d = today.getDate();

  let cash = 0, orange = 0, wave = 0;

  sales.forEach(sale => {
    const sd = new Date(sale.date);
    if (sd.getFullYear() === y && sd.getMonth() === m && sd.getDate() === d) {
      const method = sale.paymentMethod || "cash";
      if (method === "orange") orange += sale.total;
      else if (method === "wave") wave += sale.total;
      else cash += sale.total;
    }
  });

  const spanCash = document.getElementById("today-total-cash");
  const spanOrange = document.getElementById("today-total-orange");
  const spanWave = document.getElementById("today-total-wave");

  if (spanCash) spanCash.textContent = cash;
  if (spanOrange) spanOrange.textContent = orange;
  if (spanWave) spanWave.textContent = wave;
}

function renderSalesTable() {
  const tbody = document.getElementById("sales-table-body");
  if (!tbody) return;
  tbody.innerHTML = "";

  sales.forEach(sale => {
    const tr = document.createElement("tr");
    const dateStr = new Date(sale.date).toLocaleString("fr-FR");
    tr.innerHTML = `
      <td>${dateStr}</td>
      <td>${sale.total} FCFA</td>
    `;
    tbody.appendChild(tr);
  });
}

// ================== RAPPORT JOURNALIER ==================
function getTodaySales() {
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth();
  const d = today.getDate();

  return sales.filter(sale => {
    const sd = new Date(sale.date);
    return sd.getFullYear() === y && sd.getMonth() === m && sd.getDate() === d;
  });
}

function openDailyReport() {
  const todaySales = getTodaySales();
  const today = new Date();
  const dateLabel = today.toLocaleDateString("fr-FR");

  if (todaySales.length === 0) {
    alert("Aucune vente pour aujourd'hui.");
    return;
  }

  let total = 0;
  const productMap = {};

  todaySales.forEach(sale => {
    total += sale.total;
    sale.items.forEach(item => {
      const product = products.find(p => p.id === item.productId);
      const name = item.name || (product ? product.name : "");
      const unitPrice = product ? product.price : 0;
      if (!productMap[name]) {
        productMap[name] = { qty: 0, amount: 0, unitPrice };
      }
      productMap[name].qty += item.qty;
      productMap[name].amount += unitPrice * item.qty;
    });
  });

  const average = Math.round(total / todaySales.length);

  let salesRows = "";
  todaySales.forEach(sale => {
    const timeStr = new Date(sale.date).toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit"
    });
    salesRows += `
      <tr>
        <td>${timeStr}</td>
        <td style="text-align:right;">${sale.total} FCFA</td>
      </tr>
    `;
  });

  let productRows = "";
  Object.keys(productMap).forEach(name => {
    const info = productMap[name];
    productRows += `
      <tr>
        <td>${name}</td>
        <td style="text-align:center;">${info.qty}</td>
        <td style="text-align:right;">${info.unitPrice} FCFA</td>
        <td style="text-align:right;">${info.amount} FCFA</td>
      </tr>
    `;
  });

  const html = `
    <!DOCTYPE html>
    <html lang="fr">
    <head>
      <meta charset="UTF-8">
      <title>Rapport du jour - BSK</title>
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
            <h1>Rapport du jour - BSK</h1>
            <div class="subtitle">
              Date : ${dateLabel}<br>
              Grand Dakar – Garage Casamance · Tél : 77 876 92 01
            </div>
          </div>
        </div>

        <h2>Résumé</h2>
        <div class="summary">
          Nombre de ventes : <strong>${todaySales.length}</strong><br>
          Total du jour : <strong>${total} FCFA</strong><br>
          Panier moyen : <strong>${average} FCFA</strong>
        </div>

        <h2>Détail des ventes</h2>
        <table>
          <thead>
            <tr>
              <th>Heure</th>
              <th>Montant</th>
            </tr>
          </thead>
          <tbody>
            ${salesRows}
          </tbody>
        </table>

        <h2>Répartition par produit</h2>
        <table>
          <thead>
            <tr>
              <th>Produit</th>
              <th>Quantité vendue</th>
              <th>Prix unitaire</th>
              <th>Montant total</th>
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
function initDashboardDates() {
  const startInput = document.getElementById("dashboard-start");
  const endInput = document.getElementById("dashboard-end");
  if (!startInput || !endInput) return;

  if (!startInput.value || !endInput.value) {
    const today = new Date();
    const iso = today.toISOString().slice(0, 10);
    startInput.value = iso;
    endInput.value = iso;
  }
}

function setDashboardRangeToday() {
  const today = new Date();
  const iso = today.toISOString().slice(0, 10);
  const startInput = document.getElementById("dashboard-start");
  const endInput = document.getElementById("dashboard-end");
  if (!startInput || !endInput) return;
  startInput.value = iso;
  endInput.value = iso;
  loadDashboardStats();
}

function setDashboardRangeWeek() {
  const today = new Date();
  const day = today.getDay();
  const diffToMonday = (day + 6) % 7;
  const monday = new Date(today);
  monday.setDate(today.getDate() - diffToMonday);

  const startInput = document.getElementById("dashboard-start");
  const endInput = document.getElementById("dashboard-end");
  if (!startInput || !endInput) return;

  startInput.value = monday.toISOString().slice(0, 10);
  endInput.value = today.toISOString().slice(0, 10);
  loadDashboardStats();
}

function setDashboardRangeMonth() {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), 1);

  const startInput = document.getElementById("dashboard-start");
  const endInput = document.getElementById("dashboard-end");
  if (!startInput || !endInput) return;

  startInput.value = start.toISOString().slice(0, 10);
  endInput.value = today.toISOString().slice(0, 10);
  loadDashboardStats();
}

function setDashboardRangeYear() {
  const today = new Date();
  const start = new Date(today.getFullYear(), 0, 1);

  const startInput = document.getElementById("dashboard-start");
  const endInput = document.getElementById("dashboard-end");
  if (!startInput || !endInput) return;

  startInput.value = start.toISOString().slice(0, 10);
  endInput.value = today.toISOString().slice(0, 10);
  loadDashboardStats();
}

function loadDashboardStats() {
  const startInput = document.getElementById("dashboard-start");
  const endInput = document.getElementById("dashboard-end");
  if (!startInput || !endInput) return;

  const start = startInput.value;
  const end = endInput.value;

  if (!start || !end) {
    alert("Merci de choisir une date de début et une date de fin.");
    return;
  }

  const callbackName = "onDashboard_" + Date.now();
  const script = document.createElement("script");

  window[callbackName] = function (data) {
    try {
      updateDashboardUI(data);
    } finally {
      delete window[callbackName];
      script.remove();
    }
  };

  script.src = `${SHEET_URL}?action=dashboard&start=${encodeURIComponent(
    start
  )}&end=${encodeURIComponent(end)}&callback=${callbackName}`;
  script.onerror = function () {
    alert("Erreur lors du chargement des données du tableau de bord.");
  };

  document.body.appendChild(script);
}

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

  fetchStockFromSheet();
  fetchClientsFromSheet();
  fetchPerfumesFromSheet();

  const discountInput = document.getElementById("cart-discount");
  if (discountInput) {
    discountInput.addEventListener("input", renderCart);
  }
});
