/* ======================================================================
   Projekt, tavlor, Att göra och väder
   ====================================================================== */

function nyTavla(namn, idag, genId) {
    return { id: uid(genId), namn: namn || "Tavla 1", start: d2iso(mandag(iso2d(idag))),
        kort: [], hinder: [], historik: [], aterkom: [], skippa: [], plats: null, dagslage: {} };
}

function nyttProjekt(namn, forstaTavla, idag, genId) {
    const t = nyTavla(forstaTavla || "Produktion", idag, genId);
    return { id: uid(genId), projekt: namn || "Projekt", arkiverad: false, logotyp: null,
        varningar: {}, plats: null, tavlor: [t], aktiv: t.id, resurser: { kategorier: [], personer: [] },
        forberedelse: { byggstart: "", aktiviteter: [] }, foretag: [] };
}

function vaderSymbol(kod) { const t = VSYMBOL.find(x => x[0] === kod); return t ? t[1] : "·"; }

function fKlar(a) { return a.status === "Klar" || a.status === "Ej aktuell"; }

function fForfallen(a, idag) { return a.fas === "fore" && !fKlar(a) && !!a.deadline && a.deadline < idag; }

function fHinder(p, a) {
    if (!a.hinderId)
        return null;
    for (const t of p.tavlor) {
        const h = t.hinder.find(x => x.id === a.hinderId);
        if (h)
            return { tavla: t, hinder: h };
    }
    return null;
}

function fOverford(p, a) {
    if (!a.overford)
        return null;
    const t = p.tavlor.find(x => x.id === a.overford.tavlaId);
    const k = t ? t.kort.find(x => x.id === a.overford.kortId) : null;
    return k ? { tavla: t, kort: k } : null;
}

function fKalender(p, a) {
    if (!a.kalender || !a.kalender.tavlaId || !a.kalender.dag)
        return null;
    const t = p.tavlor.find(x => x.id === a.kalender.tavlaId);
    return t ? { tavla: t } : null;
}

function projTavlor(p, tavlaId) { return tavlaId ? p.tavlor.filter(t => t.id === tavlaId) : p.tavlor; }

function flyttadeIVecka(t, vStart) {
    return t.kort.filter(k => (k.flyttar || []).some(f => tidIVeckan(f.tid, vStart))).length;
}

function senasteAvstamning(t) {
    const dagar2 = Object.keys(t.dagslage || {}).sort();
    if (!dagar2.length)
        return null;
    const d = dagar2[dagar2.length - 1];
    return { dag: d, lage: t.dagslage[d].lage, kommentar: t.dagslage[d].kommentar || "" };
}

function produktionsmomentEfter(t, fran, till) {
    return t.kort.filter(k => k.typ === "produktion" && (k.roll === "S" || k.roll === "P" || !k.roll) &&
        k.dag >= fran && k.dag <= till);
}

function forutsattningsTackning(p, tavlor, dagarFram, idag) {
    const fran = idag, till = plusArbetsdagar(idag, dagarFram);
    let totalt = 0, utan = 0;
    (tavlor || p.tavlor).forEach(t => produktionsmomentEfter(t, fran, till).forEach(k => {
        totalt++;
        if (!(k.forutsattningar || []).length)
            utan++;
    }));
    return { totalt: totalt, utan: utan };
}

function aktivaGranser(p) { return VARNINGSTYPER.filter(t => p.varningar && p.varningar[t.id] && p.varningar[t.id].pa); }

function fAktiviteter(p) { return (p.forberedelse || { aktiviteter: [] }).aktiviteter; }

function fVeckaMandag(p, vecka) {
    const bs = p.forberedelse.byggstart;
    if (!bs)
        return "";
    return plus(d2iso(mandag(iso2d(bs))), ((vecka || 1) - 1) * 7);
}

function veckoUtfall(vStart, tavla) {
    const t = tavla;
    const prod = t.kort.filter(k => arLofte(k.typ));
    const planerade = prod.filter(k => fanns(k, vStart) && iVeckan(dagVidVeckostart(k, vStart), vStart));
    // Genomförd i veckan: klar och antingen kvar i veckan eller avbockad innan veckan tog slut.
    // Ett löfte som flyttades ut ur veckan och gjordes senare räknas inte som hållet den här veckan.
    const veckoslut = iso2d(plus(vStart, 7));
    const genomforda = planerade.filter(k => k.klar && (iVeckan(k.dag, vStart) || (k.klarTid && new Date(k.klarTid) < veckoslut)));
    const senaBockar = genomforda.filter(k => k.klarTid && new Date(k.klarTid) >= veckoslut);
    const ejGjorda = planerade.filter(k => genomforda.indexOf(k) < 0);
    const tillkomna = prod.filter(k => k.skapad && !fanns(k, vStart) && new Date(k.skapad) < iso2d(plus(vStart, 7)) && lagIVeckan(k, vStart));
    const tillkomnaFlyttade = tillkomna.filter(k => !iVeckan(k.dag, vStart));
    const tillkomnaKlara = tillkomna.filter(k => k.klar);
    const orsaker = {};
    t.kort.forEach(k => (k.flyttar || []).forEach(f => {
        if (f.orsak && f.riktning !== "tidigare" && f.till > f.fran && tidIVeckan(f.tid, vStart)) {
            const o = orsakGrupp(f.orsak);
            orsaker[o] = (orsaker[o] || 0) + 1;
        }
    }));
    const hSkapade = t.hinder.filter(h => tidIVeckan(h.skapad, vStart));
    const hLosta = t.hinder.filter(h => tidIVeckan(h.lostTid, vStart));
    const hKvar = t.hinder.filter(h => hinderOppetVid(h, vStart));
    const utanTid = prod.filter(k => !k.skapad).length;
    const hUtanTid = t.hinder.filter(h => !h.skapad).length;
    return { vStart: vStart, planerade: planerade, genomforda: genomforda, ejGjorda: ejGjorda, tillkomna: tillkomna,
        tillkomnaFlyttade: tillkomnaFlyttade, tillkomnaKlara: tillkomnaKlara, senaBockar: senaBockar,
        orsaker: orsaker, hSkapade: hSkapade, hLosta: hLosta, hKvar: hKvar, utanTid: utanTid, hUtanTid: hUtanTid };
}

function fLage(p, idag) {
    const lista = fAktiviteter(p), fore = lista.filter(a => a.fas === "fore"), start = lista.filter(a => a.fas === "start");
    return { fore: fore.length, foreKlara: fore.filter(fKlar).length, forfallna: fore.filter(a => fForfallen(a, idag)).length,
        start: start.length, startKlara: start.filter(fKlar).length,
        overforda: start.filter(a => fOverford(p, a)).length };
}

function projUtfall(p, vStart, tavlor) {
    const ut = { planerade: 0, genomforda: 0, ejGjorda: 0, tillkomna: 0, tillkomnaKlara: 0, senaBockar: 0,
        ejGjordaKort: [], utanTid: 0 };
    (tavlor || p.tavlor).forEach(t => {
        const u = veckoUtfall(vStart, t);
        ut.planerade += u.planerade.length;
        ut.genomforda += u.genomforda.length;
        ut.ejGjorda += u.ejGjorda.length;
        ut.tillkomna += u.tillkomna.length;
        ut.tillkomnaKlara += u.tillkomnaKlara.length;
        ut.senaBockar += u.senaBockar.length;
        ut.utanTid += u.utanTid;
        u.ejGjorda.forEach(k => ut.ejGjordaKort.push({ tavla: t, kort: k }));
    });
    ut.procent = ut.planerade ? Math.round(ut.genomforda / ut.planerade * 100) : null;
    return ut;
}

function osynkade(p, t) {
    return p.tavlor.filter(x => x.start !== t.start);
}

function kraverAtgard(p, tavlor, idag, vader) {
    const ut = [], anvand = {}, lista = tavlor || p.tavlor;
    const nara5 = plusArbetsdagar(idag, 5), nara10 = plusArbetsdagar(idag, 10);
    function rad(regel, niva, t, text, metatext, meta) {
        ut.push({ regel: regel, niva: niva, tavla: t, text: text, metatext: metatext || "",
            meta: meta || null, sort: (meta && meta.dag) || "" });
    }
    lista.forEach(t => {
        t.hinder.forEach(h => {
            if (h.status === "lost")
                return;
            if (forfallen(h.nar, idag)) {
                anvand["h" + h.id] = 1;
                rad("hinder_forfallet", "rod", t, h.vad, (h.vem || "utan ansvarig") + " · förföll " + (narText(h.nar) || "—"), { typ: "hinder", id: h.id, tavla: t.id });
            }
        });
        t.hinder.forEach(h => {
            if (h.status === "lost" || anvand["h" + h.id])
                return;
            if (!h.vem || !h.nar) {
                anvand["h" + h.id] = 1;
                rad("hinder_utan_agare", "gul", t, h.vad, (h.vem ? "" : "saknar ansvarig") + (!h.vem && !h.nar ? " och " : "") + (h.nar ? "" : "saknar datum"), { typ: "hinder", id: h.id, tavla: t.id });
            }
        });
        avropRader({ tavlor: [t], typ: "alla" }, p).forEach(r => {
            if (!forsenatAvrop(r, idag))
                return;
            rad("avrop_forsenat", "rod", t, "Avrop · " + (r.foretag || r.vad), (r.vad && r.foretag ? r.vad + " · " : "") + "skulle ha gjorts " + kortDatum(r.dag), { typ: "avrop", tavla: t.id, dag: r.dag });
        });
        t.kort.forEach(k => {
            (k.forutsattningar || []).forEach(f => {
                if (f.omrade !== "bekraftelse" || f.status !== "saknas")
                    return;
                const h = f.hinderId ? t.hinder.find(x => x.id === f.hinderId) : null;
                if (h)
                    anvand["h" + h.id] = 1;
                rad("obekraftat", "orange", t, f.txt, h && h.vem ? h.vem + (h.nar ? " · senast " + (narText(h.nar) || "") : "") : "ingen ansvarig satt", { typ: "kort", id: k.id, tavla: t.id });
            });
        });
        produktionsmomentEfter(t, idag, nara5).forEach(k => {
            const oppet = t.hinder.filter(h => h.status !== "lost" && h.kop && h.kop.kortId === k.id && !anvand["h" + h.id]);
            if (!oppet.length)
                return;
            oppet.forEach(h => anvand["h" + h.id] = 1);
            rad("start_med_hinder", "orange", t, momentNamn(k) + " startar " + kortDatum(k.dag), oppet.length === 1 ? "öppet hinder: " + oppet[0].vad : oppet.length + " öppna hinder", { typ: "kort", id: k.id, tavla: t.id, dag: k.dag });
        });
        produktionsmomentEfter(t, idag, nara10).forEach(k => {
            if (k.beredning && k.beredning.kravs && k.beredning.status !== "utford")
                rad("beredning", "orange", t, "Arbetsberedning ej utförd · " + momentNamn(k), "start " + kortDatum(k.dag) + " · " + (ABTEXT[k.beredning.status] || ""), { typ: "kort", id: k.id, tavla: t.id, dag: k.dag });
            (k.forutsattningar || []).forEach(f => {
                if (f.status !== "saknas" || f.omrade === "bekraftelse" || f.omrade === "beredning")
                    return;
                const h = f.hinderId ? t.hinder.find(x => x.id === f.hinderId) : null;
                if (h && anvand["h" + h.id])
                    return;
                if (h)
                    anvand["h" + h.id] = 1;
                rad("forutsattning", "orange", t, f.txt + " · " + momentNamn(k), "start " + kortDatum(k.dag) + (h && h.vem ? " · " + h.vem : ""), { typ: "kort", id: k.id, tavla: t.id, dag: k.dag });
            });
        });
        t.kort.forEach(k => {
            if (k.klar || k.typ === "franvaro" || franvaroPeriod(k).till >= t.start)
                return;
            rad("bakom_tavlan", "gul", t, k.text + " ligger kvar " + kortDatum(k.dag), "bakom tavlans fönster, ej avbockad", { typ: "kort", id: k.id, tavla: t.id, dag: k.dag });
        });
        t.kort.forEach(k => {
            if ((k.flyttar || []).length < 2)
                return;
            rad("upprepade_flyttar", "gul", t, "Upprepade flyttar · " + k.text, "flyttad " + k.flyttar.length + " gånger", { typ: "kort", id: k.id, tavla: t.id, dag: k.dag });
        });
    });
    if (lista.length === p.tavlor.length)
        fAktiviteter(p).forEach(a => {
            if (!fForfallen(a, idag))
                return;
            const h = fHinder(p, a);
            if (h && h.hinder.status !== "lost")
                return;
            rad("forberedelse_forfallen", "rod", { id: null, namn: "Att göra" }, a.titel, (a.ansvarig || "utan ansvarig") + " · deadline " + kortDatum(a.deadline) + " · " + (a.kategori || "Övrigt"), { typ: "forberedelse", id: a.id, dag: a.deadline });
        });
    const resFran = idag, resTill = plusArbetsdagar(idag, 10);
    const perPerson = {};
    dubbelbokningar(p, resFran, resTill).forEach(k => {
        if (!lista.some(t => k.moment.some(m => m.tavla === t)))
            return;
        (perPerson[k.personId] = perPerson[k.personId] || []).push(k);
    });
    Object.keys(perPerson).forEach(pid => {
        const x = resPers(p, pid), k = perPerson[pid];
        rad("resurs_dubbelbokad", "orange", k[0].moment[0].tavla, "Dubbelbokad resurs · " + (x ? x.namn : "?"), dagRubrik(k[0].dag) + (k.length > 1 ? " och " + (k.length - 1) + " dagar till" : "") + " · " +
            k[0].moment.map(m => momentNamn(m.kort)).join(" / "), { typ: "resurs", dag: k[0].dag });
    });
    franvaroKonflikter(p, resFran, resTill, lista).forEach(g => {
        const tx = konfliktText(p, g);
        rad(g.hel ? "resurs_franvaro" : "resurs_delvis_franvaro", g.hel ? "orange" : "gul", g.moment.tavla, "Resurskonflikt · " + tx.person, tx.lage + " · " + tx.period + " · " + momentNamn(g.moment.kort) + " · " + g.moment.tavla.namn + " · " + tx.orsak, { typ: "resurs", dag: g.dagar[0] });
    });
    lista.forEach(t => produktionsmomentEfter(t, idag, plusArbetsdagar(idag, 5)).forEach(k => {
        if (tomBemanning(k.bemanning))
            return;
        const l = bemanningsLage(p, k);
        if (!l.saknas)
            return;
        rad("bemanning_ej_klar", "orange", t, "Bemanning ej klar · " + momentNamn(k), "saknar " + l.rader.filter(r => r.saknas).map(r => r.saknas + " " + katKort(r.kategori)).join(", ") +
            " · start " + kortDatum(k.dag), { typ: "kort", id: k.id, tavla: t.id, dag: k.dag });
    }));
    (vader || []).forEach(v => {
        const berorda = lista.filter(t => t.kort.some(k => k.dag === v.dag && k.typ === "produktion"));
        if (!berorda.length)
            return;
        rad("vader", "gul", berorda[0], dagNamnKort(v.dag) + " · " + v.traffar.join(" · "), berorda.length === 1 ? "produktion planerad" : "produktion planerad på " + berorda.length + " tavlor", { typ: "vader", dag: v.dag });
    });
    const ordning = { rod: 0, orange: 1, gul: 2 };
    ut.sort((a, b) => {
        if (ordning[a.niva] !== ordning[b.niva])
            return ordning[a.niva] - ordning[b.niva];
        return (a.sort || "9999") < (b.sort || "9999") ? -1 : 1;
    });
    ut.totalt = ut.length;
    return ut.slice(0, 10);
}

function rustaTavla(t) {
    t.historik = t.historik || [];
    t.hinder = t.hinder || [];
    t.kort = t.kort || [];
    t.aterkom = t.aterkom || [];
    t.skippa = t.skippa || [];
    if (typeof t.visaPagaende !== "boolean")
        t.visaPagaende = false;
    t.aterkom.forEach(a => {
        if (!a.vdagar)
            a.vdagar = a.vdag === undefined ? [] : [a.vdag];
        if (a.slutTid === undefined)
            a.slutTid = "";
        if (a.plats === undefined)
            a.plats = "";
        if (a.tom === undefined)
            a.tom = "";
    });
    if (!t.dagslage || typeof t.dagslage !== "object")
        t.dagslage = {};
    if (t.plats === undefined)
        t.plats = null;
    t.kort.forEach(k => {
        if (k.skapad === undefined)
            k.skapad = null;
        if (!Array.isArray(k.flyttar))
            k.flyttar = [];
        if (k.klarTid === undefined)
            k.klarTid = null;
        if (!Array.isArray(k.forutsattningar))
            k.forutsattningar = [];
        if (!Array.isArray(k.material))
            k.material = [];
        if (k.roll === "A" && k.typ === "leverans")
            k.typ = "avrop";
        if (k.beredning === undefined)
            k.beredning = null;
        if (k.slutTid === undefined)
            k.slutTid = "";
        if (k.franvaroOrsak === undefined)
            k.franvaroOrsak = "";
        if (k.bemanning === undefined)
            k.bemanning = null;
        if (k.typ === "franvaro") {
            if (k.personId === undefined)
                k.personId = null;
            if (k.tillDag === undefined)
                k.tillDag = "";
            if (k.personNamn === undefined)
                k.personNamn = "";
        }
        if (k.ordning === undefined)
            k.ordning = null;
        if (k.plats === undefined)
            k.plats = "";
        if (k.urspDag === undefined)
            k.urspDag = null;
    });
    t.hinder.forEach(h => {
        if (!h.status)
            h.status = "oppet";
        if (h.skapad === undefined)
            h.skapad = null;
        if (h.lostTid === undefined)
            h.lostTid = null;
    });
}

function rustaProjekt(p, idag, genId) {
    p.tavlor = p.tavlor || [];
    if (!p.tavlor.length)
        p.tavlor.push(nyTavla("Produktion", idag, genId));
    p.tavlor.forEach(rustaTavla);
    if (!p.id)
        p.id = uid(genId);
    if (typeof p.projekt !== "string")
        p.projekt = "Projekt";
    if (p.arkiverad === undefined)
        p.arkiverad = false;
    if (p.plats === undefined) {
        const medOrt = p.tavlor.find(t => t.plats);
        p.plats = medOrt ? medOrt.plats : null;
    }
    if (!p.aktiv || !p.tavlor.some(t => t.id === p.aktiv))
        p.aktiv = p.tavlor[0].id;
    if (!p.resurser || typeof p.resurser !== "object")
        p.resurser = { kategorier: [], personer: [] };
    if (!Array.isArray(p.resurser.kategorier))
        p.resurser.kategorier = [];
    if (!Array.isArray(p.resurser.personer))
        p.resurser.personer = [];
    p.resurser.personer.forEach(x => { if (x.aktiv === undefined)
        x.aktiv = true; });
    if (!p.forberedelse || typeof p.forberedelse !== "object")
        p.forberedelse = { byggstart: "", aktiviteter: [] };
    if (typeof p.forberedelse.byggstart !== "string")
        p.forberedelse.byggstart = "";
    if (!Array.isArray(p.forberedelse.aktiviteter))
        p.forberedelse.aktiviteter = [];
    if (!Array.isArray(p.foretag))
        p.foretag = [];
    p.foretag.forEach(f => {
        if (!Array.isArray(f.roller))
            f.roller = [];
        if (f.aktiv === undefined)
            f.aktiv = true;
        ["omrade", "kontakt", "telefon", "epost", "kommentar"].forEach(n => { if (typeof f[n] !== "string")
            f[n] = ""; });
    });
    rustaState(p);
}

function rustaState(p) {
    const mal = p;
    if (!mal.varningar || typeof mal.varningar !== "object")
        mal.varningar = {};
    VARNINGSTYPER.forEach(t => {
        if (!mal.varningar[t.id])
            mal.varningar[t.id] = { pa: false, varde: t.std };
    });
}
