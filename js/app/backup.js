/* ======================================================================
   Back up: en lista med jobb som kan göras lite när som helst.
   Fylls på kontinuerligt. Går ett planerat moment inte att utföra (väder,
   leverans, sjukdom …) tar man ett back-up-jobb, så att personalen alltid
   har något vettigt att göra och inget slöseri uppstår.
   Jobben sparas i projektet (p.backup) och synkas som allt annat.
   ====================================================================== */

const BU_PRIO = { hog: "Hög", normal: "Normal", lag: "Låg" };
const BU_PRIOORDNING = { hog: 0, normal: 1, lag: 2 };
const BU_VADER = { inne: "Inomhus", ute: "Utomhus", bada: "Inne eller ute" };
let buFilter = "redo";

function buLista(p) {
    if (!Array.isArray(p.backup))
        p.backup = [];
    return p.backup;
}

// Ett inplanerat jobb räknas som klart när kortet på tavlan bockats av.
function buStatus(p, j) {
    if (j.status === "klar")
        return "klar";
    if (j.status === "planerad") {
        const t = p.tavlor.find(x => x.id === j.planTavla);
        const k = t && t.kort.find(x => x.id === j.kortId);
        if (!k)
            return "redo";            // kortet är borttaget: jobbet finns kvar att ta
        return k.klar ? "klar" : "planerad";
    }
    return "redo";
}

function buLas() { return document.body.classList.contains("p4-projlas"); }

/* ---------- öppna och stänga ---------- */

function oppnaBackup() {
    try { stangStart(); } catch (e) { }
    try { stangDash(); } catch (e) { }
    try { stangGantt(); } catch (e) { }
    document.body.classList.add("dashlage");
    document.getElementById("backup").classList.remove("dold");
    ritaBackup();
}

function stangBackup() {
    const el = document.getElementById("backup");
    if (!el || el.classList.contains("dold"))
        return;
    el.classList.add("dold");
    if (!dashOppen() && !startOppen() && !ganttOppen())
        document.body.classList.remove("dashlage");
}

function backupOppen() {
    const el = document.getElementById("backup");
    return !!el && !el.classList.contains("dold");
}

// De andra sidorna stänger Back up när de öppnas.
["oppnaGantt", "oppnaDash", "oppnaStart"].forEach(namn => {
    const urs = window[namn];
    if (typeof urs !== "function")
        return;
    window[namn] = function () {
        stangBackup();
        return urs.apply(this, arguments);
    };
});

/* ---------- ritning ---------- */

function buVaderTips(p, redoInne) {
    if (typeof vaderBedomning !== "function" || !VADER || !VADER[IDAG])
        return "";
    const dagar = [IDAG, plus(IDAG, 1)].filter(d => VADER[d]);
    const daliga = dagar.map(d => ({ d, b: vaderBedomning(VADER[d]) })).filter(x => x.b.niva === "rod" || x.b.niva === "gul");
    if (!daliga.length)
        return "";
    const forst = daliga[0];
    const nar = forst.d === IDAG ? "idag" : "imorgon";
    return '<div class="bu-vader ' + forst.b.niva + '"><span class="bu-vaderikon" aria-hidden="true">' + (VADER[forst.d].symbol || "⚠") + "</span>" +
        "<div><b>" + esc(forst.b.status) + " " + nar + "</b><span>" +
        esc(forst.b.rader.map(x => x.txt).join(" · ")) + (redoInne ? " — " + redoInne + (redoInne === 1 ? " jobb inomhus är redo att tas." : " jobb inomhus är redo att tas.") : " — inga jobb inomhus är redo, lägg gärna till några.") +
        "</span></div>" + (redoInne ? '<button type="button" class="navknapp" data-bu="visainne">Visa inomhusjobben</button>' : "") + "</div>";
}

function buKort(p, j) {
    const st = buStatus(p, j), las = buLas();
    const t = j.tavlaId && p.tavlor.find(x => x.id === j.tavlaId);
    const chip = (klass, txt) => '<span class="bu-chip ' + klass + '">' + txt + "</span>";
    const chips = [
        chip("vader-" + (j.vader || "bada"), esc(BU_VADER[j.vader || "bada"])),
        j.tid ? chip("", "⏱ " + esc(j.tid)) : "",
        j.personer ? chip("", "👷 " + esc(String(j.personer)) + (j.kompetens ? " · " + esc(j.kompetens) : "")) : j.kompetens ? chip("", "👷 " + esc(j.kompetens)) : "",
        j.plats ? chip("", "📍 " + esc(j.plats)) : "",
        t && p.tavlor.length > 1 ? chip("", esc(t.namn)) : "",
    ].join("");
    let lage = "";
    if (st === "planerad")
        lage = '<div class="bu-lage planerad">Inplanerad ' + esc(dagEtikett(j.planDag)) + "</div>";
    else if (st === "klar")
        lage = '<div class="bu-lage klar">Klart' + (j.klarTid ? " " + esc(kortDatum(j.klarTid.slice(0, 10))) : "") + "</div>";
    const knappar = las ? "" : '<div class="bu-knappar">' +
        (st === "redo" ? '<button type="button" class="p4-btn p4-btn-primar p4-btn-liten" data-bu="planera" data-id="' + j.id + '">Planera in…</button>' +
            '<button type="button" class="mknapp" data-bu="klar" data-id="' + j.id + '">Klart</button>' : "") +
        (st === "planerad" ? '<button type="button" class="mknapp" data-bu="visa" data-id="' + j.id + '">Visa på tavlan</button>' +
            '<button type="button" class="mknapp" data-bu="avplanera" data-id="' + j.id + '">Ta tillbaka</button>' : "") +
        (st === "klar" ? '<button type="button" class="mknapp" data-bu="oppna" data-id="' + j.id + '">Gör redo igen</button>' : "") +
        '<button type="button" class="mknapp" data-bu="andra" data-id="' + j.id + '">Ändra</button>' +
        '<button type="button" class="mknapp fara" data-bu="bort" data-id="' + j.id + '" aria-label="Ta bort">Ta bort</button></div>';
    return '<article class="bu-kort prio-' + (j.prio || "normal") + " st-" + st + '">' +
        '<div class="bu-korttopp"><span class="bu-prio">' + BU_PRIO[j.prio || "normal"] + " prio</span>" + lage + "</div>" +
        "<h3>" + esc(j.titel) + "</h3>" +
        (j.beskrivning ? '<p class="bu-beskr">' + esc(j.beskrivning) + "</p>" : "") +
        '<div class="bu-chips">' + chips + "</div>" +
        (j.material ? '<div class="bu-material"><b>Material / verktyg</b> ' + esc(j.material) + "</div>" : "") +
        knappar + "</article>";
}

function ritaBackup() {
    const box = document.getElementById("backup");
    if (!box || box.classList.contains("dold"))
        return;
    const p = state, lista = buLista(p);
    const med = lista.map(j => ({ j, st: buStatus(p, j) }));
    const antal = { redo: 0, planerad: 0, klar: 0 };
    med.forEach(x => antal[x.st]++);
    const redoInne = med.filter(x => x.st === "redo" && x.j.vader === "inne").length;
    const visas = med.filter(x => buFilter === "alla" || x.st === buFilter || (buFilter === "inne" && x.st === "redo" && x.j.vader === "inne"))
        .sort((a, b) => {
            const o = { redo: 0, planerad: 1, klar: 2 };
            if (o[a.st] !== o[b.st]) return o[a.st] - o[b.st];
            const pa = BU_PRIOORDNING[a.j.prio || "normal"], pb = BU_PRIOORDNING[b.j.prio || "normal"];
            if (pa !== pb) return pa - pb;
            return (a.j.skapad || "") < (b.j.skapad || "") ? -1 : 1;
        });
    const flik = (v, txt, n) => '<button type="button" data-bufilter="' + v + '"' + (buFilter === v ? ' class="aktiv" aria-pressed="true"' : ' aria-pressed="false"') + ">" +
        txt + (n != null ? " <span>" + n + "</span>" : "") + "</button>";
    let html = '<div class="p4-hero bu-hero"><div class="p4-hero-text">' +
        '<div class="p4-eyebrow"><span class="p4-pop"></span>Översikt · ' + esc(p.projekt) + "</div>" +
        '<h1 class="g-rubrik">Back up</h1>' +
        '<div class="g-meta">' + antal.redo + (antal.redo === 1 ? " jobb redo" : " jobb redo") +
        (redoInne ? " · " + redoInne + " inomhus" : "") + (antal.planerad ? " · " + antal.planerad + " inplanerade" : "") + "</div></div>" +
        '<div class="g-knappar">' +
        '<div class="g-seg" role="group" aria-label="Visa">' + flik("redo", "Redo", antal.redo) + flik("inne", "Inomhus", redoInne) +
        flik("planerad", "Inplanerade", antal.planerad) + flik("klar", "Klara", antal.klar) + flik("alla", "Alla") + "</div>" +
        (buLas() ? "" : '<button type="button" class="p4-btn p4-btn-primar" data-bu="ny">+ Nytt back-up jobb</button>') +
        "</div></div>";
    html += '<div class="bu-intro"><b>Alltid redo att sysselsätta personalen.</b> Fyll på med jobb som inte behöver göras just nu men som kan göras ' +
        "lite när som helst. Går ett planerat moment inte att utföra på grund av väder, leverans eller annat tar ni ett jobb härifrån — så minskar slöseriet.</div>";
    html += buVaderTips(p, redoInne);
    if (!visas.length) {
        html += '<div class="bu-tom"><b>' + (lista.length ? "Inga jobb här" : "Inga back-up jobb ännu") + "</b><span>" +
            (lista.length ? "Byt flik för att se de andra jobben." :
                "Exempel: Städa och sortera containern, Montera skyddsräcken plan 3, Förbereda reglar för innerväggar, Laga skadade golvskydd, Märka upp el-dosor.") +
            "</span>" + (buLas() || lista.length ? "" : '<button type="button" class="p4-btn p4-btn-primar" data-bu="ny">+ Lägg till det första</button>') + "</div>";
    }
    else
        html += '<div class="bu-grid">' + visas.map(x => buKort(p, x.j)).join("") + "</div>";
    box.innerHTML = '<div class="p4-backup">' + html + "</div>";
    uppdateraBackupBadge();
}

function uppdateraBackupBadge() {
    const b = document.getElementById("p4BuBadge");
    if (!b || !state)
        return;
    const n = buLista(state).filter(j => buStatus(state, j) === "redo").length;
    b.textContent = n;
    b.classList.toggle("dold", !n);
}

/* ---------- dialoger ---------- */

function buDialog(j) {
    const p = state, ny = !j;
    j = j || { vader: "inne", prio: "normal" };
    const opt = (lista, v) => Object.keys(lista).map(k => '<option value="' + k + '"' + (k === v ? " selected" : "") + ">" + lista[k] + "</option>").join("");
    const kropp =
        '<div class="falt"><label for="buTitel">Jobb</label><input class="f" id="buTitel" value="' + esc(j.titel || "") + '" placeholder="T.ex. Montera skyddsräcken plan 3"></div>' +
        '<div class="falt"><label for="buBeskr">Beskrivning <span class="hjalp" style="display:inline">(frivilligt)</span></label>' +
        '<textarea class="f" id="buBeskr" rows="2" placeholder="Vad ska göras, var, och vad är viktigt att tänka på">' + esc(j.beskrivning || "") + "</textarea></div>" +
        '<div class="tva"><div class="falt"><label for="buVader">Var</label><select class="f" id="buVader">' + opt(BU_VADER, j.vader || "inne") + "</select>" +
        '<p class="hjalp" style="margin:4px 0 0">Inomhusjobb föreslås när vädret är dåligt.</p></div>' +
        '<div class="falt"><label for="buPrio">Prioritet</label><select class="f" id="buPrio">' + opt(BU_PRIO, j.prio || "normal") + "</select></div></div>" +
        '<div class="tva"><div class="falt"><label for="buTid">Tidsåtgång</label><input class="f" id="buTid" value="' + esc(j.tid || "") + '" placeholder="T.ex. 4 timmar, 2 dagar"></div>' +
        '<div class="falt"><label for="buPers">Antal personer</label><input class="f" id="buPers" type="number" min="1" max="50" value="' + esc(j.personer || "") + '" placeholder="T.ex. 2"></div></div>' +
        '<div class="tva"><div class="falt"><label for="buKomp">Yrke / vem</label><input class="f" id="buKomp" value="' + esc(j.kompetens || "") + '" placeholder="T.ex. Snickare, MVB"></div>' +
        '<div class="falt"><label for="buPlats">Plats / del</label><input class="f" id="buPlats" value="' + esc(j.plats || "") + '" placeholder="T.ex. Del 1:3"></div></div>' +
        (p.tavlor.length > 1 ? '<div class="falt"><label for="buTavla">Tavla</label><select class="f" id="buTavla"><option value="">Hela projektet</option>' +
            p.tavlor.map(t => '<option value="' + t.id + '"' + (t.id === j.tavlaId ? " selected" : "") + ">" + esc(t.namn) + "</option>").join("") + "</select></div>" : "") +
        '<div class="falt"><label for="buMat">Material / verktyg <span class="hjalp" style="display:inline">(frivilligt)</span></label>' +
        '<input class="f" id="buMat" value="' + esc(j.material || "") + '" placeholder="Det som behövs och om det finns på plats"></div>' +
        '<div class="notis rod dold" id="buFel"></div>';
    modal(ny ? "Nytt back-up jobb" : "Ändra back-up jobb", "Ett jobb som kan göras när ett planerat moment inte går", kropp, [
        { txt: "Avbryt", fn: stangModal },
        { txt: ny ? "Lägg till" : "Spara", primar: true, fn: () => {
                const v = id => (document.getElementById(id) || {}).value || "";
                const titel = v("buTitel").trim();
                if (!titel) {
                    const f = document.getElementById("buFel");
                    f.textContent = "Skriv vad jobbet är.";
                    f.classList.remove("dold");
                    return;
                }
                const falt = { titel, beskrivning: v("buBeskr").trim(), vader: v("buVader") || "inne", prio: v("buPrio") || "normal",
                    tid: v("buTid").trim(), personer: parseInt(v("buPers"), 10) || "", kompetens: v("buKomp").trim(),
                    plats: v("buPlats").trim(), tavlaId: v("buTavla") || null, material: v("buMat").trim() };
                if (ny)
                    buLista(p).push(Object.assign({ id: uid(), status: "redo", skapad: new Date().toISOString() }, falt));
                else
                    Object.assign(j, falt);
                stangModal();
                spara();
                ritaBackup();
                status(ny ? "Back-up jobbet är tillagt" : "Back-up jobbet är sparat");
            } },
    ]);
    setTimeout(() => { const t = document.getElementById("buTitel"); if (t) t.focus(); }, 30);
}

// Planera in: lägger jobbet som en post på tavlan en viss dag.
function buPlaneraDialog(j) {
    const p = state;
    const forslag = p.tavlor.some(t => t.id === j.tavlaId) ? j.tavlaId : T().id;
    const kropp =
        '<p class="hjalp" style="margin-top:0">Jobbet läggs som en produktionspost på tavlan. När posten bockas av räknas jobbet som klart.</p>' +
        '<div class="tva"><div class="falt"><label for="bpDag">Dag</label><input class="f" id="bpDag" type="date" value="' + IDAG + '"></div>' +
        '<div class="falt"><label for="bpTid">Tid <span class="hjalp" style="display:inline">(frivilligt)</span></label><input class="f" id="bpTid" placeholder="T.ex. 07:00"></div></div>' +
        (p.tavlor.length > 1 ? '<div class="falt"><label for="bpTavla">Tavla</label><select class="f" id="bpTavla">' +
            p.tavlor.map(t => '<option value="' + t.id + '"' + (t.id === forslag ? " selected" : "") + ">" + esc(t.namn) + "</option>").join("") + "</select></div>" : "") +
        '<div class="falt"><label for="bpVem">Vem</label><input class="f" id="bpVem" value="' + esc(j.kompetens || "") + '"></div>';
    modal("Planera in: " + j.titel, "Back up", kropp, [
        { txt: "Avbryt", fn: stangModal },
        { txt: "Lägg på tavlan", primar: true, fn: () => {
                const dag = document.getElementById("bpDag").value || IDAG;
                const tid = document.getElementById("bpTid").value.trim();
                const vem = document.getElementById("bpVem").value.trim();
                const tavlaId = (document.getElementById("bpTavla") || {}).value || T().id;
                const t = p.tavlor.find(x => x.id === tavlaId) || T();
                const not = [j.beskrivning, j.material ? "Material / verktyg: " + j.material : "", j.tid ? "Tidsåtgång: " + j.tid : "",
                    j.personer ? "Personer: " + j.personer : ""].filter(Boolean).join("\n");
                const patch = opNyttKort({ dag, typ: "produktion", text: "Back-up: " + j.titel, tid, vem, not }, t.id);
                if (!appliceraPatch(patch, { tavla: t, projekt: p }))
                    return;
                const k = patch.andringar[0].varde;
                if (j.plats) {
                    const kk = t.kort.find(x => x.id === k.id);
                    if (kk) kk.plats = j.plats;
                }
                Object.assign(j, { status: "planerad", planDag: dag, planTavla: t.id, kortId: k.id });
                stangModal();
                spara();
                ritaBackup();
                status("“" + j.titel + "” är inplanerat " + dagEtikett(dag));
            } },
    ]);
}

function buBekraftaBort(j) {
    modal("Ta bort back-up jobbet?", "", '<p style="margin-top:0">“' + esc(j.titel) + "” tas bort från listan." +
        (j.status === "planerad" ? " Posten på tavlan ligger kvar." : "") + "</p>", [
        { txt: "Avbryt", fn: stangModal },
        { txt: "Ta bort", fara: true, fn: () => {
                state.backup = buLista(state).filter(x => x.id !== j.id);
                stangModal();
                spara();
                ritaBackup();
                status("Back-up jobbet är borttaget");
            } },
    ]);
}

/* ---------- händelser ---------- */

document.addEventListener("click", (e) => {
    const box = document.getElementById("backup");
    if (!box || !box.contains(e.target))
        return;
    const f = e.target.closest("[data-bufilter]");
    if (f) {
        buFilter = f.dataset.bufilter;
        ritaBackup();
        return;
    }
    const b = e.target.closest("[data-bu]");
    if (!b)
        return;
    const vad = b.dataset.bu, j = buLista(state).find(x => x.id === b.dataset.id);
    if (vad === "ny") return buDialog(null);
    if (vad === "visainne") { buFilter = "inne"; return ritaBackup(); }
    if (!j) return;
    if (vad === "andra") return buDialog(j);
    if (vad === "planera") return buPlaneraDialog(j);
    if (vad === "bort") return buBekraftaBort(j);
    if (vad === "klar") { j.status = "klar"; j.klarTid = new Date().toISOString(); }
    if (vad === "oppna" || vad === "avplanera") { j.status = "redo"; j.klarTid = null; if (vad === "avplanera") { j.planDag = null; j.kortId = null; j.planTavla = null; } }
    if (vad === "visa") {
        stangBackup();
        if (j.planTavla && state.tavlor.some(t => t.id === j.planTavla)) state.aktiv = j.planTavla;
        rita();
        if (window.p4MarkeraNav) window.p4MarkeraNav();
        setTimeout(() => {
            const el = document.querySelector('.kort[data-id="' + j.kortId + '"]');
            if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); el.classList.add("p4-blink"); }
        }, 50);
        return;
    }
    spara();
    ritaBackup();
});

// Märket i menyn följer med när projektet ritas om.
(function () {
    const urs = rita;
    rita = function () {
        const r = urs.apply(this, arguments);
        try { uppdateraBackupBadge(); if (backupOppen()) ritaBackup(); } catch (e) { }
        return r;
    };
})();
