/* ======================================================================
   Datum, veckor och arbetsdagar
   ====================================================================== */

function d2iso(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }

function iso2d(s) { const p = s.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }

function plus(iso, n) { const d = iso2d(iso); d.setDate(d.getDate() + n); return d2iso(d); }

function mandag(d) { const x = new Date(d); const v = (x.getDay() + 6) % 7; x.setDate(x.getDate() - v); x.setHours(0, 0, 0, 0); return x; }

function veckonr(iso) {
    const d = iso2d(iso), t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dag = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - dag);
    const nyar = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return Math.ceil(((t - nyar) / 86400000 + 1) / 7);
}

function kortDatum(iso) { const d = iso2d(iso); return d.getDate() + "/" + (d.getMonth() + 1); }

function dagEtikett(iso) { const d = iso2d(iso); return DAGKORT[(d.getDay() + 6) % 7] + " " + kortDatum(iso) + " · v" + veckonr(iso); }

function nu(klocka) { return (klocka ? klocka() : new Date()).toISOString(); }

function uid(genId) { return genId ? genId() : Math.random().toString(36).slice(2, 10); }

function skiftaArbetsdagar(iso, n) { return n >= 0 ? plusArbetsdagar(iso, n) : minusArbetsdagar(iso, -n); }

function plusArbetsdagar(iso, n) {
    let d = iso, kvar = Math.max(0, n);
    while (kvar > 0) {
        d = plus(d, 1);
        if ((iso2d(d).getDay() + 6) % 7 < 5)
            kvar--;
    }
    return d;
}

function arbetsdagarMellan(a, b) {
    if (a === b)
        return 0;
    const bakat = iso2d(b) < iso2d(a);
    let d = bakat ? b : a, mal = bakat ? a : b, n = 0;
    while (d !== mal) {
        d = plus(d, 1);
        if ((iso2d(d).getDay() + 6) % 7 < 5)
            n++;
    }
    return bakat ? -n : n;
}

function minusArbetsdagar(iso, n) {
    let d = iso;
    let kvar = Math.max(0, n);
    while (kvar > 0) {
        d = plus(d, -1);
        const v = (iso2d(d).getDay() + 6) % 7;
        if (v < 5)
            kvar--;
    }
    return d;
}

function iVeckan(iso, vStart) { return iso >= vStart && iso <= plus(vStart, 4); }

function tidIVeckan(tid, vStart) {
    if (!tid)
        return false;
    const d = new Date(tid);
    return d >= iso2d(vStart) && d < iso2d(plus(vStart, 7));
}

function lagIVeckan(k, vStart) {
    if (k.urspDag && iVeckan(k.urspDag, vStart))
        return true;
    if ((k.flyttar || []).some(f => iVeckan(f.fran, vStart) || iVeckan(f.till, vStart)))
        return true;
    return iVeckan(k.dag, vStart);
}

function tidStampel() {
    const d = new Date();
    const p2 = n => String(n).padStart(2, "0");
    return p2(d.getDate()) + "/" + p2(d.getMonth() + 1) + "/" + d.getFullYear() +
        " kl. " + p2(d.getHours()) + ":" + p2(d.getMinutes());
}

function helgDagar(idag) {
    const v = (iso2d(idag).getDay() + 6) % 7;
    if (v !== 3 && v !== 4)
        return null;
    const lor = plus(idag, (5 - v)), son = plus(idag, (6 - v));
    return [lor, son];
}

function dagNamnKort(iso) {
    const v = (iso2d(iso).getDay() + 6) % 7;
    const namn = ["Mån", "Tis", "Ons", "Tor", "Fre", "Lör", "Sön"][v];
    return namn + " " + kortDatum(iso);
}

function periodText(fran, till) {
    const a = iso2d(fran), b = iso2d(till);
    if (fran === till)
        return a.getDate() + " " + MANAD[a.getMonth()];
    if (a.getMonth() === b.getMonth())
        return a.getDate() + "–" + b.getDate() + " " + MANAD[b.getMonth()];
    return a.getDate() + " " + MANAD[a.getMonth()].slice(0, 3) + " – " + b.getDate() + " " + MANAD[b.getMonth()].slice(0, 3);
}

function arbetsdagarMellanDatum(fran, till) {
    const ut = [];
    let d = fran, n = 0;
    while (d <= till && n < 800) {
        if ((iso2d(d).getDay() + 6) % 7 < 5)
            ut.push(d);
        d = plus(d, 1);
        n++;
    }
    return ut;
}

function dagRubrik(d) { return DAGKORT[(iso2d(d).getDay() + 6) % 7] + " " + kortDatum(d); }

function dennaVeckasMandag(idag) { return d2iso(mandag(iso2d(idag))); }

function senasteAvslutadeVecka(idag) { return plus(dennaVeckasMandag(idag), -7); }

function arbDagOrd(n) { const a = Math.abs(n); return a + (a === 1 ? " arbetsdag" : " arbetsdagar"); }
