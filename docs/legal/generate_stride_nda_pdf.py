#!/usr/bin/env python3
"""Generate the execution-ready Stride California NDA PDF from Markdown."""

from __future__ import annotations

import html
import re
import sys
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase import pdfmetrics
from reportlab.platypus import (
    KeepTogether,
    ListFlowable,
    ListItem,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
)


HERE = Path(__file__).resolve().parent
SOURCE = HERE / "stride-team-confidentiality-agreement-ca.md"
OUTPUT = HERE / "Stride_Biometrics_Team_NDA_California.pdf"


def register_fonts() -> tuple[str, str, str, str]:
    """Prefer system Times New Roman, with PDF built-ins as a fallback."""
    candidates = [
        (
            Path("/Library/Fonts/Times New Roman.ttf"),
            Path("/Library/Fonts/Times New Roman Bold.ttf"),
            Path("/Library/Fonts/Times New Roman Italic.ttf"),
            Path("/Library/Fonts/Times New Roman Bold Italic.ttf"),
        ),
        (
            Path("/System/Library/Fonts/Supplemental/Times New Roman.ttf"),
            Path("/System/Library/Fonts/Supplemental/Times New Roman Bold.ttf"),
            Path("/System/Library/Fonts/Supplemental/Times New Roman Italic.ttf"),
            Path("/System/Library/Fonts/Supplemental/Times New Roman Bold Italic.ttf"),
        ),
    ]
    for regular, bold, italic, bold_italic in candidates:
        if all(path.exists() for path in (regular, bold, italic, bold_italic)):
            pdfmetrics.registerFont(TTFont("NDA-Times", str(regular)))
            pdfmetrics.registerFont(TTFont("NDA-Times-Bold", str(bold)))
            pdfmetrics.registerFont(TTFont("NDA-Times-Italic", str(italic)))
            pdfmetrics.registerFont(TTFont("NDA-Times-BoldItalic", str(bold_italic)))
            pdfmetrics.registerFontFamily(
                "NDA-Times",
                normal="NDA-Times",
                bold="NDA-Times-Bold",
                italic="NDA-Times-Italic",
                boldItalic="NDA-Times-BoldItalic",
            )
            return (
                "NDA-Times",
                "NDA-Times-Bold",
                "NDA-Times-Italic",
                "NDA-Times-BoldItalic",
            )
    return ("Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic")


REGULAR, BOLD, ITALIC, BOLD_ITALIC = register_fonts()


def inline_markup(text: str) -> str:
    escaped = html.escape(text, quote=False)
    escaped = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", escaped)
    escaped = re.sub(r"(?<!\*)\*([^*]+?)\*(?!\*)", r"<i>\1</i>", escaped)
    return escaped


def styles() -> dict[str, ParagraphStyle]:
    return {
        "title": ParagraphStyle(
            "Title",
            fontName=BOLD,
            fontSize=15,
            leading=18,
            alignment=TA_CENTER,
            spaceAfter=3,
            textColor=colors.HexColor("#111111"),
        ),
        "subtitle": ParagraphStyle(
            "Subtitle",
            fontName=ITALIC,
            fontSize=10.5,
            leading=13,
            alignment=TA_CENTER,
            spaceBefore=4,
            spaceAfter=18,
            textColor=colors.HexColor("#333333"),
        ),
        "section": ParagraphStyle(
            "Section",
            fontName=BOLD,
            fontSize=10.5,
            leading=13,
            alignment=TA_LEFT,
            spaceBefore=11,
            spaceAfter=5,
            keepWithNext=True,
            textColor=colors.HexColor("#111111"),
        ),
        "signature_heading": ParagraphStyle(
            "SignatureHeading",
            fontName=BOLD,
            fontSize=10.5,
            leading=13,
            alignment=TA_LEFT,
            spaceBefore=13,
            spaceAfter=8,
            keepWithNext=True,
        ),
        "body": ParagraphStyle(
            "Body",
            fontName=REGULAR,
            fontSize=10.25,
            leading=13.4,
            alignment=TA_JUSTIFY,
            spaceAfter=7,
            allowWidows=0,
            allowOrphans=0,
            splitLongWords=False,
        ),
        "bullet": ParagraphStyle(
            "Bullet",
            fontName=REGULAR,
            fontSize=10.1,
            leading=13.1,
            alignment=TA_JUSTIFY,
            leftIndent=0,
            firstLineIndent=0,
            spaceAfter=2.5,
            allowWidows=0,
            allowOrphans=0,
        ),
        "signature_line": ParagraphStyle(
            "SignatureLine",
            fontName=REGULAR,
            fontSize=10.25,
            leading=14,
            alignment=TA_LEFT,
            spaceAfter=8,
        ),
    }


def flush_paragraph(lines: list[str], story: list, style_map: dict[str, ParagraphStyle]) -> None:
    if not lines:
        return
    text = " ".join(part.strip() for part in lines).strip()
    if text:
        story.append(Paragraph(inline_markup(text), style_map["body"]))
    lines.clear()


def flush_bullets(items: list[str], story: list, style_map: dict[str, ParagraphStyle]) -> None:
    if not items:
        return
    flowables = [
        ListItem(
            Paragraph(inline_markup(item), style_map["bullet"]),
            leftIndent=13,
            bulletColor=colors.HexColor("#222222"),
        )
        for item in items
    ]
    story.append(
        ListFlowable(
            flowables,
            bulletType="bullet",
            start="\u2022",
            leftIndent=18,
            bulletFontName=REGULAR,
            bulletFontSize=11,
            bulletOffsetY=0,
            spaceAfter=7,
        )
    )
    items.clear()


def build_story(source_text: str) -> list:
    style_map = styles()
    story: list = []
    paragraph_lines: list[str] = []
    bullets: list[str] = []
    title_count = 0
    signatures_started = False

    for raw_line in source_text.splitlines():
        line = raw_line.rstrip()

        if line.startswith("- "):
            flush_paragraph(paragraph_lines, story, style_map)
            bullets.append(line[2:].strip())
            continue

        flush_bullets(bullets, story, style_map)

        if not line.strip():
            flush_paragraph(paragraph_lines, story, style_map)
            continue

        if line.startswith("# "):
            flush_paragraph(paragraph_lines, story, style_map)
            title_count += 1
            story.append(Paragraph(inline_markup(line[2:].strip()), style_map["title"]))
            if title_count == 2:
                story.append(Spacer(1, 4))
            continue

        if line.startswith("## "):
            flush_paragraph(paragraph_lines, story, style_map)
            heading = line[3:].strip()
            if heading == "ACKNOWLEDGMENT AND SIGNATURES":
                story.append(PageBreak())
                signatures_started = True
            story.append(Paragraph(inline_markup(heading), style_map["section"]))
            continue

        if line.startswith("### "):
            flush_paragraph(paragraph_lines, story, style_map)
            story.append(
                Paragraph(inline_markup(line[4:].strip()), style_map["signature_heading"])
            )
            continue

        if title_count >= 2 and line.startswith("**California"):
            flush_paragraph(paragraph_lines, story, style_map)
            story.append(
                Paragraph(inline_markup(line.strip("*")), style_map["subtitle"])
            )
            continue

        if signatures_started and ("___" in line or line.startswith("Mailing address:")):
            flush_paragraph(paragraph_lines, story, style_map)
            story.append(Paragraph(inline_markup(line), style_map["signature_line"]))
            continue

        paragraph_lines.append(line)

    flush_paragraph(paragraph_lines, story, style_map)
    flush_bullets(bullets, story, style_map)
    return story


def page_decoration(canvas, doc) -> None:
    canvas.saveState()
    width, height = LETTER
    canvas.setStrokeColor(colors.HexColor("#B8B8B8"))
    canvas.setLineWidth(0.4)
    canvas.line(doc.leftMargin, height - 0.58 * inch, width - doc.rightMargin, height - 0.58 * inch)
    canvas.line(doc.leftMargin, 0.58 * inch, width - doc.rightMargin, 0.58 * inch)

    canvas.setFont(REGULAR, 8)
    canvas.setFillColor(colors.HexColor("#555555"))
    canvas.drawString(
        doc.leftMargin,
        height - 0.47 * inch,
        "STRIDE BIOMETRICS, LLC  |  CONFIDENTIALITY AND NON-DISCLOSURE AGREEMENT",
    )
    canvas.drawString(doc.leftMargin, 0.39 * inch, "California form  |  September 2026")
    canvas.drawRightString(
        width - doc.rightMargin,
        0.39 * inch,
        f"Page {canvas.getPageNumber()}",
    )
    canvas.restoreState()


def main() -> None:
    source = SOURCE.read_text(encoding="utf-8")
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)

    document = SimpleDocTemplate(
        str(OUTPUT),
        pagesize=LETTER,
        rightMargin=0.82 * inch,
        leftMargin=0.82 * inch,
        topMargin=0.78 * inch,
        bottomMargin=0.75 * inch,
        title="Stride Biometrics, LLC — Confidentiality and Non-Disclosure Agreement",
        author="Stride Biometrics, LLC",
        subject="California confidentiality and non-disclosure agreement for prospective and current team members",
        creator="Stride Biometrics, LLC",
        pageCompression=1,
    )
    document.build(
        build_story(source),
        onFirstPage=page_decoration,
        onLaterPages=page_decoration,
    )
    print(OUTPUT)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"PDF generation failed: {exc}", file=sys.stderr)
        raise
