/* ======================================================================
   Operationer (patchar)
   ====================================================================== */

function stamplaHistorik(historik, klocka, genId) {
    (historik || []).forEach(h => {
        if (h && h.id === undefined)
            h.id = uid(genId);
        if (h && h.tid === undefined)
            h.tid = nu(klocka);
    });
    return historik;
}

function opBockaKort(kort, klocka, genId) {
    if (!kort || !kort.id)
        return { ok: false, fel: "kort saknas", andringar: [], fore: [], historik: [] };
    const klar = !kort.klar;
    return { ok: true, fel: null,
        andringar: [{ typ: "satt", objekt: "kort", id: kort.id, falt: { klar: klar, klarTid: klar ? nu(klocka) : null } }],
        fore: [{ objekt: "kort", id: kort.id, varde: JSON.parse(JSON.stringify(kort)) }],
        historik: stamplaHistorik(klar ? [{ txt: "Klart: " + kort.text }] : [], klocka, genId) };
}

function opBockaKedjekort(kort, tavlaId, klocka, genId) {
    if (!kort || !kort.id)
        return { ok: false, fel: "kort saknas", andringar: [], fore: [], historik: [] };
    if (!tavlaId || typeof tavlaId !== "string")
        return { ok: false, fel: "tavla saknas", andringar: [], fore: [], historik: [] };
    const klar = !kort.klar;
    const bo = { typ: "tavla", id: tavlaId };
    const faltFore = namn => Object.prototype.hasOwnProperty.call(kort, namn)
        ? { objekt: "kort", id: kort.id, falt: namn, varde: kort[namn], bo: bo }
        : { objekt: "kort", id: kort.id, falt: namn, saknades: true, bo: bo };
    return { ok: true, fel: null,
        andringar: [{ typ: "satt", objekt: "kort", id: kort.id,
                falt: { klar: klar, klarTid: klar ? nu(klocka) : null }, bo: bo }],
        fore: [faltFore("klar"), faltFore("klarTid")],
        historik: stamplaHistorik([{ txt: (klar ? "Klart: " : "Öppnad igen: ") + kort.text + " (utanför aktuell plan)" }], klocka, genId) };
}

function opBockaAttGora(aktivitet, klocka, genId) {
    if (!aktivitet || !aktivitet.id)
        return { ok: false, fel: "aktivitet saknas", andringar: [], fore: [], historik: [] };
    const status = fKlar(aktivitet) ? "Ej påbörjad" : "Klar";
    return { ok: true, fel: null,
        andringar: [{ typ: "satt", objekt: "aktivitet", id: aktivitet.id, falt: { status: status } }],
        fore: [{ objekt: "aktivitet", id: aktivitet.id, varde: JSON.parse(JSON.stringify(aktivitet)) }],
        historik: stamplaHistorik([{ txt: "Att göra: " + aktivitet.titel + " · " + status }], klocka, genId) };
}

function opSattHinderStatus(hinder, lost, klocka) {
    if (!hinder || !hinder.id)
        return { ok: false, fel: "hinder saknas", andringar: [], fore: [], historik: [] };
    const status = lost ? "lost" : "oppet";
    const lostTid = lost ? nu(klocka) : null;
    const fore = [];
    fore.push("status" in hinder
        ? { objekt: "hinder", id: hinder.id, falt: "status", varde: hinder.status }
        : { objekt: "hinder", id: hinder.id, falt: "status", saknades: true });
    fore.push("lostTid" in hinder
        ? { objekt: "hinder", id: hinder.id, falt: "lostTid", varde: hinder.lostTid }
        : { objekt: "hinder", id: hinder.id, falt: "lostTid", saknades: true });
    return { ok: true, fel: null,
        andringar: [{ typ: "satt", objekt: "hinder", id: hinder.id, falt: { status: status, lostTid: lostTid } }],
        fore: fore, historik: [] };
}

function opNyttHinder(vad, vem, nar, kop, klocka, genId) {
    const txt = typeof vad === "string" ? vad.trim() : "";
    if (!txt)
        return { ok: false, fel: "vad saknas", andringar: [], fore: [], historik: [] };
    const hid = uid(genId);
    const h = { id: hid, vad: txt, vem: typeof vem === "string" ? vem.trim() : "", nar: nar || "",
        kop: kop || null, status: "oppet", skapad: nu(klocka), lostTid: null };
    return { ok: true, fel: null,
        andringar: [{ typ: "lagg", objekt: "hinder", id: hid, varde: h }],
        fore: [{ objekt: "hinder", id: hid, varde: null }],
        historik: [] };
}

function opAndraHinder(hinder, vad, vem, nar) {
    if (!hinder || !hinder.id)
        return { ok: false, fel: "hinder saknas", andringar: [], fore: [], historik: [] };
    const txt = typeof vad === "string" ? vad.trim() : "";
    if (!txt)
        return { ok: false, fel: "vad saknas", andringar: [], fore: [], historik: [] };
    const falt = { vad: txt, vem: typeof vem === "string" ? vem.trim() : "", nar: nar || "" };
    const fore = ["vad", "vem", "nar"].map(n => n in hinder
        ? { objekt: "hinder", id: hinder.id, falt: n, varde: hinder[n] }
        : { objekt: "hinder", id: hinder.id, falt: n, saknades: true });
    return { ok: true, fel: null,
        andringar: [{ typ: "satt", objekt: "hinder", id: hinder.id, falt: falt }],
        fore: fore, historik: [] };
}

function opTaBortHinder(hinder, tavla, projekt, klocka, genId) {
    if (!hinder || !tavla || !tavla.id)
        return { ok: false, fel: "hinder eller tavla saknas", andringar: [], fore: [], historik: [] };
    const hinderLista = Array.isArray(tavla.hinder) ? tavla.hinder : [];
    const andringar = [], fore = [];
    const par = parTillHinder(hinder, tavla);
    if (par) {
        const bo = { typ: "kort", id: par.kort.id };
        andringar.push({ typ: "satt", objekt: "forutsattning", id: par.f.id, falt: { hinderId: null }, bo: bo });
        fore.push("hinderId" in par.f
            ? { objekt: "forutsattning", id: par.f.id, falt: "hinderId", varde: par.f.hinderId, bo: bo }
            : { objekt: "forutsattning", id: par.f.id, falt: "hinderId", saknades: true, bo: bo });
    }
    const aktiviteter = Array.isArray(fAktiviteter(projekt)) ? fAktiviteter(projekt) : [];
    aktiviteter.forEach(a => {
        if (!a || !a.hinderId || a.hinderId !== hinder.id)
            return;
        andringar.push({ typ: "satt", objekt: "aktivitet", id: a.id, falt: { hinderId: null } });
        fore.push({ objekt: "aktivitet", id: a.id, falt: "hinderId", varde: a.hinderId });
    });
    const iTavlan = hinderLista.find(x => x && x.id === hinder.id) || null;
    if (iTavlan) {
        const bo = { typ: "tavla", id: tavla.id };
        andringar.push({ typ: "taBort", objekt: "hinder", id: hinder.id, bo: bo });
        fore.push({ objekt: "hinder", id: hinder.id,
            varde: JSON.parse(JSON.stringify(iTavlan)), bo: bo });
    }
    return { ok: true, fel: null, andringar: andringar, fore: fore,
        historik: stamplaHistorik([{ txt: "Hinder borttaget: " + hinder.vad +
                    (par ? " (förutsättningen kvarstår osäkrad)" : "") }], klocka, genId) };
}

function opSakraForutsattning(kort, forutsattning, hinder, tyst, etikett, klocka, genId) {
    if (!kort || !kort.id || !forutsattning || !forutsattning.id)
        return { ok: false, fel: "kort eller förutsättning saknas", andringar: [], fore: [], historik: [] };
    const bo = { typ: "kort", id: kort.id };
    const andringar = [], fore = [], historik = [];
    const hist = o => { historik.push(stamplaHistorik([o], klocka, genId)[0]); };
    andringar.push({ typ: "satt", objekt: "forutsattning", id: forutsattning.id,
        falt: { status: "sakrad" }, bo: bo });
    fore.push("status" in forutsattning
        ? { objekt: "forutsattning", id: forutsattning.id, falt: "status", varde: forutsattning.status, bo: bo }
        : { objekt: "forutsattning", id: forutsattning.id, falt: "status", saknades: true, bo: bo });
    if (hinder && hinder.id && hinder.status !== "lost") {
        andringar.push({ typ: "satt", objekt: "hinder", id: hinder.id,
            falt: { status: "lost", lostTid: nu(klocka) } });
        fore.push("status" in hinder
            ? { objekt: "hinder", id: hinder.id, falt: "status", varde: hinder.status }
            : { objekt: "hinder", id: hinder.id, falt: "status", saknades: true });
        fore.push("lostTid" in hinder
            ? { objekt: "hinder", id: hinder.id, falt: "lostTid", varde: hinder.lostTid }
            : { objekt: "hinder", id: hinder.id, falt: "lostTid", saknades: true });
        hist({ txt: "Hinder löst: " + hinder.vad });
    }
    if (forutsattning.omrade === "beredning" && kort.beredning && kort.beredning.status !== "utford") {
        andringar.push({ typ: "satt", objekt: "kort", id: kort.id,
            falt: { beredning: Object.assign({}, kort.beredning, { status: "utford" }) } });
        fore.push({ objekt: "kort", id: kort.id, falt: "beredning",
            varde: JSON.parse(JSON.stringify(kort.beredning)) });
    }
    if (!tyst)
        hist({ txt: "Förutsättning säkrad: " + etikett });
    return { ok: true, fel: null, andringar: andringar, fore: fore, historik: historik };
}

function opOsakraForutsattning(kort, forutsattning, hinder, etikett, klocka, genId) {
    if (!kort || !kort.id || !forutsattning || !forutsattning.id)
        return { ok: false, fel: "kort eller förutsättning saknas", andringar: [], fore: [], historik: [] };
    const bo = { typ: "kort", id: kort.id };
    const andringar = [], fore = [];
    const faltFore = (o, namn) => ("" + namn) in o
        ? { objekt: "forutsattning", id: forutsattning.id, falt: namn, varde: o[namn], bo: bo }
        : { objekt: "forutsattning", id: forutsattning.id, falt: namn, saknades: true, bo: bo };
    if (hinder && hinder.id) {
        andringar.push({ typ: "satt", objekt: "forutsattning", id: forutsattning.id,
            falt: { status: "saknas" }, bo: bo });
        fore.push(faltFore(forutsattning, "status"));
        andringar.push({ typ: "satt", objekt: "hinder", id: hinder.id,
            falt: { status: "oppet", lostTid: null } });
        fore.push("status" in hinder
            ? { objekt: "hinder", id: hinder.id, falt: "status", varde: hinder.status }
            : { objekt: "hinder", id: hinder.id, falt: "status", saknades: true });
        fore.push("lostTid" in hinder
            ? { objekt: "hinder", id: hinder.id, falt: "lostTid", varde: hinder.lostTid }
            : { objekt: "hinder", id: hinder.id, falt: "lostTid", saknades: true });
    }
    else {
        const hid = uid(genId);
        andringar.push({ typ: "lagg", objekt: "hinder", id: hid, varde: {
                id: hid, vad: forutsattning.txt || etikett || "", vem: "", nar: "", status: "oppet",
                skapad: nu(klocka), lostTid: null,
                kop: { kortId: kort.id, kedja: kort.kedja || null, text: kort.text, dag: kort.dag,
                    forId: forutsattning.id }
            } });
        fore.push({ objekt: "hinder", id: hid, varde: null });
        andringar.push({ typ: "satt", objekt: "forutsattning", id: forutsattning.id,
            falt: { status: "saknas", hinderId: hid }, bo: bo });
        fore.push(faltFore(forutsattning, "status"));
        fore.push(faltFore(forutsattning, "hinderId"));
    }
    return { ok: true, fel: null, andringar: andringar, fore: fore, historik: [] };
}

function opSattBeredning(kort, status, hinder, txt, etikett, abtext, klocka, genId) {
    if (!kort || !kort.id || typeof status !== "string" || !status)
        return { ok: false, fel: "kort eller status saknas", andringar: [], fore: [], historik: [] };
    const bo = { typ: "kort", id: kort.id };
    const andringar = [], fore = [], historik = [];
    const hist = o => { historik.push(stamplaHistorik([o], klocka, genId)[0]); };
    const harLista = Array.isArray(kort.forutsattningar);
    const fb = harLista ? (kort.forutsattningar.find(x => x && x.omrade === "beredning") || null) : null;
    const kortFalt = {};
    if (kort.beredning && typeof kort.beredning === "object" && !Array.isArray(kort.beredning)) {
        andringar.push({ typ: "satt", objekt: "beredning", id: kort.id,
            falt: { kravs: true, status: status } });
        fore.push("kravs" in kort.beredning
            ? { objekt: "beredning", id: kort.id, falt: "kravs", varde: kort.beredning.kravs }
            : { objekt: "beredning", id: kort.id, falt: "kravs", saknades: true });
        fore.push("status" in kort.beredning
            ? { objekt: "beredning", id: kort.id, falt: "status", varde: kort.beredning.status }
            : { objekt: "beredning", id: kort.id, falt: "status", saknades: true });
    }
    else {
        kortFalt.beredning = { kravs: true, status: status };
        fore.push("beredning" in kort
            ? { objekt: "kort", id: kort.id, falt: "beredning",
                varde: kort.beredning === undefined ? null : kort.beredning }
            : { objekt: "kort", id: kort.id, falt: "beredning", saknades: true });
    }
    if (status === "utford") {
        if (fb) {
            const kortVy = Object.assign({}, kort, { beredning: Object.assign({}, kort.beredning || {}, { kravs: true, status: status }) });
            const p = opSakraForutsattning(kortVy, fb, hinder, true, fb.txt || etikett, klocka, genId);
            if (!p.ok)
                return { ok: false, fel: p.fel, andringar: [], fore: [], historik: [] };
            p.andringar.forEach(a => andringar.push(a));
            p.fore.forEach(f => fore.push(f));
            p.historik.forEach(h => historik.push(h));
        }
        if (!harLista)
            kortFalt.forutsattningar = [];
    }
    else {
        if (fb) {
            const p = opOsakraForutsattning(kort, fb, hinder, etikett, klocka, genId);
            if (!p.ok)
                return { ok: false, fel: p.fel, andringar: [], fore: [], historik: [] };
            p.andringar.forEach(a => andringar.push(a));
            p.fore.forEach(f => fore.push(f));
            p.historik.forEach(h => historik.push(h));
            if (!harLista)
                kortFalt.forutsattningar = [];
        }
        else {
            const fid = "f" + uid(genId);
            const hid = uid(genId);
            const nyF = { id: fid, omrade: "beredning", txt: txt || "", status: "saknas", kalla: "anvandare",
                hinderId: hid };
            andringar.push({ typ: "lagg", objekt: "hinder", id: hid, varde: {
                    id: hid, vad: nyF.txt || etikett || "", vem: "", nar: "", status: "oppet",
                    skapad: nu(klocka), lostTid: null,
                    kop: { kortId: kort.id, kedja: kort.kedja || null, text: kort.text, dag: kort.dag,
                        forId: fid }
                } });
            fore.push({ objekt: "hinder", id: hid, varde: null });
            if (harLista) {
                andringar.push({ typ: "lagg", objekt: "forutsattning", id: fid, varde: nyF, bo: bo });
                fore.push({ objekt: "forutsattning", id: fid, varde: null, bo: bo });
            }
            else {
                kortFalt.forutsattningar = [nyF];
            }
        }
    }
    if (Object.keys(kortFalt).length)
        andringar.unshift({ typ: "satt", objekt: "kort", id: kort.id, falt: kortFalt });
    if (!harLista && !("forutsattningar" in kortFalt)) {
        return { ok: false, fel: "förutsättningslistan saknas och skapas inte",
            andringar: [], fore: [], historik: [] };
    }
    if (!harLista)
        fore.push("forutsattningar" in kort
            ? { objekt: "kort", id: kort.id, falt: "forutsattningar",
                varde: kort.forutsattningar === undefined ? null : kort.forutsattningar }
            : { objekt: "kort", id: kort.id, falt: "forutsattningar", saknades: true });
    hist({ txt: "Arbetsberedning " + (abtext || "") + ": " + kort.text });
    return { ok: true, fel: null, andringar: andringar, fore: fore, historik: historik };
}

function redigeraFalt(o) {
    const ut = [];
    for (const namn of ["text", "tid", "slutTid", "plats", "vem", "not", "franvaroOrsak", "typ", "milstolpe"])
        if (Object.prototype.hasOwnProperty.call(o, namn))
            ut.push([namn, o[namn]]);
    return ut;
}

function opRedigeraKort(kort, o, tavlaId) {
    if (!kort || !kort.id || !o || !tavlaId)
        return { ok: false, fel: "kort, underlag eller tavla saknas", andringar: [], fore: [], historik: [] };
    const par = redigeraFalt(o);
    if (!par.length)
        return { ok: false, fel: "inga fält att ändra", andringar: [], fore: [], historik: [] };
    const bo = { typ: "tavla", id: tavlaId };
    const falt = {}, fore = [];
    par.forEach(([namn, varde]) => {
        falt[namn] = varde;
        fore.push(Object.prototype.hasOwnProperty.call(kort, namn)
            ? { objekt: "kort", id: kort.id, falt: namn, varde: kort[namn], bo: bo }
            : { objekt: "kort", id: kort.id, falt: namn, saknades: true, bo: bo });
    });
    return { ok: true, fel: null,
        andringar: [{ typ: "satt", objekt: "kort", id: kort.id, falt: falt, bo: bo }],
        fore: fore, historik: [] };
}

function franvaroFalt(o, aldre) {
    const ut = [["dag", o.dag],
        ["tillDag", o.tillDag || ""],
        ["tid", o.tid || ""],
        ["slutTid", o.slutTid || ""],
        ["franvaroOrsak", o.franvaroOrsak || ""]];
    if (o.personId) {
        ut.push(["personId", o.personId], ["personNamn", ""], ["text", o.text || ""], ["vem", ""]);
    }
    else if (o.personNamn) {
        ut.push(["personId", null], ["personNamn", o.personNamn], ["text", o.text || ""], ["vem", ""]);
    }
    else if (!aldre) {
        ut.push(["text", o.text || ""]);
    }
    ut.push(["plats", ""]);
    return ut;
}

function opNyFranvaro(o, tavlaId, klocka, genId) {
    if (!o || !o.dag || !tavlaId)
        return { ok: false, fel: "underlag eller tavla saknas", andringar: [], fore: [], historik: [] };
    const bas = opNyttKort({ dag: o.dag, typ: "franvaro", text: "" }, tavlaId, klocka, genId);
    if (!bas.ok)
        return bas;
    const k = bas.andringar[0].varde;
    franvaroFalt(o, false).forEach(([namn, varde]) => { k[namn] = varde; });
    return { ok: true, fel: null, andringar: bas.andringar, fore: bas.fore, historik: [] };
}

function snabbPostFalt(o) {
    const ut = [];
    if (o.typ === "mote") {
        ut.push(["slutTid", o.slutTid === undefined ? "" : o.slutTid]);
        ut.push(["plats", o.plats === undefined ? "" : o.plats]);
    }
    if (o.typ === "franvaro")
        ut.push(["franvaroOrsak", o.franvaroOrsak === undefined ? "" : o.franvaroOrsak]);
    if (o.typ === "produktion" && o.milstolpe)
        ut.push(["milstolpe", true]);
    return ut;
}

function opSkapaSnabbPost(o, tavlaId, klocka, genId) {
    if (!o || !o.dag || !o.typ || !tavlaId)
        return { ok: false, fel: "underlag eller tavla saknas", andringar: [], fore: [], historik: [] };
    const bas = opNyttKort({ dag: o.dag, typ: o.typ, text: o.text, tid: o.tid, vem: o.vem }, tavlaId, klocka, genId);
    if (!bas.ok)
        return bas;
    const k = bas.andringar[0].varde;
    snabbPostFalt(o).forEach(([namn, varde]) => { k[namn] = varde; });
    return { ok: true, fel: null, andringar: bas.andringar, fore: bas.fore, historik: [] };
}

function opSkapaSnabbAvrop(o, foretagId, tavlaId, klocka, genId) {
    if (!o || !o.dag || !tavlaId)
        return { ok: false, fel: "underlag eller tavla saknas", andringar: [], fore: [], historik: [] };
    const rad = { slag: o.slag || "material", txt: o.text || "", leverantor: o.leverantor || "" };
    const avr = opNyttKort({ dag: o.dag, typ: "avrop", text: avropText(rad), tid: o.tid, vem: o.vem }, tavlaId, klocka, genId);
    if (!avr.ok)
        return avr;
    const kAvr = avr.andringar[0].varde;
    let lev = null;
    if (o.levDag) {
        lev = opNyttKort({ dag: o.levDag, typ: rad.slag === "ue" ? "ue" : "leverans", vem: o.vem, text: levText(rad) }, tavlaId, klocka, genId);
        if (!lev.ok)
            return lev;
    }
    if (o.slag || o.leverantor || o.levDag || foretagId) {
        kAvr.avrop = { slag: o.slag || null, txt: o.text || "", leverantor: o.leverantor || "",
            foretagId: foretagId || null, levDag: o.levDag || "",
            levKortId: lev ? lev.andringar[0].id : null };
    }
    return { ok: true, fel: null,
        andringar: avr.andringar.concat(lev ? lev.andringar : []),
        fore: avr.fore.concat(lev ? lev.fore : []),
        historik: [] };
}

function opKopieraVecka(tavla, o, klocka, genId) {
    if (!tavla || !tavla.id || !o || !o.vStart || !o.mStart || typeof o.diff !== "number")
        return { ok: false, fel: "tavla eller underlag saknas", andringar: [], fore: [], historik: [] };
    const bo = { typ: "tavla", id: tavla.id };
    const kortLista = Array.isArray(tavla.kort) ? tavla.kort : [];
    const mSlut = plus(o.mStart, 4);
    const andringar = [], fore = [];
    const bort = o.rensa
        ? kortLista.filter(k => k && k.dag >= o.mStart && k.dag <= mSlut).map(k => k.id)
        : [];
    kortLista.forEach(k => {
        if (!k || bort.indexOf(k.id) >= 0)
            return;
        (Array.isArray(k.material) ? k.material : []).forEach(m => {
            if (!m)
                return;
            const falt = {};
            ["avropKortId", "levKortId"].forEach(n => {
                if (m[n] && bort.indexOf(m[n]) >= 0) {
                    falt[n] = null;
                    fore.push({ objekt: "materialrad", id: m.id, falt: n, varde: m[n], bo: { typ: "kort", id: k.id } });
                }
            });
            if (Object.keys(falt).length)
                andringar.push({ typ: "satt", objekt: "materialrad", id: m.id, falt: falt,
                    bo: { typ: "kort", id: k.id } });
        });
    });
    (Array.isArray(tavla.hinder) ? tavla.hinder : []).forEach(h => {
        if (!h || !h.kop || typeof h.kop !== "object" || Array.isArray(h.kop))
            return;
        if (!h.kop.kortId || bort.indexOf(h.kop.kortId) < 0)
            return;
        andringar.push({ typ: "satt", objekt: "kop", id: h.id, falt: { kortId: null, forId: null } });
        ["kortId", "forId"].forEach(n => {
            if (n in h.kop)
                fore.push({ objekt: "kop", id: h.id, falt: n, varde: h.kop[n] });
            else
                fore.push({ objekt: "kop", id: h.id, falt: n, saknades: true });
        });
    });
    (Array.isArray(o.kall) ? o.kall : []).forEach(k => {
        if (!k)
            return;
        if (o.bara && k.klar)
            return;
        const ny = opNyttKort({ dag: plus(k.dag, o.diff), typ: k.typ, text: k.text, tid: k.tid, vem: k.vem }, tavla.id, klocka, genId);
        if (!ny.ok)
            return;
        andringar.push(ny.andringar[0]);
        fore.push(ny.fore[0]);
    });
    bort.forEach(id => {
        const k = kortLista.find(x => x && x.id === id) || null;
        if (!k)
            return;
        andringar.push({ typ: "taBort", objekt: "kort", id: id, bo: bo });
        fore.push({ objekt: "kort", id: id, varde: JSON.parse(JSON.stringify(k)), bo: bo });
    });
    return { ok: true, fel: null, andringar: andringar, fore: fore, bort: bort,
        historik: stamplaHistorik([{ txt: "v" + veckonr(o.vStart) + " kopierad till v" +
                    veckonr(o.mStart) }], klocka, genId) };
}

function opAndraFranvaro(kort, o, tavlaId) {
    if (!kort || !kort.id || !o || !o.dag || !tavlaId)
        return { ok: false, fel: "kort, underlag eller tavla saknas", andringar: [], fore: [], historik: [] };
    const bo = { typ: "tavla", id: tavlaId };
    const aldre = !kort.personId && !kort.personNamn;
    const falt = {}, fore = [];
    franvaroFalt(o, aldre).forEach(([namn, varde]) => {
        falt[namn] = varde;
        fore.push(namn in kort
            ? { objekt: "kort", id: kort.id, falt: namn, varde: kort[namn], bo: bo }
            : { objekt: "kort", id: kort.id, falt: namn, saknades: true, bo: bo });
    });
    return { ok: true, fel: null,
        andringar: [{ typ: "satt", objekt: "kort", id: kort.id, falt: falt, bo: bo }],
        fore: fore, historik: [] };
}

function ordningsPatch(tavla, ordnad) {
    const bo = { typ: "tavla", id: tavla.id };
    const andringar = [], fore = [];
    ordnad.forEach((k, n) => {
        andringar.push({ typ: "satt", objekt: "kort", id: k.id, falt: { ordning: (n + 1) * 10 }, bo: bo });
        fore.push("ordning" in k
            ? { objekt: "kort", id: k.id, falt: "ordning", varde: k.ordning, bo: bo }
            : { objekt: "kort", id: k.id, falt: "ordning", saknades: true, bo: bo });
    });
    return { ok: true, fel: null, andringar: andringar, fore: fore, historik: [] };
}

function opFlyttaIDag(tavla, kort, steg, dag) {
    if (!tavla || !Array.isArray(tavla.kort) || !kort || !kort.id)
        return { ok: false, fel: "tavla eller kort saknas", andringar: [], fore: [], historik: [] };
    const lista = otidsattaIDag(tavla, dag || kort.dag);
    const i = lista.indexOf(kort), j = i + steg;
    if (i < 0 || j < 0 || j >= lista.length)
        return { ok: false, fel: "flytten ligger utanför listan", andringar: [], fore: [], historik: [] };
    const ordnad = lista.slice();
    ordnad.splice(i, 1);
    ordnad.splice(j, 0, kort);
    return ordningsPatch(tavla, ordnad);
}

function opOrdnaFore(tavla, flytt, mal) {
    if (!tavla || !Array.isArray(tavla.kort) || !flytt || !flytt.id || !mal || !mal.id)
        return { ok: false, fel: "tavla, flytt eller mål saknas", andringar: [], fore: [], historik: [] };
    const otidsatta = sorteraDag(kortForDag(tavla, mal.dag)
        .filter(x => !x.virtuell && startMinut(x) === null && x.id !== flytt.id));
    const i = otidsatta.indexOf(mal);
    if (i < 0)
        return { ok: false, fel: "målet finns inte i dagens otidsatta lista",
            andringar: [], fore: [], historik: [] };
    const ordnad = otidsatta.slice();
    ordnad.splice(i, 0, flytt);
    return ordningsPatch(tavla, ordnad);
}

function opNyttKort(o, tavlaId, klocka, genId) {
    if (!o || !tavlaId)
        return { ok: false, fel: "underlag eller tavla saknas", andringar: [], fore: [], historik: [] };
    const k = { id: uid(genId), dag: o.dag, typ: o.typ, text: o.text, tid: o.tid || "", vem: o.vem || "",
        kedja: o.kedja || null, roll: o.roll || null, klar: false, orsak: null, not: o.not || "",
        skapad: nu(klocka), urspDag: o.dag, flyttar: [], klarTid: null, forutsattningar: [], beredning: null,
        material: [] };
    if (o.mid)
        k.mid = o.mid;
    return { ok: true, fel: null,
        andringar: [{ typ: "lagg", objekt: "kort", id: k.id, varde: k, bo: { typ: "tavla", id: tavlaId } }],
        fore: [{ objekt: "kort", id: k.id, varde: null, bo: { typ: "tavla", id: tavlaId } }],
        historik: [] };
}

function opDupliceraKort(kalla, val, tavlaId, klocka, genId) {
    if (!kalla || !val || !tavlaId)
        return { ok: false, fel: "underlag saknas", andringar: [], fore: [], historik: [] };
    const k = { id: uid(genId), dag: val.dag, typ: kalla.typ, text: val.text, tid: val.tid || "",
        vem: val.vem || "", kedja: null, roll: null, klar: false, orsak: null, not: kalla.not || "",
        skapad: nu(klocka), urspDag: val.dag, flyttar: [], klarTid: null, forutsattningar: [],
        beredning: null, material: [] };
    if (val.mote) {
        k.slutTid = val.slutTid;
        k.plats = val.plats;
    }
    if (val.franvaro)
        k.franvaroOrsak = val.franvaroOrsak;
    if (kalla.milstolpe && kalla.typ === "produktion")
        k.milstolpe = true;
    return { ok: true, fel: null,
        andringar: [{ typ: "lagg", objekt: "kort", id: k.id, varde: k, bo: { typ: "tavla", id: tavlaId } }],
        fore: [{ objekt: "kort", id: k.id, varde: null, bo: { typ: "tavla", id: tavlaId } }],
        historik: stamplaHistorik([{ txt: "Duplicerad: " + k.text + " " + kortDatum(kalla.dag) + " → " + kortDatum(val.dag) }], klocka, genId) };
}

function opMaterialisera(virtuell, extra, tavlaId, klocka, genId) {
    const k = virtuell;
    if (!k || !tavlaId)
        return { ok: false, fel: "virtuell post eller tavla saknas", andringar: [], fore: [], historik: [] };
    const ny = { id: uid(genId), dag: k.dag, typ: k.typ, text: k.text, tid: k.tid, slutTid: k.slutTid || "",
        plats: k.plats || "", franvaroOrsak: k.franvaroOrsak || "",
        vem: k.vem, not: k.not || "",
        kedja: null, roll: null, klar: false, orsak: null, fran: k.fran,
        skapad: nu(klocka), urspDag: k.dag, flyttar: [], klarTid: null, forutsattningar: [],
        beredning: null };
    Object.assign(ny, extra || {});
    return { ok: true, fel: null,
        andringar: [{ typ: "lagg", objekt: "kort", id: ny.id, varde: ny, bo: { typ: "tavla", id: tavlaId } }],
        fore: [{ objekt: "kort", id: ny.id, varde: null, bo: { typ: "tavla", id: tavlaId } }],
        historik: [] };
}

function opHinderFranAktivitet(aktivitet, vem, nar, klocka, genId) {
    if (!aktivitet || !aktivitet.id)
        return { ok: false, fel: "aktivitet saknas", andringar: [], fore: [], historik: [] };
    const hid = uid(genId);
    return { ok: true, fel: null,
        andringar: [
            { typ: "lagg", objekt: "hinder", id: hid, varde: {
                    id: hid, vad: aktivitet.titel, vem: vem, nar: nar, status: "oppet", skapad: nu(klocka), lostTid: null,
                    kop: { kortId: null, kedja: null, text: "Att göra · " + (aktivitet.kategori || "Övrigt"),
                        dag: aktivitet.deadline || "", forId: null, aktivitetId: aktivitet.id }
                } },
            { typ: "satt", objekt: "aktivitet", id: aktivitet.id, falt: { hinderId: hid } }
        ],
        fore: [
            { objekt: "hinder", id: hid, varde: null },
            ("hinderId" in aktivitet
                ? { objekt: "aktivitet", id: aktivitet.id, falt: "hinderId", varde: aktivitet.hinderId }
                : { objekt: "aktivitet", id: aktivitet.id, falt: "hinderId", saknades: true })
        ],
        historik: stamplaHistorik([{ txt: "Hinder från Att göra: " + aktivitet.titel }], klocka, genId) };
}

function opOverforAktivitet(aktivitet, val, tavlaId, klocka, genId) {
    if (!aktivitet || !aktivitet.id || !val || !tavlaId)
        return { ok: false, fel: "aktivitet, underlag eller tavla saknas", andringar: [], fore: [], historik: [] };
    const k = { id: uid(genId), dag: val.dag, typ: "produktion", text: val.text, tid: "", vem: val.vem || "",
        kedja: null, roll: null, klar: false, orsak: null, not: "",
        skapad: nu(klocka), urspDag: val.dag, flyttar: [], klarTid: null, forutsattningar: [], beredning: null,
        material: [] };
    k.fran_forberedelse = aktivitet.id;
    const overford = { tavlaId: tavlaId, kortId: k.id, tid: nu(klocka) };
    return { ok: true, fel: null,
        andringar: [
            { typ: "lagg", objekt: "kort", id: k.id, varde: k, bo: { typ: "tavla", id: tavlaId } },
            { typ: "satt", objekt: "aktivitet", id: aktivitet.id, falt: { overford: overford } }
        ],
        fore: [
            { objekt: "kort", id: k.id, varde: null, bo: { typ: "tavla", id: tavlaId } },
            ("overford" in aktivitet
                ? { objekt: "aktivitet", id: aktivitet.id, falt: "overford", varde: aktivitet.overford }
                : { objekt: "aktivitet", id: aktivitet.id, falt: "overford", saknades: true })
        ],
        historik: stamplaHistorik([{ txt: "Överförd från byggstartsplanen: " + k.text }], klocka, genId) };
}

function opSattNot(kort, text) {
    if (!kort || !kort.id)
        return { ok: false, fel: "kort saknas", andringar: [], fore: [], historik: [] };
    return { ok: true, fel: null,
        andringar: [{ typ: "satt", objekt: "kort", id: kort.id, falt: { not: text } }],
        fore: [{ objekt: "kort", id: kort.id, varde: JSON.parse(JSON.stringify(kort)) }],
        historik: [] };
}

function opSattBemanning(kort, behov, personer, klocka, genId) {
    if (!kort || !kort.id)
        return { ok: false, fel: "kort saknas", andringar: [], fore: [], historik: [] };
    const b = { behov: behov || [], personer: personer || [] };
    const varde = tomBemanning(b) ? null : { behov: b.behov, personer: b.personer };
    return { ok: true, fel: null,
        andringar: [{ typ: "satt", objekt: "kort", id: kort.id, falt: { bemanning: varde } }],
        fore: [{ objekt: "kort", id: kort.id, varde: JSON.parse(JSON.stringify(kort)) }],
        historik: stamplaHistorik([{ txt: "Bemanning ändrad: " + momentNamn(kort) }], klocka, genId) };
}

function opMaterialiseraBockad(virtuell, klocka, genId) {
    const k = virtuell;
    if (!k || !k.virtuell)
        return { ok: false, fel: "posten är inte virtuell", andringar: [], fore: [], historik: [] };
    const ny = { id: uid(genId), dag: k.dag, typ: k.typ, text: k.text, tid: k.tid, slutTid: k.slutTid || "", plats: k.plats || "",
        franvaroOrsak: k.franvaroOrsak || "",
        vem: k.vem, not: k.not || "",
        kedja: null, roll: null, klar: true, orsak: null, fran: k.fran,
        skapad: nu(klocka), urspDag: k.dag, flyttar: [], klarTid: nu(klocka), forutsattningar: [], beredning: null };
    return { ok: true, fel: null,
        andringar: [{ typ: "lagg", objekt: "kort", id: ny.id, varde: ny }],
        fore: [{ objekt: "kort", id: ny.id, varde: null }],
        historik: stamplaHistorik([{ txt: "Klart: " + k.text }], klocka, genId) };
}

function opTaBortForetag(foretag, klocka, genId) {
    if (!foretag || !foretag.id)
        return { ok: false, fel: "företag saknas", andringar: [], fore: [], historik: [] };
    return { ok: true, fel: null,
        andringar: [{ typ: "taBort", objekt: "foretag", id: foretag.id }],
        fore: [{ objekt: "foretag", id: foretag.id, varde: JSON.parse(JSON.stringify(foretag)) }],
        historik: stamplaHistorik([{ txt: "Företag borttaget: " + foretag.namn }], klocka, genId) };
}

function opTaBortForetagMedAnvandning(p, foretag, klocka, genId) {
    if (!p || !Array.isArray(p.tavlor) || !foretag || !foretag.id)
        return { ok: false, fel: "projekt eller företag saknas", andringar: [], fore: [], historik: [] };
    const bryt = r => {
        const ny = {};
        Object.keys(r).forEach(n => ny[n] = r[n]);
        ny.leverantor = r.leverantor || foretag.namn;
        ny.foretagId = null;
        return ny;
    };
    const andringar = [], fore = [];
    let rader = 0;
    p.tavlor.forEach(t => (t.kort || []).forEach(k => {
        const mtrl = (k.material || []).filter(r => r.foretagId === foretag.id);
        const avrop = (!(k.material && k.material.length) && k.avrop && k.avrop.foretagId === foretag.id) ? k.avrop : null;
        if (!mtrl.length && !avrop)
            return;
        rader += mtrl.length + (avrop ? 1 : 0);
        const falt = {};
        if (mtrl.length)
            falt.material = (k.material || []).map(r => r.foretagId === foretag.id ? bryt(r) : r);
        if (avrop)
            falt.avrop = bryt(k.avrop);
        andringar.push({ typ: "satt", objekt: "kort", id: k.id, falt: falt });
        fore.push({ objekt: "kort", id: k.id, varde: JSON.parse(JSON.stringify(k)) });
    }));
    if (!rader)
        return { ok: false, fel: "företaget används inte", andringar: [], fore: [], historik: [] };
    andringar.push({ typ: "taBort", objekt: "foretag", id: foretag.id });
    fore.push({ objekt: "foretag", id: foretag.id, varde: JSON.parse(JSON.stringify(foretag)) });
    return { ok: true, fel: null, andringar: andringar, fore: fore,
        historik: stamplaHistorik([{ txt: "Företag borttaget: " + foretag.namn + " (ur " + rader + " rader, namnet bevarat som text)" }], klocka, genId) };
}

function opFlyttaKort(kort, nyDag, orsak, klocka, kopia, genId) {
    if (!kort || !kort.id || !nyDag || nyDag === kort.dag)
        return { ok: false, fel: "kort eller datum saknas", andringar: [], fore: [], historik: [] };
    const fran = kort.dag, falt = { dag: nyDag, ordning: null };
    const historik = [];
    if (orsak) {
        const tidigare = nyDag < fran, n = Math.abs(arbetsdagarMellan(tidigare ? nyDag : fran, tidigare ? fran : nyDag));
        falt.orsak = orsak;
        falt.flyttar = (kort.flyttar || []).concat([{ tid: nu(klocka), fran: fran, till: nyDag, orsak: orsak,
                riktning: tidigare ? "tidigare" : "senare" }]);
        historik.push({ txt: '"' + kort.text + '" ' + (tidigare ? "tidigarelagd " : "senarelagd ") + n +
                (n === 1 ? " arbetsdag" : " arbetsdagar") + " (" + kortDatum(fran) + " → " + kortDatum(nyDag) + "). Orsak: " + orsak });
    }
    const andringar = [{ typ: "satt", objekt: "kort", id: kort.id, falt: falt }];
    const fore = [{ objekt: "kort", id: kort.id, varde: JSON.parse(JSON.stringify(kort)) }];
    if (kopia && kopia.agare && (kopia.del === "A" || kopia.del === "L")) {
        const a = kopia.agare;
        const iMaterial = kopia.radId && Array.isArray(a.material) &&
            a.material.some(m => m && m.id === kopia.radId);
        if (iMaterial) {
            const lista = a.material.map(m => {
                if (!m || m.id !== kopia.radId)
                    return m;
                const ny = {};
                Object.keys(m).forEach(n => ny[n] = m[n]);
                if (kopia.del === "L")
                    ny.levDag = nyDag;
                else
                    ny.avropDag = nyDag;
                return ny;
            });
            if (a.id === kort.id)
                falt.material = lista;
            else {
                andringar.push({ typ: "satt", objekt: "kort", id: a.id, falt: { material: lista } });
                fore.push({ objekt: "kort", id: a.id, varde: JSON.parse(JSON.stringify(a)) });
            }
        }
        else if (a.avrop) {
            const rad = a.avrop;
            if (kopia.del === "L" || ("avropDag" in rad)) {
                const ny = {};
                Object.keys(rad).forEach(n => ny[n] = rad[n]);
                if (kopia.del === "L")
                    ny.levDag = nyDag;
                else
                    ny.avropDag = nyDag;
                if (a.id === kort.id)
                    falt.avrop = ny;
                else {
                    andringar.push({ typ: "satt", objekt: "kort", id: a.id, falt: { avrop: ny } });
                    fore.push({ objekt: "kort", id: a.id, varde: JSON.parse(JSON.stringify(a)) });
                }
            }
        }
    }
    return { ok: true, fel: null, andringar: andringar, fore: fore, historik: stamplaHistorik(historik, klocka, genId) };
}

function opKonsekvenser(bar, poster, rader, val, projekt, tavla, klocka, genId) {
    if (!bar || !bar.id || !Array.isArray(poster))
        return { ok: false, fel: "underlag saknas", andringar: [], fore: [], historik: [] };
    const djup = o => JSON.parse(JSON.stringify(o));
    const andringar = [], fore = [], historik = [];
    const hist = o => { historik.push(stamplaHistorik([o], klocka, genId)[0]); };
    const barFalt = {}, foreKort = {}, foreHinder = {}, hinderSatt = {}, hinderLagg = [];
    let barRort = false, material = null, forutsattningar = null;
    poster.forEach(p => {
        const r = rader.find(x => x.kort.id === p.kortId);
        if (!r)
            return;
        const k = r.kort, fran = k.dag, till = p.till;
        if (!foreKort[k.id])
            foreKort[k.id] = djup(k);
        andringar.push({ typ: "satt", objekt: "kort", id: k.id,
            falt: { dag: till, flyttar: (k.flyttar || []).concat([{ tid: nu(klocka), fran: fran, till: till, orsak: "" }]) } });
        hist({ txt: '"' + k.text + '" flyttad med produktionen ' + kortDatum(fran) + " → " + kortDatum(till) });
        if (p.datumfalt && p.radId) {
            if (!material)
                material = (bar.material || []).map(m => djup(m));
            const rad = material.find(m => m.id === p.radId);
            if (rad)
                rad[p.datumfalt] = till;
            barRort = true;
        }
        if (!p.bekraftelse)
            return;
        const v = val[k.id] || {};
        const fid = "bek-" + (r.rad ? r.rad.id : k.id);
        if (!forutsattningar)
            forutsattningar = (bar.forutsattningar || []).map(f => djup(f));
        const f = forutsattningar.find(x => x.id === fid);
        const namn = motpart(r, projekt);
        const txt = (r.slag === "uestart" ? "Bekräfta nytt startdatum " : "Bekräfta nytt leveransdatum ") +
            kortDatum(till) + (namn ? " med " + namn : "");
        const befintligt = f && f.hinderId ? (tavla && tavla.hinder || []).find(h => h.id === f.hinderId) : null;
        if (v.bekraftat) {
            if (!f)
                return;
            f.txt = txt;
            f.status = "sakrad";
            barRort = true;
            if (befintligt && befintligt.status !== "lost") {
                if (!foreHinder[befintligt.id])
                    foreHinder[befintligt.id] = djup(befintligt);
                hinderSatt[befintligt.id] = Object.assign(hinderSatt[befintligt.id] || {}, { status: "lost", lostTid: nu(klocka) });
                hist({ txt: "Hinder löst: " + befintligt.vad });
            }
            hist({ txt: "Nytt datum bekräftat: " + txt });
            return;
        }
        if (!f) {
            const hid = uid(genId);
            forutsattningar.push({ id: fid, omrade: "bekraftelse", txt: txt, status: "saknas",
                kalla: "anvandare", hinderId: hid });
            hinderLagg.push({ id: hid, vad: txt, vem: v.vem || "", nar: v.nar || "", status: "oppet", skapad: nu(klocka),
                lostTid: null, kop: { kortId: bar.id, kedja: bar.kedja || null, text: bar.text, dag: bar.dag, forId: fid } });
            barRort = true;
        }
        else {
            f.txt = txt;
            f.status = "saknas";
            barRort = true;
            if (befintligt) {
                if (!foreHinder[befintligt.id])
                    foreHinder[befintligt.id] = djup(befintligt);
                const falt = { vad: txt, status: "oppet", lostTid: null };
                if (v.vem)
                    falt.vem = v.vem;
                if (v.nar)
                    falt.nar = v.nar;
                hinderSatt[befintligt.id] = Object.assign(hinderSatt[befintligt.id] || {}, falt);
            }
            else {
                const hid = uid(genId);
                f.hinderId = hid;
                hinderLagg.push({ id: hid, vad: txt, vem: v.vem || "", nar: v.nar || "", status: "oppet", skapad: nu(klocka),
                    lostTid: null, kop: { kortId: bar.id, kedja: bar.kedja || null, text: bar.text, dag: bar.dag, forId: fid } });
            }
        }
        hist({ txt: "Bekräftelse krävs: " + txt });
    });
    if (material)
        barFalt.material = material;
    if (forutsattningar)
        barFalt.forutsattningar = forutsattningar;
    if (barRort && Object.keys(barFalt).length) {
        andringar.unshift({ typ: "satt", objekt: "kort", id: bar.id, falt: barFalt });
        fore.push({ objekt: "kort", id: bar.id, varde: djup(bar) });
    }
    Object.keys(foreKort).forEach(id => { if (id !== bar.id)
        fore.push({ objekt: "kort", id: id, varde: foreKort[id] }); });
    Object.keys(hinderSatt).forEach(id => {
        andringar.push({ typ: "satt", objekt: "hinder", id: id, falt: hinderSatt[id] });
        fore.push({ objekt: "hinder", id: id, varde: foreHinder[id] });
    });
    hinderLagg.forEach(h => {
        andringar.push({ typ: "lagg", objekt: "hinder", id: h.id, varde: h });
        fore.push({ objekt: "hinder", id: h.id, varde: null });
    });
    if (!andringar.length)
        return { ok: false, fel: "inget att göra", andringar: [], fore: [], historik: [] };
    return { ok: true, fel: null, andringar: andringar, fore: fore, historik: stamplaHistorik(historik, klocka, genId) };
}

function opRaderaKort(kort, tavla, extraLogg, klocka, genId) {
    if (!kort || !kort.id || !tavla || !tavla.id)
        return { ok: false, fel: "kort eller tavla saknas", andringar: [], fore: [], historik: [] };
    const kortLista = Array.isArray(tavla.kort) ? tavla.kort : [];
    const andringar = [], fore = [];
    const iTavlan = kortLista.find(x => x && x.id === kort.id) || null;
    if (iTavlan) {
        andringar.push({ typ: "taBort", objekt: "kort", id: kort.id, bo: { typ: "tavla", id: tavla.id } });
        fore.push({ objekt: "kort", id: kort.id, varde: JSON.parse(JSON.stringify(iTavlan)),
            bo: { typ: "tavla", id: tavla.id } });
    }
    kortLista.forEach(k => {
        if (!k || k.id === kort.id)
            return;
        (Array.isArray(k.material) ? k.material : []).forEach(m => {
            if (!m)
                return;
            const falt = {};
            ["avropKortId", "levKortId"].forEach(n => {
                if (m[n] && m[n] === kort.id) {
                    falt[n] = null;
                    fore.push({ objekt: "materialrad", id: m.id, falt: n, varde: m[n],
                        bo: { typ: "kort", id: k.id } });
                }
            });
            if (Object.keys(falt).length)
                andringar.push({ typ: "satt", objekt: "materialrad", id: m.id, falt: falt,
                    bo: { typ: "kort", id: k.id } });
        });
    });
    (Array.isArray(tavla.hinder) ? tavla.hinder : []).forEach(h => {
        if (!h || !h.kop || typeof h.kop !== "object" || Array.isArray(h.kop))
            return;
        if (!h.kop.kortId || h.kop.kortId !== kort.id)
            return;
        andringar.push({ typ: "satt", objekt: "kop", id: h.id, falt: { kortId: null, forId: null } });
        ["kortId", "forId"].forEach(n => {
            if (n in h.kop)
                fore.push({ objekt: "kop", id: h.id, falt: n, varde: h.kop[n] });
            else
                fore.push({ objekt: "kop", id: h.id, falt: n, saknades: true });
        });
    });
    return { ok: true, fel: null, andringar: andringar, fore: fore,
        historik: stamplaHistorik([{ txt: extraLogg || ("Borttagen: " + kort.text) }], klocka, genId) };
}

function opTaBortAllt(kort, rader, tavla, klocka, genId) {
    if (!kort || !kort.id || !tavla || !tavla.id)
        return { ok: false, fel: "kort eller tavla saknas", andringar: [], fore: [], historik: [], bort: [] };
    const kortLista = Array.isArray(tavla.kort) ? tavla.kort : [];
    const bort = [kort.id];
    if (kort.kedja)
        kortLista.forEach(x => {
            if (x && x.kedja === kort.kedja && bort.indexOf(x.id) < 0)
                bort.push(x.id);
        });
    (Array.isArray(rader) ? rader : []).forEach(r => {
        if (r && r.kort && r.kort.id && bort.indexOf(r.kort.id) < 0)
            bort.push(r.kort.id);
    });
    const andringar = [], fore = [];
    bort.forEach(id => {
        const k = kortLista.find(x => x && x.id === id) || null;
        if (!k)
            return;
        andringar.push({ typ: "taBort", objekt: "kort", id: id, bo: { typ: "tavla", id: tavla.id } });
        fore.push({ objekt: "kort", id: id, varde: JSON.parse(JSON.stringify(k)),
            bo: { typ: "tavla", id: tavla.id } });
    });
    kortLista.forEach(k => {
        if (!k || bort.indexOf(k.id) >= 0)
            return;
        (Array.isArray(k.material) ? k.material : []).forEach(m => {
            if (!m)
                return;
            const falt = {};
            ["avropKortId", "levKortId"].forEach(n => {
                if (m[n] && bort.indexOf(m[n]) >= 0) {
                    falt[n] = null;
                    fore.push({ objekt: "materialrad", id: m.id, falt: n, varde: m[n], bo: { typ: "kort", id: k.id } });
                }
            });
            if (Object.keys(falt).length)
                andringar.push({ typ: "satt", objekt: "materialrad", id: m.id, falt: falt,
                    bo: { typ: "kort", id: k.id } });
        });
    });
    (Array.isArray(tavla.hinder) ? tavla.hinder : []).forEach(h => {
        if (!h || !h.kop || typeof h.kop !== "object" || Array.isArray(h.kop))
            return;
        if (!h.kop.kortId || bort.indexOf(h.kop.kortId) < 0)
            return;
        andringar.push({ typ: "satt", objekt: "kop", id: h.id, falt: { kortId: null, forId: null } });
        ["kortId", "forId"].forEach(n => {
            if (n in h.kop)
                fore.push({ objekt: "kop", id: h.id, falt: n, varde: h.kop[n] });
            else
                fore.push({ objekt: "kop", id: h.id, falt: n, saknades: true });
        });
    });
    return { ok: true, fel: null, andringar: andringar, fore: fore, bort: bort,
        historik: stamplaHistorik([{ txt: momentNamn(kort) + " borttaget tillsammans med " +
                    (bort.length - 1) + " kopplade poster" }], klocka, genId) };
}

function opBehallKopplade(kort, rader, slut, tavla, klocka, genId) {
    if (!kort || !kort.id || !tavla || !tavla.id)
        return { ok: false, fel: "kort eller tavla saknas", andringar: [], fore: [], historik: [], bort: [] };
    const kortLista = Array.isArray(tavla.kort) ? tavla.kort : [];
    const bo = { typ: "tavla", id: tavla.id };
    const andringar = [], fore = [];
    const foreSett = {};
    const foreFalt = (k, namn) => {
        const nyckel = k.id + "\u0000" + namn;
        if (foreSett[nyckel])
            return;
        foreSett[nyckel] = 1;
        if (namn in k)
            fore.push({ objekt: "kort", id: k.id, falt: namn, varde: k[namn], bo: bo });
        else
            fore.push({ objekt: "kort", id: k.id, falt: namn, saknades: true, bo: bo });
    };
    const satt = (k, falt) => {
        Object.keys(falt).forEach(n => foreFalt(k, n));
        andringar.push({ typ: "satt", objekt: "kort", id: k.id, falt: falt, bo: bo });
    };
    (Array.isArray(kort.material) ? kort.material : []).forEach(m => {
        if (!m)
            return;
        const a = kortLista.find(x => x && x.id === m.avropKortId) || null;
        const l = kortLista.find(x => x && x.id === m.levKortId) || null;
        if (a)
            satt(a, { avrop: { slag: m.slag || null, txt: m.txt || "", leverantor: m.leverantor || "",
                    foretagId: m.foretagId || null,
                    levDag: l ? l.dag : (m.levDag || ""), levKortId: l ? l.id : null },
                kedja: null, roll: null });
        if (l)
            satt(l, { kedja: null, roll: null });
    });
    (Array.isArray(rader) ? rader : []).forEach(r => {
        if (!r || r.rad || !r.kort || !r.kort.id)
            return;
        satt(r.kort, { kedja: null, roll: null });
    });
    const bort = [kort.id];
    if (slut && slut.id && bort.indexOf(slut.id) < 0)
        bort.push(slut.id);
    bort.forEach(id => {
        const k = kortLista.find(x => x && x.id === id) || null;
        if (!k)
            return;
        andringar.push({ typ: "taBort", objekt: "kort", id: id, bo: bo });
        fore.push({ objekt: "kort", id: id, varde: JSON.parse(JSON.stringify(k)), bo: bo });
    });
    kortLista.forEach(k => {
        if (!k || bort.indexOf(k.id) >= 0)
            return;
        (Array.isArray(k.material) ? k.material : []).forEach(m => {
            if (!m)
                return;
            const falt = {};
            ["avropKortId", "levKortId"].forEach(n => {
                if (m[n] && bort.indexOf(m[n]) >= 0) {
                    falt[n] = null;
                    fore.push({ objekt: "materialrad", id: m.id, falt: n, varde: m[n], bo: { typ: "kort", id: k.id } });
                }
            });
            if (Object.keys(falt).length)
                andringar.push({ typ: "satt", objekt: "materialrad", id: m.id, falt: falt,
                    bo: { typ: "kort", id: k.id } });
        });
    });
    (Array.isArray(tavla.hinder) ? tavla.hinder : []).forEach(h => {
        if (!h || !h.kop || typeof h.kop !== "object" || Array.isArray(h.kop))
            return;
        if (!h.kop.kortId || bort.indexOf(h.kop.kortId) < 0)
            return;
        andringar.push({ typ: "satt", objekt: "kop", id: h.id, falt: { kortId: null, forId: null } });
        ["kortId", "forId"].forEach(n => {
            if (n in h.kop)
                fore.push({ objekt: "kop", id: h.id, falt: n, varde: h.kop[n] });
            else
                fore.push({ objekt: "kop", id: h.id, falt: n, saknades: true });
        });
    });
    return { ok: true, fel: null, andringar: andringar, fore: fore, bort: bort,
        historik: stamplaHistorik([{ txt: momentNamn(kort) + " borttaget · " +
                    ((Array.isArray(rader) ? rader : []).length) + " kopplade poster behölls" }], klocka, genId) };
}

function opFlyttaMed(kort, delta, text, klocka, genId) {
    if (!kort || !kort.id || !delta)
        return { ok: false, fel: "kort eller delta saknas", andringar: [], fore: [], historik: [] };
    const fran = kort.dag, till = skiftaArbetsdagar(fran, delta);
    return { ok: true, fel: null,
        andringar: [{ typ: "satt", objekt: "kort", id: kort.id,
                falt: { dag: till, flyttar: (kort.flyttar || []).concat([{ tid: nu(klocka), fran: fran, till: till, orsak: "" }]) } }],
        fore: [{ objekt: "kort", id: kort.id, varde: JSON.parse(JSON.stringify(kort)) }],
        historik: stamplaHistorik([{ txt: '"' + kort.text + '" ' + text + " " + kortDatum(fran) + " → " + kortDatum(till) }], klocka, genId) };
}

function opGuideLaggUpp(o, tavlaId, klocka, genId) {
    if (!o || !tavlaId || !Array.isArray(o.kort) || !o.kort.length)
        return { ok: false, fel: "underlag eller tavla saknas", andringar: [], fore: [], historik: [] };
    const andringar = [], fore = [], skapade = [];
    for (let i = 0; i < o.kort.length; i++) {
        const p = opNyttKort(o.kort[i], tavlaId, klocka, genId);
        if (!p.ok)
            return { ok: false, fel: p.fel, andringar: [], fore: [], historik: [] };
        andringar.push(p.andringar[0]);
        fore.push(p.fore[0]);
        skapade.push(p.andringar[0].varde);
    }
    const bar = skapade.find(k => k.roll === "S" || k.roll === "P") || skapade[0];
    bar.beredning = o.beredning || null;
    if (o.plats)
        bar.plats = o.plats;
    // milstolpen sitter på momentets sista post (Klart), annars på startposten
    if (o.milstolpe)
        (skapade.find(k => k.roll === "K") || bar).milstolpe = true;
    bar.bemanning = tomBemanning(o.bemanning) ? null :
        { behov: o.bemanning.behov.slice(), personer: o.bemanning.personer.slice() };
    bar.forutsattningar = (o.grund || []).map(f => ({ id: f.id, omrade: f.omrade, txt: f.txt, status: f.status,
        kalla: f.kalla, grund: true, hinderId: null }))
        .concat((o.forval || []).map(f => ({ id: f.id, omrade: f.omrade, txt: forvalText(f), status: f.status,
        kalla: "anvandare", hinderId: null })));
    bar.material = (o.mtrl || []).map(m => {
        const a = skapade.find(k => k.roll === "A" && k.mid === m.id);
        const l = skapade.find(k => k.roll === "L" && k.mid === m.id);
        return { id: m.id, slag: m.slag || "material", txt: m.txt, leverantor: m.leverantor,
            foretagId: m.foretagId || null, avropDag: m.avropDag, levDag: m.levDag,
            avropKortId: a ? a.id : null, levKortId: l ? l.id : null };
    });
    (o.hinder || []).forEach(h => {
        const hid = uid(genId);
        const nyttH = { id: hid, vad: h.vad, vem: h.vem, nar: h.nar, status: "oppet", skapad: nu(klocka),
            lostTid: null,
            kop: { kortId: bar.id, kedja: bar.kedja, text: o.text, dag: o.start, forId: h.forId || null } };
        andringar.push({ typ: "lagg", objekt: "hinder", id: hid, varde: nyttH });
        fore.push({ objekt: "hinder", id: hid, varde: null });
        const f = bar.forutsattningar.find(x => x.id === h.forId);
        if (f)
            f.hinderId = hid;
    });
    return { ok: true, fel: null, andringar: andringar, fore: fore,
        historik: stamplaHistorik([{ txt: "Kedja upplagd: " + o.text }], klocka, genId) };
}

function opNyttForetag(namn, roller, klocka, genId) {
    const n = foretagText(namn);
    if (!n)
        return { ok: false, fel: "namn saknas", andringar: [], fore: [], historik: [] };
    const f = { id: "ft" + uid(genId), namn: n, roller: roller || [], omrade: "", kontakt: "",
        telefon: "", epost: "", aktiv: true, kommentar: "" };
    return { ok: true, fel: null,
        andringar: [{ typ: "lagg", objekt: "foretag", id: f.id, varde: f }],
        fore: [{ objekt: "foretag", id: f.id, varde: null }],
        historik: [] };
}

function opAndraForetag(foretag, falt, klocka, genId) {
    if (!foretag || !foretag.id || !falt || typeof falt !== "object")
        return { ok: false, fel: "företag eller fält saknas", andringar: [], fore: [], historik: [] };
    const namn = Object.keys(falt);
    if (!namn.length)
        return { ok: false, fel: "inga fält", andringar: [], fore: [], historik: [] };
    const nya = {};
    for (const n of namn) {
        if (n === "id")
            return { ok: false, fel: "id kan inte ändras", andringar: [], fore: [], historik: [] };
        nya[n] = n === "namn" ? foretagText(falt.namn) : falt[n];
    }
    if (Object.prototype.hasOwnProperty.call(nya, "namn") && !nya.namn)
        return { ok: false, fel: "namn saknas", andringar: [], fore: [], historik: [] };
    const fore = namn.map(n => Object.prototype.hasOwnProperty.call(foretag, n)
        ? { objekt: "foretag", id: foretag.id, falt: n, varde: foretag[n] }
        : { objekt: "foretag", id: foretag.id, falt: n, saknades: true });
    return { ok: true, fel: null,
        andringar: [{ typ: "satt", objekt: "foretag", id: foretag.id, falt: nya }],
        fore: fore,
        historik: Object.prototype.hasOwnProperty.call(nya, "namn")
            ? stamplaHistorik([{ txt: "Företag bytte namn: " + foretag.namn + " → " + nya.namn }], klocka, genId)
            : [] };
}

function registerFore(typ, objekt, falt) {
    return Object.keys(falt).map(n => Object.prototype.hasOwnProperty.call(objekt, n)
        ? { objekt: typ, id: objekt.id, falt: n, varde: objekt[n] }
        : { objekt: typ, id: objekt.id, falt: n, saknades: true });
}

function opNyaKategorier(namn, klocka, genId) {
    const lista = Array.isArray(namn) ? namn : [namn];
    if (!lista.length)
        return { ok: false, fel: "inga namn", andringar: [], fore: [], historik: [] };
    if (lista.some(n => typeof n !== "string" || !n))
        return { ok: false, fel: "namn saknas", andringar: [], fore: [], historik: [] };
    const andringar = [], fore = [];
    for (const n of lista) {
        const c = { id: "rk" + uid(genId), namn: n };
        andringar.push({ typ: "lagg", objekt: "kategori", id: c.id, varde: c });
        fore.push({ objekt: "kategori", id: c.id, varde: null });
    }
    return { ok: true, fel: null, andringar: andringar, fore: fore, historik: [] };
}

function opNyPerson(namn, kategoriId, klocka, genId) {
    if (typeof namn !== "string" || !namn)
        return { ok: false, fel: "namn saknas", andringar: [], fore: [], historik: [] };
    const x = { id: "rp" + uid(genId), namn: namn, kategoriId: kategoriId, aktiv: true };
    return { ok: true, fel: null,
        andringar: [{ typ: "lagg", objekt: "person", id: x.id, varde: x }],
        fore: [{ objekt: "person", id: x.id, varde: null }],
        historik: [] };
}

function opAndraKategori(kategori, falt, klocka, genId) {
    if (!kategori || !kategori.id || !falt || typeof falt !== "object")
        return { ok: false, fel: "kategori eller fält saknas", andringar: [], fore: [], historik: [] };
    const namn = Object.keys(falt);
    if (!namn.length)
        return { ok: false, fel: "inga fält", andringar: [], fore: [], historik: [] };
    if (namn.indexOf("id") >= 0)
        return { ok: false, fel: "id kan inte ändras", andringar: [], fore: [], historik: [] };
    return { ok: true, fel: null,
        andringar: [{ typ: "satt", objekt: "kategori", id: kategori.id, falt: falt }],
        fore: registerFore("kategori", kategori, falt),
        historik: [] };
}

function opAndraPerson(person, falt, klocka, genId) {
    if (!person || !person.id || !falt || typeof falt !== "object")
        return { ok: false, fel: "person eller fält saknas", andringar: [], fore: [], historik: [] };
    const namn = Object.keys(falt);
    if (!namn.length)
        return { ok: false, fel: "inga fält", andringar: [], fore: [], historik: [] };
    if (namn.indexOf("id") >= 0)
        return { ok: false, fel: "id kan inte ändras", andringar: [], fore: [], historik: [] };
    return { ok: true, fel: null,
        andringar: [{ typ: "satt", objekt: "person", id: person.id, falt: falt }],
        fore: registerFore("person", person, falt),
        historik: [] };
}
