"""Which site to talk to and with what token. Imported by the other scripts, never run.

The environment wins, so a shell can point at a staging site without touching the saved config,
and CI can supply both without a file at all:

    PAGES_SITE_URL, PAGES_API_TOKEN               environment
    ${XDG_CONFIG_HOME:-~/.config}/pages/config    saved by pages-login
"""

import json
import os
import urllib.error
import urllib.parse
import urllib.request

CONFIG_FILE = os.path.join(os.environ.get("XDG_CONFIG_HOME") or os.path.expanduser("~/.config"), "pages", "config")
OPENAPI_PATH = "/api/platform/openapi.json"
CALLER_PATH = "/api/platform/caller"


class NotConfigured(Exception):
    pass


def saved():
    values = {}
    if os.path.isfile(CONFIG_FILE):
        # Read as data, never executed: a stray character in a saved value can do nothing.
        with open(CONFIG_FILE, encoding="utf-8") as config:
            for line in config:
                key, _, value = line.rstrip("\n").partition("=")
                values[key] = value
    return values


def resolve():
    stored = saved()
    site = (os.environ.get("PAGES_SITE_URL") or stored.get("site") or "").rstrip("/")
    token = os.environ.get("PAGES_API_TOKEN") or stored.get("token") or ""
    if not site or not token:
        raise NotConfigured("pages: no site configured. Run scripts/pages-login <site-url> with the token on stdin.")
    return site, token


def request(site, token, method, path, body=None, timeout=60):
    """One HTTP call. Returns (status, bytes); the token goes in a header and nowhere else."""
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(site + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()


def query(args):
    """Arguments as the API reads a GET: scalars plain, arrays as name[]=, objects as name[key]=."""
    pairs = []

    def add(name, value):
        if isinstance(value, dict):
            for key, inner in value.items():
                add(f"{name}[{key}]", inner)
        elif isinstance(value, list):
            for inner in value:
                add(f"{name}[]", inner)
        elif isinstance(value, bool):
            pairs.append((name, "true" if value else "false"))
        elif value is not None:
            pairs.append((name, str(value)))

    for name, value in args.items():
        add(name, value)
    return urllib.parse.urlencode(pairs)
