-- The deployment stores the project URL and a random dispatcher secret in Vault.
-- No project identifiers or raw secrets belong in version-controlled migrations.
create extension if not exists pg_net with schema extensions;

do $schedule$
begin
  perform cron.schedule(
    'edusafe-notification-worker',
    '* * * * *',
    $job$
    select net.http_post(
      url := rtrim((select decrypted_secret from vault.decrypted_secrets
                    where name = 'edusafe_project_url' limit 1), '/')
             || '/functions/v1/notification-worker',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-edusafe-worker-secret', (select decrypted_secret from vault.decrypted_secrets
                                    where name = 'edusafe_worker_secret' limit 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    )
    where exists (select 1 from vault.secrets where name = 'edusafe_project_url')
      and exists (select 1 from vault.secrets where name = 'edusafe_worker_secret');
    $job$
  );
end;
$schedule$;
