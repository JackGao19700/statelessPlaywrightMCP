# contextBrowserServer

python+playwright自动化测试(五)：使用token实现免登录



storage_state参数加载cookies实现免登录

加载JavaScript语句实现免登录

OS库添加本地环境的SESSION

自动化测试时时常需要做初始化的动作，但又不需要每次都做登录操作，尤其是单元测试过程中，那么就需要做免登录处理。

storage_state参数加载cookies实现免登录
使用storage_state时需要先执行一次登录操作，将登录后的cookies保存到指定文件，后面登录操作时加载此文件即可。

from playwright.sync_api import sync_playwright, Playwright, expect
 
# 获取并储存cookies
user_data = {
    'login_url': 'http://172.168.53.27:18004/#/login',
    'username': '2025041209',
    'password': '123456'
}
 
 
def get_session(playwright: Playwright, **user_data) -> None:
    browser = playwright.chromium.launch(headless=False)
    context = browser.new_context()  # 创建context，后面可在登录成功后将cookies数据存储起来
    page = context.new_page()
    page.goto(user_data.get('login_url'), wait_until='commit', timeout=50000)
    page.set_viewport_size({'width': 1920, 'height': 1080})
 
    page.locator('xpath=//input').nth(0).fill(user_data.get('username'))
    page.locator('xpath=//input').nth(1).fill(user_data.get('password'))
    page.locator('xpath=//span[text()="登录"]').click()
 
    page.wait_for_timeout(3000)  # 使用强制等待，等到资源加载完成后再执行保留cookie的操作，或者也可以使用其他等待方式，等待某个元素出现后 (即页面加载完)再保存cookie
 
    # 保存登陆成功的cookie
    context.storage_state(path="cookies.json")
 
    context.close()
    browser.close()
 
 
# 下面方法是加载已保存到本地的cookie，测试访问一个需要在登录后才能查看的页面
def documentManage(playwright: Playwright, url):
    browser = playwright.chromium.launch(headless=False)
    context = browser.new_context(storage_state="cookies.json")  # 传入storage_state参数，加载cookies
    page = context.new_page()
    page.goto(url, wait_until='commit', timeout=50000)
    page.set_viewport_size({'width': 1920, 'height': 1080})
 
    page.wait_for_timeout(3000)
    context.close()
    browser.close()
 
 
with sync_playwright() as p:
    # get_session(p, **user_data)
    documentManage(p, 'http://172.168.53.27:18004/#/documentManage')
AI写代码
python
运行
加载JavaScript语句实现免登录
token的来源：可以在已登录的网页通过开发者工具栏中的数据资源获取，也可以单独写一个通过request库请求获取返回值，从而得到token的方法。主要看一下通过JavaScript语句如何将token存储到Local Storage中。

    page.evaluate('''(token) => {
            localStorage.setItem('token', token);
        }''', token)
    
    # 从Local Storage中获取token的方法，可以通过这个方法检查是否加载将token加载到Local Storage中
    stored_token = page.evaluate('''() => {
            return localStorage.getItem('token');
        }''')
 
    if token == stored_token:
        print('token成功储存到Local Storage中')
    else:
        print('token失败')
 
    page.reload()  # 必做的一件事，储存后需要刷新页面，原理和手动在开发者工具栏修改Application的数据一样
AI写代码
python
运行
playwright两种执行JavaScript语句的区别：

evaluate(page_function, *args, force_expr=False)在页面上下文中执行JavaScript函数，并返回结果
evaluate_handle(page_function, *args, force_expr=False)在页面上下文中执行JavaScript函数，并返回JSHandle对象
# 写法2
page.evaluate("window.localStorage.setItem('{}','{}')".format(key,value))
AI写代码
python
运行
OS库添加本地环境的SESSION
某些网站除了会将会话信息保留在浏览器还会保留在本地环境，需要在自动化操作的时候也做同样的操作。os.environ提供了添加修改和删除本地环境变量的功能。

# 获取会话并存储
session_storage = page.evaluate("() => JSON.stringify(sessionStorage)")
os.environ["SESSION_STORAGE"] = session_storage
 
# 在新的上下文中设置会话存储
session_storage = os.environ["SESSION_STORAGE"]
context.add_init_script("""(storage => {
  if (window.location.hostname === 'example.com') {
    const entries = JSON.parse(storage)
    for (const [key, value] of Object.entries(entries)) {
      window.sessionStorage.setItem(key, value)
    }
  }



# 检查登录状态的示例代码
from playwright.sync_api import sync_playwright

def check_login_status(url):
    with sync_playwright() as p:
        # 启动浏览器（默认使用 Chromium）
        browser = p.chromium.launch(headless=False)  # headless=False 表示显示浏览器窗口
        page = browser.new_page()

        try:
            # 访问目标网页
            page.goto(url)
            print(f"正在访问: {url}")

            # 等待页面完全加载
            page.wait_for_load_state("networkidle")  # 等待网络空闲
            page.wait_for_timeout(3000)  # 额外等待 3 秒，确保页面完全加载

            # 从 localStorage 获取 token 数据
            token_data = page.evaluate("localStorage.getItem('token')")
            print("[LocalStorage] token 数据:", token_data)

            # 检查 token 是否有效
            if token_data and len(token_data.strip()) > 0:
                print("登录成功")
            else:
                print("登录失败")

        except Exception as e:
            print(f"检查登录状态时发生错误: {e}")

        finally:
            # 关闭浏览器
            browser.close()

代码解释
sync_playwright(): 使用 Playwright 的同步 API。
p.chromium.launch(headless=False): 启动 Chromium 浏览器，headless=False 表示显示浏览器窗口。
page.goto(url): 访问目标网页。
page.wait_for_load_state("networkidle"): 等待页面网络请求空闲，确保页面完全加载。
page.wait_for_timeout(3000): 额外等待 3 秒，确保页面完全加载。
page.evaluate("localStorage.getItem('token')"): 执行 JavaScript 代码，从 localStorage 中获取 token 数据。
if token_data and len(token_data.strip()) > 0:: 检查 token 是否存在且不为空。
browser.close(): 关闭浏览器。

# 调用函数检查登录状态
check_login_status("https://example.com/login")  # 替换为你的登录页面 URL



                        
原文链接：https://blog.csdn.net/JBY2020/article/details/145320428