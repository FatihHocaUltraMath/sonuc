/* FatihHoca | UltraMat — Öğrenci Takip · uygulama (sürüm 0.2 · Aşama 1: ödev oluşturma + hızlı ödev kontrolü)
 *
 * Kalıcı verinin tek kaynağı UltraMat_Takip Google tablosudur. Telefonda yalnızca şunlar tutulur:
 *  - öğretmen anahtarı (her girişte sormamak için),
 *  - son okunan sınıf/öğrenci/ödev listesi (uygulama anında açılsın diye; arka planda tazelenir),
 *  - henüz gönderilemeyen kayıtlar (internet gelince kendiliğinden gönderilir),
 *  - kaydedilmemiş ilk kontrolün taslağı (derste yarıda kalırsa kaybolmasın).
 * Her kaydın kimliği telefonda üretilir; aynı kayıt iki kez gönderilse bile sunucuda çoğalmaz.
 * Ekranda görünen = son okunan liste + henüz gönderilmemiş kayıtlar (internetsiz de doğru görünür).
 */
"use strict";

// ===== AYAR: Apps Script "Web uygulaması" adresi (…/exec ile biter) =====
const API_URL = "https://script.google.com/macros/s/AKfycbw-WAIeNfMbb6nSp_Q0eraU6WG7ii20c1g6vhT-x91N_DqCuEkpuv5Caouzc1g-q-kZ1Q/exec";

const SURUM = "0.2";
const DEPO = {
  anahtar: "fhTakip_anahtar", onbellek: "fhTakip_baslangic", kuyruk: "fhTakip_kuyruk", sonSinif: "fhTakip_sonSinif",
  odevler: "fhTakip_odevler", taslak: "fhTakip_taslak", sonKonu: "fhTakip_sonKonu"
};
const ZAMAN_ASIMI_MS = 25000;
const TEKRAR_DENEME_MS = 30000;
const DURUM_SIRASI = ["T", "E", "Y", "M"];
const DURUM = {};
ETIKETLER.ODEV_DURUMLARI.forEach(d => { DURUM[d.kod] = d; });
const KISA_AD = { T: "Tam", E: "Eksik", Y: "Yapmadı", M: "Mazeret" };

const durum = {
  veri: null,            // sunucudan gelen başlangıç verisi
  seciliSinif: null,     // classId
  cevrimdisi: false,     // son tazeleme başarısız mı
  kuyrukHatasi: null,    // { kalici: bool, mesaj } — kırmızı durum için
  gonderiliyor: false,
  gonderimSayaci: 0,     // başarılı her gönderimde artar (eski ödev listesinin üstüne yazılmasın diye)
  odevYukleniyor: {},    // classId → true
  odevHata: {},          // classId → mesaj
  yigin: [],             // açık ekranlar: [{e:"odevListe"}, {e:"kontrol", id}, …]
  kontrol: null,         // açık kontrol: { odevId, classId, kayitli, calisma }
  ozet: null,            // son kaydın özeti: { odevId, ilk, onceki }
  cikisOnayli: false,
  form: null             // açık form: { id } (düzenleme) ya da { id: null } (yeni)
};

// ---------- küçük yardımcılar ----------
const $ = id => document.getElementById(id);

const depo = {
  oku(k, yedek) { try { const v = localStorage.getItem(k); return v === null ? yedek : JSON.parse(v); } catch (e) { return yedek; } },
  yaz(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  sil(k) { try { localStorage.removeItem(k); } catch (e) { /* önemsiz */ } }
};

function yeniKimlik() {
  if (window.crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function el(etiket, sinif, metin) {
  const e = document.createElement(etiket);
  if (sinif) e.className = sinif;
  if (metin !== undefined && metin !== null) e.textContent = metin;
  return e;
}
function dugme(sinif, metin, tik) {
  const b = el("button", sinif, metin);
  b.type = "button";
  if (tik) b.addEventListener("click", tik);
  return b;
}
const kopya = x => JSON.parse(JSON.stringify(x));

function bugunMetni() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function tarihYaz(t) {
  if (!t) return "";
  const d = new Date(t + "T12:00:00");
  if (isNaN(d)) return t;
  return d.toLocaleDateString("tr-TR", { day: "numeric", month: "long", weekday: "short" });
}

/** Sunucudaki donemBul ile aynı kural. */
function donemBul(gun) {
  const donemler = (durum.veri && durum.veri.donemler) || [];
  if (!donemler.length) return { no: 0 };
  for (const d of donemler) if (gun >= d.bas && gun <= d.bit) return { no: d.no };
  if (gun < donemler[0].bas) return { no: donemler[0].no };
  let onceki = donemler[0];
  donemler.forEach(d => { if (d.bit < gun) onceki = d; });
  return { no: onceki.no };
}

function apiAyarliMi() { return /^https:\/\/script\.google\.com\/.+\/exec$/.test(API_URL); }

class SunucuHatasi extends Error {
  constructor(yanit) { super(yanit && yanit.mesaj || "Sunucu isteği reddetti."); this.kod = yanit && yanit.kod; }
}

/** Sunucuya istek. Ağ hatasında Error, sunucunun reddinde SunucuHatasi fırlatır. */
async function api(islem, ek, anahtar) {
  const govde = Object.assign({ islem, anahtar: anahtar !== undefined ? anahtar : depo.oku(DEPO.anahtar, "") }, ek || {});
  const kontrol = new AbortController();
  const zamanlayici = setTimeout(() => kontrol.abort(), ZAMAN_ASIMI_MS);
  let yanit;
  try {
    const r = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },   // ön kontrol (CORS preflight) istemez
      body: JSON.stringify(govde),
      signal: kontrol.signal,
      redirect: "follow"
    });
    if (!r.ok) throw new Error("Sunucu yanıt vermedi (" + r.status + ").");
    yanit = await r.json();
  } finally {
    clearTimeout(zamanlayici);
  }
  if (!yanit || yanit.ok !== true) throw new SunucuHatasi(yanit);
  return yanit;
}

function anahtarReddi(e) { return e instanceof SunucuHatasi && (e.kod === "anahtar" || e.kod === "anahtar_yok"); }

// ---------- ekranlar ve gezinme ----------
const EKRANLAR = ["giris", "ana", "bolum", "odevListe", "odevForm", "kontrol", "ozet"];

function ekranGoster(ad) {
  EKRANLAR.forEach(e => { $("ekran-" + e).hidden = e !== ad; });
  $("durumCubugu").hidden = ad === "giris";
  $("kaydetCubugu").hidden = ad !== "kontrol";
  document.body.classList.toggle("kaydetVar", ad === "kontrol");
  window.scrollTo(0, 0);
}

/** Yeni ekran aç (telefonun geri tuşu bir öncekine döner). */
function ileri(ekran) {
  durum.yigin.push(ekran);
  history.pushState({ d: durum.yigin.length }, "");
  ciz();
}
/** Üstteki ekranı değiştir (geri tuşu yine bir alttakine döner). */
function degistir(ekran) {
  durum.yigin[durum.yigin.length - 1] = ekran;
  ciz();
}
function geri(n) { history.go(-(n || 1)); }

function gecmisDegisti(ev) {
  if (!durum.veri) return;
  const d = ev.state && ev.state.d ? ev.state.d : 0;
  const kapanan = durum.yigin.slice(d);
  if (!durum.cikisOnayli && kapanan.some(x => x.e === "kontrol") && duzeltmeBekliyor()) {
    history.pushState({ d: durum.yigin.length }, "");     // geri gitmeyi durdur, önce sor
    kaydedilmemisSor();
    return;
  }
  durum.cikisOnayli = false;
  durum.yigin = durum.yigin.slice(0, d);
  ciz();
}

function ciz() {
  const ust = durum.yigin[durum.yigin.length - 1];
  if (!ust) { anaEkraniAc(); return; }
  if (ust.e === "bolum") bolumCiz(ust.ad);
  else if (ust.e === "odevListe") odevListeCiz();
  else if (ust.e === "odevForm") odevFormCiz();
  else if (ust.e === "kontrol") kontrolCiz(true);
  else if (ust.e === "ozet") ozetCiz();
  durumCubugunuCiz();
}

function girisGoster(mesaj) {
  ekranGoster("giris");
  $("donemEtiketi").textContent = "";
  const h = $("girisHata");
  h.hidden = !mesaj;
  h.textContent = mesaj || "";
  if (!apiAyarliMi()) {
    h.hidden = false;
    h.textContent = "Kurulum eksik: takip.js dosyasının başındaki API_URL satırına web uygulaması adresi yazılmamış.";
  }
}

async function girisYap() {
  const anahtar = $("anahtarInput").value.trim();
  const d = $("girisDugme");
  if (!anahtar) { girisGoster("Anahtarı yazın."); return; }
  if (!apiAyarliMi()) { girisGoster(); return; }
  d.disabled = true; d.textContent = "Kontrol ediliyor…";
  try {
    const veri = await api("baslangic", null, anahtar);
    depo.yaz(DEPO.anahtar, anahtar);
    $("anahtarInput").value = "";
    veriyiKabulEt(veri);
    durum.yigin = [];
    history.replaceState({ d: 0 }, "");
    anaEkraniAc();
    kuyruguGonder();
  } catch (e) {
    if (e instanceof SunucuHatasi) girisGoster(e.kod === "anahtar" ? "Anahtar kabul edilmedi. Tablodaki anahtarla aynı olduğundan emin olun." : e.message);
    else girisGoster("Sunucuya ulaşılamadı. İnternet bağlantısını kontrol edip tekrar deneyin.");
  } finally {
    d.disabled = false; d.textContent = "Giriş yap";
  }
}

function veriyiKabulEt(veri) {
  veri.alinma = Date.now();
  durum.veri = veri;
  durum.cevrimdisi = false;
  depo.yaz(DEPO.onbellek, veri);
}

function anaEkraniAc() {
  ekranGoster("ana");
  anaEkraniCiz();
  durumCubugunuCiz();
}

function aktifSiniflar() { return ((durum.veri && durum.veri.siniflar) || []).filter(s => s.ogrenciler.some(o => o.aktif)); }
function sinifBul(classId) { return ((durum.veri && durum.veri.siniflar) || []).find(s => s.classId === classId) || null; }

function anaEkraniCiz() {
  const v = durum.veri;
  if (!v) return;
  $("donemEtiketi").innerHTML = "";
  $("donemEtiketi").append(el("div", "", v.egitimYili || ""), el("div", "", v.donem ? v.donem.ad + (v.donem.tatil ? " (tatil)" : "") : ""));

  // Veri uyarıları (ör. aynı Kod iki öğrencide)
  const uk = $("uyariKutusu");
  if (v.uyarilar && v.uyarilar.length) {
    uk.innerHTML = "<b>Ogrenciler sayfasında düzeltilmesi gereken:</b>";
    const ul = el("ul");
    v.uyarilar.forEach(u => ul.appendChild(el("li", "", u)));
    uk.appendChild(ul);
    uk.hidden = false;
  } else uk.hidden = true;

  const izgara = $("sinifIzgara");
  izgara.innerHTML = "";
  const siniflar = aktifSiniflar();
  if (!siniflar.some(s => s.classId === durum.seciliSinif)) {
    const son = depo.oku(DEPO.sonSinif, null);
    durum.seciliSinif = siniflar.some(s => s.classId === son) ? son : (siniflar[0] ? siniflar[0].classId : null);
  }
  siniflar.forEach(s => {
    const secili = s.classId === durum.seciliSinif;
    const b = dugme("sinifDugme" + (secili ? " secili" : ""), null, () => {
      durum.seciliSinif = s.classId; depo.yaz(DEPO.sonSinif, s.classId); anaEkraniCiz();
    });
    b.setAttribute("aria-pressed", secili ? "true" : "false");
    b.append(el("b", "", s.classId), el("small", "", s.ogrenciler.filter(o => o.aktif).length + " öğrenci"));
    izgara.appendChild(b);
  });
  $("sinifBos").hidden = siniflar.length > 0;
  $("sinifBos").textContent = "Ogrenciler sayfasında sınıfı ve adı dolu öğrenci bulunamadı.";
  $("surumBilgi").textContent = "FatihHoca UltraMat · Öğrenci Takip · sürüm " + SURUM + (v.surum && v.surum !== SURUM ? " · sunucu " + v.surum : "");
}

const BOLUMLER = {
  gozlem: { ad: "Ders İçi Gözlem", asama: 3 },
  ogrenci: { ad: "Öğrenci Görünümü", asama: 4 },
  rapor: { ad: "Excel · PDF", asama: 5 }
};

function bolumAc(ad) {
  if (!durum.seciliSinif) return;
  if (ad === "odev") { ileri({ e: "odevListe" }); odevleriTazele(durum.seciliSinif); return; }
  if (BOLUMLER[ad]) ileri({ e: "bolum", ad });
}
function bolumCiz(ad) {
  const b = BOLUMLER[ad];
  $("bolumBaslik").textContent = b.ad + (durum.seciliSinif ? " · " + durum.seciliSinif : "");
  $("bolumMetin").textContent = "Bu bölüm Aşama " + b.asama + "'de eklenecek.";
  ekranGoster("bolum");
}

// ---------- ödev verisi: son okunan liste + bekleyen kayıtlar ----------
function odevVerisi(classId) {
  const tum = depo.oku(DEPO.odevler, {});
  const v = kopya(tum[classId] || { odevler: [], kontrol: {}, yok: true });
  depo.oku(DEPO.kuyruk, []).forEach(k => yereleUygula(v, k, classId));
  return v;
}

/** Bir kaydı telefondaki ödev verisine uygular (sunucunun yapacağının aynısı). */
function yereleUygula(v, k, classId) {
  const x = k.veri || {};
  if (x.classId !== classId) return;
  if (k.tur === "odevOlustur") {
    if (!v.odevler.some(o => o.id === x.odevId)) {
      v.odevler.push({ id: x.odevId, tarih: x.tarih, konu: x.konu || "", ad: x.ad, aciklama: x.aciklama || "", iptal: false, donemNo: donemBul(x.tarih).no });
    }
  } else if (k.tur === "odevGuncelle") {
    const o = v.odevler.find(o => o.id === x.odevId);
    if (!o) return;
    ["ad", "konu", "aciklama", "tarih"].forEach(a => { if (x[a] !== undefined) o[a] = x[a]; });
    if (x.tarih) o.donemNo = donemBul(x.tarih).no;
    if (x.iptal) o.iptal = true;
  } else if (k.tur === "odevKontrol") {
    const m = v.kontrol[x.odevId] = v.kontrol[x.odevId] || {};
    (x.durumlar || []).forEach(d => { if (d.d) m[d.kod] = d.d; else delete m[d.kod]; });
  }
}

async function odevleriTazele(classId) {
  if (!apiAyarliMi() || !classId || durum.odevYukleniyor[classId]) return;
  durum.odevYukleniyor[classId] = true;
  const sayac = durum.gonderimSayaci;
  if (ekranAcik("odevListe")) odevListeCiz();
  let tekrar = false;
  try {
    const y = await api("odevler", { classId });
    if (sayac !== durum.gonderimSayaci) tekrar = true;      // bu arada kayıt gitti; liste eskimiş olabilir
    else {
      const tum = depo.oku(DEPO.odevler, {});
      tum[classId] = { odevler: y.odevler || [], kontrol: y.kontrol || {}, alinma: Date.now() };
      depo.yaz(DEPO.odevler, tum);
      delete durum.odevHata[classId];
    }
  } catch (e) {
    if (anahtarReddi(e)) { depo.sil(DEPO.anahtar); girisGoster("Anahtar değişmiş ya da kaldırılmış. Yeni anahtarla giriş yapın."); return; }
    durum.odevHata[classId] = e instanceof SunucuHatasi ? e.message : "Ödev listesi güncellenemedi (internet yok olabilir).";
  } finally {
    durum.odevYukleniyor[classId] = false;
  }
  if (tekrar) { odevleriTazele(classId); return; }
  if (ekranAcik("odevListe")) odevListeCiz();
}

function ekranAcik(ad) { const u = durum.yigin[durum.yigin.length - 1]; return !!u && u.e === ad && !$("ekran-" + ad).hidden; }

function donemOdevleri(v) {
  const no = durum.veri && durum.veri.donem ? durum.veri.donem.no : 0;
  return v.odevler.filter(o => !o.iptal && (!no || o.donemNo === no))
    .sort((a, b) => (b.tarih || "").localeCompare(a.tarih || ""));
}

function sayilar(harita) {
  const c = { T: 0, E: 0, Y: 0, M: 0 };
  Object.values(harita || {}).forEach(d => { if (c[d] !== undefined) c[d]++; });
  return c;
}

// ---------- 1. ödev listesi ----------
function odevListeCiz() {
  const classId = durum.seciliSinif;
  const sinif = sinifBul(classId);
  ekranGoster("odevListe");
  $("odevListeBaslik").textContent = "Ödev Takibi · " + classId;
  const donemAd = durum.veri && durum.veri.donem ? durum.veri.donem.ad : "";
  $("odevListeAlt").textContent = (donemAd ? donemAd + " ödevleri. " : "") + "Birine dokunun: kontrol edin ya da düzeltin.";

  const kutu = $("odevListeIcerik");
  kutu.innerHTML = "";
  const v = odevVerisi(classId);
  const taslaklar = depo.oku(DEPO.taslak, {});
  const ogrSay = sinif ? sinif.ogrenciler.filter(o => o.aktif).length : 0;

  if (v.yok && durum.odevYukleniyor[classId]) { kutu.appendChild(el("div", "kart bos", "Ödevler yükleniyor…")); return; }
  if (v.yok && durum.odevHata[classId]) { kutu.appendChild(el("div", "kart bos", durum.odevHata[classId] + " İnternet gelince \"Listeyi yenile\"ye dokunun.")); }
  else if (durum.odevHata[classId]) kutu.appendChild(el("p", "ipucu", "Liste güncellenemedi; telefondaki son liste gösteriliyor."));

  const liste = donemOdevleri(v);
  if (!liste.length && !v.yok) { kutu.appendChild(el("div", "kart bos", "Bu dönem henüz ödev yok. Yukarıdaki düğmeyle ilkini oluşturun.")); }

  const bekleyen = liste.filter(o => !Object.keys(v.kontrol[o.id] || {}).length);
  const yapilan = liste.filter(o => Object.keys(v.kontrol[o.id] || {}).length);

  function kart(o, kontrollu) {
    const b = dugme("odevKart " + (kontrollu ? "kontrollu" : "bekliyor"), null, () => kontrolBaslat(o.id));
    const ust = el("div", "odevUst");
    ust.append(el("span", "odevAd", o.ad), el("span", "odevTarih", tarihYaz(o.tarih)));
    b.append(ust, el("div", "odevKonu", o.konu || "Konu yok"));
    const dr = el("div", "odevDurum");
    if (kontrollu) {
      const k = v.kontrol[o.id], c = sayilar(k);
      DURUM_SIRASI.forEach(d => dr.appendChild(el("span", "rozet", DURUM[d].emoji + " " + c[d])));
      const isaretsiz = sinif ? sinif.ogrenciler.filter(s => s.aktif && !k[s.kod]).length : 0;
      if (isaretsiz) dr.appendChild(el("span", "rozet b", isaretsiz + " işaretsiz"));
    } else {
      const tas = taslaklar[o.id] ? Object.keys(taslaklar[o.id]).length : 0;
      dr.appendChild(tas ? el("span", "rozet tas", "✏️ Taslak: " + tas + "/" + ogrSay + " işaretli, kaydedilmedi")
                         : el("span", "rozet b", "Kontrol edilmedi"));
    }
    b.appendChild(dr);
    return b;
  }
  if (bekleyen.length) { kutu.appendChild(el("div", "grupBaslik", "Kontrol bekleyen")); bekleyen.forEach(o => kutu.appendChild(kart(o, false))); }
  if (yapilan.length) { kutu.appendChild(el("div", "grupBaslik", "Kontrol edilenler")); yapilan.forEach(o => kutu.appendChild(kart(o, true))); }
  if (durum.odevYukleniyor[classId] && !v.yok) kutu.appendChild(el("p", "ipucu merkez", "Güncelleniyor…"));
}

// ---------- 2. yeni ödev / düzenleme ----------
function formAc(id) {
  durum.form = { id: id || null };
  ileri({ e: "odevForm" });
}

function odevFormCiz() {
  const classId = durum.seciliSinif;
  const sinif = sinifBul(classId);
  const id = durum.form && durum.form.id;
  const o = id ? odevVerisi(classId).odevler.find(x => x.id === id) : null;
  ekranGoster("odevForm");
  $("formBaslik").textContent = o ? "Ödev bilgilerini düzenle" : "Yeni ödev";
  $("formAlt").textContent = classId + " için";

  $("fTarih").value = o ? o.tarih : bugunMetni();
  const konular = (durum.veri.konular && sinif && durum.veri.konular[sinif.sinif]) || [];
  const sonKonu = depo.oku(DEPO.sonKonu, {})[classId];
  const secili = o ? o.konu : (konular.indexOf(sonKonu) !== -1 ? sonKonu : (konular[0] || ""));
  const sec = $("fKonu");
  sec.innerHTML = "";
  konular.forEach(k => { const op = el("option", "", k); op.value = k; sec.appendChild(op); });
  if (o && o.konu && konular.indexOf(o.konu) === -1) { const op = el("option", "", o.konu); op.value = o.konu; sec.appendChild(op); }
  const yok = el("option", "", "— Konu yok (genel tekrar vb.)"); yok.value = ""; sec.appendChild(yok);
  sec.value = secili;
  $("konuNot").textContent = o ? "" : (konular.length
    ? (sonKonu && secili === sonKonu ? "Bu sınıfta en son kullandığınız konu seçili geldi." : "Konular Müfredat sayfasından.")
    : "Müfredat sayfasında bu sınıf düzeyi için konu bulunamadı.");
  $("fAd").value = o ? o.ad : "";
  $("fAd").classList.remove("hatali");
  $("fAciklama").value = o ? o.aciklama : "";
  $("fAciklama").hidden = !(o && o.aciklama);
  $("aciklamaAc").hidden = !$("fAciklama").hidden;

  const dugmeler = $("formDugmeler");
  dugmeler.innerHTML = "";
  if (o) dugmeler.appendChild(dugme("anaDugme", "Değişiklikleri kaydet", () => formKaydet(false)));
  else {
    dugmeler.appendChild(dugme("anaDugme", "Ödevi oluştur", () => formKaydet(false)));
    dugmeler.appendChild(dugme("ikinciDugme", "Oluştur ve hemen kontrol et", () => formKaydet(true)));
  }
  $("iptalAlani").hidden = !o;
}

function formKaydet(hemenKontrol) {
  const classId = durum.seciliSinif;
  const ad = $("fAd").value.replace(/\s+/g, " ").trim();
  if (!ad) { $("fAd").classList.add("hatali"); $("fAd").focus(); bildirimGoster("Ödeve kısa bir ad yazın."); return; }
  const konu = $("fKonu").value;
  const tarih = $("fTarih").value || bugunMetni();
  const aciklama = $("fAciklama").value.trim();
  if (konu) { const sk = depo.oku(DEPO.sonKonu, {}); sk[classId] = konu; depo.yaz(DEPO.sonKonu, sk); }

  const id = durum.form && durum.form.id;
  if (id) {
    const o = odevVerisi(classId).odevler.find(x => x.id === id);
    const degisen = { odevId: id, classId };
    let var_ = false;
    if (o.ad !== ad) { degisen.ad = ad; var_ = true; }
    if (o.konu !== konu) { degisen.konu = konu; var_ = true; }
    if (o.tarih !== tarih) { degisen.tarih = tarih; var_ = true; }
    if ((o.aciklama || "") !== aciklama) { degisen.aciklama = aciklama; var_ = true; }
    if (var_ && !kuyrugaEkle("odevGuncelle", degisen)) return;
    if (var_) bildirimGoster("Ödev bilgileri güncellendi");
    geri();                                   // kontrol ekranına dön
    return;
  }
  const odevId = yeniKimlik();
  if (!kuyrugaEkle("odevOlustur", { odevId, classId, tarih, konu, ad, aciklama })) return;
  if (hemenKontrol) { kontrolHazirla(odevId); degistir({ e: "kontrol", id: odevId }); }
  else { geri(); bildirimGoster("Ödev oluşturuldu: " + ad); }
}

function iptalSor() {
  const id = durum.form && durum.form.id;
  sayfaAc(sy => {
    sy.append(el("h3", "", "Bu ödev iptal edilsin mi?"),
      el("p", "", "Listeden kalkar ve veli mesajlarındaki 4'lü sayıma girmez. Tablodan silinmez; “İptal” sütununa tarih yazılır, kontrol kayıtları da korunur."));
    const evet = dugme("secenek tehlike", null, () => {
      if (!kuyrugaEkle("odevGuncelle", { odevId: id, classId: durum.seciliSinif, iptal: true })) return;
      const taslak = depo.oku(DEPO.taslak, {}); delete taslak[id]; depo.yaz(DEPO.taslak, taslak);
      sayfaKapat();
      durum.cikisOnayli = true;
      const listeSirasi = durum.yigin.findIndex(x => x.e === "odevListe");
      geri(durum.yigin.length - 1 - listeSirasi);
      bildirimGoster("Ödev iptal edildi");
    });
    evet.appendChild(el("b", "", "İptal et"));
    sy.append(evet, dugme("ikinciDugme", "Vazgeç", sayfaKapat));
  });
}

// ---------- 3. hızlı kontrol ----------
function kontrolHazirla(odevId) {
  const classId = durum.seciliSinif;
  const v = odevVerisi(classId);
  const kayitli = kopya(v.kontrol[odevId] || {});
  const taslak = depo.oku(DEPO.taslak, {})[odevId];
  const kayitliVar = Object.keys(kayitli).length > 0;
  durum.kontrol = { odevId, classId, kayitli: kayitliVar ? kayitli : null, calisma: kayitliVar ? kopya(kayitli) : kopya(taslak || {}) };
}

function kontrolBaslat(odevId) {
  kontrolHazirla(odevId);
  ileri({ e: "kontrol", id: odevId });
}

/** Kontroldeki öğrenciler: sınıfın aktif öğrencileri + bu ödevde kaydı olan ayrılmış öğrenciler. */
function kontrolOgrencileri() {
  const k = durum.kontrol, sinif = sinifBul(k.classId);
  if (!sinif) return [];
  return sinif.ogrenciler.filter(o => o.aktif || (k.kayitli && k.kayitli[o.kod]) || k.calisma[o.kod]);
}

function duzeltmeBekliyor() {
  const k = durum.kontrol;
  if (!k || !k.kayitli) return false;
  return fark(k.kayitli, k.calisma).length > 0;
}
function fark(a, b) {
  const kodlar = new Set(Object.keys(a || {}).concat(Object.keys(b || {})));
  return Array.from(kodlar).filter(kod => (a[kod] || "") !== (b[kod] || ""));
}

function kontrolCiz(ilkCizim) {
  const k = durum.kontrol;
  if (!k) { geri(); return; }
  const o = odevVerisi(k.classId).odevler.find(x => x.id === k.odevId);
  if (!o) { geri(); return; }
  if (ilkCizim) ekranGoster("kontrol");
  $("kAd").textContent = o.ad;
  const alt = $("kAlt");
  alt.innerHTML = "";
  alt.append(document.createTextNode((o.konu || "Konu yok") + " · " + tarihYaz(o.tarih) + " · " + k.classId + " · "),
    dugme("baglantiDugme", "Bilgileri düzenle", () => formAc(o.id)));
  if (k.kayitli) alt.appendChild(el("span", "kayitliNot", "Kaydedilmiş kontrol. Değiştirdiğiniz satırlar mor işaretlenir."));

  const ogr = kontrolOgrencileri();
  const liste = $("ogrListe");
  liste.innerHTML = "";
  ogr.forEach(s => {
    const d = k.calisma[s.kod] || "";
    const once = k.kayitli ? (k.kayitli[s.kod] || "") : "";
    const satir = el("div", "ogrSatir" + (d && d !== "T" ? " istisna" : ""));
    const ad = el("div", "ogrAd", s.ad);
    if (k.kayitli && once !== d) ad.appendChild(el("small", "degisti", "değişti (önce: " + (once ? DURUM[once].ad : "boş") + ")"));
    else if (!s.aktif) ad.appendChild(el("small", "", "ayrıldı"));
    else if (!d) ad.appendChild(el("small", "", "işaretlenmedi"));
    const seg = el("div", "segment");
    seg.setAttribute("role", "group");
    seg.setAttribute("aria-label", s.ad);
    DURUM_SIRASI.forEach(kod => {
      const b = dugme("seg " + kod + (d === kod ? " secili" : ""), DURUM[kod].emoji, () => isaretle(s.kod, kod));
      b.setAttribute("aria-pressed", d === kod ? "true" : "false");
      b.setAttribute("aria-label", DURUM[kod].ad);
      seg.appendChild(b);
    });
    satir.append(ad, seg);
    liste.appendChild(satir);
  });

  const c = sayilar(k.calisma);
  const bos = ogr.filter(s => s.aktif && !k.calisma[s.kod]).length;
  const aktifSay = ogr.filter(s => s.aktif).length;
  const tb = $("tumuDugme");
  tb.disabled = bos === 0;
  tb.textContent = bos === 0 ? "✅ Herkes işaretli" : (bos === aktifSay ? "✅ Tümünü Tam işaretle (" + bos + ")" : "✅ Kalan " + bos + " öğrenciyi Tam yap");

  const sayac = $("sayac");
  sayac.innerHTML = "";
  DURUM_SIRASI.forEach(d => sayac.appendChild(el("span", "", DURUM[d].emoji + " " + c[d])));
  if (bos) sayac.appendChild(el("span", "bosSayi", "— " + bos + " boş"));
  const kd = $("kaydetDugme");
  kd.textContent = k.kayitli ? "Düzeltmeyi Kaydet" : "Kontrolü Kaydet";
  kd.disabled = k.kayitli ? !duzeltmeBekliyor() : Object.keys(k.calisma).length === 0;

  // İlk kontrol kaydedilene kadar telefonda taslak olarak saklanır
  if (!k.kayitli) {
    const taslak = depo.oku(DEPO.taslak, {});
    if (Object.keys(k.calisma).length) taslak[k.odevId] = k.calisma; else delete taslak[k.odevId];
    depo.yaz(DEPO.taslak, taslak);
  }
}

function isaretle(kod, d) {
  const k = durum.kontrol;
  if (k.calisma[kod] === d) delete k.calisma[kod];      // aynı düğmeye tekrar dokunmak işareti kaldırır
  else k.calisma[kod] = d;
  kontrolCiz(false);
}

function tumunuTam() {
  const k = durum.kontrol;
  const onceki = kopya(k.calisma);
  let n = 0;
  kontrolOgrencileri().forEach(s => { if (s.aktif && !k.calisma[s.kod]) { k.calisma[s.kod] = "T"; n++; } });
  kontrolCiz(false);
  bildirimGoster(n + " öğrenci Tam işaretlendi", () => { if (durum.kontrol === k) { k.calisma = onceki; kontrolCiz(false); } });
}

function kaydetBas() {
  const k = durum.kontrol;
  const bos = kontrolOgrencileri().filter(s => s.aktif && !k.calisma[s.kod]);
  if (!bos.length) { kaydet(); return; }
  sayfaAc(sy => {
    sy.append(el("h3", "", bos.length + " öğrenci işaretlenmedi"),
      el("p", "", bos.map(s => s.ad).join(", ")),
      el("p", "", "Bunlar “kontrol edilmedi” olarak kalır; “Yapılmadı” sayılmaz. Derste yoksa ⚪ Mazeretli seçebilirsiniz. Sonra açıp tamamlayabilirsiniz."),
      dugme("anaDugme", "Yine de kaydet", () => { sayfaKapat(); kaydet(); }),
      el("div", "bosluk"),
      dugme("ikinciDugme", "Geri dön, işaretleyeyim", sayfaKapat));
  });
}

function kaydet() {
  const k = durum.kontrol;
  const once = k.kayitli || {};
  const ogrAd = {};
  sinifBul(k.classId).ogrenciler.forEach(s => { ogrAd[s.kod] = s.ad; });
  const durumlar = fark(once, k.calisma).map(kod => ({ kod, ad: ogrAd[kod] || "", d: k.calisma[kod] || "" }));
  if (!durumlar.length) return;
  if (!kuyrugaEkle("odevKontrol", { odevId: k.odevId, classId: k.classId, durumlar })) return;
  const taslak = depo.oku(DEPO.taslak, {}); delete taslak[k.odevId]; depo.yaz(DEPO.taslak, taslak);
  durum.ozet = { odevId: k.odevId, classId: k.classId, ilk: !k.kayitli, onceki: k.kayitli };
  kontrolHazirla(k.odevId);                                 // artık kayıtlı; "Düzelt" buradan başlar
  degistir({ e: "ozet", id: k.odevId });
}

function kaydedilmemisSor() {
  sayfaAc(sy => {
    sy.append(el("h3", "", "Düzeltme kaydedilmedi"), el("p", "", "Yaptığınız değişiklikler kaybolacak."),
      dugme("anaDugme", "Kaydet", () => { sayfaKapat(); kaydet(); }),
      el("div", "bosluk"),
      dugme("ikinciDugme", "Kaydetmeden çık", () => { sayfaKapat(); durum.cikisOnayli = true; geri(); }));
  });
}

// ---------- 4. özet ----------
function ozetCiz() {
  const oz = durum.ozet;
  if (!oz) { geri(); return; }
  ekranGoster("ozet");
  const v = odevVerisi(oz.classId);
  const o = v.odevler.find(x => x.id === oz.odevId);
  const k = v.kontrol[oz.odevId] || {};
  const sinif = sinifBul(oz.classId);
  const ogr = sinif ? sinif.ogrenciler.filter(s => s.aktif || k[s.kod]) : [];
  const c = sayilar(k);
  $("oBaslik").textContent = oz.ilk ? "Kontrol kaydedildi" : "Düzeltme kaydedildi";
  $("oAlt").textContent = (o ? o.ad : "") + " · " + oz.classId + " · " + ogr.filter(s => s.aktif).length + " öğrenci";

  const sy = $("oSayilar");
  sy.innerHTML = "";
  DURUM_SIRASI.forEach(d => { const x = el("div", "ozetSayi"); x.append(el("b", "", String(c[d])), el("small", "", DURUM[d].emoji + " " + DURUM[d].ad)); sy.appendChild(x); });

  const g = $("oGruplar");
  g.innerHTML = "";
  function grup(baslik, metin, acilir) {
    if (!metin) return;
    const kutu = el(acilir ? "details" : "div", "ozetGrup");
    kutu.append(el(acilir ? "summary" : "h4", "", baslik), el("p", "", metin));
    g.appendChild(kutu);
  }
  const adlar = f => ogr.filter(f).map(s => s.ad).join(", ");
  if (!oz.ilk && oz.onceki) {
    const degisen = ogr.filter(s => (oz.onceki[s.kod] || "") !== (k[s.kod] || ""));
    grup("✏️ Bu düzeltmede değişen", degisen.map(s => s.ad + ": " + (oz.onceki[s.kod] ? DURUM[oz.onceki[s.kod]].ad : "boş") + " → " + (k[s.kod] ? DURUM[k[s.kod]].ad : "boş")).join("\n"));
  }
  const bos = adlar(s => s.aktif && !k[s.kod]);
  if (!c.E && !c.Y && !c.M && !bos) grup("İstisna yok", "Herkes tam yapmış.");
  ["E", "Y", "M"].forEach(d => grup(DURUM[d].emoji + " " + DURUM[d].ad, adlar(s => k[s.kod] === d)));
  grup("— İşaretlenmedi (kontrol edilmedi)", bos);
  grup("✅ Tam (" + c.T + ") · adları göster", adlar(s => k[s.kod] === "T"), true);
}

// ---------- alt sayfa ve bildirim ----------
function sayfaAc(doldur) {
  const sy = $("altSayfa");
  sy.innerHTML = "";
  doldur(sy);
  $("perde").hidden = false;
}
function sayfaKapat() { $("perde").hidden = true; }

let bildirimZamanlayici = null;
function bildirimGoster(metin, geriAl) {
  $("bildirimMetin").textContent = metin;
  const b = $("bildirimDugme");
  b.hidden = !geriAl;
  b.onclick = () => { if (geriAl) geriAl(); $("bildirim").hidden = true; };
  $("bildirim").hidden = false;
  clearTimeout(bildirimZamanlayici);
  bildirimZamanlayici = setTimeout(() => { $("bildirim").hidden = true; }, 5000);
}

// ---------- tazeleme ----------
async function tazele(elle) {
  if (!apiAyarliMi()) return;
  const d = $("yenileDugme");
  if (elle) { d.disabled = true; d.textContent = "Yenileniyor…"; }
  try {
    const veri = await api("baslangic");
    veriyiKabulEt(veri);
    if (!$("ekran-ana").hidden) anaEkraniCiz();
  } catch (e) {
    if (anahtarReddi(e)) {
      depo.sil(DEPO.anahtar);
      girisGoster("Anahtar değişmiş ya da kaldırılmış. Yeni anahtarla giriş yapın.");
      return;
    }
    durum.cevrimdisi = true;
    if (!durum.veri) {
      ekranGoster("ana");
      $("sinifIzgara").innerHTML = "";
      $("sinifBos").hidden = false;
      $("sinifBos").textContent = e instanceof SunucuHatasi ? e.message : "Sunucuya ulaşılamadı. İnternet gelince \"Listeyi yenile\"ye dokunun.";
    }
  } finally {
    if (elle) { d.disabled = false; d.textContent = "Listeyi yenile"; }
    durumCubugunuCiz();
  }
}

// ---------- bekleyen kayıtlar kuyruğu ----------
/** Bir kaydı kuyruğa ekler ve hemen göndermeyi dener. Ekrandaki değişiklik beklemeden görünür. */
function kuyrugaEkle(tur, veri) {
  const kuyruk = depo.oku(DEPO.kuyruk, []);
  const kayit = { id: yeniKimlik(), tur, veri, eklenme: Date.now() };
  kuyruk.push(kayit);
  if (!depo.yaz(DEPO.kuyruk, kuyruk)) {
    alert("Kayıt telefona yazılamadı (depolama dolu olabilir). Lütfen tekrar deneyin.");
    return null;
  }
  durumCubugunuCiz();
  kuyruguGonder();
  return kayit.id;
}

/** Gönderilen kayıtları telefondaki son listeye işler; böylece kuyruktan çıkınca ekrandan kaybolmazlar. */
function gidenleriListeyeIsle(kayitlar) {
  const tum = depo.oku(DEPO.odevler, {});
  let degisti = false;
  kayitlar.forEach(k => {
    const classId = k.veri && k.veri.classId;
    if (!classId) return;
    if (!tum[classId]) { setTimeout(() => odevleriTazele(classId), 0); return; }   // liste hiç okunmadıysa sunucudan al
    yereleUygula(tum[classId], k, classId);
    degisti = true;
  });
  if (degisti) depo.yaz(DEPO.odevler, tum);
}

async function kuyruguGonder() {
  if (durum.gonderiliyor || !apiAyarliMi() || !depo.oku(DEPO.anahtar, "")) return;
  const kuyruk = depo.oku(DEPO.kuyruk, []);
  if (!kuyruk.length) { durum.kuyrukHatasi = null; durumCubugunuCiz(); return; }
  durum.gonderiliyor = true;
  durumCubugunuCiz();
  const parti = kuyruk.slice(0, 50);
  let devamEt = false;
  try {
    const yanit = await api("kaydet", { islemler: parti });
    const sonuclar = yanit.sonuclar || [];
    const tamam = new Set(sonuclar.filter(s => s.ok).map(s => s.id));
    const kalici = sonuclar.find(s => !s.ok && s.kalici);
    const giden = parti.filter(k => tamam.has(k.id));
    if (giden.length) { durum.gonderimSayaci++; gidenleriListeyeIsle(giden); }
    // Gönderim sürerken eklenen kayıtlar kaybolmasın diye kuyruk yeniden okunur.
    const guncel = depo.oku(DEPO.kuyruk, []).filter(k => !tamam.has(k.id));
    depo.yaz(DEPO.kuyruk, guncel);
    durum.kuyrukHatasi = kalici ? { kalici: true, mesaj: kalici.hata } : null;
    devamEt = parti.every(k => tamam.has(k.id)) && guncel.length > 0;   // sırada başka parti var
  } catch (e) {
    if (anahtarReddi(e)) {
      durum.kuyrukHatasi = { kalici: true, mesaj: "Anahtar kabul edilmedi; kayıtlar telefonda bekliyor." };
    } else if (e instanceof SunucuHatasi && e.kod !== "mesgul") {
      durum.kuyrukHatasi = { kalici: true, mesaj: e.message };
    } else {
      durum.kuyrukHatasi = null;   // internet yok / meşgul: sessizce sonra tekrar denenir
    }
  } finally {
    durum.gonderiliyor = false;
    durumCubugunuCiz();
  }
  if (devamEt) kuyruguGonder();
}

function durumCubugunuCiz() {
  const ic = $("durumIc"), metin = $("durumMetin"), tekrar = $("tekrarDene"), alt = $("durumAlt");
  const bekleyen = depo.oku(DEPO.kuyruk, []).length;
  ic.classList.remove("durum-tamam", "durum-bekliyor", "durum-hata");
  tekrar.hidden = true;
  if (bekleyen && durum.kuyrukHatasi && durum.kuyrukHatasi.kalici) {
    ic.classList.add("durum-hata");
    metin.textContent = bekleyen + " kayıt gönderilemedi";
    tekrar.hidden = false;
  } else if (bekleyen) {
    ic.classList.add("durum-bekliyor");
    metin.textContent = bekleyen + " kayıt bekliyor" + (durum.gonderiliyor ? " · gönderiliyor…" : "");
  } else {
    ic.classList.add("durum-tamam");
    metin.textContent = "Tüm kayıtlar gönderildi";
  }
  let altMetin = "";
  if (bekleyen && durum.kuyrukHatasi && durum.kuyrukHatasi.mesaj) altMetin = durum.kuyrukHatasi.mesaj;
  else if (durum.cevrimdisi && durum.veri) altMetin = "Liste güncellenemedi; telefondaki son liste gösteriliyor.";
  alt.textContent = altMetin;
  alt.hidden = !altMetin;
}

// ---------- çıkış ----------
function cikisYap() {
  const bekleyen = depo.oku(DEPO.kuyruk, []).length;
  if (bekleyen) {
    alert(bekleyen + " kayıt henüz gönderilmedi. Çıkmadan önce internete bağlanıp gönderilmesini bekleyin.");
    return;
  }
  if (!confirm("Bu telefondaki anahtar ve listeler silinsin mi? Tablodaki kayıtlar etkilenmez.")) return;
  [DEPO.anahtar, DEPO.onbellek, DEPO.sonSinif, DEPO.odevler, DEPO.taslak, DEPO.sonKonu].forEach(k => depo.sil(k));
  durum.veri = null; durum.seciliSinif = null; durum.yigin = [];
  history.replaceState({ d: 0 }, "");
  girisGoster();
}

// ---------- başlat ----------
function baslat() {
  $("girisDugme").addEventListener("click", girisYap);
  $("anahtarInput").addEventListener("keydown", e => { if (e.key === "Enter") girisYap(); });
  $("yenileDugme").addEventListener("click", () => tazele(true));
  $("cikisDugme").addEventListener("click", cikisYap);
  $("tekrarDene").addEventListener("click", () => { durum.kuyrukHatasi = null; kuyruguGonder(); });
  document.querySelectorAll("[data-geri]").forEach(b => b.addEventListener("click", () => geri()));
  document.querySelectorAll("[data-bolum]").forEach(b => b.addEventListener("click", () => bolumAc(b.dataset.bolum)));
  $("yeniOdevDugme").addEventListener("click", () => formAc(null));
  $("odevYenileDugme").addEventListener("click", () => odevleriTazele(durum.seciliSinif));
  $("tumuDugme").addEventListener("click", tumunuTam);
  $("kaydetDugme").addEventListener("click", kaydetBas);
  $("iptalDugme").addEventListener("click", iptalSor);
  $("ozetDuzelt").addEventListener("click", () => { kontrolHazirla(durum.ozet.odevId); degistir({ e: "kontrol", id: durum.ozet.odevId }); });
  $("ozetListe").addEventListener("click", () => geri());
  $("perde").addEventListener("click", e => { if (e.target === $("perde")) sayfaKapat(); });
  $("aciklamaAc").addEventListener("click", () => { $("fAciklama").hidden = false; $("aciklamaAc").hidden = true; $("fAciklama").focus(); });
  $("fAd").addEventListener("input", () => $("fAd").classList.remove("hatali"));
  document.querySelectorAll("[data-cip]").forEach(b => b.addEventListener("click", () => {
    const f = $("fAd"), c = b.dataset.cip;
    f.value = c.endsWith(" ") ? c : (f.value.trim() ? f.value.trim() + " – " + c : c);
    f.classList.remove("hatali");
    f.focus();
  }));

  // Telefonun geri tuşu: bir önceki ekrana döner.
  history.replaceState({ d: 0 }, "");
  window.addEventListener("popstate", gecmisDegisti);

  // İnternet gelince / uygulamaya dönülünce / belirli aralıkla bekleyenleri gönder.
  window.addEventListener("online", () => { kuyruguGonder(); if (durum.cevrimdisi) tazele(); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") kuyruguGonder(); });
  setInterval(kuyruguGonder, TEKRAR_DENEME_MS);

  // Ana ekrana "Yükle" ile eklenebilmesi ve internetsiz de açılabilmesi için
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => { /* önemsiz */ });

  if (!apiAyarliMi() || !depo.oku(DEPO.anahtar, "")) { girisGoster(); return; }

  const onbellek = depo.oku(DEPO.onbellek, null);
  if (onbellek && onbellek.siniflar) {
    durum.veri = onbellek;
    anaEkraniAc();          // anında aç
  }
  tazele();                 // arka planda güncelle
  kuyruguGonder();
}

document.addEventListener("DOMContentLoaded", baslat);
