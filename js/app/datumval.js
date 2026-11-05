/* ======================================================================
   Datumväljare: ersätter webbläsarens datumruta med Plan4:s egen.

   Varje <input type="date"> får en knapp bredvid sig som visar datumet på
   svenska och öppnar en egen kalender. Själva fältet finns kvar (dolt) och
   håller värdet som ÅÅÅÅ-MM-DD, så att all övrig kod läser och skriver
   .value precis som förut och får input- och change-händelser.
   Fält som skapas senare (i dialoger) tas med automatiskt.
   ====================================================================== */
(function () {
    "use strict";

    var MANADER = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti",
        "september", "oktober", "november", "december"];
    var MAN_KORT = ["jan", "feb", "mars", "apr", "maj", "juni", "juli", "aug", "sep", "okt", "nov", "dec"];
    var DAGAR_KORT = ["Mån", "Tis", "Ons", "Tor", "Fre", "Lör", "Sön"];
    var VARDE = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    // fält som alltid måste ha ett datum: där visas ingen Rensa-knapp
    var NODVANDIGA = ["tmStart", "feDag", "duDag", "fvFran", "fvTill", "faKalDag"];

    // ---------- datumhjälp ----------
    function tillDatum(iso) {
        var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
        return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
    }
    function tillIso(d) {
        return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    }
    function idagIso() { return tillIso(new Date()); }
    function vecka(d) {
        var t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
        var dag = t.getUTCDay() || 7;
        t.setUTCDate(t.getUTCDate() + 4 - dag);
        var ar = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
        return Math.ceil(((t - ar) / 86400000 + 1) / 7);
    }
    function visningstext(iso) {
        var d = tillDatum(iso);
        if (!d) return null;
        return DAGAR_KORT[(d.getDay() + 6) % 7] + " " + d.getDate() + " " + MAN_KORT[d.getMonth()] + " " + d.getFullYear();
    }
    function hamtaVarde(inp) { return VARDE.get.call(inp); }
    function inomGranser(inp, iso) {
        return !((inp.min && iso < inp.min) || (inp.max && iso > inp.max));
    }

    // ---------- fältet ----------
    function forbattra(inp) {
        if (inp.dataset.p4datum) return;
        inp.dataset.p4datum = "1";

        var knapp = document.createElement("button");
        knapp.type = "button";
        knapp.setAttribute("aria-haspopup", "dialog");
        knapp.setAttribute("aria-expanded", "false");
        knapp.innerHTML = '<span class="p4d-text"></span><span class="p4d-vecka"></span><span class="p4d-ikon" aria-hidden="true"></span>';
        inp.insertAdjacentElement("afterend", knapp);
        inp._p4knapp = knapp;
        knapp._p4input = inp;

        // Knappen ärver fältets klasser, stil och läge, så att visa/dölj och marginaler följer med.
        function synka() {
            knapp.className = (inp.className || "") + " p4d-falt";
            knapp.style.cssText = inp.style.cssText;
            knapp.disabled = inp.disabled;
            knapp.title = inp.title || "";
            var lbl = inp.getAttribute("aria-label") || (inp.id && (document.querySelector('label[for="' + inp.id + '"]') || {}).textContent);
            var iso = hamtaVarde(inp), txt = visningstext(iso);
            knapp.classList.toggle("tom", !txt);
            knapp.querySelector(".p4d-text").textContent = txt || inp.placeholder || "Välj datum";
            knapp.querySelector(".p4d-vecka").textContent = txt ? "v" + vecka(tillDatum(iso)) : "";
            knapp.setAttribute("aria-label", (lbl ? lbl.trim() + ": " : "") + (txt || "inget datum valt"));
        }
        inp._p4synka = synka;

        // Värden som sätts från koden visas direkt i knappen.
        Object.defineProperty(inp, "value", {
            configurable: true,
            get: function () { return VARDE.get.call(this); },
            set: function (v) { VARDE.set.call(this, v); synka(); }
        });
        new MutationObserver(synka).observe(inp, { attributes: true, attributeFilter: ["class", "style", "disabled", "title", "min", "max"] });
        inp.addEventListener("change", synka);

        knapp.addEventListener("click", function () { if (oppen && oppen.inp === inp) stang(); else oppna(inp); });
        knapp.addEventListener("keydown", function (e) {
            if (e.key === "ArrowDown" || (e.altKey && e.key === "ArrowDown")) { e.preventDefault(); oppna(inp); }
        });
        synka();
    }

    function satt(inp, iso) {
        VARDE.set.call(inp, iso);
        inp._p4synka();
        inp.dispatchEvent(new Event("input", { bubbles: true }));
        inp.dispatchEvent(new Event("change", { bubbles: true }));
    }

    // ---------- kalendern ----------
    var oppen = null;   // { inp, ruta, visad (första dagen i visad månad), fokus (iso) }

    function oppna(inp) {
        stang();
        var knapp = inp._p4knapp;
        if (!knapp || knapp.disabled) return;
        var iso = hamtaVarde(inp);
        var start = tillDatum(iso) || tillDatum(inp.min && idagIso() < inp.min ? inp.min : idagIso());
        var ruta = document.createElement("div");
        ruta.className = "p4d-pop";
        ruta.setAttribute("role", "dialog");
        ruta.setAttribute("aria-label", "Välj datum");
        document.body.appendChild(ruta);
        oppen = { inp: inp, ruta: ruta, visad: new Date(start.getFullYear(), start.getMonth(), 1), fokus: tillIso(start) };
        knapp.setAttribute("aria-expanded", "true");
        knapp.classList.add("aktiv");
        rita();
        placera();
        var f = ruta.querySelector(".p4d-dag.fokus");
        if (f) f.focus({ preventScroll: true });
    }

    function stang(tillbaka) {
        if (!oppen) return;
        var knapp = oppen.inp._p4knapp;
        oppen.ruta.remove();
        knapp.setAttribute("aria-expanded", "false");
        knapp.classList.remove("aktiv");
        oppen = null;
        if (tillbaka) knapp.focus();
    }

    function rita() {
        var o = oppen, inp = o.inp, v = o.visad;
        var valt = hamtaVarde(inp), idag = idagIso();
        var forsta = new Date(v.getFullYear(), v.getMonth(), 1);
        var borjan = new Date(forsta);
        borjan.setDate(1 - ((forsta.getDay() + 6) % 7));     // måndagen i första veckan

        var html = '<div class="p4d-topp">' +
            '<button type="button" class="p4d-pil" data-steg="-1" aria-label="Föregående månad"><span></span></button>' +
            '<div class="p4d-rubrik"><b>' + MANADER[v.getMonth()].charAt(0).toUpperCase() + MANADER[v.getMonth()].slice(1) + "</b> " + v.getFullYear() + "</div>" +
            '<button type="button" class="p4d-pil nasta" data-steg="1" aria-label="Nästa månad"><span></span></button></div>' +
            '<div class="p4d-rutnat" role="grid"><span class="p4d-vh">v</span>' +
            DAGAR_KORT.map(function (d, i) { return '<span class="p4d-vd' + (i > 4 ? " helg" : "") + '">' + d.slice(0, 2) + "</span>"; }).join("");
        var d = new Date(borjan);
        for (var rad = 0; rad < 6; rad++) {
            html += '<span class="p4d-vnr">' + vecka(d) + "</span>";
            for (var k = 0; k < 7; k++) {
                var iso = tillIso(d);
                var kl = "p4d-dag" + (d.getMonth() !== v.getMonth() ? " annan" : "") + (k > 4 ? " helg" : "") +
                    (iso === idag ? " idag" : "") + (iso === valt ? " vald" : "") + (iso === o.fokus ? " fokus" : "");
                var av = !inomGranser(inp, iso);
                html += '<button type="button" class="' + kl + '" data-iso="' + iso + '" tabindex="' + (iso === o.fokus ? "0" : "-1") + '"' +
                    (av ? " disabled" : "") + (iso === valt ? ' aria-pressed="true"' : "") +
                    ' aria-label="' + visningstext(iso) + '">' + d.getDate() + "</button>";
                d.setDate(d.getDate() + 1);
            }
        }
        html += "</div>" +
            '<div class="p4d-fot">' +
            (inp.required || NODVANDIGA.indexOf(inp.id) >= 0 ? "<span></span>" : '<button type="button" class="p4d-lank" data-gor="rensa">Rensa</button>') +
            '<button type="button" class="p4d-lank stark" data-gor="idag"' + (inomGranser(inp, idag) ? "" : " disabled") + ">Idag</button></div>";
        o.ruta.innerHTML = html;
    }

    function placera() {
        if (!oppen) return;
        var r = oppen.inp._p4knapp.getBoundingClientRect(), p = oppen.ruta;
        var b = p.offsetWidth, h = p.offsetHeight, m = 8;
        var vanster = Math.min(Math.max(m, r.left), window.innerWidth - b - m);
        var topp = r.bottom + 6;
        if (topp + h > window.innerHeight - m && r.top - h - 6 > m) topp = r.top - h - 6;
        p.style.left = vanster + "px";
        p.style.top = Math.max(m, topp) + "px";
    }

    function flyttaFokus(dagar, manader) {
        var o = oppen, d = tillDatum(o.fokus);
        if (manader) {
            var dag = d.getDate();
            d = new Date(d.getFullYear(), d.getMonth() + manader, 1);
            d.setDate(Math.min(dag, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
        } else d.setDate(d.getDate() + dagar);
        o.fokus = tillIso(d);
        o.visad = new Date(d.getFullYear(), d.getMonth(), 1);
        rita();
        var f = o.ruta.querySelector(".p4d-dag.fokus");
        if (f) f.focus({ preventScroll: true });
    }

    document.addEventListener("click", function (e) {
        // En etikett för ett datumfält öppnar kalendern.
        var lbl = e.target.closest && !e.target.closest(".p4d-falt, .p4d-pop") && e.target.closest("label");
        if (lbl) {
            var mal = lbl.htmlFor ? document.getElementById(lbl.htmlFor) : lbl.querySelector("input[data-p4datum]");
            if (mal && mal._p4knapp) { e.preventDefault(); oppna(mal); return; }
        }
        if (!oppen || !oppen.ruta.contains(e.target)) return;
        var knapp = e.target.closest("button");
        if (!knapp || knapp.disabled) return;
        if (knapp.dataset.steg) {
            oppen.visad = new Date(oppen.visad.getFullYear(), oppen.visad.getMonth() + +knapp.dataset.steg, 1);
            oppen.fokus = tillIso(oppen.visad);
            rita();
        } else if (knapp.dataset.iso) {
            var inp = oppen.inp;
            stang(true);
            satt(inp, knapp.dataset.iso);
        } else if (knapp.dataset.gor) {
            var inp2 = oppen.inp, varde = knapp.dataset.gor === "idag" ? idagIso() : "";
            stang(true);
            satt(inp2, varde);
        }
    });

    // Klick utanför stänger kalendern (men inte dialogen den ligger i).
    document.addEventListener("mousedown", function (e) {
        if (!oppen) return;
        if (oppen.ruta.contains(e.target) || oppen.inp._p4knapp.contains(e.target)) return;
        stang();
    }, true);

    document.addEventListener("keydown", function (e) {
        if (!oppen) return;
        var i = oppen.ruta.contains(document.activeElement);
        if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); stang(true); return; }
        if (!i) return;
        var steg = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
        if (steg) { e.preventDefault(); e.stopImmediatePropagation(); flyttaFokus(steg, 0); }
        else if (e.key === "PageUp" || e.key === "PageDown") { e.preventDefault(); e.stopImmediatePropagation(); flyttaFokus(0, e.key === "PageUp" ? -1 : 1); }
        else if (e.key === "Tab") { stang(); }
        else if (e.key === "Enter" || e.key === " ") { e.stopImmediatePropagation(); }   // knappen sköter valet
        else if (e.key.length === 1) { e.stopImmediatePropagation(); }                     // inga kortkommandon i kalendern
    }, true);

    window.addEventListener("resize", placera);
    document.addEventListener("scroll", function (e) {
        if (oppen && !oppen.ruta.contains(e.target)) placera();
    }, true);

    // Stängs dialogen medan kalendern är öppen försvinner kalendern också.
    function genomsok(rot) {
        if (rot.nodeType !== 1) return;
        if (rot.matches('input[type="date"]')) forbattra(rot);
        rot.querySelectorAll && rot.querySelectorAll('input[type="date"]').forEach(forbattra);
    }
    new MutationObserver(function (lista) {
        lista.forEach(function (m) { m.addedNodes.forEach(genomsok); });
        if (oppen && !document.body.contains(oppen.inp)) stang();
    }).observe(document.documentElement, { childList: true, subtree: true });
    genomsok(document.body);
})();
