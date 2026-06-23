# Backfill Queue Worker Deployment Notes

## Overview

The data loss audit & backfill feature requires a dedicated queue worker to handle backfill jobs efficiently. This document outlines why, how to configure it, and the post-deployment steps.

## Why a Dedicated Backfill Worker?

The backfill process must respect two constraints:

1. **Sequential per logger:** Each logger's missing periods must be backfilled in order to ensure data consistency and prevent file upload race conditions.
2. **Parallel across loggers:** Multiple loggers should backfill concurrently to speed up recovery across the fleet.

The existing default queue worker handles all job types sequentially in a single process. A dedicated `backfill` queue with multiple worker processes (`numprocs=4`) allows:

- Multiple loggers to backfill in parallel (one process per logger)
- Each logger's backfill jobs to remain sequential (enforced by `RunLoggerBackfill` job using `WithoutOverlapping`)
- Efficient resource utilization without blocking other queue jobs

## Supervisor Configuration

Add the following `[program:cloud_beacon-backfill]` block to your Supervisor configuration file (typically `/etc/supervisord.conf` or included from `/etc/supervisor/conf.d/`):

```ini
[program:cloud_beacon-backfill]
command=php /var/www/vhosts/<domain>/httpdocs/artisan queue:work --queue=backfill --sleep=1 --tries=3 --timeout=120
numprocs=4
process_name=%(program_name)s_%(process_num)02d
autostart=true
autorestart=true
user=<plesk-user>
redirect_stderr=true
stdout_logfile=/var/log/cloud_beacon-backfill.log
```

**Configuration notes:**

- `numprocs=4`: Creates 4 worker processes, allowing up to 4 loggers to backfill in parallel.
- `--queue=backfill`: Routes only backfill jobs to this worker; the existing default worker continues handling other queues.
- `--sleep=1`: Poll interval for new jobs (1 second).
- `--tries=3`: Retry failed backfill jobs up to 3 times.
- `--timeout=120`: Job timeout of 120 seconds covers one fire-and-confirm cycle and accounts for network latency. Long total backfill runtime is spread across many short re-dispatched jobs, not a single long-running process.

Replace `<domain>` with your domain (e.g., `example.com`) and `<plesk-user>` with the Plesk application user (e.g., `u123456789`).

## Post-Deployment Steps

After deploying the backfill worker configuration:

1. **Run database migrations:**
   ```bash
   php artisan migrate
   ```

2. **Clear application configuration cache:**
   ```bash
   php artisan config:clear
   ```

3. **Restart Supervisor to load the new worker:**
   ```bash
   supervisorctl reread
   supervisorctl update
   supervisorctl restart all
   ```

4. **Verify the scheduler will pick up audit scans:**
   - The existing `audit:scan` command should already be registered in your `app/Console/Kernel.php` with an appropriate schedule (e.g., every 5 minutes).
   - No additional scheduler configuration is required; the existing Laravel scheduler will continue to trigger `audit:scan` as configured.
   - Confirm the scheduler is running under Supervisor alongside the default queue worker.

## Verification

After restart, verify the backfill workers are running:

```bash
supervisorctl status
```

You should see four processes like:
```
cloud_beacon-backfill:cloud_beacon-backfill_00   RUNNING
cloud_beacon-backfill:cloud_beacon-backfill_01   RUNNING
cloud_beacon-backfill:cloud_beacon-backfill_02   RUNNING
cloud_beacon-backfill:cloud_beacon-backfill_03   RUNNING
```

Monitor logs at `/var/log/cloud_beacon-backfill.log` for any errors during the initial backfill run.
