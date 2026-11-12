/* ======================================================================
   Snabb post och guiden Planera moment
   ====================================================================== */

/* ---------- guiden ---------- */

let g = null;

function startDag(dag) { return dag && inomTavlan(dag) ? dag : (inomTavlan(IDAG) ? IDAG : dagar()[0]); }

function nollstall(d) {
    g = { steg: 0, dag: d, typ: null, text: "", vem: "", tid: "", start: d, klar: d,
        mtrl: [], forval: [], grund: {}, beredning: null, kedja: null, plats: "", milstolpe: false, bemanning: { behov: [], personer: [] } };
}

function planeraMoment(dag, text) {
    const d = startDag(dag);
    nollstall(d);
    g.typ = "produktion";
    g.steg = 1;
    g.text = text || "";
    visaSteg();
}

function snabbPost(dag) {
    const d = startDag(dag);
    nollstall(d);
    let typ = "produktion";
    const kropp = '<div class="falt"><label for="sbText">Vad?</label>' +
        '<input class="f" id="sbText" placeholder="Håltagning Hus A"></div>' +
        '<div class="tva"><div class="falt"><label for="sbDag">Dag</label><select class="f" id="sbDag">' + dagOptioner(d) + '</select></div>' +
        '<div class="falt" id="sbTillFalt"><label for="sbTill">Till och med</label><select class="f" id="sbTill">' + tillOptioner(d, "") + '</select></div></div>' +
        '<div id="sbFlera" class="hjalp dold" style="margin:-4px 0 10px"></div>' +
        '<div class="falt"><label for="sbVem">Vem</label><input class="f" id="sbVem" placeholder="Håltagaren"></div>' +
        '<div class="tva"><div class="falt"><label>Typ</label><div class="snabbtyp" id="sbTyp">' +
        TYPER.map(t => '<button type="button" data-t="' + t + '"' + (t === "produktion" ? ' class="vald"' : "") + '>' +
            ({ produktion: "Produktion", mote: "Möte", avrop: "Avrop", leverans: "Leverans", ue: "UE", franvaro: "Frånvaro", ovrigt: "Övrigt" })[t] + '</button>').join("") +
        '</div></div>' +
        '<div class="falt" id="sbTidFalt"><label for="sbTid">Klockslag / plats</label><input class="f" id="sbTid" placeholder="Valfritt"></div></div>' +
        '<label class="milstolpeval" id="sbMilFalt"><input type="checkbox" id="sbMil"><span class="milstolpe-ik" aria-hidden="true"></span><span><b>Milstolpe</b><small>Märks med en symbol på tavlan och i Gantt-schemat</small></span></label>' +
        '<div id="sbMote" class="dold"><div class="tva">' +
        '<div class="falt"><label for="sbStart">Börjar</label><input class="f" id="sbStart" type="time"></div>' +
        '<div class="falt"><label for="sbSlut">Slutar</label><input class="f" id="sbSlut" type="time"></div></div>' +
        '<div class="falt"><label for="sbPlats">Plats</label><input class="f" id="sbPlats" placeholder="Platskontoret"></div>' +
        '<div id="sbMoteFel"></div></div>' +
        '<div id="sbFranvaro" class="dold"><div class="falt"><label>Orsak</label>' +
        '<div class="lage" id="sbFOrsak">' + FRANVARO.map((o, i) => '<button type="button" data-o="' + o + '"' +
        (i === 0 ? ' class="vald"' : "") + '>' + o + '</button>').join("") + '</div></div></div>' +
        '<div class="falt" style="margin-bottom:0"><label for="sbRepet">Återkommer</label>' +
        '<select class="f" id="sbRepet"><option value="nej">Nej</option>' +
        '<option value="vecka">Varje vecka</option><option value="dagar">Valda veckodagar</option></select></div>' +
        '<div id="sbDagar" class="dold" style="margin-top:9px">' +
        '<div class="krysslista">' + DAGNAMN.map((n, i) => '<label><input type="checkbox" class="sbVdag" value="' + i + '"> ' +
        n.slice(0, 3) + '</label>').join("") + '</div>' +
        '<div class="falt" style="margin-top:9px;margin-bottom:0"><label for="sbTom">Till och med (valfritt)</label>' +
        '<input class="f" id="sbTom" type="date"></div></div>' +
        '<div id="sbAvrop" class="dold avropblock">' +
        '<div class="rubrik2">Avropet (frivilligt — fyller i avropslistan)</div>' +
        '<div class="falt"><label>Typ av avrop</label>' +
        '<div class="lage" id="sbSlag"><button type="button" data-s="material">Material</button>' +
        '<button type="button" data-s="ue">UE / extern resurs</button></div></div>' +
        '<div class="tva"><div class="falt"><label>Leverantör / företag</label>' +
        '<span id="sbLevRuta">' + foretagValjare(state, "leverantor", null, "sbForetag") + '</span></div>' +
        '<div class="falt"><label for="sbLevDag" id="sbLevDagEt">Leverans</label>' +
        '<input class="f" id="sbLevDag" type="date"></div></div>' +
        '<p class="hjalp" style="margin:2px 0 0">Ett avrop från Snabb post är alltid fristående. ' +
        'Hör avropet till ett produktionsmoment lägger du in det under Planera moment · Material / UE.</p>' +
        '</div>' +
        '<div id="sbAvropRepet" class="dold"><div class="notis">Ett återkommande avrop kan inte kopplas till ett moment eller ' +
        'få material- och leveransuppgifter, eftersom det inte finns som en enskild post förrän det bockas av. ' +
        'Avmarkera Återkommer om du vill fylla i det.</div></div>';
    let slag = null, fOrsak = FRANVARO[0], valtForetag = null, manuelltForetag = "";
    function laggUpp() {
        const txt = document.getElementById("sbText").value.trim();
        if (!txt)
            return document.getElementById("sbText").focus();
        const dagVal = document.getElementById("sbDag").value;
        const vem = document.getElementById("sbVem").value.trim();
        let tid = document.getElementById("sbTid").value.trim(), slutTid = "", plats = "";
        if (typ === "mote") {
            tid = document.getElementById("sbStart").value;
            slutTid = document.getElementById("sbSlut").value;
            plats = document.getElementById("sbPlats").value.trim();
            if (tid && slutTid && slutTid <= tid) {
                document.getElementById("sbMoteFel").innerHTML =
                    '<div class="notis rod">Sluttiden måste vara senare än starttiden.</div>';
                return;
            }
            if (!tid)
                slutTid = "";
        }
        const repet = document.getElementById("sbRepet").value;
        if (repet !== "nej") {
            const valda = Array.prototype.slice.call(document.querySelectorAll(".sbVdag:checked")).map(e => +e.value);
            const vdagar = repet === "dagar" ? valda : [(iso2d(dagVal).getDay() + 6) % 7];
            if (!vdagar.length) {
                document.getElementById("sbDagar").insertAdjacentHTML("beforeend", '<div class="notis rod">Välj minst en veckodag.</div>');
                return;
            }
            T().aterkom.push({ id: uid(), vdagar: vdagar, typ: typ, text: txt, tid: tid, slutTid: slutTid, plats: plats,
                vem: vem, not: "", tom: document.getElementById("sbTom").value || "",
                franvaroOrsak: typ === "franvaro" ? fOrsak : "" });
            logg("Återkommande post upplagd: " + txt);
        }
        else if (typ === "avrop") {
            skapaSnabbAvrop({ dag: dagVal, text: txt, tid: tid, vem: vem, slag: slag,
                foretagId: valtForetag, leverantor: valtForetag ? "" : manuelltForetag,
                levDag: document.getElementById("sbLevDag").value });
        }
        else {
            // en post per vardag från Dag till och med Till och med
            const t = T(), dagarna = valdaDagar();
            for (const dg of dagarna) {
                const patch = opSkapaSnabbPost({ dag: dg, typ: typ, text: txt, tid: tid, vem: vem,
                    slutTid: slutTid, plats: plats, franvaroOrsak: fOrsak,
                    milstolpe: typ === "produktion" && document.getElementById("sbMil").checked }, t.id, null, null);
                if (!patch.ok || !appliceraPatch(patch, { tavla: t, projekt: state }))
                    return;
            }
            if (dagarna.length > 1) {
                logg(txt + " upplagd " + dagarna.length + " dagar, " + kortDatum(dagarna[0]) + "–" + kortDatum(dagarna[dagarna.length - 1]));
                status(dagarna.length + " poster skapade: " + txt + " " + kortDatum(dagarna[0]) + "–" + kortDatum(dagarna[dagarna.length - 1]));
            }
        }
        stangModal();
        spara();
        rita();
    }
    modal("Snabb post", "Det som dyker upp under dagen. Full planering med material och förutsättningar gör du under Planera moment.", kropp, [
        { txt: "Planera moment ▸", vanster: true, fn: () => {
                const txt = document.getElementById("sbText").value.trim();
                const dagVal = document.getElementById("sbDag").value;
                planeraMoment(dagVal, txt);
            } },
        { txt: "Avbryt", fn: stangModal },
        { txt: "Lägg till", primar: true, fn: laggUpp }
    ]);
    // dagarna från Dag till och med Till och med (bara vardagar, tavlan har inga helger)
    function valdaDagar() {
        const fran = document.getElementById("sbDag").value, till = document.getElementById("sbTill").value;
        if (!till || till <= fran || typ === "avrop" || document.getElementById("sbRepet").value !== "nej")
            return [fran];
        return dagar().filter(x => x >= fran && x <= till);
    }
    function visaFlera() {
        const n = valdaDagar().length, el = document.getElementById("sbFlera");
        el.classList.toggle("dold", n < 2);
        el.textContent = n > 1 ? "Blir " + n + " poster, en per dag " + kortDatum(valdaDagar()[0]) + "–" + kortDatum(valdaDagar()[n - 1]) + "." : "";
    }
    document.getElementById("sbDag").addEventListener("change", () => {
        const s = document.getElementById("sbTill"), v = s.value;
        s.innerHTML = tillOptioner(document.getElementById("sbDag").value, v);
        visaFlera();
    });
    document.getElementById("sbTill").addEventListener("change", visaFlera);
    function visaAvrop() {
        const repet = document.getElementById("sbRepet").value !== "nej";
        document.getElementById("sbTillFalt").classList.toggle("dold", typ === "avrop" || repet);
        if (typeof visaFlera === "function") visaFlera();
        document.getElementById("sbAvrop").classList.toggle("dold", typ !== "avrop" || repet);
        document.getElementById("sbAvropRepet").classList.toggle("dold", !(typ === "avrop" && repet));
        document.getElementById("sbMote").classList.toggle("dold", typ !== "mote");
        document.getElementById("sbFranvaro").classList.toggle("dold", typ !== "franvaro");
        document.getElementById("sbTidFalt").classList.toggle("dold", typ === "mote");
        document.getElementById("sbMilFalt").classList.toggle("dold", typ !== "produktion" || repet);
        document.getElementById("sbDagar").classList.toggle("dold", document.getElementById("sbRepet").value !== "dagar");
    }
    document.querySelectorAll("#sbTyp button").forEach(b => b.addEventListener("click", () => {
        if (b.dataset.t === "franvaro") {
            const dag2 = document.getElementById("sbDag").value;
            stangModal();
            return franvaroDialog(null, { dag: dag2 });
        }
        typ = b.dataset.t;
        document.querySelectorAll("#sbTyp button").forEach(x => x.classList.remove("vald"));
        b.classList.add("vald");
        visaAvrop();
    }));
    document.getElementById("sbRepet").addEventListener("change", () => {
        const v = document.getElementById("sbRepet").value;
        if (v === "dagar") {
            const vd = (iso2d(document.getElementById("sbDag").value).getDay() + 6) % 7;
            document.querySelectorAll(".sbVdag").forEach(e => { if (+e.value === vd)
                e.checked = true; });
        }
        visaAvrop();
    });
    document.querySelectorAll("#sbFOrsak button").forEach(b => b.addEventListener("click", () => {
        fOrsak = b.dataset.o;
        document.querySelectorAll("#sbFOrsak button").forEach(x => x.classList.toggle("vald", x === b));
    }));
    document.querySelectorAll("#sbSlag button").forEach(b => b.addEventListener("click", () => {
        slag = b.dataset.s;
        document.querySelectorAll("#sbSlag button").forEach(x => x.classList.toggle("vald", x === b));
        document.getElementById("sbLevDagEt").textContent = slag === "ue" ? "Start på plats" : "Leverans";
        const ruta = document.getElementById("sbLevRuta");
        ruta.innerHTML = foretagValjare(state, slag === "ue" ? "ue" : "leverantor", valtForetag, "sbForetag", manuelltForetag);
        kopplaForetagValjare(ruta, state, (sel, id, sk, txt) => { valtForetag = id; manuelltForetag = id ? "" : (txt || ""); });
    }));
    kopplaForetagValjare(document.getElementById("sbLevRuta"), state, (sel, id, sk, txt) => { valtForetag = id; manuelltForetag = id ? "" : (txt || ""); });
    visaAvrop();
    ["sbText", "sbVem", "sbTid", "sbPlats"].forEach(i => document.getElementById(i).addEventListener("keydown", e => {
        if (e.key === "Enter")
            laggUpp();
    }));
}

function skapaSnabbAvrop(o) {
    const f = o.foretagId ? ftgPost(state, o.foretagId) : null;
    if (f)
        o.leverantor = f.namn;
    const t = T();
    const patch = opSkapaSnabbAvrop(o, f ? f.id : null, t.id, null, null);
    if (!patch.ok)
        return null;
    if (!appliceraPatch(patch, { tavla: t, projekt: state }))
        return null;
    const id = patch.andringar[0].id;
    return t.kort.find(x => x.id === id) || null;
}

// Till och med: samma dag eller en senare dag i planen.
function tillOptioner(fran, vald) {
    return '<option value="">Bara den dagen</option>' + dagar().filter(iso => iso > fran)
        .map(iso => '<option value="' + iso + '"' + (iso === vald ? " selected" : "") + '>' + dagEtikett(iso) + '</option>').join("");
}

function dagOptioner(vald) {
    return dagar().map(iso => '<option value="' + iso + '"' + (iso === vald ? " selected" : "") + '>' + dagEtikett(iso) + '</option>').join("");
}

function visaSteg() {
    return [null, stegVad, stegNar, stegMaterial, stegVillkor, stegSammanst][g.steg || 1]();
}

function stegRad(n) {
    return '<div class="steg">' + ["1 Vad", "2 När", "3 Material", "4 Förutsättningar", "5 Klart"]
        .map((s, i) => '<span' + (i === n - 1 ? ' class="nu"' : "") + '>' + s + '</span>').join("") + '</div>';
}

function stegVad() {
    const kropp = stegRad(1) + '<p class="fraga">Vilket moment är det?</p>' +
        '<div class="falt"><p class="hjalp">Verb + byggdel + delnummer. Inte "armering" utan "ÖK armering del 5" — annars går det inte att se på fredagen om det blev gjort.</p>' +
        '<input class="f" id="pText" value="' + esc(g.text) + '" placeholder="ÖK armering del 5"></div>' +
        '<div class="tva"><div class="falt"><label for="pPlats">Plats / del (frivilligt)</label>' +
        '<input class="f" id="pPlats" value="' + esc(g.plats || "") + '" placeholder="Plan 2 – Hus A"></div>' +
        '<div class="falt"><label for="pVem">Vem utför?</label><input class="f" id="pVem" value="' + esc(g.vem) + '" placeholder="Lag, lagbas eller UE"></div></div>' +
        '<label class="milstolpeval"><input type="checkbox" id="pMil"' + (g.milstolpe ? " checked" : "") + '><span class="milstolpe-ik" aria-hidden="true"></span><span><b>Milstolpe</b><small>Märks med en symbol på tavlan och i Gantt-schemat</small></span></label>' +
        '<div id="delvarn"></div>';
    modal("Ny produktionspost", "Guiden frågar efter hela kedjan: avrop, leverans, start och färdigt.", kropp, [
        { txt: "◂ Snabb post", vanster: true, fn: () => snabbPost(g.dag) },
        { txt: "Avbryt", fn: stangModal },
        { txt: "Nästa ▸", primar: true, fn: () => {
                const t = document.getElementById("pText").value.trim();
                if (!t)
                    return document.getElementById("pText").focus();
                g.text = t;
                g.vem = document.getElementById("pVem").value.trim();
                g.plats = document.getElementById("pPlats").value.trim();
                g.milstolpe = document.getElementById("pMil").checked;
                g.steg = 2;
                visaSteg();
            } }
    ]);
}

function stegNar() {
    const kropp = stegRad(2) + '<p class="fraga">När ska momentet starta — och när ska det vara färdigställt?</p>' +
        '<div class="tva"><div class="falt"><label for="pStart">Start</label><select class="f" id="pStart">' + dagOptioner(g.start) + '</select></div>' +
        '<div class="falt"><label for="pKlar">Färdigställt</label><select class="f" id="pKlar">' +
        dagOptioner(g.klar) + '<option value="__annat"' + (inomTavlan(g.klar) ? "" : " selected") + '>Annat datum…</option></select>' +
        '<input class="f" id="pKlarDatum" type="date" style="margin-top:6px' + (inomTavlan(g.klar) ? ";display:none" : "") +
        '" value="' + (inomTavlan(g.klar) ? "" : esc(g.klar)) + '"></div></div>' +
        '<div id="narVarn"></div>' +
        '<details class="bemdetaljer"' + (tomBemanning(g.bemanning) ? "" : " open") + '><summary>Resurser (frivilligt)</summary>' +
        '<div id="bemRuta">' + bemanningRedigerare(state, g.bemanning, null, null) + '</div></details>';
    modal("Ny produktionspost · " + g.text, "", kropp, [
        { txt: "◂ Tillbaka", vanster: true, fn: () => { lasBem(); g.steg = 1; visaSteg(); } },
        { txt: "Avbryt", fn: stangModal },
        { txt: "Nästa ▸", primar: true, fn: () => {
                lasBem();
                g.start = document.getElementById("pStart").value;
                g.klar = klarValt();
                if (!g.klar || iso2d(g.klar) < iso2d(g.start))
                    g.klar = g.start;
                (g.mtrl || []).forEach(m => {
                    if (iso2d(m.levDag) > iso2d(g.start)) {
                        m.levDag = g.start;
                        m.avropDag = minusArbetsdagar(m.levDag, Math.max(0, parseInt(m.ledtid || "0", 10)));
                    }
                });
                g.steg = 3;
                visaSteg();
            } }
    ]);
    const s = document.getElementById("pStart"), k = document.getElementById("pKlar"), v = document.getElementById("narVarn");
    const kd = document.getElementById("pKlarDatum");
    function klarValt() { return k.value === "__annat" ? (kd.value || "") : k.value; }
    const lasBem = kopplaBemanning(state, g.bemanning, () => {
        const kv = klarValt() || s.value;
        return { fran: s.value, till: kv > s.value ? kv : s.value };
    }, null);
    const kolla = () => {
        const kv = klarValt();
        if (!kv) {
            v.innerHTML = '<div class="notis">Välj ett slutdatum.</div>';
            return;
        }
        if (iso2d(kv) < iso2d(s.value)) {
            v.innerHTML = '<div class="notis rod">Färdigt ligger före start. Rätta innan du går vidare.</div>';
            return;
        }
        if (!inomTavlan(kv)) {
            v.innerHTML = '<div class="notis">Momentet slutar ' + kortDatum(kv) + ' (v' + veckonr(kv) + '), utanför den här fyraveckorsplanen. ' +
                'Slutposten sparas och dyker upp på tavlan när planen rullas fram. Den syns tills dess i momentets detaljvy.</div>';
            return;
        }
        const vecka = Math.floor((iso2d(s.value) - iso2d(tavlaStart())) / 86400000 / 7);
        if (vecka < 0) {
            v.innerHTML = '<div class="notis">Ligger före planens första vecka. Kontrollera datumet.</div>';
            return;
        }
        v.innerHTML = vecka >= 2
            ? '<div class="notis">Vecka +' + vecka + ' är förberedelse, inte löfte. Håll den grov — det viktiga här är avrop och bokningar.</div>'
            : '<div class="notis gron">Ligger i löfteszonen. Då ska bemanning, material och metod vara säkrade innan veckan börjar.</div>';
    };
    k.addEventListener("change", () => { kd.style.display = k.value === "__annat" ? "" : "none"; kolla(); });
    kd.addEventListener("change", kolla);
    s.addEventListener("change", kolla);
    kolla();
}

function tomMaterial(slag) {
    const lev = g.start;
    return { id: "m" + uid(), slag: slag || "material", txt: "", leverantor: "", foretagId: null, levDag: lev, ledtid: "5",
        avropDag: minusArbetsdagar(lev, 5) };
}

function radEtikett(m) {
    const delar = [arUe(m) ? "UE" : "Material"];
    if (m.txt)
        delar.push(m.txt);
    const namn = ftgNamn(state, m);
    if (namn)
        delar.push(namn);
    return delar;
}

function datumFalt(falt, varde) {
    const ute = varde && !inomTavlan(varde);
    return '<select class="f" data-f="' + falt + '">' + dagOptioner(ute ? "" : varde) +
        '<option value="__annat"' + (ute ? " selected" : "") + '>Annat datum…</option></select>' +
        '<input class="f' + (ute ? "" : " dold") + '" type="date" data-d="' + falt + '" value="' + esc(ute ? varde : "") + '">';
}

function lasDatum(rad, falt) {
    const sel = rad.querySelector('[data-f="' + falt + '"]');
    if (!sel)
        return "";
    if (sel.value !== "__annat")
        return sel.value;
    const d = rad.querySelector('[data-d="' + falt + '"]');
    return d && d.value ? d.value : "";
}

function materialRad(m) {
    const ue = arUe(m);
    return '<div class="mrad" data-id="' + m.id + '">' +
        '<div class="mslag">' +
        '<div class="lage">' +
        '<button type="button" data-s="material"' + (!ue ? ' class="vald"' : "") + '>Material</button>' +
        '<button type="button" data-s="ue"' + (ue ? ' class="vald"' : "") + '>UE / extern resurs</button>' +
        '</div>' +
        '<button type="button" class="fbort" title="Ta bort raden">✕</button>' +
        '</div>' +
        '<div class="mtopp">' +
        '<input class="f" data-f="txt" placeholder="' + (ue ? "UE/arbete, t.ex. Ventilationsmontage" : "Material, t.ex. Gips") + '" value="' + esc(m.txt || "") + '">' +
        foretagValjare(state, ue ? "ue" : "leverantor", m.foretagId || null, "foretagId", m.foretagId ? "" : (m.leverantor || "")) +
        '</div>' +
        '<div class="mbotten">' +
        '<label>' + (ue ? "Start på plats" : "Leverans") + datumFalt("levDag", m.levDag) + '</label>' +
        '<label>Ledtid<span class="mled"><input class="f" data-f="ledtid" type="number" min="0" max="250" step="1" value="' + esc(m.ledtid) + '"><em>arbetsdagar</em></span></label>' +
        '<label>' + (ue ? "Avrop/bekräftelse" : "Avrop") + datumFalt("avropDag", m.avropDag) + '</label>' +
        '</div>' +
        '<div class="mvarn"></div></div>';
}

function ritaMaterial() {
    const box = document.getElementById("mLista");
    if (!box)
        return;
    setTimeout(() => kopplaForetagValjare(box, state, () => samlaMaterial()), 0);
    box.innerHTML = g.mtrl.length ? g.mtrl.map(materialRad).join("")
        : '<p class="hjalp" style="margin:0">Inget tillagt. Lägg till en rad per material som ska levereras och per UE som ska avropas — de kan ha olika företag och olika datum.</p>';
    box.querySelectorAll(".mrad").forEach(rad => {
        const m = g.mtrl.find(x => x.id === rad.dataset.id);
        if (!m)
            return;
        rad.querySelector(".fbort").addEventListener("click", () => {
            samlaMaterial();
            g.mtrl = g.mtrl.filter(x => x.id !== m.id);
            ritaMaterial();
        });
        rad.querySelectorAll(".mslag .lage button").forEach(b => b.addEventListener("click", () => {
            samlaMaterial();
            m.slag = b.dataset.s;
            ritaMaterial();
        }));
        const lev = rad.querySelector('[data-f="levDag"]'), lt = rad.querySelector('[data-f="ledtid"]'), av = rad.querySelector('[data-f="avropDag"]');
        const levD = rad.querySelector('[data-d="levDag"]'), avD = rad.querySelector('[data-d="avropDag"]');
        function visaFalt() {
            levD.classList.toggle("dold", lev.value !== "__annat");
            avD.classList.toggle("dold", av.value !== "__annat");
        }
        function visaAvrop() {
            if (inomTavlan(m.avropDag)) {
                av.value = arbetsdag(m.avropDag);
                avD.value = "";
            }
            else {
                av.value = "__annat";
                avD.value = m.avropDag;
            }
            visaFalt();
        }
        const fran = () => {
            visaFalt();
            samlaMaterial();
            m.avropDag = minusArbetsdagar(m.levDag, Math.max(0, parseInt(m.ledtid || "0", 10)));
            visaAvrop();
            varna(rad, m);
        };
        lev.addEventListener("change", fran);
        levD.addEventListener("change", fran);
        lt.addEventListener("input", fran);
        const avByt = () => {
            visaFalt();
            samlaMaterial();
            if (!m.avropDag)
                return;
            m.ledtid = String(arbetsdagarMellan(m.avropDag, m.levDag));
            lt.value = m.ledtid;
            varna(rad, m);
        };
        av.addEventListener("change", avByt);
        avD.addEventListener("change", avByt);
        visaFalt();
        varna(rad, m);
    });
    function varna(rad, m) {
        const v = rad.querySelector(".mvarn");
        if (iso2d(m.avropDag) < iso2d(tavlaStart())) {
            v.innerHTML = '<div class="notis rod" style="margin:8px 0 0">Avropet skulle ha legat ' + kortDatum(m.avropDag) +
                ' (v' + veckonr(m.avropDag) + ') — före tavlan. Det läggs på första dagen märkt "gör idag" och hamnar på hinderlistan.</div>';
        }
        else if (!inomTavlan(m.levDag)) {
            v.innerHTML = '<div class="notis">' + (arUe(m) ? "UE-starten" : "Leveransen") + ' ligger ' + kortDatum(m.levDag) +
                ' (v' + veckonr(m.levDag) + '), utanför den här fyraveckorsplanen. Posten sparas och syns när planen rullar fram.</div>';
        }
        else if (iso2d(m.levDag) > iso2d(g.start)) {
            v.innerHTML = '<div class="notis" style="margin:8px 0 0">' + (arUe(m) ? "UE startar efter momentets start." : "Leveransen ligger efter momentets start.") + ' Kontrollera ordningen.</div>';
        }
        else
            v.innerHTML = "";
    }
}

function samlaMaterial() {
    const box = document.getElementById("mLista");
    if (!box)
        return;
    box.querySelectorAll(".mrad").forEach(rad => {
        const m = g.mtrl.find(x => x.id === rad.dataset.id);
        if (!m)
            return;
        m.txt = rad.querySelector('[data-f="txt"]').value.trim();
        const fsel = rad.querySelector('[data-f="foretagId"]');
        if (fsel && fsel.value === "__manuell") {
            const mi = rad.querySelector(".ftgman");
            m.foretagId = null;
            m.leverantor = mi ? mi.value.trim() : "";
        }
        else if (fsel && fsel.value !== "__nytt") {
            m.foretagId = fsel.value || null;
            const fp = ftgPost(state, m.foretagId);
            m.leverantor = fp ? fp.namn : "";
        }
        const lev = lasDatum(rad, "levDag");
        if (lev)
            m.levDag = lev;
        const av = lasDatum(rad, "avropDag");
        if (av)
            m.avropDag = av;
        m.ledtid = rad.querySelector('[data-f="ledtid"]').value || "0";
    });
}

function stegMaterial() {
    g.mtrl = g.mtrl || [];
    const kropp = stegRad(3) + '<p class="fraga">Vad ska avropas inför momentet?</p>' +
        '<p class="hjalp">En rad per material eller UE. Ledtiden räknas i arbetsdagar och bestämmer var avropet hamnar — skriver du avropsdatum för hand räknas ledtiden om.</p>' +
        '<div id="mLista"></div>' +
        '<div class="mlagg"><button type="button" class="egetknapp" id="laggMtrl">+ Material</button>' +
        '<button type="button" class="egetknapp" id="laggUe">+ UE / extern resurs</button></div>';
    modal("Ny produktionspost · " + g.text, "Ledtiden bestämmer var avropet ska stå — inte när du kommer på det.", kropp, [
        { txt: "◂ Tillbaka", vanster: true, fn: () => { samlaMaterial(); g.steg = 2; visaSteg(); } },
        { txt: "Avbryt", fn: stangModal },
        { txt: "Nästa ▸", primar: true, fn: () => {
                samlaMaterial();
                g.mtrl = g.mtrl.filter(m => m.txt);
                g.steg = 4;
                visaSteg();
            } }
    ]);
    function lagg(slag) {
        samlaMaterial();
        g.mtrl.push(tomMaterial(slag));
        ritaMaterial();
        const rader = document.querySelectorAll("#mLista .mrad");
        if (rader.length) {
            const f = rader[rader.length - 1].querySelector('[data-f="txt"]');
            if (f)
                f.focus();
        }
    }
    document.getElementById("laggMtrl").addEventListener("click", () => lagg("material"));
    document.getElementById("laggUe").addEventListener("click", () => lagg("ue"));
    ritaMaterial();
}

function arbetsdag(iso) {
    const d = iso2d(iso), v = (d.getDay() + 6) % 7;
    if (v > 4)
        d.setDate(d.getDate() - (v - 4));
    const x = d2iso(d), a = dagar();
    return x < a[0] ? a[0] : x;
}

function forvalRad(f) {
    if (f.omrade === "beredning") {
        return '<div class="frad osakrad" data-id="' + f.id + '">' +
            '<div class="fhuvud"><span class="fnamn">Arbetsberedning ej utförd</span>' +
            '<span class="hjalp" style="margin:0">styrs av valet ovan</span></div>' +
            '<div class="fdetalj"><input class="f dold" data-f="txt" value="' + esc(f.txt || "") + '">' +
            '<div class="tva2"><input class="f" data-f="vem" placeholder="Vem ansvarar för beredningen?" value="' + esc(f.vem || "") + '">' +
            '<input class="f" data-f="nar" type="date" title="Senast när" value="' + esc(f.nar || "") + '"></div></div></div>';
    }
    const eget = f.omrade === "annat";
    return '<div class="frad' + (f.status === "saknas" ? " osakrad" : "") + '" data-id="' + f.id + '">' +
        '<div class="fhuvud">' +
        (eget ? '<input class="f fnamn" data-f="namn" placeholder="Egen förutsättning" value="' + esc(f.namn || "") + '">'
            : '<span class="fnamn">' + omradeNamn(f.omrade) + '</span>') +
        '<div class="lage">' +
        '<button type="button" data-l="sakrad"' + (f.status === "sakrad" ? ' class="vald"' : "") + '>Säkrad</button>' +
        '<button type="button" data-l="saknas"' + (f.status === "saknas" ? ' class="vald"' : "") + '>Saknas</button>' +
        '</div>' +
        '<button type="button" class="fbort" title="Inte relevant för det här momentet">✕</button>' +
        '</div>' +
        '<div class="fdetalj">' +
        '<input class="f" data-f="txt" placeholder="Vad saknas? ' + esc(omradeHint(f.omrade) || "Beskriv kort") + '" value="' + esc(f.txt || "") + '">' +
        '<div class="tva2"><input class="f" data-f="vem" placeholder="Vem löser det?" value="' + esc(f.vem || "") + '">' +
        '<input class="f" data-f="nar" type="date" title="Senast när" value="' + esc(f.nar || "") + '"></div>' +
        '</div></div>';
}

function ritaForval() {
    const box = document.getElementById("fLista");
    if (!box)
        return;
    box.innerHTML = g.forval.length ? g.forval.map(forvalRad).join("")
        : '<p class="hjalp" style="margin:0">Inget valt än. Välj de områden ovan som verkligen påverkar om momentet går att genomföra.</p>';
    document.querySelectorAll("#fChips button").forEach(b => {
        b.classList.toggle("vald", g.forval.some(f => f.omrade === b.dataset.o));
    });
    box.querySelectorAll(".frad").forEach(rad => {
        const f = g.forval.find(x => x.id === rad.dataset.id);
        rad.querySelectorAll(".lage button").forEach(b => b.addEventListener("click", () => {
            samlaForval();
            f.status = b.dataset.l;
            ritaForval();
        }));
        const bort = rad.querySelector(".fbort");
        if (bort)
            bort.addEventListener("click", () => {
                samlaForval();
                g.forval = g.forval.filter(x => x.id !== f.id);
                ritaForval();
            });
    });
}

function samlaForval() {
    const box = document.getElementById("fLista");
    if (!box)
        return;
    box.querySelectorAll(".frad").forEach(rad => {
        const f = g.forval.find(x => x.id === rad.dataset.id);
        if (!f)
            return;
        const namn = rad.querySelector('[data-f="namn"]');
        if (namn)
            f.namn = namn.value.trim();
        f.txt = rad.querySelector('[data-f="txt"]').value.trim();
        f.vem = rad.querySelector('[data-f="vem"]').value.trim();
        f.nar = rad.querySelector('[data-f="nar"]').value;
    });
}

function grundRad(q) {
    const sv = (g.grund && g.grund[q.id]) || {};
    return '<div class="grad' + (sv.svar === "nej" ? " nej" : "") + '" data-q="' + q.id + '">' +
        '<div class="gfraga">' + q.fraga + '</div>' +
        '<div class="lage gsvar">' + q.svar.map(x => '<button type="button" data-v="' + x[0] + '"' +
        (sv.svar === x[0] ? ' class="vald"' : "") + '>' + x[1] + '</button>').join("") + '</div>' +
        (q.id === "ue" && (g.mtrl || []).some(arUe)
            ? '<div class="gkontext">Planerat i detta moment: ' +
                g.mtrl.filter(arUe).map(m => esc([m.leverantor, m.txt].filter(Boolean).join(" – ") || "UE")).join(" · ") +
                '</div>' : "") +
        '<div class="gfoljd">' +
        (q.precisera ? '<div class="chips sma gprec">' + q.precisera.map(x => '<button type="button" data-p="' + esc(x) + '"' +
            (sv.precisera === x ? ' class="vald"' : "") + '>' + x + '</button>').join("") + '</div>' : "") +
        '<input class="f" data-f="vad" placeholder="' + esc(q.vadText) + '" value="' + esc(sv.vad || "") + '">' +
        '<div class="tva2"><input class="f" data-f="vem" placeholder="Vem ansvarar?" value="' + esc(sv.vem || "") + '">' +
        '<input class="f" data-f="nar" type="date" title="När måste det vara löst?" value="' + esc(sv.nar || "") + '"></div>' +
        '</div></div>';
}

function samlaGrund() {
    const box = document.getElementById("grundLista");
    if (!box)
        return;
    g.grund = g.grund || {};
    box.querySelectorAll(".grad").forEach(rad => {
        const id = rad.dataset.q;
        const vald = rad.querySelector(".gsvar button.vald");
        const prec = rad.querySelector(".gprec button.vald");
        g.grund[id] = {
            svar: vald ? vald.dataset.v : null,
            precisera: prec ? prec.dataset.p : "",
            vad: rad.querySelector('[data-f="vad"]').value.trim(),
            vem: rad.querySelector('[data-f="vem"]').value.trim(),
            nar: rad.querySelector('[data-f="nar"]').value
        };
    });
}

function grundKlar() {
    if (!g.beredning || g.beredning.kravs === null || g.beredning.kravs === undefined)
        return false;
    if (g.beredning.kravs === true && !g.beredning.status)
        return false;
    return GRUNDFRAGOR.every(q => g.grund && g.grund[q.id] && g.grund[q.id].svar);
}

function stegVillkor() {
    g.forval = g.forval || [];
    g.grund = g.grund || {};
    if (g.beredning === undefined)
        g.beredning = null;
    const kropp = stegRad(4) +
        '<p class="fraga">Produktionskontroll</p>' +
        '<p class="hjalp">Fyra frågor som alltid gås igenom. Ja är ett klick — det är bara vid Nej / Inte helt som tavlan frågar vidare.</p>' +
        '<div class="abblock">' +
        '<div class="gfraga" style="margin-bottom:7px">Krävs arbetsberedning för momentet?</div>' +
        '<div class="abrad">' +
        '<div class="lage gsvar" id="abKravs">' +
        '<button type="button" data-v="nej"' + (g.beredning && g.beredning.kravs === false ? ' class="vald"' : "") + '>Nej</button>' +
        '<button type="button" data-v="ja"' + (g.beredning && g.beredning.kravs === true ? ' class="vald"' : "") + '>Ja</button>' +
        '</div></div>' +
        '<div class="abrad' + (g.beredning && g.beredning.kravs ? "" : " dold") + '" id="abStatusRad"><span>Status</span>' +
        '<div class="lage" id="abStatus">' +
        Object.keys(ABTEXT).map(k => '<button type="button" data-s="' + k + '"' +
            (g.beredning && g.beredning.status === k ? ' class="vald"' : "") + '>' + ABTEXT[k] + '</button>').join("") +
        '</div></div>' +
        '<div class="abhjalp dold" id="abHjalp"></div>' +
        '</div>' +
        '<div id="grundLista">' + GRUNDFRAGOR.map(grundRad).join("") + '</div>' +
        '<div id="grundVarn"></div>' +
        '<p class="fraga" style="margin-top:20px">Finns ytterligare förutsättningar som behöver säkras?</p>' +
        '<p class="hjalp">Välj bara det som är relevant för just det här momentet. Handlingar, material och UE är redan avklarade ovan.</p>' +
        '<div class="chips" id="fChips">' +
        FOMRADEN.filter(o => o.valbar).map(o => '<button type="button" data-o="' + o.id + '" title="' + esc(o.hint) + '">' + o.namn + '</button>').join("") +
        '<button type="button" data-o="annat" class="annat">+ Annan förutsättning</button>' +
        '</div>' +
        '<div id="fLista"></div>';
    modal("Ny produktionspost · " + g.text, "", kropp, [
        { txt: "◂ Tillbaka", vanster: true, fn: () => { samlaGrund(); samlaForval(); g.steg = 3; visaSteg(); } },
        { txt: "Avbryt", fn: stangModal },
        { txt: "Nästa ▸", primar: true, fn: () => {
                samlaGrund();
                samlaForval();
                if (!grundKlar()) {
                    document.getElementById("grundVarn").innerHTML =
                        '<div class="notis rod">Svara på alla fyra frågorna i produktionskontrollen innan du går vidare.</div>';
                    return;
                }
                g.steg = 5;
                visaSteg();
            } }
    ]);
    document.querySelectorAll("#grundLista .grad").forEach(rad => {
        rad.querySelectorAll(".gsvar button").forEach(b => b.addEventListener("click", () => {
            rad.querySelectorAll(".gsvar button").forEach(x => x.classList.toggle("vald", x === b));
            rad.classList.toggle("nej", b.dataset.v === "nej");
            document.getElementById("grundVarn").innerHTML = "";
            if (b.dataset.v === "nej") {
                const f = rad.querySelector('[data-f="vad"]');
                if (f)
                    setTimeout(() => f.focus(), 30);
            }
        }));
        rad.querySelectorAll(".gprec button").forEach(b => b.addEventListener("click", () => {
            const pa = b.classList.contains("vald");
            rad.querySelectorAll(".gprec button").forEach(x => x.classList.remove("vald"));
            if (!pa)
                b.classList.add("vald");
        }));
    });
    document.querySelectorAll("#fChips button").forEach(b => b.addEventListener("click", () => {
        samlaForval();
        const o = b.dataset.o;
        if (o !== "annat" && g.forval.some(f => f.omrade === o))
            g.forval = g.forval.filter(f => f.omrade !== o);
        else
            g.forval.push({ id: "f" + uid(), omrade: o, namn: "", txt: "", status: "saknas", vem: "", nar: "" });
        ritaForval();
    }));
    function abVisa() {
        const rad = document.getElementById("abStatusRad"), hj = document.getElementById("abHjalp");
        const ja = g.beredning && g.beredning.kravs === true;
        rad.classList.toggle("dold", !ja);
        const osakrad = ja && g.beredning.status && g.beredning.status !== "utford";
        hj.classList.toggle("dold", !osakrad);
        if (osakrad)
            hj.innerHTML = 'Arbetsberedningen är inte utförd. Den läggs upp som en osäkrad förutsättning — fyll i vem och när längre ner.';
        if (osakrad && !g.forval.some(f => f.omrade === "beredning")) {
            g.forval.unshift({ id: "f" + uid(), omrade: "beredning", namn: "", txt: "", status: "saknas", vem: "", nar: "" });
        }
        if (!osakrad)
            g.forval = g.forval.filter(f => f.omrade !== "beredning");
        if (document.getElementById("fLista"))
            ritaForval();
    }
    document.querySelectorAll("#abKravs button").forEach(b => b.addEventListener("click", () => {
        samlaForval();
        const ja = b.dataset.v === "ja";
        g.beredning = { kravs: ja, status: ja ? ((g.beredning && g.beredning.status) || "behovs") : null };
        document.querySelectorAll("#abKravs button").forEach(x => x.classList.toggle("vald", x === b));
        document.querySelectorAll("#abStatus button").forEach(x => x.classList.toggle("vald", x.dataset.s === (g.beredning.status || "")));
        document.getElementById("grundVarn").innerHTML = "";
        abVisa();
    }));
    document.querySelectorAll("#abStatus button").forEach(b => b.addEventListener("click", () => {
        samlaForval();
        g.beredning = { kravs: true, status: b.dataset.s };
        document.querySelectorAll("#abStatus button").forEach(x => x.classList.toggle("vald", x === b));
        abVisa();
    }));
    ritaForval();
    abVisa();
}

function grundForutsattningar() {
    return GRUNDFRAGOR.map(q => {
        const sv = (g.grund && g.grund[q.id]) || { svar: "ja" };
        return { id: "g-" + q.id, omrade: "grund-" + q.id, txt: grundText(q, sv),
            status: sv.svar === "nej" ? "saknas" : sv.svar === "ejrelevant" ? "ejrelevant" : "sakrad",
            kalla: "anvandare", grund: true, hinderId: null, vem: sv.vem || "", nar: sv.nar || "" };
    });
}

function planeradeKort() {
    g.kedja = g.kedja || "k" + uid();
    const kedja = g.kedja, ut = [];
    (g.mtrl || []).forEach(m => {
        const sent = iso2d(m.avropDag) < iso2d(tavlaStart());
        ut.push({ dag: arbetsdag(m.avropDag), typ: "avrop", roll: "A", mid: m.id,
            text: avropText(m) + (sent ? " · gör idag" : ""), vem: g.vem, kedja: kedja });
        ut.push({ dag: m.levDag, typ: m.slag === "ue" ? "ue" : "leverans", roll: "L", mid: m.id,
            text: levText(m), vem: g.vem, kedja: kedja });
    });
    if (g.start === g.klar) {
        ut.push({ dag: g.start, typ: "produktion", roll: "P", text: g.text, vem: g.vem, kedja: kedja });
    }
    else {
        ut.push({ dag: g.start, typ: "produktion", roll: "S", text: "Start " + g.text, vem: g.vem, kedja: kedja });
        ut.push({ dag: g.klar, typ: "produktion", roll: "K", text: g.text + " klart", vem: g.vem, kedja: kedja });
    }
    ut.sort((a, b) => a.dag < b.dag ? -1 : 1);
    return ut;
}

function planeradeHinder() {
    const h = [];
    grundForutsattningar().forEach(f => {
        if (f.status === "saknas")
            h.push({ vad: f.txt, vem: f.vem, nar: f.nar, forId: f.id });
    });
    (g.forval || []).forEach(f => {
        if (f.status !== "saknas")
            return;
        h.push({ vad: forvalText(f), vem: f.vem || "", nar: f.nar || "", forId: f.id });
    });
    (g.mtrl || []).forEach(m => {
        if (iso2d(m.avropDag) < iso2d(tavlaStart()))
            h.push({ vad: avropText(m) + " är sent mot ledtiden", vem: g.vem || "", nar: IDAG, forId: null });
    });
    return h;
}

function stegSammanst() {
    const kort = planeradeKort(), hin = planeradeHinder();
    const grund = grundForutsattningar();
    const sakrade = grund.filter(f => f.status !== "saknas").concat((g.forval || []).filter(f => f.status === "sakrad"));
    const kropp = stegRad(5) + '<p class="fraga">Det här läggs upp på tavlan</p><ul class="sammanst">' +
        kort.map(k => '<li><span class="nar">' + dagEtikett(k.dag) + '</span><span style="color:var(--' + k.typ + ');font-weight:600">' + esc(k.text) + '</span></li>').join("") + '</ul>' +
        (g.beredning && g.beredning.kravs ? '<p class="hjalp" style="margin-top:10px">Arbetsberedning krävs · ' + ABTEXT[g.beredning.status] + '</p>' : "") +
        (!tomBemanning(g.bemanning) ? '<p class="hjalp" style="margin-top:10px">Resurser · ' +
            esc(bemanningsText(state, { bemanning: g.bemanning })) +
            (g.bemanning.personer.length ? " · " + g.bemanning.personer.map(id => { const x = resPers(state, id); return x ? x.namn : "?"; }).join(", ") : "") +
            '</p>' : "") +
        (sakrade.length ? '<p class="hjalp" style="margin-top:10px">Avklarat: ' +
            sakrade.map(f => esc(f.txt || forvalText(f))).join(" · ") + '</p>' : "") +
        (hin.length ? '<p class="fraga" style="margin-top:17px">Osäkrade förutsättningar blir hinder</p><ul class="sammanst">' +
            hin.map(h => '<li><span class="nar">' + esc(h.vem || "vem?") + " · " + esc(narText(h.nar) || "när?") + '</span><span>' + esc(h.vad) + '</span></li>').join("") + '</ul>' +
            '<div class="notis">Rader utan namn eller datum är en suck, inte ett åtagande. Komplettera dem i listan.</div>' : "");
    modal("Ny produktionspost · " + g.text, "", kropp, [
        { txt: "◂ Tillbaka", vanster: true, fn: () => { g.steg = 4; visaSteg(); } },
        { txt: "Avbryt", fn: stangModal },
        { txt: "Lägg upp på tavlan", primar: true, fn: () => {
                const t = T();
                const patch = opGuideLaggUpp({ kort: kort, hinder: hin, grund: grund, forval: g.forval,
                    mtrl: g.mtrl, text: g.text, start: g.start, plats: g.plats, beredning: g.beredning,
                    bemanning: g.bemanning, milstolpe: !!g.milstolpe }, t.id, null, null);
                if (!patch.ok)
                    return;
                if (!appliceraPatch(patch, { tavla: t, projekt: state }))
                    return;
                patch.historik.forEach(h => logg(h));
                stangModal();
                spara();
                rita();
                status("Kedjan upplagd");
            } }
    ]);
}
