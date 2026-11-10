/* ======================================================================
   Hjälp: en egen sida i vänstermenyn med "Tänk på" och en genomgång av
   hur allt i Wimo fungerar. Innehållsförteckning till vänster, sök i
   toppen och sektioner som kort.
   ====================================================================== */

const HJALP_TANK = [
    ["Skriv tydliga moment", "Verb + byggdel + del. Skriv <b>ÖK armering del 5</b>, inte bara \"armering\" — annars går det inte att se på fredagen om det blev gjort."],
    ["Lova bara det som går", "En produktionspost är ett löfte. Lägg bara in det laget faktiskt kan göra: handlingar, material och UE ska vara klara. Guiden <b>Planera moment</b> frågar efter det."],
    ["Bocka av samma dag", "Det som är gjort ska bockas av direkt, helst på eftermiddagspulsen. Det är avbockningarna som räknas i planpålitligheten."],
    ["Flytta med orsak", "Flyttar du en produktionspost som inte är klar frågar Wimo varför. Svara ärligt — samma orsak flera gånger är ett systemfel, inte otur."],
    ["Avropa i tid", "Backa avropet efter leverantörens ledtid. Gå igenom <b>Avropslistan</b> varje vecka så att inget med lång ledtid glöms."],
    ["Hinder ska ha vem och när", "Ett hinder utan ansvarig och datum blir sällan löst. Fler än tio öppna hinder betyder att ni ligger efter."],
    ["Flytta fram det som inte blev klart", "Tavlan går själv vidare till nästa vecka på måndagen. Flytta fram allt som inte är avbockat på fredagen — annars hamnar det bakom tavlan och syns under <b>Kräver åtgärd</b>."],
    ["Håll koll på vädret", "Rött väder = planera om. Ta ett jobb från <b>Back up</b> i stället för att låta laget stå still."],
    ["Kolla molnsynken", "Rutan <b>Molnsynk</b> i menyn ska vara grön innan du stänger efter större ändringar. Gjorde du fel? Tryck <b>Ångra</b> direkt."],
    ["Läsbehörighet", "Ser du <b>Bara läsbehörighet</b> kan du titta men inte ändra. Be en admin om du behöver redigera."]
];

const HJALP_SEKTIONER = [
    { id: "kom-igang", ik: "ik-tavla", rubrik: "Kom igång", ingress: "Från tomt projekt till en levande fyraveckorsplan på fem steg.",
      html:
        '<ol class="hj-steg">' +
        '<li><b>Välj eller skapa projekt.</b> Klicka på projektnamnet i toppraden → <i>Mina projekt</i> → <i>Nytt projekt</i>.</li>' +
        '<li><b>Ställ in projektet.</b> Under <i>Projektinställningar</i> väljer du namn, logotyp, ort för väderprognos, tavlor, resurser och företag (leverantörer och UE).</li>' +
        '<li><b>Lägg upp planen.</b> Börja med denna vecka och nästa från huvudtidplanen. Använd <i>Planera moment</i> <kbd>P</kbd> för produktion och <i>Snabb post</i> <kbd>N</kbd> för allt annat.</li>' +
        '<li><b>Bjud in kollegor.</b> Admin lägger till medlemmar under <i>Mitt konto</i> → <i>Medlemmar…</i> på projektet och väljer om de ska kunna redigera eller bara läsa.</li>' +
        '<li><b>Kör mötesrutinerna.</b> Veckoplanering på fredagen och ett kort morgonmöte varje dag — se <a href="#hj-moten" data-hj-till="moten">Möten</a>.</li>' +
        "</ol>" },

    { id: "tavlan", ik: "ik-tavla", rubrik: "Tavlan", ingress: "Fyra veckor framåt, en rad per vecka och en ruta per dag.",
      html:
        '<div class="hj-grid">' +
        '<div class="hj-ruta"><h4>Veckorna</h4><p>Översta raden är alltid innevarande vecka, sedan nästa vecka, vecka +2 (avropa och boka) och vecka +3 (långa ledtider). På måndagen flyttar tavlan själv fram en vecka — på alla tavlor.</p></div>' +
        '<div class="hj-ruta"><h4>Bläddra</h4><p><kbd>←</kbd> <kbd>→</kbd> bläddrar en vecka i taget och <i>Denna vecka</i> <kbd>T</kbd> tar dig tillbaka. Planen påverkas inte. Är du utanför planen står det <i>Du tittar utanför planen</i>.</p></div>' +
        '<div class="hj-ruta"><h4>1, 2 eller 4 veckor</h4><p>Välj hur många veckor som visas samtidigt. En vecka ger störst kort, bra på storskärm.</p></div>' +
        '<div class="hj-ruta"><h4>Filter</h4><p>Under <i>Visa</i> slår du av och på posttyper, t.ex. bara Produktion och Leverans. Sök med <kbd>/</kbd>.</p></div>' +
        '<div class="hj-ruta"><h4>Pågående</h4><p>Visar flerdagarsmoment på alla dagar mellan start och klart. Gäller den tavla du står på.</p></div>' +
        '<div class="hj-ruta"><h4>Dagsläget</h4><p>Klicka på ringen i dagens hörn och välj 😀 😐 ☹️ — er egen känsla av hur planen höll. Räknas inte in i någon siffra.</p></div>' +
        "</div>" +
        "<h4>Flera tavlor i samma projekt</h4>" +
        "<p>Gör en tavla per etapp, huskropp eller disciplin med <i>+ Ny tavla</i>. Byt tavla med flikarna ovanför. Tavlans namn och pågående-visning ändrar du under <i>Projektinställningar → Tavlor</i>.</p>" +
        "<h4>Kopiera vecka</h4>" +
        "<p>Vill du fylla en vecka med innehåll från en annan, använd <b>⧉</b> i veckohuvudet.</p>" },

    { id: "poster", ik: "ik-lista", rubrik: "Poster och kort", ingress: "Varje kort är ett moment, ett möte, ett avrop eller något annat som ska hända en viss dag.",
      html:
        "<h4>Posttyperna</h4>" +
        '<ul class="hj-typer">' +
        '<li><span class="hj-prick c-mote"></span><b>Möte</b> — byggmöten, samordning, besiktningar.</li>' +
        '<li><span class="hj-prick c-produktion"></span><b>Produktion</b> — det laget lovar att göra. Räknas i planpålitligheten.</li>' +
        '<li><span class="hj-prick c-avrop"></span><b>Avrop</b> — dagen beställningen ska gå iväg.</li>' +
        '<li><span class="hj-prick c-leverans"></span><b>Leverans / UE / viktigt</b> — leveranser, UE-starter och sådant som inte får missas.</li>' +
        '<li><span class="hj-prick c-franvaro"></span><b>Frånvaro</b> — semester, sjukdom, utbildning. Kan gå över flera dagar.</li>' +
        '<li><span class="hj-prick c-ovrigt"></span><b>Övrigt</b> — allt annat.</li>' +
        "</ul>" +
        "<h4>Skapa</h4>" +
        '<div class="hj-grid">' +
        '<div class="hj-ruta"><h4>+ Post</h4><p>Finns i varje dag. Snabbaste sättet att lägga in något just där.</p></div>' +
        '<div class="hj-ruta"><h4>Snabb post <kbd>N</kbd></h4><p>En enkel post med typ, text, dag och eventuellt klockslag.</p></div>' +
        '<div class="hj-ruta"><h4>Planera moment <kbd>P</kbd></h4><p>Femstegsguide: <i>Vad → När → Material → Förutsättningar → Klart</i>. Skapar hela kedjan med avrop, leverans, start och färdigt.</p></div>' +
        "</div>" +
        "<h4>Arbeta med korten</h4>" +
        '<table class="hj-tabell"><tbody>' +
        "<tr><td>Öppna</td><td>Klicka på kortet.</td></tr>" +
        "<tr><td>Redigera</td><td>Dubbelklicka på kortet.</td></tr>" +
        "<tr><td>Bocka av</td><td>Klicka i rutan på kortet, eller <i>Markera klart</i> när kortet är öppet.</td></tr>" +
        "<tr><td>Flytta till annan dag</td><td>Dra kortet och släpp det på dagen.</td></tr>" +
        "<tr><td>Ändra ordning</td><td>Dra kortet inom samma dag: släpp på övre halvan av ett kort för att lägga det före, nedre halvan för efter, eller på tom yta för sist. Kort med klockslag sorteras alltid efter tid.</td></tr>" +
        "<tr><td>Kedjan</td><td>Öppna ett kort och välj <i>Visa kedjan</i> för att markera avrop, leverans, start och klart som hör ihop.</td></tr>" +
        "<tr><td>Maila</td><td>Skriv en anteckning på kortet och tryck <i>Maila</i> under anteckningsrutan — ett nytt mejl öppnas i t.ex. Outlook med uppgifterna ifyllda.</td></tr>" +
        "</tbody></table>" +
        '<div class="hj-tips"><b>Tänk på:</b> På kortet står vilken del momentet gäller, t.ex. <i>Del 1:2</i>. Fyll i delen i guiden så syns det även i kalendern.</div>' },

    { id: "avrop", ik: "ik-last", rubrik: "Avrop och leveranser", ingress: "Rätt material på plats i rätt tid — utan att någon behöver komma ihåg det i huvudet.",
      html:
        "<ul>" +
        "<li><b>Avropslistan</b> i menyn samlar alla avrop i projektet med leverantör, leveransdag och status.</li>" +
        "<li>Avropet och leveransen hänger ihop i kedjan. Flyttar du momentet ser du direkt om avropet hinner.</li>" +
        "<li>På avropskort skapar <i>Maila</i> ett färdigt avropsmejl med projekt, leveransdag och vecka, del, ansvarig och material.</li>" +
        "<li>Leverantörer och UE lägger du in en gång under <i>Projektinställningar → Företag</i>, sedan väljer du dem i listor.</li>" +
        "</ul>" +
        '<div class="hj-tips"><b>Tänk på:</b> Räkna bakåt från när materialet behövs och dra av ledtiden. Vecka +2 på tavlan är veckan då det mesta ska avropas.</div>' },

    { id: "hinder", ik: "ik-hinder", rubrik: "Hinder", ingress: "Allt som står i vägen för att planen ska hålla.",
      html:
        "<ul>" +
        "<li>Skriv <b>vad</b> hindret är, <b>vem</b> som löser det och <b>senast när</b> i <i>Hinderlistan</i> till höger om tavlan.</li>" +
        "<li>Försenade hinder blir röda. Finns det olösta hinder visas ⚠ vid projektnamnet och en notis när du öppnar projektet.</li>" +
        "<li>Bocka av hindret när det är löst — det sparas i historiken.</li>" +
        "<li>Från ett öppet kort kan du lägga till ett hinder som hör till just det momentet.</li>" +
        "</ul>" +
        '<div class="hj-tips"><b>Tänk på:</b> Hinderlistan gås igenom på morgonmötet, men problemen löses inte där. Bestäm vem som tar det och när.</div>' },

    { id: "vader", ik: "ik-vader", rubrik: "Väder", ingress: "Prognos för projektets ort de kommande dagarna, bedömd för byggarbete.",
      html:
        "<ul>" +
        "<li>Öppna <i>Vädervarningar</i> till höger med pilen vid rubriken. Varje dag får en status: <b>Bra</b>, <b>Hyfsat</b>, <b>Dåligt</b> eller <b>Mycket dåligt väder</b>, med orsaken under (t.ex. hård vind eller mycket regn).</li>" +
        "<li>Är det dåligt väder idag eller de närmaste dagarna visas en notis när sidan laddas. Väntas dåligt väder till helgen visas ⚠ vid <b>Fredag</b> — håll musen över den för detaljer.</li>" +
        "<li>Ort väljer du under <i>Projektinställningar → Ort för väderprognos</i>. Lämnar du fältet tomt visas Malmö.</li>" +
        "<li>Där kan du också sätta projektets egna gränser: vind, byvind, nederbörd och temperatur. Det är era produktionsvarningar, inte officiella vädervarningar.</li>" +
        "</ul>" +
        '<div class="hj-tips"><b>Tänk på:</b> Prognosen kommer från Open-Meteo och kan ändras. Kolla den igen på morgonen innan gjutning, lyft eller takarbete.</div>' },

    { id: "backup", ik: "ik-backup", rubrik: "Back up", ingress: "Jobb som kan tas när ett planerat moment inte går att göra.",
      html:
        "<ul>" +
        "<li>Fyll på med jobb som inte behöver göras just nu men som kan göras lite när som helst, t.ex. städning, förberedelser eller inomhusjobb.</li>" +
        "<li>Ange var jobbet görs, prioritet och om det kräver bra väder.</li>" +
        "<li>Filtrera på <i>Redo</i>, <i>Inplanerade</i>, <i>Klara</i> eller <i>Alla</i>. Siffran vid Back up i menyn visar hur många som är redo.</li>" +
        "<li>Lägg in ett jobb på tavlan när det ska göras — då blir det inplanerat.</li>" +
        "</ul>" +
        '<div class="hj-tips"><b>Tänk på:</b> Ha alltid några jobb redo, särskilt inomhusjobb inför dåligt väder. Då slipper laget stå still.</div>' },

    { id: "oversikter", ik: "ik-dash", rubrik: "Översikter och Gantt", ingress: "Hela projektet på en sida.",
      html:
        '<div class="hj-grid">' +
        '<div class="hj-ruta"><h4>Projektöversikt <kbd>O</kbd></h4><p>Det viktigaste på en sida: planpålitlighet, hinder, försenade avrop, obekräftade datum och det som kräver åtgärd. Under det Gantt-schemat för dina valda projekt och kalendern med projektets alla tavlor under varandra. Välj vilka projekt som visas i schemat direkt i översikten, och tryck <b>PP</b> för att visa allt i fullskärm.</p></div>' +
        '<div class="hj-ruta"><h4>Att göra <kbd>A</kbd></h4><p>Projektets öppna punkter med ansvarig och datum. Punkter med datum syns också på tavlan.</p></div>' +
        '<div class="hj-ruta"><h4>Gantt-schema <kbd>G</kbd></h4><p>Momenten som staplar över tid, för de projekt du är med i. Tryck <b>+</b> vid projektnamnet för att lägga till ett moment, avrop, leverans, möte eller annat direkt — det hamnar på tavlan med en gång. Exportera som <b>Excel</b>, <b>bild</b> eller <b>PDF</b> under <i>Exportera</i>.</p></div>' +
        "</div>" },

    { id: "uppfoljning", ik: "ik-utfall", rubrik: "Uppföljning", ingress: "Hur bra höll planen — och varför inte?",
      html:
        "<h4>Veckans utfall</h4>" +
        "<p>Visar <b>planpålitligheten</b>: hur stor del av de produktionsposter ni lovade som blev gjorda. 80 % eller mer är bra. Du ser också det som inte blev gjort, de vanligaste orsakerna och sådant som tillkom under veckan. Välj vecka bland de senaste åtta.</p>" +
        "<h4>Resurser</h4>" +
        "<p>Vilka personer och yrkesgrupper som finns och hur många som är på plats varje dag, med frånvaro inräknad. Personer lägger du in under <i>Projektinställningar → Resurser</i>.</p>" +
        "<h4>Historik</h4>" +
        "<p>Panelen <i>Historik</i> till höger visar vad som har ändrats på tavlan och av vem — bra när något verkar ha försvunnit.</p>" },

    { id: "moten", ik: "ik-mote", rubrik: "Möten", ingress: "Tavlan fungerar bäst när den används på fasta möten.",
      html:
        '<div class="hj-grid hj-grid-2">' +
        '<div class="hj-ruta"><h4>Veckoplanering · fredag · 30 min</h4><ol>' +
        "<li>Vad lovade vi den här veckan? Blev det gjort? (5)</li>" +
        "<li>Nästa vecka: är varje aktivitet genomförbar? (15)</li>" +
        "<li>Vecka +2: vad måste avropas och bokas nu? (5)</li>" +
        "<li>Vecka +3: kommer något med lång ledtid? (5)</li></ol>" +
        "</div>" +
        '<div class="hj-ruta"><h4>Morgonmötet · 10 min</h4><ol>' +
        "<li>Igår: blev det gjort? Om inte — varför, med ett ord.</li>" +
        "<li>Idag: vad kör vi, är något i vägen?</li>" +
        "<li>Imorgon: vad måste lösas idag för att imorgon ska funka?</li>" +
        "<li>Hinderlistan igenom. Inga problem löses här.</li></ol></div>" +
        "</div>" },

    { id: "visning", ik: "ik-tv", rubrik: "Visningsläge och utskrift", ingress: "Tavlan på storskärm i bodan eller på papper.",
      html:
        "<ul>" +
        "<li><b>Visningsläge</b> <kbd>V</kbd> visar bara tavlan med stora kort och text, perfekt för en TV. Tryck <i>Avsluta visning</i> eller <kbd>V</kbd> igen för att gå tillbaka.</li>" +
        "<li><b>Skriv ut</b> i menyn gör en utskriftsvänlig version av tavlan. Välj <i>Spara som PDF</i> i utskriftsrutan om du vill ha en fil.</li>" +
        "</ul>" },

    { id: "behorighet", ik: "ik-konto", rubrik: "Projekt, konto och behörighet", ingress: "Vem som ser och får ändra vad.",
      html:
        '<table class="hj-tabell"><thead><tr><th>Roll</th><th>Kan</th></tr></thead><tbody>' +
        "<tr><td>Huvudadmin</td><td>Allt i alla projekt. Bestämmer vilka som ser vilka projekt och vem som är admin.</td></tr>" +
        "<tr><td>Får skapa projekt</td><td>Ett tillägg som huvudadmin ger en användare: kan starta egna projekt och blir projektadmin i dem. Ser bara sina egna projekt och de hen bjuds in till.</td></tr>" +
        "<tr><td>Projektadmin</td><td>Allt i sitt projekt, inklusive medlemmar och behörighet per tavla.</td></tr>" +
        "<tr><td>Redigera</td><td>Lägga till, ändra och flytta poster.</td></tr>" +
        "<tr><td>Läsa</td><td>Se allt men inte ändra något.</td></tr>" +
        "</tbody></table>" +
        "<p>Behörighet kan också sättas per tavla: <b>admin</b>, <b>redigera</b>, <b>läsa</b> eller <b>ingen åtkomst</b>. Det görs under <i>Mitt konto → Medlemmar…</i> på projektet.</p>" +
        "<p>Projekt som är klara kan arkiveras under <i>Mina projekt</i>. Arkiverade projekt kan tas fram igen; radering är permanent.</p>" },

    { id: "data", ik: "ik-historik", rubrik: "Data och synk", ingress: "Var allt sparas och vad som händer utan nät.",
      html:
        "<ul>" +
        "<li>Allt sparas <b>automatiskt i molnet</b> och synkas mellan datorer. En kopia ligger i webbläsaren, så Wimo fungerar även utan nät och synkar när du är uppkopplad igen.</li>" +
        "<li>Rutan <b>Molnsynk</b> längst ner i menyn visar om allt är sparat.</li>" +
        "<li>Efter att du flyttat eller tagit bort något visas <b>Ångra</b> längst ner en kort stund.</li>" +
        "<li>Bara projektets medlemmar och admin kommer åt ett projekt.</li>" +
        "</ul>" },

    { id: "genvagar", ik: "ik-tangent", rubrik: "Kortkommandon", ingress: "Snabbare med tangentbordet. Fungerar inte när du skriver i ett fält.",
      html:
        '<div class="hj-kbd">' +
        [["N", "Snabb post"], ["P", "Planera moment"], ["← →", "Bläddra veckor"], ["T", "Denna vecka"], ["/", "Sök"], ["O", "Projektöversikt"],
         ["A", "Att göra"], ["G", "Gantt-schema"], ["V", "Visningsläge"], ["H", "Hjälp"], ["?", "Visa kortkommandon"], ["Esc", "Stäng"]]
            .map(x => "<div><span>" + x[0].split(" ").map(k => "<kbd>" + k + "</kbd>").join(" ") + "</span>" + x[1] + "</div>").join("") +
        "</div>" },

    { id: "fragor", ik: "ik-hjalp", rubrik: "Vanliga frågor", ingress: "Snabba svar på det som brukar dyka upp.",
      html: [
        ["Jag ser fortfarande den gamla versionen", "Ladda om sidan med <kbd>Ctrl</kbd> + <kbd>F5</kbd> (eller <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>R</kbd> på Mac) så hämtas den senaste versionen."],
        ["Jag kan inte ändra något", "Du har troligen bara läsbehörighet, i hela projektet eller på just den tavlan. Det står <i>Bara läsbehörighet</i> under tavlans namn. Be en admin ändra din behörighet."],
        ["Ett kort har försvunnit", "Kontrollera att posttypen inte är avslagen under <i>Visa</i>, att sökfältet är tomt och att du tittar på rätt vecka och tavla. Kolla sedan <i>Historik</i> — där syns om någon flyttat eller tagit bort det."],
        ["Varför frågar Wimo efter en orsak när jag flyttar?", "Produktionsposter är löften. Orsaken sparas och visas i <i>Veckans utfall</i>, så att ni ser vad som oftast stoppar planen och kan åtgärda det."],
        ["Hur byter jag ort för vädret?", "<i>Projektinställningar → Ort för väderprognos</i>. Gäller projektets alla tavlor."],
        ["Kan jag använda Wimo i mobilen?", "Ja. Menyn fälls ut med knappen uppe till vänster. För planering fungerar en dator eller surfplatta bäst."],
        ["Vad händer om jag tappar nätet?", "Du kan fortsätta jobba. Ändringarna sparas i webbläsaren och skickas till molnet när du är uppkopplad igen."]
      ].map(x => '<details class="hj-fraga"><summary>' + x[0] + "</summary><p>" + x[1] + "</p></details>").join("") }
];

let hjalpObs = null;

function oppnaHjalp(till) {
    try { stangStart(); } catch (e) { }
    try { stangDash(); } catch (e) { }
    try { stangGantt(); } catch (e) { }
    try { stangBackup(); } catch (e) { }
    document.body.classList.remove("p4-kontovy");
    document.body.classList.add("dashlage");
    const el = document.getElementById("hjalp");
    el.classList.remove("dold");
    if (!el.dataset.ritad) ritaHjalp();
    if (window.p4MarkeraNav) window.p4MarkeraNav();
    if (till) setTimeout(() => hjalpTill(till), 30);
}

function stangHjalp() {
    const el = document.getElementById("hjalp");
    if (!el || el.classList.contains("dold"))
        return;
    el.classList.add("dold");
    let annan = false;
    try { annan = dashOppen() || startOppen() || ganttOppen() || backupOppen(); } catch (e) { }
    if (!annan)
        document.body.classList.remove("dashlage");
}

function hjalpOppen() {
    const el = document.getElementById("hjalp");
    return !!el && !el.classList.contains("dold");
}

// De andra sidorna stänger Hjälp när de öppnas.
["oppnaGantt", "oppnaDash", "oppnaStart", "oppnaBackup"].forEach(namn => {
    const urs = window[namn];
    if (typeof urs !== "function")
        return;
    window[namn] = function () {
        stangHjalp();
        return urs.apply(this, arguments);
    };
});

function hjalpTill(id) {
    const s = document.getElementById("hj-" + id);
    if (!s) return;
    const sok = document.getElementById("hjSok");
    if (sok && sok.value) { sok.value = ""; hjalpFiltrera(""); }
    s.scrollIntoView({ behavior: "smooth", block: "start" });
    markeraHjalpToc(id);
}

function markeraHjalpToc(id) {
    document.querySelectorAll("#hjalp .hj-toc a").forEach(a => {
        const pa = a.dataset.hjTill === id;
        a.classList.toggle("aktiv", pa);
        if (pa) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current");
    });
}

function hjalpFiltrera(q) {
    const ord = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const box = document.getElementById("hjalp");
    let traffar = 0;
    const passar = el => { const t = el.textContent.toLowerCase(); return ord.every(o => t.indexOf(o) >= 0); };
    box.querySelectorAll(".hj-tank-kort").forEach(k => {
        const v = !ord.length || passar(k);
        k.classList.toggle("dold", !v);
        if (v && ord.length) traffar++;
    });
    const tank = box.querySelector(".hj-tank");
    tank.classList.toggle("dold", ord.length > 0 && !tank.querySelector(".hj-tank-kort:not(.dold)"));
    box.querySelectorAll(".hj-sektion").forEach(s => {
        const v = !ord.length || passar(s);
        s.classList.toggle("dold", !v);
        if (v && ord.length) {
            traffar++;
            s.querySelectorAll("details").forEach(d => { d.open = passar(d); });
        }
        const a = box.querySelector('.hj-toc a[data-hj-till="' + s.id.slice(3) + '"]');
        if (a) a.classList.toggle("tom", !v);
    });
    const info = document.getElementById("hjSokInfo");
    info.textContent = !ord.length ? "" : traffar ? traffar + (traffar === 1 ? " träff" : " träffar") : "Inga träffar — prova ett annat ord.";
    info.classList.toggle("ingen", ord.length > 0 && !traffar);
}

function ritaHjalp() {
    const box = document.getElementById("hjalp");
    box.dataset.ritad = "1";
    let html = '<div class="p4-hero hj-hero"><div class="p4-hero-text">' +
        '<div class="p4-eyebrow"><span class="p4-pop"></span>Stöd · Wimo</div>' +
        '<h1 class="g-rubrik">Hjälp</h1>' +
        '<div class="g-meta">Hur allt fungerar — och vad du ska tänka på när du planerar.</div></div>' +
        '<div class="hj-sokruta"><label class="p4-sok hj-sok"><span class="p4-ik ik-sok" aria-hidden="true"></span>' +
        '<input type="search" id="hjSok" placeholder="Sök i hjälpen, t.ex. avrop" aria-label="Sök i hjälpen" autocomplete="off"></label>' +
        '<span class="hj-sokinfo" id="hjSokInfo" aria-live="polite"></span></div></div>';

    html += '<section class="hj-tank" aria-labelledby="hjTankRubrik">' +
        '<div class="hj-tank-topp"><span class="hj-tank-ikon" aria-hidden="true">!</span><div>' +
        '<h2 id="hjTankRubrik">Tänk på det här</h2><p>Tio saker som gör att planen håller — och att Wimo gör nytta.</p></div></div>' +
        '<div class="hj-tank-grid">' +
        HJALP_TANK.map((x, i) => '<div class="hj-tank-kort"><span class="hj-nr">' + (i + 1) + "</span><div><b>" + x[0] + "</b><p>" + x[1] + "</p></div></div>").join("") +
        "</div></section>";

    html += '<div class="hj-layout"><nav class="hj-toc" aria-label="Innehåll i hjälpen"><div class="hj-toc-rubrik">Innehåll</div>' +
        HJALP_SEKTIONER.map(s => '<a href="#hj-' + s.id + '" data-hj-till="' + s.id + '"><span class="p4-ik ' + s.ik + '" aria-hidden="true"></span>' + s.rubrik + "</a>").join("") +
        '</nav><div class="hj-innehall">' +
        HJALP_SEKTIONER.map(s => '<section class="hj-sektion" id="hj-' + s.id + '" aria-labelledby="hjr-' + s.id + '">' +
            '<header><span class="hj-sikon"><span class="p4-ik ' + s.ik + '" aria-hidden="true"></span></span><div>' +
            '<h2 id="hjr-' + s.id + '">' + s.rubrik + "</h2><p>" + s.ingress + "</p></div></header>" +
            '<div class="hj-text">' + s.html + "</div></section>").join("") +
        '<div class="hj-slut">Hittar du inte svaret? Hör av dig till projektets admin eller till den som gav dig tillgång till Wimo.</div>' +
        "</div></div>";
    box.innerHTML = html;

    box.addEventListener("click", e => {
        const a = e.target.closest("[data-hj-till]");
        if (!a) return;
        e.preventDefault();
        hjalpTill(a.dataset.hjTill);
    });
    const sok = document.getElementById("hjSok");
    sok.addEventListener("input", () => hjalpFiltrera(sok.value));
    sok.addEventListener("keydown", e => { if (e.key === "Escape") { sok.value = ""; hjalpFiltrera(""); sok.blur(); } });

    // Markera sektionen man läser i innehållsförteckningen.
    if (window.IntersectionObserver) {
        hjalpObs = new IntersectionObserver(poster => {
            const synliga = poster.filter(p => p.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
            if (synliga.length) markeraHjalpToc(synliga[0].target.id.slice(3));
        }, { rootMargin: "-90px 0px -60% 0px" });
        box.querySelectorAll(".hj-sektion").forEach(s => hjalpObs.observe(s));
    }
    markeraHjalpToc(HJALP_SEKTIONER[0].id);
}
