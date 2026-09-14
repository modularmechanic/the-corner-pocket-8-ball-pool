"""Send authoring code to Blender's locally installed MCP add-on (isolated port)."""
import json, socket, sys
from pathlib import Path
code = Path(sys.argv[1]).read_text()
with socket.create_connection(('127.0.0.1', 19876), timeout=10) as connection:
    connection.settimeout(180)
    connection.sendall(json.dumps({'type':'execute','code':code,'strict_json':True}).encode()+b'\0')
    response = bytearray()
    while b'\0' not in response:
        chunk = connection.recv(65536)
        if not chunk: break
        response.extend(chunk)
    data = json.loads(response.split(b'\0',1)[0])
    print(json.dumps(data,indent=2))
    if data.get('status') != 'ok': sys.exit(1)
