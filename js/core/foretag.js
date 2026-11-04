/* ======================================================================
   Företagsregister
   ====================================================================== */

function ftgRader(p) {
    const ut = [];
    p.tavlor.forEach(t => t.kort.forEach(k => {
        (k.material || []).forEach(m => ut.push({ tavla: t, kort: k, rad: m, typ: "material" }));
        if (k.avrop && !(k.material && k.material.length))
            ut.push({ tavla: t, kort: k, rad: k.avrop, typ: "avrop" });
    }));
    return ut;
}

function ftgAnvandning(p, id) { return ftgRader(p).filter(x => x.rad.foretagId === id); }

function foretagNyckel(n) { return foretagText(n).toLowerCase(); }

function ftgPost(p, id) { return id ? (p.foretag || []).find(f => f.id === id) || null : null; }

function ftgDubblett(p, namn, utomId) {
    const n = foretagNyckel(namn);
    return n ? (p.foretag || []).find(f => f.id !== utomId && foretagNyckel(f.namn) === n) || null : null;
}

function motpart(r, p) {
    if (!r.rad)
        return "";
    return ftgNamn(p, r.rad) || r.rad.txt || "";
}

function ftgNamn(p, rad) {
    if (!rad)
        return "";
    const f = ftgPost(p, rad.foretagId);
    return f ? f.namn : (rad.leverantor || "");
}

function ejKoppladeNamn(p) {
    const ut = {};
    ftgRader(p).forEach(x => {
        if (x.rad.foretagId && ftgPost(p, x.rad.foretagId))
            return;
        const n = foretagNyckel(x.rad.leverantor);
        if (!n)
            return;
        ut[n] = ut[n] || { namn: x.rad.leverantor.trim().replace(/\s+/g, " "), antal: 0 };
        ut[n].antal++;
    });
    return Object.keys(ut).map(n => ut[n]).sort((a, b) => a.namn.localeCompare(b.namn, "sv"));
}

function foretagLista(tavlor, p) {
    const lista = tavlor || [], pp = p;
    const sedda = {}, ut = [];
    let utan = false;
    const anvandaId = {};
    lista.forEach(t => {
        const lagg = rad => {
            if (!rad)
                return;
            if (rad.foretagId && ftgPost(pp, rad.foretagId)) {
                anvandaId[rad.foretagId] = 1;
                return;
            }
            const nyckel = foretagNyckel(rad.leverantor);
            if (!nyckel) {
                utan = true;
                return;
            }
            if (!sedda[nyckel]) {
                sedda[nyckel] = rad.leverantor.trim().replace(/\s+/g, " ");
                ut.push({ nyckel: nyckel, namn: sedda[nyckel], kopplad: false });
            }
        };
        t.kort.forEach(k => {
            (k.material || []).forEach(lagg);
            if (k.typ === "avrop" && !(k.material && k.material.length)) {
                if (k.avrop)
                    lagg(k.avrop);
                else
                    utan = true;
            }
        });
    });
    ut.sort((a, b) => a.namn.localeCompare(b.namn, "sv"));
    const reg = (pp.foretag || []).filter(f => f.aktiv || anvandaId[f.id])
        .map(f => ({ nyckel: "id:" + f.id, namn: f.namn, kopplad: true, aktiv: f.aktiv }))
        .sort((a, b) => a.namn.localeCompare(b.namn, "sv"));
    const alla = reg.concat(ut);
    alla.utan = utan;
    return alla;
}

function foretagNamn(nyckel, tavlor, p) {
    const f = foretagLista(tavlor, p).find(x => x.nyckel === nyckel);
    return f ? f.namn : nyckel;
}

function foretagText(n) { return (n || "").trim().replace(/\s+/g, " "); }
