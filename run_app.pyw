import os
import sys
import time
import webbrowser
import threading
import traceback
from pathlib import Path

root_dir = Path(__file__).resolve().parent
backend_dir = root_dir / "backend"
log_path = root_dir / "server.log"
crash_path = root_dir / "crash.log"

class DummyInput:
    def isatty(self):
        return False
    def read(self, *a, **k):
        return ""
    def readline(self, *a, **k):
        return ""

if sys.stdin is None:
    sys.stdin = DummyInput()
if getattr(sys, "__stdin__", None) is None:
    sys.__stdin__ = DummyInput()

try:
    log_file = open(log_path, "a", encoding="utf-8", buffering=1)
    sys.stdout = log_file
    sys.stderr = log_file
    sys.__stdout__ = log_file
    sys.__stderr__ = log_file
except Exception:
    pass

def open_browser():
    # Wait for uvicorn to bind and begin serving
    time.sleep(2.0)
    webbrowser.open("http://127.0.0.1:8000")

try:
    threading.Thread(target=open_browser, daemon=True).start()

    import uvicorn
    sys.path.insert(0, str(backend_dir))
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=False, app_dir=str(backend_dir))
except BaseException as exc:
    try:
        with open(crash_path, "w", encoding="utf-8") as f:
            traceback.print_exc(file=f)
    except Exception:
        pass
