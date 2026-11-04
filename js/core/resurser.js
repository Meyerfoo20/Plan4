/* ======================================================================
   Resurser och bemanning
   ====================================================================== */

function konfliktText(p, g) {
    const x = resPers(p, g.personId), per = periodText(g.dagar[0], g.dagar[g.dagar.length - 1]);
    return { person: x ? x.namn : "?", period: per,
        lage: g.hel ? "Frånvarande men resurssatt" : "Delvis frånvarande " + g.delar.map(d => d.tid + "–" + d.slut).join(", "),
        moment: momentRef(g.moment), orsak: g.orsak };
}

function resKat(p, id) { return (p.resurser.kategorier || []).find(c => c.id === id) || null; }

function resPers(p, id) { return (p.resurser.personer || []).find(x => x.id === id) || null; }

function katKort(namn) {
    const n = (namn || "").replace(/arbetare$/i, "").trim();
    return (n || namn || "").toLowerCase();
}

function bemannadeMoment(p, tavlor) {
    const ut = [];
    (tavlor || p.tavlor).forEach(t => t.kort.forEach(k => {
        if (k.typ !== "produktion" || k.roll === "K" || tomBemanning(k.bemanning))
            return;
        const per = momentPeriodI(t, k);
        ut.push({ tavla: t, kort: k, fran: per.fran, till: per.till });
    }));
    return ut;
}

function bemanningsLage(p, k) {
    const b = k.bemanning || { behov: [], personer: [] };
    const rader = (b.behov || []).map(x => {
        const namngivna = (b.personer || []).filter(pid => { const pp = resPers(p, pid); return pp && pp.kategoriId === x.kategoriId; }).length;
        const kat = resKat(p, x.kategoriId);
        return { kategoriId: x.kategoriId, kategori: kat ? kat.namn : "Okänd yrkesgrupp", antal: x.antal,
            namngivna: namngivna, saknas: Math.max(0, x.antal - namngivna) };
    });
    return { rader: rader, behov: rader.reduce((n, r) => n + r.antal, 0),
        namngivna: (b.personer || []).length, saknas: rader.reduce((n, r) => n + r.saknas, 0) };
}

function bemanningsText(p, k) {
    const b = k.bemanning;
    if (tomBemanning(b))
        return "";
    if ((b.behov || []).length)
        return b.behov.map(x => { const c = resKat(p, x.kategoriId); return x.antal + " " + (c ? katKort(c.namn) : "?"); }).join(" · ");
    return String((b.personer || []).length);
}

function resursKarta(p, tavlor, fran, till) {
    const karta = {};
    bemannadeMoment(p, tavlor).forEach(m => {
        const a = m.fran > fran ? m.fran : fran, b = m.till < till ? m.till : till;
        if (a > b)
            return;
        arbetsdagarMellanDatum(a, b).forEach(d => {
            (m.kort.bemanning.personer || []).forEach(pid => {
                karta[pid] = karta[pid] || {};
                (karta[pid][d] = karta[pid][d] || []).push(m);
            });
        });
    });
    return karta;
}

function dubbelbokningar(p, fran, till) {
    const karta = resursKarta(p, p.tavlor, fran, till), ut = [];
    Object.keys(karta).forEach(pid => Object.keys(karta[pid]).sort().forEach(d => {
        const lista = karta[pid][d];
        const unika = lista.filter((m, i) => lista.findIndex(x => x.kort.id === m.kort.id) === i);
        if (unika.length > 1)
            ut.push({ personId: pid, dag: d, moment: unika });
    }));
    return ut;
}

function momentRef(m) {
    return momentNamn(m.kort) + " · " + m.tavla.namn + (m.kort.plats ? " · " + m.kort.plats : "");
}

function behovPerDag(p, tavlor, fran, till) {
    const ut = {};
    bemannadeMoment(p, tavlor).forEach(m => {
        const a = m.fran > fran ? m.fran : fran, b = m.till < till ? m.till : till;
        if (a > b)
            return;
        arbetsdagarMellanDatum(a, b).forEach(d => {
            (m.kort.bemanning.behov || []).forEach(x => {
                ut[x.kategoriId] = ut[x.kategoriId] || {};
                ut[x.kategoriId][d] = (ut[x.kategoriId][d] || 0) + x.antal;
            });
        });
    });
    return ut;
}

function bemanningKonflikter(p, personer, fran, till, egetId) {
    const karta = resursKarta(p, p.tavlor, fran, till), ut = [];
    (personer || []).forEach(pid => {
        const dagar2 = karta[pid] || {};
        Object.keys(dagar2).sort().forEach(d => {
            const andra = dagar2[d].filter(m => m.kort.id !== egetId);
            if (andra.length)
                ut.push({ personId: pid, dag: d, moment: andra });
        });
    });
    return ut;
}

function resPeriod(f, idag) {
    const m = dennaVeckasMandag(idag);
    if (f.period === "1v")
        return { fran: m, till: plus(m, 4), text: "v." + veckonr(m) };
    if (f.period === "4v")
        return { fran: m, till: plus(m, 25), text: "v." + veckonr(m) + "–" + veckonr(plus(m, 21)) };
    if (f.period === "valj") {
        const a = f.fran || m, b = f.till && f.till >= a ? f.till : a;
        return { fran: a, till: plus(b, 4), text: "v." + veckonr(a) + " " + iso2d(a).getFullYear() + " – v." + veckonr(b) + " " + iso2d(b).getFullYear() };
    }
    return { fran: m, till: plus(m, 11), text: "v." + veckonr(m) + "–" + veckonr(plus(m, 7)) };
}

function personAnvandning(p, pid) {
    return bemannadeMoment(p, p.tavlor).filter(m => (m.kort.bemanning.personer || []).indexOf(pid) >= 0);
}

function resTavlor(p, f, t) { return f.omf === "tavla" ? [t] : p.tavlor; }

function resursUnderlag(p, f, t, idag) {
    const per = resPeriod(f, idag), tavlor = resTavlor(p, f, t);
    const dagar2 = arbetsdagarMellanDatum(per.fran, per.till);
    const karta = resursKarta(p, tavlor, per.fran, per.till);
    const konf = dubbelbokningar(p, per.fran, per.till);
    const konfNyckel = {};
    konf.forEach(k => konfNyckel[k.personId + "|" + k.dag] = k);
    const behov = behovPerDag(p, tavlor, per.fran, per.till);
    const moment = bemannadeMoment(p, tavlor).filter(m => m.till >= per.fran && m.fran <= per.till);
    const franvaro = franvaroKarta(p, per.fran, per.till);
    const franKonf = franvaroKonflikter(p, per.fran, per.till, tavlor);
    return { per: per, tavlor: tavlor, dagar: dagar2, karta: karta, konf: konf, konfNyckel: konfNyckel, behov: behov, moment: moment,
        franvaro: franvaro, franKonf: franKonf };
}
