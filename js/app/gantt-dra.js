/* ======================================================================
   Gantt-schemat: skapa och dra direkt i schemat.

   Sista raden i varje projekt är tom: skriv ett namn och tryck Enter, välj
   typ i rutan som kommer upp, så skapas det direkt i schemat och blinkar
   några sekunder.
     Produktionsmoment  stapel från idag och en vecka fram
     Avrop / Leverans   diamant på idag
   Dra en stapel för att flytta momentet, dra i kanterna för att ändra start
   eller slut. Dra en diamant för att flytta avropet eller leveransen. Allt
   sparas direkt på tavlan. Lördag och söndag finns inte på tavlan, så datum
   som hamnar på en helg läggs på närmaste vardag.
   ====================================================================== */

const BLINK_MS = 4000;

const gVardag = (iso) => (iso2d(iso).getDay() + 6) % 7 < 5;
// Helg: framåt till måndag eller bakåt till fredag.
function gSnap(iso, riktning) {
    let d = iso;
    while (!gVardag(d))
        d = plus(d, riktning < 0 ? -1 : 1);
    return d;
}
const gArbDagar = (fran, till) => arbetsdagarMellan(fran, till) + 1;
const gKlon = (k) => JSON.parse(JSON.stringify(k));

/* ---------- ett moment eller en milstolpe ---------- */

function gPost(nyckel) {
    const [pid, tid, kid] = String(nyckel || "").split("|");
    const p = plan4.projekt.find(x => x.id === pid);
    const t = p && p.tavlor.find(x => x.id === tid);
    const k = t && t.kort.find(x => x.id === kid);
    if (!k)
        return null;
    const mil = k.typ === "avrop" || k.typ === "leverans";
    const slut = mil ? null : slutPostI(t, k);
    const kedja = !mil && k.kedja ? t.kort.filter(x => x.kedja === k.kedja) : [k];
    const klar = slut ? !!slut.klar : !!k.klar;
    return { p, t, k, mil, slut, kedja, fran: k.dag, till: slut && slut.dag > k.dag ? slut.dag : k.dag, klar,
        kanAndra: ganttKanRedigera(p, t) && !klar };
}

/* ---------- ändringar ---------- */

// Flyttar ett kort och samlar ångra-uppgifter. Datum i en kopplad materialrad följer med.
function gFlyttaKort(m, kort, nyDag, fore) {
    if (!nyDag || nyDag === kort.dag)
        return true;
    const t = m.t, lank = lankadRad(t, kort);
    const agare = lank ? t.kort.find(x => (x.material || []).indexOf(lank.rad) >= 0 || x.avrop === lank.rad) : null;
    const patch = opFlyttaKort(kort, nyDag, null, null, lank && agare ? { agare, del: lank.del, radId: lank.rad && lank.rad.id } : null);
    if (!appliceraPatch(patch, { tavla: t, projekt: m.p }))
        return false;
    patch.fore.forEach(f => { if (!fore.some(x => x.objekt === f.objekt && x.id === f.id)) fore.push(f); });
    return true;
}

function gKlar(m, fore, txt) {
    logg2(m.t, txt + " (Gantt-schemat)");
    spara();
    if (fore.length)
        angraForeKlar(txt, fore, m.t, m.p);
    rita();
    if (!ganttOppen())
        ritaGantt();
    status(txt);
}

// En endagspost blir Start → Klart när den dras ut till fler dagar.
function gTillKedja(m, fran, till, fore) {
    const k = m.k, namn = momentNamn(k), kedja = k.kedja || "k" + uid();
    fore.push({ objekt: "kort", id: k.id, varde: gKlon(k) });
    if (!appliceraPatch({ ok: true, fel: null, andringar: [{ typ: "satt", objekt: "kort", id: k.id,
        falt: { roll: "S", kedja, text: "Start " + namn, dag: fran, ordning: null } }], fore: [], historik: [] }, { tavla: m.t, projekt: m.p }))
        return false;
    const p2 = opNyttKort({ dag: till, typ: "produktion", roll: "K", text: namn + " klart", vem: k.vem || "", kedja }, m.t.id);
    if (!appliceraPatch(p2, { tavla: m.t, projekt: m.p }))
        return false;
    const ny = m.t.kort.find(x => x.id === p2.andringar[0].id);
    if (ny && k.plats)
        ny.plats = k.plats;
    fore.push(p2.fore[0]);
    return true;
}

function gNamn(m) { return m.mil ? (m.k.text || (m.k.typ === "avrop" ? "Avrop" : "Leverans")) : momentNamn(m.k); }

// Hela momentet (eller milstolpen) flyttas ett antal arbetsdagar.
function gFlytta(nyckel, arbDelta) {
    const m = gPost(nyckel);
    if (!m || !arbDelta)
        return ritaGantt();
    if (!m.kanAndra)
        return status(m.klar ? "Det är klart och kan inte flyttas" : "Du har bara läsbehörighet på " + m.t.namn, true);
    const fore = [];
    m.kedja.filter(c => !c.klar && c.dag).forEach(c => gFlyttaKort(m, c, skiftaArbetsdagar(c.dag, arbDelta), fore));
    const n = Math.abs(arbDelta);
    gKlar(m, fore, gNamn(m) + " flyttat " + n + (n === 1 ? " arbetsdag " : " arbetsdagar ") + (arbDelta > 0 ? "senare" : "tidigare"));
}

// En milstolpe läggs på ett nytt datum.
function gFlyttaTill(nyckel, nyDag) {
    const m = gPost(nyckel);
    if (!m || !m.kanAndra || !nyDag)
        return ritaGantt();
    nyDag = gSnap(nyDag, nyDag < m.k.dag ? -1 : 1);
    if (nyDag === m.k.dag)
        return ritaGantt();
    const fore = [];
    gFlyttaKort(m, m.k, nyDag, fore);
    gKlar(m, fore, gNamn(m) + " flyttat till " + dagEtikett(nyDag));
}

function gSattStart(nyckel, ny) {
    const m = gPost(nyckel);
    if (!m || !m.kanAndra || !ny)
        return ritaGantt();
    ny = gSnap(ny, ny < m.fran ? -1 : 1);
    if (ny === m.fran)
        return ritaGantt();
    const fore = [];
    if (m.slut) {
        if (ny > m.slut.dag)
            return gFlytta(nyckel, arbetsdagarMellan(m.fran, ny));
        gFlyttaKort(m, m.k, ny, fore);
    }
    else if (ny < m.k.dag)
        gTillKedja(m, ny, m.k.dag, fore);
    else
        gFlyttaKort(m, m.k, ny, fore);
    gKlar(m, fore, gNamn(m) + ": start " + kortDatum(ny));
}

function gSattSlut(nyckel, ny) {
    const m = gPost(nyckel);
    if (!m || !m.kanAndra || !ny)
        return ritaGantt();
    ny = gSnap(ny, ny < m.till ? -1 : 1);
    if (ny < m.fran)
        ny = m.fran;
    if (ny === m.till)
        return ritaGantt();
    const fore = [];
    if (m.slut)
        gFlyttaKort(m, m.slut, ny, fore);
    else if (ny > m.k.dag)
        gTillKedja(m, m.k.dag, ny, fore);
    gKlar(m, fore, gNamn(m) + ": slut " + kortDatum(ny));
}

/* ---------- skapa från den tomma raden ---------- */

const G_TYPER = [
    { typ: "produktion", namn: "Produktionsmoment", text: "En stapel från idag och en vecka fram" },
    { typ: "avrop", namn: "Avrop", text: "En diamant på idag" },
    { typ: "leverans", namn: "Leverans", text: "En diamant på idag" }
];

function gValjTyp(pid, namn) {
    const p = plan4.projekt.find(x => x.id === pid);
    namn = String(namn || "").trim();
    if (!p || !namn)
        return;
    const tavlor = p.tavlor.filter(t => ganttKanRedigera(p, t));
    if (!tavlor.length)
        return status("Du har bara läsbehörighet i " + p.projekt, true);
    const startTavla = tavlor.find(t => p === state && t.id === state.aktiv) || tavlor[0];
    const kropp =
        '<div class="g-typval" role="radiogroup" aria-label="Typ">' +
        G_TYPER.map((x, i) => '<button type="button" role="radio" class="g-typknapp' + (i === 0 ? " vald" : "") + '" data-gnytyp="' + x.typ + '" aria-checked="' + (i === 0) + '">' +
            '<span class="g-typik g-typik-' + x.typ + '"></span><b>' + x.namn + "</b><small>" + x.text + "</small></button>").join("") +
        "</div>" +
        (tavlor.length > 1 ? '<div class="falt"><label for="gnTavla">Tavla</label><select class="f" id="gnTavla">' +
            tavlor.map(t => '<option value="' + esc(t.id) + '"' + (t === startTavla ? " selected" : "") + ">" + esc(t.namn) + "</option>").join("") +
            "</select></div>" : "") +
        '<p class="hjalp">Det hamnar direkt i schemat och på tavlan. Sedan drar du det dit det ska vara.</p>';
    modal("Vad är " + namn + "?", p.projekt, kropp, [
        { txt: "Avbryt", fn: stangModal },
        { txt: "Skapa", primar: true, fn: () => gSkapa(p, namn) }
    ]);
    const box = document.getElementById("overlay");
    box.dataset.gnytyp = "produktion";
    const val = box.querySelector(".g-typval");
    val.addEventListener("click", (e) => {
        const b = e.target.closest("[data-gnytyp]");
        if (!b)
            return;
        box.dataset.gnytyp = b.dataset.gnytyp;
        val.querySelectorAll("[data-gnytyp]").forEach(x => { x.classList.toggle("vald", x === b); x.setAttribute("aria-checked", String(x === b)); });
    });
    // dubbelklick eller Enter på en typ skapar direkt
    val.addEventListener("dblclick", (e) => { if (e.target.closest("[data-gnytyp]")) gSkapa(p, namn); });
    val.addEventListener("keydown", (e) => {
        const knappar = [...val.querySelectorAll("[data-gnytyp]")];
        const i = knappar.findIndex(x => x.classList.contains("vald"));
        if (e.key === "ArrowDown" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowLeft") {
            e.preventDefault();
            const j = (i + (e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : knappar.length - 1)) % knappar.length;
            knappar[j].click();
            knappar[j].focus();
        }
        else if (e.key === "Enter") { e.preventDefault(); gSkapa(p, namn); }
    });
    setTimeout(() => { const f = val.querySelector(".vald"); if (f) f.focus(); }, 30);
}

function gSkapa(p, namn) {
    const box = document.getElementById("overlay");
    const typ = (box && box.dataset.gnytyp) || "produktion";
    const tavlor = p.tavlor.filter(t => ganttKanRedigera(p, t));
    const valj = document.getElementById("gnTavla");
    const t = (valj && tavlor.find(x => x.id === valj.value)) || tavlor.find(x => p === state && x.id === state.aktiv) || tavlor[0];
    if (!t)
        return;
    const idag = gSnap(IDAG, 1);
    let patch, dag = idag, slut = null;
    if (typ === "produktion") {
        slut = gSnap(plus(idag, 7), -1);
        const kedja = "k" + uid();
        patch = opGuideLaggUpp({ kort: [{ dag, typ: "produktion", roll: "S", text: "Start " + namn, vem: "", kedja },
            { dag: slut, typ: "produktion", roll: "K", text: namn + " klart", vem: "", kedja }],
            text: namn, start: dag, plats: "", bemanning: { behov: [], personer: [] }, grund: [], forval: [], mtrl: [], hinder: [] }, t.id);
    }
    else
        patch = opNyttKort({ dag, typ, text: namn, vem: "" }, t.id);
    if (!patch || !patch.ok || !appliceraPatch(patch, { tavla: t, projekt: p }))
        return status("Det gick inte att skapa", true);
    (patch.historik && patch.historik.length ? patch.historik : [(typ === "avrop" ? "Avrop" : "Leverans") + " skapat i Gantt-schemat: " + namn]).forEach(h => logg2(t, h));
    // det nya kortet blinker några sekunder
    const nya = patch.andringar.filter(a => a.typ === "lagg" && a.objekt === "kort").map(a => a.id || (a.varde && a.varde.id));
    const forsta = typ === "produktion" ? t.kort.find(k => nya.includes(k.id) && k.roll === "S") : t.kort.find(k => nya.includes(k.id));
    if (forsta) {
        ganttBlink[forsta.id] = Date.now() + BLINK_MS;
        gVisaEfter = forsta.id;
        setTimeout(() => { delete ganttBlink[forsta.id]; document.querySelectorAll("#gantt .g-blink, #gantt .g-blinkrad").forEach(el => el.classList.remove("g-blink", "g-blinkrad")); }, BLINK_MS + 100);
    }
    // syns det inte? visa det: projektet utfällt och avrop och leveranser påslagna
    gantt.ihop = gantt.ihop.filter(x => x !== p.id);
    if (typ !== "produktion")
        gantt.milstolpar = true;
    if (gantt.valda && !gantt.valda.includes(p.id))
        gantt.valda = gantt.valda.concat(p.id);
    ganttSteg = 0;
    sparaGantt();
    stangModal();
    spara();
    gFokusNy = p.id;
    rita();
    if (!ganttOppen())
        ritaGantt();
    status((typ === "produktion" ? namn + " skapat " + kortDatum(dag) + "–" + kortDatum(slut) : namn + " skapat " + kortDatum(dag)) + ". Dra det dit det ska vara.");
}
let gVisaEfter = null, gFokusNy = null;

// Efter varje omritning: visa det som nyss skapats och lägg markören på tomma raden igen.
function ganttEfterRita() {
    if (gVisaEfter) {
        const el = document.querySelector('#gantt [data-gkort$="|' + CSS.escape(gVisaEfter) + '"].g-blink');
        gVisaEfter = null;
        if (el) {
            const sk = el.closest(".g-skroll");
            el.scrollIntoView({ block: "nearest", inline: "center" });
            if (sk && sk.scrollLeft < 0) sk.scrollLeft = 0;
        }
    }
    if (gFokusNy) {
        const inp = document.querySelector('#gantt .g-nyin[data-gny="' + CSS.escape(gFokusNy) + '"]');
        gFokusNy = null;
        if (inp)
            inp.focus({ preventScroll: true });
    }
}

document.getElementById("gantt").addEventListener("keydown", (e) => {
    const inp = e.target.closest && e.target.closest(".g-nyin");
    if (!inp)
        return;
    if (e.key === "Enter" && inp.value.trim()) {
        e.preventDefault();
        const namn = inp.value.trim();
        inp.value = "";
        gValjTyp(inp.dataset.gny, namn);
    }
    else if (e.key === "Escape") {
        e.stopPropagation();
        inp.value = "";
        inp.blur();
    }
});

/* ---------- dra ---------- */

let gDrag = null;

document.getElementById("gantt").addEventListener("pointerdown", (e) => {
    const el = e.target.closest && e.target.closest(".g-dra");
    if (!el || e.button !== 0)
        return;
    const tab = el.closest(".g-tabell"), m = gPost(el.dataset.gkort);
    if (!tab || !m)
        return;
    const hand = e.target.closest("[data-ghand]");
    gDrag = { el, nyckel: el.dataset.gkort, m, lage: m.mil ? "dia" : hand ? hand.dataset.ghand : "flytta",
        x0: e.clientX, dw: parseFloat(tab.dataset.gdw), left0: parseFloat(el.style.left), w0: parseFloat(el.style.width) || 0,
        flyttat: false, id: e.pointerId };
    el.setPointerCapture(e.pointerId);
    e.preventDefault();
});

document.getElementById("gantt").addEventListener("pointermove", (e) => {
    const d = gDrag;
    if (!d || e.pointerId !== d.id)
        return;
    const dx = e.clientX - d.x0;
    if (!d.flyttat && Math.abs(dx) < 4)
        return;
    d.flyttat = true;
    d.el.classList.add("g-drar");
    document.body.classList.add("g-drarlage");
    const dd = Math.round(dx / d.dw), dagar = (a, b) => Math.round((iso2d(b) - iso2d(a)) / 86400000);
    let fran = d.m.fran, till = d.m.till;
    if (d.lage === "flytta" || d.lage === "dia") { fran = plus(fran, dd); till = plus(till, dd); }
    else if (d.lage === "fran") { fran = plus(fran, dd); if (fran > till) fran = till; }
    else { till = plus(till, dd); if (till < fran) till = fran; }
    d.fran = gSnap(fran, dd < 0 ? -1 : 1);
    d.till = gSnap(till, dd < 0 ? -1 : 1);
    if (d.till < d.fran) d.till = d.fran;
    d.el.style.left = (d.left0 + dagar(d.m.fran, d.fran) * d.dw).toFixed(1) + "px";
    if (d.lage !== "dia")
        d.el.style.width = Math.max(d.dw, d.w0 + (dagar(d.m.till, d.till) - dagar(d.m.fran, d.fran)) * d.dw).toFixed(1) + "px";
    let bubbla = document.getElementById("gBubbla");
    if (!bubbla) {
        bubbla = document.createElement("div");
        bubbla.id = "gBubbla";
        bubbla.className = "g-bubbla";
        document.body.appendChild(bubbla);
    }
    bubbla.textContent = d.lage === "dia" || d.fran === d.till ? dagEtikett(d.fran)
        : kortDatum(d.fran) + " – " + kortDatum(d.till) + " · " + gArbDagar(d.fran, d.till) + " arbetsdagar";
    const r = d.el.getBoundingClientRect();
    bubbla.style.left = Math.round(d.lage === "till" ? r.right : d.lage === "fran" ? r.left : r.left + r.width / 2) + "px";
    bubbla.style.top = Math.round(r.top - 8) + "px";
});

function gSlutaDra(e) {
    const d = gDrag;
    if (!d || (e && e.pointerId !== d.id))
        return;
    document.body.classList.remove("g-drarlage");
    const b = document.getElementById("gBubbla");
    if (b)
        b.remove();
    if (!d.flyttat) {
        gDrag = null;
        return;
    }
    d.slut = true;
    // klicket efter en dragning ska inte öppna kortet
    setTimeout(() => { gDrag = null; if (ganttVantar) ritaGantt(); }, 0);
    if (!d.fran || (d.fran === d.m.fran && d.till === d.m.till))
        return ritaGantt();
    if (d.lage === "dia")
        gFlyttaTill(d.nyckel, d.fran);
    else if (d.lage === "flytta")
        gFlytta(d.nyckel, arbetsdagarMellan(d.m.fran, d.fran));
    else if (d.lage === "fran")
        gSattStart(d.nyckel, d.fran);
    else
        gSattSlut(d.nyckel, d.till);
}
document.getElementById("gantt").addEventListener("pointerup", gSlutaDra);
document.getElementById("gantt").addEventListener("pointercancel", gSlutaDra);
document.getElementById("gantt").addEventListener("click", (e) => {
    if (gDrag && gDrag.flyttat) {
        e.stopPropagation();
        e.preventDefault();
    }
}, true);

// Tangentbord på en stapel eller diamant: pilarna flyttar en arbetsdag, Skift + pil ändrar slutet.
document.getElementById("gantt").addEventListener("keydown", (e) => {
    const el = e.target.closest && e.target.closest(".g-dra");
    if (!el || (e.key !== "ArrowLeft" && e.key !== "ArrowRight"))
        return;
    e.preventDefault();
    const nyckel = el.dataset.gkort, steg = e.key === "ArrowRight" ? 1 : -1, m = gPost(nyckel);
    if (!m)
        return;
    gFokus = nyckel;
    if (e.shiftKey && !m.mil)
        gSattSlut(nyckel, skiftaArbetsdagar(m.till, steg));
    else
        gFlytta(nyckel, steg);
});
let gFokus = null;
const ursEfterRita = ganttEfterRita;
ganttEfterRita = function () {
    ursEfterRita();
    if (gFokus) {
        const el = document.querySelector('#gantt .g-dra[data-gkort="' + CSS.escape(gFokus) + '"]');
        gFokus = null;
        if (el)
            el.focus({ preventScroll: true });
    }
};
