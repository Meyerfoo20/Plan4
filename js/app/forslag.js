/* ======================================================================
   Wimo · Förslag
   Användarna skriver tips och önskemål om sidan. Förslagen sparas i
   molnet (forslag/{id}) och visas för huvudadmin under Mitt konto.
   ====================================================================== */

const FS_TYPER = [["ny", "Ny funktion"], ["battre", "Förbättring"], ["fel", "Något fungerar inte"], ["annat", "Övrigt"]];
const fsVy = { typ: "ny", text: "", skickat: false, skickar: false };

function oppnaForslag() {
    try { stangStart(); } catch (e) { }
    try { stangDash(); } catch (e) { }
    try { stangGantt(); } catch (e) { }
    try { stangBackup(); } catch (e) { }
    try { stangHjalp(); } catch (e) { }
    try { stangDagbok(); } catch (e) { }
    document.body.classList.remove("p4-kontovy");
    document.body.classList.add("dashlage");
    document.getElementById("forslag").classList.remove("dold");
    fsVy.skickat = false;
    ritaForslag();
    if (window.p4MarkeraNav) window.p4MarkeraNav();
}
function stangForslag() {
    const el = document.getElementById("forslag");
    if (!el || el.classList.contains("dold"))
        return;
    const t = document.getElementById("fsText");
    if (t) fsVy.text = t.value;
    el.classList.add("dold");
    let annan = false;
    try { annan = dashOppen() || startOppen() || ganttOppen() || backupOppen() || hjalpOppen() || dagbokOppen(); } catch (e) { }
    if (!annan)
        document.body.classList.remove("dashlage");
}
function forslagOppen() { const el = document.getElementById("forslag"); return !!el && !el.classList.contains("dold"); }

// De andra sidorna stänger Förslag när de öppnas.
["oppnaGantt", "oppnaDash", "oppnaStart", "oppnaBackup", "oppnaHjalp", "oppnaDagbok"].forEach(namn => {
    const urs = window[namn];
    if (typeof urs !== "function")
        return;
    window[namn] = function () { stangForslag(); return urs.apply(this, arguments); };
});

function ritaForslag() {
    const el = document.getElementById("forslag");
    if (!el)
        return;
    const kan = typeof window.p4KanSkickaForslag === "function" && window.p4KanSkickaForslag();
    const hero = '<div class="p4-hero"><div class="p4-hero-text">' +
        '<div class="p4-eyebrow"><span class="p4-pop"></span>Stöd · Wimo</div>' +
        '<h1 class="g-rubrik">Förslag</h1>' +
        '<div class="g-meta">Saknar du något i Wimo, eller har du en idé om hur sidan kan bli bättre? Skriv det här så går det direkt till utvecklaren.</div>' +
        "</div></div>";
    let kropp;
    if (!kan) {
        kropp = '<section class="fs-kort"><h2>Logga in för att skicka ett förslag</h2>' +
            '<p class="hjalp">Förslagen skickas med ditt namn, så att vi kan höra av oss om vi har frågor.</p>' +
            '<button type="button" class="fs-skicka" data-fs="konto">Logga in</button></section>';
    }
    else if (fsVy.skickat) {
        kropp = '<section class="fs-kort fs-tack"><div class="fs-tackik" aria-hidden="true">✓</div>' +
            "<h2>Tack för ditt förslag!</h2>" +
            '<p class="hjalp">Det har skickats och läses av den som utvecklar Wimo.</p>' +
            '<button type="button" class="fs-skicka" data-fs="nytt">Skriv ett till</button></section>';
    }
    else {
        kropp = '<section class="fs-kort">' +
            '<h2>Vad gäller det?</h2>' +
            '<div class="fs-typer" role="radiogroup" aria-label="Typ av förslag">' +
            FS_TYPER.map(([k, n]) => '<button type="button" role="radio" aria-checked="' + (fsVy.typ === k) + '" class="fs-typ' + (fsVy.typ === k ? " vald" : "") + '" data-fstyp="' + k + '">' + n + "</button>").join("") +
            "</div>" +
            '<label class="fs-etikett" for="fsText">Ditt förslag</label>' +
            '<textarea id="fsText" class="f fs-text" rows="7" maxlength="4000" placeholder="Beskriv vad du vill kunna göra, eller vad som borde fungera annorlunda. T.ex. &quot;Det vore bra om man kunde se alla UE-firmor för veckan i en lista.&quot;">' + esc(fsVy.text) + "</textarea>" +
            '<div class="fs-fot"><span class="hjalp" id="fsInfo">Skickas med ditt namn och det projekt du står i.</span>' +
            '<button type="button" class="fs-skicka" data-fs="skicka"' + (fsVy.skickar ? " disabled" : "") + ">" + (fsVy.skickar ? "Skickar…" : "Skicka förslag") + "</button></div>" +
            "</section>";
    }
    el.innerHTML = '<div class="fs-sida">' + hero + kropp + "</div>";
}

async function skickaForslag() {
    const t = document.getElementById("fsText");
    const text = (t ? t.value : fsVy.text).trim();
    fsVy.text = t ? t.value : fsVy.text;
    if (!text) {
        status("Skriv ditt förslag först", true);
        if (t) t.focus();
        return;
    }
    fsVy.skickar = true;
    ritaForslag();
    try {
        await window.p4SkickaForslag({ text, typ: fsVy.typ });
        fsVy.text = "";
        fsVy.skickat = true;
        status("Förslaget är skickat. Tack!");
    }
    catch (e) {
        console.warn("Wimo förslag:", e);
        status(e && e.message && !/permission|insufficient/i.test(e.message) ? e.message : "Förslaget kunde inte skickas. Försök igen.", true);
    }
    fsVy.skickar = false;
    ritaForslag();
}

document.addEventListener("click", (e) => {
    const typ = e.target.closest && e.target.closest("#forslag [data-fstyp]");
    if (typ) {
        const t = document.getElementById("fsText");
        if (t) fsVy.text = t.value;
        fsVy.typ = typ.dataset.fstyp;
        return ritaForslag();
    }
    const b = e.target.closest && e.target.closest("#forslag [data-fs]");
    if (!b)
        return;
    if (b.dataset.fs === "skicka") return skickaForslag();
    if (b.dataset.fs === "nytt") { fsVy.skickat = false; ritaForslag(); const t = document.getElementById("fsText"); if (t) t.focus(); return; }
    if (b.dataset.fs === "konto") { stangForslag(); if (window.p4OppnaKonto) window.p4OppnaKonto(); }
});
