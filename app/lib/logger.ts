import { IS_DEV } from "./const";

type LogLevel = "debug" | "info" | "warn" | "error";

interface LoggerInterface {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  withTag: (tag: string) => LoggerInterface;
}

const createLogger = (defaultTag: string = "ai4sales"): LoggerInterface => {
  const logLevel: LogLevel = IS_DEV ? "debug" : "info";
  const levels: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  const shouldLog = (level: LogLevel): boolean => {
    return levels[level] >= levels[logLevel];
  };

  const formatTag = (tag: string) => `[${tag}]`;

  return {
    debug: (...args) => {
      if (shouldLog("debug")) {
        console.debug(formatTag(defaultTag), ...args);
      }
    },
    info: (...args) => {
      if (shouldLog("info")) {
        console.info(formatTag(defaultTag), ...args);
      }
    },
    warn: (...args) => {
      if (shouldLog("warn")) {
        console.warn(formatTag(defaultTag), ...args);
      }
    },
    error: (...args) => {
      if (shouldLog("error")) {
        console.error(formatTag(defaultTag), ...args);
      }
    },
    withTag: (tag: string) => createLogger(`${defaultTag}:${tag}`),
  };
};

const logger = createLogger();

export default logger;
