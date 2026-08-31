#!/usr/bin/env python3
"""
DZ HOOF Relay Pool — موزّع SOCKS5 ذكي بين أنفاق المدن (وهران/الجزائر/جيجل).

- يستمع على 127.0.0.1:9000 (نفس منفذ النفق القديم — redsocks لا يتغير).
- كل مدينة تنشئ نفق SSH عكسي ديناميكي (ssh -R <port>) فيصبح sshd على الـVPS
  خادم SOCKS5 لكل مدينة على منفذها (9101/9102/9103).
- هذا البرنامج يقبل اتصالات redsocks، يختار أفضل مدينة حية، ويعمل CONNECT عبرها.
- فحص صحي كل 15 ثانية عبر كل نفق نحو الـupstream. عند سقوط المدينة النشطة
  يتحول تلقائياً لأول مدينة حية حسب الأولوية ثم أقل زمن استجابة.
- إذا ماتت كل المدن: يغلق المستمع على 9000 (حتى يزيل upstream-relay.timer
  قواعد iptables ويرجع النظام للوضع المباشر — نفس سلوك "النفق مغلق" اليوم).
- الحالة تُكتب JSON في ملف + Redis (أفضل جهد) + HTTP صغير على 127.0.0.1:9080.

معيارية فقط (stdlib). بدون تبعيات.
"""

import asyncio
import json
import os
import subprocess
import time

CONFIG_PATH = os.environ.get("RELAY_POOL_CONFIG", "/etc/dzhoof/relay-pool.json")

DEFAULTS = {
    "listen_host": "127.0.0.1",
    "listen_port": 9000,
    "status_host": "127.0.0.1",
    "status_port": 9080,
    "upstream_check_host": "104.18.22.66",
    "upstream_check_port": 443,
    # أي وجهة تصل = النفق حي. سقوط NEO وحده لا يقتل الـ relay (ottstreambox يبقى).
    "upstream_check_targets": [["104.18.22.66", 443], ["117.55.202.166", 80]],
    "check_interval": 15,
    "check_timeout": 8,
    "fail_threshold": 2,      # فشلان متتاليان => ميتة
    "recover_threshold": 2,   # نجاحان متتاليان => حية
    "status_file": "/var/lib/dzhoof-relay/status.json",
    "redis_key": "dzhoof:relay:pool",
    "redis_cli": ["docker", "exec", "dzhoof-redis", "redis-cli"],
    "nodes": [],
}

SOCKS_VER = 5
ATYP_IPV4 = 1
ATYP_DOMAIN = 3
ATYP_IPV6 = 4


def load_config():
    cfg = dict(DEFAULTS)
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            cfg.update(json.load(f))
    except FileNotFoundError:
        pass
    return cfg


class Node:
    def __init__(self, spec):
        self.name = spec["name"]
        self.port = int(spec["port"])
        self.priority = int(spec.get("priority", 100))
        self.enabled = bool(spec.get("enabled", True))
        # حالة ديناميكية
        self.healthy = False
        self.latency_ms = None
        self.consec_fail = 0
        self.consec_ok = 0
        self.last_ok = None
        self.last_error = None
        self.last_ok_target = None

    def to_dict(self):
        return {
            "name": self.name,
            "port": self.port,
            "priority": self.priority,
            "enabled": self.enabled,
            "healthy": self.healthy,
            "latency_ms": self.latency_ms,
            "last_ok": self.last_ok,
            "last_error": self.last_error,
            "last_ok_target": self.last_ok_target,
        }


async def socks5_connect(reader, writer, dest_host, dest_port, timeout):
    """مصافحة SOCKS5 no-auth + CONNECT. يرمي استثناء عند الفشل."""
    writer.write(bytes([SOCKS_VER, 1, 0]))  # VER, NMETHODS, NO-AUTH
    await asyncio.wait_for(writer.drain(), timeout)
    resp = await asyncio.wait_for(reader.readexactly(2), timeout)
    if resp[0] != SOCKS_VER or resp[1] != 0:
        raise RuntimeError("upstream SOCKS refused no-auth")

    try:
        ip_bytes = asyncio.open_connection  # placeholder to satisfy linters
    except Exception:
        pass

    # بناء طلب CONNECT
    try:
        import ipaddress
        ip = ipaddress.ip_address(dest_host)
        if ip.version == 4:
            addr = bytes([ATYP_IPV4]) + ip.packed
        else:
            addr = bytes([ATYP_IPV6]) + ip.packed
    except ValueError:
        host_b = dest_host.encode("idna")
        addr = bytes([ATYP_DOMAIN, len(host_b)]) + host_b

    req = bytes([SOCKS_VER, 1, 0]) + addr + int(dest_port).to_bytes(2, "big")
    writer.write(req)
    await asyncio.wait_for(writer.drain(), timeout)
    head = await asyncio.wait_for(reader.readexactly(4), timeout)
    if head[0] != SOCKS_VER:
        raise RuntimeError("bad SOCKS reply version")
    if head[1] != 0:
        raise RuntimeError(f"SOCKS CONNECT failed rep={head[1]}")
    atyp = head[3]
    if atyp == ATYP_IPV4:
        await asyncio.wait_for(reader.readexactly(4), timeout)
    elif atyp == ATYP_IPV6:
        await asyncio.wait_for(reader.readexactly(16), timeout)
    elif atyp == ATYP_DOMAIN:
        ln = (await asyncio.wait_for(reader.readexactly(1), timeout))[0]
        await asyncio.wait_for(reader.readexactly(ln), timeout)
    await asyncio.wait_for(reader.readexactly(2), timeout)  # BND.PORT


class Pool:
    def __init__(self, cfg):
        self.cfg = cfg
        self.nodes = [Node(n) for n in cfg["nodes"] if n.get("enabled", True)]
        self.active_name = None
        self.server = None
        self.started = time.time()
        self.stats = {"connections_total": 0, "connections_failed": 0, "failovers": 0}
        self._status_lock = asyncio.Lock()

    # ---------- الفحص الصحي ----------
    def _upstream_targets(self):
        """وجهات تثبت أن النفق حي — أي واحدة تصل تكفي."""
        t = self.cfg.get("upstream_check_targets")
        if isinstance(t, list) and t:
            out = []
            for item in t:
                if isinstance(item, (list, tuple)) and len(item) == 2:
                    out.append((str(item[0]), int(item[1])))
            if out:
                return out
        return [(str(self.cfg["upstream_check_host"]), int(self.cfg["upstream_check_port"]))]

    async def check_node(self, node):
        timeout = self.cfg["check_timeout"]
        # لا تزعج عقدة ميتة كثيراً إذا كان منفذها غير مستمع أصلاً (لا نفق):
        # أعد المحاولة كل ~5 دورات فقط، لكن إن كان المنفذ مستمعاً افحص دائماً.
        if not node.healthy and node.consec_fail > 0 and (node.consec_fail % 5) != 0:
            try:
                cr, cw = await asyncio.wait_for(
                    asyncio.open_connection("127.0.0.1", node.port), 1.5)
                cw.close()
                try:
                    await cw.wait_closed()
                except Exception:
                    pass
            except Exception:
                return  # ما زال بلا نفق — لا تغيّر الحالة
        targets = self._upstream_targets()
        t0 = time.monotonic()
        last_err = None
        ok_target = None
        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection("127.0.0.1", node.port), timeout)
            try:
                for host, port in targets:
                    try:
                        await socks5_connect(reader, writer, host, port, timeout)
                        ok_target = f"{host}:{port}"
                        break
                    except Exception as e:
                        last_err = f"{type(e).__name__}: {e}"
                        # الوجهة التالية تحتاج اتصالاً SOCKS جديداً
                        try:
                            writer.close()
                        except Exception:
                            pass
                        reader, writer = await asyncio.wait_for(
                            asyncio.open_connection("127.0.0.1", node.port), timeout)
            finally:
                writer.close()
                try:
                    await writer.wait_closed()
                except Exception:
                    pass
            if ok_target is None:
                raise RuntimeError(f"no upstream target reachable ({last_err})")
            node.latency_ms = round((time.monotonic() - t0) * 1000)
            node.last_ok_target = ok_target
            node.consec_ok += 1
            node.consec_fail = 0
            node.last_ok = int(time.time())
            node.last_error = None
            if not node.healthy and node.consec_ok >= self.cfg["recover_threshold"]:
                node.healthy = True
                self.log(f"node {node.name} RECOVERED via {ok_target} ({node.latency_ms} ms)")
            elif not node.healthy:
                self.log(f"node {node.name} check ok {node.consec_ok}/{self.cfg['recover_threshold']} via {ok_target} ({node.latency_ms} ms)")
        except Exception as e:
            node.consec_fail += 1
            node.consec_ok = 0
            node.last_error = f"{type(e).__name__}: {e}"
            if node.healthy and node.consec_fail >= self.cfg["fail_threshold"]:
                node.healthy = False
                self.log(f"node {node.name} DEAD ({node.last_error})")

    async def health_loop(self):
        while True:
            await asyncio.gather(*(self.check_node(n) for n in self.nodes),
                                 return_exceptions=True)
            await self.reconcile()
            await self.publish_status()
            await asyncio.sleep(self.cfg["check_interval"])

    async def initial_probe(self):
        # فحص فوري عند الإقلاع حتى لا يبقى النظام "كل المدن ميتة" لدورة كاملة
        await asyncio.gather(*(self.check_node(n) for n in self.nodes),
                             return_exceptions=True)
        await self.reconcile()
        await self.publish_status()

    def pick_active(self):
        alive = [n for n in self.nodes if n.healthy]
        if not alive:
            return None
        # أولوية أولاً، ثم أقل زمن استجابة. التصاق: أبقِ النشط إن كان حياً وبنفس أفضل أولوية.
        best = sorted(alive, key=lambda n: (n.priority, n.latency_ms or 99999))
        current = next((n for n in alive if n.name == self.active_name), None)
        if current and current.priority == best[0].priority:
            return current
        return best[0]

    async def reconcile(self):
        new_active = self.pick_active()
        if new_active is None:
            if self.active_name is not None:
                self.log("ALL NODES DEAD — closing listener (direct mode)")
            self.active_name = None
            await self.close_listener()
            return
        if self.active_name != new_active.name:
            if self.active_name is not None:
                self.stats["failovers"] += 1
            self.log(f"active node -> {new_active.name} ({new_active.latency_ms} ms)")
            self.active_name = new_active.name
        await self.ensure_listener()

    # ---------- المستمع ----------
    async def ensure_listener(self):
        if self.server is not None:
            return
        while True:
            try:
                self.server = await asyncio.start_server(
                    self.handle_client, self.cfg["listen_host"], self.cfg["listen_port"])
                self.log(f"listening on {self.cfg['listen_host']}:{self.cfg['listen_port']}")
                return
            except OSError as e:
                # المنفذ مشغول (النفق القديم مثلاً) — أعد المحاولة
                self.log(f"bind {self.cfg['listen_port']} failed: {e}; retry in 5s")
                await asyncio.sleep(5)

    async def close_listener(self):
        if self.server is not None:
            self.server.close()
            try:
                await self.server.wait_closed()
            except Exception:
                pass
            self.server = None

    # ---------- معالجة عميل redsocks ----------
    async def handle_client(self, client_r, client_w):
        self.stats["connections_total"] += 1
        upstream_w = None
        try:
            # مصافحة العميل (redsocks): no-auth
            greet = await asyncio.wait_for(client_r.readexactly(3), 10)
            if greet[0] != SOCKS_VER:
                raise RuntimeError("bad SOCKS version from client")
            client_w.write(bytes([SOCKS_VER, 0]))
            await client_w.drain()

            head = await asyncio.wait_for(client_r.readexactly(4), 10)
            if head[1] != 1:  # CONNECT فقط
                raise RuntimeError(f"unsupported cmd {head[1]}")
            atyp = head[3]
            if atyp == ATYP_IPV4:
                raw = await client_r.readexactly(4)
                dest_host = ".".join(str(b) for b in raw)
            elif atyp == ATYP_DOMAIN:
                ln = (await client_r.readexactly(1))[0]
                dest_host = (await client_r.readexactly(ln)).decode("idna", "replace")
            elif atyp == ATYP_IPV6:
                raw = await client_r.readexactly(16)
                import ipaddress
                dest_host = str(ipaddress.IPv6Address(raw))
            else:
                raise RuntimeError(f"bad atyp {atyp}")
            dest_port = int.from_bytes(await client_r.readexactly(2), "big")

            # اختر عقدة: النشطة، ثم أي حية أخرى عند فشل فوري
            tried = set()
            last_err = None
            while True:
                node = self._next_candidate(tried)
                if node is None:
                    raise RuntimeError(f"no healthy node ({last_err})")
                tried.add(node.name)
                try:
                    up_r, up_w = await asyncio.wait_for(
                        asyncio.open_connection("127.0.0.1", node.port),
                        self.cfg["check_timeout"])
                    try:
                        await socks5_connect(up_r, up_w, dest_host, dest_port,
                                             self.cfg["check_timeout"])
                    except Exception:
                        up_w.close()
                        raise
                    upstream_w = up_w
                    # نجاح: ردّ على العميل
                    client_w.write(bytes([SOCKS_VER, 0, 0, ATYP_IPV4, 0, 0, 0, 0, 0, 0]))
                    await client_w.drain()
                    await self._pipe(client_r, client_w, up_r, up_w)
                    return
                except Exception as e:
                    last_err = f"{node.name}: {type(e).__name__}: {e}"
                    node.consec_fail += 1
                    node.consec_ok = 0
                    if node.healthy and node.consec_fail >= self.cfg["fail_threshold"]:
                        node.healthy = False
                        self.log(f"node {node.name} DEAD (live traffic: {e})")
        except Exception as e:
            self.stats["connections_failed"] += 1
            try:
                client_w.write(bytes([SOCKS_VER, 5, 0, ATYP_IPV4, 0, 0, 0, 0, 0, 0]))
                await client_w.drain()
            except Exception:
                pass
        finally:
            for w in (upstream_w, client_w):
                if w is not None:
                    try:
                        w.close()
                    except Exception:
                        pass

    def _next_candidate(self, tried):
        alive = [n for n in self.nodes if n.healthy and n.name not in tried]
        if not alive:
            return None
        active = next((n for n in alive if n.name == self.active_name), None)
        if active:
            return active
        return sorted(alive, key=lambda n: (n.priority, n.latency_ms or 99999))[0]

    async def _pipe(self, a_r, a_w, b_r, b_w):
        async def fwd(r, w):
            try:
                while True:
                    data = await r.read(65536)
                    if not data:
                        break
                    w.write(data)
                    await w.drain()
            except Exception:
                pass
            finally:
                try:
                    w.close()
                except Exception:
                    pass
        await asyncio.gather(fwd(a_r, b_w), fwd(b_r, a_w), return_exceptions=True)

    # ---------- الحالة ----------
    def snapshot(self):
        return {
            "updated": int(time.time()),
            "uptime_s": int(time.time() - self.started),
            "active": self.active_name,
            "listening": self.server is not None,
            "stats": self.stats,
            "nodes": [n.to_dict() for n in self.nodes],
        }

    async def publish_status(self):
        snap = self.snapshot()
        data = json.dumps(snap, ensure_ascii=False)
        async with self._status_lock:
            try:
                tmp = self.cfg["status_file"] + ".tmp"
                with open(tmp, "w", encoding="utf-8") as f:
                    f.write(data)
                os.replace(tmp, self.cfg["status_file"])
            except Exception:
                pass
        # Redis أفضل جهد (لا يوقف شيئاً عند الفشل)
        try:
            proc = await asyncio.create_subprocess_exec(
                *self.cfg["redis_cli"], "SET", self.cfg["redis_key"], data, "EX", "120",
                stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
            await asyncio.wait_for(proc.wait(), 5)
        except Exception:
            pass

    async def status_http(self, reader, writer):
        try:
            await asyncio.wait_for(reader.read(4096), 5)
        except Exception:
            pass
        body = json.dumps(self.snapshot(), ensure_ascii=False, indent=2).encode()
        resp = (b"HTTP/1.1 200 OK\r\nContent-Type: application/json; charset=utf-8\r\n"
                b"Content-Length: " + str(len(body)).encode() + b"\r\n"
                b"Cache-Control: no-store\r\n\r\n" + body)
        try:
            writer.write(resp)
            await writer.drain()
        except Exception:
            pass
        finally:
            try:
                writer.close()
            except Exception:
                pass

    def log(self, msg):
        print(f"[relay-pool {time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}", flush=True)

    async def run(self):
        self.log(f"starting; nodes: {[n.name for n in self.nodes]}")
        status_server = await asyncio.start_server(
            self.status_http, self.cfg["status_host"], self.cfg["status_port"])
        self.log(f"status http on {self.cfg['status_host']}:{self.cfg['status_port']}")
        async with status_server:
            await self.initial_probe()
            await self.health_loop()


def main():
    cfg = load_config()
    os.makedirs(os.path.dirname(cfg["status_file"]), exist_ok=True)
    pool = Pool(cfg)
    asyncio.run(pool.run())


if __name__ == "__main__":
    main()
