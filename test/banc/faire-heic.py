# Fabrique de vraies photos HEIC pour les essais d'Alchimie (HEVC dans un conteneur HEIF, ISO/IEC 23008-12) :
# les images sont encodées par ffmpeg (libx265), le conteneur est écrit ici d'après la norme.
#   python3 faire-heic.py sortie.heic largeur hauteur [grille] [AAAA:MM:JJ hh:mm:ss]
# « grille » : 2 × 2 tuiles (comme un iPhone), la grille dans « idat », la taille finale un peu plus petite que les tuiles.
import struct, subprocess, sys, tempfile, os

out, W, H = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
grille = len(sys.argv) > 4 and sys.argv[4] == 'grille'
date = sys.argv[5] if len(sys.argv) > 5 else ''
tmp = tempfile.mkdtemp()

def encoder(w, h, x, y):
    f = os.path.join(tmp, f't{x}_{y}.hevc')
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', f'testsrc2=size={W}x{H}', '-vf', f'crop={w}:{h}:{x}:{y}', '-frames:v', '1', '-pix_fmt', 'yuv420p',
                    '-c:v', 'libx265', '-x265-params', 'log-level=error:keyint=1:info=0', '-f', 'hevc', f], check=True)
    data = open(f, 'rb').read(); starts, i = [], 0
    while True:
        j = data.find(b'\x00\x00\x01', i)
        if j < 0: break
        starts.append(j + 3); i = j + 3
    nals = []
    for k, s in enumerate(starts):
        e = starts[k + 1] - 3 if k + 1 < len(starts) else len(data); n = data[s:e]
        while n.endswith(b'\x00'): n = n[:-1]
        nals.append(n)
    return nals

def rbsp(b):
    o, z = bytearray(), 0
    for x in b:
        if z >= 2 and x == 3: z = 0; continue
        o.append(x); z = z + 1 if x == 0 else 0
    return bytes(o)
def box(t, p): return struct.pack('>I', 8 + len(p)) + t + p
def full(t, v, f, p): return box(t, struct.pack('>I', (v << 24) | f) + p)
typ = lambda n: (n[0] >> 1) & 0x3f
def hvcc(nals):
    ptl = rbsp([n for n in nals if typ(n) == 33][0])[3:15]
    arr = b''
    for t in (32, 33, 34):
        l = [n for n in nals if typ(n) == t]
        arr += struct.pack('>BH', 0x80 | t, len(l)) + b''.join(struct.pack('>H', len(n)) + n for n in l)
    return box(b'hvcC', bytes([1]) + ptl + struct.pack('>HBBBBHB', 0xF000, 0xFC, 0xFD, 0xF8, 0xF8, 0, 0x0F) + bytes([3]) + arr)
def corps(nals): return b''.join(struct.pack('>I', len(n)) + n for n in nals if typ(n) < 32)

if grille:
    tw, th = W // 2, H // 2
    tiles = [encoder(tw, th, x * tw, y * th) for y in range(2) for x in range(2)]
    items = [(i + 2, corps(t)) for i, t in enumerate(tiles)]  # tuiles : éléments 2 à 5
    props = [hvcc(tiles[0]), full(b'ispe', 0, 0, struct.pack('>II', tw, th)), full(b'ispe', 0, 0, struct.pack('>II', W - 20, H - 10))]
    ipma = full(b'ipma', 0, 0, struct.pack('>I', 5) + struct.pack('>HBB', 1, 1, 0x03) + b''.join(struct.pack('>HBBB', i, 2, 0x81, 0x02) for i in range(2, 6)))
    grid = bytes([0, 0, 1, 1]) + struct.pack('>HH', W - 20, H - 10)
    infes = [full(b'infe', 2, 0, struct.pack('>HH', 1, 0) + b'grid' + b'\0')] + [full(b'infe', 2, 1, struct.pack('>HH', i, 0) + b'hvc1' + b'\0') for i in range(2, 6)]
    iref = full(b'iref', 0, 0, box(b'dimg', struct.pack('>HH', 1, 4) + b''.join(struct.pack('>H', i) for i in range(2, 6))))
    idat = box(b'idat', grid)
else:
    t = encoder(W, H, 0, 0); items = [(1, corps(t))]
    props = [hvcc(t), full(b'ispe', 0, 0, struct.pack('>II', W, H))]
    ipma = full(b'ipma', 0, 0, struct.pack('>IHB', 1, 1, 2) + bytes([0x81, 0x02]))
    infes = [full(b'infe', 2, 0, struct.pack('>HH', 1, 0) + b'hvc1' + b'\0')]; iref = b''; idat = b''; grid = b''
if date:
    tiff = b'II*\x00' + struct.pack('<I', 8) + struct.pack('<H', 1) + struct.pack('<HHII', 0x9003, 2, 20, 26) + struct.pack('<I', 0) + date.encode() + b'\0'
    items.append((9, struct.pack('>I', 0) + tiff)); infes.append(full(b'infe', 2, 0, struct.pack('>HH', 9, 0) + b'Exif' + b'\0'))
payload, offs = b'', []
for i, d in items: offs.append((i, len(payload), len(d))); payload += d
hdlr = full(b'hdlr', 0, 0, struct.pack('>I', 0) + b'pict' + b'\0' * 12 + b'\0')
pitm = full(b'pitm', 0, 0, struct.pack('>H', 1))
iinf = full(b'iinf', 0, 0, struct.pack('>H', len(infes)) + b''.join(infes))
iprp = box(b'iprp', box(b'ipco', b''.join(props)) + ipma)
ftyp = box(b'ftyp', b'heic' + struct.pack('>I', 0) + b'mif1heic')
def meta(base):
    ent = b''.join(struct.pack('>HHHHII', i, 0, 0, 1, base + o, l) for i, o, l in offs)
    if grille: ent += struct.pack('>HHHHII', 1, 1, 0, 1, 0, len(grid))  # la grille, dans idat
    iloc = full(b'iloc', 1, 0, bytes([0x44, 0x00]) + struct.pack('>H', len(offs) + (1 if grille else 0)) + ent)
    return full(b'meta', 0, 0, hdlr + pitm + iloc + iinf + iref + iprp + idat)
base = len(ftyp) + len(meta(0)) + 8
open(out, 'wb').write(ftyp + meta(base) + box(b'mdat', payload))
print(out, os.path.getsize(out))
