/* FatihHoca | UltraMat — Öğrenci Takip · etiket kataloğu (sürüm 0.1)
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
    { kod: "D_KONUSMA",   kategori: "dikkat",   emoji: "💬", ad: "Ders sırasında konuşuyor", duzelme: "✓ Sonradan düzeldi" },
    { kod: "D_ODAKSIZ",   kategori: "dikkat",   emoji: "👀", ad: "Derse odaklanmıyor", duzelme: "✓ Sonradan düzeldi" },
    { kod: "D_MATERYAL",  kategori: "dikkat",   emoji: "📚", ad: "Ders materyali eksik", duzelme: "✓ Sonradan düzeldi" },
    { kod: "D_KATILMAMA", kategori: "dikkat",   emoji: "✏️", ad: "Çalışmaya katılmıyor", duzelme: "✓ Sonradan düzeldi" },
    { kod: "D_OLUMSUZ",   kategori: "dikkat",   emoji: "⚠️", ad: "Dersi/arkadaşlarını olumsuz etkiliyor", duzelme: "✓ Sonradan düzeldi" },
    { kod: "A_ZORLANMA",  kategori: "akademik", emoji: "🧩", ad: "Konuda zorlanıyor", konuyaBaglanir: true, duzelme: "✓ Sonraki gözlemde doğru uyguladı" },
    { kod: "A_KAVRAM",    kategori: "akademik", emoji: "🔄", ad: "Kavramı karıştırıyor", konuyaBaglanir: true, duzelme: "✓ Sonraki gözlemde doğru uyguladı" },
    { kod: "A_ISLEM",     kategori: "akademik", emoji: "➗", ad: "İşlem hatası yapıyor", konuyaBaglanir: true, duzelme: "✓ Sonraki gözlemde doğru uyguladı" },
    { kod: "A_PROBLEM",   kategori: "akademik", emoji: "📖", ad: "Problem anlamada zorlanıyor", konuyaBaglanir: true, duzelme: "✓ Sonraki gözlemde doğru uyguladı" }
  ],

  // Önceki bir kayda bağlanan gelişim kaydının kodu (kategori: gelisim)
  DUZELDI_KODU: "DUZELDI",

  KATEGORI_ADLARI: {
    olumlu: "Olumlu",
    dikkat: "Dikkat gerektiren",
    gelistir: "Geliştirilmeli",
    akademik: "Akademik",
    gelisim: "Sonradan düzelen"
  }
});

/** Koddan etiket bilgisini bulur (bilinmeyen kod için güvenli bir yedek döner). */
function etiketBul(kod) {
  const hepsi = ETIKETLER.ODEV_GOZLEM.concat(ETIKETLER.DERS_GOZLEM);
  return hepsi.find(e => e.kod === kod) || { kod, kategori: "", emoji: "•", ad: kod };
}
