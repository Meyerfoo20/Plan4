/* ======================================================================
   Kort, moment och dagens ordning
   ====================================================================== */

function grundDef(id) { return GRUNDFRAGOR.find(x => "grund-" + x.id === id) || null; }

function omradeHint(id) { const o = FOMRADEN.find(x => x.id === id); return o ? o.hint : ""; }

function lageDef(id) { return LAGEN.find(l => l.id === id) || null; }

// Automatisk avstämning för en passerad dag utan egen bedömning: hur stor del av dagens poster
// som bockades av. Poster som flyttades bort från dagen samma dag eller senare räknas som ej gjorda.
// Frånvaro räknas inte. Ingen post den dagen = ingen bedömning.
function autoDagslage(t, iso) {
    if (!t || !iso || iso >= IDAG)
        return null;
    let klara = 0, totalt = 0;
    (t.kort || []).forEach(k => {
        if (k.virtuell || k.typ === "franvaro")
            return;
        if (k.dag === iso) {
            totalt++;
            if (k.klar)
                klara++;
        }
        else if ((k.flyttar || []).some(f => f.fran === iso && String(f.tid || "").slice(0, 10) >= iso))
            totalt++;
    });
    if (!totalt)
        return null;
    const andel = klara / totalt;
    return { lage: andel >= 0.8 ? "gron" : andel >= 0.5 ? "gul" : "rod", klara, totalt };
}

function startMinut(k) {
    const m = /^\s*(\d{1,2})[:.](\d{2})/.exec(k.tid || "");
    if (!m)
        return null;
    const h = +m[1], min = +m[2];
    if (h > 23 || min > 59)
        return null;
    return h * 60 + min;
}

function tidText(k) {
    if (!k.tid)
        return "";
    return k.slutTid ? k.tid + "–" + k.slutTid : k.tid;
}

function otidsattaIDag(t, dag) {
    return sorteraDag(kortForDag(t, dag).filter(x => !x.virtuell && startMinut(x) === null));
}

function sorteraDag(lista) {
    return lista.map((k, i) => ({ k: k, i: i, t: startMinut(k) }))
        .sort((a, b) => {
        if ((a.t === null) !== (b.t === null))
            return a.t === null ? 1 : -1;
        if (a.t !== null && a.t !== b.t)
            return a.t - b.t;
        if (a.t === null) {
            const oa = typeof a.k.ordning === "number" ? a.k.ordning : Infinity;
            const ob = typeof b.k.ordning === "number" ? b.k.ordning : Infinity;
            if (oa !== ob)
                return oa - ob;
        }
        const sa = a.k.skapad || "", sb = b.k.skapad || "";
        if (sa !== sb)
            return sa < sb ? -1 : 1;
        return a.i - b.i;
    })
        .map(x => x.k);
}

function aterkomDagar(a) { return a.vdagar && a.vdagar.length ? a.vdagar : (a.vdag === undefined ? [] : [a.vdag]); }

function narText(nar) {
    if (!nar)
        return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(nar))
        return dagEtikett(nar);
    return nar;
}

function arLofte(typ) { return typ === "produktion"; }

function kraverOrsak(k, nyDag, nyTyp) {
    const typ = nyTyp || k.typ;
    return (arLofte(typ) || arLofte(k.typ)) && !k.klar && !!nyDag && nyDag !== k.dag;
}

function radRubrik(r) {
    return r.slag === "avrop" ? "Avrop" : r.slag === "uestart" ? "UE start" : "Leverans";
}

function orsakGrupp(o) { return (o || "").indexOf("Övrigt") === 0 ? "Övrigt" : o; }

function arUe(m) { return m.slag === "ue"; }

function radNamn(m) { return m.leverantor || m.txt || ""; }

function avropText(m) {
    const namn = radNamn(m);
    return "Avrop" + (namn ? " · " + namn : "");
}

function levText(m) {
    if (arUe(m))
        return "UE start" + (radNamn(m) ? " · " + radNamn(m) : "");
    const d = ["Leverans"];
    if (m.txt)
        d.push(m.txt);
    if (m.leverantor)
        d.push(m.leverantor);
    return d.join(" · ");
}

function grundText(q, sv) {
    if (sv.svar === "ja")
        return q.namn + " — genomgånget";
    if (sv.svar === "ejrelevant")
        return q.namn + " — ej relevant";
    return (sv.precisera ? sv.precisera + ": " : "") + (sv.vad || q.namn);
}

function kanDupliceras(k) {
    if (k.kedja || k.roll)
        return false;
    if ((k.material || []).length || (k.forutsattningar || []).length || k.beredning)
        return false;
    // ett avrop med uppgifter i avropslistan dupliceras inte (det hör till listan)
    if (k.typ === "avrop" && k.avrop)
        return false;
    return ["mote", "franvaro", "ovrigt", "produktion", "avrop", "leverans", "ue"].indexOf(k.typ) >= 0;
}

// Bara delen ur Plats / del, t.ex. "Prenadhuset Del 1:2" → "Del 1:2". Ingen del → tom text.
function delText(plats) {
    const m = /\bdel\s*(\d+)(?:\s*(?:[:\/.;,\-–—]|\bav\b|\bof\b)\s*(\d+))?/i.exec(plats || "");
    return m ? "Del " + m[1] + (m[2] ? ":" + m[2] : "") : "";
}

function momentNamn(k) {
    let t = k.text || "";
    if (t.indexOf("Start ") === 0)
        t = t.slice(6);
    return t;
}

function fanns(k, vStart) { return !k.skapad || new Date(k.skapad) < iso2d(vStart); }

function dagVidVeckostart(k, vStart) {
    const grans = iso2d(vStart);
    const under = (k.flyttar || []).filter(f => new Date(f.tid) >= grans).sort((a, b) => a.tid < b.tid ? -1 : 1);
    return under.length ? under[0].fran : k.dag;
}

function momentText(t, k) {
    if (!k.kedja)
        return "";
    const syskon = t.kort.filter(x => x.kedja === k.kedja);
    const p = syskon.find(x => x.roll === "S") || syskon.find(x => x.roll === "P");
    if (!p || !p.text)
        return "";
    let txt = p.text;
    if (txt.indexOf("Start ") === 0)
        txt = txt.slice(6);
    return txt;
}

function lankadRad(t, k) {
    if (k.kedja && (k.roll === "A" || k.roll === "L")) {
        const bar = t.kort.find(x => x.kedja === k.kedja && (x.roll === "S" || x.roll === "P"));
        const m = bar && (bar.material || []).find(r => r.avropKortId === k.id || r.levKortId === k.id);
        if (m)
            return { rad: m, del: m.avropKortId === k.id ? "A" : "L" };
    }
    if (k.typ === "avrop" && k.avrop)
        return { rad: k.avrop, del: "A" };
    if ((k.typ === "leverans" || k.typ === "ue") && !k.kedja) {
        const a = t.kort.find(x => x.avrop && x.avrop.levKortId === k.id);
        if (a)
            return { rad: a.avrop, del: "L" };
    }
    return null;
}

function pagaendeForDag(t, iso) {
    if (!t.visaPagaende)
        return [];
    const ut = [];
    t.kort.forEach(k => {
        if (k.typ !== "produktion" || k.roll !== "S" || !k.kedja)
            return;
        const slut = t.kort.find(x => x.kedja === k.kedja && x.roll === "K");
        if (!slut || !(k.dag < iso && iso < slut.dag))
            return;
        const del = delText(k.plats);
        ut.push({ kort: k, text: momentNamn(k) + (del ? " · " + del : ""), klar: !!slut.klar });
    });
    return ut.sort((a, b) => a.text.localeCompare(b.text, "sv"));
}

function kortForDag(t, iso) {
    return t.kort.filter(k => k.dag === iso ||
        (k.typ === "franvaro" && k.tillDag && k.dag < iso && iso <= k.tillDag));
}

function tomBemanning(b) { return !b || (!(b.behov || []).length && !(b.personer || []).length); }

function slutPostI(t, bar) {
    return bar.roll === "S" && bar.kedja ? t.kort.find(x => x.kedja === bar.kedja && x.roll === "K") || null : null;
}

function momentPeriodI(t, bar) {
    const s = slutPostI(t, bar);
    return { fran: bar.dag, till: s && s.dag > bar.dag ? s.dag : bar.dag };
}

function omradeNamn(id) {
    if (id === "beredning")
        return "Arbetsberedning";
    if (id === "bekraftelse")
        return "Bekräftelse av nytt datum";
    const gr = grundDef(id);
    if (gr)
        return gr.namn;
    const o = FOMRADEN.find(x => x.id === id);
    return o ? o.namn : "Egen förutsättning";
}

function forvalText(f) {
    if (f.omrade === "beredning")
        return "Arbetsberedning ej utförd";
    return f.txt || (f.omrade === "annat" ? (f.namn || "Egen förutsättning") : omradeNamn(f.omrade));
}

function veckoIndex(iso, t) { return Math.round((iso2d(iso) - iso2d(tavlaStart())) / 86400000 / 7); }

function momentFor(k, t) {
    if (!k.kedja || k.roll === "S" || k.roll === "P" || k.roll === "K")
        return null;
    const syskon = t.kort.filter(x => x.kedja === k.kedja);
    const p = syskon.find(x => x.roll === "S") || syskon.find(x => x.roll === "P");
    if (!p || !p.text)
        return null;
    let txt = p.text;
    if (txt.indexOf("Start ") === 0)
        txt = txt.slice(6);
    return txt;
}

function virtuella(iso, t) {
    const vdag = (iso2d(iso).getDay() + 6) % 7;
    return t.aterkom.filter(a => aterkomDagar(a).indexOf(vdag) >= 0)
        .filter(a => !a.tom || iso <= a.tom)
        .filter(a => !t.skippa.includes(a.id + "|" + iso))
        .filter(a => !t.kort.some(k => k.fran === a.id && k.dag === iso))
        .map(a => ({ id: "v_" + a.id + "_" + iso, dag: iso, typ: a.typ, text: a.text, tid: a.tid, slutTid: a.slutTid || "",
        plats: a.plats || "", vem: a.vem, not: a.not || "", franvaroOrsak: a.franvaroOrsak || "",
        klar: false, kedja: null, roll: null, orsak: null,
        flyttar: [], virtuell: true, fran: a.id }));
}

function serien(k, t) { return t.aterkom.find(a => a.id === k.fran) || null; }

function parKort(k, roll, t) {
    if (!k.kedja)
        return null;
    return t.kort.find(x => x.kedja === k.kedja && x.roll === roll && x.id !== k.id) || null;
}

function dagsvyPoster(t, iso, p) {
    return sorteraDag(virtuella(iso, t).concat(kortForDag(t, iso), attGoraForDag(t, iso, p)));
}

function kortText(k, t, p) {
    if (!k || k.virtuell)
        return k ? k.text : "";
    const l = lankadRad(t, k);
    if (!l || !l.rad.foretagId)
        return k.text;
    const f = ftgPost(p, l.rad.foretagId);
    if (!f)
        return k.text;
    const bas = { slag: l.rad.slag || "material", txt: l.rad.txt || "" };
    const gen = namn => { const r = Object.assign({}, bas, { leverantor: namn }); return l.del === "A" ? avropText(r) : levText(r); };
    const suffix = k.text.indexOf(" · gör idag") > 0 ? " · gör idag" : "";
    const lagrad = k.text.replace(" · gör idag", "");
    const arkiv = gen(l.rad.leverantor || "");
    if (lagrad !== arkiv && lagrad !== gen(f.namn))
        return k.text;
    return gen(f.namn) + suffix;
}

function attGoraForDag(t, iso, p) {
    return fAktiviteter(p).filter(a => a.kalender && a.kalender.tavlaId === t.id && a.kalender.dag === iso && a.status !== "Ej aktuell")
        .map(a => ({ id: "ag_" + a.id, attgora: a.id, virtuell: true, typ: "ovrigt", dag: iso, text: "Att göra · " + a.titel,
        tid: "", slutTid: "", plats: "", vem: a.ansvarig || "", not: a.kommentar || "", klar: fKlar(a), kedja: null, roll: null,
        orsak: null, flyttar: [], skapad: a.skapad || "" }));
}
