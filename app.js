/* ===== BASE DE DONNÉES (IndexedDB) =====
   Remplace localStorage : plus de limite de 5 Mo, écriture non bloquante,
   migration automatique des anciennes données. */
const DB = (() => {
  let db;
  return {
    open: () =>
      new Promise((res, rej) => {
        if (!window.indexedDB) return rej(new Error("IndexedDB indisponible"));
        const r = indexedDB.open("stockmaster", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("kv");
        r.onsuccess = () => ((db = r.result), res());
        r.onerror = () => rej(r.error);
      }),
    get: (k) =>
      new Promise((res, rej) => {
        const q = db.transaction("kv", "readonly").objectStore("kv").get(k);
        q.onsuccess = () => res(q.result);
        q.onerror = () => rej(q.error);
      }),
    set: (k, v) =>
      new Promise((res, rej) => {
        const t = db.transaction("kv", "readwrite");
        t.objectStore("kv").put(v, k);
        t.oncomplete = () => res();
        t.onerror = () => rej(t.error);
        t.onabort = () => rej(t.error);
      }),
  };
})();

const $ = (s) => document.querySelector(s),
  fmt = (n) => Math.round(n).toLocaleString("fr-FR") + " F";
const uid = () => Math.random().toString(36).slice(2, 9),
  now = () => new Date().toISOString();
const day = (d) => d.slice(0, 10);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
let S;
function seed() {
  const shop = (id, name) => ({
    id,
    name,
    addr: "",
    tel: "",
    ninea: "",
    logo: "",
  });
  const prod = (id, name, code, buy, sell, min, b1, b2) => ({
    id,
    name,
    code,
    buy,
    sell,
    min,
    stock: { b1, b2 },
  });
  return {
    shops: [shop("b1", "Boutique Centre"), shop("b2", "Boutique Marché")],
    products: [
      prod("p1", "Riz 25kg", "1001", 11000, 13000, 5, 20, 8),
      prod("p2", "Huile 5L", "1002", 5200, 6500, 6, 12, 4),
      prod("p3", "Sucre 1kg", "1003", 600, 800, 20, 60, 30),
      prod("p4", "Savon", "1004", 250, 400, 15, 10, 40),
      prod("p5", "Lait en poudre", "1005", 1800, 2300, 10, 25, 15),
    ],
    clients: [
      {
        id: "c1",
        name: "Fatou Diop",
        tel: "77 000 00 00",
        adr: "",
        limit: 50000,
        debt: 0,
      },
    ],
    suppliers: [
      { id: "f1", name: "Grossiste Dakar", tel: "33 800 00 00", debt: 0 },
    ],
    sales: [],
    pays: [],
    orders: [],
    transfers: [],
    moves: [],
    session: null,
    sessions: [],
    invoices: [],
    invN: 0,
    cfg: { bulk: 50000, bulkQ: 10 },
  };
}
async function load() {
  try {
    await DB.open();
    S = await DB.get("state");
  } catch (e) {
    console.error(e);
    alert(
      "La base de données n'est pas disponible (navigation privée ?). Les données ne seront pas conservées.",
    );
  }
  if (!S) {
    // Migration des anciennes données enregistrées dans localStorage
    try {
      S = JSON.parse(localStorage.getItem("smp"));
    } catch (e) {}
  }
  if (!S) S = seed();
  // Demande au navigateur de ne pas effacer la base automatiquement
  try {
    if (navigator.storage && navigator.storage.persist)
      navigator.storage.persist();
  } catch (e) {}
  // Compatibilité avec les anciennes données déjà enregistrées
  S.invoices = S.invoices || [];
  S.invN = S.invN || 0;
  S.cfg = S.cfg || { bulk: 50000, bulkQ: 10 };
  // CORRECTION : retire les transferts et commandes dont le produit a été supprimé
  const ids = new Set(S.products.map((p) => p.id));
  S.transfers = (S.transfers || []).filter((t) => ids.has(t.pid));
  S.bcN = S.bcN || 0;
  S.supPays = S.supPays || [];
  S.held = S.held || [];
  S.log = S.log || [];
  S.cfg.maxRem = S.cfg.maxRem ?? 10;
  S.orders = (S.orders || [])
    .map((o) => {
      if (!o.lines) {
        const p = S.products.find((x) => x.id === o.pid);
        o = {
          ...o,
          lines: o.pid
            ? [
                {
                  pid: o.pid,
                  q: o.q,
                  price: p ? p.buy : 0,
                  recv: o.status === "Reçu" ? o.q : 0,
                },
              ]
            : [],
        };
      }
      o.date = o.date || now();
      o.lines = o.lines.filter((l) => ids.has(l.pid));
      return o;
    })
    .filter((o) => o.lines.length);
  await DB.set("state", S).catch(() => {});
}
function save() {
  DB.set("state", S).catch((e) => {
    console.error(e);
    alert("Erreur : impossible d'enregistrer dans la base de données.");
  });
}
let tab = "dash",
  shop,
  role = "admin",
  cart = [];
const TABS = [
  ["dash", "Tableau de bord", "admin,stock"],
  ["pos", "Caisse", "admin,cash"],
  ["inv", "Factures", "admin,cash"],
  ["sales", "Ventes", "admin,cash"],
  ["stock", "Stock", "admin,stock,cash"],
  ["clients", "Clients & crédits", "admin,cash"],
  ["sup", "Fournisseurs", "admin,stock"],
  ["multi", "Boutiques", "admin,stock"],
  ["rep", "Rapports", "admin"],
  ["moves", "Mouvements", "admin,stock"],
];
const can = (r) => r.split(",").includes(role);
const P = (id) => S.products.find((p) => p.id === id),
  C = (id) => S.clients.find((c) => c.id === id);
const qty = (p, s = shop) => p.stock[s] || 0;
const curShop = () => S.shops.find((s) => s.id === shop);
function move(type, pid, q, s, note) {
  const p = P(pid);
  if (!p) return; // CORRECTION : produit supprimé, rien à déplacer
  p.stock[s] = qty(p, s) + q;
  S.moves.unshift({ date: now(), type, pid, q, shop: s, note: note || "" });
}
function nav() {
  const t = TABS.filter((x) => can(x[2]));
  if (!t.find((x) => x[0] === tab)) tab = t[0][0];
  $("#nav").innerHTML = t
    .map(
      (x) =>
        `<button class="${x[0] === tab ? "on" : ""}" onclick="go('${x[0]}')">${x[1]}</button>`,
    )
    .join("");
}
function go(t) {
  tab = t;
  render();
}
function render() {
  nav();
  const cfg = $("#shopcfg");
  if (cfg) cfg.style.display = can("admin") ? "" : "none";
  const dbt = $("#databtn");
  if (dbt) dbt.style.display = can("admin") ? "" : "none";
  try {
    $("#view").innerHTML = backupBanner() + V[tab]();
  } catch (e) {
    // CORRECTION : une erreur dans une page n'efface plus l'écran et est expliquée
    console.error(e);
    $("#view").innerHTML =
      `<div class="card" style="margin-top:14px"><h3>Cette page n'a pas pu s'afficher</h3><p>${esc(e.message)}</p></div>`;
    return;
  }
  save();
}
function init() {
  $("#shop").innerHTML = S.shops
    .map((s) => `<option value="${s.id}">${esc(s.name)}</option>`)
    .join("");
  $("#shop").value = shop;
  $("#shop").onchange = (e) => {
    shop = e.target.value;
    cart = [];
    render();
  };
  $("#role").disabled = true; // le rôle ne change plus que par connexion avec un code
  const row = document.querySelector("header .row");
  if (row && !$("#lockbtn"))
    row.insertAdjacentHTML(
      "beforeend",
      '<button id="databtn" class="sec" onclick="dataModal()">💾 Données</button><button id="lockbtn" class="sec" onclick="lockScreen()">🔒 Verrouiller</button>',
    );
}
/* Modal formulaire générique */
function form(title, fields, cb) {
  $("#mbox").className = "box";
  $("#mbox").innerHTML =
    `<h3 style="margin-top:0">${title}</h3>` +
    fields
      .map(
        (f) =>
          `<label>${f.l}</label>` +
          (f.o
            ? `<select id="f_${f.k}">${f.o.map((o) => `<option value="${o[0]}">${o[1]}</option>`).join("")}</select>`
            : `<input id="f_${f.k}" type="${f.t || "text"}" value="${esc(f.v ?? "")}">`),
      )
      .join("") +
    `<div class="row" style="margin-top:14px"><button id="fok">Valider</button><button class="sec" onclick="closeM()">Annuler</button></div>`;
  $("#modal").style.display = "flex";
  $("#fok").onclick = () => {
    const v = {};
    fields.forEach((f) => {
      const x = $("#f_" + f.k).value;
      v[f.k] = f.t === "number" ? +x : x;
    });
    closeM();
    cb(v);
  };
}
function closeM() {
  $("#modal").style.display = "none";
}
function info(html, wide) {
  $("#mbox").className = wide ? "box wide" : "box";
  $("#mbox").innerHTML =
    html +
    `<div class="row" style="margin-top:12px"><button class="sec" onclick="closeM()">Fermer</button></div>`;
  $("#modal").style.display = "flex";
}
function table(h, rows) {
  return `<div class="tw"><table><tr>${h.map((x) => `<th>${x}</th>`).join("")}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${h.length}">Aucune donnée</td></tr>`}</table></div>`;
}
/* Ticket */
function ticket(title, lines, total, extra) {
  const sh = curShop().name;
  const t = `${sh}\n${title}\n${new Date().toLocaleString("fr-FR")}\n--------------------------\n${lines.join("\n")}\n--------------------------\nTOTAL : ${fmt(total)}\n${extra || ""}\nMerci de votre visite !`;
  info(
    `<div class="ticket">${esc(t)}</div><div class="row" style="margin-top:10px"><button onclick="window.print()">🖨️ Imprimer</button></div>`,
  );
}
/* FACTURE (clients en grosse quantité) */
function nextInvNo() {
  S.invN++;
  return (
    "FA-" + new Date().getFullYear() + "-" + String(S.invN).padStart(4, "0")
  );
}
/* Montant en lettres (français) */
function nbLettres(n) {
  n = Math.round(n);
  if (n === 0) return "Zéro franc CFA";
  const u = [
    "",
    "un",
    "deux",
    "trois",
    "quatre",
    "cinq",
    "six",
    "sept",
    "huit",
    "neuf",
    "dix",
    "onze",
    "douze",
    "treize",
    "quatorze",
    "quinze",
    "seize",
    "dix-sept",
    "dix-huit",
    "dix-neuf",
  ];
  const t = ["", "", "vingt", "trente", "quarante", "cinquante", "soixante"];
  const b100 = (n) => {
    if (n < 20) return u[n];
    if (n < 70) {
      const d = Math.floor(n / 10),
        r = n % 10;
      return t[d] + (r === 1 ? " et un" : r ? "-" + u[r] : "");
    }
    if (n < 80) {
      const r = n - 60;
      return "soixante" + (r === 11 ? " et onze" : "-" + u[r]);
    }
    const r = n - 80;
    return r === 0 ? "quatre-vingts" : "quatre-vingt-" + u[r];
  };
  const b1000 = (n) => {
    const c = Math.floor(n / 100),
      r = n % 100;
    let s = "";
    if (c)
      s = (c > 1 ? u[c] + " " : "") + "cent" + (c > 1 && r === 0 ? "s" : "");
    if (r) s += (s ? " " : "") + b100(r);
    return s;
  };
  const m = Math.floor(n / 1e6),
    k = Math.floor((n % 1e6) / 1000),
    r = n % 1000;
  let s = "";
  if (m) s += m === 1 ? "un million" : b1000(m) + " millions";
  if (k)
    s +=
      (s ? " " : "") +
      (k === 1 ? "mille" : b1000(k).replace(/(vingt|cent)s$/, "$1") + " mille");
  if (r) s += (s ? " " : "") + b1000(r);
  s += n >= 1e6 && n % 1e6 === 0 ? " de francs CFA" : " francs CFA";
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function invoiceHTML(v) {
  const sh = S.shops.find((s) => s.id === v.shop) || { name: "" };
  const logo = sh.logo
    ? `<img class="logo" src="${sh.logo}" alt="Logo">`
    : `<div class="logo ph">${esc((sh.name || "?").slice(0, 1).toUpperCase())}</div>`;
  const rows = v.lines.map((l) => [
    l.q,
    esc(l.name),
    fmt(l.price),
    fmt(l.q * l.price),
  ]);
  if (v.rem) rows.push(["", "Remise", "", "− " + fmt(v.rem)]);
  while (rows.length < 10) rows.push(["", "", "", ""]);
  const body = rows
    .map(
      (r) =>
        `<tr><td class="c">${r[0]}</td><td>${r[1]}</td><td class="r">${r[2]}</td><td class="r">${r[3]}</td></tr>`,
    )
    .join("");
  const paid = v.paid ?? (v.pay === "Crédit" ? 0 : v.total),
    rendu = v.rendu || 0,
    reste = v.reste ?? Math.max(v.total - paid, 0);
  return `<div class="invoice">
  <div class="iv-top">
    <div class="iv-brand">${logo}<div><div class="iv-name">${esc(sh.name)}</div>${sh.ninea ? `<small>NINEA : ${esc(sh.ninea)}</small>` : ""}</div></div>
    <div class="iv-contact">
      ${sh.tel ? `<div><span class="ic">✆</span>${esc(sh.tel)}</div>` : ""}
      ${sh.email ? `<div><span class="ic">✉</span>${esc(sh.email)}</div>` : ""}
      ${sh.addr ? `<div><span class="ic">⌂</span>${esc(sh.addr)}</div>` : ""}
    </div>
  </div>
  <div class="iv-band">FACTURE${v.void ? " — ANNULÉE" : ""}</div>
  <div class="iv-body">
    <div class="iv-box">
      <div class="iv-r3"><div>FACTURE N° : <b>${esc(v.no)}</b></div><div>TÉL : <b>${esc(v.client.tel)}</b></div><div>DATE : <b>${new Date(v.date).toLocaleDateString("fr-FR")}</b></div></div>
      <div class="iv-r">NOM : <b>${esc(v.client.name)}</b></div>
      <div class="iv-r">ADRESSE : <b>${esc(v.client.adr)}</b></div>
      <div class="iv-r">MODE DE PAIEMENT : <b>${esc(v.pay === "Crédit" ? "À crédit" : v.pay)}</b></div>
    </div>
    <table class="iv-t"><colgroup><col style="width:12%"><col style="width:50%"><col style="width:18%"><col style="width:20%"></colgroup>
      <tr><th>QTÉ</th><th>DÉSIGNATION</th><th>PRIX</th><th>MONTANT</th></tr>${body}</table>
    <div class="iv-sum">
      <div class="t"><span>TOTAL</span><b>${fmt(v.total)}</b></div>
      <div><span>MONTANT VERSÉ</span><b>${fmt(paid)}</b></div>
      ${rendu ? `<div><span>MONNAIE RENDUE</span><b>${fmt(rendu)}</b></div>` : ""}
      <div class="rs ${reste ? "due" : ""}"><span>${reste ? "RESTE À PAYER" : "RESTE À PAYER (soldé)"}</span><b>${fmt(reste)}</b></div>
    </div>
    <div class="iv-words">Montant en lettres : <span>${nbLettres(v.total)}</span></div>
    <div class="iv-sign"><div>Signature du client</div><div>Signature autorisée</div></div>
  </div>
  <div class="iv-foot"></div>
</div>`;
}
function showInvoice(v) {
  info(
    invoiceHTML(v) +
      `<div class="row" style="margin-top:10px"><button onclick="window.print()">🖨️ Imprimer / PDF</button></div>`,
    true,
  );
}
function viewInv(id) {
  const v = S.invoices.find((x) => x.id === id);
  if (v) showInvoice(v);
}
const V = {};
/* DASHBOARD */
V.dash = () => {
  const t = day(now()),
    sd = SA().filter((s) => day(s.date) === t),
    ca = sd.reduce((a, s) => a + s.total, 0);
  const low = S.products.filter((p) => qty(p) <= p.min),
    debt = S.clients.reduce((a, c) => a + c.debt, 0);
  const val = S.products.reduce((a, p) => a + qty(p) * p.buy, 0);
  return `<div class="grid" style="margin:14px 0"><div class="card kpi"><span>Ventes du jour</span><b>${fmt(ca)}</b></div>
 <div class="card kpi"><span>Tickets</span><b>${sd.length}</b></div>
 <div class="card kpi"><span>Valeur du stock</span><b>${fmt(val)}</b></div>
 <div class="card kpi"><span>Créances clients</span><b>${fmt(debt)}</b></div></div>
 <div class="card"><h3>⚠️ Alertes de stock bas (${esc(curShop().name)})</h3>${table(
   ["Produit", "Stock", "Seuil"],
   low.map((p) => [p.name, `<span class="low">${qty(p)}</span>`, p.min]),
 )}</div>`;
};
/* CAISSE */
const PAYS = [
  "Espèces",
  "Carte bancaire",
  "Wave",
  "Orange Money",
  "Chèque",
  "Crédit",
];
V.pos = () => {
  const q = (window._q || "").toLowerCase();
  const list = S.products.filter((p) =>
    (p.name + p.code + (p.cat || "")).toLowerCase().includes(q),
  );
  const sub = cart.reduce((a, l) => a + l.q * P(l.pid).sell, 0);
  const open = S.session && S.session.shop === shop;
  if (!open)
    return `<div class="card" style="margin-top:14px"><h3>Caisse fermée</h3><p>Ouvrez la caisse pour commencer à vendre.</p><button onclick="openCash()">Ouvrir la caisse</button></div>`;
  return `<div class="pos" style="margin-top:14px"><div class="card"><div class="row"><input id="q" placeholder="Rechercher ou scanner un code-barres…" value="${esc(window._q || "")}" style="flex:1" oninput="window._q=this.value;render();const q=$('#q');q.focus();q.setSelectionRange(q.value.length,q.value.length)" onkeydown="if(event.key==='Enter')scan(this.value)">${cart.length ? '<button class="sec" onclick="hold()">⏸ Attente</button>' : ""}${S.held.some((h) => h.shop === shop) ? '<button class="sec" onclick="showHeld()">▶ Reprendre (' + S.held.filter((h) => h.shop === shop).length + ")</button>" : ""}<button class="sec" onclick="closeCash()">Clôturer</button></div>
 <div class="prods">${list.map((p) => `<button onclick="add('${p.id}')">${esc(p.name)}<small>${fmt(p.sell)} · stock ${qty(p)}</small></button>`).join("")}</div></div>
 <div class="card"><h3>Panier</h3>${table(
   ["Article", "Qté", "Total", ""],
   cart.map((l, i) => [
     esc(P(l.pid).name),
     `<button class="sec" onclick="chg(${i},-1)">−</button> ${l.q} <button class="sec" onclick="chg(${i},1)">+</button>`,
     fmt(l.q * P(l.pid).sell),
     `<button class="ko" onclick="cart.splice(${i},1);render()">✕</button>`,
   ]),
 )}
 <h2>${fmt(sub)}</h2>
 <div class="row"><select id="pay" onchange="window._pay=this.value">${PAYS.map((o) => `<option value="${o}" ${window._pay === o ? "selected" : ""}>${o === "Crédit" ? "Crédit client" : o}</option>`).join("")}</select></div>
 <div class="row"><select id="cl" style="flex:1" onchange="window._cl=this.value">${clOpts()}</select>
 <button class="sec" onclick="quickCl()">+ Nouveau client</button></div>
 <div class="row"><input id="rem" type="number" min="0" placeholder="Remise (F)" style="flex:1" oninput="calcRest()"><label class="chk"><input id="inv" type="checkbox"> Facture</label></div>
 <small class="hint">Facture automatique dès ${fmt(S.cfg.bulk)} ou ${S.cfg.bulkQ} articles d'un même produit.</small>
 <div class="row" style="margin-top:8px"><input id="recu" type="number" min="0" placeholder="Montant versé par le client" style="flex:1" oninput="calcRest()"><button class="ok" onclick="sell()">Encaisser</button></div>
 <div id="calc" class="calc">Total à payer : <b>${fmt(sub)}</b></div></div></div>`;
};
function add(id) {
  const p = P(id),
    l = cart.find((x) => x.pid === id);
  if ((l ? l.q : 0) + 1 > qty(p)) return alert("Stock insuffisant");
  l ? l.q++ : cart.push({ pid: id, q: 1 });
  render();
}
function chg(i, d) {
  const l = cart[i];
  if (d > 0 && l.q + 1 > qty(P(l.pid))) return alert("Stock insuffisant");
  l.q += d;
  if (l.q <= 0) cart.splice(i, 1);
  render();
}
function scan(v) {
  const p = S.products.find((p) => p.code === v.trim());
  if (p) {
    window._q = "";
    add(p.id);
  }
}
function quickCl() {
  newCl((id) => {
    window._cl = id;
  });
}
function cartTot() {
  const sub = cart.reduce((a, l) => a + l.q * P(l.pid).sell, 0),
    rem = Math.min(Math.max(+($("#rem") || {}).value || 0, 0), sub);
  return { sub, rem, tot: sub - rem };
}
/* Affiche en direct le reste à payer / la monnaie à rendre */
function calcRest() {
  const { tot } = cartTot(),
    raw = $("#recu").value,
    box = $("#calc");
  if (!box) return;
  if (raw === "") return (box.innerHTML = `Total à payer : <b>${fmt(tot)}</b>`);
  const g = Math.max(+raw, 0);
  box.innerHTML =
    g >= tot
      ? `Total : <b>${fmt(tot)}</b> · Monnaie à rendre : <b>${fmt(g - tot)}</b>`
      : `Total : <b>${fmt(tot)}</b> · Reste à payer : <b class="low">${fmt(tot - g)}</b>`;
}
function sell() {
  if (!cart.length) return;
  const pay = $("#pay").value,
    cid = $("#cl").value,
    c = cid ? C(cid) : null,
    { sub, rem, tot } = cartTot();
  if (tot <= 0 && sub > 0) {
    if (!can("admin"))
      return alert(
        "Vente à 0 F interdite : seul l'administrateur peut la valider.",
      );
    if (!confirm("Cette vente sera à 0 F (remise de 100 %). Confirmer ?"))
      return;
  }
  const maxR = S.cfg.maxRem ?? 10;
  if (!can("admin") && rem > (sub * maxR) / 100)
    return alert(
      "Remise trop élevée : le caissier est limité à " +
        maxR +
        " % (" +
        fmt((sub * maxR) / 100) +
        ").",
    );
  // Montant versé par le client (vide = tout payé, sauf en « Crédit » où rien n'est versé)
  const raw = $("#recu").value,
    given = raw !== "" ? Math.max(+raw, 0) : pay === "Crédit" ? 0 : tot,
    paid = Math.min(given, tot),
    reste = tot - paid,
    rendu = Math.max(given - tot, 0);
  const bulk = tot >= S.cfg.bulk || cart.some((l) => l.q >= S.cfg.bulkQ),
    wantInv = $("#inv").checked || bulk;
  if (wantInv && !c)
    return alert(
      "Une facture nécessite un client : choisissez-en un ou cliquez sur « + Nouveau client ».",
    );
  if (reste > 0) {
    if (!c)
      return alert(
        "Montant insuffisant : choisissez un client pour enregistrer le reste en dette.",
      );
    const lim = role === "cash" ? Math.min(c.limit, 25000) : c.limit;
    if (c.debt + reste > lim)
      return alert("Plafond de crédit dépassé (" + fmt(lim) + ")");
    c.debt += reste;
  }
  let extra = "Paiement : " + pay + "\nMontant versé : " + fmt(given);
  if (rendu) extra += "\nMonnaie rendue : " + fmt(rendu);
  if (reste) extra += "\nReste à payer : " + fmt(reste);
  const sale = {
    id: uid(),
    date: now(),
    shop,
    items: cart.map((l) => ({
      pid: l.pid,
      q: l.q,
      price: P(l.pid).sell,
      buy: P(l.pid).buy,
    })),
    sub,
    remise: rem,
    total: tot,
    paid,
    reste,
    pay,
    client: cid,
  };
  S.sales.push(sale);
  if (rem > 0)
    logA(
      "Remise de " +
        fmt(rem) +
        " sur le ticket " +
        sale.id +
        " (" +
        ROLES[role] +
        ")",
    );
  cart.forEach((l) => move("Vente", l.pid, -l.q, shop, "Ticket " + sale.id));
  const lines = cart.map(
    (l) => `${l.q} x ${P(l.pid).name} ${fmt(l.q * P(l.pid).sell)}`,
  );
  let inv = null;
  if (wantInv) {
    inv = {
      id: uid(),
      no: nextInvNo(),
      date: sale.date,
      shop,
      client: { name: c.name, tel: c.tel, adr: c.adr || "" },
      lines: cart.map((l) => ({
        name: P(l.pid).name,
        q: l.q,
        price: P(l.pid).sell,
      })),
      sub,
      rem,
      total: tot,
      paid: given,
      rendu,
      reste,
      pay,
    };
    S.invoices.unshift(inv);
    sale.inv = inv.id;
  }
  cart = [];
  window._cl = "";
  window._pay = "";
  render();
  inv ? showInvoice(inv) : ticket("Ticket " + sale.id, lines, tot, extra);
}
function openCash() {
  form(
    "Ouverture de caisse",
    [{ k: "f", l: "Fond de caisse (F)", t: "number", v: 0 }],
    (v) => {
      S.session = { shop, fond: v.f, date: now() };
      render();
    },
  );
}
function closeCash() {
  const ses = S.session,
    ve = SA()
      .filter((s) => s.shop === shop && s.date >= ses.date)
      .reduce(
        (a, s) =>
          a +
          (s.pay === "Espèces"
            ? (s.paid ?? s.total)
            : s.pay === "Crédit"
              ? s.paid || 0
              : 0),
        0,
      );
  form(
    "Clôture (théorique : " + fmt(ses.fond + ve) + ")",
    [{ k: "r", l: "Espèces comptées (F)", t: "number", v: ses.fond + ve }],
    (v) => {
      const ec = v.r - (ses.fond + ve);
      S.sessions.push({ ...ses, end: now(), ecart: ec });
      S.session = null;
      render();
      info(
        `<h3>Bilan de caisse</h3><p>Ventes espèces : ${fmt(ve)}</p><p>Écart : <b class="${ec ? "low" : ""}">${fmt(ec)}</b></p>`,
      );
    },
  );
}
/* FACTURES */
V.inv = () =>
  `<div class="card" style="margin-top:14px"><h3>Factures émises</h3>${table(
    ["N°", "Date", "Client", "Boutique", "Total", "Paiement", ""],
    S.invoices.map((v) => [
      v.no,
      new Date(v.date).toLocaleDateString("fr-FR"),
      esc(v.client.name),
      esc(sn(v.shop)),
      fmt(v.total),
      v.pay + (v.void ? " — ANNULÉE" : ""),
      `<button onclick="viewInv('${v.id}')">Voir / Imprimer</button>`,
    ]),
  )}</div>`;
/* STOCK */
V.stock =
  () => `<div class="card" style="margin-top:14px"><div class="row"><h3 style="margin:0;flex:1">Catalogue & stock</h3>${can("admin,stock") ? `<button onclick="newProd()">+ Produit</button><button class="sec" onclick="stockIn()">Entrée de stock</button><button class="sec" onclick="loss()">Perte / avarie</button><button class="sec" onclick="inventory()">Inventaire</button>` : ""}<button class="sec" onclick="exportStock()">⬇ CSV</button></div>
 ${table(
   [
     "Code",
     "Produit",
     "Catégorie",
     ...(can("admin") ? ["Achat"] : []),
     "Vente",
     "Stock",
     ...(can("admin") ? ["Marge"] : []),
     "",
   ],
   S.products.map((p) => [
     p.code,
     esc(p.name),
     esc(p.cat || ""),
     ...(can("admin") ? [fmt(p.buy)] : []),
     fmt(p.sell),
     `<span class="${qty(p) <= p.min ? "low" : ""}">${qty(p)}</span>`,
     ...(can("admin") ? [fmt(p.sell - p.buy)] : []),
     can("admin")
       ? `<button class="sec" onclick="editProd('${p.id}')">✎</button><button class="ko" onclick="delProd('${p.id}')">🗑</button>`
       : "",
   ]),
 )}</div>`;
const pf = (p) => [
  { k: "name", l: "Nom", v: p?.name },
  { k: "code", l: "Code-barres", v: p?.code },
  { k: "cat", l: "Catégorie (facultatif)", v: p?.cat },
  { k: "buy", l: "Prix d’achat", t: "number", v: p?.buy ?? 0 },
  { k: "sell", l: "Prix de vente", t: "number", v: p?.sell ?? 0 },
  { k: "min", l: "Seuil d’alerte", t: "number", v: p?.min ?? 5 },
];
function newProd() {
  form("Nouveau produit", pf(), (v) => {
    S.products.push({ id: uid(), ...v, stock: {} });
    render();
  });
}
function editProd(id) {
  const p = P(id);
  form("Modifier", pf(p), (v) => {
    Object.assign(p, v);
    render();
  });
}
/* CORRECTION : supprime aussi les transferts, commandes et lignes de panier du produit */
function delProd(id) {
  if (confirm("Supprimer ce produit ?")) {
    logA("Produit supprimé : " + (P(id)?.name || id));
    S.products = S.products.filter((p) => p.id !== id);
    S.transfers = S.transfers.filter((t) => t.pid !== id);
    S.orders.forEach((o) => (o.lines = o.lines.filter((l) => l.pid !== id)));
    S.orders = S.orders.filter((o) => o.lines.length);
    cart = cart.filter((l) => l.pid !== id);
    render();
  }
}
const popt = () => S.products.map((p) => [p.id, esc(p.name)]);
function stockIn() {
  form(
    "Entrée de stock",
    [
      { k: "p", l: "Produit", o: popt() },
      { k: "q", l: "Quantité", t: "number", v: 1 },
    ],
    (v) => {
      move("Entrée", v.p, v.q, shop, "Entrée manuelle");
      render();
    },
  );
}
function loss() {
  form(
    "Perte / avarie / périmé",
    [
      { k: "p", l: "Produit", o: popt() },
      { k: "q", l: "Quantité", t: "number", v: 1 },
      {
        k: "n",
        l: "Motif",
        o: [
          ["Avarie", "Avarie"],
          ["Périmé", "Périmé"],
          ["Perte", "Perte / vol"],
        ],
      },
    ],
    (v) => {
      move(v.n, v.p, -v.q, shop, v.n);
      render();
    },
  );
}
/* CLIENTS (séparés : endettés / sans dette) */
const clOpts = () => {
  const o = (c, extra) =>
    `<option value="${c.id}" ${window._cl === c.id ? "selected" : ""}>${esc(c.name)}${extra || ""}</option>`;
  const d = S.clients.filter((c) => c.debt > 0),
    n = S.clients.filter((c) => !(c.debt > 0));
  return `<option value="">Client comptoir</option><optgroup label="Sans dette">${n.map((c) => o(c)).join("")}</optgroup><optgroup label="Endettés">${d.map((c) => o(c, " (doit " + fmt(c.debt) + ")")).join("")}</optgroup>`;
};
V.clients = () => {
  const dbt = S.clients
      .filter((c) => c.debt > 0)
      .sort((a, b) => b.debt - a.debt),
    ok = S.clients.filter((c) => !(c.debt > 0)),
    tot = dbt.reduce((a, c) => a + c.debt, 0);
  const wa = (c) => {
    const l = waLink(
      c,
      "Bonjour " +
        c.name +
        ", il vous reste " +
        fmt(c.debt) +
        " à régler à " +
        curShop().name +
        ". Merci.",
    );
    return l
      ? `<a href="${l}" target="_blank" rel="noopener" style="display:inline-block;padding:6px 10px;border-radius:8px;background:#16a34a;color:#fff;text-decoration:none;font-size:13px">WhatsApp</a>`
      : "";
  };
  return `<div class="row" style="margin-top:14px"><h3 style="margin:0;flex:1">Clients</h3><button onclick="newCl()">+ Nouveau client</button></div>
 <div class="grid" style="margin-bottom:14px"><div class="card kpi"><span>Clients endettés</span><b class="low">${dbt.length}</b></div><div class="card kpi"><span>Total des dettes</span><b class="low">${fmt(tot)}</b></div><div class="card kpi"><span>Clients sans dette</span><b>${ok.length}</b></div></div>
 <div class="card"><h3>🔴 Clients endettés</h3>${table(
   ["Client", "Téléphone", "Limite", "Dette", ""],
   dbt.map((c) => [
     esc(c.name),
     esc(c.tel),
     fmt(c.limit),
     `<span class="low">${fmt(c.debt)}</span>`,
     `<button class="ok" onclick="repay('${c.id}')">Rembourser</button><button class="sec" onclick="hist('${c.id}')">Relevé</button>${wa(c)}<button class="sec" onclick="editCl('${c.id}')">✎</button>`,
   ]),
 )}</div>
 <div class="card"><h3>🟢 Clients sans dette</h3>${table(
   ["Client", "Téléphone", "Limite", ""],
   ok.map((c) => [
     esc(c.name),
     esc(c.tel),
     fmt(c.limit),
     `<button class="sec" onclick="hist('${c.id}')">Relevé</button><button class="sec" onclick="editCl('${c.id}')">✎</button>${can("admin") ? `<button class="ko" onclick="delCl('${c.id}')">🗑</button>` : ""}`,
   ]),
 )}</div>`;
};
function waLink(c, txt) {
  let n = String(c.tel || "").replace(/\D/g, "");
  if (n.length === 9) n = "221" + n;
  return n.length >= 10
    ? "https://wa.me/" + n + "?text=" + encodeURIComponent(txt)
    : "";
}
function editCl(id) {
  const c = C(id);
  form(
    "Modifier le client",
    [
      { k: "name", l: "Nom du client", v: c.name },
      { k: "tel", l: "Téléphone", v: c.tel },
      { k: "adr", l: "Adresse", v: c.adr },
      { k: "limit", l: "Limite de crédit (F)", t: "number", v: c.limit },
    ],
    (v) => {
      if (!v.name.trim()) return alert("Le nom du client est obligatoire");
      Object.assign(c, {
        name: v.name.trim(),
        tel: v.tel,
        adr: v.adr,
        limit: v.limit,
      });
      render();
    },
  );
}
function delCl(id) {
  const c = C(id);
  if (c.debt > 0)
    return alert("Ce client a une dette : impossible de le supprimer.");
  if (
    confirm("Supprimer ce client ? Son historique d'achats reste enregistré.")
  ) {
    logA("Client supprimé : " + c.name);
    S.clients = S.clients.filter((x) => x.id !== id);
    render();
  }
}
function newCl(cb) {
  form(
    "Nouveau client",
    [
      { k: "name", l: "Nom du client" },
      { k: "tel", l: "Téléphone" },
      { k: "adr", l: "Adresse (facultatif)" },
      { k: "limit", l: "Limite de crédit (F)", t: "number", v: 50000 },
    ],
    (v) => {
      v.name = v.name.trim();
      if (!v.name) return alert("Le nom du client est obligatoire");
      const id = uid();
      S.clients.push({ id, ...v, debt: 0 });
      if (typeof cb === "function") cb(id);
      render();
    },
  );
}
function repay(id) {
  const c = C(id);
  form(
    "Remboursement – " + esc(c.name),
    [
      {
        k: "a",
        l: "Montant (dette : " + fmt(c.debt) + ")",
        t: "number",
        v: c.debt,
      },
    ],
    (v) => {
      const a = Math.min(v.a, c.debt);
      c.debt -= a;
      S.pays.push({ id: uid(), date: now(), client: id, amt: a });
      logA("Remboursement de dette " + c.name + " : " + fmt(a));
      render();
      ticket(
        "Reçu de paiement de dette",
        [c.name],
        a,
        "Reste dû : " + fmt(c.debt),
      );
    },
  );
}
function hist(id) {
  const c = C(id);
  const a = S.sales
    .filter((s) => s.client === id)
    .map((s) => [
      new Date(s.date).getTime(),
      new Date(s.date).toLocaleDateString("fr-FR"),
      "Achat" + (s.void ? " (annulé)" : ""),
      s.pay,
      fmt(s.total),
      s.inv
        ? `<button class="sec" onclick="viewInv('${s.inv}')">Facture</button>`
        : "",
    ]);
  const p = S.pays
    .filter((x) => x.client === id)
    .map((x) => [
      new Date(x.date).getTime(),
      new Date(x.date).toLocaleDateString("fr-FR"),
      "Remboursement de dette",
      "",
      "− " + fmt(x.amt),
      "",
    ]);
  info(
    `<h3 style="margin-top:0">Relevé – ${esc(c.name)} (dette : ${fmt(c.debt)})</h3>` +
      table(
        ["Date", "Opération", "Paiement", "Montant", ""],
        a
          .concat(p)
          .sort((x, y) => y[0] - x[0])
          .map((r) => r.slice(1)),
      ) +
      `<div class="row" style="margin-top:10px"><button onclick="window.print()">🖨️ Imprimer</button></div>`,
    true,
  );
}
/* FOURNISSEURS, PAIEMENTS FOURNISSEURS ET BONS DE COMMANDE */
const oTot = (o) => o.lines.reduce((a, l) => a + l.q * l.price, 0);
const supName = (id) => S.suppliers.find((f) => f.id === id)?.name ?? "—";
V.sup =
  () => `<div class="card" style="margin-top:14px"><div class="row"><h3 style="margin:0;flex:1">Fournisseurs</h3><button onclick="newSup()">+ Fournisseur</button><button class="sec" onclick="newOrder()">Bon de commande</button></div>
 <p>Total dû aux fournisseurs : <b class="low">${fmt(S.suppliers.reduce((a, f) => a + f.debt, 0))}</b></p>
 ${table(
   ["Nom", "Téléphone", "Dette", ""],
   S.suppliers.map((f) => [
     esc(f.name),
     esc(f.tel),
     fmt(f.debt),
     (can("admin") && f.debt > 0
       ? `<button class="ok" onclick="paySup('${f.id}')">Payer</button>`
       : "") +
       `<button class="sec" onclick="histSup('${f.id}')">Historique</button><button class="sec" onclick="editSup('${f.id}')">✎</button>`,
   ]),
 )}</div>
 <div class="card"><h3>Bons de commande</h3>${table(
   ["N°", "Date", "Fournisseur", "Articles", "Total", "Statut", ""],
   S.orders.map((o) => [
     esc(o.id),
     new Date(o.date).toLocaleDateString("fr-FR"),
     esc(supName(o.sup)),
     o.lines.length,
     fmt(oTot(o)),
     `<span class="badge">${o.status}</span>`,
     `<button class="sec" onclick="viewOrder('${esc(o.id)}')">Voir / Imprimer</button>` +
       (o.status === "En attente" || o.status === "Partiel"
         ? `<button class="ok" onclick="recv('${esc(o.id)}')">Réceptionner</button>`
         : "") +
       (o.status === "En attente"
         ? `<button class="ko" onclick="cancelOrder('${esc(o.id)}')">Annuler</button>`
         : ""),
   ]),
 )}</div>`;
function newSup() {
  form(
    "Nouveau fournisseur",
    [
      { k: "name", l: "Nom" },
      { k: "tel", l: "Téléphone" },
    ],
    (v) => {
      if (!v.name.trim()) return alert("Le nom est obligatoire");
      S.suppliers.push({ id: uid(), ...v, debt: 0 });
      render();
    },
  );
}
function editSup(id) {
  const f = S.suppliers.find((x) => x.id === id);
  form(
    "Modifier le fournisseur",
    [
      { k: "name", l: "Nom", v: f.name },
      { k: "tel", l: "Téléphone", v: f.tel },
    ],
    (v) => {
      if (!v.name.trim()) return alert("Le nom est obligatoire");
      Object.assign(f, v);
      render();
    },
  );
}
function paySup(id) {
  const f = S.suppliers.find((x) => x.id === id);
  form(
    "Paiement – " + esc(f.name),
    [
      {
        k: "a",
        l: "Montant (dette : " + fmt(f.debt) + ")",
        t: "number",
        v: f.debt,
      },
      {
        k: "m",
        l: "Mode de paiement",
        o: ["Espèces", "Wave", "Orange Money", "Virement", "Chèque"].map(
          (x) => [x, x],
        ),
      },
      { k: "n", l: "Note / n° de facture du fournisseur" },
    ],
    (v) => {
      const a = Math.min(Math.max(v.a, 0), f.debt);
      if (a <= 0) return alert("Montant invalide");
      f.debt -= a;
      S.supPays.unshift({
        id: uid(),
        date: now(),
        sup: id,
        amt: a,
        mode: v.m,
        note: v.n,
      });
      logA("Paiement fournisseur " + f.name + " : " + fmt(a));
      render();
      ticket(
        "Paiement fournisseur",
        [f.name, "Mode : " + v.m],
        a,
        "Reste dû : " + fmt(f.debt),
      );
    },
  );
}
function histSup(id) {
  const f = S.suppliers.find((x) => x.id === id);
  info(
    `<h3 style="margin-top:0">${esc(f.name)} – dette ${fmt(f.debt)}</h3><h4>Paiements</h4>` +
      table(
        ["Date", "Mode", "Montant", "Note"],
        S.supPays
          .filter((p) => p.sup === id)
          .map((p) => [
            new Date(p.date).toLocaleDateString("fr-FR"),
            p.mode,
            fmt(p.amt),
            esc(p.note),
          ]),
      ) +
      `<h4>Bons de commande</h4>` +
      table(
        ["N°", "Date", "Total", "Statut"],
        S.orders
          .filter((o) => o.sup === id)
          .map((o) => [
            esc(o.id),
            new Date(o.date).toLocaleDateString("fr-FR"),
            fmt(oTot(o)),
            o.status,
          ]),
      ),
    true,
  );
}
let ol = [],
  oh = {};
function ohRead() {
  ["sup", "no", "note"].forEach((k) => {
    const e = $("#o_" + k);
    if (e) oh[k] = e.value;
  });
}
function newOrder() {
  if (!S.suppliers.length) return alert("Ajoutez d'abord un fournisseur");
  if (!S.products.length) return alert("Ajoutez d'abord un produit");
  ol = [{ pid: S.products[0].id, q: 1, price: S.products[0].buy }];
  oh = { sup: S.suppliers[0].id };
  orderForm();
}
function olSet(i, k, v) {
  if (k === "pid") {
    ol[i].pid = v;
    ol[i].price = P(v).buy;
  } else ol[i][k] = v;
  orderForm();
}
function orderForm() {
  ohRead();
  $("#mbox").className = "box wide";
  $("#mbox").innerHTML = `<h3 style="margin-top:0">Bon de commande</h3>
   <label>Fournisseur</label><select id="o_sup">${S.suppliers.map((f) => `<option value="${f.id}" ${oh.sup === f.id ? "selected" : ""}>${esc(f.name)}</option>`).join("")}</select>
   <label>N° du bon (laisser vide = numéro automatique)</label><input id="o_no" value="${esc(oh.no || "")}">
   <label>Note (facultatif)</label><input id="o_note" value="${esc(oh.note || "")}">
   <div class="tw"><table><tr><th>Produit</th><th>Qté</th><th>Prix d'achat</th><th>Total</th><th></th></tr>
   ${ol
     .map(
       (
         l,
         i,
       ) => `<tr><td><select onchange="olSet(${i},'pid',this.value)">${S.products.map((p) => `<option value="${p.id}" ${l.pid === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></td>
     <td><input type="number" min="1" value="${l.q}" style="width:80px" onchange="olSet(${i},'q',+this.value)"></td>
     <td><input type="number" min="0" value="${l.price}" style="width:110px" onchange="olSet(${i},'price',+this.value)"></td>
     <td>${fmt(l.q * l.price)}</td><td><button class="ko" onclick="ol.splice(${i},1);orderForm()">✕</button></td></tr>`,
     )
     .join("")}</table></div>
   <div class="row" style="margin-top:8px"><button class="sec" onclick="ol.push({pid:S.products[0].id,q:1,price:S.products[0].buy});orderForm()">+ Ligne</button><b style="margin-left:auto">Total : ${fmt(ol.reduce((a, l) => a + l.q * l.price, 0))}</b></div>
   <div class="row" style="margin-top:14px"><button onclick="saveOrder()">Valider</button><button class="sec" onclick="closeM()">Annuler</button></div>`;
  $("#modal").style.display = "flex";
}
function saveOrder() {
  ohRead();
  if (!ol.length) return alert("Ajoutez au moins une ligne");
  if (ol.some((l) => !(l.q > 0) || !(l.price >= 0)))
    return alert("Quantité ou prix invalide");
  let no = (oh.no || "").trim();
  if (no && S.orders.some((o) => o.id.toLowerCase() === no.toLowerCase()))
    return alert("Ce numéro de bon existe déjà");
  if (!no)
    do {
      S.bcN++;
      no =
        "BC-" + new Date().getFullYear() + "-" + String(S.bcN).padStart(4, "0");
    } while (S.orders.some((o) => o.id === no));
  S.orders.unshift({
    id: no,
    sup: oh.sup,
    shop,
    date: now(),
    note: (oh.note || "").trim(),
    lines: ol.map((l) => ({ pid: l.pid, q: l.q, price: l.price, recv: 0 })),
    status: "En attente",
  });
  oh = {};
  closeM();
  render();
}
function viewOrder(id) {
  const o = S.orders.find((x) => x.id === id),
    f = S.suppliers.find((x) => x.id === o.sup) || {},
    sh = S.shops.find((x) => x.id === o.shop) || { name: "" };
  info(
    `<div class="invoice"><h3 style="margin-top:0">BON DE COMMANDE N° ${esc(o.id)}</h3><p>${esc(sh.name)} – ${new Date(o.date).toLocaleDateString("fr-FR")}</p>
     <p>Fournisseur : <b>${esc(f.name)}</b> ${esc(f.tel)}</p>` +
      table(
        ["Désignation", "Qté", "Prix", "Total", "Reçu"],
        o.lines.map((l) => [
          esc(P(l.pid)?.name ?? "Produit supprimé"),
          l.q,
          fmt(l.price),
          fmt(l.q * l.price),
          l.recv,
        ]),
      ) +
      `<h3>Total : ${fmt(oTot(o))}</h3>${o.note ? `<p>Note : ${esc(o.note)}</p>` : ""}<p>Statut : <b>${o.status}</b></p>
     <div class="iv-sign"><div>Signature de la boutique</div><div>Signature du fournisseur</div></div></div>
     <div class="row" style="margin-top:10px"><button onclick="window.print()">🖨️ Imprimer</button></div>`,
    true,
  );
}
function cancelOrder(id) {
  const o = S.orders.find((x) => x.id === id);
  if (confirm("Annuler le bon " + o.id + " ?")) {
    o.status = "Annulé";
    render();
  }
}
function recv(id) {
  const o = S.orders.find((x) => x.id === id);
  $("#mbox").className = "box";
  $("#mbox").innerHTML =
    `<h3 style="margin-top:0">Réception – ${esc(o.id)}</h3>${o.lines
      .map(
        (l, i) =>
          `<label>${esc(P(l.pid)?.name ?? "Produit supprimé")} (commandé ${l.q}, déjà reçu ${l.recv})</label><input id="r_${i}" type="number" min="0" max="${l.q - l.recv}" value="${l.q - l.recv}">`,
      )
      .join(
        "",
      )}<div class="row" style="margin-top:14px"><button id="r_ok">Valider la réception</button><button class="sec" onclick="closeM()">Annuler</button></div>`;
  $("#modal").style.display = "flex";
  $("#r_ok").onclick = () => {
    let cost = 0,
      n = 0;
    o.lines.forEach((l, i) => {
      const q = Math.min(Math.max(+$("#r_" + i).value || 0, 0), l.q - l.recv);
      if (q > 0 && P(l.pid)) {
        move("Réception", l.pid, q, o.shop, o.id);
        l.recv += q;
        cost += q * l.price;
        n += q;
      }
    });
    if (!n) return alert("Aucune quantité saisie");
    const f = S.suppliers.find((x) => x.id === o.sup);
    if (f) f.debt += cost;
    o.status = o.lines.every((l) => l.recv >= l.q) ? "Reçu" : "Partiel";
    closeM();
    render();
  };
}
/* MULTI-BOUTIQUES */
V.multi =
  () => `<div class="card" style="margin-top:14px"><div class="row"><h3 style="margin:0;flex:1">Stock par boutique</h3>${can("admin") ? `<button class="sec" onclick="shopSettings()">⚙️ Infos & logo</button><button class="sec" onclick="newShop()">+ Boutique</button>` : ""}<button onclick="newTr()">Transfert</button></div>
 ${table(
   ["Produit", ...S.shops.map((s) => esc(s.name)), "Global"],
   S.products.map((p) => [
     esc(p.name),
     ...S.shops.map((s) => qty(p, s.id)),
     S.shops.reduce((a, s) => a + qty(p, s.id), 0),
   ]),
 )}</div>
 <div class="card"><h3>Transferts</h3>${table(
   ["De", "Vers", "Produit", "Qté", "Statut", ""],
   S.transfers.map((t) => [
     esc(sn(t.from)),
     esc(sn(t.to)),
     esc(P(t.pid)?.name ?? "Produit supprimé"),
     t.q,
     `<span class="badge">${t.status}</span>`,
     (t.status === "En transit" && t.to === shop
       ? `<button class="ok" onclick="conf('${t.id}')">Confirmer réception</button>`
       : "") +
       (t.status === "En transit" && can("admin")
         ? `<button class="ko" onclick="cancelTr('${t.id}')">Annuler</button>`
         : ""),
   ]),
 )}</div>`;
const sn = (id) => S.shops.find((s) => s.id === id)?.name;
function newShop() {
  form("Nouvelle boutique", [{ k: "name", l: "Nom" }], (v) => {
    S.shops.push({
      id: uid(),
      name: v.name,
      addr: "",
      tel: "",
      ninea: "",
      logo: "",
    });
    init();
    render();
  });
}
/* Réduit le logo (200 px max) pour ne pas saturer le stockage */
function readLogo(file, cb) {
  const r = new FileReader();
  r.onload = () => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 200 / Math.max(img.width, img.height)),
        c = document.createElement("canvas");
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      cb(c.toDataURL("image/png"));
    };
    img.src = r.result;
  };
  r.readAsDataURL(file);
}
function shopSettings() {
  const s = curShop();
  let logo = s.logo || "";
  $("#mbox").className = "box";
  $("#mbox").innerHTML =
    `<h3 style="margin-top:0">Informations de la boutique</h3>
  <label>Nom de la boutique</label><input id="s_name" value="${esc(s.name)}">
  <label>Adresse</label><input id="s_addr" value="${esc(s.addr)}">
  <label>Téléphone</label><input id="s_tel" value="${esc(s.tel)}">
  <label>NINEA / RCCM (facultatif)</label><input id="s_ninea" value="${esc(s.ninea)}">
  <label>E-mail (facultatif)</label><input id="s_email" value="${esc(s.email)}">
  <label>Logo</label><input id="s_logo" type="file" accept="image/*">
  <div id="s_prev" style="margin-top:8px"></div>
  <label>Facture automatique à partir de (F)</label><input id="s_bulk" type="number" value="${S.cfg.bulk}">
  <label>… ou à partir de (quantité d'un même produit)</label><input id="s_bq" type="number" value="${S.cfg.bulkQ}">
  <label>Remise maximale du caissier (%)</label><input id="s_mr" type="number" min="0" max="100" value="${S.cfg.maxRem ?? 10}">
  <div class="row" style="margin-top:14px"><button id="s_ok">Enregistrer</button><button class="sec" onclick="closeM()">Annuler</button></div>`;
  const prev = () =>
    ($("#s_prev").innerHTML = logo
      ? `<img class="logo" src="${logo}" alt="Logo"> <button class="sec" id="s_rm">Retirer</button>`
      : "");
  prev();
  $("#s_prev").onclick = (e) => {
    if (e.target.id === "s_rm") {
      logo = "";
      prev();
    }
  };
  $("#s_logo").onchange = (e) => {
    const f = e.target.files[0];
    if (f)
      readLogo(f, (d) => {
        logo = d;
        prev();
      });
  };
  $("#s_ok").onclick = () => {
    const n = $("#s_name").value.trim();
    if (!n) return alert("Le nom de la boutique est obligatoire");
    Object.assign(s, {
      name: n,
      addr: $("#s_addr").value.trim(),
      tel: $("#s_tel").value.trim(),
      ninea: $("#s_ninea").value.trim(),
      email: $("#s_email").value.trim(),
      logo,
    });
    S.cfg.bulk = +$("#s_bulk").value || S.cfg.bulk;
    S.cfg.bulkQ = +$("#s_bq").value || S.cfg.bulkQ;
    S.cfg.maxRem = Math.min(100, Math.max(0, +$("#s_mr").value || 0));
    closeM();
    init();
    render();
  };
  $("#modal").style.display = "flex";
}
function newTr() {
  form(
    "Transfert depuis " + esc(sn(shop)),
    [
      {
        k: "to",
        l: "Vers",
        o: S.shops.filter((s) => s.id !== shop).map((s) => [s.id, esc(s.name)]),
      },
      { k: "pid", l: "Produit", o: popt() },
      { k: "q", l: "Quantité", t: "number", v: 1 },
    ],
    (v) => {
      if (v.q > qty(P(v.pid))) return alert("Stock insuffisant");
      move("Transfert sortant", v.pid, -v.q, shop, "→ " + sn(v.to));
      S.transfers.push({ id: uid(), from: shop, ...v, status: "En transit" });
      render();
    },
  );
}
function conf(id) {
  const t = S.transfers.find((x) => x.id === id);
  if (!P(t.pid)) {
    // CORRECTION : produit supprimé entre-temps
    t.status = "Annulé";
    alert("Ce produit a été supprimé : le transfert est annulé.");
    return render();
  }
  move("Transfert entrant", t.pid, t.q, t.to, "← " + sn(t.from));
  t.status = "Reçu";
  render();
}
/* RAPPORTS */
V.rep = () => {
  const t = Date.now(),
    sum = (d) =>
      SA()
        .filter((s) => t - new Date(s.date) < d * 864e5)
        .reduce((a, s) => a + s.total, 0);
  const stat = {};
  SA().forEach((s) =>
    s.items.forEach((i) => {
      const x = stat[i.pid] || (stat[i.pid] = { q: 0, m: 0 });
      x.q += i.q;
      x.m += i.q * (i.price - i.buy);
    }),
  );
  const arr = S.products
      .map((p) => ({ p, ...(stat[p.id] || { q: 0, m: 0 }) }))
      .sort((a, b) => b.m - a.m),
    tm =
      arr.reduce((a, x) => a + x.m, 0) -
      SA().reduce((a, s) => a + (s.remise || 0), 0);
  const tp = arr.reduce((a, x) => a + Math.max(x.m, 0), 0);
  let cum = 0;
  const abc = arr.map((x) => {
    const r = tp ? cum / tp : 1; // part cumulée AVANT ce produit : le meilleur produit est toujours « A »
    cum += Math.max(x.m, 0);
    return [
      esc(x.p.name),
      x.q,
      fmt(x.m),
      x.m <= 0 ? "C" : r < 0.8 ? "A" : r < 0.95 ? "B" : "C",
    ];
  });
  const dorm = S.products.filter((p) => !stat[p.id]);
  const loss = S.moves.filter((m) =>
    ["Avarie", "Périmé", "Perte"].includes(m.type),
  );
  return `${repPeriod()}<div class="grid" style="margin:14px 0"><div class="card kpi"><span>CA 24 h</span><b>${fmt(sum(1))}</b></div><div class="card kpi"><span>CA 7 jours</span><b>${fmt(sum(7))}</b></div><div class="card kpi"><span>CA 30 jours</span><b>${fmt(sum(30))}</b></div><div class="card kpi"><span>Marge nette totale</span><b>${fmt(tm)}</b></div></div>
 <div class="card"><h3>Analyse ABC (marge = prix de vente − prix d’achat)</h3>${table(["Produit", "Qté vendue", "Marge", "Classe"], abc)}</div>
 <div class="card"><h3>Produits dormants</h3>${table(
   ["Produit"],
   dorm.map((p) => [esc(p.name)]),
 )}</div>
 ${repSessions()}<div class="card"><h3>Pertes & avaries</h3>${table(
   ["Date", "Produit", "Qté", "Type"],
   loss.map((m) => [
     day(m.date),
     esc(P(m.pid)?.name ?? "Produit supprimé"),
     -m.q,
     m.type,
   ]),
 )}</div>`;
};
V.moves = () =>
  `<div class="card" style="margin-top:14px"><h3>Traçabilité des mouvements</h3>${table(
    ["Date", "Type", "Produit", "Qté", "Boutique", "Note"],
    S.moves
      .slice(0, 100)
      .map((m) => [
        new Date(m.date).toLocaleString("fr-FR"),
        m.type,
        esc(P(m.pid)?.name ?? "Produit supprimé"),
        m.q,
        esc(sn(m.shop)),
        esc(m.note),
      ]),
  )}</div>`;
/* ===== OUTILS : ventes valides, journal, CSV ===== */
function SA() {
  return S.sales.filter((s) => !s.void);
}
function logA(t) {
  S.log.unshift({ date: now(), role, t });
  S.log = S.log.slice(0, 300);
}
function dl(name, text) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(
    new Blob(["\ufeff" + text], { type: "text/csv;charset=utf-8" }),
  );
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const csvLine = (r) =>
  r.map((c) => '"' + String(c ?? "").replace(/"/g, '""') + '"').join(";");
/* ===== VENTES : historique, ticket, annulation ===== */
V.sales = () => {
  const d = window._sd || day(now()),
    L = S.sales.filter((s) => day(s.date) === d && s.shop === shop).reverse();
  return `<div class="card" style="margin-top:14px"><div class="row"><h3 style="margin:0;flex:1">Ventes – ${esc(curShop().name)}</h3><input type="date" value="${d}" onchange="window._sd=this.value;render()"></div>
   ${table(
     ["Heure", "N°", "Articles", "Total", "Paiement", "Client", "Statut", ""],
     L.map((s) => [
       new Date(s.date).toLocaleTimeString("fr-FR", {
         hour: "2-digit",
         minute: "2-digit",
       }),
       s.id,
       s.items.reduce((a, i) => a + i.q, 0),
       fmt(s.total),
       s.pay,
       esc(C(s.client)?.name ?? "Comptoir"),
       s.void ? `<span class="low">Annulée</span>` : "Valide",
       `<button class="sec" onclick="reprint('${s.id}')">Ticket</button>` +
         (s.inv
           ? `<button class="sec" onclick="viewInv('${s.inv}')">Facture</button>`
           : "") +
         (can("admin") && !s.void
           ? `<button class="ko" onclick="cancelSale('${s.id}')">Annuler</button>`
           : ""),
     ]),
   )}</div>`;
};
function reprint(id) {
  const s = S.sales.find((x) => x.id === id);
  ticket(
    "Ticket " + s.id + (s.void ? " (ANNULÉ)" : ""),
    s.items.map(
      (i) =>
        `${i.q} x ${P(i.pid)?.name ?? "Produit supprimé"} ${fmt(i.q * i.price)}`,
    ),
    s.total,
    "Paiement : " +
      s.pay +
      (s.reste ? "\nReste à payer : " + fmt(s.reste) : ""),
  );
}
function cancelSale(id) {
  const s = S.sales.find((x) => x.id === id);
  form(
    "Annuler la vente " + s.id + " (" + fmt(s.total) + ")",
    [{ k: "m", l: "Motif de l'annulation" }],
    (v) => {
      if (!v.m.trim()) return alert("Le motif est obligatoire");
      s.items.forEach((i) =>
        move(
          "Annulation vente",
          i.pid,
          i.q,
          s.shop,
          "Vente " + s.id + " annulée",
        ),
      );
      const c = C(s.client);
      if (c && s.reste > 0) c.debt = Math.max(0, c.debt - s.reste);
      s.void = { date: now(), by: role, motif: v.m.trim() };
      const inv = S.invoices.find((x) => x.id === s.inv);
      if (inv) inv.void = true;
      logA("Vente " + s.id + " annulée (" + fmt(s.total) + ") : " + v.m.trim());
      render();
    },
  );
}
/* ===== CAISSE : paniers en attente ===== */
function hold() {
  if (!cart.length) return alert("Le panier est vide");
  S.held.push({
    id: uid(),
    date: now(),
    shop,
    cart: cart.map((l) => ({ ...l })),
    client: window._cl || "",
  });
  cart = [];
  window._cl = "";
  render();
}
function showHeld() {
  const L = S.held.filter((h) => h.shop === shop);
  info(
    `<h3 style="margin-top:0">Paniers en attente</h3>` +
      table(
        ["Heure", "Articles", "Client", ""],
        L.map((h) => [
          new Date(h.date).toLocaleTimeString("fr-FR", {
            hour: "2-digit",
            minute: "2-digit",
          }),
          h.cart.reduce((a, l) => a + l.q, 0),
          esc(C(h.client)?.name ?? "Comptoir"),
          `<button class="ok" onclick="resume('${h.id}')">Reprendre</button><button class="ko" onclick="dropHeld('${h.id}')">✕</button>`,
        ]),
      ),
  );
}
function resume(id) {
  const h = S.held.find((x) => x.id === id);
  if (cart.length && !confirm("Le panier actuel sera remplacé. Continuer ?"))
    return;
  cart = h.cart
    .filter((l) => P(l.pid) && qty(P(l.pid)) > 0)
    .map((l) => ({ pid: l.pid, q: Math.min(l.q, qty(P(l.pid))) }));
  window._cl = h.client;
  S.held = S.held.filter((x) => x.id !== id);
  closeM();
  render();
}
function dropHeld(id) {
  S.held = S.held.filter((x) => x.id !== id);
  render();
  showHeld();
}
/* ===== STOCK : inventaire et export ===== */
function inventory() {
  $("#mbox").className = "box wide";
  $("#mbox").innerHTML =
    `<h3 style="margin-top:0">Inventaire – ${esc(curShop().name)}</h3><small class="hint">Saisissez la quantité comptée. Laissez vide les produits non comptés.</small>` +
    table(
      ["Produit", "En stock", "Compté"],
      S.products.map((p, i) => [
        esc(p.name),
        qty(p),
        `<input id="iv_${i}" type="number" min="0" style="width:90px">`,
      ]),
    ) +
    `<div class="row" style="margin-top:12px"><button id="iv_ok">Valider l'inventaire</button><button class="sec" onclick="closeM()">Annuler</button></div>`;
  $("#modal").style.display = "flex";
  $("#iv_ok").onclick = () => {
    const diffs = [];
    S.products.forEach((p, i) => {
      const v = $("#iv_" + i).value;
      if (v === "") return;
      const d = Math.max(0, +v) - qty(p);
      if (d) {
        move("Inventaire", p.id, d, shop, "Écart d'inventaire");
        diffs.push([esc(p.name), d > 0 ? "+" + d : d, fmt(d * p.buy)]);
      }
    });
    logA("Inventaire " + curShop().name + " : " + diffs.length + " écart(s)");
    render();
    info(
      `<h3 style="margin-top:0">Inventaire enregistré</h3>` +
        table(["Produit", "Écart", "Valeur"], diffs),
    );
  };
}
function exportStock() {
  dl(
    "stock-" + day(now()) + ".csv",
    [
      [
        "Code",
        "Produit",
        "Catégorie",
        "Prix d'achat",
        "Prix de vente",
        "Stock " + curShop().name,
      ],
    ]
      .concat(
        S.products.map((p) => [
          p.code,
          p.name,
          p.cat || "",
          p.buy,
          p.sell,
          qty(p),
        ]),
      )
      .map(csvLine)
      .join("\r\n"),
  );
}
function cancelTr(id) {
  const t = S.transfers.find((x) => x.id === id);
  if (
    !confirm(
      "Annuler ce transfert ? Le stock retourne à la boutique d'origine.",
    )
  )
    return;
  move("Transfert annulé", t.pid, t.q, t.from, "Annulation → " + sn(t.to));
  t.status = "Annulé";
  logA("Transfert annulé : " + (P(t.pid)?.name ?? "") + " ×" + t.q);
  render();
}
/* ===== RAPPORTS : période, export, clôtures ===== */
function repData() {
  const d1 =
      window._rd1 || day(new Date(Date.now() - 29 * 864e5).toISOString()),
    d2 = window._rd2 || day(now());
  return {
    d1,
    d2,
    L: SA().filter((s) => day(s.date) >= d1 && day(s.date) <= d2),
  };
}
function repPeriod() {
  const { d1, d2, L } = repData(),
    sum = (f) => L.reduce((a, s) => a + f(s), 0);
  const by = (key) => {
    const m = {};
    L.forEach((s) => {
      const x = m[key(s)] || (m[key(s)] = { n: 0, t: 0 });
      x.n++;
      x.t += s.total;
    });
    return Object.keys(m).map((k) => [esc(k), m[k].n, fmt(m[k].t)]);
  };
  return `<div class="card" style="margin-top:14px"><div class="row"><h3 style="margin:0;flex:1">Analyse par période</h3>Du <input type="date" value="${d1}" onchange="window._rd1=this.value;render()"> au <input type="date" value="${d2}" onchange="window._rd2=this.value;render()"><button class="sec" onclick="exportSales()">⬇ CSV des ventes</button></div>
   <div class="grid" style="margin:10px 0"><div class="card kpi"><span>Chiffre d'affaires</span><b>${fmt(sum((s) => s.total))}</b></div><div class="card kpi"><span>Ventes</span><b>${L.length}</b></div>
   <div class="card kpi"><span>Marge (remises déduites)</span><b>${fmt(sum((s) => s.items.reduce((a, i) => a + i.q * (i.price - i.buy), 0) - (s.remise || 0)))}</b></div><div class="card kpi"><span>Reste à encaisser</span><b>${fmt(sum((s) => s.reste || 0))}</b></div></div>
   ${table(
     ["Mode de paiement", "Ventes", "Total"],
     by((s) => s.pay),
   )}${table(
     ["Boutique", "Ventes", "Total"],
     by((s) => sn(s.shop) || "?"),
   )}</div>`;
}
function exportSales() {
  dl(
    "ventes-" + repData().d1 + "_" + repData().d2 + ".csv",
    [
      [
        "Date",
        "Boutique",
        "N° ticket",
        "Client",
        "Paiement",
        "Total",
        "Versé",
        "Reste",
        "Remise",
      ],
    ]
      .concat(
        repData().L.map((s) => [
          new Date(s.date).toLocaleString("fr-FR"),
          sn(s.shop),
          s.id,
          C(s.client)?.name ?? "Comptoir",
          s.pay,
          s.total,
          s.paid ?? s.total,
          s.reste || 0,
          s.remise || 0,
        ]),
      )
      .map(csvLine)
      .join("\r\n"),
  );
}
function repSessions() {
  return `<div class="card"><h3>Clôtures de caisse</h3>${table(
    ["Ouverture", "Clôture", "Boutique", "Fond", "Écart"],
    S.sessions
      .slice()
      .reverse()
      .map((x) => [
        new Date(x.date).toLocaleString("fr-FR"),
        x.end ? new Date(x.end).toLocaleString("fr-FR") : "",
        esc(sn(x.shop)),
        fmt(x.fond),
        `<span class="${x.ecart ? "low" : ""}">${fmt(x.ecart || 0)}</span>`,
      ]),
  )}</div>`;
}
/* ===== TABLEAU DE BORD : graphique et meilleures ventes ; JOURNAL ===== */
function dashExtra() {
  const days = [...Array(7)].map((_, i) =>
    day(new Date(Date.now() - (6 - i) * 864e5).toISOString()),
  );
  const v = days.map((d) =>
      SA()
        .filter((s) => day(s.date) === d)
        .reduce((a, s) => a + s.total, 0),
    ),
    mx = Math.max(1, ...v),
    top = {};
  SA().forEach((s) =>
    s.items.forEach((i) => (top[i.pid] = (top[i.pid] || 0) + i.q)),
  );
  const tp = Object.keys(top)
    .map((k) => [esc(P(k)?.name ?? "Produit supprimé"), top[k]])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  return `<div class="card"><h3>Ventes des 7 derniers jours (toutes boutiques)</h3>${days.map((d, i) => `<div style="display:flex;align-items:center;gap:8px;margin:4px 0"><span style="width:60px;font-size:12px">${d.slice(5)}</span><div style="background:#3b82f6;height:14px;border-radius:4px;width:${(v[i] / mx) * 60}%;min-width:2px"></div><span style="font-size:12px">${fmt(v[i])}</span></div>`).join("")}</div><div class="card"><h3>Meilleures ventes</h3>${table(["Produit", "Qté vendue"], tp)}</div>`;
}
const _dash = V.dash;
V.dash = () => _dash() + dashExtra();
const _mv = V.moves;
V.moves = () =>
  _mv() +
  (can("admin")
    ? `<div class="card"><h3>Journal des actions</h3>${table(
        ["Date", "Rôle", "Action"],
        S.log.map((l) => [
          new Date(l.date).toLocaleString("fr-FR"),
          ROLES[l.role] || l.role,
          esc(l.t),
        ]),
      )}</div>`
    : "");
/* SÉCURITÉ : codes par rôle. Protège contre un accès simple, ce n'est pas un chiffrement. */
const hash = (s) => {
  s = "smp|" + s;
  let h1 = 0xdeadbeef,
    h2 = 0x41c6ce57;
  for (let i = 0, c; i < s.length; i++) {
    c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
};
const ROLES = {
  admin: "Administrateur",
  cash: "Caissier",
  stock: "Gestionnaire de stock",
};
const codeOk = (r, c) =>
  hash(c) === (r !== "admin" && S.auth[r] ? S.auth[r] : S.auth.admin);
/* ===== ÉCRAN DE CONNEXION : styles autonomes (ne dépendent pas de style.css) ===== */
const lkCSS = `
#lock{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto;background:radial-gradient(circle at 15% 20%,#2563eb55,transparent 40%),radial-gradient(circle at 85% 80%,#7c3aed44,transparent 40%),linear-gradient(135deg,#0b1220,#13245a)}
#lock *{box-sizing:border-box}
#lock .lk-card{width:min(430px,100%);background:#fff;border-radius:22px;padding:30px 28px;box-shadow:0 25px 60px #0008;text-align:center;animation:lkup .5s ease;font-family:inherit}
#lock .lk-ic{width:68px;height:68px;border-radius:20px;margin:0 auto 14px;display:flex;align-items:center;justify-content:center;font-size:32px;background:linear-gradient(135deg,#3b82f6,#6366f1);box-shadow:0 8px 20px #3b82f655}
#lock h2{margin:0;font-size:22px;color:#0f172a}
#lock .lk-sub{margin:6px 0 20px;color:#64748b;font-size:14px}
#lock .lk-sec{text-align:left;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#3b82f6;margin:14px 0 8px}
#lock .lk-f{text-align:left;margin-bottom:12px}
#lock .lk-f label{display:block;font-size:13px;font-weight:600;color:#334155;margin:0 0 5px}
#lock .lk-f small{display:block;color:#94a3b8;font-size:12px;margin-top:4px}
#lock .lk-pw{position:relative}
#lock .lk-pw input{display:block;width:100%;padding:12px 44px 12px 14px;font-size:16px;border:2px solid #e2e8f0;border-radius:12px;background:#f8fafc;outline:0;transition:.15s;margin:0}
#lock .lk-pw input:focus{border-color:#3b82f6;background:#fff;box-shadow:0 0 0 4px #3b82f622}
#lock .lk-eye{position:absolute;right:6px;top:50%;transform:translateY(-50%);width:34px;height:34px;border:0;border-radius:8px;background:transparent;color:#334155;cursor:pointer;font-size:16px;opacity:.6;padding:0;margin:0}
#lock .lk-eye:hover{background:#e2e8f0;opacity:1}
#lock .lk-btn{display:block;width:100%;margin:18px 0 0;padding:13px;border:0;border-radius:12px;font-size:16px;font-weight:700;color:#fff;cursor:pointer;background:linear-gradient(135deg,#2563eb,#4f46e5);box-shadow:0 8px 20px #2563eb55}
#lock .lk-btn:hover{filter:brightness(1.08)}
#lock .lk-link{display:block;margin:12px auto 0;background:none;border:0;color:#64748b;font-size:13px;cursor:pointer;text-decoration:underline;padding:4px;box-shadow:none}
#lock .lk-roles{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px}
#lock .lk-role{display:flex;flex-direction:column;align-items:center;gap:4px;padding:12px 4px;border:2px solid #e2e8f0;border-radius:14px;background:#fff;cursor:pointer;font-size:24px;color:#334155;margin:0;box-shadow:none}
#lock .lk-role span{font-size:11.5px;font-weight:600;line-height:1.2}
#lock .lk-role.on{border-color:#3b82f6;background:#eff6ff;color:#1d4ed8}
#lock .lk-err{margin-top:12px;padding:10px 12px;color:#b91c1c;background:#fef2f2;border:1px solid #fecaca;border-radius:10px;font-size:13px;font-weight:600;text-align:left}
#lock .lk-err:empty{display:none}
#lock .lk-foot{margin-top:14px;padding-top:12px;border-top:1px solid #f1f5f9;color:#94a3b8;font-size:12px}
#lock .lk-shake{animation:lkshake .35s}
@keyframes lkup{from{opacity:0;transform:translateY(18px) scale(.98)}to{opacity:1;transform:none}}
@keyframes lkshake{25%{transform:translateX(-6px)}75%{transform:translateX(6px)}}`;
const LK_ICON = { admin: "👑", cash: "🧾", stock: "📦" };
function lkStyle() {
  if ($("#lkcss")) return;
  const st = document.createElement("style");
  st.id = "lkcss";
  st.textContent = lkCSS;
  document.head.appendChild(st);
}
const lkField = (id, label, hint) =>
  `<div class="lk-f"><label for="${id}">${label}</label><div class="lk-pw"><input id="${id}" type="password" autocomplete="off"><button type="button" class="lk-eye" tabindex="-1" title="Afficher / masquer" onclick="lkEye('${id}')">👁</button></div>${hint ? `<small>${hint}</small>` : ""}</div>`;
function lkEye(id) {
  const i = $("#" + id);
  i.type = i.type === "password" ? "text" : "password";
}
function lkErr(m) {
  const e = $("#lk_err");
  if (!e) return;
  e.textContent = "⚠ " + m;
  e.classList.remove("lk-shake");
  void e.offsetWidth;
  e.classList.add("lk-shake");
}
const lkCard = (icon, title, sub, body) =>
  `<div class="lk-card"><div class="lk-ic">${icon}</div><h2>${title}</h2><p class="lk-sub">${sub}</p>${body}<div id="lk_err" class="lk-err"></div><div class="lk-foot">🔒 Vos données sont enregistrées dans la base de données de cet ordinateur · v7</div></div>`;
function lockScreen() {
  lkStyle();
  let L = $("#lock");
  if (!L) {
    L = document.createElement("div");
    L.id = "lock";
    document.body.appendChild(L);
  }
  L.style.display = "flex";
  if (!S.auth || !S.auth.admin) {
    L.innerHTML = lkCard(
      "🔐",
      "Bienvenue sur StockMaster Pro",
      "Créez vos codes d'accès pour protéger votre boutique.",
      `<div class="lk-sec">Obligatoire</div>${lkField("a_adm", "Code administrateur", "4 caractères minimum")}${lkField("a_res", "Mot de secours", "Sert à retrouver l'accès si vous oubliez le code")}
       <div class="lk-sec">Facultatif</div>${lkField("a_cash", "Code caissier", "Vide = le code administrateur est demandé")}${lkField("a_stock", "Code gestionnaire de stock", "Vide = le code administrateur est demandé")}
       <button class="lk-btn" id="a_ok">Enregistrer et entrer →</button>`,
    );
    $("#a_adm").focus();
    $("#a_ok").onclick = () => {
      const a = $("#a_adm").value,
        r = $("#a_res").value;
      if (a.length < 4 || r.length < 4)
        return lkErr(
          "Le code administrateur et le mot de secours doivent avoir 4 caractères minimum.",
        );
      S.auth = {
        admin: hash(a),
        rescue: hash(r),
        cash: $("#a_cash").value ? hash($("#a_cash").value) : "",
        stock: $("#a_stock").value ? hash($("#a_stock").value) : "",
      };
      save();
      enter("admin");
    };
    return;
  }
  L.innerHTML = lkCard(
    "📦",
    "StockMaster Pro",
    "Choisissez votre profil, puis entrez votre code.",
    `<div class="lk-roles">${Object.keys(ROLES)
      .map(
        (k, i) =>
          `<button type="button" class="lk-role${i === 0 ? " on" : ""}" data-r="${k}">${LK_ICON[k]}<span>${ROLES[k]}</span></button>`,
      )
      .join("")}</div>
     ${lkField("l_code", "Code d'accès")}<button class="lk-btn" id="l_ok">Entrer →</button><button type="button" class="lk-link" id="l_forgot">Code oublié ?</button>`,
  );
  let r = "admin";
  L.querySelectorAll(".lk-role").forEach(
    (b) =>
      (b.onclick = () => {
        r = b.dataset.r;
        L.querySelectorAll(".lk-role").forEach((x) =>
          x.classList.toggle("on", x === b),
        );
        $("#l_code").focus();
      }),
  );
  const ok = () => {
    try {
      const c = $("#l_code").value;
      if (!codeOk(r, c) && !codeOk(r, c.trim())) {
        $("#l_code").select();
        return lkErr(
          "Code incorrect pour le profil « " +
            ROLES[r] +
            " ». Cliquez sur l'œil 👁 pour vérifier ce que vous tapez. Si le code caissier ou stock n'a pas été défini, utilisez le code administrateur.",
        );
      }
      enter(r);
    } catch (e) {
      console.error(e);
      lkErr("Erreur : " + e.message);
    }
  };
  $("#l_ok").onclick = ok;
  $("#l_code").addEventListener("keydown", (e) => {
    if (e.key === "Enter") ok(); // ne bloque aucune autre touche
  });
  $("#l_code").focus();
  $("#l_forgot").onclick = forgot;
}
function forgot() {
  $("#lock").innerHTML = lkCard(
    "🔑",
    "Retrouver l'accès",
    "Entrez votre mot de secours pour créer un nouveau code administrateur.",
    `${lkField("f_res", "Mot de secours")}${lkField("f_new", "Nouveau code administrateur", "4 caractères minimum")}
     <button class="lk-btn" id="f_ok">Valider</button><button type="button" class="lk-link" onclick="lockScreen()">← Retour</button>`,
  );
  $("#f_res").focus();
  $("#f_ok").onclick = () => {
    if (hash($("#f_res").value) !== S.auth.rescue)
      return lkErr("Mot de secours incorrect.");
    if ($("#f_new").value.length < 4)
      return lkErr("Le nouveau code doit avoir 4 caractères minimum.");
    S.auth.admin = hash($("#f_new").value);
    save();
    alert("Code administrateur changé.");
    lockScreen();
  };
}
function enter(r) {
  role = r;
  cart = [];
  $("#lock").style.display = "none";
  try {
    $("#role").value = r;
    logA("Connexion : " + ROLES[r]);
  } catch (e) {
    console.error(e);
  }
  render();
}
function backupBanner() {
  if (!can("admin")) return "";
  const old = !S.lastBackup || Date.now() - new Date(S.lastBackup) > 7 * 864e5;
  return old
    ? `<div class="card" style="margin-top:14px;border-left:4px solid #f59e0b"><div class="row"><span style="flex:1">⚠️ ${S.lastBackup ? "Dernière sauvegarde il y a plus de 7 jours." : "Aucune sauvegarde n'a encore été faite."}</span><button onclick="dataModal()">Sauvegarder maintenant</button></div></div>`
    : "";
}
function dataModal() {
  if (!can("admin")) return alert("Réservé à l'administrateur");
  $("#mbox").className = "box";
  $("#mbox").innerHTML = `<h3 style="margin-top:0">💾 Données et sécurité</h3>
   <p>Dernière sauvegarde : <b>${S.lastBackup ? new Date(S.lastBackup).toLocaleString("fr-FR") : "jamais"}</b></p>
   <div class="row"><button onclick="exportData()">💾 Exporter une sauvegarde</button><button class="sec" onclick="$('#imp').click()">📂 Restaurer</button><input id="imp" type="file" accept=".json,application/json" style="display:none" onchange="importData(this)"></div>
   <small class="hint">Gardez le fichier sur une clé USB ou envoyez-le sur WhatsApp. Sans sauvegarde, vider le navigateur efface tout.</small>
   <h4 style="margin:16px 0 4px">Codes d'accès</h4><small class="hint">Vide = inchangé. Pour caissier et stock, « - » retire le code (le code administrateur est alors demandé).</small>
   <label>Nouveau code administrateur</label><input id="c_adm" type="password"><label>Nouveau mot de secours</label><input id="c_res" type="password">
   <label>Code caissier</label><input id="c_cash" type="password"><label>Code gestionnaire de stock</label><input id="c_stock" type="password">
   <div class="row" style="margin-top:14px"><button onclick="saveCodes()">Enregistrer les codes</button><button class="sec" onclick="closeM()">Fermer</button></div>`;
  $("#modal").style.display = "flex";
}
function saveCodes() {
  const v = (id) => $("#" + id).value;
  if (v("c_adm") && v("c_adm").length < 4)
    return alert("Code administrateur : 4 caractères minimum");
  if (v("c_res") && v("c_res").length < 4)
    return alert("Mot de secours : 4 caractères minimum");
  if (v("c_adm")) S.auth.admin = hash(v("c_adm"));
  if (v("c_res")) S.auth.rescue = hash(v("c_res"));
  if (v("c_cash")) S.auth.cash = v("c_cash") === "-" ? "" : hash(v("c_cash"));
  if (v("c_stock"))
    S.auth.stock = v("c_stock") === "-" ? "" : hash(v("c_stock"));
  save();
  closeM();
  alert("Codes enregistrés.");
}
function exportData() {
  S.lastBackup = now();
  logA("Sauvegarde exportée");
  save();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(
    new Blob([JSON.stringify(S)], { type: "application/json" }),
  );
  a.download = "stockmaster-sauvegarde-" + day(now()) + ".json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  dataModal();
}
function importData(inp) {
  const f = inp.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    let d;
    try {
      d = JSON.parse(r.result);
      if (!Array.isArray(d.products) || !Array.isArray(d.shops)) throw 0;
    } catch (e) {
      return alert("Fichier de sauvegarde invalide.");
    }
    if (
      !confirm("Remplacer TOUTES les données actuelles par cette sauvegarde ?")
    )
      return;
    DB.set("state", d)
      .then(() => location.reload())
      .catch(() => alert("Erreur : la restauration a échoué."));
  };
  r.readAsText(f);
}
/* ===== DÉMARRAGE : ouvre la base de données, puis affiche l'écran de connexion ===== */
(async () => {
  await load();
  shop = S.shops[0].id;
  init();
  lockScreen();
})();
