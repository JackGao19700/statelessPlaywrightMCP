import { Browser, BrowserContext, Page } from 'playwright';

// 定义参数类型
export interface RunOptions {
  browser: Browser;
  context?: BrowserContext;  // 可选
  page?: Page;               // 可选
  customData?: any;          // 可扩展其他参数
}

export async function run(options: RunOptions): Promise<string> {
  const { browser, context, page,customData } = options;

  // 如果未传入 page，则新建一个
  const targetPage = page || await (context || browser).newPage();

  await targetPage.goto('https://www.taobao.com/');  
  await targetPage.getByRole('combobox', { name: '请输入搜索文字' }).fill(customData?.searchText??'扩音机');
  const page1Promise = targetPage.waitForEvent('popup');
  await targetPage.getByRole('button', { name: '搜索' }).click();
  const newPage = await page1Promise;

  // 等待新页面加载完成
  //await newPage.waitForLoadState('networkidle',{timeout:60000});
  //await newPage.waitForLoadState('load');
  await newPage.waitForLoadState('domcontentloaded',{timeout:600000});

  // 额外等待 #content_items_wrapper 元素出现
  await newPage.waitForSelector('#content_items_wrapper', { timeout: 300000 });

  // 定位所有搜索结果,只匹配直接子级 div
  const searchContents = newPage.locator('#content_items_wrapper').locator('> div');

  // 额外等待第一个直接子 div 元素出现
  await searchContents.first().waitFor({ state: 'visible', timeout: 300000 });

  // 获取所有直接子 div 的数量
  //const count = await searchContents.count();

  // 批量获取所有子 div 元素
  const allDivs = await searchContents.all();

  // 并行处理元素
  const itemsInfo = await Promise.all(allDivs.map(async (div, i) => {
      // 并行获取各元素文本
      const [shopPopularText, shopInfoText, itemDescriptionText, priceUnitText, priceValueText, saleCountText] = await Promise.all([
          // 处理 shopPopular
          div.locator('[class*="shopTagText"]').first().innerText().catch(() => `${i}-Error`),
          //const isShopPopularVisible = await shopPopularLocator.isVisible();

          // 处理 shopInfo
          div.locator('[class*="shopNameText"]').first().innerText().catch(() => `${i}-Error`),

          // 处理 itemDescription
          div.locator('div[class*="descWrapper"]').first().innerText().catch(() => `${i}-Error`),

          // 处理 priceUnit
          (async () => {
              const priceDiv = await div.locator('div[class*="priceWrapper"]').first();
              return priceDiv.locator('[class*="unit"]').first().innerText().catch(() => `${i}-Error`);
          })(),

          // 处理 priceValue
          (async () => {
              const priceDiv = await div.locator('div[class*="priceWrapper"]').first();
              return priceDiv.locator('[class*="innerPrice"]').first().innerText().catch(() => `${i}-Error`);
          })(),

          // 处理 saleCount
          (async () => {
              const priceDiv = await div.locator('div[class*="priceWrapper"]').first();
              return priceDiv.locator('[class*="realSales"]').first().innerText().catch(() => `${i}-Error`);
          })()
      ]);
  
      return {
          "shop": { 
              shopPopular: shopPopularText, 
              shopInfo: shopInfoText 
          },
          "item": { 
              itemDescription: itemDescriptionText, 
              saleCount: saleCountText,
              "price": { 
                  priceUnit: priceUnitText, 
                  priceValue: priceValueText 
              }
          }
      };
  }));

  // 返回 JSON 字符串
  return JSON.stringify({
    success: true,
    itemsInfo
  });
}