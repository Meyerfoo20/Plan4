/* ======================================================================
   Tavlan: rendering, kort, hinderlista och historik
   ====================================================================== */

/* ---------- rendering ---------- */

function rita() {
    const pk = document.getElementById("pagaendeKnapp");
    if (pk) {
        const pa = !!T().visaPagaende;
        pk.classList.toggle("aktiv", pa);
        pk.textContent = pa ? "Pågående ✓" : "Pågående";
    }
    const kc = document.getElementById("kedjechip");
    if (kc) {
        if (valdKedja && !T().kort.some(k => k.kedja === valdKedja))
            valdKedja = null;
        kc.classList.toggle("dold", !valdKedja);
    }
    const t = T();
    document.getElementById("projektnamnText").textContent = state.projekt || "Projekt";
    ritaHindermark();
    document.getElementById("tavlanamn").value = t.namn;
    const vs = ritStart();
    document.getElementById("spann").textContent = "v" + veckonr(vs) + "–v" + veckonr(plus(vs, 21)) + " · " + kortDatum(vs) + "–" + kortDatum(plus(vs, 25));
    const chip = document.getElementById("vychip");
    chip.classList.toggle("dold", vyOffset === 0);
    chip.firstChild.textContent = vyOffset === 0 ? "" : "Du bläddrar — planen börjar v" + veckonr(tavlaStart()) + " ";
    ritaFlikar();
    const g = document.getElementById("rutnat");
    g.innerHTML = "";
    const horn = document.createElement("div");
    horn.className = "hornruta";
    g.appendChild(horn);
    DAGNAMN.forEach(n => { const c = document.createElement("div"); c.className = "dagrubrik"; c.textContent = n; g.appendChild(c); });
    const antal = antalVeckor();
    document.body.classList.toggle("v1", document.body.classList.contains("visning") && antal === 1);
    document.body.classList.toggle("v2", document.body.classList.contains("visning") && antal === 2);
    document.body.classList.toggle("v4", document.body.classList.contains("visning") && antal === 4);
    document.querySelectorAll("#veckoval button").forEach(b => b.classList.toggle("vald", +b.dataset.v === antal));
    for (let v = 0; v < antal; v++) {
        const vStart = plus(vs, v * 7);
        const pi = veckoIndex(vStart, T());
        const vh = document.createElement("div");
        vh.className = "vhuvud" + (pi > 1 || pi < 0 ? " forberedelse" : "") + (pi === 1 ? " granslinje" : "");
        vh.innerHTML = '<span class="vnr">v' + veckonr(vStart) + '</span>' +
            '<span class="vdatum">' + kortDatum(vStart) + "–" + kortDatum(plus(vStart, 4)) + '</span>';
        const kop = document.createElement("button");
        kop.className = "kopieravecka";
        kop.textContent = "⧉";
        kop.title = "Kopiera veckan";
        kop.addEventListener("click", () => kopieraVecka(v));
        vh.appendChild(kop);
        g.appendChild(vh);
        for (let d = 0; d < 5; d++) {
            const iso = plus(vs, v * 7 + d);
            const ruta = document.createElement("div");
            ruta.className = "ruta" + (pi === 1 ? " granslinje" : "") + (iso === IDAG ? " idag" : "");
            ruta.dataset.dag = iso;
            const nr = document.createElement("span");
            nr.className = "dagnr";
            const vanster = document.createElement("span");
            vanster.className = "dagvanster";
            if (iso <= IDAG)
                vanster.appendChild(lageKnapp(iso));
            nr.appendChild(vanster);
            const dnr = document.createElement("span");
            dnr.textContent = kortDatum(iso);
            nr.appendChild(dnr);
            ruta.appendChild(nr);
            sorteraDag(virtuella(iso, T()).concat(kortForDag(t, iso), attGoraForDag(t, iso, projektForTavla(t))))
                .forEach(k => ruta.appendChild(kortEl(k)));
            const pag = pagaendeForDag(t, iso);
            if (pag.length) {
                const pd = document.createElement("div");
                pd.innerHTML = pagaendeHtml(pag);
                const pel = pd.firstChild;
                pel.querySelectorAll("[data-pk]").forEach(r => r.addEventListener("click", e => {
                    e.stopPropagation();
                    if (document.body.classList.contains("visning"))
                        return dagsvy(iso);
                    const k2 = t.kort.find(x => x.id === r.dataset.pk);
                    if (k2)
                        visaKort(k2);
                }));
                ruta.appendChild(pel);
            }
            const p = document.createElement("button");
            p.className = "plus";
            p.type = "button";
            p.textContent = "+ Post";
            p.title = "Ny post " + dagEtikett(iso);
            p.addEventListener("click", () => snabbPost(iso));
            ruta.appendChild(p);
            ruta.addEventListener("click", () => { if (document.body.classList.contains("visning"))
                dagsvy(iso); });
            ruta.addEventListener("dragover", e => { e.preventDefault(); ruta.classList.add("dragover"); });
            ruta.addEventListener("dragleave", () => ruta.classList.remove("dragover"));
            ruta.addEventListener("drop", e => {
                e.preventDefault();
                ruta.classList.remove("dragover");
                const id = e.dataTransfer.getData("text/plain");
                const d = T().kort.find(x => x.id === id);
                // släppt på samma dag (under korten): lägg kortet sist
                if (d && d.dag === iso)
                    return ordnaVid(d, null, true);
                flyttaKort(id, iso);
            });
            g.appendChild(ruta);
        }
    }
    document.getElementById("tomtavla").classList.toggle("dold", t.kort.length > 0 || t.aterkom.length > 0);
    ritaHinder();
    ritaHistorik();
    filtrera();
    ritaLogga();
    ritaVader();
    ritaVarningar();
    hamtaVader();
}

function lageKnapp(iso) {
    const dl = (T().dagslage || {})[iso];
    const def = dl ? lageDef(dl.lage) : null;
    const b = document.createElement("button");
    b.className = "lagemark" + (def ? " satt " + dl.lage : "");
    b.type = "button";
    b.textContent = def ? def.ikon : "○";
    b.title = def ? (def.txt + (dl.kommentar ? " — " + dl.kommentar : "")) + " · klicka för att ändra" : "Dagens avstämning";
    b.addEventListener("click", e => { e.stopPropagation(); lageDialog(iso); });
    return b;
}

function lageDialog(iso) {
    const t = T();
    const dl = (t.dagslage || {})[iso] || null;
    const kropp = '<p class="fraga">Hur upplevde ni att planen höll?</p>' +
        '<p class="hjalp">Er egen bedömning vid eftermiddagspulsen. Den räknas inte in i planpålitligheten eller någon annan siffra.</p>' +
        '<div class="lageval" id="lageval">' +
        LAGEN.map(l => '<button type="button" data-l="' + l.id + '"' + (dl && dl.lage === l.id ? ' class="vald"' : "") + '>' +
            '<span class="ikon">' + l.ikon + '</span><span>' + l.txt + '</span></button>').join("") + '</div>' +
        '<div class="falt" style="margin-top:14px;margin-bottom:0"><label for="lgKom">Kommentar (frivillig)</label>' +
        '<input class="f" id="lgKom" value="' + esc(dl ? dl.kommentar || "" : "") + '" placeholder="Betongleverans sen och armering del 3 ej klar"></div>';
    let valt = dl ? dl.lage : null;
    function spar() {
        if (!valt)
            return;
        t.dagslage = t.dagslage || {};
        t.dagslage[iso] = { lage: valt, kommentar: document.getElementById("lgKom").value.trim() };
        logg("Avstämning " + dagEtikett(iso) + ": " + lageDef(valt).txt.toLowerCase());
        stangModal();
        spara();
        rita();
    }
    const knappar = [];
    if (dl)
        knappar.push({ txt: "Ta bort", vanster: true, fara: true, fn: () => {
                delete t.dagslage[iso];
                stangModal();
                spara();
                rita();
            } });
    knappar.push({ txt: "Avbryt", fn: stangModal });
    knappar.push({ txt: "Spara", primar: true, fn: spar });
    modal("Dagens avstämning", dagEtikett(iso), kropp, knappar);
    document.querySelectorAll("#lageval button").forEach(b => b.addEventListener("click", () => {
        valt = b.dataset.l;
        document.querySelectorAll("#lageval button").forEach(x => x.classList.toggle("vald", x === b));
        spar();
    }));
    const kom = document.getElementById("lgKom");
    if (kom)
        kom.addEventListener("keydown", e => { if (e.key === "Enter")
            spar(); });
}

function flyttaIDag(k, steg, dag) {
    const t = T();
    const patch = opFlyttaIDag(t, k, steg, dag);
    if (!patch.ok)
        return false;
    if (!appliceraPatch(patch, { tavla: t, projekt: state }))
        return false;
    spara();
    rita();
    return true;
}

// Flyttar ett kort inom dagen: före eller efter ett annat kort, eller sist (mal = null).
function ordnaVid(flytt, mal, efter) {
    const t = T();
    const lista = sorteraDag(kortForDag(t, flytt.dag).filter(x => !x.virtuell && startMinut(x) === null && x.id !== flytt.id));
    let i = mal ? lista.indexOf(mal) : lista.length;
    if (i < 0)
        return;
    if (mal && efter)
        i++;
    const ordnad = lista.slice();
    ordnad.splice(i, 0, flytt);
    const patch = ordningsPatch(t, ordnad);
    if (!patch || !patch.ok || !appliceraPatch(patch, { tavla: t, projekt: state }))
        return;
    spara();
    rita();
}

function ordnaFore(flytt, mal) {
    const t = T();
    const patch = opOrdnaFore(t, flytt, mal);
    if (!patch.ok)
        return;
    if (!appliceraPatch(patch, { tavla: t, projekt: state }))
        return;
    spara();
    rita();
}

function framtidsKontroll(dag, fortsatt) {
    if (!dag || dag <= IDAG)
        return fortsatt();
    modal("Markera som klar?", "", '<p class="fraga">Aktiviteten är planerad till ' + kortDatum(dag) + ' men markeras som klar redan ' + kortDatum(IDAG) + '.</p>' +
        '<p class="hjalp">Vill du fortsätta?</p>', [{ txt: "Markera klar", fn: () => { stangModal(); fortsatt(); } },
        { txt: "Avbryt", primar: true, fn: stangModal }]);
}

const REGISTERTYPER = ["person", "kategori", "foretag", "aktivitet"];

function regLista(ctx, objekt) {
    const p = ctx && ctx.projekt;
    if (!p)
        return null;
    if (objekt === "foretag")
        return Array.isArray(p.foretag) ? p.foretag : null;
    if (objekt === "aktivitet") {
        const f = p.forberedelse;
        return f && Array.isArray(f.aktiviteter) ? f.aktiviteter : null;
    }
    if (objekt === "person")
        return p.resurser && Array.isArray(p.resurser.personer) ? p.resurser.personer : null;
    if (objekt === "kategori")
        return p.resurser && Array.isArray(p.resurser.kategorier) ? p.resurser.kategorier : null;
    return null;
}

function regBoFel(a) { return REGISTERTYPER.indexOf(a.objekt) >= 0 && ("bo" in a); }

function angraPatch(fore, ctx) {
    if (!Array.isArray(fore))
        return false;
    const listaFor = objekt => {
        if (REGISTERTYPER.indexOf(objekt) >= 0)
            return regLista(ctx, objekt);
        if (objekt === "hinder")
            return ctx.tavla && Array.isArray(ctx.tavla.hinder) ? ctx.tavla.hinder : null;
        return null;
    };
    const kortlistor = () => {
        if (ctx.projekt && Array.isArray(ctx.projekt.tavlor))
            return ctx.projekt.tavlor.map(t => t.kort).filter(Array.isArray);
        return ctx.tavla && Array.isArray(ctx.tavla.kort) ? [ctx.tavla.kort] : [];
    };
    const hittaKort = id => {
        for (const l of kortlistor()) {
            const k = l.find(x => x.id === id);
            if (k)
                return { lista: l, objekt: k };
        }
        return null;
    };
    const falt = p => (typeof p.falt === "string" && p.falt ? p.falt : null);
    const tavlaMed = id => (ctx.projekt && Array.isArray(ctx.projekt.tavlor)
        ? ctx.projekt.tavlor.find(x => x && x.id === id) : null)
        || ((ctx.tavla && ctx.tavla.id === id) ? ctx.tavla : null);
    const boAv = p => {
        if (!("bo" in p))
            return undefined;
        const b = p.bo;
        if (!b || typeof b !== "object" || b.typ !== "tavla" || typeof b.id !== "string" || !b.id)
            return null;
        if (p.objekt !== "kort" && p.objekt !== "hinder")
            return null;
        if (falt(p))
            return null;
        const tv = tavlaMed(b.id);
        if (!tv)
            return null;
        const lista = p.objekt === "kort" ? tv.kort : tv.hinder;
        return Array.isArray(lista) ? lista : null;
    };
    const kortMedId = id => {
        const tavlor = ctx.projekt && Array.isArray(ctx.projekt.tavlor) ? ctx.projekt.tavlor
            : (ctx.tavla ? [ctx.tavla] : []);
        for (const t of tavlor) {
            const k = (t.kort || []).find(x => x.id === id);
            if (k)
                return k;
        }
        return null;
    };
    const kortBo = p => {
        const b = p && p.bo;
        if (!b || typeof b !== "object" || Array.isArray(b))
            return null;
        if (b.typ !== "kort" || typeof b.id !== "string" || !b.id)
            return null;
        const k = kortMedId(b.id);
        if (!k || !Array.isArray(k.forutsattningar))
            return null;
        return k;
    };
    const kortFaltIBo = p => {
        const b = p && p.bo;
        if (!b || typeof b !== "object" || Array.isArray(b))
            return null;
        if (b.typ !== "tavla" || typeof b.id !== "string" || !b.id)
            return null;
        const tv = tavlaMed(b.id);
        if (!tv || !Array.isArray(tv.kort))
            return null;
        const traffar = tv.kort.filter(x => x && x.id === p.id);
        return traffar.length === 1 ? traffar[0] : null;
    };
    const materialradBo = p => {
        const b = p && p.bo;
        if (!b || typeof b !== "object" || Array.isArray(b))
            return null;
        if (b.typ !== "kort" || typeof b.id !== "string" || !b.id)
            return null;
        const lista = ctx.tavla && Array.isArray(ctx.tavla.kort) ? ctx.tavla.kort : null;
        if (!lista)
            return null;
        const traffar = lista.filter(k => k && k.id === b.id);
        if (traffar.length !== 1)
            return null;
        const k = traffar[0];
        if (!Array.isArray(k.material))
            return null;
        return k;
    };
    const materialradI = (k, id) => {
        const traffar = k.material.filter(m => m && m.id === id);
        return traffar.length === 1 ? traffar[0] : null;
    };
    const steg = [];
    for (const post of fore) {
        if (!post || !post.id || !post.objekt)
            return false;
        if (falt(post) && post.varde === undefined && post.saknades !== true)
            return false;
        if (falt(post) && post.saknades === true && "varde" in post)
            return false;
        if (post.objekt === "kop") {
            const h = (ctx.tavla && ctx.tavla.hinder || []).find(x => x && x.id === post.id) || null;
            if (!h)
                return false;
            const kp = (h.kop && typeof h.kop === "object" && !Array.isArray(h.kop)) ? h.kop : null;
            if (!kp)
                return false;
            if (!falt(post))
                return false;
            steg.push({ typ: "falt", objekt: kp, falt: falt(post),
                saknades: post.saknades === true, varde: post.varde });
            continue;
        }
        if (post.objekt === "beredning") {
            const k = kortMedId(post.id);
            if (!k)
                return false;
            const b2 = (k.beredning && typeof k.beredning === "object") ? k.beredning : null;
            if (falt(post)) {
                if (!b2)
                    return false;
                steg.push({ typ: "falt", objekt: b2, falt: falt(post),
                    saknades: post.saknades === true, varde: post.varde });
                continue;
            }
            return false;
        }
        if (post.objekt === "forutsattning") {
            const k = kortBo(post);
            if (!k)
                return false;
            const f = k.forutsattningar.find(x => x && x.id === post.id) || null;
            if (falt(post)) {
                if (!f)
                    return false;
                steg.push({ typ: "falt", objekt: f, falt: falt(post),
                    saknades: post.saknades === true, varde: post.varde });
            }
            else if (post.varde === null) {
                if (!f)
                    return false;
                steg.push({ typ: "bort", lista: k.forutsattningar, objekt: f });
            }
            else if (f)
                steg.push({ typ: "fyll", objekt: f, varde: post.varde });
            else
                steg.push({ typ: "in", lista: k.forutsattningar, varde: post.varde });
            continue;
        }
        if (post.objekt === "materialrad") {
            const k = materialradBo(post);
            if (!k)
                return false;
            if (!falt(post))
                return false;
            const m = materialradI(k, post.id);
            if (!m)
                return false;
            steg.push({ typ: "falt", objekt: m, falt: falt(post),
                saknades: post.saknades === true, varde: post.varde });
            continue;
        }
        if (post.objekt === "kort") {
            if (falt(post) && ("bo" in post)) {
                const k = kortFaltIBo(post);
                if (!k)
                    return false;
                steg.push({ typ: "falt", objekt: k, falt: falt(post),
                    saknades: post.saknades === true, varde: post.varde });
                continue;
            }
            const boLista = boAv(post);
            if (boLista === null)
                return false;
            const traff = hittaKort(post.id);
            if (boLista) {
                if (post.varde === null) {
                    if (!traff)
                        return false;
                    steg.push({ typ: "bort", lista: traff.lista, objekt: traff.objekt });
                }
                else if (!traff) {
                    if (boLista.some(x => x && x.id === post.id))
                        return false;
                    steg.push({ typ: "in", lista: boLista, varde: post.varde });
                }
                else if (traff.lista === boLista) {
                    steg.push({ typ: "fyll", objekt: traff.objekt, varde: post.varde });
                }
                else {
                    if (boLista.some(x => x && x.id === post.id))
                        return false;
                    steg.push({ typ: "flytta", fran: traff.lista, till: boLista, objekt: traff.objekt });
                    steg.push({ typ: "fyll", objekt: traff.objekt, varde: post.varde });
                }
                continue;
            }
            if (falt(post)) {
                if (!traff)
                    return false;
                steg.push({ typ: "falt", objekt: traff.objekt, falt: falt(post),
                    saknades: post.saknades === true, varde: post.varde });
                continue;
            }
            if (post.varde === null) {
                if (!traff)
                    return false;
                steg.push({ typ: "bort", lista: traff.lista, objekt: traff.objekt });
            }
            else if (traff) {
                steg.push({ typ: "fyll", objekt: traff.objekt, varde: post.varde });
            }
            else {
                return false;
            }
            continue;
        }
        if (post.objekt === "tavla") {
            const tv = (ctx.projekt && Array.isArray(ctx.projekt.tavlor)
                ? ctx.projekt.tavlor.find(x => x.id === post.id) : null)
                || ((ctx.tavla && ctx.tavla.id === post.id) ? ctx.tavla : null);
            if (!tv)
                return false;
            if (!falt(post))
                return false;
            steg.push({ typ: "falt", objekt: tv, falt: falt(post),
                saknades: post.saknades === true, varde: post.varde });
            continue;
        }
        const boLista2 = boAv(post);
        if (boLista2 === null)
            return false;
        if (boLista2) {
            const objekt = boLista2.find(x => x && x.id === post.id) || null;
            if (post.varde === null) {
                if (!objekt)
                    return false;
                steg.push({ typ: "bort", lista: boLista2, objekt: objekt });
            }
            else if (objekt)
                steg.push({ typ: "fyll", objekt: objekt, varde: post.varde });
            else
                steg.push({ typ: "in", lista: boLista2, varde: post.varde });
            continue;
        }
        const lista = listaFor(post.objekt);
        if (!lista)
            return false;
        const objekt = lista.find(x => x.id === post.id) || null;
        if (falt(post)) {
            if (!objekt)
                return false;
            steg.push({ typ: "falt", objekt: objekt, falt: falt(post),
                saknades: post.saknades === true, varde: post.varde });
            continue;
        }
        if (post.varde === null) {
            if (!objekt)
                return false;
            steg.push({ typ: "bort", lista: lista, objekt: objekt });
        }
        else if (objekt)
            steg.push({ typ: "fyll", objekt: objekt, varde: post.varde });
        else
            steg.push({ typ: "in", lista: lista, varde: post.varde });
    }
    const helobjekt = steg.filter(s => s.typ !== "falt"), faltSteg = steg.filter(s => s.typ === "falt");
    helobjekt.forEach(s => {
        if (s.typ === "flytta") {
            const i = s.fran.indexOf(s.objekt);
            if (i >= 0)
                s.fran.splice(i, 1);
            s.till.push(s.objekt);
        }
        else if (s.typ === "fyll") {
            Object.keys(s.objekt).forEach(n => delete s.objekt[n]);
            Object.assign(s.objekt, JSON.parse(JSON.stringify(s.varde)));
        }
        else if (s.typ === "bort") {
            const i = s.lista.indexOf(s.objekt);
            if (i >= 0)
                s.lista.splice(i, 1);
        }
        else
            s.lista.push(JSON.parse(JSON.stringify(s.varde)));
    });
    faltSteg.forEach(s => {
        if (s.saknades)
            delete s.objekt[s.falt];
        else
            s.objekt[s.falt] = JSON.parse(JSON.stringify(s.varde));
    });
    return true;
}

function appliceraPatch(patch, ctx) {
    if (!patch || patch.ok !== true)
        return false;
    const kortMedId = id => {
        const tavlor = ctx.projekt && Array.isArray(ctx.projekt.tavlor) ? ctx.projekt.tavlor
            : (ctx.tavla ? [ctx.tavla] : []);
        for (const t of tavlor) {
            const k = (t.kort || []).find(x => x.id === id);
            if (k)
                return k;
        }
        return null;
    };
    const kortBo = p => {
        const b = p && p.bo;
        if (!b || typeof b !== "object" || Array.isArray(b))
            return null;
        if (b.typ !== "kort" || typeof b.id !== "string" || !b.id)
            return null;
        const k = kortMedId(b.id);
        if (!k || !Array.isArray(k.forutsattningar))
            return null;
        return k;
    };
    const materialradBo = p => {
        const b = p && p.bo;
        if (!b || typeof b !== "object" || Array.isArray(b))
            return null;
        if (b.typ !== "kort" || typeof b.id !== "string" || !b.id)
            return null;
        const lista = ctx.tavla && Array.isArray(ctx.tavla.kort) ? ctx.tavla.kort : null;
        if (!lista)
            return null;
        const traffar = lista.filter(k => k && k.id === b.id);
        if (traffar.length !== 1)
            return null;
        const k = traffar[0];
        if (!Array.isArray(k.material))
            return null;
        return k;
    };
    const materialradI = (k, id) => {
        const traffar = k.material.filter(m => m && m.id === id);
        return traffar.length === 1 ? traffar[0] : null;
    };
    const kortIBo = p => {
        if (!("bo" in p))
            return undefined;
        const b = p.bo;
        if (!b || typeof b !== "object" || Array.isArray(b))
            return null;
        if (b.typ !== "tavla" || typeof b.id !== "string" || !b.id)
            return null;
        const tv = tavlorI().find(x => x && x.id === b.id);
        if (!tv || !Array.isArray(tv.kort))
            return null;
        const traffar = tv.kort.filter(x => x && x.id === p.id);
        return traffar.length === 1 ? traffar[0] : null;
    };
    const hitta = a => {
        if (a.typ !== "satt")
            return null;
        if (a.objekt === "beredning") {
            const k = kortMedId(a.id);
            if (!k)
                return null;
            return (k.beredning && typeof k.beredning === "object") ? k.beredning : null;
        }
        if (a.objekt === "kop") {
            const h = (ctx.tavla && ctx.tavla.hinder || []).find(x => x && x.id === a.id) || null;
            if (!h)
                return null;
            return (h.kop && typeof h.kop === "object" && !Array.isArray(h.kop)) ? h.kop : null;
        }
        if (a.objekt === "forutsattning") {
            const k = kortBo(a);
            if (!k)
                return null;
            return k.forutsattningar.find(x => x && x.id === a.id) || null;
        }
        if (a.objekt === "materialrad") {
            const k = materialradBo(a);
            if (!k)
                return null;
            return materialradI(k, a.id);
        }
        if (a.objekt === "kort") {
            const viaBo = kortIBo(a);
            if (viaBo !== undefined)
                return viaBo;
            const tavlor = ctx.projekt && Array.isArray(ctx.projekt.tavlor) ? ctx.projekt.tavlor : (ctx.tavla ? [ctx.tavla] : []);
            for (const t of tavlor) {
                const k = (t.kort || []).find(x => x.id === a.id);
                if (k)
                    return k;
            }
            return null;
        }
        if (REGISTERTYPER.indexOf(a.objekt) >= 0) {
            if (regBoFel(a))
                return null;
            const l = regLista(ctx, a.objekt);
            return l ? l.find(x => x && x.id === a.id) || null : null;
        }
        if (a.objekt === "hinder")
            return (ctx.tavla && ctx.tavla.hinder || []).find(x => x.id === a.id) || null;
        return null;
    };
    const lista = a => {
        if (a.objekt === "forutsattning") {
            const k = kortBo(a);
            return k ? k.forutsattningar : null;
        }
        if (REGISTERTYPER.indexOf(a.objekt) >= 0)
            return regBoFel(a) ? null : regLista(ctx, a.objekt);
        if (!ctx.tavla)
            return null;
        if (a.objekt === "kort")
            return Array.isArray(ctx.tavla.kort) ? ctx.tavla.kort : null;
        if (a.objekt === "hinder")
            return Array.isArray(ctx.tavla.hinder) ? ctx.tavla.hinder : null;
        return null;
    };
    const bortLista = a => regBoFel(a) ? null : regLista(ctx, a.objekt);
    const tavlorI = () => (ctx.projekt && Array.isArray(ctx.projekt.tavlor)) ? ctx.projekt.tavlor
        : (ctx.tavla ? [ctx.tavla] : []);
    const boLista = a => {
        if (a.objekt === "forutsattning")
            return undefined;
        if (!("bo" in a))
            return undefined;
        const b = a.bo;
        if (!b || typeof b !== "object" || Array.isArray(b))
            return null;
        if (b.typ !== "tavla" || typeof b.id !== "string" || !b.id)
            return null;
        if (a.objekt !== "kort")
            return null;
        const tv = tavlorI().find(x => x && x.id === b.id);
        if (!tv || !Array.isArray(tv.kort))
            return null;
        return tv.kort;
    };
    const hinderBortIBo = a => {
        if (a.objekt !== "hinder")
            return undefined;
        if (!("bo" in a))
            return null;
        const b = a.bo;
        if (!b || typeof b !== "object" || Array.isArray(b))
            return null;
        if (b.typ !== "tavla" || typeof b.id !== "string" || !b.id)
            return null;
        const tv = tavlorI().find(x => x && x.id === b.id);
        if (!tv || !Array.isArray(tv.hinder))
            return null;
        const traffar = tv.hinder.filter(x => x && x.id === a.id);
        if (traffar.length !== 1)
            return null;
        return tv.hinder;
    };
    const satt = [], lagg = [], bort = [];
    const tasBort = new Set();
    for (const a of patch.andringar || []) {
        if (a && a.typ === "taBort" && a.objekt === "kort" && a.id && ("bo" in a))
            tasBort.add(a.id);
    }
    for (const a of patch.andringar || []) {
        if (a.typ === "satt") {
            const obj = hitta(a);
            if (!obj || !a.falt || typeof a.falt !== "object")
                return false;
            satt.push([obj, a.falt]);
        }
        else if (a.typ === "lagg") {
            const bl = boLista(a);
            if (bl === null)
                return false;
            const mal = bl === undefined ? lista(a) : bl;
            if (!mal)
                return false;
            if (!a.id || !a.varde || typeof a.varde !== "object")
                return false;
            if (a.varde.id !== a.id)
                return false;
            if (mal.some(x => x.id === a.id))
                return false;
            if (bl !== undefined && !tasBort.has(a.id) &&
                tavlorI().some(t => (t.kort || []).some(x => x.id === a.id)))
                return false;
            if (lagg.some(x => x[0] === mal && x[1].id === a.id))
                return false;
            if (bl !== undefined && lagg.some(x => x[1].id === a.id))
                return false;
            lagg.push([mal, a.varde]);
        }
        else if (a.typ === "taBort") {
            const hb = hinderBortIBo(a);
            if (hb === null)
                return false;
            let mal;
            if (hb !== undefined)
                mal = hb;
            else {
                const bl = boLista(a);
                if (bl === null)
                    return false;
                mal = bl === undefined ? bortLista(a) : bl;
            }
            if (!mal)
                return false;
            if (!a.id)
                return false;
            if (!mal.some(x => x.id === a.id))
                return false;
            if (bort.some(x => x[0] === mal && x[1] === a.id))
                return false;
            bort.push([mal, a.id]);
        }
        else
            return false;
    }
    satt.forEach(([obj, falt]) => {
        Object.keys(falt).forEach(n => {
            if (n === "id")
                return;
            obj[n] = falt[n];
        });
    });
    lagg.forEach(([mal, varde]) => mal.push(varde));
    bort.forEach(([mal, id]) => { const i = mal.findIndex(x => x.id === id); if (i >= 0)
        mal.splice(i, 1); });
    return true;
}

function bockaKort(k, efter) {
    const ctx = { tavla: T(), projekt: state };
    const klart = () => { if (typeof efter === "function")
        efter(); spara(); rita(); };
    if (k.attgora) {
        const a = fAktiviteter(state).find(x => x.id === k.attgora);
        if (!a)
            return;
        const p = opBockaAttGora(a);
        if (!appliceraPatch(p, ctx))
            return;
        p.historik.forEach(h => logg(h));
        klart();
        return;
    }
    const gor = () => {
        const p = k.virtuell ? opMaterialiseraBockad(k) : opBockaKort(k);
        if (!appliceraPatch(p, ctx))
            return;
        p.historik.forEach(h => logg(h));
        klart();
    };
    if (!k.klar)
        return framtidsKontroll(k.dag, gor);
    gor();
}

function kortEl(k) {
    const el = document.createElement("div");
    el.className = "kort t-" + k.typ + (k.attgora ? " attgora" : "") + (k.klar ? " klar" : "") + (k.milstolpe && k.typ === "produktion" ? " milstolpe" : "") + (k.virtuell ? " virtuell" : "") +
        (valdKedja && k.kedja === valdKedja ? " kedja-vald" : "");
    el.draggable = !k.virtuell && !(k.typ === "franvaro" && k.tillDag && k.tillDag > k.dag);
    el.dataset.id = k.id;
    const bock = document.createElement("button");
    bock.className = "bock";
    bock.type = "button";
    bock.title = "Markera klart";
    bock.textContent = k.klar ? "✓" : "";
    bock.addEventListener("click", e => { e.stopPropagation(); bockaKort(k); });
    el.appendChild(bock);
    if (k.virtuell || k.fran) {
        const a = document.createElement("span");
        a.className = "aterkomsymbol";
        a.textContent = "↻";
        a.title = "Återkommande varje " + DAGNAMN[(iso2d(k.dag).getDay() + 6) % 7].toLowerCase();
        el.appendChild(a);
    }
    if (k.kedja) {
        const m = document.createElement("span");
        m.className = "kedjemark";
        m.textContent = k.roll || "·";
        m.title = "Del av en kedja — klicka för att visa hela";
        el.appendChild(m);
    }
    const txt = document.createElement("span");
    txt.className = "txt";
    const rub = k.typ === "franvaro" ? null : kortRubrik(k, kortText(k, T(), projektForTavla(T())));
    if (rub) {
        // överst: typen (och klockslag för möten), sedan namnet som rubrik
        const ov = document.createElement("span");
        ov.className = "kortetikett";
        ov.textContent = rub.etikett + (k.typ === "mote" && k.tid ? " · " + tidText(k) : "");
        if (k.milstolpe && k.typ === "produktion") {
            const ms = document.createElement("span");
            ms.className = "milstolpe-mark";
            ms.title = "Milstolpe";
            ms.innerHTML = '<span class="milstolpe-ik" aria-hidden="true"></span>Milstolpe';
            ov.appendChild(ms);
        }
        if (rub.gorIdag) {
            const gi = document.createElement("span");
            gi.className = "gorIdag";
            gi.textContent = "Gör idag";
            ov.appendChild(gi);
        }
        txt.appendChild(ov);
    }
    if (k.typ === "franvaro" && franvaroNy(k)) {
        txt.appendChild(document.createTextNode(franvaroTitel(state, k)));
        const fr = document.createElement("span");
        fr.className = "franvarounder";
        fr.textContent = franvaroUnder(state, k);
        txt.appendChild(fr);
    }
    else {
        if (k.typ === "franvaro") {
            const fr = document.createElement("span");
            fr.className = "franvarorad";
            fr.textContent = "Frånvaro · " + (k.franvaroOrsak || "Annat");
            txt.appendChild(fr);
        }
        const ti = document.createElement("span");
        ti.className = "korttitel";
        ti.textContent = rub ? rub.titel : kortText(k, T(), projektForTavla(T()));
        txt.appendChild(ti);
        if (rub && rub.under) {
            const un = document.createElement("span");
            un.className = "kortunder";
            un.textContent = rub.under;
            txt.appendChild(un);
        }
    }
    // Plats / del visas på alla kort i momentet (avrop, leverans, start och klart).
    const plats = k.typ === "franvaro" ? "" : kortPlats(k, T()), del = k.typ === "franvaro" ? "" : kortDel(k, T());
    if (del) {
        const pl = document.createElement("span");
        pl.className = "platsrad";
        pl.textContent = del;
        pl.title = "Plats / del: " + plats;
        txt.appendChild(pl);
    }
    if (k.typ === "produktion" && !k.virtuell && !tomBemanning(k.bemanning)) {
        const bm = document.createElement("span");
        bm.className = "bemrad2";
        bm.textContent = "👷 " + bemanningsText(state, k);
        txt.appendChild(bm);
    }
    const meta = [];
    if (k.tid && k.typ !== "mote" && !(k.typ === "franvaro" && franvaroNy(k)))
        meta.push(tidText(k));
    if (k.vem && !(k.typ === "franvaro" && franvaroNy(k)))
        meta.push(k.vem);
    if (k.orsak)
        meta.push("orsak: " + k.orsak);
    if (meta.length) {
        const m = document.createElement("span");
        m.className = "meta";
        m.textContent = meta.join(" · ");
        txt.appendChild(m);
    }
    if (k.roll === "S" && !k.virtuell) {
        const slut = parKort(k, "K", T());
        if (slut && !inomTavlan(slut.dag)) {
            const u = document.createElement("span");
            u.className = "momentref utanfor";
            u.textContent = "Klart " + kortDatum(slut.dag) + " · utanför aktuell plan";
            u.title = "Slutposten ligger v" + veckonr(slut.dag) + " och syns när planen rullas fram";
            txt.appendChild(u);
        }
    }
    const moment = k.virtuell ? null : momentFor(k, T());
    if (moment) {
        const mm = document.createElement("span");
        mm.className = "momentref";
        mm.textContent = "→ " + moment;
        mm.title = "Hör till " + moment;
        txt.appendChild(mm);
    }
    else if (!k.virtuell && k.typ === "avrop") {
        const fr = document.createElement("span");
        fr.className = "momentref fristaende";
        fr.textContent = "fristående";
        fr.title = "Avropet hör inte till något produktionsmoment";
        txt.appendChild(fr);
    }
    el.appendChild(txt);
    el.addEventListener("dragstart", e => { e.dataTransfer.setData("text/plain", k.id); el.classList.add("dragging"); });
    if (!k.virtuell && startMinut(k) === null) {
        // Övre halvan av kortet = lägg före, nedre halvan = lägg efter.
        const nedre = e => { const r = el.getBoundingClientRect(); return e.clientY > r.top + r.height / 2; };
        el.addEventListener("dragover", e => {
            e.preventDefault();
            const efter = nedre(e);
            el.classList.toggle("ordna", !efter);
            el.classList.toggle("ordna-efter", efter);
        });
        el.addEventListener("dragleave", () => el.classList.remove("ordna", "ordna-efter"));
        el.addEventListener("drop", e => {
            el.classList.remove("ordna", "ordna-efter");
            const d = T().kort.find(x => x.id === e.dataTransfer.getData("text/plain"));
            if (!d || d.id === k.id || d.dag !== k.dag)
                return;
            e.preventDefault();
            e.stopPropagation();
            if (startMinut(d) !== null)
                return;
            ordnaVid(d, k, nedre(e));
        });
    }
    el.addEventListener("dragend", () => el.classList.remove("dragging"));
    if (k.beredning && k.beredning.kravs) {
        const st = k.beredning.status || "behovs";
        const ab = document.createElement("span");
        ab.className = "abmark " + (st === "utford" ? "utford" : st === "planerad" ? "planerad" : "saknas");
        ab.textContent = st === "utford" ? "✓ AB" : st === "planerad" ? "AB planerad" : "AB saknas";
        ab.title = "Arbetsberedning: " + ABTEXT[st];
        el.appendChild(ab);
    }
    if (!k.virtuell && k.flyttar && k.flyttar.length) {
        const fl = document.createElement("span");
        fl.className = "flyttmark";
        fl.textContent = "Flyttad";
        const sen = k.flyttar[k.flyttar.length - 1];
        fl.title = "Senast flyttad " + kortDatum(sen.fran) + " → " + kortDatum(sen.till);
        // Ligger i etikettraden överst på kortet, precis som "Gör idag".
        const etikett = txt.querySelector(".kortetikett");
        if (etikett)
            etikett.appendChild(fl);
        else
            el.appendChild(fl);
    }
    if (k.not) {
        const d = document.createElement("span");
        d.className = "notprick";
        el.appendChild(d);
    }
    el.addEventListener("click", e => {
        if (document.body.classList.contains("visning")) {
            e.stopPropagation();
            return dagsvy(k.dag);
        }
        visaKort(k);
    });
    el.addEventListener("dblclick", e => { e.stopPropagation(); if (!k.virtuell)
        redigeraKort(k); });
    el.title = k.virtuell ? "Återkommande post — klicka för att öppna" : "Klicka: öppna · dra: flytta";
    return el;
}

function materialisera(k, extra) {
    const t = T();
    const patch = opMaterialisera(k, extra, t.id, null, null);
    if (!appliceraPatch(patch, { tavla: t, projekt: state }))
        return null;
    const id = patch.andringar[0].id;
    return t.kort.find(x => x.id === id) || null;
}

function filtrera() {
    TYPER.forEach(t => {
        const pa = document.getElementById("v-" + t).checked;
        document.querySelectorAll(".kort.t-" + t).forEach(el => el.classList.toggle("dold", !pa));
    });
}

function ritaFlikar() {
    const f = document.getElementById("flikar");
    f.innerHTML = "";
    state.tavlor.forEach(t => {
        const b = document.createElement("button");
        b.className = "flik" + (t.id === state.aktiv ? " aktiv" : "");
        b.textContent = t.namn;
        b.addEventListener("click", () => { state.aktiv = t.id; valdKedja = null; vyOffset = 0; spara(); rita(); });
        f.appendChild(b);
    });
    const p = document.createElement("button");
    p.className = "flik plus";
    p.textContent = "+ Ny tavla";
    p.title = "Skapa en ny tavla i projektet, t.ex. för ett annat delområde";
    p.addEventListener("click", nyTavlaDialog);
    f.appendChild(p);
}

let visaLosta = false;

function ritaHinder() {
    const t = T(), ul = document.getElementById("hinderlista");
    ul.innerHTML = "";
    const gammal = ul.parentNode.querySelector(".visalosta");
    if (gammal)
        gammal.remove();
    const oppna = oppnaHinder(t), losta = t.hinder.filter(h => h.status === "lost");
    document.getElementById("hinderAntal").textContent = oppna.length + " / 10";
    document.getElementById("hinderVarn").classList.toggle("dold", oppna.length <= 10);
    const forsenade = oppna.filter(h => forfallen(h.nar, IDAG)).length;
    const ofullst = oppna.filter(h => !h.vem || !h.nar).length;
    const topp = document.getElementById("hindertopp");
    topp.innerHTML = !oppna.length
        ? '<span>Vad som saknas för att aktiviteterna ska gå att köra.</span>'
        : (forsenade ? '<span class="larm">' + forsenade + ' försenade</span>' : '<span>Inget försenat</span>') +
            (ofullst ? '<span class="larm">· ' + ofullst + " utan namn eller datum</span>" : "");
    if (!oppna.length) {
        ul.innerHTML = '<li class="tomrad">Inga öppna hinder. Det som saknas för att en aktivitet ska gå att köra skrivs upp här — alltid ett namn, alltid ett datum.</li>';
    }
    const lista = oppna.concat(visaLosta ? losta : []);
    const sorterat = lista.slice().sort((a, b) => {
        const la = a.status === "lost" ? 1 : 0, lb = b.status === "lost" ? 1 : 0;
        if (la !== lb)
            return la - lb;
        const da = /^\d{4}-/.test(a.nar || "") ? a.nar : "9999";
        const db = /^\d{4}-/.test(b.nar || "") ? b.nar : "9999";
        return da < db ? -1 : da > db ? 1 : 0;
    });
    sorterat.forEach(h => {
        const lost = h.status === "lost";
        const li = document.createElement("li");
        li.className = (lost ? "lost " : (forfallen(h.nar, IDAG) ? "forsenat " : "")) + "klick";
        const los = document.createElement("button");
        los.className = "h-los" + (lost ? " angra" : "");
        los.textContent = lost ? "↺" : "✓";
        los.title = lost ? "Öppna igen" : "Markera löst — sparas för uppföljningen";
        los.addEventListener("click", e => {
            e.stopPropagation();
            sattHinderStatus(h, !lost);
            logg(lost ? "Hinder öppnat igen: " + h.vad : "Hinder löst: " + h.vad);
            spara();
            rita();
        });
        li.appendChild(los);
        const kropp = document.createElement("div");
        kropp.className = "h-kropp";
        const txt = document.createElement("div");
        txt.className = "h-txt";
        txt.textContent = h.vad;
        kropp.appendChild(txt);
        const meta = document.createElement("div");
        meta.className = "h-meta";
        meta.innerHTML = '<span class="' + (h.vem ? "" : "saknas") + '">' + esc(h.vem || "vem?") + '</span>' +
            '<span class="' + (h.nar ? (forfallen(h.nar, IDAG) ? "forfallen" : "") : "saknas") + '">' +
            esc(narText(h.nar) || "när?") + (forfallen(h.nar, IDAG) ? " · försenat" : "") + '</span>';
        kropp.appendChild(meta);
        if (h.kop && h.kop.text) {
            const kop = document.createElement("button");
            kop.className = "h-kop";
            kop.textContent = "↳ " + h.kop.text + (h.kop.dag ? " · " + kortDatum(h.kop.dag) : "");
            kop.title = "Visa aktiviteten på tavlan";
            kop.addEventListener("click", e => { e.stopPropagation(); visaKoppling(h); });
            kropp.appendChild(kop);
        }
        li.appendChild(kropp);
        if (lost && h.lostTid) {
            const l = document.createElement("div");
            l.className = "h-meta";
            const d = new Date(h.lostTid);
            l.textContent = "Löst " + d.getDate() + "/" + (d.getMonth() + 1);
            kropp.appendChild(l);
        }
        li.addEventListener("click", () => hinderDialog(h.kop || null, h));
        ul.appendChild(li);
    });
    if (losta.length) {
        const kn = document.createElement("button");
        kn.className = "visalosta";
        kn.textContent = (visaLosta ? "Dölj lösta hinder" : "Visa lösta hinder") + " (" + losta.length + ")";
        kn.addEventListener("click", () => { visaLosta = !visaLosta; ritaHinder(); });
        ul.parentNode.insertBefore(kn, ul.nextSibling);
    }
}

function visaKoppling(h) {
    const t = T();
    if (h.kop && h.kop.aktivitetId) {
        const akt = fAktiviteter(state).find(x => x.id === h.kop.aktivitetId);
        if (akt)
            return oppnaStart(akt.id);
    }
    if (h.kop && h.kop.kortId) {
        const kort = t.kort.find(k => k.id === h.kop.kortId);
        if (kort)
            return visaKort(kort);
    }
    if (h.kop && h.kop.kedja && t.kort.some(k => k.kedja === h.kop.kedja)) {
        valdKedja = h.kop.kedja;
        rita();
        status("Kedjan markerad på tavlan");
        return;
    }
    const träff = t.kort.find(k => k.text === h.kop.text || (h.kop.text && k.text.indexOf(h.kop.text) >= 0));
    if (träff)
        visaKort(träff);
    else
        status("Aktiviteten finns inte kvar på tavlan");
}

function hinderDialog(kop, befintlig) {
    const h = befintlig || {};
    const kropp = (kop && kop.text ? '<div class="notis gron" style="margin-top:0">Hör till <b>' + esc(kop.text) + '</b>' + (kop.dag ? " · " + dagEtikett(kop.dag) : "") + '</div>' : "") +
        '<div class="falt"><label for="hdVad">Vad är hindret?</label><input class="f" id="hdVad" value="' + esc(h.vad || "") + '"></div>' +
        '<div class="tva"><div class="falt"><label for="hdVem">Vem löser det?</label>' +
        '<input class="f" id="hdVem" value="' + esc(h.vem || "") + '" placeholder="Namn — aldrig \'vi\'"></div>' +
        '<div class="falt"><label for="hdNar">Senast när?</label>' +
        '<input class="f" id="hdNar" type="date" value="' + (/^\d{4}-/.test(h.nar || "") ? h.nar : "") + '"></div></div>';
    const knappar = [];
    if (befintlig)
        knappar.push({ txt: "Ta bort helt", vanster: true, fara: true, fn: () => {
                const t = T();
                const patch = opTaBortHinder(h, t, state, null, null);
                if (!appliceraPatch(patch, { tavla: t, projekt: state }))
                    return;
                patch.historik.forEach(x => logg(x));
                stangModal();
                spara();
                rita();
            } });
    knappar.push({ txt: "Avbryt", fn: stangModal });
    knappar.push({ txt: befintlig ? "Spara" : "Lägg till", primar: true, fn: () => {
            const vad = document.getElementById("hdVad").value.trim();
            if (!vad)
                return document.getElementById("hdVad").focus();
            const vem = document.getElementById("hdVem").value.trim();
            const nar = document.getElementById("hdNar").value;
            const t = T();
            const patch = befintlig ? opAndraHinder(h, vad, vem, nar)
                : opNyttHinder(vad, vem, nar, kop, null, null);
            if (!appliceraPatch(patch, { tavla: t, projekt: state }))
                return;
            stangModal();
            spara();
            rita();
        } });
    modal(befintlig ? "Hinder" : "Nytt hinder", "", kropp, knappar);
}

function ritaHistorik() {
    const t = T(), ul = document.getElementById("historik");
    ul.innerHTML = "";
    document.getElementById("histAntal").textContent = t.historik.length ? t.historik.length + " händelser" : "";
    if (!t.historik.length) {
        ul.innerHTML = '<li class="tomrad">Ingen historik än. Flyttade aktiviteter och deras orsaksord hamnar här.</li>';
    }
    else {
        t.historik.slice(0, 40).forEach(h => {
            const li = document.createElement("li");
            const d = new Date(h.tid);
            li.innerHTML = '<b>' + d.getDate() + "/" + (d.getMonth() + 1) + '</b> ' + esc(h.txt);
            ul.appendChild(li);
        });
    }
    const rakn = {};
    t.kort.forEach(k => {
        if (k.flyttar && k.flyttar.length)
            k.flyttar.forEach(f => { const o = orsakGrupp(f.orsak); if (o)
                rakn[o] = (rakn[o] || 0) + 1; });
        else if (k.orsak) {
            const o = orsakGrupp(k.orsak);
            rakn[o] = (rakn[o] || 0) + 1;
        }
    });
    const ol = document.getElementById("ordlista");
    const ord = Object.keys(rakn);
    ol.innerHTML = ord.length
        ? ord.sort((a, b) => rakn[b] - rakn[a]).map(o => '<span class="ord' + (rakn[o] >= 3 ? " larm" : "") + '">' + esc(o) + " " + rakn[o] + '</span>').join("")
            + (ord.some(o => rakn[o] >= 3) ? '<span class="ord larm">Samma ord tre gånger = systemfel</span>' : "")
        : '<span class="ord">Orsaksord räknas här</span>';
}

// Plats / del för ett kort: kortets egen, annars momentets (startposten i kedjan).
function kortPlats(k, t) {
    if (k.plats)
        return k.plats;
    if (!k.kedja || !t)
        return "";
    const bar = t.kort.find(x => x.kedja === k.kedja && (x.roll === "S" || x.roll === "P"));
    return bar && bar.plats || "";
}

// Delen ett kort hör till: ur Plats / del, annars ur momentets namn (t.ex. "Gjutning del 1:3").
function kortDel(k, t) {
    const ur = delText(kortPlats(k, t));
    if (ur)
        return ur;
    const bar = k.kedja && t ? t.kort.find(x => x.kedja === k.kedja && (x.roll === "S" || x.roll === "P")) : null;
    return delText(bar ? bar.text : k.text);
}

// Öppna hinder i hela projektet (alla tavlor).
function projektetsHinder(p) {
    const ut = [];
    (p && p.tavlor || []).forEach(t => oppnaHinder(t).forEach(h => ut.push({ h, t })));
    return ut;
}

// Varningstecken bredvid projektnamnet när projektet har öppna hinder.
function ritaHindermark() {
    const el = document.getElementById("projektHinder");
    if (!el)
        return;
    const lista = projektetsHinder(state);
    const sena = lista.filter(x => forfallen(x.h.nar, IDAG)).length;
    el.classList.toggle("dold", !lista.length);
    el.classList.toggle("sen", sena > 0);
    el.title = lista.length + (lista.length === 1 ? " öppet hinder" : " öppna hinder") + (sena ? ", varav " + sena + " försenade" : "");
}

// Delar upp korttexten i en liten typetikett och själva namnet.
// "Avrop · Optimera · gör idag" → etikett "Avrop", namn "Optimera", Gör idag-märke.
const KORT_ETIKETT = { A: "Avrop", L: "Leverans", S: "Start", K: "Klart", P: "Produktion" };
const TYP_ETIKETT = { mote: "Möte", produktion: "Produktion", avrop: "Avrop", leverans: "Leverans", ue: "UE", ovrigt: "Övrigt", franvaro: "Frånvaro" };
function kortRubrik(k, text) {
    let titel = text || "", gorIdag = false;
    if (/ · gör idag$/i.test(titel)) {
        gorIdag = true;
        titel = titel.replace(/ · gör idag$/i, "");
    }
    const etikett = KORT_ETIKETT[k.roll] || (k.attgora ? "Att göra" : TYP_ETIKETT[k.typ] || "");
    const bort = ["Avrop · ", "Leverans · ", "Att göra · ", "Möte · "];
    if (k.roll === "S" || k.roll === "P") bort.push("Start ");
    if (k.roll === "K") bort.push("Klart ");
    bort.forEach(p => { if (titel.indexOf(p) === 0) titel = titel.slice(p.length); });
    if (k.roll === "K")
        titel = titel.replace(/\s+(klart|färdigt)$/i, "");
    // avrop och leveranser: leverantören på en egen rad under det som levereras
    let under = "";
    const delar = titel.split(" · ");
    if ((k.typ === "avrop" || k.typ === "leverans" || k.typ === "ue") && delar.length > 1) {
        under = delar.pop();
        titel = delar.join(" · ");
    }
    return { etikett, titel: titel.trim() || text, under: under.trim(), gorIdag };
}
