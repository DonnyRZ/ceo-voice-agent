"""Inspect public ingress metadata without printing configuration secrets."""
import json
from pathlib import Path
import re
import shutil
import subprocess


def run(arguments):
    try:
        result = subprocess.run(arguments, capture_output=True, text=True, timeout=10)
        return result.returncode, result.stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        return None, ''


services = {}
for service in ('nginx', 'caddy', 'apache2', 'haproxy'):
    code, _ = run(['systemctl', 'is-active', '--quiet', service])
    services[service] = code == 0
print(json.dumps({'services': services, 'tools': {
    name: bool(shutil.which(name)) for name in ('nginx', 'caddy', 'certbot', 'sudo')
}}, sort_keys=True))
code, _ = run(['sudo', '-n', 'true'])
print(json.dumps({'sudo_noninteractive_true': code == 0}))
_, ports = run(['ss', '-ltnH'])
print(json.dumps({'listeners': [line.split()[3] for line in ports.splitlines() if len(line.split()) >= 4]}))
_, containers = run(['docker', 'ps', '--format', '{{.Names}}\t{{.Image}}\t{{.Ports}}'])
print(json.dumps({'containers': containers.splitlines()}))
for root in (Path('/etc/nginx'), Path('/etc/caddy')):
    if not root.exists():
        continue
    for path in sorted(root.rglob('*')):
        try:
            if not path.is_file() or not path.resolve().is_relative_to(root) or path.stat().st_size > 262144:
                continue
            if path.suffix != '.conf' and path.name != 'Caddyfile' and path.parent.name not in ('sites-enabled', 'sites-available'):
                continue
            text = path.read_text()
        except (OSError, UnicodeError):
            continue
        # Only public routing names and certificate paths; never dump raw configs.
        fields = {}
        for name in ('server_name', 'listen', 'ssl_certificate', 'ssl_certificate_key'):
            values = re.findall(r'^\s*' + name + r'\s+([^;\n]+);', text, re.MULTILINE)
            if values:
                fields[name] = values
        if path.name == 'Caddyfile':
            hosts = re.findall(r'^([a-z0-9.*:-]+(?:\s*,\s*[a-z0-9.*:-]+)*)\s*\{', text, re.MULTILINE)
            if hosts:
                fields['hosts'] = hosts
        if fields:
            print(json.dumps({'config': str(path), **fields}, sort_keys=True))
