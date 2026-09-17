import re, base64, os, sys

SERVER = 'server.js'
OUT_DIR = '_embed_src'

with open(SERVER, encoding='utf8') as f:
    src = f.read()

pattern = re.compile(r"'((?:[\w./-]+))': \{ type: '([^']+)', b64: '([A-Za-z0-9+/=]*)' \}")
names = []
for m in pattern.finditer(src):
    name, ctype, b64 = m.group(1), m.group(2), m.group(3)
    names.append(name)
    data = base64.b64decode(b64)
    out_path = os.path.join(OUT_DIR, name)
    os.makedirs(os.path.dirname(out_path) or '.', exist_ok=True)
    with open(out_path, 'wb') as g:
        g.write(data)
print('Extracted', len(names), 'assets:', names)
