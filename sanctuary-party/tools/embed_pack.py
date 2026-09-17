import re, base64, os

SERVER = 'server.js'
SRC_DIR = '_embed_src'

with open(SERVER, encoding='utf8') as f:
    src = f.read()

pattern = re.compile(r"('((?:[\w./-]+))': \{ type: '([^']+)', b64: ')([A-Za-z0-9+/=]*)('\s*\})")

def repl(m):
    prefix, name, ctype, _old_b64, suffix = m.group(1), m.group(2), m.group(3), m.group(4), m.group(5)
    path = os.path.join(SRC_DIR, name)
    with open(path, 'rb') as g:
        data = g.read()
    new_b64 = base64.b64encode(data).decode('ascii')
    return prefix + new_b64 + suffix

new_src, n = pattern.subn(repl, src)
with open(SERVER, 'w', encoding='utf8', newline='') as f:
    f.write(new_src)
print('Re-packed', n, 'assets into', SERVER)
