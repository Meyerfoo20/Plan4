/* ======================================================================
   Plan4 · Konto och molnsynk (Firebase Authentication + Cloud Firestore)

   - Utan konto fungerar Plan4 som förut: allt sparas lokalt i webbläsaren.
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
    // Läsbehöriga har aldrig något eget att ladda upp.
    const arAndrad = (p) => !arLas(p.id) && moln.hash[p.id] !== hash(projektJson(p));

    // ---------- läsbehörighet ----------
    // Projekt där den inloggade bara får läsa (uid finns i projektets lasare).
    const LASNYCKEL = "plan4_las";            // { uid, ids: [projekt-id] }, så att läget gäller även offline
    let lasIds = new Set();
    const arLas = (id) => !!anvandare && !arAdmin() && lasIds.has(id);
    // Projektets innehåll utan vald tavla: att byta tavla räknas inte som en ändring.
    const innehall = (p) => JSON.stringify(Object.assign({}, p, { aktiv: undefined }));
    const lasBasis = new Map();               // id → innehållet senast det synkades med molnet

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
    const projektMeta = new Map();   // id → { namn, arkiverad, medlemmar } (admin)
    function lasMeta(docs) {
        projektMeta.clear();
        docs.forEach((d) => { const x = d.data(); projektMeta.set(d.id, { namn: x.namn || "Projekt", arkiverad: !!x.arkiverad, medlemmar: x.medlemmar || [], lasare: x.lasare || [] }); });
    }

    // ---------- hjälp mot appen ----------
    function tomtStandardprojekt() {
        if (plan4.projekt.length !== 1) return false;
        const p = plan4.projekt[0];
        const poster = p.tavlor.reduce((n, t) => n + t.kort.length + t.hinder.length + t.aterkom.length, 0);
        return !poster && !fAktiviteter(p).length && !p.resurser.personer.length && !p.resurser.kategorier.length && !p.foretag.length;
    }
    function dialogOppen() { return !!$("overlay"); }
    function lasProjekt(data) { const p = JSON.parse(data); rustaProjekt(p, IDAG); return p; }
    function markeraSynkad(p, rev) { moln.rev[p.id] = rev; moln.hash[p.id] = hash(projektJson(p)); lasBasis.set(p.id, innehall(p)); }

    // Läser vilka projekt den inloggade bara får läsa, ur projektdokumenten.
    function uppdateraLas(dokument) {
        if (!anvandare) return;
        const ny = new Set(dokument.filter((d) => (d.lasare || []).includes(anvandare.uid)).map((d) => d.id));
        const andrat = ny.size !== lasIds.size || [...ny].some((id) => !lasIds.has(id));
        lasIds = ny;
        skrivJson(LASNYCKEL, { uid: anvandare.uid, ids: [...ny] });
        if (andrat) { markeraLasvy(); if (kontoOppen()) ritaSynkkort(); }
    }
    // Innehållet ett läsbehörigt projekt ska ha: senaste synk, annars den sparade kopian på datorn.
    function basFor(p) {
        if (lasBasis.has(p.id)) return lasBasis.get(p.id);
        try {
            const d = JSON.parse(localStorage.getItem(NYCKEL));
            const x = d && Array.isArray(d.projekt) && d.projekt.find((q) => q.id === p.id);
            if (x) { const b = innehall(lasProjekt(JSON.stringify(x))); lasBasis.set(p.id, b); return b; }
        } catch (e) { }
        return null;
    }
    function lasMeddelande() {
        status("Du har bara läsbehörighet i " + (state.projekt || "projektet") + " — ändringen sparades inte");
    }
    // Ändringar i ett läsbehörigt projekt rullas tillbaka direkt och sparas aldrig.
    let aterstallTimer = null;
    function lasAndrat() {
        return plan4.projekt.some((p) => { if (!arLas(p.id)) return false; const b = basFor(p); return b !== null && b !== innehall(p); });
    }
    function aterstallLas() {
        aterstallTimer = null;
        let n = 0;
        plan4.projekt.forEach((p, i) => {
            if (!arLas(p.id)) return;
            const b = basFor(p);
            if (b === null || b === innehall(p)) return;
            const ny = lasProjekt(b);
            if (p.aktiv && ny.tavlor.some((t) => t.id === p.aktiv)) ny.aktiv = p.aktiv;
            plan4.projekt[i] = ny;
            if (state === p) { angraForeAvbryt(); state = ny; valdKedja = null; }
            n++;
        });
        if (!n) return;
        if (dialogOppen()) stangModal();
        rita();
        lasMeddelande();
    }
    function markeraLasvy() {
        const las = !!(state && state.id && arLas(state.id));
        document.body.classList.toggle("p4-las", las);
        const namn = $("tavlanamn");
        if (namn) namn.readOnly = las;
    }

    // Läser in molnets projekt som hela Plan4 (ersätter det lokala).
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
                if (!arAdmin() && !(p.id in moln.rev)) continue;    // bara admin lägger till nya projekt
                const json = projektJson(p);
                if (json.length > MAX_PROJEKT_TECKEN) {
                    status("Projektet " + p.projekt + " är för stort för molnet — exportera det", true);
                    continue;
                }
                const ref = projektDoc(p.id), vantad = moln.rev[p.id] || 0;
                let utfall;
                try {
                    utfall = await fb.fs.runTransaction(fb.db, async (tx) => {
                        const snap = await tx.get(ref);
                        const molnRev = snap.exists() ? snap.data().rev || 0 : 0;
                        if (molnRev !== vantad) return { konflikt: true, snap };
                        tx.set(ref, { namn: p.projekt, arkiverad: !!p.arkiverad, data: json, rev: molnRev + 1,
                            uppdaterad: fb.fs.serverTimestamp(), enhet: ENHET,
                            medlemmar: snap.exists() ? snap.data().medlemmar || [] : [anvandare.uid],
                            lasare: snap.exists() ? snap.data().lasare || [] : [] });
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
            console.warn("Plan4 molnsynk:", fel);
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
            else uppdateraLas(snap.docs.map((d) => Object.assign({ id: d.id }, d.data())));
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
        }, (e) => { console.warn("Plan4 molnlyssnare:", e); lage = "offline"; uppdateraUI(); });
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
        if (!arAdmin()) uppdateraLas(dokument); else { lasIds = new Set(); markeraLasvy(); }
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
            // kan inte läggas till (det gör admin), men de kan exporteras först.
            const fortsatt = () => { stangModal(); if (dokument.length) anvandMolnet(dokument, aktivt); else nollstallLokalt(); klar(); };
            if (tomtStandardprojekt()) return fortsatt();
            return fraga("Projekten på den här datorn läggs inte till i ditt konto",
                "Du kommer åt de projekt som en admin har gett dig tillgång till. " +
                "Vill du behålla projekten som finns här (" + plan4.projekt.map((p) => p.projekt).join(", ") + "), " +
                "exportera dem och skicka filen till din admin.",
                [{ txt: "Exportera", fn: () => exporteraAllt() },
                 { txt: "Fortsätt", primar: true, fn: fortsatt }]);
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
            } catch (e) { console.warn("Plan4 flytt av projekt:", e); }
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
    // Plan4 kräver konto. Utan inloggning visas bara inloggningssidan (#p4Inloggning).
    function visaVy(vy, text) {
        document.body.classList.toggle("p4-laddar", vy === "laddar");
        document.body.classList.toggle("p4-utloggad", vy === "inloggning");
        document.body.classList.toggle("p4-vantar", vy === "vantar");
        if (vy === "vantar") ritaVantesida();
        if (vy === "laddar") $("p4LaddningText").textContent = text || "Startar Plan4…";
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
        $("kkGoogle").addEventListener("click", async () => {
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
            console.error("Plan4 kontosidan:", e);
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
                  (arAdmin() ? ' · <span class="p4-ks-tagg admin">Admin</span>' : "") + "</p>" +
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
                '<p class="hjalp">Ändringar sparas först här och laddas upp till ditt konto inom någon sekund. Utan nät sparas de här tills nätet är tillbaka.</p>' +
                '<div class="p4-ks-knappar"><button type="button" class="mknapp" data-ks="synka">Synka nu</button></div>' +
              "</section>" +

              '<section class="p4-ks-kort">' +
                "<h2>Säkerhetskopia</h2>" +
                '<p class="hjalp">Projekten sparas automatiskt i ditt konto. Vill du ha en egen kopia, till exempel inför ett projektavslut, ' +
                  "kan du exportera dem till en fil.</p>" +
                '<div class="p4-ks-knappar"><button type="button" class="mknapp" data-ks="exportera">Exportera alla projekt</button>' +
                (arAdmin() ? '<button type="button" class="mknapp" data-ks="importera">Importera från fil</button>' : "") + "</div>" +
              "</section>" +

              '<section class="p4-ks-kort">' +
                "<h2>Logga ut</h2>" +
                '<p class="hjalp">Projekten tas bort från den här datorn när du loggar ut, men finns kvar i ditt konto. ' +
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
                : !synkKlar ? "Väntar" : arLas(p.id) ? "Läsbehörig" : arAndrad(p) ? "Sparas…" : "Sparat";
            const klass = k ? "konflikt" : arAndrad(p) || !synkKlar ? "vantar" : "ok";
            return "<tr><td><b>" + esc(p.projekt) + "</b>" +
                (p.id === state.id ? ' <span class="p4-ks-tagg oppet">Öppet</span>' : "") +
                (p.arkiverad ? ' <span class="p4-ks-tagg">Arkiverat</span>' : "") +
                (arLas(p.id) ? ' <span class="p4-ks-tagg">Bara läsa</span>' : "") + "</td>" +
                "<td>" + p.tavlor.length + "</td><td>" + poster + "</td>" +
                (arAdmin() ? "<td>" + medlemsText(p.id) + "</td>" : "") +
                "<td>" + esc(andrad ? new Date(andrad).toLocaleDateString("sv-SE") : "—") + "</td>" +
                '<td><span class="p4-ks-status ' + klass + '">' + esc(lageTxt) + "</span>" +
                (k ? '<span class="p4-konto-val">' +
                    '<button type="button" class="mknapp" data-hamta="' + esc(p.id) + '">' + (k.borttagen ? "Ta bort här" : "Hämta deras") + "</button>" +
                    '<button type="button" class="mknapp primar" data-behall="' + esc(p.id) + '">Behåll min</button></span>' : "") +
                "</td>" +
                '<td class="p4-ks-hoger"><span class="p4-ks-atgarder">' +
                  (arAdmin() && projektMeta.has(p.id) ? '<button type="button" class="mknapp" data-medlemmar="' + esc(p.id) + '">Medlemmar…</button>' : "") +
                  (p.arkiverad ? "" : '<button type="button" class="mknapp" data-oppna="' + esc(p.id) + '">Öppna</button>') + "</span></td></tr>";
        }).join("");
        kort.innerHTML =
            '<div class="p4-ks-rubrikrad"><h2>' + (arAdmin() ? "Alla projekt" : "Dina projekt") + "</h2>" +
              '<span class="p4-ks-status ' + (lage === "synkad" ? "ok" : lage === "konflikt" || lage === "fel" ? "konflikt" : "vantar") + '">' +
              esc(lagesText()) + "</span>" +
              '<span class="p4-ks-knappar p4-ks-hoger-knappar">' + (arAdmin() ? '<button type="button" class="mknapp" data-ks="nyttprojekt">+ Nytt projekt</button>' : "") +
              '<button type="button" class="mknapp" data-ks="synka">Synka nu</button></span></div>' +
            (konflikter.size ? '<div class="notis">Välj vilken version som ska gälla för projekten som ändrats på två ställen.</div>' : "") +
            '<div class="p4-ks-tabellram"><table class="lista p4-ks-tabell"><thead><tr><th>Projekt</th><th>Tavlor</th><th>Poster</th>' + (arAdmin() ? "<th>Medlemmar</th>" : "") + '<th>Senast ändrat</th><th>Molnet</th><th></th></tr></thead>' +
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
              "de andra medlemmarna. Exportera först om du vill ha en egen kopia.</p>" +
            (harLosenord()
              ? '<div class="falt"><label for="ksRaderaLosen">Bekräfta med ditt lösenord</label><input class="f" id="ksRaderaLosen" type="password" autocomplete="current-password"></div>'
              : '<p class="hjalp">Du får bekräfta med ditt Google-konto.</p>') +
            '<label class="p4-ks-bekrafta"><input type="checkbox" id="ksRaderaOk"> Jag förstår att det inte går att ångra</label>' +
            '<div class="notis rod dold" id="ksRaderaSvar"></div>';
        modal("Radera konto", anvandare.email || "", kropp, [
            { txt: "Exportera först", vanster: true, fn: () => exporteraAllt() },
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
            else if (vad === "exportera") exporteraAllt();
            else if (vad === "importera") $("importfil").click();
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
                    "Kontrollera nätverket eller exportera projekten först.",
                    [{ txt: "Logga ut ändå", fara: true, vanster: true, fn: () => loggaUt(true) },
                     { txt: "Exportera", fn: () => { stangModal(); exporteraAllt(); } },
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
        if (lasIds.size && lasAndrat()) {
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
    lagringstext = function () { return anvandare && synkKlar ? " · i ditt konto" : ursLagringstext.apply(this, arguments); };
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
    // och status ("vantar" | "godkand" | "nekad"). Bara godkända konton kommer åt Plan4.
    // Ett nytt konto skapas alltid som user med status vantar. Säkerhetsreglerna i
    // firestore.rules hindrar att någon godkänner sig själv eller gör sig till admin.
    const BEHNYCKEL = "plan4_behorighet";     // senast kända status, så att appen kan starta offline
    let behorighet = { roll: "user", status: "vantar" };
    let appStartad = false;
    let anvLyssnare = null;      // användarens eget dokument
    let adminLyssnare = null;    // alla användare (bara för admin)
    let allaAnvandare = [];
    let adminFilter = null;      // null = Väntar om någon väntar, annars Alla
    const arAdmin = () => behorighet.roll === "admin" && behorighet.status === "godkand";
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
        behorighet = { roll: (d && d.roll) || "user", status: (d && d.status) || "vantar" };
        skrivJson(BEHNYCKEL, { uid: anvandare.uid, roll: behorighet.roll, status: behorighet.status });
        if (behorighet.status === "godkand") {
            // Ny roll ger andra projekt (admin ser alla): synka om från början.
            if (appStartad && forraRoll !== behorighet.roll) stoppaApp();
            if (!appStartad) startaApp();
        } else {
            stoppaApp();
            visaVy("vantar");
        }
        if (arAdmin()) startaAdmin(); else stoppaAdmin();
        uppdateraUI();
    }

    function startaApp() {
        appStartad = true;
        // Samma konto som senast: visa den lokala kopian direkt och synka i bakgrunden.
        // Annars visas ingenting förrän kontots projekt är hämtade.
        const kand = moln.uid === anvandare.uid;
        visaVy(kand ? "app" : "laddar", "Hämtar dina projekt…");
        forstaSynk().then(efterForstaSynk).catch((e) => {
            console.warn("Plan4 första synk:", e);
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
            ? "En administratör har inte gett " + (anvandare.email || "kontot") + " tillgång till Plan4. Kontakta administratören om du tror att det är fel."
            : "En administratör behöver godkänna " + (anvandare.email || "ditt konto") + " innan du kommer åt Plan4. Sidan öppnas av sig själv så fort det är klart — du behöver inte ladda om.";
        $("p4Vantar").classList.toggle("nekad", nekad);
    }

    // ---------- admin: alla användare ----------
    function startaAdmin() {
        if (adminLyssnare) return;
        adminLyssnare = fb.fs.onSnapshot(fb.fs.collection(fb.db, "anvandare"), (snap) => {
            allaAnvandare = snap.docs.map((d) => Object.assign({ uid: d.id }, d.data()));
            uppdateraUI();
            if (kontoOppen()) ritaAdmin();
        }, (e) => console.warn("Plan4 användarlista:", e));
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
                if (st === "godkand") atgard += roll === "admin" ? knapp("user", a.uid, "Ta bort admin") : knapp("admin", a.uid, "Gör till admin");
            }
            return "<tr><td><b>" + esc(a.namn || a.epost || a.uid) + "</b>" + (jag ? ' <span class="p4-ks-tagg oppet">Du</span>' : "") +
                (a.namn ? "<br><small>" + esc(a.epost || "") + "</small>" : "") + "</td>" +
                "<td>" + esc(skapad ? skapad.toLocaleDateString("sv-SE") : "—") + "</td>" +
                "<td>" + (roll === "admin" ? '<span class="p4-ks-tagg admin">Admin</span>' : "Användare") + "</td>" +
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
            '<p class="hjalp">Nya konton kommer inte åt Plan4 förrän du godkänner dem och ger dem minst ett projekt. ' +
              "Användare ser bara projekten de är medlemmar i, och du väljer om de får redigera eller bara läsa. Admin har tillgång till alla projekt.</p>" +
            (lista.length
              ? '<div class="p4-ks-tabellram"><table class="lista p4-ks-tabell"><thead><tr><th>Användare</th><th>Skapad</th><th>Roll</th><th>Projekt</th><th>Status</th><th></th></tr></thead><tbody>' +
                rader + "</tbody></table></div>"
              : '<p class="listtom">' + (filter === "vantar" ? "Inga konton väntar på godkännande." : "Inga användare ännu.") + "</p>");
    }

    async function adminAndra(uid, vad) {
        const a = allaAnvandare.find((x) => x.uid === uid);
        if (!a || uid === anvandare.uid) return;
        const andring = vad === "godkann" ? { status: "godkand" } : vad === "neka" ? { status: "nekad" }
            : vad === "admin" ? { roll: "admin" } : { roll: "user" };
        const gor = async () => {
            try {
                await fb.fs.setDoc(fb.fs.doc(fb.db, "anvandare", uid),
                    Object.assign(andring, { behandladAv: anvandare.uid, behandladTid: fb.fs.serverTimestamp() }), { merge: true });
                status((a.namn || a.epost) + ": " + ({ godkann: "godkänd", neka: "nekad", admin: "är nu admin", user: "är inte längre admin" })[vad]);
            } catch (e) { status("Kunde inte ändra användaren: " + (e.code || e.message), true); }
        };
        if (vad === "godkann") return projektvalDialog(a, true);
        if (vad === "projekt") return projektvalDialog(a, false);
        if (vad === "admin" || (vad === "neka" && a.status === "godkand")) {
            const txt = vad === "admin"
                ? (a.namn || a.epost) + " får samma behörighet som du: godkänna och spärra konton och dela ut adminrollen."
                : (a.namn || a.epost) + " stängs ute från Plan4 direkt. Projekten finns kvar i kontot och blir tillgängliga igen om du godkänner kontot på nytt.";
            return fraga(vad === "admin" ? "Gör till admin?" : "Spärra kontot?", txt,
                [{ txt: "Avbryt", fn: stangModal },
                 { txt: vad === "admin" ? "Gör till admin" : "Spärra", primar: vad === "admin", fara: vad !== "admin", fn: () => { stangModal(); gor(); } }], false);
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

    // ---------- medlemmar i projekt (admin) ----------
    function projektFor(a) {
        if ((a.roll || "user") === "admin") return '<span class="p4-ks-dampad">Alla projekt</span>';
        const namn = [...projektMeta].filter(([, m]) => m.medlemmar.includes(a.uid))
            .map(([, m]) => esc(m.namn) + (m.lasare.includes(a.uid) ? ' <span class="p4-ks-tagg">Bara läsa</span>' : ""));
        return namn.length ? namn.join(", ") : '<span class="p4-ks-dampad">Inga</span>';
    }
    const valbaraProjekt = () => [...projektMeta].map(([id, m]) => Object.assign({ id }, m))
        .sort((x, y) => (x.arkiverad - y.arkiverad) || x.namn.localeCompare(y.namn, "sv"));

    // Godkänn (kräver minst ett projekt) eller ändra vilka projekt en användare är med i.
    function projektvalDialog(a, godkann) {
        const lista = valbaraProjekt();
        if (!lista.length) {
            return fraga("Det finns inga projekt än", "Skapa ett projekt först, så kan du godkänna " + (a.namn || a.epost) + " och ge tillgång till det.",
                [{ txt: "OK", primar: true, fn: stangModal }], false);
        }
        const kropp =
            '<p class="hjalp" style="margin-top:0">' + (godkann
                ? "Välj vilka projekt " + esc(a.namn || a.epost) + " ska få tillgång till. Minst ett projekt krävs."
                : "Bocka i projekten " + esc(a.namn || a.epost) + " ska vara med i. Utan projekt kommer personen inte åt något.") + "</p>" +
            '<ul class="p4-ks-valista">' + lista.map((p) => {
                const med = p.medlemmar.includes(a.uid);
                return '<li class="p4-ks-medbeh"><label><input type="checkbox" data-pval="' + esc(p.id) + '"' + (med ? " checked" : "") + "> " +
                    "<span><b>" + esc(p.namn) + "</b>" + (p.arkiverad ? ' <span class="p4-ks-tagg">Arkiverat</span>' : "") +
                    "<small>" + (p.medlemmar.filter((u) => u !== a.uid).length) + " andra medlemmar</small></span></label>" +
                    behorighetsval("data-pbeh", p.id, med && p.lasare.includes(a.uid), !med) + "</li>";
            }).join("") + "</ul>" +
            '<div class="notis rod dold" id="pvFel"></div>';
        modal(godkann ? "Godkänn " + (a.namn || a.epost) : "Projekt för " + (a.namn || a.epost), a.namn ? a.epost : "", kropp, [
            { txt: "Avbryt", fn: stangModal },
            { txt: godkann ? "Godkänn och ge tillgång" : "Spara", primar: true, fn: async () => {
                const valda = [...document.querySelectorAll("[data-pval]")].filter((x) => x.checked).map((x) => x.dataset.pval);
                const lasVal = new Set([...document.querySelectorAll("[data-pbeh]")].filter((x) => x.value === "las").map((x) => x.dataset.pbeh));
                if (godkann && !valda.length) { const f = $("pvFel"); f.textContent = "Välj minst ett projekt."; f.classList.remove("dold"); return; }
                stangModal();
                try {
                    await sattProjektFor(a.uid, valda, lasVal);
                    if (godkann) {
                        await fb.fs.setDoc(fb.fs.doc(fb.db, "anvandare", a.uid),
                            { status: "godkand", behandladAv: anvandare.uid, behandladTid: fb.fs.serverTimestamp() }, { merge: true });
                    }
                    status((a.namn || a.epost) + (godkann ? " är godkänd" : ": projekten är sparade"));
                } catch (e) { status("Kunde inte spara: " + (e.code || e.message), true); }
            } },
        ]);
    }

    // Väljare för behörighet i ett projekt: redigera eller bara läsa.
    function behorighetsval(attr, id, las, av) {
        return '<select class="f p4-ks-beh" ' + attr + '="' + esc(id) + '"' + (av ? " disabled" : "") + ' aria-label="Behörighet">' +
            '<option value="red"' + (las ? "" : " selected") + ">Kan redigera</option>" +
            '<option value="las"' + (las ? " selected" : "") + ">Bara läsa</option></select>";
    }
    // Väljaren gäller bara när personen är med i projektet.
    document.addEventListener("change", (e) => {
        const box = e.target.closest && e.target.closest(".p4-ks-medbeh input[type=checkbox]");
        if (!box) return;
        const val = box.closest("li").querySelector(".p4-ks-beh");
        if (val) val.disabled = !box.checked || box.disabled;
    });

    // Lägger till och tar bort en användare ur projekt så att hen är med i exakt de valda,
    // med läsbehörighet i de projekt som finns i lasVal.
    async function sattProjektFor(uid, valda, lasVal) {
        lasVal = lasVal || new Set();
        for (const [id, m] of projektMeta) {
            const med = m.medlemmar.includes(uid), ska = valda.includes(id);
            const arL = m.lasare.includes(uid), skaL = ska && lasVal.has(id);
            if (med === ska && arL === skaL) continue;
            const ny = ska ? (med ? m.medlemmar : m.medlemmar.concat(uid)) : m.medlemmar.filter((u) => u !== uid);
            const nyL = skaL ? (arL ? m.lasare : m.lasare.concat(uid)) : m.lasare.filter((u) => u !== uid);
            await fb.fs.setDoc(projektDoc(id), { medlemmar: ny, lasare: nyL }, { merge: true });
            m.medlemmar = ny; m.lasare = nyL;
        }
    }

    // Vilka användare är med i ett projekt?
    function medlemmarDialog(pid) {
        const m = projektMeta.get(pid);
        if (!m) return;
        const anvandareLista = allaAnvandare.filter((a) => a.status === "godkand")
            .sort((x, y) => (x.namn || x.epost || "").localeCompare(y.namn || y.epost || "", "sv"));
        const kropp =
            '<p class="hjalp" style="margin-top:0">Bocka i vilka som ska ha tillgång till projektet och välj om de får redigera eller bara läsa. Admin har alltid tillgång. ' +
              "Konton som väntar på godkännande ger du projekt när du godkänner dem.</p>" +
            (anvandareLista.length ? '<ul class="p4-ks-valista">' + anvandareLista.map((a) => {
                const admin = a.roll === "admin", med = m.medlemmar.includes(a.uid);
                return '<li class="p4-ks-medbeh"><label><input type="checkbox" data-mval="' + esc(a.uid) + '"' +
                    (admin || med ? " checked" : "") + (admin ? " disabled" : "") + "> " +
                    "<span><b>" + esc(a.namn || a.epost) + "</b>" + (admin ? ' <span class="p4-ks-tagg admin">Admin</span>' : "") +
                    (a.namn ? "<small>" + esc(a.epost || "") + "</small>" : "") + "</span></label>" +
                    (admin ? "" : behorighetsval("data-mbeh", a.uid, med && m.lasare.includes(a.uid), !med)) + "</li>";
            }).join("") + "</ul>" : '<p class="listtom">Inga godkända användare ännu.</p>');
        modal("Medlemmar i " + m.namn, "", kropp, [
            { txt: "Avbryt", fn: stangModal },
            { txt: "Spara", primar: true, fn: async () => {
                const valda = [...document.querySelectorAll("[data-mval]")].filter((x) => x.checked && !x.disabled).map((x) => x.dataset.mval);
                const admins = m.medlemmar.filter((u) => { const a = allaAnvandare.find((x) => x.uid === u); return a && a.roll === "admin"; });
                // andra som inte syns i listan (väntande eller spärrade) ligger kvar som de var
                const osynliga = m.medlemmar.filter((u) => !anvandareLista.some((a) => a.uid === u));
                const ny = [...new Set(admins.concat(osynliga, valda))];
                const lasValda = [...document.querySelectorAll("[data-mbeh]")].filter((x) => x.value === "las" && valda.includes(x.dataset.mbeh)).map((x) => x.dataset.mbeh);
                const nyL = [...new Set(m.lasare.filter((u) => osynliga.includes(u)).concat(lasValda))];
                stangModal();
                try {
                    await fb.fs.setDoc(projektDoc(pid), { medlemmar: ny, lasare: nyL }, { merge: true });
                    m.medlemmar = ny; m.lasare = nyL;
                    status("Medlemmarna i " + m.namn + " är sparade");
                    if (kontoOppen()) { ritaSynkkort(); ritaAdmin(); }
                } catch (e) { status("Kunde inte spara: " + (e.code || e.message), true); }
            } },
        ]);
    }
    document.addEventListener("click", (e) => {
        const b = e.target.closest("#p4KontoSida [data-medlemmar]");
        if (b) medlemmarDialog(b.dataset.medlemmar);
    });

    // Bara admin skapar, raderar och importerar projekt.
    function barAdmin(fn, vad) {
        return function () {
            if (aktiverat && anvandare && !arAdmin()) {
                return fraga("Bara admin kan " + vad, "Du arbetar i de projekt du har fått tillgång till. Be din admin om du behöver ett nytt projekt.",
                    [{ txt: "OK", primar: true, fn: stangModal }], false);
            }
            return fn.apply(this, arguments);
        };
    }
    nyttProjektDialog = barAdmin(nyttProjektDialog, "skapa projekt");
    raderaProjektDialog = barAdmin(raderaProjektDialog, "radera projekt");
    importDialog = barAdmin(importDialog, "importera projekt");

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
            lasIds = new Set(lasCache && lasCache.uid === u.uid ? lasCache.ids || [] : []);
            markeraLasvy();
            if (!u) {
                lage = "utloggad"; uppdateraUI();
                return visaVy("inloggning");
            }
            // Var kontot godkänt senast? Då startar appen direkt (även offline) och
            // behörigheten kontrolleras i bakgrunden. Annars väntar vi på svaret.
            const cache = lasJson(BEHNYCKEL, null);
            if (cache && cache.uid === u.uid && cache.status === "godkand") {
                behorighet = { roll: cache.roll || "user", status: "godkand" };
                startaApp();
            } else {
                visaVy("laddar", "Kontrollerar ditt konto…");
            }
            const lyssnaPaKontot = () => sakerstallAnvandardok().then(() => {
                if (anvandare !== u) return;
                anvLyssnare = fb.fs.onSnapshot(anvDoc(), (snap) => hanteraBehorighet(snap.exists() ? snap.data() : null),
                    (e) => console.warn("Plan4 behörighet:", e));
            }).catch((e) => {
                console.warn("Plan4 behörighet:", e);
                if (!appStartad) visaVy("laddar", "Kunde inte kontrollera ditt konto. Kontrollera nätverket — försöker igen…");
                setTimeout(() => { if (anvandare === u) lyssnaPaKontot(); }, 15000);
            });
            lyssnaPaKontot();
        });
    }).catch((e) => {
        console.warn("Plan4: kunde inte ladda Firebase", e);
        lage = "offline"; uppdateraUI();
        // Utan kontakt med inloggningstjänsten får den som senast var inloggad och godkänd
        // på datorn arbeta vidare i den lokala kopian. Ändringarna synkas vid nästa start med nät.
        const cache = lasJson(BEHNYCKEL, null);
        if (moln.uid && cache && cache.uid === moln.uid && cache.status === "godkand") visaVy("app");
        else visaVy("inloggning", "Ingen kontakt med inloggningstjänsten. Kontrollera nätverket och ladda om sidan.");
    });
})();
