"""The language AVENZA replies in: the user's own (auto) or one picked in Settings."""
import re

_NAME = re.compile(r"[^\W\d_][\w ()'-]{1,40}")

AUTO_RULE = ("Language: reply in the language of the user's latest message, in its usual script (Hindi in Devanagari, "
             "Arabic in Arabic script and so on). If they mix languages, like Hinglish, reply in the same mix. "
             "Keep code, commands, ticker symbols, units and quoted source text as they are.")


def reply_rule(language: str) -> str:
    """System-prompt rule for the reply language. language is "auto" or a language name from Settings ("Hindi")."""
    language = language.strip()
    if language.lower() in ("", "auto") or not _NAME.fullmatch(language):
        return AUTO_RULE
    return (f"Language: write your whole reply in {language}, in its standard script, whatever language the message "
            "or the sources are in (translate what you take from them). Keep code, commands, ticker symbols, units, "
            "names and citation numbers as they are.")
