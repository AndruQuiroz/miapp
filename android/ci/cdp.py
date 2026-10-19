"""Ejecuta JavaScript dentro del WebView de Mi App (Chrome DevTools Protocol vía adb forward)."""
import json, sys, time, urllib.request
import websocket  # pip install websocket-client

expr = sys.argv[1]
for intento in range(20):
    try:
        pages = json.load(urllib.request.urlopen("http://127.0.0.1:9222/json", timeout=5))
        page = next(p for p in pages if "miapp" in p.get("url", ""))
        break
    except Exception as e:
        time.sleep(2)
else:
    print("SIN_PAGINA"); sys.exit(1)
ws = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=20, suppress_origin=True)
ws.send(json.dumps({"id": 1, "method": "Runtime.evaluate", "params": {"expression": expr, "returnByValue": True, "awaitPromise": True}}))
while True:
    r = json.loads(ws.recv())
    if r.get("id") == 1:
        v = r.get("result", {}).get("result", {})
        print(v.get("value", v.get("description", json.dumps(r)[:500])))
        break
