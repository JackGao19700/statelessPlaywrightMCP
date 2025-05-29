#!/usr/bin/env node
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envFile = path.resolve(__dirname, '../.env');
const result = dotenv.config({ path: envFile });

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { logger } from './logger.js';


async function main() {
  let browserAgent;
  try {
    const { server, browserAgent: agent } = await createServer();
    browserAgent = agent;
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info("playwrightMCP Server running on stdio");

    // 自定义逻辑保持进程存活
    await new Promise(() => {});
  } catch (error) {
    logger.error("Fatal error in main():", error);
    process.exit(1);
  } finally {
    if (browserAgent) {
      try {
        await browserAgent.tearDown();
        logger.info('Browser agent has been torn down.');
      } catch (tearDownError) {
        logger.error('Failed to tear down browser agent:', tearDownError);
      }
    }
  }
}

// 使用立即执行的异步函数封装 main 函数的调用
(async () => {
  try {
    await main();
  } catch (error) {
    // 这里的错误捕获通常不会触发，因为 main 函数内部已经处理了错误并退出进程
    logger.error("Unexpected error outside main():", error);
    process.exit(1);
  }
})();