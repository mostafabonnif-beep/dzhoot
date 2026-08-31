import json, urllib.request, sys

BASE = "https://iptv.ld-11.net"
CODE = "T24VKT"
results = []

def call(path, method="GET", body=None, code=CODE):
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header("X-TV-Code", code)
    req.add_header("Accept", "application/json")
    if body is not None:
        req.add_header("Content-Type", "application/json")
        req.data = json.dumps(body).encode()
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read().decode() or "{}")
        except Exception: return e.code, {}
    except Exception as e:
        return 0, {"_err": str(e)}

def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("PASS" if ok else "FAIL"), "-", name, ("| " + detail if detail else ""))

s, d = call("/api/v1/app/version?currentVersion=10037")
check("app/version", s==200 and d.get("updateAvailable") in (True,False) and bool(d.get("latestVersion")), str((d.get("latestVersion") or {}).get("versionName")))

s, d = call("/api/v1/channels")
ch = d.get("data") or []
check("channels sync", s==200 and len(ch)>1000, f"count={len(ch)}")
if ch:
    c = ch[0]
    need = ["channelId","channelName","channelUrl","channelImg","channelGroup","metadata","catchup","alternateStreams"]
    missing = [k for k in need if k not in c]
    check("channel fields", not missing, f"missing={missing}")
    check("channelUrl present(blank ok)", "channelUrl" in c, repr(c.get("channelUrl",""))[:40])

s, d = call("/api/v1/tv/epg/%s/json?hours=6" % CODE)
ech = d.get("channels") or []
check("epg json", s==200 and len(ech)>0, f"channels={len(ech)} progCount={d.get('programCount')}")
if ech:
    e0 = ech[0]
    missing = [k for k in ["channelId","channelName","tvgLogo","programs"] if k not in e0]
    check("epg channel fields", not missing, f"missing={missing}")
    progs = e0.get("programs") or []
    if progs:
        pm = [k for k in ["title","description","start","end"] if k not in progs[0]]
        check("epg program fields", not pm, f"missing={pm}")

chid = ch[0]["channelId"] if ch else None
if chid:
    s, d = call("/api/v1/tv/playback-token", "POST", {"channelId": chid, "slot": 0})
    data = d.get("data") or {}
    need = ["playbackUrl","proxyPlaybackUrl","mimeType","expiresAt","slot"]
    missing = [k for k in need if k not in data]
    check("playback-token slot0", s==200 and data.get("playbackUrl","").startswith("http"), f"missing={missing} url={str(data.get('playbackUrl',''))[:50]}")
    if data.get("playbackUrl"):
        try:
            req = urllib.request.Request(data["playbackUrl"], headers={"Accept":"*/*"})
            with urllib.request.urlopen(req, timeout=30) as r:
                body = r.read(200).decode("utf-8", "replace")
                check("playback m3u8 fetch", r.status==200 and "#EXTM3U" in body, f"status={r.status}")
        except Exception as e:
            check("playback m3u8 fetch", False, str(e))
    s, d = call("/api/v1/tv/playback-token", "POST", {"channelId": chid, "slot": 1})
    check("playback-token slot1 (404=no alt ok)", s in (200,404), f"status={s}")

s, d = call("/api/v1/catalog/movies?page=1&limit=5")
mv = d.get("data") or []
check("catalog/movies", s==200 and len(mv)>0, f"count={len(mv)}")
if mv:
    m0 = mv[0]
    missing = [k for k in ["_id","title","category","poster","backdrop","year","duration","rating"] if k not in m0]
    check("movie fields", not missing, f"missing={missing} keys={list(m0.keys())[:12]}")

s, d = call("/api/v1/catalog/series?page=1&limit=5")
sv = d.get("data") or []
check("catalog/series", s==200 and len(sv)>0, f"count={len(sv)}")
if sv:
    s0 = sv[0]
    missing = [k for k in ["_id","title","category","poster","backdrop","plot","genre","rating"] if k not in s0]
    check("series fields", not missing, f"missing={missing} keys={list(s0.keys())[:12]}")

if mv:
    mid = mv[0]["_id"]
    s, d = call("/api/v1/catalog/movies/%s" % mid)
    check("movie detail", s==200, str(d.get("error",""))[:60])
    s, d = call("/api/v1/tv/playback-token", "POST", {"movieId": mid})
    data = d.get("data") or {}
    ok = s==200 and data.get("playbackUrl","").startswith("http")
    check("playback-token movie", ok, f"status={s} err={str(d.get('error',''))[:40]} mime={data.get('mimeType')}")

if sv:
    sid = sv[0]["_id"]
    s, d = call("/api/v1/catalog/series/%s/seasons" % sid)
    seas = d.get("data") or []
    check("series seasons", s==200, f"seasons={len(seas)}")
    if seas:
        ss = seas[0]
        missing = [k for k in ["_id","seriesId","seasonNumber","name"] if k not in ss]
        check("season fields", not missing, f"missing={missing}")
        s, d = call("/api/v1/catalog/seasons/%s/episodes" % ss["_id"])
        eps = d.get("data") or []
        check("season episodes", s==200, f"episodes={len(eps)}")
        if eps:
            e0 = eps[0]
            missing = [k for k in ["_id","seriesId","seasonId","episodeNumber","title"] if k not in e0]
            check("episode fields", not missing, f"missing={missing}")
            s, d = call("/api/v1/tv/playback-token", "POST", {"episodeId": e0["_id"]})
            data = d.get("data") or {}
            ok = s==200 and data.get("playbackUrl","").startswith("http")
            check("playback-token episode", ok, f"status={s} err={str(d.get('error',''))[:40]} mime={data.get('mimeType')}")

s, d = call("/api/v1/categories")
check("categories", s==200, f"count={len(d.get('categories') or [])}")
s, d = call("/api/v1/favorites", "GET")
check("favorites", s in (200,401), f"status={s}")
s, d = call("/api/v1/channels/health-sync", "POST", {"reports":[]})
check("health-sync", s in (200,400), f"status={s} err={str(d.get('error',''))[:50]}")
if chid:
    import time
    s, d = call("/api/v1/channels/%s/report-play" % chid, "POST", {"deviceId": "contract-test", "timestamp": int(time.time()*1000), "proxyPlay": False})
    check("report-play", s in (200,202,429), f"status={s}")

fails = [r for r in results if not r[1]]
print("\n==== SUMMARY: %d checks, %d FAILED ====" % (len(results), len(fails)))
for f in fails:
    print("  FAILED:", f[0], f[2])
