import winston from 'winston';
import type { Logger, transport } from 'winston';

// 环境变量
const LOG_LEVEL: string = process.env.LOG_LEVEL || 'info';
const LOG_FILEPATH: string | undefined = process.env.LOG_FILEPATH;

// 日志传输配置
const loggerTransports: transport[] = [];

// 配置日志输出
if (LOG_FILEPATH) {
  // 如果配置了文件路径，添加文件日志
  loggerTransports.push(new winston.transports.File({ filename: LOG_FILEPATH }));
}

// 添加控制台日志，在stdio模式下重定向到stderr
loggerTransports.push(new winston.transports.Console({
  stderrLevels: ['error', 'warn', 'info', 'verbose', 'debug', 'silly']
}));

// 创建统一的logger实例
const logger: Logger = winston.createLogger({
  level: LOG_LEVEL,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.simple()
  ),
  transports: loggerTransports
});

export { logger };