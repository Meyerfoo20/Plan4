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
     anvandare/{uid}/projekt/{id}    { namn, arkiverad, data, rev, uppdaterad, enhet }
   där data är hela projektet som JSON-text och rev ökar med ett per sparning.

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
    const arAndrad = (p) => moln.hash[p.id] !== hash(projektJson(p));

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
    const projektSamling = () => fb.fs.collection(fb.db, "anvandare", anvandare.uid, "projekt");
    const projektDoc = (id) => fb.fs.doc(fb.db, "anvandare", anvandare.uid, "projekt", id);

    // ---------- hjälp mot appen ----------
    function tomtStandardprojekt() {
        if (plan4.projekt.length !== 1) return false;
        const p = plan4.projekt[0];
        const poster = p.tavlor.reduce((n, t) => n + t.kort.length + t.hinder.length + t.aterkom.length, 0);
        return !poster && !fAktiviteter(p).length && !p.resurser.personer.length && !p.resurser.kategorier.length && !p.foretag.length;
    }
    function dialogOppen() { return !!$("overlay"); }
    function lasProjekt(data) { const p = JSON.parse(data); rustaProjekt(p, IDAG); return p; }
    function markeraSynkad(p, rev) { moln.rev[p.id] = rev; moln.hash[p.id] = hash(projektJson(p)); }

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
        sparaMoln();
        ursSparaNu();
        rita();
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
                const json = projektJson(p);
                if (json.length > MAX_PROJEKT_TECKEN) {
                    status("Projektet " + p.projekt + " är för stort för molnet — exportera det", true);
                    continue;
                }
                const ref = projektDoc(p.id), vantad = moln.rev[p.id] || 0;
                const utfall = await fb.fs.runTransaction(fb.db, async (tx) => {
                    const snap = await tx.get(ref);
                    const molnRev = snap.exists() ? snap.data().rev || 0 : 0;
                    if (molnRev !== vantad) return { konflikt: true, snap };
                    tx.set(ref, { namn: p.projekt, arkiverad: !!p.arkiverad, data: json, rev: molnRev + 1,
                        uppdaterad: fb.fs.serverTimestamp(), enhet: ENHET });
                    return { rev: molnRev + 1 };
                });
                if (utfall.konflikt) {
                    const d = utfall.snap.exists() ? utfall.snap.data() : null;
                    registreraKonflikt(p.id, p.projekt, d);
                } else {
                    moln.rev[p.id] = utfall.rev;
                    moln.hash[p.id] = hash(json);
                    sparaMoln();
                }
            }
            // projekt som raderats permanent här tas bort i molnet
            for (const id of Object.keys(moln.rev)) {
                if (lokala.has(id) || konflikter.has(id)) continue;
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
        lyssnare = fb.fs.onSnapshot(projektSamling(), (snap) => {
            snap.docChanges().forEach((c) => {
                const id = c.doc.id, d = c.doc.data();
                if (c.type === "removed") {
                    if (!(id in moln.rev)) return;
                    const p = plan4.projekt.find((x) => x.id === id);
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
        for (const [id, v] of vantande) {
            if (v.borttagen) taBortLokalt(id); else ersattProjekt(id, v.data, v.rev);
        }
        vantande.clear();
        status("Uppdaterat från en annan enhet");
        uppdateraUI();
    }
    // en väntande uppdatering tillämpas när dialogen stängs
    const ursStangModal = stangModal;
    stangModal = function () { ursStangModal.apply(this, arguments); setTimeout(tillampaVantande, 0); };

    // ---------- första synken efter inloggning ----------
    async function forstaSynk() {
        lage = "synkar"; uppdateraUI();
        const [snap, anvSnap] = await Promise.all([fb.fs.getDocs(projektSamling()), fb.fs.getDoc(anvDoc())]);
        const dokument = snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
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
        if (!dokument.length) {
            // Nytt konto: ladda upp det som finns på den här datorn.
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
        schemalaggPush(50);
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
    rita = function () { const r = ursRitaKonto.apply(this, arguments); if (kontoOppen()) ritaSynkkort(); return r; };
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
                  " · konto skapat " + esc(datumText(anvandare.metadata && anvandare.metadata.creationTime)) + "</p>" +
              "</div>" +
              '<button type="button" class="navknapp" data-ks="tillbaka">← Till tavlan</button>' +
            "</div>" +

            '<div class="p4-ks-siffror" id="ksSiffror"></div>' +

            '<section class="p4-ks-kort p4-ks-projekt" id="ksSynk"></section>' +

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
                '<button type="button" class="mknapp" data-ks="importera">Importera från fil</button></div>' +
              "</section>" +

              '<section class="p4-ks-kort">' +
                "<h2>Logga ut</h2>" +
                '<p class="hjalp">Projekten tas bort från den här datorn när du loggar ut, men finns kvar i ditt konto. ' +
                  "Logga alltid ut på en delad dator, till exempel i bodan.</p>" +
                '<div class="p4-ks-knappar"><button type="button" class="mknapp" data-ks="loggaut">Logga ut</button></div>' +
              "</section>" +

              '<section class="p4-ks-kort p4-ks-fara">' +
                "<h2>Radera konto</h2>" +
                '<p class="hjalp">Kontot och alla projekt i det tas bort för gott, på alla datorer. Det går inte att ångra.</p>' +
                '<div class="p4-ks-knappar"><button type="button" class="mknapp fara" data-ks="radera">Radera mitt konto…</button></div>' +
              "</section>" +
            "</div>";
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
                : !synkKlar ? "Väntar" : arAndrad(p) ? "Sparas…" : "Sparat";
            const klass = k ? "konflikt" : arAndrad(p) || !synkKlar ? "vantar" : "ok";
            return "<tr><td><b>" + esc(p.projekt) + "</b>" +
                (p.id === state.id ? ' <span class="p4-ks-tagg oppet">öppet</span>' : "") +
                (p.arkiverad ? ' <span class="p4-ks-tagg">arkiverat</span>' : "") + "</td>" +
                "<td>" + p.tavlor.length + "</td><td>" + poster + "</td>" +
                "<td>" + esc(andrad ? new Date(andrad).toLocaleDateString("sv-SE") : "—") + "</td>" +
                '<td><span class="p4-ks-status ' + klass + '">' + esc(lageTxt) + "</span>" +
                (k ? '<span class="p4-konto-val">' +
                    '<button type="button" class="mknapp" data-hamta="' + esc(p.id) + '">' + (k.borttagen ? "Ta bort här" : "Hämta deras") + "</button>" +
                    '<button type="button" class="mknapp primar" data-behall="' + esc(p.id) + '">Behåll min</button></span>' : "") +
                "</td>" +
                '<td class="p4-ks-hoger">' + (p.arkiverad ? "" : '<button type="button" class="mknapp" data-oppna="' + esc(p.id) + '">Öppna</button>') + "</td></tr>";
        }).join("");
        kort.innerHTML =
            '<div class="p4-ks-rubrikrad"><h2>Dina projekt</h2>' +
              '<span class="p4-ks-status ' + (lage === "synkad" ? "ok" : lage === "konflikt" || lage === "fel" ? "konflikt" : "vantar") + '">' +
              esc(lagesText()) + "</span>" +
              '<span class="p4-ks-knappar p4-ks-hoger-knappar"><button type="button" class="mknapp" data-ks="nyttprojekt">+ Nytt projekt</button>' +
              '<button type="button" class="mknapp" data-ks="synka">Synka nu</button></span></div>' +
            (konflikter.size ? '<div class="notis">Välj vilken version som ska gälla för projekten som ändrats på två ställen.</div>' : "") +
            '<div class="p4-ks-tabellram"><table class="lista p4-ks-tabell"><thead><tr><th>Projekt</th><th>Tavlor</th><th>Poster</th><th>Senast ändrat</th><th>Molnet</th><th></th></tr></thead>' +
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
            '<p class="hjalp">' + plan4.projekt.length + (plan4.projekt.length === 1 ? " projekt" : " projekt") +
              " raderas från molnet och från den här datorn. Exportera först om du vill ha kvar något.</p>" +
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
            sparaNu = async () => true;
            clearTimeout(sparaTimer);
            const snap = await fb.fs.getDocs(projektSamling());
            for (const d of snap.docs) await fb.fs.deleteDoc(projektDoc(d.id));
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
        clearTimeout(pushTimer);
        synkKlar = false;
        sparaNu = async () => true;          // ingen ny lokal skrivning mellan utloggning och omladdning
        clearTimeout(sparaTimer);
        try { localStorage.removeItem(NYCKEL); localStorage.removeItem(MOLNNYCKEL); } catch (e) { }
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
    }

    // ---------- koppling till appen ----------
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

    // ---------- start ----------
    kopplaFormular();
    uppdateraUI();
    if (!aktiverat) { visaVy("app"); return; }        // utan Firebase-konfiguration: lokalt läge som förut
    visaVy("laddar");

    function forsokIgen() {
        setTimeout(() => {
            if (!anvandare || synkKlar) return;
            forstaSynk().then(() => visaVy("app")).catch(forsokIgen);
        }, 15000);
    }

    laddaFirebase().then(() => {
        fb.auth.onAuthStateChanged(fb.authInst, async (u) => {
            anvandare = u;
            synkKlar = false;
            konflikter.clear(); vantande.clear();
            if (!u) {
                if (lyssnare) { lyssnare(); lyssnare = null; }
                lage = "utloggad"; uppdateraUI();
                return visaVy("inloggning");
            }
            // Samma konto som senast: visa den lokala kopian direkt och synka i bakgrunden.
            // Annars visas ingenting förrän kontots projekt är hämtade.
            const kand = moln.uid === u.uid;
            visaVy(kand ? "app" : "laddar", "Hämtar dina projekt…");
            try {
                await forstaSynk();
                if (!kand) visaVy("app");
            } catch (e) {
                console.warn("Plan4 första synk:", e);
                lage = "offline"; uppdateraUI();
                if (!kand) visaVy("laddar", "Kunde inte hämta dina projekt. Kontrollera nätverket — försöker igen…");
                forsokIgen();
            }
        });
    }).catch((e) => {
        console.warn("Plan4: kunde inte ladda Firebase", e);
        lage = "offline"; uppdateraUI();
        // Utan kontakt med inloggningstjänsten får den som senast var inloggad på datorn
        // arbeta vidare i den lokala kopian. Ändringarna synkas vid nästa start med nät.
        if (moln.uid) visaVy("app");
        else visaVy("inloggning", "Ingen kontakt med inloggningstjänsten. Kontrollera nätverket och ladda om sidan.");
    });
})();
