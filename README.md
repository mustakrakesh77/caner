# Çeyiz Listesi – kurulum (yaklaşık 15 dk)

Üç parça var: **Supabase** (ortak liste burada durur), **GitHub Pages** (uygulamanın sitesi), **GitHub Actions** (2 saatte bir fiyat tarar). Hepsi ücretsiz.

## 1) Supabase
1. supabase.com → hesap aç → **New project** (şifreyi bir yere not et, bölge: Frankfurt olabilir).
2. Sol menü **SQL Editor** → `supabase/schema.sql` dosyasının içeriğini yapıştır → **Run**.
3. **Project Settings → API** sayfasında şunlar var:
   - Project URL
   - `anon public` anahtarı → `config.js`'e yazılacak
   - `service_role` anahtarı → **sadece GitHub secret'ına** yazılacak, kimseyle paylaşma, `config.js`'e yazma.

## 2) GitHub
1. github.com'da **public** bir repo aç (adı örn. `ceyiz`), bu klasördeki dosyaları yükle.
   (Public olması gerekiyor, ücretsiz Pages için. Kodda sır yok; anon anahtar zaten herkese açık tasarlanmıştır.)
2. `config.js` içine Project URL ve `anon public` anahtarını yaz.
3. Repo **Settings → Secrets and variables → Actions → New repository secret**:
   - `SUPABASE_URL` = Project URL
   - `SUPABASE_SERVICE_KEY` = `service_role` anahtarı
4. Repo **Settings → Pages** → Source: *Deploy from a branch* → `main` / `/ (root)` → Save.
   Birkaç dakika sonra `https://KULLANICI.github.io/ceyiz/` adresi açılır. Bu linki manitayla paylaş.
5. **Actions** sekmesi → "Fiyat taraması" → **Run workflow** ile ilk taramayı elle başlat. Sonra kendiliğinden 2 saatte bir çalışır.

## 3) Telefona kur
Linki telefonda aç → tarayıcı menüsü → **Ana ekrana ekle**. Uygulama gibi açılır.

## Bilmen gerekenler
- Fiyatlar **Akakçe**'den gelir (onlarca mağazayı tarar). Trendyol/Hepsiburada linki atınca ürün adını linkten çıkarıp Akakçe'de ararım; eşleşme kartta "Doğru mu?" diye sorulur. Yanlışsa doğru Akakçe linkini yapıştırırsın.
- Site adresini bilen herkes listeyi değiştirebilir (şifre yok). Linki başkasıyla paylaşma.
- GitHub zamanlayıcısı bazen birkaç dakika geç çalışır; "tam 2 saat" garantisi yok.
- Akakçe sayfa yapısını değiştirirse tarama hata verir; kartta kırmızı uyarı görürsün.

## "Fiyatları yenile" butonu için GitHub anahtarı (her telefonda bir kere)
Buton, GitHub'daki taramayı başlatır. Bunun için sadece bu repoya, sadece "Actions" izni olan bir anahtar lazım:
1. GitHub'da sağ üst profil → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. Name: `ceyiz-yenile`. Expiration: en uzun süreyi seç.
3. **Repository access → Only select repositories** → `caner`.
4. **Permissions → Repository permissions → Actions: Read and write** (başka izin verme).
5. **Generate token** → çıkan `github_pat_...` ile başlayan anahtarı kopyala (bir daha gösterilmez).
6. Sitede butona ilk bastığında anahtarı sorar, yapıştır. Anahtar sadece o cihazın tarayıcısında saklanır.
Anahtar süresi dolarsa buton "geçersiz" uyarısı verir, aynı adımlarla yenisini oluştur. Manitanın telefonunda da aynı anahtarı girebilir ya da kendi GitHub hesabıyla repoya katkıcı olarak eklenip kendi anahtarını alabilir. Anahtarı kimseyle paylaşma, yazıp çizdiğin yerlere yapıştırma.
