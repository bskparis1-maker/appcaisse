// =====================================================================
// ================== B2B : prospects, dépôts-ventes, commandes de gros ==================
// =====================================================================
// • Même STOCK que la caisse (dépôt et commande = stock retiré ; invendus = stock remis)
// • Les ventes B2B NE vont PAS dans la caisse boutique ni dans les ventes du jour
// • Caisse B2B à part (encaissements en espèces − dépôts au coffre marqués « [B2B] »)
// • Un seul COFFRE pour toute l'app
// • Données dans le Google Sheets de la caisse : feuilles B2B_… (actions « b2b_… » du Code.gs)

const B2B_STATUTS = ["À contacter", "Contacté", "Intéressé", "Client", "Pas intéressé"];
const B2B_STATUT_CLS = { "À contacter": "attente", "Contacté": "assignee", "Intéressé": "route", "Client": "livree", "Pas intéressé": "annulee" };
const B2B_MODES = [{ v: "cash", l: "Espèces" }, { v: "wave", l: "Wave" }, { v: "orange", l: "Orange Money" }, { v: "virement", l: "Virement / chèque" }];
const B2B_CACHE_KEY = "bsk_b2b_cache";

const b2b = {
  data: { B2B_Clients: [], B2B_Depots: [], B2B_Ventes: [], B2B_Paiements: [], B2B_Tarifs: [] },
  vue: "fiches",          // fiches | depots | commandes | caisse | bord | tarifs
  filtreStatut: "",
  periode: "month",
  chargement: false,
  statut: "loading",
  pointDepot: null,       // ID du dépôt dont on fait le point
  payCible: null          // { venteId } ou { clientId } pour la fenêtre d'encaissement
};

// ---------- Connexion (JSONP, même script Google que la caisse) ----------
function b2bApi(action, payload) {
  return new Promise((resolve, reject) => {
    const cb = "onB2B_" + action + "_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
    const script = document.createElement("script");
    let fini = false;
    const finir = (fn, val) => { if (fini) return; fini = true; clearTimeout(t); delete window[cb]; script.remove(); fn(val); };
    const t = setTimeout(() => finir(reject, new Error("Google Sheets ne répond pas (internet ?)")), 25000);
    window[cb] = (res) => {
      if (res && res.ok) finir(resolve, res.data);
      else if (res && /unknown action/.test(res.error || "")) finir(reject, new Error("Le script Google de la caisse n'a pas encore la partie B2B : colle le nouveau Code.gs puis « Nouvelle version »."));
      else finir(reject, new Error((res && res.error) || "Réponse invalide"));
    };
    script.onerror = () => finir(reject, new Error("Google Sheets injoignable. Vérifie internet et le déploiement du script."));
    let url = `${SHEET_URL}?action=b2b_${encodeURIComponent(action)}&callback=${cb}`;
    if (payload) url += `&payload=${encodeURIComponent(JSON.stringify(payload))}`;
    script.src = url;
    document.body.appendChild(script);
  });
}

// enregistre plusieurs lignes d'un coup (ex. vente + paiement + dépôt) et met à jour l'affichage local
async function b2bSave(lignes) {
  // grosses opérations : envoyées en plusieurs fois pour ne pas dépasser la longueur d'un lien
  const paquets = [];
  let cur = [];
  lignes.forEach((l) => {
    cur.push(l);
    if (JSON.stringify(cur).length > 1500) { paquets.push(cur); cur = []; }
  });
  if (cur.length) paquets.push(cur);
  for (const p of paquets) await b2bApi("upsert", { lignes: p });
  lignes.forEach(({ feuille, obj }) => {
    const L = b2b.data[feuille];
    const i = L.findIndex((x) => String(x.ID) === String(obj.ID));
    if (i >= 0) L[i] = { ...L[i], ...obj }; else L.push({ ...obj });
  });
  b2bEcrireCache();
}

function b2bLireCache() {
  try { const c = JSON.parse(localStorage.getItem(B2B_CACHE_KEY) || "null"); if (c) b2b.data = { ...b2b.data, ...c }; } catch (e) {}
}
function b2bEcrireCache() {
  try { localStorage.setItem(B2B_CACHE_KEY, JSON.stringify(b2b.data)); } catch (e) {}
}

async function b2bCharger(silencieux) {
  if (b2b.chargement) return;
  b2b.chargement = true;
  b2bEtat("⏳ Mise à jour…");
  try {
    const d = await b2bApi("getAll");
    b2b.data = { ...b2b.data, ...d };
    b2b.statut = "ok";
    b2bEcrireCache();
  } catch (e) {
    b2b.statut = "offline";
    if (!silencieux) alert("⚠️ " + e.message);
  } finally {
    b2b.chargement = false;
    b2bRendre();
    renderCoffreViewIfVisible();
  }
}

function b2bEtat(txt) {
  const el = document.getElementById("b2b-etat");
  if (!el) return;
  el.innerHTML = txt || (b2b.statut === "ok" ? `<span class="text-pos">☁️ À jour</span>`
    : b2b.statut === "offline" ? `<span class="text-neg">⚠️ Hors ligne : dernières données de cet appareil</span>` : "⏳");
}

function renderCoffreViewIfVisible() {
  const v = document.getElementById("view-coffre");
  if (v && !v.classList.contains("hidden")) renderCoffreView();
}

// ---------- Utilitaires ----------
const b2bId = (prefixe) => `${prefixe}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
const b2bNow = () => new Date().toISOString();
const b2bJs = (s) => proEscape(JSON.stringify(String(s ?? "")));
const b2bNum = (v) => Number(v) || 0;
const b2bProduits = (o) => { try { return JSON.parse(o["Produits"] || "[]"); } catch (e) { return []; } };
const b2bClient = (id) => b2b.data.B2B_Clients.find((c) => String(c.ID) === String(id));
const b2bModeLabel = (m) => (B2B_MODES.find((x) => x.v === m) || { l: m || "—" }).l;
const b2bDateFr = (iso) => { const d = new Date(iso); return isNaN(d.getTime()) ? String(iso || "") : d.toLocaleDateString("fr-FR"); };
const b2bWa = (t) => { const k = clientPhoneKey(t); return k.length >= 9 ? "221" + k : ""; };

function b2bTarif(p) {
  const t = b2b.data.B2B_Tarifs.find((x) => String(x.ID) === String(p.id));
  const v = t && t["Prix B2B"] !== "" ? Number(t["Prix B2B"]) : NaN;
  return isNaN(v) ? Number(p.price) || 0 : v;
}

// ce qu'un établissement doit, a acheté, a en dépôt
function b2bStatsClient(id) {
  const ventes = b2b.data.B2B_Ventes.filter((v) => String(v["Client ID"]) === String(id));
  const depots = b2b.data.B2B_Depots.filter((d) => String(d["Client ID"]) === String(id) && d["Statut"] !== "Clôturé");
  let enDepotQte = 0, enDepotValeur = 0;
  depots.forEach((d) => b2bProduits(d).forEach((l) => {
    const r = b2bNum(l.qte) - b2bNum(l.vendus) - b2bNum(l.retournes);
    enDepotQte += r; enDepotValeur += r * b2bNum(l.prix);
  }));
  const dates = ventes.map((v) => v["Date"]).sort();
  return {
    ca: ventes.reduce((s, v) => s + b2bNum(v["Total"]), 0),
    reste: ventes.reduce((s, v) => s + b2bNum(v["Reste"]), 0),
    nbVentes: ventes.length,
    dernier: dates[dates.length - 1] || "",
    enDepotQte, enDepotValeur, depotsOuverts: depots.length
  };
}

// ---------- Stock (même stock que la caisse) ----------
function b2bProduitDe(l) {
  return products.find((x) => x.id === Number(l.productId)) || products.find((x) => proKey(x.name) === proKey(l.nom));
}
// delta négatif = sortie de stock ; renvoie un message d'erreur si stock insuffisant
function b2bVerifierStock(lignes) {
  if (!productsLoadedFromSheet) { fetchStockFromSheet(); return "⏳ Le stock n'est pas encore chargé depuis Google Sheets. Attends quelques secondes et réessaie."; }
  for (const l of lignes) {
    const p = b2bProduitDe(l);
    if (!p) return `« ${l.nom} » n'existe plus dans les produits.`;
    if (!isServiceProduct(p) && b2bNum(l.qte) > (Number(p.stock) || 0)) return `Stock insuffisant pour ${p.name} (reste ${p.stock}, demandé ${l.qte}).`;
  }
  return null;
}
function b2bBougerStock(lignes, sens, motif) {
  lignes.forEach((l) => {
    const p = b2bProduitDe(l);
    const q = b2bNum(l.qte);
    if (!p || isServiceProduct(p) || !q) return;
    const old = Number(p.stock) || 0;
    p.stock = Math.max(0, old + sens * q);
    logStockChangeToSheet({ date: b2bNow(), productId: p.id, productName: p.name, oldStock: old, newStock: p.stock, delta: p.stock - old, reason: motif });
  });
  saveProducts(products);
  sendStockToSheet(products);
  renderProductsForSale();
  renderProductsTable();
  updateNavBadges();
}

// ---------- Navigation ----------
function renderB2BView() {
  b2bRendre();
  b2bCharger(true);
}

function b2bNav(vue) {
  b2b.vue = vue;
  b2bRendre();
}

function b2bRendre() {
  b2bEtat();
  if (!document.getElementById("view-b2b")) return;
  document.querySelectorAll(".b2b-sub-btn").forEach((b) => b.classList.toggle("active", b.dataset.vue === b2b.vue));
  ["fiches", "depots", "commandes", "caisse", "bord", "tarifs"].forEach((v) =>
    document.getElementById("b2b-" + v)?.classList.toggle("hidden", b2b.vue !== v));
  if (b2b.vue === "fiches") b2bRendreFiches();
  if (b2b.vue === "depots") b2bRendreDepots();
  if (b2b.vue === "commandes") b2bRendreCommandes();
  if (b2b.vue === "caisse") b2bRendreCaisse();
  if (b2b.vue === "bord") b2bRendreBord();
  if (b2b.vue === "tarifs") b2bRendreTarifs();
}

// =====================================================================
// FICHES (prospects + clients)
// =====================================================================
function b2bOuvrirFiche(id) {
  const c = id ? b2bClient(id) : null;
  const $ = (i) => document.getElementById(i);
  $("b2b-fiche-form").classList.remove("hidden");
  $("b2b-fiche-titre").textContent = c ? "Modifier " + c["Établissement"] : "Nouvelle fiche";
  $("b2b-f-id").value = c ? c.ID : "";
  $("b2b-f-tel").value = c ? c["Téléphone"] : "";
  $("b2b-f-etab").value = c ? c["Établissement"] : "";
  $("b2b-f-resp").value = c ? c["Responsable"] : "";
  $("b2b-f-adresse").value = c ? c["Adresse"] : "";
  $("b2b-f-statut").value = c ? c["Statut"] : "À contacter";
  $("b2b-f-note").value = c ? c["Note"] : "";
  $("b2b-f-doublon").classList.add("hidden");
  setTimeout(() => $("b2b-f-tel").focus(), 50);
}

function b2bFermerFiche() { document.getElementById("b2b-fiche-form").classList.add("hidden"); }

function b2bVerifTel() {
  const id = document.getElementById("b2b-f-id").value;
  const k = clientPhoneKey(document.getElementById("b2b-f-tel").value);
  const box = document.getElementById("b2b-f-doublon");
  const d = k.length >= 9 ? b2b.data.B2B_Clients.find((c) => clientPhoneKey(c["Téléphone"]) === k && String(c.ID) !== String(id)) : null;
  box.classList.toggle("hidden", !d);
  box.innerHTML = d ? `⚠️ Ce numéro est déjà celui de <strong>${proEscape(d["Établissement"])}</strong>. <button type="button" class="secondary-btn small-btn" onclick="b2bOuvrirFiche(${b2bJs(d.ID)})">Ouvrir sa fiche</button>` : "";
  return d;
}

async function b2bEnregistrerFiche(e) {
  if (e) e.preventDefault();
  const $ = (i) => document.getElementById(i);
  const etab = $("b2b-f-etab").value.trim().replace(/\s+/g, " ");
  const tel = $("b2b-f-tel").value.trim();
  if (!etab) return alert("Le nom de l'établissement est obligatoire.");
  if (b2bVerifTel()) return alert("Ce numéro existe déjà dans une autre fiche.");
  const id = $("b2b-f-id").value || b2bId("B2B");
  const ex = b2bClient(id);
  const obj = {
    ID: id,
    "Établissement": etab,
    "Responsable": $("b2b-f-resp").value.trim(),
    "Téléphone": tel ? formatClientPhone(tel) : "",
    "Adresse": $("b2b-f-adresse").value.trim(),
    "Statut": $("b2b-f-statut").value,
    "Note": $("b2b-f-note").value.trim(),
    "Créé le": ex ? ex["Créé le"] : b2bNow(),
    "Mis à jour": b2bNow()
  };
  try {
    await b2bSave([{ feuille: "B2B_Clients", obj }]);
    b2bFermerFiche();
    b2bRendre();
  } catch (err) { alert("⚠️ " + err.message); }
}

async function b2bChangerStatut(id, statut) {
  const c = b2bClient(id);
  if (!c) return;
  try { await b2bSave([{ feuille: "B2B_Clients", obj: { ...c, "Statut": statut, "Mis à jour": b2bNow() } }]); b2bRendre(); }
  catch (e) { alert("⚠️ " + e.message); }
}

async function b2bSupprimerFiche(id) {
  const c = b2bClient(id);
  if (!c) return;
  const st = b2bStatsClient(id);
  if (st.reste > 0 || st.enDepotQte > 0) return alert(`Impossible : ${c["Établissement"]} a encore ${fmt(st.reste)} FCFA à payer ou ${st.enDepotQte} produit(s) en dépôt.`);
  if (!(await requireDeletePassword(`Supprimer la fiche « ${c["Établissement"]} » ?`))) return;
  try {
    await b2bApi("delete", { feuille: "B2B_Clients", id, code: DELETE_PASSWORD });
    b2b.data.B2B_Clients = b2b.data.B2B_Clients.filter((x) => String(x.ID) !== String(id));
    b2bEcrireCache();
    b2bRendre();
  } catch (e) { alert("⚠️ " + e.message); }
}

function b2bRendreFiches() {
  const box = document.getElementById("b2b-fiches-liste");
  if (!box) return;
  const L = b2b.data.B2B_Clients;
  const compte = (s) => L.filter((c) => !s || c["Statut"] === s).length;
  document.getElementById("b2b-seg-statut").innerHTML = ["", ...B2B_STATUTS].map((s) =>
    `<button class="secondary-btn small-btn ${s === b2b.filtreStatut ? "active" : ""}" onclick="b2b.filtreStatut=${b2bJs(s)};b2bRendreFiches()">${s || "Toutes"} (${compte(s)})</button>`).join("");

  const q = (document.getElementById("b2b-rech").value || "").trim().toLowerCase();
  const qTel = clientPhoneKey(q);
  const liste = L.filter((c) => (!b2b.filtreStatut || c["Statut"] === b2b.filtreStatut) &&
    (!q || [c["Établissement"], c["Responsable"], c["Adresse"]].join(" ").toLowerCase().includes(q) ||
      (qTel.length >= 3 && clientPhoneKey(c["Téléphone"]).includes(qTel))))
    .map((c) => ({ c, st: b2bStatsClient(c.ID) }))
    .sort((a, b) => b.st.reste - a.st.reste || b.st.ca - a.st.ca || String(a.c["Établissement"]).localeCompare(String(b.c["Établissement"]), "fr"));

  if (!liste.length) { box.innerHTML = `<div class="task-empty">Aucune fiche. Ajoute ton premier prospect avec « + Nouvelle fiche ».</div>`; return; }
  box.innerHTML = liste.map(({ c, st }) => {
    const k = B2B_STATUT_CLS[c["Statut"]] || "attente";
    const id = b2bJs(c.ID);
    const wa = b2bWa(c["Téléphone"]);
    const opts = B2B_STATUTS.map((s) => `<option ${s === c["Statut"] ? "selected" : ""}>${s}</option>`).join("");
    return `<div class="liv-card liv-b-${k}">
      <div class="liv-top">
        <div>
          <div class="liv-nom">${proEscape(c["Établissement"])}</div>
          <div class="liv-mut">👤 ${proEscape(c["Responsable"] || "—")} • 📞 ${proEscape(c["Téléphone"] || "—")}</div>
          <div class="liv-mut">📍 ${proEscape(c["Adresse"] || "—")}</div>
          ${c["Note"] ? `<div class="liv-mut">📝 ${proEscape(c["Note"])}</div>` : ""}
        </div>
        <div class="liv-prix">
          <span class="badge liv-st-${k}">${proEscape(c["Statut"])}</span>
          ${st.ca ? `<div class="liv-mut">Acheté : ${fmt(st.ca)} FCFA (${st.nbVentes})</div>` : ""}
          ${st.enDepotQte ? `<div class="liv-mut">📦 En dépôt : ${st.enDepotQte} pièce(s) • ${fmt(st.enDepotValeur)} F</div>` : ""}
          ${st.reste ? `<div class="text-neg">Doit : ${fmt(st.reste)} FCFA</div>` : ""}
        </div>
      </div>
      <div class="liv-actions">
        <select onchange="b2bChangerStatut(${id}, this.value)">${opts}</select>
        <button class="secondary-btn small-btn" onclick="b2bNouveauDepot(${id})">📦 Dépôt</button>
        <button class="secondary-btn small-btn" onclick="b2bNouvelleCommande(${id})">🧾 Commande</button>
        ${st.reste ? `<button class="primary-btn small-btn" onclick="b2bOuvrirPaiement({clientId:${id}})">💵 Encaisser</button>` : ""}
        ${wa ? `<button class="secondary-btn small-btn" onclick="window.open('https://wa.me/${wa}','_blank')">💬</button>` : ""}
        ${c["Téléphone"] ? `<a class="secondary-btn small-btn" href="tel:${proEscape(clientPhoneKey(c["Téléphone"]))}">📞</a>` : ""}
        <button class="secondary-btn small-btn" onclick="b2bOuvrirFiche(${id})">✏️</button>
        <button class="small-btn del-row" onclick="b2bSupprimerFiche(${id})">🗑️</button>
      </div>
    </div>`;
  }).join("");
}

// =====================================================================
// LIGNES PRODUITS (dépôt et commande)
// =====================================================================
function b2bOptionsProduits(sel) {
  return `<option value="">— Produit —</option>` + products.filter((p) => !isServiceProduct(p)).map((p) =>
    `<option value="${p.id}" ${String(p.id) === String(sel) ? "selected" : ""}>${proEscape(p.name)} (pro ${fmt(b2bTarif(p))} F, stock ${p.stock})</option>`).join("");
}
function b2bAjouterLigne(boxId, l = {}) {
  const d = document.createElement("div");
  d.className = "liv-ligne";
  d.innerHTML = `<select onchange="b2bProduitChoisi(this)">${b2bOptionsProduits(l.productId)}</select>
    <input type="number" min="1" value="${l.qte || 1}" oninput="b2bCalculer('${boxId}')" title="Quantité" />
    <input type="number" min="0" value="${l.prix ?? ""}" placeholder="Prix pro" oninput="b2bCalculer('${boxId}')" title="Prix unitaire B2B" />
    <button type="button" class="del-btn" onclick="this.parentElement.remove();b2bCalculer('${boxId}')">✕</button>`;
  document.getElementById(boxId).appendChild(d);
  b2bCalculer(boxId);
}
function b2bProduitChoisi(sel) {
  const p = products.find((x) => String(x.id) === sel.value);
  if (p) sel.parentElement.querySelectorAll("input")[1].value = b2bTarif(p);
  b2bCalculer(sel.closest("[id]").id);
}
function b2bLignes(boxId) {
  return [...document.querySelectorAll(`#${boxId} .liv-ligne`)].map((d) => {
    const p = products.find((x) => String(x.id) === d.querySelector("select").value);
    const [q, pr] = d.querySelectorAll("input");
    return p ? { productId: p.id, nom: p.name, qte: b2bNum(q.value), prix: b2bNum(pr.value) } : null;
  }).filter((l) => l && l.qte > 0);
}
function b2bCalculer(boxId) {
  const total = b2bLignes(boxId).reduce((s, l) => s + l.qte * l.prix, 0);
  const el = document.getElementById(boxId + "-total");
  if (el) el.innerHTML = `Total : <strong>${fmt(total)} FCFA</strong>`;
  if (boxId === "b2b-cmd-lignes") {
    const paye = document.getElementById("b2b-cmd-paye");
    if (paye && !paye.dataset.modifie) paye.value = total;
  }
}
function b2bRemplirSelectClients(selId, choisi) {
  const sel = document.getElementById(selId);
  const L = b2b.data.B2B_Clients.filter((c) => c["Statut"] !== "Pas intéressé")
    .sort((a, b) => String(a["Établissement"]).localeCompare(String(b["Établissement"]), "fr"));
  sel.innerHTML = `<option value="">— Établissement —</option>` + L.map((c) =>
    `<option value="${proEscape(c.ID)}" ${String(c.ID) === String(choisi) ? "selected" : ""}>${proEscape(c["Établissement"])}${c["Statut"] !== "Client" ? " (" + proEscape(c["Statut"]) + ")" : ""}</option>`).join("");
}
function b2bRemplirModes(selId) {
  document.getElementById(selId).innerHTML = B2B_MODES.map((m) => `<option value="${m.v}">${m.l}</option>`).join("");
}
// un prospect qui achète ou prend un dépôt devient « Client »
function b2bDevenirClient(c) {
  return c && c["Statut"] !== "Client" ? [{ feuille: "B2B_Clients", obj: { ...c, "Statut": "Client", "Mis à jour": b2bNow() } }] : [];
}

// =====================================================================
// DÉPÔTS-VENTES
// =====================================================================
function b2bNouveauDepot(clientId) {
  b2b.vue = "depots";
  b2bRendre();
  b2bRemplirSelectClients("b2b-dep-client", clientId);
  document.getElementById("b2b-dep-form").classList.remove("hidden");
  document.getElementById("b2b-dep-lignes").innerHTML = "";
  document.getElementById("b2b-dep-note").value = "";
  b2bAjouterLigne("b2b-dep-lignes");
}

async function b2bEnregistrerDepot() {
  const clientId = document.getElementById("b2b-dep-client").value;
  const c = b2bClient(clientId);
  const lignes = b2bLignes("b2b-dep-lignes");
  if (!c) return alert("Choisis l'établissement.");
  if (!lignes.length) return alert("Ajoute au moins un produit.");
  const err = b2bVerifierStock(lignes);
  if (err) return alert(err);
  const total = lignes.reduce((s, l) => s + l.qte * l.prix, 0);
  if (!confirm(`Déposer ${lignes.reduce((s, l) => s + l.qte, 0)} pièce(s) chez ${c["Établissement"]} (valeur ${fmt(total)} FCFA au prix pro) ?\n\nLe stock sera retiré maintenant.`)) return;
  const id = b2bId("DEP");
  const obj = {
    ID: id, "Date": b2bNow(), "Client ID": c.ID, "Établissement": c["Établissement"],
    "Produits": JSON.stringify(lignes.map((l) => ({ ...l, vendus: 0, retournes: 0 }))),
    "Statut": "En cours", "Note": document.getElementById("b2b-dep-note").value.trim(), "Mis à jour": b2bNow()
  };
  try {
    await b2bSave([{ feuille: "B2B_Depots", obj }, ...b2bDevenirClient(c)]);
    b2bBougerStock(lignes, -1, `Dépôt-vente ${c["Établissement"]} (${id})`);
    document.getElementById("b2b-dep-form").classList.add("hidden");
    b2bRendre();
    if (confirm("✅ Dépôt enregistré.\n\nGénérer le bon de dépôt ?")) b2bTicketDepot(id);
  } catch (e) { alert("⚠️ " + e.message); }
}

function b2bRendreDepots() {
  const box = document.getElementById("b2b-depots-liste");
  const voirClos = document.getElementById("b2b-dep-clos")?.checked;
  const L = b2b.data.B2B_Depots.filter((d) => voirClos || d["Statut"] !== "Clôturé")
    .sort((a, b) => String(b["Date"]).localeCompare(String(a["Date"])));
  if (!L.length) { box.innerHTML = `<div class="task-empty">Aucun dépôt en cours.</div>`; return; }
  box.innerHTML = L.map((d) => {
    const lignes = b2bProduits(d);
    const id = b2bJs(d.ID);
    const enPoint = b2b.pointDepot === d.ID;
    const restantTot = lignes.reduce((s, l) => s + b2bNum(l.qte) - b2bNum(l.vendus) - b2bNum(l.retournes), 0);
    const rows = lignes.map((l, i) => {
      const r = b2bNum(l.qte) - b2bNum(l.vendus) - b2bNum(l.retournes);
      return `<tr><td>${proEscape(l.nom)}</td><td>${fmt(l.prix)}</td><td>${l.qte}</td><td>${b2bNum(l.vendus)}</td><td>${b2bNum(l.retournes)}</td><td><strong>${r}</strong></td>
        ${enPoint ? `<td><input type="number" min="0" max="${r}" value="0" id="pt-v-${i}" oninput="b2bCalculerPoint()" style="width:64px" /></td>
                     <td><input type="number" min="0" max="${r}" value="0" id="pt-r-${i}" style="width:64px" /></td>` : ""}</tr>`;
    }).join("");
    return `<div class="liv-card ${d["Statut"] === "Clôturé" ? "liv-b-livree" : "liv-b-route"}">
      <div class="liv-top">
        <div><div class="liv-nom">📦 ${proEscape(d["Établissement"])}</div>
          <div class="liv-mut">${proEscape(d.ID)} • déposé le ${b2bDateFr(d["Date"])}${d["Note"] ? " • " + proEscape(d["Note"]) : ""}</div></div>
        <div class="liv-prix">${restantTot} pièce(s) chez eux<div class="liv-mut">${proEscape(d["Statut"])}</div></div>
      </div>
      <table><thead><tr><th>Produit</th><th>Prix pro</th><th>Déposé</th><th>Vendu</th><th>Rendu</th><th>Reste chez eux</th>${enPoint ? "<th>Vendus depuis</th><th>Invendus rendus</th>" : ""}</tr></thead>
        <tbody>${rows}</tbody></table>
      ${enPoint ? `<div class="payment-section">
          <p id="pt-total" class="total-label"></p>
          <div class="form-grid">
            <label>Montant payé maintenant (FCFA)<input type="number" id="pt-paye" min="0" oninput="this.dataset.modifie=1" /></label>
            <label>Mode de paiement<select id="pt-mode"></select></label>
          </div>
          <button class="primary-btn" onclick="b2bValiderPoint(${id})">✅ Valider le point</button>
          <button class="secondary-btn" onclick="b2b.pointDepot=null;b2bRendreDepots()">Annuler</button>
        </div>`
        : `<div class="liv-actions">${d["Statut"] !== "Clôturé" ? `<button class="primary-btn small-btn" onclick="b2bOuvrirPoint(${id})">🧮 Faire le point (vendus / invendus)</button>` : ""}
             <button class="secondary-btn small-btn" onclick="b2bTicketDepot(${id})">🧾 Bon de dépôt</button></div>`}
    </div>`;
  }).join("");
  if (b2b.pointDepot) { b2bRemplirModes("pt-mode"); b2bCalculerPoint(); }
}

function b2bOuvrirPoint(id) { b2b.pointDepot = id; b2bRendreDepots(); }

function b2bCalculerPoint() {
  const d = b2b.data.B2B_Depots.find((x) => x.ID === b2b.pointDepot);
  if (!d) return;
  const total = b2bProduits(d).reduce((s, l, i) => s + b2bNum(document.getElementById("pt-v-" + i)?.value) * b2bNum(l.prix), 0);
  document.getElementById("pt-total").innerHTML = `Ventes à facturer : <strong>${fmt(total)} FCFA</strong>`;
  const paye = document.getElementById("pt-paye");
  if (paye && !paye.dataset.modifie) paye.value = total;
}

async function b2bValiderPoint(id) {
  const d = b2b.data.B2B_Depots.find((x) => x.ID === id);
  const c = d && b2bClient(d["Client ID"]);
  if (!d) return;
  const lignes = b2bProduits(d);
  const vendus = [], rendus = [];
  for (let i = 0; i < lignes.length; i++) {
    const l = lignes[i];
    const r = b2bNum(l.qte) - b2bNum(l.vendus) - b2bNum(l.retournes);
    const v = b2bNum(document.getElementById("pt-v-" + i).value);
    const ret = b2bNum(document.getElementById("pt-r-" + i).value);
    if (v < 0 || ret < 0 || v + ret > r) return alert(`${l.nom} : vendus + rendus (${v + ret}) dépasse ce qui reste chez eux (${r}).`);
    if (v) vendus.push({ ...l, qte: v });
    if (ret) rendus.push({ ...l, qte: ret });
    l.vendus = b2bNum(l.vendus) + v;
    l.retournes = b2bNum(l.retournes) + ret;
  }
  if (!vendus.length && !rendus.length) return alert("Indique au moins un produit vendu ou rendu.");
  const total = vendus.reduce((s, l) => s + l.qte * b2bNum(l.prix), 0);
  const paye = Math.min(total, b2bNum(document.getElementById("pt-paye").value));
  const mode = document.getElementById("pt-mode").value;
  const restant = lignes.reduce((s, l) => s + b2bNum(l.qte) - b2bNum(l.vendus) - b2bNum(l.retournes), 0);

  const resume = (vendus.length ? `• Vendus : ${vendus.map((l) => l.qte + " × " + l.nom).join(", ")} = ${fmt(total)} FCFA (caisse B2B)\n` : "") +
    (total ? `• Payé maintenant : ${fmt(paye)} FCFA${total - paye > 0 ? ` • reste à payer ${fmt(total - paye)} FCFA` : ""}\n` : "") +
    (rendus.length ? `• Invendus remis en stock : ${rendus.map((l) => l.qte + " × " + l.nom).join(", ")}\n` : "") +
    (restant ? `• Restent chez eux : ${restant} pièce(s)` : "• Dépôt clôturé");
  if (!confirm(`Point du dépôt chez ${d["Établissement"]} :\n\n${resume}`)) return;

  const save = [{ feuille: "B2B_Depots", obj: { ...d, "Produits": JSON.stringify(lignes), "Statut": restant ? "En cours" : "Clôturé", "Mis à jour": b2bNow() } }];
  if (vendus.length) {
    const venteId = b2bId("VTE");
    save.push({ feuille: "B2B_Ventes", obj: {
      ID: venteId, "Date": b2bNow(), "Type": "Dépôt-vente", "Client ID": d["Client ID"], "Établissement": d["Établissement"],
      "Produits": JSON.stringify(vendus.map((l) => ({ productId: l.productId, nom: l.nom, qte: l.qte, prix: l.prix }))),
      "Total": total, "Payé": paye, "Reste": total - paye, "Dépôt ID": d.ID, "Note": "" } });
    if (paye > 0) save.push({ feuille: "B2B_Paiements", obj: {
      ID: b2bId("PAY"), "Date": b2bNow(), "Vente ID": venteId, "Client ID": d["Client ID"], "Établissement": d["Établissement"],
      "Montant": paye, "Mode": mode, "Note": "Point de dépôt" } });
  }
  try {
    await b2bSave(save.concat(b2bDevenirClient(c)));
    if (rendus.length) b2bBougerStock(rendus, +1, `Invendus rendus ${d["Établissement"]} (${d.ID})`);
    b2b.pointDepot = null;
    b2bRendre();
    refreshProIfVisible();
    const venteDuPoint = save.find((x) => x.feuille === "B2B_Ventes");
    if (venteDuPoint && confirm("✅ Point enregistré.\n\nGénérer la facture des produits vendus ?")) b2bTicketVente(venteDuPoint.obj.ID);
    else if (!venteDuPoint && confirm("✅ Point enregistré.\n\nGénérer le bon de dépôt à jour ?")) b2bTicketDepot(d.ID);
  } catch (e) { alert("⚠️ " + e.message); }
}

// =====================================================================
// COMMANDES (vente en gros directe)
// =====================================================================
function b2bNouvelleCommande(clientId) {
  b2b.vue = "commandes";
  b2bRendre();
  b2bRemplirSelectClients("b2b-cmd-client", clientId);
  b2bRemplirModes("b2b-cmd-mode");
  document.getElementById("b2b-cmd-form").classList.remove("hidden");
  document.getElementById("b2b-cmd-lignes").innerHTML = "";
  document.getElementById("b2b-cmd-note").value = "";
  const paye = document.getElementById("b2b-cmd-paye");
  delete paye.dataset.modifie;
  b2bAjouterLigne("b2b-cmd-lignes");
}

async function b2bEnregistrerCommande() {
  const c = b2bClient(document.getElementById("b2b-cmd-client").value);
  const lignes = b2bLignes("b2b-cmd-lignes");
  if (!c) return alert("Choisis l'établissement.");
  if (!lignes.length) return alert("Ajoute au moins un produit.");
  const err = b2bVerifierStock(lignes);
  if (err) return alert(err);
  const total = lignes.reduce((s, l) => s + l.qte * l.prix, 0);
  const paye = Math.min(total, b2bNum(document.getElementById("b2b-cmd-paye").value));
  const mode = document.getElementById("b2b-cmd-mode").value;
  if (!confirm(`Commande de ${c["Établissement"]} : ${fmt(total)} FCFA\nPayé maintenant : ${fmt(paye)} FCFA (${b2bModeLabel(mode)})${total - paye ? `\nReste à payer : ${fmt(total - paye)} FCFA` : ""}\n\nLe stock sera retiré.`)) return;
  const venteId = b2bId("CMD");
  const save = [{ feuille: "B2B_Ventes", obj: {
    ID: venteId, "Date": b2bNow(), "Type": "Commande", "Client ID": c.ID, "Établissement": c["Établissement"],
    "Produits": JSON.stringify(lignes), "Total": total, "Payé": paye, "Reste": total - paye, "Dépôt ID": "",
    "Note": document.getElementById("b2b-cmd-note").value.trim() } }];
  if (paye > 0) save.push({ feuille: "B2B_Paiements", obj: {
    ID: b2bId("PAY"), "Date": b2bNow(), "Vente ID": venteId, "Client ID": c.ID, "Établissement": c["Établissement"],
    "Montant": paye, "Mode": mode, "Note": "À la commande" } });
  try {
    await b2bSave(save.concat(b2bDevenirClient(c)));
    b2bBougerStock(lignes, -1, `Vente en gros ${c["Établissement"]} (${venteId})`);
    document.getElementById("b2b-cmd-form").classList.add("hidden");
    b2bRendre();
    if (confirm("✅ Commande enregistrée.\n\nGénérer la facture ?")) b2bTicketVente(venteId);
  } catch (e) { alert("⚠️ " + e.message); }
}

function b2bRendreCommandes() {
  const box = document.getElementById("b2b-ventes-body");
  const f = document.getElementById("b2b-ventes-filtre")?.value || "";
  const L = b2b.data.B2B_Ventes.filter((v) => !f || (f === "impaye" ? b2bNum(v["Reste"]) > 0 : v["Type"] === f))
    .sort((a, b) => String(b["Date"]).localeCompare(String(a["Date"])));
  box.innerHTML = L.length ? L.slice(0, 300).map((v) => `<tr>
      <td>${b2bDateFr(v["Date"])}</td>
      <td>${proEscape(v["Établissement"])}<br><small class="help-text">${proEscape(v["Type"])} • ${proEscape(v.ID)}</small></td>
      <td>${b2bProduits(v).map((l) => `${l.qte} × ${proEscape(l.nom)}`).join("<br>")}</td>
      <td>${fmt(v["Total"])} FCFA</td>
      <td>${fmt(v["Payé"])} FCFA</td>
      <td class="${b2bNum(v["Reste"]) > 0 ? "text-neg" : "text-pos"}">${b2bNum(v["Reste"]) > 0 ? fmt(v["Reste"]) + " FCFA" : "✅ Payé"}</td>
      <td><button class="small-btn" onclick="b2bTicketVente(${b2bJs(v.ID)})">🧾 Ticket</button>
        ${b2bNum(v["Reste"]) > 0 ? `<button class="small-btn" onclick="b2bOuvrirPaiement({venteId:${b2bJs(v.ID)}})">💵 Encaisser</button>` : ""}</td>
    </tr>`).join("") : `<tr><td colspan="7">Aucune vente B2B.</td></tr>`;
}

// =====================================================================
// TICKETS B2B (même modèle que le ticket de caisse)
// =====================================================================
function b2bInfosEtab(clientId, nomSecours) {
  const c = b2bClient(clientId) || {};
  return [
    ["Établissement", c["Établissement"] || nomSecours],
    ["Responsable", c["Responsable"]],
    ["Téléphone", c["Téléphone"]],
    ["Adresse", c["Adresse"]]
  ];
}

// Facture d'une vente B2B (commande directe ou point de dépôt)
function b2bTicketVente(venteId) {
  const v = b2b.data.B2B_Ventes.find((x) => String(x.ID) === String(venteId));
  if (!v) return;
  const pays = b2b.data.B2B_Paiements.filter((p) => String(p["Vente ID"]) === String(v.ID))
    .sort((a, b) => String(a["Date"]).localeCompare(String(b["Date"])));
  const reste = b2bNum(v["Reste"]);
  const historique = pays.length
    ? pays.map((p) => `<div class="row small"><span>${b2bDateFr(p["Date"])} • ${proEscape(b2bModeLabel(p["Mode"]))}</span><span>${fmt(p["Montant"])} F</span></div>`).join("")
    : `<div class="small muted">Aucun paiement reçu</div>`;
  openTicketWindow(buildTicketHtml({
    titre: v["Type"] === "Commande" ? "FACTURE – VENTE EN GROS" : "FACTURE – DÉPÔT-VENTE",
    numero: v.ID,
    date: v["Date"],
    infos: [...b2bInfosEtab(v["Client ID"], v["Établissement"]), ["Dépôt", v["Dépôt ID"]], ["Note", v["Note"]]],
    lignes: b2bProduits(v).map((l) => ({ nom: l.nom, qte: l.qte, prix: l.prix })),
    recap: [],
    totalLabel: "TOTAL",
    total: v["Total"],
    apresTotal: `<div class="row"><span>Déjà payé</span><span>${fmt(v["Payé"])} F</span></div>` +
      (reste > 0 ? `<div class="encadre">RESTE À PAYER : ${fmt(reste)} FCFA</div>` : `<div class="encadre">✅ FACTURE RÉGLÉE</div>`),
    bloc: `<div class="small fort">Paiements reçus</div>${historique}`,
    noteBas: `<div class="signature"><div>L'établissement</div><div>BSK</div></div>`,
    pied: `<div class="merci">Merci pour votre confiance 🧡</div>`
  }));
}

// Bon de dépôt-vente : produits laissés chez l'établissement et où on en est
function b2bTicketDepot(depotId) {
  const d = b2b.data.B2B_Depots.find((x) => String(x.ID) === String(depotId));
  if (!d) return;
  const lignes = b2bProduits(d);
  const vendus = lignes.reduce((s, l) => s + b2bNum(l.vendus), 0);
  const rendus = lignes.reduce((s, l) => s + b2bNum(l.retournes), 0);
  const restant = lignes.reduce((s, l) => s + b2bNum(l.qte) - b2bNum(l.vendus) - b2bNum(l.retournes), 0);
  const valeurRestante = lignes.reduce((s, l) => s + (b2bNum(l.qte) - b2bNum(l.vendus) - b2bNum(l.retournes)) * b2bNum(l.prix), 0);
  const detail = (vendus || rendus) ? lignes.map((l) => {
    const r = b2bNum(l.qte) - b2bNum(l.vendus) - b2bNum(l.retournes);
    return `<div class="row small"><span>${proEscape(l.nom)}</span><span>vendu ${b2bNum(l.vendus)} • rendu ${b2bNum(l.retournes)} • reste ${r}</span></div>`;
  }).join("") : "";
  openTicketWindow(buildTicketHtml({
    titre: "BON DE DÉPÔT-VENTE",
    numero: d.ID,
    date: d["Date"],
    infos: [...b2bInfosEtab(d["Client ID"], d["Établissement"]), ["Statut", d["Statut"]], ["Note", d["Note"]]],
    lignes: lignes.map((l) => ({ nom: l.nom, qte: l.qte, prix: l.prix })),
    recap: [],
    totalLabel: "VALEUR",
    total: lignes.reduce((s, l) => s + b2bNum(l.qte) * b2bNum(l.prix), 0),
    apresTotal: `<div class="small muted">Prix professionnels BSK. Les produits vendus sont facturés au point de dépôt, les invendus sont repris.</div>` +
      ((vendus || rendus) ? `<div class="row small"><span>Vendus</span><span>${vendus} pièce(s)</span></div><div class="row small"><span>Rendus</span><span>${rendus} pièce(s)</span></div>` : "") +
      `<div class="encadre">RESTENT CHEZ VOUS : ${restant} pièce(s)<br>${fmt(valeurRestante)} FCFA</div>`,
    bloc: detail ? `<div class="small fort">Détail</div>${detail}` : "",
    noteBas: `<div class="signature"><div>L'établissement</div><div>BSK</div></div>`,
    pied: `<div class="merci">Merci pour votre confiance 🧡</div>`
  }));
}

// =====================================================================
// PAIEMENTS (reste à payer)
// =====================================================================
function b2bOuvrirPaiement(cible) {
  b2b.payCible = cible;
  const ventes = b2bVentesCible(cible);
  const reste = ventes.reduce((s, v) => s + b2bNum(v["Reste"]), 0);
  const nom = ventes[0] ? ventes[0]["Établissement"] : "";
  document.getElementById("b2b-pay-titre").textContent = `💵 Encaisser : ${nom}`;
  document.getElementById("b2b-pay-info").innerHTML = `Reste à payer : <strong>${fmt(reste)} FCFA</strong>` +
    (ventes.length > 1 ? `<br><small>${ventes.length} ventes : le paiement règle d'abord les plus anciennes.</small>` : "");
  document.getElementById("b2b-pay-montant").value = reste;
  document.getElementById("b2b-pay-montant").max = reste;
  b2bRemplirModes("b2b-pay-mode");
  document.getElementById("b2b-pay-note").value = "";
  document.getElementById("b2b-pay-modal").classList.remove("hidden");
}
function b2bVentesCible(cible) {
  return b2b.data.B2B_Ventes.filter((v) => b2bNum(v["Reste"]) > 0 &&
    (cible.venteId ? v.ID === cible.venteId : String(v["Client ID"]) === String(cible.clientId)))
    .sort((a, b) => String(a["Date"]).localeCompare(String(b["Date"])));
}
function b2bFermerPaiement() { document.getElementById("b2b-pay-modal").classList.add("hidden"); }

async function b2bValiderPaiement(e) {
  if (e) e.preventDefault();
  const ventes = b2bVentesCible(b2b.payCible || {});
  const reste = ventes.reduce((s, v) => s + b2bNum(v["Reste"]), 0);
  let montant = b2bNum(document.getElementById("b2b-pay-montant").value);
  const mode = document.getElementById("b2b-pay-mode").value;
  const note = document.getElementById("b2b-pay-note").value.trim();
  if (montant <= 0) return alert("Indique un montant.");
  if (montant > reste) return alert(`Le montant dépasse ce qui reste à payer (${fmt(reste)} FCFA).`);
  const save = [];
  for (const v of ventes) {
    if (montant <= 0) break;
    const part = Math.min(montant, b2bNum(v["Reste"]));
    montant -= part;
    save.push({ feuille: "B2B_Ventes", obj: { ...v, "Payé": b2bNum(v["Payé"]) + part, "Reste": b2bNum(v["Reste"]) - part } });
    save.push({ feuille: "B2B_Paiements", obj: { ID: b2bId("PAY"), "Date": b2bNow(), "Vente ID": v.ID, "Client ID": v["Client ID"],
      "Établissement": v["Établissement"], "Montant": part, "Mode": mode, "Note": note || "Règlement" } });
  }
  try {
    await b2bSave(save);
    b2bFermerPaiement();
    b2bRendre();
  } catch (err) { alert("⚠️ " + err.message); }
}

// =====================================================================
// CAISSE B2B (séparée de la caisse boutique) + dépôt au coffre commun
// =====================================================================
const B2B_COFFRE_TAG = "[B2B]";
function isB2BVaultMove(m) { return String(m.motif || "").indexOf(B2B_COFFRE_TAG) === 0; }

function computeCaisseB2B() {
  const especes = b2b.data.B2B_Paiements.filter((p) => p["Mode"] === "cash").reduce((s, p) => s + b2bNum(p["Montant"]), 0);
  const versements = (vault.moves || []).filter((m) => m.type === "deposit" && isB2BVaultMove(m)).reduce((s, m) => s + b2bNum(m.amount), 0);
  return especes - versements;
}

function b2bDeposerCoffre() {
  const solde = computeCaisseB2B();
  openMoneyModal({
    title: "🔐 Dépôt de la caisse B2B dans le coffre",
    info: `Disponible dans la caisse B2B : <strong>${fmt(solde)} FCFA</strong><br><small>Le coffre est le même que celui de la boutique.</small>`,
    amountLabel: "Montant à déposer (FCFA)",
    defaultAmount: solde > 0 ? solde : "",
    motifLabel: "Note (optionnel)",
    motifPlaceholder: "Ex : encaissements B2B de la semaine",
    confirmLabel: "Déposer",
    onConfirm: ({ amount, motif }) => {
      if (!(amount > 0)) return "Indique un montant valide.";
      if (amount > solde) return `La caisse B2B ne contient que ${fmt(solde)} FCFA.`;
      addVaultMove({ at: b2bNow(), type: "deposit", amount, motif: `${B2B_COFFRE_TAG} ${motif || "Dépôt depuis la caisse B2B"}` });
      b2bRendre();
      refreshProIfVisible();
      alert(`✅ ${fmt(amount)} FCFA de la caisse B2B déposés dans le coffre.`);
      return null;
    }
  });
}

function b2bRendreCaisse() {
  const jour = todayLocalStr();
  const duJour = (iso) => dateKeyOf(iso) === jour;
  const pays = b2b.data.B2B_Paiements.filter((p) => duJour(p["Date"]));
  const ventes = b2b.data.B2B_Ventes.filter((v) => duJour(v["Date"]));
  const parMode = {};
  pays.forEach((p) => { parMode[p["Mode"]] = (parMode[p["Mode"]] || 0) + b2bNum(p["Montant"]); });
  const solde = computeCaisseB2B();
  document.getElementById("b2b-caisse-solde").textContent = fmt(solde);
  document.getElementById("b2b-caisse-solde").parentElement.classList.toggle("negative", solde < 0);
  const creances = b2b.data.B2B_Ventes.reduce((s, v) => s + b2bNum(v["Reste"]), 0);
  document.getElementById("b2b-caisse-kpis").innerHTML =
    `<div class="card"><div class="label">Ventes B2B du jour</div><div class="value">${fmt(ventes.reduce((s, v) => s + b2bNum(v["Total"]), 0))} FCFA</div><div class="sub">${ventes.length} vente(s)</div></div>` +
    `<div class="card"><div class="label">Encaissé aujourd'hui</div><div class="value">${fmt(pays.reduce((s, p) => s + b2bNum(p["Montant"]), 0))} FCFA</div></div>` +
    B2B_MODES.map((m) => `<div class="card"><div class="label">${m.l}</div><div class="value">${fmt(parMode[m.v] || 0)} FCFA</div></div>`).join("") +
    `<div class="card"><div class="label">Reste à encaisser (tous)</div><div class="value text-neg">${fmt(creances)} FCFA</div></div>`;

  document.getElementById("b2b-caisse-ventes").innerHTML = ventes.length ? ventes.map((v) => `<tr>
      <td>${new Date(v["Date"]).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</td>
      <td>${proEscape(v["Établissement"])}<br><small class="help-text">${proEscape(v["Type"])}</small></td>
      <td>${b2bProduits(v).map((l) => `${l.qte} × ${proEscape(l.nom)}`).join("<br>")}</td>
      <td>${fmt(v["Total"])} FCFA</td>
      <td class="${b2bNum(v["Reste"]) > 0 ? "text-neg" : "text-pos"}">${b2bNum(v["Reste"]) > 0 ? "reste " + fmt(v["Reste"]) : "✅ payé"}</td></tr>`).join("")
    : `<tr><td colspan="5">Aucune vente B2B aujourd'hui.</td></tr>`;

  document.getElementById("b2b-caisse-pays").innerHTML = pays.length ? pays.map((p) => `<tr>
      <td>${new Date(p["Date"]).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</td>
      <td>${proEscape(p["Établissement"])}</td><td>${fmt(p["Montant"])} FCFA</td><td>${b2bModeLabel(p["Mode"])}</td><td>${proEscape(p["Note"])}</td></tr>`).join("")
    : `<tr><td colspan="5">Aucun encaissement aujourd'hui.</td></tr>`;
}

// =====================================================================
// TABLEAU DE BORD B2B (code obligatoire)
// =====================================================================
function b2bDeverrouiller(e) {
  if (e) e.preventDefault();
  const input = document.getElementById("b2b-lock-input");
  if (input.value === PRO_PASSWORD) {
    sessionStorage.setItem(PRO_UNLOCK_KEY, "1");
    input.value = "";
    document.getElementById("b2b-lock-error").classList.add("hidden");
    b2bRendre();
  } else {
    input.value = "";
    document.getElementById("b2b-lock-error").classList.remove("hidden");
  }
}

function b2bSetPeriode(p) { b2b.periode = p; b2bRendreBord(); }

function b2bRendreBord() {
  const ok = isProUnlocked();
  document.getElementById("b2b-lock").classList.toggle("hidden", ok);
  document.getElementById("b2b-bord-contenu").classList.toggle("hidden", !ok);
  if (!ok) return;
  document.querySelectorAll(".b2b-period-btn").forEach((b) => b.classList.toggle("active", b.dataset.period === b2b.periode));
  const { from, to } = getProRange(b2b.periode, todayLocalStr());
  const dans = (iso) => { const k = dateKeyOf(iso); return k && k >= from && k <= to; };
  const ventes = b2b.data.B2B_Ventes.filter((v) => dans(v["Date"]));
  const pays = b2b.data.B2B_Paiements.filter((p) => dans(p["Date"]));
  const ca = ventes.reduce((s, v) => s + b2bNum(v["Total"]), 0);
  const creances = b2b.data.B2B_Ventes.reduce((s, v) => s + b2bNum(v["Reste"]), 0);
  let depotValeur = 0, depotQte = 0;
  b2b.data.B2B_Depots.filter((d) => d["Statut"] !== "Clôturé").forEach((d) => b2bProduits(d).forEach((l) => {
    const r = b2bNum(l.qte) - b2bNum(l.vendus) - b2bNum(l.retournes);
    depotQte += r; depotValeur += r * b2bNum(l.prix);
  }));
  // marge (coût de revient de l'onglet Pro)
  let cout = 0;
  ventes.forEach((v) => b2bProduits(v).forEach((l) => { cout += (getUnitCost(l.nom) || 0) * b2bNum(l.qte); }));
  const fiches = b2b.data.B2B_Clients;
  const nb = (s) => fiches.filter((c) => c["Statut"] === s).length;
  const card = (l, v, sub = "") => `<div class="card"><div class="label">${l}</div><div class="value">${v}</div>${sub ? `<div class="sub">${sub}</div>` : ""}</div>`;
  document.getElementById("b2b-bord-kpis").innerHTML =
    card("CA B2B", fmt(ca) + " FCFA", `${ventes.length} vente(s)`) +
    card("dont commandes", fmt(ventes.filter((v) => v["Type"] === "Commande").reduce((s, v) => s + b2bNum(v["Total"]), 0)) + " FCFA") +
    card("dont dépôts-ventes", fmt(ventes.filter((v) => v["Type"] === "Dépôt-vente").reduce((s, v) => s + b2bNum(v["Total"]), 0)) + " FCFA") +
    card("Marge brute", fmt(ca - cout) + " FCFA", ca ? `${Math.round(((ca - cout) / ca) * 100)}% (coûts de l'onglet Pro)` : "") +
    card("Encaissé", fmt(pays.reduce((s, p) => s + b2bNum(p["Montant"]), 0)) + " FCFA") +
    card("Reste à encaisser (tous)", `<span class="text-neg">${fmt(creances)} FCFA</span>`) +
    card("Marchandise en dépôt", `${fmt(depotQte)} pièce(s)`, `${fmt(depotValeur)} FCFA au prix pro`) +
    card("Caisse B2B", fmt(computeCaisseB2B()) + " FCFA");
  document.getElementById("b2b-bord-funnel").innerHTML =
    B2B_STATUTS.map((s) => card(s, fmt(nb(s)))).join("") +
    card("Taux de conversion", fiches.length ? Math.round((nb("Client") / fiches.length) * 100) + "%" : "—", "prospects devenus clients");

  const parClient = {};
  ventes.forEach((v) => { const k = v["Établissement"]; parClient[k] = parClient[k] || { ca: 0, n: 0 }; parClient[k].ca += b2bNum(v["Total"]); parClient[k].n++; });
  const topC = Object.entries(parClient).sort((a, b) => b[1].ca - a[1].ca).slice(0, 10);
  document.getElementById("b2b-bord-clients").innerHTML = topC.length ? topC.map(([k, v], i) => {
    const c = fiches.find((x) => x["Établissement"] === k);
    return `<tr><td>${i + 1}</td><td>${proEscape(k)}</td><td>${v.n}</td><td>${fmt(v.ca)} FCFA</td><td class="text-neg">${c ? fmt(b2bStatsClient(c.ID).reste) : "—"}</td></tr>`;
  }).join("") : `<tr><td colspan="5">Aucune vente sur la période.</td></tr>`;

  const parProd = {};
  ventes.forEach((v) => b2bProduits(v).forEach((l) => { parProd[l.nom] = parProd[l.nom] || { q: 0, ca: 0 }; parProd[l.nom].q += b2bNum(l.qte); parProd[l.nom].ca += b2bNum(l.qte) * b2bNum(l.prix); }));
  const topP = Object.entries(parProd).sort((a, b) => b[1].q - a[1].q).slice(0, 10);
  document.getElementById("b2b-bord-produits").innerHTML = topP.length ? topP.map(([k, v]) =>
    `<tr><td>${proEscape(k)}</td><td>${v.q}</td><td>${fmt(v.ca)} FCFA</td></tr>`).join("") : `<tr><td colspan="3">—</td></tr>`;
}

// =====================================================================
// TARIFS B2B
// =====================================================================
function b2bRendreTarifs() {
  document.getElementById("b2b-tarifs-body").innerHTML = products.filter((p) => !isServiceProduct(p)).map((p) => {
    const t = b2b.data.B2B_Tarifs.find((x) => String(x.ID) === String(p.id));
    const v = t ? t["Prix B2B"] : "";
    const remise = v !== "" && p.price ? Math.round((1 - Number(v) / p.price) * 100) : null;
    return `<tr><td>${proEscape(p.name)}</td><td>${fmt(p.price)} FCFA</td>
      <td><input type="number" min="0" step="100" value="${v}" placeholder="${p.price}" onchange="b2bEnregistrerTarif(${p.id}, this.value)" /></td>
      <td>${remise !== null ? remise + "%" : `<small class="help-text">prix boutique</small>`}</td><td>${p.stock}</td></tr>`;
  }).join("");
}

async function b2bEnregistrerTarif(productId, valeur) {
  const p = products.find((x) => x.id === productId);
  if (!p) return;
  try {
    await b2bSave([{ feuille: "B2B_Tarifs", obj: { ID: String(p.id), "Produit": p.name, "Prix B2B": valeur === "" ? "" : b2bNum(valeur), "Mis à jour": b2bNow() } }]);
    b2bRendreTarifs();
  } catch (e) { alert("⚠️ " + e.message); }
}

// ---------- Démarrage ----------
document.addEventListener("DOMContentLoaded", () => {
  b2bLireCache();
  b2bCharger(true);
  document.getElementById("b2b-f-tel")?.addEventListener("input", b2bVerifTel);
  document.getElementById("b2b-rech")?.addEventListener("input", b2bRendreFiches);
  document.getElementById("b2b-cmd-paye")?.addEventListener("input", (e) => { e.target.dataset.modifie = "1"; });
  document.getElementById("b2b-pay-modal")?.addEventListener("keydown", (e) => { if (e.key === "Escape") b2bFermerPaiement(); });
  setInterval(() => {
    const v = document.getElementById("view-b2b");
    if (v && !v.classList.contains("hidden")) b2bCharger(true);
  }, 60000);
});
