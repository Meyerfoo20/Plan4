/* ======================================================================
   Hindernotis: en ruta som dyker upp när sidan laddas eller när man går
   in i ett projekt som har hinder som inte är lösta.
   Visas en gång per projekt och sidladdning. Försvinner när man stänger
   den, väljer "Visa hinder" eller efter en stund utan att man rör den.
   ====================================================================== */
(function () {
    "use strict";

    let visatFor = null;        // projektet notisen senast gällde
    let timer = null;

    function appSynlig() {
        const b = document.body.classList;
        return !b.contains("p4-laddar") && !b.contains("p4-utloggad") && !b.contains("p4-vantar");
    }

    // Notiserna (hinder och väder) staplas uppe till höger.
    function notisBox() {
        let box = document.getElementById("p4Notiser");
        if (!box) {
            box = document.createElement("div");
            box.id = "p4Notiser";
            box.className = "p4-notiser";
            document.body.appendChild(box);
        }
        return box;
    }
    window.p4NotisBox = notisBox;

    function ruta() {
        let el = document.getElementById("hinderNotis");
        if (!el) {
            el = document.createElement("div");
            el.id = "hinderNotis";
            el.className = "p4-hnotis";
            el.setAttribute("role", "alert");
            notisBox().prepend(el);
            el.addEventListener("click", (e) => {
                const b = e.target.closest("button");
                if (!b) return;
                if (b.dataset.hn === "visa") visaHinder(b.dataset.t);
                stang();
            });
            el.addEventListener("mouseenter", () => clearTimeout(timer));
        }
        return el;
    }

    function stang() {
        clearTimeout(timer);
        const el = document.getElementById("hinderNotis");
        if (!el || !el.classList.contains("synlig")) return;
        el.classList.remove("synlig");
        setTimeout(() => { if (!el.classList.contains("synlig")) el.innerHTML = ""; }, 250);
    }

    // Går till tavlan med hindret och visar hinderlistan.
    function visaHinder(tavlaId) {
        try { if (typeof ganttOppen === "function" && ganttOppen()) stangGantt(); } catch (e) { }
        try { if (typeof dashOppen === "function" && dashOppen()) stangDash(); } catch (e) { }
        try { if (typeof startOppen === "function" && startOppen()) stangStart(); } catch (e) { }
        try { if (typeof backupOppen === "function" && backupOppen()) stangBackup(); } catch (e) { }
        try { if (typeof hjalpOppen === "function" && hjalpOppen()) stangHjalp(); } catch (e) { }
        if (tavlaId && state.tavlor.some(t => t.id === tavlaId) && state.aktiv !== tavlaId) {
            state.aktiv = tavlaId;
            rita();
        }
        if (window.p4MarkeraNav) window.p4MarkeraNav();
        const panel = document.querySelector(".p4-hinderpanel");
        if (panel) {
            panel.scrollIntoView({ behavior: "smooth", block: "center" });
            panel.classList.remove("p4-blink");
            void panel.offsetWidth;
            panel.classList.add("p4-blink");
        }
    }

    function visa(p) {
        const lista = projektetsHinder(p);
        if (!lista.length) { stang(); return; }
        const sena = lista.filter(x => forfallen(x.h.nar, IDAG));
        const flera = p.tavlor.length > 1;
        // försenade först, sedan efter datum
        lista.sort((a, b) => {
            const fa = forfallen(a.h.nar, IDAG), fb = forfallen(b.h.nar, IDAG);
            if (fa !== fb) return fa ? -1 : 1;
            return (a.h.nar || "9999") < (b.h.nar || "9999") ? -1 : 1;
        });
        const visas = lista.slice(0, 4);
        const el = ruta();
        el.classList.toggle("sen", sena.length > 0);
        el.innerHTML =
            '<div class="p4-hnotis-topp"><span class="p4-hnotis-ikon" aria-hidden="true">⚠</span>' +
            '<div class="p4-hnotis-rubrik"><b>' + lista.length + (lista.length === 1 ? " hinder är inte löst" : " hinder är inte lösta") + "</b>" +
            "<small>" + esc(p.projekt) + (sena.length ? ' · <em>' + sena.length + " försenade</em>" : "") + "</small></div>" +
            '<button type="button" class="p4-hnotis-x" data-hn="stang" aria-label="Stäng">×</button></div>' +
            '<ul class="p4-hnotis-lista">' + visas.map(x => {
                const sen = forfallen(x.h.nar, IDAG);
                return '<li class="' + (sen ? "sen" : "") + '"><span class="p4-hnotis-vad">' + esc(x.h.vad || "Hinder") + "</span>" +
                    '<span class="p4-hnotis-meta">' + esc(x.h.vem || "vem?") + " · " + esc(narText(x.h.nar) || "när?") +
                    (sen ? " · försenat" : "") + (flera ? " · " + esc(x.t.namn) : "") + "</span></li>";
            }).join("") + "</ul>" +
            (lista.length > visas.length ? '<div class="p4-hnotis-fler">+ ' + (lista.length - visas.length) + " till</div>" : "") +
            '<div class="p4-hnotis-fot"><button type="button" class="p4-btn p4-btn-ljus p4-btn-liten" data-hn="stang">Stäng</button>' +
            '<button type="button" class="p4-btn p4-btn-primar p4-btn-liten" data-hn="visa" data-t="' + esc(visas[0].t.id) + '">Visa hinder</button></div>';
        requestAnimationFrame(() => el.classList.add("synlig"));
        clearTimeout(timer);
        timer = setTimeout(stang, 15000);
    }

    // Kontroll efter varje ritning: ny sidladdning eller nytt projekt → visa notisen.
    function kontrollera() {
        if (!state || !state.id || !appSynlig()) return;
        if (visatFor === state.id) return;
        visatFor = state.id;
        // vänta tills sidan har ritats klart (och molnsynken hunnit ersätta den lokala kopian)
        setTimeout(() => { if (state && state.id === visatFor) visa(state); }, 700);
    }

    const ursRita = rita;
    rita = function () {
        const r = ursRita.apply(this, arguments);
        try { kontrollera(); } catch (e) { }
        return r;
    };

    // Varningstecknet uppdateras när hinder läggs till, löses eller tas bort.
    const ursRitaHinder = ritaHinder;
    ritaHinder = function () {
        const r = ursRitaHinder.apply(this, arguments);
        try { ritaHindermark(); } catch (e) { }
        return r;
    };

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && document.getElementById("hinderNotis") && document.getElementById("hinderNotis").classList.contains("synlig") &&
            !document.getElementById("overlay")) stang();
    });

    // Utloggning eller byte av konto: visa notisen igen nästa gång.
    new MutationObserver(() => { if (!appSynlig()) { visatFor = null; stang(); } })
        .observe(document.body, { attributes: true, attributeFilter: ["class"] });
})();

/* ======================================================================
   Vädernotis: dyker upp när sidan laddas (som hindernotisen) om det är
   dåligt eller mycket dåligt väder idag eller de två närmaste dagarna.
   ====================================================================== */
(function () {
    "use strict";
    let visadFor = null, timer = null;

    function appSynlig() {
        const b = document.body.classList;
        return !b.contains("p4-laddar") && !b.contains("p4-utloggad") && !b.contains("p4-vantar");
    }
    function stang() {
        clearTimeout(timer);
        const el = document.getElementById("vaderNotis");
        if (el) el.classList.remove("synlig");
    }
    function dagNamn(iso) {
        return iso === IDAG ? "Idag" : iso === plus(IDAG, 1) ? "Imorgon" : (typeof vaderDagNamn === "function" ? vaderDagNamn(iso) : iso);
    }
    function visa() {
        const dagar = [0, 1, 2].map(i => plus(IDAG, i)).filter(d => VADER[d]);
        const daliga = dagar.map(d => ({ d, b: vaderBedomning(VADER[d]) })).filter(x => x.b.niva === "rod" || x.b.niva === "gul");
        if (!daliga.length) return;
        const rod = daliga.some(x => x.b.niva === "rod");
        let el = document.getElementById("vaderNotis");
        if (!el) {
            el = document.createElement("div");
            el.id = "vaderNotis";
            el.className = "p4-hnotis p4-vnotis";
            el.setAttribute("role", "alert");
            (window.p4NotisBox ? window.p4NotisBox() : document.body).appendChild(el);
            el.addEventListener("click", (e) => {
                const b = e.target.closest("button");
                if (!b) return;
                if (b.dataset.vn === "visa") {
                    const panel = document.getElementById("varningspanel");
                    if (panel && panel.classList.contains("stangd")) document.getElementById("vaderFall").click();
                    try { if (typeof backupOppen === "function" && backupOppen()) stangBackup(); } catch (x) { }
                    try { if (typeof hjalpOppen === "function" && hjalpOppen()) stangHjalp(); } catch (x) { }
                    try { if (ganttOppen()) stangGantt(); if (dashOppen()) stangDash(); if (startOppen()) stangStart(); } catch (x) { }
                    if (window.p4MarkeraNav) window.p4MarkeraNav();
                    if (panel) panel.scrollIntoView({ behavior: "smooth", block: "center" });
                }
                if (b.dataset.vn === "backup") { try { oppnaBackup(); if (window.p4MarkeraNav) window.p4MarkeraNav(); } catch (x) { } }
                stang();
            });
            el.addEventListener("mouseenter", () => clearTimeout(timer));
        }
        let redo = 0;
        try { redo = (state.backup || []).filter(j => buStatus(state, j) === "redo").length; } catch (e) { }
        el.classList.toggle("sen", rod);
        el.innerHTML =
            '<div class="p4-hnotis-topp"><span class="p4-hnotis-ikon" aria-hidden="true">' + (VADER[daliga[0].d].symbol || "⚠") + "</span>" +
            '<div class="p4-hnotis-rubrik"><b>' + (rod ? "Mycket dåligt väder" : "Dåligt väder") + " " + (daliga.length === 1 ? dagNamn(daliga[0].d).toLowerCase() : "de närmaste dagarna") + "</b>" +
            "<small>" + esc(VADER._namn || "") + " · prognos från Open-Meteo</small></div>" +
            '<button type="button" class="p4-hnotis-x" data-vn="stang" aria-label="Stäng">×</button></div>' +
            '<ul class="p4-hnotis-lista">' + daliga.map(x => '<li class="' + (x.b.niva === "rod" ? "sen" : "") + '">' +
                '<span class="p4-hnotis-vad">' + dagNamn(x.d) + " · " + esc(x.b.status) + "</span>" +
                '<span class="p4-hnotis-meta">' + esc(x.b.rader.map(r => r.txt).join(" · ")) + "</span></li>").join("") + "</ul>" +
            '<div class="p4-hnotis-fot">' +
            (redo ? '<button type="button" class="p4-btn p4-btn-ljus p4-btn-liten" data-vn="backup">Back-up jobb (' + redo + ")</button>" : "") +
            '<button type="button" class="p4-btn p4-btn-primar p4-btn-liten" data-vn="visa">Visa vädret</button></div>';
        requestAnimationFrame(() => el.classList.add("synlig"));
        clearTimeout(timer);
        timer = setTimeout(stang, 15000);
    }
    function kontrollera() {
        if (!appSynlig() || !VADER || !VADER._idag || !VADER[IDAG]) return;
        const nyckel = (VADER._plats || "") + "|" + IDAG + "|" + (state && state.id);
        if (visadFor === nyckel) return;
        visadFor = nyckel;
        setTimeout(visa, 900);
    }
    const urs = ritaVarningar;
    ritaVarningar = function () {
        const r = urs.apply(this, arguments);
        try { kontrollera(); } catch (e) { }
        return r;
    };
    new MutationObserver(() => { if (!appSynlig()) { visadFor = null; stang(); } })
        .observe(document.body, { attributes: true, attributeFilter: ["class"] });
})();
