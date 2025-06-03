REM Method1:To get browser path by using this url in browser: chrome://version/ in browser
REM Method2:To get the path of the chrome.exe file, you can use this command: where chrome.exe

@echo off
@set REMOTE_BROWSER_FILE_PATH=c:/Program Files/Google/Chrome/Application/chrome.exe

@echo on
"%REMOTE_BROWSER_FILE_PATH%" --remote-debugging-port=9223 --user-data-dir="J:/mcpservers/myPlaywrightMCP/.auth"