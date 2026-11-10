/* ======================================================================
   Wimo · Konto och molnsynk (Firebase Authentication + Cloud Firestore)

   - Utan konto fungerar Wimo som förut: allt sparas lokalt i webbläsaren.
   - Inloggad sparas varje projekt dessutom i Firestore, och ändringar från
     andra enheter hämtas automatiskt.
   - Den lokala lagringen ligger kvar som cache, så appen fungerar offline.
     Ändringar som görs utan nät laddas upp när nätet kommer tillbaka.
   - Ingenting skrivs över tyst. Har samma projekt ändrats på två enheter
     får användaren välja vilken version som gäller.

   Datamodell i Firestore:
     anvandare/{uid}                 { epost, aktivtProjekt, uppdaterad }
     projekt/{id}                    { namn, arkiverad, data, rev, uppdaterad, enhet, medlemmar, lasare }
   där data är hela projektet som JSON-text och rev ökar med ett per sparning.
   medlemmar är alla som har tillgång (uid). lasare är de medlemmar som bara
   får läsa: de ser projektet men deras ändringar sparas aldrig.

   Skriptet är ett vanligt skript som laddar Firebase med dynamisk import, så
   att det fungerar även när index.html öppnas direkt från disken.
   ====================================================================== */
(function () {
    "use strict";

    const SDK = "https://www.gstatic.com/firebasejs/10.12.2/";
    const MOLNNYCKEL = "plan4_moln";          // { uid, rev: {id: rev}, hash: {id: hash} }
    const ENHETNYCKEL = "plan4_enhet";
    const MAX_PROJEKT_TECKEN = 900000;        // Firestore tillåter högst 1 MiB per dokument
    const $ = (id) => document.getElementById(id);

    const konfig = window.PLAN4_FIREBASE || {};
    const aktiverat = !!(konfig.apiKey && konfig.projectId);

    // ---------- tillstånd ----------
    let fb = null;                 // laddade Firebase-moduler och instanser
    let anvandare = null;          // inloggad Firebase-användare
    let synkKlar = false;          // första synken efter inloggning är gjord
    let lyssnare = null;           // avregistrering för onSnapshot
    let pushTimer = null;
    let pushPagar = false;
    let pushIgen = false;
    let senastSynkad = null;
    let lage = aktiverat ? "utloggad" : "av";   // av | utloggad | synkar | synkad | offline | konflikt | fel
    const konflikter = new Map();  // projekt-id → { namn, molnData, molnRev, borttagen }

    function lasJson(n, std) { try { return JSON.parse(localStorage.getItem(n)) || std; } catch (e) { return std; } }
    function skrivJson(n, v) { try { localStorage.setItem(n, JSON.stringify(v)); } catch (e) { } }
    function enhetsId() {
        let id = null;
        try { id = localStorage.getItem(ENHETNYCKEL); } catch (e) { }
        if (!id) {
            id = Math.random().toString(36).slice(2, 12);
            try { localStorage.setItem(ENHETNYCKEL, id); } catch (e) { }
        }
        return id;
    }
    const ENHET = enhetsId();
    let moln = lasJson(MOLNNYCKEL, { uid: null, rev: {}, hash: {} });
    function sparaMoln() { skrivJson(MOLNNYCKEL, moln); }

    // Kort, stabil kontrollsumma (FNV-1a) för att se om ett projekt ändrats sedan senaste synk.
    function hash(txt) {
        let h = 0x811c9dc5;
        for (let i = 0; i < txt.length; i++) { h ^= txt.charCodeAt(i); h = Math.imul(h, 0x01000193); }
        return (h >>> 0).toString(36) + ":" + txt.length;
    }
    const projektJson = (p) => JSON.stringify(p);
    // Den som inte får ändra något har aldrig något eget att ladda upp.
    const arAndrad = (p) => kanSkriva(p) && moln.hash[p.id] !== hash(projektJson(p));

    // ---------- behörigheter ----------
    // Huvudadmin (roll "admin" på kontot) har full åtkomst till allt. Övriga har en roll per projekt:
    //   projektAdmin  – allt i projektet, och väljer vilka som är med och vad de får göra
    //   (vanlig)      – kan redigera
    //   lasare        – bara läsa
    // och kan dessutom ha en egen behörighet per tavla i tavlaBeh[uid][tavlaId]:
    //   "admin" | "red" | "las" | "ingen" (ingen åtkomst: tavlan syns inte alls).
    const LASNYCKEL = "plan4_las";            // { uid, beh: { projektId: { roll, tavlor } } }, gäller även offline
    let behCache = {};
    const TAVLARATT = ["admin", "red", "las", "ingen"];
    // Min roll i ett projekt: "huvud" | "admin" | "red" | "las".
    function minBeh(pid) {
        if (!anvandare) return { roll: "red", tavlor: {} };
        if (arAdmin()) return { roll: "huvud", tavlor: {} };
        const m = projektMeta.get(pid);
        if (m) return { roll: m.projektAdmin.includes(anvandare.uid) ? "admin" : m.lasare.includes(anvandare.uid) ? "las" : "red",
            tavlor: (m.tavlaBeh && m.tavlaBeh[anvandare.uid]) || {} };
        return behCache[pid] || { roll: "red", tavlor: {} };
    }
    const minRoll = (pid) => minBeh(pid).roll;
    const arProjektAdmin = (pid) => { const r = minRoll(pid); return r === "huvud" || r === "admin"; };
    // Min rätt på en tavla: "admin" | "red" | "las" | "ingen". Projektadmin styrs inte per tavla.
    function tavlaRatt(pid, tid) {
        const b = minBeh(pid);
        if (b.roll === "huvud" || b.roll === "admin") return "admin";
        const o = b.tavlor[tid];
        return TAVLARATT.includes(o) ? o : b.roll;
    }
    const harTavlaAdmin = (pid) => Object.values(minBeh(pid).tavlor).includes("admin");
    // Får jag ändra något alls i projektet?
    function kanSkriva(p) {
        if (minRoll(p.id) !== "las") return true;
        return p.tavlor.some((t) => { const r = tavlaRatt(p.id, t.id); return r === "red" || r === "admin"; });
    }
    // Bara läsa i projektet som helhet (projektets inställningar, register, tavellistan).
    const arLas = (id) => !!anvandare && minRoll(id) === "las";
    const tavlaLas = (pid, tid) => !!anvandare && tavlaRatt(pid, tid) === "las";
    // Projektets innehåll utan vald tavla: att byta tavla räknas inte som en ändring.
    const innehall = (p) => JSON.stringify(Object.assign({}, p, { aktiv: undefined }));
    const lasBasis = new Map();               // id → innehållet senast det synkades med molnet
    // Tavlor man saknar åtkomst till tas bort ur den lokala kopian och läggs tillbaka orörda vid uppladdning.
    const doldaTavlor = new Map();            // projektId → { ordning: [tavlaId], dolda: [tavla] } ur senaste molnversionen

    // ---------- Firebase ----------
    async function laddaFirebase() {
        if (fb) return fb;
        const [app, auth, fs] = await Promise.all([
            import(SDK + "firebase-app.js"), import(SDK + "firebase-auth.js"), import(SDK + "firebase-firestore.js")]);
        const appen = app.initializeApp(konfig);
        fb = { auth, fs, authInst: auth.getAuth(appen), db: fs.getFirestore(appen) };
        return fb;
    }
    const anvDoc = () => fb.fs.doc(fb.db, "anvandare", anvandare.uid);
    // Projekten är gemensamma: projekt/{id} med en lista medlemmar (uid). Admin ser alla,
    // övriga bara de projekt de är medlemmar i.
    const projektSamling = () => fb.fs.collection(fb.db, "projekt");
    const projektFraga = () => arAdmin() ? projektSamling()
        : fb.fs.query(projektSamling(), fb.fs.where("medlemmar", "array-contains", anvandare.uid));
    const projektDoc = (id) => fb.fs.doc(fb.db, "projekt", id);
    const gamlaProjekt = () => fb.fs.collection(fb.db, "anvandare", anvandare.uid, "projekt");   // före medlemskap
    const projektMeta = new Map();   // id → { namn, arkiverad, medlemmar, lasare, projektAdmin, tavlaBeh, tavlor }
    function metaFran(x) {
        let tavlor = [];
        try { tavlor = (JSON.parse(x.data || "{}").tavlor || []).map((t) => ({ id: t.id, namn: t.namn || "Tavla" })); } catch (e) { }
        return { namn: x.namn || "Projekt", arkiverad: !!x.arkiverad, medlemmar: x.medlemmar || [], lasare: x.lasare || [],
            projektAdmin: x.projektAdmin || [], tavlaBeh: x.tavlaBeh || {}, tavlor: tavlor };
    }
    function lasMeta(docs) {
        projektMeta.clear();
        docs.forEach((d) => projektMeta.set(d.id, metaFran(d.data())));
    }

    // ---------- hjälp mot appen ----------
    function tomtStandardprojekt() {
        if (plan4.projekt.length !== 1) return false;
        const p = plan4.projekt[0];
        const poster = p.tavlor.reduce((n, t) => n + t.kort.length + t.hinder.length + t.aterkom.length, 0);
        return !poster && !fAktiviteter(p).length && !p.resurser.personer.length && !p.resurser.kategorier.length && !p.foretag.length;
    }
    function dialogOppen() { return !!$("overlay"); }
    function lasProjekt(data, lokal) {
        const p = JSON.parse(data);
        rustaProjekt(p, IDAG);
        if (lokal) return p;
        // tavlor utan åtkomst plockas bort (men minst en tavla blir kvar, som bara går att läsa)
        const ordning = p.tavlor.map((t) => t.id);
        let dolda = p.tavlor.filter((t) => tavlaRatt(p.id, t.id) === "ingen");
        if (dolda.length === p.tavlor.length) dolda = dolda.slice(1);
        doldaTavlor.set(p.id, { ordning: ordning, dolda: JSON.parse(JSON.stringify(dolda)) });
        if (dolda.length) {
            const bort = new Set(dolda.map((t) => t.id));
            p.tavlor = p.tavlor.filter((t) => !bort.has(t.id));
            if (!p.tavlor.some((t) => t.id === p.aktiv)) p.aktiv = p.tavlor[0].id;
        }
        return p;
    }
    // Det som laddas upp: den lokala kopian med de dolda tavlorna tillbaka på sina platser.
    function uppladdningsJson(p, json) {
        const d = doldaTavlor.get(p.id);
        if (!d || !d.dolda.length) return json;
        const q = JSON.parse(json), egna = new Map(q.tavlor.map((t) => [t.id, t])), dolda = new Map(d.dolda.map((t) => [t.id, t]));
        const ut = [];
        d.ordning.forEach((id) => { if (egna.has(id)) { ut.push(egna.get(id)); egna.delete(id); } else if (dolda.has(id)) ut.push(dolda.get(id)); });
        egna.forEach((t) => ut.push(t));
        q.tavlor = ut;
        return JSON.stringify(q);
    }
    // Saknar vi en dold tavla som borde finnas med? Då väntar uppladdningen tills molnet är inläst.
    function saknarDolda(p) {
        const b = minBeh(p.id);
        if (b.roll === "huvud" || b.roll === "admin") return false;
        return Object.values(b.tavlor).includes("ingen") && !doldaTavlor.has(p.id);
    }
    function markeraSynkad(p, rev) { moln.rev[p.id] = rev; moln.hash[p.id] = hash(projektJson(p)); lasBasis.set(p.id, innehall(p)); }

    // Läser behörigheterna ur projektdokumenten. Ändras vilka tavlor som syns läses projektet om.
    function uppdateraBeh(dokument) {
        if (!anvandare) return;
        const fore = {};
        dokument.forEach((d) => { fore[d.id] = JSON.stringify(minBeh(d.id)); });
        projektMeta.clear();
        dokument.forEach((d) => projektMeta.set(d.id, metaFran(d)));
        const nyCache = {};
        let andrat = false;
        dokument.forEach((d) => {
            const b = minBeh(d.id);
            nyCache[d.id] = b;
            if (fore[d.id] !== JSON.stringify(b)) andrat = true;
        });
        behCache = nyCache;
        skrivJson(LASNYCKEL, { uid: anvandare.uid, beh: nyCache });
        // tavlor som blivit dolda eller synliga: läs om projektet från molnet (om inget lokalt väntar)
        dokument.forEach((d) => {
            const p = plan4.projekt.find((x) => x.id === d.id);
            if (!p || !d.data) return;
            let moln0;
            try { moln0 = JSON.parse(d.data).tavlor || []; } catch (e) { return; }
            const ska = new Set(moln0.filter((t) => tavlaRatt(d.id, t.id) !== "ingen").map((t) => t.id));
            if (!ska.size && moln0.length) ska.add(moln0[0].id);
            const har = new Set(p.tavlor.map((t) => t.id));
            const fel = [...har].some((id) => moln0.some((t) => t.id === id) && !ska.has(id)) || [...ska].some((id) => !har.has(id));
            if (fel && (d.rev || 0) === (moln.rev[d.id] || 0) && !arAndrad(p)) vantande.set(d.id, { data: d.data, rev: d.rev });
        });
        if (andrat) { markeraLasvy(); if (kontoOppen()) { ritaSynkkort(); ritaAdmin(); } startaAnvandarlista(); }
    }
    // Innehållet ett läsbehörigt projekt ska ha: senaste synk, annars den sparade kopian på datorn.
    function basFor(p) {
        if (lasBasis.has(p.id)) return lasBasis.get(p.id);
        try {
            const d = JSON.parse(localStorage.getItem(NYCKEL));
            const x = d && Array.isArray(d.projekt) && d.projekt.find((q) => q.id === p.id);
            if (x) { const b = innehall(lasProjekt(JSON.stringify(x), true)); lasBasis.set(p.id, b); return b; }
        } catch (e) { }
        return null;
    }
    function lasMeddelande() {
        status("Du har bara läsbehörighet här — ändringen sparades inte");
    }
    // Ändringar i det man bara får läsa rullas tillbaka direkt och sparas aldrig:
    // projektets egna delar (inställningar, register, tavellistan) och enskilda tavlor.
    let aterstallTimer = null;
    const utanTavlor = (p) => JSON.stringify(Object.assign({}, p, { aktiv: undefined, tavlor: p.tavlor.map((t) => t.id) }));
    const tavlaJson = (p, id) => { const t = p.tavlor.find((x) => x.id === id); return t ? JSON.stringify(t) : null; };
    const basObj = new Map();
    function basForObj(p) {
        const b = basFor(p);
        if (b === null) return null;
        const c = basObj.get(p.id);
        if (c && c.txt === b) return c.obj;
        const obj = JSON.parse(b);
        basObj.set(p.id, { txt: b, obj: obj });
        return obj;
    }
    function skyddat(p) {
        if (!anvandare || arAdmin()) return null;
        const proj = arLas(p.id), tavlor = p.tavlor.filter((t) => tavlaLas(p.id, t.id)).map((t) => t.id);
        return proj || tavlor.length ? { proj: proj, tavlor: tavlor } : null;
    }
    function brott(p) {
        const s = skyddat(p);
        if (!s) return false;
        const b = basForObj(p);
        if (!b) return false;
        if (s.proj && utanTavlor(p) !== utanTavlor(b)) return true;
        return s.tavlor.some((id) => tavlaJson(p, id) !== tavlaJson(b, id));
    }
    function lasAndrat() { return plan4.projekt.some(brott); }
    function aterstallLas() {
        aterstallTimer = null;
        let n = 0;
        plan4.projekt.forEach((p, i) => {
            if (!brott(p)) return;
            const s = skyddat(p), b = JSON.parse(JSON.stringify(basForObj(p)));
            let ny;
            if (s.proj) {
                // projektets delar från senaste synk; tavlor man får ändra behåller sina ändringar
                ny = b;
                ny.tavlor = b.tavlor.map((bt) => {
                    const egen = p.tavlor.find((t) => t.id === bt.id);
                    return egen && !s.tavlor.includes(bt.id) ? egen : bt;
                });
            } else {
                ny = p;
                ny.tavlor = p.tavlor.map((t) => s.tavlor.includes(t.id) ? (b.tavlor.find((bt) => bt.id === t.id) || t) : t);
            }
            ny.aktiv = p.aktiv && ny.tavlor.some((t) => t.id === p.aktiv) ? p.aktiv : ny.tavlor[0].id;
            rustaProjekt(ny, IDAG);
            plan4.projekt[i] = ny;
            if (state === p) { angraForeAvbryt(); state = ny; valdKedja = null; }
            n++;
        });
        if (!n) return;
        if (dialogOppen()) stangModal();
        rita();
        lasMeddelande();
        if (kanSkriva(state)) ursSpara();
    }
    function markeraLasvy() {
        const las = !!(state && state.id && state.tavlor && tavlaLas(state.id, (T() || {}).id));
        document.body.classList.toggle("p4-projlas", !!(state && state.id && anvandare && !arAdmin() && arLas(state.id)));
        document.body.classList.toggle("p4-las", las);
        const namn = $("tavlanamn");
        if (namn) namn.readOnly = las;
    }

    // Molnets version av de tavlor jag inte ser (läggs tillbaka orörda vid uppladdning).
    function uppdateraDolda(pid, data) {
        if (!data || !anvandare || arAdmin()) return;
        try {
            const p = JSON.parse(data), tav = p.tavlor || [];
            let dolda = tav.filter((t) => tavlaRatt(pid, t.id) === "ingen");
            if (dolda.length === tav.length) dolda = dolda.slice(1);
            doldaTavlor.set(pid, { ordning: tav.map((t) => t.id), dolda: dolda });
        } catch (e) { }
    }
    const harNagonAdminroll = () => arAdmin() || [...projektMeta.keys()].some((id) => arProjektAdmin(id));
    function rollTagg(pid) {
        const b = minBeh(pid);
        if (b.roll === "huvud") return "";
        const t = Object.values(b.tavlor);
        return (b.roll === "admin" ? ' <span class="p4-ks-tagg admin">Projektadmin</span>' : b.roll === "las" ? ' <span class="p4-ks-tagg">Bara läsa</span>' : "") +
            (b.roll !== "admin" && t.includes("admin") ? ' <span class="p4-ks-tagg admin">Tavleadmin</span>' : "") +
            (b.roll !== "admin" && t.includes("ingen") ? ' <span class="p4-ks-tagg">Vissa tavlor dolda</span>' : "");
    }

    // Läser in molnets projekt som hela Wimo (ersätter det lokala).
    function anvandMolnet(dokument, aktivt) {
        moln = { uid: anvandare.uid, rev: {}, hash: {} };
        const projekt = dokument.map((d) => lasProjekt(d.data));
        if (!projekt.length) return false;
        angraForeAvbryt();
        laddaRot({ version: VERSION, aktivtProjekt: aktivt || null, projekt: projekt });
        dokument.forEach((d, i) => markeraSynkad(projekt[i], d.rev));
        sparaMoln();
        vyOffset = 0; valdKedja = null; VADER = {};
        ursSparaNu();
        rita();
        return true;
    }

    // Byter ut ett enskilt projekt mot molnets version.
    function ersattProjekt(id, data, rev) {
        const ny = lasProjekt(data);
        const i = plan4.projekt.findIndex((p) => p.id === id);
        if (i >= 0) plan4.projekt[i] = ny; else plan4.projekt.push(ny);
        if (state.id === id) { angraForeAvbryt(); state = ny; valdKedja = null; }
        markeraSynkad(ny, rev);
        // ett tomt reservprojekt (när användaren saknade projekt) behövs inte längre
        const reserv = plan4.projekt.findIndex((p) => p.id !== id && !(p.id in moln.rev) && !arAdmin());
        if (reserv >= 0) { const r = plan4.projekt[reserv]; plan4.projekt.splice(reserv, 1); if (state.id === r.id) state = ny; }
        sparaMoln();
        ursSparaNu();
        rita();
        kontrolleraTillgang();
    }

    function taBortLokalt(id) {
        const i = plan4.projekt.findIndex((p) => p.id === id);
        if (i < 0) return;
        plan4.projekt.splice(i, 1);
        delete moln.rev[id]; delete moln.hash[id]; sparaMoln();
        if (!plan4.projekt.length) {
            const p = nyttProjekt("Projekt", "Produktion", IDAG);
            rustaProjekt(p, IDAG);
            plan4.projekt.push(p);
        }
        if (state.id === id) valjProjekt((aktivaProjekt()[0] || plan4.projekt[0]).id);
        else { ursSparaNu(); rita(); }
        kontrolleraTillgang();
    }

    // ---------- uppladdning ----------
    function schemalaggPush(ms) {
        if (!anvandare || !synkKlar) return;
        clearTimeout(pushTimer);
        pushTimer = setTimeout(push, ms == null ? 1500 : ms);
    }

    async function push() {
        if (!anvandare || !synkKlar) return;
        if (pushPagar) { pushIgen = true; return; }
        pushPagar = true;
        let fel = null;
        try {
            const lokala = new Set();
            for (const p of plan4.projekt) {
                lokala.add(p.id);
                if (konflikter.has(p.id) || !arAndrad(p)) continue;
                if (!(p.id in moln.rev) && !kanSkapaProjekt()) continue;    // bara den som får skapa projekt lägger till nya
                if (saknarDolda(p)) continue;                          // väntar på molnets version av de dolda tavlorna
                const json = projektJson(p), upp = uppladdningsJson(p, json);
                if (upp.length > MAX_PROJEKT_TECKEN) {
                    status("Projektet " + p.projekt + " är för stort för molnet och kan inte sparas där", true);
                    continue;
                }
                const ref = projektDoc(p.id), vantad = moln.rev[p.id] || 0;
                let utfall;
                try {
                    utfall = await fb.fs.runTransaction(fb.db, async (tx) => {
                        const snap = await tx.get(ref);
                        const molnRev = snap.exists() ? snap.data().rev || 0 : 0;
                        if (molnRev !== vantad) return { konflikt: true, snap };
                        const x = snap.exists() ? snap.data() : {};
                        tx.set(ref, { namn: p.projekt, arkiverad: !!p.arkiverad, data: upp, rev: molnRev + 1,
                            uppdaterad: fb.fs.serverTimestamp(), enhet: ENHET,
                            medlemmar: snap.exists() ? x.medlemmar || [] : [anvandare.uid],
                            lasare: x.lasare || [],
                            // den som skapar ett projekt utan att vara huvudadmin blir projektadmin i det
                            projektAdmin: snap.exists() ? x.projektAdmin || [] : (arAdmin() ? [] : [anvandare.uid]),
                            tavlaBeh: x.tavlaBeh || {} });
                        return { rev: molnRev + 1 };
                    });
                } catch (e) {
                    if (e && e.code === "permission-denied") continue;   // inte längre medlem — lyssnaren tar bort projektet
                    throw e;
                }
                if (utfall.konflikt) {
                    const d = utfall.snap.exists() ? utfall.snap.data() : null;
                    registreraKonflikt(p.id, p.projekt, d);
                } else {
                    moln.rev[p.id] = utfall.rev;
                    moln.hash[p.id] = hash(json);
                    lasBasis.set(p.id, innehall(JSON.parse(json)));
                    sparaMoln();
                }
            }
            // projekt som admin raderat permanent här tas bort i molnet
            for (const id of Object.keys(moln.rev)) {
                if (lokala.has(id) || konflikter.has(id) || !arAdmin()) continue;
                await fb.fs.deleteDoc(projektDoc(id));
                delete moln.rev[id]; delete moln.hash[id]; sparaMoln();
            }
            await fb.fs.setDoc(anvDoc(), { epost: anvandare.email || "", aktivtProjekt: plan4.aktivtProjekt || null,
                uppdaterad: fb.fs.serverTimestamp() }, { merge: true });
            senastSynkad = new Date();
        } catch (e) { fel = e; }
        pushPagar = false;
        if (fel) {
            lage = navigator.onLine === false || /unavailable|network|offline/i.test(String(fel.code || fel.message)) ? "offline" : "fel";
            console.warn("Wimo molnsynk:", fel);
            schemalaggPush(30000);
        } else lage = konflikter.size ? "konflikt" : "synkad";
        uppdateraUI();
        if (pushIgen) { pushIgen = false; schemalaggPush(200); }
    }

    // ---------- konflikter ----------
    function registreraKonflikt(id, namn, molnDok) {
        konflikter.set(id, { namn: namn, molnData: molnDok ? molnDok.data : null, molnRev: molnDok ? molnDok.rev : 0,
            borttagen: !molnDok });
        lage = "konflikt";
        uppdateraUI();
    }
    function losKonflikt(id, behallMin) {
        const k = konflikter.get(id);
        if (!k) return;
        konflikter.delete(id);
        if (behallMin) {
            moln.rev[id] = k.molnRev;      // nästa uppladdning skriver över molnets version
            moln.hash[id] = "";
            sparaMoln();
        } else if (k.borttagen) {
            taBortLokalt(id);
        } else {
            ersattProjekt(id, k.molnData, k.molnRev);
        }
        lage = konflikter.size ? "konflikt" : "synkad";
        uppdateraUI();
        schemalaggPush(100);
    }

    // ---------- ändringar från andra enheter ----------
    const vantande = new Map();   // ändringar som väntar på att en dialog stängs
    function lyssna() {
        if (lyssnare) lyssnare();
        lyssnare = fb.fs.onSnapshot(projektFraga(), (snap) => {
            if (arAdmin()) { lasMeta(snap.docs); if (kontoOppen()) { ritaSynkkort(); ritaAdmin(); } }
            else uppdateraBeh(snap.docs.map((d) => Object.assign({ id: d.id }, d.data())));
            // molnets version av tavlor man inte ser, så att de följer med orörda vid uppladdning
            snap.docs.forEach((d) => { const x = d.data(); if ((x.rev || 0) >= (moln.rev[d.id] || 0)) uppdateraDolda(d.id, x.data); });
            snap.docChanges().forEach((c) => {
                const id = c.doc.id, d = c.doc.data();
                if (c.type === "removed") {
                    if (!(id in moln.rev)) return;
                    const p = plan4.projekt.find((x) => x.id === id);
                    if (!arAdmin()) {
                        // borttagen ur projektet (eller projektet raderat): åtkomsten är borta
                        vantande.set(id, { borttagen: true, namn: p ? p.projekt : "" });
                        return;
                    }
                    if (p && arAndrad(p)) registreraKonflikt(id, p.projekt, null);
                    else vantande.set(id, { borttagen: true });
                    return;
                }
                if ((d.rev || 0) <= (moln.rev[id] || 0)) return;          // eget eko eller redan inläst
                const p = plan4.projekt.find((x) => x.id === id);
                if (p && arAndrad(p)) registreraKonflikt(id, p.projekt, d);
                else vantande.set(id, { data: d.data, rev: d.rev });
            });
            tillampaVantande();
        }, (e) => { console.warn("Wimo molnlyssnare:", e); lage = "offline"; uppdateraUI(); });
    }
    function tillampaVantande() {
        if (!vantande.size) return;
        if (dialogOppen()) { uppdateraUI(); return; }
        const borta = [];
        for (const [id, v] of vantande) {
            if (v.borttagen) { taBortLokalt(id); if (v.namn) borta.push(v.namn); }
            else ersattProjekt(id, v.data, v.rev);
        }
        vantande.clear();
        status(borta.length ? "Du har inte längre tillgång till " + borta.join(", ") : "Uppdaterat");
        uppdateraUI();
    }
    // en väntande uppdatering tillämpas när dialogen stängs
    const ursStangModal = stangModal;
    stangModal = function () { ursStangModal.apply(this, arguments); setTimeout(tillampaVantande, 0); };

    // ---------- första synken efter inloggning ----------
    async function forstaSynk() {
        lage = "synkar"; uppdateraUI();
        if (arAdmin()) await migreraGamla();
        const [snap, anvSnap] = await Promise.all([fb.fs.getDocs(projektFraga()), fb.fs.getDoc(anvDoc())]);
        if (arAdmin()) lasMeta(snap.docs);
        const dokument = snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
        if (!arAdmin()) uppdateraBeh(dokument); else markeraLasvy();
        dokument.forEach((d) => uppdateraDolda(d.id, d.data));
        const aktivt = anvSnap.exists() ? anvSnap.data().aktivtProjekt : null;
        const agare = moln.uid;

        if (agare === anvandare.uid) {
            // Samma konto som förut på den här datorn: molnet gäller, utom där det finns
            // lokala ändringar som inte hunnit laddas upp.
            for (const d of dokument) {
                const p = plan4.projekt.find((x) => x.id === d.id);
                const kandRev = moln.rev[d.id] || 0;
                if (!p) { if (!(d.id in moln.rev)) ersattProjekt(d.id, d.data, d.rev); continue; }
                if (d.rev === kandRev) continue;                          // lokala ändringar laddas upp nedan
                if (arAndrad(p)) registreraKonflikt(d.id, p.projekt, d);
                else ersattProjekt(d.id, d.data, d.rev);
            }
            const iMolnet = new Set(dokument.map((d) => d.id));
            for (const id of Object.keys(moln.rev)) {
                if (iMolnet.has(id)) continue;
                const p = plan4.projekt.find((x) => x.id === id);
                if (p && arAndrad(p)) registreraKonflikt(id, p.projekt, null);
                else if (p) taBortLokalt(id);
            }
            return klar();
        }
        if (agare && agare !== anvandare.uid) {
            // Datan på datorn tillhör ett annat konto och visas aldrig för den här användaren.
            if (dokument.length) anvandMolnet(dokument, aktivt);
            else nollstallLokalt();
            return klar();
        }
        if (!arAdmin()) {
            // Användare: bara projekten man är medlem i. Projekt som redan fanns på datorn
            // kan inte läggas till (det gör admin).
            const fortsatt = () => { stangModal(); if (dokument.length) anvandMolnet(dokument, aktivt); else nollstallLokalt(); klar(); };
            if (tomtStandardprojekt()) return fortsatt();
            return fraga("Projekten på den här datorn läggs inte till i ditt konto",
                "Du kommer åt de projekt som en admin har gett dig tillgång till. " +
                "Projekten som finns här (" + plan4.projekt.map((p) => p.projekt).join(", ") + ") tas bort från datorn. " +
                "Be en admin skapa projektet i molnet om det behövs.",
                [{ txt: "Fortsätt", primar: true, fn: fortsatt }]);
        }
        if (!dokument.length) {
            // Admin utan projekt i molnet: ladda upp det som finns på den här datorn.
            moln = { uid: anvandare.uid, rev: {}, hash: {} };
            sparaMoln();
            return klar();
        }
        if (tomtStandardprojekt()) { anvandMolnet(dokument, aktivt); return klar(); }

        // Både den här datorn och kontot har projekt sedan tidigare.
        const lokala = plan4.projekt.map((p) => p.projekt).join(", ");
        const iKontot = dokument.map((d) => d.namn || "Projekt").join(", ");
        fraga("Det finns projekt både här och i ditt konto",
            "På den här datorn: " + lokala + ".\nI kontot: " + iKontot + ".",
            [{ txt: "Använd bara kontots projekt", fara: true, vanster: true,
               fn: () => { stangModal(); anvandMolnet(dokument, aktivt); klar(); } },
             { txt: "Slå ihop", primar: true, fn: () => { stangModal(); slaIhop(dokument, aktivt); klar(); } }]);
    }

    function nollstallLokalt() {
        angraForeAvbryt();
        const p = nyttProjekt("Projekt", "Produktion", IDAG);
        rustaProjekt(p, IDAG);
        plan4 = { version: VERSION, aktivtProjekt: p.id, projekt: [p] };
        state = p;
        moln = { uid: anvandare.uid, rev: {}, hash: {} };
        sparaMoln();
        vyOffset = 0; valdKedja = null; VADER = {};
        ursSparaNu();
    }

    // Kontots projekt läses in och de lokala läggs till. Ett lokalt projekt med samma id
    // som ett i kontot behålls som kopia, så att ingenting försvinner.
    function slaIhop(dokument, aktivt) {
        const lokala = plan4.projekt.slice();
        anvandMolnet(dokument, aktivt);
        const ids = new Set(plan4.projekt.map((p) => p.id));
        lokala.forEach((p) => {
            if (ids.has(p.id)) {
                if (projektJson(p) === projektJson(plan4.projekt.find((x) => x.id === p.id))) return;
                p.id = uid();
                p.projekt = p.projekt + " (från den här datorn)";
            }
            plan4.projekt.push(p);
        });
        ursSparaNu();
        rita();
    }

    function klar() {
        synkKlar = true;
        lyssna();
        tillampaVantande();
        startaAnvandarlista();
        lage = konflikter.size ? "konflikt" : "synkad";
        senastSynkad = new Date();
        uppdateraUI();
        kontrolleraTillgang();
        schemalaggPush(50);
    }

    // Projekt som sparades per användare innan projekten blev gemensamma flyttas till
    // projekt/{id} med admin som medlem. Görs av admin, en gång.
    async function migreraGamla() {
        let snap;
        try { snap = await fb.fs.getDocs(gamlaProjekt()); } catch (e) { return; }
        for (const d of snap.docs) {
            const x = d.data(), ref = projektDoc(d.id);
            try {
                const finns = await fb.fs.getDoc(ref);
                if (!finns.exists()) {
                    await fb.fs.setDoc(ref, { namn: x.namn || "Projekt", arkiverad: !!x.arkiverad, data: x.data, rev: x.rev || 1,
                        uppdaterad: fb.fs.serverTimestamp(), enhet: x.enhet || ENHET, medlemmar: [anvandare.uid] });
                }
                await fb.fs.deleteDoc(fb.fs.doc(fb.db, "anvandare", anvandare.uid, "projekt", d.id));
            } catch (e) { console.warn("Wimo flytt av projekt:", e); }
        }
    }

    // Har användaren något att arbeta i? Admin alltid; andra bara med minst ett projekt.
    function harTillgang() { return arAdmin() || Object.keys(moln.rev).length > 0; }
    function kontrolleraTillgang() {
        if (!appStartad || !synkKlar) return;
        if (!harTillgang()) visaVy("vantar");
        else if (["p4-vantar", "p4-laddar"].some((k) => document.body.classList.contains(k))) visaVy("app");
    }

    function fraga(titel, text, knappar, arSynkval) {
        if (arSynkval !== false) {
            lage = "val";        // stängs dialogen utan val kan användaren välja senare via bannern
            uppdateraUI();
        }
        modal(titel, "", '<p class="hjalp" style="white-space:pre-line;margin:0">' + esc(text) + "</p>", knappar);
    }

    // ---------- inloggning ----------
    const FELTEXT = {
        "auth/invalid-credential": "Fel e-post eller lösenord.",
        "auth/invalid-login-credentials": "Fel e-post eller lösenord.",
        "auth/wrong-password": "Fel e-post eller lösenord.",
        "auth/user-not-found": "Det finns inget konto med den e-postadressen.",
        "auth/email-already-in-use": "Det finns redan ett konto med den e-postadressen. Logga in i stället.",
        "auth/weak-password": "Lösenordet måste ha minst 6 tecken.",
        "auth/invalid-email": "E-postadressen ser inte rätt ut.",
        "auth/missing-password": "Skriv ett lösenord.",
        "auth/too-many-requests": "För många försök. Vänta en stund och försök igen.",
        "auth/network-request-failed": "Ingen kontakt med servern. Kontrollera nätverket.",
        "auth/popup-closed-by-user": "Inloggningsfönstret stängdes.",
        "auth/popup-blocked": "Webbläsaren blockerade inloggningsfönstret.",
        "auth/unauthorized-domain": "Den här adressen är inte godkänd i Firebase. Lägg till den under Authentication → Settings → Authorized domains.",
        "auth/operation-not-supported-in-this-environment": "Google-inloggning fungerar bara när sidan öppnas via en webbadress, inte direkt från disken.",
        "auth/operation-not-allowed": "Inloggningssättet är inte aktiverat i Firebase-konsolen.",
        "auth/requires-recent-login": "Av säkerhetsskäl behöver du logga in igen innan du gör det här.",
        "auth/user-mismatch": "Du bekräftade med ett annat konto än det du är inloggad med.",
    };
    const feltext = (e) => FELTEXT[e && e.code] || "Något gick fel: " + ((e && (e.code || e.message)) || "okänt fel");

    // ---------- inloggningssidan ----------
    // Wimo kräver konto. Utan inloggning visas bara inloggningssidan (#p4Inloggning).
    function visaVy(vy, text) {
        document.body.classList.toggle("p4-laddar", vy === "laddar");
        document.body.classList.toggle("p4-utloggad", vy === "inloggning");
        document.body.classList.toggle("p4-vantar", vy === "vantar");
        if (vy === "vantar") ritaVantesida();
        if (vy === "laddar") $("p4LaddningText").textContent = text || "Startar Wimo…";
        if (vy === "inloggning") { visaFel(text || ""); setTimeout(() => $("kkEpost").focus(), 0); }
        if (vy === "app") rita();
    }

    let skapaLage = false;
    function visaFel(t, gron) {
        const f = $("kkFel");
        f.textContent = t;
        f.className = "notis " + (gron ? "gron" : "rod") + (t ? "" : " dold");
    }
    function visaFormular() {
        document.querySelectorAll(".p4-konto-flikar button").forEach((b) => {
            const vald = (b.dataset.k === "skapa") === skapaLage;
            b.classList.toggle("vald", vald);
            b.setAttribute("aria-selected", vald ? "true" : "false");
        });
        $("kkSkicka").textContent = skapaLage ? "Skapa konto" : "Logga in";
        $("kkRubrik").textContent = skapaLage ? "Skapa ditt konto" : "Välkommen tillbaka";
        $("kkHjalp").textContent = skapaLage
            ? "Har du redan projekt i den här webbläsaren laddas de upp till ditt nya konto."
            : "Logga in för att öppna dina projekt.";
        $("kkLosen").setAttribute("autocomplete", skapaLage ? "new-password" : "current-password");
        $("kkLosen2Falt").classList.toggle("dold", !skapaLage);
        $("kkGlomt").classList.toggle("dold", skapaLage);
        visaFel("");
    }
    async function skicka(e) {
        if (e) e.preventDefault();
        const epost = $("kkEpost").value.trim(), losen = $("kkLosen").value;
        if (!epost) return visaFel("Skriv din e-postadress.");
        if (!losen) return visaFel("Skriv ett lösenord.");
        if (skapaLage && losen !== $("kkLosen2").value) return visaFel("Lösenorden är inte likadana.");
        visaFel("");
        const knapp = $("kkSkicka");
        knapp.disabled = true;
        try {
            await laddaFirebase();
            if (skapaLage) await fb.auth.createUserWithEmailAndPassword(fb.authInst, epost, losen);
            else await fb.auth.signInWithEmailAndPassword(fb.authInst, epost, losen);
            $("kkLosen").value = "";
            $("kkLosen2").value = "";
        } catch (err) { visaFel(feltext(err)); }
        knapp.disabled = false;
    }
    function kopplaFormular() {
        if (!$("p4Inloggning")) return;
        document.querySelectorAll(".p4-konto-flikar button").forEach((b) =>
            b.addEventListener("click", () => { skapaLage = b.dataset.k === "skapa"; visaFormular(); }));
        $("kkFormular").addEventListener("submit", skicka);
        $("kkGlomt").addEventListener("click", async () => {
            const epost = $("kkEpost").value.trim();
            if (!epost) return visaFel("Skriv din e-postadress först, så skickar vi en länk.");
            try {
                await laddaFirebase();
                await fb.auth.sendPasswordResetEmail(fb.authInst, epost);
                visaFel("Vi har skickat en länk för nytt lösenord till " + epost + ".", true);
            } catch (err) { visaFel(feltext(err)); }
        });
        // Knappen "Fortsätt med Google" är borttagen från inloggningen; koden finns kvar om den läggs tillbaka.
        if ($("kkGoogle")) $("kkGoogle").addEventListener("click", async () => {
            visaFel("");
            try {
                await laddaFirebase();
                await fb.auth.signInWithPopup(fb.authInst, new fb.auth.GoogleAuthProvider());
            } catch (err) { visaFel(feltext(err)); }
        });
        visaFormular();
    }

    // ---------- kontosidan ----------
    // Öppnas från kontoikonen i headern och "Mitt konto" i sidomenyn. Den ligger i
    // huvudytan precis som Projektöversikten och Att göra.
    const kontoOppen = () => document.body.classList.contains("p4-kontovy");

    function oppnaKontosida() {
        try { if (startOppen()) stangStart(); } catch (e) { }
        try { if (dashOppen()) stangDash(); } catch (e) { }
        document.body.classList.add("p4-kontovy");
        ritaKontosida();
        window.scrollTo({ top: 0 });
        if (window.p4MarkeraNav) window.p4MarkeraNav();
    }
    function stangKontosida() {
        document.body.classList.remove("p4-kontovy");
        if (window.p4MarkeraNav) window.p4MarkeraNav();
        rita();
    }
    window.p4OppnaKonto = oppnaKontosida;
    // Får användaren ändra i den här tavlan? (Används av Gantt-schemat, som kan lägga till i andra projekt än det öppna.)
    window.p4KanRedigera = (pid, tid) => !anvandare || ["admin", "red"].includes(tavlaRatt(pid, tid));
    // Är jag med i projektet? (Gantt-schemat visar bara de egna projekten, även för huvudadmin.)
    window.p4ArMed = (pid) => {
        if (!anvandare || arAdmin()) return true;
        const m = projektMeta.get(pid), u = anvandare.uid;
        return !m || m.medlemmar.includes(u) || m.lasare.includes(u) || m.projektAdmin.includes(u);
    };
    // När projekten ändras (nytt projekt, synk från annan enhet) hålls siffror och lista aktuella.
    const ursRitaKonto = rita;
    rita = function () { markeraLasvy(); const r = ursRitaKonto.apply(this, arguments); if (kontoOppen()) ritaSynkkort(); return r; };
    // Översikten och Att göra stänger kontosidan, oavsett varifrån de öppnas.
    const ursOppnaDash = oppnaDash, ursOppnaStart = oppnaStart;
    oppnaDash = function () { document.body.classList.remove("p4-kontovy"); return ursOppnaDash.apply(this, arguments); };
    oppnaStart = function () { document.body.classList.remove("p4-kontovy"); return ursOppnaStart.apply(this, arguments); };

    const harLosenord = () => !!(anvandare && anvandare.providerData && anvandare.providerData.some((p) => p.providerId === "password"));
    const harGoogle = () => !!(anvandare && anvandare.providerData && anvandare.providerData.some((p) => p.providerId === "google.com"));
    const datumText = (t) => { const d = t ? new Date(t) : null; return d && !isNaN(d) ? d.toLocaleDateString("sv-SE", { day: "numeric", month: "long", year: "numeric" }) : "—"; };

    // Siffror för översikten: räknas fram ur projekten, ingenting lagras.
    function kontoSiffror() {
        const ut = { projekt: 0, arkiverade: 0, tavlor: 0, poster: 0, hinder: 0, attGora: 0, personer: 0, foretag: 0 };
        plan4.projekt.forEach((p) => {
            if (p.arkiverad) ut.arkiverade++; else ut.projekt++;
            ut.tavlor += p.tavlor.length;
            p.tavlor.forEach((t) => {
                ut.poster += t.kort.length;
                ut.hinder += t.hinder.filter((h) => h.status !== "lost").length;
            });
            ut.attGora += fAktiviteter(p).filter((a) => !fKlar(a)).length;
            ut.personer += p.resurser.personer.length;
            ut.foretag += p.foretag.length;
        });
        return ut;
    }
    function senastAndrad(p) {
        let senast = "";
        p.tavlor.forEach((t) => (t.historik || []).forEach((h) => { if (h.tid > senast) senast = h.tid; }));
        return senast;
    }

    function ritaKontosida() {
        const sida = $("p4KontoSida");
        if (!sida) return;
        try {
            sida.innerHTML = anvandare ? kontosidaHtml() : utanKontoHtml();
            ritaSynkkort();
            ritaAdmin();
        } catch (e) {
            console.error("Wimo kontosidan:", e);
            sida.innerHTML = '<div class="p4-ks-kort"><h2>Kontosidan kunde inte visas</h2>' +
                '<p class="hjalp">Ladda om sidan (Ctrl + F5). Felet: ' + esc(e && e.message || e) + "</p></div>";
        }
    }

    function utanKontoHtml() {
        return '<div class="p4-ks-topp"><div class="p4-ks-avatar">?</div><div class="p4-ks-namn">' +
            '<div class="p4-eyebrow"><span class="p4-pop"></span>Mitt konto</div><h1>Inte inloggad</h1>' +
            "<p>" + esc(aktiverat ? "Inloggningen är inte klar ännu. Kontrollera nätverket och ladda om sidan."
                : "Konton är inte aktiverade i den här installationen.") + "</p></div>" +
            '<button type="button" class="navknapp" data-ks="tillbaka">← Till tavlan</button></div>';
    }

    function kontosidaHtml() {
        const namn = anvandare.displayName || "";
        const satt = [harLosenord() ? "e-post och lösenord" : "", harGoogle() ? "Google" : ""].filter(Boolean).join(" och ") || "e-post";
        return '<div class="p4-ks-topp">' +
              '<div class="p4-ks-avatar">' + esc(initialer()) + "</div>" +
              '<div class="p4-ks-namn">' +
                '<div class="p4-eyebrow"><span class="p4-pop"></span>Mitt konto</div>' +
                "<h1>" + esc(namn || anvandare.email || "Mitt konto") + "</h1>" +
                "<p>" + esc(anvandare.email || "") + " · inloggad med " + esc(satt) +
                  " · konto skapat " + esc(datumText(anvandare.metadata && anvandare.metadata.creationTime)) +
                  (arAdmin() ? ' · <span class="p4-ks-tagg admin">Huvudadmin</span>' : "") + "</p>" +
              "</div>" +
              '<button type="button" class="navknapp" data-ks="tillbaka">← Till tavlan</button>' +
            "</div>" +

            '<div class="p4-ks-siffror" id="ksSiffror"></div>' +

            '<section class="p4-ks-kort p4-ks-projekt" id="ksSynk"></section>' +
            '<section class="p4-ks-kort p4-ks-projekt dold" id="ksAdmin"></section>' +

            '<div class="p4-ks-rutnat">' +

              '<section class="p4-ks-kort">' +
                "<h2>Profil</h2>" +
                '<p class="hjalp">Namnet visas i kontoikonen. Det syns inte för någon annan.</p>' +
                '<div class="falt"><label for="ksNamn">Namn</label><input class="f" id="ksNamn" value="' + esc(namn) + '" placeholder="Förnamn Efternamn" autocomplete="name"></div>' +
                '<div class="falt"><label>E-post</label><input class="f" value="' + esc(anvandare.email || "") + '" disabled></div>' +
                '<div class="notis dold" id="ksNamnSvar"></div>' +
                '<div class="p4-ks-knappar"><button type="button" class="mknapp primar" data-ks="namn">Spara namn</button></div>' +
              "</section>" +

              '<section class="p4-ks-kort">' +
                "<h2>Lösenord</h2>" +
                (harLosenord()
                  ? '<div class="falt"><label for="ksLosenNu">Nuvarande lösenord</label><input class="f" id="ksLosenNu" type="password" autocomplete="current-password"></div>' +
                    '<div class="falt"><label for="ksLosenNytt">Nytt lösenord</label><input class="f" id="ksLosenNytt" type="password" autocomplete="new-password"></div>' +
                    '<div class="falt"><label for="ksLosenNytt2">Upprepa nytt lösenord</label><input class="f" id="ksLosenNytt2" type="password" autocomplete="new-password"></div>' +
                    '<div class="notis dold" id="ksLosenSvar"></div>' +
                    '<div class="p4-ks-knappar"><button type="button" class="mknapp primar" data-ks="losen">Byt lösenord</button>' +
                    '<button type="button" class="p4-konto-lank" data-ks="aterstall">Skicka en länk i stället</button></div>'
                  : '<p class="hjalp">Du loggar in med Google, så lösenordet hanteras av ditt Google-konto.</p>' +
                    '<div class="p4-ks-knappar"><a class="mknapp" href="https://myaccount.google.com/security" target="_blank" rel="noopener">Öppna Google-kontot</a></div>') +
              "</section>" +

              '<section class="p4-ks-kort">' +
                "<h2>Den här datorn</h2>" +
                '<ul class="detalj">' +
                  '<li><span class="et">Lagring</span><span>' + esc(lagringslage === "lokal" ? "Lokal kopia i webbläsaren + molnet" : "Bara molnet") + "</span></li>" +
                  '<li><span class="et">Senast synkad</span><span>' + esc(senastSynkad ? senastSynkad.toLocaleString("sv-SE") : "—") + "</span></li>" +
                  '<li><span class="et">Enhets-id</span><span>' + esc(ENHET) + "</span></li>" +
                "</ul>" +
                '<p class="hjalp">Ändringar sparas först här och laddas upp till molnet inom någon sekund. Utan nät sparas de här tills nätet är tillbaka.</p>' +
                '<div class="p4-ks-knappar"><button type="button" class="mknapp" data-ks="synka">Synka nu</button></div>' +
              "</section>" +

              '<section class="p4-ks-kort">' +
                "<h2>Logga ut</h2>" +
                '<p class="hjalp">Projekten tas bort från den här datorn när du loggar ut, men finns kvar i molnet. ' +
                  "Logga alltid ut på en delad dator, till exempel i bodan.</p>" +
                '<div class="p4-ks-knappar"><button type="button" class="mknapp" data-ks="loggaut">Logga ut</button></div>' +
              "</section>" +

              '<section class="p4-ks-kort p4-ks-fara">' +
                "<h2>Radera konto</h2>" +
                '<p class="hjalp">Ditt konto tas bort för gott. Projekten du är med i finns kvar för de andra medlemmarna. Det går inte att ångra.</p>' +
                '<div class="p4-ks-knappar"><button type="button" class="mknapp fara" data-ks="radera">Radera mitt konto…</button></div>' +
              "</section>" +
            "</div>";
    }

    function medlemsText(id) {
        const m = projektMeta.get(id);
        if (!m) return '<span class="p4-ks-dampad">Sparas…</span>';
        const andra = m.medlemmar.filter((u) => { const a = allaAnvandare.find((x) => x.uid === u); return !(a && a.roll === "admin"); });
        return andra.length ? andra.length + (andra.length === 1 ? " person" : " personer") : '<span class="p4-ks-dampad">Bara admin</span>';
    }

    function ritaSiffror() {
        const ruta = $("ksSiffror");
        if (!ruta) return;
        const s = kontoSiffror();
        const siffra = (tal, rubrik, under) => '<div class="p4-ks-siffra"><b>' + tal + "</b><span>" + rubrik + "</span>" +
            (under ? "<small>" + under + "</small>" : "") + "</div>";
        ruta.innerHTML =
            siffra(s.projekt, s.projekt === 1 ? "aktivt projekt" : "aktiva projekt", s.arkiverade ? s.arkiverade + " arkiverade" : "") +
            siffra(s.tavlor, s.tavlor === 1 ? "tavla" : "tavlor") +
            siffra(s.poster, "poster på tavlorna") +
            siffra(s.hinder, s.hinder === 1 ? "öppet hinder" : "öppna hinder") +
            siffra(s.attGora, "öppna i Att göra") +
            siffra(s.personer, s.personer === 1 ? "person i resursbanken" : "personer i resursbanken", s.foretag ? s.foretag + " företag" : "");
    }

    function ritaSynkkort() {
        ritaSiffror();
        const kort = $("ksSynk");
        if (!kort) return;
        const rader = plan4.projekt.map((p) => {
            const k = konflikter.get(p.id);
            const poster = p.tavlor.reduce((n, t) => n + t.kort.length, 0);
            const andrad = senastAndrad(p);
            const lageTxt = k ? (k.borttagen ? "Borttaget på en annan enhet" : "Ändrat på två ställen")
                : !synkKlar ? "Väntar" : !kanSkriva(p) ? "Läsbehörig" : arAndrad(p) ? "Sparas…" : "Sparat";
            const klass = k ? "konflikt" : arAndrad(p) || !synkKlar ? "vantar" : "ok";
            return "<tr><td><b>" + esc(p.projekt) + "</b>" +
                (p.id === state.id ? ' <span class="p4-ks-tagg oppet">Öppet</span>' : "") +
                (p.arkiverad ? ' <span class="p4-ks-tagg">Arkiverat</span>' : "") +
                rollTagg(p.id) + "</td>" +
                "<td>" + p.tavlor.length + "</td><td>" + poster + "</td>" +
                (harNagonAdminroll() ? "<td>" + (arProjektAdmin(p.id) ? medlemsText(p.id) : "") + "</td>" : "") +
                "<td>" + esc(andrad ? new Date(andrad).toLocaleDateString("sv-SE") : "—") + "</td>" +
                '<td><span class="p4-ks-status ' + klass + '">' + esc(lageTxt) + "</span>" +
                (k ? '<span class="p4-konto-val">' +
                    '<button type="button" class="mknapp" data-hamta="' + esc(p.id) + '">' + (k.borttagen ? "Ta bort här" : "Hämta deras") + "</button>" +
                    '<button type="button" class="mknapp primar" data-behall="' + esc(p.id) + '">Behåll min</button></span>' : "") +
                "</td>" +
                '<td class="p4-ks-hoger"><span class="p4-ks-atgarder">' +
                  (projektMeta.has(p.id) && (arProjektAdmin(p.id) || harTavlaAdmin(p.id)) ? '<button type="button" class="mknapp" data-medlemmar="' + esc(p.id) + '">' + (arProjektAdmin(p.id) ? "Medlemmar…" : "Behörigheter…") + "</button>" : "") +
                  (p.arkiverad ? "" : '<button type="button" class="mknapp" data-oppna="' + esc(p.id) + '">Öppna</button>') + "</span></td></tr>";
        }).join("");
        kort.innerHTML =
            '<div class="p4-ks-rubrikrad"><h2>' + (arAdmin() ? "Alla projekt" : "Dina projekt") + "</h2>" +
              '<span class="p4-ks-status ' + (lage === "synkad" ? "ok" : lage === "konflikt" || lage === "fel" ? "konflikt" : "vantar") + '">' +
              esc(lagesText()) + "</span>" +
              '<span class="p4-ks-knappar p4-ks-hoger-knappar">' + (kanSkapaProjekt() ? '<button type="button" class="mknapp" data-ks="nyttprojekt">+ Nytt projekt</button>' : "") +
              '<button type="button" class="mknapp" data-ks="synka">Synka nu</button></span></div>' +
            (konflikter.size ? '<div class="notis">Välj vilken version som ska gälla för projekten som ändrats på två ställen.</div>' : "") +
            '<div class="p4-ks-tabellram"><table class="lista p4-ks-tabell"><thead><tr><th>Projekt</th><th>Tavlor</th><th>Poster</th>' + (harNagonAdminroll() ? "<th>Medlemmar</th>" : "") + '<th>Senast ändrat</th><th>Molnet</th><th></th></tr></thead>' +
            "<tbody>" + rader + "</tbody></table></div>";
    }

    function svar(id, text, gron) {
        const el = $(id);
        if (!el) return;
        el.textContent = text;
        el.className = "notis " + (gron ? "gron" : "rod") + (text ? "" : " dold");
    }

    async function sparaNamn() {
        const namn = $("ksNamn").value.trim();
        try {
            await fb.auth.updateProfile(anvandare, { displayName: namn || null });
            svar("ksNamnSvar", "Namnet är sparat.", true);
            uppdateraUI();
            document.querySelector(".p4-ks-avatar").textContent = initialer();
            document.querySelector(".p4-ks-namn h1").textContent = namn || anvandare.email || "Mitt konto";
        } catch (e) { svar("ksNamnSvar", feltext(e)); }
    }

    async function bytLosenord() {
        const nu = $("ksLosenNu").value, nytt = $("ksLosenNytt").value;
        if (!nu) return svar("ksLosenSvar", "Skriv ditt nuvarande lösenord.");
        if (nytt.length < 6) return svar("ksLosenSvar", "Det nya lösenordet måste ha minst 6 tecken.");
        if (nytt !== $("ksLosenNytt2").value) return svar("ksLosenSvar", "De nya lösenorden är inte likadana.");
        try {
            await fb.auth.reauthenticateWithCredential(anvandare, fb.auth.EmailAuthProvider.credential(anvandare.email, nu));
            await fb.auth.updatePassword(anvandare, nytt);
            ["ksLosenNu", "ksLosenNytt", "ksLosenNytt2"].forEach((id) => { $(id).value = ""; });
            svar("ksLosenSvar", "Lösenordet är bytt.", true);
        } catch (e) { svar("ksLosenSvar", feltext(e)); }
    }

    async function skickaAterstallning() {
        try {
            await fb.auth.sendPasswordResetEmail(fb.authInst, anvandare.email);
            svar("ksLosenSvar", "Vi har skickat en länk till " + anvandare.email + ".", true);
        } catch (e) { svar("ksLosenSvar", feltext(e)); }
    }

    function raderaKontoDialog() {
        const kropp =
            '<p class="fraga">Allt i kontot tas bort för gott</p>' +
            '<p class="hjalp">Kontot raderas och projekten tas bort från den här datorn. Projekten finns kvar i molnet för ' +
              "de andra medlemmarna.</p>" +
            (harLosenord()
              ? '<div class="falt"><label for="ksRaderaLosen">Bekräfta med ditt lösenord</label><input class="f" id="ksRaderaLosen" type="password" autocomplete="current-password"></div>'
              : '<p class="hjalp">Du får bekräfta med ditt Google-konto.</p>') +
            '<label class="p4-ks-bekrafta"><input type="checkbox" id="ksRaderaOk"> Jag förstår att det inte går att ångra</label>' +
            '<div class="notis rod dold" id="ksRaderaSvar"></div>';
        modal("Radera konto", anvandare.email || "", kropp, [
            { txt: "Avbryt", fn: stangModal },
            { txt: "Radera kontot", fara: true, fn: raderaKonto },
        ]);
    }

    async function raderaKonto() {
        if (!$("ksRaderaOk").checked) return svar("ksRaderaSvar", "Kryssa i rutan för att bekräfta.");
        try {
            if (harLosenord()) {
                const losen = $("ksRaderaLosen").value;
                if (!losen) return svar("ksRaderaSvar", "Skriv ditt lösenord.");
                await fb.auth.reauthenticateWithCredential(anvandare, fb.auth.EmailAuthProvider.credential(anvandare.email, losen));
            } else {
                await fb.auth.reauthenticateWithPopup(anvandare, new fb.auth.GoogleAuthProvider());
            }
            synkKlar = false;
            clearTimeout(pushTimer);
            if (lyssnare) { lyssnare(); lyssnare = null; }
            if (anvLyssnare) { anvLyssnare(); anvLyssnare = null; }
            stoppaAdmin();
            sparaNu = async () => true;
            clearTimeout(sparaTimer);
            try {
                const gamla = await fb.fs.getDocs(gamlaProjekt());
                for (const d of gamla.docs) await fb.fs.deleteDoc(fb.fs.doc(fb.db, "anvandare", anvandare.uid, "projekt", d.id));
            } catch (e) { }
            await fb.fs.deleteDoc(anvDoc());
            await fb.auth.deleteUser(anvandare);
            try { localStorage.removeItem(NYCKEL); localStorage.removeItem(MOLNNYCKEL); } catch (e) { }
            location.reload();
        } catch (e) { svar("ksRaderaSvar", feltext(e)); }
    }

    document.addEventListener("click", (e) => {
        const b = e.target.closest("#p4KontoSida [data-ks]");
        if (b) {
            const vad = b.dataset.ks;
            if (vad === "tillbaka") stangKontosida();
            else if (vad === "synka") { lage = "synkar"; uppdateraUI(); schemalaggPush(0); }
            else if (vad === "namn") sparaNamn();
            else if (vad === "losen") bytLosenord();
            else if (vad === "aterstall") skickaAterstallning();
            else if (vad === "loggaut") loggaUt(false);
            else if (vad === "radera") raderaKontoDialog();
            else if (vad === "nyttprojekt") nyttProjektDialog();
        }
        const o = e.target.closest("#p4KontoSida [data-oppna]");
        if (o) { stangKontosida(); valjProjekt(o.dataset.oppna); }
        const h = e.target.closest("#p4KontoSida [data-hamta], #p4KontoSida [data-behall]");
        if (h) losKonflikt(h.dataset.hamta || h.dataset.behall, !!h.dataset.behall);
    });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && kontoOppen() && !dialogOppen()) stangKontosida();
        if (e.key === "Enter" && e.target && e.target.id === "ksNamn") sparaNamn();
    });

    // Utloggning laddar först upp det som återstår och tar sedan bort projektdatan från
    // datorn. Finns det ändringar som inte kommit upp i molnet frågar vi först.
    async function loggaUt(trotsOsparat) {
        stangModal();
        if (!trotsOsparat) {
            try { if (synkKlar && !konflikter.size) { clearTimeout(pushTimer); await push(); } } catch (e) { }
            const osparade = plan4.projekt.filter((p) => arAndrad(p) || konflikter.has(p.id));
            if (osparade.length) {
                return fraga("Det finns ändringar som inte är sparade i molnet",
                    osparade.map((p) => p.projekt).join(", ") + "\nLoggar du ut nu försvinner de ändringarna från den här datorn. " +
                    "Kontrollera nätverket och försök igen.",
                    [{ txt: "Logga ut ändå", fara: true, vanster: true, fn: () => loggaUt(true) },
                     { txt: "Avbryt", primar: true, fn: stangModal }], false);
            }
        }
        if (lyssnare) { lyssnare(); lyssnare = null; }
        if (anvLyssnare) { anvLyssnare(); anvLyssnare = null; }
        stoppaAdmin();
        clearTimeout(pushTimer);
        synkKlar = false;
        sparaNu = async () => true;          // ingen ny lokal skrivning mellan utloggning och omladdning
        clearTimeout(sparaTimer);
        try { localStorage.removeItem(NYCKEL); localStorage.removeItem(MOLNNYCKEL); localStorage.removeItem(BEHNYCKEL); localStorage.removeItem(LASNYCKEL); } catch (e) { }
        try { await fb.auth.signOut(fb.authInst); } catch (e) { }
        location.reload();
    }

    // ---------- gränssnitt ----------
    function lagesText() {
        const tid = senastSynkad ? senastSynkad.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" }) : "";
        return {
            av: "Konto är inte aktiverat",
            utloggad: "Inte inloggad — sparas bara på den här datorn",
            synkar: "Synkar…",
            synkad: "Sparat i molnet" + (tid ? " " + tid : ""),
            offline: "Offline — synkas när nätet är tillbaka",
            konflikt: konflikter.size + (konflikter.size === 1 ? " projekt" : " projekt") + " har ändrats på två ställen",
            fel: "Kunde inte synka — försöker igen",
            val: "Välj hur dina projekt ska synkas",
        }[lage];
    }

    function initialer() {
        const n = (anvandare && (anvandare.displayName || anvandare.email)) || "";
        const delar = n.split("@")[0].split(/[.\s_-]+/).filter(Boolean);
        return ((delar[0] || "?")[0] + (delar[1] ? delar[1][0] : "")).toUpperCase();
    }

    function uppdateraUI() {
        const knapp = $("p4Konto");
        if (knapp) {
            knapp.classList.toggle("inloggad", !!anvandare);
            knapp.classList.toggle("varn", ["konflikt", "fel", "offline", "val"].includes(lage));
            knapp.querySelector(".p4-konto-avatar").textContent = anvandare ? initialer() : "";
            knapp.querySelector(".p4-konto-text").textContent = anvandare ? "Konto" : "Logga in";
            knapp.title = anvandare ? (anvandare.email || "") + " · " + lagesText() : "Logga in för att spara i molnet";
        }
        window.p4Moln = { aktiv: !!(anvandare && synkKlar), lage: lage, text: lagesText(), vantar: vantande.size };
        const bannerTxt = lage === "val" ? lagesText() : konflikter.size ? lagesText() : vantande.size ? "Det finns uppdateringar från en annan enhet" : "";
        const banner = $("p4MolnBanner");
        if (banner) {
            banner.classList.toggle("dold", !bannerTxt);
            $("p4MolnBannerText").textContent = bannerTxt;
        }
        if (typeof window.p4UppdateraBackup === "function") window.p4UppdateraBackup();
        if (kontoOppen()) ritaSynkkort();
        const vantar = arAdmin() ? vantandeAnvandare().length : 0;
        const badge = $("p4KontoBadge");
        if (badge) { badge.textContent = String(vantar); badge.classList.toggle("dold", !vantar); badge.title = vantar + " konton väntar på godkännande"; }
        if (knapp) knapp.classList.toggle("admin-vantar", !!vantar);
    }

    // ---------- koppling till appen ----------
    // I ett läsbehörigt projekt sparas ingenting: ändringen rullas tillbaka i stället.
    const ursSpara = spara;
    spara = function () {
        if (anvandare && !arAdmin() && lasAndrat()) {
            if (!aterstallTimer) aterstallTimer = setTimeout(aterstallLas, 0);
            return;
        }
        return ursSpara.apply(this, arguments);
    };
    // Knappar och handgrepp som ändrar tavlan stängs av för läsbehöriga.
    const LAS_SPARR = "#snabbPostKnapp, #planeraKnapp, #rullaFram, #nyTavlaKnapp, #hLagg, .rutnat .plus, .flik.plus, " +
        ".kort .bock, .h-los, .kedjebock, [data-klick='planeraKnapp'], [data-klick='snabbPostKnapp']";
    const lasLage = () => document.body.classList.contains("p4-las");
    document.addEventListener("click", (e) => {
        if (!lasLage() || !e.target.closest || !e.target.closest(LAS_SPARR)) return;
        e.preventDefault(); e.stopImmediatePropagation();
        status("Du har bara läsbehörighet i " + (state.projekt || "projektet"));
    }, true);
    document.addEventListener("dragstart", (e) => { if (lasLage()) e.preventDefault(); }, true);
    document.addEventListener("dblclick", (e) => {
        if (lasLage() && e.target.closest && e.target.closest(".kort")) e.stopImmediatePropagation();
    }, true);

    // Varje lokal sparning följs av en uppladdning (med kort fördröjning).
    const ursSparaNu = sparaNu;
    sparaNu = async function () {
        const r = await ursSparaNu.apply(this, arguments);
        schemalaggPush();
        return r;
    };
    // Statusraden och footern säger var datan finns.
    const ursLagringstext = lagringstext;
    lagringstext = function () { return anvandare && synkKlar ? " · i molnet" : ursLagringstext.apply(this, arguments); };
    window.addEventListener("online", () => { if (anvandare) { lage = "synkar"; uppdateraUI(); schemalaggPush(0); } });

    document.addEventListener("click", (e) => {
        if (e.target.closest("#p4Konto")) { if (kontoOppen()) stangKontosida(); else oppnaKontosida(); }
        if (e.target.closest("#p4MolnBannerKnapp")) {
            if (lage === "val") forstaSynk();
            else if (konflikter.size) oppnaKontosida();
            else tillampaVantande();
        }
    });

    // ---------- roller och godkännande ----------
    // Varje konto har ett användardokument: anvandare/{uid} med roll ("user" | "admin")
    // och status ("vantar" | "godkand" | "nekad"). Bara godkända konton kommer åt Wimo.
    // Ett nytt konto skapas alltid som user med status vantar. Säkerhetsreglerna i
    // firestore.rules hindrar att någon godkänner sig själv eller gör sig till admin.
    const BEHNYCKEL = "plan4_behorighet";     // senast kända status, så att appen kan starta offline
    let behorighet = { roll: "user", status: "vantar", skapa: false };
    let appStartad = false;
    let anvLyssnare = null;      // användarens eget dokument
    let adminLyssnare = null;    // alla användare (bara för admin)
    let allaAnvandare = [];
    let adminFilter = null;      // null = Väntar om någon väntar, annars Alla
    const arAdmin = () => behorighet.roll === "admin" && behorighet.status === "godkand";
    // Huvudadmin, eller en godkänd användare som fått "Får skapa projekt" av huvudadmin.
    const kanSkapaProjekt = () => arAdmin() || (behorighet.status === "godkand" && behorighet.skapa === true);
    const tidAv = (v) => v && typeof v.toDate === "function" ? v.toDate()
        : typeof v === "string" && !isNaN(Date.parse(v)) ? new Date(v) : null;

    async function sakerstallAnvandardok() {
        const ref = anvDoc(), snap = await fb.fs.getDoc(ref);
        if (!snap.exists()) {
            await fb.fs.setDoc(ref, { epost: anvandare.email || "", namn: anvandare.displayName || "",
                roll: "user", status: "vantar", skapad: fb.fs.serverTimestamp() });
        } else if (!snap.data().status) {
            // konto från tiden före godkännandet: läggs i kön
            await fb.fs.setDoc(ref, { roll: "user", status: "vantar" }, { merge: true });
        }
    }

    function hanteraBehorighet(d) {
        const forraRoll = behorighet.roll;
        behorighet = { roll: (d && d.roll) || "user", status: (d && d.status) || "vantar", skapa: !!(d && d.skapa === true) };
        skrivJson(BEHNYCKEL, { uid: anvandare.uid, roll: behorighet.roll, status: behorighet.status, skapa: behorighet.skapa });
        if (behorighet.status === "godkand") {
            // Ny roll ger andra projekt (admin ser alla): synka om från början.
            if (appStartad && forraRoll !== behorighet.roll) stoppaApp();
            if (!appStartad) startaApp();
        } else {
            stoppaApp();
            visaVy("vantar");
        }
        if (arAdmin()) startaAdmin(); else { stoppaAdmin(); startaAnvandarlista(); }
        uppdateraUI();
    }

    function startaApp() {
        appStartad = true;
        // Samma konto som senast: visa den lokala kopian direkt och synka i bakgrunden.
        // Annars visas ingenting förrän kontots projekt är hämtade.
        const kand = moln.uid === anvandare.uid;
        visaVy(kand ? "app" : "laddar", "Hämtar dina projekt…");
        forstaSynk().then(efterForstaSynk).catch((e) => {
            console.warn("Wimo första synk:", e);
            lage = "offline"; uppdateraUI();
            if (!kand) visaVy("laddar", "Kunde inte hämta dina projekt. Kontrollera nätverket — försöker igen…");
            forsokIgen();
        });
    }
    // Väntar ett val i en dialog visas appen så att dialogen syns; annars avgör tillgången.
    function efterForstaSynk() {
        if (!synkKlar) visaVy("app");
        else kontrolleraTillgang();
    }
    function stoppaApp() {
        appStartad = false;
        synkKlar = false;
        clearTimeout(pushTimer);
        if (lyssnare) { lyssnare(); lyssnare = null; }
        document.body.classList.remove("p4-kontovy");
    }
    function forsokIgen() {
        setTimeout(() => {
            if (!anvandare || synkKlar || !appStartad) return;
            forstaSynk().then(efterForstaSynk).catch(forsokIgen);
        }, 15000);
    }

    // Väntesidan: visas för konton som inte är godkända (än).
    function ritaVantesida() {
        const nekad = behorighet.status === "nekad";
        const ingaProjekt = behorighet.status === "godkand";
        $("p4Vantar").classList.toggle("inga", ingaProjekt);
        if (ingaProjekt) {
            $("p4VantarRubrik").textContent = "Du har inte tillgång till något projekt än";
            $("p4VantarText").textContent = "Ditt konto är godkänt, men en administratör behöver lägga till dig i ett projekt. " +
                "Sidan öppnas av sig själv så fort det är klart — du behöver inte ladda om.";
            $("p4Vantar").classList.remove("nekad");
            return;
        }
        $("p4VantarRubrik").textContent = nekad ? "Ditt konto har inte godkänts" : "Ditt konto väntar på godkännande";
        $("p4VantarText").textContent = nekad
            ? "En administratör har inte gett " + (anvandare.email || "kontot") + " tillgång till Wimo. Kontakta administratören om du tror att det är fel."
            : "En administratör behöver godkänna " + (anvandare.email || "ditt konto") + " innan du kommer åt Wimo. Sidan öppnas av sig själv så fort det är klart — du behöver inte ladda om.";
        $("p4Vantar").classList.toggle("nekad", nekad);
    }

    // ---------- admin: alla användare ----------
    function startaAdmin() {
        if (adminLyssnare) return;
        adminLyssnare = fb.fs.onSnapshot(fb.fs.collection(fb.db, "anvandare"), (snap) => {
            allaAnvandare = snap.docs.map((d) => Object.assign({ uid: d.id }, d.data()));
            uppdateraUI();
            if (kontoOppen()) ritaAdmin();
        }, (e) => console.warn("Wimo användarlista:", e));
    }
    // Användarlistan behövs för huvudadmin och för den som är admin för ett projekt eller en tavla.
    function startaAnvandarlista() {
        if (!anvandare || !synkKlar) return;
        if (arAdmin() || harNagonAdminroll() || [...projektMeta.keys()].some((id) => harTavlaAdmin(id))) startaAdmin();
    }
    function stoppaAdmin() {
        if (adminLyssnare) { adminLyssnare(); adminLyssnare = null; }
        allaAnvandare = [];
    }
    const vantandeAnvandare = () => allaAnvandare.filter((a) => (a.status || "vantar") === "vantar");

    const STATUSNAMN = { vantar: "Väntar", godkand: "Godkänd", nekad: "Nekad" };
    function ritaAdmin() {
        const kort = $("ksAdmin");
        if (!kort) return;
        if (!arAdmin()) { kort.classList.add("dold"); return; }
        kort.classList.remove("dold");
        const vantar = vantandeAnvandare();
        const filter = adminFilter || (vantar.length ? "vantar" : "alla");
        const lista = (filter === "vantar" ? vantar : allaAnvandare.slice())
            .sort((a, b) => ((tidAv(b.skapad) || 0) - (tidAv(a.skapad) || 0)));
        const knapp = (vad, uid, txt, typ) => '<button type="button" class="mknapp' + (typ ? " " + typ : "") +
            '" data-admin="' + vad + '" data-uid="' + esc(uid) + '">' + txt + "</button>";
        const rader = lista.map((a) => {
            const jag = a.uid === anvandare.uid, st = a.status || "vantar", roll = a.roll || "user";
            const skapad = tidAv(a.skapad);
            let atgard = "";
            if (!jag) {
                if (st !== "godkand") atgard += knapp("godkann", a.uid, "Godkänn…", "primar");
                if (st === "godkand" && roll !== "admin") atgard += knapp("projekt", a.uid, "Projekt…");
                if (st !== "nekad") atgard += knapp("neka", a.uid, st === "godkand" ? "Spärra" : "Neka", "fara");
                if (st === "godkand" && roll !== "admin") atgard += a.skapa === true ? knapp("ejskapa", a.uid, "Ta bort skapa projekt") : knapp("skapa", a.uid, "Får skapa projekt");
                if (st === "godkand") atgard += roll === "admin" ? knapp("user", a.uid, "Ta bort huvudadmin") : knapp("admin", a.uid, "Gör till huvudadmin");
            }
            return "<tr><td><b>" + esc(a.namn || a.epost || a.uid) + "</b>" + (jag ? ' <span class="p4-ks-tagg oppet">Du</span>' : "") +
                (a.namn ? "<br><small>" + esc(a.epost || "") + "</small>" : "") + "</td>" +
                "<td>" + esc(skapad ? skapad.toLocaleDateString("sv-SE") : "—") + "</td>" +
                "<td>" + (roll === "admin" ? '<span class="p4-ks-tagg admin">Huvudadmin</span>' : "Användare" +
                    (a.skapa === true ? '<br><span class="p4-ks-tagg oppet">Får skapa projekt</span>' : "")) + "</td>" +
                "<td>" + projektFor(a) + "</td>" +
                '<td><span class="p4-ks-status ' + (st === "godkand" ? "ok" : st === "nekad" ? "konflikt" : "vantar") + '">' + STATUSNAMN[st] + "</span></td>" +
                '<td class="p4-ks-hoger"><span class="p4-ks-atgarder">' + atgard + "</span></td></tr>";
        }).join("");
        kort.innerHTML =
            '<div class="p4-ks-rubrikrad"><h2>Användare</h2>' +
              (vantar.length ? '<span class="p4-ks-status vantar">' + vantar.length + (vantar.length === 1 ? " väntar" : " väntar") + " på godkännande</span>" : "") +
              '<span class="p4-ks-hoger-knappar lage" role="tablist">' +
                '<button type="button" data-adminfilter="vantar"' + (filter === "vantar" ? ' class="vald"' : "") + ">Väntar (" + vantar.length + ")</button>" +
                '<button type="button" data-adminfilter="alla"' + (filter === "alla" ? ' class="vald"' : "") + ">Alla (" + allaAnvandare.length + ")</button>" +
              "</span></div>" +
            '<p class="hjalp">Nya konton kommer inte åt Wimo förrän du godkänner dem och ger dem minst ett projekt. ' +
              "Användare ser bara projekten de är medlemmar i. Under Projekt… väljer du roll per projekt (Kan redigera, Bara läsa eller Projektadmin), " +
              "och under Medlemmar… på ett projekt kan du dessutom ge behörighet per tavla. Med Får skapa projekt kan en användare starta egna projekt och blir projektadmin i dem. Huvudadmin har tillgång till allt.</p>" +
            (lista.length
              ? '<div class="p4-ks-tabellram"><table class="lista p4-ks-tabell"><thead><tr><th>Användare</th><th>Skapad</th><th>Roll</th><th>Projekt</th><th>Status</th><th></th></tr></thead><tbody>' +
                rader + "</tbody></table></div>"
              : '<p class="listtom">' + (filter === "vantar" ? "Inga konton väntar på godkännande." : "Inga användare ännu.") + "</p>");
    }

    async function adminAndra(uid, vad) {
        const a = allaAnvandare.find((x) => x.uid === uid);
        if (!a || uid === anvandare.uid) return;
        const andring = vad === "godkann" ? { status: "godkand" } : vad === "neka" ? { status: "nekad" }
            : vad === "skapa" ? { skapa: true } : vad === "ejskapa" ? { skapa: false }
            : vad === "admin" ? { roll: "admin" } : { roll: "user" };
        const gor = async () => {
            try {
                await fb.fs.setDoc(fb.fs.doc(fb.db, "anvandare", uid),
                    Object.assign(andring, { behandladAv: anvandare.uid, behandladTid: fb.fs.serverTimestamp() }), { merge: true });
                status((a.namn || a.epost) + ": " + ({ godkann: "godkänd", neka: "nekad", admin: "är nu huvudadmin", user: "är inte längre huvudadmin",
                    skapa: "får nu skapa egna projekt", ejskapa: "får inte längre skapa projekt" })[vad]);
            } catch (e) { status("Kunde inte ändra användaren: " + (e.code || e.message), true); }
        };
        if (vad === "godkann") return projektvalDialog(a, true);
        if (vad === "projekt") return projektvalDialog(a, false);
        if (vad === "admin" || (vad === "neka" && a.status === "godkand")) {
            const txt = vad === "admin"
                ? (a.namn || a.epost) + " blir huvudadmin med samma behörighet som du: tillgång till alla projekt, godkänna och spärra konton och dela ut alla roller. " +
                  "Vill du bara att personen ska styra ett projekt väljer du Projektadmin under Projekt… i stället."
                : (a.namn || a.epost) + " stängs ute från Wimo direkt. Projekten finns kvar i kontot och blir tillgängliga igen om du godkänner kontot på nytt.";
            return fraga(vad === "admin" ? "Gör till huvudadmin?" : "Spärra kontot?", txt,
                [{ txt: "Avbryt", fn: stangModal },
                 { txt: vad === "admin" ? "Gör till huvudadmin" : "Spärra", primar: vad === "admin", fara: vad !== "admin", fn: () => { stangModal(); gor(); } }], false);
        }
        gor();
    }

    document.addEventListener("click", (e) => {
        const a = e.target.closest("#ksAdmin [data-admin]");
        if (a) adminAndra(a.dataset.uid, a.dataset.admin);
        const f = e.target.closest("#ksAdmin [data-adminfilter]");
        if (f) { adminFilter = f.dataset.adminfilter; ritaAdmin(); }
        if (e.target.closest("#p4VantarLoggaUt")) {
            // inget har synkats för ett väntande konto, så den lokala datan lämnas orörd
            fb.auth.signOut(fb.authInst).then(() => location.reload());
        }
    });

    // ---------- medlemmar och behörigheter ----------
    const ROLLNAMN = { admin: "Projektadmin", red: "Kan redigera", las: "Bara läsa" };
    const TAVLANAMN = [["", "Som projektet"], ["admin", "Admin"], ["red", "Redigera"], ["las", "Läsa"], ["ingen", "Ingen åtkomst"]];
    const arHuvud = (a) => (a && a.roll) === "admin";
    const rollI = (m, uid) => m.projektAdmin.includes(uid) ? "admin" : m.lasare.includes(uid) ? "las" : "red";

    function projektFor(a) {
        if (arHuvud(a)) return '<span class="p4-ks-dampad">Alla projekt</span>';
        const namn = [...projektMeta].filter(([, m]) => m.medlemmar.includes(a.uid)).map(([, m]) => {
            const r = rollI(m, a.uid), egna = Object.keys((m.tavlaBeh || {})[a.uid] || {}).length;
            return esc(m.namn) + (r !== "red" ? ' <span class="p4-ks-tagg' + (r === "admin" ? " admin" : "") + '">' + ROLLNAMN[r] + "</span>" : "") +
                (egna && r !== "admin" ? ' <span class="p4-ks-tagg">' + egna + (egna === 1 ? " tavla" : " tavlor") + " egen behörighet</span>" : "");
        });
        return namn.length ? namn.join(", ") : '<span class="p4-ks-dampad">Inga</span>';
    }
    const valbaraProjekt = () => [...projektMeta].map(([id, m]) => Object.assign({ id }, m))
        .sort((x, y) => (x.arkiverad - y.arkiverad) || x.namn.localeCompare(y.namn, "sv"));

    // Väljare för roll i ett projekt.
    function rollval(attr, id, roll, av) {
        return '<select class="f p4-ks-beh" ' + attr + '="' + esc(id) + '"' + (av ? " disabled" : "") + ' aria-label="Roll i projektet">' +
            ["red", "las", "admin"].map((r) => '<option value="' + r + '"' + (r === roll ? " selected" : "") + ">" + ROLLNAMN[r] + "</option>").join("") +
            "</select>";
    }
    // Väljare för en tavla.
    function tavlaval(uid, tid, varde, av) {
        return '<select class="f p4-ks-tbeh" data-tu="' + esc(uid) + '" data-tt="' + esc(tid) + '"' + (av ? " disabled" : "") + ">" +
            TAVLANAMN.map(([v, t]) => '<option value="' + v + '"' + (v === (varde || "") ? " selected" : "") + ">" + t + "</option>").join("") + "</select>";
    }
    // Rollen och tavlorna gäller bara när personen är med i projektet; projektadmin styrs inte per tavla.
    function synkaRad(li) {
        const box = li.querySelector("input[type=checkbox]"), roll = li.querySelector(".p4-ks-beh");
        const med = !box || box.checked;
        if (roll && box) roll.disabled = !med || box.disabled;
        const tav = li.querySelector(".p4-ks-tavlor");
        if (tav) tav.classList.toggle("dold", !med || (roll && roll.value === "admin"));
    }
    document.addEventListener("change", (e) => {
        const li = e.target.closest && e.target.closest(".p4-ks-medbeh");
        if (li) synkaRad(li);
    });

    // Godkänn (kräver minst ett projekt) eller ändra vilka projekt en användare är med i (huvudadmin).
    function projektvalDialog(a, godkann) {
        const lista = valbaraProjekt();
        if (!lista.length) {
            return fraga("Det finns inga projekt än", "Skapa ett projekt först, så kan du godkänna " + (a.namn || a.epost) + " och ge tillgång till det.",
                [{ txt: "OK", primar: true, fn: stangModal }], false);
        }
        const kropp =
            '<p class="hjalp" style="margin-top:0">' + (godkann
                ? "Välj vilka projekt " + esc(a.namn || a.epost) + " ska få tillgång till och vilken roll personen har i varje. Minst ett projekt krävs."
                : "Bocka i projekten " + esc(a.namn || a.epost) + " ska vara med i och välj roll. Utan projekt kommer personen inte åt något.") +
            " En projektadmin bestämmer själv vilka som är med i projektet. Behörighet per tavla väljer du under Medlemmar… på projektet.</p>" +
            '<ul class="p4-ks-valista">' + lista.map((p) => {
                const med = p.medlemmar.includes(a.uid);
                return '<li class="p4-ks-medbeh"><label><input type="checkbox" data-pval="' + esc(p.id) + '"' + (med ? " checked" : "") + "> " +
                    "<span><b>" + esc(p.namn) + "</b>" + (p.arkiverad ? ' <span class="p4-ks-tagg">Arkiverat</span>' : "") +
                    "<small>" + (p.medlemmar.filter((u) => u !== a.uid).length) + " andra medlemmar</small></span></label>" +
                    rollval("data-pbeh", p.id, med ? rollI(p, a.uid) : "red", !med) + "</li>";
            }).join("") + "</ul>" +
            '<div class="notis rod dold" id="pvFel"></div>';
        modal(godkann ? "Godkänn " + (a.namn || a.epost) : "Projekt för " + (a.namn || a.epost), a.namn ? a.epost : "", kropp, [
            { txt: "Avbryt", fn: stangModal },
            { txt: godkann ? "Godkänn och ge tillgång" : "Spara", primar: true, fn: async () => {
                const valda = [...document.querySelectorAll("[data-pval]")].filter((x) => x.checked).map((x) => x.dataset.pval);
                const roller = new Map([...document.querySelectorAll("[data-pbeh]")].map((x) => [x.dataset.pbeh, x.value]));
                if (godkann && !valda.length) { const f = $("pvFel"); f.textContent = "Välj minst ett projekt."; f.classList.remove("dold"); return; }
                stangModal();
                try {
                    await sattProjektFor(a.uid, valda, roller);
                    if (godkann) {
                        await fb.fs.setDoc(fb.fs.doc(fb.db, "anvandare", a.uid),
                            { status: "godkand", behandladAv: anvandare.uid, behandladTid: fb.fs.serverTimestamp() }, { merge: true });
                    }
                    status((a.namn || a.epost) + (godkann ? " är godkänd" : ": projekten är sparade"));
                } catch (e) { status("Kunde inte spara: " + (e.code || e.message), true); }
            } },
        ]);
    }

    // Nya listor för ett projekt när en person får en viss roll (null = inte med).
    function medRoll(m, uid, roll) {
        const utan = (lista) => lista.filter((u) => u !== uid);
        const tb = Object.assign({}, m.tavlaBeh || {});
        if (!roll) delete tb[uid];
        return {
            medlemmar: roll ? (m.medlemmar.includes(uid) ? m.medlemmar : m.medlemmar.concat(uid)) : utan(m.medlemmar),
            lasare: roll === "las" ? utan(m.lasare).concat(uid) : utan(m.lasare),
            projektAdmin: roll === "admin" ? utan(m.projektAdmin).concat(uid) : utan(m.projektAdmin),
            tavlaBeh: tb
        };
    }
    async function sparaMeta(pid, m, ny) {
        await fb.fs.updateDoc(projektDoc(pid), ny);
        Object.assign(m, ny);
    }

    // Lägger till och tar bort en användare ur projekt så att hen är med i exakt de valda, med vald roll.
    async function sattProjektFor(uid, valda, roller) {
        roller = roller || new Map();
        for (const [id, m] of projektMeta) {
            const med = m.medlemmar.includes(uid), ska = valda.includes(id);
            const roll = ska ? roller.get(id) || "red" : null;
            if (med === ska && (!ska || rollI(m, uid) === roll)) continue;
            await sparaMeta(id, m, medRoll(m, uid, roll));
        }
    }

    // Medlemmar och behörigheter i ett projekt. Huvudadmin och projektadmin ändrar allt;
    // den som är admin för en tavla ändrar bara vilka som kommer åt den tavlan.
    function medlemmarDialog(pid) {
        const m = projektMeta.get(pid);
        if (!m) return;
        const full = arProjektAdmin(pid);
        const tavlor = m.tavlor.length ? m.tavlor : ((plan4.projekt.find((p) => p.id === pid) || {}).tavlor || []).map((t) => ({ id: t.id, namn: t.namn }));
        const mina = full ? tavlor : tavlor.filter((t) => tavlaRatt(pid, t.id) === "admin");
        if (!full && !mina.length) return;
        const godkanda = allaAnvandare.filter((a) => a.status === "godkand");
        const namnFor = (uid) => { const a = allaAnvandare.find((x) => x.uid === uid); return a ? a.namn || a.epost : "Okänd användare"; };
        // vilka som visas: alla godkända (full), annars bara projektets medlemmar
        let lista = full ? godkanda.slice() : godkanda.filter((a) => m.medlemmar.includes(a.uid));
        m.medlemmar.forEach((u) => { if (!lista.some((a) => a.uid === u) && !allaAnvandare.some((a) => a.uid === u && a.status !== "godkand")) lista.push({ uid: u, namn: "", epost: "" }); });
        lista = lista.filter((a) => full || (!arHuvud(a) && !m.projektAdmin.includes(a.uid) && a.uid !== anvandare.uid))
            .sort((x, y) => (arHuvud(y) - arHuvud(x)) || (x.namn || x.epost || "").localeCompare(y.namn || y.epost || "", "sv"));
        const tb = m.tavlaBeh || {};
        const rad = (a) => {
            const huvud = arHuvud(a), med = huvud || m.medlemmar.includes(a.uid), jag = a.uid === anvandare.uid;
            const roll = med && !huvud ? rollI(m, a.uid) : "red";
            const namn = a.namn || a.epost || namnFor(a.uid);
            if (huvud)
                return '<li class="p4-ks-medbeh"><label><input type="checkbox" checked disabled> <span><b>' + esc(namn) + '</b> <span class="p4-ks-tagg admin">Huvudadmin</span>' +
                    "<small>Full åtkomst till allt</small></span></label></li>";
            const egen = tb[a.uid] || {};
            const tavelrutor = (full ? tavlor : mina).length > 0
                ? '<div class="p4-ks-tavlor' + (!med || roll === "admin" ? " dold" : "") + '">' +
                    (full ? tavlor : mina).map((t) => '<label class="p4-ks-tavla"><span>' + esc(t.namn) + "</span>" +
                        tavlaval(a.uid, t.id, egen[t.id], jag) + "</label>").join("") + "</div>"
                : "";
            return '<li class="p4-ks-medbeh">' +
                (full
                    ? '<label><input type="checkbox" data-mval="' + esc(a.uid) + '"' + (med ? " checked" : "") + (jag ? " disabled" : "") + "> "
                    : "<label>") +
                "<span><b>" + esc(namn) + "</b>" + (jag ? ' <span class="p4-ks-tagg oppet">Du</span>' : "") +
                (a.namn && a.epost ? "<small>" + esc(a.epost) + "</small>" : "") +
                (!full ? "<small>" + ROLLNAMN[roll] + " i projektet</small>" : "") + "</span></label>" +
                (full ? rollval("data-mbeh", a.uid, roll, !med || jag) : "") + tavelrutor + "</li>";
        };
        const kropp =
            '<p class="hjalp" style="margin-top:0">' + (full
                ? "Bocka i vilka som ska vara med i projektet och välj roll. <b>Projektadmin</b> får allt i projektet och väljer själv vilka som är med. " +
                  "Under varje person kan du ge en egen behörighet per tavla: <b>Admin</b> för tavlan, <b>Redigera</b>, <b>Läsa</b> eller <b>Ingen åtkomst</b> (tavlan syns inte alls)."
                : "Du är admin för " + mina.map((t) => "<b>" + esc(t.namn) + "</b>").join(", ") + ". Välj vilka av projektets medlemmar som ska komma åt " +
                  (mina.length === 1 ? "tavlan" : "tavlorna") + " och vad de får göra där.") + "</p>" +
            (godkanda.length || !full ? (lista.length ? '<ul class="p4-ks-valista p4-ks-medlista">' + lista.map(rad).join("") + "</ul>"
                : '<p class="listtom">Inga andra medlemmar i projektet.</p>')
                : '<p class="listtom">Användarlistan hämtas… Stäng och öppna igen om en stund.</p>') +
            '<div class="notis rod dold" id="mdFel"></div>';
        modal((full ? "Medlemmar i " : "Behörigheter i ") + m.namn, full ? "" : "Tavlor du är admin för", kropp, [
            { txt: "Avbryt", fn: stangModal },
            { txt: "Spara", primar: true, fn: async () => {
                const fel = (t) => { const f = $("mdFel"); f.textContent = t; f.classList.remove("dold"); };
                const nyTb = JSON.parse(JSON.stringify(tb));
                document.querySelectorAll(".p4-ks-tbeh").forEach((x) => {
                    if (x.disabled) return;
                    const u = x.dataset.tu, t = x.dataset.tt;
                    if (!full && !mina.some((mt) => mt.id === t)) return;
                    nyTb[u] = nyTb[u] || {};
                    if (x.value) nyTb[u][t] = x.value; else delete nyTb[u][t];
                    if (!Object.keys(nyTb[u]).length) delete nyTb[u];
                });
                let ny;
                if (full) {
                    const synliga = new Set(lista.map((a) => a.uid));
                    const valda = [...document.querySelectorAll("[data-mval]")].filter((x) => x.checked).map((x) => x.dataset.mval);
                    // jag själv (disabled) och personer som inte syns i listan ligger kvar som de var
                    const kvar = m.medlemmar.filter((u) => !synliga.has(u) || u === anvandare.uid || allaAnvandare.some((a) => a.uid === u && arHuvud(a)));
                    const huvuden = allaAnvandare.filter(arHuvud).map((a) => a.uid).filter((u) => m.medlemmar.includes(u));
                    const medlemmar = [...new Set(kvar.concat(huvuden, valda))];
                    const roll = new Map([...document.querySelectorAll("[data-mbeh]")].map((x) => [x.dataset.mbeh, x.value]));
                    const lasare = [], projektAdmin = [];
                    medlemmar.forEach((u) => {
                        const r = roll.has(u) && valda.includes(u) ? roll.get(u) : rollI(m, u);
                        if (r === "las") lasare.push(u);
                        if (r === "admin") projektAdmin.push(u);
                    });
                    Object.keys(nyTb).forEach((u) => { if (!medlemmar.includes(u) || projektAdmin.includes(u)) delete nyTb[u]; });
                    ny = { medlemmar, lasare, projektAdmin, tavlaBeh: nyTb };
                } else ny = { tavlaBeh: nyTb };
                // ingen får bli helt utestängd från alla tavlor (ta då bort personen ur projektet i stället)
                const utestangd = Object.keys(nyTb).find((u) => {
                    if (full && !ny.medlemmar.includes(u)) return false;
                    if ((full ? ny.projektAdmin : m.projektAdmin).includes(u)) return false;
                    return tavlor.length && tavlor.every((t) => nyTb[u][t.id] === "ingen");
                });
                if (utestangd) return fel(namnFor(utestangd) + " har Ingen åtkomst på alla tavlor. Ta bort personen ur projektet i stället, eller öppna minst en tavla.");
                stangModal();
                try {
                    await sparaMeta(pid, m, ny);
                    status((full ? "Medlemmarna i " : "Behörigheterna i ") + m.namn + " är sparade");
                    if (kontoOppen()) { ritaSynkkort(); ritaAdmin(); }
                } catch (e) { status("Kunde inte spara: " + (e.code || e.message), true); }
            } },
        ]);
    }
    document.addEventListener("click", (e) => {
        const b = e.target.closest("#p4KontoSida [data-medlemmar]");
        if (b) medlemmarDialog(b.dataset.medlemmar);
    });

    // Bara den som får skapa projekt skapar nya; bara huvudadmin raderar och importerar.
    function barSkapare(fn) {
        return function () {
            if (aktiverat && anvandare && !kanSkapaProjekt()) {
                return fraga("Du kan inte skapa projekt", "Du arbetar i de projekt du har fått tillgång till. Be huvudadmin om rätten att skapa projekt, eller om ett nytt projekt.",
                    [{ txt: "OK", primar: true, fn: stangModal }], false);
            }
            return fn.apply(this, arguments);
        };
    }
    function barAdmin(fn, vad) {
        return function () {
            if (aktiverat && anvandare && !arAdmin()) {
                return fraga("Bara admin kan " + vad, "Du arbetar i de projekt du har fått tillgång till. Be din admin om du behöver ett nytt projekt.",
                    [{ txt: "OK", primar: true, fn: stangModal }], false);
            }
            return fn.apply(this, arguments);
        };
    }
    nyttProjektDialog = barSkapare(nyttProjektDialog);
    raderaProjektDialog = barAdmin(raderaProjektDialog, "radera projekt");

    // ---------- start ----------
    kopplaFormular();
    uppdateraUI();
    if (!aktiverat) { visaVy("app"); return; }        // utan Firebase-konfiguration: lokalt läge som förut
    visaVy("laddar");

    laddaFirebase().then(() => {
        fb.auth.onAuthStateChanged(fb.authInst, (u) => {
            if (anvLyssnare) { anvLyssnare(); anvLyssnare = null; }
            stoppaAdmin();
            stoppaApp();
            anvandare = u;
            konflikter.clear(); vantande.clear();
            const lasCache = u ? lasJson(LASNYCKEL, null) : null;
            behCache = lasCache && lasCache.uid === u.uid && lasCache.beh ? lasCache.beh : {};
            projektMeta.clear(); doldaTavlor.clear();
            markeraLasvy();
            if (!u) {
                lage = "utloggad"; uppdateraUI();
                return visaVy("inloggning");
            }
            // Var kontot godkänt senast? Då startar appen direkt (även offline) och
            // behörigheten kontrolleras i bakgrunden. Annars väntar vi på svaret.
            const cache = lasJson(BEHNYCKEL, null);
            if (cache && cache.uid === u.uid && cache.status === "godkand") {
                behorighet = { roll: cache.roll || "user", status: "godkand", skapa: !!cache.skapa };
                startaApp();
            } else {
                visaVy("laddar", "Kontrollerar ditt konto…");
            }
            const lyssnaPaKontot = () => sakerstallAnvandardok().then(() => {
                if (anvandare !== u) return;
                anvLyssnare = fb.fs.onSnapshot(anvDoc(), (snap) => hanteraBehorighet(snap.exists() ? snap.data() : null),
                    (e) => console.warn("Wimo behörighet:", e));
            }).catch((e) => {
                console.warn("Wimo behörighet:", e);
                if (!appStartad) visaVy("laddar", "Kunde inte kontrollera ditt konto. Kontrollera nätverket — försöker igen…");
                setTimeout(() => { if (anvandare === u) lyssnaPaKontot(); }, 15000);
            });
            lyssnaPaKontot();
        });
    }).catch((e) => {
        console.warn("Wimo: kunde inte ladda Firebase", e);
        lage = "offline"; uppdateraUI();
        // Utan kontakt med inloggningstjänsten får den som senast var inloggad och godkänd
        // på datorn arbeta vidare i den lokala kopian. Ändringarna synkas vid nästa start med nät.
        const cache = lasJson(BEHNYCKEL, null);
        if (moln.uid && cache && cache.uid === moln.uid && cache.status === "godkand") visaVy("app");
        else visaVy("inloggning", "Ingen kontakt med inloggningstjänsten. Kontrollera nätverket och ladda om sidan.");
    });
})();
