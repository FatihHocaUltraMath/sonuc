/* FatihHoca | UltraMat — Öğrenci Takip · uygulama (sürüm 0.1 · Aşama 0)
 *
 * Kalıcı verinin tek kaynağı UltraMat_Takip Google tablosudur. Telefonda yalnızca şunlar tutulur:
 *  - öğretmen anahtarı (her girişte sormamak için),
 *  - son okunan sınıf/öğrenci listesi (uygulama anında açılsın diye; arka planda tazelenir),
 *  - henüz gönderilemeyen kayıtlar (internet gelince kendiliğinden gönderilir).
 * Her kaydın kimliği telefonda üretilir; aynı kayıt iki kez gönderilse bile sunucuda çoğalmaz.
 */
"use strict";

// ===== AYAR: Apps Script "Web uygulaması" adresi (…/exec ile biter) =====
const API_URL = "https://script.google.com/macros/s/AKfycbw-WAIeNfMbb6nSp_Q0eraU6WG7ii20c1g6vhT-x91N_DqCuEkpuv5Caouzc1g-q-kZ1Q/exec";

const SURUM = "0.1";
const DEPO = { anahtar: "fhTakip_anahtar", onbellek: "fhTakip_baslangic", kuyruk: "fhTakip_kuyruk", sonSinif: "fhTakip_sonSinif" };
const ZAMAN_ASIMI_MS = 25000;
const TEKRAR_DENEME_MS = 30000;

const durum = {
  veri: null,            // sunucudan gelen başlangıç verisi
  seciliSinif: null,     // classId
  cevrimdisi: false,     // son tazeleme başarısız mı
  kuyrukHatasi: null,    // { kalici: bool, mesaj } — kırmızı durum için
  gonderiliyor: false
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

// ---------- ekranlar ----------
function ekranGoster(ad) {
  ["giris", "ana", "bolum"].forEach(e => { $("ekran-" + e).hidden = e !== ad; });
  $("durumCubugu").hidden = ad === "giris";
  window.scrollTo(0, 0);
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
  const dugme = $("girisDugme");
  if (!anahtar) { girisGoster("Anahtarı yazın."); return; }
  if (!apiAyarliMi()) { girisGoster(); return; }
  dugme.disabled = true; dugme.textContent = "Kontrol ediliyor…";
  try {
    const veri = await api("baslangic", null, anahtar);
    depo.yaz(DEPO.anahtar, anahtar);
    $("anahtarInput").value = "";
    veriyiKabulEt(veri);
    anaEkraniAc();
    kuyruguGonder();
  } catch (e) {
    if (e instanceof SunucuHatasi) girisGoster(e.kod === "anahtar" ? "Anahtar kabul edilmedi. Tablodaki anahtarla aynı olduğundan emin olun." : e.message);
    else girisGoster("Sunucuya ulaşılamadı. İnternet bağlantısını kontrol edip tekrar deneyin.");
  } finally {
    dugme.disabled = false; dugme.textContent = "Giriş yap";
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

function anaEkraniCiz() {
  const v = durum.veri;
  if (!v) return;
  $("donemEtiketi").innerHTML = "";
  const satir1 = document.createElement("div"); satir1.textContent = v.egitimYili || "";
  const satir2 = document.createElement("div"); satir2.textContent = v.donem ? v.donem.ad + (v.donem.tatil ? " (tatil)" : "") : "";
  $("donemEtiketi").append(satir1, satir2);

  // Veri uyarıları (ör. aynı Kod iki öğrencide)
  const uk = $("uyariKutusu");
  if (v.uyarilar && v.uyarilar.length) {
    uk.innerHTML = "<b>Ogrenciler sayfasında düzeltilmesi gereken:</b>";
    const ul = document.createElement("ul");
    v.uyarilar.forEach(u => { const li = document.createElement("li"); li.textContent = u; ul.appendChild(li); });
    uk.appendChild(ul);
    uk.hidden = false;
  } else uk.hidden = true;

  // Sınıflar
  const izgara = $("sinifIzgara");
  izgara.innerHTML = "";
  const siniflar = (v.siniflar || []).filter(s => s.ogrenciler.some(o => o.aktif));
  if (!siniflar.some(s => s.classId === durum.seciliSinif)) {
    const son = depo.oku(DEPO.sonSinif, null);
    durum.seciliSinif = siniflar.some(s => s.classId === son) ? son : (siniflar[0] ? siniflar[0].classId : null);
  }
  siniflar.forEach(s => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "sinifDugme" + (s.classId === durum.seciliSinif ? " secili" : "");
    b.setAttribute("aria-pressed", s.classId === durum.seciliSinif ? "true" : "false");
    const ad = document.createElement("b"); ad.textContent = s.classId;
    const sayi = document.createElement("small"); sayi.textContent = s.ogrenciler.filter(o => o.aktif).length + " öğrenci";
    b.append(ad, sayi);
    b.addEventListener("click", () => { durum.seciliSinif = s.classId; depo.yaz(DEPO.sonSinif, s.classId); anaEkraniCiz(); });
    izgara.appendChild(b);
  });
  $("sinifBos").hidden = siniflar.length > 0;
  $("sinifBos").textContent = "Ogrenciler sayfasında sınıfı ve adı dolu öğrenci bulunamadı.";
  $("surumBilgi").textContent = "FatihHoca UltraMat · Öğrenci Takip · sürüm " + SURUM + (v.surum && v.surum !== SURUM ? " · sunucu " + v.surum : "");
}

const BOLUMLER = {
  odev: { ad: "Ödev ve Çalışma Takibi", asama: 1 },
  gozlem: { ad: "Ders İçi Gözlem", asama: 3 },
  ogrenci: { ad: "Öğrenci Görünümü", asama: 4 },
  rapor: { ad: "Excel · PDF", asama: 5 }
};

function bolumAc(ad, gecmiseEkle) {
  const b = BOLUMLER[ad];
  if (!b) return;
  if (gecmiseEkle !== false) history.pushState({ bolum: ad }, "");
  $("bolumBaslik").textContent = b.ad + (durum.seciliSinif ? " · " + durum.seciliSinif : "");
  $("bolumMetin").textContent = "Bu bölüm Aşama " + b.asama + "'de eklenecek.";
  ekranGoster("bolum");
  durumCubugunuCiz();
}

// ---------- tazeleme ----------
async function tazele(elle) {
  if (!apiAyarliMi()) return;
  const dugme = $("yenileDugme");
  if (elle) { dugme.disabled = true; dugme.textContent = "Yenileniyor…"; }
  try {
    const veri = await api("baslangic");
    veriyiKabulEt(veri);
    if (!$("ekran-ana").hidden) anaEkraniCiz();
  } catch (e) {
    if (e instanceof SunucuHatasi && (e.kod === "anahtar" || e.kod === "anahtar_yok")) {
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
    if (elle) { dugme.disabled = false; dugme.textContent = "Listeyi yenile"; }
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
    // Gönderim sürerken eklenen kayıtlar kaybolmasın diye kuyruk yeniden okunur.
    const guncel = depo.oku(DEPO.kuyruk, []).filter(k => !tamam.has(k.id));
    depo.yaz(DEPO.kuyruk, guncel);
    durum.kuyrukHatasi = kalici ? { kalici: true, mesaj: kalici.hata } : null;
    devamEt = parti.every(k => tamam.has(k.id)) && guncel.length > 0;   // sırada başka parti var
  } catch (e) {
    if (e instanceof SunucuHatasi && (e.kod === "anahtar" || e.kod === "anahtar_yok")) {
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
  if (!confirm("Bu telefondaki anahtar ve liste silinsin mi? Tablodaki kayıtlar etkilenmez.")) return;
  [DEPO.anahtar, DEPO.onbellek, DEPO.sonSinif].forEach(k => depo.sil(k));
  durum.veri = null; durum.seciliSinif = null;
  girisGoster();
}

// ---------- başlat ----------
function baslat() {
  $("girisDugme").addEventListener("click", girisYap);
  $("anahtarInput").addEventListener("keydown", e => { if (e.key === "Enter") girisYap(); });
  $("yenileDugme").addEventListener("click", () => tazele(true));
  $("cikisDugme").addEventListener("click", cikisYap);
  $("tekrarDene").addEventListener("click", () => { durum.kuyrukHatasi = null; kuyruguGonder(); });
  $("geriDugme").addEventListener("click", () => history.back());
  document.querySelectorAll("[data-bolum]").forEach(b => b.addEventListener("click", () => bolumAc(b.dataset.bolum)));

  // Telefonun geri tuşu: bölümden ana ekrana döner.
  window.addEventListener("popstate", ev => {
    if (!durum.veri) return;
    if (ev.state && ev.state.bolum) bolumAc(ev.state.bolum, false);
    else anaEkraniAc();
  });

  // İnternet gelince / uygulamaya dönülünce / belirli aralıkla bekleyenleri gönder.
  window.addEventListener("online", () => { kuyruguGonder(); if (durum.cevrimdisi) tazele(); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") kuyruguGonder(); });
  setInterval(kuyruguGonder, TEKRAR_DENEME_MS);

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
