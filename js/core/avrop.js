/* ======================================================================
   Avrop, leveranser och hinder
   ====================================================================== */

function forfallen(nar, idag) { return /^\d{4}-\d{2}-\d{2}$/.test(nar || "") && nar < idag; }

function behoverBekraftelse(r) {
    return r.rad && (r.slag === "leverans" || r.slag === "uestart");
}

function avropKonflikter(bar, rader, val, delta) {
    const ut = [];
    (bar.material || []).forEach(m => {
        const a = rader.find(x => x.rad === m && x.slag === "avrop"), l = rader.find(x => x.rad === m && x.slag !== "avrop");
        if (!a || !l)
            return;
        const aDag = val[a.kort.id] && val[a.kort.id].flytta ? skiftaArbetsdagar(a.kort.dag, delta) : a.kort.dag;
        const lDag = val[l.kort.id] && val[l.kort.id].flytta ? skiftaArbetsdagar(l.kort.dag, delta) : l.kort.dag;
        if (iso2d(aDag) > iso2d(lDag))
            ut.push(m.txt || radRubrik(l));
    });
    return ut;
}

function hinderOppetVid(h, vStart) {
    const slut = iso2d(plus(vStart, 7));
    if (h.skapad && new Date(h.skapad) >= slut)
        return false;
    if (h.lostTid)
        return new Date(h.lostTid) >= slut;
    if (h.status === "lost")
        return false;
    return true;
}

function forsenatAvrop(r, idag) { return !r.klar && r.dag < idag; }

function projHinder(p, tavlor, idag) {
    const ut = { oppna: [], forfallna: [], utanAgare: [], forfallerIVeckan: [], lostaIVeckan: [] };
    const vStart = dennaVeckasMandag(idag), vSlut = plus(vStart, 6);
    (tavlor || p.tavlor).forEach(t => {
        t.hinder.forEach(h => {
            const rad = { tavla: t, hinder: h };
            if (h.status === "lost") {
                if (tidIVeckan(h.lostTid, vStart))
                    ut.lostaIVeckan.push(rad);
                return;
            }
            ut.oppna.push(rad);
            if (forfallen(h.nar, idag))
                ut.forfallna.push(rad);
            else if (/^\d{4}-/.test(h.nar || "") && h.nar >= vStart && h.nar <= vSlut)
                ut.forfallerIVeckan.push(rad);
            if (!h.vem || !h.nar)
                ut.utanAgare.push(rad);
        });
    });
    return ut;
}

function obekraftadeDatum(p, tavlor) {
    const ut = [];
    (tavlor || p.tavlor).forEach(t => t.kort.forEach(k => {
        (k.forutsattningar || []).forEach(f => {
            if (f.omrade === "bekraftelse" && f.status === "saknas")
                ut.push({ tavla: t, kort: k, f: f });
        });
    }));
    return ut;
}

function oppnaHinder(t) { return t.hinder.filter(h => h.status !== "lost"); }

function parTillHinder(h, t) {
    if (!h.kop || !h.kop.kortId || !h.kop.forId)
        return null;
    const kort = t.kort.find(k => k.id === h.kop.kortId);
    if (!kort)
        return null;
    const f = (kort.forutsattningar || []).find(x => x.id === h.kop.forId);
    return f ? { kort: kort, f: f } : null;
}

function hinderTillF(f, t) { return f && f.hinderId ? t.hinder.find(x => x.id === f.hinderId) || null : null; }

function avropRader(opt, p) {
    const ut = [], tavlor = opt.tavlor || [];
    tavlor.forEach(t => {
        const pp = p;
        const tagna = {};
        t.kort.forEach(prod => {
            (prod.material || []).forEach(m => {
                const a = t.kort.find(x => x.id === m.avropKortId);
                if (!a)
                    return;
                tagna[a.id] = 1;
                const l = t.kort.find(x => x.id === m.levKortId);
                const fid = m.foretagId && ftgPost(pp, m.foretagId) ? m.foretagId : null;
                ut.push({ tavla: t.namn, dag: a.dag, klar: !!a.klar, slag: m.slag || "material",
                    vad: m.txt || a.text, foretag: ftgNamn(pp, m), foretagId: fid,
                    moment: momentText(t, a) || prod.text, levDag: l ? l.dag : (m.levDag || "") });
            });
        });
        t.kort.forEach(k => {
            if (tagna[k.id] || (k.typ !== "avrop" && k.roll !== "A"))
                return;
            const lev = k.kedja ? t.kort.filter(x => x.kedja === k.kedja && x.roll === "L") : [];
            let vad = k.text.replace(" · gör idag", "");
            if (vad.indexOf("Avrop ") === 0)
                vad = vad.slice(6);
            const eget = k.avrop || null;
            const levKort = eget && eget.levKortId ? t.kort.find(x => x.id === eget.levKortId) : null;
            if (eget && eget.txt)
                vad = eget.txt;
            const fid2 = eget && eget.foretagId && ftgPost(pp, eget.foretagId) ? eget.foretagId : null;
            ut.push({ tavla: t.namn, dag: k.dag, klar: !!k.klar, slag: eget ? (eget.slag || null) : null, vad: vad,
                foretag: eget ? ftgNamn(pp, eget) : "", foretagId: fid2, moment: momentText(t, k),
                levDag: levKort ? levKort.dag : (eget && eget.levDag ? eget.levDag : (lev.length === 1 ? lev[0].dag : "")) });
        });
    });
    const utanTyp = ut.filter(r => r.slag === null).length;
    let rader = ut;
    if (opt.typ === "material")
        rader = rader.filter(r => r.slag === "material");
    if (opt.typ === "ue")
        rader = rader.filter(r => r.slag === "ue");
    if (opt.foretag === "__utan")
        rader = rader.filter(r => !r.foretagId && !foretagNyckel(r.foretag));
    else if (opt.foretag && opt.foretag.indexOf("id:") === 0)
        rader = rader.filter(r => r.foretagId === opt.foretag.slice(3));
    else if (opt.foretag)
        rader = rader.filter(r => !r.foretagId && foretagNyckel(r.foretag) === opt.foretag);
    if (opt.fran)
        rader = rader.filter(r => r.dag >= opt.fran);
    if (opt.till)
        rader = rader.filter(r => r.dag <= opt.till);
    rader.sort((a, b) => a.dag < b.dag ? -1 : a.dag > b.dag ? 1 : (a.tavla < b.tavla ? -1 : a.tavla > b.tavla ? 1 : 0));
    rader.utanTyp = utanTyp;
    return rader;
}

function projAvrop(p, tavlor, fran, till) {
    return avropRader({ tavlor: tavlor || p.tavlor, typ: "alla", fran: fran, till: till }, p);
}

function framforhallning(p, tavlor, veckor, idag) {
    const fran = dennaVeckasMandag(idag), till = plus(fran, veckor * 7 - 1);
    const rader = projAvrop(p, tavlor, fran, till);
    const ut = { fran: fran, till: till, moment: 0, avrop: rader.length, leveranser: 0, uestarter: 0, medHinder: 0 };
    (tavlor || p.tavlor).forEach(t => {
        const moment = produktionsmomentEfter(t, fran, till);
        ut.moment += moment.length;
        ut.medHinder += moment.filter(k => t.hinder.some(h => h.status !== "lost" && h.kop && h.kop.kortId === k.id)).length;
        t.kort.forEach(k => {
            if (k.roll !== "L" || k.dag < fran || k.dag > till)
                return;
            const ue = k.text.indexOf("UE start") === 0;
            if (ue)
                ut.uestarter++;
            else
                ut.leveranser++;
        });
    });
    return ut;
}

function rensaMaterialRef(t, borttagna) {
    (t.kort || []).forEach(k => (k.material || []).forEach(m => {
        if (m.avropKortId && borttagna.indexOf(m.avropKortId) >= 0)
            m.avropKortId = null;
        if (m.levKortId && borttagna.indexOf(m.levKortId) >= 0)
            m.levKortId = null;
    }));
}

function rensaAktivitetRef(t, borttagna) {
    (t.hinder || []).forEach(h => {
        if (h.kop && h.kop.aktivitetId && borttagna.indexOf(h.kop.aktivitetId) >= 0)
            h.kop.aktivitetId = null;
    });
}

function rensaHinderRef(t, borttagna) {
    t.hinder.forEach(h => {
        if (h.kop && h.kop.kortId && borttagna.indexOf(h.kop.kortId) >= 0) {
            h.kop.kortId = null;
            h.kop.forId = null;
        }
    });
}
