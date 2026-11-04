/* ======================================================================
   Frånvaro
   ====================================================================== */

function franvaroUtPeriod(f, idag) {
    const m = dennaVeckasMandag(idag);
    if (f.period === "forra")
        return { fran: plus(m, -7), till: plus(m, -1), text: "v." + veckonr(plus(m, -7)) };
    if (f.period === "denna")
        return { fran: m, till: plus(m, 6), text: "v." + veckonr(m) };
    if (f.period === "2v")
        return { fran: m, till: plus(m, 13), text: "v." + veckonr(m) + "–" + veckonr(plus(m, 7)) };
    if (f.period === "4v")
        return { fran: m, till: plus(m, 27), text: "v." + veckonr(m) + "–" + veckonr(plus(m, 21)) };
    if (f.period === "valj") {
        const a = f.fran || m, b = f.till && f.till >= a ? f.till : a;
        return { fran: a, till: plus(b, 6), text: "v." + veckonr(a) + " " + iso2d(a).getFullYear() + " – v." + veckonr(b) + " " + iso2d(b).getFullYear() };
    }
    return { fran: "0000-01-01", till: "9999-12-31", text: "Alla registrerade", alla: true };
}

function franvaroRader(p, f, idag) {
    const per = franvaroUtPeriod(f, idag), ut = [];
    function passar(pid, orsak) {
        if (f.person === "__okopplad" && pid)
            return false;
        if (f.person && f.person !== "__okopplad" && pid !== f.person)
            return false;
        if (f.orsak && orsak !== f.orsak)
            return false;
        return true;
    }
    p.tavlor.forEach(t => {
        t.kort.forEach(k => {
            if (k.typ !== "franvaro")
                return;
            const pr = franvaroPeriod(k);
            if (pr.till < per.fran || pr.fran > per.till)
                return;
            if (!passar(k.personId, k.franvaroOrsak || "Annat"))
                return;
            const x = k.personId ? resPers(p, k.personId) : null;
            ut.push({ person: x ? x.namn : (k.personNamn || k.text || "—"), kopplad: !!k.personId, manuell: !!k.personNamn, orsak: k.franvaroOrsak || "Annat",
                fran: pr.fran, till: pr.till, tid: pr.del ? tidText(k) : "", vad: franvaroNy(k) ? (k.text || "") : "", tavla: t.namn,
                arbetsdagar: arbetsdagarMellanDatum(pr.fran, pr.till).length });
        });
        if (per.alla)
            return;
        t.aterkom.forEach(a => {
            if (a.typ !== "franvaro" || !passar(null, a.franvaroOrsak || "Annat"))
                return;
            arbetsdagarMellanDatum(per.fran, per.till).forEach(d => {
                if (aterkomDagar(a).indexOf((iso2d(d).getDay() + 6) % 7) < 0 || (a.tom && d > a.tom))
                    return;
                if (t.skippa.indexOf(a.id + "|" + d) >= 0 || t.kort.some(k => k.fran === a.id && k.dag === d))
                    return;
                ut.push({ person: a.text || a.vem || "—", kopplad: false, orsak: a.franvaroOrsak || "Annat", fran: d, till: d,
                    tid: a.tid ? (a.slutTid ? a.tid + "–" + a.slutTid : a.tid) : "", vad: "återkommande", tavla: t.namn, arbetsdagar: 1 });
            });
        });
    });
    ut.sort((a, b) => a.fran !== b.fran ? (a.fran < b.fran ? -1 : 1) : a.person.localeCompare(b.person, "sv"));
    ut.per = per;
    return ut;
}

function franvaroPeriod(k) {
    const till = k.tillDag && k.tillDag > k.dag ? k.tillDag : k.dag;
    return { fran: k.dag, till: till, del: !!k.tid && till === k.dag };
}

function franvaroPerson(p, k) { return k.personId ? resPers(p, k.personId) : null; }

function franvaroTitel(p, k) {
    const x = franvaroPerson(p, k);
    if (x)
        return x.namn + " borta";
    if (k.personNamn)
        return k.personNamn + " borta";
    return k.text || "Frånvaro";
}

function franvaroNy(k) { return !!(k.personId || k.personNamn); }

function franvaroUnder(p, k) {
    const per = franvaroPeriod(k), delar = [k.franvaroOrsak || "Annat"];
    if (franvaroNy(k) && k.text)
        delar[0] += " · " + k.text;
    if (per.del)
        delar.push(tidText(k));
    else if (per.till !== per.fran)
        delar.push(periodText(per.fran, per.till));
    return delar.join(" · ");
}

function franvaroOrsakDag(x) {
    const hel = x.poster.find(f => !franvaroPeriod(f.kort).del);
    return (hel || x.poster[0]).kort.franvaroOrsak || "Annat";
}

function franvaroKarta(p, fran, till) {
    const ut = {};
    p.tavlor.forEach(t => t.kort.forEach(k => {
        if (k.typ !== "franvaro" || !k.personId)
            return;
        const per = franvaroPeriod(k);
        const a = per.fran > fran ? per.fran : fran, b = per.till < till ? per.till : till;
        if (a > b)
            return;
        arbetsdagarMellanDatum(a, b).forEach(d => {
            ut[k.personId] = ut[k.personId] || {};
            const x = ut[k.personId][d] = ut[k.personId][d] || { hel: false, delar: [], poster: [] };
            x.poster.push({ tavla: t, kort: k });
            if (per.del)
                x.delar.push({ tid: k.tid, slut: k.slutTid, orsak: k.franvaroOrsak || "Annat" });
            else
                x.hel = true;
        });
    }));
    return ut;
}

function franvaroKonflikter(p, fran, till, tavlor) {
    const fk = franvaroKarta(p, fran, till), rk = resursKarta(p, tavlor || p.tavlor, fran, till), grupper = {};
    Object.keys(fk).forEach(pid => {
        const bem = rk[pid] || {};
        Object.keys(fk[pid]).sort().forEach(d => {
            const f = fk[pid][d];
            (bem[d] || []).forEach(m => {
                const nyckel = pid + "|" + m.kort.id + "|" + (f.hel ? "hel" : "del");
                const g = grupper[nyckel] = grupper[nyckel] || { personId: pid, moment: m, hel: f.hel, dagar: [],
                    orsak: franvaroOrsakDag(f), delar: f.delar };
                if (g.dagar.indexOf(d) < 0)
                    g.dagar.push(d);
            });
        });
    });
    return Object.keys(grupper).map(k => grupper[k]).sort((a, b) => a.dagar[0] < b.dagar[0] ? -1 : 1);
}
