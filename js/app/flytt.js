/* ======================================================================
   Flytt av poster, konsekvenskontroll och dialogramen
   ====================================================================== */

/* ---------- flytta ---------- */

function flyttaKort(id, nyDag) {
    const t = T(), k = t.kort.find(x => x.id === id);
    if (!k || k.dag === nyDag)
        return;
    if (kraverOrsak(k, nyDag))
        return fragaOrsak(k, nyDag);
    utfor(k, nyDag, null);
}

let angraTimer = null;
let angraFore = null;

function angraForeKlar(txt, fore, tavla, projekt) {
    const samma = angraFore && angraFore.timer === angraTimer &&
        angraFore.tavla === tavla.id && angraFore.projekt === projekt.id;
    const samlad = samma ? angraFore.fore.slice() : [];
    const containerDel = p => (p.bo && typeof p.bo === "object" && !Array.isArray(p.bo) &&
        typeof p.bo.typ === "string" && typeof p.bo.id === "string") ? p.bo.typ + ":" + p.bo.id : "";
    const adress = p => p.objekt + "\u0000" +
        (p.objekt === "forutsattning" || p.objekt === "materialrad" || p.objekt === "kort"
            ? containerDel(p) : "") + "\u0000" +
        p.id + "\u0000" + (typeof p.falt === "string" && p.falt ? p.falt : "*");
    (fore || []).forEach(post => {
        if (!samlad.some(x => adress(x) === adress(post)))
            samlad.push(post);
    });
    const visad = samma ? angraFore.txt : txt;
    const rad = document.getElementById("angrarad");
    document.getElementById("angraText").textContent = visad;
    rad.classList.remove("dold");
    clearTimeout(angraTimer);
    angraTimer = setTimeout(angraForeAvbryt, 15000);
    angraFore = { txt: visad, fore: samlad, tavla: tavla.id, projekt: projekt.id, timer: angraTimer };
}

function angraForeAvbryt() {
    angraFore = null;
    clearTimeout(angraTimer);
    const rad = document.getElementById("angrarad");
    if (rad)
        rad.classList.add("dold");
}

function angraForeFlytt() {
    if (!angraFore)
        return;
    const p = plan4.projekt.find(x => x.id === angraFore.projekt);
    const t = p ? p.tavlor.find(x => x.id === angraFore.tavla) : null;
    if (!t) {
        angraForeAvbryt();
        return status("Flytten kan inte ångras längre");
    }
    if (!angraPatch(angraFore.fore, { tavla: t, projekt: p })) {
        angraForeAvbryt();
        return status("Flytten kan inte ångras längre");
    }
    logg2(t, "Flytt ångrad: " + angraFore.txt);
    angraForeAvbryt();
    spara();
    rita();
    status("Flytten ångrad");
}

function utforPatch(k, nyDag, orsak, foreKort) {
    const fran = k.dag, t = T(), p = state;
    const lank = lankadRad(t, k);
    const agare = lank ? t.kort.find(x => (x.material || []).indexOf(lank.rad) >= 0 || x.avrop === lank.rad) : null;
    const patch = opFlyttaKort(k, nyDag, orsak, null, lank && agare ? { agare: agare, del: lank.del, radId: lank.rad && lank.rad.id } : null);
    if (foreKort) {
        const post = patch.fore.find(f => f.objekt === "kort" && f.id === k.id);
        if (post)
            post.varde = foreKort;
    }
    const foreSkippa = k.fran ? JSON.parse(JSON.stringify(t.skippa)) : null;
    if (!appliceraPatch(patch, { tavla: t, projekt: p }))
        return;
    if (k.fran && t.skippa.indexOf(k.fran + "|" + fran) < 0)
        t.skippa.push(k.fran + "|" + fran);
    patch.historik.forEach(h => logg(h));
    stangModal();
    spara();
    rita();
    const fonsterFore = k.fran
        ? patch.fore.concat([{ objekt: "tavla", id: t.id, falt: "skippa", varde: foreSkippa }])
        : patch.fore;
    angraForeKlar(k.text + " flyttad " + kortDatum(fran) + " → " + kortDatum(nyDag), fonsterFore, t, p);
    efterFlytt(k, fran, nyDag);
}

function pilotMoment(k) {
    return (k.roll === "P" || k.roll === "S" || k.roll === "K") && !k.fran && !k.attgora && !k.virtuell;
}

function pilotKedjadPost(k) {
    return (k.roll === "A" || k.roll === "L") && !!k.kedja && !k.fran && !k.attgora && !k.virtuell;
}

function pilotSeriePost(k) {
    return !!k.fran && !k.roll && !k.kedja && !k.attgora && !k.virtuell;
}

function pilotFlytt(k) {
    if (pilotMoment(k) || pilotKedjadPost(k) || pilotSeriePost(k))
        return true;
    return !k.roll && !k.kedja && !k.fran && !k.attgora && !k.virtuell;
}

function utfor(k, nyDag, orsak, foreKort) {
    if (!pilotFlytt(k))
        return;
    return utforPatch(k, nyDag, orsak, foreKort);
}

function efterFlytt(k, fran, till) {
    const delta = arbetsdagarMellan(fran, till);
    if (k.roll === "S" || k.roll === "P") {
        const slut = k.roll === "S" ? parKort(k, "K", T()) : null;
        const sedan = () => konsekvensDialog(k, delta);
        if (slut && iso2d(till) > iso2d(slut.dag))
            return dialogStartEfterSlut(k, slut, delta, sedan);
        if (slut && delta > 0)
            return dialogHelaMomentet(k, slut, delta, sedan);
        return sedan();
    }
    if (k.roll === "K") {
        const start = parKort(k, "S", T());
        if (start && iso2d(till) < iso2d(start.dag))
            return dialogSlutForeStart(k, start, delta);
    }
}

function dialogHelaMomentet(start, slut, delta, sedan) {
    const nyttSlut = skiftaArbetsdagar(slut.dag, delta);
    const kropp = '<p class="fraga">Du flyttar starten ' + arbDagOrd(delta) + ' framåt.</p>' +
        '<p class="hjalp">Slutet ligger idag ' + dagEtikett(slut.dag) + '. Flyttas hela momentet blir nytt slutdatum <b>' +
        dagEtikett(nyttSlut) + '</b>' + (inomTavlan(nyttSlut) ? "" : " · utanför aktuell plan") +
        '. Materialets avrop och leveranser flyttas inte.</p>';
    modal("Flerdagarsmoment", start.text, kropp, [
        { txt: "Flytta endast starten", fn: () => { stangModal(); if (sedan)
                sedan(); } },
        { txt: "Flytta hela momentet", primar: true, fn: () => {
                flyttaMedVal(slut, delta, "slutdatum flyttat med momentet");
                stangModal();
                if (sedan)
                    sedan();
            } }
    ]);
}

function dialogStartEfterSlut(start, slut, delta, sedan) {
    const nyttSlut = skiftaArbetsdagar(slut.dag, delta);
    const kropp = '<div class="notis rod" style="margin-top:0"><b>Startdatumet hamnar efter planerat slutdatum.</b><br>' +
        'Starten ligger ' + dagEtikett(start.dag) + ' och slutet ' + dagEtikett(slut.dag) + '.</div>' +
        '<p class="hjalp">Flytta hela momentet ' + arbDagOrd(delta) + ' framåt — nytt slutdatum blir <b>' +
        dagEtikett(nyttSlut) + '</b>' + (inomTavlan(nyttSlut) ? "" : " · utanför aktuell plan") +
        ' — eller stäng och sätt datumen själv.</p>';
    modal("Kontrollera datumen", start.text, kropp, [
        { txt: "Ändra datumen manuellt", fn: () => { stangModal(); if (sedan)
                sedan(); } },
        { txt: "Flytta hela momentet", primar: true, fn: () => {
                flyttaMedVal(slut, delta, "slutdatum flyttat med momentet");
                stangModal();
                if (sedan)
                    sedan();
            } }
    ]);
}

function kopplade(bar, tavla) {
    const t = tavla || T(), ut = [], sedda = {};
    (bar.material || []).forEach(m => {
        const a = t.kort.find(x => x.id === m.avropKortId);
        const l = t.kort.find(x => x.id === m.levKortId);
        if (a) {
            ut.push({ kort: a, rad: m, slag: "avrop" });
            sedda[a.id] = 1;
        }
        if (l) {
            ut.push({ kort: l, rad: m, slag: m.slag === "ue" ? "uestart" : "leverans" });
            sedda[l.id] = 1;
        }
    });
    if (bar.kedja)
        t.kort.forEach(x => {
            if (sedda[x.id] || x.id === bar.id || x.kedja !== bar.kedja)
                return;
            if (x.roll === "A")
                ut.push({ kort: x, rad: null, slag: "avrop" });
            else if (x.roll === "L")
                ut.push({ kort: x, rad: null, slag: "leverans" });
        });
    ut.sort((a, b) => a.kort.dag < b.kort.dag ? -1 : 1);
    return ut;
}

function konsekvensDialog(bar, delta) {
    if (!delta)
        return;
    const rader = kopplade(bar);
    if (!rader.length)
        return;
    const val = {};
    rader.forEach(r => { val[r.kort.id] = { flytta: false, bekraftat: null, vem: "", nar: "" }; });
    const nyttDatum = r => skiftaArbetsdagar(r.kort.dag, delta);
    const riktning = (delta > 0 ? "+" : "−") + arbDagOrd(delta);
    const kropp = '<p class="hjalp" style="margin-top:0">Produktionen har flyttats ' + riktning +
        '. Behöver något av följande planeras om? Ingenting flyttas om du inte väljer det.</p>' +
        '<div id="kRader">' + rader.map(r => {
        const nytt = nyttDatum(r);
        if (r.kort.klar) {
            return '<div class="krad klar"><div class="ktopp"><span class="kbock">✓</span>' +
                '<span class="knamn">' + esc(radRubrik(r) + " " + kortDatum(r.kort.dag)) + '</span></div>' +
                '<div class="khist">' + esc(kortText(r.kort, T(), projektForTavla(T()))) + ' · redan utfört, behålls</div></div>';
        }
        return '<div class="krad" data-k="' + r.kort.id + '">' +
            '<div class="ktopp"><span class="knamn">' + esc(kortText(r.kort, T(), projektForTavla(T()))) + '</span>' +
            '<span class="knar">' + esc(radRubrik(r) + " " + kortDatum(r.kort.dag)) + '</span></div>' +
            '<div class="lage kval">' +
            '<button type="button" data-f="0" class="vald">Behåll ' + kortDatum(r.kort.dag) + '</button>' +
            '<button type="button" data-f="1">Flytta → ' + kortDatum(nytt) + (inomTavlan(nytt) ? "" : " · utanför tavlan") + '</button>' +
            '</div>' +
            (behoverBekraftelse(r) ? '<div class="kbekraft">' +
                '<div class="gfraga" style="font-size:13px;margin-bottom:6px">' +
                (r.slag === "uestart" ? "Är det nya startdatumet bekräftat" : "Är det nya leveransdatumet bekräftat") +
                (motpart(r, state) ? " med " + esc(motpart(r, state)) : "") + '?</div>' +
                '<div class="lage kbsvar">' +
                '<button type="button" data-b="ja">Ja</button>' +
                '<button type="button" data-b="nej">Nej – behöver bekräftas</button>' +
                '</div>' +
                '<div class="kbfalt"><input class="f" data-f="vem" placeholder="Vem ansvarar för bekräftelsen?">' +
                '<input class="f" data-f="nar" type="date" title="Senast när"></div>' +
                '</div>' : "") +
            '</div>';
    }).join("") + '</div><div id="kVarn"></div>';
    modal("Produktionen har flyttats — kontrollera kopplade aktiviteter", bar.text + " · " + riktning, kropp, [
        { txt: "Behåll allt", fn: stangModal },
        { txt: "Genomför", primar: true, fn: genomfor }
    ]);
    document.querySelectorAll("#kRader .krad[data-k]").forEach(rad => {
        const r = rader.find(x => x.kort.id === rad.dataset.k), v = val[rad.dataset.k];
        rad.querySelectorAll(".kval button").forEach(b => b.addEventListener("click", () => {
            rad.querySelectorAll(".kval button").forEach(x => x.classList.toggle("vald", x === b));
            v.flytta = b.dataset.f === "1";
            rad.classList.toggle("flyttas", v.flytta);
            varna();
        }));
        rad.querySelectorAll(".kbsvar button").forEach(b => b.addEventListener("click", () => {
            rad.querySelectorAll(".kbsvar button").forEach(x => x.classList.toggle("vald", x === b));
            v.bekraftat = b.dataset.b === "ja";
            rad.classList.toggle("obekraftad", v.bekraftat === false);
            varna();
        }));
    });
    function las() {
        document.querySelectorAll("#kRader .krad[data-k]").forEach(rad => {
            const v = val[rad.dataset.k];
            const vem = rad.querySelector('[data-f="vem"]'), nar = rad.querySelector('[data-f="nar"]');
            if (vem)
                v.vem = vem.value.trim();
            if (nar)
                v.nar = nar.value;
        });
    }
    function varna() {
        const box = document.getElementById("kVarn");
        if (!box)
            return;
        const konf = avropKonflikter(bar, rader, val, delta);
        box.innerHTML = konf.length
            ? '<div class="notis rod">⚠ Avropsdatum hamnar efter leverans- eller startdatum: ' +
                konf.map(esc).join(", ") + '. Kontrollera ordningen.</div>' : "";
    }
    function genomfor() {
        las();
        if (!genomforKonsekvens(bar, delta, rader, val)) {
            document.getElementById("kVarn").innerHTML =
                '<div class="notis rod">Svara på bekräftelsefrågan för det du valt att flytta.</div>';
            return;
        }
        stangModal();
        spara();
        rita();
    }
}

function beraknaKonsekvens(bar, delta, rader, val) {
    const saknar = rader.filter(r => val[r.kort.id] && val[r.kort.id].flytta &&
        behoverBekraftelse(r) && val[r.kort.id].bekraftat === null).map(r => r.kort.id);
    if (saknar.length)
        return { ok: false, saknar: saknar, poster: [] };
    const poster = [];
    rader.forEach(r => {
        const v = val[r.kort.id];
        if (!v || !v.flytta || r.kort.klar)
            return;
        poster.push({ kortId: r.kort.id,
            fran: r.kort.dag,
            till: skiftaArbetsdagar(r.kort.dag, delta),
            radId: r.rad ? r.rad.id : null,
            datumfalt: r.rad ? (r.slag === "avrop" ? "avropDag" : "levDag") : null,
            bekraftelse: !!behoverBekraftelse(r) });
    });
    return { ok: true, saknar: [], poster: poster };
}

function flyttaMedVal(kort, delta, text) {
    const t = T(), p = state;
    const patch = opFlyttaMed(kort, delta, text);
    if (!appliceraPatch(patch, { tavla: t, projekt: p }))
        return;
    patch.historik.forEach(h => logg(h));
    spara();
    rita();
    angraForeKlar(angraFore.txt, patch.fore, t, p);
}

function genomforKonsekvensPatch(bar, rader, val, plan) {
    const t = T(), p = state;
    const patch = opKonsekvenser(bar, plan.poster, rader, val, p, t);
    if (!patch.ok)
        return true;
    if (!appliceraPatch(patch, { tavla: t, projekt: p }))
        return false;
    patch.historik.forEach(h => logg(h));
    plan.poster.forEach(() => { spara(); rita(); });
    angraForeKlar(angraFore ? angraFore.txt : bar.text, patch.fore, t, p);
    return true;
}

function genomforKonsekvens(bar, delta, rader, val) {
    const plan = beraknaKonsekvens(bar, delta, rader, val);
    if (!plan.ok)
        return false;
    return genomforKonsekvensPatch(bar, rader, val, plan);
}

function dialogSlutForeStart(slut, start, delta) {
    const kropp = '<div class="notis rod" style="margin-top:0"><b>Slutdatumet hamnar före startdatumet.</b><br>' +
        'Starten ligger ' + dagEtikett(start.dag) + ' och slutet ' + dagEtikett(slut.dag) + '.</div>' +
        '<p class="hjalp">Flytta hela momentet ' + arbDagOrd(delta) + ' bakåt, eller stäng och sätt datumen själv.</p>';
    modal("Kontrollera datumen", slut.text, kropp, [
        { txt: "Ändra datumen manuellt", fn: stangModal },
        { txt: "Flytta hela momentet", primar: true, fn: () => {
                flyttaMedVal(start, delta, "startdatum flyttat med momentet");
                stangModal();
            } }
    ]);
}

function fragaOrsak(k, nyDag, foreKort) {
    const tidigare = nyDag < k.dag;
    const kropp = '<p class="fraga">' + (tidigare ? "Varför tidigareläggs momentet?" : "Varför blev den inte gjord?") + '</p>' +
        '<p class="hjalp">' + (tidigare ? "Tidigareläggning kan påverka avrop, leveranser och UE. Orsaken sparas i historiken men räknas inte som ett brutet löfte." :
        "Ett klick. Inte för att peka ut någon — samma orsak flera gånger är ett systemfel, inte otur.") + '</p>' +
        '<div class="orsaker" id="orsaker">' +
        ORSAKSORD.map(o => '<button type="button" data-o="' + o + '">' + o + '</button>').join("") + '</div>' +
        '<div class="falt dold" id="ovrigtFalt" style="margin-top:12px"><label for="ovrigtTxt">Kort beskrivning</label>' +
        '<input class="f" id="ovrigtTxt" placeholder="Några ord" maxlength="60"></div>';
    modal("Flyttas till " + dagEtikett(nyDag), k.text, kropp, [{ txt: "Avbryt", fn: stangModal }]);
    document.querySelectorAll("#orsaker button").forEach(b => b.addEventListener("click", () => {
        if (b.dataset.o !== "Övrigt")
            return utfor(k, nyDag, b.dataset.o, foreKort);
        document.getElementById("orsaker").classList.add("dold");
        const f = document.getElementById("ovrigtFalt");
        f.classList.remove("dold");
        const inp = document.getElementById("ovrigtTxt");
        inp.focus();
        const kor = () => utfor(k, nyDag, "Övrigt: " + (inp.value.trim() || "ej angivet"), foreKort);
        inp.addEventListener("keydown", e => { if (e.key === "Enter")
            kor(); });
        const o = document.getElementById("overlay");
        const kn = document.createElement("button");
        kn.className = "mknapp primar";
        kn.textContent = "Flytta";
        kn.addEventListener("click", kor);
        o.querySelector(".mhoger").appendChild(kn);
    }));
}

/* ---------- modal ---------- */

function modal(titel, undertitel, kropp, knappar) {
    stangModal();
    const o = document.createElement("div");
    o.className = "overlay";
    o.id = "overlay";
    o.innerHTML = '<div class="modal" role="dialog" aria-modal="true"><header><h3></h3><p></p></header>' +
        '<div class="kropp"></div><footer><div class="mhoger"></div></footer></div>';
    o.querySelector("h3").textContent = titel;
    o.querySelector("header p").textContent = undertitel || "";
    o.querySelector(".kropp").innerHTML = kropp;
    const h = o.querySelector(".mhoger"), foot = o.querySelector("footer");
    knappar.forEach(b => {
        const kn = document.createElement("button");
        kn.className = "mknapp" + (b.primar ? " primar" : "") + (b.fara ? " fara" : "");
        kn.textContent = b.txt;
        kn.addEventListener("click", b.fn);
        if (b.vanster)
            foot.prepend(kn);
        else
            h.appendChild(kn);
    });
    o.addEventListener("mousedown", e => { if (e.target === o)
        stangModal(); });
    document.body.appendChild(o);
    const f = o.querySelector("input,select,textarea");
    if (f)
        f.focus();
}

function stangModal() { const o = document.getElementById("overlay"); if (o)
    o.remove(); }

document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
        if (document.getElementById("overlay"))
            stangModal();
        else if (startOppen())
            stangStart();
        else if (dashOppen())
            stangDash();
        else if (valdKedja) {
            valdKedja = null;
            rita();
        }
        else if (document.body.classList.contains("visning"))
            vaxlaVisning(false);
    }
});
