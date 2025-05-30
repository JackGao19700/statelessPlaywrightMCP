import { Browser, BrowserContext, Page } from 'playwright';

// 定义参数类型
export interface RunOptions {
  browser: Browser;
  context?: BrowserContext;  // 可选
  page?: Page;               // 可选
  customData?: any;          // 可扩展其他参数
}

export async function run(options: RunOptions): Promise<string> {
  const { browser, context, page } = options;

  // 如果未传入 page，则新建一个
  const targetPage = page || await (context || browser).newPage();
  await targetPage.goto('https://www.baidu.com');
  const title = await targetPage.title();

  // 返回 JSON 字符串
  return JSON.stringify({
    success: true,
    data: { title },
  });
}