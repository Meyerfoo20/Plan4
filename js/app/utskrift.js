/* ======================================================================
   Avropslistan, logotyp, utskrifter och vädervarningar
   ====================================================================== */

/* ---------- avropslistan ---------- */

function avropPeriod(opt) {
    const vs = visaStart();
    if (opt.period === "denna") {
        const m = d2iso(mandag(new Date()));
        return { fran: m, till: plus(m, 6), text: "Vecka " + veckonr(m) };
    }
    if (opt.period === "2v")
        return { fran: vs, till: plus(vs, 13), text: "Vecka " + veckonr(vs) + "–" + veckonr(plus(vs, 7)) };
    if (opt.period === "4v")
        return { fran: vs, till: plus(vs, 27), text: "Vecka " + veckonr(vs) + "–" + veckonr(plus(vs, 21)) };
    if (opt.period === "valj") {
        const f = opt.fran || vs, t2 = opt.till || f;
        return { fran: f, till: plus(t2, 6),
            text: "Vecka " + veckonr(f) + " " + iso2d(f).getFullYear() + " – v" + veckonr(t2) + " " + iso2d(t2).getFullYear() };
    }
    return { fran: IDAG, till: null, text: "Alla framtida avrop" };
}

function veckoOptioner(vald) {
    const start = plus(visaStart(), -8 * 7), ut = [];
    for (let i = 0; i < 70; i++) {
        const m = plus(start, i * 7);
        ut.push('<option value="' + m + '"' + (m === vald ? " selected" : "") + '>v' + veckonr(m) + " " + iso2d(m).getFullYear() + '</option>');
    }
    return ut.join("");
}

function avropTabell(rader, visaTavla) {
    if (!rader.length)
        return "";
    let html = '<table class="lista"><thead><tr><th>Avrop</th><th>Status</th><th>Typ</th><th>Vad</th>' +
        '<th>Leverantör / UE</th><th>Tillhör moment</th><th>Leverans / start</th>' +
        (visaTavla ? "<th>Delområde</th>" : "") + '<th class="kvitt">□</th></tr></thead><tbody>';
    let vecka = null;
    rader.forEach(r => {
        const v = veckonr(r.dag) + "/" + iso2d(r.dag).getFullYear();
        if (v !== vecka) {
            vecka = v;
            html += '<tr class="veckorad"><td colspan="' + (visaTavla ? 9 : 8) + '">VECKA ' + veckonr(r.dag) +
                " · " + iso2d(r.dag).getFullYear() + '</td></tr>';
        }
        const sen = forsenatAvrop(r, IDAG);
        html += '<tr class="' + (sen ? "sen" : "") + (r.klar ? " utford" : "") + '">' +
            '<td class="dat">' + kortDatum(r.dag) + '</td>' +
            '<td>' + (r.klar ? "✓ Utfört" : sen ? "Försenat" : "Öppet") + '</td>' +
            '<td>' + (r.slag === "ue" ? "UE" : r.slag === "material" ? "Material" : "–") + '</td>' +
            '<td>' + esc(r.vad) + '</td><td>' + esc(r.foretag || "–") + '</td>' +
            '<td>' + esc(r.moment || "–") + '</td>' +
            '<td class="dat">' + (r.levDag ? kortDatum(r.levDag) : "–") + '</td>' +
            (visaTavla ? '<td>' + esc(r.tavla) + '</td>' : "") +
            '<td class="kvitt">□</td></tr>';
    });
    return html + '</tbody></table>';
}

/* ---------- projektlogotyp ---------- */

const LOGGA_MAX_B = 320, LOGGA_MAX_H = 80, LOGGA_MAX_KB = 60;

function laddaLogga(fil, klar) {
    if (!fil)
        return;
    if (!/^image\/(png|jpeg|jpg|webp)$/i.test(fil.type))
        return klar(null, "Filformatet stöds inte. Använd PNG, JPG eller WebP.");
    if (fil.size > 10 * 1024 * 1024)
        return klar(null, "Bilden är för stor (max 10 MB).");
    const las = new FileReader();
    las.onerror = () => klar(null, "Bilden kunde inte läsas.");
    las.onload = () => {
        const bild = new Image();
        bild.onerror = () => klar(null, "Bilden kunde inte tolkas.");
        bild.onload = () => {
            const skala = Math.min(LOGGA_MAX_B / bild.width, LOGGA_MAX_H / bild.height, 1);
            const c = document.createElement("canvas");
            c.width = Math.max(1, Math.round(bild.width * skala));
            c.height = Math.max(1, Math.round(bild.height * skala));
            const ctx = c.getContext("2d");
            ctx.drawImage(bild, 0, 0, c.width, c.height);
            let ut = c.toDataURL("image/png");
            if (ut.length / 1024 > LOGGA_MAX_KB) {
                const webp = c.toDataURL("image/webp", 0.85);
                if (webp.indexOf("data:image/webp") === 0 && webp.length < ut.length)
                    ut = webp;
            }
            klar(ut, null);
        };
        bild.src = las.result;
    };
    las.readAsDataURL(fil);
}

function ritaLogga() {
    const el = document.getElementById("logga");
    if (!el)
        return;
    if (state.logotyp) {
        el.src = state.logotyp;
        el.classList.remove("dold");
    }
    else {
        el.removeAttribute("src");
        el.classList.add("dold");
    }
}

/* ---------- utskrifter ---------- */

function utskriftHuvud(typ, urval) {
    const rad = esc(state.projekt || "Projekt") + " – " + esc(typ);
    document.getElementById("utskriftsfot").textContent = rad + " · " + urval + " · utskriven " + tidStampel() +
        (typ.indexOf("Planerad avrops") === 0 ? " · planeringsunderlag, inte en beställning" : "");
    return '<div class="uhuvud">' +
        (state.logotyp ? '<img class="ulogga" src="' + state.logotyp + '" alt="">' : "") +
        '<div class="utext"><div class="utitel">' + rad + '</div>' +
        '<div class="umeta">' + esc(urval) + '</div>' +
        '<div class="umeta">Utskriven ' + tidStampel() + '</div></div></div>';
}

function sidorientering(liggande) {
    let st = document.getElementById("sidstil");
    if (!st) {
        st = document.createElement("style");
        st.id = "sidstil";
        document.head.appendChild(st);
    }
    st.textContent = "@page{size:" + (liggande ? "landscape" : "portrait") + ";margin:11mm 11mm 16mm}";
}

function skrivUt(html, liggande) {
    document.getElementById("utskrift").innerHTML = html;
    sidorientering(liggande);
    window.print();
}

function utskriftKalender(opt) {
    const t = T(), vs = visaStart();
    let antal = 0, html = '<table class="kal"><thead><tr><th class="vk">Vecka</th>' +
        DAGNAMN.map(d => '<th>' + d + '</th>').join("") + '</tr></thead><tbody>';
    for (let v = 0; v < opt.veckor; v++) {
        const vStart = plus(vs, v * 7);
        html += '<tr><td class="vk"><b>v' + veckonr(vStart) + '</b><br>' + kortDatum(vStart) + "–" + kortDatum(plus(vStart, 4)) + '</td>';
        for (let d = 0; d < 5; d++) {
            const iso = plus(vStart, d);
            const kort = sorteraDag(virtuella(iso, T()).concat(kortForDag(t, iso), attGoraForDag(t, iso, projektForTavla(t)))
                .filter(k => opt.typer.indexOf(k.typ) >= 0));
            antal += kort.length;
            html += '<td><div class="ddat">' + kortDatum(iso) + '</div>' + kort.map(k => {
                if (k.typ === "franvaro" && franvaroNy(k)) {
                    const fp = projektForTavla(t);
                    return '<div class="ukort t-franvaro' + (k.klar ? " klar" : "") + '">' + esc(franvaroTitel(fp, k)) +
                        '<span class="umeta2">' + esc(franvaroUnder(fp, k)) + '</span></div>';
                }
                return '<div class="ukort t-' + k.typ + (k.klar ? " klar" : "") + '">' + esc(kortText(k, t, projektForTavla(t))) +
                    ([k.tid, k.vem].filter(Boolean).length ? '<span class="umeta2">' + esc([k.tid, k.vem].filter(Boolean).join(" · ")) + '</span>' : "") +
                    '</div>';
            }).join("") + '</td>';
        }
        html += '</tr>';
    }
    return { html: html + '</tbody></table>', antal: antal };
}

function utskriftHinder(tavlor, medLosta) {
    let rader = [];
    tavlor.forEach(t => t.hinder.forEach(h => {
        if (!medLosta && h.status === "lost")
            return;
        rader.push({ t: t.namn, h: h });
    }));
    rader.sort((a, b) => {
        const da = /^\d{4}-/.test(a.h.nar || "") ? a.h.nar : "9999", db = /^\d{4}-/.test(b.h.nar || "") ? b.h.nar : "9999";
        return da < db ? -1 : da > db ? 1 : 0;
    });
    if (!rader.length)
        return "";
    const flera = tavlor.length > 1;
    return '<table class="lista"><thead><tr><th>Senast</th><th>Status</th><th>Hinder</th><th>Vem</th>' +
        '<th>Tillhör moment</th>' + (flera ? "<th>Delområde</th>" : "") + '<th class="kvitt">□</th></tr></thead><tbody>' +
        rader.map(r => '<tr class="' + (forfallen(r.h.nar, IDAG) && r.h.status !== "lost" ? "sen" : "") + (r.h.status === "lost" ? " utford" : "") + '">' +
            '<td class="dat">' + esc(narText(r.h.nar) || "–") + '</td>' +
            '<td>' + (r.h.status === "lost" ? "✓ Löst" : forfallen(r.h.nar, IDAG) ? "Försenat" : "Öppet") + '</td>' +
            '<td>' + esc(r.h.vad) + '</td><td>' + esc(r.h.vem || "–") + '</td>' +
            '<td>' + esc((r.h.kop && r.h.kop.text) || "–") + '</td>' +
            (flera ? '<td>' + esc(r.t) + '</td>' : "") + '<td class="kvitt">□</td></tr>').join("") + '</tbody></table>';
}

function utskriftVader() {
    const lista = vaderVarningar();
    if (!aktivaGranser(state).length)
        return '<p class="utom">Inga gränsvärden är valda under Tavla ⋯.</p>';
    if (!lista.length)
        return "";
    return '<table class="lista"><thead><tr><th>Dag</th><th>Överskrider</th></tr></thead><tbody>' +
        lista.map(x => '<tr><td class="dat">' + dagNamnKort(x.dag) + '</td><td>' + esc(x.traffar.join(" · ")) + '</td></tr>').join("") +
        '</tbody></table>';
}

function skrivUtOversikt(p, tavlor) {
    const sv = senasteAvslutadeVecka(IDAG), dv = dennaVeckasMandag(IDAG);
    const u = projUtfall(p, sv, tavlor), nu = projUtfall(p, dv, tavlor);
    const h = projHinder(p, tavlor, IDAG), obek = obekraftadeDatum(p, tavlor);
    const sena = projAvrop(p, tavlor, null, null).filter(r => forsenatAvrop(r, IDAG));
    const atg = kraverAtgard(p, tavlor, IDAG, vaderForAtgard(p)), fh = framforhallning(p, tavlor, 2, IDAG);
    const flera = (tavlor || p.tavlor).length > 1;
    let html = utskriftHuvud("Veckans produktionsöversikt", ((tavlor || p.tavlor).length === p.tavlor.length ? "Alla tavlor" : (tavlor[0] && tavlor[0].namn)) +
        " · v." + veckonr(sv) + " avslutad · v." + veckonr(dv) + " pågår");
    html += '<table class="lista"><tbody>' +
        '<tr><td>Planpålitlighet v.' + veckonr(sv) + '</td><td><b>' + (u.procent === null ? "–" : u.procent + " %") + '</b></td></tr>' +
        '<tr><td>Genomförda av planerade löften</td><td>' + u.genomforda + " av " + u.planerade + '</td></tr>' +
        '<tr><td>Tillkom under veckan</td><td>' + u.tillkomna + " (varav " + u.tillkomnaKlara + ' genomförda)</td></tr>' +
        '<tr><td>Öppna hinder</td><td>' + h.oppna.length + " (varav " + h.forfallna.length + ' förfallna)</td></tr>' +
        '<tr><td>Försenade avrop</td><td>' + sena.length + '</td></tr>' +
        '<tr><td>Obekräftade leverans- eller UE-datum</td><td>' + obek.length + '</td></tr>' +
        '<tr><td>v.' + veckonr(dv) + ' pågår</td><td>' + nu.genomforda + " av " + nu.planerade + ' löften avbockade</td></tr>' +
        '</tbody></table>';
    html += '<div class="ublock"><h3>Kräver åtgärd</h3>' +
        (atg.length ? '<table class="lista"><thead><tr><th>Nivå</th><th>Tavla</th><th>Vad</th><th>Detalj</th>' +
            '<th class="kvitt">□</th></tr></thead><tbody>' +
            atg.map(r => '<tr><td>' + (r.niva === "rod" ? "Åtgärd" : r.niva === "orange" ? "Kontrollera" : "Uppmärksamma") + '</td>' +
                '<td>' + esc(r.tavla.namn) + '</td><td>' + esc(r.text) + '</td><td>' + esc(r.metatext) + '</td>' +
                '<td class="kvitt">□</td></tr>').join("") + '</tbody></table>'
            : '<p class="utom">Inget kräver åtgärd.</p>') + '</div>';
    html += '<div class="ublock"><h3>Läge per tavla</h3><table class="lista"><thead><tr><th>Tavla</th>' +
        '<th>Idag</th><th>Planpålit.</th><th>Ej gjorda</th><th>Hinder</th><th>Förfallna</th></tr></thead><tbody>' +
        (tavlor || p.tavlor).map(t => {
            const tu = projUtfall(p, sv, [t]), th = projHinder(p, [t], IDAG), av = senasteAvstamning(t), def = av ? lageDef(av.lage) : null;
            return '<tr><td>' + esc(t.namn) + '</td><td>' + (def ? def.txt : "–") + '</td>' +
                '<td>' + (tu.procent === null ? "–" : tu.procent + " %") + '</td><td>' + tu.ejGjorda + '</td>' +
                '<td>' + th.oppna.length + '</td><td>' + th.forfallna.length + '</td></tr>';
        }).join("") + '</tbody></table>' +
        '<p class="hjalp">Dagens läge är arbetsledningens egen bedömning, inte en automatisk bedömning.</p></div>';
    html += '<div class="ublock"><h3>Kommande två veckor</h3><table class="lista"><tbody>' +
        '<tr><td>Moment som startar</td><td>' + fh.moment + '</td></tr>' +
        '<tr><td>Avrop</td><td>' + fh.avrop + '</td></tr>' +
        '<tr><td>Leveranser</td><td>' + fh.leveranser + '</td></tr>' +
        '<tr><td>UE-starter</td><td>' + fh.uestarter + '</td></tr>' +
        '<tr><td>Moment med öppna hinder</td><td>' + fh.medHinder + '</td></tr>' +
        '</tbody></table></div>';
    skrivUt(html, false);
}

function skrivUtProjektstart(p) {
    const fb = p.forberedelse, l = fLage(p, IDAG);
    const rad = a => {
        const ov = fOverford(p, a), h = fHinder(p, a);
        return '<tr class="' + (fForfallen(a, IDAG) ? "sen" : "") + (fKlar(a) ? " utford" : "") + '"><td>' + esc(a.status) + '</td>' +
            '<td>' + esc(a.titel) + (a.kommentar ? ' <span class="hjalp">' + esc(a.kommentar) + '</span>' : "") +
            (h ? ' <span class="hjalp">↳ hinder</span>' : "") + (ov ? ' <span class="hjalp">↳ överförd ' + esc(ov.tavla.namn) + '</span>' : "") + '</td>' +
            '<td>' + esc(a.kategori || "Övrigt") + '</td><td>' + esc(a.ansvarig || "–") + '</td>' +
            '<td class="dat">' + (a.fas === "fore" ? (a.deadline ? kortDatum(a.deadline) : "–") + (fForfallen(a, IDAG) ? " · förfallen" : "")
            : "v" + (a.vecka || 1) + (fb.byggstart ? " · " + kortDatum(fVeckaMandag(p, a.vecka)) : "")) + '</td>' +
            '<td class="kvitt">□</td></tr>';
    };
    const tabell = lista => lista.length ? '<table class="lista"><thead><tr><th>Status</th><th>Aktivitet</th><th>Kategori</th>' +
        '<th>Ansvarig</th><th>Deadline / vecka</th><th class="kvitt">□</th></tr></thead><tbody>' +
        lista.map(rad).join("") + '</tbody></table>' : '<p class="utom">Inga aktiviteter.</p>';
    const fore = fAktiviteter(p).filter(a => a.fas === "fore").sort((a, b) => (a.deadline || "9999") < (b.deadline || "9999") ? -1 : 1);
    const start = fAktiviteter(p).filter(a => a.fas === "start").sort((a, b) => (a.vecka || 9) - (b.vecka || 9));
    const html = utskriftHuvud("Att göra", l.foreKlara + " av " + l.fore + " klara" + (l.forfallna ? " · " + l.forfallna + " förfallna" : "")) +
        '<div class="ublock"><h3>Att göra</h3>' + tabell(fore) + '</div>' +
        (start.length ? '<div class="ublock"><h3>Äldre byggstartsplan</h3>' + tabell(start) + '</div>' : "");
    skrivUt(html, false);
}

function skrivUtFranvaro(p, f) {
    const r = franvaroRader(p, f, IDAG);
    const pers = f.person === "__okopplad" ? "Ej kopplade" : f.person ? (resPers(p, f.person) || {}).namn : "Alla personer";
    const urval = pers + " · " + (f.orsak || "Alla orsaker") + " · " + r.per.text;
    const html = utskriftHuvud("Frånvarolista", urval) +
        (r.length ? '<table class="lista"><thead><tr><th>Person</th><th>Orsak</th><th>Datum / period</th>' +
            '<th>Arbetsdagar</th><th>Tid</th><th>Vad</th><th>Tavla</th><th class="kvitt">□</th></tr></thead><tbody>' +
            r.map(x => '<tr><td>' + esc(x.person) + (x.kopplad ? "" : ' <span class="hjalp">(' + (x.manuell ? "manuellt namn" : "ej kopplad") + ')</span>') + '</td>' +
                '<td>' + esc(x.orsak) + '</td><td class="dat">' + (x.fran === x.till ? kortDatum(x.fran) : kortDatum(x.fran) + "–" + kortDatum(x.till)) + '</td>' +
                '<td>' + (x.tid ? "del av dag" : x.arbetsdagar) + '</td><td>' + esc(x.tid || "–") + '</td><td>' + esc(x.vad || "–") + '</td>' +
                '<td>' + esc(x.tavla) + '</td><td class="kvitt">□</td></tr>').join("") + '</tbody></table>'
            : '<p class="utom">Ingen frånvaro registrerad för valt urval.</p>');
    skrivUt(html, false);
}

function utskriftUtfall(vStart) {
    const u = veckoUtfall(vStart, T()), antal = u.planerade.length;
    const procent = antal ? Math.round(u.genomforda.length / antal * 100) : null;
    const orsak = Object.keys(u.orsaker).sort((a, b) => u.orsaker[b] - u.orsaker[a]);
    return '<table class="lista"><tbody>' +
        '<tr><td>Planpålitlighet</td><td><b>' + (procent === null ? "–" : procent + " %") + '</b></td></tr>' +
        '<tr><td>Planerade produktionsaktiviteter</td><td>' + antal + '</td></tr>' +
        '<tr><td>Genomförda</td><td>' + u.genomforda.length +
        (u.senaBockar.length ? " (varav " + u.senaBockar.length + " avbockade efter veckan)" : "") + '</td></tr>' +
        '<tr><td>Ej genomförda</td><td>' + u.ejGjorda.length + '</td></tr>' +
        (u.tillkomna.length ? '<tr><td>Tillkom under veckan</td><td>' + u.tillkomna.length +
            " (varav " + u.tillkomnaKlara.length + " genomförda)</td></tr>" : "") +
        '<tr><td>Hinder skapade / lösta / kvarstående</td><td>' + u.hSkapade.length + " / " + u.hLosta.length + " / " + u.hKvar.length + '</td></tr>' +
        (orsak.length ? '<tr><td>Orsaker till framflyttning</td><td>' +
            orsak.map(o => esc(o) + " " + u.orsaker[o]).join(" · ") + '</td></tr>' : "") +
        '</tbody></table>';
}

/* ---------- avropslistan på skärm ---------- */

let avropFilter = { typ: "alla", tavla: "denna", period: "4v", fran: null, till: null, foretag: "" };

function avropUrval() {
    const per = avropPeriod(avropFilter);
    const tavlor = avropFilter.tavla === "alla" ? state.tavlor : [T()];
    const rader = avropRader({ typ: avropFilter.typ, tavlor: tavlor, fran: per.fran, till: per.till,
        foretag: avropFilter.foretag }, state);
    const typtext = avropFilter.typ === "material" ? "Material" : avropFilter.typ === "ue" ? "UE / externa resurser" : "Alla avrop";
    const ftg = avropFilter.foretag === "__utan" ? "Utan angivet företag"
        : avropFilter.foretag ? foretagNamn(avropFilter.foretag, tavlor, state) : "";
    return { rader: rader, per: per, flera: tavlor.length > 1, foretag: ftg,
        urval: (avropFilter.tavla === "alla" ? "Alla delområden" : T().namn) + " · " + typtext +
            (ftg ? " · " + ftg : "") + " · " + per.text,
        tomtext: "Inga avrop" + (ftg ? " för " + ftg : "") + " under " + per.text.toLowerCase() + "." };
}

function avropFilterHtml() {
    const v = avropFilter;
    return '<div class="filterrad">' +
        '<label>Typ<select class="f" id="afTyp">' +
        [["alla", "Alla"], ["material", "Material"], ["ue", "UE / extern resurs"]].map(x => '<option value="' + x[0] + '"' + (v.typ === x[0] ? " selected" : "") + '>' + x[1] + '</option>').join("") + '</select></label>' +
        '<label>Tavla<select class="f" id="afTavla">' +
        '<option value="denna"' + (v.tavla === "denna" ? " selected" : "") + '>Aktuell tavla</option>' +
        '<option value="alla"' + (v.tavla === "alla" ? " selected" : "") + '>Alla delområden</option></select></label>' +
        '<label>Företag<select class="f" id="afForetag">' + foretagOptioner() + '</select></label>' +
        '<label>Period<select class="f" id="afPeriod">' +
        [["denna", "Denna vecka"], ["2v", "2 veckor"], ["4v", "4 veckor"], ["valj", "Välj veckor"], ["alla", "Alla framtida"]].map(x => '<option value="' + x[0] + '"' + (v.period === x[0] ? " selected" : "") + '>' + x[1] + '</option>').join("") + '</select></label>' +
        '<label class="vvalj' + (v.period === "valj" ? "" : " dold") + '">Från<select class="f" id="afFran">' + veckoOptioner(v.fran || visaStart()) + '</select></label>' +
        '<label class="vvalj' + (v.period === "valj" ? "" : " dold") + '">Till<select class="f" id="afTill">' + veckoOptioner(v.till || plus(visaStart(), 14)) + '</select></label>' +
        '</div>';
}

function foretagOptioner() {
    const tavlor = avropFilter.tavla === "alla" ? state.tavlor : [T()];
    const lista = foretagLista(tavlor, state);
    if (avropFilter.foretag && avropFilter.foretag !== "__utan" && !lista.some(f => f.nyckel === avropFilter.foretag))
        avropFilter.foretag = "";
    const reg = lista.filter(f => f.kopplad), fri = lista.filter(f => !f.kopplad);
    const opt = f => '<option value="' + esc(f.nyckel) + '"' + (avropFilter.foretag === f.nyckel ? " selected" : "") +
        '>' + esc(f.namn) + (f.kopplad && !f.aktiv ? " (inaktiv)" : "") + '</option>';
    return '<option value=""' + (avropFilter.foretag ? "" : " selected") + '>Alla företag</option>' +
        reg.map(opt).join("") +
        (fri.length ? '<optgroup label="Ej kopplade till registret">' + fri.map(opt).join("") + '</optgroup>' : "") +
        (lista.utan ? '<option value="__utan"' + (avropFilter.foretag === "__utan" ? " selected" : "") +
            '>Utan angivet företag</option>' : "");
}

function kopplaAvropFilter(rita) {
    const ftgFalt = () => document.getElementById("afForetag");
    const byt = (omTavla) => {
        avropFilter.typ = document.getElementById("afTyp").value;
        avropFilter.tavla = document.getElementById("afTavla").value;
        avropFilter.period = document.getElementById("afPeriod").value;
        avropFilter.fran = document.getElementById("afFran").value;
        avropFilter.till = document.getElementById("afTill").value;
        if (ftgFalt())
            avropFilter.foretag = ftgFalt().value;
        if (omTavla && ftgFalt())
            ftgFalt().innerHTML = foretagOptioner();
        document.querySelectorAll(".vvalj").forEach(e => e.classList.toggle("dold", avropFilter.period !== "valj"));
        rita();
    };
    ["afTyp", "afPeriod", "afFran", "afTill", "afForetag"].forEach(i => {
        const e = document.getElementById(i);
        if (e)
            e.addEventListener("change", () => byt(false));
    });
    const tv = document.getElementById("afTavla");
    if (tv)
        tv.addEventListener("change", () => byt(true));
}

function avropDialog() {
    const kropp = avropFilterHtml() + '<div id="afInnehall"></div>';
    modal("Avropslista", "Vilka avrop behöver göras?", kropp, [
        { txt: "Stäng", fn: stangModal },
        { txt: "Skriv ut listan", primar: true, fn: () => { const u = avropUrval(); stangModal(); skrivUtAvrop(u); } }
    ]);
    const m = document.querySelector("#overlay .modal");
    if (m)
        m.style.maxWidth = "1000px";
    function rita2() {
        const u = avropUrval();
        const box = document.getElementById("afInnehall");
        box.innerHTML = (u.rader.length ? avropTabell(u.rader, u.flera)
            : '<div class="listtom">' + esc(u.tomtext) + '</div>') +
            (u.rader.utanTyp ? '<p class="hjalp" style="margin-top:10px">' + u.rader.utanTyp +
                ' avrop saknar typ (skapade innan Material/UE infördes) och kommer bara med under Alla.</p>' : "");
    }
    kopplaAvropFilter(rita2);
    rita2();
}

function skrivUtAvrop(u) {
    const titel = u.foretag && u.foretag !== "Utan angivet företag"
        ? "Planerad avrops- och leveransöversikt – " + u.foretag : "Avropslista";
    const html = utskriftHuvud(titel, u.urval) +
        '<p class="ufriskrivning">Planeringsunderlag för framförhållning. Detta är inte ett avrop eller en beställning.</p>' +
        (u.rader.length ? avropTabell(u.rader, u.flera) : '<p class="utom">' + esc(u.tomtext) + '</p>') +
        (u.rader.utanTyp ? '<p class="utom">' + u.rader.utanTyp + ' avrop saknar typ och kommer bara med under Alla.</p>' : "");
    skrivUt(html, u.flera);
}

/* ---------- utskriftsdialogen ---------- */

function utskriftDialog() {
    const valdaTyper = TYPER.filter(t => document.getElementById("v-" + t).checked);
    const kropp = '<div class="uval">' +
        '<div class="krysslista">' +
        [["kalender", "Kalender"], ["oversikt", "Veckans produktionsöversikt"], ["resurser", "Resursplanering"],
            ["franvaro", "Frånvarolista"], ["projektstart", "Att göra"], ["avrop", "Avropslista"],
            ["hinder", "Hinderlista"], ["vader", "Vädervarningar"]].map((x, i) => '<label><input type="radio" name="uinnehall" value="' + x[0] + '"' + (i === 0 ? " checked" : "") + '> ' + x[1] + '</label>').join("") +
        '</div></div>' +
        '<div id="uKalender"><div class="rubrik2">Period</div><div class="krysslista">' +
        '<label><input type="radio" name="uper" value="2" checked> 2 veckor</label>' +
        '<label><input type="radio" name="uper" value="4"> 4 veckor</label></div>' +
        '<div class="rubrik2">Korttyper</div><div class="krysslista">' +
        TYPER.map(t => '<label><input type="checkbox" class="utyp" value="' + t + '"' +
            (valdaTyper.indexOf(t) >= 0 ? " checked" : "") + '> ' + TYPNAMN[t] + '</label>').join("") + '</div>' +
        '<div class="rubrik2">Ta även med</div><div class="krysslista">' +
        '<label><input type="checkbox" id="uHinder"> Hinderlista</label>' +
        '<label><input type="checkbox" id="uVader"> Vädervarningar</label>' +
        '<label><input type="checkbox" id="uUtfall"> Veckans utfall</label></div></div>' +
        '<div id="uAvrop" class="dold">' + avropFilterHtml() + '</div>' +
        '<div id="uHinderval" class="dold"><div class="krysslista">' +
        '<label>Tavla<select class="f" id="uhTavla" style="margin-left:7px">' +
        '<option value="denna">Aktuell tavla</option><option value="alla">Alla delområden</option></select></label>' +
        '<label><input type="checkbox" id="uhLosta"> Ta med lösta hinder</label></div></div>' +
        '<div id="uVaderval" class="dold"><p class="hjalp" style="margin:0">Vädervarningarna är gemensamma för projektet och skrivs ut för hela perioden, helger inkluderade.</p></div>' +
        '<div id="uFranvaro" class="dold"><div class="filterrad">' +
        '<label>Person<select class="f" id="ufPerson"><option value="">Alla personer</option>' +
        state.resurser.personer.slice().sort((a, b) => a.namn.localeCompare(b.namn, "sv")).map(x => '<option value="' + x.id + '">' + esc(x.namn) + (x.aktiv ? "" : " (inaktiv)") + '</option>').join("") +
        '<option value="__okopplad">Ej kopplade (äldre poster)</option></select></label>' +
        '<label>Orsak<select class="f" id="ufOrsak"><option value="">Alla orsaker</option>' +
        FRANVARO.map(o => '<option>' + o + '</option>').join("") + '</select></label>' +
        '<label>Period<select class="f" id="ufPeriod">' + [["forra", "Förra veckan"], ["denna", "Denna vecka"],
        ["2v", "2 veckor"], ["4v", "4 veckor"], ["valj", "Välj veckor"], ["alla", "Alla registrerade"]].map(x => '<option value="' + x[0] + '"' + (x[0] === "4v" ? " selected" : "") + '>' + x[1] + '</option>').join("") + '</select></label>' +
        '<label class="dold" id="ufFranL">Från<select class="f" id="ufFran">' + veckoOptioner(dennaVeckasMandag(IDAG)) + '</select></label>' +
        '<label class="dold" id="ufTillL">Till<select class="f" id="ufTill">' + veckoOptioner(dennaVeckasMandag(IDAG)) + '</select></label>' +
        '</div><p class="hjalp" style="margin:0">Kontrollunderlag, t.ex. mot lönelistor. Hela projektet, alla tavlor.</p></div>';
    modal("Skriv ut", "Kalendern skrivs ut som du har valt att visa den — inget annat följer med automatiskt.", kropp, [
        { txt: "Avbryt", fn: stangModal },
        { txt: "Skriv ut", primar: true, fn: kor }
    ]);
    const visa = () => {
        const v = document.querySelector('input[name="uinnehall"]:checked').value;
        document.getElementById("uKalender").classList.toggle("dold", v !== "kalender");
        document.getElementById("uAvrop").classList.toggle("dold", v !== "avrop");
        document.getElementById("uHinderval").classList.toggle("dold", v !== "hinder");
        document.getElementById("uVaderval").classList.toggle("dold", v !== "vader");
        document.getElementById("uFranvaro").classList.toggle("dold", v !== "franvaro");
    };
    document.querySelectorAll('input[name="uinnehall"]').forEach(r => r.addEventListener("change", visa));
    kopplaAvropFilter(() => { });
    const ufp = document.getElementById("ufPeriod");
    if (ufp)
        ufp.addEventListener("change", () => {
            document.getElementById("ufFranL").classList.toggle("dold", ufp.value !== "valj");
            document.getElementById("ufTillL").classList.toggle("dold", ufp.value !== "valj");
        });
    visa();
    function kor() {
        const v = document.querySelector('input[name="uinnehall"]:checked').value;
        if (v === "oversikt") {
            stangModal();
            return skrivUtOversikt(state, state.tavlor);
        }
        if (v === "resurser") {
            stangModal();
            return resursVy();
        }
        if (v === "avrop") {
            const u = avropUrval();
            stangModal();
            return skrivUtAvrop(u);
        }
        if (v === "hinder") {
            const alla = document.getElementById("uhTavla").value === "alla";
            const tavlor = alla ? state.tavlor : [T()];
            const losta = document.getElementById("uhLosta").checked;
            const tab = utskriftHinder(tavlor, losta);
            const urval = (alla ? "Alla delområden" : T().namn) + (losta ? " · öppna och lösta" : " · öppna hinder");
            stangModal();
            return skrivUt(utskriftHuvud("Hinderlista", urval) +
                (tab || '<p class="utom">Inga hinder finns för valt urval.</p>'), false);
        }
        if (v === "projektstart") {
            stangModal();
            return skrivUtProjektstart(state);
        }
        if (v === "franvaro") {
            const f = { person: document.getElementById("ufPerson").value, orsak: document.getElementById("ufOrsak").value,
                period: document.getElementById("ufPeriod").value, fran: document.getElementById("ufFran").value,
                till: document.getElementById("ufTill").value };
            stangModal();
            return skrivUtFranvaro(state, f);
        }
        if (v === "vader") {
            const tab = utskriftVader();
            stangModal();
            return skrivUt(utskriftHuvud("Vädervarningar", "Projektets gränsvärden · " +
                kortDatum(visaStart()) + "–" + kortDatum(plus(visaStart(), 27))) +
                (tab || '<p class="utom">Inga överskridna gränsvärden i prognosen.</p>'), false);
        }
        const veckor = +document.querySelector('input[name="uper"]:checked').value;
        const typer = Array.prototype.slice.call(document.querySelectorAll(".utyp:checked")).map(e => e.value);
        const medHinder = document.getElementById("uHinder").checked;
        const medVader = document.getElementById("uVader").checked;
        const medUtfall = document.getElementById("uUtfall").checked;
        const kal = utskriftKalender({ veckor: veckor, typer: typer });
        const vs = visaStart();
        const urval = T().namn + " · vecka " + veckonr(vs) + "–" + veckonr(plus(vs, (veckor - 1) * 7)) + " · " +
            (typer.length === TYPER.length ? "alla korttyper" : typer.map(t => TYPNAMN[t]).join(", ") || "inget valt");
        let html = utskriftHuvud("Kalender", urval);
        html += typer.length && kal.antal ? kal.html
            : '<p class="utom">' + (typer.length ? "Inga aktiviteter av valda typer i perioden." : "Inga korttyper valda.") + '</p>';
        if (medHinder) {
            const tab = utskriftHinder([T()], false);
            html += '<div class="ublock"><h3>Hinderlista</h3>' + (tab || '<p class="utom">Inga öppna hinder.</p>') + '</div>';
        }
        if (medVader) {
            const tab = utskriftVader();
            html += '<div class="ublock"><h3>Vädervarningar</h3>' + (tab || '<p class="utom">Inga överskridna gränsvärden.</p>') + '</div>';
        }
        if (medUtfall) {
            html += '<div class="ublock"><h3>Veckans utfall · v' + veckonr(vs) + '</h3>' + utskriftUtfall(vs) + '</div>';
        }
        stangModal();
        skrivUt(html, true);
    }
}

/* ---------- projektets vädervarningar ---------- */

function vaderVarningar() { return vaderVarningarPeriod(visaStart(), 28); }

function vaderTraffar(iso) { const v = vaderVarningarPeriod(iso, 1); return v.length ? v[0].traffar : []; }

function vaderVarningarPeriod(start, antalDagar) {
    const ut = [], aktiva = aktivaGranser(state);
    if (!aktiva.length)
        return ut;
    for (let i = 0; i < antalDagar; i++) {
        const iso = plus(start, i), v = VADER[iso];
        if (!v)
            continue;
        const traffar = [];
        aktiva.forEach(t => {
            const varde = v[t.falt];
            if (varde === undefined || varde === null)
                return;
            const grans = parseFloat(state.varningar[t.id].varde);
            if (isNaN(grans))
                return;
            if (t.riktning === "over" ? varde > grans : varde < grans)
                traffar.push(t.etikett(varde));
        });
        if (traffar.length)
            ut.push({ dag: iso, traffar: traffar });
    }
    return ut;
}

function vaderDagNamn(iso) {
    return iso === IDAG ? "Idag" : iso === plus(IDAG, 1) ? "Imorgon" : dagNamnKort(iso).split(" ")[0];
}

function vaderDagRad(iso) {
    const v = VADER[iso];
    if (!v)
        return "";
    const b = vaderBedomning(v);
    const egna = vaderTraffar(iso);
    const temp = (v.temp !== null ? Math.round(v.temp) + "°" : "–") + (v.tempMin !== null ? '<small>' + Math.round(v.tempMin) + "°</small>" : "");
    const del = (t) => '<span class="vp-del">' + t + "</span>";
    const detalj = del("💨 " + Math.round(v.vind) + " m/s" + (v.byvind ? " (" + Math.round(v.byvind) + ")" : "")) +
        " · " + del("💧 " + (v.nederbord >= 10 ? Math.round(v.nederbord) : v.nederbord.toFixed(1).replace(".", ",")) + " mm") +
        (v.regnrisk !== null && v.regnrisk !== undefined ? " · " + del(v.regnrisk + " % risk") : "");
    return '<div class="vp-dag niva-' + b.niva + (iso === IDAG ? " idag" : "") + '">' +
        '<span class="vp-namn"><b>' + vaderDagNamn(iso) + "</b><small>" + kortDatum(iso) + "</small></span>" +
        '<span class="vp-sym" aria-hidden="true">' + v.symbol + "</span>" +
        '<span class="vp-temp">' + temp + "</span>" +
        '<span class="vp-bed"><span class="vp-tagg ' + b.niva + '"' +
        (b.rader.length || egna.length ? ' title="' + esc(b.rader.map(x => x.txt).concat(egna.length ? ["Över projektets gräns: " + egna.join(", ")] : []).join(" · ")) + '"' : "") +
        ">" + esc(b.status) + "</span>" +
        '<span class="vp-detalj">' + detalj + "</span></span></div>";
}

function ritaVarningar() {
    const box = document.getElementById("varningsinnehall");
    if (!box)
        return;
    const plats = vaderPlats();
    const harData = VADER._idag && VADER[IDAG];
    let html = "";
    if (!harData) {
        html = '<div class="tomrad">' + esc(vaderFel || "Hämtar väderprognosen för " + plats.namn + "…") + "</div>";
    }
    else {
        const vecka1 = [], vecka2 = [];
        for (let i = 0; i < 14; i++)
            (i < 7 ? vecka1 : vecka2).push(plus(IDAG, i));
        const grupp = (rubrik, under, lista) => {
            const rader = lista.map(vaderDagRad).join("");
            if (!rader)
                return "";
            const roda = lista.filter(d => VADER[d] && vaderBedomning(VADER[d]).niva === "rod").length;
            const gula = lista.filter(d => VADER[d] && vaderBedomning(VADER[d]).niva === "gul").length;
            const sammanfattning = roda ? roda + (roda === 1 ? " dag med varning" : " dagar med varning")
                : gula ? gula + (gula === 1 ? " dag att tänka på" : " dagar att tänka på") : "Inget besvärligt väder";
            return '<div class="vp-grupp"><div class="vp-grupprubrik"><b>' + rubrik + "</b>" +
                (under ? "<small>" + under + "</small>" : "") +
                '<span class="vp-summa ' + (roda ? "rod" : gula ? "gul" : "gron") + '">' + sammanfattning + "</span></div>" + rader + "</div>";
        };
        html = '<div class="vp-plats">📍 ' + esc(VADER._namn || plats.namn) + " · 14 dagar framåt</div>" +
            grupp("Kommande 7 dagar", kortDatum(vecka1[0]) + "–" + kortDatum(vecka1[6]), vecka1) +
            grupp("Följande 7 dagar", kortDatum(vecka2[0]) + "–" + kortDatum(vecka2[6]) + " · mer osäker prognos", vecka2) +
            '<p class="vp-kalla">Prognos från Open-Meteo · hämtad ' +
            new Date(VADER._tid).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" }) +
            (state.plats && state.plats.lat ? "" : " · byt ort under Projektinställningar") + "</p>";
    }
    box.innerHTML = html;
    // remsan överst på tavlan: varningar de närmaste fyra dagarna
    const remsa = document.getElementById("varningsremsa");
    const egna = vaderVarningar();
    const naraDagar = [0, 1, 2, 3].map(i => plus(IDAG, i)).map(dag => {
        const v = VADER[dag];
        const roda = v && vaderBedomning(v).niva === "rod" ? ["Mycket dåligt väder"] : [];
        const e = (egna.find(x => x.dag === dag) || { traffar: [] }).traffar;
        return { dag: dag, txt: roda.concat(e) };
    }).filter(x => x.txt.length);
    remsa.classList.toggle("har", naraDagar.length > 0);
    remsa.innerHTML = naraDagar.length
        ? '<span>⚠ Vädervarning</span>' + naraDagar.map(x => '<span class="vdag">' + vaderDagNamn(x.dag) + " " +
            esc(x.txt.join(" · ")) + '</span>').join("")
        : "";
}
