/* ======================================================================
   Dagbok

   En dagbok per projekt och dag. Wimo fyller i det som redan finns:
   datum, väder för dagen och alla poster på tavlorna den dagen. Sedan
   svarar man på fem frågor (samma delar som en dagbok i Next):
     1. Påbörjat, pågående och avslutat
     2. Arbetsstyrka
     3. Avvikelser, störningar och hinder
     4. Ändringar och tilläggsarbeten (ÄTA)
     5. Övrigt
   Planerat och utfört hålls isär: en planerad post räknas inte som utförd
   förrän man har bekräftat det. Dagböckerna ligger kvar oavsett datum och
   sparas i projektet (i molnet som egna delar, en per dagbok).

   Juridik: en dagboksanteckning är inte automatiskt en hinderanmälan eller
   en ÄTA-underrättelse. Det står i dagboken där det är aktuellt.
   ====================================================================== */

const DB_ORSAKER = ["Material saknades", "Handlingar eller beslut saknades", "Föregående arbete var inte färdigt",
    "Resursbrist", "Väderförhållanden", "Omplanering", "Annan orsak"];
const DB_STATUS = [
    { id: "", namn: "Ej bekräftad" },
    { id: "utford", namn: "Utfört" },
    { id: "pagar", namn: "Pågår" },
    { id: "ej", namn: "Ej utfört" }
];
const DB_MAN = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];

let dbVy = { lage: "lista", projekt: null, id: null, filter: "alla", sok: "" };
let dbSparaTimer = null;

/* ---------- vem och vilka projekt ---------- */

function dbJag() {
    try { const j = window.p4Jag && window.p4Jag(); if (j) return j; } catch (e) { }
    return { uid: "", namn: "Den här datorn", epost: "" };
}
function dbArMed(p) {
    try { return typeof window.p4ArMed !== "function" || window.p4ArMed(p.id); } catch (e) { return true; }
}
// Ny dagbok: bara huvudadmin eller projektadmin i projektet.
function dbKanSkapa(p) {
    try { return !!p && (typeof window.p4ArProjektAdmin !== "function" || window.p4ArProjektAdmin(p.id)); } catch (e) { return false; }
}
function dbKanAndra(p) {
    try { return typeof window.p4KanProjekt !== "function" || window.p4KanProjekt(p.id); } catch (e) { return true; }
}
// Dagboken hör till projektet man står i: listan och nya dagböcker gäller bara det projektet.
function dbProjekt() { return state && state.id && dbArMed(state) ? [state] : []; }
function dbHitta(pid, id) {
    const p = plan4.projekt.find(x => x.id === pid);
    const d = p && (p.dagbok || []).find(x => x.id === id);
    return d ? { p, d } : null;
}
const dbNu = () => new Date().toISOString();
const dbTid = (iso) => { if (!iso) return ""; const d = new Date(iso); return kortDatum(d2iso(d)) + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };
const dbVeckodag = (iso) => ["Söndag", "Måndag", "Tisdag", "Onsdag", "Torsdag", "Fredag", "Lördag"][iso2d(iso).getDay()];
const dbLangtDatum = (iso) => { const d = iso2d(iso); return dbVeckodag(iso) + " " + d.getDate() + " " + DB_MAN[d.getMonth()] + " " + d.getFullYear(); };

/* ---------- sidan ---------- */

function oppnaDagbok() {
    try { stangStart(); } catch (e) { }
    try { stangDash(); } catch (e) { }
    try { stangGantt(); } catch (e) { }
    try { stangBackup(); } catch (e) { }
    try { stangHjalp(); } catch (e) { }
    document.body.classList.add("dashlage");
    document.getElementById("dagbok").classList.remove("dold");
    dbVy.lage = "lista";
    ritaDagbok();
}
function stangDagbok() {
    const el = document.getElementById("dagbok");
    if (!el || el.classList.contains("dold"))
        return;
    dbSparaNu();
    el.classList.add("dold");
    let annan = false;
    try { annan = dashOppen() || startOppen() || ganttOppen() || backupOppen() || hjalpOppen(); } catch (e) { }
    if (!annan)
        document.body.classList.remove("dashlage");
}
function dagbokOppen() { const el = document.getElementById("dagbok"); return !!el && !el.classList.contains("dold"); }

// De andra sidorna stänger dagboken när de öppnas.
["oppnaGantt", "oppnaDash", "oppnaStart", "oppnaBackup", "oppnaHjalp"].forEach(namn => {
    const urs = window[namn];
    if (typeof urs !== "function")
        return;
    window[namn] = function () { stangDagbok(); return urs.apply(this, arguments); };
});

function ritaDagbok() {
    const el = document.getElementById("dagbok");
    if (!el)
        return;
    if (dbVy.lage === "visa") {
        const h = state && dbVy.projekt === state.id ? dbHitta(dbVy.projekt, dbVy.id) : null;
        if (h)
            return ritaEnDagbok(el, h.p, h.d);
        dbVy.lage = "lista";
    }
    ritaDagbokLista(el);
}

function ritaDagbokLista(el) {
    const projekt = dbProjekt();
    let alla = [];
    projekt.forEach(p => (p.dagbok || []).forEach(d => alla.push({ p, d })));
    const filtrerade = alla
        .filter(x => !dbVy.sok || dbSokText(x.p, x.d).indexOf(dbVy.sok.toLowerCase()) >= 0)
        .sort((a, b) => b.d.datum.localeCompare(a.d.datum) || (b.d.skapad || "").localeCompare(a.d.skapad || ""));
    const utkast = alla.filter(x => !x.d.godkand).length;
    const val = "";
    // bara datumet; ett klick öppnar dagboken med allt innehåll
    const rader = filtrerade.map(x => '<li><button type="button" class="db-rad db-rad-enkel" data-dbvisa="' + esc(x.p.id) + "|" + esc(x.d.id) + '">' +
        esc(dbLangtDatum(x.d.datum)) + '<span class="db-pil" aria-hidden="true">›</span></button></li>').join("");
    el.innerHTML =
        '<section class="db-sida">' +
        '<header class="db-topp"><div><h2>Dagbok' + (state && state.projekt ? ' <span class="db-projnamn">· ' + esc(state.projekt) + "</span>" : "") + "</h2><p>" + (alla.length
            ? alla.length + (alla.length === 1 ? " dagbok" : " dagböcker") + (utkast ? " · " + utkast + " inte godkända" : " · alla godkända")
            : "Byggdagbok per dag. Wimo fyller i datum, väder och dagens poster åt dig.") + "</p></div>" +
        (dbKanSkapa(state) ? '<button type="button" class="db-ny" id="dbNy" title="Ny dagbok" aria-label="Ny dagbok"><span aria-hidden="true">+</span> Ny dagbok</button>' : "") + "</header>" +
        '<div class="db-verktyg">' + val + '<input class="f db-sok" id="dbSok" type="search" placeholder="Sök i dagböckerna" value="' + esc(dbVy.sok) + '"></div>' +
        (filtrerade.length ? '<ul class="db-lista">' + rader + "</ul>"
            : '<div class="db-tom"><b>' + (alla.length ? "Inga dagböcker matchar" : "Ingen dagbok än") + "</b><p>" +
              (alla.length ? "Ändra sökningen eller projektvalet." : (dbKanSkapa(state) ? "Tryck på + Ny dagbok och välj dagen du vill skriva för." : "Dagböckerna skapas av projektadmin.")) + "</p></div>") +
        "</section>";
}

function dbSokText(p, d) {
    const s = d.svar || {};
    return [p.projekt, d.datum, dbLangtDatum(d.datum), s.arbete, s.avvikelseText, s.ataText, s.ovrigt, s.ue,
        (d.poster || []).map(x => x.text + " " + (x.vem || "") + " " + (x.kommentar || "")).join(" ")].join(" ").toLowerCase();
}

/* ---------- ny dagbok: välj dag i en kalender ---------- */

let dbKal = null;     // { pid, manad: "YYYY-MM" }

function nyDagbokDialog() {
    const projekt = dbProjekt().filter(p => !p.arkiverad || p === state);
    if (!projekt.length)
        return status("Du är inte med i något projekt", true);
    if (!dbKanSkapa(projekt[0]))
        return status("Bara huvudadmin och projektadmin kan skapa en dagbok", true);
    const pid = projekt[0].id;
    dbKal = { pid, manad: IDAG.slice(0, 7) };
    modal("Ny dagbok", "Välj dagen du ska skriva dagbok för", '<div id="dbKalender"></div>', [{ txt: "Avbryt", fn: stangModal }]);
    ritaDbKalender();
}

function ritaDbKalender() {
    const box = document.getElementById("dbKalender");
    if (!box || !dbKal)
        return;
    const projekt = dbProjekt().filter(p => !p.arkiverad || p === state);
    const p = plan4.projekt.find(x => x.id === dbKal.pid);
    const finns = new Set((p.dagbok || []).map(d => d.datum));
    const [ar, mn] = dbKal.manad.split("-").map(Number);
    const forsta = new Date(ar, mn - 1, 1), start = (forsta.getDay() + 6) % 7;
    const dagarIManad = new Date(ar, mn, 0).getDate();
    let celler = "";
    for (let i = 0; i < start; i++)
        celler += '<span class="db-kd tom"></span>';
    for (let d = 1; d <= dagarIManad; d++) {
        const iso = d2iso(new Date(ar, mn - 1, d)), vd = (new Date(ar, mn - 1, d).getDay() + 6) % 7;
        const framtid = iso > IDAG;
        celler += '<button type="button" class="db-kd' + (vd > 4 ? " helg" : "") + (iso === IDAG ? " idag" : "") + (finns.has(iso) ? " har" : "") +
            '" data-dbdag="' + iso + '"' + (framtid ? " disabled" : "") + ' title="' + esc(dagEtikett(iso)) + (finns.has(iso) ? " · dagbok finns" : "") + '">' +
            d + (finns.has(iso) ? "<i></i>" : "") + "</button>";
    }
    const nasta = d2iso(new Date(ar, mn, 1)).slice(0, 7);
    box.innerHTML =
        '<p class="hjalp">Projekt: <b>' + esc(p.projekt) + "</b></p>" +
        '<div class="db-kal">' +
        '<div class="db-kalhuvud"><button type="button" class="db-kalpil" data-dbman="-1" aria-label="Föregående månad">‹</button>' +
        "<b>" + DB_MAN[mn - 1].charAt(0).toUpperCase() + DB_MAN[mn - 1].slice(1) + " " + ar + "</b>" +
        '<button type="button" class="db-kalpil" data-dbman="1" aria-label="Nästa månad"' + (nasta > IDAG.slice(0, 7) ? " disabled" : "") + ">›</button></div>" +
        '<div class="db-kalveckodagar">' + ["mån", "tis", "ons", "tor", "fre", "lör", "sön"].map(x => "<span>" + x + "</span>").join("") + "</div>" +
        '<div class="db-kalgrid">' + celler + "</div></div>" +
        '<p class="hjalp db-kalinfo"><i class="db-prick"></i> Dagar med en dagbok öppnar den. Datum, väder och dagens poster fylls i av sig själva.</p>';
}

document.addEventListener("click", (e) => {
    const t = e.target.closest && e.target.closest("#dbKalender [data-dbman], #dbKalender [data-dbdag]");
    if (!t || !dbKal)
        return;
    if (t.dataset.dbman) {
        const [ar, mn] = dbKal.manad.split("-").map(Number);
        dbKal.manad = d2iso(new Date(ar, mn - 1 + Number(t.dataset.dbman), 1)).slice(0, 7);
        return ritaDbKalender();
    }
    const iso = t.dataset.dbdag, p = plan4.projekt.find(x => x.id === dbKal.pid);
    if (!p)
        return;
    stangModal();
    const finns = (p.dagbok || []).find(d => d.datum === iso);
    if (finns)
        return visaDagbok(p.id, finns.id);
    if (!dbKanSkapa(p))
        return status("Bara huvudadmin och projektadmin kan skapa en dagbok", true);
    skapaDagbok(p, iso);
});
document.addEventListener("change", (e) => {
    if (e.target && e.target.id === "dbKalProj" && dbKal) { dbKal.pid = e.target.value; ritaDbKalender(); }
});

/* ---------- skapa ---------- */

// Alla poster på projektets tavlor en viss dag, plus produktionsmoment som pågår den dagen.
function dbPosterFor(p, iso) {
    const ut = [];
    p.tavlor.forEach(t => {
        dagsvyPoster(t, iso, p).forEach(k => {
            if (!k || k.attgora || !k.typ)
                return;
            ut.push({ id: (k.virtuell ? k.id : k.id) || uid(), kortId: k.virtuell ? null : k.id, tavla: t.namn, tavlaId: t.id,
                typ: k.typ, text: kortText(k, t, p) || k.text || TYPNAMN[k.typ], vem: k.vem || "", tid: k.tid || "", plats: delText(k.plats || ""),
                klarPaTavlan: !!k.klar, planerad: true, status: "", orsak: "", kommentar: "" });
        });
        // moment som pågår (start före dagen, klart efter)
        t.kort.filter(k => k.roll === "S" && k.kedja).forEach(k => {
            const per = momentPeriodI(t, k);
            if (per.fran < iso && iso < per.till && !ut.some(x => x.kortId === k.id))
                ut.push({ id: "p_" + k.id, kortId: k.id, tavla: t.namn, tavlaId: t.id, typ: "produktion", text: momentNamn(k) + " (pågående moment)",
                    vem: k.vem || "", tid: "", plats: delText(k.plats || ""), klarPaTavlan: false, planerad: true, status: "", orsak: "", kommentar: "" });
        });
    });
    return ut;
}

function dbVaderPlats(p) { return p.plats && p.plats.lat ? p.plats : VADERORT_STD; }

// Vädret för en dag: prognosens data för de senaste månaderna, arkivet för äldre dagar.
async function dbHamtaVader(p, iso) {
    const pl = dbVaderPlats(p);
    const falt = "daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum,wind_speed_10m_max,wind_gusts_10m_max" +
        "&wind_speed_unit=ms&timezone=Europe%2FStockholm&start_date=" + iso + "&end_date=" + iso;
    const dagarSedan = Math.round((iso2d(IDAG) - iso2d(iso)) / 86400000);
    const bas = dagarSedan <= 80 ? "https://api.open-meteo.com/v1/forecast" : "https://archive-api.open-meteo.com/v1/archive";
    const r = await fetch(bas + "?latitude=" + pl.lat + "&longitude=" + pl.lon + "&" + falt);
    if (!r.ok)
        throw new Error("HTTP " + r.status);
    const d = (await r.json()).daily || {};
    const v = (n) => d[n] && d[n][0] != null ? d[n][0] : null;
    if (v("temperature_2m_max") === null)
        throw new Error("Inget väder för dagen");
    const ut = { ort: pl.namn || "", kod: v("weather_code"), symbol: vaderSymbol(v("weather_code")), temp: v("temperature_2m_max"), tempMin: v("temperature_2m_min"),
        nederbord: v("precipitation_sum") || 0, sno: v("snowfall_sum") || 0, vind: v("wind_speed_10m_max") || 0, byvind: v("wind_gusts_10m_max"), hamtad: dbNu() };
    try { ut.bedomning = vaderBedomning(ut).status; } catch (e) { }
    return ut;
}

function skapaDagbok(p, iso) {
    if (!dbKanSkapa(p))
        return status("Bara huvudadmin och projektadmin kan skapa en dagbok", true);
    const jag = dbJag();
    const d = { id: uid(), datum: iso, skapad: dbNu(), av: jag.namn, avUid: jag.uid, andrad: dbNu(), andradAv: jag.namn,
        vader: null, vaderText: "", poster: dbPosterFor(p, iso), postHamtade: dbNu(),
        svar: { arbete: "", egna: "", ue: dbUeForslag(p, iso), avvikelse: "", orsaker: [], avvikelseText: "", ata: "", ataText: "", ovrigt: "" },
        godkand: null, historik: [{ tid: dbNu(), av: jag.namn, txt: "Dagboken skapades. Datum, väder och " + "dagens poster hämtades automatiskt." }], versioner: [] };
    p.dagbok = p.dagbok || [];
    p.dagbok.push(d);
    spara();
    visaDagbok(p.id, d.id);
    status("Dagbok för " + dbLangtDatum(iso).toLowerCase() + " skapad");
    dbHamtaVader(p, iso).then(v => {
        const h = dbHitta(p.id, d.id);
        if (!h || h.d.vader)
            return;
        h.d.vader = v;
        spara();
        if (dagbokOppen() && dbVy.id === d.id)
            ritaDagbok();
    }).catch(() => {
        const h = dbHitta(p.id, d.id);
        if (h) { h.d.vaderFel = true; if (dagbokOppen() && dbVy.id === d.id) ritaDagbok(); }
    });
}

// UE på plats enligt tavlan den dagen (förslag som går att ändra).
function dbUeForslag(p, iso) {
    const namn = [];
    p.tavlor.forEach(t => kortForDag(t, iso).filter(k => k.typ === "ue").forEach(k => {
        const n = (k.vem || k.text || "").trim();
        if (n && namn.indexOf(n) < 0) namn.push(n);
    }));
    return namn.join(", ");
}

function visaDagbok(pid, id) {
    dbSparaNu();
    if (!dagbokOppen()) {
        try { stangStart(); stangDash(); stangGantt(); stangBackup(); stangHjalp(); } catch (e) { }
        document.body.classList.add("dashlage");
        document.getElementById("dagbok").classList.remove("dold");
    }
    dbVy.lage = "visa"; dbVy.projekt = pid; dbVy.id = id;
    ritaDagbok();
    window.scrollTo({ top: 0 });
}

/* ---------- en dagbok ---------- */

function dbVaderHtml(d, kan) {
    const v = d.vader;
    const auto = v ? '<div class="db-vader"><span class="db-vsym">' + v.symbol + "</span><div><b>" + Math.round(v.temp) + "° / " + Math.round(v.tempMin) + "°</b>" +
        "<small>" + [v.nederbord ? String(v.nederbord.toFixed(1)).replace(".", ",") + " mm" : "Uppehåll", v.sno ? Math.round(v.sno) + " cm snö" : "",
            "vind " + Math.round(v.vind) + " m/s" + (v.byvind ? ", byar " + Math.round(v.byvind) : ""), v.bedomning || ""].filter(Boolean).join(" · ") + "</small>" +
        '<small class="db-kalla">Hämtat automatiskt' + (v.ort ? " för " + esc(v.ort) : "") + "</small></div></div>"
        : '<div class="db-vader tom">' + (d.vaderFel ? "Vädret kunde inte hämtas för dagen. Skriv det nedan." : "Hämtar väder…") +
          (d.vaderFel && kan ? ' <button type="button" class="mknapp" data-dbgor="vader">Försök igen</button>' : "") + "</div>";
    return auto + '<label class="db-lbl" for="dbVaderText">Väder på plats <span>(komplettera vid behov)</span></label>' +
        '<input class="f" id="dbVaderText" data-dbfalt="vaderText" maxlength="200" placeholder="T.ex. regn på förmiddagen, uppehåll efter lunch"' +
        ' value="' + esc(d.vaderText || "") + '"' + (kan ? "" : " disabled") + ">";
}

function dbPosterHtml(d, kan) {
    const poster = d.poster || [];
    if (!poster.length)
        return '<p class="db-inga">Inga poster på tavlan den här dagen.</p>';
    const ordning = ["produktion", "ue", "leverans", "avrop", "mote", "franvaro", "ovrigt"];
    const sorterade = poster.slice().sort((a, b) => ordning.indexOf(a.typ) - ordning.indexOf(b.typ));
    return '<ul class="db-poster">' + sorterade.map(x => {
        const i = poster.indexOf(x);
        const bekr = x.typ === "produktion" || x.typ === "ue" || x.typ === "leverans" || x.typ === "avrop";
        return '<li class="db-post t-' + esc(x.typ) + (x.status ? " s-" + x.status : "") + '">' +
            '<span class="db-ptyp">' + esc((TYPNAMN[x.typ] || x.typ).split(" /")[0]) + "</span>" +
            '<div class="db-ptext"><b>' + esc(x.text) + "</b><small>" + esc([x.tid, x.vem, x.plats, plan4.projekt.length && x.tavla].filter(Boolean).join(" · ")) +
            (x.klarPaTavlan ? ' · <span class="db-ok">klarmarkerad på tavlan</span>' : "") + "</small>" +
            (bekr ? '<div class="db-pval">' +
                '<select class="f" data-dbpost="' + i + '" data-dbpf="status"' + (kan ? "" : " disabled") + ' aria-label="Utfört?">' +
                DB_STATUS.map(s => '<option value="' + s.id + '"' + ((x.status || "") === s.id ? " selected" : "") + ">" +
                    (s.id === "" ? "Planerat – bekräfta" : s.namn) + "</option>").join("") + "</select>" +
                (x.status === "ej" ? '<select class="f" data-dbpost="' + i + '" data-dbpf="orsak"' + (kan ? "" : " disabled") + ' aria-label="Orsak">' +
                    '<option value="">Vad berodde det på?</option>' + DB_ORSAKER.map(o => "<option" + (x.orsak === o ? " selected" : "") + ">" + o + "</option>").join("") + "</select>" : "") +
                "</div>" +
                (x.status === "ej" || x.kommentar ? '<input class="f db-pkom" data-dbpost="' + i + '" data-dbpf="kommentar" maxlength="300" placeholder="Kort kommentar"' +
                    ' value="' + esc(x.kommentar || "") + '"' + (kan ? "" : " disabled") + ">" : "") : "") +
            "</div></li>";
    }).join("") + "</ul>";
}

function dbJaNej(falt, varde, kan) {
    return '<div class="db-janej" role="radiogroup">' + [["nej", "Nej"], ["ja", "Ja"]].map(([v, t]) =>
        '<button type="button" role="radio" aria-checked="' + (varde === v) + '" class="' + (varde === v ? "vald" : "") + '" data-dbjn="' + falt + '" data-v="' + v + '"' +
        (kan ? "" : " disabled") + ">" + t + "</button>").join("") + "</div>";
}

function ritaEnDagbok(el, p, d) {
    const kan = dbKanAndra(p), s = d.svar || (d.svar = {});
    const poster = d.poster || [];
    const prod = poster.filter(x => x.typ === "produktion" || x.typ === "ue");
    const obekr = poster.filter(x => (x.typ === "produktion" || x.typ === "ue" || x.typ === "leverans" || x.typ === "avrop") && !x.status).length;
    const ej = poster.filter(x => x.status === "ej");
    const ta = (id, falt, ph, rader) => '<textarea class="f db-ta" id="' + id + '" data-dbfalt="' + falt + '" rows="' + (rader || 3) + '" maxlength="4000" placeholder="' + esc(ph) + '"' +
        (kan ? "" : " disabled") + ">" + esc(s[falt] || "") + "</textarea>";
    const fraga = (nr, rubrik, fragetext, inne, klar) => '<section class="db-fraga' + (klar ? " besvarad" : "") + '"><header><span class="db-nr">' + nr + "</span><div><h3>" + rubrik + "</h3><p>" +
        fragetext + "</p></div></header>" + inne + "</section>";
    const besvarat = [!!(s.arbete || prod.some(x => x.status)), !!(s.egna || s.ue), !!s.avvikelse, !!s.ata, true];
    el.innerHTML =
        '<section class="db-sida db-en">' +
        '<div class="db-tillbaka"><button type="button" class="mknapp" data-dbgor="lista">← Alla dagböcker</button>' +
        '<span class="db-sparad" id="dbSparad">' + (d.andrad ? "Sparat " + dbTid(d.andrad) : "") + "</span></div>" +
        '<header class="db-entopp"><div><span class="db-proj">' + esc(p.projekt) + "</span><h2>" + esc(dbLangtDatum(d.datum)) + "</h2>" +
        "<p>Vecka " + veckonr(d.datum) + " · skapad av " + esc(d.av || "–") + " " + dbTid(d.skapad) + "</p></div>" +
        '<div class="db-enknappar">' + (d.godkand ? '<span class="db-tagg gron stor">Godkänd av ' + esc(d.godkand.av) + " " + dbTid(d.godkand.tid) + "</span>" : '<span class="db-tagg gul stor">Utkast</span>') +
        '<button type="button" class="mknapp" data-dbgor="skrivut">Skriv ut / PDF</button>' +
        (kan && !d.godkand ? '<button type="button" class="mknapp primar" data-dbgor="godkann">Godkänn dagboken</button>' : "") +
        "</div></header>" +
        (obekr ? '<div class="notis gul db-notis">' + obekr + (obekr === 1 ? " planerad post är" : " planerade poster är") + " inte bekräftade. Planerat räknas inte som utfört förrän du bekräftat det.</div>" : "") +
        '<div class="db-grid">' +
        '<div class="db-kol">' +
        '<section class="db-kort"><h3>Väder</h3>' + dbVaderHtml(d, kan) + "</section>" +
        '<section class="db-kort"><div class="db-kortrubrik"><h3>Dagens poster <span>' + poster.length + "</span></h3>" +
        (kan ? '<button type="button" class="mknapp liten" data-dbgor="hamta" title="Hämta posterna från tavlan igen">Hämta igen</button>' : "") + "</div>" +
        '<p class="db-kalla">Hämtat från tavlan ' + dbTid(d.postHamtade) + ". Bekräfta vad som faktiskt blev gjort.</p>" + dbPosterHtml(d, kan) + "</section>" +
        "</div>" +
        '<div class="db-kol">' +
        fraga(1, "Påbörjat, pågående och avslutat", "Vilka arbeten påbörjades, pågick eller avslutades idag? Bekräfta posterna till vänster och skriv det som saknas.",
            ta("dbArbete", "arbete", "T.ex. Påbörjat formsättning bjälklag plan 2. Avslutat armering hus A.", 3), besvarat[0]) +
        fraga(2, "Arbetsstyrka", "Hur många var på plats, egen personal och underentreprenörer?",
            '<div class="db-tva"><label class="db-lbl">Egen personal<input class="f" data-dbfalt="egna" inputmode="numeric" maxlength="6" placeholder="Antal" value="' + esc(s.egna || "") + '"' + (kan ? "" : " disabled") + "></label>" +
            '<label class="db-lbl">UE på plats<input class="f" data-dbfalt="ue" maxlength="300" placeholder="Firma och antal, t.ex. Golvbolaget 3" value="' + esc(s.ue || "") + '"' + (kan ? "" : " disabled") + "></label></div>", besvarat[1]) +
        fraga(3, "Avvikelser, störningar och hinder", "Har något stört, försenat eller hindrat arbetet idag?" +
            (ej.length ? " <b>" + ej.length + (ej.length === 1 ? " post blev" : " poster blev") + " inte utförda.</b>" : ""),
            dbJaNej("avvikelse", s.avvikelse, kan) +
            (s.avvikelse === "ja" ? '<div class="db-orsaker">' + DB_ORSAKER.map(o => '<label class="db-chip"><input type="checkbox" data-dborsak="' + esc(o) + '"' +
                ((s.orsaker || []).indexOf(o) >= 0 ? " checked" : "") + (kan ? "" : " disabled") + "><span>" + o + "</span></label>").join("") + "</div>" +
                ta("dbAvv", "avvikelseText", "Vad hände, när, vilka arbeten och resurser påverkades? Pågår det fortfarande? Kända konsekvenser för tid eller kostnad (eller: kan inte bedömas än).", 4) +
                '<p class="db-juridik">En dagboksanteckning är inte en hinderanmälan. Kan det påverka tid eller kostnad behöver beställaren underrättas separat.' +
                (kan ? ' <button type="button" class="mknapp liten" data-dbgor="hinder">Lägg i hinderlistan</button>' : "") + "</p>" : ""), besvarat[2]) +
        fraga(4, "Ändringar och tilläggsarbeten", "Har något ändrats, tillkommit eller utgått (ÄTA)?",
            dbJaNej("ata", s.ata, kan) +
            (s.ata === "ja" ? ta("dbAta", "ataText", "Vad gäller det, vem beställde eller beslutade, och vilka arbeten berörs?", 3) +
                '<p class="db-juridik">En anteckning här är inte en ÄTA-underrättelse eller beställning. Den måste göras separat enligt avtalet.</p>' : ""), besvarat[3]) +
        fraga(5, "Övrigt", "Något annat av betydelse för entreprenaden? Besök, beslut, leveranser, säkerhet, nya eller ändrade handlingar.",
            ta("dbOvrigt", "ovrigt", "T.ex. Besiktning av armering med konstruktör. Nya ritningar K-20-1-03 rev B.", 3), besvarat[4]) +
        "</div></div>" +
        '<section class="db-kort db-historik"><h3>Historik</h3><ul>' + (d.historik || []).slice().reverse().map(h =>
            "<li><b>" + dbTid(h.tid) + "</b> " + esc(h.av || "") + " · " + esc(h.txt) + "</li>").join("") + "</ul>" +
        (kan && dbVy.raderaOk !== false ? '<button type="button" class="mknapp fara liten" data-dbgor="radera">Ta bort dagboken</button>' : "") + "</section>" +
        "</section>";
}

/* ---------- ändringar ---------- */

function dbAktuell() { return dbVy.lage === "visa" ? dbHitta(dbVy.projekt, dbVy.id) : null; }

// En ändring i en godkänd dagbok är en komplettering: den förra versionen sparas och det syns när den gjordes.
function dbAndrat(h, vad) {
    const jag = dbJag(), d = h.d;
    if (d.godkand && !d._kompletterar) {
        d.versioner = d.versioner || [];
        d.versioner.push({ tid: dbNu(), godkand: d.godkand, svar: JSON.parse(JSON.stringify(d.svar || {})), poster: JSON.parse(JSON.stringify(d.poster || [])),
            vaderText: d.vaderText || "" });
        d.historik.push({ tid: dbNu(), av: jag.namn, txt: "Komplettering efter godkännande (" + vad + "). Den godkända versionen är sparad." });
        d.godkand = null;
        d._kompletterar = true;
    }
    d.andrad = dbNu();
    d.andradAv = jag.namn;
    clearTimeout(dbSparaTimer);
    dbSparaTimer = setTimeout(dbSparaNu, 600);
    const el = document.getElementById("dbSparad");
    if (el) el.textContent = "Sparar…";
}
function dbSparaNu() {
    if (!dbSparaTimer)
        return;
    clearTimeout(dbSparaTimer);
    dbSparaTimer = null;
    spara();
    const el = document.getElementById("dbSparad"), h = dbAktuell();
    if (el && h) el.textContent = "Sparat " + dbTid(h.d.andrad);
}

document.addEventListener("input", (e) => {
    const t = e.target;
    if (!t || !t.closest || !t.closest("#dagbok"))
        return;
    if (t.id === "dbSok") { dbVy.sok = t.value; const pos = t.selectionStart; ritaDagbok(); const n = document.getElementById("dbSok"); if (n) { n.focus(); n.setSelectionRange(pos, pos); } return; }
    const h = dbAktuell();
    if (!h)
        return;
    if (t.dataset.dbfalt) {
        if (t.dataset.dbfalt === "vaderText") h.d.vaderText = t.value;
        else h.d.svar[t.dataset.dbfalt] = t.value;
        dbAndrat(h, { vaderText: "väder", arbete: "arbeten", egna: "arbetsstyrka", ue: "arbetsstyrka", avvikelseText: "avvikelser", ataText: "ÄTA", ovrigt: "övrigt" }[t.dataset.dbfalt] || "text");
    }
    else if (t.dataset.dbpost && t.dataset.dbpf === "kommentar") {
        h.d.poster[+t.dataset.dbpost].kommentar = t.value;
        dbAndrat(h, "poster");
    }
});

document.addEventListener("change", (e) => {
    const t = e.target;
    if (!t || !t.closest || !t.closest("#dagbok"))
        return;
    if (t.id === "dbFilter") { dbVy.filter = t.value; return ritaDagbok(); }
    const h = dbAktuell();
    if (!h)
        return;
    if (t.dataset.dbpost && (t.dataset.dbpf === "status" || t.dataset.dbpf === "orsak")) {
        const x = h.d.poster[+t.dataset.dbpost];
        x[t.dataset.dbpf] = t.value;
        if (t.dataset.dbpf === "status" && t.value !== "ej") x.orsak = "";
        // ej utfört: avvikelsefrågan blir ja och orsaken följer med
        if (x.status === "ej") {
            h.d.svar.avvikelse = "ja";
            if (x.orsak && (h.d.svar.orsaker || []).indexOf(x.orsak) < 0) h.d.svar.orsaker = (h.d.svar.orsaker || []).concat(x.orsak);
        }
        dbAndrat(h, "poster");
        dbSparaNu();
        return ritaDagbok();
    }
    if (t.dataset.dborsak) {
        const o = t.dataset.dborsak, l = h.d.svar.orsaker || [];
        h.d.svar.orsaker = t.checked ? l.concat(o) : l.filter(x => x !== o);
        dbAndrat(h, "avvikelser");
    }
});

document.addEventListener("click", (e) => {
    const t = e.target.closest && e.target.closest("#dagbok [data-dbvisa], #dagbok [data-dbgor], #dagbok [data-dbjn], #dagbok #dbNy");
    if (!t)
        return;
    if (t.id === "dbNy")
        return nyDagbokDialog();
    if (t.dataset.dbvisa) {
        const [pid, id] = t.dataset.dbvisa.split("|");
        return visaDagbok(pid, id);
    }
    const h = dbAktuell();
    if (t.dataset.dbjn && h) {
        h.d.svar[t.dataset.dbjn] = t.dataset.v;
        dbAndrat(h, t.dataset.dbjn === "ata" ? "ÄTA" : "avvikelser");
        dbSparaNu();
        return ritaDagbok();
    }
    const gor = t.dataset.dbgor;
    if (gor === "lista") { dbSparaNu(); dbVy.lage = "lista"; return ritaDagbok(); }
    if (!h)
        return;
    if (gor === "vader") {
        h.d.vaderFel = false; ritaDagbok();
        return dbHamtaVader(h.p, h.d.datum).then(v => { h.d.vader = v; dbAndrat(h, "väder"); dbSparaNu(); ritaDagbok(); })
            .catch(() => { h.d.vaderFel = true; ritaDagbok(); });
    }
    if (gor === "hamta") return dbHamtaIgen(h);
    if (gor === "godkann") return dbGodkann(h);
    if (gor === "skrivut") { dbSparaNu(); return dbSkrivUt(h.p, h.d); }
    if (gor === "hinder") return dbTillHinder(h);
    if (gor === "radera") {
        return modal("Ta bort dagboken?", dbLangtDatum(h.d.datum), '<p class="hjalp" style="margin:0">Dagboken för ' + esc(dbLangtDatum(h.d.datum).toLowerCase()) +
            " i " + esc(h.p.projekt) + " tas bort för alla i projektet. Det går inte att ångra.</p>", [
            { txt: "Avbryt", fn: stangModal },
            { txt: "Ta bort", fara: true, fn: () => {
                h.p.dagbok = h.p.dagbok.filter(x => x !== h.d);
                stangModal(); spara(); dbVy.lage = "lista"; ritaDagbok(); status("Dagboken är borttagen");
            } }]);
    }
});

// Hämtar dagens poster igen och behåller det man redan bekräftat.
function dbHamtaIgen(h) {
    const gamla = new Map((h.d.poster || []).map(x => [x.kortId || x.id, x]));
    const nya = dbPosterFor(h.p, h.d.datum).map(x => {
        const g = gamla.get(x.kortId || x.id);
        return g ? Object.assign(x, { status: g.status, orsak: g.orsak, kommentar: g.kommentar }) : x;
    });
    // poster som inte finns på tavlan längre men har bekräftats ligger kvar
    (h.d.poster || []).forEach(g => { if ((g.status || g.kommentar) && !nya.some(x => (x.kortId || x.id) === (g.kortId || g.id))) nya.push(Object.assign({}, g, { borta: true })); });
    h.d.poster = nya;
    h.d.postHamtade = dbNu();
    h.d.historik.push({ tid: dbNu(), av: dbJag().namn, txt: "Dagens poster hämtades igen från tavlan." });
    dbAndrat(h, "poster");
    dbSparaNu();
    ritaDagbok();
    status("Posterna är uppdaterade från tavlan");
}

function dbGodkann(h) {
    const obekr = (h.d.poster || []).filter(x => (x.typ === "produktion" || x.typ === "ue" || x.typ === "leverans" || x.typ === "avrop") && !x.status).length;
    const kor = () => {
        const jag = dbJag();
        h.d.godkand = { av: jag.namn, uid: jag.uid, tid: dbNu() };
        delete h.d._kompletterar;
        h.d.historik.push({ tid: dbNu(), av: jag.namn, txt: "Dagboken godkändes." });
        h.d.andrad = dbNu();
        stangModal();
        spara();
        ritaDagbok();
        status("Dagboken är godkänd");
    };
    if (!obekr)
        return kor();
    modal("Godkänna ändå?", "", '<p class="hjalp" style="margin:0">' + obekr + (obekr === 1 ? " planerad post är" : " planerade poster är") +
        " inte bekräftade. De står kvar som planerade i dagboken, inte som utförda.</p>",
        [{ txt: "Avbryt", fn: stangModal }, { txt: "Godkänn ändå", primar: true, fn: kor }]);
}

// En avvikelse blir ett hinder i hinderlistan på tavlan (dagboken är ingen hinderanmälan).
function dbTillHinder(h) {
    const s = h.d.svar, text = (s.avvikelseText || "").trim() || (s.orsaker || []).join(", ");
    if (!text)
        return status("Skriv vad som hände först", true);
    const t = h.p.tavlor.find(x => x.id === (h.p === state ? state.aktiv : "")) || h.p.tavlor[0];
    try {
        const patch = opNyttHinder(text.slice(0, 200), "", "");
        if (patch && patch.ok && appliceraPatch(patch, { tavla: t, projekt: h.p })) {
            h.d.historik.push({ tid: dbNu(), av: dbJag().namn, txt: "Avvikelsen lades i hinderlistan på " + t.namn + "." });
            dbAndrat(h, "hinder"); dbSparaNu(); rita(); ritaDagbok();
            return status("Lagt i hinderlistan på " + t.namn);
        }
    } catch (e) { }
    status("Det gick inte att lägga i hinderlistan", true);
}

/* ---------- utskrift ---------- */

function dbSkrivUt(p, d) {
    const s = d.svar || {}, v = d.vader;
    const rad = (rub, txt) => txt ? "<h3>" + rub + "</h3><p>" + esc(txt).replace(/\n/g, "<br>") + "</p>" : "";
    const statusNamn = (x) => (DB_STATUS.find(y => y.id === (x.status || "")) || DB_STATUS[0]).namn;
    const html = '<!doctype html><html lang="sv"><head><meta charset="utf-8"><title>Dagbok ' + esc(p.projekt) + " " + d.datum + "</title><style>" +
        "body{font-family:Inter,system-ui,sans-serif;color:#181c19;margin:28px;font-size:12px;line-height:1.45}h1{font-size:20px;margin:0}h2{font-size:14px;margin:18px 0 6px;border-bottom:1px solid #ccc;padding-bottom:3px}" +
        "h3{font-size:12px;margin:10px 0 2px}p{margin:0 0 6px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:4px 6px;text-align:left;vertical-align:top}" +
        "th{background:#f3f1ea}.liten{color:#56615a;font-size:11px}.ruta{border:1px solid #ddd;padding:8px;border-radius:6px;margin:6px 0}</style></head><body>" +
        "<h1>Byggdagbok · " + esc(p.projekt) + "</h1><p class=liten>" + esc(dbLangtDatum(d.datum)) + " · vecka " + veckonr(d.datum) + " · skapad av " + esc(d.av || "") + " " + dbTid(d.skapad) +
        " · " + (d.godkand ? "godkänd av " + esc(d.godkand.av) + " " + dbTid(d.godkand.tid) : "ej godkänd (utkast)") + "</p>" +
        "<h2>Väder</h2><p>" + (v ? v.symbol + " " + Math.round(v.temp) + "° / " + Math.round(v.tempMin) + "°, " + String((v.nederbord || 0).toFixed(1)).replace(".", ",") + " mm, vind " +
            Math.round(v.vind) + " m/s" + (v.byvind ? " (byar " + Math.round(v.byvind) + ")" : "") + (v.ort ? " · " + esc(v.ort) + " (automatiskt hämtat)" : "") : "Inte hämtat") +
            (d.vaderText ? "<br>På plats: " + esc(d.vaderText) : "") + "</p>" +
        "<h2>Dagens poster (från tavlan)</h2>" + ((d.poster || []).length ? "<table><tr><th>Typ</th><th>Post</th><th>Vem</th><th>Status</th><th>Kommentar</th></tr>" +
            d.poster.map(x => "<tr><td>" + esc((TYPNAMN[x.typ] || "").split(" /")[0]) + "</td><td>" + esc(x.text) + (x.tavla ? " <span class=liten>(" + esc(x.tavla) + ")</span>" : "") + "</td><td>" +
                esc(x.vem || "") + "</td><td>" + statusNamn(x) + (x.orsak ? ": " + esc(x.orsak) : "") + "</td><td>" + esc(x.kommentar || "") + "</td></tr>").join("") + "</table>" : "<p>Inga poster.</p>") +
        "<h2>1. Påbörjat, pågående och avslutat</h2><p>" + (esc(s.arbete || "").replace(/\n/g, "<br>") || "–") + "</p>" +
        "<h2>2. Arbetsstyrka</h2><p>Egen personal: " + esc(s.egna || "–") + "<br>UE: " + esc(s.ue || "–") + "</p>" +
        "<h2>3. Avvikelser, störningar och hinder</h2><p>" + (s.avvikelse === "ja" ? "Ja" + ((s.orsaker || []).length ? " – " + esc(s.orsaker.join(", ")) : "") : s.avvikelse === "nej" ? "Nej" : "–") + "</p>" + rad("Beskrivning", s.avvikelseText) +
        "<h2>4. Ändringar och tilläggsarbeten (ÄTA)</h2><p>" + (s.ata === "ja" ? "Ja" : s.ata === "nej" ? "Nej" : "–") + "</p>" + rad("Beskrivning", s.ataText) +
        "<h2>5. Övrigt</h2><p>" + (esc(s.ovrigt || "").replace(/\n/g, "<br>") || "–") + "</p>" +
        "<h2>Historik</h2>" + (d.historik || []).map(h => "<p class=liten>" + dbTid(h.tid) + " · " + esc(h.av || "") + " · " + esc(h.txt) + "</p>").join("") +
        "<script>window.onload=function(){setTimeout(function(){window.print()},200)}<\/script></body></html>";
    const w = window.open("", "_blank");
    if (!w)
        return status("Tillåt popup-fönster för att skriva ut dagboken", true);
    w.document.open();
    w.document.write(html);
    w.document.close();
}

// Dagboken hålls aktuell när projekten ändras (synk från andra enheter).
const ursRitaDagbok = rita;
rita = function () {
    const r = ursRitaDagbok.apply(this, arguments);
    try {
        if (dagbokOppen() && !(document.activeElement && document.activeElement.closest && document.activeElement.closest("#dagbok") &&
            /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)))
            ritaDagbok();
    } catch (e) { }
    return r;
};
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && dagbokOppen() && !document.getElementById("overlay") && dbVy.lage === "visa") {
        dbSparaNu(); dbVy.lage = "lista"; ritaDagbok();
    }
});
window.addEventListener("beforeunload", dbSparaNu);
