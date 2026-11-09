/* ======================================================================
   Grund: konstanter, data, lagring och hjälpfunktioner
   ====================================================================== */

/* ---------- konstanter ---------- */

const NYCKEL = "fyraveckorstavlan_v2";
const VERSION = "1.6.2a";
const DAGNAMN = ["Måndag", "Tisdag", "Onsdag", "Torsdag", "Fredag"];

const ORSAKSORD = ["Material", "Bemanning", "Föregående ej klart", "Handling", "Beslut/besked",
    "Egen planering", "Väder", "Maskin", "UE", "Övrigt"];

const ABTEXT = { behovs: "Behöver utföras", planerad: "Planerad", utford: "Utförd" };

const TYPNAMN = { mote: "Möte", produktion: "Produktion", avrop: "Avrop", leverans: "Leverans / UE / viktigt",
    franvaro: "Frånvaro", ovrigt: "Övrigt" };

const FRANVARO = ["Sjukdom", "Ledighet", "VAB", "Annat"];
const TYPER = Object.keys(TYPNAMN);

/* ---------- datum ---------- */

// Dagens datum. Uppdateras när datumet byts medan sidan står öppen (t.ex. på en TV i bodan),
// så att Projektöversikten, Veckans utfall och tavlan inte fastnar på gårdagen.
let IDAG = d2iso(new Date());

function kollaNyDag() {
    const d = d2iso(new Date());
    if (d === IDAG)
        return;
    IDAG = d;
    try { rita(); } catch (e) { }
    try { if (typeof dashOppen === "function" && dashOppen()) ritaDash(); } catch (e) { }
    try { if (typeof startOppen === "function" && startOppen()) ritaStart(); } catch (e) { }
    try { if (typeof ganttOppen === "function" && ganttOppen()) ritaGantt(); } catch (e) { }
    try { if (typeof backupOppen === "function" && backupOppen()) ritaBackup(); } catch (e) { }
}
setInterval(kollaNyDag, 60000);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") kollaNyDag(); });
window.addEventListener("focus", kollaNyDag);

/* ---------- data ---------- */

let plan4 = { version: VERSION, aktivtProjekt: null, projekt: [] };
let state = { projekt: "", tavlor: [], aktiv: null };

function aktivaProjekt() { return plan4.projekt.filter(p => !p.arkiverad); }

function valjProjekt(id) {
    const p = plan4.projekt.find(x => x.id === id);
    if (!p)
        return;
    angraForeAvbryt();
    state = p;
    plan4.aktivtProjekt = p.id;
    vyOffset = 0;
    visaVeckor = 2;
    valdKedja = null;
    VADER = {};
    spara();
    rita();
}

let valdKedja = null;

function T() { return state.tavlor.find(t => t.id === state.aktiv) || state.tavlor[0]; }

function laddaRot(d) {
    if (!d)
        return false;
    if (Array.isArray(d.projekt) && !d.tavlor) {
        plan4 = { version: d.version || VERSION, aktivtProjekt: d.aktivtProjekt || null, projekt: d.projekt };
    }
    else if (d.tavlor && d.tavlor.length) {
        const gammalt = d;
        gammalt.id = gammalt.id || uid();
        if (typeof gammalt.projekt !== "string" || !gammalt.projekt)
            gammalt.projekt = "Projekt 1";
        plan4 = { version: VERSION, aktivtProjekt: gammalt.id, projekt: [gammalt] };
    }
    else
        return false;
    plan4.projekt.forEach(p => rustaProjekt(p, IDAG));
    if (!plan4.projekt.length)
        return false;
    const vald = plan4.projekt.find(p => p.id === plan4.aktivtProjekt && !p.arkiverad)
        || aktivaProjekt()[0] || plan4.projekt[0];
    state = vald;
    plan4.aktivtProjekt = vald.id;
    return true;
}

let vyOffset = 0;
let visaVeckor = 1;

function ritStart() {
    const vs = visaStart();
    if (!document.body.classList.contains("visning") || vyOffset !== 0)
        return vs;
    return vs;
}

function antalVeckor() { return document.body.classList.contains("visning") ? visaVeckor : 4; }

// Tavlan börjar alltid på innevarande vecka, med de tre kommande under.
// Räknas fram från dagens datum (sparas inte), så alla tavlor och alla användare visar samma veckor.
function tavlaStart() { return d2iso(mandag(iso2d(IDAG))); }

function visaStart() { return plus(tavlaStart(), vyOffset * 7); }

/* ---------- lagring ---------- */

let sparaTimer = null;

function status(txt, kvar) {
    const el = document.getElementById("status");
    el.textContent = txt;
    if (txt && !kvar)
        setTimeout(() => { if (el.textContent === txt)
            el.textContent = ""; }, 2600);
}

let lagringslage = "okand";

function lagringstext() {
    return lagringslage === "lokal" ? " · lokalt på denna dator" : lagringslage === "ingen" ? " · ingen automatisk lagring" : "";
}

function rotdata() {
    plan4.version = VERSION;
    plan4.aktivtProjekt = state.id || plan4.aktivtProjekt;
    return plan4;
}

async function sparaNu() {
    const data = JSON.stringify(rotdata());
    try {
        if (window.storage && window.storage.set) {
            await window.storage.set(NYCKEL, data);
            lagringslage = "storage";
            return true;
        }
    }
    catch (e) { }
    try {
        if (window.localStorage) {
            window.localStorage.setItem(NYCKEL, data);
            lagringslage = "lokal";
            return true;
        }
    }
    catch (e) {
        lagringslage = "ingen";
        return false;
    }
    lagringslage = "ingen";
    return false;
}

let sparaVantar = false;

function spara() {
    clearTimeout(sparaTimer);
    sparaVantar = true;
    sparaTimer = setTimeout(async () => {
        sparaTimer = null;
        sparaVantar = false;
        const gick = await sparaNu();
        if (gick)
            status("Sparat " + new Date().toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" }) + lagringstext());
        else
            status("Kunde inte spara på den här datorn", true);
    }, 400);
}

function sparaVantande() {
    if (!sparaVantar)
        return;
    clearTimeout(sparaTimer);
    sparaTimer = null;
    sparaVantar = false;
    sparaNu();
}

document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden")
    sparaVantande(); });

window.addEventListener("pagehide", sparaVantande);

async function las() {
    try {
        if (window.storage && window.storage.get) {
            const r = await window.storage.get(NYCKEL);
            if (r && r.value) {
                lagringslage = "storage";
                return JSON.parse(r.value);
            }
        }
    }
    catch (e) { }
    try {
        if (window.localStorage) {
            const v = window.localStorage.getItem(NYCKEL);
            lagringslage = "lokal";
            if (v)
                return JSON.parse(v);
        }
    }
    catch (e) {
        lagringslage = "ingen";
    }
    return null;
}

function logg(txt) {
    const t = T();
    t.historik.unshift(typeof txt === "object" && txt
        ? { id: txt.id, tid: txt.tid, txt: txt.txt }
        : { id: uid(), tid: new Date().toISOString(), txt: txt });
    if (t.historik.length > 300)
        t.historik.length = 300;
}

/* ---------- hjälp ---------- */

function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

function dagar() { const ut = [], s = visaStart(); for (let v = 0; v < 4; v++)
    for (let d = 0; d < 5; d++)
        ut.push(plus(s, v * 7 + d)); return ut; }

function inomTavlan(iso) { const a = dagar(); return iso >= a[0] && iso <= a[a.length - 1]; }
