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
     anvandare/{uid}                 { epost, roll, status, aktivtProjekt, … }
     projekt/{id}                    metadata: { namn, arkiverad, version: 2, tavlor, medlemmar, lasare,
                                     projektAdmin, tavlaBeh, kod }
     projekt/{id}/delar/…            projektets egna delar
     projekt/{id}/tavlor/{tid}/poster/…  varje kort, hinder, historikrad och återkommande post för sig
   Bara det som ändrats laddas upp och hämtas, så två personer som ändrar olika kort
   krockar aldrig, och inget projekt blir för stort för molnet. Projekt i det gamla
   formatet (hela projektet som JSON i fältet data) flyttas av projektadmin eller
   huvudadmin första gången de öppnar Wimo. Se "molnformatet" nedan.

   Skriptet är ett vanligt skript som laddar Firebase med dynamisk import, så
   att det fungerar även när index.html öppnas direkt från disken.
   ====================================================================== */
(function () {
    "use strict";

    const SDK = "https://www.gstatic.com/firebasejs/10.12.2/";
    const MOLNNYCKEL = "plan4_moln";          // { uid, v: 2, delar, tid, meta, v1 } (se molnformatet nedan)
    const ENHETNYCKEL = "plan4_enhet";
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
    // Molnets baslinje på den här datorn:
    //   delar[projekt][del] = [rev, kontrollsumma | null]   senast synkade version av varje del
    //   tid[projekt][samling] = ms                         senaste ändringstid som hämtats
    //   meta[projekt] = { n, a, o }                        namn, arkiverad och tavelordning vid senaste synk
    //   v1[projekt] = rev                                  projekt som ännu ligger i det gamla formatet
    function lasMolnet() {
        const m = lasJson(MOLNNYCKEL, null) || {};
        if (m.v === 2) return Object.assign({ delar: {}, tid: {}, meta: {}, v1: {} }, m);
        return { uid: m.uid || null, v: 2, delar: {}, tid: {}, meta: {}, v1: Object.assign({}, m.rev || {}) };
    }
    let moln = lasMolnet();
    const SKARM = (new URLSearchParams(location.search).get("skarm") || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 40);
    function sparaMoln() { basVersion++; skrivJson(MOLNNYCKEL, moln); }

    // Kort, stabil kontrollsumma (FNV-1a) för att se om ett projekt ändrats sedan senaste synk.
    function hash(txt) {
        let h = 0x811c9dc5;
        for (let i = 0; i < txt.length; i++) { h ^= txt.charCodeAt(i); h = Math.imul(h, 0x01000193); }
        return (h >>> 0).toString(36) + ":" + txt.length;
    }
    const projektJson = (p) => JSON.stringify(p);
    // Den som inte får ändra något har aldrig något eget att ladda upp. Ett projekt som inte finns
    // i molnet än räknas som ändrat om jag får skapa projekt.
    function arAndrad(p) {
        if (!anvandare || !kanSkriva(p)) return false;
        if (!moln.delar[p.id]) return !projektMeta.has(p.id) && !kanda(p.id) && kanSkapaProjekt() && !(p.reserv && arTomt(p));
        return andringar(p).length > 0 || !!metaAndring(p);
    }

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
        // gamla formatet: bara läsa tills projektadmin flyttat projektet (det sker av sig självt)
        if (m && m.version !== 2 && !m.projektAdmin.includes(anvandare.uid)) {
            const egna = (m.tavlaBeh && m.tavlaBeh[anvandare.uid]) || {}, ingen = {};
            Object.keys(egna).forEach((tid) => { if (egna[tid] === "ingen") ingen[tid] = "ingen"; });
            return { roll: "las", tavlor: ingen };
        }
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
    // Projektkoder: projektet har fältet kod och koder/{kod} pekar tillbaka på projektet.
    // Den som skapar konto med koden ansöker i projekt/{id}/ansokningar/{uid}; projektadmin godkänner.
    // projekt/{id}/personer/{uid} är projektets egen namnlista, så att projektadmin bara ser sina medlemmar.
    const KODTECKEN = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    function nyKod() {
        const a = new Uint32Array(6);
        crypto.getRandomValues(a);
        return Array.from(a, (n) => KODTECKEN[n % KODTECKEN.length]).join("");
    }
    const rensaKod = (k) => String(k || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const kodDoc = (k) => fb.fs.doc(fb.db, "koder", k);
    const ansokDoc = (pid, uid) => fb.fs.doc(fb.db, "projekt", pid, "ansokningar", uid);
    const personDoc = (pid, uid) => fb.fs.doc(fb.db, "projekt", pid, "personer", uid);
    const projektMeta = new Map();   // id → { namn, arkiverad, medlemmar, lasare, projektAdmin, tavlaBeh, tavlor }
    function metaFran(x) {
        let tavlor = [];
        if (x.version === 2) tavlor = (Array.isArray(x.tavlor) ? x.tavlor : []).map((t) => ({ id: t.id, namn: t.namn || "Tavla" }));
        else try { tavlor = (JSON.parse(x.data || "{}").tavlor || []).map((t) => ({ id: t.id, namn: t.namn || "Tavla" })); } catch (e) { }
        return { namn: x.namn || "Projekt", arkiverad: !!x.arkiverad, version: x.version === 2 ? 2 : 1, medlemmar: x.medlemmar || [], lasare: x.lasare || [],
            projektAdmin: x.projektAdmin || [], tavlaBeh: x.tavlaBeh || {}, kod: x.kod || "", visning: x.visning || {}, tavlor: tavlor };
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
    // Projekt i det gamla formatet (hela projektet i ett dokument). Läses bara, tills
    // projektadmin eller huvudadmin har flyttat det till det nya formatet.
    function lasProjekt(data, lokal) {
        const p = JSON.parse(data);
        rustaProjekt(p, IDAG);
        if (lokal) return p;
        // tavlor utan åtkomst plockas bort (men minst en tavla blir kvar, som bara går att läsa)
        let dolda = p.tavlor.filter((t) => tavlaRatt(p.id, t.id) === "ingen");
        if (dolda.length === p.tavlor.length) dolda = dolda.slice(1);
        if (dolda.length) {
            const bort = new Set(dolda.map((t) => t.id));
            p.tavlor = p.tavlor.filter((t) => !bort.has(t.id));
            if (!p.tavlor.some((t) => t.id === p.aktiv)) p.aktiv = p.tavlor[0].id;
        }
        return p;
    }
    function markeraSynkad(p) { lasBasis.set(p.id, innehall(p)); }

    // ---------- molnformatet: projektet i små delar ----------
    //   projekt/{id}                                  metadata: namn, arkiverad, medlemmar, behörigheter, kod,
    //                                                 tavlor [{ id, namn }] i ordning och version 2
    //   projekt/{id}/delar/bas                        projektets egna delar (inställningar, register, resurser …)
    //   projekt/{id}/delar/logo                       logotypen
    //   projekt/{id}/tavlor/{tid}/poster/_tavla       tavlans egna delar (namn, dagsläge …)
    //   projekt/{id}/tavlor/{tid}/poster/kort_{id}    ett kort (likadant för hinder, historik och aterkom)
    // Varje del har { data, pos, rev, andrad, borttagen }. rev ökar med ett per ändring och reglerna
    // kräver det, så två samtidiga ändringar av samma del upptäcks. Borttagna delar ligger kvar med
    // borttagen = true, så att den som bara hämtar det som ändrats sedan sist ser borttagningen.
    // En tavla med Ingen åtkomst går inte att läsa alls: reglerna stoppar det.
    const SAMLINGAR = ["kort", "hinder", "historik", "aterkom"];
    const MAX_DEL = 900000;                   // Firestore tillåter högst 1 MiB per dokument
    const MARGINAL = 60000;                   // ms: "ändrat sedan" hämtar lite extra bakåt
    const arV2 = (pid) => { const m = projektMeta.get(pid); return !!(m && m.version === 2); };
    const kanda = (pid) => !!(moln.delar[pid] || pid in moln.v1);
    const docNamn = (id) => String(id).replace(/[\/\s.]/g, "_");
    // Dagböckerna ligger i en egen samling, projekt/{id}/dagbok/{dagbok}. Äldre versioner av appen
    // känner inte till den och kan därför aldrig råka ta bort en dagbok.
    const DBN = "dagbok:";
    const arDbNyckel = (key) => key.indexOf(DBN) === 0;
    const nyckelFor = (coll, id) => coll === "delar" ? id : coll === "dagbok" ? DBN + id : coll + "/" + id;
    function delRef(pid, key) {
        if (arDbNyckel(key)) return fb.fs.doc(fb.db, "projekt", pid, "dagbok", key.slice(DBN.length));
        if (key.indexOf("/") < 0) return fb.fs.doc(fb.db, "projekt", pid, "delar", key);
        const i = key.indexOf("/");
        return fb.fs.doc(fb.db, "projekt", pid, "tavlor", key.slice(0, i), "poster", key.slice(i + 1));
    }
    const delSamling = (pid, coll) => coll === "delar" ? fb.fs.collection(fb.db, "projekt", pid, "delar")
        : coll === "dagbok" ? fb.fs.collection(fb.db, "projekt", pid, "dagbok")
        : fb.fs.collection(fb.db, "projekt", pid, "tavlor", coll, "poster");
    const kopiaDoc = (pid) => fb.fs.doc(fb.db, "projektkopior", pid);
    const msAv = (t) => t && typeof t.toMillis === "function" ? t.toMillis() : 0;

    // Varje post behöver ett eget id för att bli ett eget dokument.
    function sakerstallIds(p) {
        p.tavlor.forEach((t) => SAMLINGAR.forEach((s) => {
            const sedda = new Set();
            (t[s] || []).forEach((x) => {
                if (!x || typeof x !== "object") return;
                if (x.id === undefined || x.id === null || x.id === "" || sedda.has(docNamn(x.id))) x.id = uid();
                sedda.add(docNamn(x.id));
            });
        }));
    }
    // Hela projektet → delar (nyckel → JSON-text) och deras position i listan.
    function dela(p) {
        const delar = new Map(), pos = new Map();
        const x = JSON.parse(innehall(p));
        const logo = x.logotyp, tavlor = x.tavlor || [], dagbok = Array.isArray(x.dagbok) ? x.dagbok : [];
        delete x.logotyp; delete x.tavlor; delete x.dagbok;
        delar.set("bas", JSON.stringify(x));
        // varje dagbok är en egen del, så att den aldrig försvinner och inte krockar med andra
        dagbok.forEach((d) => { if (d && d.id) delar.set(DBN + docNamn(d.id), JSON.stringify(d)); });
        if (logo) delar.set("logo", JSON.stringify(logo));
        tavlor.forEach((t, i) => {
            SAMLINGAR.forEach((s) => {
                (t[s] || []).forEach((it, j) => {
                    if (!it || typeof it !== "object") return;
                    const key = t.id + "/" + s + "_" + docNamn(it.id);
                    delar.set(key, JSON.stringify(it)); pos.set(key, j);
                });
                delete t[s];
            });
            delar.set(t.id + "/_tavla", JSON.stringify(t)); pos.set(t.id + "/_tavla", i);
        });
        return { delar, pos };
    }
    // Delar → hela projektet. Ordningen följer den lokala kopian (gammal) så långt det går,
    // tavlorna följer projektets tavellista och nya poster hamnar efter sin position.
    function bygg(pid, L, gammal, pos) {
        if (!L.has("bas")) return null;
        let p;
        try { p = JSON.parse(L.get("bas")); } catch (e) { return null; }
        p.id = pid;
        try { p.logotyp = L.has("logo") ? JSON.parse(L.get("logo")) : null; } catch (e) { p.logotyp = null; }
        const tav = new Map();
        p.dagbok = [];
        for (const [key, data] of L) {
            const i = key.indexOf("/");
            if (i < 0) {
                // dagbok_… i delar/ är det tidigare sättet: flyttas till dagbok/ vid nästa uppladdning
                if (arDbNyckel(key) || key.indexOf("dagbok_") === 0) {
                    try {
                        const d = JSON.parse(data), i = d && d.id ? p.dagbok.findIndex((x) => x.id === d.id) : -2;
                        if (i === -1) p.dagbok.push(d); else if (i >= 0 && arDbNyckel(key)) p.dagbok[i] = d;
                    } catch (e) { }
                }
                continue;
            }
            const tid = key.slice(0, i), namn = key.slice(i + 1);
            if (!tav.has(tid)) tav.set(tid, { t: null, s: {} });
            const e = tav.get(tid);
            if (namn === "_tavla") { e.t = data; continue; }
            const s = namn.slice(0, namn.indexOf("_"));
            if (SAMLINGAR.includes(s)) (e.s[s] = e.s[s] || []).push({ key, data });
        }
        const meta = projektMeta.get(pid);
        const gt = new Map(((gammal && gammal.tavlor) || []).map((t, i) => [t.id, { t, i }]));
        const mo = new Map(((meta && meta.tavlor) || []).map((t, i) => [t.id, i]));
        const plats = (tid) => mo.has(tid) ? mo.get(tid) : gt.has(tid) ? 1e6 + gt.get(tid).i : 2e6 + (pos.get(tid + "/_tavla") || 0);
        const ordning = [...tav.keys()].filter((tid) => tav.get(tid).t).sort((a, b) => plats(a) - plats(b));
        const tavlor = [];
        ordning.forEach((tid) => {
            const e = tav.get(tid), g = gt.has(tid) ? gt.get(tid).t : null;
            let t;
            try { t = JSON.parse(e.t); } catch (err) { return; }
            t.id = tid;
            SAMLINGAR.forEach((s) => {
                const lista = [];
                (e.s[s] || []).forEach((x) => { try { lista.push({ obj: JSON.parse(x.data), key: x.key }); } catch (err) { } });
                const gi = new Map(((g && g[s]) || []).map((it, i) => [it && it.id, i]));
                const nyForst = s === "historik";           // historiken har de nyaste raderna först
                const idx = (x) => gi.has(x.obj.id) ? gi.get(x.obj.id) : null;
                lista.sort((a, b) => {
                    const ia = idx(a), ib = idx(b);
                    if (ia !== null && ib !== null) return ia - ib;
                    if (ia === null && ib === null) {
                        if (nyForst) { const d = String(b.obj.tid || "").localeCompare(String(a.obj.tid || "")); if (d) return d; }
                        return (pos.get(a.key) || 0) - (pos.get(b.key) || 0);
                    }
                    return (ia === null) === nyForst ? -1 : 1;
                });
                t[s] = lista.map((x) => x.obj);
            });
            tavlor.push(t);
        });
        if (!tavlor.length) return null;
        p.tavlor = tavlor;
        p.aktiv = gammal && tavlor.some((t) => t.id === gammal.aktiv) ? gammal.aktiv : tavlor[0].id;
        rustaProjekt(p, IDAG);
        return p;
    }
    // Får jag ändra den här delen? Reglerna kontrollerar samma sak.
    function tillat(pid, key) {
        if (arAdmin()) return true;
        if (key.indexOf("/") < 0) return !arLas(pid);
        const r = tavlaRatt(pid, key.slice(0, key.indexOf("/")));
        return r === "admin" || r === "red";
    }
    // De delar som ändrats lokalt sedan senaste synk (som jag får spara).
    const andCache = new Map();
    let basVersion = 0;                       // ökas när molnets baslinje ändras
    function andringar(p) {
        const b = moln.delar[p.id];
        if (!b) return [];
        sakerstallIds(p);
        const j = projektJson(p), c = andCache.get(p.id);
        if (c && c.j === j && c.v === basVersion) return c.ut;
        const k = konflikter.get(p.id), iKonflikt = (key) => !!(k && k.delar && k.delar.has(key));
        const { delar: L, pos } = dela(p), ut = [];
        for (const [key, data] of L) {
            const bb = b[key], h = hash(data);
            if (bb && bb[1] === h) continue;
            if (iKonflikt(key) || !tillat(p.id, key)) continue;
            ut.push({ key, rev: (bb ? bb[0] : 0) + 1, h, falt: { data, pos: pos.get(key) || 0, borttagen: false } });
        }
        Object.keys(b).forEach((key) => {
            if (b[key][1] === null || L.has(key) || iKonflikt(key) || !tillat(p.id, key)) return;
            ut.push({ key, rev: b[key][0] + 1, h: null, falt: { data: "", pos: 0, borttagen: true } });
        });
        andCache.set(p.id, { j, v: basVersion, ut });
        return ut;
    }
    // Tavellistan i metadata: mina tavlor i min ordning, tavlor jag inte ser (eller inte hämtat än) på sina platser.
    function tavelLista(pid, p) {
        const m = projektMeta.get(pid), b = moln.delar[pid] || {};
        const lokala = p.tavlor.map((t) => ({ id: t.id, namn: t.namn || "Tavla" }));
        const lok = new Set(lokala.map((t) => t.id));
        const ut = [];
        let i = 0;
        ((m && m.tavlor) || []).forEach((e) => {
            if (lok.has(e.id)) { if (i < lokala.length) ut.push(lokala[i++]); }
            else if (!(b[e.id + "/_tavla"] !== undefined && tavlaRatt(pid, e.id) !== "ingen")) ut.push({ id: e.id, namn: e.namn || "Tavla" });
        });
        while (i < lokala.length) ut.push(lokala[i++]);
        return ut;
    }
    const tavelnamn = (p) => JSON.stringify(p.tavlor.map((t) => t.namn || "Tavla"));
    const metaBas = (p) => ({ n: p.projekt, a: !!p.arkiverad, o: JSON.stringify(p.tavlor.map((t) => t.id)), t: tavelnamn(p) });
    // Ändrat namn, arkivering eller tavellista som ska upp i metadata.
    function metaAndring(p) {
        const m = projektMeta.get(p.id);
        if (!m || m.version !== 2 || arLas(p.id)) return null;
        const bas = moln.meta[p.id] || {}, ny = metaBas(p);
        if (bas.n === ny.n && bas.a === ny.a && bas.o === ny.o && bas.t === ny.t) return null;
        const falt = {}, lista = tavelLista(p.id, p);
        if (m.namn !== p.projekt) falt.namn = p.projekt;
        if (!!m.arkiverad !== !!p.arkiverad) falt.arkiverad = !!p.arkiverad;
        if (JSON.stringify(m.tavlor || []) !== JSON.stringify(lista)) falt.tavlor = lista;
        return { falt, bas: ny };
    }
    // Någon annan har ändrat tavlornas ordning: följ den om jag inte själv ändrat ordningen.
    function foljTavelordning(pid) {
        const p = plan4.projekt.find((x) => x.id === pid), m = projektMeta.get(pid), bas = moln.meta[pid];
        if (!p || !m || m.version !== 2 || !bas) return false;
        const har = new Set(p.tavlor.map((t) => t.id));
        const rem = (m.tavlor || []).map((t) => t.id).filter((id) => har.has(id));
        const lok = JSON.stringify(p.tavlor.map((t) => t.id));
        if (lok !== bas.o || JSON.stringify(rem) === JSON.stringify([...har].filter((id) => rem.includes(id)))) return false;
        const idx = new Map(rem.map((id, i) => [id, i]));
        const fore = lok;
        p.tavlor.sort((a, b) => (idx.has(a.id) ? idx.get(a.id) : 1e6) - (idx.has(b.id) ? idx.get(b.id) : 1e6));
        bas.o = JSON.stringify(p.tavlor.map((t) => t.id));
        return bas.o !== fore;
    }

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

    const harNagonAdminroll = () => arAdmin() || [...projektMeta.keys()].some((id) => arProjektAdmin(id));
    function rollTagg(pid) {
        const b = minBeh(pid);
        if (b.roll === "huvud") return "";
        const t = Object.values(b.tavlor);
        return (b.roll === "admin" ? ' <span class="p4-ks-tagg admin">Projektadmin</span>' : b.roll === "las" ? ' <span class="p4-ks-tagg">Bara läsa</span>' : "") +
            (b.roll !== "admin" && t.includes("admin") ? ' <span class="p4-ks-tagg admin">Tavleadmin</span>' : "") +
            (b.roll !== "admin" && t.includes("ingen") ? ' <span class="p4-ks-tagg">Vissa tavlor dolda</span>' : "");
    }

    // ---------- hämta från molnet ----------
    // Läser alla delar i ett projekt (de tavlor jag ser). Används första gången projektet hämtas till datorn.
    async function hamtaDelar(pid) {
        const delar = new Map(), pos = new Map(), tid = {}, b = {};
        const las = async (coll) => {
            const s = await fb.fs.getDocs(delSamling(pid, coll));
            let max = 0;
            s.docs.forEach((d) => {
                const x = d.data(), key = nyckelFor(coll, d.id);
                b[key] = [x.rev || 0, x.borttagen ? null : hash(x.data || "")];
                if (!x.borttagen) { delar.set(key, x.data || ""); pos.set(key, x.pos || 0); }
                max = Math.max(max, msAv(x.andrad));
            });
            tid[coll] = max;
        };
        await Promise.all([las("delar"), las("dagbok").catch(() => { })].concat(synligaTavlor(pid).map(las)));
        return { delar, pos, tid, b };
    }
    // Ett hämtat projekt blir den lokala kopian.
    function anvandHamtat(pid, h, gammal) {
        const p = bygg(pid, h.delar, gammal, h.pos);
        if (!p) return null;
        moln.delar[pid] = h.b;
        moln.tid[pid] = h.tid;
        moln.meta[pid] = metaBas(p);
        delete moln.v1[pid];
        markeraSynkad(p);
        return p;
    }
    // Hämtar alla projekt i listan (nya formatet delvis, gamla formatet ur dokumentet).
    async function hamtaAlla(dokument) {
        const ut = [];
        for (const d of dokument) {
            if (d.version === 2) {
                const h = await hamtaDelar(d.id);
                const p = anvandHamtat(d.id, h, null);
                if (p) ut.push(p);
            } else if (typeof d.data === "string") {
                try { const p = lasProjekt(d.data); moln.v1[d.id] = d.rev || 0; markeraSynkad(p); ut.push(p); }
                catch (e) { console.warn("Wimo: kunde inte läsa " + d.id, e); }
            }
        }
        return ut;
    }

    // Läser in molnets projekt som hela Wimo (ersätter det lokala).
    function anvandMolnet(projekt, aktivt) {
        if (!projekt.length) return false;
        angraForeAvbryt();
        laddaRot({ version: VERSION, aktivtProjekt: aktivt || null, projekt: projekt });
        sparaMoln();
        vyOffset = 0; valdKedja = null; VADER = {};
        ursSparaNu();
        rita();
        return true;
    }
    // Sätter in ett projekt (nytt eller ersätter den lokala kopian).
    function sattIn(ny) {
        const id = ny.id, i = plan4.projekt.findIndex((p) => p.id === id);
        const gammal = i >= 0 ? plan4.projekt[i] : null;
        if (i >= 0) plan4.projekt[i] = ny; else plan4.projekt.push(ny);
        if (state === gammal || state.id === id) { angraForeAvbryt(); state = ny; valdKedja = null; }
        // ett tomt reservprojekt (när användaren saknade projekt) behövs inte längre
        const reserv = plan4.projekt.findIndex((p) => p.id !== id && !kanda(p.id) && !projektMeta.has(p.id) && !arAdmin() && arTomt(p));
        if (reserv >= 0) { const r = plan4.projekt[reserv]; plan4.projekt.splice(reserv, 1); if (state.id === r.id) state = ny; }
    }
    function arTomt(p) {
        const poster = p.tavlor.reduce((n, t) => n + t.kort.length + t.hinder.length + t.aterkom.length, 0);
        return !poster && !fAktiviteter(p).length && !p.resurser.personer.length && !p.resurser.kategorier.length && !p.foretag.length;
    }
    // Projekt i gamla formatet: byt ut den lokala kopian mot molnets.
    function ersattV1(id, data, rev) {
        let ny;
        try { ny = lasProjekt(data); } catch (e) { return; }
        sattIn(ny);
        moln.v1[id] = rev;
        markeraSynkad(ny);
        sparaMoln();
        ursSparaNu();
        rita();
        kontrolleraTillgang();
    }
    function glomProjekt(id) {
        delete moln.delar[id]; delete moln.tid[id]; delete moln.meta[id]; delete moln.v1[id];
        andCache.delete(id); lasBasis.delete(id);
        sparaMoln();
    }
    function taBortLokalt(id) {
        const i = plan4.projekt.findIndex((p) => p.id === id);
        glomProjekt(id);
        if (i < 0) return;
        plan4.projekt.splice(i, 1);
        if (!plan4.projekt.length) {
            const p = nyttProjekt("Projekt", "Produktion", IDAG);
            rustaProjekt(p, IDAG);
            p.reserv = true;            // tomt reservprojekt: laddas inte upp så länge det är tomt
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
    const skickat = new Map();     // "projekt|del" → rev som skickats (ekot från molnet hoppas över)
    let aktivtSkrivet;             // senast sparade aktiva projekt i användardokumentet

    async function push() {
        if (!anvandare || !synkKlar) return;
        if (pushPagar) { pushIgen = true; return; }
        pushPagar = true;
        let fel = null;
        try {
            for (const p of plan4.projekt.slice()) await pushProjekt(p);
            planeraSkarmar();
            // projekt som admin raderat permanent här tas bort i molnet
            if (arAdmin()) {
                const lokala = new Set(plan4.projekt.map((p) => p.id));
                for (const id of Object.keys(moln.delar).concat(Object.keys(moln.v1))) {
                    if (lokala.has(id) || konflikter.has(id)) continue;
                    await raderaIMolnet(id);
                }
            }
            const aktivt = plan4.aktivtProjekt || null;
            if (aktivt !== aktivtSkrivet) {
                await fb.fs.setDoc(anvDoc(), { epost: anvandare.email || "", aktivtProjekt: aktivt, uppdaterad: fb.fs.serverTimestamp() }, { merge: true });
                aktivtSkrivet = aktivt;
            }
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

    // Laddar upp de delar av ett projekt som ändrats. Ett nytt projekt skapas med metadata,
    // projektkod och alla delar; det första paketet skrivs i ett svep.
    async function pushProjekt(p) {
        const pid = p.id, m = projektMeta.get(pid);
        if (!kanSkriva(p)) return;
        const ny = !m && !moln.delar[pid] && !kanda(pid);
        if (ny && !kanSkapaProjekt()) return;                     // bara den som får skapa projekt lägger till nya
        if (ny && p.reserv) { if (arTomt(p)) return; delete p.reserv; }   // reservprojektet laddas upp först när det fått innehåll
        if (!ny && (!m || m.version !== 2 || !moln.delar[pid])) return;   // gamla formatet: flyttas av projektadmin först
        let ops;
        if (ny) {
            sakerstallIds(p);
            const { delar: L, pos } = dela(p);
            ops = [...L].map(([key, data]) => ({ key, rev: 1, h: hash(data), falt: { data, pos: pos.get(key) || 0, borttagen: false } }));
        } else ops = andringar(p).slice();
        const stor = ops.filter((o) => o.falt.data.length > MAX_DEL);
        if (stor.length) {
            status("En del av " + p.projekt + " är för stor för molnet och sparas bara på den här datorn", true);
            ops = ops.filter((o) => o.falt.data.length <= MAX_DEL);
        }
        const metaOp = ny ? null : metaAndring(p);
        if (!ops.length && !metaOp) return;
        const b = ny ? {} : moln.delar[pid];
        const skriv = (bt, o) => bt.set(delRef(pid, o.key), Object.assign({ rev: o.rev, andrad: fb.fs.serverTimestamp() }, o.falt));
        for (let i = 0; i < ops.length || (ny && i === 0); i += 400) {
            const del = ops.slice(i, i + 400), bt = fb.fs.writeBatch(fb.db);
            if (ny && i === 0) {
                const kod = nyKod();
                bt.set(projektDoc(pid), { namn: p.projekt, arkiverad: !!p.arkiverad, version: 2, enhet: ENHET,
                    tavlor: p.tavlor.map((t) => ({ id: t.id, namn: t.namn || "Tavla" })),
                    medlemmar: [anvandare.uid], lasare: [], tavlaBeh: {}, kod: kod,
                    // den som skapar ett projekt utan att vara huvudadmin blir projektadmin i det
                    projektAdmin: arAdmin() ? [] : [anvandare.uid], andrad: fb.fs.serverTimestamp() });
                bt.set(kodDoc(kod), { projekt: pid, namn: p.projekt });
            }
            del.forEach((o) => { skriv(bt, o); skickat.set(pid + "|" + o.key, o.rev); });
            try {
                await bt.commit();
                del.forEach((o) => { b[o.key] = [o.rev, o.h]; });
                if (ny && i === 0) {
                    moln.delar[pid] = b; moln.tid[pid] = {}; moln.meta[pid] = metaBas(p); moln.uid = anvandare.uid;
                    // ett riktigt projekt finns nu: det tomma reservprojektet behövs inte, och lobbyn öppnar appen
                    const reserv = plan4.projekt.filter((x) => x.id !== pid && x.reserv && arTomt(x) && !kanda(x.id));
                    if (reserv.length) {
                        plan4.projekt = plan4.projekt.filter((x) => reserv.indexOf(x) < 0);
                        if (reserv.indexOf(state) >= 0) { state = p; plan4.aktivtProjekt = p.id; }
                        ursSparaNu(); rita();
                    }
                    setTimeout(kontrolleraTillgang, 0);
                }
            } catch (e) {
                if (!e || e.code !== "permission-denied") { sparaMoln(); throw e; }
                del.forEach((o) => skickat.delete(pid + "|" + o.key));
                if (ny && i === 0) return;                         // fick inte skapa projektet
                await enOchEn(pid, del, b);
            }
            sparaMoln();
        }
        if (metaOp) {
            try {
                if (Object.keys(metaOp.falt).length)
                    await fb.fs.updateDoc(projektDoc(pid), Object.assign({ andrad: fb.fs.serverTimestamp(), enhet: ENHET }, metaOp.falt));
                moln.meta[pid] = metaOp.bas;
                sparaMoln();
            } catch (e) { if (!e || e.code !== "permission-denied") throw e; }
        }
    }
    // Ett paket nekades: skriv delarna en och en och se vilka som ändrats av någon annan.
    async function enOchEn(pid, ops, b) {
        const krockar = [];
        for (const o of ops) {
            try {
                skickat.set(pid + "|" + o.key, o.rev);
                await fb.fs.setDoc(delRef(pid, o.key), Object.assign({ rev: o.rev, andrad: fb.fs.serverTimestamp() }, o.falt));
                b[o.key] = [o.rev, o.h];
            } catch (e) {
                skickat.delete(pid + "|" + o.key);
                if (!e || e.code !== "permission-denied") throw e;
                let d;
                try { d = await fb.fs.getDoc(delRef(pid, o.key)); } catch (e2) { continue; }   // ingen åtkomst längre
                if (!d.exists()) { delete b[o.key]; continue; }      // finns inte: skapas på nytt nästa gång
                const x = d.data(), mh = x.borttagen ? null : hash(x.data || "");
                if (mh === o.h) { b[o.key] = [x.rev || 0, mh]; continue; }   // samma innehåll
                krockar.push({ key: o.key, rev: x.rev || 0, data: x.data || "", pos: x.pos || 0, borttagen: !!x.borttagen });
            }
        }
        if (krockar.length) registreraKonflikter(pid, krockar);
    }
    // Huvudadmin har raderat projektet: ta bort det och alla dess delar i molnet.
    async function raderaIMolnet(id) {
        const keys = Object.keys(moln.delar[id] || {});
        const kod = (projektMeta.get(id) || {}).kod;
        for (let i = 0; i < keys.length; i += 400) {
            const bt = fb.fs.writeBatch(fb.db);
            keys.slice(i, i + 400).forEach((key) => bt.delete(delRef(id, key)));
            await bt.commit();
        }
        if (kod) await fb.fs.deleteDoc(kodDoc(kod)).catch(() => { });
        await fb.fs.deleteDoc(projektDoc(id));
        glomProjekt(id);
    }

    // ---------- konflikter ----------
    // Samma del (ett kort, ett hinder …) har ändrats både här och någon annanstans.
    function registreraKonflikter(id, lista) {
        const p = plan4.projekt.find((x) => x.id === id);
        const k = konflikter.get(id) || { namn: p ? p.projekt : "", delar: new Map(), borttagen: false };
        lista.forEach((r) => k.delar.set(r.key, r));
        konflikter.set(id, k);
        lage = "konflikt";
        uppdateraUI();
    }
    function registreraBorttaget(id, namn) {
        konflikter.set(id, { namn: namn, delar: new Map(), borttagen: true });
        lage = "konflikt";
        uppdateraUI();
    }
    function losKonflikt(id, behallMin) {
        const k = konflikter.get(id);
        if (!k) return;
        konflikter.delete(id);
        if (k.borttagen) {
            if (behallMin) glomProjekt(id);              // laddas upp som ett nytt projekt
            else taBortLokalt(id);
        } else if (behallMin) {
            // nästa uppladdning skriver över molnets version av just de delarna
            const b = moln.delar[id] || {};
            k.delar.forEach((r, key) => { b[key] = [r.rev, "konflikt"]; });
            moln.delar[id] = b;
            sparaMoln();
        } else {
            const ink = inkFor(id);
            ink.tvinga = true;
            k.delar.forEach((r, key) => ink.delar.set(key, r));
            tillampaVantande();
        }
        lage = konflikter.size ? "konflikt" : "synkad";
        uppdateraUI();
        schemalaggPush(100);
    }

    // ---------- ändringar från andra enheter ----------
    // Metadata för projekten lyssnas på som förut. För varje projekt i nya formatet lyssnar vi
    // dessutom på delar och på varje tavla jag ser, men bara på det som ändrats sedan sist.
    const inkommande = new Map();     // projektId → { delar: Map(nyckel → del), tider: { samling: ms }, rensa: Set(tid) }
    const vantandeBort = new Map();   // projektId → namn (åtkomsten är borta)
    const vantandeV1 = new Map();     // projektId → { data, rev } i gamla formatet
    const vantandeHela = new Map();   // projektId → hämtat projekt som ska sättas in
    const v1Data = new Map();         // projektId → { data, rev } för flytten till nya formatet
    const delLyss = new Map();        // "projekt|samling" → avregistrering
    const vantande = { get size() { return inkommande.size + vantandeBort.size + vantandeV1.size + vantandeHela.size; } };
    function rensaVantande() { inkommande.clear(); vantandeBort.clear(); vantandeV1.clear(); vantandeHela.clear(); skickat.clear(); }
    function inkFor(pid) {
        if (!inkommande.has(pid)) inkommande.set(pid, { delar: new Map(), tider: {}, rensa: new Set() });
        return inkommande.get(pid);
    }
    function synligaTavlor(pid) {
        const m = projektMeta.get(pid);
        return ((m && m.tavlor) || []).map((t) => t.id).filter((tid) => arAdmin() || tavlaRatt(pid, tid) !== "ingen");
    }
    function lyssna() {
        if (lyssnare) lyssnare();
        lyssnare = fb.fs.onSnapshot(projektFraga(), (snap) => {
            if (arAdmin()) { lasMeta(snap.docs); if (kontoOppen()) { ritaSynkkort(); ritaAdmin(); } if (gruppFel) startaAnsokningar(); if (synkKlar) skapaSaknadeKoder(); }
            else uppdateraBeh(snap.docs.map((d) => Object.assign({ id: d.id }, d.data())));
            samlaAnsokningar();
            snap.docChanges().forEach((c) => {
                const id = c.doc.id, d = c.doc.data();
                if (c.type === "removed") {
                    v1Data.delete(id);
                    if (!kanda(id)) return;
                    const p = plan4.projekt.find((x) => x.id === id);
                    // borttagen ur projektet (eller projektet raderat): åtkomsten är borta
                    if (arAdmin() && p && arAndrad(p)) registreraBorttaget(id, p.projekt);
                    else vantandeBort.set(id, p ? p.projekt : "");
                    return;
                }
                if (d.version !== 2) {
                    if (typeof d.data !== "string") return;
                    v1Data.set(id, { data: d.data, rev: d.rev || 0 });
                    if ((d.rev || 0) > (moln.v1[id] || 0) || !plan4.projekt.some((x) => x.id === id)) {
                        const p = plan4.projekt.find((x) => x.id === id);
                        if (!(p && arProjektAdmin(id) && arAndrad(p))) vantandeV1.set(id, { data: d.data, rev: d.rev || 0 });
                    }
                    return;
                }
                v1Data.delete(id);
            });
            let omordnat = false;
            projektMeta.forEach((m, id) => { if (foljTavelordning(id)) omordnat = true; });
            if (omordnat) { sparaMoln(); ursSparaNu(); rita(); }
            synkaDelLyssnare();
            hamtaNya();
            tillampaVantande();
            flyttaTillV2();
        }, (e) => { console.warn("Wimo molnlyssnare:", e); lage = "offline"; uppdateraUI(); });
    }
    // Startar och stoppar lyssnarna på delarna så att de följer projekten och tavlorna jag ser.
    function synkaDelLyssnare() {
        if (!anvandare || !fb) return;
        const vill = new Map();
        projektMeta.forEach((m, pid) => {
            if (m.version !== 2 || !moln.delar[pid]) return;
            vill.set(pid + "|delar", [pid, "delar"]);
            vill.set(pid + "|dagbok", [pid, "dagbok"]);
            synligaTavlor(pid).forEach((tid) => vill.set(pid + "|" + tid, [pid, tid]));
        });
        for (const [k, av] of delLyss) {
            if (vill.has(k)) continue;
            av(); delLyss.delete(k);
            const [pid, coll] = k.split("|");
            // tavlan syns inte längre för mig: den tas bort från datorn
            if (coll !== "delar" && coll !== "dagbok" && projektMeta.has(pid) && moln.delar[pid]) inkFor(pid).rensa.add(coll);
        }
        for (const [k, [pid, coll]] of vill) if (!delLyss.has(k)) startaDelLyss(pid, coll);
    }
    function stoppaDelLyssnare() {
        delLyss.forEach((av) => av());
        delLyss.clear();
    }
    function startaDelLyss(pid, coll) {
        const T = (moln.tid[pid] || {})[coll] || 0;
        const samling = delSamling(pid, coll);
        const q = T ? fb.fs.query(samling, fb.fs.where("andrad", ">", fb.fs.Timestamp.fromMillis(Math.max(0, T - MARGINAL)))) : samling;
        delLyss.set(pid + "|" + coll, fb.fs.onSnapshot(q, (snap) => {
            const ink = inkFor(pid);
            snap.docChanges().forEach((c) => {
                if (c.type === "removed" || c.doc.metadata.hasPendingWrites) return;
                const x = c.doc.data(), key = nyckelFor(coll, c.doc.id);
                const fore = ink.delar.get(key), rev = x.rev || 0;
                if (!fore || rev > fore.rev) ink.delar.set(key, { key, rev, data: x.data || "", pos: x.pos || 0, borttagen: !!x.borttagen });
                ink.tider[coll] = Math.max(ink.tider[coll] || 0, msAv(x.andrad));
            });
            if (!ink.delar.size && !ink.rensa.size && !Object.keys(ink.tider).length) inkommande.delete(pid);
            tillampaVantande();
        }, (e) => { console.warn("Wimo molnlyssnare (" + coll + "):", e); delLyss.delete(pid + "|" + coll); }));
    }
    // Projekt jag nyss fått tillgång till (eller som just flyttats till nya formatet) hämtas i sin helhet.
    const hamtas = new Set();
    function hamtaNya() {
        projektMeta.forEach((m, pid) => {
            if (m.version !== 2 || moln.delar[pid] || hamtas.has(pid)) return;
            if (plan4.projekt.some((p) => p.id === pid) && !kanda(pid)) return;   // mitt nya projekt som just skapas
            hamtas.add(pid);
            hamtaDelar(pid).then((h) => {
                hamtas.delete(pid);
                if (!anvandare || !projektMeta.has(pid) || moln.delar[pid]) return;
                vantandeHela.set(pid, h);
                tillampaVantande();
            }).catch((e) => { hamtas.delete(pid); console.warn("Wimo hämtning:", e); });
        });
    }
    function tillampaVantande() {
        if (!vantande.size) return;
        if (dialogOppen()) { uppdateraUI(); return; }
        const borta = [];
        let andrat = false;
        for (const [id, namn] of vantandeBort) { taBortLokalt(id); if (namn) borta.push(namn); }
        vantandeBort.clear();
        for (const [id, v] of vantandeV1) ersattV1(id, v.data, v.rev);
        vantandeV1.clear();
        for (const [id, h] of vantandeHela) {
            const gammal = plan4.projekt.find((p) => p.id === id) || null;
            const p = anvandHamtat(id, h, gammal);
            if (p) { sattIn(p); andrat = true; }
        }
        vantandeHela.clear();
        for (const [id, ink] of [...inkommande]) {
            inkommande.delete(id);
            if (tillampaDelar(id, ink)) andrat = true;
        }
        if (andrat) {
            moln.uid = anvandare.uid;
            sparaMoln();
            ursSparaNu();
            rita();
            kontrolleraTillgang();
            status(borta.length ? "Du har inte längre tillgång till " + borta.join(", ") : "Uppdaterat");
            schemalaggPush();
        } else if (borta.length) status("Du har inte längre tillgång till " + borta.join(", "));
        synkaDelLyssnare();
        uppdateraUI();
    }
    // För in andras ändringar i den lokala kopian. Det jag själv ändrat och inte laddat upp
    // ligger kvar; har samma del ändrats på båda ställena blir det en konflikt för just den delen.
    function tillampaDelar(pid, ink) {
        const m = projektMeta.get(pid), b = moln.delar[pid];
        if (!m || m.version !== 2 || !b) return false;
        const i0 = plan4.projekt.findIndex((x) => x.id === pid);
        if (i0 < 0) return false;
        const gammal = plan4.projekt[i0];
        sakerstallIds(gammal);
        const { delar: L, pos } = dela(gammal);
        let andrat = false;
        ink.rensa.forEach((tid) => {
            for (const key of [...L.keys()]) if (key.startsWith(tid + "/")) { L.delete(key); andrat = true; }
            Object.keys(b).forEach((key) => { if (key.startsWith(tid + "/")) delete b[key]; });
            if (moln.tid[pid]) delete moln.tid[pid][tid];
        });
        const krockar = [];
        for (const [key, r] of ink.delar) {
            if (ink.rensa.has(key.split("/")[0]) && key.indexOf("/") > 0) continue;
            const bb = b[key], brev = bb ? bb[0] : 0;
            if (!ink.tvinga && (r.rev <= brev || (skickat.get(pid + "|" + key) || 0) >= r.rev)) continue;
            const lokal = L.has(key) ? hash(L.get(key)) : null, bas = bb ? bb[1] : null, mh = r.borttagen ? null : hash(r.data);
            if (!ink.tvinga && lokal !== bas && lokal !== mh) { krockar.push(r); continue; }
            if (r.borttagen) L.delete(key); else { L.set(key, r.data); pos.set(key, r.pos); }
            b[key] = [r.rev, mh];
            if (lokal !== mh) andrat = true;
        }
        if (krockar.length) registreraKonflikter(pid, krockar);
        else if (ink.tvinga) { const k = konflikter.get(pid); if (k && !k.delar.size) konflikter.delete(pid); }
        const tider = moln.tid[pid] = moln.tid[pid] || {};
        Object.keys(ink.tider).forEach((c) => { if (!ink.rensa.has(c)) tider[c] = Math.max(tider[c] || 0, ink.tider[c]); });
        if (!andrat) { sparaMoln(); return false; }
        const ny = bygg(pid, L, gammal, pos);
        if (!ny) {
            // inga tavlor kvar som jag ser: projektet tas bort från datorn
            vantandeBort.set(pid, gammal.projekt);
            return false;
        }
        sattIn(ny);
        const bas = moln.meta[pid];
        if (bas && bas.o === JSON.stringify(gammal.tavlor.map((t) => t.id))) bas.o = JSON.stringify(ny.tavlor.map((t) => t.id));
        if (bas && bas.n === gammal.projekt) bas.n = ny.projekt;
        if (bas && bas.a === !!gammal.arkiverad) bas.a = !!ny.arkiverad;
        if (bas && bas.t === tavelnamn(gammal)) bas.t = tavelnamn(ny);
        markeraSynkad(ny);
        return true;
    }
    // en väntande uppdatering tillämpas när dialogen stängs
    const ursStangModal = stangModal;
    stangModal = function () { ursStangModal.apply(this, arguments); setTimeout(tillampaVantande, 0); };

    // ---------- flytt till nya formatet ----------
    // Projektadmin eller huvudadmin delar upp ett projekt i gamla formatet i små delar.
    // Hela gamla versionen sparas som kopia i projektkopior/{id}.
    let flyttPagar = false;
    async function flyttaTillV2() {
        if (flyttPagar || !synkKlar || !anvandare) return;
        const lista = [...v1Data.keys()].filter((id) => projektMeta.has(id) && !arV2(id) && arProjektAdmin(id));
        if (!lista.length) return;
        flyttPagar = true;
        try { for (const id of lista) await flyttaProjekt(id).catch((e) => console.warn("Wimo flytt av " + id + ":", e)); }
        finally { flyttPagar = false; }
    }
    async function flyttaProjekt(pid) {
        const v = v1Data.get(pid);
        if (!v) return;
        const full = JSON.parse(v.data);
        full.id = pid;
        rustaProjekt(full, IDAG);
        sakerstallIds(full);
        const { delar: L, pos } = dela(full);
        const keys = [...L.keys()];
        for (let i = 0; i < keys.length; i += 400) {
            const bt = fb.fs.writeBatch(fb.db);
            keys.slice(i, i + 400).forEach((key) => bt.set(delRef(pid, key),
                { data: L.get(key), pos: pos.get(key) || 0, rev: 1, andrad: fb.fs.serverTimestamp(), borttagen: false }));
            await bt.commit();
        }
        const lista = full.tavlor.map((t) => ({ id: t.id, namn: t.namn || "Tavla" }));
        const klart = await fb.fs.runTransaction(fb.db, async (tx) => {
            const s = await tx.get(projektDoc(pid));
            if (!s.exists()) return false;
            const x = s.data();
            if (x.version === 2 || (x.rev || 0) !== v.rev) return false;      // ändrat under tiden: görs om
            tx.set(kopiaDoc(pid), { data: x.data, rev: x.rev || 0, namn: x.namn || "", tid: fb.fs.serverTimestamp(), av: anvandare.uid });
            tx.update(projektDoc(pid), { version: 2, tavlor: lista, data: fb.fs.deleteField(), rev: fb.fs.deleteField(),
                andrad: fb.fs.serverTimestamp(), enhet: ENHET });
            return true;
        });
        if (!klart) return;
        v1Data.delete(pid);
        const b = {};
        L.forEach((data, key) => { b[key] = [1, hash(data)]; });
        moln.delar[pid] = b;
        moln.tid[pid] = {};
        delete moln.v1[pid];
        const m = projektMeta.get(pid);
        if (m) { m.version = 2; m.tavlor = lista; }
        const lokal = plan4.projekt.find((p) => p.id === pid);
        if (lokal) moln.meta[pid] = metaBas(full);
        else {
            const p = bygg(pid, L, null, pos);
            if (p) { moln.meta[pid] = metaBas(p); markeraSynkad(p); sattIn(p); ursSparaNu(); rita(); }
        }
        sparaMoln();
        synkaDelLyssnare();
        schemalaggPush();
    }

    // ---------- första synken efter inloggning ----------
    async function forstaSynk() {
        lage = "synkar"; uppdateraUI();
        if (arAdmin()) await migreraGamla();
        const [snap, anvSnap] = await Promise.all([fb.fs.getDocs(projektFraga()), fb.fs.getDoc(anvDoc())]);
        if (arAdmin()) lasMeta(snap.docs);
        const dokument = snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
        if (!arAdmin()) uppdateraBeh(dokument); else markeraLasvy();
        v1Data.clear();
        dokument.forEach((d) => { if (d.version !== 2 && typeof d.data === "string") v1Data.set(d.id, { data: d.data, rev: d.rev || 0 }); });
        const aktivt = anvSnap.exists() ? anvSnap.data().aktivtProjekt : null;
        aktivtSkrivet = aktivt;
        const agare = moln.uid;

        if (agare === anvandare.uid) {
            // Samma konto som förut på den här datorn: det som redan finns här synkas med
            // det som ändrats sedan sist; projekt som saknas här hämtas i sin helhet.
            for (const d of dokument) {
                const p = plan4.projekt.find((x) => x.id === d.id);
                if (d.version === 2) {
                    if (moln.delar[d.id] && p) continue;              // lyssnarna hämtar det som ändrats
                    const h = await hamtaDelar(d.id);
                    const ny = anvandHamtat(d.id, h, p || null);
                    if (ny) sattIn(ny);
                    continue;
                }
                if (typeof d.data !== "string") continue;
                if (p && (d.rev || 0) === (moln.v1[d.id] || 0)) continue;
                ersattV1(d.id, d.data, d.rev || 0);
            }
            const iMolnet = new Set(dokument.map((d) => d.id));
            for (const id of Object.keys(moln.delar).concat(Object.keys(moln.v1))) {
                if (iMolnet.has(id)) continue;
                const p = plan4.projekt.find((x) => x.id === id);
                if (p && arAdmin() && arAndrad(p)) registreraBorttaget(id, p.projekt);
                else if (p) taBortLokalt(id);
                else glomProjekt(id);
            }
            sparaMoln(); ursSparaNu(); rita();
            return klar();
        }
        if (agare && agare !== anvandare.uid) {
            // Datan på datorn tillhör ett annat konto och visas aldrig för den här användaren.
            moln = tomtMoln();
            const projekt = await hamtaAlla(dokument);
            if (projekt.length) anvandMolnet(projekt, aktivt); else nollstallLokalt();
            return klar();
        }
        if (!arAdmin()) {
            // Användare: bara projekten man är medlem i. Projekt som redan fanns på datorn
            // kan inte läggas till (det gör admin).
            const fortsatt = async () => {
                stangModal();
                moln = tomtMoln();
                const projekt = await hamtaAlla(dokument);
                if (projekt.length) anvandMolnet(projekt, aktivt); else nollstallLokalt();
                klar();
            };
            if (tomtStandardprojekt()) return fortsatt();
            return fraga("Projekten på den här datorn läggs inte till i ditt konto",
                "Du kommer åt de projekt som en admin har gett dig tillgång till. " +
                "Projekten som finns här (" + plan4.projekt.map((p) => p.projekt).join(", ") + ") tas bort från datorn. " +
                "Be en admin skapa projektet i molnet om det behövs.",
                [{ txt: "Fortsätt", primar: true, fn: fortsatt }]);
        }
        if (!dokument.length) {
            // Admin utan projekt i molnet: ladda upp det som finns på den här datorn.
            moln = tomtMoln();
            sparaMoln();
            return klar();
        }
        if (tomtStandardprojekt()) {
            moln = tomtMoln();
            anvandMolnet(await hamtaAlla(dokument), aktivt);
            return klar();
        }

        // Både den här datorn och kontot har projekt sedan tidigare.
        const lokala = plan4.projekt.map((p) => p.projekt).join(", ");
        const iKontot = dokument.map((d) => d.namn || "Projekt").join(", ");
        fraga("Det finns projekt både här och i ditt konto",
            "På den här datorn: " + lokala + ".\nI kontot: " + iKontot + ".",
            [{ txt: "Använd bara kontots projekt", fara: true, vanster: true,
               fn: async () => { stangModal(); moln = tomtMoln(); anvandMolnet(await hamtaAlla(dokument), aktivt); klar(); } },
             { txt: "Slå ihop", primar: true, fn: async () => { stangModal(); await slaIhop(dokument, aktivt); klar(); } }]);
    }
    function tomtMoln() { return { uid: anvandare.uid, v: 2, delar: {}, tid: {}, meta: {}, v1: {} }; }

    function nollstallLokalt() {
        angraForeAvbryt();
        const p = nyttProjekt("Projekt", "Produktion", IDAG);
        rustaProjekt(p, IDAG);
        p.reserv = true;                // tomt reservprojekt: laddas inte upp så länge det är tomt
        plan4 = { version: VERSION, aktivtProjekt: p.id, projekt: [p] };
        state = p;
        moln = tomtMoln();
        sparaMoln();
        vyOffset = 0; valdKedja = null; VADER = {};
        ursSparaNu();
    }

    // Kontots projekt läses in och de lokala läggs till. Ett lokalt projekt med samma id
    // som ett i kontot behålls som kopia, så att ingenting försvinner.
    async function slaIhop(dokument, aktivt) {
        const lokala = plan4.projekt.slice();
        moln = tomtMoln();
        anvandMolnet(await hamtaAlla(dokument), aktivt);
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
        moln.uid = anvandare.uid;
        sparaMoln();
        lyssna();
        synkaDelLyssnare();
        tillampaVantande();
        startaAnvandarlista();
        lage = konflikter.size ? "konflikt" : "synkad";
        senastSynkad = new Date();
        uppdateraUI();
        kontrolleraTillgang();
        schemalaggPush(50);
        flyttaTillV2();
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
    function harTillgang() { return arAdmin() || Object.keys(moln.delar).length + Object.keys(moln.v1).length > 0; }
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
        $("kkNamnFalt").classList.toggle("dold", !skapaLage);
        $("kkKodFalt").classList.toggle("dold", !skapaLage);
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
            if (skapaLage) {
                // Projektkoden kontrolleras innan kontot skapas, så att en felskriven kod inte ger ett konto utan ansökan.
                const kod = rensaKod($("kkKod").value);
                let ansokan = null;
                if (kod) {
                    ansokan = await slaUppKod(kod);
                    if (!ansokan) { visaFel("Projektkoden " + kod + " finns inte. Kontrollera den med din projektadmin, eller lämna fältet tomt."); knapp.disabled = false; return; }
                }
                const namn = $("kkNamn").value.trim();
                nyttKonto = { epost: epost.toLowerCase(), namn: namn, ansokan: ansokan };
                const cred = await fb.auth.createUserWithEmailAndPassword(fb.authInst, epost, losen);
                if (namn) await fb.auth.updateProfile(cred.user, { displayName: namn }).catch(() => { });
                $("kkKod").value = "";
            }
            else await fb.auth.signInWithEmailAndPassword(fb.authInst, epost, losen);
            $("kkLosen").value = "";
            $("kkLosen2").value = "";
        } catch (err) { nyttKonto = null; visaFel(feltext(err)); }
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
    // Vem är inloggad, och får hen ändra i projektet? (Används av dagboken.)
    window.p4Jag = () => anvandare ? { uid: anvandare.uid, namn: anvandare.displayName || anvandare.email || "", epost: anvandare.email || "" } : null;
    window.p4KanProjekt = (pid) => !anvandare || arAdmin() || !arLas(pid);
    // Bara huvudadmin och projektets projektadmin skapar dagböcker.
    window.p4ArProjektAdmin = (pid) => !anvandare || arAdmin() || arProjektAdmin(pid);
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
            ritaAnsokningar();
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
            '<section class="p4-ks-kort p4-ks-projekt dold" id="ksAnsok"></section>' +
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
                "<h2>Gå med i ett projekt</h2>" +
                '<p class="hjalp">Har du fått en projektkod? Skriv in den här så skickas en ansökan till projektadmin för projektet.</p>' +
                '<div class="falt"><label for="ksKod">Projektkod</label><div class="p4-ks-gamed"><input class="f p4-kodfalt" id="ksKod" autocomplete="off" spellcheck="false" maxlength="12" placeholder="T.ex. K7M4QX">' +
                '<button type="button" class="mknapp primar" data-ks="gamed">Skicka ansökan</button></div></div>' +
                '<div class="notis dold" id="ksKodSvar"></div>' +
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

    // Projektkoden i tabellen: huvudadmin ser den för alla projekt, projektadmin för sina.
    function kodText(id) {
        const m = projektMeta.get(id);
        if (!m || !arProjektAdmin(id)) return "";
        return m.kod
            ? '<button type="button" class="p4-konto-lank p4-ks-kodliten" data-pkod="kopiera" data-pid="' + esc(id) + '" title="Kopiera koden">' + esc(m.kod) + "</button>"
            : '<button type="button" class="mknapp" data-pkod="ny" data-pid="' + esc(id) + '">Skapa kod</button>';
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
                (harNagonAdminroll() ? "<td>" + (arProjektAdmin(p.id) ? medlemsText(p.id) : "") + "</td><td>" + kodText(p.id) + "</td>" : "") +
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
            '<div class="p4-ks-tabellram"><table class="lista p4-ks-tabell"><thead><tr><th>Projekt</th><th>Tavlor</th><th>Poster</th>' + (harNagonAdminroll() ? "<th>Medlemmar</th><th>Projektkod</th>" : "") + '<th>Senast ändrat</th><th>Molnet</th><th></th></tr></thead>' +
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
            await fb.fs.setDoc(anvDoc(), { namn: namn }, { merge: true }).catch(() => { });
            synkaPersoner();
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
            else if (vad === "gamed") gaMedKod($("ksKod").value, "ksKodSvar");
        }
        const o = e.target.closest("#p4KontoSida [data-oppna]");
        if (o) { stangKontosida(); valjProjekt(o.dataset.oppna); }
        const h = e.target.closest("#p4KontoSida [data-hamta], #p4KontoSida [data-behall]");
        if (h) losKonflikt(h.dataset.hamta || h.dataset.behall, !!h.dataset.behall);
    });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && kontoOppen() && !dialogOppen()) stangKontosida();
        if (e.key === "Enter" && e.target && e.target.id === "ksNamn") sparaNamn();
        if (e.key === "Enter" && e.target && e.target.id === "ksKod") gaMedKod(e.target.value, "ksKodSvar");
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
        // huvudadmin: väntande konton och ansökningar; projektadmin: ansökningar till sina projekt
        const vantar = new Set(ansokningar.map((a) => a.uid).concat(arAdmin() ? vantandeAnvandare().map((a) => a.uid) : [])).size;
        const badge = $("p4KontoBadge");
        if (badge) { badge.textContent = String(vantar); badge.classList.toggle("dold", !vantar); badge.title = vantar + (vantar === 1 ? " person väntar" : " personer väntar") + " på godkännande"; }
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
    let allaAnvandare = [];      // huvudadmin: alla konton; övriga admins: personerna i sina projekt
    let adminFilter = null;      // null = Väntar om någon väntar, annars Alla
    let nyttKonto = null;        // { epost, namn, ansokan } medan ett nytt konto skapas
    let ansokningar = [];        // [{ uid, pid, namn, epost, kod, tid }] som jag får godkänna
    const arAdmin = () => behorighet.roll === "admin" && behorighet.status === "godkand";
    // Huvudadmin, eller en godkänd användare som fått "Får skapa projekt" av huvudadmin.
    const kanSkapaProjekt = () => arAdmin() || (behorighet.status === "godkand" && behorighet.skapa === true);
    const tidAv = (v) => v && typeof v.toDate === "function" ? v.toDate()
        : typeof v === "string" && !isNaN(Date.parse(v)) ? new Date(v) : null;

    async function sakerstallAnvandardok() {
        const ref = anvDoc(), snap = await fb.fs.getDoc(ref);
        const ny = nyttKonto && nyttKonto.epost === String(anvandare.email || "").toLowerCase() ? nyttKonto : null;
        nyttKonto = null;
        if (!snap.exists()) {
            const namn = (ny && ny.namn) || anvandare.displayName || "";
            await fb.fs.setDoc(ref, Object.assign({ epost: anvandare.email || "", namn: namn,
                roll: "user", status: "vantar", skapad: fb.fs.serverTimestamp() }, ny && ny.ansokan ? ansokanFalt(ny.ansokan) : {}));
            if (ny && ny.ansokan) await skickaAnsokan(ny.ansokan, namn).catch((e) => console.warn("Wimo ansökan:", e));
        } else if (!snap.data().status) {
            // konto från tiden före godkännandet: läggs i kön
            await fb.fs.setDoc(ref, { roll: "user", status: "vantar" }, { merge: true });
        }
    }

    function hanteraBehorighet(d) {
        const forraRoll = behorighet.roll;
        behorighet = { roll: (d && d.roll) || "user", status: (d && d.status) || "vantar", skapa: !!(d && d.skapa === true),
            ansokan: (d && d.ansokan) || "", ansokanNamn: (d && d.ansokanNamn) || "" };
        skrivJson(BEHNYCKEL, { uid: anvandare.uid, roll: behorighet.roll, status: behorighet.status, skapa: behorighet.skapa });
        if (behorighet.status === "godkand") {
            // Ny roll ger andra projekt (admin ser alla): synka om från början.
            if (appStartad && forraRoll !== behorighet.roll) stoppaApp();
            if (!appStartad) startaApp();
        } else {
            stoppaApp();
            visaVy("vantar");
        }
        if (arAdmin()) startaAdmin(); else stoppaAdmin();
        startaAnvandarlista();
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
        stoppaDelLyssnare();
        document.body.classList.remove("p4-kontovy");
    }
    function forsokIgen() {
        setTimeout(() => {
            if (!anvandare || synkKlar || !appStartad) return;
            forstaSynk().then(efterForstaSynk).catch(forsokIgen);
        }, 15000);
    }

    // Väntesidan: visas för konton som inte är godkända (än).
    let ansokanKollad = "";      // ansökan vars status redan hämtats till väntesidan
    let ansokanFinns = true;
    function ritaVantesida() {
        const nekad = behorighet.status === "nekad";
        const ingaProjekt = behorighet.status === "godkand";
        const pnamn = behorighet.ansokanNamn;
        $("p4Vantar").classList.toggle("inga", ingaProjekt);
        // Finns ansökan kvar? Projektadmin tar bort den när hen godkänner eller nekar.
        if (behorighet.ansokan && !nekad) {
            const nyckel = behorighet.ansokan + "/" + anvandare.uid;
            if (ansokanKollad !== nyckel) {
                ansokanKollad = nyckel; ansokanFinns = true;
                fb.fs.getDoc(ansokDoc(behorighet.ansokan, anvandare.uid)).then((d) => {
                    ansokanFinns = d.exists();
                    if (!ansokanFinns && document.body.classList.contains("p4-vantar")) ritaVantesida();
                }).catch(() => { });
            }
        }
        const sokt = pnamn && !nekad ? (ansokanFinns
            ? " Du har ansökt om att gå med i " + pnamn + ". Projektadmin för " + pnamn + " godkänner dig."
            : " Din ansökan till " + pnamn + " är avslutad utan att du lagts till. Fråga projektadmin, eller skriv in en ny kod nedan.") : "";
        $("p4VantarSkapa").classList.toggle("dold", !(ingaProjekt && behorighet.skapa));
        if (ingaProjekt) {
            // lobbyn: godkänd men inte med i något projekt än
            $("p4VantarRubrik").textContent = "Välkommen till Wimo" + (anvandare.displayName ? ", " + anvandare.displayName.split(" ")[0] : "");
            $("p4VantarText").textContent = (pnamn && ansokanFinns ? "Ditt konto är godkänt." + sokt
                : "Ditt konto är godkänt. Du är inte med i något projekt än: när en projektadmin lägger till dig öppnas projektet här av sig självt, du behöver inte ladda om." + (pnamn ? sokt : "")) +
                (behorighet.skapa ? " Du får också skapa egna projekt." : " Har du fått en projektkod skriver du in den nedan.");
            $("p4Vantar").classList.remove("nekad");
            return;
        }
        if (pnamn && !nekad) {
            $("p4VantarRubrik").textContent = ansokanFinns ? "Din ansökan väntar på godkännande" : "Ditt konto väntar på godkännande";
            $("p4VantarText").textContent = sokt.trim() + " Sidan öppnas av sig själv så fort det är klart — du behöver inte ladda om.";
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
    // Bara huvudadmin läser alla konton.
    function startaAdmin() {
        if (adminLyssnare) return;
        stoppaPersoner();
        adminLyssnare = fb.fs.onSnapshot(fb.fs.collection(fb.db, "anvandare"), (snap) => {
            allaAnvandare = snap.docs.map((d) => Object.assign({ uid: d.id }, d.data()));
            uppdateraUI();
            if (kontoOppen()) { ritaAdmin(); ritaAnsokningar(); }
            synkaPersoner();
        }, (e) => console.warn("Wimo användarlista:", e));
    }
    // Projektadmin och tavla-admin ser bara personerna i sina egna projekt (projekt/{id}/personer).
    function startaAnvandarlista() {
        if (!anvandare || !synkKlar) return;
        if (!arAdmin()) startaPersoner();
        startaAnsokningar();
        synkaPersoner();
        skapaSaknadeKoder();
    }
    // Projekt från tiden före projektkoderna får en kod när huvudadmin eller projektadmin är inloggad.
    let koderPagar = false;
    const kodForsokt = new Set();
    async function skapaSaknadeKoder() {
        if (koderPagar || !anvandare || !synkKlar) return;
        koderPagar = true;
        try {
            for (const [id, m] of [...projektMeta]) {
                if (m.kod || kodForsokt.has(id) || !arProjektAdmin(id)) continue;
                kodForsokt.add(id);
                try { await nyProjektkod(id); } catch (e) { console.warn("Wimo projektkod:", e); }
            }
        } finally { koderPagar = false; }
        if (kontoOppen()) ritaSynkkort();
    }
    function stoppaAdmin() {
        if (adminLyssnare) { adminLyssnare(); adminLyssnare = null; allaAnvandare = []; }
    }

    // ---------- projektens namnlistor ----------
    const persLyss = new Map(), persPer = new Map();     // projektId → avregistrering / [{ uid, namn, epost }]
    function startaPersoner() {
        const vill = new Set([...projektMeta.keys()].filter((id) => arProjektAdmin(id) || harTavlaAdmin(id)));
        for (const [id, av] of persLyss) if (!vill.has(id)) { av(); persLyss.delete(id); persPer.delete(id); }
        vill.forEach((id) => {
            if (persLyss.has(id)) return;
            persLyss.set(id, fb.fs.onSnapshot(fb.fs.collection(fb.db, "projekt", id, "personer"), (snap) => {
                persPer.set(id, snap.docs.map((d) => Object.assign({ uid: d.id }, d.data())));
                samlaPersoner();
            }, (e) => console.warn("Wimo namnlista:", e)));
        });
        samlaPersoner();
    }
    function samlaPersoner() {
        if (arAdmin()) return;
        const alla = new Map();
        persPer.forEach((lista) => lista.forEach((a) => {
            if (!alla.has(a.uid)) alla.set(a.uid, { uid: a.uid, namn: a.namn || "", epost: a.epost || "", status: "godkand", roll: "user" });
        }));
        allaAnvandare = [...alla.values()];
        if (kontoOppen()) ritaSynkkort();
    }
    function stoppaPersoner() {
        persLyss.forEach((av) => av());
        persLyss.clear(); persPer.clear();
        if (!adminLyssnare) allaAnvandare = [];
    }
    // Var och en skriver sitt namn i projekten hen är med i; huvudadmin fyller i för alla medlemmar.
    // Det som redan skrivits från den här datorn skrivs inte igen.
    const PERSNYCKEL = "plan4_personer";
    let persTimer = null;
    function synkaPersoner() { clearTimeout(persTimer); persTimer = setTimeout(skrivPersoner, 2500); }
    async function skrivPersoner() {
        if (!anvandare || !synkKlar || !fb) return;
        let cache = lasJson(PERSNYCKEL, null);
        if (!cache || cache.uid !== anvandare.uid) cache = { uid: anvandare.uid, k: {} };
        const info = (uid) => {
            if (uid === anvandare.uid) return { namn: anvandare.displayName || "", epost: anvandare.email || "" };
            const a = allaAnvandare.find((x) => x.uid === uid);
            return a && arAdmin() ? { namn: a.namn || "", epost: a.epost || "" } : null;
        };
        const jobb = [];
        for (const [pid, m] of projektMeta) {
            (arAdmin() ? m.medlemmar : m.medlemmar.filter((u) => u === anvandare.uid)).forEach((uid) => {
                const i = info(uid);
                if (!i) return;
                const nyckel = pid + "/" + uid, sig = i.namn + "|" + i.epost;
                if (cache.k[nyckel] !== sig) jobb.push({ pid, uid, i, nyckel, sig });
            });
        }
        for (let n = 0; n < jobb.length; n += 400) {
            const del = jobb.slice(n, n + 400), b = fb.fs.writeBatch(fb.db);
            del.forEach((j) => b.set(personDoc(j.pid, j.uid), j.i));
            try { await b.commit(); del.forEach((j) => { cache.k[j.nyckel] = j.sig; }); }
            catch (e) { console.warn("Wimo namnlista:", e); break; }
        }
        skrivJson(PERSNYCKEL, cache);
    }

    // ---------- projektkoder och ansökningar ----------
    const ansokanFalt = (a) => ({ ansokan: a.pid, ansokanKod: a.kod, ansokanNamn: a.namn });
    async function slaUppKod(kod) {
        const d = await fb.fs.getDoc(kodDoc(kod));
        return d.exists() && d.data().projekt ? { kod: kod, pid: d.data().projekt, namn: d.data().namn || "projektet" } : null;
    }
    function skickaAnsokan(a, namn) {
        return fb.fs.setDoc(ansokDoc(a.pid, anvandare.uid), { namn: namn || anvandare.displayName || "",
            epost: anvandare.email || "", kod: a.kod, tid: fb.fs.serverTimestamp() });
    }
    // Från väntesidan eller kontosidan: ansök till ett projekt med dess kod.
    async function gaMedKod(rad, svarId) {
        const kod = rensaKod(rad);
        if (!kod) return svar(svarId, "Skriv projektkoden du fått.");
        svar(svarId, "");
        try {
            const a = await slaUppKod(kod);
            if (!a) return svar(svarId, "Projektkoden " + kod + " finns inte. Kontrollera den med din projektadmin.");
            const m = projektMeta.get(a.pid);
            if (arAdmin() || (m && m.medlemmar.includes(anvandare.uid))) return svar(svarId, "Du är redan med i " + a.namn + ".", true);
            await fb.fs.setDoc(anvDoc(), ansokanFalt(a), { merge: true });
            await skickaAnsokan(a);
            ansokanKollad = "";
            svar(svarId, "Ansökan är skickad. Projektadmin för " + a.namn + " godkänner dig, och projektet öppnas av sig självt när det är klart.", true);
            ["ksKod", "p4VantarKod"].forEach((id) => { if ($(id)) $(id).value = ""; });
        } catch (e) { svar(svarId, "Kunde inte skicka ansökan: " + (e.code || e.message)); }
    }
    document.addEventListener("click", (e) => {
        if (e.target.closest && e.target.closest("#p4VantarSkapa")) nyttProjektDialog();
    });
    document.addEventListener("submit", (e) => {
        if (!e.target || e.target.id !== "p4VantarKodForm") return;
        e.preventDefault();
        gaMedKod($("p4VantarKod").value, "p4VantarKodSvar");
    });

    // Huvudadmin ser ansökningarna till alla projekt, projektadmin till sina egna.
    const ansokLyss = new Map(), ansokPer = new Map();   // "*" eller projektId → avregistrering / ansökningar
    let gruppFel = false;        // gick inte frågan över alla projekt läser huvudadmin projekt för projekt
    function startaAnsokningar() {
        if (!anvandare || !synkKlar) return;
        const vill = new Set(arAdmin() ? (gruppFel ? [...projektMeta.keys()] : ["*"])
            : [...projektMeta].filter(([, m]) => m.projektAdmin.includes(anvandare.uid)).map(([id]) => id));
        for (const [k, av] of ansokLyss) if (!vill.has(k)) { av(); ansokLyss.delete(k); ansokPer.delete(k); }
        vill.forEach((k) => {
            if (ansokLyss.has(k)) return;
            const fraga = k === "*" ? fb.fs.collectionGroup(fb.db, "ansokningar") : fb.fs.collection(fb.db, "projekt", k, "ansokningar");
            ansokLyss.set(k, fb.fs.onSnapshot(fraga, (snap) => {
                ansokPer.set(k, snap.docs.map((d) => Object.assign({ uid: d.id, pid: d.ref.parent.parent.id }, d.data())));
                samlaAnsokningar();
            }, (e) => {
                console.warn("Wimo ansökningar:", e);
                if (k === "*" && !gruppFel) { gruppFel = true; ansokLyss.delete("*"); ansokPer.delete("*"); startaAnsokningar(); }
            }));
        });
        samlaAnsokningar();
    }
    function samlaAnsokningar() {
        const alla = [];
        ansokPer.forEach((lista) => lista.forEach((a) => { if (!alla.some((x) => x.uid === a.uid && x.pid === a.pid)) alla.push(a); }));
        ansokningar = alla.filter((a) => projektMeta.has(a.pid)).sort((a, b) => (tidAv(a.tid) || 0) - (tidAv(b.tid) || 0));
        uppdateraUI();
        if (kontoOppen()) ritaAnsokningar();
    }
    function stoppaAnsokningar() {
        ansokLyss.forEach((av) => av());
        ansokLyss.clear(); ansokPer.clear(); ansokningar = [];
    }

    function ritaAnsokningar() {
        const kort = $("ksAnsok");
        if (!kort) return;
        if (!ansokningar.length) { kort.classList.add("dold"); kort.innerHTML = ""; return; }
        kort.classList.remove("dold");
        const flera = new Set(ansokningar.map((a) => a.pid)).size > 1 || arAdmin();
        const rader = ansokningar.map((a) => {
            const m = projektMeta.get(a.pid), t = tidAv(a.tid), nyckel = a.pid + "/" + a.uid;
            return "<tr><td><b>" + esc(a.namn || a.epost || "Okänd") + "</b>" + (a.namn && a.epost ? "<br><small>" + esc(a.epost) + "</small>" : "") + "</td>" +
                "<td>" + esc(m ? m.namn : "") + "</td>" +
                "<td>" + esc(t ? t.toLocaleDateString("sv-SE") : "—") + "</td>" +
                "<td>" + rollval("data-arol", nyckel, "red", false) + "</td>" +
                '<td class="p4-ks-hoger"><span class="p4-ks-atgarder">' +
                  '<button type="button" class="mknapp primar" data-ansok="godkann" data-nyckel="' + esc(nyckel) + '">Godkänn</button>' +
                  '<button type="button" class="mknapp fara" data-ansok="neka" data-nyckel="' + esc(nyckel) + '">Neka</button>' +
                "</span></td></tr>";
        }).join("");
        kort.innerHTML =
            '<div class="p4-ks-rubrikrad"><h2>Ansökningar</h2><span class="p4-ks-status vantar">' + ansokningar.length +
              (ansokningar.length === 1 ? " person väntar" : " personer väntar") + "</span></div>" +
            '<p class="hjalp">De här personerna har skrivit in projektkoden till ' + (flera ? "ett projekt" : "projektet") +
              " du är admin för. Välj roll och godkänn, så får de tillgång direkt. Nekar du tas ansökan bort.</p>" +
            '<div class="p4-ks-tabellram"><table class="lista p4-ks-tabell"><thead><tr><th>Person</th><th>Projekt</th><th>Ansökte</th><th>Roll</th><th></th></tr></thead><tbody>' +
            rader + "</tbody></table></div>";
    }
    async function besvaraAnsokan(nyckel, godkann) {
        const a = ansokningar.find((x) => x.pid + "/" + x.uid === nyckel);
        if (!a) return;
        const m = projektMeta.get(a.pid), vem = a.namn || a.epost || "Personen";
        const rollEl = document.querySelector('[data-arol="' + CSS.escape(nyckel) + '"]');
        const roll = rollEl ? rollEl.value : "red";
        try {
            if (godkann && m) {
                if (!m.medlemmar.includes(a.uid) || rollI(m, a.uid) !== roll) await sparaMeta(a.pid, m, medRoll(m, a.uid, roll), a);
                // ett konto som väntar blir godkänt; ett konto som redan är godkänt lämnas som det är
                const konto = allaAnvandare.find((x) => x.uid === a.uid);
                if (!arAdmin() || !konto || konto.status !== "godkand") {
                    try {
                        await fb.fs.updateDoc(fb.fs.doc(fb.db, "anvandare", a.uid),
                            { status: "godkand", behandladAv: anvandare.uid, behandladTid: fb.fs.serverTimestamp() });
                    } catch (e) { if (!e || e.code !== "permission-denied") throw e; }
                }
            }
            await fb.fs.deleteDoc(ansokDoc(a.pid, a.uid));
            status(vem + (godkann ? " är med i " + (m ? m.namn : "projektet") + " som " + ROLLNAMN[roll].toLowerCase() : ": ansökan är nekad"));
        } catch (e) { status("Kunde inte " + (godkann ? "godkänna" : "neka") + ": " + (e.code || e.message), true); }
    }
    document.addEventListener("click", (e) => {
        const b = e.target.closest && e.target.closest("#ksAnsok [data-ansok]");
        if (!b) return;
        const vad = b.dataset.ansok, nyckel = b.dataset.nyckel;
        if (vad === "godkann") return besvaraAnsokan(nyckel, true);
        const a = ansokningar.find((x) => x.pid + "/" + x.uid === nyckel);
        fraga("Neka ansökan?", (a ? a.namn || a.epost : "Personen") + " får inte tillgång till projektet. Hen kan ansöka igen med koden. Byt kod under Medlemmar… om koden inte ska användas mer.",
            [{ txt: "Avbryt", fn: stangModal }, { txt: "Neka", fara: true, fn: () => { stangModal(); besvaraAnsokan(nyckel, false); } }], false);
    });

    // Ny projektkod: den gamla slutar gälla direkt.
    async function nyProjektkod(pid) {
        const m = projektMeta.get(pid);
        if (!m) return "";
        let kod = "";
        for (let i = 0; i < 6 && !kod; i++) { const k = nyKod(); if (!(await fb.fs.getDoc(kodDoc(k))).exists()) kod = k; }
        if (!kod) throw new Error("Kunde inte skapa en ledig kod");
        const b = fb.fs.writeBatch(fb.db);
        b.update(projektDoc(pid), { kod: kod });
        b.set(kodDoc(kod), { projekt: pid, namn: m.namn });
        if (m.kod) b.delete(kodDoc(m.kod));
        await b.commit();
        m.kod = kod;
        return kod;
    }
    function kodrutaHtml(pid, m) {
        return '<div class="p4-ks-kodruta"><span class="et">Projektkod</span><b class="p4-ks-kod" id="mdKod">' + esc(m.kod || "—") + "</b>" +
            '<span class="p4-ks-knappar">' +
              (m.kod ? '<button type="button" class="mknapp" data-pkod="kopiera" data-pid="' + esc(pid) + '">Kopiera</button>' : "") +
              '<button type="button" class="mknapp" data-pkod="ny" data-pid="' + esc(pid) + '">' + (m.kod ? "Byt kod" : "Skapa kod") + "</button>" +
            "</span></div>" +
            '<p class="hjalp" style="margin-top:0">Ge koden till den som ska vara med. Hen skriver in den när hen skapar konto (eller under Gå med i ett projekt på kontosidan), ' +
              "och du godkänner hen under Ansökningar på kontosidan. Byter du kod slutar den gamla att gälla.</p>";
    }
    document.addEventListener("click", async (e) => {
        const b = e.target.closest && e.target.closest("[data-pkod]");
        if (!b) return;
        const pid = b.dataset.pid, m = projektMeta.get(pid);
        if (!m) return;
        if (b.dataset.pkod === "kopiera") {
            try { await navigator.clipboard.writeText(m.kod); status("Projektkoden " + m.kod + " är kopierad"); }
            catch (err) { status("Projektkoden är " + m.kod); }
            return;
        }
        b.disabled = true;
        try {
            const kod = await nyProjektkod(pid);
            const ruta = b.closest(".p4-ks-kodruta");
            if (ruta) ruta.outerHTML = kodrutaHtml(pid, m).replace(/<p class="hjalp"[\s\S]*$/, "");
            else b.disabled = false;
            status("Ny projektkod för " + m.namn + ": " + kod);
            if (kontoOppen()) ritaSynkkort();
        } catch (err) { b.disabled = false; status("Kunde inte skapa koden: " + (err.code || err.message), true); }
    });
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
                "<td>" + projektFor(a) + (st === "vantar" && a.ansokanNamn ? '<br><span class="p4-ks-tagg">Ansöker till ' + esc(a.ansokanNamn) + "</span>" : "") + "</td>" +
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
              "och under Medlemmar… på ett projekt kan du dessutom ge behörighet per tavla. Med Får skapa projekt kan en användare starta egna projekt och blir projektadmin i dem. " +
              "Den som skapar konto med ett projekts kod godkänns av projektadmin under Ansökningar. Huvudadmin har tillgång till allt och är den enda som ser alla användare.</p>" +
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
        if (!lista.length && !godkann) {
            return fraga("Det finns inga projekt än", "Skapa ett projekt först, så kan du godkänna " + (a.namn || a.epost) + " och ge tillgång till det.",
                [{ txt: "OK", primar: true, fn: stangModal }], false);
        }
        const kropp =
            '<p class="hjalp" style="margin-top:0">' + (godkann
                ? (lista.length ? "Välj vilka projekt " + esc(a.namn || a.epost) + " ska få tillgång till och vilken roll personen har i varje. " +
                    "Du kan också godkänna utan projekt: då hamnar personen i lobbyn och väntar på att bli tillagd." : "Det finns inga projekt än. " +
                    esc(a.namn || a.epost) + " hamnar i lobbyn och väntar på att bli tillagd i ett projekt.")
                : "Bocka i projekten " + esc(a.namn || a.epost) + " ska vara med i och välj roll. Utan projekt kommer personen inte åt något.") +
            " En projektadmin bestämmer själv vilka som är med i projektet. Behörighet per tavla väljer du under Medlemmar… på projektet.</p>" +
            '<ul class="p4-ks-valista">' + lista.map((p) => {
                const med = p.medlemmar.includes(a.uid) || (godkann && (a.ansokan === p.id || ansokningar.some((x) => x.uid === a.uid && x.pid === p.id)));
                return '<li class="p4-ks-medbeh"><label><input type="checkbox" data-pval="' + esc(p.id) + '"' + (med ? " checked" : "") + "> " +
                    "<span><b>" + esc(p.namn) + "</b>" + (p.arkiverad ? ' <span class="p4-ks-tagg">Arkiverat</span>' : "") +
                    "<small>" + (p.medlemmar.filter((u) => u !== a.uid).length) + " andra medlemmar</small></span></label>" +
                    rollval("data-pbeh", p.id, med ? rollI(p, a.uid) : "red", !med) + "</li>";
            }).join("") + "</ul>" +
            (godkann ? '<label class="kryssrad p4-ks-skaparad"><input type="checkbox" id="pvSkapa"' + (a.skapa === true ? " checked" : "") +
                "> <span><b>Får skapa egna projekt</b><small>Personen kan starta egna projekt och blir projektadmin i dem.</small></span></label>" : "") +
            '<div class="notis rod dold" id="pvFel"></div>';
        modal(godkann ? "Godkänn " + (a.namn || a.epost) : "Projekt för " + (a.namn || a.epost), a.namn ? a.epost : "", kropp, [
            { txt: "Avbryt", fn: stangModal },
            { txt: godkann ? "Godkänn" : "Spara", primar: true, fn: async () => {
                const valda = [...document.querySelectorAll("[data-pval]")].filter((x) => x.checked).map((x) => x.dataset.pval);
                const roller = new Map([...document.querySelectorAll("[data-pbeh]")].map((x) => [x.dataset.pbeh, x.value]));
                const skapa = godkann && $("pvSkapa") ? $("pvSkapa").checked : null;
                stangModal();
                try {
                    await sattProjektFor(a.uid, valda, roller);
                    if (godkann) {
                        await fb.fs.setDoc(fb.fs.doc(fb.db, "anvandare", a.uid),
                            Object.assign({ status: "godkand", behandladAv: anvandare.uid, behandladTid: fb.fs.serverTimestamp() },
                                skapa === null ? {} : { skapa: skapa }), { merge: true });
                    }
                    // ansökningar till projekten personen nu är med i är klara
                    for (const x of ansokningar.filter((x) => x.uid === a.uid && valda.includes(x.pid)))
                        await fb.fs.deleteDoc(ansokDoc(x.pid, x.uid)).catch(() => { });
                    status((a.namn || a.epost) + (godkann ? " är godkänd" + (valda.length ? "" : " och väntar i lobbyn") : ": projekten är sparade"));
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
    async function sparaMeta(pid, m, ny, kalla) {
        const fore = m.medlemmar.slice();
        await fb.fs.updateDoc(projektDoc(pid), ny);
        Object.assign(m, ny);
        if (!ny.medlemmar) return;
        // projektets namnlista följer medlemmarna: nya läggs till, borttagna tas bort
        const info = (uid) => {
            const a = (kalla && kalla.uid === uid ? kalla : null) || allaAnvandare.find((x) => x.uid === uid) || ansokningar.find((x) => x.uid === uid);
            return a ? { namn: a.namn || "", epost: a.epost || "" } : null;
        };
        const b = fb.fs.writeBatch(fb.db);
        let n = 0;
        ny.medlemmar.filter((u) => !fore.includes(u)).forEach((u) => { const i = info(u); if (i) { b.set(personDoc(pid, u), i); n++; } });
        fore.filter((u) => !ny.medlemmar.includes(u)).forEach((u) => { b.delete(personDoc(pid, u)); n++; });
        if (n) await b.commit().catch((e) => console.warn("Wimo namnlista:", e));
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
        const kropp = (full ? kodrutaHtml(pid, m) : "") +
            '<p class="hjalp" style="margin-top:0">' + (full
                ? (arAdmin() ? "" : "Listan visar personerna i projekten du är admin för. Nya personer kommer in med projektkoden ovan. ") +
                  "Bocka i vilka som ska vara med i projektet och välj roll. <b>Projektadmin</b> får allt i projektet och väljer själv vilka som är med. " +
                  "Under varje person kan du ge en egen behörighet per tavla: <b>Admin</b> för tavlan, <b>Redigera</b>, <b>Läsa</b> eller <b>Ingen åtkomst</b> (tavlan syns inte alls)."
                : "Du är admin för " + mina.map((t) => "<b>" + esc(t.namn) + "</b>").join(", ") + ". Välj vilka av projektets medlemmar som ska komma åt " +
                  (mina.length === 1 ? "tavlan" : "tavlorna") + " och vad de får göra där.") + "</p>" +
            (godkanda.length || !full ? (lista.length ? '<ul class="p4-ks-valista p4-ks-medlista">' + lista.map(rad).join("") + "</ul>"
                : '<p class="listtom">Inga andra medlemmar i projektet.</p>')
                : '<p class="listtom">' + (arAdmin() ? "Användarlistan hämtas… Stäng och öppna igen om en stund." : "Inga personer ännu. Ge projektkoden till dem som ska vara med.") + "</p>") +
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
    // ---------- länk till skärm (Yodeck och liknande) ----------
    // visning/{token} = { projekt, tavla, namn, data, uppdaterad }: en kopia av en tavla som alla med
    // länken kan läsa utan att logga in. Den skrivs av den som ändrar i tavlan (högst var 20:e sekund),
    // och skärmen uppdateras av sig själv. Projektadmin skapar, byter och tar bort länken.
    const SKARMNYCKEL = "plan4_skarm";       // token → { h: kontrollsumma, t: ms } senast skrivet härifrån
    const visningDoc = (tok) => fb.fs.doc(fb.db, "visning", tok);
    function nyToken() {
        const tecken = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789", a = new Uint32Array(24);
        crypto.getRandomValues(a);
        return Array.from(a, (n) => tecken[n % tecken.length]).join("");
    }
    const kanSkapaSkarm = (pid, tid) => arAdmin() || arProjektAdmin(pid) || tavlaRatt(pid, tid) === "admin";
    function skarmData(p, tid) {
        const t = p.tavlor.find((x) => x.id === tid);
        if (!t) return null;
        const fran = plus(tavlaStart(), -60);
        const x = JSON.parse(innehall(p)), tk = x.tavlor.find((y) => y.id === tid);
        tk.kort = tk.kort.filter((k) => !k.dag || k.dag >= fran || !k.klar);
        tk.historik = [];
        x.dagbok = [];
        tk.hinder = tk.hinder.filter((h) => h.status !== "lost" || !h.lostTid || String(h.lostTid).slice(0, 10) >= fran);
        x.tavlor = [tk];
        x.aktiv = tid;
        let txt = JSON.stringify(x);
        if (txt.length > 900000) { x.logotyp = null; txt = JSON.stringify(x); }
        return txt.length > 950000 ? null : txt;
    }
    let skarmTimer = null;
    function planeraSkarmar() {
        clearTimeout(skarmTimer);
        skarmTimer = setTimeout(() => skrivSkarmar().catch((e) => console.warn("Wimo skärmlänk:", e)), 20000);
    }
    async function skrivSkarmar(tvinga) {
        if (!anvandare || !synkKlar) return;
        const cache = lasJson(SKARMNYCKEL, {});
        for (const p of plan4.projekt) {
            const m = projektMeta.get(p.id);
            if (!m || !m.visning) continue;
            for (const tid of Object.keys(m.visning)) {
                const tok = m.visning[tid], r = tavlaRatt(p.id, tid);
                if (!tok || !p.tavlor.some((t) => t.id === tid) || !(arAdmin() || r === "admin" || r === "red")) continue;
                const txt = skarmData(p, tid);
                if (!txt) continue;
                const h = hash(txt), c = cache[tok];
                if (!tvinga && c && c.h === h && Date.now() - c.t < 12 * 3600000) continue;
                const t = p.tavlor.find((x) => x.id === tid);
                try {
                    await fb.fs.setDoc(visningDoc(tok), { projekt: p.id, tavla: tid, namn: p.projekt + " · " + (t.namn || "Tavla"),
                        data: txt, uppdaterad: fb.fs.serverTimestamp() });
                    cache[tok] = { h, t: Date.now() };
                } catch (e) { console.warn("Wimo skärmlänk:", e); }
            }
        }
        skrivJson(SKARMNYCKEL, cache);
    }
    const skarmUrl = (tok, v) => location.origin + location.pathname + "?skarm=" + tok + (v && v !== 4 ? "&veckor=" + v : "");
    async function andraSkarmLank(pid, tid, ny) {
        const m = projektMeta.get(pid), gammal = m && m.visning && m.visning[tid];
        await fb.fs.updateDoc(projektDoc(pid), { ["visning." + tid]: ny || fb.fs.deleteField() });
        if (m) { m.visning = Object.assign({}, m.visning); if (ny) m.visning[tid] = ny; else delete m.visning[tid]; }
        if (ny) {
            const p = plan4.projekt.find((x) => x.id === pid), t = p && p.tavlor.find((x) => x.id === tid);
            await fb.fs.setDoc(visningDoc(ny), { projekt: pid, tavla: tid, namn: p.projekt + " · " + (t.namn || "Tavla"),
                data: skarmData(p, tid) || "{}", uppdaterad: fb.fs.serverTimestamp() });
        }
        if (gammal) await fb.fs.deleteDoc(visningDoc(gammal)).catch(() => { });
    }
    function skarmDialog() {
        if (!anvandare || !synkKlar) return status("Logga in för att skapa en länk till en skärm", true);
        const p = state, t = T(), m = projektMeta.get(p.id);
        if (!m || m.version !== 2) return status("Projektet sparas inte i molnet än", true);
        const tok = m.visning && m.visning[t.id], kan = kanSkapaSkarm(p.id, t.id);
        let veckor = 4;
        const kropp = () => tok
            ? '<p class="hjalp" style="margin-top:0">Lägg in länken som en <b>webbsida</b> i Yodeck (eller en annan skärmtjänst) så visas ' +
                esc(t.namn) + " i visningsläge. Skärmen uppdateras av sig själv när någon ändrar i tavlan, och dagen byts vid midnatt.</p>" +
              '<div class="falt"><label for="skVeckor">Visa</label><span class="veckoval" id="skVeckor">' +
                [1, 2, 4].map((v) => '<button type="button" data-skv="' + v + '" class="' + (v === veckor ? "vald" : "") + '">' + v + (v === 1 ? " vecka" : " veckor") + "</button>").join("") + "</span></div>" +
              '<div class="falt"><label for="skLank">Länk</label><input class="f" id="skLank" readonly value="' + esc(skarmUrl(tok, veckor)) + '"></div>' +
              '<p class="hjalp">Alla som har länken kan se tavlan utan att logga in. Byt länk om den har kommit på villovägar: den gamla slutar då att fungera.</p>'
            : '<p class="hjalp" style="margin-top:0">' + (kan
                ? "Skapa en länk som visar " + esc(t.namn) + " i visningsläge på en skärm, till exempel i Yodeck. Skärmen behöver inte logga in och uppdateras av sig själv."
                : "Det finns ingen skärmlänk för " + esc(t.namn) + " än. Be projektadmin skapa en.") + "</p>";
        const knappar = tok
            ? [].concat(kan ? [{ txt: "Ta bort länk", fara: true, vanster: true, fn: () => kor(null, "Skärmlänken är borttagen") },
                               { txt: "Byt länk", fn: () => kor(nyToken(), "Ny skärmlänk skapad. Den gamla fungerar inte längre.") }] : [])
                .concat([{ txt: "Öppna", fn: () => window.open(skarmUrl(tok, veckor), "_blank") },
                         { txt: "Kopiera länk", primar: true, fn: () => kopiera() }])
            : (kan ? [{ txt: "Avbryt", fn: stangModal }, { txt: "Skapa länk", primar: true, fn: () => kor(nyToken(), "Skärmlänken är skapad") }]
                   : [{ txt: "Stäng", primar: true, fn: stangModal }]);
        modal("Länk till skärm", p.projekt + " · " + t.namn, kropp(), knappar);
        const kopiera = async () => {
            const url = skarmUrl(tok, veckor);
            try { await navigator.clipboard.writeText(url); status("Länken är kopierad"); }
            catch (e) { const f = $("skLank"); if (f) { f.select(); document.execCommand && document.execCommand("copy"); } status("Länken är kopierad"); }
        };
        const kor = async (ny, txt) => {
            try { await andraSkarmLank(p.id, t.id, ny); stangModal(); status(txt); if (ny) skarmDialog(); }
            catch (e) { status("Kunde inte ändra länken: " + (e.code || e.message), true); }
        };
        const val = $("skVeckor");
        if (val) val.addEventListener("click", (e) => {
            const b = e.target.closest("[data-skv]");
            if (!b) return;
            veckor = +b.dataset.skv;
            val.querySelectorAll("[data-skv]").forEach((x) => x.classList.toggle("vald", x === b));
            $("skLank").value = skarmUrl(tok, veckor);
        });
    }
    document.addEventListener("click", (e) => { if (e.target.closest && e.target.closest("#skarmLank")) skarmDialog(); });
    function visaSkarmKnapp() {
        const b = $("skarmLank");
        if (!b) return;
        const m = anvandare && synkKlar ? projektMeta.get(state.id) : null;
        const ok = !!(m && m.version === 2 && ((m.visning && m.visning[T().id]) || kanSkapaSkarm(state.id, T().id)));
        b.classList.toggle("dold", !ok);
    }
    const ursRitaSkarm = rita;
    rita = function () { const r = ursRitaSkarm.apply(this, arguments); try { visaSkarmKnapp(); } catch (e) { } return r; };

    // Skärmen: öppnad med ?skarm=… visar bara tavlan, uppdateras av sig själv och sparar ingenting på datorn.
    async function startaSkarm() {
        document.body.classList.add("p4-skarm");
        spara = function () { };
        sparaNu = async function () { return true; };
        const veckor = [1, 2, 4].includes(+new URLSearchParams(location.search).get("veckor")) ? +new URLSearchParams(location.search).get("veckor") : 4;
        visaVy("laddar", "Hämtar tavlan…");
        // skärmen kan inte ändra något
        ["keydown", "dragstart", "dblclick", "contextmenu"].forEach((typ) => window.addEventListener(typ, (e) => { e.stopImmediatePropagation(); if (typ !== "keydown") e.preventDefault(); }, true));
        // Många poster på en dag: inget får klippas. Veckor med mycket får mer höjd, en full dag
        // lägger posterna i två eller tre spalter, och först därefter krymps de.
        const passa = () => {
            const g = document.querySelector(".rutnat");
            if (!g) return;
            const rutor = [...g.querySelectorAll(".ruta")];
            const inneI = (ruta) => [...ruta.children].filter((c) => !c.classList.contains("dagnr") && !c.classList.contains("plus"));
            g.style.gridTemplateRows = "";
            rutor.forEach((r) => { r.classList.remove("sk-kol2", "sk-kol3"); inneI(r).forEach((c) => { c.style.zoom = ""; }); });
            // hur mycket höjd varje vecka behöver
            const behov = (ruta) => {
                const top = ruta.getBoundingClientRect().top;
                let max = 0;
                inneI(ruta).forEach((c) => { max = Math.max(max, c.getBoundingClientRect().bottom - top); });
                return max + 6;
            };
            const full = (ruta) => ruta.scrollHeight > ruta.clientHeight + 1;
            // 1. veckor med mycket får mer höjd, de andra lite mindre
            if (rutor.some(full)) {
                const veckor = [];
                for (let i = 0; i < rutor.length; i += 5) veckor.push(Math.max(...rutor.slice(i, i + 5).map(behov)));
                const huvud = g.firstElementChild ? g.firstElementChild.getBoundingClientRect().height : 0;
                const H = window.innerHeight - huvud, lika = H / Math.max(1, veckor.length);
                const minst = Math.max(76, lika * 0.55);
                const vikter = veckor.map((v) => Math.max(minst, v));
                const summa = vikter.reduce((x, v) => x + v, 0);
                let hojd;
                if (summa <= H) hojd = vikter.map((v) => v + (H - summa) / vikter.length);
                else {
                    // allt får inte plats: varje vecka minst sin miniminivå, resten i proportion till behovet
                    const extra = vikter.map((v) => v - minst), ex = extra.reduce((x, v) => x + v, 0) || 1;
                    hojd = extra.map((e) => minst + (e / ex) * Math.max(0, H - minst * vikter.length));
                }
                g.style.gridTemplateRows = "auto " + hojd.map((h) => "minmax(0, " + Math.floor(h) + "px)").join(" ");
            }
            const krymp = (ruta, golv) => {
                const inne = inneI(ruta);
                let z = parseFloat((inne[0] && inne[0].style.zoom) || 1);
                for (let i = 0; i < 12 && full(ruta) && z > golv; i++) {
                    z = Math.max(golv, z * Math.min(0.95, Math.sqrt(ruta.clientHeight / ruta.scrollHeight)));
                    inne.forEach((c) => { c.style.zoom = String(z); });
                }
            };
            // 2. en full dag: två spalter och något mindre poster, sedan tre spalter, sist ännu mindre
            rutor.forEach((ruta) => {
                if (!full(ruta)) return;
                krymp(ruta, 0.85);
                if (!full(ruta)) return;
                inneI(ruta).forEach((c) => { c.style.zoom = ""; });
                ruta.classList.add("sk-kol2");
                krymp(ruta, 0.7);
                if (!full(ruta)) return;
                inneI(ruta).forEach((c) => { c.style.zoom = ""; });
                ruta.classList.remove("sk-kol2");
                ruta.classList.add("sk-kol3");
                krymp(ruta, 0.4);
            });
        };
        const ursRitaSk = rita;
        rita = function () {
            const r = ursRitaSk.apply(this, arguments);
            // hörnet ovanför veckorna: vilken tavla skärmen visar
            const horn = document.querySelector(".rutnat .hornruta");
            if (horn && state && T()) horn.innerHTML = '<span class="sk-tavla">' + esc(T().namn || "Tavla") + '</span><span class="sk-proj">' + esc(state.projekt || "") + "</span>";
            requestAnimationFrame(passa);
            return r;
        };
        window.addEventListener("resize", () => requestAnimationFrame(passa));
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => requestAnimationFrame(passa));
        let forsok = 0;
        const koppla = async () => {
            try {
                await laddaFirebase();
                fb.fs.onSnapshot(visningDoc(SKARM), (snap) => {
                    if (!snap.exists()) return visaVy("laddar", "Länken gäller inte längre. Be projektadmin om en ny länk.");
                    const x = snap.data();
                    let p;
                    try { p = JSON.parse(x.data); } catch (e) { return; }
                    if (!p || !Array.isArray(p.tavlor) || !p.tavlor.length) return visaVy("laddar", "Tavlan är tom just nu.");
                    rustaProjekt(p, IDAG);
                    p.aktiv = p.tavlor.some((t) => t.id === x.tavla) ? x.tavla : p.tavlor[0].id;
                    angraForeAvbryt();
                    plan4 = { version: VERSION, aktivtProjekt: p.id, projekt: [p] };
                    state = p;
                    vyOffset = 0;
                    document.title = (x.namn || p.projekt) + " · Wimo";
                    if (!document.body.classList.contains("visning")) vaxlaVisning(true);
                    visaVeckor = veckor;
                    visaVy("app");
                }, (e) => {
                    console.warn("Wimo skärm:", e);
                    visaVy("laddar", "Ingen kontakt just nu. Försöker igen…");
                    setTimeout(koppla, Math.min(60000, 5000 * ++forsok));
                });
            } catch (e) {
                visaVy("laddar", "Ingen kontakt just nu. Försöker igen…");
                setTimeout(koppla, Math.min(60000, 5000 * ++forsok));
            }
        };
        koppla();
        // ladda om sidan en gång per natt, så att skärmen alltid kör senaste versionen
        const natt = new Date(); natt.setHours(24, 3 + Math.floor(Math.random() * 20), 0, 0);
        setTimeout(() => location.reload(), natt - new Date());
    }

    nyttProjektDialog = barSkapare(nyttProjektDialog);
    raderaProjektDialog = barAdmin(raderaProjektDialog, "radera projekt");

    // ---------- start ----------
    if (SKARM && aktiverat) { startaSkarm(); return; }   // länk till en skärm: bara tavlan, ingen inloggning
    kopplaFormular();
    uppdateraUI();
    if (!aktiverat) { visaVy("app"); return; }        // utan Firebase-konfiguration: lokalt läge som förut
    visaVy("laddar");

    laddaFirebase().then(() => {
        fb.auth.onAuthStateChanged(fb.authInst, (u) => {
            if (anvLyssnare) { anvLyssnare(); anvLyssnare = null; }
            stoppaAdmin();
            stoppaPersoner();
            stoppaAnsokningar();
            ansokanKollad = "";
            stoppaApp();
            anvandare = u;
            konflikter.clear(); rensaVantande();
            const lasCache = u ? lasJson(LASNYCKEL, null) : null;
            behCache = lasCache && lasCache.uid === u.uid && lasCache.beh ? lasCache.beh : {};
            projektMeta.clear(); v1Data.clear();
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
