"""The language AVENZA replies in: one the message asks for ("translate to Tamil"), the one picked in Settings,
or the user's own (auto). The chosen language's code also picks the voice that reads the reply aloud."""
import re

# (code, English name, native name): the same list as src/config/languages.ts.
LANGUAGES = [
    ('af', 'Afrikaans', 'Afrikaans'),
    ('sq', 'Albanian', 'Shqip'),
    ('am', 'Amharic', 'አማርኛ'),
    ('ar', 'Arabic', 'العربية'),
    ('hy', 'Armenian', 'Հայերեն'),
    ('as', 'Assamese', 'অসমীয়া'),
    ('az', 'Azerbaijani', 'Azərbaycanca'),
    ('ba', 'Bashkir', 'Башҡортса'),
    ('eu', 'Basque', 'Euskara'),
    ('be', 'Belarusian', 'Беларуская'),
    ('bn', 'Bengali', 'বাংলা'),
    ('bho', 'Bhojpuri', 'भोजपुरी'),
    ('bs', 'Bosnian', 'Bosanski'),
    ('br', 'Breton', 'Brezhoneg'),
    ('bg', 'Bulgarian', 'Български'),
    ('my', 'Burmese', 'မြန်မာ'),
    ('yue', 'Cantonese', '粵語'),
    ('ca', 'Catalan', 'Català'),
    ('ceb', 'Cebuano', 'Cebuano'),
    ('ny', 'Chichewa', 'Chichewa'),
    ('zh', 'Chinese (Simplified)', '简体中文'),
    ('zh-TW', 'Chinese (Traditional)', '繁體中文'),
    ('co', 'Corsican', 'Corsu'),
    ('hr', 'Croatian', 'Hrvatski'),
    ('cs', 'Czech', 'Čeština'),
    ('da', 'Danish', 'Dansk'),
    ('dv', 'Dhivehi', 'ދިވެހި'),
    ('doi', 'Dogri', 'डोगरी'),
    ('nl', 'Dutch', 'Nederlands'),
    ('en', 'English', 'English'),
    ('eo', 'Esperanto', 'Esperanto'),
    ('et', 'Estonian', 'Eesti'),
    ('fo', 'Faroese', 'Føroyskt'),
    ('fil', 'Filipino', 'Filipino'),
    ('fi', 'Finnish', 'Suomi'),
    ('fr', 'French', 'Français'),
    ('fy', 'Frisian', 'Frysk'),
    ('gl', 'Galician', 'Galego'),
    ('ka', 'Georgian', 'ქართული'),
    ('de', 'German', 'Deutsch'),
    ('el', 'Greek', 'Ελληνικά'),
    ('gn', 'Guarani', "Avañe'ẽ"),
    ('gu', 'Gujarati', 'ગુજરાતી'),
    ('ht', 'Haitian Creole', 'Kreyòl ayisyen'),
    ('ha', 'Hausa', 'Hausa'),
    ('haw', 'Hawaiian', 'ʻŌlelo Hawaiʻi'),
    ('he', 'Hebrew', 'עברית'),
    ('hi', 'Hindi', 'हिन्दी'),
    ('hmn', 'Hmong', 'Hmoob'),
    ('hu', 'Hungarian', 'Magyar'),
    ('is', 'Icelandic', 'Íslenska'),
    ('ig', 'Igbo', 'Igbo'),
    ('id', 'Indonesian', 'Bahasa Indonesia'),
    ('ga', 'Irish', 'Gaeilge'),
    ('it', 'Italian', 'Italiano'),
    ('ja', 'Japanese', '日本語'),
    ('jw', 'Javanese', 'Basa Jawa'),
    ('kn', 'Kannada', 'ಕನ್ನಡ'),
    ('ks', 'Kashmiri', 'कॉशुर'),
    ('kk', 'Kazakh', 'Қазақ'),
    ('km', 'Khmer', 'ខ្មែរ'),
    ('rw', 'Kinyarwanda', 'Kinyarwanda'),
    ('kok', 'Konkani', 'कोंकणी'),
    ('ko', 'Korean', '한국어'),
    ('ku', 'Kurdish', 'Kurdî'),
    ('ky', 'Kyrgyz', 'Кыргызча'),
    ('lo', 'Lao', 'ລາວ'),
    ('la', 'Latin', 'Latina'),
    ('lv', 'Latvian', 'Latviešu'),
    ('ln', 'Lingala', 'Lingála'),
    ('lt', 'Lithuanian', 'Lietuvių'),
    ('lb', 'Luxembourgish', 'Lëtzebuergesch'),
    ('mk', 'Macedonian', 'Македонски'),
    ('mai', 'Maithili', 'मैथिली'),
    ('mg', 'Malagasy', 'Malagasy'),
    ('ms', 'Malay', 'Bahasa Melayu'),
    ('ml', 'Malayalam', 'മലയാളം'),
    ('mt', 'Maltese', 'Malti'),
    ('mi', 'Maori', 'Te Reo Māori'),
    ('mr', 'Marathi', 'मराठी'),
    ('mni', 'Meitei (Manipuri)', 'ꯃꯤꯇꯩꯂꯣꯟ'),
    ('mn', 'Mongolian', 'Монгол'),
    ('ne', 'Nepali', 'नेपाली'),
    ('no', 'Norwegian', 'Norsk'),
    ('nn', 'Norwegian Nynorsk', 'Nynorsk'),
    ('oc', 'Occitan', 'Occitan'),
    ('or', 'Odia', 'ଓଡ଼ିଆ'),
    ('om', 'Oromo', 'Afaan Oromoo'),
    ('ps', 'Pashto', 'پښتو'),
    ('fa', 'Persian', 'فارسی'),
    ('pl', 'Polish', 'Polski'),
    ('pt', 'Portuguese', 'Português'),
    ('pa', 'Punjabi', 'ਪੰਜਾਬੀ'),
    ('qu', 'Quechua', 'Runasimi'),
    ('ro', 'Romanian', 'Română'),
    ('ru', 'Russian', 'Русский'),
    ('sm', 'Samoan', 'Gagana Samoa'),
    ('sa', 'Sanskrit', 'संस्कृतम्'),
    ('sat', 'Santali', 'ᱥᱟᱱᱛᱟᱲᱤ'),
    ('gd', 'Scottish Gaelic', 'Gàidhlig'),
    ('sr', 'Serbian', 'Српски'),
    ('st', 'Sesotho', 'Sesotho'),
    ('sn', 'Shona', 'ChiShona'),
    ('sd', 'Sindhi', 'سنڌي'),
    ('si', 'Sinhala', 'සිංහල'),
    ('sk', 'Slovak', 'Slovenčina'),
    ('sl', 'Slovenian', 'Slovenščina'),
    ('so', 'Somali', 'Soomaali'),
    ('es', 'Spanish', 'Español'),
    ('su', 'Sundanese', 'Basa Sunda'),
    ('sw', 'Swahili', 'Kiswahili'),
    ('sv', 'Swedish', 'Svenska'),
    ('tl', 'Tagalog', 'Tagalog'),
    ('tg', 'Tajik', 'Тоҷикӣ'),
    ('ta', 'Tamil', 'தமிழ்'),
    ('tt', 'Tatar', 'Татарча'),
    ('te', 'Telugu', 'తెలుగు'),
    ('th', 'Thai', 'ไทย'),
    ('bo', 'Tibetan', 'བོད་ཡིག'),
    ('ti', 'Tigrinya', 'ትግርኛ'),
    ('tr', 'Turkish', 'Türkçe'),
    ('tk', 'Turkmen', 'Türkmençe'),
    ('uk', 'Ukrainian', 'Українська'),
    ('ur', 'Urdu', 'اردو'),
    ('ug', 'Uyghur', 'ئۇيغۇرچە'),
    ('uz', 'Uzbek', 'Oʻzbek'),
    ('vi', 'Vietnamese', 'Tiếng Việt'),
    ('cy', 'Welsh', 'Cymraeg'),
    ('xh', 'Xhosa', 'isiXhosa'),
    ('yi', 'Yiddish', 'ייִדיש'),
    ('yo', 'Yoruba', 'Yorùbá'),
    ('zu', 'Zulu', 'isiZulu'),
]
_BY_NAME = {n.lower(): (c, n) for c, n, _ in LANGUAGES} | {nat.lower(): (c, n) for c, n, nat in LANGUAGES if nat}
_BY_NAME |= {"chinese": ("zh", "Chinese (Simplified)"), "mandarin": ("zh", "Chinese (Simplified)"),
             "farsi": ("fa", "Persian"), "oriya": ("or", "Odia"), "punjabi": ("pa", "Punjabi"),
             "hinglish": ("hi", "Hinglish (Hindi in Latin letters mixed with English)")}
# Longest names first, so "Malayalam" is not read as "Malay".
_NAMES = "|".join(sorted((re.escape(k) for k in _BY_NAME), key=len, reverse=True))
_ASKED = re.compile(
    rf"(?:\b(?:in|into|to)\s+|\btranslat\w*\b.*?\b(?:in|into|to)\s+)(?P<lang>{_NAMES})(?![\w\u0300-\u036f\u0900-\u0dff])"
    rf"|\b(?P<lang2>{_NAMES})\s+(?:translation|version|language)\b",
    re.I,
)
# "to Polish this paragraph", "turn it into a Swedish-style table": a language name that is not the reply language.
_NOT_LANGUAGE = re.compile(r"^\s*(?:polish|turkish|swedish|dutch|french)\s+(?:it|this|that|the|my|a)\b", re.I)


_PHRASE = re.compile(r"\bhow (?:do|would|can) (?:you|i|we) say\b|\bhow to say\b|\bwhat(?:'s| is| are) (?:the )?(?:word|words|phrase) for\b"
                     r"|\bwhat does .+ mean\b", re.I)


def requested(message: str) -> tuple[str, str] | None:
    """(code, name) of a language the message asks the answer to be in: "translate this to Tamil",
    "explain EMI in Hindi", "Spanish version please". None when it asks for none."""
    for m in _ASKED.finditer(message):
        word = m["lang"] or m["lang2"]
        if _NOT_LANGUAGE.match(message[m.start("lang" if m["lang"] else "lang2"):]):
            continue
        return _BY_NAME[word.lower()]
    return None


def by_code(code: str) -> tuple[str, str] | None:
    return next(((c, n) for c, n, _ in LANGUAGES if c == code), None)

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


_SCRIPTS = [(r"[\u0900-\u097f]", "hi"), (r"[\u0980-\u09ff]", "bn"), (r"[\u0b80-\u0bff]", "ta"), (r"[\u0c00-\u0c7f]", "te"),
            (r"[\u0c80-\u0cff]", "kn"), (r"[\u0d00-\u0d7f]", "ml"), (r"[\u0a80-\u0aff]", "gu"), (r"[\u0a00-\u0a7f]", "pa"),
            (r"[\u0600-\u06ff]", "ar"), (r"[\u0590-\u05ff]", "he"), (r"[\u0400-\u04ff]", "ru"), (r"[\u0370-\u03ff]", "el"),
            (r"[\u0e00-\u0e7f]", "th"), (r"[\uac00-\ud7af]", "ko"), (r"[\u3040-\u30ff]", "ja"), (r"[\u4e00-\u9fff]", "zh")]


def script_language(text: str) -> str | None:
    """Language code suggested by a non-Latin script that makes up most of the letters (Devanagari -> hi)."""
    letters = re.sub(r"[\W\d_]+", "", text)
    if not letters:
        return None
    for pattern, code in _SCRIPTS:
        if len(re.findall(pattern, letters)) / len(letters) > 0.3:
            return code
    return None


def reply_rule(language: str, message: str = "") -> tuple[str, str | None]:
    """(system-prompt rule, language code or None) for the reply. A language the message asks for wins, then the
    one picked in Settings ("auto" or a name like "Hindi"); with "auto", an English message is answered in English
    whatever language the sources are in."""
    asked = requested(message)
    if asked and _PHRASE.search(message):
        # "How do you say thank you in Japanese?": the phrase in that language, explained in the user's own.
        code, name = asked
        own = "English" if is_english(message) else "the language of the user's message"
        return (f"Language: give the {name} phrase in its native script, then its pronunciation in Latin letters, then a "
                f"short explanation (meaning, when to use it, a polite or casual variant) in {own}."), None
    if asked:
        code, name = asked
        return (f"Language: the user asked for {name}. Write the whole answer in {name}, in its standard native script "
                f"(for a translation: only the translated text, complete and natural, not word by word; for a question: "
                f"answer it in {name}). Keep names, code, ticker symbols and citation numbers as they are."), code
    language = language.strip()
    if language.lower() in ("", "auto") or not _NAME.fullmatch(language):
        if is_english(message):
            return ENGLISH_RULE, "en"
        return AUTO_RULE, script_language(message)
    found = _BY_NAME.get(language.lower())
    return (f"Language: write your whole reply in {language}, in its standard script, whatever language the message "
            "or the sources are in (translate what you take from them). Keep code, commands, ticker symbols, units, "
            "names and citation numbers as they are."), (found[0] if found else None)
