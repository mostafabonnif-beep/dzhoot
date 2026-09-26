#!/bin/sh
# DZ HOOF relay firewall — restricts TCP/9001 to the production docker subnet + loopback.
# Idempotent: removes every existing :9001 rule, then installs the exact ordered set.
set -e
PORT=9001
SUBNET=172.19.0.0/16

nums=$(iptables -L INPUT --line-numbers -n 2>/dev/null | awk "/dpt:$PORT/ {print \$1}" | sort -rn)
for n in $nums; do iptables -D INPUT "$n" || true; done

# Three inserts at position 1 leave the order: 127 ACCEPT, SUBNET ACCEPT, DROP others.
iptables -I INPUT 1 -p tcp --dport "$PORT" ! -s "$SUBNET" -j DROP
iptables -I INPUT 1 -p tcp --dport "$PORT" -s "$SUBNET" -j ACCEPT
iptables -I INPUT 1 -p tcp --dport "$PORT" -s 127.0.0.0/8 -j ACCEPT
