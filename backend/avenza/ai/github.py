"""Public GitHub access: repository facts for the GitHub plugin and SKILL.md files for skill imports.

Only github.com and raw.githubusercontent.com are ever fetched, so a pasted URL cannot point the server elsewhere.
GITHUB_TOKEN (optional) raises the API limit from 60 to 5,000 requests an hour.
"""
import base64
import re
from urllib.parse import quote

import requests
from flask import current_app

_http = requests.Session()
API = "https://api.github.com"

_REPO_URL = re.compile(
    r"^https?://(?:www\.)?github\.com/(?P<owner>[\w.-]+)/(?P<repo>[\w.-]+?)(?:\.git)?"
    r"(?:/(?P<kind>blob|tree)/(?P<ref>[^/]+)(?:/(?P<path>.*?))?)?/?(?:[?#].*)?$", re.I)
_RAW_URL = re.compile(r"^https?://raw\.githubusercontent\.com/(?P<owner>[\w.-]+)/(?P<repo>[\w.-]+)/(?P<ref>[^/]+)/(?P<path>.+)$", re.I)


class GitHubError(RuntimeError):
    pass


def _headers() -> dict:
    h = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "AVENZA-AI"}
    token = current_app.config.get("GITHUB_TOKEN")
    if token:
        h["Authorization"] = f"Bearer {token}"
    return h


def api(path: str, **params) -> dict | list:
    res = _http.get(f"{API}{path}", headers=_headers(), params=params or None, timeout=8)
    if res.status_code == 404:
        raise GitHubError("Not found on GitHub (check the link, and that the repository is public).")
    if res.status_code in (403, 429) and res.headers.get("X-RateLimit-Remaining") == "0":
        raise GitHubError("GitHub's hourly request limit was reached. Try again later, or set GITHUB_TOKEN.")
    if not res.ok:
        raise GitHubError(f"GitHub returned an error ({res.status_code}).")
    return res.json()


def parse_url(url: str) -> dict | None:
    """{"owner", "repo", "kind", "ref", "path"} for a github.com or raw.githubusercontent.com link, else None."""
    url = url.strip()
    m = _RAW_URL.match(url)
    if m:
        return {**m.groupdict(), "kind": "blob"}
    m = _REPO_URL.match(url)
    if m:
        d = m.groupdict()
        d["path"] = (d["path"] or "").strip("/")
        return d
    return None


def file_text(owner: str, repo: str, path: str, ref: str | None = None) -> str:
    data = api(f"/repos/{owner}/{repo}/contents/{quote(path)}", **({"ref": ref} if ref else {}))
    if not isinstance(data, dict) or data.get("type") != "file":
        raise GitHubError(f"{path} is not a file.")
    return base64.b64decode(data["content"]).decode("utf-8", errors="replace")


def find_files(owner: str, repo: str, ref: str | None, under: str, name: str, limit: int) -> tuple[str, list[str]]:
    """(ref, paths) of files called name (any case) in the repo, below the folder under."""
    if not ref:
        ref = api(f"/repos/{owner}/{repo}")["default_branch"]
    tree = api(f"/repos/{owner}/{repo}/git/trees/{quote(ref)}", recursive="1").get("tree", [])
    prefix = f"{under.strip('/')}/" if under.strip("/") else ""
    paths = sorted((t["path"] for t in tree if t["type"] == "blob" and t["path"].startswith(prefix)
                    and t["path"].rsplit("/", 1)[-1].lower() == name.lower()), key=lambda p: (p.count("/"), p))
    return ref, paths[:limit]


def repo_summary(owner: str, repo: str) -> dict:
    """Repository facts, latest release and the start of the README, for a cited plugin passage."""
    r = api(f"/repos/{owner}/{repo}")
    facts = [f"{r['full_name']}: {r.get('description') or 'no description'}.",
             f"Stars {r['stargazers_count']:,}, forks {r['forks_count']:,}, open issues and pull requests {r['open_issues_count']:,}, "
             f"watchers {r['subscribers_count']:,}."]
    if r.get("language"):
        facts.append(f"Main language: {r['language']}.")
    if r.get("license"):
        facts.append(f"License: {r['license'].get('spdx_id') or r['license'].get('name')}.")
    facts.append(f"Default branch {r['default_branch']}; created {r['created_at'][:10]}; last push {r['pushed_at'][:10]}.")
    if r.get("archived"):
        facts.append("The repository is archived (read-only).")
    if r.get("topics"):
        facts.append("Topics: " + ", ".join(r["topics"][:12]) + ".")
    try:
        rel = api(f"/repos/{owner}/{repo}/releases/latest")
        facts.append(f"Latest release {rel.get('name') or rel['tag_name']} ({rel['tag_name']}), published {rel['published_at'][:10]}.")
    except GitHubError:
        pass  # many repositories publish no releases
    try:
        readme = api(f"/repos/{owner}/{repo}/readme")
        text = base64.b64decode(readme["content"]).decode("utf-8", errors="replace")
        text = re.sub(r"<[^>]+>|!\[[^\]]*\]\([^)]*\)", " ", text)  # HTML and image badges
        text = re.sub(r"\s+", " ", text).strip()[:1500]
        if text:
            facts.append(f"README (start): {text}")
    except GitHubError:
        pass
    return {"title": r["full_name"], "text": " ".join(facts), "url": r["html_url"]}
