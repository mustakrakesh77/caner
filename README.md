# SC İhtiyaç Listesi – kurulum (yaklaşık 15 dk)

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

## "Yenile" butonu
Telefonlarda hiçbir anahtar girilmez. Buton Supabase'deki `request_scan()` fonksiyonunu çağırır; o da Vault'ta saklı `gh_token` ile GitHub'daki taramayı başlatır (en çok 45 saniyede bir). Tarama bitince `settings.scan_status` kaydına yazar, uygulama bitişi oradan öğrenir.
`gh_token` (GitHub fine-grained anahtarı, Actions: Read and write) süresi dolarsa buton "anahtar eksik ya da süresi dolmuş" uyarısı verir; yenisini Supabase → Integrations → Vault'a `gh_token` adıyla kaydetmek yeterli. Her 2 saatte bir otomatik tarama da aynı anahtarla çalışır (`supabase/scheduler.sql`).

## Telefona kur ve paylaşarak ekle
Linki telefonda aç → tarayıcı menüsü → **Ana ekrana ekle**. Android'de kurulduktan sonra Trendyol/Hepsiburada uygulamasında bir ürünün "Paylaş" menüsünde **SC İhtiyaç** görünür; seçince ekleme formu link dolu açılır. iPhone'da bu özellik yok; onun yerine ekleme formundaki **Yapıştır** düğmesi panodaki linki alır.
