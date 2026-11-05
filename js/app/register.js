/* ======================================================================
   Företagsregister, frånvaro, bemanning och resursplanering
   ====================================================================== */

/* ---------- företagsregister: logik ---------- */

function projektForTavla(t) { return plan4.projekt.find(p => p.tavlor.indexOf(t) >= 0) || state; }

function nyttForetag(p, namn, roller) {
    const patch = opNyttForetag(namn, roller, null, null);
    if (!patch.ok)
        return null;
    if (!appliceraPatch(patch, { tavla: T(), projekt: p }))
        return null;
    const id = patch.andringar[0].id;
    return (p.foretag || []).find(f => f.id === id) || null;
}

function foretagValjare(p, roll, valtId, falt, manuellText, utanManuell) {
    const lista = (p.foretag || []).filter(f => f.id === valtId || (f.aktiv && (!roll || f.roller.indexOf(roll) >= 0)))
        .sort((a, b) => a.namn.localeCompare(b.namn, "sv"));
    const man = !utanManuell && !valtId && !!manuellText;
    return '<span class="ftgvaljare"><select class="f ftgval" data-f="' + falt + '" data-roll="' + (roll || "") + '">' +
        '<option value="">Ej angivet</option>' +
        lista.map(f => '<option value="' + f.id + '"' + (f.id === valtId ? " selected" : "") + '>' + esc(f.namn) +
            (f.aktiv ? "" : " (inaktiv)") + '</option>').join("") +
        (utanManuell ? "" : '<option value="__manuell"' + (man ? " selected" : "") + '>Skriv manuellt…</option>') +
        '<option value="__nytt">+ Nytt företag i registret…</option></select>' +
        (utanManuell ? "" : '<input class="f ftgman' + (man ? "" : " dold") + '" value="' + esc(man ? manuellText : "") +
            '" placeholder="Företagets namn — läggs inte i registret"><span class="ftgmanhjalp"></span>') +
        '<span class="ftgny dold"><input class="f" placeholder="Företagets namn">' +
        '<button type="button" class="mknapp">Skapa</button><span class="ftgvarn"></span></span></span>';
}

function kopplaForetagValjare(rot, p, vidVal) {
    (rot || document).querySelectorAll(".ftgvaljare").forEach(v => {
        if (v.dataset.kopplad)
            return;
        v.dataset.kopplad = "1";
        const sel = v.querySelector("select"), ny = v.querySelector(".ftgny");
        const inp = ny.querySelector("input"), kn = ny.querySelector("button"), varn = ny.querySelector(".ftgvarn");
        let foreVal = sel.value, dublettOk = false;
        const man = v.querySelector(".ftgman"), manH = v.querySelector(".ftgmanhjalp");
        sel.addEventListener("change", () => {
            if (sel.value === "__nytt") {
                ny.classList.remove("dold");
                if (man)
                    man.classList.add("dold");
                inp.focus();
                return;
            }
            ny.classList.add("dold");
            foreVal = sel.value;
            if (sel.value === "__manuell") {
                man.classList.remove("dold");
                man.focus();
                vidVal(sel, null, false, man.value.trim());
                return;
            }
            if (man) {
                man.classList.add("dold");
                if (manH)
                    manH.innerHTML = "";
            }
            vidVal(sel, sel.value || null, false, "");
        });
        if (man)
            man.addEventListener("input", () => {
                const d = ftgDubblett(p, man.value);
                if (manH)
                    manH.innerHTML = d ? '<span class="hjalp" style="display:block;margin:3px 0 0">' + esc(d.namn) +
                        ' finns i registret. Välj det i listan om det är samma företag.</span>' : "";
                vidVal(sel, null, false, man.value.trim());
            });
        kn.addEventListener("click", () => {
            const namn = inp.value.trim();
            if (!namn)
                return inp.focus();
            const d = ftgDubblett(p, namn);
            if (d && !dublettOk) {
                varn.innerHTML = '<span class="notis" style="display:block;margin:6px 0 0">' + esc(d.namn) +
                    ' finns redan i registret. Välj det i listan — eller klicka Skapa igen för ett nytt företag ändå.</span>';
                dublettOk = true;
                return;
            }
            const f = nyttForetag(p, namn, sel.dataset.roll ? [sel.dataset.roll] : []);
            logg("Företag registrerat: " + f.namn);
            const o = document.createElement("option");
            o.value = f.id;
            o.textContent = f.namn;
            sel.insertBefore(o, sel.querySelector('option[value="__nytt"]'));
            sel.value = f.id;
            foreVal = f.id;
            ny.classList.add("dold");
            inp.value = "";
            varn.innerHTML = "";
            dublettOk = false;
            spara();
            vidVal(sel, f.id, true);
        });
        inp.addEventListener("keydown", e => {
            if (e.key === "Enter") {
                e.preventDefault();
                kn.click();
            }
            if (e.key === "Escape") {
                e.stopPropagation();
                ny.classList.add("dold");
                sel.value = foreVal;
            }
        });
    });
}

/* ---------- projektstart: logik ---------- */

const FKAT = ["Inköp", "UE", "Logistik", "Arbetsmiljö", "Myndighet", "Projektering", "Etablering", "Arbetsberedning", "Övrigt"];
const FSTATUS = ["Ej påbörjad", "Pågår", "Klar", "Ej aktuell"];

function pagaendeHtml(lista) {
    if (!lista.length)
        return "";
    return '<div class="pagaende"><span class="prub">Pågående</span>' +
        lista.map(x => '<div class="prad" data-pk="' + x.kort.id + '">› ' + esc(x.text) + '</div>').join("") + '</div>';
}

/* ---------- frånvaro: logik ---------- */

/* ---------- frånvaro: formuläret ---------- */

function franvaroDialog(k, forval) {
    const p = state, ny = !k, f = forval || {};
    const bas = k || {};
    let orsak = bas.franvaroOrsak || f.franvaroOrsak || FRANVARO[0];
    const startDag = bas.dag || f.dag || IDAG;
    const per0 = k ? franvaroPeriod(k) : { fran: startDag, till: f.tillDag || startDag, del: !!f.tid };
    let omf = per0.del ? "del" : (per0.till !== per0.fran ? "flera" : "dag");
    const valdPid = bas.personId || f.personId || "";
    const aktiva = p.resurser.personer.filter(x => x.aktiv || x.id === valdPid)
        .sort((a, b) => a.namn.localeCompare(b.namn, "sv"));
    const aldre = k && !k.personId && !k.personNamn;
    const manNamn = bas.personNamn || f.personNamn || "";
    const manuell = !valdPid && !!manNamn;
    const kropp = (aldre ? '<div class="notis" style="margin-top:0">Äldre frånvaropost utan koppling: <b>' + esc(k.text || "—") +
        '</b>. Välj person nedan för att koppla den till resursbanken. Plan4 gissar aldrig vem det är.</div>' : "") +
        '<div class="falt"><label for="fvPerson">Person</label><select class="f" id="fvPerson">' +
        '<option value="">' + (aldre ? "Ej kopplad — välj person" : "Välj person") + '</option>' +
        aktiva.map(x => '<option value="' + x.id + '"' + (x.id === valdPid ? " selected" : "") + '>' + esc(x.namn) +
            (x.aktiv ? "" : " (inaktiv)") + '</option>').join("") +
        '<option value="__manuell"' + (manuell ? " selected" : "") + '>Skriv namn manuellt…</option></select>' +
        '<input class="f' + (manuell ? "" : " dold") + '" id="fvNamn" style="margin-top:6px" value="' + esc(manNamn || (aldre ? k.text || "" : "")) +
        '" placeholder="Namn, t.ex. Extern montör">' +
        '<p class="hjalp" id="fvNamnHjalp" style="margin:4px 0 0' + (manuell ? "" : ";display:none") + '">Manuellt namn läggs inte i resursbanken ' +
        'och används inte i resursplaneringen.</p></div>' +
        '<div class="falt"><label>Orsak</label><div class="lage" id="fvOrsak">' + FRANVARO.map(o => '<button type="button" data-o="' + o + '"' + (o === orsak ? ' class="vald"' : "") + '>' + o + '</button>').join("") + '</div></div>' +
        '<div class="falt"><label for="fvVad">Kommentar / Vad? (frivilligt)</label>' +
        '<input class="f" id="fvVad" value="' + esc(aldre ? "" : (bas.text || f.text || "")) + '" placeholder="Semester, utbildning …"></div>' +
        '<div class="falt"><label>Omfattning</label><div class="lage" id="fvOmf">' +
        [["dag", "En dag"], ["flera", "Flera dagar"], ["del", "Del av dag"]].map(x => '<button type="button" data-v="' + x[0] + '"' + (omf === x[0] ? ' class="vald"' : "") + '>' + x[1] + '</button>').join("") + '</div></div>' +
        '<div class="tva"><div class="falt"><label for="fvFran" id="fvFranEt">Datum</label>' +
        '<input class="f" id="fvFran" type="date" value="' + per0.fran + '"></div>' +
        '<div class="falt" id="fvTillF"><label for="fvTill">Till och med</label>' +
        '<input class="f" id="fvTill" type="date" value="' + per0.till + '"></div></div>' +
        '<div class="tva" id="fvTider"><div class="falt"><label for="fvStart">Från kl.</label>' +
        '<input class="f" id="fvStart" type="time" value="' + esc(bas.tid || f.tid || "") + '"></div>' +
        '<div class="falt"><label for="fvSlut">Till kl.</label>' +
        '<input class="f" id="fvSlut" type="time" value="' + esc(bas.slutTid || f.slutTid || "") + '"></div></div>' +
        '<div id="fvVarn"></div>';
    modal(ny ? "Frånvaro" : "Ändra frånvaro", p.projekt, kropp, [
        ...(ny ? [] : [{ txt: "Ta bort", vanster: true, fara: true, fn: () => { raderaKort(k, "Frånvaro borttagen: " + franvaroTitel(p, k)); } }]),
        { txt: "Avbryt", fn: stangModal },
        { txt: ny ? "Lägg till" : "Spara", primar: true, fn: spar }
    ]);
    function visaFalt() {
        document.getElementById("fvTillF").style.display = omf === "flera" ? "" : "none";
        document.getElementById("fvTider").style.display = omf === "del" ? "" : "none";
        document.getElementById("fvFranEt").textContent = omf === "flera" ? "Från" : "Datum";
    }
    function varden() {
        const fran = document.getElementById("fvFran").value;
        let till = omf === "flera" ? document.getElementById("fvTill").value : fran;
        const pv = document.getElementById("fvPerson").value;
        return { pid: pv === "__manuell" ? "" : pv, namn: pv === "__manuell" ? document.getElementById("fvNamn").value.trim() : "",
            fran: fran, till: till,
            tid: omf === "del" ? document.getElementById("fvStart").value : "",
            slut: omf === "del" ? document.getElementById("fvSlut").value : "" };
    }
    function kontroll() {
        const v = varden(), box = document.getElementById("fvVarn");
        if (!v.pid || !v.fran || (omf === "flera" && (!v.till || v.till < v.fran))) {
            box.innerHTML = "";
            return;
        }
        const karta = resursKarta(p, p.tavlor, v.fran, v.till)[v.pid] || {};
        const perMoment = {};
        Object.keys(karta).sort().forEach(d => karta[d].forEach(m => {
            (perMoment[m.kort.id] = perMoment[m.kort.id] || { m: m, dagar: [] }).dagar.push(d);
        }));
        const lista = Object.keys(perMoment).map(id => perMoment[id]);
        const x = resPers(p, v.pid);
        box.innerHTML = lista.length ? '<div class="notis">⚠ <b>' + esc(x ? x.namn : "") + ' är redan resurssatt under denna period</b><br>' +
            lista.map(o => periodText(o.dagar[0], o.dagar[o.dagar.length - 1]) + " · " + esc(momentRef(o.m))).join("<br>") +
            (omf === "del" ? "<br>Delvis frånvaro räknas inte bort ur numerären, men markeras i resursplaneringen." : "") +
            '<br>Frånvaron kan sparas ändå.</div>' : "";
    }
    function spar() {
        const v = varden(), fel = [];
        if (!v.pid && !v.namn && !aldre)
            fel.push("Välj person eller skriv ett namn.");
        if (!v.fran)
            fel.push("Välj datum.");
        if (omf === "flera" && (!v.till || v.till < v.fran))
            fel.push("Till och med måste vara samma dag eller senare.");
        if (omf === "del" && (!v.tid || !v.slut))
            fel.push("Ange från och till klockslag.");
        if (omf === "del" && v.tid && v.slut && v.slut <= v.tid)
            fel.push("Sluttiden måste vara senare än starttiden.");
        if (v.fran && (iso2d(v.fran).getDay() + 6) % 7 > 4 && omf !== "flera")
            fel.push("Tavlan visar måndag till fredag — välj en vardag.");
        if (fel.length) {
            document.getElementById("fvVarn").innerHTML = '<div class="notis rod">' + fel.join("<br>") + '</div>';
            return;
        }
        const vad = document.getElementById("fvVad").value.trim();
        const t = T();
        const underlag = { dag: v.fran, tillDag: omf === "flera" && v.till > v.fran ? v.till : "",
            tid: v.tid, slutTid: v.slut, franvaroOrsak: orsak,
            personId: v.pid || "", personNamn: v.pid ? "" : v.namn, text: vad };
        const patch = k ? opAndraFranvaro(k, underlag, t.id) : opNyFranvaro(underlag, t.id, null, null);
        if (!patch.ok)
            return;
        if (!appliceraPatch(patch, { tavla: t, projekt: state }))
            return;
        const mal = k || t.kort.find(x => x.id === patch.andringar[0].id);
        if (!mal)
            return;
        logg((ny ? "Frånvaro registrerad: " : "Frånvaro ändrad: ") + franvaroTitel(p, mal) + " · " + franvaroUnder(p, mal));
        stangModal();
        spara();
        rita();
    }
    document.querySelectorAll("#fvOrsak button").forEach(b => b.addEventListener("click", () => {
        orsak = b.dataset.o;
        document.querySelectorAll("#fvOrsak button").forEach(x => x.classList.toggle("vald", x === b));
    }));
    document.querySelectorAll("#fvOmf button").forEach(b => b.addEventListener("click", () => {
        omf = b.dataset.v;
        document.querySelectorAll("#fvOmf button").forEach(x => x.classList.toggle("vald", x === b));
        visaFalt();
        kontroll();
    }));
    ["fvPerson", "fvFran", "fvTill", "fvStart", "fvSlut"].forEach(id => {
        const e = document.getElementById(id);
        if (e)
            e.addEventListener("change", kontroll);
    });
    document.getElementById("fvPerson").addEventListener("change", e => {
        const man = e.target.value === "__manuell";
        document.getElementById("fvNamn").classList.toggle("dold", !man);
        document.getElementById("fvNamnHjalp").style.display = man ? "" : "none";
        if (man)
            document.getElementById("fvNamn").focus();
    });
    visaFalt();
    kontroll();
}

/* ---------- resurser: logik ---------- */

/* ---------- resurser: redigering av bemanning ---------- */

function bemanningRedigerare(p, b, period, egetId) {
    const kat = p.resurser.kategorier, pers = p.resurser.personer;
    if (!kat.length)
        return '<p class="hjalp" style="margin:0">Projektet har inga resurser ännu. ' +
            'Lägg till yrkesgrupper och personer under Projektinställningar → Resurser.</p>';
    const valdaKat = (b.behov || []).map(x => x.kategoriId);
    const ordning = kat.slice().sort((a, c) => (valdaKat.indexOf(a.id) < 0) - (valdaKat.indexOf(c.id) < 0));
    return '<div class="rubrik2">Resursbehov</div>' +
        '<div id="bemBehov">' + (b.behov || []).map((x, i) => '<div class="bemrad" data-i="' + i + '"><select class="f" data-f="kat">' +
        kat.map(c => '<option value="' + c.id + '"' + (c.id === x.kategoriId ? " selected" : "") + '>' + esc(c.namn) + '</option>').join("") +
        '</select><input class="f" data-f="antal" type="number" min="1" max="99" value="' + x.antal + '">' +
        '<button type="button" class="fbort" data-bort="' + i + '" title="Ta bort">✕</button></div>').join("") + '</div>' +
        '<button type="button" class="egetknapp" id="bemLagg">+ Resursbehov</button>' +
        '<div class="rubrik2" style="margin-top:12px">Namngivna personer</div>' +
        '<div class="bempers">' + ordning.map(c => {
        const ic = pers.filter(x => x.kategoriId === c.id && (x.aktiv || (b.personer || []).indexOf(x.id) >= 0));
        if (!ic.length)
            return "";
        return '<div class="bemgrupp"><b>' + esc(c.namn) + '</b>' + ic.map(x => '<label><input type="checkbox" class="bemP" value="' + x.id + '"' + ((b.personer || []).indexOf(x.id) >= 0 ? " checked" : "") + '> ' +
            esc(x.namn) + (x.aktiv ? "" : ' <em class="inaktiv">Inaktiv</em>') + '</label>').join("") + '</div>';
    }).join("") + '</div>' +
        '<div id="bemVarn"></div>';
}

function kopplaBemanning(p, b, period, egetId) {
    function varna() {
        const box = document.getElementById("bemVarn");
        if (!box)
            return;
        const per = period();
        const konf = bemanningKonflikter(p, b.personer, per.fran, per.till, egetId);
        const lage = bemanningsLage(p, { bemanning: b });
        let html = "";
        if (konf.length) {
            const perPerson = {};
            konf.forEach(k => { (perPerson[k.personId] = perPerson[k.personId] || []).push(k); });
            html += '<div class="notis rod dubbelbokning">' +
                Object.keys(perPerson).map(pid => {
                    const x = perPerson[pid], pp = resPers(p, pid), m = x[0].moment[0];
                    return '<b>⚠ ' + esc(pp ? pp.namn : "?") + ' är redan planerad</b><br>' + esc(momentNamn(m.kort) + " · " + m.tavla.namn) +
                        ' · ' + x.length + (x.length === 1 ? " dag" : " dagar") + ' från ' + kortDatum(x[0].dag);
                }).join("<br>") + '<br><span class="hjalp" style="display:block;margin-top:4px">Du kan spara ändå och lösa krocken senare.</span></div>';
        }
        if (lage.saknas)
            html += '<p class="hjalp" style="margin-top:6px">Behov ' + lage.behov + ' · namngivna ' +
                lage.rader.reduce((n, r) => n + Math.min(r.namngivna, r.antal), 0) + ' — ' + lage.saknas + ' ännu inte namngivna.</p>';
        box.innerHTML = html;
    }
    function las() {
        b.behov = Array.prototype.slice.call(document.querySelectorAll("#bemBehov .bemrad")).map(r => ({
            kategoriId: r.querySelector('[data-f="kat"]').value,
            antal: Math.max(1, parseInt(r.querySelector('[data-f="antal"]').value || "1", 10))
        }));
        b.personer = Array.prototype.slice.call(document.querySelectorAll(".bemP:checked")).map(e => e.value);
        varna();
    }
    document.querySelectorAll("#bemBehov select,#bemBehov input,.bemP").forEach(e => {
        e.addEventListener("change", las);
        e.addEventListener("input", las);
    });
    document.querySelectorAll("#bemBehov [data-bort]").forEach(x => x.addEventListener("click", () => {
        las();
        b.behov.splice(+x.dataset.bort, 1);
        ritaOm();
    }));
    const lagg = document.getElementById("bemLagg");
    if (lagg)
        lagg.addEventListener("click", () => {
            las();
            b.behov.push({ kategoriId: p.resurser.kategorier[0].id, antal: 1 });
            ritaOm();
        });
    function ritaOm() {
        const box = document.getElementById("bemRuta");
        if (!box)
            return;
        box.innerHTML = bemanningRedigerare(p, b, period, egetId);
        kopplaBemanning(p, b, period, egetId);
    }
    varna();
    return las;
}

function bemanningDialog(k) {
    const p = state, t = T();
    const b = JSON.parse(JSON.stringify(k.bemanning || { behov: [], personer: [] }));
    const per = () => momentPeriodI(t, k);
    const kropp = '<p class="hjalp" style="margin-top:0">Gäller hela momentet, ' + kortDatum(per().fran) +
        (per().till !== per().fran ? "–" + kortDatum(per().till) : "") + '. Bemanningen följer momentet när det flyttas eller förlängs.</p>' +
        '<div id="bemRuta">' + bemanningRedigerare(p, b, per, k.id) + '</div>';
    modal("Bemanning", momentNamn(k), kropp, [
        { txt: "Avbryt", fn: stangModal },
        { txt: "Spara", primar: true, fn: () => {
                las();
                const patch = opSattBemanning(k, b.behov, b.personer);
                if (appliceraPatch(patch, { tavla: t, projekt: p }))
                    patch.historik.forEach(h => logg(h));
                stangModal();
                spara();
                rita();
                visaKort(k);
            } }
    ]);
    const las = kopplaBemanning(p, b, per, k.id);
}

/* ---------- resursplanering: vyn ---------- */

let resFilter = { vy: "person", period: "2v", fran: null, till: null, omf: "projekt" };

function resursPersonTabell(p, u) {
    const r = p.resurser;
    const synliga = r.personer.filter(x => x.aktiv || u.karta[x.id] || u.franvaro[x.id]);
    if (!synliga.length)
        return '<p class="utom">Inga personer att visa.</p>';
    const sorterade = synliga.slice().sort((a, b) => {
        const ka = resKat(p, a.kategoriId), kb = resKat(p, b.kategoriId);
        const na = ka ? ka.namn : "", nb = kb ? kb.namn : "";
        return na !== nb ? na.localeCompare(nb, "sv") : a.namn.localeCompare(b.namn, "sv");
    });
    return '<div class="resskroll"><table class="lista restabell"><thead><tr><th>Person</th>' +
        u.dagar.map(d => '<th>' + dagRubrik(d) + '</th>').join("") + '</tr></thead><tbody>' +
        sorterade.map(x => {
            const k = resKat(p, x.kategoriId);
            return '<tr><td class="resnamn"><b>' + esc(x.namn) + '</b>' + (x.aktiv ? "" : ' <em class="inaktiv">Inaktiv</em>') +
                '<span>' + esc(k ? k.namn : "") + '</span></td>' +
                u.dagar.map(d => {
                    const lista = (u.karta[x.id] || {})[d] || [];
                    const konf = u.konfNyckel[x.id + "|" + d];
                    const fr = (u.franvaro[x.id] || {})[d];
                    const frHtml = fr ? '<span class="frmark">⚠ ' + (fr.hel ? esc(franvaroOrsakDag(fr))
                        : "Delvis frånvarande " + fr.delar.map(z => z.tid + "–" + z.slut).join(", ")) + '</span>' : "";
                    if (!lista.length) {
                        if (fr)
                            return '<td class="resfranvaro">' + frHtml + '</td>';
                        return konf ? '<td class="reskonf" title="Dubbelbokad på annan tavla">⚠</td>' : '<td></td>';
                    }
                    const krock = fr && fr.hel;
                    return '<td class="' + (krock ? "reskrock" : konf ? "reskonf" : fr ? "resfranvaro" : "") + '">' +
                        (konf ? '<span class="konfmark">⚠ ' + konf.moment.length + ' moment</span>' : "") +
                        lista.map(m => '<div class="rescell"><b>' + esc(momentNamn(m.kort)) + '</b><span>' + esc(m.tavla.namn) +
                            (m.kort.plats ? " · " + esc(m.kort.plats) : "") + '</span></div>').join("") + frHtml + '</td>';
                }).join("") + '</tr>';
        }).join("") + '</tbody></table></div>';
}

function resursGruppTabell(p, u) {
    const r = p.resurser;
    if (!r.kategorier.length)
        return '<p class="utom">Inga yrkesgrupper registrerade.</p>';
    let html = '<div class="resskroll"><table class="lista restabell"><thead><tr><th>Yrkesgrupp</th>' +
        u.dagar.map(d => '<th>' + dagRubrik(d) + '</th>').join("") + '</tr></thead><tbody>' +
        r.kategorier.map(c => {
            const personer = r.personer.filter(x => x.aktiv && x.kategoriId === c.id);
            const aktiva = personer.length;
            return '<tr><td class="resnamn"><b>' + esc(c.namn) + '</b><span>' + aktiva + ' aktiva</span></td>' +
                u.dagar.map(d => {
                    const b = (u.behov[c.id] || {})[d] || 0;
                    const franv = personer.filter(x => (u.franvaro[x.id] || {})[d] && u.franvaro[x.id][d].hel).length;
                    const delv = personer.filter(x => (u.franvaro[x.id] || {})[d] && !u.franvaro[x.id][d].hel).length;
                    const tillg = aktiva - franv;
                    if (!b && !franv && !delv)
                        return '<td class="resnoll">–</td>';
                    const over = b > tillg;
                    return '<td class="' + (over ? "resover" : "") + '" title="Aktiva ' + aktiva + ' · frånvarande ' + franv +
                        ' · tillgängliga ' + tillg + ' · planerat behov ' + b + (delv ? " · " + delv + " delvis frånvarande" : "") + '">' +
                        (b ? b + "/" + tillg : "–/" + tillg) + (over ? " ⚠" : "") +
                        (franv ? '<span class="grpfr">' + franv + ' frånv.</span>' : "") +
                        (delv ? '<span class="grpfr">' + delv + ' delvis</span>' : "") + '</td>';
                }).join("") + '</tr>';
        }).join("") + '</tbody></table></div>' +
        '<p class="hjalp">Första siffran är planerat behov, andra är tillgängliga personer — aktiva minus heldagsfrånvarande. ' +
        'Delvis frånvaro minskar inte numerären. ⚠ Kapacitetsrisk betyder att behovet överstiger antalet tillgängliga — ' +
        'en resursvarning, inte ett fel i planeringen.</p>';
    const brist = u.moment.map(m => ({ m: m, l: bemanningsLage(p, m.kort) })).filter(x => x.l.rader.length);
    if (brist.length) {
        html += '<div class="ublock"><h3>Bemanning per moment</h3><table class="lista"><thead><tr><th>Moment</th>' +
            '<th>Period</th><th>Behov</th><th>Namngivna</th></tr></thead><tbody>' +
            brist.map(x => '<tr' + (x.l.saknas ? ' class="sen"' : "") + '><td>' + esc(momentRef(x.m)) + '</td>' +
                '<td class="dat">' + kortDatum(x.m.fran) + (x.m.till !== x.m.fran ? "–" + kortDatum(x.m.till) : "") + '</td>' +
                '<td>' + x.l.rader.map(r => r.antal + " " + esc(katKort(r.kategori))).join(" · ") + '</td>' +
                '<td>' + x.l.rader.map(r => r.namngivna + (r.saknas ? ' <span class="saknasbem">(saknar ' + r.saknas + ')</span>' : "")).join(" · ") +
                '</td></tr>').join("") + '</tbody></table></div>';
    }
    return html;
}

function franvaroKonfLista(p, u) {
    if (!u.franKonf || !u.franKonf.length)
        return "";
    const perPerson = {};
    u.franKonf.forEach(g => { (perPerson[g.personId] = perPerson[g.personId] || []).push(g); });
    return '<div class="notis rod">' + Object.keys(perPerson).map(pid => {
        const gs = perPerson[pid], x = resPers(p, pid);
        const alla = [].concat.apply([], gs.map(g => g.dagar)).sort();
        const hel = gs.some(g => g.hel);
        return '⚠ <b>' + esc(x ? x.namn : "?") + '</b> är ' + (hel ? "frånvarande" : "delvis frånvarande") + ' ' +
            periodText(alla[0], alla[alla.length - 1]) + ' (' + esc(gs[0].orsak) + ') men är resurssatt på:<br>' +
            gs.map(g => '&nbsp;&nbsp;' + esc(momentRef(g.moment)) + (g.hel ? "" : " · " + g.delar.map(z => z.tid + "–" + z.slut).join(", "))).join("<br>");
    }).join("<br>") + '</div>';
}

function resursKonfLista(p, u) {
    if (!u.konf.length)
        return franvaroKonfLista(p, u);
    const perPerson = {};
    u.konf.forEach(k => { (perPerson[k.personId] = perPerson[k.personId] || []).push(k); });
    return '<div class="notis">' + Object.keys(perPerson).map(pid => {
        const x = resPers(p, pid), lista = perPerson[pid];
        return '⚠ <b>' + esc(x ? x.namn : "?") + '</b> är planerad på två moment ' +
            lista.map(k => dagRubrik(k.dag)).join(", ") + ': ' +
            lista[0].moment.map(m => esc(momentRef(m))).join(" <i>och</i> ");
    }).join("<br>") + '</div>' + franvaroKonfLista(p, u);
}

function resursVy() {
    const p = state, f = resFilter;
    const u = resursUnderlag(p, f, T(), IDAG);
    const kropp = '<div class="filterrad">' +
        '<label>Vy<select class="f" id="rvVy"><option value="person"' + (f.vy === "person" ? " selected" : "") + '>Per person</option>' +
        '<option value="grupp"' + (f.vy === "grupp" ? " selected" : "") + '>Per yrkesgrupp</option></select></label>' +
        '<label>Period<select class="f" id="rvPer">' + [["1v", "1 vecka"], ["2v", "2 veckor"], ["4v", "4 veckor"], ["valj", "Välj veckor"]].map(x => '<option value="' + x[0] + '"' + (f.period === x[0] ? " selected" : "") + '>' + x[1] + '</option>').join("") + '</select></label>' +
        '<label class="' + (f.period === "valj" ? "" : "dold") + '" id="rvFranL">Från<select class="f" id="rvFran">' + veckoOptioner(f.fran || dennaVeckasMandag(IDAG)) + '</select></label>' +
        '<label class="' + (f.period === "valj" ? "" : "dold") + '" id="rvTillL">Till<select class="f" id="rvTill">' + veckoOptioner(f.till || dennaVeckasMandag(IDAG)) + '</select></label>' +
        '<label>Omfattning<select class="f" id="rvOmf"><option value="projekt"' + (f.omf === "projekt" ? " selected" : "") + '>Hela projektet</option>' +
        '<option value="tavla"' + (f.omf === "tavla" ? " selected" : "") + '>Denna tavla (' + esc(T().namn) + ')</option></select></label>' +
        '</div>' +
        (p.resurser.personer.length ? "" : '<div class="notis">Projektet har inga resurser. Lägg till dem under Projektinställningar → Resurser.</div>') +
        resursKonfLista(p, u) +
        (f.vy === "grupp" ? resursGruppTabell(p, u) : resursPersonTabell(p, u));
    modal("Resursplanering", p.projekt + " · " + u.per.text, kropp, [
        { txt: "Hantera resurser", vanster: true, fn: () => { stangModal(); resursbankDialog(); } },
        { txt: "Stäng", fn: stangModal },
        { txt: "Skriv ut", primar: true, fn: () => { stangModal(); skrivUtResurser(Object.assign({}, resFilter)); } }
    ]);
    const m = document.querySelector("#overlay .modal");
    if (m)
        m.style.maxWidth = "1200px";
    ["rvVy", "rvPer", "rvFran", "rvTill", "rvOmf"].forEach(id => {
        const e = document.getElementById(id);
        if (e)
            e.addEventListener("change", () => {
                resFilter = { vy: document.getElementById("rvVy").value, period: document.getElementById("rvPer").value,
                    fran: document.getElementById("rvFran").value, till: document.getElementById("rvTill").value,
                    omf: document.getElementById("rvOmf").value };
                stangModal();
                resursVy();
            });
    });
}

function skrivUtResurser(f) {
    const p = state, u = resursUnderlag(p, f, T(), IDAG);
    const omf = f.omf === "tavla" ? T().namn : "Hela projektet";
    const html = utskriftHuvud("Resursplanering", (f.vy === "grupp" ? "Per yrkesgrupp" : "Per person") + " · " + u.per.text + " · " + omf) +
        resursKonfLista(p, u).replace('class="notis"', 'class="utom"') +
        (f.vy === "grupp" ? resursGruppTabell(p, u) : resursPersonTabell(p, u));
    skrivUt(html, true);
}
