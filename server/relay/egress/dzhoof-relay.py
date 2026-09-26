#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
DZ HOOF Relay Kit — نفق خروج منزلي + وكيل مجمَّع (pool) للمزوّد.

لماذا هذا الملف
--------------
قياس الإنتاج (2026-09-21) أثبت أمرين:
  1. حساب المزوّد يقبل **اتصالًا واحدًا لكل IP**: طلبان متزامنان من IP واحد ⇒ الثاني
     يُرفض بـ 407 والثالث بـ 405 (وأحيانًا 200 بجسم فارغ). ولهذا كان «يُصلح عند الخروج
     والدخول»: الخروج يُحرّر المقعد.
  2. IP الخادم **غير محجوب** حاليًا (4/4 قنوات نجحت 200/206، ولا كود 456).

فالحلّ الحقيقي للسعة هو أن يبثّ **كل زبون من IP نفسه** (وهو ما فُعِّل على الخادم:
ALLOW_DIRECT_PLAYBACK=true). ويبقى ما يلي احتياطًا للزبائن الذين يحجب مزوّد الإنترنت
عنهم الاتصال المباشر: يمرّون عبر المرحّل من الخادم.

وإذا كان حدّ المزوّد **لكل IP**، فإن جمع عدة خطوط (بيتك + بيت قريب + هاتف…) يضاعف
السعة. هذا الملف يعطيك ذلك كاملًا:

  dzhoof-relay.py serve    ← على جهاز البيت: وكيل HTTP (CONNECT + absolute-form)
  dzhoof-relay.py tunnel   ← ينشئ نفق SSH عكسي إلى الخادم (مع إعادة تشغيل تلقائية)
  dzhoof-relay.py pool     ← على الخادم: وكيل واحد يوزّع الطلبات على عدة أنفاق منازل
  dzhoof-relay.py check    ← تشخيص: هل المزوّد يخدم؟ ما سقف التزامن؟ هل IP محجوب (456)؟

الأمان: `serve` و`pool` يستمعان على 127.0.0.1 فقط، ويحجبان المضيفات الخاصة افتراضيًا،
وقائمة السماح الافتراضية هي نطاق المزوّد وحده. لا ترفع الاستماع إلى 0.0.0.0.

تفاصيل تقنية: قياسات السقف (1 متزامن)، وأسباب اختيار HTTP بدل SOCKS5 (لأن ffmpeg
و axios يتحدثان CONNECT/absolute-form)، موجودة في docs/RELAY_KIT_AR.md بالتفصيل.
"""
from __future__ import annotations

import argparse
import ipaddress
import os
import select
import socket
import subprocess
import sys
import threading
import time
from datetime import datetime
from urllib.parse import urlsplit

DEFAULT_ALLOW = "tv.business-cloud-neo.com"
BUF = 256 * 1024

# ───────────────────────────── أدوات مشتركة ─────────────────────────────

_lock = threading.Lock()
LOG_PATH = os.environ.get("RELAY_LOG", "").strip()


def log(msg: str) -> None:
    line = "[%s] %s" % (datetime.now().strftime("%Y-%m-%d %H:%M:%S"), msg)
    print(line, flush=True)
    if LOG_PATH:
        try:
            with _lock:
                with open(LOG_PATH, "a", encoding="utf-8") as fh:
                    fh.write(line + "\n")
        except Exception:
            pass


def split_host_port(value: str, default_port: int) -> tuple[str, int]:
    """Host header / target ⇒ (host, port). Handles [v6]:port, host:port, bare host.

    القاعدة المهمة: نجرّد المنفذ **قبل** أي فحص عنوان، وإلا مرّت عناوين محلية مثل
    '192.168.1.1:80' من فحص ipaddress وسقطت في السماح الافتراضي (ثغب تجاوز حقيقي).
    """
    v = (value or "").strip()
    if v.startswith("["):  # [::1]:80
        host, _, rest = v.partition("]")
        host = host[1:]
        port = int(rest[1:]) if rest.startswith(":") and rest[1:].isdigit() else default_port
        return host, port
    if v.count(":") == 1:
        h, _, p = v.rpartition(":")
        if p.isdigit():
            return h, int(p)
    return v, default_port


def is_blocked(host: str, port: int, allow: list[str], allow_ports: set[int]) -> bool:
    """مضيف/منفذ لا يجوز الوصول إليه من خلال النفق."""
    h = (host or "").strip().strip("[]").lower()
    if not h or port not in allow_ports:
        return True
    if h == "localhost" or h.endswith(".local") or h.endswith(".lan") or h.endswith(".internal"):
        return True
    try:
        ip = ipaddress.ip_address(h)
        if (ip.is_private or ip.is_loopback or ip.is_link_local
                or ip.is_multicast or ip.is_unspecified or ip.is_reserved):
            return True
    except ValueError:
        pass  # اسم مضيف
    if allow:
        return not any(h == a or h.endswith("." + a) for a in allow)
    return False


def pump(src, dst, *, shutdown=True) -> None:
    try:
        while True:
            data = src.recv(BUF)
            if not data:
                break
            dst.sendall(data)
    except Exception:
        pass
    finally:
        if shutdown:
            try:
                dst.shutdown(socket.SHUT_WR)
            except Exception:
                pass


def parse_allow(value: str) -> list[str]:
    """قائمة نطاقات مسموحة، أو [] لـ«أي وجهة عامة».

    مهم عمليًا: مزوّدو البثّ **يُحوّلون** روابط القنوات إلى مضيف/IP آخر، فقائمة ضيّقة
    ترفض البثّ بـ403. القيمة `any` (أو `*`) تسمح بكل وجهة **عامة**، مع بقاء حجب
    الشبكات الخاصة والمحلية والعناوين المحجوزة قائمًا في كل الحالات.
    """
    raw = (value or "").strip()
    if raw.lower() in ("*", "any", "all"):
        return []
    if not raw:
        raw = DEFAULT_ALLOW
    return [a.strip().lower().lstrip("*.") for a in raw.split(",") if a.strip()]


def read_head(conn: socket.socket, timeout: float = 30.0) -> tuple[str, list[str], bytes] | None:
    """يقرأ رأس HTTP كاملًا (حتى \\r\\n\\r\\n) ويعيد (first_line, headers, remainder)."""
    conn.settimeout(timeout)
    buf = b""
    while b"\r\n\r\n" not in buf:
        chunk = conn.recv(BUF)
        if not chunk:
            return None
        buf += chunk
        if len(buf) > 64 * 1024:  # رأس ضخم = طلب مرفوض
            return None
    head, _, rest = buf.partition(b"\r\n\r\n")
    lines = head.decode("latin-1", "replace").split("\r\n")
    if not lines or len(lines[0].split(" ")) < 2:
        return None
    return lines[0], lines[1:], rest


# ───────────────────────────── serve: وكيل البيت ─────────────────────────────

def serve_connection(conn: socket.socket, allow: list[str], allow_ports: set[int]) -> None:
    try:
        parsed = read_head(conn)
        if not parsed:
            conn.close()
            return
        first_line, headers, rest = parsed
        parts = first_line.split(" ")
        method, target = parts[0].upper(), parts[1]

        host_header = None
        for line in headers:
            if line.lower().startswith("host:"):
                host_header = line.split(":", 1)[1].strip()
                break

        if method == "CONNECT":
            host, port = split_host_port(target, 443)
            if is_blocked(host, port, allow, allow_ports):
                log("BLOCKED CONNECT %s:%s" % (host, port))
                conn.sendall(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                conn.close()
                return
            upstream = socket.create_connection((host, port), timeout=25)
            conn.sendall(b"HTTP/1.1 200 Connection established\r\n\r\n")
            threading.Thread(target=pump, args=(conn, upstream), daemon=True).start()
            pump(upstream, conn)
            upstream.close()
            conn.close()
            log("CONNECT %s:%s closed" % (host, port))
            return

        # absolute-form (وكيل HTTP عادي، كما يفعل ffmpeg -http_proxy)
        host, port = split_host_port(host_header or "", 80)
        if target.startswith("http://") or target.startswith("https://"):
            split_target = urlsplit(target)
            host, port = (split_target.hostname or host), (split_target.port or (443 if split_target.scheme == "https" else 80))
            path = split_target.path or "/"
            if split_target.query:
                path += "?" + split_target.query
            target = path
        if is_blocked(host, port, allow, allow_ports):  # ← الفحص بالقيم النهائية، لا برأس خام
            log("BLOCKED %s %s:%s" % (method, host, port))
            conn.sendall(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            conn.close()
            return

        keep = [h for h in headers
                if not h.lower().startswith(("proxy-connection", "connection", "proxy-authorization"))]
        request = "%s %s HTTP/1.1\r\n" % (method, target) + "\r\n".join(keep) + "\r\nConnection: close\r\n\r\n"

        upstream = socket.create_connection((host, port), timeout=25)
        upstream.sendall(request.encode("latin-1") + rest)
        conn.settimeout(300)
        upstream.settimeout(300)
        pump(upstream, conn, shutdown=False)
        upstream.close()
        conn.close()
    except Exception as exc:  # noqa: BLE001 - أي خطأ في اتصال واحد لا يُسقط الوكيل
        log("handler error: %s" % exc)
        try:
            conn.close()
        except Exception:
            pass


def cmd_serve(args) -> int:
    allow = parse_allow(args.allow_only)
    allow_ports = {int(p) for p in (args.allow_ports or "80,443,8080").split(",") if p.strip().isdigit()}
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind((args.host, args.port))
    srv.listen(128)
    log("serve: listening on %s:%d | allow_only=%s | ports=%s" % (args.host, args.port, allow, sorted(allow_ports)))
    while True:
        conn, peer = srv.accept()
        threading.Thread(target=serve_connection, args=(conn, allow, allow_ports), daemon=True).start()


# ───────────────────── pool: وكيل واحد لعدة خطوط منازل ─────────────────────

class Egress:
    """خط خروج = منفذ محلي يصل إلى وكيل بيت عبر نفق SSH عكسي."""

    def __init__(self, host: str, port: int, label: str = "") -> None:
        self.host, self.port = host, port
        self.label = label or ("%s:%d" % (host, port))
        self.active = 0
        self.healthy = True
        self.checked_at = 0.0

    def probe(self) -> bool:
        """اتصال TCP سريع: هل النفق حيّ؟ (يُخزَّن 5 ثوانٍ حتى لا نُثقل)."""
        if time.time() - self.checked_at < 5:
            return self.healthy
        self.checked_at = time.time()
        try:
            s = socket.create_connection((self.host, self.port), timeout=2)
            s.close()
            self.healthy = True
        except Exception:
            self.healthy = False
        return self.healthy


_rotation = {"i": 0}


def pool_pick(egresses: list[Egress]) -> Egress | None:
    """أقلّ انشغالًا أولًا، ثم دوريًا عند التساوي.

    الترتيب الدوري مهم للطلبات **المتتابعة** (قناة تُغلق وأخرى تُفتح): بدونها يذهب كل
    بثّ متتالٍ إلى نفس الخط فيبقى باقي الخطوط معطّلًا، والسعة المضافة بلا فائدة.
    """
    live = [e for e in egresses if e.probe()]
    if not live:
        return None
    live.sort(key=lambda e: (e.active, e.label))
    least = live[0].active
    same_load = [e for e in live if e.active == least]
    _rotation["i"] = (_rotation["i"] + 1) % max(1, len(same_load))
    return same_load[_rotation["i"]]


def pool_handle(conn: socket.socket, egresses: list[Egress], allow: list[str], allow_ports: set[int],
                fallback_direct: bool = True) -> None:
    picked: Egress | None = None
    upstream = None
    try:
        parsed = read_head(conn)
        if not parsed:
            conn.close()
            return
        first_line, headers, rest = parsed
        parts = first_line.split(" ")
        method, target = parts[0].upper(), parts[1]
        host_header = next((l.split(":", 1)[1].strip() for l in headers if l.lower().startswith("host:")), "")

        if method == "CONNECT":
            host, port = split_host_port(target, 443)
        else:
            host, port = split_host_port(host_header, 80)
            if target.startswith("http://") or target.startswith("https://"):
                st = urlsplit(target)
                host, port = (st.hostname or host), (st.port or (443 if st.scheme == "https" else 80))
        if is_blocked(host, port, allow, allow_ports):
            log("pool BLOCKED %s %s:%s" % (method, host, port))
            conn.sendall(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            conn.close()
            return

        # مسار الطلب: عبر خطّ خروج منزلي (absolute-form إلى وكيل البيت) أو مباشر من
        # هذا الخادم (origin-form إلى الهدف).
        path = target
        if target.startswith("http://") or target.startswith("https://"):
            st = urlsplit(target)
            path = (st.path or "/") + (("?" + st.query) if st.query else "")
        keep = [h for h in headers if not h.lower().startswith(("proxy-connection", "connection"))]

        picked = pool_pick(egresses)
        direct = picked is None
        if direct:
            if not fallback_direct:
                log("pool: no healthy egress for %s:%s" % (host, port))
                conn.sendall(b"HTTP/1.1 503 No Egress Available\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                conn.close()
                return
            # لا خطّ منزلي حيّ ⇒ نخدم من هذا الخادم كما كان الوضع قبل الوكيل.
            # هذا ما يجعل توصيل الوكيل **بلا خطر**: غياب حاسوب البيت لا يُسقط شيئًا.
            log("pool %s → direct (no egress) %s:%s" % (method, host, port))
            upstream = socket.create_connection((host, port), timeout=25)
            if method == "CONNECT":
                conn.sendall(b"HTTP/1.1 200 Connection established\r\n\r\n")
            else:
                head = "%s %s HTTP/1.1\r\n" % (method, path)
                head += "\r\n".join(keep) + "\r\nConnection: close\r\n\r\n"
                upstream.sendall(head.encode("latin-1") + rest)
        else:
            with _lock:
                picked.active += 1
            log("pool %s → %s (%s:%s, active=%d)" % (method, picked.label, host, port, picked.active))
            upstream = socket.create_connection((picked.host, picked.port), timeout=10)
            if method == "CONNECT":
                upstream.sendall(("CONNECT %s:%d HTTP/1.1\r\nHost: %s:%d\r\n\r\n" % (host, port, host, port)).encode("latin-1"))
                resp = b""
                while b"\r\n\r\n" not in resp:
                    chunk = upstream.recv(BUF)
                    if not chunk:
                        break
                    resp += chunk
                if not resp.startswith(b"HTTP/1.1 2"):
                    log("pool: egress refused CONNECT (%s): %s" % (picked.label, resp.split(b"\r\n")[0][:60]))
                    conn.sendall(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                    return
                conn.sendall(b"HTTP/1.1 200 Connection established\r\n\r\n")
            else:
                head = "%s http://%s:%d%s HTTP/1.1\r\n" % (method, host, port, path)
                head += "\r\n".join(keep) + "\r\nConnection: close\r\n\r\n"
                upstream.sendall(head.encode("latin-1") + rest)

        conn.settimeout(300)
        upstream.settimeout(300)
        threading.Thread(target=pump, args=(conn, upstream), daemon=True).start()
        pump(upstream, conn)
    except Exception as exc:  # noqa: BLE001
        log("pool handler error: %s" % exc)
    finally:
        if picked:
            with _lock:
                picked.active = max(0, picked.active - 1)
        for sock_obj in (upstream, conn):
            try:
                sock_obj.close()
            except Exception:
                pass


def cmd_pool(args) -> int:
    allow = parse_allow(args.allow_only)
    allow_ports = {int(p) for p in (args.allow_ports or "80,443,8080").split(",") if p.strip().isdigit()}
    egresses = []
    for spec in args.egress.split(","):
        spec = spec.strip()
        if not spec:
            continue
        if spec.isdigit():
            # '9151' تعني منفذًا محليًا على 127.0.0.1 لنفق البيت — لا اسم مضيف.
            host, port = "127.0.0.1", int(spec)
        else:
            host, port = split_host_port(spec, 9001)
        egresses.append(Egress(host, port, spec))
    if not egresses:
        log("pool: لا توجد خطوط خروج — استخدم --egress 9101,9102,...")
        return 2
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind((args.host, args.port))
    srv.listen(256)
    log("pool: listening on %s:%d | egresses=%s | fallback_direct=%s | allow_only=%s"
        % (args.host, args.port, [e.label for e in egresses], args.fallback_direct, allow))
    while True:
        conn, _ = srv.accept()
        threading.Thread(target=pool_handle,
                         args=(conn, egresses, allow, allow_ports, args.fallback_direct),
                         daemon=True).start()


# ───────────────────────────── tunnel: SSH عكسي ─────────────────────────────

def cmd_tunnel(args) -> int:
    """ينشئ نفقًا عكسيًا: منفذ على الخادم ← وكيل البيت. يعيد المحاولة تلقائيًا."""
    remote_port = args.remote_port
    cmd = [
        "ssh", "-N",
        "-o", "ServerAliveInterval=20",
        "-o", "ServerAliveCountMax=3",
        "-o", "ExitOnForwardFailure=yes",
        "-o", "BatchMode=yes",
        "-R", "127.0.0.1:%d:127.0.0.1:%d" % (remote_port, args.local_port),
        "%s@%s" % (args.user, args.host),
    ]
    if args.key:
        cmd[1:1] = ["-i", args.key]
    log("tunnel: %s" % " ".join(cmd[:1] + cmd[1:]))
    backoff = 5
    while True:
        try:
            proc = subprocess.Popen(cmd)
            code = proc.wait()
            log("tunnel: انتهى بكود %s — إعادة محاولة بعد %ds" % (code, backoff))
        except Exception as exc:  # noqa: BLE001
            log("tunnel error: %s — إعادة محاولة بعد %ds" % (exc, backoff))
        time.sleep(backoff)
        backoff = min(60, backoff * 2)


# ───────────────────────────── check: تشخيص ─────────────────────────────

def http_probe(url: str, headers: dict[str, str] | None = None, timeout: float = 12.0):
    """GET صغير عبر socket خام يعيد (كود الحالة، عدد بايتات الجسم، نوع المحتوى)."""
    st = urlsplit(url)
    host = st.hostname or ""
    port = st.port or (443 if st.scheme == "https" else 80)
    path = (st.path or "/") + (("?" + st.query) if st.query else "")
    sock = socket.create_connection((host, port), timeout=timeout)
    if st.scheme == "https":
        import ssl
        sock = ssl.create_default_context().wrap_socket(sock, server_hostname=host)
    hdrs = {"Host": host, "User-Agent": "dzhoof-relay-check/1.0", "Accept": "*/*",
            "Range": "bytes=0-65535", "Connection": "close"}
    hdrs.update(headers or {})
    req = "GET %s HTTP/1.1\r\n" % path + "\r\n".join("%s: %s" % kv for kv in hdrs.items()) + "\r\n\r\n"
    sock.sendall(req.encode("latin-1"))
    sock.settimeout(timeout)
    data = b""
    try:
        while len(data) < 8192:
            chunk = sock.recv(BUF)
            if not chunk:
                break
            data += chunk
            if b"\r\n\r\n" in data and len(data.split(b"\r\n\r\n", 1)[1]) > 1500:
                break
    except socket.timeout:
        pass
    finally:
        try:
            sock.close()
        except Exception:
            pass
    head, _, body = data.partition(b"\r\n\r\n")
    lines = head.decode("latin-1", "replace").split("\r\n")
    status = 0
    if lines and lines[0].startswith("HTTP/"):
        try:
            status = int(lines[0].split(" ")[1])
        except (IndexError, ValueError):
            status = 0
    ctype = next((l.split(":", 1)[1].strip() for l in lines[1:] if l.lower().startswith("content-type:")), "")
    return status, len(body), ctype


def cmd_check(args) -> int:
    base = args.server.rstrip("/")
    streams = [s.strip() for s in (args.streams or "").split(",") if s.strip()]
    print("== DZ HOOF relay check ==")
    print("server : %s" % base)
    print("streams: %s" % (streams or "(لم تُمرَّر)"))
    print("الغرض: (1) هل هذا الموقع يصل إلى المزوّد؟ (2) ما سقف التزامن؟ (3) هل هناك حجب 456؟")
    if not streams:
        print("\nمرّر معرّفات بثّ حقيقية: --streams 297641,295672,702493")
        return 2
    urls = ["%s/live/%s/%s/%s.ts" % (base, args.user, args.password, sid) for sid in streams]

    print("\n-- تباعًا (يكشف الحجب 456 والجسم الفارغ) --")
    good = 0
    for sid, url in zip(streams, urls):
        try:
            status, size, ctype = http_probe(url)
            ok = status in (200, 206) and size > 0
            good += 1 if ok else 0
            print("  %-8s status=%-4s bytes=%-7s type=%-18s %s" % (sid, status, size, ctype[:18], "OK" if ok else "FAIL"))
        except Exception as exc:  # noqa: BLE001
            print("  %-8s ERR %s" % (sid, str(exc)[:60]))
    print("  الخلاصة: %d/%d تعمل تباعًا" % (good, len(streams)))
    print("  ملاحظة: وجود 456 في أي سطر = هذا الـIP محجوب من المزوّد (هنا يفيد نفق البيت).")

    print("\n-- متزامنًا (يكشف سقف الاتصالات لهذا الـIP) --")
    results: list[str] = []

    def worker(idx: int, url: str) -> None:
        try:
            status, size, _ = http_probe(url, timeout=15)
            results.append("%s:%s/%sb" % (idx + 1, status, size))
        except Exception:  # noqa: BLE001
            results.append("%d:ERR" % (idx + 1))

    threads = [threading.Thread(target=worker, args=(i, u)) for i, u in enumerate(urls)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    print("  " + "  ".join(results))
    ok_parallel = len([r for r in results if "/0b" not in r and "ERR" not in r])
    print("  نجح متزامنًا: %d من %d" % (ok_parallel, len(urls)))
    if ok_parallel < len(urls):
        print("  ⇒ السقف الفعلي لهذا الـIP ≈ %d اتصال. لخدمة عدة مشاهدين: إمّا البثّ المباشر لكل زبون،" % max(1, ok_parallel))
        print("    أو عدة خطوط خروج مع 'pool' (كل خط = IP مختلف).")
    return 0 if good else 1


# ───────────────────────────── CLI ─────────────────────────────

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="DZ HOOF Relay Kit — نفق منزلي + وكيل مجمَّع + تشخيص")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("serve", help="وكيل HTTP على جهاز البيت (استمع 127.0.0.1 فقط)")
    s.add_argument("--host", default="127.0.0.1")
    s.add_argument("--port", type=int, default=int(os.environ.get("RELAY_PORT", "9001")))
    s.add_argument("--allow-only", default=os.environ.get("ALLOW_ONLY", DEFAULT_ALLOW),
                   help="قائمة نطاقات مسموحة (افتراضي: نطاق المزوّد فقط)")
    s.add_argument("--allow-ports", default=os.environ.get("ALLOW_PORTS", "80,443,8080"))
    s.set_defaults(func=cmd_serve)

    t = sub.add_parser("tunnel", help="نفق SSH عكسي من البيت إلى الخادم مع إعادة تشغيل تلقائية")
    t.add_argument("--host", required=True, help="IP الخادم")
    t.add_argument("--user", default="root")
    t.add_argument("--key", default="", help="مسار مفتاح SSH (اختياري)")
    t.add_argument("--remote-port", type=int, default=9101, help="المنفذ على الخادم (لكل بيت رقم مختلف)")
    t.add_argument("--local-port", type=int, default=9001, help="منفذ serve على جهاز البيت")
    t.set_defaults(func=cmd_tunnel)

    p2 = sub.add_parser("pool", help="على الخادم: وكيل واحد يوزّع على عدة أنفاق منازل")
    p2.add_argument("--host", default="127.0.0.1")
    p2.add_argument("--port", type=int, default=int(os.environ.get("RELAY_PORT", "9001")))
    p2.add_argument("--egress", required=True, help="منافذ الأنفاق على الخادم، مثال: 9101,9102,9103")
    p2.add_argument("--allow-only", default=os.environ.get("ALLOW_ONLY", DEFAULT_ALLOW))
    p2.add_argument("--allow-ports", default=os.environ.get("ALLOW_PORTS", "80,443,8080"))
    p2.add_argument("--fallback-direct", dest="fallback_direct", action="store_true", default=True,
                    help="عند غياب خطّ منزلي حيّ، اخدم من هذا الخادم (افتراضي: نعم — يمنع أي انقطاع)")
    p2.add_argument("--no-fallback-direct", dest="fallback_direct", action="store_false",
                    help="امنع الخدمة إن لم يوجد خطّ منزلي (للتشخيص فقط)")
    p2.set_defaults(func=cmd_pool)

    c = sub.add_parser("check", help="تشخيص: وصول + سقف تزامن + حجب 456")
    c.add_argument("--server", required=True, help="مثال: http://tv.business-cloud-neo.com")
    c.add_argument("--user", required=True)
    c.add_argument("--password", required=True)
    c.add_argument("--streams", default="", help="معرّفات بثّ مفصولة بفاصلة")
    c.set_defaults(func=cmd_check)
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return args.func(args) or 0
    except KeyboardInterrupt:
        log("stopping")
        return 0


if __name__ == "__main__":
    sys.exit(main())
