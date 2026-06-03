# Logging Setup

EasySticker uses [Pino](https://getpino.io/) as its structured logging framework.

## Current Configuration

Pino writes **JSON lines to stdout** (one JSON object per line). The log level is
configurable via the `LOG_LEVEL` environment variable:

| Variable     | Default | Valid Values                                                  |
|--------------|---------|---------------------------------------------------------------|
| `LOG_LEVEL`  | `info`  | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent` |

In development (`NODE_ENV !== "production"`), `pino-pretty` is used to print
human-readable logs to the terminal.

## Log Format

Each log line is a JSON object — suitable for ingestion by any JSON-log
collector (e.g., Loki, Datadog, ELK, CloudWatch).

Example:

```json
{"level":30,"time":1717000000000,"pid":1,"hostname":"abc123","msg":"server started","port":3000}
```

## Docker / Docker Compose

When deployed with Docker Compose, logs are captured by the Docker daemon.
You can view them with:

```bash
docker compose logs -f easysticker
```

Docker's default log driver (`json-file`) stores logs on disk. For production
deployments, consider:

- Switching to `journald` or `syslog` log driver
- Using a logging plugin (e.g., `loki`, `fluentd`, `awslogs`)
- Enabling Docker log rotation (see below)

### Docker Log Rotation

Add the following to `/etc/docker/daemon.json` on the host to limit log size
and prevent disk exhaustion:

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
```

Then restart the Docker daemon:

```bash
sudo systemctl restart docker
```

## Logrotate (System-Level)

If you cannot configure Docker's log driver, install `logrotate` to rotate
the container log files directly. Create `/etc/logrotate.d/easysticker`:

```
/var/lib/docker/containers/*/*.log {
  rotate 7
  daily
  compress
  missingok
  delaycompress
  copytruncate
  maxsize 50M
}
```

## Recommendations

| Environment | Log Level | Log Collection                        |
|-------------|-----------|---------------------------------------|
| Development | `debug`   | Terminal (pino-pretty)                |
| Staging     | `info`    | Docker logs + Loki / Grafana          |
| Production  | `info`    | JSON to stdout → log collector        |
