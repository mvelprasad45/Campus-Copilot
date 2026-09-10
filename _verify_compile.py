import py_compile
from pathlib import Path

app_path = Path(r"C:\Users\atcha\Desktop\campus-copilot-final\Campus-Copilot\app.py")
py_compile.compile(app_path, doraise=True)
print("PY_COMPILE_OK")
