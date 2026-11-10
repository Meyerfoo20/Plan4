/* ======================================================================
   Det nya skalet: navigering, sök, genvägar och molnstatus
   ====================================================================== */

(function () {
    "use strict";
    var $ = function (id) { return document.getElementById(id); };
    try {
        $("p4Version").textContent = VISAD_VERSION;
    }
    catch (e) { }
    document.addEventListener("click", function (e) {
        var b = e.target.closest("[data-klick]");
        if (!b)
            return;
        var mal = $(b.getAttribute("data-klick"));
        if (mal) {
            stangMeny();
            mal.click();
        }
    });
    function stangSidor() {
        document.body.classList.remove("p4-kontovy");
        try {
            if (startOppen())
                stangStart();
        }
        catch (e) { }
        try {
            if (dashOppen())
                stangDash();
        }
        catch (e) { }
        try {
            if (ganttOppen())
                stangGantt();
        }
        catch (e) { }
        try {
            if (backupOppen())
                stangBackup();
        }
        catch (e) { }
        try {
            if (hjalpOppen())
                stangHjalp();
        }
        catch (e) { }
    }
    document.querySelectorAll("[data-nav]").forEach(function (b) {
        b.addEventListener("click", function () {
            var vy = b.getAttribute("data-nav");
            stangMeny();
            document.body.classList.remove("p4-kontovy");
            if (vy === "konto") {
                if (window.p4OppnaKonto)
                    window.p4OppnaKonto();
            }
            else if (vy === "tavla") {
                stangSidor();
                window.scrollTo({ top: 0 });
            }
            else if (vy === "dash") {
                oppnaDash();
                window.scrollTo({ top: 0 });
            }
            else if (vy === "start") {
                oppnaStart();
                window.scrollTo({ top: 0 });
            }
            else if (vy === "gantt") {
                oppnaGantt();
                window.scrollTo({ top: 0 });
            }
            else if (vy === "backup") {
                oppnaBackup();
                window.scrollTo({ top: 0 });
            }
            else if (vy === "hjalp") {
                oppnaHjalp();
                window.scrollTo({ top: 0 });
            }
            markeraNav();
        });
    });
    $("p4Brand").addEventListener("click", function (e) { e.preventDefault(); stangSidor(); markeraNav(); });
    $("flikar").addEventListener("click", function (e) {
        if (e.target.closest(".flik"))
            stangSidor();
    }, true);
    ["utfallKnapp", "resursKnapp", "avropKnapp"].forEach(function (id) {
        $(id).addEventListener("click", function () { stangMeny(); }, true);
    });
    function aktuellVy() {
        if (document.body.classList.contains("p4-kontovy"))
            return "konto";
        try {
            if (startOppen())
                return "start";
            if (dashOppen())
                return "dash";
            if (ganttOppen())
                return "gantt";
            if (backupOppen())
                return "backup";
            if (hjalpOppen())
                return "hjalp";
        }
        catch (e) { }
        return "tavla";
    }
    function markeraNav() {
        var vy = aktuellVy();
        document.querySelectorAll("[data-nav]").forEach(function (b) {
            b.classList.toggle("aktiv", b.getAttribute("data-nav") === vy);
            if (b.getAttribute("data-nav") === vy)
                b.setAttribute("aria-current", "page");
            else
                b.removeAttribute("aria-current");
        });
        document.body.classList.toggle("p4-dashvy", vy !== "tavla");
    }
    window.p4MarkeraNav = markeraNav;
    if (window.MutationObserver) {
        var obs = new MutationObserver(markeraNav);
        obs.observe($("dash"), { attributes: true, attributeFilter: ["class"] });
        obs.observe($("pstart"), { attributes: true, attributeFilter: ["class"] });
        obs.observe($("gantt"), { attributes: true, attributeFilter: ["class"] });
        obs.observe($("backup"), { attributes: true, attributeFilter: ["class"] });
        obs.observe($("hjalp"), { attributes: true, attributeFilter: ["class"] });
    }
    function stangMeny() { document.body.classList.remove("p4-menyoppen"); $("p4Meny").setAttribute("aria-expanded", "false"); }
    $("p4Meny").addEventListener("click", function () {
        var pa = !document.body.classList.contains("p4-menyoppen");
        document.body.classList.toggle("p4-menyoppen", pa);
        $("p4Meny").setAttribute("aria-expanded", pa ? "true" : "false");
    });
    $("p4Skugga").addEventListener("click", stangMeny);
    var header = document.querySelector(".p4-header");
    function mattHeader() {
        if (header && header.offsetHeight)
            document.documentElement.style.setProperty("--hh", header.offsetHeight + "px");
    }
    if (window.ResizeObserver)
        new ResizeObserver(mattHeader).observe(header);
    window.addEventListener("resize", mattHeader);
    mattHeader();
    var sok = $("p4Sok");
    function normal(s) { return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); }
    function tillampaSok() {
        var q = normal(sok.value.trim());
        var kort = document.querySelectorAll("#rutnat .kort");
        var traff = 0;
        kort.forEach(function (el) {
            if (!q) {
                el.classList.remove("p4-sokdold", "p4-soktraff");
                return;
            }
            var ja = normal(el.textContent).indexOf(q) >= 0;
            el.classList.toggle("p4-sokdold", !ja);
            el.classList.toggle("p4-soktraff", ja);
            if (ja)
                traff++;
        });
        var info = $("p4SokInfo");
        if (q) {
            info.textContent = traff + (traff === 1 ? " träff" : " träffar") + " för ”" + sok.value.trim() + "”";
            info.classList.remove("dold");
        }
        else
            info.classList.add("dold");
    }
    sok.addEventListener("input", function () {
        if (sok.value && aktuellVy() !== "tavla") {
            stangSidor();
            markeraNav();
        }
        tillampaSok();
    });
    sok.addEventListener("keydown", function (e) { if (e.key === "Escape") {
        sok.value = "";
        tillampaSok();
        sok.blur();
        e.stopPropagation();
    } });
    function uppdateraRaknare() {
        try {
            var r = kraverAtgard(state, null, IDAG, null);
            var b = $("p4AtgBadge"), n = r.totalt || 0;
            b.textContent = n > 99 ? "99+" : String(n);
            b.classList.toggle("dold", !n);
        }
        catch (e) { }
        try {
            var oppna = fAktiviteter(state).filter(function (a) { return !fKlar(a); }).length;
            var a = $("p4AgBadge");
            a.textContent = String(oppna);
            a.classList.toggle("dold", !oppna);
        }
        catch (e) { }
    }
    function uppdateraBackup() {
        var ruta = $("p4Backup"), text = $("p4BackupText");
        var molnet = window.p4Moln;
        ruta.classList.remove("ok", "varn", "fara");
        if (molnet && molnet.aktiv) {
            ruta.classList.add(molnet.lage === "synkad" ? "ok" : "varn");
            text.textContent = molnet.text + ".";
        }
        else {
            ruta.classList.add("varn");
            text.textContent = "Ansluter till molnet…";
        }
        var lag = $("p4Lagring");
        try {
            lag.textContent = molnet && molnet.aktiv ? "Lagring: molnet + kopia på den här datorn"
                : lagringslage === "lokal" ? "Lagring: lokalt på denna dator"
                : lagringslage === "ingen" ? "Lagring: ingen automatisk lagring"
                    : lagringslage === "storage" ? "Lagring: värdens lagring" : "";
        }
        catch (e) { }
    }
    window.p4UppdateraBackup = uppdateraBackup;
    var ursRita = rita;
    rita = function () {
        var r = ursRita.apply(this, arguments);
        try {
            tillampaSok();
            uppdateraRaknare();
            uppdateraBackup();
            markeraNav();
        }
        catch (e) { }
        return r;
    };
    function skriver(el) {
        if (!el)
            return false;
        var t = el.tagName;
        return t === "INPUT" || t === "TEXTAREA" || t === "SELECT" || el.isContentEditable;
    }
    function visaGenvagar() {
        var rader = [["N", "Snabb post idag"], ["P", "Planera moment"], ["← / →", "Bläddra en vecka"], ["T", "Denna vecka"],
            ["O", "Projektöversikt"], ["A", "Att göra"], ["G", "Gantt-schema"], ["V", "Visningsläge"], ["H", "Hjälp"], ["/", "Sök på tavlan"], ["Esc", "Stäng dialog eller sida"]];
        modal("Kortkommandon", "Fungerar när du inte skriver i ett fält", '<ul class="detalj">' + rader.map(function (r) { return '<li><span class="et"><kbd>' + esc(r[0]) + '</kbd></span><span>' + esc(r[1]) + '</span></li>'; }).join("") + "</ul>", [{ txt: "Stäng", primar: true, fn: stangModal }]);
    }
    $("p4Genvagar").addEventListener("click", function () { stangMeny(); visaGenvagar(); });
    document.addEventListener("keydown", function (e) {
        if (e.ctrlKey || e.metaKey || e.altKey)
            return;
        if (["p4-utloggad", "p4-laddar", "p4-vantar"].some(function (k) { return document.body.classList.contains(k); }))
            return;
        if (skriver(document.activeElement) || $("overlay"))
            return;
        var k = e.key, tv = document.body.classList.contains("visning");
        if (k === "/") {
            e.preventDefault();
            if (!tv) {
                stangSidor();
                sok.focus();
                sok.select();
            }
            return;
        }
        if (k === "?") {
            e.preventDefault();
            visaGenvagar();
            return;
        }
        var l = k.toLowerCase();
        if (l === "n") {
            e.preventDefault();
            $("snabbPostKnapp").click();
        }
        else if (l === "p" && !tv) {
            e.preventDefault();
            $("planeraKnapp").click();
        }
        else if (l === "t" && aktuellVy() === "tavla")
            $("idagKnapp").click();
        else if (k === "ArrowLeft" && aktuellVy() === "tavla")
            $("bakat").click();
        else if (k === "ArrowRight" && aktuellVy() === "tavla")
            $("framat").click();
        else if (l === "o" && !tv) {
            oppnaDash();
        }
        else if (l === "a" && !tv) {
            oppnaStart();
        }
        else if (l === "g" && !tv) {
            oppnaGantt();
            window.scrollTo({ top: 0 });
        }
        else if (l === "v") {
            $("visning").click();
        }
        else if (l === "h" && !tv) {
            oppnaHjalp();
            window.scrollTo({ top: 0 });
        }
    });
    uppdateraBackup();
    markeraNav();
    try {
        if (state && state.tavlor && state.tavlor.length)
            rita();
    }
    catch (e) { }
})();

/* Vädervarningar: fäll ut och ihop listan. Stängd från början; valet minns i webbläsaren. */
(function () {
    var NYCKEL = "plan4_vader_oppen";
    var knapp = document.getElementById("vaderFall"), panel = document.getElementById("varningspanel");
    if (!knapp || !panel) return;
    function satt(oppen) {
        panel.classList.toggle("stangd", !oppen);
        knapp.setAttribute("aria-expanded", oppen ? "true" : "false");
        knapp.title = oppen ? "Dölj vädret" : "Visa vädret";
    }
    var sparad = false;
    try { sparad = localStorage.getItem(NYCKEL) === "1"; } catch (e) { }
    satt(sparad);
    knapp.addEventListener("click", function () {
        var oppen = panel.classList.contains("stangd");
        satt(oppen);
        try { localStorage.setItem(NYCKEL, oppen ? "1" : "0"); } catch (e) { }
    });
})();
