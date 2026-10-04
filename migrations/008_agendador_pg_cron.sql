-- Agendador da fila de posts: chama /api/cron/publish a cada 5 minutos (pg_cron + pg_net, gratuitos).
-- Troque <CRON_SECRET> pelo valor da Vercel e rode no SQL Editor do Supabase (não salve o valor no git).
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid) from cron.job where jobname = 'publicar-agenda';

select cron.schedule(
  'publicar-agenda',
  '*/5 * * * *',
  $$
  select net.http_get(
    url := 'https://cee-automacao.vercel.app/api/cron/publish',
    headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>'),
    timeout_milliseconds := 60000
  );
  $$
);

select jobid, jobname, schedule, active from cron.job where jobname = 'publicar-agenda';
