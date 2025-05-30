@echo off
@set REMOTE_BROWSER_FILE_PATH=c:/Program Files/Google/Chrome/Application/chrome.exe

@echo on
"%REMOTE_BROWSER_FILE_PATH%" --remote-debugging-port=9223 --user-data-dir="J:/mcpservers/myPlaywrightMCP/.auth"