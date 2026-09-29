/* FatihHoca | UltraMat — Öğrenci Takip · uygulama (sürüm 0.5 · Aşama 4: öğrenci görünümü)
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

const SURUM = "0.5";
const DEPO = {
  anahtar: "fhTakip_anahtar", onbellek: "fhTakip_baslangic", kuyruk: "fhTakip_kuyruk", sonSinif: "fhTakip_sonSinif",
  odevler: "fhTakip_odevler", taslak: "fhTakip_taslak", sonKonu: "fhTakip_sonKonu",
  dersGoz: "fhTakip_dersGozlem", dersKonu: "fhTakip_dersKonu"
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
  form: null,            // açık form: { id } (düzenleme) ya da { id: null } (yeni)
  veliSira: 0,           // veli mesajı ekranında sıradaki velinin yeri
  dersYukleniyor: {},    // classId → true (ders gözlemleri okunuyor)
  dersHata: {},
  gozlemSecili: new Set(),   // "Birden fazla öğrenci" açıkken seçilenler
  gozlemCoklu: false,
  ogrKod: null,          // öğrenci görünümünde açık öğrenci
  ogrKapsam: "donem"     // "donem" | "yil"
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
const EKRANLAR = ["giris", "ana", "bolum", "odevListe", "odevForm", "kontrol", "ozet", "veli", "gozlem", "ogrListe", "ogrenci"];

function ekranGoster(ad) {
  EKRANLAR.forEach(e => { $("ekran-" + e).hidden = e !== ad; });
  $("durumCubugu").hidden = ad === "giris";
  $("kaydetCubugu").hidden = ad !== "kontrol";
  document.body.classList.toggle("kaydetVar", ad === "kontrol");
  if (ad !== "gozlem") { $("secimCubugu").hidden = true; document.body.classList.remove("secimVar"); }
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
  else if (ust.e === "veli") veliCiz();
  else if (ust.e === "gozlem") gozlemCiz();
  else if (ust.e === "ogrListe") ogrListeCiz();
  else if (ust.e === "ogrenci") ogrenciCiz();
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
  rapor: { ad: "Excel · PDF", asama: 5 }
};

function bolumAc(ad) {
  if (!durum.seciliSinif) return;
  if (ad === "odev") { ileri({ e: "odevListe" }); odevleriTazele(durum.seciliSinif); return; }
  if (ad === "gozlem") { gozlemAc(); return; }
  if (ad === "ogrenci") { ogrenciGorunumuAc(); return; }
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
  v.gozlemler = v.gozlemler || [];
  v.veli = v.veli || [];
  depo.oku(DEPO.kuyruk, []).forEach(k => yereleUygula(v, k, classId));
  return v;
}

/** Bir kaydı telefondaki ödev verisine uygular (sunucunun yapacağının aynısı). */
function yereleUygula(v, k, classId) {
  const x = k.veri || {};
  if (x.classId !== classId) return;
  if (k.tur === "odevOlustur") {
    if (!v.odevler.some(o => o.id === x.odevId)) {
      v.odevler.push({ id: x.odevId, tarih: x.tarih, konu: x.konu || "", ad: x.ad, aciklama: x.aciklama || "", iptal: false, donemNo: donemBul(x.tarih).no, olusturma: k.eklenme || 0 });
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
    if (x.gozlem) {
      v.gozlemler = v.gozlemler || [];
      const iptal = new Set(x.gozlem.iptal || []);
      v.gozlemler = v.gozlemler.filter(g => !iptal.has(g.id));
      (x.gozlem.ekle || []).forEach(g => {
        if (!v.gozlemler.some(y => y.id === g.id)) v.gozlemler.push({ id: g.id, kod: g.kod, odevId: x.odevId, kategori: g.kategori, etiket: g.etiket, baglantiId: g.baglantiId || "" });
      });
    }
  } else if (k.tur === "veliBilgi") {
    v.veli = v.veli || [];
    v.veli.push({ kod: x.kod, donemNo: x.donemNo, blokNo: x.blokNo });
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
      tum[classId] = { odevler: y.odevler || [], kontrol: y.kontrol || {}, gozlemler: y.gozlemler || [], veli: y.veli || [], alinma: Date.now() };
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
  ogrenciEkraniniYenile();
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

  veliSeridi(kutu, classId);
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
      const gozSay = (v.gozlemler || []).filter(g => g.odevId === o.id && g.kategori !== "gelisim").length;
      if (gozSay) dr.appendChild(el("span", "rozet", "🏷️ " + gozSay + " gözlem"));
    } else {
      const t = taslaklar[o.id];
      const tas = t ? Object.keys(t.d || t).length : 0;
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

// ---------- 3. hızlı kontrol (+ ödev gözlemleri) ----------
const ODEV_ETIKET = {};
ETIKETLER.ODEV_GOZLEM.forEach(e => { ODEV_ETIKET[e.kod] = e; });
const etiketBilgi = kod => ODEV_ETIKET[kod] || { kod, kategori: "", emoji: "•", ad: kod };

/** Bu ödevde kayıtlı gözlemler: etiketler {kod: {etiket: gözlemId}}, düzeldiler {bağlantıId: gözlemId}. */
function kayitliGozlemler(v, odevId) {
  const etiket = {}, duzeldi = {};
  (v.gozlemler || []).forEach(g => {
    if (g.odevId !== odevId) return;
    if (g.kategori === "gelisim") { if (g.baglantiId) duzeldi[g.baglantiId] = g.id; }
    else (etiket[g.kod] = etiket[g.kod] || {})[g.etiket] = g.id;
  });
  return { etiket, duzeldi };
}

function kontrolHazirla(odevId) {
  const classId = durum.seciliSinif;
  const v = odevVerisi(classId);
  const kayitli = kopya(v.kontrol[odevId] || {});
  let taslak = depo.oku(DEPO.taslak, {})[odevId] || null;
  if (taslak && !taslak.d) taslak = { d: taslak, e: {}, z: {} };          // 0.2 taslağı
  const kayitliVar = Object.keys(kayitli).length > 0;
  const kg = kayitliGozlemler(v, odevId);
  const etiketKume = {};
  Object.keys(kg.etiket).forEach(kod => { etiketKume[kod] = {}; Object.keys(kg.etiket[kod]).forEach(e => { etiketKume[kod][e] = true; }); });
  const duzeldiKume = {};
  Object.keys(kg.duzeldi).forEach(b => { duzeldiKume[b] = true; });
  durum.kontrol = {
    odevId, classId,
    kayitli: kayitliVar ? kayitli : null,
    calisma: kayitliVar ? kopya(kayitli) : kopya((taslak && taslak.d) || {}),
    gozKayitli: kg,
    etiket: kayitliVar || !taslak ? etiketKume : kopya(taslak.e || {}),
    duzeldi: kayitliVar || !taslak ? duzeldiKume : kopya(taslak.z || {})
  };
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

function fark(a, b) {
  const kodlar = new Set(Object.keys(a || {}).concat(Object.keys(b || {})));
  return Array.from(kodlar).filter(kod => (a[kod] || "") !== (b[kod] || ""));
}

/** Gözlemlerde kayıtlıya göre ne değişti: eklenecek etiketler/düzeldiler, iptal edilecek gözlem kimlikleri. */
function gozlemFarki() {
  const k = durum.kontrol, kg = k.gozKayitli;
  const ekle = [], iptal = [];
  const kodlar = new Set(Object.keys(k.etiket).concat(Object.keys(kg.etiket)));
  kodlar.forEach(kod => {
    const simdi = k.etiket[kod] || {}, once = kg.etiket[kod] || {};
    Object.keys(simdi).forEach(e => { if (simdi[e] && !once[e]) ekle.push({ tur: "etiket", kod, etiket: e }); });
    Object.keys(once).forEach(e => { if (!simdi[e]) iptal.push(once[e]); });
  });
  Object.keys(k.duzeldi).forEach(b => { if (k.duzeldi[b] && !kg.duzeldi[b]) ekle.push({ tur: "duzeldi", baglantiId: b }); });
  Object.keys(kg.duzeldi).forEach(b => { if (!k.duzeldi[b]) iptal.push(kg.duzeldi[b]); });
  return { ekle, iptal };
}
function gozlemDegisti() { const f = gozlemFarki(); return f.ekle.length + f.iptal.length > 0; }

function duzeltmeBekliyor() {
  const k = durum.kontrol;
  if (!k || !k.kayitli) return false;
  return fark(k.kayitli, k.calisma).length > 0 || gozlemDegisti();
}

/** Öğrencinin önceki ödevlerden "geliştirmeli" gözlemleri: henüz düzelmemiş olanlar + bu ödevde düzeldi denenler. */
function acikGelistirler(kod) {
  const k = durum.kontrol, v = odevVerisi(k.classId);
  const gozlemler = v.gozlemler || [];
  const baskaOdevdeDuzeldi = new Set(gozlemler.filter(g => g.kategori === "gelisim" && g.odevId !== k.odevId).map(g => g.baglantiId));
  return gozlemler.filter(g => g.kod === kod && g.kategori === "gelistir" && g.odevId !== k.odevId && !baskaOdevdeDuzeldi.has(g.id))
    .map(g => Object.assign({ odev: v.odevler.find(o => o.id === g.odevId) }, g))
    .filter(g => g.odev && !g.odev.iptal);
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
    const ad = dugme("ogrAd", null, () => etiketSayfasi(s.kod));
    ad.appendChild(document.createTextNode(s.ad));
    if (k.kayitli && once !== d) ad.appendChild(el("small", "degisti", "değişti (önce: " + (once ? DURUM[once].ad : "boş") + ")"));
    else if (!s.aktif) ad.appendChild(el("small", "", "ayrıldı"));
    else if (!d) ad.appendChild(el("small", "", "işaretlenmedi"));
    // gözlem çipleri
    const secili = Object.keys(k.etiket[s.kod] || {}).filter(e => k.etiket[s.kod][e]);
    const duzelen = acikGelistirler(s.kod).filter(g => k.duzeldi[g.id]);
    if (secili.length || duzelen.length) {
      const cipler = el("span", "etiketCipleri");
      secili.forEach(e => { const b = etiketBilgi(e); cipler.appendChild(el("span", "e-" + b.kategori, b.emoji + " " + b.ad)); });
      duzelen.forEach(g => cipler.appendChild(el("span", "e-gelisim", etiketBilgi(g.etiket).duzelme || "✓ Düzeldi")));
      ad.appendChild(cipler);
    } else if (s.aktif) {
      const acik = acikGelistirler(s.kod).length;
      ad.appendChild(el("small", "ekle", "＋ gözlem" + (acik ? " · 📌 açık kayıt var" : "")));
    }
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
  kd.disabled = k.kayitli ? !duzeltmeBekliyor() : (Object.keys(k.calisma).length === 0 && !gozlemDegisti());

  // İlk kontrol kaydedilene kadar telefonda taslak olarak saklanır
  if (!k.kayitli) {
    const taslak = depo.oku(DEPO.taslak, {});
    if (Object.keys(k.calisma).length || gozlemDegisti()) taslak[k.odevId] = { d: k.calisma, e: k.etiket, z: k.duzeldi };
    else delete taslak[k.odevId];
    depo.yaz(DEPO.taslak, taslak);
  }
}

function isaretle(kod, d) {
  const k = durum.kontrol;
  if (k.calisma[kod] === d) delete k.calisma[kod];      // aynı düğmeye tekrar dokunmak işareti kaldırır
  else k.calisma[kod] = d;
  kontrolCiz(false);
}

/** Öğrencinin adına dokununca: bu ödev için gözlem seçimi + önceki ödevlerden açık kalanlar. */
function etiketSayfasi(kod) {
  const k = durum.kontrol;
  const s = sinifBul(k.classId).ogrenciler.find(x => x.kod === kod);
  const o = odevVerisi(k.classId).odevler.find(x => x.id === k.odevId);
  sayfaAc(sy => {
    sy.append(el("h3", "", s.ad), el("p", "alt", (o ? o.ad : "") + " · birden fazla seçebilirsiniz · hiçbiri zorunlu değil"));
    const acik = acikGelistirler(kod);
    if (acik.length) {
      sy.appendChild(el("div", "etiketGrup", "Önceki ödevlerden açık kalan"));
      acik.forEach(g => {
        const b = etiketBilgi(g.etiket), isaretli = !!k.duzeldi[g.id];
        const satir = el("div", "acikKayit");
        const metin = el("div", "", b.emoji + " " + b.ad);
        metin.appendChild(el("small", "", g.odev.ad + " · " + tarihYaz(g.odev.tarih)));
        const dd = dugme("duzeldiDugme" + (isaretli ? " secili" : ""), isaretli ? "✓ İşaretlendi" : (b.duzelme || "✓ Düzeldi"), () => {
          if (k.duzeldi[g.id]) delete k.duzeldi[g.id]; else k.duzeldi[g.id] = true;
          etiketSayfasi(kod);
        });
        satir.append(metin, dd);
        sy.appendChild(satir);
      });
      sy.appendChild(el("p", "alt", "Eski kayıt silinmez; bu ödevde düzeldiği yanına eklenir."));
    }
    [["olumlu", "Olumlu"], ["gelistir", "Geliştirilmeli"]].forEach(([kat, baslik]) => {
      sy.appendChild(el("div", "etiketGrup", baslik));
      const izgara = el("div", "etiketIzgara");
      ETIKETLER.ODEV_GOZLEM.filter(e => e.kategori === kat && !e.emekli).forEach(e => {
        const secili = !!(k.etiket[kod] && k.etiket[kod][e.kod]);
        const b = dugme("etiket " + kat + (secili ? " secili" : ""), null, () => {
          k.etiket[kod] = k.etiket[kod] || {};
          if (k.etiket[kod][e.kod]) delete k.etiket[kod][e.kod]; else k.etiket[kod][e.kod] = true;
          etiketSayfasi(kod);
        });
        b.setAttribute("aria-pressed", secili ? "true" : "false");
        b.append(el("span", "", e.emoji), el("span", "", e.ad));
        izgara.appendChild(b);
      });
      sy.appendChild(izgara);
    });
    const alt = el("div", "dugmeSatir");
    alt.appendChild(dugme("anaDugme", "Tamam", sayfaKapat));
    sy.appendChild(alt);
  }, () => kontrolCiz(false));
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
  if (!bos.length || !Object.keys(k.calisma).length) { kaydet(); return; }
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
  const gf = gozlemFarki();
  if (!durumlar.length && !gf.ekle.length && !gf.iptal.length) return;
  const gozlemler = odevVerisi(k.classId).gozlemler || [];
  const ekle = gf.ekle.map(x => {
    if (x.tur === "etiket") return { id: yeniKimlik(), kod: x.kod, ad: ogrAd[x.kod] || "", kategori: etiketBilgi(x.etiket).kategori || "olumlu", etiket: x.etiket, baglantiId: "" };
    const eski = gozlemler.find(g => g.id === x.baglantiId) || {};
    return { id: yeniKimlik(), kod: eski.kod, ad: ogrAd[eski.kod] || "", kategori: "gelisim", etiket: ETIKETLER.DUZELDI_KODU, baglantiId: x.baglantiId };
  }).filter(x => x.kod);
  const oncekiBlok = veliBlogu(k.classId).tamam;
  if (!kuyrugaEkle("odevKontrol", { odevId: k.odevId, classId: k.classId, durumlar, gozlem: { ekle, iptal: gf.iptal } })) return;
  const taslak = depo.oku(DEPO.taslak, {}); delete taslak[k.odevId]; depo.yaz(DEPO.taslak, taslak);
  const b = veliBlogu(k.classId);
  durum.ozet = { odevId: k.odevId, classId: k.classId, ilk: !k.kayitli, onceki: k.kayitli, yeniBlok: b.tamam > oncekiBlok ? b.tamam : 0 };
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
  const kontrolVar = Object.keys(k).length > 0;
  $("oBaslik").textContent = oz.ilk ? (kontrolVar ? "Kontrol kaydedildi" : "Gözlemler kaydedildi") : "Düzeltme kaydedildi";
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
  if (oz.yeniBlok) {
    const kutu = el("div", "ozetGrup");
    kutu.append(el("h4", "", "📨 Veli mesajları hazır"), el("p", "", "Bu dönem " + (oz.yeniBlok * 4) + " ödev kontrol edildi. Mesajlar ödev listesinin üstünde sizi bekliyor."));
    g.appendChild(kutu);
  }
  const adlar = f => ogr.filter(f).map(s => s.ad).join(", ");
  if (!oz.ilk && oz.onceki) {
    const degisen = ogr.filter(s => (oz.onceki[s.kod] || "") !== (k[s.kod] || ""));
    grup("✏️ Bu düzeltmede değişen", degisen.map(s => s.ad + ": " + (oz.onceki[s.kod] ? DURUM[oz.onceki[s.kod]].ad : "boş") + " → " + (k[s.kod] ? DURUM[k[s.kod]].ad : "boş")).join("\n"));
  }
  const bos = kontrolVar ? adlar(s => s.aktif && !k[s.kod]) : "";
  if (kontrolVar && !c.E && !c.Y && !c.M && !bos) grup("İstisna yok", "Herkes tam yapmış.");
  ["E", "Y", "M"].forEach(d => grup(DURUM[d].emoji + " " + DURUM[d].ad, adlar(s => k[s.kod] === d)));
  grup("— İşaretlenmedi (kontrol edilmedi)", bos);
  // gözlemler
  const kg = kayitliGozlemler(v, oz.odevId);
  const gozSatir = ogr.map(s => {
    const e = Object.keys(kg.etiket[s.kod] || {}).map(x => { const b = etiketBilgi(x); return b.emoji + " " + b.ad; });
    (v.gozlemler || []).filter(x => x.kategori === "gelisim" && x.odevId === oz.odevId).forEach(x => {
      const eski = (v.gozlemler || []).find(y => y.id === x.baglantiId);
      if (eski && eski.kod === s.kod) e.push(etiketBilgi(eski.etiket).duzelme || "✓ Düzeldi");
    });
    return e.length ? s.ad + ": " + e.join(", ") : "";
  }).filter(Boolean);
  grup("🏷️ Gözlemler", gozSatir.join("\n"));
  if (kontrolVar) grup("✅ Tam (" + c.T + ") · adları göster", adlar(s => k[s.kod] === "T"), true);
}

// ---------- 5. veli mesajları (her 4 kontrol edilmiş ödevde bir) ----------
/** Bu dönemin kontrol edilmiş ödevleri (eskiden yeniye) ve 4'lü bloklar. */
function veliBlogu(classId) {
  const v = odevVerisi(classId);
  const donemNo = durum.veri && durum.veri.donem ? durum.veri.donem.no : 0;
  const kontrollu = v.odevler
    .filter(o => !o.iptal && (!donemNo || o.donemNo === donemNo) && Object.keys(v.kontrol[o.id] || {}).length)
    .sort((a, b) => (a.tarih || "").localeCompare(b.tarih || "") || (a.olusturma || 0) - (b.olusturma || 0));
  const tamam = Math.floor(kontrollu.length / 4);
  return { v, donemNo, kontrollu, tamam, blok: tamam ? kontrollu.slice((tamam - 1) * 4, tamam * 4) : [] };
}

/** Son tamamlanan bloğun henüz gönderilmemiş velileri. */
function veliSirasi(classId) {
  const b = veliBlogu(classId);
  const sinif = sinifBul(classId);
  if (!b.tamam || !sinif) return Object.assign(b, { bekleyen: [], giden: [] });
  const gidenKod = new Set((b.v.veli || []).filter(x => x.donemNo === b.donemNo && x.blokNo === b.tamam).map(x => x.kod));
  const aktif = sinif.ogrenciler.filter(s => s.aktif);
  return Object.assign(b, { bekleyen: aktif.filter(s => !gidenKod.has(s.kod)), giden: aktif.filter(s => gidenKod.has(s.kod)) });
}

function ayAraligi(t1, t2) {
  const a = new Date(t1 + "T12:00:00"), b = new Date(t2 + "T12:00:00");
  const ay = d => d.toLocaleDateString("tr-TR", { month: "long" });
  return a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()
    ? (a.getDate() === b.getDate() ? a.getDate() + " " + ay(b) : a.getDate() + "–" + b.getDate() + " " + ay(b))
    : a.getDate() + " " + ay(a) + " – " + b.getDate() + " " + ay(b);
}
const kisaTarih = t => new Date(t + "T12:00:00").toLocaleDateString("tr-TR", { day: "numeric", month: "short" });

function veliMesaji(s, b) {
  const v = b.v, blok = b.blok;
  const bid = new Set(blok.map(o => o.id));
  let m = (s.hitap ? "Merhaba " + s.hitap + "," : "Merhaba,") + "\n\n*" + s.ad + " · Matematik ödev takibi*\n_" +
    ayAraligi(blok[0].tarih, blok[blok.length - 1].tarih) + " arasında verilen 4 ödev_\n\n";
  m += blok.map(o => { const d = (v.kontrol[o.id] || {})[s.kod]; return (d ? DURUM[d].emoji : "▫️") + " " + o.ad + " (" + kisaTarih(o.tarih) + "): " + (d ? DURUM[d].ad : "kontrol edilmedi"); }).join("\n");
  if (b.tamam > 1) {
    const donem = b.kontrollu.slice(0, b.tamam * 4);
    const c = { T: 0, E: 0, Y: 0, M: 0 }; let yok = 0;
    donem.forEach(o => { const d = (v.kontrol[o.id] || {})[s.kod]; if (d) c[d]++; else yok++; });
    const p = [donem.length + " ödev", c.T + " tam"];
    if (c.E) p.push(c.E + " eksik"); if (c.Y) p.push(c.Y + " yapılmadı"); if (c.M) p.push(c.M + " mazeretli"); if (yok) p.push(yok + " kontrol edilmedi");
    m += "\n\n*Dönem geneli:* " + p.join(" · ");
  }
  const gozlemler = v.gozlemler || [];
  const bu = gozlemler.filter(g => g.kod === s.kod && bid.has(g.odevId) && g.kategori !== "gelisim");
  const duzeldiOdev = {};
  gozlemler.filter(g => g.kategori === "gelisim" && bid.has(g.odevId)).forEach(g => { duzeldiOdev[g.baglantiId] = true; });
  const eskiDuzelen = gozlemler.filter(g => g.kod === s.kod && g.kategori === "gelistir" && !bid.has(g.odevId) && duzeldiOdev[g.id]);
  if (bu.length || eskiDuzelen.length) {
    m += "\n\n*Ödevlerinde gözlemlerim:*";
    bu.filter(g => g.kategori === "olumlu").forEach(g => { const e = etiketBilgi(g.etiket); m += "\n" + e.emoji + " " + e.ad; });
    bu.filter(g => g.kategori === "gelistir").concat(eskiDuzelen).forEach(g => {
      const e = etiketBilgi(g.etiket);
      m += "\n" + e.emoji + " " + e.ad + (duzeldiOdev[g.id] ? " → " + (e.duzelme || "✓ Düzeldi") : "");
    });
  }
  return m + "\n\nBilginize sunarım.\n— Fatih Hoca ✍️";
}

/** Sunucudaki normalizeTelefon (karne-uret) ile aynı kural. */
function telefonNormal(t) {
  const ham = String(t || "").trim();
  let r = ham.replace(/[^0-9]/g, "");
  if (!r) return "";
  if (ham.indexOf("+") === 0 || r.indexOf("00") === 0) return r.replace(/^00/, "");
  r = r.replace(/^0/, "");
  if (r.indexOf("90") === 0 && r.length > 10) return r;
  return "90" + r;
}

function veliSeridi(kutu, classId) {
  const b = veliSirasi(classId);
  if (b.tamam && b.bekleyen.length) {
    const d = dugme("veliSerit", null, () => { durum.veliSira = 0; ileri({ e: "veli" }); });
    const metin = el("span");
    metin.append(el("b", "", "📨 Veli mesajı zamanı"),
      el("small", "", b.tamam + ". blok (" + b.tamam * 4 + " ödev) tamamlandı · " + b.bekleyen.length + " veli sırada" + (b.giden.length ? ", " + b.giden.length + " gönderildi" : "")));
    d.append(metin, el("span", "ok", "›"));
    kutu.appendChild(d);
  } else if (b.kontrollu.length || b.v.odevler.length) {
    kutu.appendChild(el("p", "ipucu", "📨 Sonraki veli mesajı " + (4 - b.kontrollu.length % 4) + " ödev daha kontrol edilince hazır olur."));
  }
}

function veliCiz() {
  const classId = durum.seciliSinif;
  const b = veliSirasi(classId);
  ekranGoster("veli");
  $("veliBaslik").textContent = "Veli mesajları · " + classId;
  const icerik = $("vIcerik");
  icerik.innerHTML = "";
  $("vIlerleme").innerHTML = "";
  if (!b.tamam) { $("vAlt").textContent = ""; icerik.appendChild(el("div", "kart bos", "Bu dönem henüz 4 ödev kontrol edilmedi.")); return; }
  $("vAlt").textContent = b.tamam + ". blok · " + ayAraligi(b.blok[0].tarih, b.blok[3].tarih) + " arası 4 ödev";
  if (durum.veliSira >= b.bekleyen.length) durum.veliSira = 0;
  const s = b.bekleyen[durum.veliSira];
  const sinif = sinifBul(classId);
  sinif.ogrenciler.filter(x => x.aktif).forEach(x => {
    $("vIlerleme").appendChild(el("span", b.giden.some(g => g.kod === x.kod) ? "gitti" : (s && s.kod === x.kod ? "simdi" : "")));
  });
  if (!s) {
    const k = el("div", "kart bitti");
    k.append(el("div", "buyuk", "✅"), el("b", "", "Bu bloğun tüm mesajları gönderildi."),
      el("p", "altBilgi", "Sonraki mesajlar 4 ödev daha kontrol edilince hazır olur."),
      dugme("anaDugme", "Ödev listesine dön", () => geri()));
    icerik.appendChild(k);
    return;
  }
  const tel = telefonNormal(s.tel);
  const kart = el("div", "kart");
  const kim = el("div", "veliKimlik");
  kim.append(el("b", "", s.ad), el("small", "", (durum.veliSira + 1) + "/" + b.bekleyen.length + " sırada · " + (tel ? "📞 " + s.tel : "telefon yok")));
  kart.appendChild(kim);
  if (!tel) kart.appendChild(el("div", "uyariKucuk", "Ogrenciler sayfasında bu öğrencinin veli telefonu yok. Mesajı kopyalayıp başka yoldan gönderebilir ya da bu veliyi atlayabilirsiniz."));
  const alan = el("textarea", "mesaj");
  alan.id = "mesajMetni";
  alan.setAttribute("aria-label", "Mesaj");
  alan.value = veliMesaji(s, b);
  kart.append(alan, el("p", "ipucu", "Göndermeden önce metni burada değiştirebilirsiniz. *Yıldızlı* yazılar WhatsApp'ta kalın görünür."));
  const dugmeler = el("div", "dugmeSatir");
  const gonderdim = dugme("anaDugme", "✓ Gönderdim, sıradakine geç", () => veliGonderildi(s, b, alan.value));
  gonderdim.hidden = true;
  if (tel) dugmeler.appendChild(dugme("waDugme", "WhatsApp'ta aç", () => {
    window.open("https://wa.me/" + tel + "?text=" + encodeURIComponent(alan.value), "_blank");
    gonderdim.hidden = false;
  }));
  dugmeler.appendChild(dugme("ikinciDugme", "📋 Mesajı kopyala", async () => {
    const ok = await panoyaKopyala(alan.value);
    bildirimGoster(ok ? "Mesaj kopyalandı." : "Kopyalanamadı; metni basılı tutup kendiniz kopyalayın.");
    gonderdim.hidden = false;
  }));
  dugmeler.appendChild(gonderdim);
  dugmeler.appendChild(dugme("baglantiDugme", "Bu veliyi şimdilik atla ›", () => { durum.veliSira++; veliCiz(); }));
  kart.appendChild(dugmeler);
  icerik.appendChild(kart);
}

async function panoyaKopyala(metin) {
  try { await navigator.clipboard.writeText(metin); return true; } catch (e) { /* eski yöntem */ }
  try {
    const t = el("textarea"); t.value = metin; t.style.position = "fixed"; t.style.opacity = "0";
    document.body.appendChild(t); t.select(); const ok = document.execCommand("copy"); t.remove(); return ok;
  } catch (e) { return false; }
}

function veliGonderildi(s, b, mesaj) {
  const kayitId = yeniKimlik();
  if (!kuyrugaEkle("veliBilgi", {
    kayitId, classId: durum.seciliSinif, kod: s.kod, ad: s.ad, donemNo: b.donemNo, blokNo: b.tamam,
    odevIdler: b.blok.map(o => o.id), mesaj
  })) return;
  bildirimGoster("“Veli bilgilendirildi” olarak kaydedildi.");
  veliCiz();
}

// ---------- 6. ders içi gözlem ----------
const DERS_ETIKET = {};
ETIKETLER.DERS_GOZLEM.forEach(e => { DERS_ETIKET[e.kod] = e; });
const dersEtiket = kod => DERS_ETIKET[kod] || { kod, kategori: "", emoji: "•", ad: kod };
const DERS_GRUPLARI = [["olumlu", "Olumlu"], ["dikkat", "Dikkat gerektiren"], ["akademik", "Akademik"]];

/** Son okunan ders gözlemleri + henüz gönderilmemiş kayıtlar. */
function dersVerisi(classId) {
  const tum = depo.oku(DEPO.dersGoz, {});
  const v = kopya(tum[classId] || { gozlemler: [], yok: true });
  depo.oku(DEPO.kuyruk, []).forEach(k => dersUygula(v, k, classId));
  return v;
}

function dersUygula(v, k, classId) {
  const x = k.veri || {};
  if (k.tur === "dersGozlem" && x.classId === classId) {
    (x.kayitlar || []).forEach(g => {
      if (v.gozlemler.some(y => y.id === g.id)) return;
      v.gozlemler.push({ id: g.id, kod: g.kod, kategori: g.kategori, etiket: g.etiket, tarih: x.tarih, zaman: x.zaman,
        konu: g.konuyaBagli ? x.konu : "", altKonu: g.konuyaBagli ? x.altKonu : "", baglantiId: g.baglantiId || "" });
    });
  } else if (k.tur === "gozlemIptal" && x.classId === classId) {
    const iptal = new Set(x.idler || []);
    v.gozlemler = v.gozlemler.filter(g => !iptal.has(g.id));
  }
}

async function dersGozlemleriTazele(classId) {
  if (!apiAyarliMi() || !classId || durum.dersYukleniyor[classId]) return;
  durum.dersYukleniyor[classId] = true;
  const sayac = durum.gonderimSayaci;
  let tekrar = false;
  try {
    const y = await api("dersGozlemleri", { classId });
    if (sayac !== durum.gonderimSayaci) tekrar = true;
    else {
      const tum = depo.oku(DEPO.dersGoz, {});
      tum[classId] = { gozlemler: y.gozlemler || [], alinma: Date.now() };
      depo.yaz(DEPO.dersGoz, tum);
      delete durum.dersHata[classId];
    }
  } catch (e) {
    if (anahtarReddi(e)) { depo.sil(DEPO.anahtar); girisGoster("Anahtar değişmiş ya da kaldırılmış. Yeni anahtarla giriş yapın."); return; }
    durum.dersHata[classId] = true;
  } finally {
    durum.dersYukleniyor[classId] = false;
  }
  if (tekrar) { dersGozlemleriTazele(classId); return; }
  if (ekranAcik("gozlem")) gozlemCiz();
  ogrenciEkraniniYenile();
}

/** Sınıfın bugünkü konusu: telefonda sınıf başına hatırlanır; yoksa ödevde son kullanılan konu. */
function dersKonusu(classId) {
  const kayit = depo.oku(DEPO.dersKonu, {})[classId];
  if (kayit && kayit.konu !== undefined) return kayit;
  const sinif = sinifBul(classId);
  const konular = (durum.veri.konular && sinif && durum.veri.konular[sinif.sinif]) || [];
  const son = depo.oku(DEPO.sonKonu, {})[classId];
  return { konu: son || konular[0] || "", alt: "" };
}

function gozlemAc() {
  durum.gozlemSecili = new Set();
  durum.gozlemCoklu = false;
  ileri({ e: "gozlem" });
  dersGozlemleriTazele(durum.seciliSinif);
}

function gozlemCiz() {
  const classId = durum.seciliSinif;
  const sinif = sinifBul(classId);
  ekranGoster("gozlem");
  $("gozlemBaslik").textContent = "Ders İçi Gözlem · " + classId;
  const v = dersVerisi(classId);
  const bugun = bugunMetni();

  // konu şeridi
  const k = dersKonusu(classId);
  const serit = $("konuSerit");
  serit.innerHTML = "";
  const metin = el("span");
  metin.append(el("b", "", "Bugünün konusu: " + (k.konu || "seçilmedi")),
    el("small", "", (k.alt ? "Alt konu: " + k.alt + " · " : "") + "💡 ❓ ve akademik gözlemler bu konuya bağlanır"));
  serit.append(el("span", "ik", "📘"), metin, el("span", "deg", "Değiştir"));

  $("cokluAnahtar").classList.toggle("acik", durum.gozlemCoklu);
  $("cokluAnahtar").setAttribute("aria-pressed", durum.gozlemCoklu ? "true" : "false");

  // öğrenciler
  const izgara = $("gozlemIzgara");
  izgara.innerHTML = "";
  const bugunkuler = v.gozlemler.filter(g => g.tarih === bugun);
  (sinif ? sinif.ogrenciler.filter(o => o.aktif) : []).forEach(s => {
    const secili = durum.gozlemSecili.has(s.kod);
    const b = dugme("ogrDugme" + (secili ? " secili" : ""), null, () => gozlemOgrTik(s.kod));
    b.setAttribute("aria-pressed", secili ? "true" : "false");
    const simgeler = bugunkuler.filter(g => g.kod === s.kod).sort((a, c) => (a.zaman || 0) - (c.zaman || 0))
      .map(g => g.kategori === "gelisim" ? "✓" : dersEtiket(g.etiket).emoji).join(" ");
    b.append(el("b", "", s.ad), el("small", "", simgeler));
    izgara.appendChild(b);
  });

  // bugün bu sınıfta
  const liste = bugunkuler.slice().sort((a, c) => (c.zaman || 0) - (a.zaman || 0));
  $("bugunBaslik").textContent = "Bugün bu sınıfta (" + liste.length + ")";
  const kutu = $("bugunListe");
  kutu.innerHTML = "";
  if (!liste.length) {
    kutu.appendChild(el("div", "kart bos", v.yok && durum.dersYukleniyor[classId] ? "Yükleniyor…" : "Bugün henüz gözlem yok."));
  } else {
    const l = el("div", "bugunListe");
    const adlar = {};
    (sinif ? sinif.ogrenciler : []).forEach(s => { adlar[s.kod] = s.ad; });
    liste.forEach(g => {
      const satir = el("div", "bugunSatir");
      const saat = g.zaman ? new Date(g.zaman).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }) : "";
      const ne = el("span", "ne");
      ne.appendChild(el("b", "", adlar[g.kod] || g.kod));
      let alt = "";
      if (g.kategori === "gelisim") {
        const eski = v.gozlemler.find(y => y.id === g.baglantiId);
        const e = eski ? dersEtiket(eski.etiket) : null;
        ne.appendChild(document.createTextNode(" · " + (e && e.duzelme ? e.duzelme : "✓ Düzeldi")));
        if (e) alt = e.emoji + " " + e.ad + (e.konuyaBaglanir && eski.konu ? " · " + eski.konu : "");
      } else {
        const e = dersEtiket(g.etiket);
        ne.appendChild(document.createTextNode(" · " + e.emoji + " " + e.ad));
        if (g.konu) alt = g.konu + (g.altKonu ? " · " + g.altKonu : "");
      }
      if (alt) ne.appendChild(el("small", "", alt));
      satir.append(el("span", "saat", saat), ne, dugme("", "Geri al", () => gozlemGeriAl([g.id], "Gözlem geri alındı")));
      l.appendChild(satir);
    });
    kutu.appendChild(l);
  }
  if (durum.dersHata[classId] && !v.yok) kutu.appendChild(el("p", "ipucu merkez", "Liste güncellenemedi; telefondaki son liste gösteriliyor."));

  // seçim çubuğu
  const secimVar = durum.gozlemCoklu && durum.gozlemSecili.size > 0;
  $("secimCubugu").hidden = !secimVar;
  document.body.classList.toggle("secimVar", secimVar);
  $("secimMetin").textContent = durum.gozlemSecili.size + " öğrenci seçili";
}

function gozlemOgrTik(kod) {
  if (!durum.gozlemCoklu) { gozlemEtiketSayfasi([kod]); return; }
  if (durum.gozlemSecili.has(kod)) durum.gozlemSecili.delete(kod); else durum.gozlemSecili.add(kod);
  gozlemCiz();
}

/** Öğrencinin önceki derslerden açık kalan dikkat/akademik gözlemleri (düzeldi denmemiş olanlar). */
function acikDersKayitlari(v, kod) {
  const duzelen = new Set(v.gozlemler.filter(g => g.kategori === "gelisim").map(g => g.baglantiId));
  return v.gozlemler.filter(g => g.kod === kod && (g.kategori === "dikkat" || g.kategori === "akademik") && !duzelen.has(g.id))
    .sort((a, c) => (c.zaman || 0) - (a.zaman || 0));
}

function gozlemEtiketSayfasi(kodlar) {
  const classId = durum.seciliSinif;
  const sinif = sinifBul(classId);
  const adlar = {};
  sinif.ogrenciler.forEach(s => { adlar[s.kod] = s.ad; });
  const v = dersVerisi(classId);
  const konu = dersKonusu(classId);
  const tek = kodlar.length === 1;
  sayfaAc(sy => {
    sy.append(el("h3", "", tek ? adlar[kodlar[0]] : kodlar.length + " öğrenci: " + kodlar.map(k => (adlar[k] || "").split(" ")[0]).join(", ")),
      el("p", "alt", "Bir etikete dokunmak kaydeder. Yanlışsa “Geri al”."));
    if (tek) {
      const acik = acikDersKayitlari(v, kodlar[0]);
      if (acik.length) {
        sy.appendChild(el("div", "etiketGrup acik", "Önceki derslerden açık kalan"));
        acik.forEach(g => {
          const e = dersEtiket(g.etiket);
          const satir = el("div", "acikKayit");
          const m = el("div", "", e.emoji + " " + e.ad);
          m.appendChild(el("small", "", tarihYaz(g.tarih) + (g.konu ? " · " + g.konu : "")));
          satir.append(m, dugme("duzeldiDugme", e.duzelme || "✓ Düzeldi", () => dersDuzeldi(g, adlar[g.kod])));
          sy.appendChild(satir);
        });
      }
    }
    DERS_GRUPLARI.forEach(([kat, baslik]) => {
      sy.appendChild(el("div", "etiketGrup " + kat, kat === "akademik" && konu.konu ? baslik + " · " + konu.konu : baslik));
      const izgara = el("div", "etiketIzgara");
      ETIKETLER.DERS_GOZLEM.filter(e => e.kategori === kat && !e.emekli).forEach(e => {
        const b = dugme("etiket ders " + kat, null, () => dersGozlemKaydet(kodlar, e, adlar));
        const yazi = el("span", "", e.ad);
        if (e.konuyaBaglanir && konu.konu) yazi.appendChild(el("span", "k", konu.konu));
        b.append(el("span", "", e.emoji), yazi);
        izgara.appendChild(b);
      });
      sy.appendChild(izgara);
    });
    sy.appendChild(el("div", "bosluk"));
    sy.appendChild(dugme("ikinciDugme", "Vazgeç", sayfaKapat));
  });
}

function dersGozlemKaydet(kodlar, e, adlar) {
  const classId = durum.seciliSinif;
  const konu = dersKonusu(classId);
  const kayitlar = kodlar.map(kod => ({ id: yeniKimlik(), kod, ad: adlar[kod] || "", kategori: e.kategori, etiket: e.kod, baglantiId: "", konuyaBagli: !!e.konuyaBaglanir }));
  if (!kuyrugaEkle("dersGozlem", { classId, tarih: bugunMetni(), zaman: Date.now(), konu: konu.konu, altKonu: konu.alt, kayitlar })) return;
  durum.gozlemSecili.clear();
  sayfaKapat();
  gozlemCiz();
  const kim = kodlar.length === 1 ? adlar[kodlar[0]] : kodlar.length + " öğrenci";
  bildirimGoster(kim + ": " + e.emoji + " " + e.ad, () => gozlemGeriAl(kayitlar.map(k => k.id), "Geri alındı"));
}

function dersDuzeldi(g, ad) {
  const e = dersEtiket(g.etiket);
  const id = yeniKimlik();
  if (!kuyrugaEkle("dersGozlem", {
    classId: durum.seciliSinif, tarih: bugunMetni(), zaman: Date.now(), konu: g.konu, altKonu: g.altKonu,
    kayitlar: [{ id, kod: g.kod, ad, kategori: "gelisim", etiket: ETIKETLER.DUZELDI_KODU, baglantiId: g.id, konuyaBagli: !!g.konu }]
  })) return;
  sayfaKapat();
  gozlemCiz();
  bildirimGoster(ad + ": " + (e.duzelme || "✓ Düzeldi") + " (eski kayıt korunur)", () => gozlemGeriAl([id], "Geri alındı"));
}

function gozlemGeriAl(idler, mesaj) {
  if (!kuyrugaEkle("gozlemIptal", { classId: durum.seciliSinif, idler })) return;
  if (ekranAcik("gozlem")) gozlemCiz();
  bildirimGoster(mesaj);
}

function dersKonusuSayfasi() {
  const classId = durum.seciliSinif;
  const sinif = sinifBul(classId);
  const konular = (durum.veri.konular && sinif && durum.veri.konular[sinif.sinif]) || [];
  const k = dersKonusu(classId);
  sayfaAc(sy => {
    sy.append(el("h3", "", "Bugünün konusu · " + classId),
      el("p", "alt", "Bu sınıfta girilen 💡 ❓ ve akademik gözlemler bu konuya bağlanır. Ertesi derste son seçtiğiniz konu hazır gelir."));
    const l1 = el("label", "alan", "Konu (Müfredat)"); l1.htmlFor = "dkSec";
    const sec = el("select", "girdi"); sec.id = "dkSec";
    konular.forEach(x => { const o = el("option", "", x); o.value = x; sec.appendChild(o); });
    if (k.konu && konular.indexOf(k.konu) === -1) { const o = el("option", "", k.konu); o.value = k.konu; sec.appendChild(o); }
    const yok = el("option", "", "— Konu yok"); yok.value = ""; sec.appendChild(yok);
    sec.value = k.konu || "";
    const l2 = el("label", "alan", "Alt konu (isteğe bağlı)"); l2.htmlFor = "dkAlt";
    const alt = el("input", "girdi"); alt.id = "dkAlt"; alt.maxLength = 60; alt.placeholder = "Ör. Negatif üs"; alt.value = k.alt || "";
    sy.append(l1, sec, l2, alt, el("div", "bosluk"),
      dugme("anaDugme", "Kaydet", () => {
        const tum = depo.oku(DEPO.dersKonu, {});
        const yeniKonu = sec.value;
        tum[classId] = { konu: yeniKonu, alt: alt.value.trim() };
        depo.yaz(DEPO.dersKonu, tum);
        sayfaKapat(); gozlemCiz(); bildirimGoster("Konu güncellendi");
      }),
      el("div", "bosluk"), dugme("ikinciDugme", "Vazgeç", sayfaKapat));
  });
}

// ---------- 7. öğrenci görünümü ----------
function ogrenciGorunumuAc() {
  durum.ogrKapsam = "donem";
  ileri({ e: "ogrListe" });
  odevleriTazele(durum.seciliSinif);
  dersGozlemleriTazele(durum.seciliSinif);
}

/** Bir sınıfın öğrenci görünümü için tüm veri, seçilen kapsamda (bu dönem / tüm yıl). */
function ogrenciVerisi(classId, kapsam) {
  const v = odevVerisi(classId), d = dersVerisi(classId);
  const donemNo = durum.veri && durum.veri.donem ? durum.veri.donem.no : 0;
  const donemde = no => kapsam === "yil" || !donemNo || no === donemNo;
  const odevler = v.odevler.filter(o => !o.iptal);
  const odevById = {};
  odevler.forEach(o => { odevById[o.id] = o; });
  const kontrollu = odevler
    .filter(o => donemde(o.donemNo) && Object.keys(v.kontrol[o.id] || {}).length)
    .sort((a, b) => (a.tarih || "").localeCompare(b.tarih || "") || (a.olusturma || 0) - (b.olusturma || 0));
  // tüm gözlemler tek biçimde: {id, kod, baglam, kategori, etiket, tarih, zaman, konu, altKonu, baglantiId, odev}
  const hepsi = [];
  (v.gozlemler || []).forEach(g => {
    const o = odevById[g.odevId];
    if (!o) return;                                         // iptal edilmiş ödevin gözlemi
    hepsi.push({ id: g.id, kod: g.kod, baglam: "odev", kategori: g.kategori, etiket: g.etiket, tarih: o.tarih, zaman: 0,
      konu: o.konu, altKonu: "", baglantiId: g.baglantiId, odev: o, donemNo: o.donemNo });
  });
  d.gozlemler.forEach(g => {
    hepsi.push(Object.assign({ baglam: "ders", donemNo: donemBul(g.tarih).no }, g));
  });
  const duzeldiHaritasi = {};
  hepsi.filter(g => g.kategori === "gelisim" && g.baglantiId).forEach(g => { duzeldiHaritasi[g.baglantiId] = g; });
  return {
    v, d, kontrollu, duzeldiHaritasi,
    gozlemler: hepsi.filter(g => donemde(g.donemNo)),
    tumGozlemler: hepsi,
    yukleniyor: (v.yok && durum.odevYukleniyor[classId]) || (d.yok && durum.dersYukleniyor[classId]),
    veli: (v.veli || []).filter(x => donemde(x.donemNo))
  };
}

const gozEtiket = g => g.baglam === "ders" ? dersEtiket(g.etiket) : etiketBilgi(g.etiket);
const ACIK_KATEGORILER = { dikkat: 1, akademik: 1, gelistir: 1 };

function ogrListeCiz() {
  const classId = durum.seciliSinif;
  const sinif = sinifBul(classId);
  ekranGoster("ogrListe");
  $("ogrListeBaslik").textContent = "Öğrenci Görünümü · " + classId;
  const kutu = $("ogrListeIcerik");
  kutu.innerHTML = "";
  const ov = ogrenciVerisi(classId, "donem");
  if (ov.yukleniyor) { kutu.appendChild(el("div", "kart bos", "Yükleniyor…")); return; }
  (sinif ? sinif.ogrenciler.filter(o => o.aktif) : []).forEach(s => {
    const c = { T: 0, E: 0, Y: 0, M: 0 }; let yok = 0;
    ov.kontrollu.forEach(o => { const d = (ov.v.kontrol[o.id] || {})[s.kod]; if (d) c[d]++; else yok++; });
    const goz = ov.gozlemler.filter(g => g.kod === s.kod && g.kategori !== "gelisim").length;
    const acik = ov.tumGozlemler.filter(g => g.kod === s.kod && ACIK_KATEGORILER[g.kategori] && !ov.duzeldiHaritasi[g.id]).length;
    const p = [ov.kontrollu.length + " ödev" + (ov.kontrollu.length ? ": " + c.T + " tam" : "")];
    if (c.E) p.push(c.E + " eksik"); if (c.Y) p.push(c.Y + " yapılmadı"); if (c.M) p.push(c.M + " mazeretli");
    if (yok && ov.kontrollu.length) p.push(yok + " kontrol edilmedi");
    const b = dugme("ogrSatirKart", null, () => { durum.ogrKod = s.kod; durum.ogrKapsam = "donem"; ileri({ e: "ogrenci" }); });
    const ad = el("span", "ad");
    const baslik = el("b", "", s.ad);
    if (acik) baslik.appendChild(el("span", "acikIsaret", "📌 " + acik + " açık"));
    ad.append(baslik, el("small", "", p.join(", ") + " · " + goz + " gözlem"));
    b.append(ad, el("span", "ok", "›"));
    kutu.appendChild(b);
  });
  if (durum.odevHata[classId] || durum.dersHata[classId]) kutu.appendChild(el("p", "ipucu merkez", "Liste güncellenemedi; telefondaki son bilgiler gösteriliyor."));
}

function kisaGun(t) { return t ? new Date(t + "T12:00:00").toLocaleDateString("tr-TR", { day: "numeric", month: "short" }) : ""; }
function uzunGun(t) { return t ? new Date(t + "T12:00:00").toLocaleDateString("tr-TR", { day: "numeric", month: "long", weekday: "long" }) : ""; }

function ogrenciCiz() {
  const classId = durum.seciliSinif;
  const sinif = sinifBul(classId);
  const s = sinif && sinif.ogrenciler.find(x => x.kod === durum.ogrKod);
  if (!s) { geri(); return; }
  ekranGoster("ogrenci");
  const kapsam = durum.ogrKapsam;
  const donemAd = durum.veri && durum.veri.donem ? durum.veri.donem.ad : "Bu dönem";
  $("ogrAd").textContent = s.ad;
  $("ogrAlt").textContent = classId + " · " + (kapsam === "donem" ? donemAd : (durum.veri.egitimYili || "") + " eğitim yılı");
  $("kapsamDonem").classList.toggle("secili", kapsam === "donem");
  $("kapsamYil").classList.toggle("secili", kapsam === "yil");
  $("kapsamDonem").setAttribute("aria-pressed", kapsam === "donem" ? "true" : "false");
  $("kapsamYil").setAttribute("aria-pressed", kapsam === "yil" ? "true" : "false");
  const kutu = $("ogrIcerik");
  kutu.innerHTML = "";
  const ov = ogrenciVerisi(classId, kapsam);
  if (ov.yukleniyor) { kutu.appendChild(el("div", "kart bos", "Yükleniyor…")); return; }
  const kapsamMetni = kapsam === "donem" ? "Bu dönem" : "Bu yıl";

  function kart(baslik, ek) {
    const k = el("div", "kart");
    const b = el("div", "kartBaslik2", baslik);
    if (ek) b.appendChild(el("small", "", ek));
    k.appendChild(b);
    kutu.appendChild(k);
    return k;
  }

  // Ödevler
  const kontrol = ov.v.kontrol;
  const c = { T: 0, E: 0, Y: 0, M: 0 }; let yok = 0;
  ov.kontrollu.forEach(o => { const d = (kontrol[o.id] || {})[s.kod]; if (d) c[d]++; else yok++; });
  const ok = kart("📋 Ödevler", ov.kontrollu.length + " kontrol edilmiş ödev");
  if (!ov.kontrollu.length) ok.appendChild(el("p", "bos", kapsamMetni + " henüz kontrol edilmiş ödev yok."));
  else {
    const sy = el("div", "ozetSayilar");
    DURUM_SIRASI.forEach(d => { const x = el("div", "ozetSayi"); x.append(el("b", "", String(c[d])), el("small", "", DURUM[d].emoji + " " + DURUM[d].ad)); sy.appendChild(x); });
    ok.appendChild(sy);
    const serit = el("div", "odevSeridi");
    serit.setAttribute("aria-label", "Ödevler, eskiden yeniye");
    ov.kontrollu.forEach(o => {
      const d = (kontrol[o.id] || {})[s.kod];
      const k = el("span", d || "", d ? DURUM[d].emoji : "·");
      k.title = o.ad;
      serit.appendChild(k);
    });
    ok.append(serit, el("p", "ipucu", "Eskiden yeniye" + (yok ? " · " + yok + " ödevde kontrol edilmedi (·)" : "") + "."));
    const det = el("details", "odevDetay");
    det.appendChild(el("summary", "", "Ödevleri tek tek göster"));
    ov.kontrollu.slice().reverse().forEach(o => {
      const d = (kontrol[o.id] || {})[s.kod];
      const sat = el("div", "odevSatir2");
      const n = el("span", "n", o.ad);
      n.appendChild(el("small", "", o.konu || "Konu yok"));
      sat.append(el("span", "t", kisaGun(o.tarih)), n, el("span", "", d ? DURUM[d].emoji + " " + DURUM[d].ad : "kontrol edilmedi"));
      det.appendChild(sat);
    });
    ok.appendChild(det);
  }

  // Etiketleri gruplayan satırlar
  function etiketSatirlari(hedef, liste) {
    const grup = {};
    liste.forEach(g => { (grup[g.etiket] = grup[g.etiket] || []).push(g); });
    Object.keys(grup).forEach(et => {
      const l = grup[et].sort((a, b) => (a.tarih || "").localeCompare(b.tarih || ""));
      const e = gozEtiket(l[0]);
      const sat = el("div", "etiketSatir");
      const m = el("span", "m", e.ad);
      m.appendChild(el("small", "", l.map(g => kisaGun(g.tarih)).join(", ")));
      if (ACIK_KATEGORILER[l[0].kategori]) {
        const acik = l.filter(g => !ov.duzeldiHaritasi[g.id]).length, duz = l.length - acik;
        const dr = el("small");
        if (acik) dr.appendChild(el("span", "durumRozet acik", "📌 " + acik + " açık"));
        if (acik && duz) dr.appendChild(document.createTextNode(" "));
        if (duz) dr.appendChild(el("span", "durumRozet duzeldi", (e.duzelme || "✓ Düzeldi") + (duz > 1 ? " ×" + duz : "")));
        m.appendChild(dr);
      }
      sat.append(el("span", "e", e.emoji), m, el("span", "kez", l.length + " kez"));
      hedef.appendChild(sat);
    });
  }
  const benim = ov.gozlemler.filter(g => g.kod === s.kod && g.kategori !== "gelisim");

  // Ödev gözlemleri
  const og = benim.filter(g => g.baglam === "odev");
  const ogk = kart("🏷️ Ödev gözlemleri");
  if (!og.length) ogk.appendChild(el("p", "bos", kapsamMetni + " ödev gözlemi yok."));
  [["olumlu", "Olumlu"], ["gelistir", "Geliştirilmeli"]].forEach(([k, ad]) => {
    const l = og.filter(g => g.kategori === k);
    if (!l.length) return;
    ogk.appendChild(el("div", "grupAd " + k, ad));
    etiketSatirlari(ogk, l);
  });

  // Ders içi gözlemler
  const dg = benim.filter(g => g.baglam === "ders");
  const dk = kart("👀 Ders içi gözlemler");
  if (!dg.length) dk.appendChild(el("p", "bos", kapsamMetni + " ders gözlemi yok. Bu “değerlendirilmedi” demektir, “sorun yok” değil."));
  [["olumlu", "Olumlu"], ["dikkat", "Dikkat gerektiren"]].forEach(([k, ad]) => {
    const l = dg.filter(g => g.kategori === k);
    if (!l.length) return;
    dk.appendChild(el("div", "grupAd " + k, ad));
    etiketSatirlari(dk, l);
  });
  const ak = dg.filter(g => g.kategori === "akademik");
  if (ak.length) {
    dk.appendChild(el("div", "grupAd akademik", "Akademik · konulara göre"));
    const konular = {};
    ak.forEach(g => { const k = g.konu || "Konu belirtilmemiş"; (konular[k] = konular[k] || []).push(g); });
    Object.keys(konular).forEach(k => {
      const blok = el("div", "konuBlok");
      blok.appendChild(el("h5", "", "📘 " + k));
      konular[k].sort((a, b) => (a.tarih || "").localeCompare(b.tarih || "")).forEach(g => {
        const e = gozEtiket(g), dz = ov.duzeldiHaritasi[g.id];
        const sat = el("div", "etiketSatir");
        const m = el("span", "m", e.ad + (g.altKonu ? " · " + g.altKonu : ""));
        const alt = el("small", "", kisaGun(g.tarih) + " · ");
        alt.appendChild(dz ? el("span", "durumRozet duzeldi", (e.duzelme || "✓ Düzeldi") + " (" + kisaGun(dz.tarih) + ")") : el("span", "durumRozet acik", "📌 açık"));
        m.appendChild(alt);
        sat.append(el("span", "e", e.emoji), m);
        blok.appendChild(sat);
      });
      dk.appendChild(blok);
    });
  }

  // Veli bilgilendirme
  const vk = kart("📨 Veli bilgilendirme");
  const gonderilen = ov.veli.filter(x => x.kod === s.kod).sort((a, b) => (a.donemNo - b.donemNo) || (a.blokNo - b.blokNo));
  gonderilen.forEach(x => {
    vk.appendChild(el("div", "veliSatir", "✅ " + (kapsam === "yil" && x.donemNo ? x.donemNo + ". dönem · " : "") + x.blokNo + ". blok mesajı gönderildi" +
      (x.zaman ? " · " + new Date(x.zaman).toLocaleDateString("tr-TR", { day: "numeric", month: "short" }) : "")));
  });
  const sira = veliSirasi(classId);
  if (sira.tamam && sira.bekleyen.some(x => x.kod === s.kod)) vk.appendChild(el("div", "veliSatir", "⏳ " + sira.tamam + ". blok mesajı henüz gönderilmedi"));
  if (!vk.querySelector(".veliSatir")) vk.appendChild(el("p", "bos", "Henüz veli mesajı yok. İlk mesaj 4 ödev kontrol edilince hazır olur."));

  // Zaman çizelgesi
  const olaylar = [];
  ov.kontrollu.forEach(o => {
    const d = (kontrol[o.id] || {})[s.kod];
    olaylar.push({ t: o.tarih, z: 0, ik: d ? DURUM[d].emoji : "·", m: "Ödev: " + o.ad, alt: d ? DURUM[d].ad : "kontrol edilmedi" });
  });
  ov.gozlemler.filter(g => g.kod === s.kod).forEach(g => {
    if (g.kategori === "gelisim") {
      const eski = ov.tumGozlemler.find(x => x.id === g.baglantiId);
      const e = eski ? gozEtiket(eski) : null;
      olaylar.push({ t: g.tarih, z: g.zaman || 1, ik: "✓", m: e ? (e.duzelme || "✓ Düzeldi").replace(/^✓\s*/, "") : "Düzeldi", alt: e ? e.emoji + " " + e.ad : "" });
    } else {
      const e = gozEtiket(g);
      olaylar.push({ t: g.tarih, z: g.zaman || 1, ik: e.emoji, m: e.ad,
        alt: (g.baglam === "odev" ? "Ödev gözlemi · " + g.odev.ad : "Ders") + (g.baglam === "ders" && g.konu ? " · " + g.konu + (g.altKonu ? " · " + g.altKonu : "") : "") });
    }
  });
  olaylar.sort((a, b) => (b.t || "").localeCompare(a.t || "") || b.z - a.z);
  const zk = el("div", "kart");
  const det = el("details");
  const sum = el("summary", "kartBaslik2 tiklanir", "🗓️ Zaman çizelgesi");
  sum.appendChild(el("small", "", olaylar.length + " kayıt · dokunun"));
  det.appendChild(sum);
  let gun = "";
  olaylar.forEach(o => {
    if (o.t !== gun) { gun = o.t; det.appendChild(el("div", "zcGun", uzunGun(o.t))); }
    const sat = el("div", "zcSatir");
    const m = el("span", "", o.m);
    if (o.alt) m.appendChild(el("small", "", o.alt));
    sat.append(el("span", "ik", o.ik), m);
    det.appendChild(sat);
  });
  if (!olaylar.length) det.appendChild(el("p", "bos", kapsamMetni + " kayıt yok."));
  zk.appendChild(det);
  kutu.appendChild(zk);
}

/** Veri tazelenince açık öğrenci ekranını yeniden çiz. */
function ogrenciEkraniniYenile() {
  if (ekranAcik("ogrListe")) ogrListeCiz();
  else if (ekranAcik("ogrenci")) ogrenciCiz();
}

// ---------- alt sayfa ve bildirim ----------
let sayfaKapaninca = null;
function sayfaAc(doldur, kapaninca) {
  const sy = $("altSayfa");
  sy.innerHTML = "";
  doldur(sy);
  sayfaKapaninca = kapaninca || null;
  $("perde").hidden = false;
}
function sayfaKapat() {
  $("perde").hidden = true;
  const f = sayfaKapaninca; sayfaKapaninca = null;
  if (f) f();
}

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
  // ders gözlemleri
  const ders = depo.oku(DEPO.dersGoz, {});
  let dersDegisti = false;
  kayitlar.forEach(k => {
    const classId = k.veri && k.veri.classId;
    if (!classId || (k.tur !== "dersGozlem" && k.tur !== "gozlemIptal")) return;
    if (!ders[classId]) { if (k.tur === "dersGozlem") setTimeout(() => dersGozlemleriTazele(classId), 0); return; }
    dersUygula(ders[classId], k, classId);
    dersDegisti = true;
  });
  if (dersDegisti) depo.yaz(DEPO.dersGoz, ders);
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
  [DEPO.anahtar, DEPO.onbellek, DEPO.sonSinif, DEPO.odevler, DEPO.taslak, DEPO.sonKonu, DEPO.dersGoz, DEPO.dersKonu].forEach(k => depo.sil(k));
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
  $("konuSerit").addEventListener("click", dersKonusuSayfasi);
  $("kapsamDonem").addEventListener("click", () => { durum.ogrKapsam = "donem"; ogrenciCiz(); });
  $("kapsamYil").addEventListener("click", () => { durum.ogrKapsam = "yil"; ogrenciCiz(); });
  $("cokluAnahtar").addEventListener("click", () => { durum.gozlemCoklu = !durum.gozlemCoklu; durum.gozlemSecili.clear(); gozlemCiz(); });
  $("secimTemizle").addEventListener("click", () => { durum.gozlemSecili.clear(); gozlemCiz(); });
  $("secimGozlem").addEventListener("click", () => { if (durum.gozlemSecili.size) gozlemEtiketSayfasi(Array.from(durum.gozlemSecili)); });
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
