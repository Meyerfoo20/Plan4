/* ======================================================================
   Projektöversikt och Att göra
   ====================================================================== */

/* ---------- projektöversikt: beräkningar ---------- */

function vaderForAtgard(p) { return p === state ? vaderVarningarPeriod(IDAG, 10) : []; }

/* ---------- projektstart: vyn ---------- */

let startSort = "deadline";

function oppnaStart(markera) {
    stangDash();
    document.body.classList.add("dashlage");
    document.getElementById("pstart").classList.remove("dold");
    ritaStart(markera);
}

function stangStart() {
    document.getElementById("pstart").classList.add("dold");
    if (!dashOppen())
        document.body.classList.remove("dashlage");
}

function startOppen() { return !document.getElementById("pstart").classList.contains("dold"); }

function aktivitetRad(p, a, markera) {
    const h = fHinder(p, a), ov = fOverford(p, a), sen = fForfallen(a, IDAG);
    const nar = a.fas === "fore" ? (a.deadline ? kortDatum(a.deadline) : "–") :
        ("v" + (a.vecka || 1) + (p.forberedelse.byggstart ? " · " + kortDatum(fVeckaMandag(p, a.vecka)) : ""));
    return '<tr data-a="' + a.id + '" class="' + (sen ? "sen " : "") + (fKlar(a) ? "utford " : "") + (a.id === markera ? "markerad" : "") + '">' +
        '<td><button type="button" class="fstat ' + (a.status === "Klar" ? "klar" : a.status === "Pågår" ? "pagar" : a.status === "Ej aktuell" ? "ejakt" : "ej") +
        '" data-stat="' + a.id + '" title="Byt status">' + esc(a.status) + '</button></td>' +
        '<td><b>' + esc(a.titel) + '</b>' + (a.kommentar ? '<span class="fkom">' + esc(a.kommentar) + '</span>' : "") +
        (h ? '<span class="fkopp">↳ hinder' + (h.hinder.status === "lost" ? " (löst)" : "") + " · " + esc(h.tavla.namn) + '</span>' : "") +
        (ov ? '<span class="fkopp">↳ överförd till ' + esc(ov.tavla.namn) + " " + kortDatum(ov.kort.dag) + '</span>' : "") +
        (fKalender(p, a) ? '<span class="fkopp">📅 visas i kalendern · ' + esc(fKalender(p, a).tavla.namn) + " " + kortDatum(a.kalender.dag) + '</span>' : "") + '</td>' +
        '<td>' + esc(a.kategori || "Övrigt") + '</td><td>' + esc(a.ansvarig || "–") + '</td>' +
        '<td class="dat">' + nar + (sen ? ' <span class="rodtal">förfallen</span>' : "") + '</td></tr>';
}

function ritaStart(markera) {
    const p = state, fb = p.forberedelse, l = fLage(p, IDAG);
    const sortera = lista => lista.slice().sort((a, b) => {
        if (startSort === "kategori" && a.kategori !== b.kategori)
            return FKAT.indexOf(a.kategori) - FKAT.indexOf(b.kategori);
        if (fKlar(a) !== fKlar(b))
            return fKlar(a) ? 1 : -1;
        const da = a.fas === "fore" ? (a.deadline || "9999") : String(a.vecka || 9), db = b.fas === "fore" ? (b.deadline || "9999") : String(b.vecka || 9);
        return da < db ? -1 : da > db ? 1 : 0;
    });
    const fore = sortera(fAktiviteter(p).filter(a => a.fas === "fore"));
    const start = fAktiviteter(p).filter(a => a.fas === "start");
    let html = '<div class="dashtopp">' +
        (p.logotyp ? '<img class="logga" src="' + p.logotyp + '" alt="">' : "") +
        '<b>Wimo</b><span class="punkt">·</span><span class="dashprojekt">' + esc(p.projekt) + '</span>' +
        '<span class="dashrub">Att göra</span>' +
        '<div class="hoger">' +
        '<button class="navknapp" id="psNy">+ Att göra</button>' +
        '<button class="navknapp" id="psSkrivUt">Skriv ut</button>' +
        '<button class="navknapp" id="psStang">Stäng</button>' +
        '</div></div>';
    html += '<p class="hjalp" style="margin:0 0 6px">Projektets uppföljningslista — det som ska göras men inte är ett ' +
        'produktionsmoment: beställningar, besked, bokningar, kontroller. Förfallna punkter syns i Projektöversikten. ' +
        'En punkt kan också visas i kalendern.</p>';
    html += '<div class="lagesrad">' + l.foreKlara + " av " + l.fore + " klara" +
        (l.forfallna ? ' · <span class="rodtal">' + l.forfallna + " förfallna</span>" : "") + '</div>';
    html += '<div class="dashblock"><h3>Att göra' +
        '<span class="antal">Sortera <select class="f dashval" id="psSort">' +
        '<option value="deadline"' + (startSort === "deadline" ? " selected" : "") + '>Efter deadline</option>' +
        '<option value="kategori"' + (startSort === "kategori" ? " selected" : "") + '>Efter kategori</option></select></span></h3>' +
        (fore.length ? '<table class="lista fatabell"><thead><tr><th>Status</th><th>Att göra</th><th>Kategori</th>' +
            '<th>Ansvarig</th><th>Deadline</th></tr></thead><tbody>' + fore.map(a => aktivitetRad(p, a, markera)).join("") + '</tbody></table>'
            : '<p class="hjalp">Inget att göra ännu. Exempel: Beställ etableringsskylt, Boka mobilkran, Få besked om kulör, ' +
                'Följ upp ÄTA, Boka besiktning.</p>') + '</div>';
    if (start.length) {
        html += '<details class="dashblock"><summary><b>Äldre byggstartsplan (' + start.length + ')</b> ' +
            '<span class="hjalp" style="display:inline">— från tidigare version, visas så att inget försvinner</span></summary>' +
            '<table class="lista fatabell" style="margin-top:8px"><tbody>' + sortera(start).map(a => aktivitetRad(p, a, markera)).join("") +
            '</tbody></table></details>';
    }
    html += '<p class="dashfot">Att göra ingår inte i planpålitligheten, Veckans utfall, resursplaneringen eller avropen — ' +
        'inte heller när en punkt visas i kalendern.</p>';
    const box = document.getElementById("pstart");
    box.innerHTML = html;
    document.getElementById("psStang").addEventListener("click", stangStart);
    document.getElementById("psNy").addEventListener("click", () => aktivitetDialog(null));
    document.getElementById("psSkrivUt").addEventListener("click", () => skrivUtProjektstart(p));
    document.getElementById("psSort").addEventListener("change", e => { startSort = e.target.value; ritaStart(); });
    box.querySelectorAll("[data-stat]").forEach(b => b.addEventListener("click", e => {
        e.stopPropagation();
        const a = fAktiviteter(p).find(x => x.id === b.dataset.stat);
        if (!a)
            return;
        a.status = FSTATUS[(FSTATUS.indexOf(a.status) + 1) % FSTATUS.length];
        spara();
        ritaStart();
        rita();
    }));
    box.querySelectorAll("tr[data-a]").forEach(tr => tr.addEventListener("click", () => {
        const a = fAktiviteter(p).find(x => x.id === tr.dataset.a);
        if (a)
            aktivitetDialog(a);
    }));
}

function aktivitetDialog(a, forval) {
    const p = state, ny = !a, f = forval || {};
    const b = a || { fas: "fore", kategori: f.kategori || FKAT[0], status: "Ej påbörjad", vecka: 1 };
    let fas = b.fas;
    const kal = b.kalender || null;
    const h = a ? fHinder(p, a) : null, ov = a ? fOverford(p, a) : null;
    const kropp = '<div class="falt"><label for="faTitel">Aktivitet</label>' +
        '<input class="f" id="faTitel" value="' + esc(b.titel || "") + '" placeholder="Beställ byggbodar"></div>' +
        (fas === "start" ? '<div class="notis" style="margin-top:0">Punkt från den äldre byggstartsplanen (vecka ' + (b.vecka || 1) +
            '). Den kan fortfarande överföras till en tavla.</div>' : "") +
        '<div class="tva"><div class="falt"><label for="faKat">Kategori</label><select class="f" id="faKat">' +
        FKAT.map(k => '<option' + (k === b.kategori ? " selected" : "") + '>' + k + '</option>').join("") + '</select></div>' +
        '<div class="falt"><label for="faStatus">Status</label><select class="f" id="faStatus">' +
        FSTATUS.map(k => '<option' + (k === b.status ? " selected" : "") + '>' + k + '</option>').join("") + '</select></div></div>' +
        '<div class="tva"><div class="falt"><label for="faAnsv">Ansvarig</label>' +
        '<input class="f" id="faAnsv" value="' + esc(b.ansvarig || "") + '" placeholder="Namn eller roll"></div>' +
        '<div class="falt" id="faDeadF"><label for="faDead">Deadline</label>' +
        '<input class="f" id="faDead" type="date" value="' + esc(b.deadline || "") + '"></div>' +
        '<div class="falt" id="faVeckaF"><label for="faVecka">Vecka efter byggstart</label><select class="f" id="faVecka">' +
        [1, 2, 3, 4].map(v => '<option value="' + v + '"' + (v === (b.vecka || 1) ? " selected" : "") + '>Vecka ' + v + '</option>').join("") + '</select></div></div>' +
        '<div class="falt"><label for="faKom">Kommentar</label><input class="f" id="faKom" value="' + esc(b.kommentar || "") + '"></div>' +
        '<div class="falt"><label class="kryssrad"><input type="checkbox" id="faKal"' + (kal ? " checked" : "") + '> Visa även i kalendern</label>' +
        '<div class="tva' + (kal ? "" : " dold") + '" id="faKalF" style="margin-top:6px">' +
        '<div class="falt"><label for="faKalTavla">Tavla</label><select class="f" id="faKalTavla">' +
        p.tavlor.map(t => '<option value="' + t.id + '"' + ((kal ? kal.tavlaId : p.aktiv) === t.id ? " selected" : "") + '>' + esc(t.namn) + '</option>').join("") +
        '</select></div>' +
        '<div class="falt"><label for="faKalDag">Datum</label><input class="f" id="faKalDag" type="date" value="' +
        esc(kal ? kal.dag : (b.deadline || IDAG)) + '"></div></div>' +
        '<p class="hjalp" style="margin:4px 0 0">Punkten visas som en påminnelse på tavlan. Den räknas inte som produktion.</p></div>' +
        (h ? '<div class="notis">Kopplat hinder på ' + esc(h.tavla.namn) + ': ' + esc(h.hinder.vad) +
            (h.hinder.status === "lost" ? " — löst" : " — öppet") + '</div>' : "") +
        (ov ? '<div class="notis gron">Överförd till ' + esc(ov.tavla.namn) + " · " + esc(ov.kort.text) + " · " + dagEtikett(ov.kort.dag) +
            '. Den posten är nu en vanlig produktionspost.</div>' : "") +
        '<div id="faFel"></div>';
    const knappar = [];
    if (!ny)
        knappar.push({ txt: "Ta bort", vanster: true, fara: true, fn: () => {
                p.forberedelse.aktiviteter = p.forberedelse.aktiviteter.filter(x => x.id !== a.id);
                p.tavlor.forEach(tv => rensaAktivitetRef(tv, [a.id]));
                logg("Att göra: borttagen · " + a.titel);
                stangModal();
                spara();
                ritaStart();
                rita();
            } });
    if (!ny && a.fas === "fore" && !fKlar(a) && !h)
        knappar.push({ txt: "Skapa hinder", fn: () => hinderFranAktivitet(a) });
    if (!ny && a.fas === "start")
        knappar.push({ txt: "Överför till tavla", fn: () => overforDialog(a) });
    knappar.push({ txt: "Avbryt", fn: stangModal });
    knappar.push({ txt: ny ? "Lägg till" : "Spara", primar: true, fn: spar });
    modal(ny ? "Ny punkt" : "Att göra", p.projekt + " · Att göra", kropp, knappar);
    function visa() {
        document.getElementById("faDeadF").style.display = fas === "fore" ? "" : "none";
        document.getElementById("faVeckaF").style.display = fas === "start" ? "" : "none";
    }
    function spar() {
        const titel = document.getElementById("faTitel").value.trim();
        if (!titel) {
            document.getElementById("faFel").innerHTML = '<div class="notis rod">Skriv vad som ska göras.</div>';
            return;
        }
        const mal = a || { id: "fa" + uid(), skapad: nu(), hinderId: null, overford: null };
        mal.titel = titel;
        mal.fas = fas;
        mal.kategori = document.getElementById("faKat").value;
        mal.status = document.getElementById("faStatus").value;
        mal.ansvarig = document.getElementById("faAnsv").value.trim();
        mal.kommentar = document.getElementById("faKom").value.trim();
        mal.deadline = fas === "fore" ? document.getElementById("faDead").value : "";
        mal.vecka = fas === "start" ? (+document.getElementById("faVecka").value || 1) : null;
        if (document.getElementById("faKal").checked) {
            const dag = document.getElementById("faKalDag").value;
            if (!dag) {
                document.getElementById("faFel").innerHTML = '<div class="notis rod">Välj datum för kalendern.</div>';
                return;
            }
            mal.kalender = { tavlaId: document.getElementById("faKalTavla").value, dag: dag };
        }
        else
            mal.kalender = null;
        if (ny)
            p.forberedelse.aktiviteter.push(mal);
        logg("Att göra: " + (ny ? "ny punkt" : "ändrad") + " · " + titel);
        stangModal();
        spara();
        ritaStart(mal.id);
        rita();
    }
    document.getElementById("faKal").addEventListener("change", e => {
        document.getElementById("faKalF").classList.toggle("dold", !e.target.checked);
    });
    visa();
}

function hinderFranAktivitet(a) {
    const p = state;
    const kropp = '<p class="hjalp" style="margin-top:0">Aktiviteten blir ett hinder med ansvarig och datum. ' +
        'Den förberedande aktiviteten finns kvar och visar kopplingen.</p>' +
        '<div class="falt"><label for="haTavla">Tavla</label><select class="f" id="haTavla">' +
        p.tavlor.map(t => '<option value="' + t.id + '"' + (t.id === p.aktiv ? " selected" : "") + '>' + esc(t.namn) + '</option>').join("") + '</select></div>' +
        '<div class="tva"><div class="falt"><label for="haVem">Vem löser det?</label>' +
        '<input class="f" id="haVem" value="' + esc(a.ansvarig || "") + '"></div>' +
        '<div class="falt"><label for="haNar">Senast när?</label>' +
        '<input class="f" id="haNar" type="date" value="' + esc(a.deadline && a.deadline >= IDAG ? a.deadline : IDAG) + '"></div></div>';
    modal("Skapa hinder", a.titel, kropp, [
        { txt: "Avbryt", fn: () => { stangModal(); aktivitetDialog(a); } },
        { txt: "Skapa hinder", primar: true, fn: () => {
                if (fHinder(p, a)) {
                    stangModal();
                    return status("Aktiviteten har redan ett hinder");
                }
                const t = p.tavlor.find(x => x.id === document.getElementById("haTavla").value) || p.tavlor[0];
                const patch = opHinderFranAktivitet(a, document.getElementById("haVem").value.trim(), document.getElementById("haNar").value, null, null);
                if (!appliceraPatch(patch, { tavla: t, projekt: p }))
                    return;
                patch.historik.forEach(h => logg2(t, h));
                stangModal();
                spara();
                rita();
                ritaStart(a.id);
            } }
    ]);
}

function overforDialog(a) {
    const p = state, finns = fOverford(p, a);
    if (finns) {
        return modal("Redan överförd", a.titel, '<p class="fraga">Aktiviteten finns redan som produktionspost</p>' +
            '<p class="hjalp">' + esc(finns.tavla.namn) + " · " + esc(finns.kort.text) + " · " + dagEtikett(finns.kort.dag) +
            '. Ta bort den posten först om du vill överföra igen.</p>', [
            { txt: "Stäng", fn: stangModal },
            { txt: "Öppna posten", primar: true, fn: () => { state.aktiv = finns.tavla.id; stangModal(); stangStart(); rita(); visaKort(finns.kort); } }
        ]);
    }
    const m = fVeckaMandag(p, a.vecka) || d2iso(mandag(new Date()));
    const kropp = '<p class="hjalp" style="margin-top:0">Posten skapas som vanlig produktion på vald tavla. ' +
        'Därefter hanteras den som all annan produktion — flytt, orsak, utfall.</p>' +
        '<div class="tva"><div class="falt"><label for="ovTavla">Tavla</label><select class="f" id="ovTavla">' +
        p.tavlor.map(t => '<option value="' + t.id + '"' + (t.id === p.aktiv ? " selected" : "") + '>' + esc(t.namn) + '</option>').join("") + '</select></div>' +
        '<div class="falt"><label for="ovDag">Dag</label><select class="f" id="ovDag">' +
        [0, 1, 2, 3, 4].map(i => '<option value="' + plus(m, i) + '">' + dagEtikett(plus(m, i)) + '</option>').join("") + '</select></div></div>' +
        '<div class="falt"><label for="ovText">Text på tavlan</label><input class="f" id="ovText" value="' + esc(a.titel) + '"></div>' +
        (p.forberedelse.byggstart ? "" : '<div class="notis">Ingen byggstart satt — veckan räknas från innevarande vecka.</div>');
    modal("Överför till tavla", a.titel, kropp, [
        { txt: "Avbryt", fn: () => { stangModal(); aktivitetDialog(a); } },
        { txt: "Överför", primar: true, fn: () => {
                if (fOverford(p, a)) {
                    stangModal();
                    return status("Redan överförd");
                }
                const t = p.tavlor.find(x => x.id === document.getElementById("ovTavla").value) || p.tavlor[0];
                const dag = document.getElementById("ovDag").value;
                const patch = opOverforAktivitet(a, { dag: dag,
                    text: document.getElementById("ovText").value.trim() || a.titel,
                    vem: a.ansvarig || "" }, t.id, null, null);
                if (!appliceraPatch(patch, { tavla: t, projekt: p }))
                    return;
                patch.historik.forEach(h => logg2(t, h));
                stangModal();
                spara();
                rita();
                ritaStart(a.id);
            } }
    ]);
}

/* ---------- projektöversikt: vyn ---------- */

let dashTavlaId = null, dashVeckor = 2, dashTV = false;

function oppnaDash() {
    dashTavlaId = null;
    dashTV = false;
    document.body.classList.add("dashlage");
    document.getElementById("dash").classList.remove("dold");
    ritaDash();
}

function stangDash() {
    const varPP = dashTV;
    document.body.classList.remove("dashlage", "dashtv");
    document.getElementById("dash").classList.add("dold");
    dashTV = false;
    try {
        if (varPP && document.fullscreenElement && document.exitFullscreen)
            document.exitFullscreen().catch(() => { });
    }
    catch (e) { }
}

function dashOppen() { return !document.getElementById("dash").classList.contains("dold"); }

function kpiKort(id, tal, rubrik, under, niva, tips) {
    return '<button type="button" class="kpi' + (niva ? " " + niva : "") + '" data-kpi="' + id + '"' +
        (tips ? ' title="' + esc(tips) + '"' : "") + '>' +
        '<span class="kpital">' + tal + '</span><span class="kpirub">' + rubrik + '</span>' +
        (under ? '<span class="kpiunder">' + under + '</span>' : "") + '</button>';
}

function ritaDash() {
    const p = state, tavlor = projTavlor(p, dashTavlaId);
    const sv = senasteAvslutadeVecka(IDAG), dv = dennaVeckasMandag(IDAG);
    const u = projUtfall(p, sv, tavlor), fore = projUtfall(p, plus(sv, -7), tavlor), nu = projUtfall(p, dv, tavlor);
    const h = projHinder(p, tavlor, IDAG), obek = obekraftadeDatum(p, tavlor);
    const sena = projAvrop(p, tavlor, null, null).filter(r => forsenatAvrop(r, IDAG));
    const atg = kraverAtgard(p, tavlor, IDAG, vaderForAtgard(p)), fh = framforhallning(p, tavlor, dashVeckor, IDAG);
    const tack = forutsattningsTackning(p, tavlor, 10, IDAG);
    const diff = (u.procent !== null && fore.procent !== null) ? u.procent - fore.procent : null;
    let html = '<div class="dashtopp">' +
        (p.logotyp ? '<img class="logga" src="' + p.logotyp + '" alt="">' : "") +
        '<b>Wimo</b><span class="punkt">·</span><span class="dashprojekt">' + esc(p.projekt) + '</span>' +
        '<span class="dashrub">Projektöversikt</span>' +
        '<span class="dashvecka">v.' + veckonr(dv) + ' · ' + dagNamnKort(IDAG) + '</span>' +
        '<div class="hoger">' +
        '<select class="f dashval" id="dashTavla"><option value="">Alla tavlor</option>' +
        p.tavlor.map(t => '<option value="' + t.id + '"' + (dashTavlaId === t.id ? " selected" : "") + '>' + esc(t.namn) + '</option>').join("") +
        '</select>' +
        '<button class="navknapp' + (dashTV ? " pp-pa" : "") + '" id="dashTvKnapp" title="' + (dashTV ? "Avsluta fullskärm" : "Visa översikten i fullskärm") + '">' + (dashTV ? "Avsluta PP" : "PP") + '</button>' +
        '<button class="navknapp" id="dashSkrivUt">Skriv ut</button>' +
        '<button class="navknapp" id="dashStang">Stäng</button>' +
        '</div></div>';
    html += '<div class="kpirad">' +
        kpiKort("pall", (u.procent === null ? "–" : u.procent + " %"), "Planpålitlighet", "v." + veckonr(sv) + " · " + (u.procent === null ? "inga löften" : u.genomforda + " av " + u.planerade + " löften") +
            (diff === null ? "" : (diff >= 0 ? " · ▲ +" : " · ▼ ") + Math.abs(diff)), "", u.procent === null
            ? "Ingen planpålitlighet kan beräknas – inga produktionslöften fanns i v." + veckonr(sv) +
                ". Ett löfte är en produktionspost som fanns innan veckan började och låg i veckan."
            : "Genomförda av planerade produktionslöften i senast avslutade vecka, v." + veckonr(sv) + ". Pågående vecka räknas inte.") +
        kpiKort("hinder", h.oppna.length, "Öppna hinder", h.forfallna.length ? "varav " + h.forfallna.length + " förfallna" : "inga förfallna", h.forfallna.length ? "rod" : "", "Alla olösta hinder just nu. Förfallna = senast-datumet har passerat.") +
        kpiKort("avrop", sena.length, "Försenade avrop", "", sena.length ? "rod" : "", "Avrop som inte bockats av och vars avropsdatum har passerat.") +
        kpiKort("obek", obek.length, "Obekräftade datum", "leverans eller UE-start", obek.length ? "orange" : "", "Leveranser och UE-starter som flyttats utan att motparten bekräftat det nya datumet.") +
        '</div>';
    html += '<div class="lagesrad">v.' + veckonr(dv) + ' pågår · ' + nu.genomforda + ' av ' + nu.planerade +
        ' löften avbockade' + (nu.planerade ? "" : " (inga löften registrerade)") + '</div>';
    html += '<div class="dashblock"><h3>Kräver åtgärd<span class="antal">' +
        (atg.totalt > atg.length ? atg.length + " av " + atg.totalt : (atg.length || "inget")) + '</span></h3>';
    html += atg.length ? '<ul class="atglista">' + atg.map((r, i) => '<li data-atg="' + i + '"><span class="prick ' + r.niva + '"></span>' +
        '<span class="atgtavla">' + esc(r.tavla.namn) + '</span>' +
        '<span class="atgtext">' + esc(r.text) +
        (r.metatext ? '<span class="atgmeta">' + esc(r.metatext) + '</span>' : "") + '</span></li>').join("") + '</ul>'
        : '<p class="hjalp">Inget kräver åtgärd just nu.</p>';
    html += '</div>';
    // Gantt-schemat för de valda projekten (samma urval som på Gantt-sidan)
    html += '<div class="dashblock dashgantt"><h3>Gantt-schema<span class="antal" id="dashGanttInfo"></span>' +
        '<span class="dg-knappar">' +
        Object.keys(GANTT_PERIODER).map(s2 => '<button type="button" data-dgper="' + s2 + '"' + (s2 === gantt.period ? ' class="vald"' : "") + ">" + GANTT_PERIODER[s2] + "</button>").join("") +
        '<button type="button" data-dgsteg="-1" aria-label="Föregående">←</button><button type="button" data-dgsteg="1" aria-label="Nästa">→</button>' +
        '<button type="button" id="dashTillGantt">Öppna Gantt</button></span></h3>' +
        dashGanttProjektval() +
        '<div id="dashGantt"></div></div>';
    // Kalendern: alla tavlor i projektet under varandra, denna vecka och tre framåt
    html += '<div class="dashblock dashkal"><h3>Kalender<span class="antal">' + esc(p.projekt) + " · v" + veckonr(dv) + "–v" + veckonr(plus(dv, 21)) +
        "</span></h3>" + p.tavlor.map(t => dashKalender(t, dv)).join("") + "</div>";
    const dash = document.getElementById("dash");
    dash.innerHTML = html;
    ritaDashGantt(document.getElementById("dashGantt"));
    dashGanttLyssnare(dash);
    document.getElementById("dashStang").addEventListener("click", stangDash);
    const dst = document.getElementById("dashStart");
    if (dst)
        dst.addEventListener("click", () => oppnaStart());
    const dr = document.getElementById("dashRes");
    if (dr)
        dr.addEventListener("click", () => {
            resFilter = { vy: "person", period: dashVeckor === 1 ? "1v" : dashVeckor === 4 ? "4v" : "2v", fran: null, till: null,
                omf: dashTavlaId ? "tavla" : "projekt" };
            if (dashTavlaId)
                state.aktiv = dashTavlaId;
            stangDash();
            resursVy();
        });
    document.getElementById("dashSkrivUt").addEventListener("click", () => skrivUtOversikt(p, tavlor));
    document.getElementById("dashTvKnapp").addEventListener("click", () => vaxlaDashPP(!dashTV));
    document.getElementById("dashTavla").addEventListener("change", e => {
        dashTavlaId = e.target.value || null;
        ritaDash();
    });
    dash.querySelectorAll("[data-fv]").forEach(b => b.addEventListener("click", () => {
        dashVeckor = +b.dataset.fv;
        ritaDash();
    }));
    dash.querySelectorAll("[data-kpi]").forEach(b => b.addEventListener("click", () => dashKlick(b.dataset.kpi, p, tavlor)));
    dash.querySelectorAll("[data-atg]").forEach(li => li.addEventListener("click", () => oppnaAtgard(atg[+li.dataset.atg])));
    dash.querySelectorAll("[data-tavla]").forEach(tr => tr.addEventListener("click", () => {
        state.aktiv = tr.dataset.tavla;
        stangDash();
        vyOffset = 0;
        spara();
        rita();
    }));
    dash.querySelectorAll("[data-vecka]").forEach(li => li.addEventListener("click", () => {
        stangDash();
        visaUtfall(li.dataset.vecka);
    }));
    dash.querySelectorAll("[data-fram]").forEach(li => li.addEventListener("click", () => {
        const v = li.dataset.fram;
        if (v === "moment" || v === "hinder")
            return momentLista(p, tavlor, v);
        avropFilter = { typ: v === "ue" ? "ue" : "alla", tavla: dashTavlaId ? "denna" : "alla",
            period: dashVeckor === 1 ? "denna" : dashVeckor === 2 ? "2v" : "4v", fran: null, till: null, foretag: "" };
        if (dashTavlaId)
            state.aktiv = dashTavlaId;
        stangDash();
        avropDialog();
    }));
}

function dashKlick(vilken, p, tavlor) {
    if (vilken === "pall") {
        stangDash();
        return visaUtfall(senasteAvslutadeVecka(IDAG));
    }
    if (vilken === "hinder")
        return hinderVy(p, tavlor, "oppna");
    if (vilken === "avrop") {
        avropFilter = { typ: "alla", tavla: dashTavlaId ? "denna" : "alla", period: "alla", fran: null, till: null, foretag: "" };
        if (dashTavlaId)
            state.aktiv = dashTavlaId;
        stangDash();
        return avropDialog();
    }
    if (vilken === "obek")
        return hinderVy(p, tavlor, "obekraftade");
}

function oppnaAtgard(r) {
    if (!r || !r.meta)
        return;
    if (r.meta.typ === "hinder") {
        state.aktiv = r.tavla.id;
        const h = r.tavla.hinder.find(x => x.id === r.meta.id);
        stangDash();
        rita();
        if (h)
            hinderDialog(h.kop || null, h);
        return;
    }
    if (r.meta.typ === "kort") {
        state.aktiv = r.tavla.id;
        const k = r.tavla.kort.find(x => x.id === r.meta.id);
        stangDash();
        rita();
        if (k)
            visaKort(k);
        return;
    }
    if (r.meta.typ === "avrop") {
        avropFilter = { typ: "alla", tavla: "denna", period: "alla", fran: null, till: null, foretag: "" };
        state.aktiv = r.tavla.id;
        stangDash();
        rita();
        return avropDialog();
    }
    if (r.meta.typ === "vader") {
        state.aktiv = r.tavla.id;
        stangDash();
        rita();
    }
    if (r.meta.typ === "forberedelse") {
        stangDash();
        oppnaStart(r.meta.id);
        return;
    }
    if (r.meta.typ === "resurs") {
        resFilter.vy = "person";
        resFilter.omf = "projekt";
        resFilter.period = "2v";
        stangDash();
        resursVy();
    }
}

function hinderVy(p, tavlor, lage) {
    const h = projHinder(p, tavlor, IDAG), obek = obekraftadeDatum(p, tavlor);
    let rader;
    if (lage === "forfallna")
        rader = h.forfallna;
    else if (lage === "obekraftade")
        rader = obek.map(o => ({ tavla: o.tavla,
            hinder: o.f.hinderId ? o.tavla.hinder.find(x => x.id === o.f.hinderId) : null, kort: o.kort, f: o.f }));
    else
        rader = h.oppna;
    const rubrik = lage === "forfallna" ? "Förfallna hinder" : lage === "obekraftade" ? "Obekräftade datum" : "Öppna hinder";
    const flera = (tavlor || p.tavlor).length > 1;
    const kropp = '<div class="filterrad"><label>Visa<select class="f" id="hvLage">' +
        [["oppna", "Öppna hinder (" + h.oppna.length + ")"], ["forfallna", "Förfallna (" + h.forfallna.length + ")"],
            ["obekraftade", "Obekräftade datum (" + obek.length + ")"]].map(x => '<option value="' + x[0] + '"' + (lage === x[0] ? " selected" : "") + '>' + x[1] + '</option>').join("") +
        '</select></label></div>' +
        (rader.length ? '<table class="lista"><thead><tr><th>Senast</th><th>Status</th><th>Hinder</th>' +
            '<th>Vem</th><th>Tillhör moment</th>' + (flera ? "<th>Tavla</th>" : "") + '</tr></thead><tbody>' +
            rader.map((r, i) => {
                const hh = r.hinder, nar = hh ? hh.nar : "";
                return '<tr data-hv="' + i + '" class="' + (hh && forfallen(nar, IDAG) ? "sen" : "") + '" style="cursor:pointer">' +
                    '<td class="dat">' + esc(narText(nar) || "–") + '</td>' +
                    '<td>' + (hh ? (forfallen(nar, IDAG) ? "Försenat" : "Öppet") : "—") + '</td>' +
                    '<td>' + esc(hh ? hh.vad : (r.f ? r.f.txt : "")) + '</td>' +
                    '<td>' + esc((hh && hh.vem) || "–") + '</td>' +
                    '<td>' + esc((hh && hh.kop && hh.kop.text) || (r.kort ? momentNamn(r.kort) : "–")) + '</td>' +
                    (flera ? '<td>' + esc(r.tavla.namn) + '</td>' : "") + '</tr>';
            }).join("") + '</tbody></table>'
            : '<div class="listtom">Inga poster i det här urvalet.</div>');
    modal(rubrik, p.projekt, kropp, [{ txt: "Stäng", primar: true, fn: stangModal }]);
    const m = document.querySelector("#overlay .modal");
    if (m)
        m.style.maxWidth = "900px";
    const val = document.getElementById("hvLage");
    if (val)
        val.addEventListener("change", () => { const v = val.value; stangModal(); hinderVy(p, tavlor, v); });
    document.querySelectorAll("[data-hv]").forEach(tr => tr.addEventListener("click", () => {
        const r = rader[+tr.dataset.hv];
        state.aktiv = r.tavla.id;
        stangModal();
        stangDash();
        rita();
        if (r.hinder)
            hinderDialog(r.hinder.kop || null, r.hinder);
        else if (r.kort)
            visaKort(r.kort);
    }));
}

function momentLista(p, tavlor, vilken) {
    const fran = dennaVeckasMandag(IDAG), till = plus(fran, dashVeckor * 7 - 1), rader = [];
    (tavlor || p.tavlor).forEach(t => produktionsmomentEfter(t, fran, till).forEach(k => {
        const oppna = t.hinder.filter(h => h.status !== "lost" && h.kop && h.kop.kortId === k.id);
        if (vilken === "hinder" && !oppna.length)
            return;
        rader.push({ tavla: t, kort: k, hinder: oppna });
    }));
    rader.sort((a, b) => a.kort.dag < b.kort.dag ? -1 : 1);
    const flera = (tavlor || p.tavlor).length > 1;
    const kropp = rader.length ? '<table class="lista"><thead><tr><th>Start</th><th>Moment</th>' +
        '<th>Öppna hinder</th>' + (flera ? "<th>Tavla</th>" : "") + '</tr></thead><tbody>' +
        rader.map((r, i) => '<tr data-ml="' + i + '" style="cursor:pointer"><td class="dat">' + kortDatum(r.kort.dag) + '</td>' +
            '<td>' + esc(momentNamn(r.kort)) + '</td><td' + (r.hinder.length ? ' class="rodtal"' : "") + '>' +
            (r.hinder.length || "–") + '</td>' + (flera ? '<td>' + esc(r.tavla.namn) + '</td>' : "") + '</tr>').join("") +
        '</tbody></table>' : '<div class="listtom">Inga moment i perioden.</div>';
    modal(vilken === "hinder" ? "Kommande moment med öppna hinder" : "Moment som startar", "Vecka " + veckonr(fran) + "–" + veckonr(plus(till, -6)), kropp, [{ txt: "Stäng", primar: true, fn: stangModal }]);
    const m = document.querySelector("#overlay .modal");
    if (m)
        m.style.maxWidth = "820px";
    document.querySelectorAll("[data-ml]").forEach(tr => tr.addEventListener("click", () => {
        const r = rader[+tr.dataset.ml];
        state.aktiv = r.tavla.id;
        stangModal();
        stangDash();
        rita();
        visaKort(r.kort);
    }));
}

/* ---------- Projektöversiktens kalender: en tavla, fyra veckor ---------- */

function dashKalender(t, dv) {
    const dagNamn = ["Mån", "Tis", "Ons", "Tors", "Fre"];
    let html = '<div class="dk-tavla"><div class="dk-topp"><b>' + esc(t.namn) + '</b><span>' + t.kort.filter(k => !k.klar && k.dag >= dv && k.dag <= plus(dv, 25)).length +
        ' öppna poster</span><button type="button" class="dk-oppna" data-dktavla="' + t.id + '">Öppna tavlan</button></div>' +
        '<div class="dk-grid"><div class="dk-horn"></div>' + dagNamn.map(n => '<div class="dk-dag">' + n + "</div>").join("");
    for (let v = 0; v < 4; v++) {
        const vs = plus(dv, v * 7);
        html += '<div class="dk-vecka"><b>v' + veckonr(vs) + "</b><small>" + kortDatum(vs) + "</small></div>";
        for (let d = 0; d < 5; d++) {
            const iso = plus(vs, d);
            const lista = sorteraDag(virtuella(iso, t).concat(kortForDag(t, iso)));
            html += '<div class="dk-ruta' + (iso === IDAG ? " idag" : "") + (iso < IDAG ? " forbi" : "") + '" data-dkdag="' + iso + '" data-dktavla="' + t.id + '">' +
                '<span class="dk-datum">' + dagNamn[d] + " " + kortDatum(iso) + "</span>" +
                lista.map(k => '<span class="dk-kort t-' + k.typ + (k.klar ? " klar" : "") + '"' + (k.virtuell ? "" : ' data-dkkort="' + k.id + '"') +
                    ' title="' + esc(TYPNAMN[k.typ] + " · " + (k.text || "")) + '">' + (k.tid ? "<em>" + esc(k.tid) + "</em> " : "") + esc(k.text || TYPNAMN[k.typ]) + "</span>").join("") +
                "</div>";
        }
    }
    return html + "</div></div>";
}

function dashGanttLyssnare(dash) {
    const box = dash.querySelector(".dashgantt");
    if (!box)
        return;
    box.addEventListener("click", (e) => {
        const plus = e.target.closest(".g-plus");
        if (plus) {
            e.preventDefault();
            e.stopPropagation();
            return ganttLaggTill(plus.dataset.gplus);
        }
        const b = e.target.closest("button");
        if (!b)
            return;
        if (b.dataset.dgper) {
            gantt.period = b.dataset.dgper;
            ganttSteg = 0;
            sparaGantt();
            return ritaDash();
        }
        if (b.dataset.dgsteg) {
            ganttSteg += +b.dataset.dgsteg;
            return ritaDash();
        }
        if (b.dataset.dgproj) {
            const alla = ganttProjekt().map(x => x.id);
            if (b.dataset.dgproj === "alla")
                gantt.valda = null;
            else {
                let valda = gantt.valda ? gantt.valda.filter(id => alla.includes(id)) : alla.slice();
                valda = valda.includes(b.dataset.dgproj) ? valda.filter(id => id !== b.dataset.dgproj) : valda.concat(b.dataset.dgproj);
                gantt.valda = valda.length === alla.length ? null : valda;
            }
            sparaGantt();
            return ritaDash();
        }
        if (b.id === "dashTillGantt") {
            stangDash();
            oppnaGantt();
            if (window.p4MarkeraNav)
                window.p4MarkeraNav();
            return window.scrollTo({ top: 0 });
        }
        if (b.dataset.gihop) {
            const id = b.dataset.gihop;
            gantt.ihop = gantt.ihop.includes(id) ? gantt.ihop.filter(x => x !== id) : gantt.ihop.concat(id);
            sparaGantt();
            return ritaDashGantt(document.getElementById("dashGantt"));
        }
        if (b.dataset.gkort) {
            stangDash();
            return ganttTillKort(b.dataset.gkort);
        }
    });
    dash.querySelector(".dashkal").addEventListener("click", (e) => {
        const kort = e.target.closest("[data-dkkort]"), el = e.target.closest("[data-dktavla]");
        if (!el)
            return;
        const t = state.tavlor.find(x => x.id === el.dataset.dktavla);
        if (!t)
            return;
        state.aktiv = t.id;
        vyOffset = 0;
        stangDash();
        if (window.p4MarkeraNav)
            window.p4MarkeraNav();
        rita();
        window.scrollTo({ top: 0 });
        if (kort) {
            const k = t.kort.find(x => x.id === kort.dataset.dkkort);
            if (k)
                visaKort(k);
        }
    });
}

// Projektval direkt i översiktens Gantt: tryck på ett projekt för att visa eller dölja det.
function dashGanttProjektval() {
    const alla = ganttProjekt();
    if (alla.length < 2)
        return "";
    const vald = (p) => !gantt.valda || gantt.valda.includes(p.id);
    return '<div class="dg-projekt" role="group" aria-label="Projekt i schemat">' +
        '<button type="button" data-dgproj="alla"' + (!gantt.valda ? ' class="vald"' : "") + ">Alla</button>" +
        alla.map(p => '<button type="button" data-dgproj="' + esc(p.id) + '" aria-pressed="' + vald(p) + '"' + (vald(p) ? ' class="pa"' : "") +
            ' style="--gf:' + ganttFarg(p) + '"><span class="g-ruta"></span>' + esc(p.projekt) + "</button>").join("") + "</div>";
}

// PP: Projektöversikten i fullskärm, som visningsläget men för översikten.
function vaxlaDashPP(pa) {
    dashTV = pa;
    document.body.classList.toggle("dashtv", pa);
    try {
        if (pa && !document.fullscreenElement && document.documentElement.requestFullscreen)
            document.documentElement.requestFullscreen().catch(() => { });
        if (!pa && document.fullscreenElement && document.exitFullscreen)
            document.exitFullscreen().catch(() => { });
    }
    catch (e) { }
    if (dashOppen())
        ritaDash();
    window.scrollTo({ top: 0 });
}

document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement && dashTV)
        vaxlaDashPP(false);
});
