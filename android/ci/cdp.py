"""Ejecuta JavaScript dentro del WebView de Mi App (Chrome DevTools Protocol vía adb forward).
   python3 cdp.py "<expresión>"      → imprime el resultado
   python3 cdp.py SHOT:archivo.png   → captura de la página por dentro (no depende del emulador)"""
import base64, json, sys, time, urllib.request
import websocket  # pip install websocket-client

arg = sys.argv[1]
err = ''
for intento in range(20):
    try:
        pages = json.load(urllib.request.urlopen("http://127.0.0.1:9222/json", timeout=5))
        cands = [p for p in pages if "miapp" in p.get("url", "") and p.get("type") == "page"]
        vis = [p for p in cands if '"visible":true' in p.get("description", "")]
        page = (vis or cands)[0]
        break
    except Exception as e:
        err = repr(e); time.sleep(2)
else:
    print("SIN_PAGINA " + err); sys.exit(1)
ws = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=30, suppress_origin=True)
if arg.startswith("SHOT:"):
    ws.send(json.dumps({"id": 1, "method": "Page.captureScreenshot", "params": {"format": "png"}}))
else:
    ws.send(json.dumps({"id": 1, "method": "Runtime.evaluate", "params": {"expression": arg, "returnByValue": True, "awaitPromise": True}}))
while True:
    r = json.loads(ws.recv())
    if r.get("id") == 1:
        if arg.startswith("SHOT:"):
            d = r.get("result", {}).get("data")
            if d: open(arg[5:], "wb").write(base64.b64decode(d)); print("ok")
            else: print(json.dumps(r)[:300])
        else:
            res = r.get("result", {})
            if "exceptionDetails" in res: print("EXCEPCION " + json.dumps(res["exceptionDetails"])[:800])
            v = res.get("result", {})
            print(v.get("value", v.get("description", json.dumps(r)[:500])))
        break
