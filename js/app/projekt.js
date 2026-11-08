/* ======================================================================
   Projekt, tavlor, knappar och uppstart
   ====================================================================== */

/* ---------- projekt ---------- */

function projektRad(p) {
    const sv = senasteAvslutadeVecka(IDAG);
    const u = projUtfall(p, sv), h = projHinder(p, null, IDAG), atg = kraverAtgard(p, null, IDAG, vaderForAtgard(p));
    const sena = projAvrop(p, null, null, null).filter(r => forsenatAvrop(r, IDAG));
    const faces = p.tavlor.map(t => {
        const av = senasteAvstamning(t), def = av ? lageDef(av.lage) : null;
        return def ? '<span title="' + esc(t.namn + ": " + def.txt + " " + dagNamnKort(av.dag)) + '">' + def.ikon + '</span>' : "";
    }).join(" ");
    return '<div class="projektrad' + (p.id === state.id ? " aktiv" : "") + '" data-p="' + p.id + '">' +
        '<div style="flex:1;min-width:0">' +
        '<div class="pnamn">' + esc(p.projekt) +
        (h.oppna.length ? ' <span class="p4-hindermark' + (h.forfallna.length ? " sen" : "") + '" title="' + h.oppna.length +
            (h.oppna.length === 1 ? " öppet hinder" : " öppna hinder") + '">⚠</span>' : "") +
        ' <span class="pfaces">' + faces + '</span></div>' +
        '<div class="pmeta">' + p.tavlor.length + (p.tavlor.length === 1 ? " tavla · " : " tavlor · ") +
        p.tavlor.map(t => '<button type="button" class="ptavla" data-t="' + p.id + '|' + t.id + '">' + esc(t.namn) + '</button>').join(" · ") +
        '</div>' +
        '<div class="ptal">' +
        '<span>Planpålitlighet v.' + veckonr(sv) + ' <b>' + (u.procent === null ? "–" : u.procent + " %") + '</b></span>' +
        '<span>Öppna hinder <b>' + h.oppna.length + '</b>' +
        (h.forfallna.length ? ' <em class="rodtal">varav ' + h.forfallna.length + ' förfallna</em>' : "") + '</span>' +
        '<span>Försenade avrop <b' + (sena.length ? ' class="rodtal"' : "") + '>' + sena.length + '</b></span>' +
        '<span>Kräver åtgärd <b>' + (atg.totalt || 0) + '</b></span>' +
        '</div></div>' +
        (p.id === state.id ? '<span class="pmeta">Öppet</span>'
            : '<button type="button" class="parkiv" data-ark="' + p.id + '">Arkivera</button>') +
        '</div>';
}

function projektDialog() {
    const lista = aktivaProjekt();
    const arkiverade = plan4.projekt.filter(p => p.arkiverad);
    const kropp = '<p class="hjalp" style="margin-top:0">Klicka på projektet för projektöversikten, ' +
        'eller på en tavla för att gå direkt dit. Varje projekt har egna tavlor, hinder, avrop och ' +
        'inställningar — ingenting delas mellan projekt.</p>' +
        '<div id="projektlista">' + lista.map(projektRad).join("") + '</div>' +
        (arkiverade.length ? '<button type="button" class="visalosta" id="visaArkiv" style="border-top:0">' +
            'Visa arkiverade projekt (' + arkiverade.length + ')</button>' : "");
    modal("Mina projekt", "", kropp, [
        { txt: "Projektinställningar", vanster: true, fn: () => { stangModal(); projektInstallningar(); } },
        { txt: "Stäng", fn: stangModal },
        { txt: "+ Nytt projekt", primar: true, fn: nyttProjektDialog }
    ]);
    document.querySelectorAll("#projektlista .projektrad").forEach(rad => {
        rad.addEventListener("click", e => {
            if (e.target.dataset.ark || e.target.dataset.t)
                return;
            stangModal();
            valjProjekt(rad.dataset.p);
            oppnaDash();
        });
    });
    document.querySelectorAll(".ptavla").forEach(b => b.addEventListener("click", e => {
        e.stopPropagation();
        const [pid, tid] = b.dataset.t.split("|");
        stangModal();
        valjProjekt(pid);
        state.aktiv = tid;
        stangDash();
        spara();
        rita();
    }));
    document.querySelectorAll("[data-ark]").forEach(b => b.addEventListener("click", e => {
        e.stopPropagation();
        arkiveraDialog(b.dataset.ark);
    }));
    const va = document.getElementById("visaArkiv");
    if (va)
        va.addEventListener("click", arkivDialog);
}

function nyttProjektDialog() {
    const kropp = '<div class="falt"><label for="npNamn">Projektets namn</label>' +
        '<input class="f" id="npNamn" placeholder="Sallerupskolan"></div>' +
        '<div class="falt" style="margin-bottom:0"><label for="npTavla">Första tavlan</label>' +
        '<p class="hjalp">Ett litet projekt klarar sig med en tavla. Är produktionen för stor för en ' +
        'gemensam operativ tavla lägger du till fler delområden senare.</p>' +
        '<input class="f" id="npTavla" value="Produktion"></div>';
    modal("Nytt projekt", "", kropp, [
        { txt: "Avbryt", fn: stangModal },
        { txt: "Skapa projekt", primar: true, fn: () => {
                const namn = document.getElementById("npNamn").value.trim();
                if (!namn)
                    return document.getElementById("npNamn").focus();
                const p = nyttProjekt(namn, document.getElementById("npTavla").value.trim() || "Produktion", IDAG);
                rustaProjekt(p, IDAG);
                plan4.projekt.push(p);
                stangModal();
                valjProjekt(p.id);
                status("Projektet " + namn + " skapat");
            } }
    ]);
}

function arkiveraDialog(id) {
    const p = plan4.projekt.find(x => x.id === id);
    if (!p)
        return;
    if (aktivaProjekt().length < 2)
        return status("Det sista projektet kan inte arkiveras");
    const kropp = '<p class="fraga">Arkivera ' + esc(p.projekt) + '?</p>' +
        '<p class="hjalp">Projektet döljs ur listan men ingenting raderas. Du hittar det under ' +
        'Visa arkiverade projekt och kan återställa det när som helst.</p>';
    modal("Arkivera projekt", "", kropp, [
        { txt: "Avbryt", fn: stangModal },
        { txt: "Arkivera", primar: true, fn: () => {
                p.arkiverad = true;
                stangModal();
                spara();
                if (state.id === p.id)
                    valjProjekt(aktivaProjekt()[0].id);
                else
                    projektDialog();
            } }
    ]);
}

function arkivDialog() {
    const arkiverade = plan4.projekt.filter(p => p.arkiverad);
    const kropp = arkiverade.length ? '<div id="arkivlista">' + arkiverade.map(p => {
        const kort = p.tavlor.reduce((n, t) => n + t.kort.length, 0);
        return '<div class="projektrad" style="cursor:default"><div style="flex:1"><div class="pnamn">' + esc(p.projekt) + '</div>' +
            '<div class="pmeta">' + p.tavlor.length + " tavlor · " + kort + ' poster</div></div>' +
            '<button type="button" class="mknapp" data-ater="' + p.id + '">Återställ</button>' +
            '<button type="button" class="parkiv" data-rad="' + p.id + '">Radera permanent</button></div>';
    }).join("") + '</div>' : '<p class="hjalp">Inga arkiverade projekt.</p>';
    modal("Arkiverade projekt", "", kropp, [{ txt: "Tillbaka", primar: true, fn: projektDialog }]);
    document.querySelectorAll("[data-ater]").forEach(b => b.addEventListener("click", () => {
        const p = plan4.projekt.find(x => x.id === b.dataset.ater);
        p.arkiverad = false;
        spara();
        projektDialog();
        status("Projektet återställt");
    }));
    document.querySelectorAll("[data-rad]").forEach(b => b.addEventListener("click", () => raderaProjektDialog(b.dataset.rad)));
}

function raderaProjektDialog(id) {
    const p = plan4.projekt.find(x => x.id === id);
    if (!p)
        return;
    const kort = p.tavlor.reduce((n, t) => n + t.kort.length, 0);
    const hinder = p.tavlor.reduce((n, t) => n + t.hinder.length, 0);
    const kropp = '<div class="notis rod" style="margin-top:0"><b>Detta går inte att ångra.</b><br>' +
        esc(p.projekt) + " innehåller " + p.tavlor.length + " tavlor, " + kort + " poster och " + hinder +
        ' hinder, inklusive all historik.</div>' +
        '<p class="hjalp">Skriv projektets namn för att bekräfta.</p>' +
        '<div class="falt" style="margin-bottom:0"><input class="f" id="rpNamn" placeholder="' + esc(p.projekt) + '"></div>' +
        '<div id="rpFel"></div>';
    modal("Radera projekt permanent", "", kropp, [
        { txt: "Avbryt", primar: true, fn: arkivDialog },
        { txt: "Radera permanent", fara: true, fn: () => {
                if (document.getElementById("rpNamn").value.trim() !== p.projekt) {
                    document.getElementById("rpFel").innerHTML = '<div class="notis rod">Namnet stämmer inte.</div>';
                    return;
                }
                plan4.projekt = plan4.projekt.filter(x => x.id !== p.id);
                spara();
                arkivDialog();
                status("Projektet raderat");
            } }
    ]);
}

function resursbankDialog() {
    const p = state, r = p.resurser;
    const kropp = '<p class="hjalp" style="margin-top:0">Projektets egna yrkesarbetare, gemensamma för alla tavlor. ' +
        'Bara det som behövs för produktionsplaneringen — namn, yrkesgrupp och om personen är aktiv.</p>' +
        '<div class="rubrik2">Yrkesgrupper</div>' +
        (r.kategorier.length ? '<div class="katlista">' + r.kategorier.map(c => '<span class="katchip"><input class="f" data-kat="' + c.id + '" value="' + esc(c.namn) + '">' +
            '<em>' + r.personer.filter(x => x.kategoriId === c.id && x.aktiv).length + ' aktiva</em></span>').join("") + '</div>'
            : '<p class="hjalp">Inga yrkesgrupper ännu. <button type="button" class="parkiv" id="rbForslag">Lägg till förslag: ' +
                'Träarbetare, Betongarbetare, Maskinförare, Övrigt</button></p>') +
        '<div class="bemrad"><input class="f" id="rbNyKat" placeholder="Ny yrkesgrupp"><button type="button" class="mknapp" id="rbLaggKat">Lägg till</button></div>' +
        (r.kategorier.length ? '<div class="rubrik2" style="margin-top:14px">Personer</div>' +
            '<table class="lista"><thead><tr><th>Namn</th><th>Yrkesgrupp</th><th>Aktiv</th><th></th></tr></thead><tbody>' +
            r.personer.slice().sort((a, b) => a.namn.localeCompare(b.namn, "sv")).map(x => '<tr' + (x.aktiv ? "" : ' class="utford"') + '>' +
                '<td><input class="f" data-pn="' + x.id + '" value="' + esc(x.namn) + '"></td>' +
                '<td><select class="f" data-pk="' + x.id + '">' + r.kategorier.map(c => '<option value="' + c.id + '"' +
                (c.id === x.kategoriId ? " selected" : "") + '>' + esc(c.namn) + '</option>').join("") + '</select></td>' +
                '<td><input type="checkbox" data-pa="' + x.id + '"' + (x.aktiv ? " checked" : "") + '></td>' +
                '<td><button type="button" class="parkiv" data-pr="' + x.id + '">Ta bort</button></td></tr>').join("") +
            '</tbody></table>' +
            '<div class="bemrad" style="margin-top:8px"><input class="f" id="rbNyNamn" placeholder="Namn">' +
            '<select class="f" id="rbNyKatVal">' + r.kategorier.map(c => '<option value="' + c.id + '">' + esc(c.namn) + '</option>').join("") + '</select>' +
            '<button type="button" class="mknapp" id="rbLaggPers">Lägg till person</button></div>' : "") +
        '<div id="rbFel"></div>';
    modal("Resurser", p.projekt, kropp, [{ txt: "Klar", primar: true, fn: () => { stangModal(); spara(); rita(); } }]);
    const m = document.querySelector("#overlay .modal");
    if (m)
        m.style.maxWidth = "720px";
    const om = () => { spara(); resursbankDialog(); };
    const f = document.getElementById("rbForslag");
    if (f)
        f.addEventListener("click", () => {
            const patch = opNyaKategorier(["Träarbetare", "Betongarbetare", "Maskinförare", "Övrigt"], null, null);
            if (!patch.ok)
                return;
            if (!appliceraPatch(patch, { tavla: T(), projekt: p }))
                return;
            om();
        });
    document.getElementById("rbLaggKat").addEventListener("click", () => {
        const n = document.getElementById("rbNyKat").value.trim();
        if (!n)
            return;
        if (r.kategorier.some(c => c.namn.toLowerCase() === n.toLowerCase()))
            return document.getElementById("rbFel").innerHTML = '<div class="notis rod">Yrkesgruppen finns redan.</div>';
        const patch = opNyaKategorier([n], null, null);
        if (!patch.ok)
            return;
        if (!appliceraPatch(patch, { tavla: T(), projekt: p }))
            return;
        om();
    });
    document.querySelectorAll("[data-kat]").forEach(e => e.addEventListener("change", () => {
        const c = resKat(p, e.dataset.kat);
        if (c && e.value.trim()) {
            const patch = opAndraKategori(c, { namn: e.value.trim() }, null, null);
            if (patch.ok)
                appliceraPatch(patch, { tavla: T(), projekt: p });
        }
        spara();
    }));
    document.querySelectorAll("[data-pn]").forEach(e => e.addEventListener("change", () => {
        const x = resPers(p, e.dataset.pn);
        if (x && e.value.trim()) {
            const patch = opAndraPerson(x, { namn: e.value.trim() }, null, null);
            if (patch.ok)
                appliceraPatch(patch, { tavla: T(), projekt: p });
        }
        spara();
    }));
    document.querySelectorAll("[data-pk]").forEach(e => e.addEventListener("change", () => {
        const x = resPers(p, e.dataset.pk);
        if (x) {
            const patch = opAndraPerson(x, { kategoriId: e.value }, null, null);
            if (patch.ok)
                appliceraPatch(patch, { tavla: T(), projekt: p });
        }
        spara();
    }));
    document.querySelectorAll("[data-pa]").forEach(e => e.addEventListener("change", () => {
        const x = resPers(p, e.dataset.pa);
        if (x) {
            const patch = opAndraPerson(x, { aktiv: e.checked }, null, null);
            if (patch.ok)
                appliceraPatch(patch, { tavla: T(), projekt: p });
        }
        om();
    }));
    document.querySelectorAll("[data-pr]").forEach(e => e.addEventListener("click", () => raderaPersonDialog(e.dataset.pr)));
    const lp = document.getElementById("rbLaggPers");
    if (lp)
        lp.addEventListener("click", () => {
            const n = document.getElementById("rbNyNamn").value.trim();
            if (!n)
                return document.getElementById("rbNyNamn").focus();
            const patch = opNyPerson(n, document.getElementById("rbNyKatVal").value, null, null);
            if (!patch.ok)
                return;
            if (!appliceraPatch(patch, { tavla: T(), projekt: p }))
                return;
            om();
        });
}

function raderaPersonDialog(pid) {
    const p = state, x = resPers(p, pid);
    if (!x)
        return;
    const anv = personAnvandning(p, pid);
    if (!anv.length) {
        p.resurser.personer = p.resurser.personer.filter(y => y.id !== pid);
        logg("Resurs borttagen: " + x.namn);
        spara();
        return resursbankDialog();
    }
    const kropp = '<div class="notis" style="margin-top:0"><b>' + esc(x.namn) + '</b> är resurssatt på ' + anv.length +
        (anv.length === 1 ? " moment" : " moment") + ':<br>' + anv.slice(0, 6).map(m => esc(momentRef(m))).join("<br>") +
        (anv.length > 6 ? "<br>…" : "") + '</div>' +
        '<p class="hjalp">Gör personen inaktiv i stället — då ligger historiken kvar men personen erbjuds inte i nya moment. ' +
        'Tar du bort personen helt försvinner hen från bemanningen i momenten ovan.</p>';
    modal("Ta bort resurs", "", kropp, [
        { txt: "Ta bort ändå", vanster: true, fara: true, fn: () => {
                anv.forEach(m => {
                    m.kort.bemanning.personer = m.kort.bemanning.personer.filter(y => y !== pid);
                    if (tomBemanning(m.kort.bemanning))
                        m.kort.bemanning = null;
                });
                p.resurser.personer = p.resurser.personer.filter(y => y.id !== pid);
                logg("Resurs borttagen: " + x.namn + " (ur " + anv.length + " moment)");
                stangModal();
                spara();
                resursbankDialog();
            } },
        { txt: "Avbryt", fn: () => { stangModal(); resursbankDialog(); } },
        { txt: "Gör inaktiv", primar: true, fn: () => { x.aktiv = false; stangModal(); spara(); resursbankDialog(); } }
    ]);
}

function foretagDialog() {
    const p = state, reg = p.foretag, ej = ejKoppladeNamn(p);
    const kropp = '<p class="hjalp" style="margin-top:0">Projektets leverantörer och underentreprenörer. ' +
        'Poster kopplas till företaget, så att ett namnbyte slår igenom överallt. Skilt från resursbanken, som gäller egen personal.</p>' +
        (reg.length ? '<table class="lista ftgtabell"><thead><tr><th>Företag</th><th>Roll</th><th>Område</th>' +
            '<th>Kontakt</th><th>Telefon</th><th>E-post</th><th>Aktiv</th><th>Används</th><th></th></tr></thead><tbody>' +
            reg.slice().sort((a, b) => a.namn.localeCompare(b.namn, "sv")).map(f => '<tr' + (f.aktiv ? "" : ' class="utford"') + '>' +
                '<td><input class="f" data-fn="' + f.id + '" value="' + esc(f.namn) + '"></td>' +
                '<td class="rollval">' + FROLLER.map(r => '<label><input type="checkbox" data-fr="' + f.id + '" value="' + r[0] + '"' +
                (f.roller.indexOf(r[0]) >= 0 ? " checked" : "") + '> ' + r[1] + '</label>').join("") + '</td>' +
                ["omrade", "kontakt", "telefon", "epost"].map(n => '<td><input class="f" data-fx="' + f.id + '" data-n="' + n + '" value="' + esc(f[n] || "") + '"></td>').join("") +
                '<td><input type="checkbox" data-fa="' + f.id + '"' + (f.aktiv ? " checked" : "") + '></td>' +
                '<td>' + ftgAnvandning(p, f.id).length + '</td>' +
                '<td><button type="button" class="parkiv" data-fd="' + f.id + '">Ta bort</button></td></tr>').join("") +
            '</tbody></table>' : '<p class="hjalp">Inga företag registrerade ännu.</p>') +
        '<div class="bemrad ftgnyrad"><input class="f" id="frNamn" placeholder="Nytt företag">' +
        '<label><input type="checkbox" id="frLev" checked> Leverantör</label>' +
        '<label><input type="checkbox" id="frUe"> UE</label>' +
        '<button type="button" class="mknapp" id="frLagg">Lägg till</button></div>' +
        '<div id="frFel"></div>' +
        (ej.length ? '<div class="rubrik2" style="margin-top:14px">Ej kopplade namn i projektet</div>' +
            '<p class="hjalp">Fritext från tiden före registret. Plan4 kopplar aldrig automatiskt — öppna momentet eller ' +
            'avropet och välj företag. Samlad koppling kommer i nästa version.</p>' +
            '<ul class="radlista">' + ej.map(x => '<li>' + esc(x.namn) + ' · ' + x.antal + (x.antal === 1 ? " rad" : " rader") + '</li>').join("") + '</ul>' : "");
    modal("Företag", p.projekt, kropp, [{ txt: "Klar", primar: true, fn: () => { stangModal(); spara(); rita(); } }]);
    const m = document.querySelector("#overlay .modal");
    if (m)
        m.style.maxWidth = "1100px";
    const om = () => { spara(); foretagDialog(); };
    const fel = txt => { document.getElementById("frFel").innerHTML = txt ? '<div class="notis rod">' + txt + '</div>' : ""; };
    document.getElementById("frLagg").addEventListener("click", () => {
        const namn = document.getElementById("frNamn").value.trim();
        if (!namn)
            return document.getElementById("frNamn").focus();
        const d = ftgDubblett(p, namn);
        if (d)
            return fel(esc(d.namn) + " finns redan i registret.");
        const roller = [];
        if (document.getElementById("frLev").checked)
            roller.push("leverantor");
        if (document.getElementById("frUe").checked)
            roller.push("ue");
        const f = nyttForetag(p, namn, roller);
        logg("Företag registrerat: " + f.namn);
        om();
    });
    document.querySelectorAll("[data-fn]").forEach(e => e.addEventListener("change", () => {
        const f = ftgPost(p, e.dataset.fn), namn = e.value.trim();
        if (!f)
            return;
        if (!namn) {
            e.value = f.namn;
            return;
        }
        const d = ftgDubblett(p, namn, f.id);
        if (d) {
            e.value = f.namn;
            return fel(esc(d.namn) + " finns redan — namnet ändrades inte.");
        }
        const patch = opAndraForetag(f, { namn: namn }, null, null);
        if (!patch.ok)
            return;
        if (!appliceraPatch(patch, { tavla: T(), projekt: p }))
            return;
        patch.historik.forEach(h => logg(h));
        fel("");
        spara();
        rita();
    }));
    document.querySelectorAll("[data-fr]").forEach(e => e.addEventListener("change", () => {
        const f = ftgPost(p, e.dataset.fr);
        if (!f)
            return;
        const roller = Array.prototype.slice.call(document.querySelectorAll('[data-fr="' + f.id + '"]:checked')).map(x => x.value);
        const patch = opAndraForetag(f, { roller: roller }, null, null);
        if (!patch.ok)
            return;
        if (!appliceraPatch(patch, { tavla: T(), projekt: p }))
            return;
        spara();
    }));
    document.querySelectorAll("[data-fx]").forEach(e => e.addEventListener("change", () => {
        const f = ftgPost(p, e.dataset.fx);
        if (!f)
            return;
        const patch = opAndraForetag(f, { [e.dataset.n]: e.value.trim() }, null, null);
        if (!patch.ok)
            return;
        if (!appliceraPatch(patch, { tavla: T(), projekt: p }))
            return;
        spara();
    }));
    document.querySelectorAll("[data-fa]").forEach(e => e.addEventListener("change", () => {
        const f = ftgPost(p, e.dataset.fa);
        if (!f)
            return;
        const patch = opAndraForetag(f, { aktiv: e.checked }, null, null);
        if (!patch.ok)
            return;
        if (!appliceraPatch(patch, { tavla: T(), projekt: p }))
            return;
        om();
    }));
    document.querySelectorAll("[data-fd]").forEach(e => e.addEventListener("click", () => raderaForetagDialog(e.dataset.fd)));
}

function raderaForetagDialog(id) {
    const p = state, f = ftgPost(p, id);
    if (!f)
        return;
    const anv = ftgAnvandning(p, id);
    if (!anv.length) {
        const patch = opTaBortForetag(f);
        if (appliceraPatch(patch, { tavla: T(), projekt: p }))
            patch.historik.forEach(h => logg(h));
        spara();
        return foretagDialog();
    }
    const kropp = '<div class="notis" style="margin-top:0"><b>' + esc(f.namn) + '</b> används på ' + anv.length +
        (anv.length === 1 ? " rad" : " rader") + ':<br>' + anv.slice(0, 6).map(x => esc((x.rad.txt || "–") + " · " + x.tavla.namn)).join("<br>") +
        (anv.length > 6 ? "<br>…" : "") + '</div>' +
        '<p class="hjalp">Gör företaget inaktivt i stället — då ligger kopplingarna kvar men företaget erbjuds inte i nya poster. ' +
        'Tar du bort det helt behåller raderna företagsnamnet som text, men kopplingen till registret försvinner.</p>';
    modal("Ta bort företag", "", kropp, [
        { txt: "Ta bort ändå", vanster: true, fara: true, fn: () => {
                const patch = opTaBortForetagMedAnvandning(p, f);
                if (appliceraPatch(patch, { tavla: T(), projekt: p }))
                    patch.historik.forEach(h => logg(h));
                stangModal();
                spara();
                rita();
                foretagDialog();
            } },
        { txt: "Avbryt", fn: () => { stangModal(); foretagDialog(); } },
        { txt: "Gör inaktivt", primar: true, fn: () => { f.aktiv = false; stangModal(); spara(); foretagDialog(); } }
    ]);
}

function projektInstallningar() {
    const kropp = '<div class="falt"><label for="piNamn">Projektets namn</label>' +
        '<input class="f" id="piNamn" value="' + esc(state.projekt) + '"></div>' +
        '<p class="fraga" style="font-size:14px;margin-top:18px">Projektlogotyp</p>' +
        '<p class="hjalp">Visas i toppraden, i visningsläget och på utskrifter. Bilden skalas ner automatiskt.</p>' +
        '<div class="loggaval">' +
        (state.logotyp ? '<img id="tmLoggaBild" src="' + state.logotyp + '" alt="">' : '<span class="hjalp" id="tmLoggaBild" style="margin:0">Ingen logotyp vald</span>') +
        '<button type="button" class="mknapp" id="tmLoggaValj">' + (state.logotyp ? "Byt bild" : "Välj bild") + '</button>' +
        (state.logotyp ? '<button type="button" class="mknapp fara" id="tmLoggaBort">Ta bort bild</button>' : "") +
        '<input type="file" id="tmLoggaFil" accept="image/png,image/jpeg,image/webp" hidden>' +
        '</div><div id="tmLoggaFel"></div>' +
        '<p class="fraga" style="font-size:14px;margin-top:18px">Tavlor</p>' +
        '<p class="hjalp">Namn, första veckans måndag och om pågående moment ska visas, för varje tavla.</p>' +
        '<ul class="pi-tavlor">' + state.tavlor.map(t => '<li><span><b>' + esc(t.namn) + '</b><small>Från ' + esc(kortDatum(t.start)) +
            ' · v' + veckonr(t.start) + (t.visaPagaende ? " · Pågående visas" : "") + '</small></span>' +
            '<button type="button" class="mknapp" data-tavlainst="' + t.id + '">Inställningar…</button></li>').join("") + '</ul>' +
        '<p class="fraga" style="font-size:14px;margin-top:18px">Företag</p>' +
        '<p class="hjalp">' + state.foretag.filter(f => f.aktiv).length + ' aktiva leverantörer och UE. ' +
        '<button type="button" class="parkiv" id="piForetag">Hantera företag</button></p>' +
        '<p class="fraga" style="font-size:14px;margin-top:18px">Resurser</p>' +
        '<p class="hjalp">' + state.resurser.personer.filter(x => x.aktiv).length + ' aktiva personer i ' +
        state.resurser.kategorier.length + ' yrkesgrupper. <button type="button" class="parkiv" id="piResurser">Hantera resurser</button></p>' +
        '<div class="falt" style="margin-top:18px"><label for="piOrt">Ort för väderprognos</label>' +
        '<p class="hjalp">Gäller projektets alla tavlor. Lämnar du fältet tomt visas vädret för Malmö.</p>' +
        '<input class="f" id="piOrt" value="' + esc(state.plats ? state.plats.namn : "") + '" placeholder="Malmö"></div>' +
        (vaderFel ? '<div class="notis rod">' + vaderFel + '</div>' : "") +
        '<p class="fraga" style="font-size:14px;margin-top:18px">Vädervarningar</p>' +
        '<p class="hjalp">Projektets egna produktionsvarningar — inte officiella vädervarningar. ' +
        'Inget är aktivt förrän du väljer det.</p>' +
        '<div id="varningsinst">' + VARNINGSTYPER.map(t => {
        const inst = (state.varningar || {})[t.id] || { pa: false, varde: t.std };
        return '<label class="vinst" data-v="' + t.id + '"><input type="checkbox" ' + (inst.pa ? "checked" : "") + '>' +
            '<span class="vnamn2">' + t.namn + '</span>' +
            '<input class="f vvarde" type="number" step="0.5" value="' + esc(String(inst.varde)) + '">' +
            '<span class="venhet">' + t.enhet + '</span></label>';
    }).join("") + '</div>';
    modal("Projektinställningar", state.projekt, kropp, [
        { txt: "Arkivera projekt", vanster: true, fara: true, fn: () => { stangModal(); arkiveraDialog(state.id); } },
        { txt: "Avbryt", fn: stangModal },
        { txt: "Spara", primar: true, fn: async () => {
                state.projekt = document.getElementById("piNamn").value.trim() || state.projekt;
                document.querySelectorAll("#varningsinst .vinst").forEach(rad => {
                    state.varningar[rad.dataset.v] = { pa: rad.querySelector('input[type="checkbox"]').checked,
                        varde: parseFloat(rad.querySelector(".vvarde").value) || 0 };
                });
                const ort = document.getElementById("piOrt").value.trim();
                stangModal();
                if (!ort) {
                    state.plats = null;
                    VADER = {};
                    hamtaVader(true);
                }
                else if (!state.plats || state.plats.namn.toLowerCase() !== ort.toLowerCase()) {
                    status("Slår upp " + ort + "…");
                    try {
                        const träff = await slaUppOrt(ort);
                        if (träff) {
                            state.plats = träff;
                            VADER = {};
                            hamtaVader(true);
                            status("Väder för " + träff.namn);
                        }
                        else
                            status("Hittade ingen ort som heter " + ort);
                    }
                    catch (e) {
                        status("Kunde inte slå upp orten — ingen internetanslutning?");
                    }
                }
                spara();
                rita();
            } }
    ]);
    koppplaLogga();
    document.querySelectorAll("[data-tavlainst]").forEach(b => b.addEventListener("click", () => {
        const t = state.tavlor.find(x => x.id === b.dataset.tavlainst);
        if (t) tavlaInstallningar(t);
    }));
    const pf = document.getElementById("piForetag");
    if (pf)
        pf.addEventListener("click", () => { stangModal(); foretagDialog(); });
    const pr = document.getElementById("piResurser");
    if (pr)
        pr.addEventListener("click", () => { stangModal(); resursbankDialog(); });
}

/* ---------- veckor och tavlor ---------- */

function kopieraVecka(v) {
    const t = T(), vStart = plus(visaStart(), v * 7), vSlut = plus(vStart, 4);
    const kall = t.kort.filter(k => k.dag >= vStart && k.dag <= vSlut);
    const kropp = '<p class="fraga">Kopiera v' + veckonr(vStart) + ' till en annan vecka</p>' +
        '<p class="hjalp">Underlag för den nya veckan — rensa och skärp den sedan vid veckoplaneringen. Avbockningar och orsaksord följer inte med.</p>' +
        '<div class="falt"><label for="kMal">Till vecka</label><select class="f" id="kMal">' +
        [0, 1, 2, 3].filter(i => i !== v).map(i => '<option value="' + i + '">v' + veckonr(plus(visaStart(), i * 7)) + " (" + kortDatum(plus(visaStart(), i * 7)) + "–" + kortDatum(plus(visaStart(), i * 7 + 4)) + ")</option>").join("") +
        '</select></div>' +
        '<div class="falt"><label><input type="checkbox" id="kBara" checked> Bara det som inte är avbockat (' + kall.filter(k => !k.klar).length + " av " + kall.length + ' poster)</label></div>' +
        '<div class="falt"><label><input type="checkbox" id="kRensa"> Töm målveckan först</label></div>';
    modal("Kopiera vecka", "", kropp, [
        { txt: "Avbryt", fn: stangModal },
        { txt: "Kopiera", primar: true, fn: () => {
                const mal = +document.getElementById("kMal").value;
                const bara = document.getElementById("kBara").checked;
                const mStart = plus(visaStart(), mal * 7);
                const patch = opKopieraVecka(t, { kall: kall, vStart: vStart, mStart: mStart,
                    diff: (mal - v) * 7, bara: bara, rensa: document.getElementById("kRensa").checked }, null, null);
                if (!patch.ok)
                    return;
                if (!appliceraPatch(patch, { tavla: t, projekt: state }))
                    return;
                patch.historik.forEach(h => logg(h));
                stangModal();
                spara();
                rita();
                status("Veckan kopierad");
            } }
    ]);
}

function rullaTavla(t) {
    angraForeAvbryt();
    logg2(t, "Ny vecka: v" + veckonr(plus(t.start, 28)));
    t.start = plus(t.start, 7);
    t.skippa = t.skippa.filter(x => x.split("|")[1] >= t.start);
}

function logg2(t, txt) {
    t.historik.unshift(typeof txt === "object" && txt
        ? { id: txt.id, tid: txt.tid, txt: txt.txt }
        : { id: uid(), tid: nu(), txt: txt });
    if (t.historik.length > 300)
        t.historik.length = 300;
}

document.getElementById("rullaFram").addEventListener("click", () => {
    const t = T();
    const grupp = state.tavlor.filter(x => x.start === t.start);
    const andra = osynkade(state, T());
    const kvar = grupp.reduce((n, x) => n + x.kort.filter(k => k.dag <= plus(x.start, 4) && !k.klar).length, 0);
    const kropp = '<p class="fraga">v' + veckonr(plus(t.start, 28)) + ' kommer in längst ner</p>' +
        '<p class="hjalp">Tavlan visar alltid fyra veckor. En ny vecka skapas genom att planeringen flyttas ett steg framåt: v' +
        veckonr(t.start) + ' lämnar tavlan och v' + veckonr(plus(t.start, 28)) + ' kommer in som ny förberedelsevecka. ' +
        'Gör det på fredagens veckoplanering. Vill du fylla den nya veckan med förra veckans innehåll — använd ⧉ i veckohuvudet efteråt.</p>' +
        (grupp.length > 1 ? '<div class="notis gron">Rullas för ' + grupp.length + ' tavlor i projektet: ' +
            grupp.map(x => esc(x.namn)).join(", ") + '. Delområdena ska ligga på samma period.</div>' : "") +
        (andra.length ? '<div class="notis">Ligger på annan period och berörs inte: ' +
            andra.map(x => esc(x.namn) + " (v" + veckonr(x.start) + ")").join(", ") + '.</div>' : "") +
        (kvar ? '<div class="notis rod"><b>' + kvar + ' poster i v' + veckonr(t.start) + ' är inte avbockade.</b> Flytta dem framåt med orsak i stället — annars försvinner de ur vyn utan spår.</div>' : "");
    const knappar = [{ txt: "Avbryt", fn: stangModal }];
    if (andra.length)
        knappar.push({ txt: "Synka alla till v" + veckonr(plus(t.start, 7)), fn: () => {
                grupp.forEach(rullaTavla);
                const mal = t.start;
                andra.forEach(x => { logg2(x, "Synkad till v" + veckonr(mal)); x.start = mal; x.skippa = x.skippa.filter(y => y.split("|")[1] >= mal); });
                vyOffset = 0;
                stangModal();
                spara();
                rita();
                status("Alla tavlor på v" + veckonr(mal));
            } });
    knappar.push({ txt: grupp.length > 1 ? "Rulla " + grupp.length + " tavlor" : "Lägg till v" + veckonr(plus(t.start, 28)), primar: true, fn: () => {
            grupp.forEach(rullaTavla);
            vyOffset = 0;
            stangModal();
            spara();
            rita();
        } });
    modal("Ny vecka", "", kropp, knappar);
});

function nyTavlaDialog() {
    const kropp = '<div class="falt"><label for="ntNamn">Vad heter tavlan?</label>' +
        '<p class="hjalp">En tavla per etapp, huskropp eller disciplin — t.ex. "Hus A stomme" eller "Mark".</p>' +
        '<input class="f" id="ntNamn" placeholder="Hus A stomme"></div>';
    modal("Ny tavla", "Flera tavlor kan ligga i samma projekt.", kropp, [
        { txt: "Avbryt", fn: stangModal },
        { txt: "Skapa tavla", primar: true, fn: () => {
                const n = document.getElementById("ntNamn").value.trim() || "Tavla " + (state.tavlor.length + 1);
                const ny = nyTavla(n, IDAG);
                ny.start = T().start;
                state.tavlor.push(ny);
                state.aktiv = ny.id;
                stangModal();
                spara();
                rita();
            } }
    ]);
}

document.getElementById("nyTavlaKnapp").addEventListener("click", nyTavlaDialog);

// Tavlans inställningar: öppnas från Projektinställningar → Tavlor.
function tavlaInstallningar(t) {
    t = t || T();
    const kropp = '<div class="falt"><label for="tmNamn">Tavlans namn</label><input class="f" id="tmNamn" value="' + esc(t.namn) + '"></div>' +
        '<div class="falt"><label for="tmStart">Första veckans måndag</label><input class="f" id="tmStart" type="date" value="' + t.start + '"></div>' +
        '<div class="falt"><label class="kryssrad"><input type="checkbox" id="tmPagaende"' + (t.visaPagaende ? " checked" : "") +
        '> Visa pågående moment</label><p class="hjalp" style="margin:3px 0 0">Visar flerdagarsmoment kompakt på dagarna ' +
        'mellan start och klart. Påverkar inga siffror.</p></div>' +
        '<p class="hjalp">Logotyp, väderort och vädervarningar är gemensamma för projektet och ligger under Projektinställningar.</p>' +
        '<p class="hjalp" style="margin-top:14px">' + t.kort.length + ' poster · ' + t.aterkom.length + ' återkommande · ' +
        t.hinder.length + ' hinder · ' + t.historik.length + ' händelser.</p>';
    const varning = lagringslage === "ingen"
        ? '<div class="notis rod">Webbläsaren kan inte spara en lokal kopia. Ändringarna sparas i molnet så länge du är uppkopplad.</div>'
        : '<p class="hjalp" style="margin-top:14px">Data sparas i molnet, med en kopia på den här datorn.</p>';
    modal("Tavlan", state.projekt, kropp + varning, [
        { txt: "Ta bort tavlan", vanster: true, fara: true, fn: () => {
                if (state.tavlor.length < 2)
                    return status("Sista tavlan kan inte tas bort");
                state.tavlor = state.tavlor.filter(x => x.id !== t.id);
                state.aktiv = state.tavlor[0].id;
                stangModal();
                spara();
                rita();
            } },
        { txt: "Avbryt", fn: stangModal },
        { txt: "Spara", primar: true, fn: () => {
                t.namn = document.getElementById("tmNamn").value.trim() || t.namn;
                t.visaPagaende = document.getElementById("tmPagaende").checked;
                const d = document.getElementById("tmStart").value;
                if (d && d2iso(mandag(iso2d(d))) !== t.start) {
                    t.start = d2iso(mandag(iso2d(d)));
                    vyOffset = 0;
                }
                stangModal();
                spara();
                rita();
            } }
    ]);
}

function koppplaLogga() {
    const valj = document.getElementById("tmLoggaValj"), fil = document.getElementById("tmLoggaFil");
    if (valj)
        valj.addEventListener("click", () => fil.click());
    if (fil)
        fil.addEventListener("change", e => {
            const f = e.target.files[0];
            e.target.value = "";
            const fel = document.getElementById("tmLoggaFel");
            fel.innerHTML = '<p class="hjalp">Bearbetar bilden…</p>';
            laddaLogga(f, (data, felmed) => {
                if (felmed) {
                    fel.innerHTML = '<div class="notis rod">' + esc(felmed) + '</div>';
                    return;
                }
                state.logotyp = data;
                fel.innerHTML = '<p class="hjalp">Logotyp sparad (' + Math.round(data.length / 1024) + ' kB).</p>';
                const bild = document.getElementById("tmLoggaBild");
                if (bild && bild.tagName === "IMG")
                    bild.src = data;
                else if (bild) {
                    const ny = document.createElement("img");
                    ny.id = "tmLoggaBild";
                    ny.src = data;
                    bild.replaceWith(ny);
                }
                spara();
                ritaLogga();
            });
        });
    const bort = document.getElementById("tmLoggaBort");
    if (bort)
        bort.addEventListener("click", () => {
            delete state.logotyp;
            document.getElementById("tmLoggaFel").innerHTML = '<p class="hjalp">Logotypen är borttagen.</p>';
            const bild = document.getElementById("tmLoggaBild");
            if (bild) {
                const ny = document.createElement("span");
                ny.id = "tmLoggaBild";
                ny.className = "hjalp";
                ny.textContent = "Ingen logotyp vald";
                bild.replaceWith(ny);
            }
            bort.remove();
            spara();
            ritaLogga();
        });
}

/* ---------- topprad ---------- */

document.getElementById("snabbPostKnapp").addEventListener("click", () => snabbPost(IDAG));
document.getElementById("planeraKnapp").addEventListener("click", () => planeraMoment(IDAG));
document.getElementById("bakat").addEventListener("click", () => { vyOffset--; rita(); });
document.getElementById("framat").addEventListener("click", () => { vyOffset++; rita(); });

document.getElementById("idagKnapp").addEventListener("click", () => {
    vyOffset = Math.round((mandag(new Date()) - iso2d(T().start)) / 86400000 / 7);
    rita();
});

document.getElementById("tillPlanen").addEventListener("click", () => { vyOffset = 0; rita(); });
document.getElementById("synkchip").addEventListener("click", () => document.getElementById("rullaFram").click());
document.getElementById("angraKnapp").addEventListener("click", angraForeFlytt);
document.getElementById("kedjechip").addEventListener("click", () => { valdKedja = null; rita(); });

document.getElementById("pagaendeKnapp").addEventListener("click", () => {
    const t = T();
    t.visaPagaende = !t.visaPagaende;
    spara();
    rita();
});

document.querySelectorAll("#veckoval button").forEach(b => b.addEventListener("click", () => {
    visaVeckor = +b.dataset.v;
    rita();
}));

document.getElementById("projektknapp").addEventListener("click", projektDialog);
document.getElementById("tavlanamn").addEventListener("change", e => { T().namn = e.target.value.trim() || T().namn; spara(); rita(); });
document.getElementById("skrivUt").addEventListener("click", utskriftDialog);
document.getElementById("avropKnapp").addEventListener("click", avropDialog);
document.getElementById("resursKnapp").addEventListener("click", resursVy);

function vaxlaVisning(pa) {
    if (pa === undefined)
        pa = !document.body.classList.contains("visning");
    if (pa) {
        visaVeckor = 1;
        // visningsläget visar bara tavlan: stäng Gantt, Back up, översikter och kontosidan först
        try {
            if (ganttOppen()) stangGantt();
            if (dashOppen()) stangDash();
            if (startOppen()) stangStart();
            if (typeof backupOppen === "function" && backupOppen()) stangBackup();
        }
        catch (e) { }
        document.body.classList.remove("p4-kontovy", "dashlage");
        if (window.p4MarkeraNav) window.p4MarkeraNav();
    }
    document.body.classList.toggle("visning", pa);
    rita();
    document.getElementById("visning").textContent = pa ? "Avsluta visning" : "Visningsläge";
    try {
        if (pa && !document.fullscreenElement && document.documentElement.requestFullscreen)
            document.documentElement.requestFullscreen().catch(() => { });
        if (!pa && document.fullscreenElement && document.exitFullscreen)
            document.exitFullscreen().catch(() => { });
    }
    catch (e) { }
}

document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement && document.body.classList.contains("visning"))
        vaxlaVisning(false);
});

document.getElementById("visning").addEventListener("click", () => vaxlaVisning());

document.getElementById("hLagg").addEventListener("click", () => {
    const vad = document.getElementById("hVad").value.trim();
    if (!vad)
        return;
    const vem = document.getElementById("hVem").value.trim();
    const nar = document.getElementById("hNar").value;
    const t = T();
    const patch = opNyttHinder(vad, vem, nar, null, null, null);
    if (!appliceraPatch(patch, { tavla: t, projekt: state }))
        return;
    ["hVad", "hVem", "hNar"].forEach(i => document.getElementById(i).value = "");
    document.getElementById("hVad").focus();
    spara();
    ritaHinder();
});

["hVad", "hVem", "hNar"].forEach(i => document.getElementById(i).addEventListener("keydown", e => {
    if (e.key === "Enter")
        document.getElementById("hLagg").click();
}));

TYPER.forEach(t => document.getElementById("v-" + t).addEventListener("change", filtrera));


/* ---------- start ---------- */

(async function () {
    const sparad = await las();
    const migrerad = sparad && sparad.tavlor && sparad.tavlor.length;
    if (!laddaRot(sparad)) {
        const p = nyttProjekt("Projekt", "Produktion", IDAG);
        plan4 = { version: VERSION, aktivtProjekt: p.id, projekt: [p] };
        state = p;
        rustaProjekt(p, IDAG);
        await sparaNu();
        if (lagringslage === "ingen")
            status("Ingen lokal lagring i den här webbläsaren — ändringar sparas bara i molnet", true);
        else if (lagringslage === "lokal")
            status("Sparas lokalt på denna dator");
    }
    else if (migrerad) {
        logg("Projektstruktur införd — tavlorna ligger nu i projektet " + state.projekt);
        await sparaNu();
    }
    rita();
})();
