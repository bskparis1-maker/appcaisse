/* ==========================
      CONFIGURATION
========================== */

const SHEET_URL = "https://script.google.com/macros/s/AKfycbwIuoPvoE_1DcLGWY5aoEdAHHM1l_2eoqL5VReGyF0P8ctbzmvQwt6tDcgSzRfxcbw/exec"; 
// IMPORTANT : mets l’URL exacte de ton Apps Script déployé

let products = [];
let cart = [];
let sales = [];
let clients = [];
let perfumes = [];
let dashboardChart = null;

/* ==========================
      NAVIGATION ENTRE VUES
========================== */

function showView(id) {
  document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
  document.getElementById("view-" + id).classList.remove("hidden");
}

/* ==========================
      GESTION DES PRODUITS
========================== */

function renderProductsList() {
  const list = document.getElementById("products-list");
  list.innerHTML = "";

  products.forEach(p => {
    // Appliquer le prix promo si actif
    const price = getPromoPrice(p.price);

    const div = document.createElement("div");
    div.className = "product-card";
    div.innerHTML = `
      <strong>${p.name}</strong><br>
      <label>Prix : ${price} FCFA</label><br>
      <label>Quantité :</label>
      <input type="number" id="qty-${p.id}" min="1" value="1">
      <button onclick="addToCart(${p.id})">Ajouter</button>
    `;
    list.appendChild(div);
  });
}

/* ==========================
      PANIER
========================== */

function addToCart(id) {
  const product = products.find(p => p.id === id);
  if (!product) return;

  const qty = parseInt(document.getElementById("qty-" + id).value);
  if (qty <= 0) return;

  const existing = cart.find(i => i.id === id);
  if (existing) existing.qty += qty;
  else cart.push({ id, name: product.name, price: getPromoPrice(product.price), qty });

  renderCart();
}

function clearCart() {
  cart = [];
  renderCart();
}

function renderCart() {
  const div = document.getElementById("cart-list");
  div.innerHTML = "";

  let total = 0;

  cart.forEach(item => {
    const lineTotal = item.price * item.qty;
    total += lineTotal;

    const p = document.createElement("p");
    p.innerHTML = `${item.name} × ${item.qty} — <strong>${lineTotal} FCFA</strong>`;
    div.appendChild(p);
  });

  const discount = Number(document.getElementById("cart-discount").value) || 0;
  const finalTotal = Math.max(total - discount, 0);

  document.getElementById("cart-total").textContent = finalTotal;
}

/* ==========================
      VALIDATION DE VENTE
========================== */

function confirmSale() {
  if (cart.length === 0) {
    alert("Panier vide.");
    return;
  }

  const paymentMethod = document.getElementById("payment-method").value;
  const discount = Number(document.getElementById("cart-discount").value) || 0;
  const discountReason = document.getElementById("cart-discount-reason").value || "";
  const clientId = document.getElementById("client-select").value || null;

  const client = clients.find(c => c.id == clientId);

  const sale = {
    date: new Date().toISOString(),
    total: Number(document.getElementById("cart-total").textContent),
    items: cart.map(i => ({ name: i.name, qty: i.qty })),
    paymentMethod,
    discountAmount: discount,
    discountReason,
    clientId: client ? client.id : "",
    clientName: client ? client.name : "",
    clientPhone: client ? client.phone : "",
    loyaltyDiscount: 0
  };

  // Envoyer au serveur
  sendSaleToSheet(sale);

  // Activer bouton imprimé
  document.getElementById("print-ticket-btn").style.display = "inline-block";

  // Générer ticket pour impression manuelle
  generateTicket(sale);

  // Reset panier
  cart = [];
  renderCart();
}

function sendSaleToSheet(sale) {
  const payload = encodeURIComponent(JSON.stringify({ sale }));
  const url = `${SHEET_URL}?payload=${payload}`;

  fetch(url)
    .then(r => r.text())
    .then(() => {
      console.log("Vente envoyée.");
      refreshSalesFromSheet();
      fetchClientsFromSheet();
    });
}

/* ==========================
      TICKET DE CAISSE
========================== */

function generateTicket(sale) {
  const box = document.getElementById("ticket-content");

  let itemsHTML = "";
  sale.items.forEach(i => {
    itemsHTML += `
      <div class="ticket-line">
        <span>${i.name} × ${i.qty}</span>
        <span>${i.qty * getPromoPrice(0)} FCFA</span>
      </div>
    `;
  });

  box.innerHTML = `
    <h2>BSK - Ticket</h2>
    <p>Grand Dakar Garage Casamance</p>
    <p>Tél : 77 876 92 01</p>
    <hr>
    <p>Date : ${new Date(sale.date).toLocaleString()}</p>
    <hr>
    ${itemsHTML}
    <hr>
    <p>Total : <strong>${sale.total} FCFA</strong></p>
    ${
      sale.discountAmount > 0
        ? `<p>Remise : -${sale.discountAmount} FCFA<br>(${sale.discountReason})</p>`
        : ""
    }
    <hr>
    <p>Merci pour votre achat !</p>
  `;
}

function openTicketPopup() {
  document.getElementById("ticket-popup").classList.remove("hidden");
}

function closeTicketPopup() {
  document.getElementById("ticket-popup").classList.add("hidden");
}

/* ==========================
      PROMO (OPTION 1)
========================== */

function openPromoModal() {
  document.getElementById("promo-popup").classList.remove("hidden");
}

function closePromoPopup() {
  document.getElementById("promo-popup").classList.add("hidden");
}

function savePromo() {
  const p8000 = Number(document.getElementById("promo-8000").value);
  const p5000 = Number(document.getElementById("promo-5000").value);
  const start = document.getElementById("promo-start").value;
  const end = document.getElementById("promo-end").value;

  const promo = {
    start,
    end,
    new8000: p8000,
    new5000: p5000
  };

  localStorage.setItem("promo", JSON.stringify(promo));
  closePromoPopup();
  renderProductsList();
}

function getPromoPrice(originalPrice) {
  const promo = JSON.parse(localStorage.getItem("promo") || "{}");
  if (!promo.start || !promo.end) return originalPrice;

  const now = new Date();
  const s = new Date(promo.start);
  const e = new Date(promo.end);

  if (now < s || now > e) return originalPrice;

  if (originalPrice === 8000) return promo.new8000 || originalPrice;
  if (originalPrice === 5000) return promo.new5000 || originalPrice;

  return originalPrice;
}
/* ==========================
    SYNCHRONISATION VENTES
========================== */

function fetchSalesFromSheet() {
  const debugEl = document.getElementById("sales-debug");
  if (debugEl) debugEl.textContent = "Connexion à Google Sheets…";

  const callbackName = "onSalesFromSheet_" + Date.now();
  const script = document.createElement("script");

  window[callbackName] = function (data) {
    try {
      if (data && Array.isArray(data.sales)) {
        sales = data.sales.map(s => {
          const info = s.info || {};

          // Liste produits
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
            date: s.date,
            total: Number(s.total),
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

        if (debugEl)
          debugEl.textContent = "Ventes reçues depuis Google Sheets : " + sales.length;
      } else {
        if (debugEl)
          debugEl.textContent = "Réponse vide depuis Google Sheets";
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
    if (debugEl)
      debugEl.textContent = "Erreur de connexion à Google Sheets";

    updateSalesViewForSelectedDate();
  };
  document.body.appendChild(script);
}

function refreshSalesFromSheet() {
  fetchSalesFromSheet();
}

function saveSales(arr) {
  localStorage.setItem("sales", JSON.stringify(arr));
}

/* ==========================
      FILTRER LES VENTES
========================== */

function saleMatchesDate(sale, dateStr) {
  if (!dateStr) return true;
  const d = (sale.date || "").slice(0, 10);
  return d === dateStr;
}

function updateSalesViewForSelectedDate() {
  const dateStr = document.getElementById("sales-date").value;
  const tbody = document.getElementById("sales-table-body");
  tbody.innerHTML = "";

  let totalDay = 0;
  let cash = 0;
  let orange = 0;
  let wave = 0;

  sales
    .filter(s => saleMatchesDate(s, dateStr))
    .forEach(s => {
      totalDay += s.total;

      if (s.paymentMethod === "cash") cash += s.total;
      else if (s.paymentMethod === "orange") orange += s.total;
      else if (s.paymentMethod === "wave") wave += s.total;

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${new Date(s.date).toLocaleString()}</td>
        <td>${s.total} FCFA</td>
      `;
      tbody.appendChild(tr);
    });

  document.getElementById("today-total").textContent = totalDay;
  document.getElementById("today-total-cash").textContent = cash;
  document.getElementById("today-total-orange").textContent = orange;
  document.getElementById("today-total-wave").textContent = wave;
}

/* ==========================
        CLIENTS
========================== */

function fetchClientsFromSheet() {
  const cb = "onClients_" + Date.now();
  const script = document.createElement("script");

  window[cb] = function (data) {
    if (data && Array.isArray(data.clients)) {
      clients = data.clients;
      saveClients();
      renderClientsSelect();
      renderClientsTable();
    }
    delete window[cb];
    script.remove();
  };

  script.src = `${SHEET_URL}?action=getClients&callback=${cb}`;
  document.body.appendChild(script);
}

function saveClients() {
  localStorage.setItem("clients", JSON.stringify(clients));
}

function renderClientsSelect() {
  const select = document.getElementById("client-select");
  select.innerHTML = `<option value="">Client occasionnel</option>`;

  clients.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.name;
    select.appendChild(opt);
  });
}

function renderClientsTable() {
  const tbody = document.getElementById("clients-table-body");
  if (!tbody) return;

  const search = document.getElementById("client-search").value.toLowerCase();

  tbody.innerHTML = "";

  clients
    .filter(c => c.name.toLowerCase().includes(search))
    .forEach(c => {
      const total = computeClientTotal(c.id);

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${c.name}</td>
        <td>${c.phone}</td>
        <td>${total} FCFA</td>
        <td><button class="secondary-btn" onclick="openClientPopup('${c.id}')">Détails</button></td>
      `;
      tbody.appendChild(tr);
    });
}

/* ==========================
     HISTORIQUE CLIENT
========================== */

function computeClientTotal(clientId) {
  let sum = 0;
  sales.forEach(s => {
    if (s.clientId == clientId) sum += s.total;
  });
  return sum;
}

function openClientPopup(clientId) {
  const c = clients.find(c => c.id == clientId);
  if (!c) return;

  document.getElementById("popup-client-name").textContent = c.name;
  document.getElementById("popup-client-phone").textContent = c.phone;

  const historyDiv = document.getElementById("popup-client-history");
  historyDiv.innerHTML = "";

  sales
    .filter(s => s.clientId == clientId)
    .forEach(s => {
      const div = document.createElement("div");
      div.style.marginBottom = "8px";
      div.innerHTML = `
        <div><strong>${new Date(s.date).toLocaleString()}</strong></div>
        <div>Montant : ${s.total} FCFA</div>
        <div>Paiement : ${s.paymentMethod}</div>
        ${
          s.discountAmount > 0
            ? `<div>Remise : -${s.discountAmount} FCFA (${s.discountReason})</div>`
            : ""
        }
        <div>Produits :</div>
        <ul>
          ${s.items.map(i => `<li>${i.name} × ${i.qty}</li>`).join("")}
        </ul>
        <hr>
      `;
      historyDiv.appendChild(div);
    });

  document.getElementById("popup-client").classList.remove("hidden");
}

function closeClientPopup() {
  document.getElementById("popup-client").classList.add("hidden");
}
/* ==========================
      BAR À PARFUM
========================== */

function fetchPerfumesFromSheet() {
  const cb = "onPerf_" + Date.now();
  const script = document.createElement("script");

  window[cb] = function (data) {
    if (data && Array.isArray(data.perfumes)) {
      perfumes = data.perfumes;
      renderPerfumeTable();
    }
    delete window[cb];
    script.remove();
  };

  script.src = `${SHEET_URL}?action=getPerfumes&callback=${cb}`;
  document.body.appendChild(script);
}

function renderPerfumeTable() {
  const tbody = document.getElementById("perfume-table-body");
  if (!tbody) return;
  tbody.innerHTML = "";

  perfumes.forEach((p, index) => {
    const tr = document.createElement("tr");

    let colorClass = "";
    if (p.level === "full") colorClass = "legend-full";
    else if (p.level === "half") colorClass = "legend-half";
    else if (p.level === "out") colorClass = "legend-out";

    tr.innerHTML = `
      <td>${p.name}</td>
      <td>
        <select data-index="${index}" onchange="updatePerfumeLevel(this)">
          <option value="full" ${p.level === "full" ? "selected" : ""}>1L ou plus</option>
          <option value="half" ${p.level === "half" ? "selected" : ""}>0,5L</option>
          <option value="out" ${p.level === "out" ? "selected" : ""}>Rupture</option>
        </select>
      </td>
    `;

    tbody.appendChild(tr);
  });
}

function updatePerfumeLevel(selectEl) {
  const idx = Number(selectEl.dataset.index);
  const level = selectEl.value;
  if (!perfumes[idx]) return;
  perfumes[idx].level = level;
  savePerfumesToSheet();
}

function savePerfumesToSheet() {
  const payload = encodeURIComponent(JSON.stringify({ perfumes }));
  const url = `${SHEET_URL}?action=updatePerfumes&payload=${payload}`;

  fetch(url)
    .then(r => r.text())
    .then(() => {
      console.log("Bar à parfum mis à jour.");
    });
}

/* ==========================
      STOCK / PRODUITS
========================== */

function fetchStockFromSheet() {
  const cb = "onStock_" + Date.now();
  const script = document.createElement("script");

  window[cb] = function (data) {
    if (data && Array.isArray(data.products)) {
      products = data.products;
      renderProductsList();
      renderProductsTable();
    }
    delete window[cb];
    script.remove();
  };

  script.src = `${SHEET_URL}?action=getStock&callback=${cb}`;
  document.body.appendChild(script);
}

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
        <button class="secondary-btn" onclick="alert('Modification stock manuelle via Google Sheets pour le moment.')">
          Modifier
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

/* ==========================
      TABLEAU DE BORD
========================== */

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

  const perDay = {};

  sales.forEach(s => {
    const d = new Date(s.date);
    if (isNaN(d)) return;
    if (d < start || d > end) return;

    total += s.total;
    count += 1;
    discount += s.discountAmount || 0;

    if (s.paymentMethod === "cash") cash += s.total;
    else if (s.paymentMethod === "orange") orange += s.total;
    else if (s.paymentMethod === "wave") wave += s.total;

    const dayKey = s.date.slice(0, 10);
    if (!perDay[dayKey]) {
      perDay[dayKey] = { total: 0, count: 0 };
    }
    perDay[dayKey].total += s.total;
    perDay[dayKey].count += 1;
  });

  const avg = count > 0 ? Math.round(total / count) : 0;

  document.getElementById("db-total").textContent = total;
  document.getElementById("db-count").textContent = count;
  document.getElementById("db-average").textContent = avg;
  document.getElementById("db-discount").textContent = discount;
  document.getElementById("db-cash").textContent = cash;
  document.getElementById("db-orange").textContent = orange;
  document.getElementById("db-wave").textContent = wave;

  renderDashboardChart(perDay);
}

function renderDashboardChart(perDay) {
  const ctx = document.getElementById("dashboard-chart");
  if (!ctx) return;

  const labels = Object.keys(perDay).sort();
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
          label: "Nb ventes",
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

/* ==========================
   RACCOURCIS PÉRIODE DASHBOARD
========================== */

function setDashboardRangeToday() {
  const today = new Date().toISOString().slice(0, 10);
  document.getElementById("dashboard-start").value = today;
  document.getElementById("dashboard-end").value = today;
  loadDashboardStats();
}

function setDashboardRangeWeek() {
  const now = new Date();
  const dayOfWeek = now.getDay() || 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - dayOfWeek + 1);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const s = monday.toISOString().slice(0, 10);
  const e = sunday.toISOString().slice(0, 10);

  document.getElementById("dashboard-start").value = s;
  document.getElementById("dashboard-end").value = e;
  loadDashboardStats();
}

function setDashboardRangeMonth() {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const s = first.toISOString().slice(0, 10);
  const e = last.toISOString().slice(0, 10);

  document.getElementById("dashboard-start").value = s;
  document.getElementById("dashboard-end").value = e;
  loadDashboardStats();
}

function setDashboardRangeYear() {
  const now = new Date();
  const first = new Date(now.getFullYear(), 0, 1);
  const last = new Date(now.getFullYear(), 11, 31);

  const s = first.toISOString().slice(0, 10);
  const e = last.toISOString().slice(0, 10);

  document.getElementById("dashboard-start").value = s;
  document.getElementById("dashboard-end").value = e;
  loadDashboardStats();
}

/* ==========================
   RAPPORT JOURNALIER PDF SIMPLE
========================== */

function openDailyReportForSelectedDate() {
  const dateStr = document.getElementById("sales-date").value;
  if (!dateStr) {
    alert("Choisissez une date d’abord.");
    return;
  }

  const daySales = sales.filter(s => saleMatchesDate(s, dateStr));
  if (daySales.length === 0) {
    alert("Aucune vente ce jour-là.");
    return;
  }

  let total = 0;
  let detailsHTML = "";

  daySales.forEach(s => {
    total += s.total;
    detailsHTML += `
      <tr>
        <td>${new Date(s.date).toLocaleTimeString()}</td>
        <td>${s.total} FCFA</td>
        <td>${s.paymentMethod}</td>
      </tr>
    `;
  });

  const win = window.open("", "_blank");
  win.document.write(`
    <html>
      <head>
        <meta charset="UTF-8">
        <title>Rapport ${dateStr}</title>
      </head>
      <body>
        <h2>Rapport des ventes - ${dateStr}</h2>
        <p>Total du jour : ${total} FCFA</p>
        <table border="1" cellspacing="0" cellpadding="4">
          <thead>
            <tr>
              <th>Heure</th>
              <th>Montant</th>
              <th>Paiement</th>
            </tr>
          </thead>
          <tbody>
            ${detailsHTML}
          </tbody>
        </table>
        <script>
          window.print();
        </script>
      </body>
    </html>
  `);
  win.document.close();
}

/* ==========================
  NOUVELLE VERSION DE confirmSale
  (corrige ticket & enregistre prix)
========================== */

function confirmSale() {
  if (cart.length === 0) {
    alert("Panier vide.");
    return;
  }

  const paymentMethod = document.getElementById("payment-method").value;
  const discount = Number(document.getElementById("cart-discount").value) || 0;
  const discountReason = document.getElementById("cart-discount-reason").value || "";
  const clientId = document.getElementById("client-select").value || null;
  const client = clients.find(c => c.id == clientId);

  let totalWithoutDiscount = 0;
  const items = cart.map(i => {
    const lineTotal = i.price * i.qty;
    totalWithoutDiscount += lineTotal;
    return {
      name: i.name,
      qty: i.qty,
      price: i.price
    };
  });

  const total = Math.max(totalWithoutDiscount - discount, 0);

  const sale = {
    date: new Date().toISOString(),
    total,
    items,
    paymentMethod,
    discountAmount: discount,
    discountReason,
    clientId: client ? client.id : "",
    clientName: client ? client.name : "",
    clientPhone: client ? client.phone : "",
    loyaltyDiscount: 0
  };

  sendSaleToSheet(sale);

  // Activer bouton imprimé
  document.getElementById("print-ticket-btn").style.display = "inline-block";

  // Générer ticket (mais ne pas l’ouvrir automatiquement)
  generateTicket(sale);

  // Vider panier visuellement
  cart = [];
  document.getElementById("cart-discount").value = "0";
  document.getElementById("cart-discount-reason").value = "";
  renderCart();
}

/* ==========================
   NOUVELLE VERSION TICKET
========================== */

function generateTicket(sale) {
  const box = document.getElementById("ticket-content");
  if (!box) return;

  let itemsHTML = "";
  let totalLines = 0;

  sale.items.forEach(i => {
    const line = i.price * i.qty;
    totalLines += line;
    itemsHTML += `
      <div class="ticket-line">
        <span>${i.name} × ${i.qty}</span>
        <span>${line} FCFA</span>
      </div>
    `;
  });

  box.innerHTML = `
    <h2>BSK - Ticket</h2>
    <p>Grand Dakar Garage Casamance</p>
    <p>Tél : 77 876 92 01</p>
    <hr>
    <p>Date : ${new Date(sale.date).toLocaleString()}</p>
    <hr>
    ${itemsHTML}
    <hr>
    <p>Sous-total : ${totalLines} FCFA</p>
    ${
      sale.discountAmount > 0
        ? `<p>Remise : -${sale.discountAmount} FCFA<br>Raison : ${sale.discountReason}</p>`
        : ""
    }
    <p><strong>Total à payer : ${sale.total} FCFA</strong></p>
    <hr>
    <p>Mode de paiement : ${sale.paymentMethod}</p>
    ${
      sale.clientName
        ? `<p>Client : ${sale.clientName} (${sale.clientPhone || "-"})</p>`
        : ""
    }
    <p>Merci pour votre achat !</p>
  `;
}
/* ==========================
   AJOUT CLIENT (PROMPTS)
========================== */

function openAddClientModal() {
  const name = prompt("Nom du client :");
  if (!name) return;
  const phone = prompt("Téléphone du client (optionnel) :") || "";

  const client = {
    id: Date.now(),
    name,
    phone,
    createdAt: new Date().toISOString()
  };

  const payload = encodeURIComponent(JSON.stringify({ client }));
  const url = `${SHEET_URL}?action=addClient&payload=${payload}`;

  fetch(url)
    .then(r => r.text())
    .then(t => {
      console.log("Client ajouté :", t);
      fetchClientsFromSheet();
    })
    .catch(err => {
      console.error("Erreur ajout client", err);
      alert("Erreur lors de l’ajout du client.");
    });
}

/* ==========================
   UTILITAIRES DATES
========================== */

function initDates() {
  const today = new Date().toISOString().slice(0, 10);

  const salesDateInput = document.getElementById("sales-date");
  if (salesDateInput) salesDateInput.value = today;

  const dbStart = document.getElementById("dashboard-start");
  const dbEnd = document.getElementById("dashboard-end");
  if (dbStart && dbEnd) {
    dbStart.value = today;
    dbEnd.value = today;
  }
}

/* ==========================
   INITIALISATION GLOBALE
========================== */

document.addEventListener("DOMContentLoaded", () => {
  // Vue par défaut
  showView("caisse");

  // Initialiser dates
  initDates();

  // Charger depuis Google Sheets
  fetchStockFromSheet();
  fetchClientsFromSheet();
  fetchPerfumesFromSheet();
  fetchSalesFromSheet();

  // Mise à jour total panier quand la remise change
  const discountInput = document.getElementById("cart-discount");
  if (discountInput) {
    discountInput.addEventListener("input", renderCart);
  }

  // Rafraîchir les ventes automatiquement toutes les 30s
  setInterval(() => {
    fetchSalesFromSheet();
  }, 30000);
});