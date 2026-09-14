"""Run the installed Blender MCP extension in an isolated background process.

Start with:
  Blender --background --factory-startup --online-mode --python scripts/start_blender_mcp.py

This imports the existing add-on without changing its installation or saving
Blender preferences. The ordinary GUI instance and its open scene are untouched.
The project client uses this dedicated loopback port, rather than the GUI port.
"""
import importlib.util
import os
from pathlib import Path
import sys

import bpy

if not bpy.app.background:
    raise RuntimeError("Use --background --factory-startup to keep authoring isolated.")

version = f"{bpy.app.version[0]}.{bpy.app.version[1]}"
addon = Path(os.environ.get(
    "COOLPOOL_BLENDER_MCP_ADDON",
    str(Path.home() / "Library/Application Support/Blender" / version / "extensions/user_default/mcp"),
))
if not (addon / "mcp_to_blender_server.py").is_file():
    raise RuntimeError(f"The installed Blender MCP extension was not found at {addon}")

package = "coolpool_installed_mcp"
spec = importlib.util.spec_from_file_location(
    package, addon / "__init__.py", submodule_search_locations=[str(addon)]
)
module = importlib.util.module_from_spec(spec)
sys.modules[package] = module
spec.loader.exec_module(module)

from coolpool_installed_mcp.cli import cli_execute

print(f"Coolpool isolated authoring: Blender {bpy.app.version_string}; extension {addon}", flush=True)
print("GUI scenes and user preferences are not loaded or modified.", flush=True)
exit_code = cli_execute(["--host", "127.0.0.1", "--port", "19876"])
if exit_code:
    raise RuntimeError(f"Could not start the isolated Blender MCP bridge ({exit_code}).")
