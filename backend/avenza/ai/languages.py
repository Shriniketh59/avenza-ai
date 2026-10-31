"""The language AVENZA replies in: the user's own (auto) or one picked in Settings."""
import re

_NAME = re.compile(r"[^\W\d_][\w ()'-]{1,40}")

AUTO_RULE = ("Language: reply in the language of the user's latest message, in its usual script (Hindi in Devanagari, "
             "Arabic in Arabic script and so on), never in the language of the sources. If they mix languages, like "
             "Hinglish, reply in the same mix. Keep code, commands, ticker symbols, units and quoted source text as they are.")

ENGLISH_RULE = ("Language: the user wrote in English, so reply in English, even when the sources or earlier messages "
                "are in another language (translate what you take from them). Keep code, commands and ticker symbols as they are.")

# Frequent English words: a Latin-script message made of these is English, not Hinglish ("kya haal hai") or Spanish.
_EN = set("""a an the is are was were be been am do does did have has had i you he she it we they me my your his her its our
their this that these those what who whom whose which when where why how not no yes and or but if then so of to in on at by
for with from about as into than too very can could will would should shall may might must please tell explain give show
make write find list compare between there here all any some more most other new latest current today now
hello hi hey thanks thank good morning evening""".split())


def is_english(text: str) -> bool:
    words = re.findall(r"[a-z']+", text.lower())
    if not words or re.search(r"[^\x00-\x7f\u2018\u2019\u201c\u201d\u2013\u2014\u20b9\u20ac\u00a3]", text):
        return False
    hits = sum(w in _EN for w in words)
    return hits >= 1 and hits / len(words) >= (0.15 if len(words) >= 6 else 0.1)


def reply_rule(language: str, message: str = "") -> str:
    """System-prompt rule for the reply language. language is "auto" or a language name from Settings ("Hindi");
    with "auto", an English message is answered in English whatever language the sources are in."""
    language = language.strip()
    if language.lower() in ("", "auto") or not _NAME.fullmatch(language):
        return ENGLISH_RULE if is_english(message) else AUTO_RULE
    return (f"Language: write your whole reply in {language}, in its standard script, whatever language the message "
            "or the sources are in (translate what you take from them). Keep code, commands, ticker symbols, units, "
            "names and citation numbers as they are.")
