/* ======================================================================
   Det nya skalet: navigering, sök, genvägar och säkerhetskopia
   ====================================================================== */

(function () {
    "use strict";
    var $ = function (id) { return document.getElementById(id); };
    var EXPORTNYCKEL = "plan4_senaste_export";
    function lasLokalt(n) { try {
        return window.localStorage.getItem(n);
    }
    catch (e) {
        return null;
    } }
    function skrivLokalt(n, v) { try {
        window.localStorage.setItem(n, v);
    }
    catch (e) { } }
    try {
        $("p4Version").textContent = VERSION;
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
        var t = lasLokalt(EXPORTNYCKEL);
        var molnet = window.p4Moln;
        ruta.classList.remove("ok", "varn", "fara");
        if (molnet && molnet.aktiv) {
            // inloggad: kontot i molnet är säkerhetskopian
            ruta.classList.add(molnet.lage === "synkad" ? "ok" : "varn");
            text.textContent = molnet.text + ".";
        }
        else if (!t) {
            ruta.classList.add("fara");
            text.textContent = "Aldrig exporterad. Datan finns bara i den här webbläsaren.";
        }
        else {
            var d = new Date(t), dagar = Math.floor((Date.now() - d.getTime()) / 86400000);
            var nar = dagar <= 0 ? "i dag" : dagar === 1 ? "i går" : dagar + " dagar sedan";
            text.textContent = "Senast exporterad " + nar + " (" + d.toLocaleDateString("sv-SE") + ").";
            ruta.classList.add(dagar >= 7 ? "fara" : dagar >= 3 ? "varn" : "ok");
        }
        var lag = $("p4Lagring");
        try {
            lag.textContent = molnet && molnet.aktiv ? "Lagring: ditt konto + kopia på den här datorn"
                : lagringslage === "lokal" ? "Lagring: lokalt på denna dator"
                : lagringslage === "ingen" ? "Lagring: ingen automatisk lagring — exportera filen"
                    : lagringslage === "storage" ? "Lagring: värdens lagring" : "";
        }
        catch (e) { }
    }
    window.p4UppdateraBackup = uppdateraBackup;
    var ursLaddaNer = laddaNer;
    laddaNer = function (namn, data) {
        ursLaddaNer(namn, data);
        skrivLokalt(EXPORTNYCKEL, new Date().toISOString());
        uppdateraBackup();
    };
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
        var rader = [["N", "Snabb post i dag"], ["P", "Planera moment"], ["← / →", "Bläddra en vecka"], ["T", "Denna vecka"],
            ["O", "Projektöversikt"], ["A", "Att göra"], ["V", "Visningsläge"], ["/", "Sök på tavlan"], ["Esc", "Stäng dialog eller sida"]];
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
        else if (l === "v") {
            $("visning").click();
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
