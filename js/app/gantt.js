/* ======================================================================
   Gantt-schema: alla produktionsmoment som staplar på en tidslinje.

   Visar ett eller flera projekt samtidigt. Ett moment är en produktionspost:
   en kedja från Start till Klart (roll S → K) eller en endagspost. Avrop och
   leveranser visas som milstolpar, på momentets rad om de hör till det.
   Perioden (vecka, månad, år) och valen av projekt minns i webbläsaren.
   ====================================================================== */

const GANTT_NYCKEL = "plan4_gantt";
const GANTT_FARGER = ["#0a6f61", "#254e9c", "#6b4a9c", "#b8611a", "#2f7d32", "#b32d22", "#1f6f8b", "#8a5b12"];
const GANTT_PERIODER = { vecka: "Vecka", manad: "Månad", ar: "År" };
const MANADER_LANG = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];
const DAGAR_LANG = ["måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag", "söndag"];
const GANTT_DAGKORT = ["Mån", "Tis", "Ons", "Tor", "Fre", "Lör", "Sön"];

let gantt = lasGantt();
let ganttSteg = 0;              // bläddring bakåt/framåt från dagens period
let ganttBlink = {};            // kortId → tid då blinkningen slutar (nyss skapat i schemat)
function ganttBlinkar(id) { return !!ganttBlink[id] && ganttBlink[id] > Date.now(); }

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

// Bara projekt man är med i (huvudadmin har tillgång till alla och ser därför alla).
function ganttArMed(p) {
    try { return typeof window.p4ArMed !== "function" || window.p4ArMed(p.id); } catch (e) { return true; }
}

function ganttProjekt() {
    return plan4.projekt.filter(p => (gantt.arkiverade || !p.arkiverad) && ganttArMed(p));
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
                const ms = k.milstolpe || (slut && slut.milstolpe);
                moment.push({ p, t, k, namn: momentNamn(k) || "Produktionsmoment", fran: k.dag, till,
                    klar: slut ? !!slut.klar : !!k.klar, mil: [], milstolpe: ms ? till : null });
            }
            else if (k.typ === "avrop" || k.typ === "leverans" || k.typ === "ue")
                mil.push({ p, t, k, typ: k.typ, dag: k.dag, klar: !!k.klar, text: k.text || TYPNAMN[k.typ] });
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

// Det som syns i schemat just nu: valda projekt, perioden och filtren.
function ganttUrval() {
    const valda = ganttValda();
    const per = ganttPeriod(), { fran, till } = per;
    // det som syns i perioden (Idag: bara det som pågår den dagen)
    const iPerioden = (m) => m.fran <= till && m.till >= fran;
    const milIPerioden = (m) => m.dag >= fran && m.dag <= till;
    const data = valda.map(p => {
        const d = ganttMoment(p);
        return { p, moment: d.moment.filter(m => (gantt.klara || !m.klar) && iPerioden(m))
            .map(m => Object.assign({}, m, { mil: m.mil.filter(milIPerioden) })), losa: d.losa.filter(milIPerioden) };
    });
    return { valda, per, data };
}

let ganttVantar = false;        // omritning som väntar tills en dragning är klar
function ritaGantt(andraForsok) {
    if (typeof gDrag !== "undefined" && gDrag && gDrag.flyttat && !gDrag.slut) { ganttVantar = true; return; }
    ganttVantar = false;
    const box = document.getElementById("gantt");
    const gammal = box.querySelector(".g-skroll");
    const skrollY = gammal ? gammal.scrollTop : 0, skrollX = gammal ? gammal.scrollLeft : null, perFore = gammal ? gammal.dataset.per : "";
    const { valda, per, data } = ganttUrval(), { fran, till } = per;

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
        '<div class="g-exp"><button type="button" class="p4-btn p4-btn-ljus g-expknapp" data-g="exportmeny" aria-haspopup="menu" aria-expanded="false"' +
        (valda.length ? "" : " disabled") + '>Exportera<span class="p4-caret" aria-hidden="true"></span></button>' +
        '<div class="g-expmeny dold" role="menu">' +
        '<button type="button" role="menuitem" data-g="exp-pdf"><b>PDF / Skriv ut</b><small>Schemat som det ser ut, liggande A4</small></button>' +
        '<button type="button" role="menuitem" data-g="exp-png"><b>Bild (PNG)</b><small>Att klistra in i mejl eller presentationer</small></button>' +
        '<button type="button" role="menuitem" data-g="exp-csv"><b>Excel (CSV)</b><small>Alla moment i perioden som tabell</small></button>' +
        "</div></div>" +
        "</div></div>";

    html += '<div class="g-layout">' + ganttValHtml() + '<div class="g-schema">';
    if (!valda.length)
        html += '<div class="g-tom"><b>Inga projekt valda</b><span>Kryssa i ett eller flera projekt till vänster.</span></div>';
    else
        html += ganttTabell(data, { fran, till, dagar, dw, x, bredd, per, dra: true });
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
        if (skrollX !== null && perFore === per.per + ganttSteg)
            sk.scrollLeft = skrollX;
        else if (per.per === "ar" && sk.scrollWidth > sk.clientWidth)
            sk.scrollLeft = Math.max(0, x(IDAG) - 4 * 7 * dw);
        sk.dataset.per = per.per + ganttSteg;
    }
    if (typeof ganttEfterRita === "function")
        ganttEfterRita();
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
        '<li><span class="g-dia g-ue"></span>UE</li>' +
        '<li><span class="g-dia g-milstolpe"></span>Milstolpe</li>' +
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
    // dagrad med Mån, Tis … när dagarna är breda nog (veckovyn)
    const medDagar = dw >= 30;
    if (medDagar)
        for (let i = 0; i < dagar; i++) {
            const iso = plus(fran, i), d = iso2d(iso), vd = (d.getDay() + 6) % 7;
            const namn = GANTT_DAGKORT[vd];
            veckor += '<div class="g-cell g-dagcell' + (iso === IDAG ? " idag" : "") + (vd > 4 ? " helg" : "") +
                '" style="left:' + (i * dw).toFixed(1) + "px;width:" + dw.toFixed(1) + 'px" title="' + esc(dagEtikett(iso)) + '">' +
                (dw >= 64 ? namn + " <small>" + kortDatum(iso) + "</small>" : namn) + "</div>";
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
            "<small>" + (moment.length ? moment.length + " moment · " + klara + " klara" : "Inget i perioden") + "</small></span>" +
            ganttPlus(p.id, "Lägg till i " + p.projekt) + "</button>" +
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
                (kortDel(m.k, m.t) ? " · " + kortDel(m.k, m.t) : "") + (m.k.vem ? "\nAnsvarig: " + m.k.vem : "");
            const textInne = w >= m.namn.length * 6.6 + 18 || (w >= 60 && v + w + m.namn.length * 6.6 + 12 > bredd);
            const dra = o.dra && !m.klar && ganttKanRedigera(p, m.t);
            rader += '<div class="g-rad' + (ganttBlinkar(m.k.id) ? " g-blinkrad" : "") + '" style="--gf:' + farg + '">' +
                '<button type="button" class="g-etikett g-mom" data-gkort="' + p.id + "|" + m.t.id + "|" + m.k.id + '">' +
                '<span class="g-etext"><b>' + esc(m.namn) + "</b><small>" + esc(dagarTxt) +
                (p.tavlor.length > 1 ? " · " + esc(m.t.namn) : "") + (kortDel(m.k, m.t) ? " · " + esc(kortDel(m.k, m.t)) : "") + "</small></span>" +
                (st.klass ? '<span class="g-status ' + st.klass + '">' + st.text + "</span>" : "") + "</button>" +
                '<div class="g-spar" style="width:' + bredd + "px;" + bakgrund + '">' +
                '<button type="button" class="g-stapel ' + st.klass + kant + (dra ? " g-dra" : "") + (ganttBlinkar(m.k.id) ? " g-blink" : "") +
                '" data-gkort="' + p.id + "|" + m.t.id + "|" + m.k.id + '" style="left:' +
                v.toFixed(1) + "px;width:" + w.toFixed(1) + 'px" title="' + esc(tips + (dra ? "\nDra för att flytta, dra i kanterna för att ändra start och slut" : "")) + '">' +
                (dra ? '<i class="g-hand v" data-ghand="fran"></i>' : "") + (textInne ? "<span>" + esc(m.namn) + "</span>" : "") +
                (dra ? '<i class="g-hand h" data-ghand="till"></i>' : "") + "</button>" +
                (textInne || dw < 4 ? "" : v + Math.max(w, 6) + 12 + m.namn.length * 6.6 > bredd
                    ? '<span class="g-utetext" style="right:' + (bredd - v + 6).toFixed(1) + 'px">' + esc(m.namn) + "</span>"
                    : '<span class="g-utetext" style="left:' + (v + Math.max(w, 6) + 6).toFixed(1) + 'px">' + esc(m.namn) + "</span>") +
                (gantt.milstolpar ? m.mil.map(ml => ganttDiamant(ml, x, dw, o.dra)).join("") : "") +
                (m.milstolpe && m.milstolpe >= fran && m.milstolpe <= till ? '<button type="button" class="g-dia g-milstolpe' + (m.klar ? " klar" : "") + '" data-gkort="' + p.id + "|" + m.t.id + "|" + m.k.id +
                    '" style="left:' + (x(m.milstolpe) + dw - 1).toFixed(1) + 'px" title="' + esc("Milstolpe: " + m.namn + "\n" + dagEtikett(m.milstolpe) + (m.klar ? " · klar" : "")) + '"></button>' : "") +
                "</div></div>";
        });
        if (gantt.milstolpar && d.losa.length)
            rader += '<div class="g-rad g-milrad' + (d.losa.some(m => ganttBlinkar(m.k.id)) ? " g-blinkrad" : "") + '" style="--gf:' + farg + '">' +
                '<div class="g-etikett"><span class="g-etext"><b>Avrop och leveranser</b><small>' + d.losa.length +
                " utan kopplat moment</small></span></div>" +
                '<div class="g-spar" style="width:' + bredd + "px;" + bakgrund + '">' + d.losa.map(m => ganttDiamant(m, x, dw, o.dra)).join("") + "</div></div>";
        // tom rad: skriv ett namn så skapas ett nytt moment, avrop eller en leverans
        if (o.dra && p.tavlor.some(t => ganttKanRedigera(p, t)))
            rader += '<div class="g-rad g-nyrad" style="--gf:' + farg + '"><div class="g-etikett g-mom">' +
                '<input class="g-nyin" data-gny="' + p.id + '" maxlength="120" placeholder="+ Nytt namn, tryck Enter" aria-label="Nytt i ' + esc(p.projekt) + '">' +
                '</div><div class="g-spar" style="width:' + bredd + "px;" + bakgrund + '"></div></div>';
    });
    if (tom && !o.dra)
        rader += '<div class="g-rad g-tomrad"><div class="g-etikett"></div><div class="g-spar" style="width:' + bredd + "px;" + bakgrund + '">' +
            "<span>" + "Inga produktionsmoment i perioden." + "</span></div></div>";
    const markdag = IDAG;
    const idag = markdag >= fran && markdag <= till ? '<div class="g-idaglinje" style="left:calc(var(--g-et) + ' + (x(markdag) + dw / 2).toFixed(1) + 'px)"></div>' : "";
    return '<div class="g-skroll"><div class="g-tabell' + (dw < 12 ? " grov" : "") + (7 * dw < 20 ? " tat" : "") + (medDagar ? " meddagar" : "") + '" data-gdw="' + dw + '" style="width:calc(var(--g-et) + ' + bredd + 'px)">' +
        '<div class="g-rad g-huvud"><div class="g-etikett g-horn">Moment</div>' +
        '<div class="g-tid" style="width:' + bredd + 'px">' + veckor + "</div></div>" +
        rader + idag + "</div></div>";
}

function ganttDiamant(m, x, dw, kanDra) {
    const dra = kanDra && !m.klar && ganttKanRedigera(m.p, m.t);
    const tips = (m.typ === "avrop" ? "Avrop: " : m.typ === "ue" ? "UE: " : "Leverans: ") + m.text + "\n" + dagEtikett(m.dag) + (m.klar ? " · klar" : "") + (dra ? "\nDra för att flytta" : "");
    return '<button type="button" class="g-dia g-' + m.typ + (m.klar ? " klar" : "") + (dra ? " g-dra" : "") + (ganttBlinkar(m.k.id) ? " g-blink" : "") + '" data-gkort="' + m.p.id + "|" + m.t.id + "|" + m.k.id +
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
    const v = Math.floor((iso2d(k.dag) - iso2d(tavlaStart())) / 86400000 / 7);
    vyOffset = v >= 0 && v < 4 ? 0 : v;
    stangGantt();
    if (window.p4MarkeraNav)
        window.p4MarkeraNav();
    rita();
    window.scrollTo({ top: 0 });
    visaKort(k);
}

document.getElementById("gantt").addEventListener("click", (e) => {
    const plus = e.target.closest(".g-plus");
    if (plus) {
        e.preventDefault();
        e.stopPropagation();
        return ganttLaggTill(plus.dataset.gplus);
    }
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
    if (g === "exportmeny") {
        const meny = b.parentNode.querySelector(".g-expmeny"), oppen = meny.classList.contains("dold");
        meny.classList.toggle("dold", !oppen);
        b.setAttribute("aria-expanded", String(oppen));
        return;
    }
    if (g === "exp-pdf" || g === "exp-png" || g === "exp-csv") {
        b.closest(".g-expmeny").classList.add("dold");
        return g === "exp-csv" ? ganttExportCsv() : g === "exp-png" ? ganttExportBild() : ganttExportPdf();
    }
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

/* ---------- export ---------- */

// Stäng exportmenyn vid klick utanför.
document.addEventListener("mousedown", (e) => {
    const meny = document.querySelector("#gantt .g-expmeny:not(.dold)");
    if (meny && !e.target.closest(".g-exp")) {
        meny.classList.add("dold");
        const k = document.querySelector("#gantt .g-expknapp");
        if (k) k.setAttribute("aria-expanded", "false");
    }
});

function ganttFilnamn(andelse) {
    const { valda, per } = ganttUrval();
    const namn = valda.length === 1 ? valda[0].projekt : valda.length + " projekt";
    const period = per.per === "vecka" ? "v" + veckonr(per.fran) + " " + iso2d(per.fran).getFullYear()
        : per.namn;
    return ("Gantt " + namn + " " + period).replace(/[^\p{L}\p{N} ._-]+/gu, "").replace(/\s+/g, " ").trim() + "." + andelse;
}

function ganttLaddaNer(namn, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = namn;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Excel: semikolon och BOM så att svenska Excel öppnar filen rätt.
function ganttExportCsv() {
    const { data, per } = ganttUrval();
    const cell = (v) => {
        const t = String(v == null ? "" : v);
        return /[;"\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
    };
    const dagarMellan = (a, b) => Math.round((iso2d(b) - iso2d(a)) / 86400000) + 1;
    const rader = [["Projekt", "Tavla", "Moment", "Del", "Ansvarig", "Start", "Klart", "Dagar", "Vecka start", "Vecka klart", "Status"]];
    data.forEach(d => {
        d.moment.forEach(m => rader.push([d.p.projekt, m.t.namn, m.namn, kortDel(m.k, m.t), m.k.vem || "", m.fran, m.till,
            dagarMellan(m.fran, m.till), veckonr(m.fran), veckonr(m.till), ganttStatus(m).text]));
        if (gantt.milstolpar) {
            const mil = d.losa.concat(...d.moment.map(m => m.mil.map(x => Object.assign({ moment: m.namn }, x))));
            mil.forEach(x => rader.push([d.p.projekt, x.t.namn, (x.typ === "avrop" ? "Avrop: " : "Leverans: ") + x.text +
                (x.moment ? " (" + x.moment + ")" : ""), "", x.k.vem || "", x.dag, x.dag, 1, veckonr(x.dag), veckonr(x.dag), x.klar ? "Klart" : "Milstolpe"]));
        }
    });
    const text = "﻿" + "Gantt-schema;" + cell(per.namn) + "\r\n\r\n" + rader.map(r => r.map(cell).join(";")).join("\r\n") + "\r\n";
    ganttLaddaNer(ganttFilnamn("csv"), new Blob([text], { type: "text/csv;charset=utf-8" }));
    status("Gantt-schemat exporterat som Excel-fil");
}

function ganttExportBild() {
    ganttRitaBild().toBlob((blob) => {
        if (!blob) return status("Bilden kunde inte skapas", true);
        ganttLaddaNer(ganttFilnamn("png"), blob);
        status("Gantt-schemat exporterat som bild");
    }, "image/png");
}

// PDF: bilden läggs på en egen utskriftssida och webbläsarens utskrift öppnas (välj "Spara som PDF").
function ganttExportPdf() {
    const url = ganttRitaBild().toDataURL("image/png");
    let ruta = document.getElementById("gUtskrift");
    if (!ruta) {
        ruta = document.createElement("div");
        ruta.id = "gUtskrift";
        document.body.appendChild(ruta);
    }
    ruta.innerHTML = '<img alt="Gantt-schema" src="' + url + '">';
    const bild = ruta.querySelector("img");
    const skrivUt = () => {
        document.body.classList.add("g-skrivut");
        const klar = () => { document.body.classList.remove("g-skrivut"); window.removeEventListener("afterprint", klar); };
        window.addEventListener("afterprint", klar);
        window.print();
        setTimeout(klar, 1500);
    };
    if (bild.complete) skrivUt();
    else bild.onload = skrivUt;
}

// Ritar schemat på en canvas: samma urval som på skärmen.
function ganttRitaBild() {
    const { valda, per, data } = ganttUrval(), { fran, till } = per;
    const dagar = Math.round((iso2d(till) - iso2d(fran)) / 86400000) + 1;
    const ET = 300, TID = Math.max(900, Math.min(1500, dagar * 48)), dw = TID / dagar;
    const medDagar = dw >= 30, RAD = 34, PROJRAD = 40, TOPP = 96, HUVUD = medDagar ? 56 : 34, KANT = 24;
    // rader
    const rader = [];
    data.forEach(d => {
        rader.push({ typ: "proj", d });
        if (gantt.ihop.includes(d.p.id)) return;
        d.moment.forEach(m => rader.push({ typ: "mom", d, m }));
        if (gantt.milstolpar && d.losa.length) rader.push({ typ: "mil", d });
    });
    const hojd = TOPP + HUVUD + rader.reduce((h, r) => h + (r.typ === "proj" ? PROJRAD : RAD), 0) + 56;
    const bredd = KANT * 2 + ET + TID;
    const SK = 2, c = document.createElement("canvas");
    c.width = bredd * SK;
    c.height = hojd * SK;
    const g = c.getContext("2d");
    g.scale(SK, SK);
    const css = getComputedStyle(document.documentElement);
    const v = (n, alt) => (css.getPropertyValue(n) || "").trim() || alt;
    const F = { text: v("--text-main", "#1d2125"), mutad: v("--text-muted", "#5b636b"), svag: v("--text-faint", "#8b939b"),
        linje: v("--border-light", "#ece7de"), kant: v("--border-color", "#ddd6ca"), bg: "#ffffff", alt: v("--bg-main", "#f6f3ee"),
        rod: v("--leverans", "#b32d22"), rodfyll: v("--leverans-fyll", "#fbe9e7"), avrop: v("--avrop", "#6b4a9c"), lev: v("--leverans", "#b32d22"), ue: v("--ue", "#b85a0d") };
    const font = (vikt, storlek) => vikt + " " + storlek + "px Inter, system-ui, sans-serif";
    const blanda = (hex, andel) => {        // hex blandad med vitt
        const n = parseInt(hex.slice(1), 16), r = n >> 16, gg = (n >> 8) & 255, b = n & 255;
        const m = (x) => Math.round(x * andel + 255 * (1 - andel));
        return "rgb(" + m(r) + "," + m(gg) + "," + m(b) + ")";
    };
    const klipp = (txt, max) => {
        if (g.measureText(txt).width <= max) return txt;
        while (txt.length > 1 && g.measureText(txt + "…").width > max) txt = txt.slice(0, -1);
        return txt + "…";
    };
    const x = (iso) => KANT + ET + Math.round((iso2d(iso) - iso2d(fran)) / 86400000) * dw;
    const kl = (iso) => iso < fran ? fran : iso > till ? till : iso;
    const rundad = (x0, y0, w, h, r) => { g.beginPath(); g.roundRect ? g.roundRect(x0, y0, w, h, r) : g.rect(x0, y0, w, h); };

    g.fillStyle = F.bg;
    g.fillRect(0, 0, bredd, hojd);
    // rubrik
    g.fillStyle = F.text;
    g.font = font(800, 24);
    g.fillText("Gantt-schema · " + per.namn, KANT, 40);
    g.font = font(500, 13);
    g.fillStyle = F.mutad;
    const antal = data.reduce((n, d) => n + d.moment.length, 0);
    g.fillText(valda.map(p => p.projekt).join(", ") + " · " + antal + " moment · utskrivet " + kortDatum(IDAG) + " " + new Date().getFullYear(), KANT, 64);

    // tidshuvud
    const y0 = TOPP;
    g.fillStyle = F.alt;
    g.fillRect(KANT, y0, ET + TID, HUVUD);
    g.font = font(700, 11);
    g.fillStyle = F.svag;
    g.fillText("MOMENT", KANT + 14, y0 + HUVUD - 12);
    for (let i = 0; i < dagar; i += 7) {
        const iso = plus(fran, i), xx = KANT + ET + i * dw, w = 7 * dw;
        g.strokeStyle = F.kant;
        g.beginPath(); g.moveTo(xx + .5, y0); g.lineTo(xx + .5, y0 + HUVUD); g.stroke();
        const nu = iso <= IDAG && IDAG <= plus(iso, 6);
        g.fillStyle = nu ? "#0369a1" : F.text;
        g.font = font(nu ? 800 : 700, 12);
        const txt = w >= 130 ? "Vecka " + veckonr(iso) + "  " + kortDatum(iso) + "–" + kortDatum(plus(iso, 6)) : w >= 34 ? "v" + veckonr(iso) : w >= 16 ? String(veckonr(iso)) : "";
        g.textAlign = "center";
        g.fillText(txt, xx + w / 2, y0 + (medDagar ? 20 : 22));
        g.textAlign = "left";
    }
    if (medDagar)
        for (let i = 0; i < dagar; i++) {
            const iso = plus(fran, i), vd = (iso2d(iso).getDay() + 6) % 7, xx = KANT + ET + i * dw;
            if (iso === IDAG) { g.fillStyle = "rgba(56,189,248,.16)"; g.fillRect(xx, y0 + 28, dw, HUVUD - 28); }
            g.fillStyle = iso === IDAG ? "#0369a1" : vd > 4 ? F.svag : F.mutad;
            g.font = font(iso === IDAG ? 800 : 600, 11.5);
            g.textAlign = "center";
            g.fillText(GANTT_DAGKORT[vd] + (dw >= 64 ? " " + kortDatum(iso) : ""), xx + dw / 2, y0 + 46);
            g.textAlign = "left";
        }

    // rader
    let y = y0 + HUVUD;
    const raderTopp = y;
    rader.forEach(rad => {
        const h = rad.typ === "proj" ? PROJRAD : RAD, farg = ganttFarg(rad.d.p);
        // helger
        for (let i = 0; i < dagar; i++) {
            const vd = (iso2d(plus(fran, i)).getDay() + 6) % 7;
            if (vd > 4 && dw >= 3) { g.fillStyle = "rgba(0,0,0,.025)"; g.fillRect(KANT + ET + i * dw, y, dw, h); }
        }
        if (rad.typ === "proj") {
            g.fillStyle = blanda(farg, .08);
            g.fillRect(KANT, y, ET + TID, h);
            g.fillStyle = farg;
            g.fillRect(KANT, y, 4, h);
            g.fillStyle = F.text;
            g.font = font(800, 14);
            g.fillText(klipp(rad.d.p.projekt, ET - 30), KANT + 16, y + 18);
            g.font = font(500, 11.5);
            g.fillStyle = F.mutad;
            const kl2 = rad.d.moment.filter(m => m.klar).length;
            g.fillText(rad.d.moment.length ? rad.d.moment.length + " moment · " + kl2 + " klara" : "Inget i perioden", KANT + 16, y + 33);
            const mom = rad.d.moment;
            if (mom.length) {
                const a = kl(mom.reduce((s, m) => m.fran < s ? m.fran : s, mom[0].fran)), b = kl(mom.reduce((s, m) => m.till > s ? m.till : s, mom[0].till));
                g.fillStyle = farg;
                rundad(x(a), y + h / 2 - 4, x(b) - x(a) + dw, 8, 4);
                g.fill();
            }
        }
        else if (rad.typ === "mom") {
            const m = rad.m, st = ganttStatus(m);
            g.fillStyle = F.text;
            g.font = font(700, 12.5);
            g.fillText(klipp(m.namn, ET - 28), KANT + 16, y + 15);
            g.font = font(500, 11);
            g.fillStyle = F.svag;
            const under = (m.fran === m.till ? kortDatum(m.fran) : kortDatum(m.fran) + "–" + kortDatum(m.till)) +
                (rad.d.p.tavlor.length > 1 ? " · " + m.t.namn : "") + (kortDel(m.k, m.t) ? " · " + kortDel(m.k, m.t) : "") + (st.klass ? " · " + st.text : "");
            g.fillText(klipp(under, ET - 28), KANT + 16, y + 28);
            const xa = x(kl(m.fran)), w = Math.max(6, x(kl(m.till)) - xa + dw), yb = y + 7, hb = h - 14;
            if (st.klass === "klar") {
                g.fillStyle = F.alt; rundad(xa, yb, w, hb, 4); g.fill();
                g.strokeStyle = F.kant; g.lineWidth = 1; rundad(xa + .5, yb + .5, w - 1, hb - 1, 4); g.stroke();
            }
            else if (st.klass === "sen") {
                g.fillStyle = F.rodfyll; rundad(xa, yb, w, hb, 4); g.fill();
                g.strokeStyle = F.rod; g.lineWidth = 1.5; rundad(xa + .75, yb + .75, w - 1.5, hb - 1.5, 4); g.stroke();
            }
            else {
                g.fillStyle = blanda(farg, st.klass === "pagar" ? .55 : .22); rundad(xa, yb, w, hb, 4); g.fill();
                g.fillStyle = farg; g.fillRect(xa, yb, 3, hb);
            }
            g.font = font(600, 11.5);
            const tw = g.measureText(m.namn).width;
            g.fillStyle = st.klass === "sen" ? F.rod : st.klass === "klar" ? F.mutad : F.text;
            if (tw + 16 <= w) g.fillText(m.namn, xa + 8, y + h / 2 + 4);
            else if (xa + w + 8 + tw < KANT + ET + TID) { g.fillStyle = F.mutad; g.fillText(m.namn, xa + w + 6, y + h / 2 + 4); }
            if (gantt.milstolpar) m.mil.forEach(ml => diamant(ml, y + h / 2));
            if (m.milstolpe && m.milstolpe >= fran && m.milstolpe <= till) diamant({ dag: m.milstolpe, typ: "milstolpe", klar: m.klar, slut: true }, y + h / 2);
        }
        else {
            g.fillStyle = F.mutad;
            g.font = font(700, 12);
            g.fillText("Avrop och leveranser", KANT + 16, y + 15);
            g.font = font(500, 11);
            g.fillStyle = F.svag;
            g.fillText(rad.d.losa.length + " utan kopplat moment", KANT + 16, y + 28);
            rad.d.losa.forEach(ml => diamant(ml, y + h / 2));
        }
        g.strokeStyle = F.linje;
        g.lineWidth = 1;
        g.beginPath(); g.moveTo(KANT, y + h + .5); g.lineTo(KANT + ET + TID, y + h + .5); g.stroke();
        y += h;
    });
    function diamant(ml, cy) {
        const cx = x(ml.dag) + (ml.slut ? dw : dw / 2), r = ml.typ === "milstolpe" ? 7 : 6;
        g.beginPath(); g.moveTo(cx, cy - r); g.lineTo(cx + r, cy); g.lineTo(cx, cy + r); g.lineTo(cx - r, cy); g.closePath();
        const fd = ml.typ === "milstolpe" ? "#d9a21b" : ml.typ === "avrop" ? F.avrop : ml.typ === "ue" ? F.ue : F.lev;
        g.fillStyle = ml.klar ? "#ffffff" : fd;
        g.fill();
        g.strokeStyle = fd;
        g.lineWidth = 1.5;
        g.stroke();
    }
    if (!rader.length) {
        g.fillStyle = F.svag;
        g.font = font(500, 13);
        g.fillText("Inga produktionsmoment i perioden.", KANT + ET + 16, y + 24);
        y += 40;
    }
    // veckolinjer, etikettkant och idaglinje
    g.strokeStyle = F.linje;
    for (let i = 0; i <= dagar; i += 7) {
        const xx = KANT + ET + i * dw;
        g.beginPath(); g.moveTo(xx + .5, raderTopp); g.lineTo(xx + .5, y); g.stroke();
    }
    g.strokeStyle = F.kant;
    g.beginPath(); g.moveTo(KANT + ET + .5, y0); g.lineTo(KANT + ET + .5, y); g.stroke();
    g.strokeRect(KANT + .5, y0 + .5, ET + TID - 1, y - y0 - 1);
    const markdag = IDAG;
    if (markdag >= fran && markdag <= till) {
        const xx = x(markdag) + dw / 2;
        g.strokeStyle = "#0284c7";
        g.lineWidth = 2;
        g.beginPath(); g.moveTo(xx, y0 + HUVUD); g.lineTo(xx, y); g.stroke();
        g.lineWidth = 1;
    }
    // teckenförklaring
    let lx = KANT, ly = y + 30;
    const fk = (namn, ritaFn) => { ritaFn(lx, ly - 9); g.fillStyle = F.mutad; g.font = font(500, 11.5); g.fillText(namn, lx + 26, ly); lx += 26 + g.measureText(namn).width + 22; };
    const gf = "#5b636b";
    fk("Planerat", (a, b) => { g.fillStyle = blanda(gf, .22); g.fillRect(a, b, 20, 10); g.fillStyle = gf; g.fillRect(a, b, 3, 10); });
    fk("Pågår", (a, b) => { g.fillStyle = blanda(gf, .55); g.fillRect(a, b, 20, 10); g.fillStyle = gf; g.fillRect(a, b, 3, 10); });
    fk("Försenat", (a, b) => { g.fillStyle = F.rodfyll; g.fillRect(a, b, 20, 10); g.strokeStyle = F.rod; g.strokeRect(a + .5, b + .5, 19, 9); });
    fk("Klart", (a, b) => { g.fillStyle = F.alt; g.fillRect(a, b, 20, 10); g.strokeStyle = F.kant; g.strokeRect(a + .5, b + .5, 19, 9); });
    if (gantt.milstolpar) {
        const dia = (farg) => (a, b) => {
            const cx = a + 10, cy = b + 5, r = 6;
            g.beginPath(); g.moveTo(cx, cy - r); g.lineTo(cx + r, cy); g.lineTo(cx, cy + r); g.lineTo(cx - r, cy); g.closePath();
            g.fillStyle = farg; g.fill();
        };
        fk("Avrop", dia(F.avrop));
        fk("Leverans", dia(F.lev));
        fk("UE", dia(F.ue));
    }
    return c;
}

/* ---------- lägg till direkt i schemat ---------- */

// Plustecknet på varje rad i sidopanelen. Ligger inuti radens knapp, därför ett span med rollen knapp.
function ganttPlus(nyckel, etikett) {
    return '<span class="g-plus" role="button" tabindex="0" data-gplus="' + esc(nyckel) + '" title="' + esc(etikett) +
        '" aria-label="' + esc(etikett) + '">+</span>';
}

document.getElementById("gantt").addEventListener("keydown", (e) => {
    const plus = e.target.closest && e.target.closest(".g-plus");
    if (!plus || (e.key !== "Enter" && e.key !== " "))
        return;
    e.preventDefault();
    e.stopPropagation();
    ganttLaggTill(plus.dataset.gplus);
});

const GANTT_NYTT = {
    produktion: { namn: "Produktionsmoment", text: "T.ex. Montage innerväggar plan 3" },
    avrop: { namn: "Avrop", text: "T.ex. Gips, reglar och skenor" },
    leverans: { namn: "Leverans", text: "T.ex. Leverans NP Nilsson" },
    ue: { namn: "UE", text: "T.ex. Flytspackling Golvbolaget" },
    mote: { namn: "Möte", text: "T.ex. Byggmöte" },
    ovrigt: { namn: "Övrigt", text: "Vad ska hända?" }
};

// Lördag och söndag finns inte på tavlan: lägg posten på fredagen före.
function ganttVardag(iso) {
    const d = iso2d(iso), v = (d.getDay() + 6) % 7;
    if (v > 4)
        d.setDate(d.getDate() - (v - 4));
    return d2iso(d);
}

function ganttKanRedigera(p, t) {
    try { return typeof window.p4KanRedigera !== "function" || window.p4KanRedigera(p.id, t.id); } catch (e) { return true; }
}

function ganttLaggTill(nyckel) {
    const [pid, tid, kid] = String(nyckel || "").split("|");
    const p = plan4.projekt.find(x => x.id === pid);
    if (!p)
        return;
    const tavlor = p.tavlor.filter(t => ganttKanRedigera(p, t));
    if (!tavlor.length)
        return status("Du har bara läsbehörighet i " + p.projekt);
    const mt = tid ? p.tavlor.find(t => t.id === tid) : null;
    const mk = mt && kid ? mt.kort.find(k => k.id === kid) : null;
    const slut = mk ? slutPostI(mt, mk) : null;
    const typer = mk ? ["avrop", "leverans", "ue", "produktion", "mote", "ovrigt"] : ["produktion", "avrop", "leverans", "ue", "mote", "ovrigt"];
    const startTavla = mk && tavlor.includes(mt) ? mt : (tavlor.find(t => p === state && t.id === state.aktiv) || tavlor[0]);
    const dag0 = mk ? (mk.dag >= IDAG ? mk.dag : IDAG) : IDAG;
    const kropp =
        (mk ? '<div class="notis">Kopplas till momentet <b>' + esc(momentNamn(mk)) + "</b> och syns på samma rad i schemat.</div>" : "") +
        '<div class="falt"><label>Vad vill du lägga till?</label><div class="snabbtyp g-nytyp" role="radiogroup">' +
        typer.map((ty, i) => '<button type="button" role="radio" data-gtyp="' + ty + '" data-t="' + ty + '"' + (i === 0 ? ' class="vald"' : "") +
            '" aria-checked="' + (i === 0) + '">' + GANTT_NYTT[ty].namn + "</button>").join("") + "</div></div>" +
        '<div class="falt"><label for="gpText">Text</label><input class="f" id="gpText" maxlength="120" placeholder="' + esc(GANTT_NYTT[typer[0]].text) + '"></div>' +
        '<div class="tva"><div class="falt"><label for="gpDag" id="gpDagEtikett">' + (typer[0] === "produktion" ? "Start" : "Datum") + "</label>" +
        '<input class="f" id="gpDag" type="date" required value="' + dag0 + '"></div>' +
        '<div class="falt" id="gpKlarFalt"' + (typer[0] === "produktion" ? "" : " hidden") + '><label for="gpKlar">Klart</label>' +
        '<input class="f" id="gpKlar" type="date" required value="' + dag0 + '"></div></div>' +
        '<div class="tva">' +
        (tavlor.length > 1 ? '<div class="falt"><label for="gpTavla">Tavla</label><select class="f" id="gpTavla">' +
            tavlor.map(t => '<option value="' + esc(t.id) + '"' + (t === startTavla ? " selected" : "") + ">" + esc(t.namn) + "</option>").join("") +
            "</select></div>" : "") +
        '<div class="falt"><label for="gpVem">Ansvarig (valfritt)</label><input class="f" id="gpVem" maxlength="60" value="' +
        esc(mk && mk.vem ? mk.vem : "") + '"></div></div>' +
        '<p class="hjalp">Posten hamnar direkt på tavlan i kalendern. Lördag och söndag läggs på fredagen före.</p>';
    modal(mk ? "Lägg till i " + momentNamn(mk) : "Lägg till i " + p.projekt,
        mk ? p.projekt + (p.tavlor.length > 1 ? " · " + mt.namn : "") + " · " + (slut && slut.dag > mk.dag ? kortDatum(mk.dag) + "–" + kortDatum(slut.dag) : kortDatum(mk.dag)) : "Direkt från Gantt-schemat",
        kropp, [
        { txt: "Avbryt", fn: stangModal },
        { txt: "Lägg till", primar: true, fn: () => ganttSparaNytt(p, tavlor, mt, mk) }
    ]);
    const box = document.getElementById("overlay");
    let typ = typer[0];
    box.querySelector(".g-nytyp").addEventListener("click", (e) => {
        const b = e.target.closest("[data-gtyp]");
        if (!b)
            return;
        typ = b.dataset.gtyp;
        box.querySelectorAll("[data-gtyp]").forEach(x => { x.classList.toggle("vald", x === b); x.setAttribute("aria-checked", String(x === b)); });
        document.getElementById("gpText").placeholder = GANTT_NYTT[typ].text;
        document.getElementById("gpKlarFalt").hidden = typ !== "produktion";
        document.getElementById("gpDagEtikett").textContent = typ === "produktion" ? "Start" : "Datum";
        box.dataset.gtyp = typ;
    });
    box.dataset.gtyp = typ;
    setTimeout(() => { const f = document.getElementById("gpText"); if (f) f.focus(); }, 30);
}

function ganttSparaNytt(p, tavlor, mt, mk) {
    const box = document.getElementById("overlay");
    const typ = box.dataset.gtyp || "produktion";
    const text = document.getElementById("gpText").value.trim();
    if (!text) {
        document.getElementById("gpText").focus();
        return status("Skriv vad som ska läggas till", true);
    }
    const valj = document.getElementById("gpTavla");
    const t = valj ? tavlor.find(x => x.id === valj.value) : tavlor[0];
    const dagIn = document.getElementById("gpDag").value;
    if (!dagIn)
        return status("Välj ett datum", true);
    const dag = ganttVardag(dagIn);
    const vem = document.getElementById("gpVem").value.trim();
    let patch;
    if (typ === "produktion") {
        const klarIn = document.getElementById("gpKlar").value || dagIn;
        const klar = ganttVardag(klarIn < dagIn ? dagIn : klarIn);
        const kedja = "k" + uid();
        const kort = klar === dag
            ? [{ dag, typ: "produktion", roll: "P", text, vem, kedja }]
            : [{ dag, typ: "produktion", roll: "S", text: "Start " + text, vem, kedja }, { dag: klar, typ: "produktion", roll: "K", text: text + " klart", vem, kedja }];
        patch = opGuideLaggUpp({ kort, text, start: dag, plats: "", bemanning: { behov: [], personer: [] }, grund: [], forval: [], mtrl: [], hinder: [] }, t.id);
    }
    else {
        // avrop och leveranser kopplas till momentet (samma kedja) när de läggs till från en momentrad på samma tavla
        const kedja = mk && mt === t && mk.kedja && (typ === "avrop" || typ === "leverans" || typ === "ue") ? mk.kedja : null;
        patch = opNyttKort({ dag, typ, text, vem, kedja, roll: kedja ? (typ === "avrop" ? "A" : "L") : null }, t.id);
    }
    if (!patch || !patch.ok || !appliceraPatch(patch, { tavla: t, projekt: p }))
        return status("Det gick inte att lägga till", true);
    if (patch.historik && patch.historik.length)
        patch.historik.forEach(h => logg2(t, h));
    else
        logg2(t, GANTT_NYTT[typ].namn + " tillagt från Gantt-schemat: " + text);
    stangModal();
    spara();
    try { rita(); } catch (e) { }
    ritaGantt();
    status(GANTT_NYTT[typ].namn + " tillagt · " + kortDatum(dag) + (p.tavlor.length > 1 ? " · " + t.namn : ""));
}

/* ---------- Gantt i Projektöversikten ---------- */

function ritaDashGantt(el, andraForsok) {
    if (!el)
        return;
    const { valda, per, data } = ganttUrval(), { fran, till } = per;
    const dagar = Math.round((iso2d(till) - iso2d(fran)) / 86400000) + 1;
    const et = window.innerWidth <= 700 ? 170 : 270;
    const bredd0 = el._yta || Math.max(200, el.clientWidth - 2 - et);
    const dw = Math.max(per.per === "ar" ? 1.5 : 6, bredd0 / dagar);
    const x = (iso) => Math.round((iso2d(iso) - iso2d(fran)) / 86400000) * dw;
    const bredd = Math.floor(dagar * dw);
    const info = document.getElementById("dashGanttInfo");
    if (info)
        info.textContent = per.namn + " · " + valda.length + " projekt";
    el.innerHTML = '<div class="p4-gantt"><div class="g-schema">' + (valda.length ? ganttTabell(data, { fran, till, dagar, dw, x, bredd, per })
        : '<div class="g-tom"><b>Inga projekt valda</b><span>Välj projekt på Gantt-sidan.</span></div>') + "</div></div>";
    const sk = el.querySelector(".g-skroll");
    if (sk) {
        const yta = sk.clientWidth - et;
        if (!andraForsok && yta > 0 && Math.abs(yta - bredd0) > 1) {
            el._yta = yta;
            return ritaDashGantt(el, true);
        }
        if (per.per === "ar" && sk.scrollWidth > sk.clientWidth)
            sk.scrollLeft = Math.max(0, x(IDAG) - 4 * 7 * dw);
    }
}
