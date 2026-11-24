// =====================================================================
// ================== LIVRAISONS (commandes à livrer) ==================
// =====================================================================
// Les commandes sont gardées dans le même Google Sheets que la caisse
// (feuilles « Livraisons », « Livreurs », « Livraisons_Journal », actions « liv_… » du Code.gs).
// Tout le reste vient de la caisse :
//   • clients  → même liste que l'onglet Clients (un nouveau client est créé ici s'il n'existe pas)
//   • produits → même catalogue et même stock que la caisse
//   • quand une commande passe en « Livrée » :
//       1) une VENTE est enregistrée (ventes du jour, CA, client, Pro, Bilan)
//       2) le STOCK est diminué
//       3) le paiement du livreur est ajouté aux FRAIS (Transport / livraison), payé avec la CAISSE
const LIV_URL = SHEET_URL; // même script Google que la caisse

const LIV_SOURCES = ["Live", "Instagram", "WhatsApp", "Appel", "Autre"];
const LIV_SOURCE_ICONS = { Live: "🎥", Instagram: "📸", WhatsApp: "💬", Appel: "📞", Autre: "✳️" };
const LIV_STATUTS = ["En attente", "Assignée", "En route", "Livrée", "Annulée", "Retournée"];
const LIV_ACTIFS = ["En attente", "Assignée", "En route"];
const LIV_CLS = { "En attente": "attente", "Assignée": "assignee", "En route": "route", "Livrée": "livree", "Annulée": "annulee", "Retournée": "annulee" };
// libellés enregistrés dans la base Livraisons → mode de paiement de la caisse
const LIV_PAIEMENTS = [
  { label: "Espèces à la livraison", method: "cash" },
  { label: "Wave", method: "wave" },
  { label: "Orange Money", method: "orange" },
  { label: "Déjà payé en boutique", method: null } // vente déjà passée en caisse : pas de 2e vente
];
const LIV_CACHE_KEY = "bsk_livraisons_cache";

const liv = {
  commandes: [],
  livreurs: [],
  vue: "liste",          // liste | form | livreurs | bilan
  filtre: "Actives",
  periode: "day",
  source: "",
  coutModifie: false,    // « payé au livreur » modifié à la main ?
  chargement: false,
  statut: "loading"      // loading | ok | offline
};

// ---------- Connexion à la base Livraisons (JSONP, comme le reste de l'app) ----------
function livApi(action, payload) {
  return new Promise((resolve, reject) => {
    const cb = "onLiv_" + action + "_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
    const script = document.createElement("script");
    let fini = false;
    const finir = (fn, val) => {
      if (fini) return;
      fini = true;
      clearTimeout(timer);
      delete window[cb];
      script.remove();
      fn(val);
    };
    const timer = setTimeout(() => finir(reject, new Error("Google Sheets ne répond pas (internet ?)")), 25000);
    window[cb] = (res) => {
      if (res && res.ok) finir(resolve, res.data);
      else if (res && /unknown action/.test(res.error || "")) finir(reject, new Error("Le script Google de la caisse n'a pas encore la partie Livraisons : colle le nouveau Code.gs puis « Nouvelle version »."));
      else finir(reject, new Error((res && res.error) || "Réponse invalide"));
    };
    script.onerror = () => finir(reject, new Error("Google Sheets injoignable. Vérifie internet et que le script de la caisse est déployé en « Nouvelle version »."));
    let url = `${LIV_URL}?action=liv_${encodeURIComponent(action)}&callback=${cb}`;
    if (payload) url += `&payload=${encodeURIComponent(JSON.stringify(payload))}`;
    script.src = url;
    document.body.appendChild(script);
  });
}

function livLireCache() {
  try {
    const c = JSON.parse(localStorage.getItem(LIV_CACHE_KEY) || "null");
    if (c && Array.isArray(c.commandes)) { liv.commandes = c.commandes; liv.livreurs = c.livreurs || []; }
  } catch (e) {}
}
function livEcrireCache() {
  try { localStorage.setItem(LIV_CACHE_KEY, JSON.stringify({ commandes: liv.commandes, livreurs: liv.livreurs })); } catch (e) {}
}

async function livCharger(silencieux) {
  if (liv.chargement) return;
  liv.chargement = true;
  livMajEtat("⏳ Mise à jour…");
  try {
    const d = await livApi("getAll");
    liv.commandes = d.commandes || [];
    liv.livreurs = d.livreurs || [];
    liv.statut = "ok";
    livEcrireCache();
  } catch (e) {
    liv.statut = "offline";
    if (!silencieux) alert("⚠️ " + e.message);
  } finally {
    liv.chargement = false;
    livRendre();
    // adresses de livraison affichées dans l'onglet Clients
    if (!document.getElementById("view-clients")?.classList.contains("hidden")) renderClientsTable();
  }
}

function livMajEtat(txt) {
  const el = document.getElementById("liv-etat");
  if (!el) return;
  if (txt) { el.innerHTML = txt; return; }
  el.innerHTML = liv.statut === "ok" ? `<span class="text-pos">☁️ À jour</span>`
    : liv.statut === "offline" ? `<span class="text-neg">⚠️ Hors ligne : dernières données gardées sur cet appareil</span>` : "⏳";
}

// ---------- Utilitaires ----------
const livJs = (s) => proEscape(JSON.stringify(String(s ?? "")));
const livTel9 = (t) => { const d = String(t || "").replace(/\D/g, ""); return d.length > 9 ? d.slice(-9) : d; };
const livWa = (t) => { const d = String(t || "").replace(/\D/g, ""); return d ? (d.length <= 9 ? "221" + d : d) : ""; };
const livProduits = (c) => { try { return JSON.parse(c["Produits"] || "[]"); } catch (e) { return []; } };
const livMethod = (label) => (LIV_PAIEMENTS.find((p) => p.label === label) || LIV_PAIEMENTS[0]).method;
const livParId = (id) => liv.commandes.find((c) => c["ID"] === id);
// « client » = le client paie le livreur directement (frais hors caisse) ; anciennes commandes = « boutique »
const livPayeur = (c) => (c["Livreur payé par"] === "client" ? "client" : "boutique");
// ce que la boutique encaisse (sans les frais si le client paie le livreur)
const livMontantBoutique = (c) => livPayeur(c) === "client" ? Number(c["Sous-total"]) || 0 : Number(c["Total"]) || 0;

function livNav(vue) {
  liv.vue = vue;
  // « + Nouvelle » pendant une modification : on repart d'un formulaire vide
  if (vue === "form" && document.getElementById("liv-id").value) livViderForm();
  livRendre();
}

// ---------- Affichage général ----------
function renderLivraisonsView() {
  livRendre();
  livCharger(true);
}

function livRendre() {
  livMajEtat();
  livMajBadge();
  const view = document.getElementById("view-livraisons");
  if (!view) return;
  document.querySelectorAll(".liv-sub-btn").forEach((b) => b.classList.toggle("active", b.dataset.vue === liv.vue));
  ["liste", "form", "livreurs", "bilan"].forEach((v) =>
    document.getElementById("liv-" + v)?.classList.toggle("hidden", liv.vue !== v));
  if (liv.vue === "liste") livRendreListe();
  if (liv.vue === "form") livRemplirListesForm();
  if (liv.vue === "livreurs") livRendreLivreurs();
  if (liv.vue === "bilan") livRendreBilan();
}

function livMajBadge() {
  const btn = document.querySelector(`nav button[onclick="showView('livraisons')"]`);
  if (!btn) return;
  const n = liv.commandes.filter((c) => LIV_ACTIFS.includes(c["Statut"])).length;
  btn.innerHTML = "Livraisons 🛵" + (n > 0 ? ` <span class="nav-badge">${n}</span>` : "");
}

// ---------- Liste des commandes ----------
function livRendreListe() {
  const seg = ["Actives", ...LIV_STATUTS, "Toutes"];
  const compte = (s) => liv.commandes.filter((c) =>
    s === "Toutes" || (s === "Actives" ? LIV_ACTIFS.includes(c["Statut"]) : c["Statut"] === s)).length;
  document.getElementById("liv-seg").innerHTML = seg.map((s) =>
    `<button class="secondary-btn small-btn ${s === liv.filtre ? "active" : ""}" onclick="liv.filtre=${livJs(s)};livRendreListe()">${s} (${compte(s)})</button>`).join("");

  const q = (document.getElementById("liv-rech").value || "").trim().toLowerCase();
  const fl = document.getElementById("liv-f-livreur").value;
  const fs = document.getElementById("liv-f-source").value;
  livRemplirSelectLivreurs(document.getElementById("liv-f-livreur"), "Tous les livreurs", true);
  livRemplirSelectSources(document.getElementById("liv-f-source"), "Toutes sources");

  const L = liv.commandes.filter((c) => {
    if (liv.filtre === "Actives" && !LIV_ACTIFS.includes(c["Statut"])) return false;
    if (!["Actives", "Toutes"].includes(liv.filtre) && c["Statut"] !== liv.filtre) return false;
    if (fl === "__aucun" && c["Livreur"]) return false;
    if (fl && fl !== "__aucun" && c["Livreur"] !== fl) return false;
    if (fs && c["Source"] !== fs) return false;
    if (q && ![c["ID"], c["Client"], c["Téléphone"], c["Adresse"], c["Repère"]].join(" ").toLowerCase().includes(q)) return false;
    return true;
  }).sort((a, b) => String(b["Créée le"]).localeCompare(String(a["Créée le"])));

  const box = document.getElementById("liv-liste-cmd");
  if (!L.length) { box.innerHTML = `<div class="task-empty">Aucune commande ici.</div>`; return; }

  box.innerHTML = L.map((c) => {
    const k = LIV_CLS[c["Statut"]] || "attente";
    const livree = c["Statut"] === "Livrée";
    const prods = livProduits(c).map((p) => `${p.qte} × ${proEscape(p.nom)}`).join(", ");
    const wa = livWa(c["Téléphone"]);
    const id = livJs(c["ID"]);
    const statuts = LIV_STATUTS.filter((s) => s !== "Livrée")
      .map((s) => `<option ${s === c["Statut"] ? "selected" : ""}>${s}</option>`).join("");
    const livs = `<option value="">— Livreur —</option>` + liv.livreurs.map((l) =>
      `<option ${l["Nom"] === c["Livreur"] ? "selected" : ""}>${proEscape(l["Nom"])}</option>`).join("");
    const caisse = livree
      ? `<div class="help-text">✅ Comptée en caisse${c["Vente caisse"] ? ` : ${fmt(livMontantBoutique(c))} F` : " (paiement déjà fait en boutique)"}${livPayeur(c) === "boutique" && Number(c["Coût livreur"]) > 0 ? ` • livreur ${fmt(c["Coût livreur"])} F dans Frais` : ""}</div>`
      : "";
    return `
      <div class="liv-card liv-b-${k}">
        <div class="liv-top">
          <div>
            <div class="help-text" style="margin:0">${proEscape(c["ID"])} • créée ${proEscape(c["Créée le"])}${c["Livraison prévue"] ? " • prévue " + proEscape(c["Livraison prévue"]) : ""}</div>
            <div class="liv-nom">${proEscape(c["Client"])}</div>
            <div class="liv-mut">📞 ${proEscape(c["Téléphone"])} • 📍 ${proEscape(c["Adresse"] || "—")}${c["Repère"] ? " (" + proEscape(c["Repère"]) + ")" : ""}</div>
            <div class="liv-mut">🛍️ ${prods}</div>
            ${c["Note"] ? `<div class="liv-mut">📝 ${proEscape(c["Note"])}</div>` : ""}
          </div>
          <div class="liv-prix">${fmt(c["Total"])} FCFA
            <div class="liv-mut">dont livraison ${fmt(c["Frais livraison"])}${livPayeur(c) === "client" && Number(c["Frais livraison"]) > 0 ? " (payée au livreur)" : ""}</div>
            <div style="margin-top:4px">
              <span class="badge liv-st-${k}">${proEscape(c["Statut"])}</span>
              <span class="badge ${c["Payé"] === "Oui" ? "pos" : "neg"}">${c["Payé"] === "Oui" ? "Payé" : "Non payé"}</span>
              ${c["Source"] ? `<span class="badge neutral">${LIV_SOURCE_ICONS[c["Source"]] || ""} ${proEscape(c["Source"])}</span>` : ""}
            </div>
            <div class="liv-mut">${proEscape(c["Paiement"])}${c["Livreur"] ? " • 🛵 " + proEscape(c["Livreur"]) : ""}</div>
          </div>
        </div>
        ${caisse}
        <div class="liv-actions">
          ${!livree && c["Statut"] !== "En route" ? `<button class="secondary-btn small-btn" onclick="livStatut(${id},'En route')">🛵 En route</button>` : ""}
          ${!livree ? `<button class="primary-btn small-btn" onclick="livLivree(${id})">✅ Livrée</button>` : ""}
          ${!livree ? `<select onchange="livStatut(${id},this.value)">${statuts}</select>` : ""}
          ${!livree ? `<select onchange="livChangerLivreur(${id},this.value)">${livs}</select>` : ""}
          <button class="secondary-btn small-btn" onclick="livTicket(${id})">🧾 Ticket</button>
          ${wa ? `<button class="secondary-btn small-btn" onclick="livWhatsappClient(${id})">💬 Client</button>` : ""}
          ${c["Livreur"] ? `<button class="secondary-btn small-btn" onclick="livEnvoyerLivreur(${id})">💬 Livreur</button>` : ""}
          ${!livree ? `<button class="secondary-btn small-btn" onclick="livModifier(${id})">✏️ Modifier</button>` : ""}
          <button class="small-btn del-row" onclick="livSupprimer(${id})">🗑️</button>
        </div>
      </div>`;
  }).join("");
}

function livRemplirSelectLivreurs(sel, premier, avecAucun) {
  if (!sel) return;
  const v = sel.value;
  sel.innerHTML = `<option value="">${premier}</option>` + (avecAucun ? `<option value="__aucun">Sans livreur</option>` : "") +
    liv.livreurs.map((l) => `<option>${proEscape(l["Nom"])}</option>`).join("");
  sel.value = v;
}
function livRemplirSelectSources(sel, premier) {
  if (!sel) return;
  const v = sel.value;
  sel.innerHTML = `<option value="">${premier}</option>` + LIV_SOURCES.map((s) => `<option>${s}</option>`).join("");
  sel.value = v;
}

// ---------- Actions sur une commande ----------
async function livStatut(id, statut) {
  try {
    await livApi("statut", { id, statut });
    await livCharger(true);
  } catch (e) { alert("⚠️ " + e.message); livRendre(); }
}

async function livChangerLivreur(id, livreur) {
  try { await livApi("livreur", { id, livreur }); await livCharger(true); }
  catch (e) { alert("⚠️ " + e.message); }
}

async function livSupprimer(id) {
  const c = livParId(id);
  if (!c) return;
  const extra = c["Statut"] === "Livrée"
    ? "<br><small>⚠️ Déjà livrée : la vente et les frais restent dans la caisse. Supprime-les aussi dans Ventes / Frais si besoin.</small>" : "";
  if (!(await requireDeletePassword(`Supprimer la commande ${proEscape(id)} de ${proEscape(c["Client"])} ?${extra}`, true))) return;
  try { await livApi("supprimer", { id, code: DELETE_PASSWORD }); await livCharger(true); }
  catch (e) { alert("⚠️ " + e.message); }
}

// ✅ LIVRÉE → vente + stock + frais du livreur
async function livLivree(id) {
  const c = livParId(id);
  if (!c) return;
  const method = livMethod(c["Paiement"]);
  const lignes = livProduits(c);
  const clientPaie = livPayeur(c) === "client";
  // si le client paie le livreur : ni frais dans la vente, ni dépense
  const frais = clientPaie ? 0 : Number(c["Frais livraison"]) || 0;
  const cout = clientPaie ? 0 : Number(c["Coût livreur"] === "" || c["Coût livreur"] == null ? frais : c["Coût livreur"]) || 0;

  // vérification du stock (seulement si la vente n'a pas déjà été faite en boutique)
  if (method) {
    for (const l of lignes) {
      const p = products.find((x) => x.id === Number(l.productId)) ||
        products.find((x) => proKey(x.name) === proKey(l.nom));
      if (!p) { if (!confirm(`« ${l.nom} » n'existe plus dans les produits : le stock ne sera pas retiré. Continuer ?`)) return; continue; }
      if (!isServiceProduct(p) && l.qte > (Number(p.stock) || 0)) {
        return alert(`Stock insuffisant pour ${p.name} (reste ${p.stock}, commande ${l.qte}).`);
      }
    }
  }

  const resume = (method
    ? `• Vente de ${fmt(livMontantBoutique(c))} FCFA en ${formatPaymentMethod(method)} ajoutée aux ventes du jour\n• Stock diminué\n`
    : `• Paiement déjà fait en boutique : pas de nouvelle vente\n`) +
    (clientPaie
      ? (Number(c["Frais livraison"]) > 0 ? `• Livraison (${fmt(c["Frais livraison"])} FCFA) payée au livreur par le client : pas dans la caisse` : "• Pas de frais de livraison")
      : (cout > 0 ? `• ${fmt(cout)} FCFA payés au livreur, retirés de la caisse (Frais)` : "• Aucun frais de livreur"));
  if (!confirm(`Commande ${id} livrée à ${c["Client"]} ?\n\n${resume}`)) return;

  try {
    const r = await livApi("statut", { id, statut: "Livrée" });
    if (r && r.deja) { alert("Cette commande était déjà marquée livrée (sur un autre appareil)."); return livCharger(true); }
  } catch (e) { return alert("⚠️ " + e.message); }

  let sale = null, expense = null;

  if (method) {
    // 1) stock
    lignes.forEach((l) => {
      const p = products.find((x) => x.id === Number(l.productId)) || products.find((x) => proKey(x.name) === proKey(l.nom));
      if (p && !isServiceProduct(p)) p.stock = Math.max(0, (Number(p.stock) || 0) - (Number(l.qte) || 0));
    });
    saveProducts(products);
    sendStockToSheet(products);

    // 2) vente
    const items = lignes.map((l) => {
      const p = products.find((x) => x.id === Number(l.productId)) || products.find((x) => proKey(x.name) === proKey(l.nom));
      return { productId: p ? p.id : 0, name: p ? p.name : l.nom, qty: Number(l.qte) || 0, price: Number(l.prix) || 0, lineTotal: (Number(l.prix) || 0) * (Number(l.qte) || 0) };
    });
    if (frais > 0) items.push({ productId: 0, name: "Frais de livraison", qty: 1, price: frais, lineTotal: frais });
    const total = items.reduce((s, i) => s + i.lineTotal, 0);
    sale = {
      id: Date.now(),
      date: new Date().toISOString(),
      baseTotal: total,
      total,
      items,
      paymentMethod: method,
      promoDiscount: 0, manualDiscount: 0, birthdayDiscount: 0, discountAmount: 0,
      discountReason: `Livraison ${id}`,
      clientId: c["ID client"] || "",
      clientName: c["Client"] || "",
      clientPhone: c["Téléphone"] || "",
      wholesale: false
    };
    sales.push(sale);
    saveSales(sales);
    sendSaleToSheet(sale);
    lastTicketSale = sale;
  }

  // 3) frais du livreur, payés avec la caisse
  if (cout > 0) {
    expense = createExpense({
      category: "Transport / livraison",
      motif: `Livraison ${id} – ${c["Client"]}${c["Livreur"] ? " (" + c["Livreur"] + ")" : ""}`,
      amount: cout,
      source: "caisse"
    });
  }

  try {
    await livApi("lier", { id, vente: sale ? sale.id : "", depense: expense ? expense.id : "", paye: true });
  } catch (e) { console.warn("Lien vente/commande non enregistré :", e); }

  renderProductsForSale();
  updateSalesViewForSelectedDate();
  renderExpensesTable();
  renderClientsTable();
  loadDashboardStats?.();
  refreshProIfVisible();
  await livCharger(true);
}

// ✅ Bon de livraison (même modèle que le ticket de caisse)
function livTicket(id) {
  const c = livParId(id);
  if (!c) return;
  const frais = Number(c["Frais livraison"]) || 0;
  const clientPaie = livPayeur(c) === "client";
  const dejaPaye = c["Payé"] === "Oui" || !livMethod(c["Paiement"]);
  const prevue = /^\d{4}-\d{2}-\d{2}$/.test(c["Livraison prévue"] || "") ? fmtDateFr(c["Livraison prévue"]) : c["Livraison prévue"];
  const encaisser = dejaPaye
    ? (clientPaie && frais ? `<div class="encadre">✅ PRODUITS DÉJÀ PAYÉS<br>Livraison à payer au livreur : ${fmt(frais)} F</div>` : `<div class="encadre">✅ DÉJÀ PAYÉ</div>`)
    : `<div class="encadre">À ENCAISSER : ${fmt(c["Total"])} FCFA` +
      (clientPaie && frais ? `<br><span style="font-weight:600">dont livraison ${fmt(frais)} F pour le livreur</span>` : "") + `</div>`;
  openTicketWindow(buildTicketHtml({
    titre: "BON DE LIVRAISON",
    numero: c["ID"],
    date: String(c["Créée le"] || "").replace(" ", "T"),
    infos: [
      ["Client", c["Client"]],
      ["Téléphone", c["Téléphone"]],
      ["Adresse", c["Adresse"]],
      ["Repère", c["Repère"]],
      ["Livraison prévue", prevue],
      ["Livreur", c["Livreur"]],
      ["Statut", c["Statut"]],
      ["Note", c["Note"]]
    ],
    lignes: livProduits(c).map((l) => ({ nom: l.nom, qte: l.qte, prix: l.prix })),
    recap: [
      ["Produits", fmt(c["Sous-total"]) + " F"],
      [clientPaie ? "Livraison (payée au livreur)" : "Livraison", fmt(frais) + " F"]
    ],
    totalLabel: "TOTAL",
    total: c["Total"],
    apresTotal: `<div class="row small"><span>Paiement</span><span>${proEscape(c["Paiement"])}</span></div>` + encaisser,
    bloc: ticketFideliteHtml(c["ID client"]),
    noteBas: `<div class="signature"><div>Signature client</div><div>Livreur</div></div>`
  }));
}

function livMessageClient(c) {
  const p = livProduits(c).map((x) => `- ${x.qte} × ${x.nom}`).join("\n");
  return `Bonjour ${c["Client"]}, c'est BSK 👋\nVotre commande ${c["ID"]} :\n${p}\nTotal : ${fmt(c["Total"])} FCFA (livraison incluse)\nStatut : ${c["Statut"]}\nMerci !`;
}
function livMessageLivreur(c) {
  const p = livProduits(c).map((x) => `- ${x.qte} × ${x.nom}`).join("\n");
  const fraisLiv = Number(c["Frais livraison"]) || 0;
  const produitsPayes = c["Payé"] === "Oui" || !livMethod(c["Paiement"]);
  let enc;
  if (livPayeur(c) === "client" && fraisLiv > 0) {
    enc = produitsPayes
      ? `Produits DÉJÀ PAYÉS. Encaisse seulement ta livraison : ${fmt(fraisLiv)} FCFA (pour toi)`
      : `À ENCAISSER : ${fmt(c["Total"])} FCFA (${c["Paiement"]})\n= produits ${fmt(c["Sous-total"])} à rapporter à la boutique + ta livraison ${fmt(fraisLiv)}`;
  } else {
    enc = produitsPayes ? "DÉJÀ PAYÉ : rien à encaisser" : `À ENCAISSER : ${fmt(c["Total"])} FCFA (${c["Paiement"]})`;
  }
  return `🛵 Livraison ${c["ID"]}\nClient : ${c["Client"]}\nTél : ${c["Téléphone"]}\nAdresse : ${c["Adresse"] || "—"}` +
    (c["Repère"] ? `\nRepère : ${c["Repère"]}` : "") + `\n\n${p}\n\n${enc}` + (c["Note"] ? `\nNote : ${c["Note"]}` : "");
}
function livWhatsappClient(id) {
  const c = livParId(id);
  window.open(`https://wa.me/${livWa(c["Téléphone"])}?text=${encodeURIComponent(livMessageClient(c))}`, "_blank");
}
function livEnvoyerLivreur(id) {
  const c = livParId(id);
  const l = liv.livreurs.find((x) => x["Nom"] === c["Livreur"]);
  const t = livWa(l && l["Téléphone"]);
  window.open(`https://wa.me/${t}?text=${encodeURIComponent(livMessageLivreur(c))}`, "_blank");
}

// ---------- Formulaire ----------
function livRemplirListesForm() {
  const dl = document.getElementById("liv-dl-clients");
  if (dl) dl.innerHTML = (clients || []).map((c) =>
    `<option value="${proEscape(c.name)}">${proEscape(c.phone || "")}</option>`).join("");
  livRemplirSelectLivreurs(document.getElementById("liv-livreur"), "— Aucun —", false);
  // produits à jour (stock / prix reçus de Google Sheets)
  document.querySelectorAll("#liv-lignes .liv-ligne select").forEach((sel) => { sel.innerHTML = livOptionsProduits(sel.value); });
  document.getElementById("liv-sources").innerHTML = LIV_SOURCES.map((s) =>
    `<button type="button" class="secondary-btn small-btn ${s === liv.source ? "active" : ""}" onclick="livChoisirSource(${livJs(s)})">${LIV_SOURCE_ICONS[s]} ${s}</button>`).join("");
  livCalculer();
}

function livChoisirSource(s) { liv.source = s; livRemplirListesForm(); }

function livOptionsProduits(selId) {
  return `<option value="">— Produit —</option>` + (products || []).map((p) =>
    `<option value="${p.id}" ${String(p.id) === String(selId) ? "selected" : ""}>${proEscape(p.name)} (${fmt(getPromoPrice(p.price))} F${isServiceProduct(p) ? "" : ", stock " + p.stock})</option>`).join("");
}

function livAjouterLigne(l = {}) {
  const div = document.createElement("div");
  div.className = "liv-ligne";
  let pid = l.productId;
  if (pid == null && l.nom) { const p = products.find((x) => proKey(x.name) === proKey(l.nom)); pid = p ? p.id : ""; }
  div.innerHTML = `
    <select onchange="livProduitChoisi(this)">${livOptionsProduits(pid)}</select>
    <input type="number" min="1" value="${l.qte || 1}" oninput="livCalculer()" title="Quantité" />
    <input type="number" min="0" value="${l.prix ?? ""}" placeholder="Prix" oninput="livCalculer()" title="Prix unitaire" />
    <button type="button" class="del-btn" onclick="this.parentElement.remove();livCalculer()">✕</button>`;
  document.getElementById("liv-lignes").appendChild(div);
  livCalculer();
}

function livProduitChoisi(sel) {
  const p = products.find((x) => String(x.id) === sel.value);
  const prix = sel.parentElement.querySelectorAll("input")[1];
  if (p) prix.value = getPromoPrice(p.price);
  livCalculer();
}

function livLignes() {
  return [...document.querySelectorAll("#liv-lignes .liv-ligne")].map((d) => {
    const sel = d.querySelector("select");
    const [q, pr] = d.querySelectorAll("input");
    const p = products.find((x) => String(x.id) === sel.value);
    return { productId: p ? p.id : "", nom: p ? p.name : "", qte: Number(q.value) || 0, prix: Number(pr.value) || 0 };
  }).filter((l) => l.nom && l.qte > 0);
}

function livCalculer() {
  const st = livLignes().reduce((s, l) => s + l.qte * l.prix, 0);
  const fraisEl = document.getElementById("liv-frais");
  const coutEl = document.getElementById("liv-cout");
  if (!fraisEl) return;
  if (!liv.coutModifie) coutEl.value = fraisEl.value;
  const fr = Number(fraisEl.value) || 0;
  const clientPaie = document.getElementById("liv-payeur").value === "client";
  document.getElementById("liv-cout-wrap").classList.toggle("hidden", clientPaie);
  document.getElementById("liv-total").innerHTML =
    `Le client paie : produits ${fmt(st)} + livraison ${fmt(fr)} = <strong>${fmt(st + fr)} FCFA</strong>` +
    `<br><span class="help-text">Dans la caisse : ${fmt(clientPaie ? st : st + fr)} FCFA` +
    (clientPaie ? (fr ? ` (la livraison va directement au livreur)` : "") : (Number(coutEl.value) ? ` • ${fmt(coutEl.value)} FCFA payés au livreur (Frais)` : "")) + `</span>`;
}

// Nom choisi dans la liste → on complète le téléphone
function livClientTape() {
  const nom = document.getElementById("liv-client").value.trim().toLowerCase();
  const c = (clients || []).find((x) => (x.name || "").toLowerCase() === nom);
  if (c && c.phone && !document.getElementById("liv-tel").value) {
    document.getElementById("liv-tel").value = c.phone;
    livTelTape();
  }
}

// ✅ On commence par le numéro : client reconnu → nom rempli ; sinon il sera créé à l'enregistrement
function livTelTape() {
  const telEl = document.getElementById("liv-tel");
  const nomEl = document.getElementById("liv-client");
  const info = document.getElementById("liv-client-info");
  const t = livTel9(telEl.value);
  const c = t.length >= 9 ? (clients || []).find((x) => livTel9(x.phone) === t) : null;

  if (c) {
    if (!nomEl.value || liv.nomAuto) { nomEl.value = c.name; liv.nomAuto = true; }
    info.className = "liv-client-info existe";
    const nb = liv.commandes.filter((x) => livTel9(x["Téléphone"]) === t).length;
    info.innerHTML = `✅ Client existant : <strong>${proEscape(c.name)}</strong>` +
      (nb ? ` • ${nb} livraison${nb > 1 ? "s" : ""} déjà faite${nb > 1 ? "s" : ""}` : "") +
      (isClientBirthdaySoon(c) ? " • 🎂 anniversaire dans les 72h" : "");
    livRemplirAdresse();
  } else if (t.length >= 9) {
    if (liv.nomAuto) { nomEl.value = ""; liv.nomAuto = false; }
    info.className = "liv-client-info nouveau";
    info.innerHTML = "🆕 Nouveau client : tape son nom, il sera ajouté à l'onglet Clients en enregistrant la commande.";
    setTimeout(() => nomEl.focus(), 0);
  } else {
    info.className = "liv-client-info hidden";
    info.innerHTML = "";
  }
}
// reprend l'adresse de la dernière livraison de ce client
function livRemplirAdresse() {
  const t = livTel9(document.getElementById("liv-tel").value);
  if (!t) return;
  const der = [...liv.commandes].reverse().find((c) => livTel9(c["Téléphone"]) === t && c["Adresse"]);
  if (der) {
    if (!document.getElementById("liv-adresse").value) document.getElementById("liv-adresse").value = der["Adresse"];
    if (!document.getElementById("liv-repere").value) document.getElementById("liv-repere").value = der["Repère"] || "";
  }
}

function livViderForm() {
  ["liv-id", "liv-client", "liv-tel", "liv-adresse", "liv-repere", "liv-note"].forEach((i) => (document.getElementById(i).value = ""));
  document.getElementById("liv-frais").value = 0;
  document.getElementById("liv-cout").value = 0;
  document.getElementById("liv-payeur").value = "client";
  document.getElementById("liv-client-info").className = "liv-client-info hidden";
  liv.nomAuto = false;
  document.getElementById("liv-date").value = todayLocalStr();
  document.getElementById("liv-paiement").value = LIV_PAIEMENTS[0].label;
  document.getElementById("liv-livreur").value = "";
  document.getElementById("liv-form-titre").textContent = "Nouvelle commande à livrer";
  document.getElementById("liv-lignes").innerHTML = "";
  liv.source = "";
  liv.coutModifie = false;
  livAjouterLigne();
}

function livModifier(id) {
  const c = livParId(id);
  if (!c) return;
  liv.vue = "form";
  livRendre();
  document.getElementById("liv-id").value = id;
  document.getElementById("liv-client").value = c["Client"];
  document.getElementById("liv-tel").value = c["Téléphone"];
  document.getElementById("liv-adresse").value = c["Adresse"];
  document.getElementById("liv-repere").value = c["Repère"];
  document.getElementById("liv-note").value = c["Note"];
  document.getElementById("liv-frais").value = c["Frais livraison"] || 0;
  document.getElementById("liv-cout").value = c["Coût livreur"] === "" ? (c["Frais livraison"] || 0) : c["Coût livreur"];
  liv.coutModifie = String(document.getElementById("liv-cout").value) !== String(document.getElementById("liv-frais").value);
  document.getElementById("liv-payeur").value = livPayeur(c);
  document.getElementById("liv-date").value = c["Livraison prévue"];
  document.getElementById("liv-paiement").value = c["Paiement"];
  document.getElementById("liv-livreur").value = c["Livreur"];
  document.getElementById("liv-form-titre").textContent = "Modifier " + id;
  document.getElementById("liv-lignes").innerHTML = "";
  livProduits(c).forEach(livAjouterLigne);
  if (!document.querySelector("#liv-lignes .liv-ligne")) livAjouterLigne();
  liv.source = c["Source"] || "";
  livRemplirListesForm();
  livTelTape();
}

// Retrouve le client de la caisse (par téléphone, sinon par nom) ou le crée
function livClientCaisse(nom, tel) {
  const t = livTel9(tel);
  let c = (clients || []).find((x) => t && livTel9(x.phone) === t) ||
    (clients || []).find((x) => !t && (x.name || "").toLowerCase() === nom.toLowerCase());
  if (!c) {
    const phone = typeof formatClientPhone === "function" ? formatClientPhone(tel) : tel;
    c = { id: Date.now(), name: nom.replace(/\s+/g, " "), phone, createdAt: new Date().toISOString(), birthdate: "" };
    clients.push(c);
    saveClients(clients);
    sendClientToSheet(c);
    renderClientSelect();
    renderClientsTable();
  }
  return c;
}

async function livEnregistrer() {
  const $ = (i) => document.getElementById(i);
  const nom = $("liv-client").value.trim().replace(/\s+/g, " ");
  const tel = $("liv-tel").value.trim();
  const lignes = livLignes();
  if (!liv.source) return alert("Choisis la source de la commande (Live, Instagram…).");
  if (!nom || !tel) return alert("Nom et téléphone du client obligatoires.");
  if (!lignes.length) return alert("Ajoute au moins un produit.");

  const client = livClientCaisse(nom, tel);
  const commande = {
    id: $("liv-id").value || "",
    client: nom,
    telephone: tel,
    clientId: String(client.id),
    adresse: $("liv-adresse").value.trim(),
    repere: $("liv-repere").value.trim(),
    produits: lignes,
    frais: Number($("liv-frais").value) || 0,
    payeur: $("liv-payeur").value,
    coutLivreur: $("liv-payeur").value === "client" ? 0 : Number($("liv-cout").value) || 0,
    dateLivraison: $("liv-date").value,
    paiement: $("liv-paiement").value,
    paye: !livMethod($("liv-paiement").value),
    livreur: $("liv-livreur").value,
    note: $("liv-note").value.trim(),
    source: liv.source
  };

  const btn = $("liv-btn-save");
  btn.disabled = true;
  btn.textContent = "⏳ Enregistrement…";
  try {
    const r = await livApi("save", { commande });
    const veutTicket = confirm(`✅ Commande ${r.id} enregistrée.\n\nGénérer le bon de livraison (ticket) ?`);
    $("liv-id").value = "";
    livViderForm();
    liv.vue = "liste";
    liv.filtre = "Actives";
    await livCharger(true);
    if (veutTicket) livTicket(r.id);
  } catch (e) {
    alert("⚠️ " + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "💾 Enregistrer la commande";
  }
}

// ---------- Livreurs ----------
async function livAjouterLivreur() {
  const nom = document.getElementById("liv-l-nom").value.trim();
  const tel = document.getElementById("liv-l-tel").value.trim();
  if (!nom) return alert("Nom du livreur obligatoire.");
  try {
    await livApi("ajouterLivreur", { nom, tel });
    document.getElementById("liv-l-nom").value = "";
    document.getElementById("liv-l-tel").value = "";
    await livCharger(true);
  } catch (e) { alert("⚠️ " + e.message); }
}

async function livSupprimerLivreur(nom) {
  if (!(await requireDeletePassword(`Supprimer le livreur « ${nom} » ?`))) return;
  try { await livApi("supprimerLivreur", { nom, code: DELETE_PASSWORD }); await livCharger(true); }
  catch (e) { alert("⚠️ " + e.message); }
}

function livRendreLivreurs() {
  const tbody = document.getElementById("liv-livreurs-body");
  if (!tbody) return;
  const j = todayLocalStr();
  if (!liv.livreurs.length) { tbody.innerHTML = `<tr><td colspan="6">Aucun livreur. Ajoute-en un ci-dessus.</td></tr>`; return; }
  tbody.innerHTML = liv.livreurs.map((l) => {
    const mes = liv.commandes.filter((c) => c["Livreur"] === l["Nom"]);
    const enCours = mes.filter((c) => ["Assignée", "En route"].includes(c["Statut"])).length;
    const auj = mes.filter((c) => c["Statut"] === "Livrée" && String(c["Livrée le"]).startsWith(j));
    const especes = auj.filter((c) => livMethod(c["Paiement"]) === "cash").reduce((s, c) => s + livMontantBoutique(c), 0);
    const paye = auj.filter((c) => livPayeur(c) === "boutique").reduce((s, c) => s + (Number(c["Coût livreur"]) || 0), 0);
    return `<tr>
      <td><strong>${proEscape(l["Nom"])}</strong><br><small>${proEscape(l["Téléphone"])}</small></td>
      <td>${enCours}</td>
      <td>${auj.length}</td>
      <td>${fmt(paye)} FCFA</td>
      <td><strong>${fmt(especes)} FCFA</strong></td>
      <td><button class="small-btn del-row" onclick="livSupprimerLivreur(${livJs(l["Nom"])})">Supprimer</button></td>
    </tr>`;
  }).join("");
}

// ---------- Bilan des livraisons ----------
function livSetPeriode(p) { liv.periode = p; livRendreBilan(); }

function livRendreBilan() {
  document.querySelectorAll(".liv-period-btn").forEach((b) => b.classList.toggle("active", b.dataset.period === liv.periode));
  const { from, to } = getProRange(liv.periode, todayLocalStr());
  const dans = (v) => { const k = String(v || "").slice(0, 10); return k && k >= from && k <= to; };
  const recues = liv.commandes.filter((c) => dans(c["Créée le"]));
  const livrees = liv.commandes.filter((c) => c["Statut"] === "Livrée" && dans(c["Livrée le"]));
  const annulees = recues.filter((c) => ["Annulée", "Retournée"].includes(c["Statut"])).length;
  const somme = (L, k) => L.reduce((s, c) => s + (Number(c[k]) || 0), 0);
  const enCours = liv.commandes.filter((c) => LIV_ACTIFS.includes(c["Statut"]));
  const parBoutique = livrees.filter((c) => livPayeur(c) === "boutique");
  const parClient = livrees.filter((c) => livPayeur(c) === "client");
  const fraisFactures = somme(parBoutique, "Frais livraison");
  const fraisPayes = somme(parBoutique, "Coût livreur");
  const caBoutique = livrees.reduce((s, c) => s + livMontantBoutique(c), 0);

  const card = (label, value, sub = "") =>
    `<div class="card"><div class="label">${label}</div><div class="value">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ""}</div>`;
  document.getElementById("liv-kpis").innerHTML =
    card("Commandes reçues", fmt(recues.length)) +
    card("Livrées", fmt(livrees.length)) +
    card("En cours (maintenant)", fmt(enCours.length)) +
    card("Annulées / retournées", fmt(annulees), recues.length ? `${Math.round((annulees * 100) / recues.length)}%` : "") +
    card("CA livré (dans la caisse)", fmt(caBoutique) + " FCFA") +
    card("Livraisons payées par les clients au livreur", fmt(somme(parClient, "Frais livraison")) + " FCFA", `${parClient.length} commande(s), hors caisse`) +
    card("Frais facturés (boutique paie le livreur)", fmt(fraisFactures) + " FCFA") +
    card("Payé aux livreurs par la caisse", fmt(fraisPayes) + " FCFA",
      fraisFactures - fraisPayes >= 0 ? `<span class="text-pos">+${fmt(fraisFactures - fraisPayes)} gardé</span>` : `<span class="text-neg">−${fmt(fraisPayes - fraisFactures)} à ta charge</span>`) +
    card("Panier moyen", fmt(livrees.length ? somme(livrees, "Sous-total") / livrees.length : 0) + " FCFA");

  const parSource = {};
  recues.forEach((c) => {
    const k = c["Source"] || "Non renseignée";
    parSource[k] = parSource[k] || { n: 0, l: 0, t: 0 };
    parSource[k].n++;
    if (c["Statut"] === "Livrée") { parSource[k].l++; parSource[k].t += livMontantBoutique(c); }
  });
  const lignes = Object.entries(parSource).sort((a, b) => b[1].n - a[1].n);
  document.getElementById("liv-sources-body").innerHTML = lignes.length
    ? lignes.map(([k, v]) => `<tr><td>${LIV_SOURCE_ICONS[k] || ""} ${proEscape(k)}</td><td>${v.n}</td><td>${Math.round((v.n * 100) / recues.length)}%</td><td>${v.l}</td><td>${fmt(v.t)} FCFA</td></tr>`).join("")
    : `<tr><td colspan="5">Aucune commande sur la période.</td></tr>`;

  const zones = {};
  livrees.forEach((c) => {
    const z = String(c["Adresse"] || "—").split(",")[0].trim() || "—";
    zones[z] = zones[z] || { n: 0, t: 0 };
    zones[z].n++; zones[z].t += livMontantBoutique(c);
  });
  const zl = Object.entries(zones).sort((a, b) => b[1].n - a[1].n).slice(0, 10);
  document.getElementById("liv-zones-body").innerHTML = zl.length
    ? zl.map(([z, v]) => `<tr><td>${proEscape(z)}</td><td>${v.n}</td><td>${fmt(v.t)} FCFA</td></tr>`).join("")
    : `<tr><td colspan="3">Pas encore de livraison sur la période.</td></tr>`;
}

// ---------- Démarrage ----------
document.addEventListener("DOMContentLoaded", () => {
  livLireCache();
  livViderForm();
  livMajBadge();
  livCharger(true);
  document.getElementById("liv-frais")?.addEventListener("input", livCalculer);
  document.getElementById("liv-cout")?.addEventListener("input", () => { liv.coutModifie = true; });
  document.getElementById("liv-client")?.addEventListener("change", livClientTape);
  document.getElementById("liv-tel")?.addEventListener("input", livTelTape);
  document.getElementById("liv-client")?.addEventListener("input", () => { liv.nomAuto = false; });
  document.getElementById("liv-payeur")?.addEventListener("change", livCalculer);
  document.getElementById("liv-cout")?.addEventListener("input", livCalculer);
  document.getElementById("liv-rech")?.addEventListener("input", livRendreListe);
  document.getElementById("liv-f-livreur")?.addEventListener("change", livRendreListe);
  document.getElementById("liv-f-source")?.addEventListener("change", livRendreListe);
  // mise à jour toutes les 60 s (plusieurs téléphones / livreurs)
  setInterval(() => livCharger(true), 60000);
});
