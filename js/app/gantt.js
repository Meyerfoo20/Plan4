/* ======================================================================
   Gantt-schema: alla produktionsmoment som staplar på en tidslinje.

   Visar ett eller flera projekt samtidigt. Ett moment är en produktionspost:
   en kedja från Start till Klart (roll S → K) eller en endagspost. Avrop och
   leveranser visas som milstolpar, på momentets rad om de hör till det.
   Perioden (idag, vecka, månad, år) och valen av projekt minns i webbläsaren.
   ====================================================================== */

const GANTT_NYCKEL = "plan4_gantt";
const GANTT_FARGER = ["#0a6f61", "#254e9c", "#6b4a9c", "#b8611a", "#2f7d32", "#b32d22", "#1f6f8b", "#8a5b12"];
const GANTT_PERIODER = { idag: "Idag", vecka: "Vecka", manad: "Månad", ar: "År" };
const MANADER_LANG = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];
const DAGAR_LANG = ["måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag", "söndag"];

let gantt = lasGantt();
let ganttSteg = 0;              // bläddring bakåt/framåt från dagens period

function lasGantt() {
    const grund = { valda: null, period: "manad", milstolpar: true, klara: true, arkiverade: false, ihop: [] };
    try {
        const s = JSON.parse(localStorage.getItem(GANTT_NYCKEL) || "null");
        return Object.assign(grund, s || {});
    }
    catch (e) {
        return grund;
    }
}

function sparaGantt() {
    try { localStorage.setItem(GANTT_NYCKEL, JSON.stringify(gantt)); }
    catch (e) { }
}

/* ---------- öppna och stäng ---------- */

function oppnaGantt() {
    stangStart();
    stangDash();
    document.body.classList.add("dashlage");
    document.getElementById("gantt").classList.remove("dold");
    ganttSteg = 0;
    ganttYta = null;
    ritaGantt();
}

function stangGantt() {
    document.getElementById("gantt").classList.add("dold");
    if (!dashOppen() && !startOppen())
        document.body.classList.remove("dashlage");
}

function ganttOppen() { return !document.getElementById("gantt").classList.contains("dold"); }

/* ---------- data ---------- */

function ganttProjekt() {
    return plan4.projekt.filter(p => gantt.arkiverade || !p.arkiverad);
}

function ganttValda() {
    const alla = ganttProjekt();
    if (!gantt.valda)
        return alla;
    return alla.filter(p => gantt.valda.includes(p.id));
}

function ganttFarg(p) {
    const i = plan4.projekt.indexOf(p);
    return GANTT_FARGER[(i < 0 ? 0 : i) % GANTT_FARGER.length];
}

// Moment och milstolpar i ett projekt.
function ganttMoment(p) {
    const moment = [], losa = [];
    p.tavlor.forEach(t => {
        const mil = [];
        t.kort.forEach(k => {
            if (!k.dag)
                return;
            if (k.typ === "produktion" && k.roll !== "K") {
                const slut = slutPostI(t, k);
                const till = slut && slut.dag > k.dag ? slut.dag : k.dag;
                moment.push({ p, t, k, namn: momentNamn(k) || "Produktionsmoment", fran: k.dag, till,
                    klar: slut ? !!slut.klar : !!k.klar, mil: [] });
            }
            else if (k.typ === "avrop" || k.typ === "leverans")
                mil.push({ p, t, k, typ: k.typ, dag: k.dag, klar: !!k.klar, text: k.text || (k.typ === "avrop" ? "Avrop" : "Leverans") });
        });
        mil.forEach(m => {
            const agare = m.k.kedja ? moment.find(x => x.t === t && x.k.kedja === m.k.kedja) : null;
            (agare ? agare.mil : losa).push(m);
        });
    });
    moment.sort((a, b) => a.fran < b.fran ? -1 : a.fran > b.fran ? 1 : a.namn.localeCompare(b.namn, "sv"));
    losa.sort((a, b) => a.dag < b.dag ? -1 : 1);
    return { moment, losa };
}

function ganttStatus(m) {
    if (m.klar)
        return { klass: "klar", text: "Klart" };
    if (m.till < IDAG)
        return { klass: "sen", text: "Försenat" };
    if (m.fran <= IDAG)
        return { klass: "pagar", text: "Pågår" };
    return { klass: "", text: "Planerat" };
}

/* ---------- rita ---------- */

// Perioden som visas: från måndag till söndag, hela veckor.
function ganttPeriod() {
    const per = GANTT_PERIODER[gantt.period] ? gantt.period : "manad", idag = iso2d(IDAG);
    const mandagFor = (iso) => d2iso(mandag(iso2d(iso)));
    if (per === "idag") {
        const dag = plus(IDAG, ganttSteg), d = iso2d(dag);
        return { per, dag, fran: mandagFor(dag), till: plus(mandagFor(dag), 6),
            namn: ganttSteg === 0 ? "Idag, " + DAGAR_LANG[(d.getDay() + 6) % 7] + " " + d.getDate() + " " + MANADER_LANG[d.getMonth()]
                : DAGAR_LANG[(d.getDay() + 6) % 7].replace(/^./, c => c.toUpperCase()) + " " + d.getDate() + " " + MANADER_LANG[d.getMonth()] };
    }
    if (per === "vecka") {
        const fran = plus(mandagFor(IDAG), 7 * ganttSteg), till = plus(fran, 6);
        return { per, fran, till, namn: "Vecka " + veckonr(fran) + " · " + kortDatum(fran) + "–" + kortDatum(till) };
    }
    if (per === "manad") {
        const forsta = new Date(idag.getFullYear(), idag.getMonth() + ganttSteg, 1);
        const sista = new Date(forsta.getFullYear(), forsta.getMonth() + 1, 0);
        return { per, fran: mandagFor(d2iso(forsta)), till: plus(mandagFor(d2iso(sista)), 6),
            namn: MANADER_LANG[forsta.getMonth()].replace(/^./, c => c.toUpperCase()) + " " + forsta.getFullYear() };
    }
    const ar = idag.getFullYear() + ganttSteg;
    return { per, fran: mandagFor(ar + "-01-01"), till: plus(mandagFor(ar + "-12-31"), 6), namn: String(ar) };
}

let ganttYta = null;            // uppmätt bredd för tidslinjen (utan etiketter och rullist)

function ritaGantt(andraForsok) {
    const box = document.getElementById("gantt");
    const gammal = box.querySelector(".g-skroll");
    const skrollY = gammal ? gammal.scrollTop : 0;
    const valda = ganttValda();
    const per = ganttPeriod(), { fran, till } = per;
    // det som syns i perioden (Idag: bara det som pågår den dagen)
    const iPerioden = per.per === "idag"
        ? (m) => m.fran <= per.dag && per.dag <= m.till
        : (m) => m.fran <= till && m.till >= fran;
    const milIPerioden = per.per === "idag" ? (m) => m.dag === per.dag : (m) => m.dag >= fran && m.dag <= till;
    const data = valda.map(p => {
        const d = ganttMoment(p);
        return { p, moment: d.moment.filter(m => (gantt.klara || !m.klar) && iPerioden(m))
            .map(m => Object.assign({}, m, { mil: m.mil.filter(milIPerioden) })), losa: d.losa.filter(milIPerioden) };
    });

    // dagbredden anpassas så att perioden fyller schemats bredd (året får rulla på smala skärmar)
    const dagar = Math.round((iso2d(till) - iso2d(fran)) / 86400000) + 1;
    const et = window.innerWidth <= 700 ? 170 : 270;
    const bredd0 = ganttYta || (box.clientWidth || 1000) - (window.innerWidth > 1000 ? 250 + 16 : 0) - 2 - et;
    const dw = Math.max(per.per === "ar" ? 1.5 : 6, bredd0 / dagar);
    const x = (iso) => Math.round((iso2d(iso) - iso2d(fran)) / 86400000) * dw;
    const bredd = Math.floor(dagar * dw);

    const antalMoment = data.reduce((n, d) => n + d.moment.length, 0);
    const sena = data.reduce((n, d) => n + d.moment.filter(m => !m.klar && m.till < IDAG).length, 0);

    let html = '<div class="p4-hero g-hero"><div class="p4-hero-text">' +
        '<div class="p4-eyebrow"><span class="p4-pop"></span>Översikt</div>' +
        '<h1 class="g-rubrik">Gantt-schema</h1>' +
        '<div class="g-meta">' + valda.length + " projekt · " + antalMoment + " moment i perioden" +
        (sena ? ' · <span class="g-meta-sen">' + sena + " försenade</span>" : "") + "</div></div>" +
        '<div class="g-knappar">' +
        '<div class="g-seg" role="group" aria-label="Period">' +
        Object.keys(GANTT_PERIODER).map(s => '<button type="button" data-gper="' + s + '"' +
            (s === per.per ? ' class="aktiv" aria-pressed="true"' : ' aria-pressed="false"') + ">" + GANTT_PERIODER[s] + "</button>").join("") +
        "</div>" +
        '<div class="g-blad"><button type="button" class="navknapp" data-g="bakat" title="Föregående" aria-label="Föregående">←</button>' +
        '<span class="g-period">' + esc(per.namn) + "</span>" +
        '<button type="button" class="navknapp" data-g="framat" title="Nästa" aria-label="Nästa">→</button></div>' +
        "</div></div>";

    html += '<div class="g-layout">' + ganttValHtml() + '<div class="g-schema">';
    if (!valda.length)
        html += '<div class="g-tom"><b>Inga projekt valda</b><span>Kryssa i ett eller flera projekt till vänster.</span></div>';
    else
        html += ganttTabell(data, { fran, till, dagar, dw, x, bredd, per });
    html += "</div></div>";
    box.innerHTML = '<div class="p4-gantt">' + html + "</div>";

    const sk = box.querySelector(".g-skroll");
    if (sk) {
        // mät den verkliga ytan (rullisten tar plats) och rita om en gång om den inte stämde
        const yta = sk.clientWidth - et;
        if (!andraForsok && yta > 0 && Math.abs(yta - bredd0) > 1) {
            ganttYta = yta;
            return ritaGantt(true);
        }
        sk.scrollTop = skrollY;
        if (per.per === "ar" && sk.scrollWidth > sk.clientWidth)
            sk.scrollLeft = Math.max(0, x(IDAG) - 4 * 7 * dw);
    }
}

function ganttValHtml() {
    const alla = ganttProjekt(), harArkiv = plan4.projekt.some(p => p.arkiverad);
    const vald = (p) => !gantt.valda || gantt.valda.includes(p.id);
    return '<aside class="g-val">' +
        '<div class="g-val-topp"><h2>Projekt</h2>' +
        '<div class="g-val-snabb"><button type="button" data-g="alla">Alla</button>' +
        '<button type="button" data-g="aktuellt" title="Bara projektet du har öppet">Aktuellt</button></div></div>' +
        '<ul class="g-projlista">' +
        alla.map(p => {
            const n = ganttMoment(p).moment.length;
            return '<li><label class="g-proj' + (vald(p) ? " vald" : "") + '">' +
                '<input type="checkbox" data-gproj="' + p.id + '"' + (vald(p) ? " checked" : "") + ">" +
                '<span class="g-ruta" style="--gf:' + ganttFarg(p) + '"></span>' +
                '<span class="g-proj-namn">' + esc(p.projekt) + (p.arkiverad ? ' <span class="g-tagg">Arkiverat</span>' : "") + "</span>" +
                '<span class="g-proj-antal">' + n + "</span></label>" +
                '<button type="button" class="g-bara" data-gbara="' + p.id + '" title="Visa bara ' + esc(p.projekt) + '">Bara</button></li>';
        }).join("") +
        "</ul>" +
        '<div class="g-val-rad">' +
        '<label class="kryssrad"><input type="checkbox" data-gval="milstolpar"' + (gantt.milstolpar ? " checked" : "") + "> Avrop och leveranser</label>" +
        '<label class="kryssrad"><input type="checkbox" data-gval="klara"' + (gantt.klara ? " checked" : "") + "> Klara moment</label>" +
        (harArkiv ? '<label class="kryssrad"><input type="checkbox" data-gval="arkiverade"' + (gantt.arkiverade ? " checked" : "") + "> Arkiverade projekt</label>" : "") +
        "</div>" +
        '<ul class="g-forklaring">' +
        '<li><span class="g-fk g-fk-plan"></span>Planerat</li>' +
        '<li><span class="g-fk g-fk-pagar"></span>Pågår</li>' +
        '<li><span class="g-fk g-fk-sen"></span>Försenat</li>' +
        '<li><span class="g-fk g-fk-klar"></span>Klart</li>' +
        '<li><span class="g-dia g-avrop"></span>Avrop</li>' +
        '<li><span class="g-dia g-leverans"></span>Leverans</li>' +
        "</ul></aside>";
}

function ganttTabell(data, o) {
    const { fran, till, dagar, dw, x, bredd } = o;
    // tidshuvud: bara veckor
    let veckor = "";
    for (let i = 0; i < dagar; i += 7) {
        const iso = plus(fran, i), w = 7 * dw, nu = iso <= IDAG && IDAG <= plus(iso, 6);
        const txt = w >= 120 ? "Vecka " + veckonr(iso) + " <small>" + kortDatum(iso) + "–" + kortDatum(plus(iso, 6)) + "</small>"
            : w >= 34 ? "v" + veckonr(iso) : w >= 15 || veckonr(iso) % 2 === 0 ? String(veckonr(iso)) : "";
        veckor += '<div class="g-cell' + (nu ? " idag" : "") + '" style="left:' + (i * dw).toFixed(1) + "px;width:" + w.toFixed(1) + 'px">' + txt + "</div>";
    }
    const tom = !data.some(d => d.moment.length || (gantt.milstolpar && d.losa.length));
    const bakgrund = "--vb:" + (7 * dw).toFixed(2) + "px;--hb:" + (5 * dw).toFixed(2) + "px;--db:" + dw.toFixed(2) + "px";
    const kl = (iso) => iso < fran ? fran : iso > till ? till : iso;     // klipp till perioden
    let rader = "";
    data.forEach(d => {
        const p = d.p, farg = ganttFarg(p), ihop = gantt.ihop.includes(p.id);
        const moment = d.moment;
        const span = moment.length ? { fran: kl(moment.reduce((a, m) => m.fran < a ? m.fran : a, moment[0].fran)),
            till: kl(moment.reduce((a, m) => m.till > a ? m.till : a, moment[0].till)) } : null;
        const klara = moment.filter(m => m.klar).length;
        rader += '<div class="g-rad g-projrad" style="--gf:' + farg + '">' +
            '<button type="button" class="g-etikett" data-gihop="' + p.id + '" aria-expanded="' + !ihop + '">' +
            '<span class="p4-caret' + (ihop ? " stangd" : "") + '" aria-hidden="true"></span>' +
            '<span class="g-ruta"></span><span class="g-etext"><b>' + esc(p.projekt) + "</b>" +
            "<small>" + (moment.length ? moment.length + " moment · " + klara + " klara" : "Inget i perioden") + "</small></span></button>" +
            '<div class="g-spar" style="width:' + bredd + "px;" + bakgrund + '">' +
            (span ? '<div class="g-summa" style="left:' + x(span.fran) + "px;width:" + (x(span.till) - x(span.fran) + dw) + 'px"></div>' : "") +
            (ihop && gantt.milstolpar ? d.losa.map(m => ganttDiamant(m, x, dw)).join("") : "") +
            "</div></div>";
        if (ihop)
            return;
        moment.forEach(m => {
            const st = ganttStatus(m), v = x(kl(m.fran)), w = x(kl(m.till)) - v + dw;
            const kant = (m.fran < fran ? " fore" : "") + (m.till > till ? " efter" : "");
            const dagarTxt = m.fran === m.till ? kortDatum(m.fran) : kortDatum(m.fran) + "–" + kortDatum(m.till);
            const tips = m.namn + "\n" + dagarTxt + " · " + st.text + "\n" + p.projekt + " · " + m.t.namn +
                (m.k.plats ? " · " + m.k.plats : "") + (m.k.vem ? "\nAnsvarig: " + m.k.vem : "");
            const textInne = w >= m.namn.length * 6.6 + 18 || (w >= 60 && v + w + m.namn.length * 6.6 + 12 > bredd);
            rader += '<div class="g-rad" style="--gf:' + farg + '">' +
                '<button type="button" class="g-etikett g-mom" data-gkort="' + p.id + "|" + m.t.id + "|" + m.k.id + '">' +
                '<span class="g-etext"><b>' + esc(m.namn) + "</b><small>" + esc(dagarTxt) +
                (p.tavlor.length > 1 ? " · " + esc(m.t.namn) : "") + (m.k.plats ? " · " + esc(m.k.plats) : "") + "</small></span>" +
                (st.klass ? '<span class="g-status ' + st.klass + '">' + st.text + "</span>" : "") + "</button>" +
                '<div class="g-spar" style="width:' + bredd + "px;" + bakgrund + '">' +
                '<button type="button" class="g-stapel ' + st.klass + kant + '" data-gkort="' + p.id + "|" + m.t.id + "|" + m.k.id + '" style="left:' +
                v.toFixed(1) + "px;width:" + w.toFixed(1) + 'px" title="' + esc(tips) + '">' + (textInne ? "<span>" + esc(m.namn) + "</span>" : "") + "</button>" +
                (textInne || dw < 4 ? "" : v + Math.max(w, 6) + 12 + m.namn.length * 6.6 > bredd
                    ? '<span class="g-utetext" style="right:' + (bredd - v + 6).toFixed(1) + 'px">' + esc(m.namn) + "</span>"
                    : '<span class="g-utetext" style="left:' + (v + Math.max(w, 6) + 6).toFixed(1) + 'px">' + esc(m.namn) + "</span>") +
                (gantt.milstolpar ? m.mil.map(ml => ganttDiamant(ml, x, dw)).join("") : "") +
                "</div></div>";
        });
        if (gantt.milstolpar && d.losa.length)
            rader += '<div class="g-rad g-milrad" style="--gf:' + farg + '">' +
                '<div class="g-etikett"><span class="g-etext"><b>Avrop och leveranser</b><small>' + d.losa.length +
                " utan kopplat moment</small></span></div>" +
                '<div class="g-spar" style="width:' + bredd + "px;" + bakgrund + '">' + d.losa.map(m => ganttDiamant(m, x, dw)).join("") + "</div></div>";
    });
    if (tom)
        rader += '<div class="g-rad g-tomrad"><div class="g-etikett"></div><div class="g-spar" style="width:' + bredd + "px;" + bakgrund + '">' +
            "<span>" + (o.per.per === "idag" ? "Inga produktionsmoment pågår den här dagen." : "Inga produktionsmoment i perioden.") + "</span></div></div>";
    const markdag = o.per.per === "idag" ? o.per.dag : IDAG;
    const idag = markdag >= fran && markdag <= till ? '<div class="g-idaglinje" style="left:calc(var(--g-et) + ' + (x(markdag) + dw / 2).toFixed(1) + 'px)"></div>' : "";
    return '<div class="g-skroll"><div class="g-tabell' + (dw < 12 ? " grov" : "") + (7 * dw < 20 ? " tat" : "") + '" style="width:calc(var(--g-et) + ' + bredd + 'px)">' +
        '<div class="g-rad g-huvud"><div class="g-etikett g-horn">Moment</div>' +
        '<div class="g-tid" style="width:' + bredd + 'px">' + veckor + "</div></div>" +
        rader + idag + "</div></div>";
}

function ganttDiamant(m, x, dw) {
    const tips = (m.typ === "avrop" ? "Avrop: " : "Leverans: ") + m.text + "\n" + dagEtikett(m.dag) + (m.klar ? " · klar" : "");
    return '<button type="button" class="g-dia g-' + m.typ + (m.klar ? " klar" : "") + '" data-gkort="' + m.p.id + "|" + m.t.id + "|" + m.k.id +
        '" style="left:' + (x(m.dag) + dw / 2).toFixed(1) + 'px" title="' + esc(tips) + '"></button>';
}

/* ---------- händelser ---------- */

function ganttTillKort(nyckel) {
    const [pid, tid, kid] = nyckel.split("|");
    if (!state || state.id !== pid)
        valjProjekt(pid);
    if (!state || state.id !== pid)
        return;
    state.aktiv = tid;
    const t = T(), k = t.kort.find(x => x.id === kid);
    if (!k)
        return;
    const v = Math.floor((iso2d(k.dag) - iso2d(t.start)) / 86400000 / 7);
    vyOffset = v >= 0 && v < 4 ? 0 : v;
    stangGantt();
    if (window.p4MarkeraNav)
        window.p4MarkeraNav();
    rita();
    window.scrollTo({ top: 0 });
    visaKort(k);
}

document.getElementById("gantt").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b)
        return;
    if (b.dataset.gper) {
        gantt.period = b.dataset.gper;
        ganttSteg = 0;
        sparaGantt();
        return ritaGantt();
    }
    if (b.dataset.gkort)
        return ganttTillKort(b.dataset.gkort);
    if (b.dataset.gbara) {
        gantt.valda = [b.dataset.gbara];
        sparaGantt();
        return ritaGantt();
    }
    if (b.dataset.gihop) {
        const id = b.dataset.gihop;
        gantt.ihop = gantt.ihop.includes(id) ? gantt.ihop.filter(x => x !== id) : gantt.ihop.concat(id);
        sparaGantt();
        return ritaGantt();
    }
    const g = b.dataset.g;
    if (g === "bakat" || g === "framat") {
        ganttSteg += g === "bakat" ? -1 : 1;
        return ritaGantt();
    }
    if (g === "alla") {
        gantt.valda = null;
        sparaGantt();
        return ritaGantt();
    }
    if (g === "aktuellt" && state && state.id) {
        gantt.valda = [state.id];
        sparaGantt();
        return ritaGantt();
    }
});

document.getElementById("gantt").addEventListener("change", (e) => {
    const el = e.target;
    if (el.dataset.gproj) {
        const valda = [...document.querySelectorAll("#gantt [data-gproj]")].filter(x => x.checked).map(x => x.dataset.gproj);
        gantt.valda = valda.length === ganttProjekt().length ? null : valda;
        sparaGantt();
        return ritaGantt();
    }
    if (el.dataset.gval) {
        gantt[el.dataset.gval] = el.checked;
        if (el.dataset.gval === "arkiverade" && gantt.valda && el.checked)
            gantt.valda = gantt.valda.concat(plan4.projekt.filter(p => p.arkiverad).map(p => p.id));
        sparaGantt();
        return ritaGantt();
    }
});

// Projektöversikt och Att göra stänger schemat, oavsett varifrån de öppnas.
const ursOppnaDashG = oppnaDash, ursOppnaStartG = oppnaStart;
oppnaDash = function () { stangGantt(); return ursOppnaDashG.apply(this, arguments); };
oppnaStart = function () { stangGantt(); return ursOppnaStartG.apply(this, arguments); };

document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && ganttOppen() && !document.getElementById("overlay")) {
        stangGantt();
        if (window.p4MarkeraNav)
            window.p4MarkeraNav();
    }
});

let ganttStorlek = null;
window.addEventListener("resize", () => {
    clearTimeout(ganttStorlek);
    ganttStorlek = setTimeout(() => { ganttYta = null; if (ganttOppen()) ritaGantt(); }, 150);
});

// Schemat hålls aktuellt när projekten ändras (egna ändringar och synk från andra datorer).
const ursRitaGantt = rita;
rita = function () {
    const r = ursRitaGantt.apply(this, arguments);
    if (ganttOppen())
        ritaGantt();
    return r;
};
