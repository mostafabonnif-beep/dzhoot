#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
DZ HOOF Home Relay — minimal SOCKS5 (CONNECT) server.
Exits traffic from your HOME IP (residential) so NEO streams play.
Listen: 127.0.0.1:9001  (paired with an SSH reverse tunnel to the VPS)
Usage:  python3 relay.py     (or:  python relay.py  on Windows)
Stdlib only — no pip install needed.
"""
import socket
import threading

LISTEN = ("127.0.0.1", 9001)
BUF = 64 * 1024


def _reply(conn, code):
    conn.sendall(bytes([5, code, 0, 1, 0, 0, 0, 0, 0, 0]))


def _pump(src, dst):
    try:
        while True:
            d = src.recv(BUF)
            if not d:
                break
            dst.sendall(d)
    except Exception:
        pass
    finally:
        try:
            dst.shutdown(socket.SHUT_WR)
        except Exception:
            pass


def _handle(conn):
    try:
        conn.settimeout(30)
        ver, nm = conn.recv(2)
        if ver != 5 or not nm:
            conn.close()
            return
        conn.recv(nm)
        conn.sendall(bytes([5, 0]))  # no auth
        hdr = conn.recv(4)
        if len(hdr) < 4 or hdr[1] != 1:  # CONNECT only
            _reply(conn, 7)
            conn.close()
            return
        atyp = hdr[3]
        if atyp == 1:
            dst = socket.inet_ntoa(conn.recv(4))
        elif atyp == 3:
            ln = conn.recv(1)[0]
            dst = conn.recv(ln).decode()
        elif atyp == 4:
            dst = socket.inet_ntop(socket.AF_INET6, conn.recv(16))
        else:
            conn.close()
            return
        port = int.from_bytes(conn.recv(2), "big")
        up = socket.create_connection((dst, port), timeout=25)
        _reply(conn, 0)
        threading.Thread(target=_pump, args=(conn, up), daemon=True).start()
        _pump(up, conn)
    except Exception:
        try:
            _reply(conn, 5)
        except Exception:
            pass
    finally:
        try:
            conn.close()
        except Exception:
            pass


def main():
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind(LISTEN)
    s.listen(64)
    print("DZ HOOF relay SOCKS5 listening on %s:%d" % LISTEN)
    while True:
        c, _ = s.accept()
        threading.Thread(target=_handle, args=(c,), daemon=True).start()


if __name__ == "__main__":
    main()
