/* ======================================================================
   Domänkonstanter
   ====================================================================== */

const DAGKORT = ["Mån", "Tis", "Ons", "Tors", "Fre"];

const FOMRADEN = [
    { id: "foregaende", namn: "Föregående arbete", valbar: true, hint: "Är det vi bygger vidare på färdigt och i rätt skick?" },
    { id: "logistik", namn: "Arbetsplats / logistik", valbar: true, hint: "Åtkomst, arbetsyta, upplag, lossning, transportväg." },
    { id: "kontroll", namn: "Kontroll / utsättning", valbar: true, hint: "Utsättning, egenkontroll, mottagningskontroll, besiktning före nästa moment." },
    { id: "sakerhet", namn: "Säkerhet / yttre", valbar: true, hint: "Väder, fallrisk, lyftrisk, avspärrning, andra arbetsmiljöförutsättningar." },
    { id: "handling", namn: "Handlingar / beslut", valbar: false, hint: "" },
    { id: "material", namn: "Material / leverans", valbar: false, hint: "" },
    { id: "bemanning", namn: "Bemanning / kompetens", valbar: false, hint: "" },
    { id: "maskiner", namn: "Maskiner / hjälpmedel", valbar: false, hint: "" }
];

const GRUNDFRAGOR = [
    { id: "handling",
        fraga: "Är handlingar och nödvändiga beslut genomgångna så att momentet kan utföras utan oklarheter?",
        namn: "Handlingar och beslut",
        svar: [["ja", "Ja"], ["nej", "Nej / Inte helt"]],
        precisera: ["Handling", "Beslut", "Annan oklarhet"],
        vadText: "Vad behöver redas ut eller saknas?" },
    { id: "material",
        fraga: "Är material, maskiner och hjälpmedel säkrade i rätt tid för momentet?",
        namn: "Material, maskiner och hjälpmedel",
        svar: [["ja", "Ja"], ["nej", "Nej / Inte helt"]],
        precisera: ["Material", "Maskin", "Kran/lyft", "Ställning/lift", "Annat"],
        vadText: "Vad saknas eller är inte säkrat?" },
    { id: "ue",
        fraga: "Är berörda UE och externa resurser avropade och införstådda med när och vad de ska utföra?",
        namn: "UE och externa resurser",
        svar: [["ja", "Ja"], ["ejrelevant", "Ej relevant"], ["nej", "Nej / Inte helt"]],
        precisera: null,
        vadText: "Vilken UE/resurs, och vad behöver avropas eller bekräftas?" }
];

const LAGEN = [
    { id: "gron", ikon: "😀", txt: "Planen höll bra" },
    { id: "gul", ikon: "😐", txt: "Planen höll delvis" },
    { id: "rod", ikon: "☹️", txt: "Planen höll dåligt" }
];

const VSYMBOL = [[0, "☀"], [1, "⛅"], [2, "⛅"], [3, "☁"], [45, "🌫"], [48, "🌫"], [51, "🌦"], [53, "🌦"], [55, "🌦"],
    [56, "🌧"], [57, "🌧"], [61, "🌧"], [63, "🌧"], [65, "🌧"], [66, "🌧"], [67, "🌧"], [71, "❄"], [73, "❄"], [75, "❄"],
    [77, "❄"], [80, "🌦"], [81, "🌧"], [82, "🌧"], [85, "❄"], [86, "❄"], [95, "⛈"], [96, "⛈"], [99, "⛈"]];

const FROLLER = [["leverantor", "Leverantör"], ["ue", "UE"]];
const MANAD = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];

const VARNINGSTYPER = [
    { id: "vind", namn: "Vind över", enhet: "m/s", std: 10, falt: "vind", riktning: "over",
        etikett: v => "Vind " + Math.round(v) + " m/s" },
    { id: "byvind", namn: "Byvind över", enhet: "m/s", std: 15, falt: "byvind", riktning: "over",
        etikett: v => "Byvind " + Math.round(v) + " m/s" },
    { id: "nederbord", namn: "Nederbörd över", enhet: "mm/dygn", std: 10, falt: "nederbord", riktning: "over",
        etikett: v => "Nederbörd " + (v >= 10 ? Math.round(v) : v.toFixed(1)) + " mm" },
    { id: "temp_under", namn: "Temperatur under", enhet: "°C", std: 0, falt: "tempMin", riktning: "under",
        etikett: v => "Lägst " + Math.round(v) + " °C" },
    { id: "temp_over", namn: "Temperatur över", enhet: "°C", std: 25, falt: "temp", riktning: "over",
        etikett: v => "Högst " + Math.round(v) + " °C" }
];
