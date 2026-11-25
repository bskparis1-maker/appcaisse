// =====================================================================
// ================== IMPRESSION DIRECTE SUR LA POS-80 (ESC/POS) ==================
// =====================================================================
// Le ticket est envoyé directement à l'imprimante par le câble USB, dans sa propre
// langue (ESC/POS), sans passer par la fenêtre d'impression du Chromebook.
//  • 1re fois : « Connecter l'imprimante » puis choisir la POS-80 dans la fenêtre de Chrome
//  • ensuite : reconnexion automatique à chaque ouverture de l'app
//  • tous les tickets de l'app (caisse, livraison, B2B, remboursement) peuvent sortir ici
// Si la POS-80 se présente comme un « port série », utiliser « Connecter (port série) ».

const POS_SETTINGS_KEY = "bsk_pos80";
const pos = {
  device: null,      // WebUSB
  endpoint: null,
  iface: null,
  port: null,        // Web Serial
  writer: null,
  nom: "",
  occupe: false
};

function posReglages() {
  const def = { direct: false, largeur: 48, accents: true, qr: true, coupe: true };
  try { return { ...def, ...JSON.parse(localStorage.getItem(POS_SETTINGS_KEY) || "{}") }; } catch (e) { return def; }
}
function posEnregistrerReglages(r) {
  try { localStorage.setItem(POS_SETTINGS_KEY, JSON.stringify(r)); } catch (e) {}
}
const posConnecte = () => !!(pos.device && pos.endpoint) || !!pos.writer;
const posSupporte = () => !!(navigator.usb || navigator.serial);

// ---------- Connexion USB ----------
async function posOuvrirUsb(device) {
  await device.open();
  if (device.configuration === null) await device.selectConfiguration(1);
  // interface « imprimante » (classe 7) en priorité, sinon la première avec une sortie « bulk »
  const ifaces = device.configuration.interfaces;
  const trouve = (filtre) => {
    for (const itf of ifaces) {
      for (const alt of itf.alternates) {
        if (!filtre(alt)) continue;
        const ep = alt.endpoints.find((e) => e.direction === "out" && e.type === "bulk");
        if (ep) return { itf, alt, ep };
      }
    }
    return null;
  };
  const choix = trouve((a) => a.interfaceClass === 7) || trouve(() => true);
  if (!choix) throw new Error("Aucune sortie d'impression trouvée sur cet appareil USB.");
  await device.claimInterface(choix.itf.interfaceNumber);
  if (choix.itf.alternates.length > 1) {
    try { await device.selectAlternateInterface(choix.itf.interfaceNumber, choix.alt.alternateSetting); } catch (e) {}
  }
  pos.device = device;
  pos.iface = choix.itf.interfaceNumber;
  pos.endpoint = choix.ep.endpointNumber;
  pos.nom = device.productName || device.manufacturerName || "Imprimante USB";
}

async function posConnecterUsb() {
  if (!navigator.usb) return alert("Ce navigateur ne permet pas l'impression directe USB. Utilise Google Chrome.");
  try {
    const device = await navigator.usb.requestDevice({ filters: [] });
    await posOuvrirUsb(device);
    posMajPanneau();
    alert(`✅ Imprimante connectée : ${pos.nom}\n\nClique sur « Imprimer un test » pour vérifier.`);
  } catch (e) {
    if (e && e.name === "NotFoundError") return; // fenêtre fermée sans choisir
    posMajPanneau();
    alert("⚠️ Connexion impossible : " + (e.message || e) +
      "\n\nSi la POS-80 est enregistrée dans Paramètres → Imprimantes du Chromebook, supprime-la, débranche / rebranche le câble et réessaie." +
      "\nSinon essaie « Connecter (port série) ».");
  }
}

// ---------- Connexion port série (certaines POS-80) ----------
async function posConnecterSerie() {
  if (!navigator.serial) return alert("Ce navigateur ne permet pas la connexion « port série ». Utilise Google Chrome.");
  try {
    const port = await navigator.serial.requestPort({});
    await posOuvrirSerie(port);
    posMajPanneau();
    alert("✅ Imprimante connectée (port série).\n\nClique sur « Imprimer un test » pour vérifier.");
  } catch (e) {
    if (e && e.name === "NotFoundError") return;
    posMajPanneau();
    alert("⚠️ Connexion impossible : " + (e.message || e));
  }
}
async function posOuvrirSerie(port) {
  await port.open({ baudRate: 9600 });
  pos.port = port;
  pos.writer = port.writable.getWriter();
  pos.nom = "Imprimante (port série)";
}

async function posDeconnecter() {
  try { if (pos.device) { await pos.device.releaseInterface(pos.iface); await pos.device.close(); } } catch (e) {}
  try { if (pos.writer) { pos.writer.releaseLock(); await pos.port.close(); } } catch (e) {}
  Object.assign(pos, { device: null, endpoint: null, iface: null, port: null, writer: null, nom: "" });
  posMajPanneau();
}

// reconnexion automatique (l'autorisation donnée une fois est gardée par Chrome)
async function posReconnexionAuto() {
  try {
    if (navigator.usb) {
      const devs = await navigator.usb.getDevices();
      if (devs.length) { await posOuvrirUsb(devs[0]); return posMajPanneau(); }
    }
    if (navigator.serial) {
      const ports = await navigator.serial.getPorts();
      if (ports.length) { await posOuvrirSerie(ports[0]); return posMajPanneau(); }
    }
  } catch (e) { console.warn("POS-80 : reconnexion automatique impossible", e); }
  posMajPanneau();
}

async function posEnvoyer(bytes) {
  if (!posConnecte()) throw new Error("Imprimante non connectée.");
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const taille = 4096;
  for (let i = 0; i < data.length; i += taille) {
    const morceau = data.slice(i, i + taille);
    if (pos.device) {
      const r = await pos.device.transferOut(pos.endpoint, morceau);
      if (r.status !== "ok") throw new Error("Envoi refusé par l'imprimante (" + r.status + ")");
    } else {
      await pos.writer.write(morceau);
    }
  }
}

// =====================================================================
// Encodage du texte (page de caractères PC850 : accents français)
// =====================================================================
const POS_PC850 = {
  "Ç": 0x80, "ü": 0x81, "é": 0x82, "â": 0x83, "ä": 0x84, "à": 0x85, "ç": 0x87, "ê": 0x88, "ë": 0x89, "è": 0x8A,
  "ï": 0x8B, "î": 0x8C, "É": 0x90, "ô": 0x93, "ö": 0x94, "û": 0x96, "ù": 0x97, "ÿ": 0x98, "Ü": 0x9A,
  "«": 0xAE, "»": 0xAF, "Â": 0xB6, "À": 0xB7, "Ê": 0xD2, "Ë": 0xD3, "È": 0xD4, "Î": 0xD7, "Ï": 0xD8,
  "Ô": 0xE2, "Û": 0xEA, "Ù": 0xEB, "°": 0xF8
};

// remplace ce que l'imprimante ne sait pas afficher (emojis, espaces spéciaux, tirets longs…)
function posNettoyer(texte) {
  return String(texte ?? "")
    .replace(/[    ]/g, " ")
    .replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"')
    .replace(/[–—−]/g, "-").replace(/•/g, "-").replace(/→/g, "->")
    .replace(/×/g, "x").replace(/≈/g, "~").replace(/…/g, "...")
    .replace(/[œ]/g, "oe").replace(/[Œ]/g, "OE").replace(/€/g, "EUR").replace(/ʳᵉ/g, "re")
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}️‍⃣]/gu, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function posSansAccents(t) {
  return t.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[«»]/g, '"').replace(/°/g, "o");
}

function posEncoder(texte, accents) {
  const t = accents ? texte : posSansAccents(texte);
  const out = [];
  for (const ch of t) {
    const c = ch.charCodeAt(0);
    if (ch === "\n") out.push(0x0A);
    else if (c >= 0x20 && c < 0x7F) out.push(c);
    else if (accents && POS_PC850[ch] !== undefined) out.push(POS_PC850[ch]);
    else {
      const simple = posSansAccents(ch);
      const s = simple.charCodeAt(0);
      out.push(s >= 0x20 && s < 0x7F ? s : 0x3F); // « ? » si vraiment inconnu
    }
  }
  return out;
}

// =====================================================================
// Mise en page du ticket (ESC/POS)
// =====================================================================
class PosTicket {
  constructor(reglages) {
    this.r = reglages;
    this.W = Number(reglages.largeur) || 48;
    this.b = [0x1B, 0x40]; // ESC @ : initialisation
    if (reglages.accents) this.b.push(0x1B, 0x74, 0x02); // ESC t 2 : page PC850
  }
  raw(...octets) { this.b.push(...octets); return this; }
  align(a) { return this.raw(0x1B, 0x61, a === "center" ? 1 : a === "right" ? 2 : 0); }
  gras(on) { return this.raw(0x1B, 0x45, on ? 1 : 0); }
  taille(l, h) { return this.raw(0x1D, 0x21, ((l - 1) << 4) | (h - 1)); }
  texte(t) { this.b.push(...posEncoder(t, this.r.accents)); return this; }
  ligne(t = "") { return this.texte(t).raw(0x0A); }
  avance(n = 1) { return this.raw(0x1B, 0x64, n); }
  sep(c = "-") { return this.align("left").ligne(c.repeat(this.W)); }

  // coupe un texte en lignes de largeur max
  couper(t, largeur = this.W) {
    const res = [];
    String(t).split("\n").forEach((para) => {
      let cur = "";
      para.split(" ").forEach((mot) => {
        while (mot.length > largeur) { if (cur) { res.push(cur); cur = ""; } res.push(mot.slice(0, largeur)); mot = mot.slice(largeur); }
        if (!cur) cur = mot;
        else if ((cur + " " + mot).length <= largeur) cur += " " + mot;
        else { res.push(cur); cur = mot; }
      });
      res.push(cur);
    });
    return res;
  }
  centre(t, opts = {}) {
    const t2 = posNettoyer(t);
    if (!t2) return this;
    this.align("center");
    if (opts.gras) this.gras(true);
    this.couper(t2, opts.largeur || this.W).forEach((l) => this.ligne(l));
    if (opts.gras) this.gras(false);
    return this.align("left");
  }
  // « gauche ............ droite » sur une ligne (ou deux si trop long)
  lr(g, d, largeur = this.W) {
    const retrait = (String(g).match(/^ */) || [""])[0];
    g = retrait + posNettoyer(g); d = posNettoyer(d);
    if (g.length + d.length + 1 <= largeur) return this.ligne(g + " ".repeat(largeur - g.length - d.length) + d);
    this.couper(g, largeur).forEach((l) => this.ligne(l));
    return this.ligne(" ".repeat(Math.max(0, largeur - d.length)) + d.slice(-largeur));
  }
  qr(contenu) {
    const data = posEncoder(contenu, false);
    const n = data.length + 3;
    this.align("center")
      .raw(0x1D, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00)      // modèle 2
      .raw(0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, 0x06)            // taille des points
      .raw(0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, 0x30)            // correction d'erreur L
      .raw(0x1D, 0x28, 0x6B, n & 0xFF, (n >> 8) & 0xFF, 0x31, 0x50, 0x30, ...data) // données
      .raw(0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30);           // impression
    return this.align("left");
  }
  fin() {
    this.avance(4);
    if (this.r.coupe) this.raw(0x1D, 0x56, 0x42, 0x03); // GS V B : avance + coupe partielle
    return new Uint8Array(this.b);
  }
}

// texte d'un morceau de HTML (les <br> deviennent des retours à la ligne)
function posTexteHtml(el) {
  const clone = el.cloneNode(true);
  clone.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  return clone.textContent.replace(/[ \t]*\n[ \t]*/g, "\n").replace(/[ \t]+/g, " ").trim();
}

// convertit les petits blocs HTML des tickets (lignes, encadrés, signatures…) en ESC/POS
function posAjouterHtml(t, html) {
  if (!html) return;
  const box = document.createElement("div");
  box.innerHTML = html;
  box.childNodes.forEach((n) => {
    if (n.nodeType === 3) { if (n.textContent.trim()) t.centre(n.textContent); return; }
    if (n.nodeType !== 1) return;
    const cls = n.classList;
    if (cls.contains("row")) {
      const spans = [...n.children];
      t.lr(spans[0] ? posTexteHtml(spans[0]) : "", spans[1] ? posTexteHtml(spans[1]) : "");
    } else if (cls.contains("encadre")) {
      t.ligne("");
      t.centre("*** " + posTexteHtml(n).replace(/\n/g, " ") + " ***", { gras: true });
    } else if (cls.contains("signature")) {
      const labels = [...n.children].map((c) => posNettoyer(c.textContent));
      const moitie = Math.floor((t.W - 2) / 2);
      t.ligne("").ligne("").ligne("");
      t.ligne("_".repeat(moitie) + "  " + "_".repeat(moitie));
      t.ligne((labels[0] || "").padEnd(moitie) + "  " + (labels[1] || ""));
    } else {
      const txt = posTexteHtml(n);
      if (txt) t.centre(txt, { gras: cls.contains("fort") || cls.contains("merci") });
    }
  });
}

// construit le ticket ESC/POS à partir des mêmes informations que le ticket à l'écran
function posConstruireTicket(o) {
  const r = posReglages();
  const t = new PosTicket(r);
  const W = t.W;
  const d = new Date(o.date || Date.now());
  const dateStr = isNaN(d.getTime()) ? "" : d.toLocaleDateString("fr-FR") + " " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

  // en-tête
  t.align("center").gras(true).taille(2, 2).ligne(BOUTIQUE.nom).taille(1, 1).gras(false);
  t.centre("Parfums - Brumes - Muscs");
  t.centre(BOUTIQUE.site, { gras: true });
  t.centre(BOUTIQUE.adresse);
  t.centre("Tel : " + BOUTIQUE.telephone);
  t.sep();
  if (o.titre) t.centre(o.titre, { gras: true });
  t.lr("N° " + (o.numero || "-"), dateStr);

  // informations (client, adresse, livreur, établissement…)
  const infos = (o.infos || []).filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== "");
  if (infos.length) {
    t.sep();
    infos.forEach(([l, v]) => {
      const g = posNettoyer(l), dv = posNettoyer(v);
      if (g.length + dv.length + 2 <= W) t.lr(g, dv);
      else { t.ligne(g + " :"); t.couper(dv, W - 2).forEach((x) => t.ligne("  " + x)); }
    });
  }

  // produits
  t.sep();
  let nb = 0;
  (o.lignes || []).forEach((l) => {
    const q = Number(l.qte) || 0, pu = Number(l.prix) || 0;
    nb += q;
    t.gras(true);
    t.couper(posNettoyer(l.nom || "Produit")).forEach((x) => t.ligne(x));
    t.gras(false);
    t.lr(`  ${q} x ${fmt(pu)}`, `${fmt(pu * q)} F`);
  });
  t.sep();
  t.ligne(`${nb} article${nb > 1 ? "s" : ""}`);
  (o.recap || []).forEach(([l, v]) => {
    const box = document.createElement("div"); box.innerHTML = String(v);
    t.lr(l, box.textContent);
  });

  // total
  t.gras(true).taille(1, 2);
  t.lr(o.totalLabel || "TOTAL", `${fmt(o.total)} FCFA`);
  t.taille(1, 1).gras(false);
  posAjouterHtml(t, o.apresTotal);

  if (o.bloc) { t.sep(); posAjouterHtml(t, o.bloc); }
  posAjouterHtml(t, o.noteBas);

  // pied
  t.sep();
  if (o.pied) posAjouterHtml(t, o.pied); else t.centre("Merci pour votre achat !", { gras: true });
  t.ligne("");
  t.centre("Pour tout échange ou remboursement, le ticket de caisse est obligatoire et le produit ne doit pas avoir été utilisé.", { gras: true });
  t.ligne("");
  t.centre("Commandez en ligne sur " + BOUTIQUE.site);
  t.centre("Livraison partout à Dakar");
  t.centre("Ouvert de " + BOUTIQUE.horaires);
  if (r.qr) {
    t.ligne("");
    t.qr("https://" + BOUTIQUE.site);
    t.centre("Scannez : notre site");
  }
  return t.fin();
}

// =====================================================================
// Impression
// =====================================================================
async function posImprimer(o) {
  if (!o) return alert("Aucun ticket à imprimer.");
  if (!posConnecte()) {
    alert("L'imprimante POS-80 n'est pas connectée.\n\nCaisse → « 🖨️ Imprimante de tickets » → « Connecter l'imprimante ».");
    return false;
  }
  if (pos.occupe) return false;
  pos.occupe = true;
  try {
    await posEnvoyer(posConstruireTicket(o));
    return true;
  } catch (e) {
    alert("⚠️ Impression impossible : " + (e.message || e) + "\n\nVérifie que la POS-80 est allumée, branchée et qu'il y a du papier, puis reconnecte-la.");
    if (pos.device && !pos.device.opened) await posDeconnecter();
    return false;
  } finally {
    pos.occupe = false;
  }
}

// appelé depuis le bouton « Imprimer sur POS-80 » de la fenêtre du ticket
function posImprimerDernier() { return posImprimer(window.__posDernierTicket); }

// ticket de test : accents, largeur, QR code, coupe
async function posTest() {
  if (!posConnecte()) return alert("Connecte d'abord l'imprimante.");
  const r = posReglages();
  const t = new PosTicket(r);
  t.align("center").gras(true).taille(2, 2).ligne("BSK").taille(1, 1).gras(false);
  t.centre("TEST D'IMPRESSION", { gras: true });
  t.sep();
  t.ligne("Accents : é è ê à â ç ù ô î ë");
  t.ligne("Si les accents sont faux, décoche « Accents ».");
  t.sep();
  t.ligne("Règle de largeur (" + t.W + " caractères) :");
  t.ligne("1234567890".repeat(Math.ceil(t.W / 10)).slice(0, t.W));
  t.ligne("La ligne de chiffres doit tenir sur UNE ligne.");
  t.sep();
  t.lr("Bar à Musc", "8 000 F");
  t.gras(true).taille(1, 2).lr("TOTAL", "8 000 FCFA").taille(1, 1).gras(false);
  if (r.qr) { t.ligne(""); t.qr("https://" + BOUTIQUE.site); t.centre("QR code : " + BOUTIQUE.site); }
  try {
    await posEnvoyer(t.fin());
  } catch (e) {
    alert("⚠️ Test impossible : " + (e.message || e));
  }
}

// =====================================================================
// Panneau de réglage (onglet Caisse)
// =====================================================================
function posMajPanneau() {
  const etat = document.getElementById("pos-etat");
  if (!etat) return;
  const r = posReglages();
  if (!posSupporte()) {
    etat.innerHTML = `<span class="text-neg">⚠️ Ce navigateur ne permet pas l'impression directe. Utilise Google Chrome.</span>`;
  } else if (posConnecte()) {
    etat.innerHTML = `<span class="text-pos">✅ Connectée : ${proEscape(pos.nom)}</span>`;
  } else {
    etat.innerHTML = `<span class="text-neg">Non connectée</span>`;
  }
  const set = (id, prop, val) => { const el = document.getElementById(id); if (el) el[prop] = val; };
  set("pos-direct", "checked", !!r.direct);
  set("pos-accents", "checked", !!r.accents);
  set("pos-qr", "checked", !!r.qr);
  set("pos-coupe", "checked", !!r.coupe);
  set("pos-largeur", "value", String(r.largeur));
  document.querySelectorAll(".pos-si-connecte").forEach((b) => b.classList.toggle("hidden", !posConnecte()));
  document.querySelectorAll(".pos-si-deconnecte").forEach((b) => b.classList.toggle("hidden", posConnecte()));
}

function posChangerReglage(cle, valeur) {
  const r = posReglages();
  r[cle] = cle === "largeur" ? Number(valeur) : valeur;
  posEnregistrerReglages(r);
  posMajPanneau();
}

document.addEventListener("DOMContentLoaded", () => {
  posMajPanneau();
  posReconnexionAuto();
  if (navigator.usb) {
    navigator.usb.addEventListener("disconnect", (e) => { if (pos.device && e.device === pos.device) { Object.assign(pos, { device: null, endpoint: null }); posMajPanneau(); } });
    navigator.usb.addEventListener("connect", () => { if (!posConnecte()) posReconnexionAuto(); });
  }
});
