export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
  child(fields: Record<string, string>): Logger;
}

type Sink = (line: string, level: LogLevel) => void;

const defaultSink: Sink = (line, level) => {
  if (level === "error" || level === "warn") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
};

function formatData(data: Record<string, unknown> | undefined): string {
  if (!data) return "";
  const parts = Object.entries(data)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`);
  return parts.length ? " " + parts.join(" ") : "";
}

/**
 * Structured logger: every line carries the project ID (spec §11).
 * LOG_FORMAT=json prints one JSON object per line; otherwise a readable line.
 */
export function createLogger(fields: Record<string, string>, sink: Sink = defaultSink): Logger {
  const json = process.env.LOG_FORMAT === "json";
  const debugOn = process.env.LOG_LEVEL === "debug";

  const write = (level: LogLevel, msg: string, data?: Record<string, unknown>) => {
    if (level === "debug" && !debugOn) return;
    const time = new Date().toISOString();
    if (json) {
      sink(JSON.stringify({ time, level, ...fields, msg, ...data }), level);
      return;
    }
    const tags = Object.values(fields)
      .map((v) => `[${v}]`)
      .join(" ");
    const lvl = level === "info" ? "" : ` ${level.toUpperCase()}`;
    sink(`${time.slice(11, 19)}${lvl} ${tags} ${msg}${formatData(data)}`, level);
  };

  return {
    debug: (m, d) => write("debug", m, d),
    info: (m, d) => write("info", m, d),
    warn: (m, d) => write("warn", m, d),
    error: (m, d) => write("error", m, d),
    child: (more) => createLogger({ ...fields, ...more }, sink),
  };
}

/** Logger that discards everything; handy in tests. */
export const silentLogger: Logger = createLogger({}, () => undefined);
