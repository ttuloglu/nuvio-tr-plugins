# Nuvio TR Pro Eklenti Deposu (Repository)

Nuvio TV (`com.nuvio.tv`) Android TV uygulaması için yerli ve yabancı film & dizi kaynak eklenti deposudur. Harici eklenti sunucusuna (addon server/PC) ihtiyaç duymadan, doğrudan televizyon üzerinde QuickJS motorunda çalışır.

## Kaynaklar (Scrapers)
1. **Film Makinesi** (`providers/filmmakinesi.js`): Popüler film ve diziler, 1080p HLS akışları ve Türkçe dublaj/altyazı.
2. **HDFilmCehennemi** (`providers/hdfilmcehennemi.js`): HDFilmCehennemi.land üzerinden 1080p çift ses (Türkçe Dublaj & Orijinal) adaptif HLS akışları ve Türkçe altyazı desteği.
3. **DiziBox** (`providers/dizibox.js`): DiziBox.live üzerinden yabancı dizi arşivi, Molystream / VidMoly 1080p HLS akışları.
4. **DiziYou** (`providers/diziyou.js`): DiziYou.one üzerinden doğrudan 1080p play.m3u8 HLS akışları ve senkronize Türkçe VTT altyazıları.
5. **SineVix** (`providers/sinewix.js`): SineVix / SineWix arşivi, 1080p doğrudan HLS akışları.

## Kurulum
Nuvio uygulamasında:
1. **Ayarlar (Settings) -> Eklentiler (Plugins / Addons) -> Depo Ekle (Add Repository)** bölümüne gidin.
2. Aşağıdaki URL'yi yapıştırın:
```
https://raw.githubusercontent.com/ttuloglu/nuvio-tr-plugins/main/manifest.json
```
3. Depoyu ekledikten sonra eklentileri aktif hale getirin.
