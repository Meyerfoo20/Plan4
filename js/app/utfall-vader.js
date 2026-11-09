/* ======================================================================
   Veckans utfall och väderprognos
   ====================================================================== */

/* ---------- veckans utfall ---------- */

function visaUtfall(vStart) {
    const u = veckoUtfall(vStart, T());
    const antal = u.planerade.length;
    const procent = antal ? Math.round(u.genomforda.length / antal * 100) : null;
    // Ingen plan fanns när veckan började men poster lades in under veckan: visa det i stället för bara "–".
    const baraTillkomna = !antal && u.tillkomna.length > 0;
    const tillkomnaProcent = baraTillkomna ? Math.round(u.tillkomnaKlara.length / u.tillkomna.length * 100) : null;
    const orsakLista = Object.keys(u.orsaker).sort((a, b) => u.orsaker[b] - u.orsaker[a]);
    const max = orsakLista.length ? u.orsaker[orsakLista[0]] : 1;
    // de fyra veckorna på tavlan plus fyra veckor bakåt
    const veckor = [-4, -3, -2, -1, 0, 1, 2, 3].map(i => plus(visaStart(), i * 7));
    if (!veckor.includes(vStart)) veckor.push(vStart);
    veckor.sort();
    const kropp = '<div class="falt" style="margin-bottom:16px"><select class="f" id="uVecka">' +
        veckor.map(v => '<option value="' + v + '"' + (v === vStart ? " selected" : "") + '>v' + veckonr(v) + " · " + kortDatum(v) + "–" + kortDatum(plus(v, 4)) + '</option>').join("") +
        '</select></div>' +
        '<div class="utfall"><div class="rubrikrad">' +
        (baraTillkomna
            ? '<span class="stor">' + tillkomnaProcent + ' %</span>' +
              '<span class="under">genomfört av det som lades in under veckan<br>' + u.tillkomnaKlara.length + " av " + u.tillkomna.length + " produktionsposter</span></div>" +
              '<div class="notis">Ingen planpålitlighet för v' + veckonr(vStart) + ": inga produktionsposter låg på tavlan när veckan började " +
              "(måndag " + kortDatum(vStart) + "). Allt lades in under veckan och räknas därför som tillkommet. " +
              "Lägg in nästa veckas produktion senast på fredagens veckoplanering, så mäts den.</div>"
            : '<span class="stor ' + (procent === null ? "" : procent >= 80 ? "bra" : "svag") + '">' + (procent === null ? "–" : procent + " %") + '</span>' +
              '<span class="under">planpålitlighet<br>hur mycket av det vi lovade som blev gjort</span></div>' +
              (procent === null ? '<div class="notis">Inga produktionsposter för v' + veckonr(vStart) + " ännu. Planpålitligheten räknas på " +
                  "produktionsposterna som ligger på tavlan när veckan börjar.</div>" : "")) +
        '<div class="talrad"><span>Planerade produktionsaktiviteter</span><b>' + antal + '</b></div>' +
        '<div class="talrad"><span>Genomförda</span><b>' + u.genomforda.length + '</b></div>' +
        (u.senaBockar.length ? '<div class="talrad"><span class="underrad">varav avbockade efter veckans slut</span><b>' +
            u.senaBockar.length + '</b></div>' : "") +
        '<div class="talrad"><span>Ej genomförda</span><b>' + u.ejGjorda.length + '</b></div>' +
        (u.tillkomna.length ? '<div class="talrad"><span>Tillkom under veckan (räknas inte in)' +
            (u.tillkomnaFlyttade.length ? ', varav ' + u.tillkomnaFlyttade.length + ' framflyttad' : "") +
            '</span><b>' + u.tillkomna.length + '</b></div>' +
            '<div class="talrad"><span class="underrad">varav genomförda</span><b>' + u.tillkomnaKlara.length + '</b></div>' : "") +
        '</div>' +
        '<div class="utfallblock"><h4>Varför höll inte planen?</h4>' +
        (orsakLista.length
            ? orsakLista.map(o => '<div class="orsakstapel' + (u.orsaker[o] >= 3 ? " upprepad" : "") + '"><span>' + esc(o) + '</span>' +
                '<span class="stapel" style="width:' + Math.round(u.orsaker[o] / max * 100) + '%"></span><b>' + u.orsaker[o] + '</b></div>').join("") +
                (orsakLista.some(o => u.orsaker[o] >= 3) ? '<div class="notis rod">Samma orsak tre gånger på en vecka är ett systemfel, inte otur. Ta den till nästa planeringsmöte.</div>' : "")
            : '<p class="hjalp">Inga aktiviteter flyttades den här veckan.</p>') +
        '</div>' +
        (u.ejGjorda.length ? '<div class="utfallblock"><h4>Det som inte blev gjort</h4><ul class="ejlista">' +
            u.ejGjorda.map(k => '<li><span class="nar">' + dagEtikett(k.dag) + '</span><span>' + esc(k.text) +
                (k.orsak ? ' <span style="color:var(--leverans)">· ' + esc(k.orsak) + '</span>' : "") + '</span></li>').join("") + '</ul></div>' : "") +
        '<div class="utfallblock"><h4>Hinder</h4>' +
        '<div class="talrad"><span>Skapade under veckan</span><b>' + u.hSkapade.length + '</b></div>' +
        '<div class="talrad"><span>Lösta under veckan</span><b>' + u.hLosta.length + '</b></div>' +
        '<div class="talrad"><span>Kvarstående vid veckans slut</span><b>' + u.hKvar.length + '</b></div>' +
        '</div>' +
        (u.utanTid || u.hUtanTid ? '<p class="hjalp" style="margin-top:14px">' +
            (u.utanTid ? u.utanTid + ' produktionsposter saknar tidsstämpel (skapade före 1.1) och räknas som planerade. ' : "") +
            (u.hUtanTid ? u.hUtanTid + ' hinder saknar tidsstämpel och kan inte dateras till en vecka.' : "") + '</p>' : "");
    // Veckans utfall gäller tavlan man står på; Projektöversikten räknar alla tavlor.
    const tavlaText = state.tavlor.length > 1 ? " · tavla: " + T().namn + " (Projektöversikten visar alla tavlor)" : "";
    modal("Veckans utfall · v" + veckonr(vStart), kortDatum(vStart) + "–" + kortDatum(plus(vStart, 4)) + tavlaText, kropp, [
        { txt: "Stäng", primar: true, fn: stangModal }
    ]);
    document.getElementById("uVecka").addEventListener("change", e => visaUtfall(e.target.value));
}

document.getElementById("utfallKnapp").addEventListener("click", () => {
    const veckor = [0, 1, 2, 3].map(i => plus(visaStart(), i * 7));
    const nuvarande = veckor.find(v => iVeckan(IDAG, v));
    visaUtfall(nuvarande || veckor[0]);
});

/* ---------- väderprognos ---------- */

let VADER = {}, vaderHamtas = false, vaderFel = "";

function ritaVader() {
    document.querySelectorAll(".vader").forEach(el => {
        const v = VADER[el.dataset.dag];
        if (!v) {
            el.innerHTML = "";
            return;
        }
        const inst = (state.varningar || {}).vind;
        const grans = inst && inst.pa ? parseFloat(inst.varde) : NaN;
        const blast = !isNaN(grans) && v.vind > grans;
        const traffar = vaderTraffar(el.dataset.dag);
        el.classList.toggle("overskriden", traffar.length > 0);
        el.innerHTML = v.symbol + " " + Math.round(v.temp) + "°" +
            (v.nederbord >= 0.5 ? ' <span>' + v.nederbord.toFixed(1) + " mm</span>" : "") +
            ' <span class="' + (blast ? "blast" : "vind") + '">💨 ' + Math.round(v.vind) + " m/s</span>";
        el.title = v.symbol + "  " + Math.round(v.temp) + "°C · " + v.nederbord.toFixed(1) + " mm · vind " +
            Math.round(v.vind) + " m/s" + (v.byvind ? " (byvind " + Math.round(v.byvind) + " m/s)" : "") +
            (traffar.length ? " — överskrider projektets gräns: " + traffar.join(", ") : "");
    });
}

// Prognosen gäller projektets ort, eller Malmö när ingen ort är vald.
const VADERORT_STD = { namn: "Malmö", lat: 55.605, lon: 13.0038 };
function vaderPlats() { return state.plats && state.plats.lat ? state.plats : VADERORT_STD; }

async function hamtaVader(tvinga) {
    const plats = vaderPlats();
    if (vaderHamtas)
        return;
    const nyckel = plats.lat + "," + plats.lon;
    // samma ort och dag: hämta igen tidigast efter en timme
    if (!tvinga && VADER._plats === nyckel && VADER._idag === IDAG && Date.now() - (VADER._tid || 0) < 3600000)
        return;
    vaderHamtas = true;
    try {
        const url = "https://api.open-meteo.com/v1/forecast?latitude=" + plats.lat + "&longitude=" + plats.lon +
            "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum," +
            "precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max" +
            "&wind_speed_unit=ms&timezone=Europe%2FStockholm&forecast_days=16";
        const r = await fetch(url);
        if (!r.ok)
            throw new Error("HTTP " + r.status);
        const d = await r.json();
        const dd = d.daily || {};
        const tal = (lista, i) => lista && lista[i] != null ? lista[i] : null;
        VADER = { _plats: nyckel, _idag: IDAG, _tid: Date.now(), _namn: plats.namn };
        (dd.time || []).forEach((dag, i) => {
            VADER[dag] = { kod: tal(dd.weather_code, i), symbol: vaderSymbol(dd.weather_code[i]),
                temp: tal(dd.temperature_2m_max, i), tempMin: tal(dd.temperature_2m_min, i),
                nederbord: tal(dd.precipitation_sum, i) || 0, sno: tal(dd.snowfall_sum, i) || 0,
                regnrisk: tal(dd.precipitation_probability_max, i),
                vind: tal(dd.wind_speed_10m_max, i) || 0, byvind: tal(dd.wind_gusts_10m_max, i) };
        });
        vaderFel = "";
    }
    catch (e) {
        vaderFel = "Väderprognosen kunde inte hämtas — kontrollera att datorn har internet.";
    }
    vaderHamtas = false;
    ritaVader();
    ritaVarningar();
}

// Hämta en färsk prognos varje timme medan sidan är öppen.
setInterval(() => { try { hamtaVader(); } catch (e) { } }, 3600000);

/* ---------- bedömning av dagens väder ----------
   Nivåer för byggarbetsplatsen: gul = tänk på det, röd = kan stoppa arbeten
   (kranlyft, tak- och ställningsarbete, gjutning, målning). */
const VBED = { vindGul: 10, vindRod: 14, byGul: 15, byRod: 21, regnGul: 5, regnRod: 15, snoGul: 1, snoRod: 5,
    kallaGul: -5, kallaRod: -10, varmeGul: 28 };

function vaderBedomning(v) {
    const ut = [];
    const by = v.byvind || 0;
    if (v.kod >= 95)
        ut.push({ niva: "rod", txt: "Risk för åska" });
    if (v.vind >= VBED.vindRod || by >= VBED.byRod)
        ut.push({ niva: "rod", txt: "Hård vind " + Math.round(v.vind) + " m/s" + (by ? ", byar " + Math.round(by) : "") });
    else if (v.vind >= VBED.vindGul || by >= VBED.byGul)
        ut.push({ niva: "gul", txt: "Blåsigt " + Math.round(v.vind) + " m/s" + (by ? ", byar " + Math.round(by) : "") });
    const mm = (x) => (x >= 10 ? Math.round(x) : x.toFixed(1).replace(".", ","));
    if (v.sno >= VBED.snoRod)
        ut.push({ niva: "rod", txt: "Mycket snö " + Math.round(v.sno) + " cm" });
    else if (v.sno >= VBED.snoGul)
        ut.push({ niva: "gul", txt: "Snö " + Math.round(v.sno) + " cm" });
    else if (v.nederbord >= VBED.regnRod)
        ut.push({ niva: "rod", txt: "Mycket regn " + mm(v.nederbord) + " mm" });
    else if (v.nederbord >= VBED.regnGul)
        ut.push({ niva: "gul", txt: "Regnigt " + mm(v.nederbord) + " mm" });
    if (v.tempMin !== null && v.tempMin <= VBED.kallaRod)
        ut.push({ niva: "rod", txt: "Sträng kyla " + Math.round(v.tempMin) + "°" });
    else if (v.tempMin !== null && v.tempMin <= 0 && (v.nederbord >= 0.5 || v.sno > 0))
        ut.push({ niva: "gul", txt: "Risk för halka" });
    else if (v.tempMin !== null && v.tempMin <= VBED.kallaGul)
        ut.push({ niva: "gul", mild: true, txt: "Kallt, lägst " + Math.round(v.tempMin) + "°" });
    if (v.temp !== null && v.temp >= VBED.varmeGul)
        ut.push({ niva: "gul", mild: true, txt: "Värme " + Math.round(v.temp) + "°" });
    const roda = ut.filter(x => x.niva === "rod").length;
    const bra = v.kod !== null && v.kod <= 3 && v.nederbord < 1;
    // en samlad status per dag; orsakerna finns kvar i rader (visas som verktygstips)
    // kyla eller värme ensamt gör dagen hyfsad, inte dålig
    const niva = roda ? "rod" : ut.some(x => !x.mild) ? "gul" : bra && !ut.length ? "gron" : "hyfsat";
    const status = { gron: "Bra väder", hyfsat: "Hyfsat väder", gul: "Dåligt väder", rod: "Mycket dåligt väder" }[niva];
    return { niva: niva, status: status, rader: ut };
}

async function slaUppOrt(namn) {
    const r = await fetch("https://geocoding-api.open-meteo.com/v1/search?count=1&language=sv&name=" + encodeURIComponent(namn));
    const d = await r.json();
    if (!d.results || !d.results.length)
        return null;
    const o = d.results[0];
    return { namn: o.name, lat: o.latitude, lon: o.longitude };
}

/* ---------- varning för helgens väder, till höger om Fredag ---------- */
// Helgen efter närmaste fredag (idag eller senare). På lördag och söndag gäller alltså nästa helg.
function helgDagar() {
    const d = iso2d(IDAG).getDay();
    const fre = plus(IDAG, (5 - d + 7) % 7);
    return [plus(fre, 1), plus(fre, 2)];
}
function ritaHelgvader() {
    const fre = document.querySelectorAll("#rutnat .dagrubrik")[4];
    if (!fre)
        return;
    document.querySelectorAll("#rutnat .helgvader").forEach(x => x.remove());
    if (typeof vaderBedomning !== "function" || !VADER || !VADER._idag)
        return;
    const daliga = helgDagar().filter(d => VADER[d]).map(d => ({ d, b: vaderBedomning(VADER[d]) }))
        .filter(x => x.b.niva === "rod" || x.b.niva === "gul");
    if (!daliga.length)
        return;
    const namn = d => (iso2d(d).getDay() === 6 ? "Lör " : "Sön ") + kortDatum(d);
    const rod = daliga.some(x => x.b.niva === "rod");
    const b = document.createElement("button");
    b.type = "button";
    b.className = "helgvader" + (rod ? " rod" : "");
    b.textContent = "⚠";
    const txt = "Dåligt väder i helgen: " + daliga.map(x => namn(x.d) + " " + x.b.status.toLowerCase() + " (" + x.b.rader.map(r => r.txt).join(", ") + ")").join(" · ");
    b.title = txt;
    b.setAttribute("aria-label", txt);
    const klick = e => {
        e.stopPropagation();
        const panel = document.getElementById("varningspanel");
        if (panel && panel.classList.contains("stangd")) {
            const k = document.getElementById("vaderFall");
            if (k) k.click();
        }
        if (panel) panel.scrollIntoView({ behavior: "smooth", block: "center" });
        status(txt);
    };
    b.addEventListener("click", klick);
    fre.appendChild(b);
    // Samma ikon i fredagsrutan, för mobilen där dagrubrikerna inte visas.
    const fredag = plus(helgDagar()[0], -1);
    const dnr = document.querySelector('#rutnat .ruta[data-dag="' + fredag + '"] .dagnr > span:last-child');
    if (dnr) {
        const m = b.cloneNode(true);
        m.classList.add("helgvader-mobil");
        m.addEventListener("click", klick);
        dnr.appendChild(m);
    }
}
