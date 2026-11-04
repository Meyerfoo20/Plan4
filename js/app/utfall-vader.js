/* ======================================================================
   Veckans utfall och väderprognos
   ====================================================================== */

/* ---------- veckans utfall ---------- */

function visaUtfall(vStart) {
    const u = veckoUtfall(vStart, T());
    const antal = u.planerade.length;
    const procent = antal ? Math.round(u.genomforda.length / antal * 100) : null;
    const orsakLista = Object.keys(u.orsaker).sort((a, b) => u.orsaker[b] - u.orsaker[a]);
    const max = orsakLista.length ? u.orsaker[orsakLista[0]] : 1;
    const veckor = [0, 1, 2, 3].map(i => plus(visaStart(), i * 7));
    const kropp = '<div class="falt" style="margin-bottom:16px"><select class="f" id="uVecka">' +
        veckor.map(v => '<option value="' + v + '"' + (v === vStart ? " selected" : "") + '>v' + veckonr(v) + " · " + kortDatum(v) + "–" + kortDatum(plus(v, 4)) + '</option>').join("") +
        '</select></div>' +
        '<div class="utfall"><div class="rubrikrad">' +
        '<span class="stor ' + (procent === null ? "" : procent >= 80 ? "bra" : "svag") + '">' + (procent === null ? "–" : procent + " %") + '</span>' +
        '<span class="under">planpålitlighet<br>hur mycket av det vi lovade som blev gjort</span></div>' +
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
    modal("Veckans utfall · v" + veckonr(vStart), kortDatum(vStart) + "–" + kortDatum(plus(vStart, 4)), kropp, [
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

async function hamtaVader() {
    const plats = state.plats;
    if (!plats || !plats.lat || vaderHamtas)
        return;
    const first = dagar()[0];
    if (VADER["_plats"] === plats.lat + "," + plats.lon && VADER["_start"] === first)
        return;
    vaderHamtas = true;
    try {
        const url = "https://api.open-meteo.com/v1/forecast?latitude=" + plats.lat + "&longitude=" + plats.lon +
            "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max" +
            "&wind_speed_unit=ms&timezone=Europe%2FStockholm&forecast_days=16";
        const r = await fetch(url);
        const d = await r.json();
        VADER = { _plats: plats.lat + "," + plats.lon, _start: first };
        (d.daily.time || []).forEach((dag, i) => {
            VADER[dag] = { symbol: vaderSymbol(d.daily.weather_code[i]), temp: d.daily.temperature_2m_max[i],
                tempMin: d.daily.temperature_2m_min ? d.daily.temperature_2m_min[i] : null,
                nederbord: d.daily.precipitation_sum[i] || 0, vind: d.daily.wind_speed_10m_max[i] || 0,
                byvind: d.daily.wind_gusts_10m_max ? d.daily.wind_gusts_10m_max[i] || 0 : null };
        });
        vaderFel = "";
        ritaVader();
        ritaVarningar();
    }
    catch (e) {
        vaderFel = "Väderprognosen kunde inte hämtas — kontrollera att datorn har internet.";
    }
    vaderHamtas = false;
}

async function slaUppOrt(namn) {
    const r = await fetch("https://geocoding-api.open-meteo.com/v1/search?count=1&language=sv&name=" + encodeURIComponent(namn));
    const d = await r.json();
    if (!d.results || !d.results.length)
        return null;
    const o = d.results[0];
    return { namn: o.name, lat: o.latitude, lon: o.longitude };
}
