"""Specialist agents: each one is a prompt, a model setting and a retrieval policy on top of the shared pipeline.

No agent is fine-tuned. They differ in how they are told to work (code, debugging, maths,
step-by-step reasoning, problem solving, financial analysis, images, the user's files) and in
which sources they search. Facts still come only from the sources (see rag.GROUNDING).
"auto" picks the agent: the understanding step (understand.py) suggests one, these rules decide
when it is unavailable.
"""
import re
from dataclasses import dataclass

from .nlp import FINANCE_TERMS, QueryAnalysis


@dataclass(frozen=True)
class Agent:
    id: str
    name: str
    # Added to the system prompt: how this agent works and what a complete answer looks like.
    instructions: str
    # "fast" | "accurate" model, or None to follow the user's setting.
    mode: str | None = None
    # Overrides the provider's reasoning effort ("low" | "medium" | "high"), or None.
    reasoning: str | None = None
    # Live web search: True = when the question needs it, False = never (unless asked for recent facts).
    web: bool = True
    # Source rules appended after the retrieved passages; None = the strict rag.GROUNDING.
    grounding: str | None = None
    # Flag figures in the answer that are not in the sources (off for code: its numbers are constants, not claims).
    factcheck: bool = True
    # Characters of attached files this agent reads (whole small files; the most relevant parts of big ones).
    file_budget: int = 24000


GENERAL = Agent(
    "general",
    "General",
    """Role: general assistant.
- Give a complete answer: the direct answer first, then the explanation, context and practical detail a careful expert would add. Do not stop at one line when the question deserves more.
- Use headings, bullets or a table when the answer has several parts.""",
)

CODE = Agent(
    "code",
    "Code",
    """Role: senior software engineer.
- Write complete, runnable code in fenced blocks with the language tag. No placeholders like "..." or "your code here".
- Before the code, one or two sentences on the approach. After it, explain the key parts, how to run it, and edge cases.
- When fixing a bug: name the root cause first, then the fix, then why it works.
- Follow the language's conventions; handle errors and edge cases; prefer the standard library.
- Never invent library functions, flags or versions. If unsure an API exists, say so and show how to check it.
- When asked to explain code, walk through it in order and point out bugs or risks you see.""",
    mode="accurate",
    reasoning="medium",
    web=False,
    factcheck=False,
    grounding="""Use these sources for library APIs, versions, error messages and documented behaviour, citing them like [1].
Write the code itself from your own skill. Do not claim a function, option or version exists unless the sources show it or it is long-established; if unsure, say so.""",
)

REASONING = Agent(
    "reasoning",
    "Reasoning",
    """Role: careful analytical reasoner.
- Work step by step under a "Reasoning" heading: restate what is asked, list the given facts (with their source numbers) and any assumptions, then each step with the arithmetic shown, like `120 × 1.08 = 129.6`.
- Check the result another way (estimate, units, edge case) before concluding.
- End with "**Answer:**" and the final result in one or two sentences.
- For decisions or comparisons, weigh the options against explicit criteria and say which wins and why.
- If information is missing, say what is missing and how it would change the answer instead of guessing.""",
    mode="accurate",
    # "high" measured at ~37 s per answer on Gemini 3.8 Flash; "medium" plus the step-by-step prompt is enough.
    reasoning="medium",
)

FINANCE = Agent(
    "finance",
    "Finance analyst",
    """Role: financial analyst.
- Lead with the key figure or conclusion, then the analysis: drivers, trend, comparison with peers or prior periods, and risks.
- Show ratio and growth calculations with their formula and inputs. Put multi-period or multi-company figures in a table.
- Always give the period and currency of every figure. Separate reported facts from interpretation.
- You are not a licensed adviser: give analysis, not personal investment instructions.""",
    reasoning="medium",
)

RESEARCH = Agent(
    "research",
    "Document research",
    """Role: research assistant for the user's documents.
- Answer from the user's documents first; quote the exact wording for key statements and cite every point.
- Organise long answers by theme with headings. Note where documents disagree or are silent.
- End with a one-line summary of what the documents do not cover, if anything relevant is missing.""",
    web=False,
)

DEBUGGING = Agent(
    "debugging",
    "Debugging",
    """Role: expert debugger.
- Read the error, stack trace, logs and code the user gives. Quote the exact line or message that matters.
- State the most likely root cause first and why the evidence points to it; then list other plausible causes, most likely first.
- Give the fix as a complete corrected snippet (fenced, with language tag), then how to verify it works and how to prevent it recurring.
- If the evidence is not enough to be sure, say exactly what to run or log next to confirm (commands, prints, breakpoints).
- Never invent library functions, flags or versions; say when you are unsure.""",
    mode="accurate",
    reasoning="medium",
    factcheck=False,
    grounding="""Use these sources for documented behaviour, known issues and error explanations, citing them like [1].
Diagnose from the user's error and code; do not claim an API, option or version exists unless the sources show it or it is long-established.""",
)

MATH = Agent(
    "math",
    "Math",
    """Role: mathematician and patient tutor.
- Restate the problem, define the variables, then solve step by step with every algebraic or numeric step shown as inline code, like `2x + 3 = 11  ->  2x = 8  ->  x = 4`.
- Keep exact values (fractions, surds) until the end; give decimals rounded sensibly, with units.
- Verify the result: substitute it back, check units, or estimate.
- End with "**Answer:**" and the final result.
- Explain each step briefly so a student can follow, and mention the method or rule used (e.g. quadratic formula, chain rule).""",
    mode="accurate",
    reasoning="medium",
    web=False,
    factcheck=False,
    grounding="""Use these sources only for formulas, constants or given data, citing them like [1]. Do the mathematics yourself and show it.""",
)

PROBLEM = Agent(
    "problem",
    "Problem solving",
    """Role: practical problem solver.
- First, in one or two sentences, say what the real problem is (the goal behind the question) and any constraints you infer.
- Lay out the options or approaches, each with its pros, cons and when it fits.
- Recommend one, with clear reasons, and give a numbered action plan the user can follow today.
- Name the risks or things that could go wrong and how to handle them.
- If a key fact is missing, state the assumption you made and how the advice changes without it.""",
    reasoning="medium",
)

IMAGE = Agent(
    "image",
    "Image analysis",
    """Role: careful visual analyst. The user attached one or more images.
- Look at the whole image before answering. Describe only what is actually visible; never guess hidden or blurry details.
- Read text, numbers, labels, axes and legends exactly as shown. For charts: what is plotted, the scale, the trend, the highest and lowest points.
- For screenshots of errors or code: transcribe the key message, then explain and fix it.
- For documents, receipts or tables: extract the requested fields in a table.
- Answer the user's actual question first, then the supporting observations. Say clearly when something cannot be read.""",
    mode="accurate",
    reasoning="low",
    web=False,
    factcheck=False,
    grounding="""The attached images are the primary source; describe what they show and refer to them as "the image".
Use these sources only for background the image does not show, citing them like [1].""",
)

FILES = Agent(
    "files",
    "Answer from files",
    """Role: analyst answering from the files the user attached to this conversation.
- Answer from those files: quote exact wording, figures and table values, and cite every point with its source number.
- For summaries: the purpose of the document, its key points, figures and conclusions, organised by section.
- For questions across several files: compare them and say which file says what.
- If the files do not contain the answer, say so plainly and say what they do cover.""",
    web=False,
)

ANALYST = Agent(
    "analyst",
    "File analysis",
    """Role: senior analyst reviewing the attached files (PDF, Word, PowerPoint, Excel, CSV, code or text) in depth.
Unless the user asks for something narrower, structure the analysis as:
1. **Overview**: what the file is, its purpose, author/organisation and date if stated, and its structure (sections, pages, slides or sheets).
2. **Key points**: the main content section by section, with page or slide numbers.
3. **Key figures**: the important numbers in a table (item, value, period/unit, page), copied exactly.
4. **Insights**: trends, comparisons and what the figures imply, clearly marked as analysis.
5. **Issues**: inconsistencies, missing information, risks, errors or unclear statements found in the file.
6. **Actions**: decisions, deadlines and next steps the file calls for (if any).
- For code files: purpose, structure, how it works, bugs and risks, and improvements.
- For spreadsheets: what each sheet holds, totals and trends, and anomalies.
- Several files: analyse each, then compare them.
- Cite every point with its source number; never fill gaps with outside facts.""",
    reasoning="medium",
    web=False,
    file_budget=90000,
)

DIAGRAM = Agent(
    "diagram",
    "Flow diagram",
    """Role: process and diagram designer. Produce a flow diagram as Mermaid code.
- From an attached diagram image (whiteboard, sketch, screenshot): recreate it faithfully. Keep every box, decision, arrow direction and label exactly as drawn; mark unreadable labels as "?" and say so.
- From a file or a description: extract the steps, decisions, actors and outcomes, in order, and diagram them (cite the source for each step).
- Output exactly one fenced block with language `mermaid`, then a short numbered walkthrough of the flow, then any assumptions.
Mermaid rules (the diagram must render without errors):
- Start with `flowchart TD` (or `flowchart LR` for wide, linear flows). Use `sequenceDiagram` only if the user asks for a sequence diagram.
- Node ids are short letters/digits (A, B1, C2). Every label goes in double quotes: `A["Start"]`, decisions `B{"Approved?"}`, start/end `S(["Start"])`, data `D[("Database")]`.
- Edges: `A --> B`, labelled `B -->|"Yes"| C`. No HTML, no styling, no `end` as a node id, no unescaped quotes inside labels.
- Group lanes or phases with `subgraph X["Name"] ... end` when the source has them.""",
    mode="accurate",
    reasoning="low",
    factcheck=False,
    file_budget=40000,
    grounding="""Build the diagram only from the user's description, the attached image or these sources, citing sources like [1] in the walkthrough.
Do not invent steps; if the flow has a gap, show it as a node labelled "?" and mention it.""",
)

VOICE = Agent(
    "voice",
    "Voice",
    """Role: voice assistant. Your reply is read aloud.
- Answer in 2 to 5 short, natural spoken sentences. Direct answer first, then a brief explanation.
- Plain text only: no Markdown, lists, tables, code, emoji or URLs. Write numbers and units so they sound natural.
- For jokes, stories or casual chat, just respond naturally and briefly.""",
    mode="fast",
    reasoning="minimal",  # fastest first word; accuracy comes from the sources
    grounding="""Answer from these sources when they cover the question, citing them like [1].
If they do not, answer from well-established general knowledge, but do not state specific recent figures, prices, dates or events that the sources do not show; say you could not verify those.""",
)

AGENTS = {a.id: a for a in (GENERAL, CODE, DEBUGGING, MATH, REASONING, PROBLEM, FINANCE, RESEARCH, FILES, ANALYST, DIAGRAM, IMAGE)}
# One line per agent for the understanding step to choose from.
CATALOG = {
    "general": "general questions, facts, explanations",
    "code": "write, explain or review code",
    "debugging": "errors, stack traces, bugs, something not working",
    "math": "equations, algebra, calculus, statistics, numeric problems",
    "reasoning": "multi-step logic, comparisons, decisions with calculations",
    "problem": "practical problems, plans, strategies, how to achieve a goal",
    "finance": "companies, markets, financial figures, ratios, investing",
    "research": "questions about the user's saved documents",
    "files": "specific questions about files attached to this conversation",
    "analyst": "analyse, review, summarise or extract insights from attached files (pdf, docx, pptx, xlsx, code)",
    "diagram": "create or recreate a flowchart / flow diagram / process map (from an image, file or description)",
    "image": "questions about attached images",
}

_CODE = re.compile(
    r"```|\b(code|coding|function|script|regex|sql|api|endpoint|bug|debug|exception|traceback|stack ?trace|compiler?|"
    r"refactor|unit tests?|algorithm|snippet|syntax error|python|javascript|typescript|java|c\+\+|golang|rust|kotlin|"
    r"swift|php|ruby|bash|html|css|react|next\.?js|node\.?js|flask|django|pandas|numpy|docker|kubernetes|github|"
    r"json|yaml|npm|pip)\b|\b\w+\(\)|[{};]\s*$",
    re.I | re.M,
)
_DEBUG = re.compile(
    r"\b(bug|debug|error|exception|traceback|stack ?trace|crash(es|ed|ing)?|fails?|failing|failed|broken|"
    r"not working|doesn'?t work|isn'?t working|throws?|thrown|segfault|undefined is not|cannot read|"
    r"\d{3} (error|internal server error)|status code \d{3}|\w+(Error|Exception))\b|^\s*(Traceback|File \"|at [\w.$]+\()",
    re.I | re.M,
)
_MATH = re.compile(
    r"\b(solve|equation|integral|integrate|derivative|differentiate|limit of|matrix|matrices|determinant|"
    r"eigen\w*|algebra|calculus|trigonometry|geometry|probability|permutations?|combinations?|factori[sz]e|"
    r"simplify|prove that|theorem|sqrt|log(arithm)?|sin|cos|tan|polynomial|quadratic|mean|median|variance|"
    r"standard deviation)\b|\b[a-z]\s*[\^²³]|\d\s*[a-z]\s*[-+=]|[=<>]\s*-?\d+\s*$",
    re.I,
)
_PROBLEM = re.compile(
    r"\b(how (do|can|should) i|how to|help me|what should i do|plan|strategy|steps to|approach|"
    r"best way|improve|reduce|increase|fix my|solve my|problem|issue|struggling|stuck)\b",
    re.I,
)
_DIAGRAM = re.compile(
    r"\b(flow ?charts?|flow ?diagrams?|diagram|mermaid|process (map|flow)|swim ?lanes?|sequence diagram|"
    r"workflow chart|draw (the|a|this) (flow|process))\b",
    re.I,
)
_ANALYSE = re.compile(
    r"\b(analy[sz]e|analysis|review|summari[sz]e|summary|insights?|key points|overview|breakdown|audit|"
    r"extract|go through|explain (this|the) (file|document|pdf|deck|sheet|report))\b",
    re.I,
)
_REASONING = re.compile(
    r"\b(calculate|compute|solve|prove|derive|how (much|many|long)|step[- ]by[- ]step|reason|logic|puzzle|riddle|"
    r"probability|odds|compare|comparison|which is better|should i|pros and cons|trade-?offs?|estimate|what if|"
    r"break[- ]?even|compound|cagr|irr|npv|emi|percentage of|average of)\b|\d\s*[-+*/×÷^]\s*\d",
    re.I,
)


def resolve(agent_id: str | None, question: str, analysis: QueryAnalysis, *, suggested: str | None = None,
            has_images: bool = False, has_files: bool = False) -> Agent:
    """The agent the user picked; for "auto", the understanding step's suggestion, else the best rule match.

    Images and attached files always get the agent that can read them unless the user picked another.
    """
    if agent_id in AGENTS and agent_id != "auto":
        return AGENTS[agent_id]
    wants_diagram = suggested == "diagram" or bool(_DIAGRAM.search(question))
    if has_images:
        return DIAGRAM if wants_diagram else IMAGE
    if suggested in ("files", "analyst") and not has_files:
        suggested = "research"
    if suggested in AGENTS and suggested != "image":
        return FILES if has_files and suggested in ("general", "research") else AGENTS[suggested]
    if wants_diagram:
        return DIAGRAM
    if has_files:
        return ANALYST if _ANALYSE.search(question) else FILES
    if _DEBUG.search(question) and (_CODE.search(question) or re.search(r"\w+(Error|Exception)\b|\n", question.strip())):
        return DEBUGGING
    if _CODE.search(question):
        return CODE
    if _MATH.search(question) and not any(t in question.lower() for t in FINANCE_TERMS):
        return MATH
    if _REASONING.search(question):
        return REASONING
    if analysis.intent == "document_question":
        return RESEARCH
    if analysis.intent == "finance_question" or any(t in question.lower() for t in FINANCE_TERMS):
        return FINANCE
    if _PROBLEM.search(question):
        return PROBLEM
    return GENERAL
