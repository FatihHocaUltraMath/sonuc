/* FatihHoca | UltraMat — Öğrenci Takip · etiket kataloğu (sürüm 0.3 · ders içi gözlem 30 etiket)
 *
 * Kayıtlara etiketin METNİ değil KODU yazılır. Bir etiketin adını ya da emojisini buradan
 * değiştirirseniz eski kayıtlar bozulmaz. Kodları (O_OZEN, D_KONUSMA …) DEĞİŞTİRMEYİN;
 * yeni etiket gerekiyorsa yeni kodla ekleyin, kullanılmayanı "emekli: true" yapın.
 *
 * Kategoriler:
 *   olumlu   → iyi giden durum
 *   dikkat   → dikkat gerektiren davranış (ders içi)
 *   gelistir → ödevde geliştirilmesi gereken yön
 *   akademik → derste fark edilen akademik zorlanma (aktif konuya bağlanır)
 *   gelisim  → önceki bir kayda bağlanan "düzeldi / tamamladı" kaydı
 */
const ETIKETLER = Object.freeze({

  ODEV_DURUMLARI: [
    { kod: "T", emoji: "✅", ad: "Tam" },
    { kod: "E", emoji: "🟡", ad: "Eksik" },
    { kod: "Y", emoji: "❌", ad: "Yapılmadı" },
    { kod: "M", emoji: "⚪", ad: "Mazeretli" }
  ],

  // Ödev satırındaki "+ Gözlem" (isteğe bağlı, birden fazla seçilebilir)
  ODEV_GOZLEM: [
    { kod: "O_OZEN",    kategori: "olumlu",   emoji: "⭐", ad: "Çok özenli" },
    { kod: "O_YAZIM",   kategori: "olumlu",   emoji: "✍️", ad: "Düzenli/güzel yazım" },
    { kod: "O_ISLEM",   kategori: "olumlu",   emoji: "🧮", ad: "İşlemler çok iyi" },
    { kod: "O_COZUM",   kategori: "olumlu",   emoji: "🎯", ad: "Çözümler başarılı" },
    { kod: "O_CABA",    kategori: "olumlu",   emoji: "💪", ad: "Belirgin çaba" },
    { kod: "O_GELISIM", kategori: "olumlu",   emoji: "📈", ad: "Gelişim gösteriyor" },
    { kod: "G_DUZEN",   kategori: "gelistir", emoji: "📝", ad: "Daha düzenli çalışmalı", duzelme: "✓ Daha düzenli" },
    { kod: "G_ISLEM",   kategori: "gelistir", emoji: "🧮", ad: "İşlem hatalarına dikkat", duzelme: "✓ İşlemlerde düzeldi" },
    { kod: "G_KONTROL", kategori: "gelistir", emoji: "🔍", ad: "Çözümlerini kontrol etmeli", duzelme: "✓ Kontrol ediyor" },
    { kod: "G_EKSIK",   kategori: "gelistir", emoji: "📌", ad: "Eksiklerini tamamlamalı", duzelme: "✓ Tamamladı" }
  ],

  // Ders içi gözlem (seçici kayıt: gözlem yok = değerlendirilmedi)
  DERS_GOZLEM: [
    { kod: "D_KATILIM",   kategori: "olumlu",   emoji: "🙋", ad: "Derse aktif katıldı" },
    { kod: "D_FIKIR",     kategori: "olumlu",   emoji: "💡", ad: "Güzel fikir/çözüm sundu", konuyaBaglanir: true },
    { kod: "D_SORU",      kategori: "olumlu",   emoji: "❓", ad: "Nitelikli soru sordu", konuyaBaglanir: true },
    { kod: "D_ODAK",      kategori: "olumlu",   emoji: "🎯", ad: "Derse odaklandı" },
    { kod: "D_CABA",      kategori: "olumlu",   emoji: "💪", ad: "Çaba gösterdi" },
    { kod: "D_GELISIM",   kategori: "olumlu",   emoji: "📈", ad: "Gelişim gösteriyor" },
    { kod: "D_YARDIM",    kategori: "olumlu",   emoji: "🤝", ad: "Arkadaşına yardımcı oldu" },
    { kod: "D_ANLATIM",   kategori: "olumlu",   emoji: "🗣️", ad: "Çözümünü açıkça anlattı", konuyaBaglanir: true },
    { kod: "D_HIZLI",     kategori: "olumlu",   emoji: "⚡", ad: "Soruları hızlı ve doğru çözdü", konuyaBaglanir: true },
    { kod: "D_KAVRADI",   kategori: "olumlu",   emoji: "🏆", ad: "Konuyu çok iyi kavradı", konuyaBaglanir: true },
    { kod: "D_ZIHIN",     kategori: "olumlu",   emoji: "🧮", ad: "Zihinden işlemlerde başarılı" },
    { kod: "D_ISTEKLI",   kategori: "olumlu",   emoji: "😊", ad: "Derse ilgili ve istekli" },
    { kod: "D_DEFTER",    kategori: "olumlu",   emoji: "📐", ad: "Defteri düzenli" },
    { kod: "D_KONUSMA",   kategori: "dikkat",   emoji: "💬", ad: "Ders sırasında konuşuyor", duzelme: "✓ Sonradan düzeldi" },
    { kod: "D_ODAKSIZ",   kategori: "dikkat",   emoji: "👀", ad: "Derse odaklanmıyor", duzelme: "✓ Sonradan düzeldi" },
    { kod: "D_MATERYAL",  kategori: "dikkat",   emoji: "📚", ad: "Ders materyali eksik", duzelme: "✓ Sonradan düzeldi" },
    { kod: "D_KATILMAMA", kategori: "dikkat",   emoji: "✏️", ad: "Çalışmaya katılmıyor", duzelme: "✓ Sonradan düzeldi" },
    { kod: "D_OLUMSUZ",   kategori: "dikkat",   emoji: "⚠️", ad: "Dersi/arkadaşlarını olumsuz etkiliyor", duzelme: "✓ Sonradan düzeldi" },
    { kod: "D_ILGISIZ",   kategori: "dikkat",   emoji: "🔇", ad: "Derse ilgisiz", duzelme: "✓ Sonradan düzeldi" },
    { kod: "D_BOLUYOR",   kategori: "dikkat",   emoji: "📣", ad: "Dersi sık sık bölüyor", duzelme: "✓ Sonradan düzeldi" },
    { kod: "D_UYARI",     kategori: "dikkat",   emoji: "🙈", ad: "Uyarılara rağmen devam ediyor", duzelme: "✓ Sonradan düzeldi" },
    { kod: "D_DEFTERYOK", kategori: "dikkat",   emoji: "📓", ad: "Defter tutmuyor", duzelme: "✓ Sonradan düzeldi" },
    { kod: "A_ZORLANMA",  kategori: "akademik", emoji: "🧩", ad: "Konuda zorlanıyor", konuyaBaglanir: true, duzelme: "✓ Sonraki gözlemde doğru uyguladı" },
    { kod: "A_KAVRAM",    kategori: "akademik", emoji: "🔄", ad: "Kavramı karıştırıyor", konuyaBaglanir: true, duzelme: "✓ Sonraki gözlemde doğru uyguladı" },
    { kod: "A_ISLEM",     kategori: "akademik", emoji: "➗", ad: "İşlem hatası yapıyor", konuyaBaglanir: true, duzelme: "✓ Sonraki gözlemde doğru uyguladı" },
    { kod: "A_PROBLEM",   kategori: "akademik", emoji: "📖", ad: "Problem anlamada zorlanıyor", konuyaBaglanir: true, duzelme: "✓ Sonraki gözlemde doğru uyguladı" },
    { kod: "A_ONBILGI",   kategori: "akademik", emoji: "🧱", ad: "Ön bilgi eksiği var", konuyaBaglanir: true, duzelme: "✓ Sonraki gözlemde doğru uyguladı" },
    { kod: "A_EZBER",     kategori: "akademik", emoji: "💭", ad: "Mantığını kurmadan ezberle çözüyor", konuyaBaglanir: true, duzelme: "✓ Sonraki gözlemde doğru uyguladı" },
    { kod: "A_CARPIM",    kategori: "akademik", emoji: "✖️", ad: "Çarpım tablosunda eksik", duzelme: "✓ Sonraki gözlemde doğru uyguladı" },
    { kod: "A_DORTISLEM", kategori: "akademik", emoji: "🔢", ad: "Dört işlemde zorlanıyor", duzelme: "✓ Sonraki gözlemde doğru uyguladı" }
  ],

  // Önceki bir kayda bağlanan gelişim kaydının kodu (kategori: gelisim)
  DUZELDI_KODU: "DUZELDI",

  KATEGORI_ADLARI: {
    olumlu: "Olumlu",
    dikkat: "Dikkat Gerektiren",
    gelistir: "Geliştirilmeli",
    akademik: "Akademik",
    gelisim: "Sonradan Düzelen"
  }
});

/** Koddan etiket bilgisini bulur (bilinmeyen kod için güvenli bir yedek döner). */
function etiketBul(kod) {
  const hepsi = ETIKETLER.ODEV_GOZLEM.concat(ETIKETLER.DERS_GOZLEM);
  return hepsi.find(e => e.kod === kod) || { kod, kategori: "", emoji: "•", ad: kod };
}
