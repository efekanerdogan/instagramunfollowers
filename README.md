# 🦊 Unfollowers v2: Instagram Analiz ve Takipten Çıkarma Aracı

![Durum](https://img.shields.io/badge/durum-aktif-brightgreen)
![Sürüm](https://img.shields.io/badge/s%C3%BCr%C3%BCm-2.0.0-orange)
![Lisans](https://img.shields.io/badge/lisans-MIT-blue)

Instagram'da seni geri takip etmeyenleri bulan, beyaz liste ve otomatik molalı hız modlarıyla güvenle takipten çıkarmanı sağlayan, tamamen tarayıcıda çalışan açık kaynak bir araç.

**Canlı site:** [efekanerdogan.github.io/instagramunfollowers](https://efekanerdogan.github.io/instagramunfollowers/). Kurmadan önce sayfadaki **Demoyu dene** butonuyla sahte verilerle deneyebilirsin.

---

## 🌱 v2'deki Yenilikler

| | Özellik | Açıklama |
|---|---|---|
| 💎 | **Beyaz liste** | Yıldızladığın hesaplar asla seçilmez ve listeden gizlenir. JSON olarak dışa/içe aktarılabilir. |
| 🫖 | **Otomatik molalar** | Hızlı ve Güvenli modlar belirli aralıklarla mola verir. Instagram yavaşlatırsa (429 / action block) araç bekleyip kaldığı yerden devam eder; üst üste olursa durur. |
| 🔀 | **Yedek tarama yöntemi** | GraphQL yöntemi çalışmazsa takipçi ve takip listelerini REST API ile karşılaştıran alternatif yönteme otomatik geçer. |
| 🧮 | **Gerçek ilerleme** | Takip sayısına göre yüzde ilerleme, durdurulabilir tarama. |
| 🗃️ | **Geçmiş** | Takipten çıkardığın hesaplar tarih bilgisiyle saklanır (son 1000). |
| 🧾 | **CSV dışa aktarma** | Listeyi Excel uyumlu CSV olarak indir veya kullanıcı adlarını kopyala. |
| 🗄️ | **Kayıtlı tarama** | Paneli kapatıp açınca son tarama geri gelir; yeniden taramak zorunda kalmazsın. |
| 🧭 | **Sıralama ve toplu seçim** | A→Z, Z→A, onaylılar/gizliler önce sıralama; **Shift + tık** ile aralık seçimi. |
| 🤳 | **Mobil uyum** | Telefonda panel tam ekran açılır; sitede mobil kurulum adımları var. |
| 🔻 | **Küçült** | İşlem sürerken paneli köşedeki ilerleme balonuna küçültebilirsin. |
| 🎭 | **Demo modu** | Sitede ağ isteği yapmadan, sahte verilerle paneli deneyebilirsin. |

### Düzeltilen hatalar
- **Güvenlik:** Kullanıcı adı ve isimler HTML olarak basılıyordu. Kötü niyetli bir "isim" instagram.com üzerinde kod çalıştırabilirdi (XSS). Artık tüm veriler kaçışlanıyor.
- İşlem bitince **Durdur** butonu eski haline dönmüyor, sonraki işlemleri bozuyordu.
- Tarama ilerleme çubuğu hep %50'de kalıyordu.
- Panel stilleri `:root` değişkenleriyle Instagram'ın sayfasına sızıyordu. Artık tamamen `#ee-root` altında izole.
- README'deki hız değerleri koddakilerle uyuşmuyordu.
- Yer imi kodundaki yorum temizleme regex'i kırılgandı. Artık build adımında `terser` ile güvenle küçültülüyor.

---

## 🖲️ Kullanım

### Yer imi (önerilen)
1. Sitedeki **🦊 Unfollowers** butonunu yer imleri çubuğuna sürükle (çubuk yoksa `Ctrl/⌘ + Shift + B`).
2. **instagram.com**'a gir ve oturum aç.
3. Yer imine tıkla, **Analizi başlat**'a bas.
4. Listeden seç, hız modunu belirle, **Takipten çık**'a bas.

### Konsol
Sitede **Konsol kodunu kopyala**'ya bas → Instagram'da `F12` → Console → yapıştır → `Enter`.

### Mobil (Chrome / Safari)
1. Sitede **Yer imi bağlantısını kopyala**'ya bas.
2. Herhangi bir sayfayı yer imlerine ekle, adını `unf` yap, adresini kopyaladığın metinle değiştir.
3. Tarayıcıda instagram.com'u aç, adres çubuğuna `unf` yaz ve önerilen yer imine dokun.

---

## 🐆 Hız Modları

| Mod | Kişi başı bekleme | Mola | Ne zaman? |
|---|---|---|---|
| 🐆 Turbo | 120–260 ms | yok | Birkaç düzine kişi |
| 🐇 Hızlı *(varsayılan)* | 0,4–0,8 sn | her 40 kişide 30 sn | Çoğu kullanıcı |
| 🐢 Güvenli | 1,2–2,5 sn | her 15 kişide 90 sn | Yüzlerce kişilik temizlik |

---

## 🔩 Geliştirme

```
tool.js      → Instagram'da açılan panelin kaynak kodu (asıl düzenlenecek dosya)
index.html   → Tanıtım sayfası; tool.js build sırasında buraya gömülür
build.mjs    → tool.js'i index.html'e gömer ve yer imi için küçültülmüş sürüm üretir
```

```bash
npm install
npm run build
```

`tool.js`'i değiştirdikten sonra `npm run build` çalıştır. `index.html` içindeki `TOOL:START` / `TOOL:END` arasını elle düzenleme. Panel arayüzünü Instagram'a girmeden test etmek için siteyi yerelde açıp **Demoyu dene**'ye basabilirsin:

```bash
python -m http.server 8000
```

---

## 🚧 Yasal Uyarı

Bu proje yalnızca **eğitim ve kişisel kullanım** amaçlıdır.

* Instagram (Meta) ile hiçbir bağlantısı yoktur.
* Kullanımdan doğabilecek hesap kısıtlamalarından (action block) veya kapatılmalarından geliştirici sorumlu tutulamaz.
* Kısa sürede yüzlerce kişiyi takipten çıkmak Instagram'ın dikkatini çekebilir. Büyük temizlikler için **Güvenli** modu kullan ve işlemi birkaç güne böl.

---

## 🧾 Lisans

**MIT Lisansı.** Detaylar için [LICENSE](LICENSE) dosyasına bakabilirsin.
