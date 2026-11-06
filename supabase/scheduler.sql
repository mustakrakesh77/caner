-- Supabase zamanlayıcısı: her 2 saatte GitHub'daki taramayı başlatır.
-- GitHub'ın kendi zamanlayıcısına göre daha düzenlidir ve 60 gün hareketsizlikte kapanmaz.
-- GitHub anahtarı Vault'ta 'gh_token' adıyla saklanır (kodda anahtar YOK).

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.trigger_scan() returns bigint
language plpgsql security definer set search_path = public, extensions, vault, net
as $fn$
declare tok text; rid bigint;
begin
  select decrypted_secret into tok from vault.decrypted_secrets where name = 'gh_token' limit 1;
  if tok is null then
    raise notice 'gh_token Vault''ta yok, tarama tetiklenmedi';
    return null;
  end if;
  select net.http_post(
    url := 'https://api.github.com/repos/mustakrakesh77/caner/actions/workflows/scan.yml/dispatches',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || tok,
      'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent', 'ceyiz-cron',
      'Content-Type', 'application/json'),
    body := '{"ref":"main"}'::jsonb
  ) into rid;
  return rid;
end
$fn$;
revoke all on function private.trigger_scan() from public, anon, authenticated;

select cron.schedule('ceyiz-scan', '7 */2 * * *', $$select private.trigger_scan()$$);
