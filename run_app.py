import os
import sys
import time
import webbrowser
import threading
from pathlib import Path

root_dir = Path(__file__).resolve().parent
backend_dir = root_dir / "backend"

def open_browser():
    # Wait for uvicorn to bind and begin serving
    time.sleep(1.8)
    webbrowser.open("http://127.0.0.1:8000")

if __name__ == "__main__":
    threading.Thread(target=open_browser, daemon=True).start()

    try:
        import uvicorn
        sys.path.insert(0, str(backend_dir))
        uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=False, app_dir=str(backend_dir))
    except KeyboardInterrupt:
        pass
