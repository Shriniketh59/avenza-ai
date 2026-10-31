"""Built-in plugins: live tools a user switches on in Settings (stocks, currency, weather, calculator, GitHub).

Each plugin turns a question into exact data from a named source. Its result becomes a cited source passage
(kind "plugin"), so the model answers from it like any other source and never guesses the figure.
Detection is rule-based and fast; a plugin that cannot answer returns None and the normal pipeline carries on.
"""
import ast
import math
import operator
import re
from datetime import datetime

import requests
from flask import current_app

_http = requests.Session()

PLUGINS = {
    "stocks": {
        "name": "Stock prices",
        "description": "Live share and index prices, day change and 52-week range (NSE, BSE, NYSE, NASDAQ…).",
        "source": "Yahoo Finance",
    },
    "currency": {
        "name": "Currency rates",
        "description": "Exchange rates and conversions from the European Central Bank's daily reference rates.",
        "source": "European Central Bank (Frankfurter)",
    },
    "weather": {
        "name": "Weather",
        "description": "Current weather and a 3-day forecast for any city.",
        "source": "Open-Meteo",
    },
    "calculator": {
        "name": "Calculator",
        "description": "Exact arithmetic for expressions like 2450 * 1.18 or (1 + 0.08)^5.",
        "source": "AVENZA calculator",
    },
    "github": {
        "name": "GitHub",
        "description": "Live facts on public repositories: stars, forks, issues, latest release, license and README. "
                       "Paste a github.com link or ask about owner/repo.",
        "source": "GitHub",
    },
}


# --- Detection -----------------------------------------------------------------------------------------------

_CURRENCIES = {
    "usd": "USD", "dollar": "USD", "dollars": "USD", "us dollar": "USD", "$": "USD",
    "inr": "INR", "rupee": "INR", "rupees": "INR", "rs": "INR", "₹": "INR",
    "eur": "EUR", "euro": "EUR", "euros": "EUR", "€": "EUR",
    "gbp": "GBP", "pound": "GBP", "pounds": "GBP", "£": "GBP",
    "jpy": "JPY", "yen": "JPY", "aud": "AUD", "cad": "CAD", "chf": "CHF", "franc": "CHF",
    "cny": "CNY", "yuan": "CNY", "sgd": "SGD", "aed": "AED", "dirham": "AED", "hkd": "HKD",
    "nzd": "NZD", "sek": "SEK", "krw": "KRW", "won": "KRW", "zar": "ZAR", "rand": "ZAR",
    "brl": "BRL", "real": "BRL", "mxn": "MXN", "thb": "THB", "baht": "THB", "myr": "MYR", "ringgit": "MYR",
    "idr": "IDR", "rupiah": "IDR", "php": "PHP", "peso": "PHP", "try": "TRY", "lira": "TRY", "sar": "SAR", "riyal": "SAR",
}
_CUR = r"(\$|₹|€|£|[a-z]{2,10}(?: dollars?)?)"
_CONVERT = re.compile(
    rf"(?:(?P<amount>\d[\d,]*(?:\.\d+)?)\s*)?{_CUR.replace('(', '(?P<src>', 1)}\s*(?:to|in|into|=|vs|against)\s*{_CUR.replace('(', '(?P<dst>', 1)}",
    re.I,
)
_FX_HINT = re.compile(r"\b(exchange rate|conversion|convert|forex|fx rate|rate of)\b|\b(usd|inr|eur|gbp)\b", re.I)

_WEATHER = re.compile(
    r"\b(weather|temperature|forecast|rain(ing)?|humid(ity)?|hot|cold|sunny)\b.*?\b(?:in|at|for|of)\s+"
    r"(?P<place>[a-z][a-z .'-]{1,40}?)(?:\s+(?:today|tomorrow|now|this week|right now))?\s*[?.!]*$",
    re.I,
)

# Tried in order: "share price of X" first, so "what is the share price of X" is not read as company "what is the".
_STOCK = [
    re.compile(r"\b(?:share|stock|equity|index)\s+(?:price|value|quote|rate)\s+(?:of|for)\s+(?P<name>[\w&.\- ]{2,40}?)"
               r"\s*(?:today|now|right now)?\s*[?.!]*$", re.I),
    re.compile(r"\b(?:price|quote)\s+of\s+(?P<name>[\w&.\- ]{2,40}?)\s+(?:share|stock)s?\b", re.I),
    re.compile(r"(?P<name>[\w&.\- ]{2,40}?)\s+(?:share|stock)\s+(?:price|quote|value)\s*(?:today|now)?\s*[?.!]*$", re.I),
    # "infosys stock": only as the whole (short) message, so "should i buy stocks" is not a company lookup.
    re.compile(r"^\s*(?P<name>[\w&.\-]{2,25}(?: [\w&.\-]{2,25})?)\s+(?:share|stock)\s*[?.!]*$", re.I),
    re.compile(r"\b(?P<name>nifty(?: ?50| bank)?|sensex|nasdaq|dow jones|s&p ?500)\b", re.I),
]
_FILLER = re.compile(r"^(?:what(?:'s| is| are)?|how(?:'s| is| much is)?|tell me|show me|give me|check|the|current|today'?s|"
                     r"latest|live|price of|of|is)\s+", re.I)
_INDEXES = {"nifty": "^NSEI", "nifty 50": "^NSEI", "nifty50": "^NSEI", "nifty bank": "^NSEBANK", "sensex": "^BSESN",
            "nasdaq": "^IXIC", "dow jones": "^DJI", "s&p 500": "^GSPC", "s&p500": "^GSPC"}

_GH_URL = re.compile(r"github\.com/(?P<owner>[\w.-]+)/(?P<repo>[\w.-]+)", re.I)
_GH_SLUG = re.compile(r"(?<![\w./])(?P<owner>[A-Za-z0-9][\w-]{0,38})/(?P<repo>[\w.-]{1,100})(?![\w/])")
_GH_HINT = re.compile(r"\b(github|repo|repository|stars?|forks?|release)\b", re.I)
_GH_NAME = re.compile(r"\b(?:github\s+(?:repo(?:sitory)?\s+)?(?:of|for)\s+|(?:repo(?:sitory)?|github)\s+(?:of|for)\s+)"
                      r"(?P<name>[\w.\- ]{2,40}?)\s*[?.!]*$|^\s*(?P<name2>[\w.\-]{2,40})\s+(?:github|repo)\s*[?.!]*$", re.I)

_CALC_HINT = re.compile(r"^\s*(calculate|compute|what is|what's|evaluate|solve)?\s*[(\d.]", re.I)
_EXPR = re.compile(r"[\d.\s+\-*/×÷^%(),]+")


def _currency_code(word: str) -> str | None:
    w = word.lower().strip()
    return _CURRENCIES.get(w) or _CURRENCIES.get(re.sub(r"\s*dollars?$", "", w))


def detect(question: str, enabled: set[str]) -> list[tuple[str, dict]]:
    """Plugin calls this question needs, among the enabled plugins: [(plugin id, arguments)]."""
    q = question.strip()
    calls = []
    if "currency" in enabled:
        # Overlapping matches: "the dollar to rupee" first reads "the dollar" as a currency, so try each word start.
        for start in [0, *(m.end() for m in re.finditer(r"\s+", q))]:
            m = _CONVERT.match(q, start)
            if not m:
                continue
            src, dst = _currency_code(m["src"]), _currency_code(m["dst"])
            if src and dst and src != dst and (m["amount"] or _FX_HINT.search(q) or len(q.split()) <= 8):
                calls.append(("currency", {"src": src, "dst": dst, "amount": float((m["amount"] or "1").replace(",", ""))}))
                break
    if "weather" in enabled:
        m = _WEATHER.search(q)
        if m:
            calls.append(("weather", {"place": m["place"].strip(" .?!")}))
    if "stocks" in enabled and not calls:
        for pattern in _STOCK:
            m = pattern.search(q)
            if not m:
                continue
            name = m["name"].strip()
            while _FILLER.match(name):
                name = _FILLER.sub("", name, count=1)
            if len(name) >= 2 and not re.search(r"\b(i|my|our|your|buy|sell|should|which|best|good|top|are|is|"
                                                 r"what|why|how|invest|portfolio|this|that|these|those|their|its)\b", name, re.I):
                calls.append(("stocks", {"name": name}))
                break
    if "github" in enabled and not calls:
        m = _GH_URL.search(q) or (_GH_HINT.search(q) and _GH_SLUG.search(q))
        if m:
            calls.append(("github", {"owner": m["owner"], "repo": m["repo"].removesuffix(".git").rstrip(".")}))
        else:
            m = _GH_NAME.search(q)
            if m:
                calls.append(("github", {"search": (m["name"] or m["name2"]).strip()}))
    if "calculator" in enabled and not calls:
        body = re.sub(r"^\s*(calculate|compute|what is|what's|evaluate|solve)\s*", "", q, flags=re.I).rstrip(" ?=.")
        if _CALC_HINT.match(q) and _EXPR.fullmatch(body) and re.search(r"\d\s*[-+*/×÷^%]\s*\(?\d", body):
            calls.append(("calculator", {"expr": body}))
    return calls


# --- Plugins -------------------------------------------------------------------------------------------------

def _item(pid: str, title: str, text: str, url: str | None = None) -> dict:
    return {"kind": "plugin", "label": PLUGINS[pid]["source"], "title": title, "text": text, "url": url, "score": 20.0}


def _fmt(x: float, digits: int = 2) -> str:
    return f"{x:,.{digits}f}"


def currency(src: str, dst: str, amount: float = 1.0) -> dict | None:
    res = _http.get("https://api.frankfurter.dev/v1/latest", params={"base": src, "symbols": dst}, timeout=6)
    if not res.ok:
        return None
    data = res.json()
    rate = data["rates"].get(dst)
    if rate is None:
        return None
    text = (f"Exchange rate on {data['date']} (European Central Bank reference rate): 1 {src} = {rate} {dst}; "
            f"1 {dst} = {round(1 / rate, 6)} {src}.")
    if amount != 1:
        text += f" {_fmt(amount)} {src} = {_fmt(amount * rate)} {dst}."
    text += " Reference rates are published once per working day; bank and card rates differ."
    return _item("currency", f"{src} to {dst}", text, f"https://www.frankfurter.app/?from={src}&to={dst}")


_WMO = {0: "clear sky", 1: "mainly clear", 2: "partly cloudy", 3: "overcast", 45: "fog", 48: "fog", 51: "light drizzle",
        53: "drizzle", 55: "heavy drizzle", 61: "light rain", 63: "rain", 65: "heavy rain", 71: "light snow", 73: "snow",
        75: "heavy snow", 80: "rain showers", 81: "rain showers", 82: "violent rain showers", 95: "thunderstorm",
        96: "thunderstorm with hail", 99: "thunderstorm with hail"}


def weather(place: str) -> dict | None:
    geo = _http.get("https://geocoding-api.open-meteo.com/v1/search", params={"name": place, "count": 1}, timeout=6).json()
    if not geo.get("results"):
        return None
    loc = geo["results"][0]
    res = _http.get("https://api.open-meteo.com/v1/forecast", timeout=6, params={
        "latitude": loc["latitude"], "longitude": loc["longitude"], "timezone": "auto", "forecast_days": 3,
        "current": "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m",
        "daily": "temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code",
    }).json()
    cur, day = res["current"], res["daily"]
    where = ", ".join(x for x in (loc["name"], loc.get("admin1"), loc.get("country")) if x)
    text = (f"Weather in {where} at {cur['time'].replace('T', ' ')} local time: {_WMO.get(cur['weather_code'], 'unknown')}, "
            f"{cur['temperature_2m']} °C (feels like {cur['apparent_temperature']} °C), humidity {cur['relative_humidity_2m']}%, "
            f"wind {cur['wind_speed_10m']} km/h. Forecast: ")
    text += "; ".join(
        f"{d}: {_WMO.get(c, 'unknown')}, {lo}–{hi} °C, rain chance {p}%"
        for d, c, lo, hi, p in zip(day["time"], day["weather_code"], day["temperature_2m_min"],
                                   day["temperature_2m_max"], day["precipitation_probability_max"])
    ) + "."
    return _item("weather", f"Weather · {loc['name']}", text, f"https://open-meteo.com/en/docs#latitude={loc['latitude']}&longitude={loc['longitude']}")


def stock(name: str) -> dict | None:
    import yfinance as yf

    symbol = _INDEXES.get(name.lower())
    if symbol is None and re.fullmatch(r"\^[A-Z0-9.]{1,12}|[A-Z0-9\-]{1,12}\.[A-Z]{1,3}", name):
        symbol = name  # an exchange ticker: TCS.NS, ^NSEI (a bare "TCS" is looked up, which finds the NSE listing)
    if symbol is None:
        quotes = [q for q in yf.Search(name, max_results=5).quotes if q.get("quoteType") in ("EQUITY", "INDEX", "ETF")]
        if not quotes:
            return None
        # Prefer the Indian listing when the company has one (most users are in India), else the first match.
        quotes.sort(key=lambda q: 0 if str(q.get("symbol", "")).endswith((".NS", ".BO")) else 1)
        symbol = quotes[0]["symbol"]
        title = quotes[0].get("longname") or quotes[0].get("shortname") or symbol
    else:
        title = name.upper() if symbol == name else name.title()
    fi = yf.Ticker(symbol).fast_info
    price, prev = fi["lastPrice"], fi.get("previousClose")
    if price is None or (isinstance(price, float) and math.isnan(price)):
        return None
    cur = fi.get("currency") or ""
    text = f"{title} ({symbol}) last price {_fmt(price)} {cur}"
    if prev:
        change = price - prev
        text += f", previous close {_fmt(prev)} {cur}, change {change:+,.2f} ({change / prev * 100:+.2f}%)"
    lo, hi = fi.get("yearLow"), fi.get("yearHigh")
    if lo and hi:
        text += f"; 52-week range {_fmt(lo)}–{_fmt(hi)} {cur}"
    text += f". Retrieved {datetime.now():%d %b %Y %H:%M}; prices may be delayed up to 15 minutes."
    return _item("stocks", f"{title} · {symbol}", text, f"https://finance.yahoo.com/quote/{symbol}")


_OPS = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv,
        ast.Pow: operator.pow, ast.Mod: operator.mod, ast.USub: operator.neg, ast.UAdd: operator.pos}


def _eval(node):
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return node.value
    if isinstance(node, ast.BinOp) and type(node.op) in _OPS:
        left, right = _eval(node.left), _eval(node.right)
        if isinstance(node.op, ast.Pow) and abs(right) > 100:
            raise ValueError("exponent too large")
        return _OPS[type(node.op)](left, right)
    if isinstance(node, ast.UnaryOp) and type(node.op) in _OPS:
        return _OPS[type(node.op)](_eval(node.operand))
    raise ValueError("unsupported expression")


def calculator(expr: str) -> dict | None:
    """Exact arithmetic. Only numbers and + - * / ^ % ( ) are allowed (no names, calls or attributes)."""
    clean = expr.replace("×", "*").replace("÷", "/").replace("^", "**").replace(",", "")
    try:
        value = _eval(ast.parse(clean, mode="eval").body)
    except (SyntaxError, ValueError, ZeroDivisionError, OverflowError):
        return None
    shown = f"{value:,.10g}" if isinstance(value, float) else f"{value:,}"
    return _item("calculator", "Calculation", f"{expr.strip()} = {shown}")


def github_repo(owner: str | None = None, repo: str | None = None, search: str | None = None) -> dict | None:
    from . import github

    if search:
        found = github.api("/search/repositories", q=search, per_page=1).get("items") or []
        if not found:
            return None
        owner, repo = found[0]["owner"]["login"], found[0]["name"]
    try:
        info = github.repo_summary(owner, repo)
    except github.GitHubError:
        return None
    text = info["text"] + f" Retrieved {datetime.now():%d %b %Y %H:%M}."
    return _item("github", f"GitHub · {info['title']}", text, info["url"])


_RUN = {"currency": currency, "weather": weather, "stocks": stock, "calculator": calculator, "github": github_repo}
_ARGS = {"currency": lambda a: (a["src"], a["dst"], a["amount"]), "weather": lambda a: (a["place"],),
         "stocks": lambda a: (a["name"],), "calculator": lambda a: (a["expr"],),
         "github": lambda a: (a.get("owner"), a.get("repo"), a.get("search"))}


def run(pid: str, args: dict) -> dict | None:
    """Run one plugin; None when it cannot answer (unknown place or company, source offline)."""
    try:
        return _RUN[pid](*_ARGS[pid](args))
    except Exception as exc:  # network, unexpected response: the question goes on without this plugin
        current_app.logger.warning("plugin %s failed: %s", pid, exc)
        return None
