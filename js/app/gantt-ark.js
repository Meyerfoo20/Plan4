/* ======================================================================
   Gantt-schemat som planeringsark.

   Till vänster ett ark med en rad per moment: nummer, moment, start, slut,
   arbetsdagar och ansvarig. Cellerna går att skriva i direkt, som i ett
   kalkylark (Enter sparar och går ner, Tab går åt höger, Esc ångrar).
   Till höger tidslinjen: dra en stapel för att flytta momentet, dra i
   kanterna för att ändra start eller slut. Allt sparas direkt på tavlorna,
   så kalendern följer med. Lördag och söndag finns inte på tavlan: datum
   som hamnar på en helg läggs på närmaste vardag.

   Ett moment är en produktionskedja (Start → Klart) eller en endagspost.
   Flyttas hela momentet följer kedjans avrop och leveranser med.
   ====================================================================== */

const ARK_KOLUMNER = [
    { id: "nr", namn: "#", bredd: 34 },
    { id: "namn", namn: "Moment", bredd: 0 },          // tar resten av bredden
    { id: "fran", namn: "Start", bredd: 74 },
    { id: "till", namn: "Slut", bredd: 74 },
    { id: "dagar", namn: "Dgr", bredd: 46 },
    { id: "vem", namn: "Ansvarig", bredd: 104 }
];

// Arkets bredd (sticky till vänster) efter skärmen.
function arkBredd() {
    const w = window.innerWidth;
    return w <= 700 ? 250 : w <= 1300 ? 430 : 548;
}
function arkKolumner() {
    const w = window.innerWidth;
    return ARK_KOLUMNER.filter(k => !(k.id === "vem" && w <= 1300) && !(k.id === "dagar" && w <= 700) && !(k.id === "nr" && w <= 700))
        .map(k => w <= 700 && (k.id === "fran" || k.id === "till") ? Object.assign({}, k, { bredd: 54 }) : k);
}
function arkMall() {
    return arkKolumner().map(k => k.bredd ? k.bredd + "px" : "minmax(0,1fr)").join(" ");
}

const arbDagar = (fran, till) => arbetsdagarMellan(fran, till) + 1;
const arkVardag = (iso) => (iso2d(iso).getDay() + 6) % 7 < 5;
// Helg: framåt till måndag eller bakåt till fredag.
function arkSnap(iso, riktning) {
    let d = iso;
    while (!arkVardag(d))
        d = plus(d, riktning < 0 ? -1 : 1);
    return d;
}

/* ---------- datum som text ---------- */

const ARK_MAN = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
const arkDatum = (iso) => { const d = iso2d(iso); return d.getDate() + " " + ARK_MAN[d.getMonth()]; };

// Tolkar det man skriver i en datumcell: 12/11, 12/11/2027, 2026-11-12, 12 nov, +3 (arbetsdagar), -2.
function arkTolkaDatum(txt, bas) {
    const s = String(txt || "").trim().toLowerCase();
    if (!s)
        return null;
    let m = /^([+-])\s*(\d{1,3})$/.exec(s);
    if (m)
        return skiftaArbetsdagar(bas || IDAG, (m[1] === "-" ? -1 : 1) * +m[2]);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s))
        return s;
    const ar0 = iso2d(bas || IDAG).getFullYear();
    const ihop = (d, mn, ar) => {
        if (!(mn >= 1 && mn <= 12 && d >= 1 && d <= 31))
            return null;
        const dt = new Date(ar, mn - 1, d);
        return dt.getMonth() === mn - 1 ? d2iso(dt) : null;
    };
    m = /^(\d{1,2})\s*[\/.\-]\s*(\d{1,2})(?:\s*[\/.\-]\s*(\d{2,4}))?$/.exec(s);
    if (m)
        return ihop(+m[1], +m[2], m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : ar0);
    m = /^(\d{1,2})\s*([a-zåäö]{3,})\.?(?:\s*(\d{4}))?$/.exec(s);
    if (m) {
        const i = ARK_MAN.findIndex(x => m[2].indexOf(x) === 0 || (x === "mar" && m[2].indexOf("mars") === 0));
        if (i >= 0)
            return ihop(+m[1], i + 1, m[3] ? +m[3] : ar0);
    }
    return null;
}

/* ---------- data för en rad ---------- */

function arkMoment(nyckel) {
    const [pid, tid, kid] = String(nyckel || "").split("|");
    const p = plan4.projekt.find(x => x.id === pid);
    const t = p && p.tavlor.find(x => x.id === tid);
    const k = t && t.kort.find(x => x.id === kid);
    if (!k)
        return null;
    const slut = slutPostI(t, k);
    const kedja = k.kedja ? t.kort.filter(x => x.kedja === k.kedja) : [k];
    const till = slut && slut.dag > k.dag ? slut.dag : k.dag;
    return { p, t, k, slut, kedja, fran: k.dag, till, klar: slut ? !!slut.klar : !!k.klar,
        kanAndra: ganttKanRedigera(p, t) && !(slut ? slut.klar : k.klar) };
}

/* ---------- rita arket ---------- */

function ganttArk(data, o) {
    const { fran, till, dagar, dw, x, bredd } = o;
    const kol = arkKolumner(), mall = arkMall(), et = arkBredd();
    let veckor = "";
    for (let i = 0; i < dagar; i += 7) {
        const iso = plus(fran, i), w = 7 * dw, nu = iso <= IDAG && IDAG <= plus(iso, 6);
        const txt = w >= 120 ? "Vecka " + veckonr(iso) + " <small>" + kortDatum(iso) + "–" + kortDatum(plus(iso, 6)) + "</small>"
            : w >= 34 ? "v" + veckonr(iso) : w >= 15 || veckonr(iso) % 2 === 0 ? String(veckonr(iso)) : "";
        veckor += '<div class="g-cell' + (nu ? " idag" : "") + '" style="left:' + (i * dw).toFixed(1) + "px;width:" + w.toFixed(1) + 'px">' + txt + "</div>";
    }
    const medDagar = dw >= 22;
    if (medDagar)
        for (let i = 0; i < dagar; i++) {
            const iso = plus(fran, i), vd = (iso2d(iso).getDay() + 6) % 7;
            veckor += '<div class="g-cell g-dagcell' + (iso === IDAG ? " idag" : "") + (vd > 4 ? " helg" : "") +
                '" style="left:' + (i * dw).toFixed(1) + "px;width:" + dw.toFixed(1) + 'px" title="' + esc(dagEtikett(iso)) + '">' +
                (dw >= 64 ? GANTT_DAGKORT[vd] + " <small>" + kortDatum(iso) + "</small>" : dw >= 34 ? GANTT_DAGKORT[vd] : GANTT_DAGKORT[vd][0]) + "</div>";
        }
    const bakgrund = "--vb:" + (7 * dw).toFixed(2) + "px;--hb:" + (5 * dw).toFixed(2) + "px;--db:" + dw.toFixed(2) + "px";
    const kl = (iso) => iso < fran ? fran : iso > till ? till : iso;
    const celler = (varden, klass) => '<div class="a-celler' + (klass ? " " + klass : "") + '" style="grid-template-columns:' + mall + '">' +
        kol.map(k => varden[k.id] || '<span class="a-c a-' + k.id + '"></span>').join("") + "</div>";
    let rader = "", nr = 0;
    data.forEach(d => {
        const p = d.p, farg = ganttFarg(p), ihop = gantt.ihop.includes(p.id), moment = d.moment;
        const allaMoment = ganttMoment(p).moment;
        const span = allaMoment.length ? { fran: allaMoment.reduce((a, m) => m.fran < a ? m.fran : a, allaMoment[0].fran),
            till: allaMoment.reduce((a, m) => m.till > a ? m.till : a, allaMoment[0].till) } : null;
        const kanNagot = p.tavlor.some(t => ganttKanRedigera(p, t));
        const klara = allaMoment.filter(m => m.klar).length;
        rader += '<div class="g-rad g-projrad a-projrad" style="--gf:' + farg + '">' +
            '<div class="g-etikett a-etikett">' + celler({
                nr: '<button type="button" class="a-c a-nr a-fall" data-gihop="' + p.id + '" aria-expanded="' + !ihop + '" title="' + (ihop ? "Visa moment" : "Fäll ihop") + '">' +
                    '<span class="p4-caret' + (ihop ? " stangd" : "") + '" aria-hidden="true"></span></button>',
                namn: '<span class="a-c a-namn a-proj"><span class="g-ruta"></span><span class="a-ptext"><b>' + esc(p.projekt) + "</b><small>" +
                    (allaMoment.length ? allaMoment.length + " moment · " + klara + " klara" : "Inga moment än") + "</small></span>" +
                    (kanNagot ? ganttPlus(p.id, "Lägg till i " + p.projekt) : "") + "</span>",
                fran: '<span class="a-c a-fran a-sum">' + (span ? arkDatum(span.fran) : "") + "</span>",
                till: '<span class="a-c a-till a-sum">' + (span ? arkDatum(span.till) : "") + "</span>",
                dagar: '<span class="a-c a-dagar a-sum">' + (span ? arbDagar(span.fran, span.till) : "") + "</span>"
            }) + "</div>" +
            '<div class="g-spar" style="width:' + bredd + "px;" + bakgrund + '">' +
            (span && span.till >= fran && span.fran <= till ? '<div class="g-summa" style="left:' + x(kl(span.fran)) + "px;width:" + (x(kl(span.till)) - x(kl(span.fran)) + dw) + 'px"></div>' : "") +
            (ihop && gantt.milstolpar ? d.losa.map(m => ganttDiamant(m, x, dw)).join("") : "") +
            "</div></div>";
        if (ihop)
            return;
        moment.forEach(m => {
            nr++;
            const st = ganttStatus(m), nyckel = p.id + "|" + m.t.id + "|" + m.k.id;
            const andra = ganttKanRedigera(p, m.t) && !m.klar;
            const v = x(kl(m.fran)), w = x(kl(m.till)) - v + dw;
            const kant = (m.fran < fran ? " fore" : "") + (m.till > till ? " efter" : "");
            const tips = m.namn + "\n" + (m.fran === m.till ? dagEtikett(m.fran) : dagEtikett(m.fran) + " – " + dagEtikett(m.till)) +
                " · " + arbDagar(m.fran, m.till) + " arbetsdagar · " + st.text + "\n" + p.projekt + " · " + m.t.namn +
                (m.k.vem ? "\nAnsvarig: " + m.k.vem : "") + (andra ? "\nDra för att flytta, dra i kanterna för att ändra start och slut" : "");
            const textInne = w >= m.namn.length * 6.6 + 22;
            const e = (id, txt, extra) => '<span class="a-c a-' + id + (andra && id !== "nr" ? " a-e" : "") + (extra || "") +
                '" data-acell="' + id + '"' + (andra && id !== "nr" ? ' tabindex="0"' : "") + ">" + txt + "</span>";
            rader += '<div class="g-rad a-rad' + (m.klar ? " a-klar" : "") + '" data-arad="' + esc(nyckel) + '" style="--gf:' + farg + '">' +
                '<div class="g-etikett a-etikett">' + celler({
                    nr: '<button type="button" class="a-c a-nr" data-gkort="' + esc(nyckel) + '" title="Öppna på tavlan">' + nr + "</button>",
                    namn: e("namn", '<span class="a-ntext">' + esc(m.namn) + "</span>" +
                        (p.tavlor.length > 1 || kortDel(m.k, m.t) ? '<small>' + esc([p.tavlor.length > 1 ? m.t.namn : "", kortDel(m.k, m.t)].filter(Boolean).join(" · ")) + "</small>" : "") +
                        (st.klass ? '<i class="a-st ' + st.klass + '" title="' + st.text + '"></i>' : "")),
                    fran: e("fran", arkDatum(m.fran)),
                    till: e("till", arkDatum(m.till)),
                    dagar: e("dagar", String(arbDagar(m.fran, m.till))),
                    vem: e("vem", esc(m.k.vem || ""))
                }) + "</div>" +
                '<div class="g-spar" style="width:' + bredd + "px;" + bakgrund + '">' +
                '<button type="button" class="g-stapel a-stapel ' + st.klass + kant + (andra ? " a-drag" : "") + '" data-gkort="' + esc(nyckel) + '" style="left:' +
                v.toFixed(1) + "px;width:" + w.toFixed(1) + 'px" title="' + esc(tips) + '">' +
                (andra ? '<i class="a-hand v" data-ahand="fran"></i>' : "") +
                (textInne ? "<span>" + esc(m.namn) + "</span>" : "") +
                (andra ? '<i class="a-hand h" data-ahand="till"></i>' : "") + "</button>" +
                (textInne || dw < 4 ? "" : v + Math.max(w, 6) + 12 + m.namn.length * 6.6 > bredd
                    ? '<span class="g-utetext" style="right:' + (bredd - v + 6).toFixed(1) + 'px">' + esc(m.namn) + "</span>"
                    : '<span class="g-utetext" style="left:' + (v + Math.max(w, 6) + 6).toFixed(1) + 'px">' + esc(m.namn) + "</span>") +
                (gantt.milstolpar ? m.mil.map(ml => ganttDiamant(ml, x, dw)).join("") : "") +
                "</div></div>";
        });
        if (gantt.milstolpar && d.losa.length)
            rader += '<div class="g-rad g-milrad" style="--gf:' + farg + '">' +
                '<div class="g-etikett a-etikett">' + celler({ namn: '<span class="a-c a-namn"><span class="a-ntext a-dim">Avrop och leveranser</span><small>' +
                    d.losa.length + " utan kopplat moment</small></span>" }) + "</div>" +
                '<div class="g-spar" style="width:' + bredd + "px;" + bakgrund + '">' + d.losa.map(m => ganttDiamant(m, x, dw)).join("") + "</div></div>";
        // ny rad: skriv ett moment och tryck Enter
        if (kanNagot)
            rader += '<div class="g-rad a-nyrad" style="--gf:' + farg + '"><div class="g-etikett a-etikett">' + celler({
                nr: '<span class="a-c a-nr a-plus">+</span>',
                namn: '<span class="a-c a-namn"><input class="a-ny" data-any="' + p.id + '" maxlength="120" placeholder="Nytt moment i ' + esc(p.projekt) + '…" aria-label="Nytt moment i ' + esc(p.projekt) + '"></span>'
            }) + "</div>" + '<div class="g-spar" style="width:' + bredd + "px;" + bakgrund + '"></div></div>';
    });
    if (!data.some(d => d.moment.length))
        rader += '<div class="g-rad g-tomrad"><div class="g-etikett a-etikett"></div><div class="g-spar" style="width:' + bredd + "px;" + bakgrund + '">' +
            "<span>Inga produktionsmoment i perioden. Skriv ett nytt moment i arket.</span></div></div>";
    const idag = IDAG >= fran && IDAG <= till ? '<div class="g-idaglinje" style="left:calc(var(--g-et) + ' + (x(IDAG) + dw / 2).toFixed(1) + 'px)"></div>' : "";
    const huvud = '<div class="g-rad g-huvud"><div class="g-etikett g-horn a-etikett">' + celler(Object.fromEntries(kol.map(k =>
        [k.id, '<span class="a-c a-' + k.id + ' a-rub">' + k.namn + "</span>"]))) + "</div>" +
        '<div class="g-tid" style="width:' + bredd + 'px">' + veckor + "</div></div>";
    return '<div class="g-skroll"><div class="g-tabell a-ark' + (dw < 12 ? " grov" : "") + (7 * dw < 20 ? " tat" : "") + (medDagar ? " meddagar" : "") +
        '" style="--g-et:' + et + "px;width:calc(var(--g-et) + " + bredd + 'px)" data-adw="' + dw + '" data-afran="' + fran + '">' +
        huvud + rader + idag + "</div></div>";
}

/* ---------- ändringar ---------- */

const klonKort = (k) => JSON.parse(JSON.stringify(k));

// Flyttar ett kort och samlar ångra-uppgifter. Avrop och leveranser i en materialrad följer med.
function arkFlyttaKort(m, kort, nyDag, fore) {
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

function arkKlar(m, fore, txt) {
    logg2(m.t, txt + " (Gantt-schemat)");
    spara();
    if (fore.length)
        angraForeKlar(txt, fore, m.t, m.p);
    rita();
    status(txt);
}

// Endagspost blir en kedja Start → Klart när den får fler dagar.
function arkTillKedja(m, fran, till, fore) {
    const k = m.k, namn = momentNamn(k), kedja = k.kedja || "k" + uid();
    fore.push({ objekt: "kort", id: k.id, varde: klonKort(k) });
    const p1 = { ok: true, fel: null, andringar: [{ typ: "satt", objekt: "kort", id: k.id,
        falt: { roll: "S", kedja, text: "Start " + namn, dag: fran, ordning: null } }], fore: [], historik: [] };
    if (!appliceraPatch(p1, { tavla: m.t, projekt: m.p }))
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

// Hela momentet flyttas ett antal arbetsdagar.
function arkFlytta(nyckel, arbDelta) {
    const m = arkMoment(nyckel);
    if (!m || !arbDelta)
        return;
    if (!m.kanAndra)
        return status(m.klar ? "Momentet är klart och kan inte flyttas" : "Du har bara läsbehörighet på " + m.t.namn, true);
    const fore = [];
    m.kedja.filter(c => !c.klar && c.dag).forEach(c => arkFlyttaKort(m, c, skiftaArbetsdagar(c.dag, arbDelta), fore));
    const n = Math.abs(arbDelta);
    arkKlar(m, fore, momentNamn(m.k) + " flyttat " + n + (n === 1 ? " arbetsdag " : " arbetsdagar ") + (arbDelta > 0 ? "senare" : "tidigare"));
}

function arkSattStart(nyckel, ny) {
    const m = arkMoment(nyckel);
    if (!m || !m.kanAndra || !ny)
        return;
    ny = arkSnap(ny, ny < m.fran ? -1 : 1);
    if (ny === m.fran)
        return ritaGantt();
    const fore = [];
    if (m.slut) {
        if (ny > m.slut.dag) {
            // start efter slut: hela momentet flyttas och behåller sin längd
            return arkFlytta(nyckel, arbetsdagarMellan(m.fran, ny));
        }
        arkFlyttaKort(m, m.k, ny, fore);
    }
    else if (ny < m.k.dag)
        arkTillKedja(m, ny, m.k.dag, fore);
    else
        arkFlyttaKort(m, m.k, ny, fore);
    arkKlar(m, fore, momentNamn(m.k) + ": start " + kortDatum(ny));
}

function arkSattSlut(nyckel, ny) {
    const m = arkMoment(nyckel);
    if (!m || !m.kanAndra || !ny)
        return;
    ny = arkSnap(ny, ny < m.till ? -1 : 1);
    if (ny < m.fran)
        ny = m.fran;
    if (ny === m.till)
        return ritaGantt();
    const fore = [];
    if (m.slut)
        arkFlyttaKort(m, m.slut, ny, fore);
    else if (ny > m.k.dag)
        arkTillKedja(m, m.k.dag, ny, fore);
    arkKlar(m, fore, momentNamn(m.k) + ": slut " + kortDatum(ny));
}

function arkSattDagar(nyckel, n) {
    const m = arkMoment(nyckel);
    if (!m || !(n >= 1))
        return ritaGantt();
    arkSattSlut(nyckel, skiftaArbetsdagar(m.fran, Math.round(n) - 1));
}

// Byter namn på momentet (Start-, Klart- och endagsposten).
function arkDopa(nyckel, namn) {
    const m = arkMoment(nyckel);
    namn = String(namn || "").trim();
    if (!m || !m.kanAndra || !namn || namn === momentNamn(m.k))
        return ritaGantt();
    const fore = [], andringar = [];
    const satt = (k, text) => { fore.push({ objekt: "kort", id: k.id, varde: klonKort(k) }); andringar.push({ typ: "satt", objekt: "kort", id: k.id, falt: { text } }); };
    const gammalt = momentNamn(m.k);
    satt(m.k, m.k.roll === "S" ? "Start " + namn : namn);
    if (m.slut)
        satt(m.slut, m.slut.text && m.slut.text.indexOf(gammalt) === 0 ? namn + m.slut.text.slice(gammalt.length) : namn + " klart");
    if (!appliceraPatch({ ok: true, fel: null, andringar, fore: [], historik: [] }, { tavla: m.t, projekt: m.p }))
        return ritaGantt();
    arkKlar(m, fore, "Momentet heter nu " + namn);
}

function arkSattVem(nyckel, vem) {
    const m = arkMoment(nyckel);
    vem = String(vem || "").trim();
    if (!m || !m.kanAndra || vem === (m.k.vem || ""))
        return ritaGantt();
    const fore = [], andringar = [];
    m.kedja.filter(c => c.typ === "produktion").forEach(c => {
        fore.push({ objekt: "kort", id: c.id, varde: klonKort(c) });
        andringar.push({ typ: "satt", objekt: "kort", id: c.id, falt: { vem } });
    });
    if (!appliceraPatch({ ok: true, fel: null, andringar, fore: [], historik: [] }, { tavla: m.t, projekt: m.p }))
        return ritaGantt();
    arkKlar(m, fore, momentNamn(m.k) + (vem ? ": ansvarig " + vem : ": ingen ansvarig"));
}

// Nytt moment från arkets sista rad: en vecka från idag (eller från förra momentets slut).
function arkNyttMoment(pid, text) {
    const p = plan4.projekt.find(x => x.id === pid);
    text = String(text || "").trim();
    if (!p || !text)
        return;
    const tavlor = p.tavlor.filter(t => ganttKanRedigera(p, t));
    if (!tavlor.length)
        return status("Du har bara läsbehörighet i " + p.projekt, true);
    const t = tavlor.find(x => p === state && x.id === state.aktiv) || tavlor[0];
    const start = arkSnap(IDAG, 1), slut = skiftaArbetsdagar(start, 4);
    const kedja = "k" + uid();
    const patch = opGuideLaggUpp({ kort: [{ dag: start, typ: "produktion", roll: "S", text: "Start " + text, vem: "", kedja },
        { dag: slut, typ: "produktion", roll: "K", text: text + " klart", vem: "", kedja }],
        text, start, plats: "", bemanning: { behov: [], personer: [] }, grund: [], forval: [], mtrl: [], hinder: [] }, t.id);
    if (!patch || !patch.ok || !appliceraPatch(patch, { tavla: t, projekt: p }))
        return status("Det gick inte att lägga till", true);
    (patch.historik && patch.historik.length ? patch.historik : [text + " tillagt från Gantt-schemat"]).forEach(h => logg2(t, h));
    gantt.ihop = gantt.ihop.filter(x => x !== pid);
    sparaGantt();
    spara();
    arkFokusEfter = { pid, text };
    rita();
    if (!ganttOppen())
        ritaGantt();
    status(text + " tillagt · " + kortDatum(start) + "–" + kortDatum(slut) + (p.tavlor.length > 1 ? " · " + t.namn : "") + ". Dra stapeln eller skriv datum.");
}
let arkFokusEfter = null;

/* ---------- redigera i cellerna ---------- */

let arkRedigerar = null;          // { cell, nyckel, falt, input }

function arkBorjaRedigera(cell, forsta) {
    const rad = cell.closest("[data-arad]");
    if (!rad || !cell.classList.contains("a-e"))
        return;
    const nyckel = rad.dataset.arad, falt = cell.dataset.acell, m = arkMoment(nyckel);
    if (!m || !m.kanAndra)
        return;
    arkAvslutaRedigera(false);
    const varde = falt === "namn" ? momentNamn(m.k) : falt === "fran" ? kortDatum(m.fran) : falt === "till" ? kortDatum(m.till)
        : falt === "dagar" ? String(arbDagar(m.fran, m.till)) : (m.k.vem || "");
    const inp = document.createElement("input");
    inp.className = "a-in";
    inp.value = forsta != null ? forsta : varde;
    inp.setAttribute("aria-label", { namn: "Moment", fran: "Start", till: "Slut", dagar: "Arbetsdagar", vem: "Ansvarig" }[falt]);
    if (falt === "fran" || falt === "till")
        inp.placeholder = "t.ex. 12/11 eller +3";
    if (falt === "dagar")
        inp.inputMode = "numeric";
    cell.classList.add("redigerar");
    cell.dataset.gammal = cell.innerHTML;
    cell.innerHTML = "";
    cell.appendChild(inp);
    inp.focus();
    if (forsta == null)
        inp.select();
    else
        inp.setSelectionRange(inp.value.length, inp.value.length);
    arkRedigerar = { cell, nyckel, falt, input: inp };
}

// spara = true: värdet sparas. Returnerar nästa cell att gå till (om någon).
function arkAvslutaRedigera(sparaVarde) {
    const r = arkRedigerar;
    if (!r)
        return;
    arkRedigerar = null;
    const v = r.input.value;
    setTimeout(() => { if (ganttVantar) ritaGantt(); }, 0);
    r.cell.classList.remove("redigerar");
    r.cell.innerHTML = r.cell.dataset.gammal || "";
    if (!sparaVarde)
        return;
    const m = arkMoment(r.nyckel);
    if (!m)
        return;
    if (r.falt === "namn")
        return arkDopa(r.nyckel, v);
    if (r.falt === "vem")
        return arkSattVem(r.nyckel, v);
    if (r.falt === "dagar") {
        const n = parseInt(v, 10);
        if (!(n >= 1))
            return status("Skriv antal arbetsdagar, minst 1", true);
        return arkSattDagar(r.nyckel, n);
    }
    const bas = r.falt === "fran" ? m.fran : m.till;
    const iso = arkTolkaDatum(v, bas);
    if (!iso)
        return status("Skriv datumet som 12/11, 2026-11-12, 12 nov eller +3 (arbetsdagar)", true);
    if (iso === bas)
        return;
    return r.falt === "fran" ? arkSattStart(r.nyckel, iso) : arkSattSlut(r.nyckel, iso);
}

// Cellen bredvid (Tab) eller under (Enter) efter omritning.
function arkGaTill(nyckel, falt, steg) {
    const rader = [...document.querySelectorAll("#gantt [data-arad]")];
    const i = rader.findIndex(r => r.dataset.arad === nyckel);
    const kolumner = arkKolumner().map(k => k.id).filter(id => id !== "nr");
    let rad = rader[i], f = falt;
    if (steg === "ner" || steg === "upp")
        rad = rader[i + (steg === "ner" ? 1 : -1)];
    else {
        const j = kolumner.indexOf(falt) + (steg === "hoger" ? 1 : -1);
        if (j >= kolumner.length) { rad = rader[i + 1]; f = kolumner[0]; }
        else if (j < 0) { rad = rader[i - 1]; f = kolumner[kolumner.length - 1]; }
        else f = kolumner[j];
    }
    const cell = rad && rad.querySelector('[data-acell="' + f + '"]');
    if (cell)
        cell.focus();
}

function arkKlick(e) {
    if (arkDrag && arkDrag.flyttat)
        return;
    const cell = e.target.closest && e.target.closest(".a-ark .a-e");
    if (cell && !cell.classList.contains("redigerar")) {
        e.stopPropagation();
        arkBorjaRedigera(cell);
    }
}

document.getElementById("gantt").addEventListener("click", arkKlick);
document.getElementById("gantt").addEventListener("dblclick", (e) => {
    const cell = e.target.closest && e.target.closest(".a-ark .a-e");
    if (cell && !cell.classList.contains("redigerar"))
        arkBorjaRedigera(cell);
});

document.getElementById("gantt").addEventListener("keydown", (e) => {
    // ny rad
    const ny = e.target.closest && e.target.closest(".a-ny");
    if (ny) {
        if (e.key === "Enter" && ny.value.trim()) {
            e.preventDefault();
            arkNyttMoment(ny.dataset.any, ny.value);
        }
        else if (e.key === "Escape") { ny.value = ""; ny.blur(); e.stopPropagation(); }
        return;
    }
    // pågående redigering
    if (arkRedigerar && e.target === arkRedigerar.input) {
        const { nyckel, falt } = arkRedigerar;
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); arkAvslutaRedigera(false); arkGaTill(nyckel, falt, "kvar"); return; }
        if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            const steg = e.key === "Enter" ? (e.shiftKey ? "upp" : "ner") : (e.shiftKey ? "vanster" : "hoger");
            arkAvslutaRedigera(true);
            setTimeout(() => arkGaTill(nyckel, falt, steg), 0);
        }
        return;
    }
    // en markerad cell: skriv för att ersätta, Enter/F2 för att redigera, pilar för att gå
    const cell = e.target.closest && e.target.closest(".a-ark .a-e");
    if (cell) {
        const rad = cell.closest("[data-arad]"), nyckel = rad && rad.dataset.arad, falt = cell.dataset.acell;
        if (e.key === "Enter" || e.key === "F2") { e.preventDefault(); return arkBorjaRedigera(cell); }
        const pil = { ArrowDown: "ner", ArrowUp: "upp", ArrowRight: "hoger", ArrowLeft: "vanster" }[e.key];
        if (pil) { e.preventDefault(); return arkGaTill(nyckel, falt, pil); }
        if (e.key === "Tab") { e.preventDefault(); return arkGaTill(nyckel, falt, e.shiftKey ? "vanster" : "hoger"); }
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); return arkBorjaRedigera(cell, e.key); }
        return;
    }
    // stapel i fokus: pilar flyttar en arbetsdag, Skift + pil ändrar slutet
    const stapel = e.target.closest && e.target.closest(".a-stapel.a-drag");
    if (stapel && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        const nyckel = stapel.dataset.gkort, d = e.key === "ArrowRight" ? 1 : -1, m = arkMoment(nyckel);
        if (!m)
            return;
        arkFokusStapel = nyckel;
        if (e.shiftKey)
            arkSattSlut(nyckel, skiftaArbetsdagar(m.till, d));
        else
            arkFlytta(nyckel, d);
    }
});
let arkFokusStapel = null;

document.getElementById("gantt").addEventListener("focusout", (e) => {
    if (arkRedigerar && e.target === arkRedigerar.input)
        setTimeout(() => { if (arkRedigerar && document.activeElement !== arkRedigerar.input) arkAvslutaRedigera(true); }, 0);
});

/* ---------- dra staplar ---------- */

let arkDrag = null;

document.getElementById("gantt").addEventListener("pointerdown", (e) => {
    const stapel = e.target.closest && e.target.closest(".a-stapel.a-drag");
    if (!stapel || e.button !== 0)
        return;
    const ark = stapel.closest(".a-ark"), rad = stapel.closest("[data-arad]");
    const m = arkMoment(stapel.dataset.gkort);
    if (!ark || !rad || !m)
        return;
    const hand = e.target.closest("[data-ahand]");
    arkDrag = { stapel, rad, nyckel: stapel.dataset.gkort, m, lage: hand ? hand.dataset.ahand : "flytta",
        x0: e.clientX, dw: parseFloat(ark.dataset.adw), left0: parseFloat(stapel.style.left), w0: parseFloat(stapel.style.width),
        dd: 0, flyttat: false, id: e.pointerId };
    stapel.setPointerCapture(e.pointerId);
    e.preventDefault();
});

document.getElementById("gantt").addEventListener("pointermove", (e) => {
    const d = arkDrag;
    if (!d || e.pointerId !== d.id)
        return;
    const dx = e.clientX - d.x0;
    if (!d.flyttat && Math.abs(dx) < 4)
        return;
    d.flyttat = true;
    d.stapel.classList.add("drar");
    document.body.classList.add("a-drar");
    const dd = Math.round(dx / d.dw);
    d.dd = dd;
    let fran = d.m.fran, till = d.m.till;
    if (d.lage === "flytta") { fran = plus(fran, dd); till = plus(till, dd); }
    else if (d.lage === "fran") { fran = plus(fran, dd); if (fran > till) fran = till; }
    else { till = plus(till, dd); if (till < fran) till = fran; }
    const sf = arkSnap(fran, dd), st = arkSnap(till, dd < 0 ? -1 : 1);
    const dagar = (a, b) => Math.round((iso2d(b) - iso2d(a)) / 86400000);
    const left = d.left0 + dagar(d.m.fran, sf) * d.dw, w = Math.max(d.dw, d.w0 + (dagar(d.m.till, st) - dagar(d.m.fran, sf)) * d.dw);
    d.stapel.style.left = left.toFixed(1) + "px";
    d.stapel.style.width = w.toFixed(1) + "px";
    d.fran = sf; d.till = st < sf ? sf : st;
    const satt = (f, txt) => { const c = d.rad.querySelector('[data-acell="' + f + '"]'); if (c) c.textContent = txt; };
    satt("fran", arkDatum(d.fran));
    satt("till", arkDatum(d.till));
    satt("dagar", String(arbDagar(d.fran, d.till)));
    d.rad.classList.add("a-andras");
    let bubbla = document.getElementById("arkBubbla");
    if (!bubbla) {
        bubbla = document.createElement("div");
        bubbla.id = "arkBubbla";
        bubbla.className = "a-bubbla";
        document.body.appendChild(bubbla);
    }
    bubbla.textContent = (d.fran === d.till ? dagEtikett(d.fran) : kortDatum(d.fran) + " – " + kortDatum(d.till)) + " · " + arbDagar(d.fran, d.till) + " dgr";
    const r = d.stapel.getBoundingClientRect();
    bubbla.style.left = Math.round(d.lage === "till" ? r.right : d.lage === "fran" ? r.left : r.left + r.width / 2) + "px";
    bubbla.style.top = Math.round(r.top - 8) + "px";
});

function arkSlutaDra(e) {
    const d = arkDrag;
    if (!d || (e && e.pointerId !== d.id))
        return;
    document.body.classList.remove("a-drar");
    const b = document.getElementById("arkBubbla");
    if (b)
        b.remove();
    if (!d.flyttat) {
        arkDrag = null;
        return;
    }
    // klicket efter en dragning ska inte öppna kortet
    d.slut = true;
    setTimeout(() => { arkDrag = null; if (ganttVantar) ritaGantt(); }, 0);
    if (!d.fran || (d.fran === d.m.fran && d.till === d.m.till))
        return ritaGantt();
    if (d.lage === "flytta")
        arkFlytta(d.nyckel, arbetsdagarMellan(d.m.fran, d.fran));
    else if (d.lage === "fran")
        arkSattStart(d.nyckel, d.fran);
    else
        arkSattSlut(d.nyckel, d.till);
}
document.getElementById("gantt").addEventListener("pointerup", arkSlutaDra);
document.getElementById("gantt").addEventListener("pointercancel", arkSlutaDra);
// klicket efter en dragning öppnar inte kortet
document.getElementById("gantt").addEventListener("click", (e) => {
    if (arkDrag && arkDrag.flyttat) {
        e.stopPropagation();
        e.preventDefault();
    }
}, true);

// Efter omritning: fokus tillbaka till stapeln eller till nya raden.
function arkEfterRita() {
    if (arkFokusStapel) {
        const s = document.querySelector('#gantt .a-stapel[data-gkort="' + CSS.escape(arkFokusStapel) + '"]');
        arkFokusStapel = null;
        if (s)
            s.focus();
    }
    if (arkFokusEfter) {
        const ny = document.querySelector('#gantt .a-ny[data-any="' + CSS.escape(arkFokusEfter.pid) + '"]');
        arkFokusEfter = null;
        if (ny)
            ny.focus();
    }
}
