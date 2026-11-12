#!/usr/bin/env python3
# Carte réseau virtuelle (TUN) du VPN d'Odin, sans rien installer : Python standard seulement.
# Odin fait tout le protocole WireGuard (chiffrement, clés, appareils) ; ce petit relais ouvre
# l'interface du système et fait passer les paquets entre elle et Odin :
#   sortie standard : [2 octets : longueur][paquet IP]  (ce que le système envoie dans le VPN)
#   entrée standard : [2 octets : longueur][paquet IP]  (ce qu'Odin a déchiffré, à remettre au système)
# Linux seulement (ioctl TUNSETIFF). Usage : tun.py <nom de l'interface>
import fcntl, os, struct, sys, threading

TUNSETIFF, IFF_TUN, IFF_NO_PI = 0x400454CA, 0x0001, 0x1000
name = sys.argv[1].encode()[:15]
fd = os.open('/dev/net/tun', os.O_RDWR)
fcntl.ioctl(fd, TUNSETIFF, struct.pack('16sH', name, IFF_TUN | IFF_NO_PI))
out = sys.stdout.buffer
sys.stderr.write('pret\n'); sys.stderr.flush()

def from_system():
    while True:
        pkt = os.read(fd, 65535)
        if not pkt: break
        out.write(struct.pack('>H', len(pkt)) + pkt); out.flush()

threading.Thread(target=from_system, daemon=True).start()
inp = sys.stdin.buffer
while True:
    head = inp.read(2)
    if len(head) < 2: break
    n = struct.unpack('>H', head)[0]
    pkt = inp.read(n)
    if len(pkt) < n: break
    try: os.write(fd, pkt)
    except OSError: pass
