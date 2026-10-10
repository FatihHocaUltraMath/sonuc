/****************************************************************
 * FatihHoca | UltraMat — Öğrenci Takip Servisi (takip.gs)
 * Sürüm 0.7 · Mufredat'ın "İçerik" sütunu (alt başlıklar, ; ile) okunur · ödevde seçilen içerikler "İçerik"
 *   sütununa yazılır · menü: 🧹 Test Kayıtlarını Sil (takip uygulaması 0.10)
 * Sürüm 0.6 · Mufredat'ın "Kapsam" sütunu da okunur (takip uygulaması 0.9)
 *
 * Bu script UltraMat_Takip tablosuna BAĞLIDIR.
 *  - Ana tablodan (UltraMat_Veriler) yalnızca "Ogrenciler" ve "Mufredat" sayfalarını OKUR
 *    (Ogrenciler'den veli mesajı için "Veli Telefon" ve "Veli Hitap" de okunur).
 *    Ana tabloya hiçbir şey YAZMAZ. Mevcut Code.gs ve veli sayfası bundan etkilenmez.
 *  - Öğrencinin kimliği ana tablodaki "Kod" sütunudur (yeni kimlik üretilmez).
 *  - Sınıf kimliği "Sınıf-Şube" biçimindedir (ör. 8-A).
 *  - Takip kayıtları bu tablodaki sayfalara yazılır (Aşama 1'den itibaren).
 *
 * Menü (tablo açılınca üstte "🛠️ Takip"):
 *  - Takip Kurulumu: sayfaları oluşturur, ana tablo bağlantısını sorar ve test eder.
 *  - Öğretmen Anahtarını Belirle: takip uygulamasının anahtarı (Script Properties'te saklanır).
 *  - Bağlantıyı Test Et: ana tablodan kaç sınıf/öğrenci okunduğunu gösterir.
 *
 * İstekler: POST, gövde JSON (Content-Type: text/plain). Anahtar URL'de değil gövdede taşınır.
 *   { islem: "baslangic", anahtar: "…" }        → sınıflar, öğrenciler, konular (+ kapsamlar), dönem
 *   { islem: "odevler", anahtar: "…", classId }  → sınıfın bu yılki ödevleri, kontrol durumları, ödev gözlemleri, veli kayıtları
 *   { islem: "dersGozlemleri", anahtar: "…", classId } → sınıfın bu yılki ders içi gözlemleri
 *   { islem: "kaydet", anahtar: "…", islemler }  → telefonda bekleyen kayıtlar
 *        türler: odevOlustur · odevGuncelle (bilgi değişikliği / iptal) · odevKontrol (durumlar + gözlemler) · veliBilgi
 *                dersGozlem (bir anda bir ya da birkaç öğrenciye gözlem) · gozlemIptal ("Geri al")
 ****************************************************************/

var TAKIP_SURUM = "0.7";
var SAAT_DILIMI = "Europe/Istanbul";
var ANAHTAR_OZELLIGI = "TAKIP_OGRETMEN_ANAHTARI";
var ANAHTAR_MIN_UZUNLUK = 12;
var TOPLU_KAYIT_SINIRI = 200;   // tek istekte en fazla bu kadar kayıt işlenir

// Takip tablosundaki sayfalar ve başlıkları. "Ad Soyad" sütunları yalnızca tabloyu okurken
// kolaylık içindir; kimlik her zaman "Kod"dur.
var SAYFA_BASLIKLARI = {
  Odevler: ["Ödev ID", "Eğitim Yılı", "Dönem", "Sınıf ID", "Sınıf", "Şube", "Tarih", "Konu", "Ödev Adı", "Açıklama", "Oluşturma", "İptal", "İçerik"],
  Odev_Kontrol: ["Ödev ID", "Kod", "Ad Soyad", "Durum", "Son Değişiklik"],
  Gozlemler: ["Gözlem ID", "Zaman", "Tarih", "Eğitim Yılı", "Dönem", "Kod", "Ad Soyad", "Sınıf ID", "Bağlam", "Ödev ID", "Kategori", "Etiket", "Konu", "Alt Konu", "Bağlantı ID", "İptal"],
  Veli_Bilgi: ["Kayıt ID", "Kod", "Ad Soyad", "Sınıf ID", "Eğitim Yılı", "Dönem", "Blok No", "Ödev ID'leri", "Mesaj", "Zaman"],
  Degisiklikler: ["Zaman", "Sayfa", "Kayıt", "Alan", "Eski", "Yeni"]
};

var AYAR_SAYFASI = "Ayarlar";
var VARSAYILAN_AYARLAR = [
  ["Ana Tablo", "", "UltraMat_Veriler tablosunun bağlantısı (tablo açıkken adres çubuğundaki adres)."],
  ["Eğitim Yılı", "2026–2027", "Yeni yıl başında güncelle."],
  ["1. Dönem Başlangıç", "2026-09-01", "YYYY-AA-GG"],
  ["1. Dönem Bitiş", "2027-01-22", "YYYY-AA-GG"],
  ["2. Dönem Başlangıç", "2027-02-08", "YYYY-AA-GG"],
  ["2. Dönem Bitiş", "2027-06-25", "YYYY-AA-GG"]
];

// ============== MENÜ ==============
function onOpen() {
  SpreadsheetApp.getUi().createMenu("🛠️ Takip")
    .addItem("🛠️ Takip Kurulumu", "takipKurulumu")
    .addItem("🛡️ Öğretmen Anahtarını Belirle", "ogretmenAnahtariniBelirle")
    .addSeparator()
    .addItem("🔍 Bağlantıyı Test Et", "baglantiyiTestEt")
    .addSeparator()
    .addItem("🧹 Test Kayıtlarını Sil", "testKayitlariniSil")
    .addToUi();
}

/** Sayfaları (yoksa) oluşturur, ana tablo bağlantısını sorar ve test eder. Var olan sayfalara dokunmaz. */
function takipKurulumu() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var olusan = [];

  Object.keys(SAYFA_BASLIKLARI).forEach(function (ad) {
    if (!ss.getSheetByName(ad)) {
      var s = ss.insertSheet(ad);
      var b = SAYFA_BASLIKLARI[ad];
      s.getRange(1, 1, 1, b.length).setValues([b]).setFontWeight("bold").setBackground("#FFF7ED");
      s.setFrozenRows(1);
      olusan.push(ad);
    }
  });

  var ayar = ss.getSheetByName(AYAR_SAYFASI);
  if (!ayar) {
    ayar = ss.insertSheet(AYAR_SAYFASI);
    ayar.getRange(1, 1, 1, 3).setValues([["Ayar", "Değer", "Açıklama"]]).setFontWeight("bold").setBackground("#FFF7ED");
    ayar.getRange(2, 2, VARSAYILAN_AYARLAR.length, 1).setNumberFormat("@");   // tarihler metin kalsın
    ayar.getRange(2, 1, VARSAYILAN_AYARLAR.length, 3).setValues(VARSAYILAN_AYARLAR);
    ayar.setFrozenRows(1);
    ayar.setColumnWidth(1, 170); ayar.setColumnWidth(2, 320); ayar.setColumnWidth(3, 380);
    olusan.push(AYAR_SAYFASI);
  }

  // İlk kurulumda boş gelen "Sayfa1" varsa ve içi boşsa kaldır.
  var sayfa1 = ss.getSheetByName("Sayfa1") || ss.getSheetByName("Sheet1");
  if (sayfa1 && ss.getSheets().length > 1 && sayfa1.getLastRow() === 0) ss.deleteSheet(sayfa1);

  // Ana tablo bağlantısı
  var ayarlar = ayarlariOku();
  var kimlik = ayarlar.anaTabloId;
  if (!kimlik) {
    var yanit = ui.prompt("Ana tablo bağlantısı",
      "UltraMat_Veriler tablosunu açın, adres çubuğundaki adresin tamamını kopyalayıp buraya yapıştırın:",
      ui.ButtonSet.OK_CANCEL);
    if (yanit.getSelectedButton() !== ui.Button.OK) {
      ui.alert("Kurulum yarım kaldı", "Ana tablo bağlantısı girilmedi. Menüden kurulumu tekrar çalıştırabilirsiniz.", ui.ButtonSet.OK);
      return;
    }
    kimlik = tabloKimligiCikar(yanit.getResponseText());
    if (!kimlik) {
      ui.alert("Bağlantı anlaşılamadı", "Yapıştırılan metinde tablo adresi bulunamadı. Adresin tamamını (https://docs.google.com/spreadsheets/d/… ile başlayan) yapıştırın.", ui.ButtonSet.OK);
      return;
    }
    ayarYaz("Ana Tablo", "https://docs.google.com/spreadsheets/d/" + kimlik + "/edit");
  }

  var test = baglantiOzeti();
  var satirlar = [];
  if (olusan.length) satirlar.push("Oluşturulan sayfalar: " + olusan.join(", "));
  else satirlar.push("Sayfalar zaten vardı; hiçbirine dokunulmadı.");
  satirlar.push("");
  satirlar.push(test.metin);
  if (!ogretmenAnahtariniOku()) {
    satirlar.push("");
    satirlar.push("Sıradaki adım: menüden \"🛡️ Öğretmen Anahtarını Belirle\".");
  }
  ui.alert(test.ok ? "Kurulum tamam" : "Kurulum tamam, bağlantıda sorun var", satirlar.join("\n"), ui.ButtonSet.OK);
}

function ogretmenAnahtariniBelirle() {
  var ui = SpreadsheetApp.getUi();
  var yanit = ui.prompt("Öğretmen anahtarı",
    "Takip uygulamasına girişte kullanılacak anahtarı yazın (en az " + ANAHTAR_MIN_UZUNLUK + " karakter).\n" +
    "Karne üreticideki anahtarın aynısını kullanabilirsiniz.\n" +
    "Boş bırakıp Tamam'a basarsanız güçlü bir anahtar sizin için üretilir.",
    ui.ButtonSet.OK_CANCEL);
  if (yanit.getSelectedButton() !== ui.Button.OK) return;
  var a = String(yanit.getResponseText() || "").trim();
  if (!a) a = rastgeleAnahtarUret(20);
  if (a.length < ANAHTAR_MIN_UZUNLUK) {
    ui.alert("Anahtar çok kısa", "Anahtar en az " + ANAHTAR_MIN_UZUNLUK + " karakter olmalı. Değişiklik yapılmadı.", ui.ButtonSet.OK);
    return;
  }
  PropertiesService.getScriptProperties().setProperty(ANAHTAR_OZELLIGI, a);
  ui.alert("Anahtar kaydedildi",
    "Takip uygulamasının anahtarı:\n\n" + a + "\n\nBunu telefonunuzda ilk girişte bir kez yazacaksınız. " +
    "Telefon kaybolursa buradan yeni anahtar belirleyin; eski anahtar hemen geçersiz olur.",
    ui.ButtonSet.OK);
}

function baglantiyiTestEt() {
  var t = baglantiOzeti();
  SpreadsheetApp.getUi().alert(t.ok ? "Bağlantı çalışıyor" : "Bağlantıda sorun var", t.metin, SpreadsheetApp.getUi().ButtonSet.OK);
}

/** Ana tabloyu okuyup kurulum/test penceresinde gösterilecek özeti hazırlar. */
function baglantiOzeti() {
  try {
    var v = baslangicVerisiOlustur();
    var toplam = 0, satirlar = [];
    v.siniflar.forEach(function (s) {
      var aktif = s.ogrenciler.filter(function (o) { return o.aktif; }).length;
      toplam += aktif;
      satirlar.push("  " + s.classId + ": " + aktif + " öğrenci");
    });
    var konuSayisi = 0;
    Object.keys(v.konular).forEach(function (k) { konuSayisi += v.konular[k].length; });
    var kapsamSayisi = 0;
    Object.keys(v.kapsamlar).forEach(function (k) { kapsamSayisi += Object.keys(v.kapsamlar[k]).length; });
    var metin = "Ana tablo okundu: " + v.siniflar.length + " sınıf, " + toplam + " öğrenci.\n" + satirlar.join("\n") +
      "\nMüfredattan " + konuSayisi + " konu okundu (" + kapsamSayisi + " tanesinin kapsamı yazılı)." +
      "\nEğitim yılı: " + v.egitimYili + " · " + v.donem.ad;
    if (v.uyarilar.length) metin += "\n\nUyarılar:\n- " + v.uyarilar.join("\n- ");
    return { ok: true, metin: metin };
  } catch (err) {
    return { ok: false, metin: String(err && err.message ? err.message : err) };
  }
}

// ============== AYARLAR ==============
function ayarlariOku() {
  var sonuc = { anaTabloId: "", egitimYili: "", donemler: [] };
  var s = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(AYAR_SAYFASI);
  var harita = {};
  if (s && s.getLastRow() > 1) {
    s.getRange(2, 1, s.getLastRow() - 1, 2).getValues().forEach(function (r) {
      if (r[0]) harita[katla(r[0])] = r[1];
    });
  }
  sonuc.anaTabloId = tabloKimligiCikar(harita[katla("Ana Tablo")]);
  sonuc.egitimYili = String(harita[katla("Eğitim Yılı")] || "").trim();
  for (var i = 1; i <= 2; i++) {
    var bas = tarihMetni(harita[katla(i + ". Dönem Başlangıç")]);
    var bit = tarihMetni(harita[katla(i + ". Dönem Bitiş")]);
    if (bas && bit) sonuc.donemler.push({ no: i, ad: i + ". Dönem", bas: bas, bit: bit });
  }
  return sonuc;
}

function ayarYaz(ad, deger) {
  var s = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(AYAR_SAYFASI);
  if (!s) return;
  var son = s.getLastRow();
  var adlar = son > 1 ? s.getRange(2, 1, son - 1, 1).getValues() : [];
  for (var i = 0; i < adlar.length; i++) {
    if (katla(adlar[i][0]) === katla(ad)) { s.getRange(i + 2, 2).setValue(deger); return; }
  }
  s.appendRow([ad, deger, ""]);
}

/** Bağlantı metninden ya da çıplak kimlikten tablo kimliğini çıkarır; bulamazsa "". */
function tabloKimligiCikar(metin) {
  var m = String(metin || "").trim();
  if (!m) return "";
  var e = m.match(/\/d\/([a-zA-Z0-9_-]{20,})/);
  if (e) return e[1];
  if (/^[a-zA-Z0-9_-]{25,}$/.test(m)) return m;
  return "";
}

// ============== DÖNEM ==============
/** Verilen gün (YYYY-AA-GG) hangi döneme düşer? Dönem arası tatil önceki döneme sayılır;
 * ilk dönemden önceki günler 1. döneme, son dönemden sonrakiler son döneme sayılır. */
function donemBul(donemler, gun) {
  if (!donemler.length) return { no: 0, ad: "Dönem tanımsız", tatil: false };
  for (var i = 0; i < donemler.length; i++) {
    var d = donemler[i];
    if (gun >= d.bas && gun <= d.bit) return { no: d.no, ad: d.ad, tatil: false };
  }
  if (gun < donemler[0].bas) return { no: donemler[0].no, ad: donemler[0].ad, tatil: false };
  var onceki = donemler[0];
  for (var j = 0; j < donemler.length; j++) if (donemler[j].bit < gun) onceki = donemler[j];
  return { no: onceki.no, ad: onceki.ad, tatil: true };
}

// ============== ANA TABLODAN OKUMA ==============
function anaTabloyuAc() {
  var ayar = ayarlariOku();
  if (!ayar.anaTabloId) throw new Error("Ana tablo bağlantısı girilmemiş. Menüden \"🛠️ Takip Kurulumu\"nu çalıştırın.");
  try {
    return SpreadsheetApp.openById(ayar.anaTabloId);
  } catch (e) {
    throw new Error("Ana tablo açılamadı. Ayarlar sayfasındaki \"Ana Tablo\" bağlantısını kontrol edin.");
  }
}

/** Uygulamanın açılışta ihtiyaç duyduğu her şey: sınıflar + öğrenciler + konular + dönem. */
function baslangicVerisiOlustur() {
  var ayar = ayarlariOku();
  var ss = anaTabloyuAc();
  var og = ogrencileriOku(ss.getSheetByName("Ogrenciler"));
  var mufredat = mufredatOku(ss.getSheetByName("Mufredat"));
  var bugun = Utilities.formatDate(new Date(), SAAT_DILIMI, "yyyy-MM-dd");
  return {
    ok: true,
    surum: TAKIP_SURUM,
    bugun: bugun,
    egitimYili: ayar.egitimYili,
    donemler: ayar.donemler,
    donem: donemBul(ayar.donemler, bugun),
    siniflar: og.siniflar,
    konular: mufredat.konular,
    kapsamlar: mufredat.kapsamlar,   // 0.6 — { sınıf: { içerik: kapsam metni } }; eski uygulama bu alanı görmezden gelir
    uyarilar: og.uyarilar
  };
}

/** Ogrenciler sayfasını okur. Sütunlar başlık adından bulunur (bulunamazsa A–D sırası kullanılır).
 * Adı boş (rezerve) satırlar alınmaz. İsteğe bağlı "Durum" sütununda "ayrıldı" yazan öğrenci
 * aktif=false döner: listelerde görünmez ama eski kayıtları korunur. */
function ogrencileriOku(sayfa) {
  if (!sayfa) throw new Error("Ana tabloda \"Ogrenciler\" sayfası bulunamadı.");
  var veri = sayfa.getDataRange().getValues();
  if (veri.length < 2) return { siniflar: [], uyarilar: ["Ogrenciler sayfası boş."] };
  var bas = veri[0].map(katla);
  function bul(ad, yedek) { var i = bas.indexOf(ad); return i === -1 ? yedek : i; }
  var iKod = bul("kod", 0), iAd = bul("ad soyad", 1), iSinif = bul("sinif", 2), iSube = bul("sube", 3), iDurum = bul("durum", -1);
  var iTel = bul("veli telefon", -1), iHitap = bul("veli hitap", -1);

  var siniflar = {}, kodlar = {}, uyarilar = [];
  for (var r = 1; r < veri.length; r++) {
    var satir = veri[r];
    var kod = kodMetni(satir[iKod]);
    var ad = String(satir[iAd] || "").trim();
    if (!kod || !ad) continue;
    if (kodlar[kod]) { uyarilar.push("Aynı Kod iki öğrencide: " + kod + " (" + kodlar[kod] + " / " + ad + "). Düzeltilene kadar ikincisi takipte gösterilmiyor."); continue; }
    kodlar[kod] = ad;
    var sinif = kodMetni(satir[iSinif]);
    var sube = String(satir[iSube] || "").trim().toLocaleUpperCase("tr");
    if (!sinif) { uyarilar.push(ad + " (" + kod + ") için Sınıf boş; takipte gösterilmiyor."); continue; }
    var classId = sube ? sinif + "-" + sube : sinif;
    var durum = iDurum === -1 ? "" : katla(satir[iDurum]);
    var aktif = !(durum.indexOf("ayril") === 0 || durum.indexOf("pasif") === 0);
    if (!siniflar[classId]) siniflar[classId] = { classId: classId, sinif: sinif, sube: sube, ogrenciler: [] };
    siniflar[classId].ogrenciler.push({
      kod: kod, ad: ad, aktif: aktif,
      tel: iTel === -1 ? "" : String(satir[iTel] || "").trim(),
      hitap: iHitap === -1 ? "" : String(satir[iHitap] || "").trim()
    });
  }
  var liste = Object.keys(siniflar).map(function (k) { return siniflar[k]; });
  liste.sort(function (a, b) {
    return (Number(a.sinif) - Number(b.sinif)) || a.sube.localeCompare(b.sube, "tr");
  });
  liste.forEach(function (s) { s.ogrenciler.sort(function (a, b) { return a.ad.localeCompare(b.ad, "tr"); }); });
  return { siniflar: liste, uyarilar: uyarilar };
}

/** Mufredat sayfasından sınıf başına konu (İçerik Çerçevesi) listesi ve her içeriğin alt başlıkları (İçerik).
 * 0.6: "Kapsam" ile başlayan sütun (ör. "Kapsam (yalnızca senin için)") isteğe bağlıdır; hücre yazıldığı gibi alınır.
 * Döner: { konular: { sınıf: [içerik, …] }, kapsamlar: { sınıf: { içerik: kapsam } } }. Sayfa yoksa ikisi de boştur. */
function mufredatOku(sayfa) {
  var sonuc = { konular: {}, kapsamlar: {} };
  if (!sayfa) return sonuc;
  var veri = sayfa.getDataRange().getValues();
  if (veri.length < 2) return sonuc;
  var bas = veri[0].map(katla);
  var iSinif = bas.indexOf("sinif"), iSira = bas.indexOf("sira"), iIcerik = bas.indexOf("icerik cercevesi");
  // 0.7: alt başlıklar "İçerik" sütununda (eski adı "Kapsam…"); maddeler ; ile ayrılır, uygulama böler
  var iKapsam = bas.indexOf("icerik");
  if (iKapsam === -1) bas.forEach(function (b, i) { if (iKapsam === -1 && b.indexOf("kapsam") === 0) iKapsam = i; });
  if (iSinif === -1 || iIcerik === -1) return sonuc;
  var gecici = {};
  for (var r = 1; r < veri.length; r++) {
    var sinif = kodMetni(veri[r][iSinif]);
    var icerik = String(veri[r][iIcerik] || "").trim();
    if (!sinif || !icerik) continue;
    var sira = iSira === -1 ? r : Number(veri[r][iSira]) || r;
    if (!gecici[sinif]) gecici[sinif] = [];
    if (!gecici[sinif].some(function (x) { return x.ad === icerik; })) gecici[sinif].push({ ad: icerik, sira: sira });
    var kapsam = iKapsam === -1 ? "" : String(veri[r][iKapsam] || "").replace(/\s+/g, " ").trim();
    if (kapsam) {
      if (!sonuc.kapsamlar[sinif]) sonuc.kapsamlar[sinif] = {};
      if (!sonuc.kapsamlar[sinif][icerik]) sonuc.kapsamlar[sinif][icerik] = kapsam;
    }
  }
  Object.keys(gecici).forEach(function (s) {
    sonuc.konular[s] = gecici[s].sort(function (a, b) { return a.sira - b.sira; }).map(function (x) { return x.ad; });
  });
  return sonuc;
}

// ============== 0.7: TEST KAYITLARINI SİL ==============
var TEMIZLENECEK_SAYFALAR = ["Odevler", "Odev_Kontrol", "Gozlemler", "Veli_Bilgi", "Degisiklikler"];

/** Menü: takip kayıtlarını (ödevler, kontroller, gözlemler, veli mesajları, değişiklik günlüğü) başlıklar kalacak
 * şekilde siler. Ayarlar ve öğretmen anahtarı kalır. Önce tablonun bir kopyası Drive'a alınır; "SİL" yazılmalıdır. */
function testKayitlariniSil() {
  var ui = SpreadsheetApp.getUi(), ss = SpreadsheetApp.getActiveSpreadsheet();
  var liste = TEMIZLENECEK_SAYFALAR.map(function (ad) {
    var s = ss.getSheetByName(ad);
    return "  • " + ad + ": " + (s ? Math.max(0, s.getLastRow() - 1) + " satır" : "sayfa yok");
  }).join("\n");
  var onay = ui.prompt("🧹 Test Kayıtlarını Sil",
    "Şu sayfalar başlık satırları kalacak şekilde boşaltılacak:\n" + liste +
    "\n\nAyarlar ve öğretmen anahtarı kalır. Silmeden önce tablonun bir kopyası Drive'a yedek olarak alınır." +
    "\nÖNEMLİ: Telefonda gönderilmemiş kayıt varsa internet gelince yeniden yazılır; önce alt çubukta \"Tüm kayıtlar gönderildi\" yazdığından emin olun." +
    "\n\nDevam etmek için büyük harflerle SİL yazın:", ui.ButtonSet.OK_CANCEL);
  if (onay.getSelectedButton() !== ui.Button.OK || String(onay.getResponseText()).trim().toLocaleUpperCase("tr") !== "SİL") {
    ui.alert("İptal edildi; hiçbir şey silinmedi."); return;
  }
  var yedek;
  try {
    yedek = ss.copy(ss.getName() + " — yedek " + Utilities.formatDate(new Date(), SAAT_DILIMI, "yyyy-MM-dd HH.mm"));
  } catch (e) {
    ui.alert("Yedek alınamadığı için hiçbir şey silinmedi.\n\nAyrıntı: " + e); return;
  }
  var kilit = LockService.getScriptLock();
  if (!kilit.tryLock(30000)) { ui.alert("Şu an bir kayıt yazılıyor. Biraz sonra tekrar deneyin. Yedek alındı, hiçbir şey silinmedi."); return; }
  var ozet = [];
  try {
    TEMIZLENECEK_SAYFALAR.forEach(function (ad) {
      var s = ss.getSheetByName(ad);
      if (!s || s.getLastRow() < 2) return;
      var n = s.getLastRow() - 1;
      s.getRange(2, 1, n, Math.max(1, s.getLastColumn())).clearContent();
      ozet.push("  • " + ad + ": " + n + " satır");
    });
  } finally {
    kilit.releaseLock();
  }
  ui.alert("🧹 Silindi", (ozet.length ? "Boşaltılan sayfalar:\n" + ozet.join("\n") : "Silinecek kayıt yoktu.") +
    "\n\nYedek kopya: " + yedek.getName() + "\n" + yedek.getUrl() +
    "\n\nTelefonda (ve tahtada) bir kez \"Bu Telefondan Çık\" deyip yeniden giriş yapın; eski listeler silinsin.", ui.ButtonSet.OK);
}

// ============== İSTEKLER ==============
/** Tarayıcıdan adres açılırsa yalnızca servisin çalıştığını söyler; veri döndürmez. */
function doGet() {
  return ContentService.createTextOutput("FatihHoca | UltraMat takip servisi çalışıyor (sürüm " + TAKIP_SURUM + ").");
}

function doPost(e) {
  var istek;
  try {
    istek = JSON.parse((e && e.postData && e.postData.contents) || "{}");
  } catch (err) {
    return json({ ok: false, kod: "istek", mesaj: "İstek okunamadı." });
  }
  var kayitli = ogretmenAnahtariniOku();
  if (!kayitli) return json({ ok: false, kod: "anahtar_yok", mesaj: "Takip anahtarı henüz belirlenmemiş. Tablodaki menüden belirleyin." });
  if (!sabitZamanliEsit(String(istek.anahtar || ""), kayitli)) return json({ ok: false, kod: "anahtar", mesaj: "Anahtar kabul edilmedi." });

  try {
    if (istek.islem === "baslangic") return json(baslangicVerisiOlustur());
    if (istek.islem === "odevler") return json(odevleriOku(String(istek.classId || "").trim()));
    if (istek.islem === "dersGozlemleri") return json(dersGozlemleriniOku(String(istek.classId || "").trim()));
    if (istek.islem === "kaydet") return json(topluKaydet(istek.islemler));
    return json({ ok: false, kod: "islem", mesaj: "Bilinmeyen istek." });
  } catch (err) {
    Logger.log("takip doPost HATASI: " + err + (err && err.stack ? " | " + err.stack : ""));
    return json({ ok: false, kod: "sunucu", mesaj: String(err && err.message ? err.message : "Sunucuda beklenmeyen bir hata oldu.") });
  }
}

/** Telefondaki bekleyen kayıtları işler. Her işleyici tekrar gelen aynı kaydı zararsız işler
 * (bağlantı koptu, yeniden gönderildi → kayıt çoğalmaz). */
var KAYIT_ISLEYICILERI = {
  odevOlustur: odevOlustur,
  odevGuncelle: odevGuncelle,
  odevKontrol: odevKontrol,
  veliBilgi: veliBilgi,
  dersGozlem: dersGozlem,
  gozlemIptal: gozlemIptal
};

function topluKaydet(islemler) {
  if (!Array.isArray(islemler) || !islemler.length) return { ok: true, sonuclar: [] };
  if (islemler.length > TOPLU_KAYIT_SINIRI) islemler = islemler.slice(0, TOPLU_KAYIT_SINIRI);
  var kilit = LockService.getDocumentLock();
  if (!kilit.tryLock(20000)) return { ok: false, kod: "mesgul", mesaj: "Sunucu meşgul, birazdan tekrar denenecek." };
  try {
    var sonuclar = islemler.map(function (i) {
      var id = String(i && i.id || "");
      var isleyici = i && KAYIT_ISLEYICILERI[i.tur];
      if (!id) return { id: id, ok: false, kalici: true, hata: "Kayıt kimliği yok." };
      if (!isleyici) return { id: id, ok: false, kalici: true, hata: "Bu kayıt türü sunucuda tanımlı değil (" + (i && i.tur) + ")." };
      try { isleyici(i); return { id: id, ok: true }; }
      catch (err) { return { id: id, ok: false, kalici: !!(err && err.kalici), hata: String(err && err.message ? err.message : err) }; }
    });
    SpreadsheetApp.flush();
    return { ok: true, sonuclar: sonuclar };
  } finally {
    kilit.releaseLock();
  }
}

// ============== ÖDEVLER (Aşama 1) ==============
// Odevler:      Ödev ID | Eğitim Yılı | Dönem | Sınıf ID | Sınıf | Şube | Tarih | Konu | Ödev Adı | Açıklama | Oluşturma | İptal
// Odev_Kontrol: Ödev ID | Kod | Ad Soyad | Durum | Son Değişiklik
// Durum sütununa okunur metin yazılır (Tam / Eksik / Yapılmadı / Mazeretli). Boş = kontrol edilmedi.
// Ödev satırı hiç silinmez; iptalde "İptal" sütununa tarih yazılır.
var DURUM_ADLARI = { T: "Tam", E: "Eksik", Y: "Yapılmadı", M: "Mazeretli" };
// 0.7: İÇERİK = ödevde seçilen içerik maddeleri (Mufredat "İçerik" sütunundan, "; " ile). Eski tabloda sütun yoksa sayfaAl ekler.
var OD = { ID: 0, YIL: 1, DONEM: 2, SINIF_ID: 3, SINIF: 4, SUBE: 5, TARIH: 6, KONU: 7, AD: 8, ACIKLAMA: 9, OLUSTURMA: 10, IPTAL: 11, ICERIK: 12, GENISLIK: 13 };

function odevOlustur(kayit) {
  var v = kayit.veri || {};
  var odevId = String(v.odevId || "").trim();
  var classId = String(v.classId || "").trim();
  var ad = metinKirp(v.ad, 80);
  if (!odevId) throw kaliciHata("Ödev kimliği yok.");
  if (!classId) throw kaliciHata("Ödevin sınıfı yok.");
  if (!ad) throw kaliciHata("Ödev adı boş.");
  var s = sayfaAl("Odevler");
  if (satirBul(s, OD.ID, odevId) !== -1) return;          // daha önce işlenmiş
  var ayar = ayarlariOku();
  var tarih = tarihMetni(v.tarih) || Utilities.formatDate(new Date(), SAAT_DILIMI, "yyyy-MM-dd");
  var parca = classId.split("-");
  var satir = [];
  satir[OD.ID] = odevId;
  satir[OD.YIL] = ayar.egitimYili;
  satir[OD.DONEM] = donemBul(ayar.donemler, tarih).ad;
  satir[OD.SINIF_ID] = classId;
  satir[OD.SINIF] = parca[0];
  satir[OD.SUBE] = parca[1] || "";
  satir[OD.TARIH] = tarih;
  satir[OD.KONU] = metinKirp(v.konu, 120);
  satir[OD.AD] = ad;
  satir[OD.ACIKLAMA] = metinKirp(v.aciklama, 500);
  satir[OD.OLUSTURMA] = new Date();
  satir[OD.IPTAL] = "";
  satir[OD.ICERIK] = metinKirp(v.icerik, 600);
  s.getRange(s.getLastRow() + 1, 1, 1, OD.GENISLIK).setValues([satir]);
}

/** Ödevin adı/konusu/tarihi/açıklaması değişir ya da ödev iptal edilir. Eski değerler Degisiklikler'e yazılır. */
function odevGuncelle(kayit) {
  var v = kayit.veri || {};
  var s = sayfaAl("Odevler");
  var r = satirBul(s, OD.ID, String(v.odevId || "").trim());
  if (r === -1) throw kaliciHata("Güncellenecek ödev tabloda bulunamadı.");
  var satir = s.getRange(r, 1, 1, OD.GENISLIK).getValues()[0];
  var kayitAdi = String(satir[OD.AD] || satir[OD.ID]) + " (" + satir[OD.SINIF_ID] + ")";
  var degisenler = [];
  function alan(sutun, alanAdi, yeni) {
    var eski = sutun === OD.TARIH ? tarihMetni(satir[sutun]) : String(satir[sutun] === null ? "" : satir[sutun]);
    if (eski === String(yeni).replace(/^'/, "")) return;
    satir[sutun] = yeni;
    degisenler.push([new Date(), "Odevler", kayitAdi, alanAdi, eski, String(yeni).replace(/^'/, "")]);
  }
  if (v.ad !== undefined) {
    var ad = metinKirp(v.ad, 80);
    if (!ad) throw kaliciHata("Ödev adı boş olamaz.");
    alan(OD.AD, "Ödev Adı", ad);
  }
  if (v.konu !== undefined) alan(OD.KONU, "Konu", metinKirp(v.konu, 120));
  if (v.icerik !== undefined) alan(OD.ICERIK, "İçerik", metinKirp(v.icerik, 600));
  if (v.aciklama !== undefined) alan(OD.ACIKLAMA, "Açıklama", metinKirp(v.aciklama, 500));
  if (v.tarih !== undefined) {
    var t = tarihMetni(v.tarih);
    if (t) { alan(OD.TARIH, "Tarih", t); satir[OD.DONEM] = donemBul(ayarlariOku().donemler, t).ad; }
  }
  if (v.iptal === true && !satir[OD.IPTAL]) {
    satir[OD.IPTAL] = new Date();
    degisenler.push([new Date(), "Odevler", kayitAdi, "İptal", "", "iptal edildi"]);
  }
  if (!degisenler.length) return;
  s.getRange(r, 1, 1, OD.GENISLIK).setValues([satir]);
  degisiklikleriYaz(degisenler);
}

/** Bir ödevin kontrolü: telefon yalnızca değişen öğrencileri gönderir ({kod, ad, d}; d boş = işaret kaldırıldı).
 * Aynı öğrenci için satır varsa güncellenir, yoksa eklenir. Kayıtlı bir durum değişirse eskisi Degisiklikler'e yazılır. */
function odevKontrol(kayit) {
  var v = kayit.veri || {};
  var odevId = String(v.odevId || "").trim();
  var os = sayfaAl("Odevler");
  var or = satirBul(os, OD.ID, odevId);
  if (or === -1) throw kaliciHata("Kontrolü kaydedilecek ödev tabloda bulunamadı.");
  var odevSatiri = os.getRange(or, 1, 1, OD.GENISLIK).getValues()[0];
  var odevAdi = String(odevSatiri[OD.AD] || odevId);

  // Aynı öğrenci listede iki kez geldiyse sonuncusu geçerli
  var gelen = {};
  (Array.isArray(v.durumlar) ? v.durumlar : []).forEach(function (x) {
    var kod = kodMetni(x && x.kod);
    var d = String(x && x.d || "");
    if (!kod || (d && !DURUM_ADLARI[d])) return;
    gelen[kod] = { d: d, ad: metinKirp(x.ad, 80) };
  });

  var s = sayfaAl("Odev_Kontrol");
  var son = s.getLastRow();
  var veri = son > 1 ? s.getRange(2, 1, son - 1, 5).getValues() : [];
  var mevcut = {};
  veri.forEach(function (r, i) { if (String(r[0]) === odevId) mevcut[kodMetni(r[1])] = i; });

  var simdi = new Date(), eklenecek = [], degisenler = [];
  Object.keys(gelen).forEach(function (kod) {
    var g = gelen[kod], yeni = g.d ? DURUM_ADLARI[g.d] : "";
    if (mevcut[kod] !== undefined) {
      var i = mevcut[kod], eski = String(veri[i][3] || "");
      if (eski === yeni) return;
      s.getRange(i + 2, 4, 1, 2).setValues([[yeni, simdi]]);
      if (eski) degisenler.push([simdi, "Odev_Kontrol", odevAdi + " · " + (veri[i][2] || g.ad || kod), "Durum", eski, yeni || "(işaret kaldırıldı)"]);
    } else if (yeni) {
      eklenecek.push([odevId, kod, g.ad, yeni, simdi]);
    }
  });
  if (eklenecek.length) s.getRange(s.getLastRow() + 1, 1, eklenecek.length, 5).setValues(eklenecek);
  if (degisenler.length) degisiklikleriYaz(degisenler);
  if (v.gozlem) odevGozlemleriniYaz(odevSatiri, v.gozlem);
}

// Gozlemler: Gözlem ID | Zaman | Tarih | Eğitim Yılı | Dönem | Kod | Ad Soyad | Sınıf ID | Bağlam | Ödev ID | Kategori | Etiket | Konu | Alt Konu | Bağlantı ID | İptal
var GZ = { ID: 0, ZAMAN: 1, TARIH: 2, YIL: 3, DONEM: 4, KOD: 5, AD: 6, SINIF_ID: 7, BAGLAM: 8, ODEV_ID: 9, KATEGORI: 10, ETIKET: 11, KONU: 12, ALT_KONU: 13, BAGLANTI: 14, IPTAL: 15, GENISLIK: 16 };
var GOZLEM_KATEGORILERI = { olumlu: 1, gelistir: 1, gelisim: 1 };

/** Ödev kontrolüyle gelen gözlemler: { ekle: [{id, kod, ad, kategori, etiket, baglantiId}], iptal: [gözlem id] }.
 * Eklenen gözlem ödevin tarihi/dönemi/konusuyla yazılır. Kaldırılan gözlem silinmez; "İptal" sütununa tarih yazılır.
 * "Düzeldi" kaydı ayrı bir satırdır (kategori gelisim) ve Bağlantı ID ile eski gözleme bağlanır; eski satır değişmez. */
function odevGozlemleriniYaz(odevSatiri, gozlem) {
  var s = sayfaAl("Gozlemler");
  var son = s.getLastRow();
  var idler = {};
  if (son > 1) s.getRange(2, 1, son - 1, 1).getValues().forEach(function (r, i) { if (r[0]) idler[String(r[0])] = i + 2; });
  var simdi = new Date(), eklenecek = [];
  var tarih = tarihMetni(odevSatiri[OD.TARIH]);
  (Array.isArray(gozlem.ekle) ? gozlem.ekle : []).forEach(function (g) {
    var id = String(g && g.id || "").trim();
    var kod = kodMetni(g && g.kod);
    var kategori = String(g && g.kategori || "");
    if (!id || !kod || !GOZLEM_KATEGORILERI[kategori] || idler[id]) return;   // eksik ya da daha önce yazılmış
    var satir = [];
    satir[GZ.ID] = id;
    satir[GZ.ZAMAN] = simdi;
    satir[GZ.TARIH] = tarih;
    satir[GZ.YIL] = odevSatiri[OD.YIL];
    satir[GZ.DONEM] = odevSatiri[OD.DONEM];
    satir[GZ.KOD] = kod;
    satir[GZ.AD] = metinKirp(g.ad, 80);
    satir[GZ.SINIF_ID] = odevSatiri[OD.SINIF_ID];
    satir[GZ.BAGLAM] = "odev";
    satir[GZ.ODEV_ID] = odevSatiri[OD.ID];
    satir[GZ.KATEGORI] = kategori;
    satir[GZ.ETIKET] = metinKirp(g.etiket, 40);
    satir[GZ.KONU] = odevSatiri[OD.KONU];
    satir[GZ.ALT_KONU] = odevSatiri[OD.ICERIK] || "";   // 0.7: tabloda okurken kolaylık; uygulama ödevden okur
    satir[GZ.BAGLANTI] = metinKirp(g.baglantiId, 60);
    satir[GZ.IPTAL] = "";
    eklenecek.push(satir);
    idler[id] = -1;
  });
  if (eklenecek.length) s.getRange(s.getLastRow() + 1, 1, eklenecek.length, GZ.GENISLIK).setValues(eklenecek);
  (Array.isArray(gozlem.iptal) ? gozlem.iptal : []).forEach(function (id) {
    var r = idler[String(id || "")];
    if (!r || r < 2) return;
    var h = s.getRange(r, GZ.IPTAL + 1);
    if (!h.getValue()) h.setValue(simdi);
  });
}

// Veli_Bilgi: Kayıt ID | Kod | Ad Soyad | Sınıf ID | Eğitim Yılı | Dönem | Blok No | Ödev ID'leri | Mesaj | Zaman
/** "Gönderdim" denen veli mesajı: kim, hangi dönemin kaçıncı 4'lü bloğu, hangi ödevler ve giden metin. */
function veliBilgi(kayit) {
  var v = kayit.veri || {};
  var id = String(v.kayitId || kayit.id || "").trim();
  var kod = kodMetni(v.kod);
  var classId = String(v.classId || "").trim();
  var blokNo = parseInt(v.blokNo, 10);
  if (!id || !kod || !classId || !(blokNo > 0)) throw kaliciHata("Veli kaydı eksik bilgi içeriyor.");
  var s = sayfaAl("Veli_Bilgi");
  if (satirBul(s, 0, id) !== -1) return;
  var ayar = ayarlariOku();
  var donemNo = parseInt(v.donemNo, 10) || 0;
  s.getRange(s.getLastRow() + 1, 1, 1, 10).setValues([[
    id, kod, metinKirp(v.ad, 80), classId, ayar.egitimYili, donemNo ? donemNo + ". Dönem" : "",
    blokNo, (Array.isArray(v.odevIdler) ? v.odevIdler : []).join(", "), String(v.mesaj || "").slice(0, 4000), new Date()
  ]]);
}

/** Bir sınıfın bu eğitim yılındaki ödevleri (iptaller dahil, işaretli) ve kontrol durumları. */
function odevleriOku(classId) {
  if (!classId) return { ok: false, kod: "istek", mesaj: "Sınıf belirtilmedi." };
  var ayar = ayarlariOku();
  var s = sayfaAl("Odevler");
  var son = s.getLastRow();
  var odevler = [], idler = {};
  if (son > 1) {
    s.getRange(2, 1, son - 1, OD.GENISLIK).getValues().forEach(function (r) {
      var id = String(r[OD.ID] || "");
      if (!id || String(r[OD.SINIF_ID]) !== classId) return;
      if (ayar.egitimYili && String(r[OD.YIL]) !== ayar.egitimYili) return;
      idler[id] = true;
      odevler.push({
        id: id,
        donemNo: parseInt(String(r[OD.DONEM]), 10) || 0,
        tarih: tarihMetni(r[OD.TARIH]),
        konu: String(r[OD.KONU] || ""),
        icerik: String(r[OD.ICERIK] || ""),
        ad: String(r[OD.AD] || ""),
        aciklama: String(r[OD.ACIKLAMA] || ""),
        iptal: !!r[OD.IPTAL],
        olusturma: r[OD.OLUSTURMA] instanceof Date ? r[OD.OLUSTURMA].getTime() : 0
      });
    });
  }
  var kontrol = {};
  var ks = sayfaAl("Odev_Kontrol");
  var kson = ks.getLastRow();
  if (kson > 1) {
    ks.getRange(2, 1, kson - 1, 4).getValues().forEach(function (r) {
      var id = String(r[0] || "");
      if (!idler[id]) return;
      var d = durumKodu(r[3]);
      if (!d) return;
      (kontrol[id] = kontrol[id] || {})[kodMetni(r[1])] = d;
    });
  }
  var gozlemler = [];
  var gs = sayfaAl("Gozlemler");
  var gson = gs.getLastRow();
  if (gson > 1) {
    gs.getRange(2, 1, gson - 1, GZ.GENISLIK).getValues().forEach(function (r) {
      if (!r[GZ.ID] || r[GZ.IPTAL] || String(r[GZ.SINIF_ID]) !== classId || String(r[GZ.BAGLAM]) !== "odev") return;
      if (ayar.egitimYili && String(r[GZ.YIL]) !== ayar.egitimYili) return;
      gozlemler.push({
        id: String(r[GZ.ID]), kod: kodMetni(r[GZ.KOD]), odevId: String(r[GZ.ODEV_ID] || ""),
        kategori: String(r[GZ.KATEGORI] || ""), etiket: String(r[GZ.ETIKET] || ""), baglantiId: String(r[GZ.BAGLANTI] || "")
      });
    });
  }
  var veli = [];
  var vs = sayfaAl("Veli_Bilgi");
  var vson = vs.getLastRow();
  if (vson > 1) {
    vs.getRange(2, 1, vson - 1, 10).getValues().forEach(function (r) {
      if (!r[0] || String(r[3]) !== classId) return;
      if (ayar.egitimYili && String(r[4]) !== ayar.egitimYili) return;
      veli.push({ kod: kodMetni(r[1]), donemNo: parseInt(String(r[5]), 10) || 0, blokNo: parseInt(r[6], 10) || 0,
        zaman: r[9] instanceof Date ? r[9].getTime() : 0 });
    });
  }
  odevler.sort(function (a, b) { return a.tarih < b.tarih ? 1 : a.tarih > b.tarih ? -1 : 0; });
  return { ok: true, classId: classId, egitimYili: ayar.egitimYili, odevler: odevler, kontrol: kontrol, gozlemler: gozlemler, veli: veli };
}

function durumKodu(metin) {
  var k = katla(metin);
  if (!k) return "";
  for (var d in DURUM_ADLARI) if (katla(DURUM_ADLARI[d]) === k || k === d.toLowerCase()) return d;
  return "";
}

function degisiklikleriYaz(satirlar) {
  var s = sayfaAl("Degisiklikler");
  s.getRange(s.getLastRow() + 1, 1, satirlar.length, 6).setValues(satirlar);
}

/** Sayfa yoksa başlıklarıyla oluşturur (kurulum atlanmışsa da kayıt kaybolmasın). */
function sayfaAl(ad) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var s = ss.getSheetByName(ad);
  if (!s) {
    s = ss.insertSheet(ad);
    var b = SAYFA_BASLIKLARI[ad];
    s.getRange(1, 1, 1, b.length).setValues([b]).setFontWeight("bold").setBackground("#FFF7ED");
    s.setFrozenRows(1);
  } else {
    // 0.7: sonradan eklenen sütunların başlığı eski tabloda yoksa yazılır (eski satırlar boş kalır)
    var b2 = SAYFA_BASLIKLARI[ad];
    if (b2) {
      if (s.getMaxColumns() < b2.length) s.insertColumnsAfter(s.getMaxColumns(), b2.length - s.getMaxColumns());
      var ilk = s.getRange(1, 1, 1, b2.length).getValues()[0];
      for (var i = 0; i < b2.length; i++) {
        if (String(ilk[i] || "").trim() === "") s.getRange(1, i + 1).setValue(b2[i]).setFontWeight("bold").setBackground("#FFF7ED");
      }
    }
  }
  return s;
}

/** Sütunda (0 tabanlı) değeri arar; bulursa satır numarasını (1 tabanlı), yoksa -1 döner. */
function satirBul(sayfa, sutun, deger) {
  if (!deger) return -1;
  var son = sayfa.getLastRow();
  if (son < 2) return -1;
  var d = sayfa.getRange(2, sutun + 1, son - 1, 1).getValues();
  for (var i = 0; i < d.length; i++) if (String(d[i][0]) === deger) return i + 2;
  return -1;
}

/** Metni kırpar; = + - @ ile başlıyorsa tabloda formül sanılmasın diye başına ' koyar. */
function metinKirp(x, enFazla) {
  var m = String(x === null || x === undefined ? "" : x).replace(/\s+/g, " ").trim().slice(0, enFazla);
  return /^[=+\-@]/.test(m) ? "'" + m : m;
}

function kaliciHata(mesaj) { var e = new Error(mesaj); e.kalici = true; return e; }

// ============== DERS İÇİ GÖZLEM (Aşama 3) ==============
/** Derste bir an: { classId, tarih, zaman, konu, altKonu, kayitlar: [{id, kod, ad, kategori, etiket, baglantiId}] }.
 * Her öğrenci ayrı satır olur (Bağlam "ders"). Konu yalnızca konuya bağlanan etiketlerde (telefon gönderir) yazılır.
 * "Düzeldi" ayrı satırdır (kategori gelisim, etiket DUZELDI) ve Bağlantı ID ile eski gözleme bağlanır. */
function dersGozlem(kayit) {
  var v = kayit.veri || {};
  var classId = String(v.classId || "").trim();
  if (!classId) throw kaliciHata("Gözlemin sınıfı yok.");
  var ayar = ayarlariOku();
  var tarih = tarihMetni(v.tarih) || Utilities.formatDate(new Date(), SAAT_DILIMI, "yyyy-MM-dd");
  var zaman = v.zaman ? new Date(Number(v.zaman)) : new Date();
  if (isNaN(zaman)) zaman = new Date();
  var donem = donemBul(ayar.donemler, tarih).ad;
  var s = sayfaAl("Gozlemler");
  var son = s.getLastRow();
  var idler = {};
  if (son > 1) s.getRange(2, 1, son - 1, 1).getValues().forEach(function (r) { if (r[0]) idler[String(r[0])] = true; });
  var eklenecek = [];
  (Array.isArray(v.kayitlar) ? v.kayitlar : []).forEach(function (g) {
    var id = String(g && g.id || "").trim();
    var kod = kodMetni(g && g.kod);
    var kategori = String(g && g.kategori || "");
    if (!id || !kod || idler[id] || !DERS_KATEGORILERI[kategori]) return;
    var satir = [];
    satir[GZ.ID] = id;
    satir[GZ.ZAMAN] = zaman;
    satir[GZ.TARIH] = tarih;
    satir[GZ.YIL] = ayar.egitimYili;
    satir[GZ.DONEM] = donem;
    satir[GZ.KOD] = kod;
    satir[GZ.AD] = metinKirp(g.ad, 80);
    satir[GZ.SINIF_ID] = classId;
    satir[GZ.BAGLAM] = "ders";
    satir[GZ.ODEV_ID] = "";
    satir[GZ.KATEGORI] = kategori;
    satir[GZ.ETIKET] = metinKirp(g.etiket, 40);
    satir[GZ.KONU] = g.konuyaBagli ? metinKirp(v.konu, 120) : "";
    satir[GZ.ALT_KONU] = g.konuyaBagli ? metinKirp(v.altKonu, 600) : "";   // 0.7: seçilen içerik maddeleri
    satir[GZ.BAGLANTI] = metinKirp(g.baglantiId, 60);
    satir[GZ.IPTAL] = "";
    eklenecek.push(satir);
    idler[id] = true;
  });
  if (eklenecek.length) s.getRange(s.getLastRow() + 1, 1, eklenecek.length, GZ.GENISLIK).setValues(eklenecek);
}
var DERS_KATEGORILERI = { olumlu: 1, dikkat: 1, akademik: 1, gelisim: 1 };

/** "Geri al": gözlem silinmez, "İptal" sütununa tarih yazılır. { idler: [...] } */
function gozlemIptal(kayit) {
  var v = kayit.veri || {};
  var istenen = {};
  (Array.isArray(v.idler) ? v.idler : []).forEach(function (id) { if (id) istenen[String(id)] = true; });
  var s = sayfaAl("Gozlemler");
  var son = s.getLastRow();
  if (son < 2) return;
  var simdi = new Date();
  var d = s.getRange(2, 1, son - 1, GZ.GENISLIK).getValues();
  d.forEach(function (r, i) {
    if (istenen[String(r[GZ.ID])] && !r[GZ.IPTAL]) s.getRange(i + 2, GZ.IPTAL + 1).setValue(simdi);
  });
}

function dersGozlemleriniOku(classId) {
  if (!classId) return { ok: false, kod: "istek", mesaj: "Sınıf belirtilmedi." };
  var ayar = ayarlariOku();
  var s = sayfaAl("Gozlemler");
  var son = s.getLastRow();
  var liste = [];
  if (son > 1) {
    s.getRange(2, 1, son - 1, GZ.GENISLIK).getValues().forEach(function (r) {
      if (!r[GZ.ID] || r[GZ.IPTAL] || String(r[GZ.SINIF_ID]) !== classId || String(r[GZ.BAGLAM]) !== "ders") return;
      if (ayar.egitimYili && String(r[GZ.YIL]) !== ayar.egitimYili) return;
      liste.push({
        id: String(r[GZ.ID]), kod: kodMetni(r[GZ.KOD]), kategori: String(r[GZ.KATEGORI] || ""), etiket: String(r[GZ.ETIKET] || ""),
        tarih: tarihMetni(r[GZ.TARIH]), zaman: r[GZ.ZAMAN] instanceof Date ? r[GZ.ZAMAN].getTime() : 0,
        konu: String(r[GZ.KONU] || ""), altKonu: String(r[GZ.ALT_KONU] || ""), baglantiId: String(r[GZ.BAGLANTI] || "")
      });
    });
  }
  return { ok: true, classId: classId, gozlemler: liste };
}

// ============== YARDIMCILAR ==============
function json(nesne) {
  return ContentService.createTextOutput(JSON.stringify(nesne)).setMimeType(ContentService.MimeType.JSON);
}

function ogretmenAnahtariniOku() {
  var a = PropertiesService.getScriptProperties().getProperty(ANAHTAR_OZELLIGI);
  a = a ? String(a).trim() : "";
  return a.length >= ANAHTAR_MIN_UZUNLUK ? a : "";
}

/** İki metni ilk farklı karakterde durmadan (sabit sürede) karşılaştırır. */
function sabitZamanliEsit(a, b) {
  var fark = a.length ^ b.length;
  var n = Math.max(a.length, b.length);
  for (var i = 0; i < n; i++) fark |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return fark === 0 && a.length > 0;
}

function rastgeleAnahtarUret(uzunluk) {
  var harfler = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  var s = "";
  var bayt = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Utilities.getUuid() + Date.now());
  for (var i = 0; i < uzunluk; i++) s += harfler.charAt(((bayt[i % bayt.length] + 256) % 256 + i * 7) % harfler.length);
  return s;
}

/** Başlıkları karşılaştırmak için: küçük harf, Türkçe karakter sadeleştirme, fazla boşluk yok. */
function katla(h) {
  return String(h === null || h === undefined ? "" : h).trim().toLocaleLowerCase("tr")
    .replace(/ı/g, "i").replace(/ş/g, "s").replace(/ğ/g, "g").replace(/ç/g, "c").replace(/ö/g, "o").replace(/ü/g, "u")
    .replace(/\s+/g, " ");
}

/** 6418 / 6418.0 / "6418 " → "6418"; 8.0 → "8". */
function kodMetni(x) {
  if (x === null || x === undefined) return "";
  return String(x).trim().replace(/\.0+$/, "");
}

/** Hücredeki tarih (Date ya da "2026-09-01" metni) → "YYYY-AA-GG"; anlaşılamazsa "". */
function tarihMetni(x) {
  if (!x) return "";
  if (Object.prototype.toString.call(x) === "[object Date]" && !isNaN(x)) return Utilities.formatDate(x, SAAT_DILIMI, "yyyy-MM-dd");
  var m = String(x).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + "-" + m[2] + "-" + m[3];
  var t = String(x).trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (t) return t[3] + "-" + ("0" + t[2]).slice(-2) + "-" + ("0" + t[1]).slice(-2);
  return "";
}
